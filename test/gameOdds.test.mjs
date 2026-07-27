import { test } from 'node:test'
import assert from 'node:assert/strict'
import { americanToDecimal, parseGameOdds } from '../server/lib/theOddsApi.mjs'

const market = (key, outcomes) => ({ key, outcomes })
const book = (key, moneyline, total) => ({
  key,
  title: key,
  last_update: '2026-07-27T15:00:00Z',
  markets: [
    market('h2h', moneyline),
    market('totals', total),
  ],
})

test('American odds convert to decimal without accepting malformed prices', () => {
  assert.equal(americanToDecimal(150), 2.5)
  assert.equal(americanToDecimal(-200), 1.5)
  assert.equal(americanToDecimal(50), null)
  assert.equal(americanToDecimal(Number.NaN), null)
})

test('game odds parser de-vigs moneylines and totals across books', () => {
  const games = [{
    gamePk: 10,
    gameDate: '2026-07-27T23:10:00Z',
    awayTeam: { name: 'Chicago Cubs' },
    homeTeam: { name: 'Milwaukee Brewers' },
  }]
  const events = [{
    id: 'event-1',
    commence_time: '2026-07-27T23:10:00Z',
    away_team: 'Chicago Cubs',
    home_team: 'Milwaukee Brewers',
    bookmakers: [
      book('fanduel', [
        { name: 'Chicago Cubs', price: 120 },
        { name: 'Milwaukee Brewers', price: -140 },
      ], [
        { name: 'Over', price: -105, point: 8.5 },
        { name: 'Under', price: -115, point: 8.5 },
      ]),
      book('williamhill_us', [
        { name: 'Chicago Cubs', price: 125 },
        { name: 'Milwaukee Brewers', price: -145 },
      ], [
        { name: 'Over', price: 100, point: 8.5 },
        { name: 'Under', price: -120, point: 8.5 },
      ]),
    ],
  }]

  const parsed = parseGameOdds(events, games)
  assert.equal(parsed.matched, 1)
  assert.equal(parsed.priced, 1)
  const result = parsed.gameOddsByGamePk[10]
  assert.ok(result.books.caesars)
  assert.equal(result.consensus.moneyline.books, 2)
  assert.equal(result.consensus.total.line, 8.5)
  assert.equal(result.consensus.total.books, 2)
  assert.ok(Math.abs(
    result.consensus.moneyline.away.fairProbability
      + result.consensus.moneyline.home.fairProbability - 1,
  ) < 1e-12)
  assert.ok(Math.abs(
    result.consensus.total.over.fairProbability
      + result.consensus.total.under.fairProbability - 1,
  ) < 1e-12)
})

test('doubleheader matching assigns each market event to one MLB gamePk', () => {
  const games = [
    {
      gamePk: 101,
      gameDate: '2026-07-27T17:10:00Z',
      awayTeam: { name: 'New York Yankees' },
      homeTeam: { name: 'Boston Red Sox' },
    },
    {
      gamePk: 102,
      gameDate: '2026-07-27T23:10:00Z',
      awayTeam: { name: 'New York Yankees' },
      homeTeam: { name: 'Boston Red Sox' },
    },
  ]
  const makeEvent = (id, commence, awayPrice) => ({
    id,
    commence_time: commence,
    away_team: 'New York Yankees',
    home_team: 'Boston Red Sox',
    bookmakers: [book('fanduel', [
      { name: 'New York Yankees', price: awayPrice },
      { name: 'Boston Red Sox', price: -130 },
    ], [])],
  })
  const events = [
    makeEvent('late', '2026-07-27T23:12:00Z', 115),
    makeEvent('early', '2026-07-27T17:08:00Z', 110),
  ]

  const { gameOddsByGamePk } = parseGameOdds(events, games)
  assert.equal(gameOddsByGamePk[101].eventId, 'early')
  assert.equal(gameOddsByGamePk[102].eventId, 'late')
})
