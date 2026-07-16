/**
 * reconcile.mjs — server-side calibration loop
 *
 * Given yesterday's published snapshot (the scored batters with their grades +
 * active badges) and the actual game outcomes from MLB's box-score endpoints,
 * this module builds a per-day reconciliation record and appends it to a
 * rolling 30-day operational log plus a compact 180-day model archive. From
 * the operational log it computes per-badge
 * and per-grade multipliers using the same math the on-device path used to
 * use — sqrt-dampened lift ratios clamped to ±8% — and writes them out as
 * `calibration.json` for tomorrow's cron run to load.
 *
 * Why on the server rather than the device:
 *   The on-device path kept a per-user backtest log in AsyncStorage and
 *   recomputed multipliers from that. Two users with different histories
 *   ended up with different multipliers → different displayed scores for the
 *   same player on the same day. The whole point of the backend snapshot is
 *   that everyone reads the same scores. Moving calibration here keeps that
 *   invariant intact and gives the model real empirical correction at the
 *   same time.
 *
 * Boot-strap behavior:
 *   On the very first run there's no prior log. We score with all multipliers
 *   = 1.0, reconcile yesterday once it's available, and start filling the
 *   log. Across ~6-7 days we accumulate enough records (MIN_SAMPLES = 1500,
 *   ~250 batters/day) to flip `ready: true` in the calibration bundle, after
 *   which the multipliers actually move scores.
 */

// Same gate functions the UI board + combo engine run, so the logged values
// match exactly what users saw — the whole point of logging them is to make
// the precision-gate thresholds (heat/setup/positives) forward-validatable
// against real outcomes instead of proxy reconstructions.
import { heatIndex, hrSetup, pitchMixScore } from '../ui/src/lib/scout.js';
import { blastRate, positiveReasonCount, negativeReasonCount } from '../ui/src/lib/combo-engine.js';
import {
  HISTORICAL_FEATURE_VERSION,
  buildHistoricalFeatureCoverage,
  compactHistoricalPitchTypes,
  historicalFeatureVersionOf,
  normalizeHistoricalFeatureVector,
} from './lib/historicalFeatureArchive.mjs';

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const ROLLING_DAYS = 30;
export const MODEL_HISTORY_DAYS = 180;
const MIN_SAMPLES_TO_CALIBRATE = 1500;

// ── Significance-scaled clamp band ──────────────────────────────────────────
// The old clamp gave every signal the same ±8% room regardless of how trustworthy
// its measured lift was. The badge audit showed the trust gap is huge: hot
// (z≈14), homeEdge (z≈5.8), barrelKing (z≈4.7) are rock-solid, while launchPad
// (z≈1.7) and zoneMaster (z≈2.2) sit at noise. So scale each signal's allowed
// deviation from 1.0 by the statistical strength (|z| vs the overall rate) of
// its OWN measured lift: proven signals earn a wider band and move scores more,
// near-noise signals get pulled toward neutral. z is recomputed from the live
// log each run, so this re-weights automatically as the sample grows — no
// hardcoded audit constants to go stale.
const Z_FLOOR  = 2.0;   // |z| at/below this → treat as noise, tightest band
const Z_FULL   = 5.0;   // |z| at/above this → fully trusted, widest band
const DELTA_NOISE = 0.03;  // near-noise signals barely move scores (was a flat 0.08)
const DELTA_MAX   = 0.12;  // proven BADGE gets more room than the old flat cap

// ── Per-GRADE band is much wider than the per-BADGE band ─────────────────────
// The badge band (±12% max) is right for badges: each badge is a small
// additive nudge layered ON TOP of the raw score, and they stack, so a tight
// cap stops pile-on inflation. But the GRADE multiplier is the score's primary
// empirical correction and it must preserve the grade GRADIENT. With the badge
// cap, both PRIME (lift 2.09 → sqrt 1.45) and STRONG saturated to ~1.12, and
// LEAN/SKIP both floored at ~0.88 — collapsing four distinct grades into two
// values and throwing away exactly the signal grades exist to express. Giving
// the per-grade loop its own wider ceiling (±45%) lets the sqrt-dampened lift
// breathe so PRIME > STRONG and LEAN > SKIP instead of all hitting the cap.
// Sqrt-dampening + the 80-sample floor still guard against small-sample noise.

