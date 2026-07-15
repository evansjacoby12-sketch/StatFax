import { buildAiHrOutcomeIndex } from './aiHrEvaluation.mjs'
import { assertValidAiHrShadowLedger } from './aiHrShadow.mjs'

export const AI_HR_ATTRIBUTION_VERSION = 1
export const AI_HR_ATTRIBUTION_MODE = 'postgame-attribution'
export const AI_HR_SURPRISE_HR_MAX_PROBABILITY = 0.1
export const AI_HR_HIGH_PROBABILITY_BLANK_MIN = 0.18

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const round = (value, digits = 12) => Number(Number(value).toFixed(digits))

function key(date, playerId, gamePk) {
  return `${date}:${Number(gamePk)}:${Number(playerId)}`
}

function featureIndex(backtestLog) {
  const index = new Map()
  for (const recordsByDate of [backtestLog?.modelHistory?.records, backtestLog?.records]) {
    for (const [date, records] of Object.entries(recordsByDate || {})) {
      for (const record of Array.isArray(records) ? records : []) {
        if (!finite(record?.playerId) || !finite(record?.gamePk)) continue
        index.set(key(date, record.playerId, record.gamePk), record?.feat || null)
      }
    }
  }
  return index
}

function watchdogIndex(history) {
  const index = new Map()
  for (const [date, entry] of Object.entries(history?.recordsByDate || {})) {
    for (const alert of entry?.alerts || []) {
      for (const lookup of [alert.signalId, `${date}:${alert.gamePk}:${alert.entityKey}:${alert.kind}`]) {
        if (lookup) index.set(lookup, alert)
      }
    }
  }
  return index
}

function signalOutcome(signal, outcome) {
  if (signal.direction === 'uncertain' || !['boost', 'suppress'].includes(signal.direction)) return 'neutral'
  return (signal.direction === 'boost' && outcome === 1) || (signal.direction === 'suppress' && outcome === 0)
    ? 'aligned'
    : 'opposed'
}

function diagnostic(code, label, field = null, value = null, threshold = null) {
  return { code, label, field, value: finite(value) ? Number(value) : null, threshold }
}

function missDiagnostics(feat, missType) {
  if (!isObject(feat) || missType === 'normal-variance') return []
  const candidates = []
  if (Number(feat.brl) >= 13) candidates.push(diagnostic('elite-barrel-signal', 'Elite barrel rate was present but did not resolve the outcome.', 'brl', feat.brl, '>=13'))
  if (Number(feat.iso) >= 0.25) candidates.push(diagnostic('elite-isolated-power', 'Elite isolated power was present.', 'iso', feat.iso, '>=0.25'))
  if (Number(feat.phr9) >= 1.3) candidates.push(diagnostic('vulnerable-starter', 'The opposing starter carried elevated HR/9.', 'phr9', feat.phr9, '>=1.3'))
  if (Number(feat.park) >= 1.08) candidates.push(diagnostic('positive-park', 'The park environment favored home runs.', 'park', feat.park, '>=1.08'))
  if (Number(feat.heat) >= 60) candidates.push(diagnostic('hot-slate-profile', 'The batter carried a strong slate heat score.', 'heat', feat.heat, '>=60'))
  if (Number(feat.vig) >= 0.15) candidates.push(diagnostic('market-support', 'The available market implied meaningful HR probability.', 'vig', feat.vig, '>=0.15'))
  if (candidates.length) return candidates.slice(0, 4)
  return [diagnostic(
    missType === 'surprise-homer' ? 'low-signal-surprise' : 'unconverted-probability',
    missType === 'surprise-homer'
      ? 'No tracked high-end feature crossed its diagnostic threshold; treat this as a low-signal surprise, not a discovered cause.'
      : 'No single tracked feature dominated; the high projection did not convert in this game.',
  )]
}

