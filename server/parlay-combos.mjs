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
 * SINGLE SOURCE OF TRUTH: the strategy menu, ranking, and selection live in
 * ui/src/lib/combo-engine.js — imported here AND by the live UI — so the combos
 * graded are the combos shown (no more hand-mirrored math drifting apart). This
 * module only supplies the SERVER adapter (frozen-pregame snapshot → the
 * engine's canonical row) plus the grading/scorecard that's server-only.
 */

import { heatIndex, pitchMixScore, hrSetup } from '../ui/src/lib/scout.js';
import {
  buildCombos,
  barrelOf,
  recentBarrelOf,
  blastRate,
  allHitProb,
  SIZES,
  pitchEdgeOf,
  zoneEdgeOf,
  hrPlatoonEdgeOf,
  flyBallMatchupOf,
  positiveReasonCount,
  negativeReasonCount,
} from '../ui/src/lib/combo-engine.js';

/**
 * Normalize a snapshot scoredBatters row to the engine's canonical combo row,
 * reading the FROZEN pregame fields (score/grade decay once a game starts;
 * preGameScore/preGameGrade are pinned to pre-first-pitch — see the freeze block
 * in fetch-slate). Falls back to the live fields for rows that never started
 * (postponed), where they ARE pregame. The shared derivation helpers (barrel,
 * recent barrel, blast) and the Heat Index (scout.heatIndex — the same function
 * the client precomputes) come from the engine/scout so neither side recomputes
 * them differently.
 */
export function comboRowFromSnapshot(row) {
  if (!row || row.playerId == null) return null;
  const score = Number.isFinite(row.preGameScore) ? row.preGameScore : row.score;
  const grade = row.preGameGrade?.label || row.preGameGrade || row.grade?.label || row.grade || null;
  const barrel = barrelOf(row);
  return {
    playerId: row.playerId,
    gamePk:   row.gamePk,
    name:     row.name,
    team:     row.team,
    score,
    grade,
    // The model's stated chance this leg homers — the CALIBRATED headline
    // probability, matching the client adapter (groups.js toComboRow).
    // The 2026-07-05 combo audit caught the old preference for raw simHRProb:
    // the sim is the pre-calibration, under-confident value (the isotonic
    // table exists to correct it), which deflated every recorded combo pred
    // ~70x (E[all-hits] 0.3 vs 21 actual over 343 graded combos) and made the
    // scorecard's predicted-vs-actual column meaningless.
    hrProb:   Number.isFinite(row.hrProbability) ? row.hrProbability : (Number.isFinite(row.simHRProb) ? row.simHRProb : null),
    barrel,
    // Recent (L14) barrel%, when a real sample — blended into the power rank so
    // it isn't always the same season-barrel leaders. null => fall back to season.
    recentBarrel: recentBarrelOf(row),
    // park × weather × hand — the Park & Air strategy ranks on this.
    air: Number.isFinite(row.parkWeatherHandFactor) ? row.parkWeatherHandFactor : null,
    // Blast rate (bat tracking) — recent-preferred, folded into the power rank.
    blast: blastRate(row),
    // Opposing-pitcher HR/9. Fall back to a league-average prior (~1.25) for an
    // arm with no current-season sample (call-up / season debut) so the matchup
    // strategy treats him as neutral rather than blind — it won't falsely flag
    // him homer-prone (prior < the 1.3 gate), just stops nulling him.
    pitcherHr9: Number.isFinite(row.pitcher?.season?.hrPer9) ? row.pitcher.season.hrPer9
      : (row.pitcher?.id != null ? 1.25 : null),
    // Heat signals the `hot` strategy ranks on: heatIndex × recent-form multiplier.
    heat: heatIndex(row),
    heatMult: Number.isFinite(row.hotnessMultiplier) ? row.hotnessMultiplier : 1,
    // Boolean signals (static — not decayed) for the Signal Stack strategy.
    hot:           row.hot === true,
    homeEdge:      row.homeEdge === true,
    awayEdge:      row.awayEdge === true,
    bullpenLegend: row.bullpenLegend === true,
    barrelKing:    Number.isFinite(barrel) && barrel >= 13,
    // Matchup edge signals for the Edge Stack strategy.
    pitchEdge:      pitchEdgeOf(row),
    zoneEdge:       zoneEdgeOf(row),
    pitchMixEdge:   (pitchMixScore(row) ?? 0) >= 7,
    hrPlatoonEdge:  hrPlatoonEdgeOf(row),
    flyBallMatchup: flyBallMatchupOf(row),
    // Precision strategy: positive/negative eli5Reasons counts (Trends tab bullets).
    positiveReasons: positiveReasonCount(row),
    negativeReasons: negativeReasonCount(row),
    // HR Due Indicator checklist score (0-6) from scout.hrSetup — precision gate.
    hrDueScore: hrSetup(row).n,
  };
}

/**
 * Build the canonical combo records from a list of comboRowFromSnapshot rows.
 * Delegates construction to the shared engine, then flattens to compact records:
 * { strategy, size, legs: [playerId, …], pred } — just enough to grade and report.
 * `pred` = predicted all-hit prob (product of leg HR probs, null if any leg lacks
 * one) so the scorecard can compare predicted vs actual cash rate.
 */
export function buildComboRecords(rows, opts = {}) {
  return buildCombos(rows, opts).map((c) => ({
    strategy: c.strategy,
    size: c.size,
    legs: c.legs.map((l) => l.playerId),
    pred: allHitProb(c.legs.map((l) => l.hrProb)),
  }));
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
    return { strategy: c.strategy, size: c.size, legs: c.legs, nHit, allHit: nHit === c.legs.length, pred: Number.isFinite(c.pred) ? c.pred : null };
  });
}

