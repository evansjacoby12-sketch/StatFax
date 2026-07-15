import {
  AI_HR_CONTEXT_KINDS,
  assertValidAiHrContext,
  buildAiHrEntityIndex,
  isPregameMlbGame,
} from './aiHrContext.mjs'

export const AI_HR_SHADOW_VERSION = 2
export const AI_HR_SHADOW_MODE = 'shadow'
export const AI_HR_SHADOW_LOGIT_STEP = 0.05
export const AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA = 0.15
export const AI_HR_SHADOW_RETENTION_DAYS = 180
export const AI_HR_SHADOW_SCORING_KINDS = Object.freeze([
  'starter-change',
  'opener-risk',
  'pitch-limit',
  'injury',
  'scratch-risk',
  'weather',
  'roof',
  'bullpen',
])

const DIRECTIONS = new Set(['boost', 'suppress', 'uncertain'])
const ENTITY_TYPES = new Set(['batter', 'pitcher', 'game', 'bullpen'])
const KINDS = new Set(AI_HR_CONTEXT_KINDS)
const SEVERITIES = new Set(['alert', 'warn', 'info'])
const SCORING_KINDS = new Set(AI_HR_SHADOW_SCORING_KINDS)
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const round = (value, digits = 12) => Number(Number(value).toFixed(digits))
const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const same = (left, right) => left != null && right != null && String(left) === String(right)

function validHttpUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function aiHrSignalLogitDelta(signal) {
  if (!SCORING_KINDS.has(signal?.kind) || !DIRECTIONS.has(signal?.direction) || !finite(signal?.confidence)) return 0
  if (signal.kind === 'scratch-risk' && (signal.entityType !== 'batter' || signal.direction !== 'suppress')) return 0
  if (signal.kind === 'injury' && signal.entityType === 'batter' && signal.direction !== 'suppress') return 0
  const sign = signal.direction === 'boost' ? 1 : signal.direction === 'suppress' ? -1 : 0
  return round(sign * AI_HR_SHADOW_LOGIT_STEP * clamp(Number(signal.confidence), 0, 1), 6)
}

export function applyAiHrLogitDelta(probability, delta) {
  const p = Number(probability)
  if (!Number.isFinite(p) || p <= 0 || p >= 1) throw new Error('probability must be between 0 and 1')
  const boundedDelta = clamp(Number(delta) || 0, -AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA, AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA)
  const logit = Math.log(p / (1 - p)) + boundedDelta
  return round(1 / (1 + Math.exp(-logit)))
}

function opposingTeam(row, game) {
  const isAway = same(row?.teamId, game?.awayTeam?.id) || row?.isHome === false
  const isHome = same(row?.teamId, game?.homeTeam?.id) || row?.isHome === true
  if (isAway && !isHome) return game?.homeTeam
  if (isHome && !isAway) return game?.awayTeam
  if (String(row?.team || '').toUpperCase() === String(game?.awayTeam?.abbr || '').toUpperCase()) return game?.homeTeam
  if (String(row?.team || '').toUpperCase() === String(game?.homeTeam?.abbr || '').toUpperCase()) return game?.awayTeam
  return null
}

export function aiHrSignalAppliesToBatter(signal, row, game) {
  if (!signal || !row || !game || !same(signal.gamePk, row.gamePk) || !same(game.gamePk, row.gamePk)) return false
  if (signal.entityType === 'game') return true
  if (signal.entityType === 'batter') return same(signal.entityId, row.playerId)
  if (signal.entityType === 'pitcher') return same(signal.entityId, row.pitcher?.id)
  if (signal.entityType === 'bullpen') {
    const opponent = opposingTeam(row, game)
    return same(signal.entityId, opponent?.id) || (
      signal.team && String(signal.team).toUpperCase() === String(opponent?.abbr || '').toUpperCase()
    )
  }
  return false
}

