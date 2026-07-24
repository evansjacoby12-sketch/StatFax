import { K_LINES, kOverProb } from './kBrain.js'

export const K_FORWARD_SEGMENT_DIMENSIONS = [
  'lineupMode',
  'confidence',
  'volumeSource',
  'projectionBand',
]

export function flattenKResults(kProps, {
  fromDate = null,
  finalPregameOnly = false,
} = {}) {
  return Object.entries(kProps?.resultsByDate || {})
    .flatMap(([date, rows]) => (rows || []).map((row) => ({ ...row, date })))
    .filter((row) => (
      (!fromDate || row.date >= fromDate)
      && (!finalPregameOnly || (row.finalPregame === true && row.lateCapture !== true))
      && Number.isFinite(row.estK)
      && Number.isFinite(row.actualK)
    ))
}

export function summarizeKRows(rows, { scale = 1 } = {}) {
  const usable = (rows || []).filter((row) => Number.isFinite(row.estK) && Number.isFinite(row.actualK))
  if (!usable.length) return { n: 0, scale }

  let predicted = 0
  let actual = 0
  let absoluteError = 0
  let squaredError = 0
  let brier = 0
  let probabilityBias = 0
  let probabilityN = 0
  const byLine = Object.fromEntries(K_LINES.map((line) => [line, { predicted: 0, actual: 0, n: 0 }]))

  for (const row of usable) {
    const estimate = row.estK * scale
    const error = estimate - row.actualK
    predicted += estimate
    actual += row.actualK
    absoluteError += Math.abs(error)
    squaredError += error ** 2

    for (const line of K_LINES) {
      const probability = kOverProb(estimate, line)
      const outcome = row.actualK > line ? 1 : 0
      if (!Number.isFinite(probability)) continue
      brier += (probability - outcome) ** 2
      probabilityBias += probability - outcome
      probabilityN++
      byLine[line].predicted += probability
      byLine[line].actual += outcome
      byLine[line].n++
    }
  }

  const ipRows = usable.filter((row) => Number.isFinite(row.expIP) && Number.isFinite(row.actualIP))
  const bfRows = usable.filter((row) => Number.isFinite(row.expBF) && Number.isFinite(row.actualBF))
  const summarizeVolumeBias = (values, predictedKey, actualKey) => values.length
    ? values.reduce((sum, row) => sum + row[predictedKey] - row[actualKey], 0) / values.length
    : null

  for (const line of K_LINES) {
    const values = byLine[line]
    values.predicted = values.n ? values.predicted / values.n : null
    values.actual = values.n ? values.actual / values.n : null
  }

  return {
    n: usable.length,
    scale,
    predictedMean: predicted / usable.length,
    actualMean: actual / usable.length,
    bias: (predicted - actual) / usable.length,
    mae: absoluteError / usable.length,
    rmse: Math.sqrt(squaredError / usable.length),
    brier: probabilityN ? brier / probabilityN : null,
    probabilityBias: probabilityN ? probabilityBias / probabilityN : null,
    ipN: ipRows.length,
    ipBias: summarizeVolumeBias(ipRows, 'expIP', 'actualIP'),
    bfN: bfRows.length,
    bfBias: summarizeVolumeBias(bfRows, 'expBF', 'actualBF'),
    byLine,
  }
}

export function findBestKScale(rows, {
  min = 0.75,
  max = 1.15,
  step = 0.005,
  objective = 'brier',
} = {}) {
  let best = null
  for (let scale = min; scale <= max + step / 2; scale += step) {
    const roundedScale = +scale.toFixed(6)
    const metrics = summarizeKRows(rows, { scale: roundedScale })
    const value = metrics[objective]
    if (!Number.isFinite(value)) continue
    if (!best || value < best.value) best = { scale: roundedScale, value, metrics }
  }
  return best
}

function scaleDirection(scale) {
  if (!Number.isFinite(scale) || Math.abs(scale - 1) < 1e-9) return 0
  return scale > 1 ? 1 : -1
}

export function kProjectionBand(row) {
  const estimate = Number(row?.estK)
  if (!Number.isFinite(estimate)) return 'unknown'
  if (estimate < 4.5) return 'low (<4.5)'
  if (estimate < 6.5) return 'mid (4.5–6.4)'
  return 'high (6.5+)'
}

function segmentValue(row, dimension) {
  if (dimension === 'projectionBand') return kProjectionBand(row)
  if (dimension === 'confidence') return row?.conf || 'unknown'
  return row?.[dimension] || 'unknown'
}

function splitForwardDates(rows, validationFraction) {
  const dates = [...new Set(rows.map((row) => row.date).filter(Boolean))].sort()
  if (!dates.length) return { dates, trainingDates: [], validationDates: [], training: [], validation: [] }
  const validationDateCount = dates.length === 1
    ? 1
    : Math.max(1, Math.ceil(dates.length * validationFraction))
  const validationDates = dates.slice(-validationDateCount)
  const validationSet = new Set(validationDates)
  return {
    dates,
    trainingDates: dates.filter((date) => !validationSet.has(date)),
    validationDates,
    training: rows.filter((row) => !validationSet.has(row.date)),
    validation: rows.filter((row) => validationSet.has(row.date)),
  }
}

