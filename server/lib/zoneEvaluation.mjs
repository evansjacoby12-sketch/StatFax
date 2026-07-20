import {
  ZONE_POWER_MAX_LOGIT_DELTA,
  ZONE_POWER_MIN_HARD_HIT_PCT,
  ZONE_POWER_VERSION,
  zonePowerQualification,
} from './zonePowerInflation.mjs'

export const ZONE_EVIDENCE_ARCHIVE_VERSION = 1
export const ZONE_SHADOW_VERSION = 1
export const ZONE_EVALUATION_VERSION = 2

export const ZONE_PROMOTION_REQUIREMENTS = Object.freeze({
  minSettledRecords: 400,
  minQualifiedRecords: 80,
  minQualifiedHomers: 15,
  minSettledGames: 40,
  minSettledDates: 14,
  minScoreMatchedRecords: 60,
  maxEceRegression: 0.002,
})

const CALIBRATION_EDGES = Object.freeze([0, 0.05, 0.1, 0.15, 0.2, 0.3, 1])
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const round = (value, digits = 12) => Number(Number(value).toFixed(digits))
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))
const clampProbability = (value) => clamp(Number(value), 1e-9, 1 - 1e-9)
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null

export function applyZoneShadowDelta(probability, logitDelta) {
  if (!finite(probability) || Number(probability) <= 0 || Number(probability) >= 1) return null
  const probabilityN = clampProbability(probability)
  const logit = Math.log(probabilityN / (1 - probabilityN))
  return round(1 / (1 + Math.exp(-(logit + Number(logitDelta)))), 6)
}

/** Fixed, pre-registered location delta; production also requires hard-hit contact. */
export function zoneShadowLogitDelta(zoneMatchup) {
  if (
    (zoneMatchup?.modelVersion ?? 0) < 2 ||
    zoneMatchup?.advisoryOnly !== true ||
    zoneMatchup?.reliability?.status === 'limited'
  ) return 0
  const attacks = clamp(Math.trunc(Number(zoneMatchup?.attackZones?.length) || 0), 0, 3)
  if (attacks === 0) return 0
  const rating = finite(zoneMatchup?.zoneRating) ? Number(zoneMatchup.zoneRating) : 5
  const ratingTilt = clamp((rating - 5) * 0.012, -0.03, 0.04)
  return round(clamp(attacks * 0.06 + ratingTilt, 0, 0.2), 6)
}

/** Compact evidence frozen before outcomes are known. */
export function buildZoneEvidenceArchive(zoneMatchup, baselineProbability) {
  if ((zoneMatchup?.modelVersion ?? 0) < 2 || zoneMatchup?.advisoryOnly !== true) return null
  const attackCount = clamp(Math.trunc(Number(zoneMatchup?.attackZones?.length) || 0), 0, 3)
  const chaseCount = clamp(Math.trunc(Number(zoneMatchup?.chaseZones?.length) || 0), 0, 2)
  const reliability = ['high', 'medium', 'limited'].includes(zoneMatchup?.reliability?.status)
    ? zoneMatchup.reliability.status
    : 'limited'
  const shadowLogitDelta = zoneShadowLogitDelta(zoneMatchup)
  return {
    version: ZONE_EVIDENCE_ARCHIVE_VERSION,
    modelVersion: Math.trunc(zoneMatchup.modelVersion),
    advisoryOnly: true,
    attackCount,
    chaseCount,
    zoneRating: finite(zoneMatchup.zoneRating) ? round(clamp(Number(zoneMatchup.zoneRating), 0, 10), 1) : null,
    reliability,
    baselineSource: typeof zoneMatchup?.locationBaseline?.source === 'string'
      ? zoneMatchup.locationBaseline.source.slice(0, 40)
      : 'unknown',
    baselineSamplePitches: Math.max(0, Math.trunc(Number(zoneMatchup?.locationBaseline?.samplePitches) || 0)),
    shadowVersion: ZONE_SHADOW_VERSION,
    shadowLogitDelta,
    shadowProbability: applyZoneShadowDelta(baselineProbability, shadowLogitDelta),
  }
}

function recordKey(date, row) {
  return `${date}:${Number(row?.gamePk)}:${Number(row?.playerId)}`
}

