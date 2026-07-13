export const NFL_PROP_MARKETS = Object.freeze({
  anytime_td: { id: 'anytime_td', label: 'Anytime TD', shortLabel: 'Anytime TD', positions: ['QB', 'RB', 'WR', 'TE'], kind: 'touchdown' },
  first_td: { id: 'first_td', label: 'First TD Scorer', shortLabel: 'First TD', positions: ['QB', 'RB', 'WR', 'TE'], kind: 'touchdown' },
  two_plus_td: { id: 'two_plus_td', label: '2+ Touchdowns', shortLabel: '2+ TD', positions: ['QB', 'RB', 'WR', 'TE'], kind: 'touchdown' },
  passing_yards: { id: 'passing_yards', label: 'Passing Yards', shortLabel: 'Pass Yds', positions: ['QB'], kind: 'yardage', lineMin: 150, projectionKey: 'passingYards' },
  receptions: { id: 'receptions', label: 'Receptions', shortLabel: 'Receptions', positions: ['RB', 'WR', 'TE'], kind: 'volume', lineMin: 3, projectionKey: 'receptions' },
  receiving_yards: { id: 'receiving_yards', label: 'Receiving Yards', shortLabel: 'Rec Yds', positions: ['RB', 'WR', 'TE'], kind: 'yardage', lineMin: 150, projectionKey: 'receivingYards' },
  rushing_yards: { id: 'rushing_yards', label: 'Rushing Yards', shortLabel: 'Rush Yds', positions: ['QB', 'RB', 'WR'], kind: 'yardage', lineMin: 40, projectionKey: 'rushingYards' },
  rushing_receiving_yards: { id: 'rushing_receiving_yards', label: 'Rushing + Receiving Yards', shortLabel: 'Rush + Rec', positions: ['RB', 'WR', 'TE'], kind: 'combo', lineMin: 40, projectionKey: 'rushingReceivingYards' },
  passing_rushing_yards: { id: 'passing_rushing_yards', label: 'Passing + Rushing Yards', shortLabel: 'Pass + Rush', positions: ['QB'], kind: 'combo', lineMin: 150, projectionKey: 'passingRushingYards' },
})

export const NFL_PROP_MARKET_LIST = Object.freeze(Object.values(NFL_PROP_MARKETS))

export function propLineFor(player, marketId) {
  const direct = player?.propLines?.[marketId]
  if (Number.isFinite(Number(direct))) return Number(direct)
  const quoteLine = player?.markets?.[marketId]?.line
  return Number.isFinite(Number(quoteLine)) ? Number(quoteLine) : null
}

export function isPropEligible(player, marketId) {
  const market = NFL_PROP_MARKETS[marketId]
  if (!market || !player || !market.positions.includes(player.position)) return false
  if (market.kind === 'touchdown') return true
  const line = propLineFor(player, marketId)
  return line != null && line >= market.lineMin
}

export function eligiblePropMarkets(player) {
  return NFL_PROP_MARKET_LIST.filter((market) => isPropEligible(player, market.id))
}

export function eligibilityReason(player, marketId) {
  const market = NFL_PROP_MARKETS[marketId]
  if (!market) return 'Unknown market'
  if (!player || !market.positions.includes(player.position)) return `${player?.position || 'Player'} is not eligible for ${market.label}`
  if (market.kind === 'touchdown') return 'Eligible scorer position'
  const line = propLineFor(player, marketId)
  if (line == null) return `Missing ${market.label.toLowerCase()} line`
  if (line < market.lineMin) return `Line ${line} is below the ${market.lineMin} eligibility minimum`
  return `Eligible at ${line}`
}
