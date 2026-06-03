import { decimalToAmerican } from './format.js'

// Combine parlay legs. Model probability assumes leg independence (HRs by
// different batters are close enough to independent for a quick read).
// Market figures only resolve when EVERY leg has a priced book.
export function computeParlay(legs) {
  const n = legs.length
  let modelProb = n ? 1 : 0
  let decimal = 1
  let priced = 0
  for (const b of legs) {
    modelProb *= b.hrProbability ?? 0
    const d = b.odds?.best?.decimal
    if (d && d > 1) {
      decimal *= d
      priced++
    }
  }
  const allPriced = n > 0 && priced === n
  const fairDecimal = modelProb > 0 ? 1 / modelProb : null
  return {
    n,
    priced,
    allPriced,
    modelProb,
    fairAmerican: fairDecimal ? decimalToAmerican(fairDecimal) : null,
    decimal: allPriced ? decimal : null,
    american: allPriced ? decimalToAmerican(decimal) : null,
    impliedProb: allPriced ? 1 / decimal : null,
    edge: allPriced ? modelProb * decimal - 1 : null,
  }
}
