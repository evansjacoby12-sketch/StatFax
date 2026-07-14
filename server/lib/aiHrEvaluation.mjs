import { AI_HR_SHADOW_VERSION, assertValidAiHrShadowLedger } from './aiHrShadow.mjs'

export const AI_HR_EVALUATION_VERSION = 1
export const AI_HR_EVALUATION_MODE = 'evaluation'
export const AI_HR_CALIBRATION_EDGES = Object.freeze([0, 0.05, 0.1, 0.15, 0.2, 0.3, 1])
export const AI_HR_PROMOTION_REQUIREMENTS = Object.freeze({
  minSettledRecords: 500,
  minHomers: 30,
  minSettledGames: 40,
  minSettledDates: 14,
  maxEceRegression: 0.002,
})

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const round = (value, digits = 12) => Number(Number(value).toFixed(digits))
const clampProbability = (value) => Math.max(1e-12, Math.min(1 - 1e-12, Number(value)))
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

function recordKey(date, playerId, gamePk) {
  return `${date}:${Number(gamePk)}:${Number(playerId)}`
}

/** Operational rows overwrite the compact archive so repaired outcomes win. */
export function buildAiHrOutcomeIndex(backtestLog) {
  const index = new Map()
  for (const recordsByDate of [backtestLog?.modelHistory?.records, backtestLog?.records]) {
    for (const [date, records] of Object.entries(recordsByDate || {})) {
      if (!validDate(date) || !Array.isArray(records)) continue
      for (const record of records) {
        if (
          !finite(record?.playerId) || !finite(record?.gamePk) ||
          typeof record?.homered !== 'boolean' || typeof record?.actuallyPlayed !== 'boolean'
        ) continue
        index.set(recordKey(date, record.playerId, record.gamePk), {
          homered: record.homered,
          actuallyPlayed: record.actuallyPlayed === true,
        })
      }
    }
  }
  return index
}

export function settleAiHrShadowRecords(ledger, backtestLog) {
  assertValidAiHrShadowLedger(ledger)
  const outcomes = buildAiHrOutcomeIndex(backtestLog)
  const settled = []
  let shadowRecords = 0
  let scratches = 0
  let pendingRecords = 0

  for (const [date, records] of Object.entries(ledger.recordsByDate)) {
    for (const record of records) {
      shadowRecords++
      const outcome = outcomes.get(recordKey(date, record.playerId, record.gamePk))
      if (!outcome) {
        pendingRecords++
        continue
      }
      if (!outcome.actuallyPlayed) {
        scratches++
        continue
      }
      settled.push({
        date,
        record,
        outcome: outcome.homered ? 1 : 0,
        baseline: record.baselineHrProbability,
        shadow: record.shadowHrProbability,
      })
    }
  }

  const settledDates = [...new Set(settled.map((item) => item.date))].sort()
  const settledGames = new Set(settled.map((item) => `${item.date}:${item.record.gamePk}`)).size
  return {
    settled,
    coverage: {
      shadowRecords,
      settledRecords: settled.length,
      pendingRecords,
      scratches,
      settledGames,
      settledDates: settledDates.length,
      firstSettledDate: settledDates[0] || null,
      lastSettledDate: settledDates.at(-1) || null,
    },
  }
}

function calibrationBins(items, probabilityField) {
  const bins = []
  for (let index = 0; index < AI_HR_CALIBRATION_EDGES.length - 1; index++) {
    const lower = AI_HR_CALIBRATION_EDGES[index]
    const upper = AI_HR_CALIBRATION_EDGES[index + 1]
    const includeUpper = index === AI_HR_CALIBRATION_EDGES.length - 2
    const members = items.filter((item) => {
      const probability = item[probabilityField]
      return probability >= lower && (includeUpper ? probability <= upper : probability < upper)
    })
    if (!members.length) continue
    const meanProbability = mean(members.map((item) => item[probabilityField]))
    const observedRate = mean(members.map((item) => item.outcome))
    bins.push({
      lower,
      upper,
      sampleSize: members.length,
      meanProbability: round(meanProbability),
      observedRate: round(observedRate),
      absoluteGap: round(Math.abs(meanProbability - observedRate)),
    })
  }
  return bins
}

