import { assertValidAiHrContext } from './aiHrContext.mjs'
import {
  AI_HR_SHADOW_LOGIT_STEP,
  AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA,
  AI_HR_SHADOW_MODE,
  AI_HR_SHADOW_SCORING_KINDS,
  AI_HR_SHADOW_VERSION,
  applyAiHrLogitDelta,
  buildAiHrShadowRecords,
  validateAiHrShadowLedger,
} from './aiHrShadow.mjs'

export const AI_HR_PRODUCTION_VERSION = 1
export const AI_HR_PRODUCTION_MODE = 'production'
export const AI_HR_PRODUCTION_METHOD = 'external-context-confidence-logit'

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const round = (value, digits = 12) => Number(Number(value).toFixed(digits))

function hypothesis() {
  return {
    method: AI_HR_PRODUCTION_METHOD,
    perSignalLogit: AI_HR_SHADOW_LOGIT_STEP,
    maxAbsLogitDelta: AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA,
    scoringKinds: [...AI_HR_SHADOW_SCORING_KINDS],
  }
}

function baselineSlate(slate) {
  const output = structuredClone(slate)
  delete output.aiHrProduction
  for (const row of Object.values(output.scoredBatters || {})) {
    if (!isObject(row)) continue
    const priorBaseline = Number(row.baselineHrProbability)
    if (
      row.aiHr?.productionVersion === AI_HR_PRODUCTION_VERSION &&
      Number.isFinite(priorBaseline) && priorBaseline > 0 && priorBaseline < 1
    ) row.hrProbability = priorBaseline
    delete row.baselineHrProbability
    delete row.aiHr
  }
  return output
}

function productionRecord(record) {
  const { shadowHrProbability, shadowLogitDelta, ...rest } = record
  return {
    ...rest,
    productionHrProbability: shadowHrProbability,
    productionLogitDelta: shadowLogitDelta,
  }
}

/**
 * Promote the versioned external-context shadow hypothesis to the published HR
 * probability. Core score, grade, simulation output, and calibration inputs are
 * deliberately untouched. Reapplying to an already-adjusted slate first restores
 * its recorded baseline, making the operation deterministic and idempotent.
 */
export function applyAiHrProduction({ slate, context, generatedAt = new Date().toISOString() }) {
  if (!isObject(slate) || !isObject(slate.scoredBatters)) throw new Error('slate: scoredBatters is required')
  if (!validIso(generatedAt)) throw new Error('generatedAt: expected an ISO timestamp')
  assertValidAiHrContext(context)

  const output = baselineSlate(slate)
  const shadowRecords = buildAiHrShadowRecords({ slate: output, context, generatedAt })
  const records = shadowRecords.map(productionRecord)
  let applied = 0

  for (const record of records) {
    const key = `${record.playerId}-${record.gamePk}`
    const row = output.scoredBatters[key]
    if (!row) throw new Error(`production record ${record.id} has no matching slate row`)
    row.baselineHrProbability = record.baselineHrProbability
    row.hrProbability = record.productionHrProbability
    row.aiHr = {
      productionVersion: AI_HR_PRODUCTION_VERSION,
      applied: true,
      capturedAt: record.capturedAt,
      contextGeneratedAt: record.contextGeneratedAt,
      contextModel: record.contextModel,
      logitDelta: record.productionLogitDelta,
      signalIds: record.appliedSignals.map((signal) => signal.signalId),
    }
    applied++
  }

  const signalApplications = records.reduce((sum, record) => sum + record.appliedSignals.length, 0)
  const status = context.skipped
    ? 'skipped'
    : context.date !== slate.date
      ? 'date-mismatch'
      : applied > 0 ? 'applied' : 'no-adjustments'
  const reason = context.skipped
    ? String(context.reason || 'context pass skipped')
    : context.date !== slate.date
      ? `context date ${context.date} does not match slate date ${slate.date}`
      : applied > 0 ? null : 'no active sourced external signals qualified for scoring'
  const summary = {
    version: AI_HR_PRODUCTION_VERSION,
    mode: AI_HR_PRODUCTION_MODE,
    scoreImpact: true,
    gateOverride: true,
    date: String(slate.date || ''),
    appliedAt: new Date(generatedAt).toISOString(),
    contextGeneratedAt: context.generatedAt,
    contextModel: context.model,
    contextSource: context.source,
    status,
    reason,
    affectedBatters: applied,
    signalApplications,
    hypothesis: hypothesis(),
  }
  output.aiHrProduction = summary

  return {
    slate: output,
    artifact: {
      ...summary,
      records,
    },
  }
}

