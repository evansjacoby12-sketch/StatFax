// Pure ticket identity helper kept separate from the React-backed ticket store
// so engine contract tests can run without loading browser dependencies.
export function ticketId(legs, date) {
  const ids = (legs || [])
    .filter((leg) => leg?.playerId != null)
    .map((leg) => leg.gamePk != null ? `${leg.playerId}@${leg.gamePk}` : String(leg.playerId))
    .sort()
    .join('-')
  return `${date || '?'}:${ids}`
}
