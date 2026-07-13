import test from 'node:test'
import assert from 'node:assert/strict'

import { parseESPNRoster, parseESPNScoreboard, parseESPNSummary, selectCurrentNFLSlate } from '../server/sports/nfl/providers/espn.mjs'
import { parseSportsGameOdds } from '../server/sports/nfl/providers/odds.mjs'
import { indexNFLHistory, matchHistoryPlayer, projectNFLPlayer } from '../server/sports/nfl/projections.mjs'
import { buildNFLSnapshot, defenseProfile, normalizeFirstTouchdownProbabilities } from '../server/sports/nfl/fetch-nfl-slate.mjs'
import { assessPlayerAvailability, indexAvailability, externalAvailabilityFor } from '../server/sports/nfl/availability.mjs'
import { evaluateNFLHistory } from '../server/sports/nfl/backtest.mjs'
import { calibrateNFLProbability, correctedNFLProjection } from '../src/sports/nfl/logic/calibration.js'
import { depthFor, indexDepthChart, indexWeather, overlayFreshness, weatherFor } from '../server/sports/nfl/context-overlays.mjs'

const event = (id, date, week = 1, state = 'pre') => ({
  id, date, season: { year: 2026, slug: 'regular-season' }, week: { number: week },
  status: { period: state === 'post' ? 4 : 0, displayClock: state === 'post' ? '0:00' : '15:00', type: { state, name: state, shortDetail: state } },
  competitions: [{ venue: { id: '1', fullName: 'Test Field', indoor: false, address: { city: 'Test', state: 'TX' } }, competitors: [
    { homeAway: 'home', score: '0', team: { id: '1', abbreviation: 'BUF', displayName: 'Buffalo Bills' } },
    { homeAway: 'away', score: '0', team: { id: '2', abbreviation: 'MIA', displayName: 'Miami Dolphins' } },
  ] }],
})

const roster = (team) => ({ athletes: [{ position: 'offense', items: [
  { id: `${team}-qb`, displayName: `${team} Quarterback`, position: { abbreviation: 'QB' }, status: { name: 'Active' }, injuries: [] },
  { id: `${team}-fb`, displayName: `${team} Fullback`, position: { abbreviation: 'FB' }, status: { name: 'Active' }, injuries: [] },
  { id: `${team}-wr`, displayName: `${team} Receiver`, position: { abbreviation: 'WR' }, status: { name: 'Active' }, injuries: [{ status: 'Questionable', details: { type: 'Hamstring' } }] },
] }] })

test('ESPN schedule normalization selects the nearest complete NFL week', () => {
  const games = parseESPNScoreboard({ events: [event('old', '2026-09-03T00:00:00Z', 1, 'post'), event('next-a', '2026-09-10T00:00:00Z', 2), event('next-b', '2026-09-11T00:00:00Z', 2)] })
  const slate = selectCurrentNFLSlate(games, new Date('2026-09-08T12:00:00Z'))
  assert.deepEqual(slate.map((game) => game.id), ['next-a', 'next-b'])
  assert.equal(slate[0].home.abbr, 'BUF')
})

test('ESPN roster keeps requested positions and maps fullback to RB', () => {
  const players = parseESPNRoster(roster('BUF'), 'BUF')
  assert.deepEqual(players.map((player) => player.position), ['QB', 'RB', 'WR'])
  assert.equal(players[2].injury.status, 'Questionable')
})

test('ESPN live summary maps passing, rushing, receiving and scorer stats', () => {
  const game = parseESPNScoreboard({ events: [event('live', '2026-09-10T00:00:00Z', 2, 'in')] })[0]
  game.status.period = 2; game.status.clock = '7:30'
  const athlete = { id: '7', displayName: 'Test Player' }
  const summary = parseESPNSummary({ boxscore: { players: [{ statistics: [
    { name: 'passing', keys: ['completions/passingAttempts', 'passingYards', 'passingTouchdowns'], athletes: [{ athlete, stats: ['12/18', '155', '1'] }] },
    { name: 'rushing', keys: ['rushingAttempts', 'rushingYards', 'rushingTouchdowns'], athletes: [{ athlete, stats: ['5', '31', '1'] }] },
    { name: 'receiving', keys: ['receptions', 'receivingYards', 'receivingTouchdowns', 'receivingTargets'], athletes: [{ athlete, stats: ['2', '18', '0', '3'] }] },
  ] }] } }, game)
  assert.deepEqual(summary.players[0], { espnId: '7', name: 'Test Player', headshotUrl: null, completions: 12, attempts: 18, passingYards: 155, passingTds: 1, carries: 5, rushingYards: 31, rushingTds: 1, receptions: 2, receivingYards: 18, receivingTds: 0, targets: 3, totalTds: 1 })
  assert.ok(summary.progress > .3 && summary.progress < .4)
})