function forecastMetrics(items, probabilityField) {
  const probabilities = items.map((item) => item[probabilityField])
  const brier = mean(items.map((item) => (item[probabilityField] - item.outcome) ** 2))
  const logLoss = mean(items.map((item) => {
    const probability = clampProbability(item[probabilityField])
    return -(item.outcome * Math.log(probability) + (1 - item.outcome) * Math.log(1 - probability))
  }))
  const bins = calibrationBins(items, probabilityField)
  const ece = bins.reduce((sum, bin) => sum + bin.absoluteGap * bin.sampleSize, 0) / items.length
  return {
    meanProbability: round(mean(probabilities)),
    brier: round(brier),
    logLoss: round(logLoss),
    ece: round(ece),
    calibrationBins: bins,
  }
}

function pairedBrierConfidenceInterval(items, improvement) {
  const differences = items.map((item) => (
    (item.baseline - item.outcome) ** 2 - (item.shadow - item.outcome) ** 2
  ))
  const clusterResiduals = new Map()
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    const key = item?.date != null && item?.record?.gamePk != null
      ? `${item.date}:${item.record.gamePk}`
      : `row:${index}`
    clusterResiduals.set(key, (clusterResiduals.get(key) || 0) + differences[index] - improvement)
  }
  const clusters = clusterResiduals.size
  if (clusters < 2) return { method: 'game-cluster-robust-normal', clusters, low: null, high: null }
  const residualSquares = [...clusterResiduals.values()].reduce((sum, value) => sum + value ** 2, 0)
  const variance = (clusters / (clusters - 1)) * residualSquares / (items.length ** 2)
  const margin = 1.96 * Math.sqrt(variance)
  return {
    method: 'game-cluster-robust-normal',
    clusters,
    low: round(improvement - margin),
    high: round(improvement + margin),
  }
}

export function scoreAiHrForecasts(items) {
  if (!Array.isArray(items) || !items.length) return null
  const valid = items.every((item) => (
    [item?.baseline, item?.shadow].every((value) => Number.isFinite(value) && value > 0 && value < 1) &&
    (item.outcome === 0 || item.outcome === 1)
  ))
  if (!valid) throw new Error('AI HR evaluation rows require baseline/shadow probabilities in (0,1) and binary outcomes')

  const baseline = forecastMetrics(items, 'baseline')
  const shadow = forecastMetrics(items, 'shadow')
  const brierImprovement = round(baseline.brier - shadow.brier)
  return {
    sampleSize: items.length,
    homers: items.reduce((sum, item) => sum + item.outcome, 0),
    observedRate: round(mean(items.map((item) => item.outcome))),
    baseline,
    shadow,
    comparison: {
      brierImprovement,
      logLossImprovement: round(baseline.logLoss - shadow.logLoss),
      eceImprovement: round(baseline.ece - shadow.ece),
      pairedBrier95CI: pairedBrierConfidenceInterval(items, brierImprovement),
    },
  }
}

function groupMetrics(settled, keyForItem) {
  const groups = new Map()
  for (const item of settled) {
    const keys = [...new Set(keyForItem(item).filter(Boolean))]
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    }
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, items]) => [key, scoreAiHrForecasts(items)]))
}

export function evaluateAiHrPromotionGate(overall, coverage, requirements = AI_HR_PROMOTION_REQUIREMENTS) {
  const settledRecords = Number.isInteger(coverage?.settledRecords) ? coverage.settledRecords : 0
  const settledGames = Number.isInteger(coverage?.settledGames) ? coverage.settledGames : 0
  const settledDates = Number.isInteger(coverage?.settledDates) ? coverage.settledDates : 0
  const checks = {
    settledRecords: settledRecords >= requirements.minSettledRecords,
    homerEvents: (overall?.homers || 0) >= requirements.minHomers,
    settledGames: settledGames >= requirements.minSettledGames,
    settledDates: settledDates >= requirements.minSettledDates,
    brierConfidence: Number.isFinite(overall?.comparison?.pairedBrier95CI?.low) && overall.comparison.pairedBrier95CI.low > 0,
    logLoss: (overall?.comparison?.logLossImprovement ?? -Infinity) >= 0,
    calibration: Number.isFinite(overall?.shadow?.ece) && Number.isFinite(overall?.baseline?.ece) && overall.shadow.ece <= overall.baseline.ece + requirements.maxEceRegression,
  }
  const mature = checks.settledRecords && checks.homerEvents && checks.settledGames && checks.settledDates
  const passed = Object.values(checks).every(Boolean)
  const reasons = []
  if (!checks.settledRecords) reasons.push(`need ${requirements.minSettledRecords} settled records; have ${settledRecords}`)
  if (!checks.homerEvents) reasons.push(`need ${requirements.minHomers} HR outcomes; have ${overall?.homers || 0}`)
  if (!checks.settledGames) reasons.push(`need ${requirements.minSettledGames} settled games; have ${settledGames}`)
  if (!checks.settledDates) reasons.push(`need ${requirements.minSettledDates} settled dates; have ${settledDates}`)
  if (mature && !checks.brierConfidence) reasons.push('paired Brier improvement is not positive at the 95% confidence bound')
  if (mature && !checks.logLoss) reasons.push('shadow log loss does not beat baseline')
  if (mature && !checks.calibration) reasons.push(`shadow ECE regresses by more than ${requirements.maxEceRegression}`)
  return {
    status: passed ? 'eligible-for-review' : mature ? 'hold' : 'collecting',
    passed,
    autoPromotion: false,
    requirements: { ...requirements },
    checks,
    reasons,
  }
}