export function validateAiHrProduction({ slate, artifact }) {
  const errors = []
  const warnings = []
  if (!isObject(slate)) errors.push('slate: expected an object')
  if (!isObject(artifact)) return { ok: false, errors: ['artifact: expected an object'], warnings, metrics: {} }
  if (artifact.version !== AI_HR_PRODUCTION_VERSION) errors.push(`version: expected ${AI_HR_PRODUCTION_VERSION}`)
  if (artifact.mode !== AI_HR_PRODUCTION_MODE) errors.push(`mode: expected ${AI_HR_PRODUCTION_MODE}`)
  if (artifact.scoreImpact !== true) errors.push('scoreImpact: production artifact must affect scoring')
  if (artifact.gateOverride !== true) errors.push('gateOverride: manual promotion must remain explicit')
  if (!validIso(artifact.appliedAt) || !validIso(artifact.contextGeneratedAt)) errors.push('timestamps: appliedAt and contextGeneratedAt must be ISO')
  if (typeof artifact.contextModel !== 'string' || !artifact.contextModel || typeof artifact.contextSource !== 'string' || !artifact.contextSource) errors.push('context: model and source are required')
  if (artifact.date !== slate?.date) errors.push('date: artifact and slate must match')
  if (!['applied', 'no-adjustments', 'skipped', 'date-mismatch'].includes(artifact.status)) errors.push('status: unsupported value')
  if (
    artifact.hypothesis?.method !== AI_HR_PRODUCTION_METHOD ||
    artifact.hypothesis?.perSignalLogit !== AI_HR_SHADOW_LOGIT_STEP ||
    artifact.hypothesis?.maxAbsLogitDelta !== AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA ||
    JSON.stringify(artifact.hypothesis?.scoringKinds) !== JSON.stringify(AI_HR_SHADOW_SCORING_KINDS)
  ) errors.push('hypothesis: constants do not match production version')
  if (!Array.isArray(artifact.records)) errors.push('records: expected an array')
  const records = Array.isArray(artifact.records) ? artifact.records : []

  const summary = slate?.aiHrProduction
  if (!isObject(summary)) errors.push('slate.aiHrProduction: expected production summary')
  else {
    for (const field of ['version', 'mode', 'scoreImpact', 'gateOverride', 'date', 'appliedAt', 'contextGeneratedAt', 'contextModel', 'contextSource', 'status', 'reason', 'affectedBatters', 'signalApplications']) {
      if (summary[field] !== artifact[field]) errors.push(`slate.aiHrProduction.${field}: does not match artifact`)
    }
    if (JSON.stringify(summary.hypothesis) !== JSON.stringify(artifact.hypothesis)) errors.push('slate.aiHrProduction.hypothesis: does not match artifact')
  }

  const seen = new Set()
  const recordKeys = new Set()
  let signalApplications = 0
  for (let index = 0; index < records.length; index++) {
    const record = records[index]
    const at = `records[${index}]`
    if (!isObject(record)) {
      errors.push(`${at}: expected an object`)
      continue
    }
    const key = `${record.playerId}-${record.gamePk}`
    recordKeys.add(key)
    if (!record.id || seen.has(record.id)) errors.push(`${at}.id: required and unique`)
    seen.add(record.id)
    if (record.id !== `${artifact.date}:${record.gamePk}:${record.playerId}`) errors.push(`${at}: identity fields do not reconcile`)
    if (!finite(record.baselineHrProbability) || Number(record.baselineHrProbability) <= 0 || Number(record.baselineHrProbability) >= 1) errors.push(`${at}.baselineHrProbability: expected (0,1)`)
    if (!finite(record.productionHrProbability) || Number(record.productionHrProbability) <= 0 || Number(record.productionHrProbability) >= 1) errors.push(`${at}.productionHrProbability: expected (0,1)`)
    if (!finite(record.productionLogitDelta) || Math.abs(Number(record.productionLogitDelta)) > AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA) errors.push(`${at}.productionLogitDelta: outside cap`)
    if (!Array.isArray(record.appliedSignals) || !record.appliedSignals.length) errors.push(`${at}.appliedSignals: required`)
    signalApplications += Array.isArray(record.appliedSignals) ? record.appliedSignals.length : 0

    const row = slate?.scoredBatters?.[key]
    if (!row) {
      errors.push(`${at}: matching slate row is missing`)
      continue
    }
    if (row.aiHr?.productionVersion !== AI_HR_PRODUCTION_VERSION || row.aiHr?.applied !== true) errors.push(`${at}: slate row is missing production marker`)
    const recordSignalIds = Array.isArray(record.appliedSignals) ? record.appliedSignals.map((signal) => signal?.signalId) : []
    if (JSON.stringify(row.aiHr?.signalIds) !== JSON.stringify(recordSignalIds)) errors.push(`${at}: row signal IDs do not match artifact`)
    if (Math.abs(Number(row.baselineHrProbability) - Number(record.baselineHrProbability)) > 1e-12) errors.push(`${at}: row baseline does not match artifact`)
    if (Math.abs(Number(row.hrProbability) - Number(record.productionHrProbability)) > 1e-12) errors.push(`${at}: row probability does not match artifact`)
    if (
      finite(record.baselineHrProbability) && finite(record.productionLogitDelta) && finite(record.productionHrProbability) &&
      Math.abs(applyAiHrLogitDelta(Number(record.baselineHrProbability), Number(record.productionLogitDelta)) - Number(record.productionHrProbability)) > 1e-9
    ) errors.push(`${at}: production probability does not match deterministic log-odds adjustment`)
  }

  for (const [key, row] of Object.entries(slate?.scoredBatters || {})) {
    if (row?.aiHr?.productionVersion === AI_HR_PRODUCTION_VERSION && !recordKeys.has(key)) errors.push(`scoredBatters.${key}: production marker has no artifact record`)
  }
  if (artifact.affectedBatters !== records.length) errors.push('affectedBatters: does not match record count')
  if (artifact.signalApplications !== signalApplications) errors.push('signalApplications: does not match records')
  if (artifact.status === 'applied' && !records.length) errors.push('status: applied requires records')
  if (artifact.status !== 'applied' && records.length) errors.push('status: records require applied status')
  if (!records.length) warnings.push(`production: ${artifact.status}; baseline probabilities remain active`)

  // Reuse the stricter shadow-ledger contract to verify every signal target,
  // confidence-derived delta, evidence URL, and deterministic probability.
  const shadowContract = validateAiHrShadowLedger({
    version: AI_HR_SHADOW_VERSION,
    mode: AI_HR_SHADOW_MODE,
    scoreImpact: false,
    updatedAt: artifact.appliedAt,
    hypothesis: artifact.hypothesis,
    recordsByDate: {
      [artifact.date]: records.map((record) => ({
        ...record,
        shadowHrProbability: record.productionHrProbability,
        shadowLogitDelta: record.productionLogitDelta,
      })),
    },
  })
  for (const error of shadowContract.errors) errors.push(`provenance.${error}`)

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      records: records.length,
      signalApplications,
      maxAbsoluteProbabilityMove: round(Math.max(0, ...records.map((record) => (
        Math.abs(Number(record.productionHrProbability) - Number(record.baselineHrProbability)) || 0
      )))),
    },
  }
}

export function assertValidAiHrProduction(input) {
  const result = validateAiHrProduction(input)
  if (result.ok) return result
  throw new Error(`AI HR production overlay failed validation:\n- ${result.errors.join('\n- ')}`)
}
