/**
 * parlay-combos.mjs — canonical pregame parlay combos + a graded scorecard.
 *
 * The UI (ui/src/lib/groups.js) builds Parlay Combos live on each device from
 * the current board, with user filters and live-decaying scores — great for
 * picking, useless as a record (nothing is persisted, and the same combo shifts
 * through the day). This module is the RECORD side: at reconcile time it rebuilds
 * a FIXED, reproducible set of combos from yesterday's frozen pre-first-pitch
 * snapshot, grades each against actual HR outcomes, and rolls the results into
 * the backtest log so a true combo scorecard accumulates day over day.
 *
 * What's tracked is a benchmark — "the combos StatFax's strategies offered
 * pregame today", one per strategy per size (2/3/4 legs), at most one bat per
 * game. It is NOT every combo every user saw after filtering. That's the honest,
 * well-defined thing to score (like tracking the model's top picks, not each
 * user's clicks).
 *
 * Odds-dependent strategies (value, longshot) are intentionally omitted — the
 * slate often lacks live book odds, and the scorecard should be measurable on
 * every slate regardless.
 *
 * Pure JS, no imports. Mirrors the strategy math in ui/src/lib/groups.js so the
 * benchmark stays recognizably "the same combos".
 */

const SIZES = [2, 3, 4];

// Proven HR signals, weighted by the badge audit's within-grade lift — the same
// set + weighting the UI's Signal Stack uses (minus odds-only signals). "due" is
// excluded (the falsified gambler's-fallacy signal).
const STACK_SIGNALS = { hot: 3, barrelKing: 2, homeEdge: 2, bullpenLegend: 2, awayEdge: 1.5 };
const signalScore = (b) => Object.entries(STACK_SIGNALS).reduce((s, [k, w]) => s + (b[k] ? w : 0), 0);
const signalCount = (b) => Object.keys(STACK_SIGNALS).reduce((n, k) => n + (b[k] ? 1 : 0), 0);

// Heat index — mirrors ui/src/lib/scout.js heatBreakdown().total (kept in sync
// by hand, like the strategy math). Used so the `hot` strategy can rank on a
// blend of BOTH heat signals: heatIndex × the recent-form multiplier.
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const isoOf = (s) => (s ? Math.max(0, (s.slg ?? 0) - (s.avg ?? 0)) : null);
function heatIndexOf(row) {
  const HEAT_BASE = 45;
  let sum = 0;
  const sIso = isoOf(row.season), rIso = isoOf(row.recent);
  if (sIso != null && rIso != null && (row.recent?.ab ?? 0) >= 12) sum += Math.round(clamp((rIso - sIso) * 250, -25, 30));
  const seasonBarrel = Number.isFinite(row.barrelPctBBE) ? row.barrelPctBBE : row.barrelPct;
  if (Number.isFinite(row.recentBarrel?.recentBarrelPct) && Number.isFinite(seasonBarrel) && (row.recentBarrel?.recentBBE ?? 0) >= 6) {
    sum += Math.round(clamp((row.recentBarrel.recentBarrelPct - seasonBarrel) * 1.5, -15, 22));
  }
  if (row.hot) sum += 13;
  if (row.cold) sum += -20;
  if (row.hrStreak) sum += 10;
  return Math.round(clamp(HEAT_BASE + sum, 0, 100));
}

// Strategy menu — the no-odds subset of the UI's strategies. Each ranks the
// eligible pool by its own metric; `require` gates which bats qualify.
// Best Mix — a cross-metric blend so a great-overall bat and an elite-barrel
// bat can land in the SAME combo (the single-metric strategies silo them).
// Weights: grade/score 0.5, barrel 0.25, heat 0.25 — score leads (grade is the
// dominant HR signal, PRIME 2.29x in the audit); barrel (1.68x) and heat
// (1.75x) are ~tied secondary signals, so they split the rest. Mirrors ui/groups.js.
const mixRank = (b) =>
  0.5 * ((b.score ?? 0) / 100) +
  0.25 * clamp((b.barrel ?? 0) / 25, 0, 1) +
  0.25 * ((b.heat ?? 0) / 100);