function backtestDates(backtestLog) {
  return [...new Set([
    ...Object.keys(backtestLog?.modelHistory?.records || {}),
    ...Object.keys(backtestLog?.records || {}),
  ].filter(validDate))].sort()
}

export function buildAiHrEvaluation({ ledger, backtestLog, generatedAt = new Date().toISOString(), requirements }) {
  assertValidAiHrShadowLedger(ledger)
  if (!validIso(generatedAt)) throw new Error('generatedAt must be an ISO timestamp')
  const { settled, coverage } = settleAiHrShadowRecords(ledger, backtestLog)
  const overall = scoreAiHrForecasts(settled)
  const outcomeDates = backtestDates(backtestLog)
  const netDirection = (item) => [item.record.shadowLogitDelta > 0 ? 'boost' : item.record.shadowLogitDelta < 0 ? 'suppress' : 'neutral']
  return {
    version: AI_HR_EVALUATION_VERSION,
    mode: AI_HR_EVALUATION_MODE,
    scoreImpact: false,
    autoPromotion: false,
    generatedAt: new Date(generatedAt).toISOString(),
    source: {
      shadowVersion: AI_HR_SHADOW_VERSION,
      shadowUpdatedAt: ledger.updatedAt,
      outcomeDates: outcomeDates.length,
      latestOutcomeDate: outcomeDates.at(-1) || null,
    },
    coverage,
    overall,
    segments: {
      grouping: 'records; kind and entity-type groups may overlap',
      byNetDirection: groupMetrics(settled, netDirection),
      byKind: groupMetrics(settled, (item) => item.record.appliedSignals.map((signal) => signal.kind)),
      byEntityType: groupMetrics(settled, (item) => item.record.appliedSignals.map((signal) => signal.entityType)),
    },
    gate: evaluateAiHrPromotionGate(overall, coverage, requirements),
  }
}

