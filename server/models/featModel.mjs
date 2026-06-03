/**
 * featModel.mjs — EXPERIMENTAL feature-based HR model for the ranking blend.
 *
 * The production "ensemble" stacker (ensemble.mjs) only sees the rule model's
 * OUTPUTS (score + badges + grade one-hots), so it can't out-rank the rule
 * score — it's essentially a re-calibration of it. This model instead fits an
 * L2-regularized logistic regression directly on the 20-dim FEATURE vector that
 * reconcile.mjs logs (`feat`), which empirically separates HR/no-HR better
 * (5-fold CV AUC ~0.77 vs the rule score's ~0.73 on the first ~430 reconciled
 * rows with features).
 *
 * Train/inference feature parity is guaranteed because both sides use the SAME
 * extractor: training reads `record.feat`, inference calls
 * `extractPredictionRecord(row).feat` (reconcile.mjs).
 *
 * Output is a probability (sigmoid). The caller maps it onto the rule 0-100
 * scale via the isotonic table's inverse (probToScore) so it can be blended
 * with the rule score on a like-for-like axis.
 *
 * This is gated + small-sample-aware: trainFeatModel returns { ready:false }
 * until MIN_N feature rows exist, and the caller weights it by the measured
 * CV-AUC edge (capped). Set the caller's master flag off for instant rollback.
 */

export const FEAT_KEYS = [
  'bs', 'ms', 'es', 'iso', 'xiso', 'brl', 'rbrl', 'ev', 'hh', 'la',
  'phr9', 'pera', 'pk9', 'vdel', 'csw', 'park', 'vig', 'ord', 'hot', 'due',
]

const MIN_N = 300
const L2 = 2.0
const ITERS = 3000
const LR = 0.1

const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)))

function aucOf(scores, y) {
  const idx = [...scores.keys()]
  const nPos = y.filter((v) => v === 1).length
  const nNeg = y.length - nPos
  if (!nPos || !nNeg) return NaN
  const ord = idx.slice().sort((a, b) => scores[a] - scores[b])
  let i = 0
  let rankSum = 0
  while (i < ord.length) {
    let j = i
    while (j < ord.length && scores[ord[j]] === scores[ord[i]]) j++
    const avg = (i + 1 + j) / 2
    for (let k = i; k < j; k++) if (y[ord[k]] === 1) rankSum += avg
    i = j
  }
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg)
}

function fitLogistic(rowsX, y, base) {
  let w = new Array(rowsX[0].length).fill(0)
  let b = Math.log(base / (1 - base))
  for (let it = 0; it < ITERS; it++) {
    const gw = new Array(w.length).fill(0)
    let gb = 0
    for (let i = 0; i < rowsX.length; i++) {
      let z = b
      for (let j = 0; j < w.length; j++) z += w[j] * rowsX[i][j]
      const e = sigmoid(z) - y[i]
      gb += e
      for (let j = 0; j < w.length; j++) gw[j] += e * rowsX[i][j]
    }
    b -= (LR * gb) / rowsX.length
    for (let j = 0; j < w.length; j++) w[j] -= (LR * (gw[j] + L2 * w[j])) / rowsX.length
  }
  return { intercept: b, weights: w }
}

/**
 * Fit the feature model from the backtest log. Returns a handle with the fitted
 * params + the measured CV-AUC edge over the rule score (so the caller can size
 * the blend weight), or { ready:false } when there isn't enough feature data.
 */
export function trainFeatModel(backtestLog, { minN = MIN_N } = {}) {
  const recs = backtestLog?.records || {}
  const samples = []
  for (const date of Object.keys(recs)) {
    for (const r of recs[date]) {
      if (r?.feat && (r.homered === true || r.homered === false) && Number.isFinite(r.score)) {
        samples.push({ feat: r.feat, y: r.homered ? 1 : 0, score: r.score })
      }
    }
  }
  const n = samples.length
  if (n < minN) return { ready: false, n }

  const base = samples.reduce((s, r) => s + r.y, 0) / n
  // Standardization stats (finite values only).
  const mean = {}
  const sd = {}
  for (const k of FEAT_KEYS) {
    const v = samples.map((r) => r.feat[k]).filter((x) => Number.isFinite(x))
    const m = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0
    const s = v.length ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) : 1
    mean[k] = m
    sd[k] = s || 1
  }
  const std = (feat) => FEAT_KEYS.map((k) => ((Number.isFinite(feat[k]) ? feat[k] : mean[k]) - mean[k]) / sd[k])
  const X = samples.map((r) => std(r.feat))
  const y = samples.map((r) => r.y)

  // 5-fold CV → OOS predictions for an honest AUC estimate.
  const folds = Array.from({ length: 5 }, () => [])
  samples.forEach((_, i) => folds[i % 5].push(i))
  const oos = new Array(n).fill(0)
  for (let f = 0; f < 5; f++) {
    const test = folds[f]
    const train = folds.filter((_, i) => i !== f).flat()
    const m = fitLogistic(train.map((i) => X[i]), train.map((i) => y[i]), base)
    for (const i of test) {
      let z = m.intercept
      for (let j = 0; j < X[i].length; j++) z += m.weights[j] * X[i][j]
      oos[i] = sigmoid(z)
    }
  }
  const cvAuc = aucOf(oos, y)
  const ruleAuc = aucOf(samples.map((r) => r.score), y)

  // Final model on all rows.
  const final = fitLogistic(X, y, base)
  return { ready: true, n, mean, sd, weights: final.weights, intercept: final.intercept, cvAuc, ruleAuc }
}

/** Inference: feature vector → HR probability. */
export function scoreFeatProb(feat, model) {
  if (!model?.ready || !feat) return null
  let z = model.intercept
  for (let i = 0; i < FEAT_KEYS.length; i++) {
    const k = FEAT_KEYS[i]
    const x = Number.isFinite(feat[k]) ? feat[k] : model.mean[k]
    z += model.weights[i] * ((x - model.mean[k]) / model.sd[k])
  }
  return sigmoid(z)
}

/**
 * Invert the isotonic score→prob table: given a probability, return the rule
 * 0-100 score that maps to it (so an ML probability can be blended with the
 * rule score on the same axis). Linear interpolation between bucket midpoints.
 */
export function probToScore(prob, table) {
  if (!Array.isArray(table) || !table.length || !Number.isFinite(prob)) return null
  const mids = table.map((b) => (b.scoreLo + b.scoreHi) / 2)
  const probs = table.map((b) => b.observedProb)
  if (prob <= probs[0]) return mids[0]
  if (prob >= probs[probs.length - 1]) return mids[mids.length - 1]
  for (let i = 0; i < probs.length - 1; i++) {
    if (prob >= probs[i] && prob <= probs[i + 1]) {
      const span = probs[i + 1] - probs[i]
      const t = span > 1e-9 ? (prob - probs[i]) / span : 0
      return mids[i] + t * (mids[i + 1] - mids[i])
    }
  }
  return mids[mids.length - 1]
}
