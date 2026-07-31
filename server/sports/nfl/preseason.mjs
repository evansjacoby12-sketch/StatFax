const playerKey = (player) => `${player.gameId}:${player.id}`

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
  }
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
  return {
    version: 1,
    sport: 'nfl',
    purpose: 'preseason-role-observation-only',
    excludedFromRegularSeasonCalibration: true,
    updatedAt: currentSnapshot?.generatedAt || previousSnapshot?.generatedAt || log.updatedAt || null,
    games: rows.sort((a, b) => String(b.closing?.kickoffAt).localeCompare(String(a.closing?.kickoffAt))).slice(0, 10000),
    summary: {
      players: new Set(rows.map((row) => row.closing?.playerId).filter(Boolean)).size,
      observations: rows.reduce((sum, row) => sum + Number(row.observations || 0), 0),
      finals: rows.filter((row) => row.closing?.live?.isFinal).length,
      depthMoves: rows.filter((row) => row.opened?.depthOrder != null && row.closing?.depthOrder != null && row.opened.depthOrder !== row.closing.depthOrder).length,
    },
  }
}
