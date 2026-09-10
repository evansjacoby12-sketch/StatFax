import test from 'node:test'
import assert from 'node:assert/strict'

import { filterNFLTickets, getNFLPropSettlement, nflLegKey, nflTicketProfit, nflTicketsCSV, parseNFLLegKey, settleNFLLeg, settleNFLTicket, summarizeNFLTickets, ticketExportText } from '../ui/src/lib/nflTickets.js'

const leg = (marketId, line = null, side = 'over') => ({ key: nflLegKey('p1', marketId, side), playerId: 'p1', name: 'Test Player', marketId, marketLabel: marketId, line, side, status: 'pending' })

test('NFL touchdown legs settle early on achieved results', () => {
  const player = { live: { isLive: true, stats: { totalTds: 2 } } }
  assert.equal(settleNFLLeg(leg('anytime_td'), player).status, 'won')
  assert.equal(settleNFLLeg(leg('two_plus_td'), player).status, 'won')
})

test('NFL yardage legs settle over and under at final and preserve live progress', () => {
  assert.equal(settleNFLLeg(leg('rushing_yards', 40, 'over'), { live: { isLive: true, stats: { rushingYards: 25 } } }).status, 'live')
  assert.equal(settleNFLLeg(leg('rushing_yards', 40, 'over'), { live: { isFinal: true, stats: { rushingYards: 45 } } }).status, 'won')
  assert.equal(settleNFLLeg(leg('rushing_yards', 40, 'over'), { live: { isFinal: true, stats: { rushingYards: 39 } } }).status, 'lost')

  // Under settlement
  assert.equal(settleNFLLeg(leg('rushing_yards', 40, 'under'), { live: { isLive: true, stats: { rushingYards: 25 } } }).status, 'live')
  assert.equal(settleNFLLeg(leg('rushing_yards', 40, 'under'), { live: { isLive: true, stats: { rushingYards: 45 } } }).status, 'lost')
  assert.equal(settleNFLLeg(leg('rushing_yards', 40, 'under'), { live: { isFinal: true, stats: { rushingYards: 35 } } }).status, 'won')
  assert.equal(settleNFLLeg(leg('rushing_yards', 40, 'under'), { live: { isFinal: true, stats: { rushingYards: 45 } } }).status, 'lost')
})

test('getNFLPropSettlement returns formatted settlement status and stats', () => {
  const finalJSN = { live: { isFinal: true, stats: { receivingYards: 122, totalTds: 1 } } }
  const jsnOver = getNFLPropSettlement(finalJSN, 'receiving_yards', 54.5, 'over')
  assert.equal(jsnOver.status, 'won')
  assert.equal(jsnOver.value, 122)
  assert.equal(jsnOver.label, '122 YDS')

  const jsnUnder = getNFLPropSettlement(finalJSN, 'receiving_yards', 54.5, 'under')
  assert.equal(jsnUnder.status, 'lost')

  const jsnTD = getNFLPropSettlement(finalJSN, 'anytime_td')
  assert.equal(jsnTD.status, 'won')
  assert.equal(jsnTD.label, '1 TD')
})

test('First TD voids when the final feed cannot identify the scorer', () => {
  const result = settleNFLLeg(leg('first_td'), { live: { isFinal: true, firstTdKnown: false, stats: {} } })
  assert.equal(result.status, 'void')
})

test('ticket settlement and export summarize every leg with side support', () => {
  const ticket = {
    id: 't1',
    createdAt: '2026-09-01T00:00:00Z',
    status: 'pending',
    legs: [
      leg('anytime_td'),
      { ...leg('receptions', 3, 'over'), key: nflLegKey('p2', 'receptions', 'over'), playerId: 'p2', name: 'Receiver' },
      { ...leg('rushing_yards', 60, 'under'), key: nflLegKey('p3', 'rushing_yards', 'under'), playerId: 'p3', name: 'Runner' },
    ],
  }
  const snapshot = { players: [
    { id: 'p1', live: { isFinal: true, stats: { totalTds: 1 } } },
    { id: 'p2', live: { isFinal: true, stats: { receptions: 5 } } },
    { id: 'p3', live: { isFinal: true, stats: { rushingYards: 45 } } },
  ] }
  const settled = settleNFLTicket(ticket, snapshot)
  assert.equal(settled.status, 'won')
  assert.match(ticketExportText(settled), /Receiver — receptions over 3/)
  assert.match(ticketExportText(settled), /Runner — rushing_yards under 60/)
})

test('parseNFLLegKey parses keys with and without explicit side', () => {
  assert.deepEqual(parseNFLLegKey('p1:receiving_yards:under'), { playerId: 'p1', marketId: 'receiving_yards', side: 'under' })
  assert.deepEqual(parseNFLLegKey('p1:receiving_yards:over'), { playerId: 'p1', marketId: 'receiving_yards', side: 'over' })
  assert.deepEqual(parseNFLLegKey('p1:anytime_td'), { playerId: 'p1', marketId: 'anytime_td', side: 'over' })
})

test('ticket ledger computes unit profit, filters history, market splits, and CSV', () => {
  const tickets = [
    { id: 'won', createdAt: '2026-09-01T00:00:00Z', status: 'won', stake: 1, legs: [{ ...leg('anytime_td'), odds: 150, status: 'won' }] },
    { id: 'lost', createdAt: '2026-09-02T00:00:00Z', status: 'lost', stake: 1, legs: [{ ...leg('rushing_yards', 40, 'over'), odds: -110, status: 'lost' }] },
  ]
  assert.equal(nflTicketProfit(tickets[0]), 1.5)
  assert.equal(nflTicketProfit(tickets[1]), -1)
  const summary = summarizeNFLTickets(tickets)
  assert.equal(summary.profit, .5)
  assert.equal(summary.roi, .25)
  assert.equal(filterNFLTickets(tickets, { status: 'won' }).length, 1)
  assert.match(nflTicketsCSV(tickets), /ticket_profit_units/)
  assert.match(nflTicketsCSV(tickets), /"Test Player"/)
})

