/**
 * Advisory POWER READY beta signal. This is deliberately a strict intersection:
 * top-end contact quality, a favorable matchup, credible current form, and a
 * real recent sample must all be present. It is safe to display, filter, and
 * backtest, but must not be used as an additive score/probability adjustment.
 */

// Single source of truth for the gate thresholds — the signal AND the readable
// criteria breakdown both read these, so a label can never drift from the logic.
export const POWER_READY_GATES = { ceiling: 75, matchup: 60, form: 35, bbe: 6, swings: 25 }

/**
 * The four gates as a labeled, human-readable checklist for display:
 * [{ key, label, value, need, met, unit }]. `met` is the pass/fail the signal
 * ANDs together. Works for any bat, so the UI can show WHY a bat did or didn't
 * qualify (e.g. "Matchup 57 · needs ≥60 ✗").
 */
export function powerReadyCriteria(b) {
  const recentBBE = b?.recentBarrel?.recentBBE
  const recentSwings = b?.batTracking?.recentSwings
  const sampleMet = (Number.isFinite(recentBBE) && recentBBE >= POWER_READY_GATES.bbe)
    || (Number.isFinite(recentSwings) && recentSwings >= POWER_READY_GATES.swings)
  const sampleValue = Number.isFinite(recentBBE) ? recentBBE
    : Number.isFinite(recentSwings) ? recentSwings : null
  const sampleUnit = Number.isFinite(recentBBE) ? 'batted balls'
    : Number.isFinite(recentSwings) ? 'swings' : ''
  return [
    { key: 'ceiling', label: 'Power ceiling', value: b?.ceilScore, need: POWER_READY_GATES.ceiling,
      met: Number.isFinite(b?.ceilScore) && b.ceilScore >= POWER_READY_GATES.ceiling,
      blurb: 'elite raw-power upside when squared up' },
    { key: 'matchup', label: 'Matchup', value: b?.matchupScore, need: POWER_READY_GATES.matchup,
      met: Number.isFinite(b?.matchupScore) && b.matchupScore >= POWER_READY_GATES.matchup,
      blurb: 'facing a favorable pitcher / park' },
    { key: 'form', label: 'Recent form', value: b?.formScore, need: POWER_READY_GATES.form,
      met: Number.isFinite(b?.formScore) && b.formScore >= POWER_READY_GATES.form,
      blurb: 'not in a cold slump (a floor, not a peak)' },
    { key: 'sample', label: 'Recent sample', value: sampleValue, need: POWER_READY_GATES.bbe,
      met: sampleMet, unit: sampleUnit, isSample: true,
      blurb: 'enough recent contact to trust the read' },
  ]
}

export function powerReadySignal(b) {
  return powerReadyCriteria(b).every((c) => c.met)
}

// ── BARREL READY (beta) ──────────────────────────────────────────────────────
// The complement to POWER READY: our take on Barrel Lab's "Barrel Signal". Where
// POWER READY demands elite power + a favorable MATCHUP (form only a floor),
// BARREL READY demands solid power + genuinely HOT form, with NO matchup gate —
// so it surfaces bats heating up right now that POWER READY's matchup filter
// would pass on. Advisory + beta, same as POWER READY: display/filter/log only.
export const BARREL_READY_GATES = { ceiling: 70, form: 60, bbe: 6, swings: 25 }

export function barrelReadyCriteria(b) {
  const recentBBE = b?.recentBarrel?.recentBBE
  const recentSwings = b?.batTracking?.recentSwings
  const sampleMet = (Number.isFinite(recentBBE) && recentBBE >= BARREL_READY_GATES.bbe)
    || (Number.isFinite(recentSwings) && recentSwings >= BARREL_READY_GATES.swings)
  const sampleValue = Number.isFinite(recentBBE) ? recentBBE
    : Number.isFinite(recentSwings) ? recentSwings : null
  const sampleUnit = Number.isFinite(recentBBE) ? 'batted balls'
    : Number.isFinite(recentSwings) ? 'swings' : ''
  return [
    { key: 'ceiling', label: 'Power ceiling', value: b?.ceilScore, need: BARREL_READY_GATES.ceiling,
      met: Number.isFinite(b?.ceilScore) && b.ceilScore >= BARREL_READY_GATES.ceiling,
      blurb: 'solid raw-power upside' },
    { key: 'form', label: 'Recent form', value: b?.formScore, need: BARREL_READY_GATES.form,
      met: Number.isFinite(b?.formScore) && b.formScore >= BARREL_READY_GATES.form,
      blurb: 'genuinely hot — a real surge, not just "not cold"' },
    { key: 'sample', label: 'Recent sample', value: sampleValue, need: BARREL_READY_GATES.bbe,
      met: sampleMet, unit: sampleUnit, isSample: true,
      blurb: 'enough recent contact to trust the read' },
  ]
}

export function barrelReadySignal(b) {
  return barrelReadyCriteria(b).every((c) => c.met)
}
