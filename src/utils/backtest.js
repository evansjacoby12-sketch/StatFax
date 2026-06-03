/**
 * Backtest log — records each day's predictions to AsyncStorage so we can
 * verify whether PRIME/STRONG/etc. picks actually homered, and aggregate
 * the model's empirical performance by GRADE, by BADGE, and by SCORE DECILE.
 *
 * Data shape (per day):
 *   {
 *     date: 'YYYY-MM-DD',
 *     checked: bool,
 *     predictions: [{
 *       playerId, name, team,
 *       score, grade,
 *       hot, due, cold, bullpenLegend, homeEdge, awayEdge,
 *       zoneMaster, barrelKing, launchPad,
 *       hr: null | true | false,
 *     }],
 *   }
 *
 * Workflow:
 *   logPredictions(date, batters)            → save today's predictions
 *   reconcileDay(date)                        → fetch actual HR hitters and mark hits
 *   getRollingStats(days)                     → grade × hit-rate buckets (legacy)
 *   getPerformanceReport(days)                → full report: grades + badges + deciles
 *   pruneOldLogs()                            → drop entries older than RETENTION_DAYS
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { MLBService } from '../sports/mlb/api/MLBService';
import { fetchBacktestLog } from '../api/BackendService';

const KEY_PREFIX = 'hrsauce_backtest_';
const AUTO_RECONCILE_KEY = 'statfax_auto_reconcile_last';

/**
 * Auto-reconcile yesterday's predictions whenever the user opens the app
 * between 12 AM and 3 AM Central time. We can't run a true background job
 * on Expo Go, so this is the next-best thing: a foreground gate that fires
 * once per day during the window. Storage flag keys off the YYYY-MM-DD date
 * the reconciliation belongs to so the same window can't double-run.
 *
 * Returns true if reconciliation ran, false otherwise.
 */
