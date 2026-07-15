import {
  AI_HR_FULL_SLATE_MIN_GAMES,
  AI_HR_FULL_SLATE_MIN_ROWS,
  AI_HR_HISTORICAL_MODE,
  AI_HR_HISTORICAL_VERSION,
  assertValidAiHrHistoricalReplay,
} from './aiHrHistorical.mjs'
import {
  AI_HR_PRODUCTION_VERSION,
  aiHrProductionHypothesis,
} from './aiHrProduction.mjs'

export const AI_HR_FULL_SLATE_VALIDATION_VERSION = 1
export const AI_HR_FULL_SLATE_VALIDATION_MODE = 'historical-full-slate-validation'
export const AI_HR_FULL_SLATE_REQUIREMENTS = Object.freeze({
  minGamesPerSlate: AI_HR_FULL_SLATE_MIN_GAMES,
  minRowsPerSlate: AI_HR_FULL_SLATE_MIN_ROWS,
  minIdentityCoverage: 0.95,
  minFullSlateDates: 3,
})

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const round = (value, digits = 12) => Number(Number(value).toFixed(digits))

function dateResult(date, requirements) {
  const sourceRows = Number(date.sourceRows) || Number(date.baselineRows) || 0
  const hydratedRows = Number(date.baselineRows) || 0
  const identityCoverage = sourceRows > 0 ? round(hydratedRows / sourceRows) : 0
  const fullSlate = (
    Number(date.games) >= requirements.minGamesPerSlate &&
    sourceRows >= requirements.minRowsPerSlate &&
    identityCoverage >= requirements.minIdentityCoverage
  )
  return {
    date: date.date,
    games: Number(date.games) || 0,
    sourceRows,
    hydratedRows,
    identityCoverage,
    fullSlate,
    acceptedSignals: Number(date.signalsAccepted) || 0,
    adjustedRows: Number(date.shadowRows) || 0,
  }
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0)
}

function decisionFor(evaluation, fullSlateDates, requirements) {
  const enoughSlates = fullSlateDates >= requirements.minFullSlateDates
  const evaluationMature = evaluation.gate.status !== 'collecting'
  const performancePassed = evaluation.gate.status === 'eligible-for-review'
  const reasons = []
  if (!enoughSlates) reasons.push(`need ${requirements.minFullSlateDates} fully hydrated slates; have ${fullSlateDates}`)
  if (enoughSlates && !performancePassed) reasons.push(...evaluation.gate.reasons)
  if (enoughSlates && evaluationMature && performancePassed) reasons.push('historical production hypothesis meets the existing evaluation gate')
  return {
    status: !enoughSlates
      ? 'insufficient-slate-coverage'
      : !evaluationMature
        ? 'collecting-adjusted-outcomes'
        : performancePassed ? 'promising' : 'tune-or-remove',
    coveragePassed: enoughSlates,
    performanceMature: evaluationMature,
    performancePassed: evaluationMature ? performancePassed : null,
    productionChanged: false,
    reasons,
  }
}

