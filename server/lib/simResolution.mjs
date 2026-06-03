/**
 * Sim-resolution blend
 * ────────────────────
 * The isotonic score→prob table (isotonicCalibration.js) is the calibration
 * source of truth, but it is coarse: 10-wide score buckets, flat across the
 * bottom (~scores 0–35 all ≈ 4.7%) and the top (~85–100 all ≈ 26%). So picks
 * that share a bucket collapse to one probability even though the AB-by-AB sim
 * (`simHRProb`) ranks them differently.
 *
 * This restores the sim's *within-bucket ranking* on top of the calibrated
 * level — as a small, bounded NUDGE in SCORE space, read back through the same
 * isotonic curve. Doing it in score-space (rather than tilting the probability
 * directly) buys three properties for free:
 *
 *   1. Monotonic — isotonic(score) is non-decreasing, and the nudge is capped
 *      below half a bucket, so a player can never leapfrog a meaningfully
 *      higher-scored one. (The naive prob-space tilt let a score-75 bat pass a
 *      score-86 bat — grade and probability would disagree.)
 *   2. Honest at the flats — where the isotonic curve is flat (extreme top /
 *      bottom) the nudge maps to ~the same probability, so we add ~no spurious
 *      spread where the data says the rate genuinely doesn't move. Resolution
 *      shows up where the curve is steep (the meaningful middle).
 *   3. Calibration-preserving — the nudge is mean-zero within a bucket and the
 *      effect is applied as a ratio to the calibrated anchor (which keeps any
 *      ML-ensemble contribution); a final per-bucket rescale locks the mean.
 *
 * The sim is known to be under-confident at the LEVEL (predicts ~24% where
 * PRIME bats homer ~37%), which is exactly why we use it only for ranking, not
 * to set the probability outright.
 */

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const logit = (p) => Math.log(p / (1 - p))

// Strength of the sim tilt. Tunable once the backtest log carries simHRProb
// (reconcile.mjs logs it going forward).
export const SIM_RESOLUTION_WEIGHT = 0.7

const NUDGE_MAX_SCORE = 3 // max score-points a row can move (keeps it within ~its bucket)
const MIN_BUCKET_N = 3 // need this many sim'd rows in a bucket to tilt
const PROB_FLOOR = 0.005
const PROB_CEIL = 0.45

function bucketIndex(score, table) {
  for (let i = 0; i < table.length; i++) {
    if (score >= table[i].scoreLo && score < table[i].scoreHi) return i
  }
  return score >= table[table.length - 1].scoreHi ? table.length - 1 : 0
}

/**
 * Refine each row's `hrProbability` with sim resolution, mutating in place.
 *
 * @param {Array<object>} rows  rows with { score, simHRProb, [anchorKey] }
 * @param {object} opts
 * @param {Array}    opts.table       isotonic table ({ scoreLo, scoreHi, observedProb }[])
 * @param {Function} opts.lookupProb  (score, table) => calibrated prob (isotonic, interpolated)
 * @param {number}   [opts.weight]    tilt weight (default SIM_RESOLUTION_WEIGHT)
 * @param {string}   [opts.anchorKey] field holding the calibrated anchor prob (default '_anchorProb')
 * @returns {{ adjusted: number, buckets: number }}
 */
export function applySimResolution(rows, { table, lookupProb, weight = SIM_RESOLUTION_WEIGHT, anchorKey = '_anchorProb' } = {}) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(table) || !table.length || typeof lookupProb !== 'function') {
    return { adjusted: 0, buckets: 0 }
  }

  // Dedup by object identity — callers may pass the same row under multiple
  // keys (the slate aliases each batter as both `id` and `id-gamePk`). Without
  // this, an object would be tilted twice and the second pass would read its
  // already-deleted temp → NaN.
  const seen = new Set()
  const groups = new Map()
  for (const r of rows) {
    if (!r || seen.has(r) || !Number.isFinite(r.score) || !Number.isFinite(r[anchorKey])) continue
    seen.add(r)
    r.hrProbability = clamp(r[anchorKey], PROB_FLOOR, PROB_CEIL) // default: anchor unchanged
    const idx = bucketIndex(r.score, table)
    if (!groups.has(idx)) groups.set(idx, [])
    groups.get(idx).push(r)
  }

  let adjusted = 0
  let bucketsTilted = 0
  for (const group of groups.values()) {
    const simRows = group.filter((r) => Number.isFinite(r.simHRProb) && r.simHRProb > 0 && r.simHRProb < 1)
    if (weight <= 0 || simRows.length < MIN_BUCKET_N) continue

    const meanLogitSim =
      simRows.reduce((s, r) => s + logit(clamp(r.simHRProb, 1e-4, 1 - 1e-4)), 0) / simRows.length

    let sumAnchor = 0
    let sumTilted = 0
    for (const r of simRows) {
      const dev = logit(clamp(r.simHRProb, 1e-4, 1 - 1e-4)) - meanLogitSim
      // Bounded, smooth score nudge (±NUDGE_MAX_SCORE). tanh keeps it in band.
      const nudge = NUDGE_MAX_SCORE * Math.tanh(weight * dev)
      const baseProb = lookupProb(r.score, table)
      const nudgedProb = lookupProb(clamp(r.score + nudge, 0, 100), table)
      // Transfer the isotonic relative change onto the anchor (preserves the ML
      // ensemble contribution baked into the anchor).
      const ratio = baseProb > 0 ? nudgedProb / baseProb : 1
      const tilted = clamp(r[anchorKey] * ratio, PROB_FLOOR, PROB_CEIL)
      r._tilted = tilted
      sumAnchor += r[anchorKey]
      sumTilted += tilted
    }

    // Lock the bucket mean to the anchor mean (calibration preserved).
    const rescale = sumTilted > 0 ? clamp(sumAnchor / sumTilted, 0.9, 1.12) : 1
    for (const r of simRows) {
      r.hrProbability = clamp(r._tilted * rescale, PROB_FLOOR, PROB_CEIL)
      delete r._tilted
      adjusted++
    }
    bucketsTilted++
  }

  return { adjusted, buckets: bucketsTilted }
}
