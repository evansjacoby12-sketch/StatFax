const STREAK_FIELDS = {
  touchdown: (game) => Number(game.totalTds ?? 0) > 0,
  receptions: (game) => Number(game.receptions ?? 0) >= 3,
  passing: (game) => Number(game.passingYards ?? 0) >= 200,
  rushing: (game) => Number(game.rushingYards ?? 0) >= 40,
  receiving: (game) => Number(game.receivingYards ?? 0) >= 50,
}

export function consecutiveGames(games = [], predicate) {
  let streak = 0
  for (const game of games) {
    if (!predicate(game)) break
    streak += 1
  }
  return streak
}

export function nflStreakSignals(player) {
  const games = [...(player?.recentGames || [])].sort((a, b) => Number(b.season || 0) - Number(a.season || 0) || Number(b.week || 0) - Number(a.week || 0))
  const labels = {
    touchdown: 'TD', receptions: '3+ REC', passing: '200+ PASS', rushing: '40+ RUSH', receiving: '50+ REC YDS',
  }
  return Object.entries(STREAK_FIELDS)
    .map(([key, predicate]) => ({ key, games: consecutiveGames(games, predicate), label: labels[key] }))
    .filter((signal) => signal.games >= 2)
    .map((signal) => ({ ...signal, text: `${signal.games}G ${signal.label} streak`, tone: signal.games >= 3 ? 'hot' : 'neutral' }))
}

export function nflRoleSignals(player) {
  const usage = player?.usage || {}
  const signals = []
  if (Number(usage.redZoneTargetsL3) >= 5) signals.push({ key: 'rz-targets', text: `${usage.redZoneTargetsL3} RZ targets L3`, tone: 'prime' })
  if (Number(usage.redZoneTouchesL3) >= 10) signals.push({ key: 'rz-touches', text: `${usage.redZoneTouchesL3} RZ touches L3`, tone: 'prime' })
  if (Number(usage.goalLineTouchesL3) >= 4) signals.push({ key: 'goal-line', text: 'Goal-line role', tone: 'strong' })
  if (Number(usage.targetShare) >= 0.25) signals.push({ key: 'target-share', text: `${Math.round(usage.targetShare * 100)}% target share`, tone: 'strong' })
  if (Number(usage.snapShare) >= 0.8) signals.push({ key: 'snap-share', text: `${Math.round(usage.snapShare * 100)}% snaps`, tone: 'neutral' })
  return signals
}

export function buildNFLSignals(player) {
  const split = Number(player?.splits?.activeEdge ?? 0)
  const splitLabel = player?.isHome ? 'Home' : 'Away'
  const splitSignal = Math.abs(split) >= 0.04 ? [{ key: 'split', text: `${splitLabel} edge ${split >= 0 ? '+' : ''}${Math.round(split * 100)}%`, tone: split > 0 ? 'strong' : 'warn' }] : []
  return [...nflStreakSignals(player), ...nflRoleSignals(player), ...splitSignal]
}