// z-score of a sub-group's HR rate vs the overall rate (binomial SE under the
// null that the group rate equals overall), and the clamp band that strength
// earns. `deltaMax` is the widest band a fully-trusted signal can earn —
// DELTA_MAX for badges, GRADE_DELTA_MAX for grades. Returns { z, delta }.
function significanceBand(rate, n, overallRate, deltaMax = DELTA_MAX) {
  const se = n > 0 ? Math.sqrt((overallRate * (1 - overallRate)) / n) : 0;
  const z = se > 0 ? Math.abs(rate - overallRate) / se : 0;
  const w = Math.max(0, Math.min(1, (z - Z_FLOOR) / (Z_FULL - Z_FLOOR)));
  return { z, delta: DELTA_NOISE + w * (deltaMax - DELTA_NOISE) };
}

// Badges tracked for the StatRecap lift report. Direct boolean fields
// (hot/due/cold/bullpenLegend/homeEdge/awayEdge) PLUS the three "premium"
// badges derived from snapshot fields by activeBadgesForRow(). Day/night was
// dropped (noise — see ProbabilityEngine) and home/away-struggles were never
// surfaced. NOTE: these keys are tracked for REPORTING only — scoring
// calibration applies only the badges ProbabilityEngine passes in
// activeBadgeKeys (which excludes zone/barrel/park, since their signal is
// already baked into the raw score), so nothing here double-counts.
const BADGE_KEYS = ['hot', 'due', 'cold', 'bullpenLegend', 'homeEdge', 'awayEdge', 'powerReady', 'barrelReady', 'zoneMaster', 'barrelKing', 'launchPad'];
const GRADE_KEYS = ['PRIME', 'STRONG', 'LEAN', 'SKIP'];

// The three premium badges aren't boolean row fields — derive them from the
// same snapshot fields + thresholds the UI chips use so the lift table matches
// exactly what users see (ZONE MASTER / BARREL KING / LAUNCH PAD).
const DIRECT_BADGE_FIELDS = ['hot', 'due', 'cold', 'bullpenLegend', 'homeEdge', 'awayEdge', 'powerReady', 'barrelReady'];
function activeBadgesForRow(row) {
  const out = DIRECT_BADGE_FIELDS.filter(k => row[k] === true);
  if (row.zoneMatchup?.badge === 'ZONE_MASTER')                              out.push('zoneMaster');
  if (Number.isFinite(row.barrelPctBBE)     && row.barrelPctBBE     >= 13)   out.push('barrelKing');
  if (Number.isFinite(row.gameParkHRFactor) && row.gameParkHRFactor >= 1.10) out.push('launchPad');
  return out;
}

