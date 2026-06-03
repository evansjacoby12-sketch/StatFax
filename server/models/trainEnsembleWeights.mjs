/**
 * trainEnsembleWeights.mjs — Self-contained logistic-regression stacker.
 *
 * Phase 3 ML: instead of pulling in an external library (xgboost-node,
 * onnxruntime-node) and shipping a pretrained artifact, we fit a small linear
 * model directly on the reconciled backtest log every cron run. The rule
 * model's own outputs (final score, grade, active badges) are the features —
 * the stacker learns which of the rule model's signals are best calibrated and
 * blends them into a single probability that the existing combineModels()
 * weighted-averages against the raw rule score.
 *
 * Why this beats "no ML at all":
 *   - The rule model assigns equal narrative weight to every badge, but we
 *     can already see in the backtest that (e.g.) `hot` is a stronger signal
 *     than `dayEdge`. A learned weight vector encodes that automatically.
 *   - PRIME vs STRONG vs LEAN vs SKIP captures non-linear bucketing the
 *     raw score alone can't express on its own; the one-hot lets the
 *     stacker treat the grade boundaries as discrete features.
 *
 * Why it's not "real ML":
 *   - One-tap features. No exit velo / launch angle / matchup vectors.
 *   - Tiny dataset (1k-30k rows). Fits in milliseconds; no GPU, no Python.
 *   - L2 ridge term keeps weights bounded so a single noisy week can't blow
 *     up coefficients.
 *
 * The plan is to graduate to a richer feature set once we've logged richer
 * sub-scores into the backtest log (batterScore, matchupScore, envScore,
 * hotnessPosterior, vegasImpliedProb, etc). For now: simple, dependency-free,
 * retrainable on every cron.
 *
 * @module trainEnsembleWeights
 */

// ---------------------------------------------------------------------------
// Feature schema
// ---------------------------------------------------------------------------

/**
 * Fixed feature order. Both the trainer and the runtime inference path
 * (scoreWithML) MUST produce vectors in this exact order. Any mismatch
 * silently scores garbage — that's why the names + the index live together
 * here as a single source of truth.
 */
export const FEATURE_NAMES = Object.freeze([
  'score',           // 0  rule model's 0-100 final score (normalised to 0-1 inside)
  'badge_hot',       // 1
  'badge_due',       // 2
  'badge_cold',      // 3
  'badge_bullpenLegend',
  'badge_dayEdge',
  'badge_nightEdge',
  'grade_PRIME',     // 7
  'grade_STRONG',
  'grade_LEAN',
  'grade_SKIP',
]);

const BADGE_FEATURE_KEYS = ['hot', 'due', 'cold', 'bullpenLegend', 'dayEdge', 'nightEdge'];
const GRADE_FEATURE_KEYS = ['PRIME', 'STRONG', 'LEAN', 'SKIP'];

/**
 * Extract a flat feature vector from a backtest log record (or a live
 * scoredBatters row — same shape for the fields we touch).
 *
 * Field-by-field:
 *   - `score` is normalised to [0, 1] so it's on the same scale as the
 *     boolean badges/grades; otherwise the raw 0-100 swamps gradient
 *     updates on the binary features.
 *   - `badges` is the array form written by extractPredictionRecord; we
 *     also accept the live row shape where badge keys are boolean fields
 *     directly on the object.
 *   - `grade` is read as a string label ("PRIME", "STRONG", ...). The live
 *     row stores grade as `{ label }` in some code paths; we accept both.
 *
 * @param {object} record - backtest log record OR live scoredBatters row.
 * @returns {number[]} feature vector matching FEATURE_NAMES order.
 */
export function extractFeatures(record) {
  if (!record || typeof record !== 'object') {
    return new Array(FEATURE_NAMES.length).fill(0);
  }

  // Score, normalised to [0, 1].
  const rawScore = typeof record.score === 'number' ? record.score : 0;
  const normScore = Math.max(0, Math.min(1, rawScore / 100));

  // Badges may be an array (backtest log) or boolean fields (live row).
  const badgeArr = Array.isArray(record.badges) ? record.badges : null;
  const hasBadge = (key) => (badgeArr ? badgeArr.includes(key) : record[key] === true);

  // Grade may be string ("PRIME") or { label: "PRIME" } (live row).
  const gradeLabel = typeof record.grade === 'string'
    ? record.grade
    : (record.grade && typeof record.grade.label === 'string' ? record.grade.label : null);

  const vec = [normScore];
  for (const key of BADGE_FEATURE_KEYS) vec.push(hasBadge(key) ? 1 : 0);
  for (const key of GRADE_FEATURE_KEYS) vec.push(gradeLabel === key ? 1 : 0);
  return vec;
}

// ---------------------------------------------------------------------------
// trainEnsembleWeights
// ---------------------------------------------------------------------------

