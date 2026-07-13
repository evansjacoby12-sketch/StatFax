import test from 'node:test'
import assert from 'node:assert/strict'

import { nflLegKey, settleNFLLeg, settleNFLTicket, ticketExportText } from '../ui/src/lib/nflTickets.js'

const leg = (marketId, line = null) => ({ key: nflLegKey('p1', marketId), playerId: 'p1', name: 'Test Player', marketId, marketLabel: marketId, line, status: 'pending' })

test('NFL touchdown legs settle early on achieved results', () => {
  const player = { live: { isLive: true, stats: { totalTds: 2 } } }
  assert.equal(settleNFLLeg(leg('anytime_td'), player).status, 'won')
  assert.equal(settleNFLLeg(leg('two_plus_td'), player).status, 'won')
})

test('NFL yardage legs settle over at final and preserve live progress', () => {
  assert.equal(settleNFLLeg(leg('rushing_yards', 40), { live: { isLive: true, stats: { rushingYards: 25 } } }).status, 'live')
  assert.equal(settleNFLLeg(leg('rushing_yards', 40), { live: { isFinal: true, stats: { rushingYards: 45 } } }).status, 'won')
  assert.equal(settleNFLLeg(leg('rushing_yards', 40), { live: { isFinal: true, stats: { rushingYards: 39 } } }).status, 'lost')
})

test('First TD voids when the final feed cannot identify the scorer', () => {
  const result = settleNFLLeg(leg('first_td'), { live: { isFinal: true, firstTdKnown: false, stats: {} } })
  assert.equal(result.status, 'void')
})

test('ticket settlement and export summarize every leg', () => {
  const ticket = { id: 't1', createdAt: '2026-09-01T00:00:00Z', status: 'pending', legs: [leg('anytime_td'), { ...leg('receptions', 3), key: nflLegKey('p2', 'receptions'), playerId: 'p2', name: 'Receiver' }] }
  const snapshot = { players: [
    { id: 'p1', live: { isFinal: true, stats: { totalTds: 1 } } },
    { id: 'p2', live: { isFinal: true, stats: { receptions: 5 } } },
  ] }
  const settled = settleNFLTicket(ticket, snapshot)
  assert.equal(settled.status, 'won')
  assert.match(ticketExportText(settled), /Receiver/)
})

