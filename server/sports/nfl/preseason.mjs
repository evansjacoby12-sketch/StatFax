const playerKey = (player) => `${player.gameId}:${player.id}`
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0))
const ROLE_THRESHOLDS = {
  QB: { strong: 18, low: 6 },
  RB: { strong: 10, low: 3 },
  WR: { strong: 7, low: 2 },
  TE: { strong: 6, low: 2 },
}

const opportunityCount = (row = {}) => {
  const stats = row.live?.stats || {}
  if (row.position === 'QB') return Number(stats.attempts || 0) + Number(stats.carries || 0)
  if (row.position === 'RB') return Number(stats.carries || 0) + Number(stats.targets || 0)
  return Number(stats.targets || 0) + Number(stats.carries || 0)
}

function observation(player, at) {
  return {
    at,
    gameId: player.gameId,
    kickoffAt: player.kickoffAt,
    playerId: player.id,
    espnId: player.espnId || null,
    name: player.name,
    position: player.position,
    team: player.team,
    opponent: player.opponent,
    depthOrder: player.lineup?.depthOrder ?? player.usage?.roleRank ?? null,
    expectedSnapShare: player.lineup?.expectedSnapShare ?? null,
    routesPerDropback: player.lineup?.routesPerDropback ?? null,
    carryShare: player.lineup?.carryShare ?? null,
    redZoneRole: player.lineup?.redZone || null,
    participationSource: player.live?.isLive || player.live?.isFinal ? 'espn-box-score-observed-plus-projected-deployment' : 'projected-deployment',
    availability: player.availability || null,
    live: {
      isLive: Boolean(player.live?.isLive),
      isFinal: Boolean(player.live?.isFinal),
      stats: player.live?.stats || {},
    },
    participation: player.participation || null,
  }
}

export function indexNFLPreseasonParticipation(payload = {}) {
  const byKey = new Map(), byId = new Map()
  for (const row of payload?.players || []) {
    if (!row?.verified || !row?.source) continue
    if (row.gameId && row.espnId) byKey.set(`${row.gameId}:${row.espnId}`, row)
    if (row.espnId) byId.set(String(row.espnId), row)
  }
  return { byKey, byId, generatedAt: payload?.generatedAt || null, source: payload?.source || null }
}

export function preseasonParticipationFor(player, gameId, index) {
  return index?.byKey?.get(`${gameId}:${player?.espnId}`) || index?.byId?.get(String(player?.espnId || '')) || null
}

export function summarizeNFLPreseasonRoles(log = {}) {
  const groups = new Map()
  for (const record of log.games || []) {
    const row = record.closing
    if (!row?.live?.isFinal || !row.playerId) continue
    const group = groups.get(row.playerId) || { playerId: row.playerId, espnId: row.espnId || null, name: row.name, position: row.position, team: row.team, rows: [] }
    group.rows.push({ ...row, openedDepthOrder: record.opened?.depthOrder ?? null })
    groups.set(row.playerId, group)
  }
  const roles = [...groups.values()].map((group) => {
    const thresholds = ROLE_THRESHOLDS[group.position] || ROLE_THRESHOLDS.WR
    const opportunities = group.rows.map(opportunityCount)
    const gamesWithEvidence = opportunities.filter((value) => value >= thresholds.low).length
    const normalizedWork = opportunities.reduce((sum, value) => sum + clamp(value / thresholds.strong), 0) / Math.max(1, group.rows.length)
    const verifiedRows = group.rows.filter((row) => row.participation?.verified)
    const snapShares = verifiedRows.map((row) => Number(row.participation.snapShare)).filter(Number.isFinite)
    const routeShares = verifiedRows.map((row) => Number(row.participation.routeParticipation)).filter(Number.isFinite)
    const verifiedSnapShare = snapShares.length ? snapShares.reduce((sum, value) => sum + value, 0) / snapShares.length : null
    const verifiedRouteParticipation = routeShares.length ? routeShares.reduce((sum, value) => sum + value, 0) / routeShares.length : null
    const startingDepth = group.rows.map((row) => row.openedDepthOrder).find((value) => Number.isFinite(Number(value))) ?? null
    const currentDepth = group.rows.map((row) => row.depthOrder).filter((value) => Number.isFinite(Number(value))).at(-1) ?? startingDepth
    const depthChange = startingDepth != null && currentDepth != null ? Number(startingDepth) - Number(currentDepth) : 0
    const restedVeteran = Number(startingDepth) === 1 && opportunities.every((value) => value === 0) && verifiedRows.every((row) => Number(row.participation?.offenseSnaps || 0) === 0)
    const promotionEvidence = depthChange > 0
    const demotionEvidence = depthChange < 0
    const repeatedUsage = gamesWithEvidence >= 2
    const snapQualified = verifiedSnapShare != null && verifiedSnapShare >= .5
    const routeQualified = verifiedRouteParticipation != null && verifiedRouteParticipation >= .55
    const risingReady = promotionEvidence || repeatedUsage && (normalizedWork >= .65 || snapQualified || routeQualified)
    const fallingReady = demotionEvidence && group.rows.length >= 2 && normalizedWork < .35
    const status = restedVeteran ? 'rest-protected'
      : risingReady ? 'rising'
        : fallingReady ? 'falling'
          : gamesWithEvidence || verifiedRows.length ? 'watch' : 'uncertain'
    const adjustmentReady = status === 'rising' || status === 'falling'
    const factor = status === 'rising' ? 1.04 : status === 'falling' ? .96 : 1
    const redZoneOpportunities = group.rows.reduce((sum, row) => sum + Number(row.live?.stats?.redZoneOpportunities || 0), 0)
    const goalLineOpportunities = group.rows.reduce((sum, row) => sum + Number(row.live?.stats?.goalLineOpportunities || 0), 0)
    return {
      playerId: group.playerId, espnId: group.espnId, name: group.name, position: group.position, team: group.team,
      status, adjustmentReady, factor, games: group.rows.length, gamesWithEvidence,
      opportunities: opportunities.reduce((sum, value) => sum + value, 0), normalizedWork,
      redZoneOpportunities, goalLineOpportunities,
      startingDepth, currentDepth, depthChange, restedVeteran,
      verifiedParticipationGames: verifiedRows.length, verifiedSnapShare, verifiedRouteParticipation,
      evidence: {
        repeatedUsage, promotion: promotionEvidence, demotion: demotionEvidence,
        verifiedSnaps: snapShares.length > 0, verifiedRoutes: routeShares.length > 0,
      },
    }
  })
  return { version: 1, generatedAt: log.updatedAt || null, roles }
}