/** Operational rows overwrite model history so late outcome repairs win. */
export function collectZoneEvaluationRows(backtestLog) {
  const merged = new Map()
  for (const recordsByDate of [backtestLog?.modelHistory?.records, backtestLog?.records]) {
    for (const [date, rows] of Object.entries(recordsByDate || {})) {
      if (!validDate(date) || !Array.isArray(rows)) continue
      for (const row of rows) {
        if (!finite(row?.playerId) || !finite(row?.gamePk)) continue
        merged.set(recordKey(date, row), { date, row })
      }
    }
  }
  return [...merged.values()].sort((left, right) => (
    left.date.localeCompare(right.date) || Number(left.row.gamePk) - Number(right.row.gamePk) || Number(left.row.playerId) - Number(right.row.playerId)
  ))
}

function calibrationBins(items, field) {
  const bins = []
  for (let index = 0; index < CALIBRATION_EDGES.length - 1; index++) {
    const lower = CALIBRATION_EDGES[index]
    const upper = CALIBRATION_EDGES[index + 1]
    const members = items.filter((item) => item[field] >= lower && (index === CALIBRATION_EDGES.length - 2 ? item[field] <= upper : item[field] < upper))
    if (!members.length) continue
    const meanProbability = mean(members.map((item) => item[field]))
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

function forecastBlock(items, field) {
  const bins = calibrationBins(items, field)
  return {
    meanProbability: round(mean(items.map((item) => item[field]))),
    brier: round(mean(items.map((item) => (item[field] - item.outcome) ** 2))),
    logLoss: round(mean(items.map((item) => {
      const probability = clampProbability(item[field])
      return -(item.outcome * Math.log(probability) + (1 - item.outcome) * Math.log(1 - probability))
    }))),
    ece: round(bins.reduce((sum, bin) => sum + bin.absoluteGap * bin.sampleSize, 0) / items.length),
    calibrationBins: bins,
  }
}

function pairedBrierInterval(items, improvement) {
  const clusters = new Map()
  items.forEach((item, index) => {
    const difference = (item.baseline - item.outcome) ** 2 - (item.shadow - item.outcome) ** 2
    const key = item.gamePk != null ? `${item.date}:${item.gamePk}` : `row:${index}`
    clusters.set(key, (clusters.get(key) || 0) + difference - improvement)
  })
  if (clusters.size < 2) return { method: 'game-cluster-robust-normal', clusters: clusters.size, low: null, high: null }
  const residualSquares = [...clusters.values()].reduce((sum, value) => sum + value ** 2, 0)
  const variance = (clusters.size / (clusters.size - 1)) * residualSquares / (items.length ** 2)
  const margin = 1.96 * Math.sqrt(variance)
  return {
    method: 'game-cluster-robust-normal',
    clusters: clusters.size,
    low: round(improvement - margin),
    high: round(improvement + margin),
  }
}

export function scoreZoneShadow(items) {
  if (!items.length) return null
  const baseline = forecastBlock(items, 'baseline')
  const shadow = forecastBlock(items, 'shadow')
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
      pairedBrier95CI: pairedBrierInterval(items, brierImprovement),
    },
  }
}

function outcomeSummary(items) {
  if (!items.length) return null
  const homers = items.reduce((sum, item) => sum + item.outcome, 0)
  const expectedHomers = items.reduce((sum, item) => sum + item.baseline, 0)
  return {
    sampleSize: items.length,
    homers,
    observedRate: round(homers / items.length),
    meanBaselineProbability: round(expectedHomers / items.length),
    expectedHomers: round(expectedHomers),
    liftVsBaseline: expectedHomers > 0 ? round(homers / expectedHomers) : null,
  }
}

