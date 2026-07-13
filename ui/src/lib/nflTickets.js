const TD_MARKETS = new Set(['anytime_td', 'first_td', 'two_plus_td'])

export function nflLegKey(playerId, marketId) {
  return `${playerId}:${marketId}`
}

function currentValue(player, marketId) {
  const stats = player?.live?.stats || {}
  if (marketId === 'passing_yards') return Number(stats.passingYards || 0)
  if (marketId === 'receptions') return Number(stats.receptions || 0)
  if (marketId === 'receiving_yards') return Number(stats.receivingYards || 0)
  if (marketId === 'rushing_yards') return Number(stats.rushingYards || 0)
  if (marketId === 'rushing_receiving_yards') return Number(stats.rushingYards || 0) + Number(stats.receivingYards || 0)
  if (marketId === 'passing_rushing_yards') return Number(stats.passingYards || 0) + Number(stats.rushingYards || 0)
  return null
}

export function settleNFLLeg(leg, player) {
  if (!player) return { ...leg, status: 'unavailable', settledAt: null }
  const live = player.live || {}
  const touchdowns = Number(live.stats?.totalTds || 0)
  let won = false
  let decidable = false
  if (leg.marketId === 'anytime_td') { won = touchdowns >= 1; decidable = won || live.isFinal }
  else if (leg.marketId === 'two_plus_td') { won = touchdowns >= 2; decidable = won || live.isFinal }
  else if (leg.marketId === 'first_td') {
    won = Boolean(live.isFirstTdScorer)
    decidable = won || Boolean(live.firstTdKnown) || live.isFinal
    if (live.isFinal && !live.firstTdKnown && !won) return { ...leg, status: 'void', settledAt: new Date().toISOString() }
  } else {
    const value = currentValue(player, leg.marketId)
    won = Number.isFinite(value) && value > Number(leg.line)
    decidable = won || live.isFinal
  }
  const status = decidable ? (won ? 'won' : 'lost') : live.isLive ? 'live' : 'pending'
  return { ...leg, status, currentValue: TD_MARKETS.has(leg.marketId) ? touchdowns : currentValue(player, leg.marketId), settledAt: ['won', 'lost', 'void'].includes(status) ? new Date().toISOString() : null }
}

export function settleNFLTicket(ticket, snapshot) {
  const byId = new Map((snapshot?.players || []).map((player) => [player.id, player]))
  const legs = ticket.legs.map((leg) => settleNFLLeg(leg, byId.get(leg.playerId)))
  const statuses = new Set(legs.map((leg) => leg.status))
  const status = statuses.has('lost') ? 'lost'
    : [...statuses].every((value) => value === 'won' || value === 'void') ? 'won'
      : statuses.has('live') || statuses.has('won') ? 'live' : 'pending'
  return { ...ticket, legs, status, settledAt: ['won', 'lost'].includes(status) ? ticket.settledAt || new Date().toISOString() : null }
}

export function ticketExportText(ticket) {
  const lines = ticket.legs.map((leg) => `${leg.name} — ${leg.marketLabel}${leg.line != null && !TD_MARKETS.has(leg.marketId) ? ` over ${leg.line}` : ''} (${leg.status || 'pending'})`)
  return [`StatFax NFL ticket · ${ticket.status || 'pending'}`, ...lines].join('\n')
}