test('SportsGameOdds parser normalizes NFL player prop IDs and book prices', () => {
  const payload = { data: [{ players: { JOSH_ALLEN_NFL: { name: 'Josh Allen' } }, odds: {
    'passingYards-JOSH_ALLEN_NFL-game-ou-over': { playerID: 'JOSH_ALLEN_NFL', byBookmaker: { draftkings: { odds: '-110', spread: 249.5 } } },
    'passingYards-JOSH_ALLEN_NFL-game-ou-under': { playerID: 'JOSH_ALLEN_NFL', byBookmaker: { draftkings: { odds: '-110', spread: 249.5 } } },
  } }] }
  const parsed = parseSportsGameOdds(payload).get('josh allen')
  assert.equal(parsed.markets.passing_yards.line, 249.5)
  assert.equal(parsed.markets.passing_yards.odds, -110)
  assert.equal(parsed.markets.passing_yards.underOdds, -110)
})

test('historical join and projections use scoring TDs, recent volume, and priced line overrides', () => {
  const history = { players: [{ id: 'nfl-1', name: 'Josh Allen', teams: ['BUF'], recentGames: [
    { season: 2025, week: 2, passingYards: 280, completions: 24, attempts: 34, rushingYards: 55, totalTds: 1, targetShare: 0 },
    { season: 2025, week: 1, passingYards: 240, completions: 20, attempts: 30, rushingYards: 35, totalTds: 0, targetShare: 0 },
  ], splits: { home: { tdRate: .5 }, away: { tdRate: .25 } }, redZone: { redZoneCarries: 6, goalLineCarries: 2 } }] }
  const index = indexNFLHistory(history)
  const rosterPlayer = { id: 'espn-1', name: 'Josh Allen', team: 'BUF', position: 'QB' }
  const match = matchHistoryPlayer(rosterPlayer, index)
  const result = projectNFLPlayer(rosterPlayer, match, { isHome: true, odds: { markets: { passing_yards: { line: 257.5, odds: -105 } } } })
  assert.equal(match.id, 'nfl-1')
  assert.ok(result.projections.passingYards > 250)
  assert.equal(result.markets.passing_yards.line, 257.5)
  assert.equal(result.markets.passing_yards.odds, -105)
  assert.ok(result.projections.anytimeTdProbability > .2 && result.projections.anytimeTdProbability < .7)
})

test('defense profile ranks opponent position allowance and emits market factors', () => {
  const history = { defenseAllowedByPosition: { BUF: { RB: { rushingYards: 70, touchdowns: .5 } }, MIA: { RB: { rushingYards: 120, touchdowns: 1 } } } }
  const profile = defenseProfile(history, 'MIA', 'RB')
  assert.equal(profile.rank, 2)
  assert.equal(profile.percentile, 1)
  assert.ok(profile.factors.rushing_yards > 1)
})

test('calibration maps correct probability and projection bias', () => {
  assert.equal(calibrateNFLProbability(.5, { buckets: [{ samples: 100, predicted: .5, observed: .3 }] }), .3)
  assert.equal(correctedNFLProjection(250, { correction: -12.5 }), 237.5)
})

test('depth and weather overlays match stable IDs and enforce freshness', () => {
  const depth = indexDepthChart({ generatedAt: '2026-09-01T00:00:00Z', players: [{ espnId: '7', name: 'Runner', depthRank: 1 }] })
  const weather = indexWeather({ generatedAt: '2026-09-01T00:00:00Z', games: [{ gameId: 'g1', tempF: 55 }] })
  assert.equal(depthFor({ espnId: '7', name: 'Runner' }, depth).depthRank, 1)
  assert.equal(weatherFor({ id: 'g1' }, weather).tempF, 55)
  assert.equal(overlayFreshness('2026-09-01T00:00:00Z', new Date('2026-09-01T12:00:00Z'), 24).fresh, true)
  assert.equal(overlayFreshness('2026-09-01T00:00:00Z', new Date('2026-09-03T00:00:00Z'), 24).fresh, false)
})