async function getJson(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * Extract the slim record we keep per prediction. Strips everything we
 * don't need for calibration math (recent stats, savant payload, etc.) so
 * the 30-day log stays small enough to read on every cron run.
 *
 * `lineupConfirmed` is preserved so reconcileDate can break down scratches
 * by confirmation state (confirmed-then-scratched vs. unconfirmed-then-scratched).
 */
export function extractPredictionRecord(row) {
  // Curated numeric FEATURE VECTOR — the model's ingredients at prediction
  // time. Logged so that once a few weeks of reconciled outcomes accrue we can
  // LEARN the core weights from data (a proper re-weighting of the currently
  // hand-tuned composition) instead of hand-tuning ~60 coefficients. Compact
  // short keys + null-on-missing keep the rolling 30-day log small.
  const num = (x) => (Number.isFinite(x) ? +Number(x).toFixed(3) : null);
  const ps  = row.pitcher?.season || null;
  const pr  = row.pitcher?.recentForm || null;
  const bt  = row.batTracking || null;
  const feat = normalizeHistoricalFeatureVector({
    bs:   num(row.batterScore),                   // batter sub-score (0-88)
    ms:   num(row.matchupScore),                  // matchup sub-score (8-100)
    es:   num(row.envScore),                      // environment sub-score (0-100)
    iso:  num(row.season?.iso),
    xiso: num(row.xStats?.xISO),
    xslg: num(row.xStats?.xSLG),
    brl:  num(row.barrelPctBBE),
    rbrl: num(row.recentBarrel?.recentBarrelPct), // last ~14d barrel%
    ev:   num(row.exitVelo),
    hh:   num(row.hardHitPct),
    la:   num(row.launchAngle),
    pull: num(row.pullPct),
    // Ceiling inputs + advisory scores — INSTRUMENTED 2026-07-10 so the
    // barrelScore/formScore ceiling metrics can be forward-validated by
    // shortlist hit-rate (see model-lab/validate-ceil.mjs) before anything
    // built on them ships. Advisory only — none of these feed the HR score.
    mxev: num(row.maxEV),                         // max exit velo (display/noisy — not in composite)
    evhi: num(row.recentBarrel?.recentEVHi),      // robust high-end EV: mean of 5 hardest recent balls
    ss:   num(row.sweetSpotPct),                  // sweet-spot%
    rev:  num(row.recentBarrel?.recentEV),        // recent avg EV (form input)
    hrd:  num(row.hrDistance),                    // avg HR distance (descriptive only)
    bbe:  num(row.seasonBBE),                     // season batted-ball events (ceiling sample size)
    rbbe: num(row.recentBarrel?.recentBBE),       // recent BBE (form sample size)
    ceil: num(row.ceilScore),                     // barrelScore ceiling 0-100
    form: num(row.formScore),                     // formScore 0-100
    // Statcast bat tracking. Keep both the exact List Builder blast gate and
    // its raw season/recent inputs so future definitions can be replayed
    // without reconstructing a value from postgame data.
    bspd: num(bt?.batSpeed),
    blast:num(blastRate(row)),
    blsp: num(bt?.blastPct),
    blpc: num(bt?.blastPerContact),
    rblsp:num(bt?.recentBlastPct),
    rblpc:num(bt?.recentBlastPerContact),
    rsw:  num(bt?.recentSwings),
    sq:   num(bt?.squaredUpPct),
    hsw:  num(bt?.hardSwingPct),
    vhs:  num(bt?.vsHandBlast),
    vhss: num(bt?.vsHandSwings),
    vmx:  num(bt?.vsMixBlast),
    vmc:  num(bt?.vsMixCoverage),
    phr9: num(ps?.hrPer9 ?? ps?.hr9),             // opposing starter HR/9
    pera: num(ps?.era),
    pk9:  num(ps?.kPer9 ?? ps?.k9),
    // Last-five-start aggregate frozen before this game. Dates and individual
    // starts are deliberately omitted; the numeric pregame form is sufficient
    // for recipe replay and avoids carrying bulky game logs per batter.
    prg:  num(pr?.games),
    prip: num(pr?.ip),
    prera:num(pr?.era),
    prhr9:num(pr?.hrPer9),
    prk9: num(pr?.k9),
    prp3: num(pr?.pitchesL3D),
    vdel: num(row.opposingVeloTrend?.veloDelta),     // opposing starter velo trend
    csw:  num(row.opposingVeloTrend?.seasonCswPct),  // opposing starter CSW%
    // Matchup micro-signals — INSTRUMENTED 2026-07-09 so the zone/arsenal/stuff
    // machinery (previously unlogged → unauditable) can be tuned like the batter
    // badges once ~2 weeks of data accrues. Nulls when the engine didn't emit them.
    arse: num(row.matchupSignals?.arsenalEdge),      // pitch-family SLG/RV edge (−6..+10)
    stuff:num(row.matchupSignals?.stuffEdge),        // per-pitch velo/whiff physics (±10)
    zone: num(row.matchupSignals?.zoneFactor),       // pitcher heart/zone/edge location (−5..+8)
    mixf: num(row.matchupSignals?.mixFactor),        // fastball reliance × damage (−5..+8)
    piso: num(row.matchupSignals?.pitchISOAdj),      // per-pitch-type ISO mismatch (−3..+4)
    mrf:  num(row.matchupSignals?.recentForm),       // opposing starter recent-form edge
    mcf:  num(row.matchupSignals?.contactFactor),    // contact collision edge
    park: num(row.gameParkHRFactor),
    vig:  num(row.vegasImpliedProb),              // Vegas implied prob (when odds present)
    ord:  num(row.battingOrder),
    hot:  row.hot ? 1 : 0,
    due:  row.due ? 1 : 0,
    he:   row.homeEdge ? 1 : 0,   // home/park split edge — logged so the homeEdge up-weight is forward-validatable (it wasn't in feat before)
    // Precision-gate inputs, computed with the SAME functions the UI/combo
    // engine use (not proxies). scoreFeatProb reads a fixed FEAT_KEYS list,
    // so extra keys here are inert for the learned model until opted in.
    heat: num(heatIndex(row)),               // Heat Index 0-100 (gate: >=48)
    setup: hrSetup(row).n,                    // HR-setup checklist 0-6 (gate: >=5)
    pm:   num(Number.isFinite(row.pmScore) ? row.pmScore : pitchMixScore(row)), // pitch-mix score 0-10 (gate: >=7); prefer the frozen scalar — final rows lose pitchTypeSplits
    pos:  positiveReasonCount(row),           // good-tone trend count (gate: >=8)
    neg:  negativeReasonCount(row),           // bad-tone trend count (gate: <=3)
  });
  return {
    feat,
    featureVersion: HISTORICAL_FEATURE_VERSION,
    pitchTypes: compactHistoricalPitchTypes(row.pitchTypeSplits),
    playerId:       row.playerId,
    gamePk:         row.gamePk,   // join outcomes per (player, game): a split doubleheader has two prediction rows for one playerId
    name:           row.name,
    // Log the FROZEN pre-game prediction. Once a game starts the server mutates
    // BOTH `score` (live PA-decay, zeroed at Final) AND `grade` (re-derived from
    // that decayed score → every batter collapses to SKIP at Final). Yesterday's
    // PUBLISHED snapshot — which this reconcile reads — is the last run of the
    // night, i.e. post-Final, so reading the live fields filed every player who
    // batted under score ~0 / grade SKIP. That polluted the low buckets of the
    // score→prob curve AND made the per-grade StatRecap read as "almost
    // everything was a Pass" (observed: one day logged 159 of 162 picks SKIP).
    // preGameScore + preGameGrade are the model's actual pre-game call, frozen
    // the instant a game first goes live/Final (see fetch-slate's decay + Final
    // blocks), and are what calibration must measure. Fall back to the live
    // field for rows that never went live (e.g. postponed) — there it IS pregame.
    score:          Number.isFinite(row.preGameScore) ? row.preGameScore : row.score,
    grade:          row.preGameGrade?.label || row.preGameGrade || row.grade?.label || row.grade || null,
    badges:         activeBadgesForRow(row),
    lineupConfirmed: row.lineupConfirmed ?? null,
    // Mirrors the List Builder's deterministic trust gate exactly: healthy
    // rows omit dataTrust.status; warned rows carry one. Logged prospectively
    // so rolling recipe evidence never has to guess whether the gate passed.
    dataTrusted:    !row.dataTrust?.status,
    // Pre-game AB-by-AB sim probability. Logged so the sim-resolution blend
    // weight (server/lib/simResolution.mjs) becomes empirically tunable once a
    // few weeks of reconciled outcomes carry it. Snapshot stores the undecayed
    // engine sim as simHRProb, so this is the frozen pre-game value.
    simHRProb:      Number.isFinite(row.simHRProb) ? +Number(row.simHRProb).toFixed(4) : null,
  };
}

/**
 * Given a date string (YYYY-MM-DD) query MLB's box-score endpoint for every
 * Final game and collect:
 *   - homerers: Set<number> of playerIds with hr >= 1
 *   - played:   Set<number> of playerIds who had any batting stats block
 *               (i.e. at least one PA — their stats.batting object exists)
 *
 * Separating "played" from "homered" fixes a survivorship-bias gap: a batter
 * who was predicted but scratched from the lineup before first pitch has no
 * batting block and correctly lands in neither set. Without the played set,
 * scratched batters would silently count as "predicted but didn't homer",
 * deflating the calibrated hit rate.
 *
 * Returns { homerers: Set<number>, played: Set<number> }, or null on hard
 * failure (caller treats null as "skip reconciliation for this date").
 */
export async function fetchHomerersForDate(date) {
  const sched = await getJson(`${MLB_BASE}/schedule?sportId=1&date=${date}`);
  const games = sched?.dates?.[0]?.games || [];
  if (!games.length) return { homerers: new Set(), played: new Set() };

  const homerers = new Set();      // playerId — legacy combo/history compatibility only
  const played   = new Set();
  const homerersByKey = new Set(); // `${playerId}-${gamePk}` — per-batter reconcile (doubleheader-safe)
  const playedByKey   = new Set();
  let finalCount = 0;
  for (const g of games) {
    // Only count finalized games — postponed/suspended don't reconcile
    // cleanly and would skew the rate downward.
    if (g.status?.abstractGameState !== 'Final') continue;
    finalCount++;
    const bs = await getJson(`${MLB_BASE}/game/${g.gamePk}/boxscore`);
    for (const side of ['home', 'away']) {
      const players = bs?.teams?.[side]?.players || {};
      for (const p of Object.values(players)) {
        const id = p?.person?.id;
        if (!id) continue;
        // Any batter with a stats.batting block had at least one PA.
        if (p?.stats?.batting) {
          played.add(id);
          playedByKey.add(`${id}-${g.gamePk}`);
          const hr = p.stats.batting.homeRuns;
          if (Number.isFinite(hr) && hr > 0) {
            homerers.add(id);
            homerersByKey.add(`${id}-${g.gamePk}`);
          }
        }
      }
    }
  }
  const allFinal = games.length > 0 && finalCount === games.length;
  console.log(`[calib] ${date}: ${finalCount}/${games.length} final games, ${homerers.size} players homered`);
  return { homerers, played, homerersByKey, playedByKey, allFinal };
}

/**
 * Join predictions to outcomes per (playerId, gamePk). Pure + exported so it's
 * unit-testable without the network. A split doubleheader has TWO prediction
 * rows for one playerId (different gamePk); composite keying grades them
 * independently — a HR in game 1 must NOT mark the game-2 row homered. Legacy
 * records logged before gamePk existed fall back to bare-playerId matching.
 */
export function reconcileOutcomes(predictions, { homerers, played, homerersByKey, playedByKey }) {
  const didHomer = (p) =>
    p.gamePk != null && homerersByKey ? homerersByKey.has(`${p.playerId}-${p.gamePk}`) : homerers.has(p.playerId);
  const didPlay = (p) =>
    p.gamePk != null && playedByKey ? playedByKey.has(`${p.playerId}-${p.gamePk}`) : played.has(p.playerId);
  return predictions.map((p) => ({ ...p, homered: didHomer(p), actuallyPlayed: didPlay(p) }));
}

/** Keep only fields needed for long-horizon model and signal evaluation. */
export function compactModelRecord(record) {
  const featureVersion = historicalFeatureVersionOf(record);
  const validFeat = record?.feat && typeof record.feat === 'object' && !Array.isArray(record.feat);
  const rawFeat = validFeat ? record.feat : (record?.feat ?? null);
  return {
    playerId:       record?.playerId ?? null,
    gamePk:         record?.gamePk ?? null,
    score:          Number.isFinite(record?.score) ? record.score : null,
    homered:        record?.homered === true,
    actuallyPlayed: record?.actuallyPlayed !== false,
    grade:          record?.grade ?? null,
    badges:         Array.isArray(record?.badges) ? record.badges : [],
    lineupConfirmed: typeof record?.lineupConfirmed === 'boolean' ? record.lineupConfirmed : null,
    dataTrusted:    typeof record?.dataTrusted === 'boolean' ? record.dataTrusted : null,
    simHRProb:      Number.isFinite(record?.simHRProb) ? record.simHRProb : null,
    featureVersion: featureVersion || null,
    feat:           featureVersion >= HISTORICAL_FEATURE_VERSION && validFeat ? normalizeHistoricalFeatureVector(rawFeat) : rawFeat,
    pitchTypes:     compactHistoricalPitchTypes(record?.pitchTypes),
  };
}

/**
 * Merge one or more compact model-history archives. Later archives win for a
 * duplicate date, which lets the locally repaired cache override an older R2
 * copy. The result is capped to six months so the state remains practical to
 * fetch on every stateless cron run.
 */
export function mergeModelHistories(...histories) {
  const records = {};
  const dateSet = new Set();
  for (const history of histories) {
    if (!history || typeof history !== 'object') continue;
    for (const date of [...(history.dates || []), ...Object.keys(history.records || {})]) {
      const rows = history.records?.[date];
      if (!Array.isArray(rows)) continue;
      dateSet.add(date);
      records[date] = rows;
    }
  }
  const dates = [...dateSet].sort();
  while (dates.length > MODEL_HISTORY_DAYS) {
    const oldest = dates.shift();
    delete records[oldest];
  }
  return { version: 1, dates, records };
}

/**
 * Copy the current operational rows into the compact model archive. Existing
 * older archive dates survive, while current dates are overwritten so late-HR
 * repairs propagate into the durable evidence set.
 */
export function syncModelHistory(log) {
  if (!log || typeof log !== 'object') return log;
  const currentRecords = {};
  for (const date of log.dates || []) {
    if (!Array.isArray(log.records?.[date])) continue;
    currentRecords[date] = log.records[date].map(compactModelRecord);
  }
  const modelHistory = mergeModelHistories(
    log.modelHistory,
    { dates: Object.keys(currentRecords), records: currentRecords },
  );
  return {
    ...log,
    modelHistory,
    featureArchive: buildHistoricalFeatureCoverage(modelHistory),
  };
}

/**
 * Append yesterday's reconciled records to the operational log, copy them to
 * modelHistory, then trim only the operational side to ROLLING_DAYS.
 * Idempotent — already-present dates are not double-counted.
 */
export function appendToLog(log, date, reconciled) {
  let next = {
    ...log,   // preserve top-level fields (e.g. settledDates) across appends
    dates:   Array.from(new Set([...(log?.dates || []), date])).sort(),
    records: { ...(log?.records || {}) },
  };
  if (!next.records[date]) next.records[date] = reconciled;
  // Archive before trimming so the oldest operational day survives the first
  // schema-v1 migration even when no modelHistory existed on the prior log.
  next = syncModelHistory(next);
  while (next.dates.length > ROLLING_DAYS) {
    const oldest = next.dates.shift();
    delete next.records[oldest];
  }
  return next;
}

/**
 * From the full rolling log compute per-badge and per-grade multipliers.
 *
 *   per-badge multiplier = sqrt(with-badge HR rate / overall HR rate)
 *                          clamped to [1 - delta, 1 + delta]
 *
 * Sqrt-dampens noisy small samples. The clamp band `delta` is no longer a flat
 * ±8% — it's scaled by each signal's statistical strength (significanceBand):
 * a proven signal whose lift is many SE from the overall rate earns up to
 * ±12%, while one sitting near noise is held to ±3%, so the trustworthy badges
 * (hot, homeEdge, barrelKing) move scores and the weak ones (launchPad,
 * zoneMaster) barely do. Geometric-mean dampening in applyCalibration still
 * combines them conservatively when a batter has multiple active badges.
 *
 * Survivorship-bias note: records with `actuallyPlayed: false` (late lineup
 * scratches) are EXCLUDED from all rate calculations. Including them would
 * inflate the denominator — a batter who never stepped to the plate can't
 * possibly homer, so counting them as "predicted, didn't homer" is a
 * measurement artifact, not signal. Older log entries without the
 * `actuallyPlayed` field are treated as played (backward-compatible default).
 *
 * Returns { samples, badges, grades, computedAt } in the exact shape
 * setActiveCalibration() expects.
 */
export function computeMultipliers(log) {
  const allRaw = (log?.dates || []).flatMap(d => log?.records?.[d] || []);

  // Separate scratches from played. Legacy records (no actuallyPlayed field)
  // default to true so the existing 30-day window isn't suddenly invalidated.
  const scratched = allRaw.filter(r => r.actuallyPlayed === false);
  const all       = allRaw.filter(r => r.actuallyPlayed !== false);

  const totalPredictions = allRaw.length;
  const scratchCount     = scratched.length;
  if (totalPredictions > 0) {
    const scratchPct = (scratchCount / totalPredictions * 100).toFixed(1);
    console.log(`[calib] scratch rate: ${scratchCount}/${totalPredictions} predictions never played (${scratchPct}%)`);
  }

  const samples = all.length;
  const base = { samples, badges: {}, grades: {}, computedAt: new Date().toISOString() };
  if (!samples) return base;

  const homers = all.filter(r => r.homered).length;
  const overallRate = homers / samples;
  if (!overallRate) return base;

  // Per-badge multipliers — need 50+ samples-with-badge before we trust the
  // signal. Tiny buckets (e.g., 3 batters with HOT + AWAY edge) would
  // produce wild ratios. Scratched records already excluded from `all`.
  for (const key of BADGE_KEYS) {
    const withBadge = all.filter(r => r.badges?.includes(key));
    if (withBadge.length < 50) continue;
    const bRate = withBadge.filter(r => r.homered).length / withBadge.length;
    const lift = bRate / overallRate;
    if (!isFinite(lift) || lift <= 0) continue;
    const dampened = Math.sqrt(lift);
    // Band widens with the signal's statistical strength: proven badges move
    // scores more, near-noise badges are clamped tight toward 1.0.
    const { z, delta } = significanceBand(bRate, withBadge.length, overallRate);
    const clamped  = Math.min(1 + delta, Math.max(1 - delta, dampened));
    base.badges[key] = +clamped.toFixed(3);
    console.log(`[calib] badge ${key}: n=${withBadge.length} rate=${(bRate * 100).toFixed(1)}% lift=${lift.toFixed(2)} z=${z.toFixed(1)} band=±${(delta * 100).toFixed(1)}% → ${base.badges[key]}`);
  }

  // Per-grade — need 80+ in each grade bucket. PRIME players are rarer so
  // we accept the slightly higher bar; SKIP is the dominant population.
  // Scratched records already excluded from `all`.
  for (const grade of GRADE_KEYS) {
    const withGrade = all.filter(r => r.grade === grade);
    if (withGrade.length < 80) continue;
    const gRate = withGrade.filter(r => r.homered).length / withGrade.length;
    const lift = gRate / overallRate;
    if (!isFinite(lift) || lift <= 0) continue;
    const dampened = Math.sqrt(lift);
    // Grades use the SAME modest band as badges (±12%). A wider band looked good
    // for calibration in isolation, but the multiplier is applied to the 0-100
    // SCORE and the displayed GRADE is re-derived from that score — so a big
    // PRIME multiplier (e.g. 1.45) inflates scores across the PRIME boundary and
    // floods the PRIME tier (observed: ~90 PRIMEs vs the usual ~25). Probability
    // is already calibrated empirically by the score→prob isotonic table, so the
    // grade multiplier only needs to nudge the score modestly, not carry the
    // gradient. Keep it tight to preserve the grade distribution.
    const { z, delta } = significanceBand(gRate, withGrade.length, overallRate);
    const clamped  = Math.min(1 + delta, Math.max(1 - delta, dampened));
    base.grades[grade] = +clamped.toFixed(3);
    console.log(`[calib] grade ${grade}: n=${withGrade.length} rate=${(gRate * 100).toFixed(1)}% lift=${lift.toFixed(2)} z=${z.toFixed(1)} band=±${(delta * 100).toFixed(1)}% → ${base.grades[grade]}`);
  }

  base.ready = samples >= MIN_SAMPLES_TO_CALIBRATE;
  return base;
}

/**
 * End-to-end reconcile-and-recompute for one date. Returns the updated
 * log (caller writes it back to R2). When `yesterdayPredictions` is null
 * we still trim/return the log without appending; that handles the case
 * where today's first cron run already happened earlier and we no longer
 * have access to yesterday's snapshot.
 */
export async function reconcileDate(date, yesterdayPredictions, priorLog, prefetchedOutcomes = null) {
  let log = priorLog || { dates: [], records: {} };
  if (log.dates?.includes(date)) {
    // Already reconciled this date on an earlier run today. Idempotent.
    console.log(`[calib] ${date} already in log — skipping reconciliation`);
    return log;
  }
  if (!yesterdayPredictions || !yesterdayPredictions.length) {
    console.warn(`[calib] no predictions available for ${date} — skipping reconciliation`);
    return log;
  }
  // Reuse a pre-fetched outcomes sweep when the caller already did one (the
  // combo scorecard shares it), else fetch now.
  const result = prefetchedOutcomes || await fetchHomerersForDate(date);
  if (!result) {
    console.warn(`[calib] failed to fetch box scores for ${date} — skipping`);
    return log;
  }
  const reconciled = reconcileOutcomes(yesterdayPredictions, result);
  const homerCount   = reconciled.filter(r => r.homered).length;
  const scratchCount = reconciled.filter(r => !r.actuallyPlayed).length;
  console.log(`[calib] reconciled ${reconciled.length} predictions for ${date}, ${homerCount} hit (${(homerCount / reconciled.length * 100).toFixed(1)}% rate)`);

  // Scratch breakdown by lineup confirmation state (survivorship-bias audit).
  // Confirmed-then-scratched is more surprising/important than unconfirmed-then-scratched.
  if (scratchCount > 0 && reconciled.some(r => r.lineupConfirmed != null)) {
    const scratchedConfirmed   = reconciled.filter(r => !r.actuallyPlayed && r.lineupConfirmed === true).length;
    const scratchedUnconfirmed = reconciled.filter(r => !r.actuallyPlayed && r.lineupConfirmed === false).length;
    const scratchedUnknown     = reconciled.filter(r => !r.actuallyPlayed && r.lineupConfirmed == null).length;
    console.log(`[calib] ${date} scratches: ${scratchCount} total — confirmed-then-scratched: ${scratchedConfirmed}, unconfirmed: ${scratchedUnconfirmed}, unknown: ${scratchedUnknown}`);
  } else if (scratchCount > 0) {
    console.log(`[calib] ${date} scratches: ${scratchCount} (lineupConfirmed not tracked in this snapshot)`);
  }

  return appendToLog(log, date, reconciled);
}

/**
 * Self-healing back-sweep for late-game / transient reconcile misses.
 *
 * `reconcileDate` runs ONCE per date (it skips a date already in the log), so a
 * date first reconciled while a late west-coast game was still in progress
 * freezes those batters as misses forever — even though a home run is a fact
 * that shows up in the box score once the game goes Final. (This is exactly
 * what stranded a PRIME pick whose HR landed in a late AZ game: logged
 * homered=false, never corrected, quietly deflating the measured hit rate.)
 *
 * Each cron run this re-checks the most recent `n` logged dates and UPGRADES
 * any record that actually homered (false → true) + marks it played. The
 * upgrade is MONOTONIC — never true → false — so a transient empty MLB
 * response can't regress good data (a HR can't un-happen). Once every game on
 * a date is Final the date is recorded in `settledDates` and never re-fetched,
 * so steady-state cost is roughly one in-progress day's box scores per run.
 *
 * Returns the (mutated) log; safe to call every run.
 *
 * `maxScan` caps how far back we'll re-fetch in a single run. Rather than only
 * the last `n` calendar dates (which let a SUSPENDED game keep a date un-settled
 * past the 3-day tail and freeze a late HR as a permanent miss), we now revisit
 * EVERY still-unsettled date in the rolling window — capped at `maxScan` (~7) so
 * a long backlog can't blow up one cron's box-score fetch count. Settled dates
 * are skipped outright, so steady-state cost stays ~one in-progress day's boxes.
 */
export async function repairRecentDays(log, maxScan = 7) {
  if (!log?.dates?.length) return log;
  const settled = new Set(log.settledDates || []);
  let totalFixed = 0;
  // All non-settled dates in the window (newest-first so the most recent,
  // most-likely-to-still-be-live dates get repaired first), capped at maxScan.
  const candidates = log.dates
    .filter(d => !settled.has(d))
    .slice(-maxScan);
  for (const date of candidates) {
    if (settled.has(date)) continue;                 // already complete — skip the fetch
    const records = log.records?.[date];
    if (!Array.isArray(records) || !records.length) continue;
    const result = await fetchHomerersForDate(date).catch(() => null);
    if (!result) continue;
    const { homerers, played, homerersByKey, playedByKey, allFinal } = result;
    let fixed = 0;
    for (const r of records) {
      const pid = Number(r.playerId);
      // Per-(player,game) join; bare-playerId fallback for legacy records w/o gamePk.
      const homered  = r.gamePk != null ? homerersByKey.has(`${pid}-${r.gamePk}`) : homerers.has(pid);
      const playedIt = r.gamePk != null ? playedByKey.has(`${pid}-${r.gamePk}`)  : played.has(pid);
      if (r.homered !== true && homered) {
        r.homered = true;
        r.actuallyPlayed = true;
        fixed++;
      } else if (r.actuallyPlayed !== true && playedIt) {
        r.actuallyPlayed = true;                      // batted after all — not a scratch
      }
    }
    if (fixed) {
      totalFixed += fixed;
      console.log(`[calib] repair: ${date} corrected ${fixed} late-miss record(s) → homered`);
    }
    // Every game Final ⇒ box-score data is complete; stop re-fetching this date.
    if (allFinal) settled.add(date);
  }
  log.settledDates = [...settled].filter(d => log.dates.includes(d));   // prune to rolling window
  if (totalFixed) console.log(`[calib] repair: upgraded ${totalFixed} false-miss record(s) across ${candidates.length} unsettled day(s)`);
  return syncModelHistory(log);
}

/**
 * Fetch actual starter K totals for each game on `date`.
 * Returns Map<`${pitcherId}-${gamePk}`, { k, ip, bf, name }> for all games that finished.
 * allFinal = true when every scheduled game is Final.
 */
export async function fetchPitcherKsForDate(date) {
  const sched = await getJson(`${MLB_BASE}/schedule?sportId=1&date=${date}`);
  const games = sched?.dates?.[0]?.games || [];
  const out = new Map();
  let finalCount = 0;
  for (const g of games) {
    if (g.status?.abstractGameState !== 'Final') continue;
    finalCount++;
    const bs = await getJson(`${MLB_BASE}/game/${g.gamePk}/boxscore`);
    for (const side of ['home', 'away']) {
      const pitcherIds = bs?.teams?.[side]?.pitchers || [];
      if (!pitcherIds.length) continue;
      const starterId = pitcherIds[0];  // first pitcher = starter
      const playerKey = `ID${starterId}`;
      const p = bs?.teams?.[side]?.players?.[playerKey];
      if (!p) continue;
      const ks = p?.stats?.pitching?.strikeOuts;
      const ip = p?.stats?.pitching?.inningsPitched;
      const bf = parseInt(p?.stats?.pitching?.battersFaced, 10);
      const name = p?.person?.fullName || '';
      if (Number.isFinite(ks)) {
        out.set(`${starterId}-${g.gamePk}`, {
          k: ks,
          ip: ip ? parseFloat(ip) : null,
          bf: Number.isFinite(bf) ? bf : null,
          name,
        });
      }
    }
  }
  const allFinal = games.length > 0 && finalCount === games.length;
  return { outcomes: out, allFinal };
}