function segmentForwardRows(rows, candidateScale, {
  minSegmentSample,
  maxSegmentBrierRegression,
  maxSegmentRmseRegression,
} = {}) {
  return Object.fromEntries(K_FORWARD_SEGMENT_DIMENSIONS.map((dimension) => {
    const grouped = new Map()
    for (const row of rows) {
      const key = segmentValue(row, dimension)
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(row)
    }
    const segments = [...grouped.entries()]
      .map(([key, values]) => {
        const baseline = summarizeKRows(values)
        const candidate = summarizeKRows(values, { scale: candidateScale })
        const brierRegression = candidate.brier - baseline.brier
        const rmseRegression = candidate.rmse - baseline.rmse
        const material = values.length >= minSegmentSample
        return {
          key,
          n: values.length,
          dates: new Set(values.map((row) => row.date).filter(Boolean)).size,
          material,
          baseline,
          candidate,
          brierRegression,
          rmseRegression,
          pass: !material || (
            brierRegression <= maxSegmentBrierRegression
            && rmseRegression <= maxSegmentRmseRegression
          ),
        }
      })
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
    return [dimension, segments]
  }))
}

/**
 * Build a strict chronological forward-validation view for one deployed model.
 * Only last pregame captures are eligible; legacy refreshes and late captures
 * are reported but never used to approve a production calibration.
 */
export function buildKForwardValidation(rows, {
  modelVersion,
  candidateScale = 1,
  validationFraction = 0.30,
  minSegmentSample = 15,
  maxSegmentBrierRegression = 0.01,
  maxSegmentRmseRegression = 0.25,
} = {}) {
  const source = rows || []
  const finite = source.filter((row) => Number.isFinite(row?.estK) && Number.isFinite(row?.actualK))
  const versionRows = finite.filter((row) => modelVersion == null || row.modelVersion === modelVersion)
  const eligible = versionRows.filter((row) => row.finalPregame === true && row.lateCapture !== true)
  const split = splitForwardDates(eligible, validationFraction)
  const baseline = summarizeKRows(split.validation)
  const candidate = summarizeKRows(split.validation, { scale: candidateScale })
  const segments = segmentForwardRows(split.validation, candidateScale, {
    minSegmentSample,
    maxSegmentBrierRegression,
    maxSegmentRmseRegression,
  })
  const materialSegments = Object.values(segments).flat().filter((segment) => segment.material)

  return {
    modelVersion,
    candidateScale,
    counts: {
      source: source.length,
      finite: finite.length,
      modelVersion: versionRows.length,
      eligible: eligible.length,
      lateCapture: versionRows.filter((row) => row.lateCapture === true).length,
      notFinalPregame: versionRows.filter((row) => row.finalPregame !== true).length,
    },
    dates: split.dates,
    trainingDates: split.trainingDates,
    validationDates: split.validationDates,
    trainingRows: split.training,
    validationRows: split.validation,
    baseline,
    candidate,
    brierImprovement: Number.isFinite(baseline.brier) && Number.isFinite(candidate.brier)
      ? baseline.brier - candidate.brier
      : null,
    rmseImprovement: Number.isFinite(baseline.rmse) && Number.isFinite(candidate.rmse)
      ? baseline.rmse - candidate.rmse
      : null,
    segments,
    materialSegments: materialSegments.length,
    segmentDimensionsCovered: K_FORWARD_SEGMENT_DIMENSIONS.filter((dimension) => (
      segments[dimension].some((segment) => segment.material)
    )).length,
    noMaterialSegmentRegression: materialSegments.every((segment) => segment.pass),
  }
}

/**
 * Require a training-window calibration recommendation to repeat on later
 * dates before it can be proposed for code review. This function still never
 * mutates the deployed calibration.
 */
