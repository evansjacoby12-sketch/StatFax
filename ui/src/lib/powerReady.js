/**
 * Advisory POWER READY beta signal. This is deliberately a strict intersection:
 * top-end contact quality, a favorable matchup, credible current form, and a
 * real recent sample must all be present. It is safe to display, filter, and
 * backtest, but must not be used as an additive score/probability adjustment.
 */
export function powerReadySignal(b) {
  const recentBBE = b?.recentBarrel?.recentBBE
  const recentSwings = b?.batTracking?.recentSwings
  const hasRecentSample = (Number.isFinite(recentBBE) && recentBBE >= 6)
    || (Number.isFinite(recentSwings) && recentSwings >= 25)

  return hasRecentSample
    && Number.isFinite(b?.ceilScore) && b.ceilScore >= 75
    && Number.isFinite(b?.formScore) && b.formScore >= 35
    && Number.isFinite(b?.matchupScore) && b.matchupScore >= 60
}