function attributionMetrics(records, coverage) {
  const helped = records.filter((record) => record.aiImpact === 'helped').length
  const hurt = records.filter((record) => record.aiImpact === 'hurt').length
  const unchanged = records.length - helped - hurt
  const baselineBrier = records.length ? records.reduce((sum, record) => sum + record.baselineSquaredError, 0) / records.length : null
  const aiBrier = records.length ? records.reduce((sum, record) => sum + record.aiSquaredError, 0) / records.length : null
  const kinds = [...new Set(records.flatMap((record) => record.signals.map((signal) => signal.kind)))].sort()
  const bySignalKind = Object.fromEntries(kinds.map((kind) => {
    const signals = records.flatMap((record) => record.signals.filter((signal) => signal.kind === kind))
    const directional = signals.filter((signal) => signal.outcomeAlignment !== 'neutral')
    const aligned = directional.filter((signal) => signal.outcomeAlignment === 'aligned').length
    return [kind, {
      applications: signals.length,
      aligned,
      opposed: directional.length - aligned,
      neutral: signals.length - directional.length,
      alignmentRate: directional.length ? round(aligned / directional.length, 4) : null,
      meanLogitDelta: signals.length ? round(signals.reduce((sum, signal) => sum + signal.logitDelta, 0) / signals.length, 6) : null,
    }]
  }))
  return {
    shadowRecords: coverage.shadowRecords,
    settledRecords: records.length,
    pendingRecords: coverage.pendingRecords,
    scratches: coverage.scratches,
    helped,
    hurt,
    unchanged,
    surpriseHomers: records.filter((record) => record.missType === 'surprise-homer').length,
    highProbabilityBlanks: records.filter((record) => record.missType === 'high-probability-blank').length,
    baselineBrier: baselineBrier == null ? null : round(baselineBrier),
    aiBrier: aiBrier == null ? null : round(aiBrier),
    brierImprovement: baselineBrier == null ? null : round(baselineBrier - aiBrier),
    bySignalKind,
  }
}

function narrative(metrics) {
  if (!metrics.settledRecords) return {
    headline: 'Waiting for settled AI-adjusted batter outcomes.',
    findings: ['No postgame attribution is available until an AI-adjusted projection has an official played outcome.'],
  }
  const direction = metrics.brierImprovement > 0 ? 'improved' : metrics.brierImprovement < 0 ? 'worsened' : 'left unchanged'
  const findings = [
    `Across ${metrics.settledRecords} settled projection${metrics.settledRecords === 1 ? '' : 's'}, the AI layer ${direction} mean Brier error by ${Math.abs(metrics.brierImprovement).toFixed(6)}.`,
    `${metrics.helped} adjustment${metrics.helped === 1 ? '' : 's'} helped and ${metrics.hurt} hurt on the realized outcome.`,
  ]
  if (metrics.surpriseHomers || metrics.highProbabilityBlanks) findings.push(`${metrics.surpriseHomers} surprise homer${metrics.surpriseHomers === 1 ? '' : 's'} and ${metrics.highProbabilityBlanks} high-probability blank${metrics.highProbabilityBlanks === 1 ? '' : 's'} require review.`)
  return { headline: `AI context ${direction} postgame probability error.`, findings }
}