export function buildAiHrFullSlateValidation({ replay, generatedAt = new Date().toISOString(), requirements = AI_HR_FULL_SLATE_REQUIREMENTS }) {
  assertValidAiHrHistoricalReplay(replay)
  if (!validIso(generatedAt)) throw new Error('full-slate validation generatedAt must be ISO')
  const appliedRequirements = { ...AI_HR_FULL_SLATE_REQUIREMENTS, ...requirements }
  const dates = replay.dates.map((date) => dateResult(date, appliedRequirements))
  const fullSlates = dates.filter((date) => date.fullSlate)
  const sourceRows = sum(dates, 'sourceRows')
  const hydratedRows = sum(dates, 'hydratedRows')
  const evaluation = replay.evaluation
  const overall = evaluation.overall

  const report = {
    version: AI_HR_FULL_SLATE_VALIDATION_VERSION,
    mode: AI_HR_FULL_SLATE_VALIDATION_MODE,
    scoreImpact: false,
    autoTuning: false,
    generatedAt: new Date(generatedAt).toISOString(),
    source: {
      replayVersion: replay.version,
      replayMode: replay.mode,
      replayGeneratedAt: replay.generatedAt,
    },
    productionHypothesis: {
      version: AI_HR_PRODUCTION_VERSION,
      ...aiHrProductionHypothesis(),
    },
    requirements: appliedRequirements,
    dates,
    coverage: {
      replayDates: dates.length,
      fullSlateDates: fullSlates.length,
      games: sum(dates, 'games'),
      sourceRows,
      hydratedRows,
      identityCoverage: sourceRows > 0 ? round(hydratedRows / sourceRows) : 0,
      acceptedSignals: sum(dates, 'acceptedSignals'),
      adjustedRows: evaluation.coverage.shadowRecords,
      settledAdjustedRows: evaluation.coverage.settledRecords,
      settledGames: evaluation.coverage.settledGames,
      settledDates: evaluation.coverage.settledDates,
    },
    performance: {
      gateStatus: evaluation.gate.status,
      homers: overall?.homers || 0,
      brierImprovement: overall?.comparison?.brierImprovement ?? null,
      brier95CI: overall?.comparison?.pairedBrier95CI ?? null,
      logLossImprovement: overall?.comparison?.logLossImprovement ?? null,
      eceImprovement: overall?.comparison?.eceImprovement ?? null,
    },
    decision: decisionFor(evaluation, fullSlates.length, appliedRequirements),
  }
  assertValidAiHrFullSlateValidation(report, replay)
  return report
}

