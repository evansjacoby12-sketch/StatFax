import { validateAiHrContext } from './aiHrContext.mjs'
import { validateMlbDataHealth } from './mlbDataHealth.mjs'

export const MLB_DATA_HEALTH_HISTORY_VERSION = 1
export const MLB_DATA_HEALTH_HISTORY_MODE = 'watchdog-history'
export const MLB_DATA_HEALTH_HISTORY_RETENTION_DAYS = 180

const OUTCOMES = new Set(['pending', 'confirmed', 'not-confirmed', 'unverifiable'])
const measurableKinds = new Set(['starter-change', 'opener-risk', 'scratch-risk', 'lineup-status'])
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const same = (left, right) => left != null && right != null && String(left) === String(right)
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const round = (value, digits = 4) => Number(Number(value).toFixed(digits))

function hash(value) {
  let output = 2166136261
  for (const char of String(value)) {
    output ^= char.charCodeAt(0)
    output = Math.imul(output, 16777619)
  }
  return (output >>> 0).toString(36)
}

function alertId(date, signal) {
  return `${date}:${signal.entityKey}:${signal.kind}:${hash(`${signal.note}|${signal.evidence?.[0]?.url || ''}`)}`
}

function inningsToOuts(value) {
  const [whole, partial = '0'] = String(value ?? '').split('.')
  const innings = Number(whole)
  const outs = Number(partial)
  if (!Number.isInteger(innings) || ![0, 1, 2].includes(outs)) return null
  return innings * 3 + outs
}

function teamFacts(team = {}) {
  const players = Object.values(team.players || {})
  const starter = players.find((player) => Number(player?.stats?.pitching?.gamesStarted) > 0)
  const fallbackStarterId = Array.isArray(team.pitchers) && finite(team.pitchers[0]) ? Number(team.pitchers[0]) : null
  const starterId = finite(starter?.person?.id) ? Number(starter.person.id) : fallbackStarterId
  const starterPitching = starter?.stats?.pitching || (
    starterId ? players.find((player) => same(player?.person?.id, starterId))?.stats?.pitching : null
  )
  const appearedPlayerIds = []
  const startingBatterIds = []
  for (const player of players) {
    const playerId = finite(player?.person?.id) ? Number(player.person.id) : null
    const battingOrder = finite(player?.battingOrder) ? Number(player.battingOrder) : null
    if (!playerId || battingOrder == null) continue
    appearedPlayerIds.push(playerId)
    if (battingOrder % 100 === 0) startingBatterIds.push(playerId)
  }
  return {
    starterId,
    starterPitches: finite(starterPitching?.numberOfPitches) ? Number(starterPitching.numberOfPitches) : null,
    starterOuts: inningsToOuts(starterPitching?.inningsPitched),
    appearedPlayerIds: [...new Set(appearedPlayerIds)].sort((a, b) => a - b),
    startingBatterIds: [...new Set(startingBatterIds)].sort((a, b) => a - b),
  }
}

export function parseMlbOfficialFacts({ date, schedule, boxscoresByGame = {}, fetchedAt = new Date().toISOString() }) {
  const games = {}
  const scheduled = (schedule?.dates || []).flatMap((day) => day?.games || [])
  for (const game of scheduled) {
    if (!finite(game?.gamePk)) continue
    const gamePk = Number(game.gamePk)
    const status = String(game?.status?.detailedState || game?.status?.abstractGameState || '').trim() || null
    const final = game?.status?.abstractGameState === 'Final' || ['F', 'O'].includes(game?.status?.codedGameState)
    const boxscore = boxscoresByGame?.[gamePk] || boxscoresByGame?.[String(gamePk)] || null
    const away = final && boxscore ? teamFacts(boxscore?.teams?.away) : teamFacts()
    const home = final && boxscore ? teamFacts(boxscore?.teams?.home) : teamFacts()
    games[gamePk] = {
      gamePk,
      final,
      boxscoreAvailable: Boolean(boxscore),
      status,
      awayStarterId: away.starterId,
      homeStarterId: home.starterId,
      starterWorkloads: Object.fromEntries([
        away.starterId ? [away.starterId, { pitches: away.starterPitches, outs: away.starterOuts }] : null,
        home.starterId ? [home.starterId, { pitches: home.starterPitches, outs: home.starterOuts }] : null,
      ].filter(Boolean)),
      appearedPlayerIds: [...new Set([...away.appearedPlayerIds, ...home.appearedPlayerIds])].sort((a, b) => a - b),
      startingBatterIds: [...new Set([...away.startingBatterIds, ...home.startingBatterIds])].sort((a, b) => a - b),
    }
  }
  return {
    date,
    fetchedAt: validIso(fetchedAt) ? new Date(fetchedAt).toISOString() : new Date().toISOString(),
    allFinal: scheduled.length > 0 && Object.values(games).every((game) => game.final),
    games,
  }
}

