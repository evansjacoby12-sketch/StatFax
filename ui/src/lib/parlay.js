import { decimalToAmerican } from './format.js'

// Quality grade for a built parlay — the legs' average model score mapped to a
// letter (same scale as the auto Parlay Combos cards, so the manual builder and
// the combo grades read consistently). Reflects how strong the picks are, not
// how likely all legs hit (that's the all-hit probability).
export function parlayGrade(legs) {
  if (!legs?.length) return null
  const avgScore = legs.reduce((s, b) => s + (b.score ?? 0), 0) / legs.length
  const letter = avgScore >= 76 ? 'S' : avgScore >= 70 ? 'A' : avgScore >= 62 ? 'B' : avgScore >= 54 ? 'C' : 'D'
  return { letter, avgScore }
}

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
