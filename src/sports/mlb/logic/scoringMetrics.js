/**
 * scoringMetrics.js
 *
 * Probabilistic calibration metrics for HR prop model evaluation.
 *
 * All functions operate on RECONCILED data only — records where `homered` is
 * null (game not yet finished or reconcile hasn't run) must be excluded before
 * these functions see them, or pass opts.skipUnreconciled = true to
 * computeMetricsFromBacktest which handles the filter internally.
 *
 * WHY TWO METRICS?
 *   - Brier score: mean squared error between predicted probability and
 *     binary outcome. Easy to interpret — a coin-flip always predicting 0.5
 *     scores 0.25. Lower is better.
 *   - Log-loss: mean cross-entropy. Penalizes confident WRONG predictions
 *     FAR more than Brier does because the log term explodes as the predicted
 *     probability approaches 0 or 1. A model that says p=0.99 and the player
 *     doesn't homer gets hammered. Both metrics are useful: Brier captures
 *     average squared error; log-loss captures how "surprised" the model is
 *     by reality in a way that respects the extreme tails.
 *
 * RELIABILITY CURVE
 *   Bins predictions into deciles and computes observed rate per bin. A
 *   perfectly calibrated model falls on the diagonal. The output of
 *   computeReliabilityCurve goes directly to the ModelPerformance screen
 *   renderer — do not change the returned shape.
 */

// ---------------------------------------------------------------------------
// computeBrier
// ---------------------------------------------------------------------------

/**
 * Compute the Brier score for an array of predictions.
 *
 * Brier score = mean( (prob - actual)^2 )
 *
 * Reference values:
 *   - Perfect model:           0.0
 *   - Always predict base rate: baseRate * (1 - baseRate)
 *   - Always predict 0.5:       0.25
 *
 * @param {Array<{ prob: number, actual: 0|1 }>} predictions
 * @returns {number} Mean squared error, in [0, 1].
 */
export function computeBrier(predictions) {
  if (!predictions || predictions.length === 0) return 0;

  let sumSq = 0;
  for (let i = 0; i < predictions.length; i++) {
    const { prob, actual } = predictions[i];
    const diff = prob - actual;
    sumSq += diff * diff;
  }
  return sumSq / predictions.length;
}

// ---------------------------------------------------------------------------
// computeLogLoss
// ---------------------------------------------------------------------------

/**
 * Compute log-loss (binary cross-entropy) for an array of predictions.
 *
 * log-loss = -mean( actual * log(p) + (1 - actual) * log(1 - p) )
 *
 * Probabilities are clamped to [epsilon, 1 - epsilon] before taking logs to
 * prevent log(0). With the default epsilon of 1e-9 this clamp only fires for
 * degenerate inputs; in practice the isotonic lookup never produces exactly 0
 * or 1.
 *
 * Log-loss penalizes confident wrong predictions exponentially harder than
 * Brier score. A model that predicts p = 0.95 and sees actual = 0 incurs
 * -log(1 - 0.95) ≈ 3.0 nats for that single record, swamping dozens of
 * well-calibrated predictions. This makes it a valuable signal for catching
 * overconfident tiers (especially PRIME).
 *
 * @param {Array<{ prob: number, actual: 0|1 }>} predictions
 * @param {{ epsilon?: number }} [opts]
 * @param {number} [opts.epsilon=1e-9] Clamp bound to avoid log(0).
 * @returns {number} Mean cross-entropy. Lower is better. 0 = perfect.
 */
export function computeLogLoss(predictions, opts = {}) {
  if (!predictions || predictions.length === 0) return 0;

  const epsilon = opts.epsilon !== undefined ? opts.epsilon : 1e-9;

  let sumLoss = 0;
  for (let i = 0; i < predictions.length; i++) {
    const { prob, actual } = predictions[i];
    const p = Math.max(epsilon, Math.min(1 - epsilon, prob));
    sumLoss += actual * Math.log(p) + (1 - actual) * Math.log(1 - p);
  }
  return -(sumLoss / predictions.length);
}

// ---------------------------------------------------------------------------
// computeReliabilityCurve
// ---------------------------------------------------------------------------