export async function fetchMlbOfficialFacts(date, { fetchImpl = fetch } = {}) {
  const base = 'https://statsapi.mlb.com/api/v1'
  const response = await fetchImpl(`${base}/schedule?sportId=1&date=${date}`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`MLB schedule ${date} failed (${response.status})`)
  const schedule = await response.json()
  const boxscoresByGame = {}
  const games = (schedule?.dates || []).flatMap((day) => day?.games || [])
  await Promise.all(games.map(async (game) => {
    const final = game?.status?.abstractGameState === 'Final' || ['F', 'O'].includes(game?.status?.codedGameState)
    if (!final || !finite(game?.gamePk)) return
    const boxscoreResponse = await fetchImpl(`${base}/game/${Number(game.gamePk)}/boxscore`, { headers: { Accept: 'application/json' } })
    if (boxscoreResponse.ok) boxscoresByGame[Number(game.gamePk)] = await boxscoreResponse.json()
  }))
  return parseMlbOfficialFacts({ date, schedule, boxscoresByGame })
}

function emptyHistory(updatedAt) {
  return {
    version: MLB_DATA_HEALTH_HISTORY_VERSION,
    mode: MLB_DATA_HEALTH_HISTORY_MODE,
    updatedAt,
    retentionDays: MLB_DATA_HEALTH_HISTORY_RETENTION_DAYS,
    recordsByDate: {},
    metrics: historyMetrics({ recordsByDate: {} }),
  }
}

function captureAlert(date, signal, game, generatedAt) {
  return {
    id: alertId(date, signal),
    signalId: signal.id,
    entityKey: signal.entityKey,
    entityType: signal.entityType,
    entityId: signal.entityId,
    gamePk: Number(signal.gamePk),
    kind: signal.kind,
    direction: signal.direction,
    severity: signal.severity,
    confidence: signal.confidence,
    note: signal.note,
    evidence: structuredClone(signal.evidence),
    listedStarterIds: [game?.awayPitcher?.id, game?.homePitcher?.id].filter(finite).map(Number).sort((a, b) => a - b),
    firstSeenAt: generatedAt,
    lastSeenAt: generatedAt,
    outcome: 'pending',
    settlement: null,
  }
}

export function captureMlbDataHealthHistory({ previous, slate, report, context, updatedAt = new Date().toISOString(), retentionDays = MLB_DATA_HEALTH_HISTORY_RETENTION_DAYS }) {
  if (!validateMlbDataHealth({ slate, report }).ok) throw new Error('cannot capture an invalid MLB data health report')
  if (!validateAiHrContext(context).ok) throw new Error('cannot capture an invalid AI context')
  const at = validIso(updatedAt) ? new Date(updatedAt).toISOString() : new Date().toISOString()
  const base = validateMlbDataHealthHistory(previous).ok ? structuredClone(previous) : emptyHistory(at)
  const date = slate.date
  const priorEntry = base.recordsByDate[date] || { alerts: [] }
  const byId = new Map((priorEntry.alerts || []).map((alert) => [alert.id, alert]))
  const games = new Map((slate.games || []).map((game) => [Number(game.gamePk), game]))
  const activeSignalIds = new Set((report.issues || []).filter((issue) => issue.source === 'ai-context').map((issue) => issue.signalId))
  for (const signal of context.signals || []) {
    if (!activeSignalIds.has(signal.id)) continue
    const captured = captureAlert(date, signal, games.get(Number(signal.gamePk)), report.generatedAt)
    const prior = byId.get(captured.id)
    byId.set(captured.id, prior ? { ...prior, signalId: signal.id, lastSeenAt: report.generatedAt } : captured)
  }
  base.recordsByDate[date] = {
    date,
    firstCapturedAt: priorEntry.firstCapturedAt || report.generatedAt,
    lastCapturedAt: report.generatedAt,
    slateGeneratedAt: report.slateGeneratedAt,
    status: report.status,
    counts: structuredClone(report.counts),
    alerts: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
  }
  const cutoff = Date.parse(`${date}T00:00:00.000Z`) - (Math.max(1, retentionDays) - 1) * 86400000
  base.recordsByDate = Object.fromEntries(Object.entries(base.recordsByDate)
    .filter(([key]) => validDate(key) && Date.parse(`${key}T00:00:00.000Z`) >= cutoff)
    .sort(([left], [right]) => left.localeCompare(right)))
  base.updatedAt = at
  base.retentionDays = retentionDays
  base.metrics = historyMetrics(base)
  return base
}