function signalProvenance(signal) {
  return {
    signalId: signal.id,
    entityKey: signal.entityKey,
    entityType: signal.entityType,
    entityId: signal.entityId,
    gamePk: signal.gamePk,
    kind: signal.kind,
    direction: signal.direction,
    severity: signal.severity,
    confidence: signal.confidence,
    logitDelta: aiHrSignalLogitDelta(signal),
    note: signal.note,
    evidence: signal.evidence.map((item) => ({
      url: item.url,
      title: item.title,
      publishedAt: item.publishedAt ?? null,
    })),
  }
}

/**
 * Build hypothetical projections for affected pregame batters only. The input
 * slate is never mutated and its published hrProbability remains authoritative.
 */
export function buildAiHrShadowRecords({ slate, context, generatedAt = new Date().toISOString() }) {
  assertValidAiHrContext(context)
  if (!validIso(generatedAt) || context.skipped || context.date !== slate?.date) return []

  const now = Date.parse(generatedAt)
  const entities = buildAiHrEntityIndex(slate)
  const games = new Map((slate?.games || [])
    .filter((game) => finite(game?.gamePk) && isPregameMlbGame(game))
    .map((game) => [Number(game.gamePk), game]))
  const signals = context.signals.filter((signal) => (
    entities.has(signal.entityKey) &&
    Date.parse(signal.observedAt) <= now &&
    Date.parse(signal.expiresAt) > now
  ))
  const records = []

  for (const row of Object.values(slate?.scoredBatters || {})) {
    const game = games.get(Number(row?.gamePk))
    const baseline = Number(row?.hrProbability)
    if (!game || !finite(row?.playerId) || !Number.isFinite(baseline) || baseline <= 0 || baseline >= 1) continue

    const appliedSignals = signals
      .filter((signal) => aiHrSignalAppliesToBatter(signal, row, game))
      .map(signalProvenance)
      .filter((signal) => signal.logitDelta !== 0)
      .sort((a, b) => a.signalId.localeCompare(b.signalId))
    if (!appliedSignals.length) continue

    const rawDelta = appliedSignals.reduce((sum, signal) => sum + signal.logitDelta, 0)
    const shadowLogitDelta = round(clamp(
      rawDelta,
      -AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA,
      AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA,
    ), 6)
    records.push({
      id: `${slate.date}:${Number(row.gamePk)}:${Number(row.playerId)}`,
      date: slate.date,
      gamePk: Number(row.gamePk),
      gameDate: validIso(game.gameDate) ? new Date(game.gameDate).toISOString() : null,
      playerId: Number(row.playerId),
      name: String(row.name || '').trim(),
      team: String(row.team || '').trim() || null,
      teamId: finite(row.teamId) ? Number(row.teamId) : null,
      baselineHrProbability: round(baseline),
      shadowHrProbability: applyAiHrLogitDelta(baseline, shadowLogitDelta),
      shadowLogitDelta,
      capturedAt: new Date(generatedAt).toISOString(),
      contextGeneratedAt: context.generatedAt,
      contextModel: context.model,
      appliedSignals,
    })
  }

  return records.sort((a, b) => a.gamePk - b.gamePk || a.playerId - b.playerId)
}

function emptyLedger(updatedAt) {
  return {
    version: AI_HR_SHADOW_VERSION,
    mode: AI_HR_SHADOW_MODE,
    scoreImpact: false,
    updatedAt,
    hypothesis: {
      method: 'external-context-confidence-logit',
      perSignalLogit: AI_HR_SHADOW_LOGIT_STEP,
      maxAbsLogitDelta: AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA,
      scoringKinds: [...AI_HR_SHADOW_SCORING_KINDS],
    },
    recordsByDate: {},
  }
}

