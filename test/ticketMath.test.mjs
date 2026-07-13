import test from 'node:test'
import assert from 'node:assert/strict'
import { gradeTicket, summarizeTickets, ticketEconomics } from '../ui/src/lib/ticketMath.js'

const ticket = (patch = {}) => ({
  id: 't1',
  wager: 1,
  american: 400,
  legs: [
    { playerId: 1, gamePk: 10, name: 'One' },
    { playerId: 2, gamePk: 20, name: 'Two' },
  ],
  settled: null,
  ...patch,
})

test('gradeTicket preserves doubleheader game identity and reports live progress', () => {
  const graded = gradeTicket(ticket(), [
    { playerId: 1, gamePk: 9, game: { isFinal: true }, homeredThisGame: false },
    { playerId: 1, gamePk: 10, game: { isLive: true }, homeredThisGame: true },
    { playerId: 2, gamePk: 20, game: { isLive: true }, liveContext: { expectedRemainingABs: 2 } },
  ])
  assert.equal(graded.status, 'live')
  assert.equal(graded.hits, 1)
  assert.deepEqual(graded.legs.map((leg) => leg.code), ['hit', 'live'])
})

test('ticketEconomics only computes profit when wager and odds are complete', () => {
  assert.deepEqual(ticketEconomics(ticket({ wager: null }), 'cashed').profit, null)
  assert.equal(ticketEconomics(ticket(), 'cashed').profit, 4)
  assert.equal(ticketEconomics(ticket(), 'dead').profit, -1)
  assert.equal(ticketEconomics(ticket(), 'pending').projectedPayout, 5)
})

test('summarizeTickets excludes incomplete records from ROI', () => {
  const pricedWin = { ticket: ticket(), status: 'cashed' }
  const pricedLoss = { ticket: ticket({ id: 't2' }), status: 'dead' }
  const incompleteLoss = { ticket: ticket({ id: 't3', wager: null }), status: 'dead' }
  const open = { ticket: ticket({ id: 't4', wager: 2 }), status: 'pending' }
  const summary = summarizeTickets([pricedWin, pricedLoss, incompleteLoss, open])
  assert.equal(summary.settled, 3)
  assert.equal(summary.pricedSettled, 2)
  assert.equal(summary.net, 3)
  assert.equal(summary.risked, 2)
  assert.equal(summary.roi, 1.5)
  assert.equal(summary.knownExposure, 2)
})