function validateForecastMetrics(metrics, at, errors) {
  if (!isObject(metrics)) {
    errors.push(`${at}: expected an object`)
    return
  }
  if (!Number.isInteger(metrics.sampleSize) || metrics.sampleSize < 1) errors.push(`${at}.sampleSize: expected a positive integer`)
  if (!Number.isInteger(metrics.homers) || metrics.homers < 0 || metrics.homers > metrics.sampleSize) errors.push(`${at}.homers: invalid count`)
  for (const field of ['observedRate']) if (!Number.isFinite(metrics[field]) || metrics[field] < 0 || metrics[field] > 1) errors.push(`${at}.${field}: expected [0,1]`)
  if (Number.isInteger(metrics.homers) && Number.isInteger(metrics.sampleSize) && metrics.sampleSize > 0 && Number.isFinite(metrics.observedRate) && Math.abs(metrics.homers / metrics.sampleSize - metrics.observedRate) > 1e-9) errors.push(`${at}.observedRate: does not reconcile with outcomes`)
  for (const forecast of ['baseline', 'shadow']) {
    const block = metrics[forecast]
    if (!isObject(block)) {
      errors.push(`${at}.${forecast}: expected an object`)
      continue
    }
    for (const field of ['meanProbability', 'brier', 'ece']) {
      if (!Number.isFinite(block[field]) || block[field] < 0 || block[field] > 1) errors.push(`${at}.${forecast}.${field}: expected [0,1]`)
    }
    if (!Number.isFinite(block.logLoss) || block.logLoss < 0) errors.push(`${at}.${forecast}.logLoss: expected a non-negative number`)
    if (!Array.isArray(block.calibrationBins)) {
      errors.push(`${at}.${forecast}.calibrationBins: expected an array`)
      continue
    }
    const binSamples = block.calibrationBins.reduce((sum, bin) => sum + (Number.isInteger(bin?.sampleSize) ? bin.sampleSize : 0), 0)
    if (binSamples !== metrics.sampleSize) errors.push(`${at}.${forecast}.calibrationBins: samples do not reconcile`)
    for (let index = 0; index < block.calibrationBins.length; index++) {
      const bin = block.calibrationBins[index]
      const binAt = `${at}.${forecast}.calibrationBins[${index}]`
      if (!isObject(bin)) {
        errors.push(`${binAt}: expected an object`)
        continue
      }
      if (!Number.isFinite(bin.lower) || !Number.isFinite(bin.upper) || bin.lower < 0 || bin.upper > 1 || bin.lower >= bin.upper) errors.push(`${binAt}: invalid probability bounds`)
      if (!Number.isInteger(bin?.sampleSize) || bin.sampleSize < 1) errors.push(`${binAt}.sampleSize: expected a positive integer`)
      if (!Number.isFinite(bin?.meanProbability) || bin.meanProbability < bin.lower || bin.meanProbability > bin.upper) errors.push(`${binAt}.meanProbability: outside bin`)
      if (!Number.isFinite(bin?.observedRate) || bin.observedRate < 0 || bin.observedRate > 1) errors.push(`${binAt}.observedRate: expected [0,1]`)
      if (!Number.isFinite(bin?.absoluteGap) || Math.abs(Math.abs(bin.meanProbability - bin.observedRate) - bin.absoluteGap) > 1e-9) errors.push(`${binAt}.absoluteGap: does not reconcile`)
    }
    if (Number.isFinite(block.ece) && metrics.sampleSize > 0) {
      const expectedEce = block.calibrationBins.reduce((sum, bin) => sum + (Number(bin?.absoluteGap) || 0) * (Number(bin?.sampleSize) || 0), 0) / metrics.sampleSize
      if (Math.abs(expectedEce - block.ece) > 1e-9) errors.push(`${at}.${forecast}.ece: does not reconcile with bins`)
    }
  }
  const comparison = metrics.comparison
  if (!isObject(comparison)) {
    errors.push(`${at}.comparison: expected an object`)
    return
  }
  for (const field of ['brierImprovement', 'logLossImprovement', 'eceImprovement']) {
    if (!Number.isFinite(comparison[field])) errors.push(`${at}.comparison.${field}: expected a finite number`)
  }
  if (Number.isFinite(metrics.baseline?.brier) && Number.isFinite(metrics.shadow?.brier) && Number.isFinite(comparison.brierImprovement) && Math.abs((metrics.baseline.brier - metrics.shadow.brier) - comparison.brierImprovement) > 1e-9) errors.push(`${at}.comparison.brierImprovement: does not reconcile`)
  if (Number.isFinite(metrics.baseline?.logLoss) && Number.isFinite(metrics.shadow?.logLoss) && Number.isFinite(comparison.logLossImprovement) && Math.abs((metrics.baseline.logLoss - metrics.shadow.logLoss) - comparison.logLossImprovement) > 1e-9) errors.push(`${at}.comparison.logLossImprovement: does not reconcile`)
  if (Number.isFinite(metrics.baseline?.ece) && Number.isFinite(metrics.shadow?.ece) && Number.isFinite(comparison.eceImprovement) && Math.abs((metrics.baseline.ece - metrics.shadow.ece) - comparison.eceImprovement) > 1e-9) errors.push(`${at}.comparison.eceImprovement: does not reconcile`)
  const interval = comparison.pairedBrier95CI
  if (!isObject(interval) || interval.method !== 'game-cluster-robust-normal' || !Number.isInteger(interval.clusters) || interval.clusters < 1) errors.push(`${at}.comparison.pairedBrier95CI: invalid cluster metadata`)
  else if (interval.clusters < 2) {
    if (interval.low !== null || interval.high !== null) errors.push(`${at}.comparison.pairedBrier95CI: one cluster cannot produce an interval`)
  } else if (!Number.isFinite(interval.low) || !Number.isFinite(interval.high) || interval.low > comparison.brierImprovement || interval.high < comparison.brierImprovement) errors.push(`${at}.comparison.pairedBrier95CI: invalid interval`)
}