/**
 * Bin predictions by predicted probability and compute observed rate per bin.
 *
 * Returns an array of bin descriptors intended for direct consumption by the
 * ModelPerformance screen renderer. The shape of each element MUST NOT change
 * without a corresponding update to the renderer.
 *
 * A perfectly calibrated model produces points that fall on the diagonal
 * (avgPredicted ≈ observedRate). Bins that sit above the diagonal indicate
 * under-confidence; bins below the diagonal indicate over-confidence.
 *
 * @param {Array<{ prob: number, actual: 0|1 }>} predictions
 * @param {number} [numBins=10] Number of equal-width bins across [0, 1].
 * @returns {Array<{
 *   binLo: number,
 *   binHi: number,
 *   avgPredicted: number,
 *   observedRate: number,
 *   n: number
 * }>}
 */
export function computeReliabilityCurve(predictions, numBins = 10) {
  if (!predictions || predictions.length === 0) return [];

  const width = 1 / numBins;

  // Initialize bins
  const bins = [];
  for (let b = 0; b < numBins; b++) {
    bins.push({
      binLo: b * width,
      binHi: (b + 1) * width,
      sumPredicted: 0,
      sumActual: 0,
      n: 0,
    });
  }

  for (let i = 0; i < predictions.length; i++) {
    const { prob, actual } = predictions[i];
    // Clamp to [0, 1] and place in the correct bin; edge-case: prob === 1
    const p = Math.max(0, Math.min(1, prob));
    const idx = Math.min(numBins - 1, Math.floor(p * numBins));
    bins[idx].sumPredicted += p;
    bins[idx].sumActual += actual;
    bins[idx].n += 1;
  }

  return bins
    .filter((b) => b.n > 0)
    .map((b) => ({
      binLo: b.binLo,
      binHi: b.binHi,
      avgPredicted: b.sumPredicted / b.n,
      observedRate: b.sumActual / b.n,
      n: b.n,
    }));
}

// ---------------------------------------------------------------------------
// baselineBrierForRate / baselineLogLossForRate
// ---------------------------------------------------------------------------

/**
 * Brier score you would achieve by always predicting exactly the base rate.
 *
 * baseline_brier = baseRate * (1 - baseRate)
 *
 * Used to compute the Brier skill score:
 *   skillScore = 1 - actualBrier / baselineBrier
 *
 * A skill score of 0 means the model is no better than always predicting the
 * base rate; 1 is perfect.
 *
 * @param {number} baseRate Empirical HR rate in [0, 1].
 * @returns {number}
 */
export function baselineBrierForRate(baseRate) {
  return baseRate * (1 - baseRate);
}

/**
 * Log-loss you would achieve by always predicting exactly the base rate.
 *
 * This equals the binary entropy H(baseRate):
 *   H(p) = -(p * log(p) + (1-p) * log(1-p))
 *
 * @param {number} baseRate Empirical HR rate in [0, 1].
 * @param {number} [epsilon=1e-9] Guard against log(0).
 * @returns {number}
 */
export function baselineLogLossForRate(baseRate, epsilon = 1e-9) {
  const p = Math.max(epsilon, Math.min(1 - epsilon, baseRate));
  return -(p * Math.log(p) + (1 - p) * Math.log(1 - p));
}

// ---------------------------------------------------------------------------
// computeMetricsFromBacktest
// ---------------------------------------------------------------------------

/**
 * Default score-to-probability mapping used when opts.scoreToProbFn is not
 * supplied. Treats score as already a probability in [0, 1]. The caller
 * should always supply the isotonic lookup from the calibration module instead
 * of relying on this passthrough.
 *
 * @param {number} score
 * @returns {number}
 */
function _defaultScoreToProb(score) {
  return Math.max(0, Math.min(1, score));
}

/**
 * Compute all calibration metrics from a backtest log over a rolling window.
 *
 * RECONCILED-ONLY: Records where `homered` is null are skipped unconditionally
 * when opts.skipUnreconciled is true (default). This is intentional — unended
 * games have an unknown outcome and must never influence calibration math.
 *
 * Two acceptable input shapes (the function normalizes both):
 *
 *   1. Array form (per-snapshot rolling array):
 *        [{ date, records: [...] }, ...]
 *      Used by some test suites; the function takes the last `lookbackDays`
 *      entries by array order, most recent last.
 *
 *   2. Object form (the actual on-disk backtest-log.json shape):
 *        { dates: ['YYYY-MM-DD', ...], records: { 'YYYY-MM-DD': [...] } }
 *      Used by fetch-slate.mjs. Records are keyed by date string; the
 *      function walks `dates` and pulls each day's records out of the map.
 *
 * Mixing the two is not supported. Anything else short-circuits to the
 * empty result so a malformed input never blocks the cron pipeline.
 *
 * @param {Array<{ date?: string, records: Array<{ score: number, tier?: string, homered: 0|1|null }> }>} backtestLog
 * @param {{
 *   lookbackDays?: number,
 *   scoreToProbFn?: (score: number) => number,
 *   skipUnreconciled?: boolean,
 *   epsilon?: number,
 * }} [opts]
 * @returns {{
 *   brier: number,
 *   logLoss: number,
 *   brierByTier: { PRIME: number, STRONG: number, LEAN: number, SKIP: number },
 *   reliability: Array<Object>,
 *   totalReconciled: number,
 *   perTierCount: { PRIME: number, STRONG: number, LEAN: number, SKIP: number },
 *   computedAt: string,
 *   windowDays: number,
 * }}
 */
