import { legStatus } from './live.js'
import { americanToDecimal } from './odds.js'

const finiteNumber = (value) => {
  if (value === '' || value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function gradeTicket(ticket, batters = []) {
  const byGame = new Map()
  const byPlayer = new Map()
  const ambiguousPlayers = new Set()
  for (const batter of batters || []) {
    const playerId = Number(batter.playerId)
    if (byPlayer.has(playerId)) ambiguousPlayers.add(playerId)
    else byPlayer.set(playerId, batter)
    if (batter.gamePk != null) byGame.set(`${Number(batter.playerId)}:${batter.gamePk}`, batter)
  }

  const legs = (ticket?.legs || []).map((leg) => {
    const batter = leg.gamePk != null
      ? byGame.get(`${Number(leg.playerId)}:${leg.gamePk}`)
      : ambiguousPlayers.has(Number(leg.playerId)) ? null : byPlayer.get(Number(leg.playerId))
    const status = batter ? legStatus(batter) : null
    return {
      ...leg,
      batter: batter || null,
      code: batter ? status.code : 'unknown',
      statusLabel: batter ? status.label : 'unavailable',
      final: batter?.game?.isFinal === true,
      legacyIdentity: leg.gamePk == null,
    }
  })

  const found = legs.length > 0 && legs.every((leg) => leg.code !== 'unknown')
  const hits = legs.filter((leg) => leg.code === 'hit').length
  const allFinal = found && legs.every((leg) => leg.final || leg.code === 'hit')
  let status = 'unknown'
  if (ticket?.settled) status = ticket.settled.cashed ? 'cashed' : 'dead'
  else if (found && hits === legs.length) status = 'cashed'
  else if (found && legs.some((leg) => leg.code === 'dead')) status = 'dead'
  else if (found && legs.some((leg) => leg.code !== 'pending')) status = 'live'
  else if (found) status = 'pending'

  return { ticket, legs, hits, n: legs.length, status, allFinal }
}

export function ticketEconomics(ticket, status) {
  const wager = finiteNumber(ticket?.wager)
  const american = finiteNumber(ticket?.american)
  const decimal = finiteNumber(ticket?.decimal) || americanToDecimal(american)
  const complete = wager != null && wager > 0 && decimal != null && decimal > 1
  const projectedPayout = complete ? wager * decimal : null
  let profit = null
  if (complete && status === 'cashed') profit = wager * (decimal - 1)
  else if (complete && (status === 'dead' || status === 'lost')) profit = -wager
  return { wager, american, decimal, complete, projectedPayout, profit }
}

export function summarizeTickets(graded = []) {
  const settled = graded.filter((item) => item.status === 'cashed' || item.status === 'dead' || item.status === 'lost')
  const priced = settled
    .map((item) => ({ ...item, economics: ticketEconomics(item.ticket, item.status) }))
    .filter((item) => item.economics.profit != null)
  const risked = priced.reduce((sum, item) => sum + item.economics.wager, 0)
  const net = priced.reduce((sum, item) => sum + item.economics.profit, 0)
  const open = graded.filter((item) => item.status === 'live' || item.status === 'pending')
  const knownExposure = open.reduce((sum, item) => sum + (ticketEconomics(item.ticket, item.status).wager || 0), 0)
  return {
    settled: settled.length,
    wins: settled.filter((item) => item.status === 'cashed').length,
    pricedSettled: priced.length,
    risked,
    net,
    roi: risked > 0 ? net / risked : null,
    open: open.length,
    live: graded.filter((item) => item.status === 'live').length,
    knownExposure,
  }
}
