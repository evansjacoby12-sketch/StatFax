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

const decimalOdds = (american) => !Number.isFinite(Number(american)) || Number(american) === 0 ? null : Number(american) > 0 ? 1 + Number(american) / 100 : 1 + 100 / Math.abs(Number(american))

export function nflTicketProfit(ticket) {
  if (!['won', 'lost'].includes(ticket?.status)) return null
  const activeLegs = (ticket.legs || []).filter((leg) => leg.status !== 'void')
  if (!activeLegs.length) return 0
  const prices = activeLegs.map((leg) => decimalOdds(leg.odds))
  if (prices.some((price) => price == null)) return null
  const stake = Number(ticket.stake || 1)
  return ticket.status === 'won' ? stake * (prices.reduce((product, price) => product * price, 1) - 1) : -stake
}

export function summarizeNFLTickets(tickets = []) {
  const settled = tickets.filter((ticket) => ['won', 'lost'].includes(ticket.status))
  const won = settled.filter((ticket) => ticket.status === 'won').length
  const priced = settled.map(nflTicketProfit).filter(Number.isFinite)
  const profit = priced.reduce((sum, value) => sum + value, 0)
  const stake = settled.filter((ticket) => Number.isFinite(nflTicketProfit(ticket))).reduce((sum, ticket) => sum + Number(ticket.stake || 1), 0)
  const markets = {}
  for (const ticket of tickets) for (const leg of ticket.legs || []) {
    const bucket = markets[leg.marketId] ||= { marketId: leg.marketId, label: leg.marketLabel || leg.marketId || 'Unknown market', settled: 0, wins: 0, losses: 0 }
    if (leg.status === 'won') { bucket.settled++; bucket.wins++ }
    if (leg.status === 'lost') { bucket.settled++; bucket.losses++ }
  }
  return { total: tickets.length, settled: settled.length, won, lost: settled.length - won, hitRate: settled.length ? won / settled.length : null, profit: stake ? profit : null, roi: stake ? profit / stake : null, priced: priced.length, markets: Object.values(markets).sort((a, b) => b.settled - a.settled || a.label.localeCompare(b.label)) }
}

export function filterNFLTickets(tickets = [], { status = 'all', market = 'all', query = '' } = {}) {
  const normalized = query.trim().toLowerCase()
  return tickets.filter((ticket) => status === 'all' || ticket.status === status)
    .filter((ticket) => market === 'all' || ticket.legs?.some((leg) => leg.marketId === market))
    .filter((ticket) => !normalized || ticket.legs?.some((leg) => `${leg.name} ${leg.marketLabel} ${leg.marketId}`.toLowerCase().includes(normalized)))
}

const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`

export function nflTicketsCSV(tickets = []) {
  const header = ['ticket_id', 'created_at', 'ticket_status', 'ticket_profit_units', 'player', 'market', 'line', 'odds', 'probability', 'leg_status', 'result']
  const rows = tickets.flatMap((ticket) => (ticket.legs || []).map((leg) => [ticket.id, ticket.createdAt, ticket.status, nflTicketProfit(ticket), leg.name, leg.marketLabel, leg.line, leg.odds, leg.probability, leg.status, leg.currentValue]))
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

