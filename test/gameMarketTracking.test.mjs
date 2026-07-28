import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gameMarketMovement,
  gameMarketSnapshot,
  updateGameMarketHistory,
} from '../src/sports/mlb/logic/gameMarketTracking.js'

const game = (gamePk, {
  gameNumber = 1,
  isLive = false,
  isFinal = false,
} = {}) => ({
  gamePk,
  gameDate: '2026-07-28T23:10:00.000Z',
  gameNumber,
  isLive,
  isFinal,
  awayTeam: { id: 1, name: 'Away' },
  homeTeam: { id: 2, name: 'Home' },
})

const price = (american, fairProbability) => ({ american, fairProbability })

const market = ({
  awayAmerican = 110,
  homeAmerican = -120,
  awayFairProbability = 0.4762,
  homeFairProbability = 0.5238,
  line = 8.5,
  overAmerican = -110,
  underAmerican = -110,
  updatedAt = '2026-07-28T18:00:00.000Z',
} = {}) => ({
  books: {
    book: { updatedAt },
  },
  consensus: {
    moneyline: {
      books: 5,
      away: price(awayAmerican, awayFairProbability),
      home: price(homeAmerican, homeFairProbability),
    },
    total: {
      books: 5,
      line,
      over: price(overAmerican, 0.5),
      under: price(underAmerican, 0.5),
    },
  },
})

test('market history preserves opening, updates current, and freezes the closing line', () => {
  const date = '2026-07-28'
  const first = updateGameMarketHistory(
    {},
    date,
    { 10: market() },
    [game(10)],
    { capturedAt: '2026-07-28T18:05:00.000Z' },
  )
  const opening = first.currentByGame[10]
  assert.equal(opening.status, 'pregame')
  assert.equal(opening.opening.total.line, 8.5)
  assert.equal(opening.current.total.line, 8.5)
  assert.equal(opening.closing, null)
  assert.equal(opening.observationCount, 1)
  assert.equal(opening.revisionCount, 1)

  const unchanged = updateGameMarketHistory(
    first.log,
    date,
    { 10: market() },
    [game(10)],
    { capturedAt: '2026-07-28T18:15:00.000Z' },
  )
  assert.equal(unchanged.currentByGame[10].observationCount, 2)
  assert.equal(unchanged.currentByGame[10].revisionCount, 1)

  const moved = updateGameMarketHistory(
    unchanged.log,
    date,
    {
      10: market({
        homeAmerican: -145,
        awayAmerican: 125,
        homeFairProbability: 0.56,
        awayFairProbability: 0.44,
        line: 9,
        overAmerican: -125,
        underAmerican: 105,
      }),
    },
    [game(10)],
    { capturedAt: '2026-07-28T18:30:00.000Z' },
  )
  const current = moved.currentByGame[10]
  assert.equal(current.opening.total.line, 8.5)
  assert.equal(current.current.total.line, 9)
  assert.equal(current.revisionCount, 2)
  assert.equal(current.movement.material, true)
  assert.ok(current.movement.changed.includes('moneyline-probability'))
  assert.ok(current.movement.changed.includes('total-line'))

  const frozen = updateGameMarketHistory(
    moved.log,
    date,
    { 10: market({ line: 10.5, homeAmerican: -200 }) },
    [game(10, { isLive: true })],
    { capturedAt: '2026-07-28T23:12:00.000Z' },
  )
  const closing = frozen.currentByGame[10]
  assert.equal(closing.status, 'frozen')
  assert.equal(closing.current.total.line, 9)
  assert.equal(closing.closing.total.line, 9)
  assert.equal(closing.revisionCount, 2)
  assert.equal(closing.closedAt, '2026-07-28T23:12:00.000Z')

  const afterStart = updateGameMarketHistory(
    frozen.log,
    date,
    { 10: market({ line: 11.5 }) },
    [game(10, { isLive: true })],
    { capturedAt: '2026-07-28T23:30:00.000Z' },
  )
  assert.equal(afterStart.currentByGame[10].closing.total.line, 9)
})

test('market history keeps doubleheader games distinct by gamePk', () => {
  const tracked = updateGameMarketHistory(
    {},
    '2026-07-28',
    {
      10: market({ line: 8 }),
      11: market({ line: 9.5 }),
    },
    [
      game(10, { gameNumber: 1 }),
      game(11, { gameNumber: 2 }),
    ],
    { capturedAt: '2026-07-28T15:00:00.000Z' },
  )
  const day = tracked.log.gameMarketHistory.byDate['2026-07-28']
  assert.deepEqual(Object.keys(day).sort(), ['10', '11'])
  assert.equal(day['10'].gameNumber, 1)
  assert.equal(day['11'].gameNumber, 2)
  assert.equal(day['10'].current.total.line, 8)
  assert.equal(day['11'].current.total.line, 9.5)
})

test('market snapshots preserve the freshest book timestamp and movement thresholds', () => {
  const input = market()
  input.books.second = { updatedAt: '2026-07-28T18:04:00.000Z' }
  const opening = gameMarketSnapshot(input, '2026-07-28T18:05:00.000Z')
  const current = gameMarketSnapshot(market({
    homeFairProbability: 0.5488,
    awayFairProbability: 0.4512,
    line: 9,
  }), '2026-07-28T18:30:00.000Z')
  const movement = gameMarketMovement(opening, current)
  assert.equal(opening.sourceUpdatedAt, '2026-07-28T18:04:00.000Z')
  assert.equal(movement.moneylineHomeProbability, 0.025)
  assert.equal(movement.totalLine, 0.5)
  assert.equal(movement.material, true)
})