/**
 * Same-game parlay records — for each game, the best `size` bats stacked (top by
 * frozen pregame HR prob, score as tiebreak). One SGP per game per size. The
 * cross-game combo board structurally takes only one bat per game, so it misses
 * the same-game stacks that often carry a slate; freezing these lets the Combos
 * page grade SGPs against actual HRs the same way it grades combos.
 * Returns [{ gamePk, size, legs: [playerId, …], pred }].
 */
export function buildSGPRecords(rows, { sizes = [2, 3] } = {}) {
  const byGame = new Map();
  for (const r of rows || []) {
    if (!r || r.gamePk == null) continue;
    if (!r.grade || r.grade === 'SKIP') continue;
    if (!Number.isFinite(r.hrProb)) continue;
    if (!byGame.has(r.gamePk)) byGame.set(r.gamePk, []);
    byGame.get(r.gamePk).push(r);
  }
  const out = [];
  for (const [gamePk, bats] of byGame) {
    // Rank by model SCORE (grade quality) so an SGP stacks a game's best-graded
    // bats — the PRIME/STRONG studs a user would actually stack — not whichever
    // fringe bat carries the highest raw HR prob. HR prob breaks ties.
    const ranked = bats.slice().sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.hrProb ?? 0) - (a.hrProb ?? 0) || (a.playerId - b.playerId),
    );
    for (const size of sizes) {
      if (ranked.length < size) continue;
      const legs = ranked.slice(0, size);
      out.push({ gamePk, size, legs: legs.map((l) => l.playerId), pred: allHitProb(legs.map((l) => l.hrProb)) });
    }
  }
  return out;
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
  // Only the most recent graded day — a clean "how did last night's combos do?"
  // read, not a rolling multi-day blend. byDate holds only settled days
  // (appendComboDay appends graded outcomes), so the last key is yesterday.
  const dates = Object.keys(byDate).sort().slice(-30);
  const cell = () => ({ combos: 0, allHit: 0, legs: 0, legHits: 0, predSum: 0, predN: 0 });
  const byStrategy = {};
  const bySize = {};
  const overall = cell();
  const add = (x, c) => {
    x.combos += 1; x.allHit += c.allHit ? 1 : 0; x.legs += c.size; x.legHits += c.nHit;
    if (Number.isFinite(c.pred)) { x.predSum += c.pred; x.predN += 1; }
  };
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
    // Mean predicted all-hit prob across combos that carried one — the rate the
    // model EXPECTED to cash. Compare to hitRate for calibration. null until
    // newly-graded days (with pred logged) accrue.
    predHitRate: x.predN ? x.predSum / x.predN : null,
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
