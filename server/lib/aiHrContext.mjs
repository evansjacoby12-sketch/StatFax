export const AI_HR_CONTEXT_VERSION = 1
export const AI_HR_CONTEXT_MODE = 'advisory'

export const AI_HR_CONTEXT_KINDS = Object.freeze([
  'starter-change',
  'opener-risk',
  'pitch-limit',
  'lineup-status',
  'injury',
  'scratch-risk',
  'weather',
  'roof',
  'bullpen',
  'callup',
  'other',
])

const KIND_SET = new Set(AI_HR_CONTEXT_KINDS)
const ENTITY_TYPES = new Set(['batter', 'pitcher', 'game', 'bullpen'])
const DIRECTIONS = new Set(['boost', 'suppress', 'uncertain'])
const SEVERITIES = new Set(['alert', 'warn', 'info'])
const FORBIDDEN_SCORING_FIELDS = new Set([
  'hrProbability',
  'probabilityAdjustment',
  'scoreAdjustment',
  'multiplier',
  'weight',
])

const ENTITY_TYPES_BY_KIND = {
  'starter-change': new Set(['pitcher', 'game']),
  'opener-risk': new Set(['pitcher', 'game']),
  'pitch-limit': new Set(['pitcher']),
  'lineup-status': new Set(['batter']),
  injury: new Set(['batter', 'pitcher']),
  'scratch-risk': new Set(['batter']),
  weather: new Set(['game']),
  roof: new Set(['game']),
  bullpen: new Set(['bullpen']),
  callup: new Set(['batter', 'pitcher']),
  other: ENTITY_TYPES,
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const clean = (value, max = 240) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))

function validEvidenceUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) ? url.toString() : null
  } catch {
    return null
  }
}

function addEntity(index, entity) {
  if (!entity?.entityKey || index.has(entity.entityKey)) return
  index.set(entity.entityKey, Object.freeze(entity))
}

function gameMatchup(game) {
  const away = game?.awayTeam?.abbr || game?.awayTeam?.name || 'Away'
  const home = game?.homeTeam?.abbr || game?.homeTeam?.name || 'Home'
  return `${away}@${home}`
}

/**
 * Stable, slate-owned entity keys prevent the LLM from inventing player IDs or
 * attaching a news item to the wrong game in a doubleheader.
 */
export function buildAiHrEntityIndex(slate) {
  const index = new Map()
  const games = Array.isArray(slate?.games) ? slate.games : []

  for (const game of games) {
    if (!finite(game?.gamePk)) continue
    const gamePk = Number(game.gamePk)
    const matchup = gameMatchup(game)
    addEntity(index, {
      entityKey: `game:${gamePk}`,
      entityType: 'game',
      entityId: gamePk,
      gamePk,
      name: matchup,
      team: null,
      gameDate: validIso(game.gameDate) ? game.gameDate : null,
    })

    for (const [side, team] of [['away', game.awayTeam], ['home', game.homeTeam]]) {
      const id = finite(team?.id) ? Number(team.id) : clean(team?.abbr || team?.name, 20)
      if (id === '') continue
      const abbr = clean(team?.abbr || team?.name, 8)
      addEntity(index, {
        entityKey: `bullpen:${id}:${gamePk}`,
        entityType: 'bullpen',
        entityId: id,
        gamePk,
        name: `${abbr || side} bullpen`,
        team: abbr || null,
        gameDate: validIso(game.gameDate) ? game.gameDate : null,
      })
    }

    for (const [pitcher, team] of [
      [game.awayPitcher, game.awayTeam],
      [game.homePitcher, game.homeTeam],
    ]) {
      if (!finite(pitcher?.id)) continue
      addEntity(index, {
        entityKey: `pitcher:${Number(pitcher.id)}:${gamePk}`,
        entityType: 'pitcher',
        entityId: Number(pitcher.id),
        gamePk,
        name: clean(pitcher.name || pitcher.fullName, 80),
        team: clean(team?.abbr, 8) || null,
        gameDate: validIso(game.gameDate) ? game.gameDate : null,
      })
    }
  }

  const rows = Object.values(slate?.scoredBatters || {})
  for (const row of rows) {
    if (!finite(row?.playerId) || !finite(row?.gamePk)) continue
    const playerId = Number(row.playerId)
    const gamePk = Number(row.gamePk)
    const game = games.find((candidate) => Number(candidate?.gamePk) === gamePk)
    addEntity(index, {
      entityKey: `batter:${playerId}:${gamePk}`,
      entityType: 'batter',
      entityId: playerId,
      gamePk,
      name: clean(row.name, 80),
      team: clean(row.team, 8) || null,
      gameDate: validIso(game?.gameDate) ? game.gameDate : null,
    })
    if (finite(row?.pitcher?.id)) {
      addEntity(index, {
        entityKey: `pitcher:${Number(row.pitcher.id)}:${gamePk}`,
        entityType: 'pitcher',
        entityId: Number(row.pitcher.id),
        gamePk,
        name: clean(row.pitcher.name, 80),
        team: null,
        gameDate: validIso(game?.gameDate) ? game.gameDate : null,
      })
    }
  }
  return index
}