const STRATEGIES = [
  { key: 'top',     rank: (b) => b.score,          require: null },
  { key: 'mix',     rank: mixRank,                 require: null },
  { key: 'stack',   rank: signalScore,             require: (b) => signalCount(b) >= 2 },
  // hot ranks on heatIndex × recent-form multiplier (a blend of both heat
  // signals) rather than the overall score — otherwise it just re-picks `top`'s
  // legs, since hot bats already score high.
  { key: 'hot',     rank: (b) => (b.heat ?? 0) * (b.heatMult ?? 1), require: (b) => b.hot },
  // power: blend season barrel (60%) with recent L14 barrel (40%) so it rewards
  // current form, not just career barrel kings. Eligibility still gates on the
  // stable season number. Falls back to season when there's no recent sample.
  { key: 'power',   rank: (b) => (Number.isFinite(b.recentBarrel) ? 0.6 * (b.barrel ?? 0) + 0.4 * b.recentBarrel : (b.barrel ?? 0)), require: (b) => Number.isFinite(b.barrel) && b.barrel >= 9 },
  // matchup & park anchor on batter quality (score) × the environmental tilt, so
  // a homer-prone matchup / launch pad lifts a GOOD bat instead of ranking a
  // weak bat purely on the ~1.0–1.3× environmental signal. (Badge audit: grade
  // is 2.29× HR lift; park/matchup-alone are far weaker and were discarding it.)
  { key: 'matchup', rank: (b) => (b.score ?? 0) * (b.pitcherHr9 ?? 0), require: (b) => Number.isFinite(b.pitcherHr9) && b.pitcherHr9 >= 1.3 },
  { key: 'park',    rank: (b) => (b.score ?? 0) * (b.air ?? 0),         require: (b) => Number.isFinite(b.air) && b.air >= 1.05 },
];

/**
 * Normalize a snapshot scoredBatters row to the compact shape the strategies
 * rank on, reading the FROZEN pregame fields (score/grade decay once a game
 * starts; preGameScore/preGameGrade are pinned to pre-first-pitch — see the
 * freeze block in fetch-slate). Falls back to the live fields for rows that
 * never started (postponed), where they ARE pregame.
 */
export function comboRowFromSnapshot(row) {
  if (!row || row.playerId == null) return null;
  const score = Number.isFinite(row.preGameScore) ? row.preGameScore : row.score;
  const grade = row.preGameGrade?.label || row.preGameGrade || row.grade?.label || row.grade || null;
  const barrel = Number.isFinite(row.barrelPctBBE) ? row.barrelPctBBE
    : Number.isFinite(row.barrelPct) ? row.barrelPct : null;
  const park = Number.isFinite(row.gameParkHRFactor) ? row.gameParkHRFactor : null;
  const air  = Number.isFinite(row.parkWeatherHandFactor) ? row.parkWeatherHandFactor : null;
  return {
    playerId: row.playerId,
    gamePk:   row.gamePk,
    name:     row.name,
    team:     row.team,
    score,
    grade,
    barrel,
    // Recent (L14) barrel%, when a real sample — blended into the power rank so
    // it isn't always the same season-barrel leaders. null => fall back to season.
    recentBarrel:
      Number.isFinite(row.recentBarrel?.recentBarrelPct) && (row.recentBarrel?.recentBBE ?? 0) >= 6
        ? row.recentBarrel.recentBarrelPct
        : null,
    park,
    air, // park × weather × hand — the Park & Air strategy ranks on this
    // Opposing-pitcher HR/9. Fall back to a league-average prior (~1.25) for an
    // arm with no current-season sample (call-up / season debut, e.g. Estes) so
    // the matchup strategy treats him as neutral rather than blind — it won't
    // falsely flag him homer-prone (prior < the 1.3 gate), just stops nulling him.
    pitcherHr9: Number.isFinite(row.pitcher?.season?.hrPer9) ? row.pitcher.season.hrPer9
      : (row.pitcher?.id != null ? 1.25 : null),
    // Heat signals the `hot` strategy ranks on: heatIndex × recent-form multiplier.
    heat: heatIndexOf(row),
    heatMult: Number.isFinite(row.hotnessMultiplier) ? row.hotnessMultiplier : 1,
    // Boolean signals (static — not decayed) for the Signal Stack strategy.
    hot:           row.hot === true,
    homeEdge:      row.homeEdge === true,
    awayEdge:      row.awayEdge === true,
    bullpenLegend: row.bullpenLegend === true,
    barrelKing:    Number.isFinite(barrel) && barrel >= 13,
    launchPad:     Number.isFinite(park) && park >= 1.10,
    wxEdge:        Number.isFinite(air) && air >= 1.05,
  };
}