/**
 * Train logistic regression weights via full-batch gradient descent on the
 * reconciled backtest log.
 *
 * Survivorship guard: records with `actuallyPlayed === false` are dropped.
 * Records without that field (older log entries) are treated as played — same
 * convention the calibration multiplier path uses, so we don't quietly
 * invalidate the existing 30-day window.
 *
 * Lookback: defaults to 30 days. The backtest log is already trimmed to
 * ROLLING_DAYS = 30 by reconcile.mjs, so this is effectively "use everything"
 * until we either store more days or want to deliberately ignore older data.
 *
 * Math:
 *   - Init weights = 0, intercept = log(baseRate / (1 - baseRate)) so the
 *     untrained model predicts the empirical HR rate exactly. This means a
 *     model with no signal whatsoever still produces a calibrated prior.
 *   - For each iteration: z = intercept + Σ wᵢ·xᵢ ; p = sigmoid(z).
 *     Gradient w_i ←  w_i - lr · ((p - y) · x_i + λ · w_i)
 *     Intercept does NOT get L2 (penalising it would bias toward 50% rather
 *     than the empirical base rate).
 *   - L2 (ridge) keeps weights bounded. The default 0.01 is conservative;
 *     with only ~1k samples we want the prior pulling weights toward zero
 *     until we have more data.
 *
 * @param {object} backtestLog               - { dates, records } shape from R2.
 * @param {object} [opts]
 * @param {number} [opts.lookbackDays=30]    - Use the most recent N dates.
 * @param {number} [opts.learningRate=0.05]
 * @param {number} [opts.iterations=500]
 * @param {number} [opts.regularization=0.01] - L2 ridge term (lambda).
 * @returns {{
 *   weights: number[],
 *   intercept: number,
 *   trainedOn: number,
 *   featureNames: string[],
 *   brier: number,
 *   logLoss: number,
 *   trainedAt: string
 * }}
 */
export function trainEnsembleWeights(backtestLog, opts = {}) {
  const lookbackDays   = opts.lookbackDays   ?? 30;
  const learningRate   = opts.learningRate   ?? 0.05;
  const iterations     = opts.iterations     ?? 500;
  const regularization = opts.regularization ?? 0.01;

  // Pull the most recent N dates' worth of records.
  const dates = Array.isArray(backtestLog?.dates) ? [...backtestLog.dates].sort() : [];
  const recentDates = dates.slice(-lookbackDays);
  const allRaw = recentDates.flatMap(d => backtestLog?.records?.[d] || []);

  // Survivorship filter — explicit scratches only. Missing field = played.
  const samples = allRaw.filter(r => r && r.actuallyPlayed !== false);

  if (samples.length === 0) {
    throw new Error('trainEnsembleWeights: no usable samples after survivorship filter');
  }

  // Build feature matrix + label vector.
  const X = samples.map(extractFeatures);
  const y = samples.map(r => (r.homered === true ? 1 : 0));
  const n = X.length;
  const d = FEATURE_NAMES.length;

  // Sanity-check the feature matrix shape — a wrong extractor would scream here.
  for (const row of X) {
    if (row.length !== d) {
      throw new Error(`trainEnsembleWeights: feature vector length ${row.length} !== expected ${d}`);
    }
  }

  // Init: weights at zero, intercept at log-odds of empirical base rate.
  // Guard against degenerate base rates (all 1 or all 0) which would produce
  // ±Infinity log-odds — clamp slightly inward.
  const baseRate = y.reduce((s, v) => s + v, 0) / n;
  const safeRate = Math.max(0.001, Math.min(0.999, baseRate));
  const weights = new Array(d).fill(0);
  let intercept = Math.log(safeRate / (1 - safeRate));

  // Full-batch gradient descent. 500 iters on 1k samples is < 50 ms.
  for (let iter = 0; iter < iterations; iter++) {
    // Forward pass: compute predictions for every sample.
    const preds = new Array(n);
    for (let i = 0; i < n; i++) {
      let z = intercept;
      const row = X[i];
      for (let j = 0; j < d; j++) z += weights[j] * row[j];
      preds[i] = _sigmoid(z);
    }

    // Backward pass: accumulate gradients, then apply averaged update.
    const wGrad = new Array(d).fill(0);
    let bGrad = 0;
    for (let i = 0; i < n; i++) {
      const err = preds[i] - y[i];
      bGrad += err;
      const row = X[i];
      for (let j = 0; j < d; j++) wGrad[j] += err * row[j];
    }

    // Apply: w -= lr · (avgGrad + λ · w). Intercept gets no L2 penalty.
    intercept -= learningRate * (bGrad / n);
    for (let j = 0; j < d; j++) {
      weights[j] -= learningRate * (wGrad[j] / n + regularization * weights[j]);
    }
  }

  // Final training-set metrics. These aren't an honest hold-out estimate —
  // they're a "did the optimiser do anything useful?" sanity check. Compare
  // against base-rate Brier (`p̄ · (1 - p̄)`) and log-loss
  // (`-p̄·ln(p̄) - (1-p̄)·ln(1-p̄)`) which the model has to beat to earn its keep.
  let brierSum = 0;
  let logLossSum = 0;
  for (let i = 0; i < n; i++) {
    let z = intercept;
    const row = X[i];
    for (let j = 0; j < d; j++) z += weights[j] * row[j];
    const p = _sigmoid(z);
    const diff = p - y[i];
    brierSum += diff * diff;
    // Clamp to avoid log(0) in the rare case of perfect confidence.
    const pSafe = Math.max(1e-9, Math.min(1 - 1e-9, p));
    logLossSum += -(y[i] * Math.log(pSafe) + (1 - y[i]) * Math.log(1 - pSafe));
  }

  return {
    weights,
    intercept,
    trainedOn: n,
    featureNames: [...FEATURE_NAMES],
    brier: brierSum / n,
    logLoss: logLossSum / n,
    trainedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _sigmoid(z) {
  // Numerically-stable sigmoid: avoid Math.exp on large positive z (overflow
  // to Infinity → NaN downstream). The two-branch form keeps every result in
  // [0, 1] without losing precision near the asymptotes.
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

// ---------------------------------------------------------------------------
// Output file contract
// ---------------------------------------------------------------------------

// Example trained weights file structure (written to dist/ensemble-weights.json):
// {
//   "intercept": -3.31,
//   "weights": [0.42, 0.18, -0.05, 0.22, ...],
//   "featureNames": [...],
//   "trainedAt": "2026-05-27T16:30:00Z",
//   "trainedOn": 1026,
//   "brier": 0.0823,
//   "logLoss": 0.281
// }
