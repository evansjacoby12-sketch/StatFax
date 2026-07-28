const sameGame = (left, right) => (
  left != null
  && right != null
  && String(left) === String(right)
)

export function gameMarketPortfolioSelection(portfolio, gamePk, market) {
  return (portfolio?.selections || []).find((selection) => (
    sameGame(selection?.gamePk, gamePk)
    && selection?.market === market
  )) || null
}

export function gameMarketValidation(marketEvaluation, market) {
  const performance = marketEvaluation?.markets?.[market]
  const promotion = performance?.promotion
  const actionable = performance?.actionable
  const status = promotion?.status || 'collecting'
  return {
    status,
    label: status === 'eligible'
      ? 'Validated'
      : status === 'hold'
        ? 'Hold'
        : 'Collecting',
    decisions: actionable?.decisions || 0,
    dates: actionable?.dates || 0,
    minimumGames: promotion?.minimumGames
      || marketEvaluation?.minimumSample?.games
      || 100,
    minimumDates: promotion?.minimumDates
      || marketEvaluation?.minimumSample?.dates
      || 10,
    drift: performance?.drift?.status || 'collecting',
  }
}

export function gameMarketMovementCaution(projection, market, decision) {
  const movement = projection?.marketTracking?.movement
  const selectedSide = decision?.selectedSide
  if (!movement?.material || !selectedSide) return null

  if (market === 'moneyline') {
    const homeProbability = movement.moneylineHomeProbability
    const homePrice = movement.moneylineHomePrice
    const probabilityAgainst = movement.changed?.includes('moneyline-probability')
      && Number.isFinite(homeProbability)
      && (
      (selectedSide === 'home' && homeProbability < 0)
      || (selectedSide === 'away' && homeProbability > 0)
    )
    const priceAgainst = movement.changed?.includes('moneyline-price')
      && Number.isFinite(homePrice)
      && (
        (selectedSide === 'home' && homePrice > 0)
        || (selectedSide === 'away' && homePrice < 0)
      )
    return probabilityAgainst || priceAgainst
      ? 'Market moved against this side'
      : null
  }

  if (market === 'total') {
    const totalLine = movement.totalLine
    const overPrice = movement.overPrice
    const lineAgainst = movement.changed?.includes('total-line')
      && Number.isFinite(totalLine)
      && (
      (selectedSide === 'over' && totalLine < 0)
      || (selectedSide === 'under' && totalLine > 0)
    )
    const priceAgainst = movement.changed?.includes('total-price')
      && Number.isFinite(overPrice)
      && (
        (selectedSide === 'over' && overPrice > 0)
        || (selectedSide === 'under' && overPrice < 0)
      )
    return lineAgainst || priceAgainst
      ? 'Market moved against this total'
      : null
  }

  return null
}
