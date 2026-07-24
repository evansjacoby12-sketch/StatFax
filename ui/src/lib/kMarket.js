import { americanToDecimal, americanToRawImplied } from './odds.js'

export const K_MARKET_MIN_EDGE = 0.03
export const K_MARKET_MIN_EV = 0.05

export function normalizeAmericanOdds(value) {
  if (value == null || value === '') return null
  const odds = Number(String(value).trim())
  if (!Number.isFinite(odds) || odds === 0 || Math.abs(odds) < 100) return null
  return odds
}

export function noVigProbability(selectedOdds, oppositeOdds) {
  const selected = americanToRawImplied(normalizeAmericanOdds(selectedOdds))
  const opposite = americanToRawImplied(normalizeAmericanOdds(oppositeOdds))
  if (selected == null || opposite == null) return null
  const total = selected + opposite
  return total > 0 ? selected / total : null
}

export function evaluateKMarket({
  overProbability,
  underProbability,
  overOdds,
  underOdds,
  side = 'over',
  minEdge = K_MARKET_MIN_EDGE,
  minEv = K_MARKET_MIN_EV,
} = {}) {
  const normalizedSide = side === 'under' ? 'under' : 'over'
  const over = Number(overProbability)
  const under = Number(underProbability)
  const hasOver = Number.isFinite(over)
  const hasUnder = Number.isFinite(under)
  const fairProbability = normalizedSide === 'over'
    ? hasOver ? over : null
    : hasUnder ? under : hasOver ? 1 - over : null
  const lossProbability = normalizedSide === 'over'
    ? hasUnder ? under : hasOver ? 1 - over : null
    : hasOver ? over : hasUnder ? 1 - under : null
  const pushProbability = fairProbability != null && lossProbability != null
    ? Math.max(0, 1 - fairProbability - lossProbability)
    : 0
  const selectedOdds = normalizeAmericanOdds(normalizedSide === 'over' ? overOdds : underOdds)
  const oppositeOdds = normalizeAmericanOdds(normalizedSide === 'over' ? underOdds : overOdds)
  const impliedProbability = americanToRawImplied(selectedOdds)
  const noVig = noVigProbability(selectedOdds, oppositeOdds)
  const comparisonProbability = noVig ?? impliedProbability
  const edge = fairProbability != null && comparisonProbability != null
    ? fairProbability - comparisonProbability
    : null
  const decimal = americanToDecimal(selectedOdds)
  const expectedRoi = fairProbability != null && lossProbability != null && decimal != null
    ? fairProbability * (decimal - 1) - lossProbability
    : null

  let status = 'add-line'
  let label = 'ADD LINE'
  let detail = 'Enter the sportsbook strikeout line to calculate the model probability.'
  if (fairProbability != null && selectedOdds == null) {
    status = 'add-price'
    label = 'ADD PRICE'
    detail = `Add the ${normalizedSide} price before judging value.`
  } else if (fairProbability != null && selectedOdds != null) {
    const bet = edge != null && expectedRoi != null && edge >= minEdge && expectedRoi >= minEv
    status = bet ? 'bet' : 'pass'
    label = bet ? `BET ${normalizedSide.toUpperCase()}` : 'PASS'
    detail = bet
      ? `Model edge and expected ROI clear the ${Math.round(minEdge * 100)}-point / ${Math.round(minEv * 100)}% thresholds.`
      : `Price does not clear both the ${Math.round(minEdge * 100)}-point edge and ${Math.round(minEv * 100)}% ROI thresholds.`
  }

  return {
    side: normalizedSide,
    selectedOdds,
    oppositeOdds,
    fairProbability,
    lossProbability,
    pushProbability,
    impliedProbability,
    noVigProbability: noVig,
    comparisonProbability,
    edge,
    edgeBasis: noVig == null ? 'raw-implied' : 'no-vig',
    expectedRoi,
    minEdge,
    minEv,
    status,
    label,
    detail,
  }
}