function settleAlert(alert, game, settledAt) {
  if (!game?.final || !game?.boxscoreAvailable) return alert
  const finish = (outcome, basis, observed) => ({
    ...alert,
    outcome,
    settlement: { settledAt, basis, observed },
  })
  if (!measurableKinds.has(alert.kind)) {
    return finish('unverifiable', 'No objective MLB box-score rule is defined for this alert kind.', null)
  }
  if (alert.kind === 'starter-change') {
    const actual = [game.awayStarterId, game.homeStarterId].filter(finite).map(Number).sort((a, b) => a - b)
    if (!actual.length) return finish('unverifiable', 'Final box score did not identify either starting pitcher.', null)
    const changed = alert.entityType === 'pitcher'
      ? !actual.some((pitcherId) => same(pitcherId, alert.entityId))
      : JSON.stringify(actual) !== JSON.stringify((alert.listedStarterIds || []).slice().sort((a, b) => a - b))
    return finish(changed ? 'confirmed' : 'not-confirmed', 'Compared captured probable starter identity with official final starters.', { actualStarterIds: actual })
  }
  if (alert.kind === 'opener-risk') {
    const actual = [game.awayStarterId, game.homeStarterId].filter(finite).map(Number)
    if (!actual.length || alert.entityType !== 'pitcher') return finish('unverifiable', 'Opener settlement requires a targeted pitcher and official starter identity.', null)
    if (!actual.some((pitcherId) => same(pitcherId, alert.entityId))) {
      return finish('confirmed', 'Targeted probable pitcher did not start the game.', { actualStarterIds: actual })
    }
    const workload = game.starterWorkloads?.[alert.entityId] || game.starterWorkloads?.[String(alert.entityId)] || null
    if (!workload || (!finite(workload.pitches) && !finite(workload.outs))) return finish('unverifiable', 'Official starter workload was unavailable.', null)
    const short = (finite(workload.pitches) && Number(workload.pitches) <= 55) || (finite(workload.outs) && Number(workload.outs) <= 9)
    return finish(short ? 'confirmed' : 'not-confirmed', 'Checked official starter identity and opener-sized workload (≤55 pitches or ≤9 outs).', { actualStarterIds: actual, workload })
  }
  if (alert.entityType !== 'batter') return finish('unverifiable', 'Lineup settlement requires a batter target.', null)
  const appeared = (game.appearedPlayerIds || []).some((playerId) => same(playerId, alert.entityId))
  if (alert.kind === 'scratch-risk') {
    return finish(appeared ? 'not-confirmed' : 'confirmed', 'Checked whether the targeted batter appeared in the official final box score.', { appeared })
  }
  const started = (game.startingBatterIds || []).some((playerId) => same(playerId, alert.entityId))
  return finish(started ? 'not-confirmed' : 'confirmed', 'Checked whether the targeted batter was in the official starting lineup.', { appeared, started })
}

export function settleMlbDataHealthHistory({ history, factsByDate = {}, updatedAt = new Date().toISOString() }) {
  const output = structuredClone(history)
  const at = validIso(updatedAt) ? new Date(updatedAt).toISOString() : new Date().toISOString()
  for (const [date, entry] of Object.entries(output.recordsByDate || {})) {
    const facts = factsByDate instanceof Map ? factsByDate.get(date) : factsByDate?.[date]
    if (!facts) continue
    entry.alerts = (entry.alerts || []).map((alert) => (
      alert.outcome === 'pending' ? settleAlert(alert, facts.games?.[alert.gamePk] || facts.games?.[String(alert.gamePk)], at) : alert
    ))
  }
  output.updatedAt = at
  output.metrics = historyMetrics(output)
  return output
}

