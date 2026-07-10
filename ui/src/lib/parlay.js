// Backward-compatible facade over the unified parlayMath core. Existing callers
// Legacy callers import parlay + grade helpers from
// here; they now resolve to the single source in ./parlayMath.js. New code
// should import buildParlay/parlayAllHit from ./parlayMath.js directly.

import { buildParlay } from './parlayMath.js'

export { parlayGrade, gameCorrelation, correlatedJoint, parlayAllHit, buildParlay } from './parlayMath.js'

// Legacy shape used by the old quick-slip summary. Independent (cross-game)
// product by default to preserve prior behavior. All current surfaces use the
// same independent all-hit estimate.
export function computeParlay(legs) {
  const p = buildParlay(legs, { correlate: false })
  return {
    n: p.n,
    priced: p.priced,
    allPriced: p.allPriced,
    modelProb: p.modelAllHit,
    fairDecimal: p.fairDecimal,
    fairAmerican: p.fairAmerican,
    decimal: p.decimal,
    american: p.american,
    impliedProb: p.allPriced && p.decimal ? 1 / p.decimal : null,
    edge: p.allPriced && p.decimal ? p.modelAllHit * p.decimal - 1 : null,
  }
}
