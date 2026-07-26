export const PREGAME_FREEZE_PITCHER_PROVENANCE = 'pregame-freeze'

const finiteId = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const sameId = (left, right) => finiteId(left) && finiteId(right) && String(left) === String(right)

/**
 * Restore the prediction-time row once a game is live without hiding a starter
 * correction that arrived after the pregame snapshot was taken.
 *
 * `pitcher` remains the pitcher the published prediction was actually scored
 * against. `currentPitcher` records the corrected starter from the live feed.
 */
export function restoreFrozenLiveRow(row, snapshot) {
  const liveContext = row?.liveContext
  const currentPitcher = row?.pitcher ?? null
  const predictionPitcher = snapshot?.pitcher ?? null
  const pitcherChanged = finiteId(currentPitcher?.id)
    && finiteId(predictionPitcher?.id)
    && !sameId(currentPitcher.id, predictionPitcher.id)

  Object.assign(row, snapshot)
  if (liveContext !== undefined) row.liveContext = liveContext

  if (pitcherChanged) {
    row.currentPitcher = currentPitcher
    row.pitcherChanged = true
    row.pitcherProvenance = PREGAME_FREEZE_PITCHER_PROVENANCE
  } else {
    delete row.currentPitcher
    delete row.pitcherProvenance
  }

  return { pitcherChanged }
}

export function isValidFrozenPitcherCorrection(row, game, expectedPitcherId) {
  if (game?.isLive !== true && game?.isFinal !== true) return false
  if (row?.pitcherChanged !== true) return false
  if (row?.pitcherProvenance !== PREGAME_FREEZE_PITCHER_PROVENANCE) return false
  if (!finiteId(row?.pitcher?.id) || !finiteId(row?.currentPitcher?.id)) return false
  if (sameId(row.pitcher.id, row.currentPitcher.id)) return false
  return sameId(row.currentPitcher.id, expectedPitcherId)
}
