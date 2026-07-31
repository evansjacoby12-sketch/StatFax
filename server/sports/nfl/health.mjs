const REQUIRED_MARKETS = ['passing_yards', 'receptions', 'receiving_yards', 'rushing_yards', 'rushing_receiving_yards', 'passing_rushing_yards', 'anytime_td', 'first_td', 'two_plus_td']

export function buildNFLReadiness({ generatedAt = new Date().toISOString(), games = [], players = [], quality = {}, modelPerformance = {}, tracking = {}, targeted = false } = {}) {
  const now = +new Date(generatedAt)
  const kickoff = games.filter((game) => game.status?.state === 'pre').map((game) => +new Date(game.date)).filter(Number.isFinite).sort((a, b) => a - b)[0]
  const hoursToKickoff = kickoff == null ? null : (kickoff - now) / 3600000
  const teams = new Set(games.flatMap((game) => [game.home?.abbr, game.away?.abbr]).filter(Boolean))
  const playerTeams = new Set(players.map((player) => player.team).filter(Boolean))
  const latestGameAt = games.map((game) => +new Date(game.date)).filter(Number.isFinite).sort((a, b) => b - a)[0]
  const staleCompletedSlate = games.length > 0 && games.every((game) => game.status?.state === 'post') && Number.isFinite(latestGameAt) && now - latestGameAt > 18 * 3600000
  const hasPerformance = modelPerformance?.markets && Object.keys(modelPerformance.markets).length > 0
  const emptyMarkets = hasPerformance ? REQUIRED_MARKETS.filter((id) => Number(modelPerformance.markets?.[id]?.samples || 0) === 0) : []
  const gates = [
    { id: 'slate-rollover', required: true, pass: games.length > 0 && !staleCompletedSlate, advisory: targeted, message: targeted ? 'Manual week override is active' : staleCompletedSlate ? 'Completed slate did not roll to the next week' : games.length ? 'Automatic active-slate selection is active' : 'No active slate selected' },
    { id: 'team-coverage', required: true, pass: teams.size > 0 && [...teams].every((team) => playerTeams.has(team)), message: `${playerTeams.size}/${teams.size} slate teams have eligible players` },
    { id: 'historical-coverage', required: hasPerformance, pass: !hasPerformance || emptyMarkets.length === 0, message: !hasPerformance ? 'Historical performance artifact not supplied to this check' : emptyMarkets.length ? `Zero samples: ${emptyMarkets.join(', ')}` : 'Every modeled market has walk-forward samples' },
    { id: 'roles', required: hoursToKickoff != null && hoursToKickoff <= 2, pass: Number(quality.lineupConfirmed || 0) > 0 || hoursToKickoff == null || hoursToKickoff > 2, message: Number(quality.lineupConfirmed || 0) > 0 ? `${quality.lineupConfirmed} confirmed player roles` : 'Awaiting game-day role confirmations' },
    { id: 'availability', required: hoursToKickoff != null && hoursToKickoff <= 24, pass: Boolean(quality.officialAvailability), message: quality.officialAvailability ? 'Roster and injury availability is current' : 'Availability feed is incomplete' },
    { id: 'weather', required: hoursToKickoff != null && hoursToKickoff <= 24, pass: Boolean(quality.weatherFresh) && Number(quality.weatherCoverage || 0) >= .8, message: `${Math.round(Number(quality.weatherCoverage || 0) * 100)}% weather coverage` },
    { id: 'tracking', required: false, pass: tracking?.updatedAt != null || Number(tracking?.open || 0) === 0, message: tracking?.updatedAt ? `Tracking updated ${tracking.updatedAt}` : 'Tracking will initialize with the first slate' },
  ]
  const blocking = gates.filter((gate) => gate.required && !gate.pass)
  return { generatedAt, status: blocking.length ? 'blocked' : 'ready', hoursToKickoff, blocking: blocking.map((gate) => gate.id), gates }
}

export function buildNFLDataHealth({ generatedAt = new Date().toISOString(), games = [], players = [], quality = {}, providers = {}, overlayStatus = {}, modelPerformance = {}, tracking = {}, targeted = false } = {}) {
  const feeds = [
    { id: 'schedule', label: 'Schedule', state: games.length ? 'ready' : 'limited', message: games.length ? `${games.length} games loaded` : 'No active slate found' },
    { id: 'rosters', label: 'Rosters', state: players.length ? 'ready' : 'critical', message: players.length ? `${players.length} eligible players loaded` : 'No eligible players loaded' },
    { id: 'depth', label: 'Depth charts', state: quality.depthChart ? 'ready' : 'limited', message: quality.depthChart ? 'Current ESPN depth order loaded' : 'Depth chart unavailable; historical role fallback active' },
    { id: 'lineups', label: 'Lineup intelligence', state: quality.lineups && Number(quality.lineupConfirmed || 0) > 0 ? 'ready' : 'limited', message: Number(quality.lineupConfirmed || 0) > 0 ? `${Number(quality.lineupConfirmed)} confirmed · ${Number(quality.routeParticipation || 0)} route profiles` : quality.lineups ? `${Number(quality.routeParticipation || 0)} projected route profiles · awaiting confirmations` : 'Projected roles active; confirmed package feed unavailable' },
    { id: 'availability', label: 'Availability', state: quality.officialAvailability ? 'ready' : 'limited', message: quality.officialAvailability ? 'Current roster and injury statuses loaded' : 'Current availability is incomplete' },
    { id: 'weather', label: 'Weather', state: quality.weatherFresh && Number(quality.weatherCoverage) >= .8 ? 'ready' : 'limited', message: `${Math.round(Number(quality.weatherCoverage || 0) * 100)}% game coverage` },
    { id: 'history', label: 'History', state: quality.playByPlay && quality.defenseByPosition ? 'ready' : 'limited', message: quality.playByPlay ? 'Play-by-play and defense context loaded' : 'Historical context limited' },
  ].map((feed) => ({ ...feed, provider: providers[feed.id] || null, freshness: overlayStatus[feed.id] || null }))
  const readiness = buildNFLReadiness({ generatedAt, games, players, quality, modelPerformance, tracking, targeted })
  const alarms = [
    ...feeds.filter((feed) => feed.state === 'critical').map((feed) => ({ id: `${feed.id}-critical`, severity: 'critical', message: feed.message })),
    ...feeds.filter((feed) => ['schedule', 'depth', 'availability'].includes(feed.id) && feed.state === 'limited').map((feed) => ({ id: `${feed.id}-limited`, severity: feed.id === 'schedule' ? 'critical' : 'warning', message: feed.message })),
    ...readiness.gates.filter((gate) => gate.required && !gate.pass).map((gate) => ({ id: gate.id, severity: gate.id === 'historical-coverage' || gate.id === 'slate-rollover' ? 'critical' : 'warning', message: gate.message })),
  ]
  const issues = feeds.filter((feed) => feed.state !== 'ready')
  return { generatedAt, status: alarms.some((alarm) => alarm.severity === 'critical') ? 'critical' : issues.length || alarms.length ? 'limited' : 'ready', issues, alarms, feeds, readiness }
}