export function computeMetricsFromBacktest(backtestLog, opts = {}) {
  const lookbackDays = opts.lookbackDays !== undefined ? opts.lookbackDays : 30;
  const scoreToProbFn =
    typeof opts.scoreToProbFn === 'function'
      ? opts.scoreToProbFn
      : _defaultScoreToProb;
  const skipUnreconciled =
    opts.skipUnreconciled !== undefined ? opts.skipUnreconciled : true;
  const epsilon = opts.epsilon !== undefined ? opts.epsilon : 1e-9;

  const TIERS = ['PRIME', 'STRONG', 'LEAN', 'SKIP'];

  const emptyTierMap = () => ({ PRIME: 0, STRONG: 0, LEAN: 0, SKIP: 0 });

  const emptyResult = () => ({
    brier: 0,
    logLoss: 0,
    brierByTier: emptyTierMap(),
    reliability: [],
    totalReconciled: 0,
    perTierCount: emptyTierMap(),
    computedAt: new Date().toISOString(),
    windowDays: lookbackDays,
  });

  if (!backtestLog) return emptyResult();

  // Normalize the two accepted shapes into a single Array<{date, records}>.
  // The on-disk backtest-log.json uses the keyed-map form; some tests pass
  // the flat array form. Anything else falls through to empty.
  let window;
  if (Array.isArray(backtestLog)) {
    if (backtestLog.length === 0) return emptyResult();
    window = backtestLog.slice(-lookbackDays);
  } else if (
    typeof backtestLog === 'object' &&
    backtestLog.records &&
    typeof backtestLog.records === 'object'
  ) {
    const dates = Array.isArray(backtestLog.dates)
      ? backtestLog.dates
      : Object.keys(backtestLog.records);
    if (dates.length === 0) return emptyResult();
    // Sort ascending so .slice(-N) gives the most-recent N entries
    // regardless of whether the on-disk file kept dates ordered.
    const ordered = [...dates].sort();
    window = ordered.slice(-lookbackDays).map((d) => ({
      date: d,
      records: backtestLog.records[d] || [],
    }));
  } else {
    return emptyResult();
  }

  // Collect all reconciled records with computed probability
  const all = []; // { prob, actual, tier }
  const byTier = { PRIME: [], STRONG: [], LEAN: [], SKIP: [] };

  for (let d = 0; d < window.length; d++) {
    const day = window[d];
    if (!day.records || !Array.isArray(day.records)) continue;

    for (let r = 0; r < day.records.length; r++) {
      const rec = day.records[r];

      // Skip unreconciled
      if (skipUnreconciled && rec.homered == null) continue;

      const prob = scoreToProbFn(rec.score);
      const actual = rec.homered ? 1 : 0;
      // Records carry `grade` (a string like 'PRIME'), never `tier`. Reading
      // rec.tier bucketed every record as SKIP, zeroing the per-tier Brier.
      const tier = TIERS.includes(rec.grade) ? rec.grade : 'SKIP';

      const entry = { prob, actual };
      all.push(entry);
      byTier[tier].push(entry);
    }
  }

  // Global metrics
  const brier = computeBrier(all);
  const logLoss = computeLogLoss(all, { epsilon });
  const reliability = computeReliabilityCurve(all);

  // Per-tier Brier
  const brierByTier = emptyTierMap();
  for (let t = 0; t < TIERS.length; t++) {
    brierByTier[TIERS[t]] = computeBrier(byTier[TIERS[t]]);
  }

  // Per-tier record counts
  const perTierCount = emptyTierMap();
  for (let t = 0; t < TIERS.length; t++) {
    perTierCount[TIERS[t]] = byTier[TIERS[t]].length;
  }

  return {
    brier,
    logLoss,
    brierByTier,
    reliability,
    totalReconciled: all.length,
    perTierCount,
    computedAt: new Date().toISOString(),
    windowDays: lookbackDays,
  };
}