export function buildAiHrAttribution({ ledger, backtestLog = {}, watchdogHistory = null, generatedAt = new Date().toISOString() }) {
  assertValidAiHrShadowLedger(ledger)
  const outcomes = buildAiHrOutcomeIndex(backtestLog)
  const features = featureIndex(backtestLog)
  const watchdog = watchdogIndex(watchdogHistory)
  const records = []
  const coverage = { shadowRecords: 0, pendingRecords: 0, scratches: 0 }

  for (const [date, dayRecords] of Object.entries(ledger.recordsByDate || {})) {
    for (const record of dayRecords) {
      coverage.shadowRecords++
      const outcome = outcomes.get(key(date, record.playerId, record.gamePk))
      if (!outcome) { coverage.pendingRecords++; continue }
      if (!outcome.actuallyPlayed) { coverage.scratches++; continue }
      const actual = outcome.homered ? 1 : 0
      const baseline = Number(record.baselineHrProbability)
      const adjusted = Number(record.shadowHrProbability)
      const baselineSquaredError = (baseline - actual) ** 2
      const aiSquaredError = (adjusted - actual) ** 2
      const brierImprovement = baselineSquaredError - aiSquaredError
      const missType = actual === 1 && adjusted < AI_HR_SURPRISE_HR_MAX_PROBABILITY
        ? 'surprise-homer'
        : actual === 0 && adjusted >= AI_HR_HIGH_PROBABILITY_BLANK_MIN
          ? 'high-probability-blank'
          : 'normal-variance'
      const feat = features.get(key(date, record.playerId, record.gamePk))
      const signals = record.appliedSignals.map((signal) => {
        const alert = watchdog.get(signal.signalId) || watchdog.get(`${date}:${record.gamePk}:${signal.entityKey}:${signal.kind}`)
        return {
          signalId: signal.signalId,
          entityKey: signal.entityKey,
          kind: signal.kind,
          direction: signal.direction,
          confidence: signal.confidence,
          logitDelta: signal.logitDelta,
          note: signal.note,
          evidence: structuredClone(signal.evidence),
          outcomeAlignment: signalOutcome(signal, actual),
          watchdogOutcome: alert?.outcome || null,
        }
      })
      records.push({
        id: record.id,
        date,
        gamePk: record.gamePk,
        playerId: record.playerId,
        name: record.name,
        team: record.team,
        outcome: actual,
        baselineHrProbability: baseline,
        aiHrProbability: adjusted,
        probabilityDelta: round(adjusted - baseline),
        baselineSquaredError: round(baselineSquaredError),
        aiSquaredError: round(aiSquaredError),
        brierImprovement: round(brierImprovement),
        aiImpact: brierImprovement > 1e-12 ? 'helped' : brierImprovement < -1e-12 ? 'hurt' : 'unchanged',
        missType,
        diagnostics: missDiagnostics(feat, missType),
        signals,
      })
    }
  }
  records.sort((left, right) => left.date.localeCompare(right.date) || left.gamePk - right.gamePk || left.playerId - right.playerId)
  const metrics = attributionMetrics(records, coverage)
  return {
    version: AI_HR_ATTRIBUTION_VERSION,
    mode: AI_HR_ATTRIBUTION_MODE,
    scoreImpact: false,
    generatedAt: validIso(generatedAt) ? new Date(generatedAt).toISOString() : new Date().toISOString(),
    thresholds: {
      surpriseHomerMaxProbability: AI_HR_SURPRISE_HR_MAX_PROBABILITY,
      highProbabilityBlankMin: AI_HR_HIGH_PROBABILITY_BLANK_MIN,
    },
    methodology: {
      errorMetric: 'paired-brier',
      causalityClaimed: false,
      note: 'Diagnostics identify present signals and realized error direction; they do not claim a single-game causal explanation.',
    },
    metrics,
    narrative: narrative(metrics),
    records,
  }
}