export function validateAiHrFullSlateValidation(report, replay = null) {
  const errors = []
  const warnings = []
  if (!isObject(report)) return { ok: false, errors: ['report: expected an object'], warnings, metrics: {} }
  if (report.version !== AI_HR_FULL_SLATE_VALIDATION_VERSION) errors.push(`version: expected ${AI_HR_FULL_SLATE_VALIDATION_VERSION}`)
  if (report.mode !== AI_HR_FULL_SLATE_VALIDATION_MODE) errors.push(`mode: expected ${AI_HR_FULL_SLATE_VALIDATION_MODE}`)
  if (report.scoreImpact !== false || report.autoTuning !== false || report.decision?.productionChanged !== false) errors.push('controls: validation cannot change scoring or tune automatically')
  if (!validIso(report.generatedAt) || !validIso(report.source?.replayGeneratedAt)) errors.push('timestamps: expected ISO values')
  if (report.source?.replayVersion !== AI_HR_HISTORICAL_VERSION || report.source?.replayMode !== AI_HR_HISTORICAL_MODE) errors.push('source: historical replay version/mode mismatch')
  const expectedHypothesis = { version: AI_HR_PRODUCTION_VERSION, ...aiHrProductionHypothesis() }
  if (JSON.stringify(report.productionHypothesis) !== JSON.stringify(expectedHypothesis)) errors.push('productionHypothesis: does not match the deployed production overlay')
  if (
    !Number.isInteger(report.requirements?.minGamesPerSlate) || report.requirements.minGamesPerSlate < 1 ||
    !Number.isInteger(report.requirements?.minRowsPerSlate) || report.requirements.minRowsPerSlate < 1 ||
    !Number.isFinite(report.requirements?.minIdentityCoverage) || report.requirements.minIdentityCoverage <= 0 || report.requirements.minIdentityCoverage > 1 ||
    !Number.isInteger(report.requirements?.minFullSlateDates) || report.requirements.minFullSlateDates < 1
  ) errors.push('requirements: invalid full-slate thresholds')
  if (!Array.isArray(report.dates)) errors.push('dates: expected an array')

  const dates = Array.isArray(report.dates) ? report.dates : []
  for (let index = 0; index < dates.length; index++) {
    const date = dates[index]
    const expectedCoverage = date.sourceRows > 0 ? round(date.hydratedRows / date.sourceRows) : 0
    if (Math.abs(Number(date.identityCoverage) - expectedCoverage) > 1e-9) errors.push(`dates[${index}].identityCoverage: does not reconcile`)
    const expectedFullSlate = (
      date.games >= report.requirements?.minGamesPerSlate &&
      date.sourceRows >= report.requirements?.minRowsPerSlate &&
      date.identityCoverage >= report.requirements?.minIdentityCoverage
    )
    if (date.fullSlate !== expectedFullSlate) errors.push(`dates[${index}].fullSlate: does not reconcile`)
  }
  const expected = {
    replayDates: dates.length,
    fullSlateDates: dates.filter((date) => date.fullSlate).length,
    games: sum(dates, 'games'),
    sourceRows: sum(dates, 'sourceRows'),
    hydratedRows: sum(dates, 'hydratedRows'),
    acceptedSignals: sum(dates, 'acceptedSignals'),
  }
  for (const [field, value] of Object.entries(expected)) if (report.coverage?.[field] !== value) errors.push(`coverage.${field}: does not reconcile`)
  const expectedIdentity = expected.sourceRows > 0 ? round(expected.hydratedRows / expected.sourceRows) : 0
  if (Math.abs(Number(report.coverage?.identityCoverage) - expectedIdentity) > 1e-9) errors.push('coverage.identityCoverage: does not reconcile')
  const coveragePassed = expected.fullSlateDates >= Number(report.requirements?.minFullSlateDates)
  if (report.decision?.coveragePassed !== coveragePassed) errors.push('decision.coveragePassed: does not reconcile')
  if (!['insufficient-slate-coverage', 'collecting-adjusted-outcomes', 'promising', 'tune-or-remove'].includes(report.decision?.status)) errors.push('decision.status: invalid')

  if (replay) {
    try { assertValidAiHrHistoricalReplay(replay) } catch (error) { errors.push(`replay: ${error.message}`) }
    const expectedDates = replay.dates.map((date) => dateResult(date, report.requirements))
    if (JSON.stringify(dates) !== JSON.stringify(expectedDates)) errors.push('replay: date coverage does not reconcile with historical replay')
    const expectedCoverage = {
      adjustedRows: replay.evaluation.coverage.shadowRecords,
      settledAdjustedRows: replay.evaluation.coverage.settledRecords,
      settledGames: replay.evaluation.coverage.settledGames,
      settledDates: replay.evaluation.coverage.settledDates,
    }
    for (const [field, value] of Object.entries(expectedCoverage)) if (report.coverage?.[field] !== value) errors.push(`replay: coverage.${field} does not reconcile with evaluation`)
    const overall = replay.evaluation.overall
    const expectedPerformance = {
      gateStatus: replay.evaluation.gate.status,
      homers: overall?.homers || 0,
      brierImprovement: overall?.comparison?.brierImprovement ?? null,
      brier95CI: overall?.comparison?.pairedBrier95CI ?? null,
      logLossImprovement: overall?.comparison?.logLossImprovement ?? null,
      eceImprovement: overall?.comparison?.eceImprovement ?? null,
    }
    if (JSON.stringify(report.performance) !== JSON.stringify(expectedPerformance)) errors.push('replay: performance does not reconcile with evaluation')
    const expectedDecision = decisionFor(replay.evaluation, expected.fullSlateDates, report.requirements)
    if (JSON.stringify(report.decision) !== JSON.stringify(expectedDecision)) errors.push('replay: decision does not reconcile with evaluation')
    if (report.source?.replayGeneratedAt !== replay.generatedAt) errors.push('replay: generatedAt does not reconcile')
  }
  if (!report.coverage?.acceptedSignals) warnings.push('signals: replay accepted no time-eligible external context')
  if (!report.coverage?.settledAdjustedRows) warnings.push('outcomes: no adjusted batter-games were available to score')
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      status: report.decision?.status || null,
      replayDates: report.coverage?.replayDates || 0,
      fullSlateDates: report.coverage?.fullSlateDates || 0,
      identityCoverage: report.coverage?.identityCoverage || 0,
      adjustedRows: report.coverage?.adjustedRows || 0,
      settledAdjustedRows: report.coverage?.settledAdjustedRows || 0,
      brierImprovement: report.performance?.brierImprovement ?? null,
    },
  }
}

export function assertValidAiHrFullSlateValidation(report, replay = null) {
  const validation = validateAiHrFullSlateValidation(report, replay)
  if (validation.ok) return validation
  throw new Error(`AI HR full-slate validation failed:\n- ${validation.errors.join('\n- ')}`)
}