export async function autoReconcileIfDue() {
  // Previously this only ran inside a narrow 12-3 AM CT window — which only
  // worked if the user happened to open the app in that 3-hour slot. Expo Go
  // can't run true background jobs, so most users would sleep through it.
  //
  // The window was originally meant to be the "MLB results are stable" gate,
  // but yesterday's data is stable from ~3 AM CT onward and never changes
  // again. New rule: any time the CT clock is past 3 AM, yesterday's games
  // are all final and we can safely reconcile. The once-per-day dedupe flag
  // (statfax_auto_reconcile_last) prevents double-runs.
  const hourFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', hour: 'numeric', hour12: false,
  });
  const dateFmt = new Intl.DateTimeFormat('en-CA', {  // en-CA → YYYY-MM-DD
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const now = new Date();
  const hour = parseInt(hourFmt.format(now), 10);
  // Skip 12-3 AM CT: latest west-coast games (or extra-innings stragglers)
  // could still be wrapping up. After 3 AM CT, every game from yesterday is
  // definitively final.
  if (!Number.isFinite(hour) || hour < 3) return false;

  const yesterdayKey = dateFmt.format(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  // Skip if we already reconciled this date during this window
  try {
    const lastDone = await AsyncStorage.getItem(AUTO_RECONCILE_KEY);
    if (lastDone === yesterdayKey) return false;
  } catch {}

  try {
    await reconcileDay(yesterdayKey);

    // One-time-per-version recovery: walk the last 7 days and force-rerun
    // any day that's marked checked=true but has ZERO predictions flagged
    // as HR hits. The old live-feed harvester silently failed on past dates
    // and left days stuck at "0 Homered" forever, since the normal path
    // short-circuits on checked=true. A real 0-HR day across 250 predictions
    // is statistically impossible, so we use that as the "botched reconcile"
    // signature and force a re-fetch with the new boxscore harvester.
    try {
      const keys = await AsyncStorage.getAllKeys().catch(() => []);
      const recent = keys.filter(k => k.startsWith(KEY_PREFIX)).sort().slice(-7);
      for (const k of recent) {
        const raw = await AsyncStorage.getItem(k).catch(() => null);
        if (!raw) continue;
        let entry;
        try { entry = JSON.parse(raw); } catch { continue; }
        if (!entry.checked) continue;
        const hadAnyHits = entry.predictions?.some(p => p.hr === true);
        const hasEnoughPicks = (entry.predictions?.length || 0) >= 30;
        if (!hadAnyHits && hasEnoughPicks) {
          await reconcileDay(k.replace(KEY_PREFIX, ''), { force: true });
        }
      }
    } catch {}

    await AsyncStorage.setItem(AUTO_RECONCILE_KEY, yesterdayKey).catch(() => {});
    return true;
  } catch {
    return false;
  }
}
const RETENTION_DAYS = 60;     // bumped — model perf wants ≥30 days of history

const key = (date) => `${KEY_PREFIX}${date}`;

// MLB-wide HR rate baseline — roughly 5% of batter games end with a HR.
// Used as the "edge vs baseline" reference in the performance report.
export const MLB_BASELINE_HR_RATE = 0.05;

// All known badges we want to track empirical hit-rates for. Each entry
// also encodes the human-readable label used in the report UI.
export const TRACKED_BADGES = [
  { key: 'hot',           label: 'HOT BAT'         },
  { key: 'due',           label: 'DUE'             },
  { key: 'cold',          label: 'COLD'            },
  { key: 'bullpenLegend', label: 'BULLPEN LEGEND'  },
  { key: 'zoneMaster',    label: 'ZONE MASTER'     },
  { key: 'barrelKing',    label: 'BARREL KING'     },
  { key: 'launchPad',     label: 'LAUNCH PAD'      },
  { key: 'homeEdge',      label: 'HOME BOOST'      },
  { key: 'awayEdge',      label: 'ROAD WARRIOR'    },
];

// Score buckets for the calibration plot. Each player's score is dropped
// into the matching bucket and we compare actual hit-rate to expected.
export const SCORE_DECILES = [
  { min: 0,  max: 39, label: 'Under 40' },
  { min: 40, max: 49, label: '40–49'    },
  { min: 50, max: 59, label: '50–59'    },
  { min: 60, max: 69, label: '60–69'    },
  { min: 70, max: 79, label: '70–79'    },
  { min: 80, max: 89, label: '80–89'    },
  { min: 90, max: 200, label: '90+'     },
];

/**
 * Log today's predictions. MERGE semantics — never shrinks the daily log.
 *
 * Why merge instead of overwrite:
 *   `getSchedule` drops Final games from the slate, so a fetch late in the
 *   evening returns fewer games than the same day fetched at noon. The OLD
 *   behavior overwrote the morning's full 270-batter log with the evening's
 *   thinner 72-batter set — predictions for games that already played were
 *   wiped, and "yesterday's results" showed catastrophically too few picks.
 *
 *   New behavior: keep every predictionId already in the log. New playerIds
 *   get added. Existing entries keep their FIRST-seen score/grade/badges,
 *   which is the closer-to-pregame truth (later refreshes may reflect live
 *   state we don't want to evaluate against).
 *
 *   Once `checked: true`, the file is locked entirely — re-reconciling a
 *   prior day shouldn't get clobbered by a stale slate fetch.
 */
export async function logPredictions(date, batters) {
  if (!date || !Array.isArray(batters)) return;
  // Build the candidate predictions from THIS fetch's batters
  const newPredictions = batters
    .filter(b => b.grade?.label && b.score != null)
    .map(b => ({
      playerId:      b.playerId,
      name:          b.name,
      team:          b.team,
      score:         b.score,
      grade:         b.grade.label,
      hot:           !!b.hot,
      due:           !!b.due,
      cold:          !!b.cold,
      bullpenLegend: !!b.bullpenLegend,
      homeEdge:      !!b.homeEdge,
      awayEdge:      !!b.awayEdge,
      // Premium badges — derived from snapshot fields (same thresholds as the
      // UI chips + server reconcile.mjs) so the local-fallback lift table
      // matches the remote one. day/night + home/away-struggles were dropped.
      zoneMaster:    b.zoneMatchup?.badge === 'ZONE_MASTER',
      barrelKing:    Number.isFinite(b.barrelPctBBE)     && b.barrelPctBBE     >= 13,
      launchPad:     Number.isFinite(b.gameParkHRFactor) && b.gameParkHRFactor >= 1.10,
      hr:            null,
    }));

  // Load the existing entry, if any
  let existing = null;
  try {
    const raw = await AsyncStorage.getItem(key(date));
    if (raw) existing = JSON.parse(raw);
  } catch {}

  // Already reconciled? Don't touch — the day is "final."
  if (existing?.checked) return;

  // Merge: keep all existing predictions, add any new playerId we don't yet have.
  const byId = new Map();
  for (const p of existing?.predictions ?? []) {
    byId.set(String(p.playerId), p);
  }
  for (const p of newPredictions) {
    const id = String(p.playerId);
    if (!byId.has(id)) byId.set(id, p);
    // If we DO have an entry already, keep the original — it's closer to
    // pre-game truth than this later fetch (which may reflect live state).
  }

  const merged = { date, predictions: [...byId.values()], checked: false };
  await AsyncStorage.setItem(key(date), JSON.stringify(merged)).catch(() => {});
}

/**
 * Fetch actual HR hitters for a date via MLB API and mark predictions accordingly.
 * Skips if already reconciled, UNLESS `force=true` is passed (used by the
 * manual "Check Yesterday" button to recover from a previously botched
 * reconciliation — e.g., the live-feed-vs-boxscore bug that marked every
 * prediction as a miss).
 */
export async function reconcileDay(date, { force = false } = {}) {
  const raw = await AsyncStorage.getItem(key(date)).catch(() => null);
  if (!raw) return null;

  const entry = JSON.parse(raw);
  if (entry.checked && !force) return entry;

  try {
    // Use the count-aware harvest so we can credit multi-HR games (a guy
    // who went 2-for-2 should show up as 2 HRs in the total). Each map
    // value is { count, name, team } so we can list missed batters by
    // name in the report (not just "playerId 12345").
    const hrMap = typeof MLBService.getTodaysHRMap === 'function'
      ? await MLBService.getTodaysHRMap(date)
      : await (async () => {
          const ids = await MLBService.getTodaysHRHitters(date);
          const m = new Map();
          for (const id of ids) m.set(id, { count: 1, name: '', team: '' });
          return m;
        })();

    // Normalize legacy shape — older entries returned just a number, newer
    // ones return { count, name, team }. Coerce both into the rich shape.
    const richMap = new Map();
    for (const [id, val] of hrMap) {
      if (typeof val === 'number') {
        richMap.set(id, { count: val, name: '', team: '' });
      } else {
        richMap.set(id, val);
      }
    }

    // Safety guard: if force=true and the fresh fetch returned an empty map
    // (e.g., network blip or MLB API hiccup), don't overwrite a previously
    // populated reconciliation. Without this, repeatedly tapping the manual
    // check button during an outage could wipe out a good reconcile.
    if (force && entry.checked && richMap.size === 0) {
      const previouslyHadAnyHits = entry.predictions?.some(p => p.hr === true);
      if (previouslyHadAnyHits) return entry;
    }

    // Normalize ID types — MLB API returns numbers, but logPredictions has
    // stored strings in some historical rows. String-compare both sides so
    // the hit/miss flag is computed correctly regardless of source type.
    const richByStringId = new Map();
    for (const [id, val] of richMap) richByStringId.set(String(id), val);

    entry.predictions = entry.predictions.map(p => {
      const v = richByStringId.get(String(p.playerId));
      const count = v?.count || 0;
      return { ...p, hr: count > 0, hrCount: count };
    });

    // Build the "missed coverage" list — HR hitters MLB-wide who weren't
    // in our predictions at all. This is the diagnostic for "the model
    // shows 8 but I see 11 on StatMuse" — surfaces exactly which 3 got
    // missed, so we can tell whether it's late lineup changes, recent
    // call-ups/trades, roster cache staleness, or a real coverage bug.
    const predictedIds = new Set(entry.predictions.map(p => String(p.playerId)));
    const missedHitters = [];
    for (const [id, val] of richByStringId) {
      if (!predictedIds.has(id)) {
        missedHitters.push({
          playerId: id,
          name:     val.name,
          team:     val.team,
          hrCount:  val.count,
        });
      }
    }
    // Sort by count desc then name so multi-HR misses surface first
    missedHitters.sort((a, b) => (b.hrCount - a.hrCount) || (a.name || '').localeCompare(b.name || ''));
    entry.missedHitters = missedHitters;

    // Also capture the MLB-wide totals for context.
    entry.mlbTotalHRs        = [...richMap.values()].reduce((s, v) => s + (v.count || 0), 0);
    entry.mlbUniqueHRHitters = richMap.size;
    entry.checked = true;
    await AsyncStorage.setItem(key(date), JSON.stringify(entry)).catch(() => {});
    return entry;
  } catch {
    return entry;
  }
}

/**
 * Legacy: rolls up hit rates by grade across the last N reconciled days.
 * Kept so the existing "Check Yesterday's Results" UI keeps working.
 */
export async function getRollingStats(days = 7) {
  const keys = await AsyncStorage.getAllKeys().catch(() => []);
  const ours = keys.filter(k => k.startsWith(KEY_PREFIX)).sort().slice(-days);
  if (!ours.length) return null;

  const rows = await AsyncStorage.multiGet(ours).catch(() => []);
  const buckets = { PRIME: { hit: 0, total: 0 }, STRONG: { hit: 0, total: 0 }, LEAN: { hit: 0, total: 0 }, SKIP: { hit: 0, total: 0 } };
  let daysChecked = 0;

  for (const [, raw] of rows) {
    if (!raw) continue;
    const entry = JSON.parse(raw);
    if (!entry.checked) continue;
    daysChecked++;
    for (const p of entry.predictions) {
      if (!buckets[p.grade]) continue;
      buckets[p.grade].total++;
      if (p.hr) buckets[p.grade].hit++;
    }
  }
  return { daysChecked, buckets };
}

/**
 * Comprehensive model-performance report over the last N reconciled days.
 *
 * Returns:
 *   {
 *     days, daysChecked, totalPredictions,
 *     overall: { hit, total, rate, edge }   // edge = rate - MLB_BASELINE_HR_RATE
 *     grades: {
 *       PRIME:  { hit, total, rate, edge },
 *       STRONG: { hit, total, rate, edge },
 *       LEAN:   { hit, total, rate, edge },
 *       SKIP:   { hit, total, rate, edge },
 *     },
 *     badges: [
 *       { key, label, with: { hit, total, rate }, without: { hit, total, rate }, lift }
 *     ],   // sorted by lift (positive lift = badge predicts HRs better than non-badge)
 *     deciles: [
 *       { label, min, max, hit, total, rate, edge }
 *     ],
 *   }
 *
 * If no reconciled days are found, returns null.
 */
export async function getPerformanceReport(days = 30, opts = {}) {
  // ── Step 1: pull predictions for aggregation ────────────────────────────
  //
  // PRIMARY source: the shared backtest log the cron writes to R2 after
  // each reconciliation. EVERY device reads the same JSON, so overall /
  // grades / badges / deciles are identical across devices — fixes the
  // "my StatRecap says 263, friend says 258" drift where every device
  // had its own per-device AsyncStorage log accumulating differently
  // (depending on install date + how often the user tapped Check
  // Yesterday).
  //
  // FALLBACK source: local AsyncStorage. Used when the network call
  // fails (cron R2 unreachable, offline, etc.) so the screen still
  // renders something instead of empty-stating.
  //
  // We ALSO read local for `byDay` + `missedHitters` regardless of which
  // primary source won — those fields aren't in the remote log shape and
  // the local log accumulates them per-device. Hybrid: cross-device
  // headlines + per-device drill-down. Future enhancement: enrich the
  // cron's log writer to include per-day mlbTotalHRs + missedHitters and
  // we can drop the local read entirely.

  const all = [];                  // primary aggregation array
  let daysChecked = 0;
  let totalHRsFromPicks    = 0;
  let mlbTotalHRs          = 0;
  let mlbUniqueHRHitters   = 0;
  const recentMissedHitters = [];
  const byDay = [];

  // Helper: convert a single remote record to the local-shaped object the
  // aggregation loops below expect. Remote shape (server/reconcile.mjs):
  //   { playerId, name, score, grade, badges: string[], homered }
  // Local shape:
  //   { playerId, name, team, score, grade, hot, due, ..., hr }
  function adaptRemote(rec) {
    const out = {
      playerId: rec.playerId,
      name:     rec.name,
      score:    rec.score,
      grade:    rec.grade,
      hr:       !!rec.homered,
    };
    if (Array.isArray(rec.badges)) {
      for (const b of rec.badges) out[b] = true;
    }
    return out;
  }

  // ── Try remote first ────────────────────────────────────────────────────
  // Tracks which dates the remote already provided. Local-only dates (e.g.,
  // user tapped "Check Yesterday" before the cron's daily reconcile fired)
  // get layered in below so they DON'T disappear from the report. Net
  // effect: cross-device parity for dates the cron has reconciled (which
  // is the bulk of history), plus per-device extras for the edge case
  // where the user manually reconciled ahead of the cron.
  const remoteDates = new Set();
  let usedRemote = false;
  try {
    const remote = await fetchBacktestLog();
    if (remote?.records) {
      // Which reconciled dates to pull from the remote map. A single-date
      // ("Yesterday") query indexes the map directly — the cron's log IS
      // keyed by date, so there's no reason to fall back to per-device local
      // reconciliation. That matters because the 2.0 shell never runs the
      // local reconcile loop (it lived in 1.x's HomeScreen/AppContent), so
      // "Yesterday" was reading unreconciled local picks and showing 0 HRs.
      // Multi-day windows take the most recent N reconciled dates as before.
      const wanted = opts.specificDate
        ? (remote.records[opts.specificDate] ? [opts.specificDate] : [])
        : (remote.dates?.length ? remote.dates.slice(-days) : []);
      for (const date of wanted) {
        const records = remote.records[date];
        if (!Array.isArray(records) || !records.length) continue;
        daysChecked++;
        remoteDates.add(date);
        let dayHit = 0;
        for (const rec of records) {
          const adapted = adaptRemote(rec);
          all.push(adapted);
          if (adapted.hr) dayHit++;
        }
        // byDay from remote — mlbTotal/mlbUnique stay 0 here (not in remote
        // shape yet); we'll overlay local values for them below.
        byDay.push({
          date, total: records.length, hit: dayHit, hrCount: dayHit,
          mlbTotal: 0, mlbUnique: 0, missed: [],
        });
      }
      usedRemote = all.length > 0;
    }
  } catch {
    // network/parse failure → fall through to local
  }

  // ── Local read (always for byDay enrichment; primary only if remote failed) ──
  const keys = await AsyncStorage.getAllKeys().catch(() => []);
  let ours = keys.filter(k => k.startsWith(KEY_PREFIX)).sort();
  if (opts.specificDate) {
    ours = ours.filter(k => k === key(opts.specificDate));
  } else {
    ours = ours.slice(-days);
  }
  const rows = ours.length ? await AsyncStorage.multiGet(ours).catch(() => []) : [];
  for (const [k, raw] of rows) {
    if (!raw) continue;
    let entry;
    try { entry = JSON.parse(raw); } catch { continue; }
    if (!entry.checked || !Array.isArray(entry.predictions)) continue;

    const dateStr = entry.date || k.replace(KEY_PREFIX, '');

    // When remote won AND has this date: only mine local for per-day
    // enrichments (mlbTotal/mlbUnique/missed). Don't push predictions to
    // `all` — that'd double-count what remote already contributed.
    //
    // When remote won but does NOT have this date: push the local entry's
    // predictions to `all` too. This handles the "user tapped Check
    // Yesterday before the cron auto-reconciled" case — without this,
    // their manual reconcile would silently not show up in StatRecap.
    // Once the cron reconciles that date (next daily run), remoteDates
    // will include it and we'll prefer remote on subsequent calls.
    if (usedRemote) {
      if (remoteDates.has(dateStr)) {
        const existing = byDay.find(d => d.date === dateStr);
        if (existing) {
          existing.mlbTotal  = entry.mlbTotalHRs        || 0;
          existing.mlbUnique = entry.mlbUniqueHRHitters || 0;
          existing.missed    = Array.isArray(entry.missedHitters) ? entry.missedHitters : [];
        }
        mlbTotalHRs        += entry.mlbTotalHRs        || 0;
        mlbUniqueHRHitters += entry.mlbUniqueHRHitters || 0;
        continue;
      }
      // Local-only date: layer it in. Push predictions to `all` + add a
      // byDay entry. daysChecked increments because we have a real
      // reconciled day worth of data.
      daysChecked++;
      let dayHit = 0;
      let dayTotal = 0;
      let dayHRs = 0;
      for (const p of entry.predictions) {
        if (p.hr == null) continue;
        all.push(p);
        dayTotal++;
        if (p.hr) dayHit++;
        const cnt = typeof p.hrCount === 'number' ? p.hrCount : (p.hr ? 1 : 0);
        dayHRs += cnt;
      }
      totalHRsFromPicks  += dayHRs;
      mlbTotalHRs        += entry.mlbTotalHRs        || 0;
      mlbUniqueHRHitters += entry.mlbUniqueHRHitters || 0;
      byDay.push({
        date:      dateStr,
        total:     dayTotal,
        hit:       dayHit,
        hrCount:   dayHRs,
        mlbTotal:  entry.mlbTotalHRs        || 0,
        mlbUnique: entry.mlbUniqueHRHitters || 0,
        missed:    Array.isArray(entry.missedHitters) ? entry.missedHitters : [],
      });
      continue;
    }

    // Local-only path (remote unavailable) — populate `all` + byDay from local.
    daysChecked++;
    let dayHit = 0;
    let dayTotal = 0;
    let dayHRs = 0;
    for (const p of entry.predictions) {
      if (p.hr == null) continue;
      all.push(p);
      dayTotal++;
      if (p.hr) dayHit++;
      const cnt = typeof p.hrCount === 'number' ? p.hrCount : (p.hr ? 1 : 0);
      dayHRs += cnt;
    }
    totalHRsFromPicks   += dayHRs;
    mlbTotalHRs         += entry.mlbTotalHRs        || 0;
    mlbUniqueHRHitters  += entry.mlbUniqueHRHitters || 0;
    byDay.push({
      date:      dateStr,
      total:     dayTotal,
      hit:       dayHit,
      hrCount:   dayHRs,
      mlbTotal:  entry.mlbTotalHRs        || 0,
      mlbUnique: entry.mlbUniqueHRHitters || 0,
      missed:    Array.isArray(entry.missedHitters) ? entry.missedHitters : [],
    });
  }

  // When remote won, totalHRsFromPicks falls back to the all-array hit count
  // (every adapted record contributes 1 if homered). Multi-HR games are
  // collapsed to 1 in the remote shape — minor data fidelity loss vs local,
  // acceptable trade for cross-device parity.
  if (usedRemote && totalHRsFromPicks === 0) {
    totalHRsFromPicks = all.filter(p => p.hr).length;
  }

  byDay.sort((a, b) => a.date.localeCompare(b.date));

  // Flatten misses ACROSS the entire window so users can see coverage gaps
  // over multiple days (not just yesterday). Each entry carries its date so
  // the UI can show "May 21 · Schanuel" etc. Sorted by date desc then HR
  // count desc — most recent + multi-HR misses surface first.
  for (const d of byDay) {
    if (!Array.isArray(d.missed) || !d.missed.length) continue;
    for (const m of d.missed) {
      recentMissedHitters.push({ ...m, date: d.date });
    }
  }
  recentMissedHitters.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.hrCount || 0) - (a.hrCount || 0);
  });

  if (!all.length || !daysChecked) {
    return { days, daysChecked, totalPredictions: 0, overall: null, grades: null, badges: [], deciles: [], byDay, recentMissedHitters };
  }

  // ── Overall ─────────────────────────────────────────────────────────────
  const totalPredictions = all.length;
  const overallHit       = all.filter(p => p.hr).length;
  const overallRate      = overallHit / totalPredictions;
  const overall = {
    hit:                overallHit,            // # unique batters from picks who homered
    total:              totalPredictions,
    rate:               overallRate,
    edge:               overallRate - MLB_BASELINE_HR_RATE,
    totalHRsFromPicks,                         // sum of HRs across picks (multi-HR adds up)
    mlbTotalHRs,                               // MLB-wide HR total across reconciled days
    mlbUniqueHRHitters,                        // MLB-wide unique HR hitters
    coverageRate: mlbUniqueHRHitters > 0       // what % of MLB HR hitters were in our picks
      ? overallHit / mlbUniqueHRHitters
      : null,
  };

  // ── Grades ──────────────────────────────────────────────────────────────
  const grades = {};
  for (const key of ['PRIME', 'STRONG', 'LEAN', 'SKIP']) {
    const subset = all.filter(p => p.grade === key);
    const hit    = subset.filter(p => p.hr).length;
    const total  = subset.length;
    grades[key] = {
      hit,
      total,
      rate: total ? hit / total : 0,
      edge: total ? (hit / total) - MLB_BASELINE_HR_RATE : 0,
    };
  }

  // ── Badges ──────────────────────────────────────────────────────────────
  // For each tracked flag, compute the rate of HR among players WITH the flag
  // vs WITHOUT it. "lift" = with-rate − without-rate. Positive lift = the
  // badge identifies HR-prone players above the non-flagged baseline.
  const badges = [];
  for (const { key, label } of TRACKED_BADGES) {
    const withSet    = all.filter(p => p[key]);
    const withoutSet = all.filter(p => !p[key]);
    const withHit    = withSet.filter(p => p.hr).length;
    const withoutHit = withoutSet.filter(p => p.hr).length;
    const withTotal  = withSet.length;
    const withoutTotal = withoutSet.length;
    if (withTotal === 0) {
      // Don't report a badge we have no fired-evidence for; report all others
      // so users can see "0% lift" for ones that activated but didn't help.
      badges.push({
        key, label,
        with:    { hit: 0, total: 0, rate: 0 },
        without: { hit: withoutHit, total: withoutTotal, rate: withoutTotal ? withoutHit / withoutTotal : 0 },
        lift:    null,   // null = insufficient sample
      });
      continue;
    }
    const withRate    = withHit / withTotal;
    const withoutRate = withoutTotal ? withoutHit / withoutTotal : 0;
    badges.push({
      key, label,
      with:    { hit: withHit,    total: withTotal,    rate: withRate    },
      without: { hit: withoutHit, total: withoutTotal, rate: withoutRate },
      lift:    withRate - withoutRate,
    });
  }
  // Sort highest-lift first so the most predictive badges surface at the top.
  badges.sort((a, b) => {
    if (a.lift == null) return 1;
    if (b.lift == null) return -1;
    return b.lift - a.lift;
  });

  // ── Score deciles ───────────────────────────────────────────────────────
  const deciles = SCORE_DECILES.map(({ label, min, max }) => {
    const subset = all.filter(p => p.score >= min && p.score <= max);
    const hit    = subset.filter(p => p.hr).length;
    const total  = subset.length;
    return {
      label, min, max,
      hit,
      total,
      rate: total ? hit / total : 0,
      edge: total ? (hit / total) - MLB_BASELINE_HR_RATE : 0,
    };
  });

  return { days, daysChecked, totalPredictions, overall, grades, badges, deciles, byDay, recentMissedHitters };
}

/** Prune old logs beyond retention window. */
export async function pruneOldLogs() {
  const keys = await AsyncStorage.getAllKeys().catch(() => []);
  const ours = keys.filter(k => k.startsWith(KEY_PREFIX)).sort();
  if (ours.length <= RETENTION_DAYS) return;
  const toRemove = ours.slice(0, ours.length - RETENTION_DAYS);
  await AsyncStorage.multiRemove(toRemove).catch(() => {});
}

/**
 * Manual reconcile sweep — walk over recent logged-but-unreconciled days and
 * try to fetch outcomes. Useful as a daily background job or on app open.
 * Safe to call repeatedly; reconcileDay() is idempotent.
 */
export async function reconcileRecent(days = 7) {
  const keys = await AsyncStorage.getAllKeys().catch(() => []);
  const ours = keys
    .filter(k => k.startsWith(KEY_PREFIX))
    .sort()
    .slice(-days);
  for (const k of ours) {
    const date = k.replace(KEY_PREFIX, '');
    await reconcileDay(date);
  }
}