export function summarizeAiHrTargets(slate, maxBatters = 28) {
  const entities = buildAiHrEntityIndex(slate)
  const rows = Object.values(slate?.scoredBatters || {})
  const seen = new Set()
  const batters = rows
    .filter((row) => {
      const key = `batter:${row?.playerId}:${row?.gamePk}`
      if (!entities.has(key) || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, maxBatters)
    .map((row) => {
      const key = `batter:${row.playerId}:${row.gamePk}`
      return {
        entityKey: key,
        name: entities.get(key).name,
        team: entities.get(key).team,
        grade: row.grade?.label || row.grade || 'SKIP',
        opposingPitcher: clean(row.pitcher?.name, 80) || null,
      }
    })

  const games = (slate?.games || []).filter((game) => finite(game?.gamePk)).map((game) => {
    const gamePk = Number(game.gamePk)
    return {
      entityKey: `game:${gamePk}`,
      matchup: gameMatchup(game),
      venue: clean(game.venueName, 100) || null,
      gameDate: validIso(game.gameDate) ? game.gameDate : null,
      pitchers: [game.awayPitcher, game.homePitcher]
        .filter((pitcher) => finite(pitcher?.id))
        .map((pitcher) => ({
          entityKey: `pitcher:${Number(pitcher.id)}:${gamePk}`,
          name: clean(pitcher.name || pitcher.fullName, 80),
        })),
      bullpens: [game.awayTeam, game.homeTeam].map((team) => {
        const id = finite(team?.id) ? Number(team.id) : clean(team?.abbr || team?.name, 20)
        return { entityKey: `bullpen:${id}:${gamePk}`, team: clean(team?.abbr, 8) }
      }),
    }
  })

  return { date: slate?.date || null, games, batters, entities }
}

function normalizeEvidence(rawEvidence) {
  const seen = new Set()
  const evidence = []
  for (const item of Array.isArray(rawEvidence) ? rawEvidence : []) {
    const url = validEvidenceUrl(item?.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    let hostname = ''
    try { hostname = new URL(url).hostname } catch { /* already validated */ }
    evidence.push({
      url,
      title: clean(item?.title || hostname, 160),
      publishedAt: validIso(item?.publishedAt) ? new Date(item.publishedAt).toISOString() : null,
    })
    if (evidence.length === 3) break
  }
  return evidence
}

function defaultExpiry(generatedAt, entity) {
  const generatedMs = Date.parse(generatedAt)
  const eightHours = generatedMs + 8 * 60 * 60 * 1000
  const gameMs = validIso(entity?.gameDate) ? Date.parse(entity.gameDate) : null
  const expiresMs = gameMs && gameMs > generatedMs
    ? Math.min(gameMs + 60 * 60 * 1000, generatedMs + 24 * 60 * 60 * 1000)
    : eightHours
  return new Date(expiresMs).toISOString()
}

/**
 * Converts untrusted LLM JSON into the only AI context shape the HR pipeline
 * may persist. Invalid, unsourced, or mis-targeted signals are rejected.
 */
export function normalizeAiHrContext({ raw, slate, generatedAt, model, source = 'llm-web-search' }) {
  const at = validIso(generatedAt) ? new Date(generatedAt).toISOString() : new Date().toISOString()
  const entityIndex = buildAiHrEntityIndex(slate)
  const candidates = Array.isArray(raw?.signals) ? raw.signals : Array.isArray(raw?.flags) ? raw.flags : []
  const signals = []
  const seen = new Set()
  let rejected = 0

  for (const candidate of candidates) {
    const entityKey = clean(candidate?.entityKey, 120)
    const entity = entityIndex.get(entityKey)
    const kind = clean(candidate?.kind, 32)
    const direction = clean(candidate?.direction, 16)
    const severity = clean(candidate?.severity, 16)
    const note = clean(candidate?.note, 280)
    const confidence = Number(candidate?.confidence)
    const evidence = normalizeEvidence(candidate?.evidence)
    const allowedEntityTypes = ENTITY_TYPES_BY_KIND[kind]

    if (
      !entity || !KIND_SET.has(kind) || !allowedEntityTypes?.has(entity.entityType) ||
      !DIRECTIONS.has(direction) || !SEVERITIES.has(severity) || !note ||
      !Number.isFinite(confidence) || confidence < 0 || confidence > 1 || !evidence.length
    ) {
      rejected++
      continue
    }

    let observedAt = validIso(candidate?.observedAt) ? new Date(candidate.observedAt).toISOString() : at
    const observedMs = Date.parse(observedAt)
    const generatedMs = Date.parse(at)
    if (observedMs > generatedMs + 5 * 60 * 1000 || observedMs < generatedMs - 7 * 24 * 60 * 60 * 1000) observedAt = at
    let expiresAt = validIso(candidate?.expiresAt) ? new Date(candidate.expiresAt).toISOString() : defaultExpiry(at, entity)
    if (Date.parse(expiresAt) <= Date.parse(observedAt) || Date.parse(expiresAt) > Date.parse(at) + 24 * 60 * 60 * 1000) {
      expiresAt = defaultExpiry(at, entity)
    }
    const duplicateKey = `${entityKey}|${kind}|${note.toLowerCase()}`
    if (seen.has(duplicateKey)) {
      rejected++
      continue
    }
    seen.add(duplicateKey)

    signals.push({
      id: `${entityKey}:${kind}:${signals.length + 1}`,
      entityKey,
      entityType: entity.entityType,
      entityId: entity.entityId,
      gamePk: entity.gamePk,
      entity: entity.name,
      team: entity.team,
      kind,
      direction,
      severity,
      confidence: Math.round(confidence * 100) / 100,
      note,
      observedAt,
      expiresAt,
      evidence,
    })
  }

  return {
    version: AI_HR_CONTEXT_VERSION,
    date: slate?.date || null,
    generatedAt: at,
    model: clean(model, 100) || 'unknown',
    source: clean(source, 80) || 'unknown',
    mode: AI_HR_CONTEXT_MODE,
    scoreImpact: false,
    signals,
    stats: { requested: candidates.length, accepted: signals.length, rejected },
  }
}

export function emptyAiHrContext({ date = null, generatedAt, model = 'unknown', source = 'llm-web-search', ...extra } = {}) {
  const at = validIso(generatedAt) ? new Date(generatedAt).toISOString() : new Date().toISOString()
  return {
    version: AI_HR_CONTEXT_VERSION,
    date,
    generatedAt: at,
    model: clean(model, 100) || 'unknown',
    source: clean(source, 80) || 'unknown',
    mode: AI_HR_CONTEXT_MODE,
    scoreImpact: false,
    signals: [],
    stats: { requested: 0, accepted: 0, rejected: 0 },
    ...extra,
  }
}

export function validateAiHrContext(context) {
  const errors = []
  const warnings = []
  if (!isObject(context)) return { ok: false, errors: ['context: expected an object'], warnings, metrics: {} }

  if (context.version !== AI_HR_CONTEXT_VERSION) errors.push(`version: expected ${AI_HR_CONTEXT_VERSION}`)
  if (context.mode !== AI_HR_CONTEXT_MODE) errors.push(`mode: expected ${AI_HR_CONTEXT_MODE}`)
  if (context.scoreImpact !== false) errors.push('scoreImpact: must be false in Phase 1')
  if (context.date != null && !/^\d{4}-\d{2}-\d{2}$/.test(context.date)) errors.push('date: expected YYYY-MM-DD or null')
  if (!validIso(context.generatedAt)) errors.push('generatedAt: expected an ISO timestamp')
  if (!clean(context.model, 100)) errors.push('model: required')
  if (!clean(context.source, 80)) errors.push('source: required')
  if (!Array.isArray(context.signals)) errors.push('signals: expected an array')

  const seenIds = new Set()
  for (let index = 0; index < (context.signals || []).length; index++) {
    const signal = context.signals[index]
    const at = `signals[${index}]`
    if (!isObject(signal)) {
      errors.push(`${at}: expected an object`)
      continue
    }
    for (const field of FORBIDDEN_SCORING_FIELDS) {
      if (Object.hasOwn(signal, field)) errors.push(`${at}.${field}: scoring fields are forbidden in advisory context`)
    }
    if (!signal.id || seenIds.has(signal.id)) errors.push(`${at}.id: required and unique`)
    seenIds.add(signal.id)
    if (!signal.entityKey || !ENTITY_TYPES.has(signal.entityType)) errors.push(`${at}: invalid entity target`)
    if (!finite(signal.entityId) && !clean(signal.entityId, 30)) errors.push(`${at}.entityId: required`)
    if (!finite(signal.gamePk)) errors.push(`${at}.gamePk: must be finite`)
    if (!clean(signal.entity, 80)) errors.push(`${at}.entity: required`)
    if (!KIND_SET.has(signal.kind)) errors.push(`${at}.kind: unsupported value`)
    if (KIND_SET.has(signal.kind) && !ENTITY_TYPES_BY_KIND[signal.kind].has(signal.entityType)) errors.push(`${at}: kind does not apply to entity type`)
    if (!DIRECTIONS.has(signal.direction)) errors.push(`${at}.direction: unsupported value`)
    if (!SEVERITIES.has(signal.severity)) errors.push(`${at}.severity: unsupported value`)
    if (!Number.isFinite(signal.confidence) || signal.confidence < 0 || signal.confidence > 1) errors.push(`${at}.confidence: expected [0,1]`)
    if (!clean(signal.note, 280)) errors.push(`${at}.note: required`)
    if (!validIso(signal.observedAt) || !validIso(signal.expiresAt)) errors.push(`${at}: observedAt and expiresAt must be ISO timestamps`)
    else if (Date.parse(signal.expiresAt) <= Date.parse(signal.observedAt)) errors.push(`${at}.expiresAt: must be after observedAt`)
    if (!Array.isArray(signal.evidence) || !signal.evidence.length) errors.push(`${at}.evidence: at least one source is required`)
    for (const evidence of signal.evidence || []) {
      if (!validEvidenceUrl(evidence?.url)) errors.push(`${at}.evidence: invalid source URL`)
      if (!clean(evidence?.title, 160)) errors.push(`${at}.evidence: source title is required`)
      if (evidence?.publishedAt != null && !validIso(evidence.publishedAt)) errors.push(`${at}.evidence.publishedAt: expected ISO timestamp or null`)
    }
  }

  const stats = context.stats
  if (!isObject(stats) || !['requested', 'accepted', 'rejected'].every((field) => Number.isInteger(stats?.[field]) && stats[field] >= 0)) {
    errors.push('stats: requested, accepted, and rejected must be non-negative integers')
  } else if (stats.accepted !== (context.signals || []).length || stats.requested !== stats.accepted + stats.rejected) {
    errors.push('stats: counts do not reconcile with signals')
  }

  if (!context.signals?.length && !context.skipped) warnings.push('signals: no sourced AI context accepted')
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      signals: context.signals?.length || 0,
      rejected: stats?.rejected || 0,
      entities: new Set((context.signals || []).map((signal) => signal.entityKey)).size,
    },
  }
}

export function assertValidAiHrContext(context) {
  const result = validateAiHrContext(context)
  if (result.ok) return result
  throw new Error(`AI HR context failed validation:\n- ${result.errors.join('\n- ')}`)
}