// Best eligible bat per game by a metric (skip SKIP-grade + scoreless rows).
function topPerGame(rows, rank, require) {
  const byGame = new Map();
  for (const b of rows) {
    if (!b || b.gamePk == null) continue;
    if ((b.grade || 'SKIP') === 'SKIP') continue;
    if (!Number.isFinite(b.score)) continue;
    if (require && !require(b)) continue;
    const cur = byGame.get(b.gamePk);
    if (!cur || rank(b) > rank(cur) || (rank(b) === rank(cur) && (b.score ?? 0) > (cur.score ?? 0))) {
      byGame.set(b.gamePk, b);
    }
  }
  return [...byGame.values()].sort((a, b) => rank(b) - rank(a) || (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Build the canonical combos (one per strategy per size, dedup'd) from a list of
 * comboRowFromSnapshot rows. Returns compact records: { strategy, size, legs:
 * [playerId, …] } — just enough to grade and report.
 */
export function buildComboRecords(rows, { maxPerBat = 3 } = {}) {
  const pools = STRATEGIES.map((s) => ({ s, pool: topPerGame(rows, s.rank, s.require) }));
  const out = [];
  const seen = new Set();
  for (const size of SIZES) {
    // Diversity cap: a bat can anchor at most `maxPerBat` combos at this size,
    // so the same studs don't pile into all 7 strategies (correlated wipeout —
    // one cold bat kills the whole board). Strategies run in array order, so the
    // headline ones (top, mix) keep their purest picks; the tail diversifies.
    const used = {};
    for (const { s, pool } of pools) {
      if (pool.length < size) continue;
      let legs = [];
      for (const b of pool) {
        if (legs.length >= size) break;
        if ((used[b.playerId] || 0) >= maxPerBat) continue;
        legs.push(b);
      }
      if (legs.length < size) legs = pool.slice(0, size); // not enough under-cap bats — keep the strategy pure rather than drop it
      const sig = `${size}:` + legs.map((l) => l.playerId).slice().sort().join('-');
      if (seen.has(sig)) continue; // identical leg set from another strategy
      seen.add(sig);
      for (const l of legs) used[l.playerId] = (used[l.playerId] || 0) + 1;
      out.push({ strategy: s.key, size, legs: legs.map((l) => l.playerId) });
    }
  }
  return out;
}

/**
 * Best all-hit parlay that WAS available from the recommended pool — the most
 * legs you could have gone perfect on (one PRIME/STRONG bat per game that
 * homered). Separates grading quality from combo construction: if this is 2+ on
 * a day the canonical combos went 0-fer, the grades were right and it was combo
 * variance, not a model miss.
 */
export function bestAvailableCombo(rows, homerers, tiers = ['PRIME', 'STRONG']) {
  const byGame = new Map();
  for (const b of rows) {
    if (!b || b.gamePk == null) continue;
    if (!tiers.includes(b.grade)) continue;
    if (!homerers.has(Number(b.playerId))) continue;
    const cur = byGame.get(b.gamePk);
    if (!cur || (b.score ?? 0) > (cur.score ?? 0)) byGame.set(b.gamePk, b);
  }
  const all = [...byGame.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  // Cap at the largest buildable combo size — a perfect parlay you couldn't have
  // built (more legs than the max size) isn't actionable. `games` keeps the raw
  // count so we can note when even more were sittable.
  const cap = Math.max(...SIZES);
  const legs = all.slice(0, cap);
  return { n: legs.length, games: all.length, legs: legs.map((l) => ({ playerId: l.playerId, name: l.name, grade: l.grade })) };
}

/**
 * Grade combos against a Set<number> of playerIds who homered. Adds nHit (legs
 * that homered) and allHit (the parlay cashed).
 */
export function gradeCombos(combos, homerers) {
  return combos.map((c) => {
    const nHit = c.legs.filter((pid) => homerers.has(Number(pid))).length;
    return { strategy: c.strategy, size: c.size, legs: c.legs, nHit, allHit: nHit === c.legs.length };
  });
}

/**
 * Append one graded day into the combo log, which lives embedded on the backtest
 * log object (`log.combos.byDate`) so it rides the same R2/cache persistence for
 * free. Idempotent per date; trims to the backtest log's own rolling date window
 * so combos and reconciled records expire together.
 */
export function appendComboDay(log, date, gradedCombos, bestAvailable) {
  const combos = log?.combos && typeof log.combos === 'object' ? { ...log.combos } : {};
  const byDate = { ...(combos.byDate || {}) };
  if (!byDate[date]) byDate[date] = gradedCombos;
  const bestByDate = { ...(combos.bestByDate || {}) };
  if (bestAvailable && !bestByDate[date]) bestByDate[date] = bestAvailable;
  const keep = new Set(log?.dates?.length ? log.dates : Object.keys(byDate));
  for (const d of Object.keys(byDate)) if (!keep.has(d)) delete byDate[d];
  for (const d of Object.keys(bestByDate)) if (!keep.has(d)) delete bestByDate[d];
  combos.byDate = byDate;
  combos.bestByDate = bestByDate;
  return { ...log, combos };
}

/**
 * Aggregate the embedded combo log into a scorecard: overall, per-strategy, and
 * per-size hit rates (parlay all-hit rate) plus per-leg hit rate. Pure read.
 */
export function comboScorecard(log) {
  const byDate = log?.combos?.byDate || {};
  const dates = Object.keys(byDate).sort();
  const cell = () => ({ combos: 0, allHit: 0, legs: 0, legHits: 0 });
  const byStrategy = {};
  const bySize = {};
  const overall = cell();
  const add = (x, c) => { x.combos += 1; x.allHit += c.allHit ? 1 : 0; x.legs += c.size; x.legHits += c.nHit; };
  for (const d of dates) {
    for (const c of byDate[d] || []) {
      add(overall, c);
      add((byStrategy[c.strategy] ??= cell()), c);
      add((bySize[String(c.size)] ??= cell()), c);
    }
  }
  const finalize = (x) => ({
    combos: x.combos,
    allHit: x.allHit,
    hitRate: x.combos ? x.allHit / x.combos : null,
    legHitRate: x.legs ? x.legHits / x.legs : null,
  });
  // Best-available diagnostic: the perfect parlay that WAS sittable each day,
  // and how often a winning combo (2+ legs) existed at all — a read on grading
  // quality independent of which combos the strategies actually built.
  const bestByDate = log?.combos?.bestByDate || {};
  const bestDates = Object.keys(bestByDate).sort();
  const latestDate = bestDates[bestDates.length - 1] || null;
  const bestAvailable = latestDate
    ? {
        latest: { date: latestDate, ...bestByDate[latestDate] },
        daysAvailable: bestDates.filter((d) => (bestByDate[d]?.n ?? 0) >= 2).length,
        days: bestDates.length,
      }
    : null;
  return {
    days: dates.length,
    overall: finalize(overall),
    byStrategy: Object.fromEntries(Object.entries(byStrategy).map(([k, v]) => [k, finalize(v)])),
    bySize: Object.fromEntries(Object.entries(bySize).map(([k, v]) => [k, finalize(v)])),
    bestAvailable,
    updatedAt: new Date().toISOString(),
  };
}
