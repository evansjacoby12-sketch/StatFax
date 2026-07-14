/**
 * featModel.mjs — EXPERIMENTAL feature-based HR model for the ranking blend.
 *
 * The production "ensemble" stacker (ensemble.mjs) only sees the rule model's
 * OUTPUTS (score + badges + grade one-hots), so it can't out-rank the rule
 * score — it's essentially a re-calibration of it. This model instead fits an
 * L2-regularized logistic regression directly on the FEATURE vector that
 * reconcile.mjs logs (`feat`), which empirically separates HR/no-HR better
 * (temporal holdout AUC ~0.77 vs the rule score's ~0.65 on the current
 * reconciled feature history).
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
  // Ceiling/form raw ingredients — ADDED 2026-07-10. 100% null until slates
  // accrue, so they're constant-0 columns → L2 drives their weight to 0 →
  // predictions are BYTE-IDENTICAL today. As data lands, each retrain
  // (temporal-AUC gated, L2-reg, blend sized by the measured AUC edge) learns
  // their weight only when it lifts future-date AUC — auto-earning,
  // self-limiting, no hand-tuned multiplier. Raw ingredients, not the ceil/form
  // composites, so the model learns the weighting itself (no double-count).
  'ss', 'evhi', 'rev',
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

// Shared train/evaluation helpers.
function standardizationFor(samples) {
  const mean = {}
  const sd = {}
  for (const key of FEAT_KEYS) {
    const values = samples.map((sample) => sample.feat[key]).filter(Number.isFinite)
    const avg = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
    const spread = values.length
      ? Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length)
      : 1
    mean[key] = avg
    sd[key] = spread || 1
  }
  return { mean, sd }
}

function standardize(feat, mean, sd) {
  return FEAT_KEYS.map((key) => {
    const value = Number.isFinite(feat[key]) ? feat[key] : mean[key]
    return (value - mean[key]) / sd[key]
  })
}

function predictLogistic(row, model) {
  let z = model.intercept
  for (let i = 0; i < row.length; i++) z += model.weights[i] * row[i]
  return sigmoid(z)
}

/**
 * Fit the feature model and evaluate it on the newest dates only. Training
 * rows, standardization statistics, and the base-rate intercept all come from
 * older dates, preventing future information from leaking into the promotion
 * gate. The final inference model is then refit on the full resolved window.
 */
export function trainFeatModel(backtestLog, {
  minN = MIN_N,
  holdoutDays = 5,
  minHoldoutN = 50,
  historyDays = 90,
} = {}) {
  const archive = backtestLog?.modelHistory
  const useArchive = Array.isArray(archive?.dates) && archive.dates.length > 0
  const records = useArchive ? archive.records || {} : backtestLog?.records || {}
  const allDates = [...new Set([
    ...(useArchive ? archive.dates : backtestLog?.dates || []),
    ...Object.keys(records),
  ])].sort()
  const dates = Number.isFinite(historyDays) && historyDays > 0
    ? allDates.slice(-Math.floor(historyDays))
    : allDates
  const samples = []
  for (const date of dates) {
    for (const row of records[date] || []) {
      if (
        row?.actuallyPlayed !== false
        && row?.feat
        && (row.homered === true || row.homered === false)
        && Number.isFinite(row.score)
      ) {
        samples.push({ date, feat: row.feat, y: row.homered ? 1 : 0, score: row.score })
      }
    }
  }

  const n = samples.length
  if (n < minN) return { ready: false, n, reason: 'sample-too-small' }

  const populatedDates = [...new Set(samples.map((sample) => sample.date))]
  if (populatedDates.length < 2) return { ready: false, n, reason: 'need-multiple-dates' }
  const testDayCount = Math.min(
    holdoutDays,
    Math.max(1, Math.ceil(populatedDates.length * 0.20)),
  )
  const holdoutDates = populatedDates.slice(-testDayCount)
  const holdoutSet = new Set(holdoutDates)
  const trainSamples = samples.filter((sample) => !holdoutSet.has(sample.date))
  const testSamples = samples.filter((sample) => holdoutSet.has(sample.date))
  const requiredTrainN = Math.min(minN, Math.floor(n * 0.60))
  if (trainSamples.length < requiredTrainN || testSamples.length < minHoldoutN) {
    return {
      ready: false,
      n,
      trainN: trainSamples.length,
      holdoutN: testSamples.length,
      holdoutDates,
      reason: 'temporal-split-too-small',
    }
  }

  const trainStats = standardizationFor(trainSamples)
  const trainX = trainSamples.map((sample) => standardize(sample.feat, trainStats.mean, trainStats.sd))
  const trainY = trainSamples.map((sample) => sample.y)
  const trainBase = trainY.reduce((sum, value) => sum + value, 0) / trainY.length
  const evaluationModel = fitLogistic(trainX, trainY, trainBase)
  const testX = testSamples.map((sample) => standardize(sample.feat, trainStats.mean, trainStats.sd))
  const testY = testSamples.map((sample) => sample.y)
  const holdoutPredictions = testX.map((row) => predictLogistic(row, evaluationModel))
  const cvAuc = aucOf(holdoutPredictions, testY)
  const ruleAuc = aucOf(testSamples.map((sample) => sample.score), testY)
  let cvBrier = 0
  let cvLogLoss = 0
  for (let i = 0; i < testY.length; i++) {
    const probability = Math.max(1e-9, Math.min(1 - 1e-9, holdoutPredictions[i]))
    cvBrier += (probability - testY[i]) ** 2
    cvLogLoss += -(testY[i] * Math.log(probability) + (1 - testY[i]) * Math.log(1 - probability))
  }

  const finalStats = standardizationFor(samples)
  const finalX = samples.map((sample) => standardize(sample.feat, finalStats.mean, finalStats.sd))
  const finalY = samples.map((sample) => sample.y)
  const finalBase = finalY.reduce((sum, value) => sum + value, 0) / finalY.length
  const final = fitLogistic(finalX, finalY, finalBase)
  return {
    ready: true,
    n,
    mean: finalStats.mean,
    sd: finalStats.sd,
    weights: final.weights,
    intercept: final.intercept,
    cvAuc,
    ruleAuc,
    cvBrier: cvBrier / testY.length,
    cvLogLoss: cvLogLoss / testY.length,
    trainN: trainSamples.length,
    holdoutN: testSamples.length,
    holdoutDates,
    evaluation: 'temporal-holdout',
    historySource: useArchive ? 'modelHistory' : 'records',
    historyDays: dates.length,
  }
}

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
