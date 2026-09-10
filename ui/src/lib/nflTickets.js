const TD_MARKETS = new Set(['anytime_td', 'first_td', 'two_plus_td'])

export function isNFLTDMarket(marketId) {
  return TD_MARKETS.has(marketId)
}

export function nflLegKey(playerId, marketId, side = 'over') {
  if (isNFLTDMarket(marketId)) return `${playerId}:${marketId}`
  return `${playerId}:${marketId}:${side === 'under' ? 'under' : 'over'}`
}

export function parseNFLLegKey(key) {
  if (!key) return { playerId: '', marketId: '', side: 'over' }
  const parts = String(key).split(':')
  if (parts.length >= 3) {
    return { playerId: parts[0], marketId: parts[1], side: parts[2] === 'under' ? 'under' : 'over' }
  }
  return { playerId: parts[0] || '', marketId: parts[1] || '', side: 'over' }
}

export function marketUnitLabel(marketId) {
  if (marketId === 'receptions') return 'REC'
  if (isNFLTDMarket(marketId)) return 'TD'
  return 'YDS'
}

export function currentNFLStatValue(player, marketId) {
  const stats = player?.live?.stats || {}
  if (marketId === 'passing_yards') return Number(stats.passingYards || 0)
  if (marketId === 'receptions') return Number(stats.receptions || 0)
  if (marketId === 'receiving_yards') return Number(stats.receivingYards || 0)
  if (marketId === 'rushing_yards') return Number(stats.rushingYards || 0)
  if (marketId === 'rushing_receiving_yards') return Number(stats.rushingYards || 0) + Number(stats.receivingYards || 0)
  if (marketId === 'passing_rushing_yards') return Number(stats.passingYards || 0) + Number(stats.rushingYards || 0)
  if (isNFLTDMarket(marketId)) return Number(stats.totalTds || 0)
  return null
}

export function getNFLPropSettlement(player, marketId, line = null, side = 'over') {
  if (!player?.live) return { status: 'pending', value: null, label: null, won: false, decidable: false }
  const live = player.live || {}
  const touchdowns = Number(live.stats?.totalTds || 0)
  const isTD = isNFLTDMarket(marketId)
  const unit = marketUnitLabel(marketId)
  const value = isTD ? touchdowns : currentNFLStatValue(player, marketId)
  const isFinal = Boolean(live.isFinal)
  const isLive = Boolean(live.isLive)

  if (!isLive && !isFinal) {
    return { status: 'pending', value: null, label: null, unit, won: false, decidable: false }
  }

  let won = false
  let lost = false
  let push = false
  let decidable = false

  if (marketId === 'anytime_td') {
    won = touchdowns >= 1
    lost = isFinal && !won
    decidable = won || isFinal
  } else if (marketId === 'two_plus_td') {
    won = touchdowns >= 2
    lost = isFinal && !won
    decidable = won || isFinal
  } else if (marketId === 'first_td') {
    won = Boolean(live.isFirstTdScorer)
    lost = (Boolean(live.firstTdKnown) && !won) || (isFinal && !won)
    decidable = won || lost || isFinal
    if (isFinal && !live.firstTdKnown && !won) {
      return { status: 'void', value, label: `${touchdowns} ${unit}`, unit, won: false, decidable: true }
    }
  } else {
    const numericLine = Number(line)
    const effectiveSide = side === 'under' ? 'under' : 'over'
    if (Number.isFinite(value) && Number.isFinite(numericLine)) {
      if (value === numericLine && isFinal) {
        push = true
        decidable = true
      } else if (effectiveSide === 'over') {
        won = value > numericLine
        lost = isFinal && value <= numericLine
        decidable = won || isFinal
      } else {
        // Under side
        won = isFinal && value < numericLine
        lost = value > numericLine
        decidable = lost || isFinal
      }
    } else {
      decidable = isFinal
    }
  }

  const status = push ? 'push' : won ? 'won' : lost ? 'lost' : isLive ? 'live' : 'pending'
  const statLabel = value != null ? `${value} ${unit}` : null

  return {
    status,
    value,
    line,
    side,
    unit,
    label: statLabel,
    won,
    lost,
    push,
    decidable,
    isLive,
    isFinal,
  }
}

export function settleNFLLeg(leg, player) {
  if (!player) return { ...leg, status: 'unavailable', settledAt: null }
  const side = leg.side === 'under' ? 'under' : 'over'
  const settlement = getNFLPropSettlement(player, leg.marketId, leg.line, side)
  return {
    ...leg,
    side,
    status: settlement.status,
    currentValue: settlement.value,
    settledAt: ['won', 'lost', 'void', 'push'].includes(settlement.status) ? (leg.settledAt || new Date().toISOString()) : null,
  }
}

export function settleNFLTicket(ticket, snapshot) {
  const byId = new Map((snapshot?.players || []).map((player) => [player.id, player]))
  const legs = ticket.legs.map((leg) => settleNFLLeg(leg, byId.get(leg.playerId)))
  const statuses = new Set(legs.map((leg) => leg.status))
  const status = statuses.has('lost') ? 'lost'
    : [...statuses].every((value) => value === 'void' || value === 'push') ? (statuses.has('push') ? 'push' : 'void')
      : [...statuses].every((value) => value === 'won' || value === 'void' || value === 'push') ? 'won'
        : statuses.has('live') || statuses.has('won') ? 'live' : 'pending'
  return { ...ticket, legs, status, settledAt: ['won', 'lost', 'void', 'push'].includes(status) ? ticket.settledAt || new Date().toISOString() : null }
}

export function ticketExportText(ticket) {
  const lines = ticket.legs.map((leg) => {
    const sideText = isNFLTDMarket(leg.marketId) ? '' : ` ${leg.side === 'under' ? 'under' : 'over'} ${leg.line}`
    return `${leg.name} — ${leg.marketLabel}${sideText} (${leg.status || 'pending'})`
  })
  return [`StatFax NFL ticket · ${ticket.status || 'pending'}`, ...lines].join('\n')
}

const decimalOdds = (american) => !Number.isFinite(Number(american)) || Number(american) === 0 ? null : Number(american) > 0 ? 1 + Number(american) / 100 : 1 + 100 / Math.abs(Number(american))

export function nflTicketProfit(ticket) {
  if (!['won', 'lost'].includes(ticket?.status)) return null
  const activeLegs = (ticket.legs || []).filter((leg) => leg.status !== 'void' && leg.status !== 'push')
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
  const header = ['ticket_id', 'created_at', 'ticket_status', 'ticket_profit_units', 'player', 'market', 'side', 'line', 'odds', 'probability', 'leg_status', 'result']
  const rows = tickets.flatMap((ticket) => (ticket.legs || []).map((leg) => [ticket.id, ticket.createdAt, ticket.status, nflTicketProfit(ticket), leg.name, leg.marketLabel, leg.side || 'over', leg.line, leg.odds, leg.probability, leg.status, leg.currentValue]))
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
}

