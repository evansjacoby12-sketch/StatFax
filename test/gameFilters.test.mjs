import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  filterAndSortGames,
  gameStateOf,
  gameTimeWindowOf,
} from '../ui/src/lib/gameFilters.js'

const localIso = (hour, minute = 0) => new Date(2026, 6, 27, hour, minute, 0, 0).toISOString()

const games = [
  {
    gamePk: 1,
    gameDate: localIso(13, 10),
    awayTeam: { abbr: 'TOR', name: 'Toronto Blue Jays' },
    homeTeam: { abbr: 'WSH', name: 'Washington Nationals' },
  },
  {
    gamePk: 2,
    gameDate: localIso(18, 40),
    isLive: true,
    awayTeam: { abbr: 'NYY', name: 'New York Yankees' },
    homeTeam: { abbr: 'BOS', name: 'Boston Red Sox' },
  },
  {
    gamePk: 3,
    gameDate: localIso(21, 15),
    isFinal: true,
    awayTeam: { abbr: 'LAD', name: 'Los Angeles Dodgers' },
    homeTeam: { abbr: 'SF', name: 'San Francisco Giants' },
  },
]

test('game state resolves final, live, and upcoming without ambiguity', () => {
  assert.equal(gameStateOf({ isLive: true, isFinal: true }), 'final')
  assert.equal(gameStateOf({ isLive: true }), 'live')
  assert.equal(gameStateOf({}), 'upcoming')
})

test('game time windows follow the same browser-local clock used by displayed game times', () => {
  assert.equal(gameTimeWindowOf(localIso(16, 59)), 'afternoon')
  assert.equal(gameTimeWindowOf(localIso(17)), 'evening')
  assert.equal(gameTimeWindowOf(localIso(20, 59)), 'evening')
  assert.equal(gameTimeWindowOf(localIso(21)), 'late')
  assert.equal(gameTimeWindowOf('not-a-date'), 'unknown')
})

test('team search matches abbreviations and full names case-insensitively', () => {
  assert.deepEqual(filterAndSortGames(games, { query: 'bos' }).map((game) => game.gamePk), [2])
  assert.deepEqual(filterAndSortGames(games, { query: 'blue jays' }).map((game) => game.gamePk), [1])
  assert.deepEqual(filterAndSortGames(games, { query: 'LOS ANGELES' }).map((game) => game.gamePk), [3])
})

test('state and start-time filters compose without changing game data', () => {
  const original = structuredClone(games)
  assert.deepEqual(
    filterAndSortGames(games, { state: 'live', timeWindow: 'evening' }).map((game) => game.gamePk),
    [2],
  )
  assert.deepEqual(filterAndSortGames(games, { state: 'final', timeWindow: 'afternoon' }), [])
  assert.deepEqual(games, original)
})

test('chronological sorting supports earliest and latest while keeping unknown times last', () => {
  const withUnknown = [...games, {
    gamePk: 4,
    gameDate: null,
    awayTeam: { abbr: 'CHC', name: 'Chicago Cubs' },
    homeTeam: { abbr: 'STL', name: 'St. Louis Cardinals' },
  }]
  assert.deepEqual(filterAndSortGames(withUnknown).map((game) => game.gamePk), [1, 2, 3, 4])
  assert.deepEqual(
    filterAndSortGames(withUnknown, { sortDirection: 'desc' }).map((game) => game.gamePk),
    [3, 2, 1, 4],
  )
})

test('Games workspace wires the responsive filter bar to the visible matchup collection', async () => {
  const [view, bar, css] = await Promise.all([
    readFile(new URL('../ui/src/components/GamesView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/GameFilterBar.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8'),
  ])

  assert.match(view, /filterAndSortGames\(eligibleGames/)
  assert.match(view, /<GameFilterBar/)
  assert.match(view, /No games match these filters/)
  assert.match(bar, /Search games by team/)
  assert.match(bar, /Game state/)
  assert.match(bar, /Start time/)
  assert.match(bar, /shownCount/)
  assert.match(css, /\.game-filter-bar/)
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.game-filter-search \{ height: 44px/)
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.game-filter-chip \{ min-height: 44px/)
})
