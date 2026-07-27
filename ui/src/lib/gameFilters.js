export const GAME_STATE_FILTERS = [
  { id: 'all', label: 'All games' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'live', label: 'Live' },
  { id: 'final', label: 'Final' },
]

export const GAME_TIME_FILTERS = [
  { id: 'all', label: 'Any time' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Early evening' },
  { id: 'late', label: 'Late' },
]

export function gameStateOf(game) {
  if (game?.isFinal) return 'final'
  if (game?.isLive) return 'live'
  return 'upcoming'
}

export function gameTimeWindowOf(gameDate) {
  if (!gameDate) return 'unknown'
  const date = new Date(gameDate)
  if (!Number.isFinite(date.getTime())) return 'unknown'
  const hour = date.getHours()
  if (hour < 17) return 'afternoon'
  if (hour < 21) return 'evening'
  return 'late'
}

function searchableGameText(game) {
  return [
    game?.awayTeam?.abbr,
    game?.awayTeam?.name,
    game?.homeTeam?.abbr,
    game?.homeTeam?.name,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase()
}

function gameTimeValue(game) {
  if (!game?.gameDate) return null
  const time = new Date(game?.gameDate).getTime()
  return Number.isFinite(time) ? time : null
}

export function filterAndSortGames(
  games,
  {
    query = '',
    state = 'all',
    timeWindow = 'all',
    sortDirection = 'asc',
  } = {},
) {
  const needle = String(query || '').trim().toLocaleLowerCase()
  const direction = sortDirection === 'desc' ? -1 : 1

  return [...(games || [])]
    .filter((game) => !needle || searchableGameText(game).includes(needle))
    .filter((game) => state === 'all' || gameStateOf(game) === state)
    .filter((game) => timeWindow === 'all' || gameTimeWindowOf(game?.gameDate) === timeWindow)
    .sort((a, b) => {
      const aTime = gameTimeValue(a)
      const bTime = gameTimeValue(b)
      if (aTime == null && bTime == null) return String(a?.gamePk || '').localeCompare(String(b?.gamePk || ''))
      if (aTime == null) return 1
      if (bTime == null) return -1
      return direction * (aTime - bTime) || String(a?.gamePk || '').localeCompare(String(b?.gamePk || ''))
    })
}