function groupedSummaries(items, keyForItem) {
  const groups = new Map()
  for (const item of items) {
    const key = keyForItem(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return Object.fromEntries([...groups.entries()].sort(([a], [b]) => String(a).localeCompare(String(b))).map(([key, members]) => [key, outcomeSummary(members)]))
}

function scoreBand(row) {
  const score = clamp(Math.floor((Number(row?.score) || 0) / 5) * 5, 0, 95)
  return `${score}-${score + 4}`
}

export function scoreMatchedZoneLift(items) {
  const bands = new Map()
  for (const item of items) {
    if (item.evidence.reliability === 'limited') continue
    const hardHitPct = Number(item.row?.hardHitPct ?? item.row?.feat?.hh)
    if (!Number.isFinite(hardHitPct) || hardHitPct < ZONE_POWER_MIN_HARD_HIT_PCT) continue
    const band = scoreBand(item.row)
    if (!bands.has(band)) bands.set(band, { qualified: [], controls: [] })
    bands.get(band)[item.evidence.attackCount > 0 ? 'qualified' : 'controls'].push(item)
  }
  let qualifiedRecords = 0
  let controlRecords = 0
  let observedHomers = 0
  let expectedControlHomers = 0
  const byScoreBand = {}
  for (const [band, group] of [...bands.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (!group.qualified.length || !group.controls.length) continue
    const qualified = outcomeSummary(group.qualified)
    const controls = outcomeSummary(group.controls)
    const expected = qualified.sampleSize * controls.observedRate
    qualifiedRecords += qualified.sampleSize
    controlRecords += controls.sampleSize
    observedHomers += qualified.homers
    expectedControlHomers += expected
    byScoreBand[band] = {
      qualified,
      controls,
      expectedControlHomers: round(expected),
      observedVsControlLift: expected > 0 ? round(qualified.homers / expected) : null,
    }
  }
  if (!qualifiedRecords) return null
  return {
    method: 'five-point-score-band-standardization',
    qualifiedRecords,
    controlRecords,
    observedHomers,
    expectedControlHomers: round(expectedControlHomers),
    observedVsControlLift: expectedControlHomers > 0 ? round(observedHomers / expectedControlHomers) : null,
    byScoreBand,
  }
}

export function evaluateZonePromotionGate(performance, coverage, scoreMatched, requirements = ZONE_PROMOTION_REQUIREMENTS) {
  const checks = {
    settledRecords: coverage.settledRecords >= requirements.minSettledRecords,
    qualifiedRecords: coverage.qualifiedRecords >= requirements.minQualifiedRecords,
    qualifiedHomers: coverage.qualifiedHomers >= requirements.minQualifiedHomers,
    settledGames: coverage.settledGames >= requirements.minSettledGames,
    settledDates: coverage.settledDates >= requirements.minSettledDates,
    scoreMatchedRecords: (scoreMatched?.qualifiedRecords || 0) >= requirements.minScoreMatchedRecords,
    matchedLift: Number.isFinite(scoreMatched?.observedVsControlLift) && scoreMatched.observedVsControlLift > 1,
    brierConfidence: Number.isFinite(performance?.comparison?.pairedBrier95CI?.low) && performance.comparison.pairedBrier95CI.low > 0,
    logLoss: (performance?.comparison?.logLossImprovement ?? -Infinity) > 0,
    calibration: Number.isFinite(performance?.shadow?.ece) && Number.isFinite(performance?.baseline?.ece) && performance.shadow.ece <= performance.baseline.ece + requirements.maxEceRegression,
  }
  const mature = checks.settledRecords && checks.qualifiedRecords && checks.qualifiedHomers && checks.settledGames && checks.settledDates && checks.scoreMatchedRecords
  const passed = Object.values(checks).every(Boolean)
  const reasons = []
  if (!checks.settledRecords) reasons.push(`need ${requirements.minSettledRecords} settled v2 rows; have ${coverage.settledRecords}`)
  if (!checks.qualifiedRecords) reasons.push(`need ${requirements.minQualifiedRecords} qualified attacks; have ${coverage.qualifiedRecords}`)
  if (!checks.qualifiedHomers) reasons.push(`need ${requirements.minQualifiedHomers} HR outcomes in qualified attacks; have ${coverage.qualifiedHomers}`)
  if (!checks.settledGames) reasons.push(`need ${requirements.minSettledGames} settled games; have ${coverage.settledGames}`)
  if (!checks.settledDates) reasons.push(`need ${requirements.minSettledDates} settled dates; have ${coverage.settledDates}`)
  if (!checks.scoreMatchedRecords) reasons.push(`need ${requirements.minScoreMatchedRecords} score-matched attack rows; have ${scoreMatched?.qualifiedRecords || 0}`)
  if (checks.scoreMatchedRecords && !checks.matchedLift) reasons.push('current qualified attacks do not beat same-score no-attack controls')
  if (mature && !checks.brierConfidence) reasons.push('shadow Brier improvement is not positive at the 95% confidence bound')
  if (mature && !checks.logLoss) reasons.push('shadow log loss does not beat baseline')
  if (mature && !checks.calibration) reasons.push(`shadow ECE regresses by more than ${requirements.maxEceRegression}`)
  return {
    status: passed ? 'eligible-for-review' : mature ? 'hold' : 'collecting',
    passed,
    autoPromotion: false,
    productionImpact: true,
    requirements: { ...requirements },
    checks,
    reasons,
  }
}

export function buildZoneEvaluation({ backtestLog = {}, generatedAt = new Date().toISOString(), requirements } = {}) {
  if (!validIso(generatedAt)) throw new Error('generatedAt must be an ISO timestamp')
  const allRows = collectZoneEvaluationRows(backtestLog)
  const legacy = []
  const archived = []
  for (const item of allRows) {
    if (!item.row?.zoneEvidence && item.row?.badges?.includes('zoneMaster') && item.row.actuallyPlayed !== false) legacy.push({ ...item, outcome: item.row.homered ? 1 : 0 })
    if (item.row?.zoneEvidence?.version === ZONE_EVIDENCE_ARCHIVE_VERSION) archived.push(item)
  }
  const settled = archived.filter((item) => item.row.actuallyPlayed !== false && typeof item.row.homered === 'boolean')
  const scratches = archived.length - settled.length
  const scorable = settled
    .filter((item) => finite(item.row.simHRProb) && finite(item.row.zoneEvidence?.shadowProbability))
    .map((item) => ({
      ...item,
      evidence: item.row.zoneEvidence,
      outcome: item.row.homered ? 1 : 0,
      baseline: Number(item.row.simHRProb),
      shadow: Number(item.row.zoneEvidence.shadowProbability),
      gamePk: item.row.gamePk,
    }))
  const qualified = scorable.filter((item) => zonePowerQualification(item.row).qualified)
  const dates = [...new Set(settled.map((item) => item.date))].sort()
  const coverage = {
    archivedRecords: archived.length,
    settledRecords: settled.length,
    scratches,
    scorableRecords: scorable.length,
    unscorableRecords: settled.length - scorable.length,
    reliableRecords: scorable.filter((item) => item.evidence.reliability !== 'limited').length,
    qualifiedRecords: qualified.length,
    qualifiedHomers: qualified.reduce((sum, item) => sum + item.outcome, 0),
    settledGames: new Set(settled.map((item) => `${item.date}:${item.row.gamePk}`)).size,
    settledDates: dates.length,
    firstSettledDate: dates[0] || null,
    lastSettledDate: dates.at(-1) || null,
    legacyBadgeRecords: legacy.length,
  }
  const performance = scoreZoneShadow(qualified)
  const scoreMatched = scoreMatchedZoneLift(scorable)
  return {
    version: ZONE_EVALUATION_VERSION,
    mode: 'production-monitoring',
    scoreImpact: false,
    probabilityImpact: true,
    autoPromotion: false,
    generatedAt: new Date(generatedAt).toISOString(),
    hypothesis: {
      shadowVersion: ZONE_SHADOW_VERSION,
      productionVersion: ZONE_POWER_VERSION,
      description: `Reliable verified attacks combined with at least ${ZONE_POWER_MIN_HARD_HIT_PCT}% hard-hit contact receive a fixed capped log-odds probability adjustment; score and grade remain unchanged.`,
      minHardHitPct: ZONE_POWER_MIN_HARD_HIT_PCT,
      maxLogitDelta: ZONE_POWER_MAX_LOGIT_DELTA,
      productionApplied: true,
    },
    coverage,
    performance,
    scoreMatched,
    segments: {
      byAttackCount: groupedSummaries(scorable, (item) => String(item.evidence.attackCount)),
      byReliability: groupedSummaries(scorable, (item) => item.evidence.reliability),
      byScoreBand: groupedSummaries(scorable, (item) => scoreBand(item.row)),
    },
    legacyReference: {
      promotionEligible: false,
      reason: 'Legacy Zone Master rows predate the v2 cell evidence contract and are descriptive only.',
      metrics: legacy.length ? {
        sampleSize: legacy.length,
        homers: legacy.reduce((sum, item) => sum + item.outcome, 0),
        observedRate: round(mean(legacy.map((item) => item.outcome))),
      } : null,
    },
    gate: evaluateZonePromotionGate(performance, coverage, scoreMatched, requirements),
  }
}

export function validateZoneEvidenceArchive(evidence, baselineProbability, at = 'zoneEvidence') {
  const errors = []
  if (!isObject(evidence)) return [`${at}: expected an object`]
  if (evidence.version !== ZONE_EVIDENCE_ARCHIVE_VERSION) errors.push(`${at}.version: expected ${ZONE_EVIDENCE_ARCHIVE_VERSION}`)
  if (!Number.isInteger(evidence.modelVersion) || evidence.modelVersion < 2) errors.push(`${at}.modelVersion: expected 2+`)
  if (evidence.advisoryOnly !== true) errors.push(`${at}.advisoryOnly: must be true`)
  if (!Number.isInteger(evidence.attackCount) || evidence.attackCount < 0 || evidence.attackCount > 3) errors.push(`${at}.attackCount: expected 0..3`)
  if (!Number.isInteger(evidence.chaseCount) || evidence.chaseCount < 0 || evidence.chaseCount > 2) errors.push(`${at}.chaseCount: expected 0..2`)
  if (evidence.zoneRating != null && (!finite(evidence.zoneRating) || evidence.zoneRating < 0 || evidence.zoneRating > 10)) errors.push(`${at}.zoneRating: expected null or 0..10`)
  if (!['high', 'medium', 'limited'].includes(evidence.reliability)) errors.push(`${at}.reliability: unsupported`)
  if (typeof evidence.baselineSource !== 'string' || !evidence.baselineSource) errors.push(`${at}.baselineSource: expected a string`)
  if (!Number.isInteger(evidence.baselineSamplePitches) || evidence.baselineSamplePitches < 0) errors.push(`${at}.baselineSamplePitches: expected a non-negative integer`)
  if (evidence.shadowVersion !== ZONE_SHADOW_VERSION) errors.push(`${at}.shadowVersion: expected ${ZONE_SHADOW_VERSION}`)
  if (!finite(evidence.shadowLogitDelta) || evidence.shadowLogitDelta < 0 || evidence.shadowLogitDelta > 0.2) errors.push(`${at}.shadowLogitDelta: expected 0..0.2`)
  if ((evidence.attackCount === 0 || evidence.reliability === 'limited') && evidence.shadowLogitDelta !== 0) errors.push(`${at}.shadowLogitDelta: unqualified evidence must be neutral`)
  const expectedShadow = applyZoneShadowDelta(baselineProbability, evidence.shadowLogitDelta)
  if (expectedShadow == null ? evidence.shadowProbability !== null : Math.abs(Number(evidence.shadowProbability) - expectedShadow) > 1e-9) errors.push(`${at}.shadowProbability: does not reconcile with the fixed hypothesis`)
  return errors
}

export function validateZoneEvaluation(report, backtestLog = null) {
  const errors = []
  const warnings = []
  if (!isObject(report)) return { ok: false, errors: ['report: expected an object'], warnings, metrics: {} }
  if (report.version !== ZONE_EVALUATION_VERSION) errors.push(`version: expected ${ZONE_EVALUATION_VERSION}`)
  if (report.mode !== 'production-monitoring') errors.push('mode: unsupported')
  if (report.scoreImpact !== false || report.probabilityImpact !== true || report.autoPromotion !== false) errors.push('production controls: probability impact must be active while score impact and auto-promotion remain false')
  if (!validIso(report.generatedAt)) errors.push('generatedAt: expected an ISO timestamp')
  if (
    report.hypothesis?.productionApplied !== true ||
    report.hypothesis?.productionVersion !== ZONE_POWER_VERSION ||
    report.hypothesis?.shadowVersion !== ZONE_SHADOW_VERSION ||
    report.hypothesis?.minHardHitPct !== ZONE_POWER_MIN_HARD_HIT_PCT ||
    report.hypothesis?.maxLogitDelta !== ZONE_POWER_MAX_LOGIT_DELTA
  ) errors.push('hypothesis: invalid production controls or version')
  if (!isObject(report.coverage) || !Number.isInteger(report.coverage.settledRecords) || report.coverage.settledRecords < 0) errors.push('coverage: invalid')
  if (!isObject(report.gate) || report.gate.autoPromotion !== false || report.gate.productionImpact !== true || typeof report.gate.passed !== 'boolean') errors.push('gate: invalid production control')
  if (report.legacyReference?.promotionEligible !== false) errors.push('legacyReference: legacy evidence cannot be promotion eligible')
  if (backtestLog && validIso(report.generatedAt)) {
    const expected = buildZoneEvaluation({ backtestLog, generatedAt: report.generatedAt })
    if (JSON.stringify(report) !== JSON.stringify(expected)) errors.push('report: does not reconcile with backtest log and versioned requirements')
  }
  if (report.coverage?.settledRecords === 0) warnings.push('coverage: no settled v2 zone evidence yet')
  if (!report.gate?.passed) warnings.push(`gate: manual production probability override is active while evidence status is ${report.gate?.status || 'unknown'}`)
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      settled: report.coverage?.settledRecords || 0,
      qualified: report.coverage?.qualifiedRecords || 0,
      brierImprovement: report.performance?.comparison?.brierImprovement ?? null,
      gateStatus: report.gate?.status || null,
    },
  }
}

export function assertValidZoneEvaluation(report, backtestLog = null) {
  const validation = validateZoneEvaluation(report, backtestLog)
  if (validation.ok) return validation
  throw new Error(`Zone evaluation failed validation:\n- ${validation.errors.join('\n- ')}`)
}