test('First TD probabilities are normalized within each game', () => {
  const players = [
    { gameId: 'g1', projections: { anytimeTdProbability: .6 }, usage: { redZoneOpportunityShare: .5, roleRank: 1 }, markets: { first_td: {} } },
    { gameId: 'g1', projections: { anytimeTdProbability: .3 }, usage: { redZoneOpportunityShare: .2, roleRank: 2 }, markets: { first_td: {} } },
    { gameId: 'g2', projections: { anytimeTdProbability: .4 }, usage: { redZoneOpportunityShare: .3, roleRank: 1 }, markets: { first_td: {} } },
  ]
  normalizeFirstTouchdownProbabilities(players)
  const gameOne = players.filter((player) => player.gameId === 'g1')
  assert.ok(Math.abs(gameOne.reduce((sum, player) => sum + player.projections.firstTdProbability, 0) - .86) < .001)
  assert.equal(players[2].projections.firstTdProbability, .86)
  assert.ok(players[0].projections.firstTdProbability > players[1].projections.firstTdProbability)
})

test('full NFL snapshot build joins schedule, rosters, injuries, and live contract', async () => {
  const scoreboard = { events: [event('game-1', '2026-09-10T00:00:00Z', 2)] }
  const fetchImpl = async (url) => {
    if (url.includes('/scoreboard')) return { ok: true, json: async () => scoreboard }
    if (url.includes('/teams/buf/')) return { ok: true, json: async () => roster('BUF') }
    if (url.includes('/teams/mia/')) return { ok: true, json: async () => roster('MIA') }
    if (url.includes('/summary')) return { ok: true, json: async () => ({ boxscore: { players: [] } }) }
    throw new Error(`Unexpected URL ${url}`)
  }
  const snapshot = await buildNFLSnapshot({ now: new Date('2026-09-08T12:00:00Z'), fetchImpl, historyPath: 'missing-history.json', oddsApiKey: null })
  assert.equal(snapshot.sport, 'nfl')
  assert.equal(snapshot.source.mode, 'live')
  assert.equal(snapshot.source.providers.history, 'position-priors')
  assert.equal(snapshot.meta.games, 1)
  assert.equal(snapshot.players.length, 6)
  assert.ok(snapshot.players.every((player) => ['QB', 'RB', 'WR', 'TE'].includes(player.position)))
  assert.equal(snapshot.dataQuality.playByPlay, false)
  assert.ok(snapshot.players.every((player) => player.markets.first_td.source === 'game_normalized_model'))
})

test('availability gate excludes inactive players and discounts practice risks', () => {
  const index = indexAvailability({ generatedAt: '2026-09-09T20:00:00Z', players: [
    { espnId: '1', name: 'Out Player', status: 'Out', active: false },
    { name: 'Limited Player', status: 'Questionable', practiceParticipation: 'Limited Practice' },
  ] })
  const out = assessPlayerAvailability({ espnId: '1', name: 'Out Player', rosterStatus: 'Active' }, externalAvailabilityFor({ espnId: '1', name: 'Out Player' }, index))
  const limited = assessPlayerAvailability({ espnId: '2', name: 'Limited Player', rosterStatus: 'Active' }, externalAvailabilityFor({ espnId: '2', name: 'Limited Player' }, index))
  assert.equal(out.eligible, false)
  assert.equal(out.multiplier, 0)
  assert.equal(limited.eligible, true)
  assert.ok(limited.multiplier > 0 && limited.multiplier < 1)
})

test('walk-forward NFL backtest emits probability and projection metrics without future leakage', () => {
  const games = Array.from({ length: 10 }, (_, index) => ({
    season: 2025, week: index + 1, passingYards: 210 + index * 8, rushingYards: 30 + index * 2,
    receivingYards: 0, receptions: 0, totalTds: index % 3 === 0 ? 1 : 0,
  }))
  const result = evaluateNFLHistory({ seasons: [2025], players: [{ id: 'qb', name: 'QB', position: 'QB', recentGames: games }] })
  assert.equal(result.markets.passing_yards.type, 'projection')
  assert.equal(result.markets.passing_yards.samples, 6)
  assert.ok(result.markets.passing_yards.mae > 0)
  assert.ok(Number.isFinite(result.markets.passing_yards.correction))
  assert.equal(result.markets.passing_yards.correction, -result.markets.passing_yards.bias)
  assert.equal(result.markets.anytime_td.type, 'probability')
  assert.equal(result.markets.anytime_td.samples, 6)
  assert.ok(result.markets.anytime_td.brier >= 0 && result.markets.anytime_td.brier <= 1)
  assert.ok(result.markets.anytime_td.buckets.length > 0)
  assert.ok(result.markets.anytime_td.buckets.every((bucket) => bucket.samples > 0))
})