export function validateAiHrEvaluation(report) {
  const errors = []
  const warnings = []
  if (!isObject(report)) return { ok: false, errors: ['report: expected an object'], warnings, metrics: {} }
  if (report.version !== AI_HR_EVALUATION_VERSION) errors.push(`version: expected ${AI_HR_EVALUATION_VERSION}`)
  if (report.mode !== AI_HR_EVALUATION_MODE) errors.push(`mode: expected ${AI_HR_EVALUATION_MODE}`)
  if (report.scoreImpact !== false || report.autoPromotion !== false) errors.push('production controls: scoreImpact and autoPromotion must both be false')
  if (!validIso(report.generatedAt)) errors.push('generatedAt: expected an ISO timestamp')
  if (
    !isObject(report.source) || report.source.shadowVersion !== AI_HR_SHADOW_VERSION ||
    !validIso(report.source.shadowUpdatedAt) || !Number.isInteger(report.source.outcomeDates) || report.source.outcomeDates < 0 ||
    (report.source.latestOutcomeDate != null && !validDate(report.source.latestOutcomeDate))
  ) errors.push('source: invalid shadow ledger or outcome metadata')

  const coverage = report.coverage
  const coverageFields = ['shadowRecords', 'settledRecords', 'pendingRecords', 'scratches', 'settledGames', 'settledDates']
  if (!isObject(coverage) || coverageFields.some((field) => !Number.isInteger(coverage?.[field]) || coverage[field] < 0)) errors.push('coverage: counts must be non-negative integers')
  else {
    if (coverage.settledRecords + coverage.pendingRecords + coverage.scratches !== coverage.shadowRecords) errors.push('coverage: settled, pending, and scratches do not reconcile with shadow records')
    if (coverage.settledGames > coverage.settledRecords || coverage.settledDates > coverage.settledGames) errors.push('coverage: settled date/game counts exceed settled records')
  }
  if (coverage?.firstSettledDate != null && !validDate(coverage.firstSettledDate)) errors.push('coverage.firstSettledDate: expected a date or null')
  if (coverage?.lastSettledDate != null && !validDate(coverage.lastSettledDate)) errors.push('coverage.lastSettledDate: expected a date or null')

  if (coverage?.settledRecords === 0) {
    if (report.overall !== null) errors.push('overall: must be null with no settled records')
    else warnings.push('overall: no settled AI HR projections yet')
  } else {
    validateForecastMetrics(report.overall, 'overall', errors)
    if (report.overall?.sampleSize !== coverage.settledRecords) errors.push('overall.sampleSize: does not match coverage')
  }

  if (!isObject(report.segments) || report.segments.grouping !== 'records; kind and entity-type groups may overlap') errors.push('segments: expected the versioned overlapping-record grouping')
  for (const groupName of ['byNetDirection', 'byKind', 'byEntityType']) {
    const group = report.segments?.[groupName]
    if (!isObject(group)) {
      errors.push(`segments.${groupName}: expected an object`)
      continue
    }
    for (const [key, metrics] of Object.entries(group)) {
      validateForecastMetrics(metrics, `segments.${groupName}.${key}`, errors)
      if (Number.isInteger(metrics?.sampleSize) && metrics.sampleSize > (coverage?.settledRecords || 0)) errors.push(`segments.${groupName}.${key}.sampleSize: exceeds settled coverage`)
    }
  }

  const gate = report.gate
  if (!isObject(gate) || gate.autoPromotion !== false || typeof gate.passed !== 'boolean' || !['collecting', 'hold', 'eligible-for-review'].includes(gate.status)) errors.push('gate: invalid promotion control')
  else {
    const checks = Object.values(gate.checks || {})
    if (checks.length !== 7 || checks.some((value) => typeof value !== 'boolean')) errors.push('gate.checks: expected seven boolean checks')
    if (gate.passed !== checks.every(Boolean)) errors.push('gate.passed: does not reconcile with checks')
    if (gate.passed && gate.status !== 'eligible-for-review') errors.push('gate.status: a passing gate must be eligible-for-review')
    if (!Array.isArray(gate.reasons)) errors.push('gate.reasons: expected an array')
    const expectedGate = evaluateAiHrPromotionGate(report.overall, coverage || {}, AI_HR_PROMOTION_REQUIREMENTS)
    if (JSON.stringify(gate.requirements) !== JSON.stringify(AI_HR_PROMOTION_REQUIREMENTS) || JSON.stringify(gate) !== JSON.stringify(expectedGate)) errors.push('gate: does not reconcile with versioned requirements and report metrics')
  }
  if (report.gate?.passed) warnings.push('gate: eligible for human review; automatic production promotion remains disabled')
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      settled: coverage?.settledRecords || 0,
      pending: coverage?.pendingRecords || 0,
      brierImprovement: report.overall?.comparison?.brierImprovement ?? null,
      gateStatus: report.gate?.status || null,
    },
  }
}

export function assertValidAiHrEvaluation(report) {
  const result = validateAiHrEvaluation(report)
  if (result.ok) return result
  throw new Error(`AI HR evaluation failed validation:\n- ${result.errors.join('\n- ')}`)
}
