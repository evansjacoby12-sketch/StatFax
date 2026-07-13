export function buildNFLDataHealth({ generatedAt = new Date().toISOString(), games = [], players = [], quality = {}, providers = {}, overlayStatus = {} } = {}) {
  const feeds = [
    { id: 'schedule', label: 'Schedule', state: games.length ? 'ready' : 'limited', message: games.length ? `${games.length} games loaded` : 'No active slate found' },
    { id: 'rosters', label: 'Rosters', state: players.length ? 'ready' : 'critical', message: players.length ? `${players.length} eligible players loaded` : 'No eligible players loaded' },
    { id: 'depth', label: 'Depth charts', state: quality.depthChart ? 'ready' : 'limited', message: quality.depthChart ? 'Current ESPN depth order loaded' : 'Depth chart unavailable; historical role fallback active' },
    { id: 'lineups', label: 'Lineup intelligence', state: quality.lineups && Number(quality.lineupConfirmed || 0) > 0 ? 'ready' : 'limited', message: Number(quality.lineupConfirmed || 0) > 0 ? `${Number(quality.lineupConfirmed)} confirmed · ${Number(quality.routeParticipation || 0)} route profiles` : quality.lineups ? `${Number(quality.routeParticipation || 0)} projected route profiles · awaiting confirmations` : 'Projected roles active; confirmed package feed unavailable' },
    { id: 'availability', label: 'Availability', state: quality.officialAvailability ? 'ready' : 'limited', message: quality.officialAvailability ? 'Current roster and injury statuses loaded' : 'Current availability is incomplete' },
    { id: 'weather', label: 'Weather', state: quality.weatherFresh && Number(quality.weatherCoverage) >= .8 ? 'ready' : 'limited', message: `${Math.round(Number(quality.weatherCoverage || 0) * 100)}% game coverage` },
    { id: 'history', label: 'History', state: quality.playByPlay && quality.defenseByPosition ? 'ready' : 'limited', message: quality.playByPlay ? 'Play-by-play and defense context loaded' : 'Historical context limited' },
  ].map((feed) => ({ ...feed, provider: providers[feed.id] || null, freshness: overlayStatus[feed.id] || null }))
  const issues = feeds.filter((feed) => feed.state !== 'ready')
  return { generatedAt, status: feeds.some((feed) => feed.state === 'critical') ? 'critical' : issues.length ? 'limited' : 'ready', issues, feeds }
}