export function validateAiHrAttribution(report) {
  const errors = []
  const warnings = []
  if (!isObject(report)) return { ok: false, errors: ['report: expected an object'], warnings, metrics: {} }
  if (report.version !== AI_HR_ATTRIBUTION_VERSION) errors.push(`version: expected ${AI_HR_ATTRIBUTION_VERSION}`)
  if (report.mode !== AI_HR_ATTRIBUTION_MODE) errors.push(`mode: expected ${AI_HR_ATTRIBUTION_MODE}`)
  if (report.scoreImpact !== false) errors.push('scoreImpact: attribution must remain diagnostic')
  if (!validIso(report.generatedAt)) errors.push('generatedAt: expected ISO timestamp')
  if (report.thresholds?.surpriseHomerMaxProbability !== AI_HR_SURPRISE_HR_MAX_PROBABILITY || report.thresholds?.highProbabilityBlankMin !== AI_HR_HIGH_PROBABILITY_BLANK_MIN) errors.push('thresholds: do not match attribution version')
  if (report.methodology?.causalityClaimed !== false || report.methodology?.errorMetric !== 'paired-brier') errors.push('methodology: must remain non-causal paired Brier attribution')
  if (!Array.isArray(report.records)) errors.push('records: expected an array')
  const records = Array.isArray(report.records) ? report.records : []
  const ids = new Set()
  for (const [index, record] of records.entries()) {
    const at = `records[${index}]`
    if (!record?.id || ids.has(record.id)) errors.push(`${at}.id: required and unique`)
    ids.add(record?.id)
    if (![0, 1].includes(record?.outcome)) errors.push(`${at}.outcome: expected binary value`)
    if (![record?.baselineHrProbability, record?.aiHrProbability].every((value) => Number.isFinite(value) && value > 0 && value < 1)) errors.push(`${at}: probabilities must be in (0,1)`)
    const expectedBaselineError = round((record.baselineHrProbability - record.outcome) ** 2)
    const expectedAiError = round((record.aiHrProbability - record.outcome) ** 2)
    if (record.baselineSquaredError !== expectedBaselineError || record.aiSquaredError !== expectedAiError || record.brierImprovement !== round(expectedBaselineError - expectedAiError)) errors.push(`${at}: paired Brier math does not reconcile`)
    const expectedImpact = expectedBaselineError - expectedAiError > 1e-12 ? 'helped' : expectedBaselineError - expectedAiError < -1e-12 ? 'hurt' : 'unchanged'
    if (record.aiImpact !== expectedImpact) errors.push(`${at}.aiImpact: expected ${expectedImpact}`)
    if (record.probabilityDelta !== round(record.aiHrProbability - record.baselineHrProbability)) errors.push(`${at}.probabilityDelta: does not reconcile`)
    const expectedMissType = record.outcome === 1 && record.aiHrProbability < AI_HR_SURPRISE_HR_MAX_PROBABILITY
      ? 'surprise-homer'
      : record.outcome === 0 && record.aiHrProbability >= AI_HR_HIGH_PROBABILITY_BLANK_MIN
        ? 'high-probability-blank'
        : 'normal-variance'
    if (record.missType !== expectedMissType) errors.push(`${at}.missType: expected ${expectedMissType}`)
    if (!Array.isArray(record.diagnostics)) errors.push(`${at}.diagnostics: expected an array`)
    if (!Array.isArray(record.signals) || !record.signals.length) errors.push(`${at}.signals: source-backed signal applications are required`)
    for (const signal of record.signals || []) {
      if (!Array.isArray(signal.evidence) || !signal.evidence.length) errors.push(`${at}.signals: evidence is required`)
      for (const source of signal.evidence || []) {
        try {
          if (!['http:', 'https:'].includes(new URL(source?.url).protocol)) throw new Error('bad protocol')
        } catch { errors.push(`${at}.signals: evidence URL is invalid`) }
      }
      if (signal.outcomeAlignment !== signalOutcome(signal, record.outcome)) errors.push(`${at}.signals: outcome alignment does not reconcile`)
      if (!Number.isFinite(signal.logitDelta) || Math.abs(signal.logitDelta) > 0.15) errors.push(`${at}.signals: logit delta is invalid`)
      if (signal.watchdogOutcome != null && !['pending', 'confirmed', 'not-confirmed', 'unverifiable'].includes(signal.watchdogOutcome)) errors.push(`${at}.signals: watchdog outcome is invalid`)
    }
  }
  const pendingRecords = report.metrics?.pendingRecords
  const scratches = report.metrics?.scratches
  if (![pendingRecords, scratches].every((value) => Number.isInteger(value) && value >= 0)) errors.push('metrics: pendingRecords and scratches must be non-negative integers')
  const coverage = {
    shadowRecords: records.length + (Number.isInteger(pendingRecords) ? pendingRecords : 0) + (Number.isInteger(scratches) ? scratches : 0),
    pendingRecords: Number.isInteger(pendingRecords) ? pendingRecords : 0,
    scratches: Number.isInteger(scratches) ? scratches : 0,
  }
  const expectedMetrics = attributionMetrics(records, coverage)
  if (JSON.stringify(report.metrics) !== JSON.stringify(expectedMetrics)) errors.push('metrics: do not reconcile with records')
  if (JSON.stringify(report.narrative) !== JSON.stringify(narrative(expectedMetrics))) errors.push('narrative: does not reconcile with metrics')
  if (!records.length) warnings.push('records: no settled AI-adjusted outcomes yet')
  return { ok: errors.length === 0, errors, warnings, metrics: expectedMetrics }
}

export function assertValidAiHrAttribution(report) {
  const result = validateAiHrAttribution(report)
  if (result.ok) return result
  throw new Error(`AI HR attribution failed validation:\n- ${result.errors.join('\n- ')}`)
}