export function mergeAiHrShadowLedger({
  previous,
  date,
  records,
  replaceGamePks = [],
  updatedAt = new Date().toISOString(),
  retentionDays = AI_HR_SHADOW_RETENTION_DAYS,
}) {
  const base = validateAiHrShadowLedger(previous).ok
    ? structuredClone(previous)
    : emptyLedger(updatedAt)
  base.updatedAt = new Date(updatedAt).toISOString()

  const replace = new Set(replaceGamePks.map(Number))
  const priorDateRecords = Array.isArray(base.recordsByDate[date]) ? base.recordsByDate[date] : []
  const retained = priorDateRecords.filter((record) => !replace.has(Number(record.gamePk)))
  const byId = new Map(retained.map((record) => [record.id, record]))
  for (const record of records) byId.set(record.id, structuredClone(record))
  const merged = [...byId.values()].sort((a, b) => a.gamePk - b.gamePk || a.playerId - b.playerId)
  if (merged.length) base.recordsByDate[date] = merged
  else delete base.recordsByDate[date]

  const cutoff = Date.parse(`${date}T00:00:00.000Z`) - (Math.max(1, retentionDays) - 1) * 86400000
  base.recordsByDate = Object.fromEntries(Object.entries(base.recordsByDate)
    .filter(([key]) => validDate(key) && Date.parse(`${key}T00:00:00.000Z`) >= cutoff)
    .sort(([left], [right]) => left.localeCompare(right)))
  return base
}

function expectedRecordDelta(record) {
  return round(clamp(
    record.appliedSignals.reduce((sum, signal) => sum + (Number(signal?.logitDelta) || 0), 0),
    -AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA,
    AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA,
  ), 6)
}