export function evaluateKPromotion(rows, currentCalibration, {
  modelVersion,
  minSamples = 100,
  minDates = 7,
  minTrainingSamples = 50,
  minTrainingDates = 4,
  minValidationSamples = 25,
  minValidationDates = 2,
  minSegmentSample = 15,
  minBrierImprovement = 0.00025,
  minRmseImprovement = 0.005,
  maxAbsBias = 0.35,
  maxAbsProbabilityBias = 0.04,
  maxSegmentBrierRegression = 0.01,
  maxSegmentRmseRegression = 0.25,
  validationFraction = 0.30,
  maxRelativeStep = 0.05,
} = {}) {
  const initial = buildKForwardValidation(rows, {
    modelVersion,
    validationFraction,
    minSegmentSample,
    maxSegmentBrierRegression,
    maxSegmentRmseRegression,
  })
  const trainingRecommendation = recommendKCalibration(
    initial.trainingRows,
    currentCalibration,
    {
      modelVersion,
      minSamples: minTrainingSamples,
      minDates: minTrainingDates,
      maxRelativeStep,
    },
  )
  const candidateScale = trainingRecommendation.status === 'promote'
    ? trainingRecommendation.proposedScale
    : 1
  const forward = buildKForwardValidation(rows, {
    modelVersion,
    candidateScale,
    validationFraction,
    minSegmentSample,
    maxSegmentBrierRegression,
    maxSegmentRmseRegression,
  })
  const checks = {
    finalPregameSamples: forward.counts.eligible >= minSamples,
    dates: forward.dates.length >= minDates,
    trainingSamples: forward.trainingRows.length >= minTrainingSamples,
    trainingDates: forward.trainingDates.length >= minTrainingDates,
    trainingRecommendation: trainingRecommendation.status === 'promote',
    validationSamples: forward.validationRows.length >= minValidationSamples,
    validationDates: forward.validationDates.length >= minValidationDates,
    validationBrierImproves: Number.isFinite(forward.brierImprovement)
      && forward.brierImprovement >= minBrierImprovement,
    validationRmseImproves: Number.isFinite(forward.rmseImprovement)
      && forward.rmseImprovement >= minRmseImprovement,
    validationBiasControlled: Number.isFinite(forward.candidate.bias)
      && Math.abs(forward.candidate.bias) <= maxAbsBias,
    validationProbabilityBiasControlled: Number.isFinite(forward.candidate.probabilityBias)
      && Math.abs(forward.candidate.probabilityBias) <= maxAbsProbabilityBias,
    segmentCoverage: forward.segmentDimensionsCovered === K_FORWARD_SEGMENT_DIMENSIONS.length,
    noMaterialSegmentRegression: forward.noMaterialSegmentRegression,
  }
  const enoughEvidence = (
    checks.finalPregameSamples
    && checks.dates
    && checks.trainingSamples
    && checks.trainingDates
    && checks.validationSamples
    && checks.validationDates
  )
  const promote = Object.values(checks).every(Boolean)
  return {
    status: promote ? 'promote' : enoughEvidence ? 'hold' : 'collecting',
    modelVersion,
    currentCalibration,
    proposedCalibration: promote
      ? trainingRecommendation.proposedCalibration
      : currentCalibration,
    proposedScale: promote ? candidateScale : 1,
    candidateScale,
    checks,
    trainingRecommendation,
    forward,
  }
}

/**
 * Produce a code-reviewable calibration recommendation, never an automatic
 * production mutation. It requires multiple dates, Brier/RMSE agreement, a
 * material mean bias, and improvement on both objectives. Even then, one
 * promotion can move the deployed constant by at most maxRelativeStep.
 */
export function recommendKCalibration(rows, currentCalibration, {
  modelVersion = null,
  minSamples = 60,
  minDates = 3,
  minAbsBias = 0.15,
  minBrierImprovement = 0.0005,
  minRmseImprovement = 0.005,
  maxRelativeStep = 0.05,
  searchMin = 0.85,
  searchMax = 1.15,
  searchStep = 0.005,
} = {}) {
  const eligible = (rows || []).filter((row) => (
    Number.isFinite(row?.estK)
    && Number.isFinite(row?.actualK)
    && (modelVersion == null || row.modelVersion === modelVersion)
  ))
  const dates = new Set(eligible.map((row) => row.date).filter(Boolean))
  const current = summarizeKRows(eligible)
  const base = {
    n: eligible.length,
    dates: dates.size,
    modelVersion,
    currentCalibration,
    current,
  }
  if (eligible.length < minSamples || dates.size < minDates) {
    return {
      ...base,
      status: 'collecting',
      proposedCalibration: currentCalibration,
      proposedScale: 1,
      checks: {
        samples: eligible.length >= minSamples,
        dates: dates.size >= minDates,
      },
    }
  }

  const bestBrier = findBestKScale(eligible, {
    min: searchMin, max: searchMax, step: searchStep, objective: 'brier',
  })
  const bestRmse = findBestKScale(eligible, {
    min: searchMin, max: searchMax, step: searchStep, objective: 'rmse',
  })
  const agrees = (
    scaleDirection(bestBrier?.scale) !== 0
    && scaleDirection(bestBrier?.scale) === scaleDirection(bestRmse?.scale)
  )
  const rawScale = agrees ? (bestBrier.scale + bestRmse.scale) / 2 : 1
  const proposedScale = Math.max(1 - maxRelativeStep, Math.min(1 + maxRelativeStep, rawScale))
  const candidate = summarizeKRows(eligible, { scale: proposedScale })
  const brierImprovement = current.brier - candidate.brier
  const rmseImprovement = current.rmse - candidate.rmse
  const checks = {
    samples: true,
    dates: true,
    objectiveAgreement: agrees,
    materialBias: Math.abs(current.bias) >= minAbsBias,
    brierImproves: brierImprovement >= minBrierImprovement,
    rmseImproves: rmseImprovement >= minRmseImprovement,
  }
  const promote = Object.values(checks).every(Boolean)
  return {
    ...base,
    status: promote ? 'promote' : 'hold',
    proposedCalibration: promote
      ? +(currentCalibration * proposedScale).toFixed(6)
      : currentCalibration,
    proposedScale: promote ? proposedScale : 1,
    rawScale,
    candidate,
    bestBrier,
    bestRmse,
    brierImprovement,
    rmseImprovement,
    checks,
  }
}