export function indexNFLPreseasonRoles(log = {}) {
  const summary = summarizeNFLPreseasonRoles(log)
  return {
    ...summary,
    byId: new Map(summary.roles.filter((role) => role.espnId).map((role) => [String(role.espnId), role])),
    byPlayerId: new Map(summary.roles.map((role) => [role.playerId, role])),
  }
}

export function preseasonRoleFor(player, index) {
  return index?.byId?.get(String(player?.espnId || '')) || index?.byPlayerId?.get(player?.id) || null
}

export function applyNFLPreseasonRole(lineup, role) {
  if (!lineup || !role) return lineup
  const direction = role.status === 'rising' ? 1 : role.status === 'falling' ? -1 : 0
  const factors = Object.fromEntries(Object.entries(lineup.marketFactors || {}).map(([market, value]) => {
    const cap = ['anytime_td', 'first_td', 'two_plus_td'].includes(market) ? .04 : .03
    const factor = role.adjustmentReady ? 1 + direction * cap : 1
    return [market, Number(value) * factor]
  }))
  return { ...lineup, preseasonRole: role, marketFactors: factors }
}

export function updateNFLPreseason(log = {}, previousSnapshot = null, currentSnapshot = null) {
  const games = new Map((log.games || []).map((game) => [game.id, game]))
  const snapshots = [previousSnapshot, currentSnapshot].flatMap((snapshot) => snapshot?.preseasonContext ? [snapshot.preseasonContext] : snapshot?.meta?.seasonType === 'preseason' ? [snapshot] : [])
  for (const snapshot of snapshots) {
    for (const player of snapshot.players || []) {
      const id = playerKey(player)
      const existing = games.get(id)
      const next = observation(player, snapshot.generatedAt)
      if (!existing) games.set(id, { id, opened: next, closing: next, observations: 1 })
      else if (existing.closing?.at !== next.at) games.set(id, { ...existing, closing: next, observations: Number(existing.observations || 1) + 1 })
    }
  }
  const rows = [...games.values()]
  const roleSummary = summarizeNFLPreseasonRoles({ ...log, updatedAt: currentSnapshot?.generatedAt || previousSnapshot?.generatedAt || log.updatedAt || null, games: rows })
  return {
    version: 1,
    sport: 'nfl',
    purpose: 'preseason-role-observation-only',
    excludedFromRegularSeasonCalibration: true,
    updatedAt: currentSnapshot?.generatedAt || previousSnapshot?.generatedAt || log.updatedAt || null,
    games: rows.sort((a, b) => String(b.closing?.kickoffAt).localeCompare(String(a.closing?.kickoffAt))).slice(0, 10000),
    roles: roleSummary.roles,
    summary: {
      players: new Set(rows.map((row) => row.closing?.playerId).filter(Boolean)).size,
      observations: rows.reduce((sum, row) => sum + Number(row.observations || 0), 0),
      finals: rows.filter((row) => row.closing?.live?.isFinal).length,
      depthMoves: rows.filter((row) => row.opened?.depthOrder != null && row.closing?.depthOrder != null && row.opened.depthOrder !== row.closing.depthOrder).length,
      risingRoles: roleSummary.roles.filter((role) => role.status === 'rising').length,
      fallingRoles: roleSummary.roles.filter((role) => role.status === 'falling').length,
      restProtected: roleSummary.roles.filter((role) => role.status === 'rest-protected').length,
      verifiedSnapProfiles: roleSummary.roles.filter((role) => role.evidence.verifiedSnaps).length,
      verifiedRouteProfiles: roleSummary.roles.filter((role) => role.evidence.verifiedRoutes).length,
    },
  }
}