export function validateAiHrShadowLedger(ledger) {
  const errors = []
  const warnings = []
  if (!isObject(ledger)) return { ok: false, errors: ['ledger: expected an object'], warnings, metrics: {} }
  if (ledger.version !== AI_HR_SHADOW_VERSION) errors.push(`version: expected ${AI_HR_SHADOW_VERSION}`)
  if (ledger.mode !== AI_HR_SHADOW_MODE) errors.push(`mode: expected ${AI_HR_SHADOW_MODE}`)
  if (ledger.scoreImpact !== false) errors.push('scoreImpact: shadow ledger must never affect production scoring')
  if (!validIso(ledger.updatedAt)) errors.push('updatedAt: expected an ISO timestamp')
  if (
    ledger.hypothesis?.method !== 'external-context-confidence-logit' ||
    ledger.hypothesis?.perSignalLogit !== AI_HR_SHADOW_LOGIT_STEP ||
    ledger.hypothesis?.maxAbsLogitDelta !== AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA ||
    JSON.stringify(ledger.hypothesis?.scoringKinds) !== JSON.stringify(AI_HR_SHADOW_SCORING_KINDS)
  ) errors.push('hypothesis: constants do not match the versioned shadow experiment')
  if (!isObject(ledger.recordsByDate)) errors.push('recordsByDate: expected an object')

  const seenIds = new Set()
  let recordCount = 0
  let signalCount = 0
  for (const [date, records] of Object.entries(ledger.recordsByDate || {})) {
    if (!validDate(date) || !Array.isArray(records)) {
      errors.push(`recordsByDate.${date}: expected a date-keyed array`)
      continue
    }
    for (let index = 0; index < records.length; index++) {
      recordCount++
      const record = records[index]
      const at = `recordsByDate.${date}[${index}]`
      if (!isObject(record)) {
        errors.push(`${at}: expected an object`)
        continue
      }
      if (!record.id || seenIds.has(record.id)) errors.push(`${at}.id: required and globally unique`)
      seenIds.add(record.id)
      if (record.date !== date || record.id !== `${date}:${record.gamePk}:${record.playerId}`) errors.push(`${at}: identity fields do not reconcile`)
      if (!finite(record.gamePk) || !finite(record.playerId)) errors.push(`${at}: gamePk and playerId must be finite`)
      if (record.gameDate != null && !validIso(record.gameDate)) errors.push(`${at}.gameDate: expected ISO timestamp or null`)
      if (!validIso(record.capturedAt) || !validIso(record.contextGeneratedAt)) errors.push(`${at}: capture timestamps must be ISO`)
      if (typeof record.name !== 'string' || !record.name || typeof record.contextModel !== 'string' || !record.contextModel) errors.push(`${at}: name and contextModel are required`)
      if (!Number.isFinite(record.baselineHrProbability) || record.baselineHrProbability <= 0 || record.baselineHrProbability >= 1) errors.push(`${at}.baselineHrProbability: expected (0,1)`)
      if (!Number.isFinite(record.shadowHrProbability) || record.shadowHrProbability <= 0 || record.shadowHrProbability >= 1) errors.push(`${at}.shadowHrProbability: expected (0,1)`)
      if (!Number.isFinite(record.shadowLogitDelta) || Math.abs(record.shadowLogitDelta) > AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA) errors.push(`${at}.shadowLogitDelta: outside experiment cap`)
      if (!Array.isArray(record.appliedSignals) || !record.appliedSignals.length) {
        errors.push(`${at}.appliedSignals: at least one signal is required`)
        continue
      }
      signalCount += record.appliedSignals.length
      const signalIds = new Set()
      for (let signalIndex = 0; signalIndex < record.appliedSignals.length; signalIndex++) {
        const signal = record.appliedSignals[signalIndex]
        const signalAt = `${at}.appliedSignals[${signalIndex}]`
        if (!isObject(signal)) {
          errors.push(`${signalAt}: expected an object`)
          continue
        }
        if (!signal.signalId || signalIds.has(signal.signalId)) errors.push(`${signalAt}.signalId: required and unique within record`)
        signalIds.add(signal.signalId)
        if (!ENTITY_TYPES.has(signal.entityType) || !DIRECTIONS.has(signal.direction)) errors.push(`${signalAt}: invalid entityType or direction`)
        const expectedEntityKey = signal.entityType === 'game'
          ? `game:${signal.gamePk}`
          : `${signal.entityType}:${signal.entityId}:${signal.gamePk}`
        if (!finite(signal.gamePk) || !same(signal.gamePk, record.gamePk) || signal.entityKey !== expectedEntityKey) errors.push(`${signalAt}: target does not reconcile with record game`)
        if (!KINDS.has(signal.kind) || !SEVERITIES.has(signal.severity) || typeof signal.note !== 'string' || !signal.note) errors.push(`${signalAt}: kind, severity, and note are required`)
        if (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1) errors.push(`${signalAt}.confidence: expected [0,1]`)
        if (!Number.isFinite(signal.logitDelta) || Math.abs(aiHrSignalLogitDelta(signal) - signal.logitDelta) > 1e-9) errors.push(`${signalAt}.logitDelta: does not match direction and confidence`)
        if (!Array.isArray(signal.evidence) || !signal.evidence.length || signal.evidence.some((item) => (
          !isObject(item) || !validHttpUrl(item.url) || typeof item.title !== 'string' || !item.title ||
          (item.publishedAt != null && !validIso(item.publishedAt))
        ))) errors.push(`${signalAt}.evidence: sourced URLs, titles, and valid timestamps are required`)
      }
      if (Math.abs(expectedRecordDelta(record) - record.shadowLogitDelta) > 1e-9) errors.push(`${at}.shadowLogitDelta: does not reconcile with applied signals`)
      if (
        Number.isFinite(record.baselineHrProbability) && record.baselineHrProbability > 0 && record.baselineHrProbability < 1 &&
        Number.isFinite(record.shadowHrProbability) && Number.isFinite(record.shadowLogitDelta) &&
        Math.abs(applyAiHrLogitDelta(record.baselineHrProbability, record.shadowLogitDelta) - record.shadowHrProbability) > 1e-9
      ) errors.push(`${at}.shadowHrProbability: does not match deterministic log-odds hypothesis`)
    }
  }
  if (!recordCount) warnings.push('records: no active sourced signals produced a shadow projection')
  return { ok: errors.length === 0, errors, warnings, metrics: { records: recordCount, signalApplications: signalCount } }
}

export function assertValidAiHrShadowLedger(ledger) {
  const result = validateAiHrShadowLedger(ledger)
  if (result.ok) return result
  throw new Error(`AI HR shadow ledger failed validation:\n- ${result.errors.join('\n- ')}`)
}