function metricBucket(alerts) {
  const confirmed = alerts.filter((alert) => alert.outcome === 'confirmed').length
  const notConfirmed = alerts.filter((alert) => alert.outcome === 'not-confirmed').length
  const settled = confirmed + notConfirmed
  return {
    alerts: alerts.length,
    settled,
    confirmed,
    notConfirmed,
    pending: alerts.filter((alert) => alert.outcome === 'pending').length,
    unverifiable: alerts.filter((alert) => alert.outcome === 'unverifiable').length,
    confirmationRate: settled ? round(confirmed / settled) : null,
  }
}

export function historyMetrics(history) {
  const entries = Object.values(history?.recordsByDate || {})
  const alerts = entries.flatMap((entry) => entry.alerts || [])
  const byKind = {}
  for (const kind of [...new Set(alerts.map((alert) => alert.kind))].sort()) byKind[kind] = metricBucket(alerts.filter((alert) => alert.kind === kind))
  return {
    days: entries.length,
    ...metricBucket(alerts),
    byKind,
  }
}

export function validateMlbDataHealthHistory(history) {
  const errors = []
  const warnings = []
  if (!isObject(history)) return { ok: false, errors: ['history: expected an object'], warnings, metrics: {} }
  if (history.version !== MLB_DATA_HEALTH_HISTORY_VERSION) errors.push(`version: expected ${MLB_DATA_HEALTH_HISTORY_VERSION}`)
  if (history.mode !== MLB_DATA_HEALTH_HISTORY_MODE) errors.push(`mode: expected ${MLB_DATA_HEALTH_HISTORY_MODE}`)
  if (!validIso(history.updatedAt)) errors.push('updatedAt: expected ISO timestamp')
  if (!Number.isInteger(history.retentionDays) || history.retentionDays < 1 || history.retentionDays > MLB_DATA_HEALTH_HISTORY_RETENTION_DAYS) errors.push('retentionDays: out of range')
  if (!isObject(history.recordsByDate)) errors.push('recordsByDate: expected an object')
  const ids = new Set()
  for (const [date, entry] of Object.entries(history.recordsByDate || {})) {
    if (!validDate(date) || entry?.date !== date) errors.push(`recordsByDate.${date}: invalid date identity`)
    if (!validIso(entry?.firstCapturedAt) || !validIso(entry?.lastCapturedAt)) errors.push(`recordsByDate.${date}: capture timestamps are required`)
    if (!Array.isArray(entry?.alerts)) { errors.push(`recordsByDate.${date}.alerts: expected an array`); continue }
    for (const [index, alert] of entry.alerts.entries()) {
      const at = `recordsByDate.${date}.alerts[${index}]`
      if (!alert?.id || ids.has(alert.id)) errors.push(`${at}.id: required and globally unique`)
      ids.add(alert?.id)
      if (!finite(alert?.gamePk) || !alert?.entityKey || !alert?.kind) errors.push(`${at}: game and entity identity are required`)
      if (!validIso(alert?.firstSeenAt) || !validIso(alert?.lastSeenAt)) errors.push(`${at}: seen timestamps are required`)
      if (!OUTCOMES.has(alert?.outcome)) errors.push(`${at}.outcome: unsupported value`)
      if (!Array.isArray(alert?.evidence) || !alert.evidence.length) errors.push(`${at}.evidence: at least one source is required`)
      if (alert.outcome === 'pending' && alert.settlement != null) errors.push(`${at}.settlement: pending alerts cannot be settled`)
      if (alert.outcome !== 'pending' && (!validIso(alert?.settlement?.settledAt) || !alert?.settlement?.basis)) errors.push(`${at}.settlement: settled alerts require timestamp and basis`)
    }
  }
  const expected = historyMetrics(history)
  if (JSON.stringify(history.metrics) !== JSON.stringify(expected)) errors.push('metrics: do not reconcile with alert records')
  if (!expected.alerts) warnings.push('alerts: no sourced watchdog alerts captured yet')
  return { ok: errors.length === 0, errors, warnings, metrics: expected }
}

export function assertValidMlbDataHealthHistory(history) {
  const result = validateMlbDataHealthHistory(history)
  if (result.ok) return result
  throw new Error(`MLB data health history failed validation:\n- ${result.errors.join('\n- ')}`)
}
