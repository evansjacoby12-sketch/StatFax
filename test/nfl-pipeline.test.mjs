import test from 'node:test'
import assert from 'node:assert/strict'

import { fetchESPNDepthChart, fetchESPNRoster, parseESPNDepthChart, parseESPNDepthChartHTML, parseESPNRoster, parseESPNScoreboard, parseESPNSummary, selectCurrentNFLSlate } from '../server/sports/nfl/providers/espn.mjs'
import { nearestHourlyForecast } from '../server/sports/nfl/providers/weather.mjs'
import { parseSportsGameOdds } from '../server/sports/nfl/providers/odds.mjs'
import { indexNFLHistory, matchHistoryPlayer, projectNFLPlayer } from '../server/sports/nfl/projections.mjs'
import { buildNFLSnapshot, defenseProfile, normalizeFirstTouchdownProbabilities } from '../server/sports/nfl/fetch-nfl-slate.mjs'
import { assessPlayerAvailability, indexAvailability, externalAvailabilityFor } from '../server/sports/nfl/availability.mjs'
import { evaluateNFLHistory } from '../server/sports/nfl/backtest.mjs'
import { calibrateNFLProbability, correctedNFLProjection } from '../src/sports/nfl/logic/calibration.js'
import { depthFor, indexDepthChart, indexWeather, overlayFreshness, weatherFor } from '../server/sports/nfl/context-overlays.mjs'
import { buildNFLDataHealth } from '../server/sports/nfl/health.mjs'
import { summarizeNFLTracking, updateNFLTracking } from '../server/sports/nfl/tracking.mjs'
import { buildTeamLineup, indexNFLLineups, lineupFor, summarizeLineupCoverage, teamLineupFor } from '../server/sports/nfl/lineups.mjs'

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

test('ESPN depth chart parser preserves position, order, stable ID and availability', () => {
  const html = '<tr data-idx="0"><td data-testid="statCell">QB<!-- --> <span></span></td></tr><tr data-idx="1"><td data-testid="statCell">RB<!-- --> <span></span></td></tr>'
    + '<tr data-idx="1"><td><a data-player-uid="s:20~l:28~a:1" href="https://www.espn.com/nfl/player/_/id/1/starter">Starter Back</a> <span class="DepthChart__injuryMeta"></span></td><td><a data-player-uid="s:20~l:28~a:2" href="https://www.espn.com/nfl/player/_/id/2/backup">Backup Back</a> <span class="DepthChart__injuryMeta">Q</span></td></tr>'
  const players = parseESPNDepthChartHTML(html, 'BUF')
  assert.equal(players.length, 2)
  assert.deepEqual(players.map((player) => [player.espnId, player.position, player.depthRank, player.status]), [['1', 'RB', 1, 'Active'], ['2', 'RB', 2, 'Questionable']])
})

test('ESPN providers use JSON depth charts and numeric roster fallback', async () => {
  const depthPayload = { depthchart: [{ name: '3WR 1TE', positions: { rb: { position: { abbreviation: 'RB' }, athletes: [{ id: '7', displayName: 'Test Back', injuries: [] }] } } }] }
  assert.equal(parseESPNDepthChart(depthPayload, 'BUF')[0].role, 'Starter')
  const depthURLs = []
  const depth = await fetchESPNDepthChart('BUF', async (url) => {
    depthURLs.push(url)
    return new Response(JSON.stringify(depthPayload), { status: 200 })
  })
  assert.match(depthURLs[0], /depthcharts/)
  assert.equal(depth[0].espnId, '7')

  const rosterURLs = []
  const players = await fetchESPNRoster('BUF', async (url) => {
    rosterURLs.push(url)
    return url.includes('/buf/')
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(roster('BUF')), { status: 200 })
  }, '1')
  assert.match(rosterURLs[1], /teams\/1\/roster/)
  assert.equal(players.length, 3)
})

test('weather forecast chooses the kickoff hour and health reports missing feeds', () => {
  const weather = nearestHourlyForecast({ hourly: { time: ['2026-09-01T18:00', '2026-09-01T19:00'], temperature_2m: [70, 68], wind_speed_10m: [8, 10], wind_gusts_10m: [14, 18], precipitation_probability: [10, 30], weather_code: [1, 61] } }, '2026-09-01T18:45:00Z')
  assert.equal(weather.tempF, 68)
  assert.equal(weather.precipProbability, 30)
  const health = buildNFLDataHealth({ games: [{}], players: [{}], quality: { depthChart: false, officialAvailability: true, weatherFresh: false, weatherCoverage: .5, playByPlay: true, defenseByPosition: true } })
  assert.equal(health.status, 'limited')
  assert.ok(health.issues.some((issue) => issue.id === 'depth'))
})

test('season tracker freezes forecasts and settles probability and projection results', () => {
  const pregame = { generatedAt: '2026-09-01T00:00:00Z', players: [{ id: 'p1', gameId: 'g1', kickoffAt: '2026-09-02T00:00:00Z', name: 'Player', position: 'RB', team: 'BUF', live: {}, projections: { rushingYards: 55 }, markets: { anytime_td: { probability: .4, odds: 150 }, rushing_yards: { probability: .6, line: 49.5, odds: -110 } } }] }
  const final = { generatedAt: '2026-09-02T04:00:00Z', players: [{ ...pregame.players[0], live: { isFinal: true, stats: { totalTds: 1, rushingYards: 60 } } }] }
  const log = updateNFLTracking({}, pregame, final, new Date('2026-09-02T04:00:00Z'))
  const summary = summarizeNFLTracking(log)
  assert.equal(summary.settled, 2)
  assert.equal(summary.markets.anytime_td.brier, .36)
  assert.equal(summary.markets.anytime_td.calibration[0].observed, 1)
  assert.equal(summary.markets.rushing_yards.mae, 5)
  assert.equal(summary.markets.anytime_td.roiSamples, 1)
})

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

test('lineup overlay indexes player and team context by stable identity', () => {
  const index = indexNFLLineups({ generatedAt: '2026-09-01T00:00:00Z', players: [{ espnId: '7', name: 'Runner', expectedSnapShare: .75 }], teams: [{ team: 'BUF', confirmed: true }] })
  assert.equal(lineupFor({ espnId: '7', name: 'Runner' }, index).expectedSnapShare, .75)
  assert.equal(teamLineupFor('BUF', index).confirmed, true)
})

test('lineup engine reallocates inactive-player work and builds package factors', () => {
  const rows = [
    { player: { espnId: '1', name: 'RB One', team: 'BUF', position: 'RB', roleRank: 1 }, history: { recentGames: [{ snapShare: .72 }] }, depth: { depthRank: 1 }, availability: { eligible: false }, entry: { snapShare: .72, insideFiveSnapShare: .8 } },
    { player: { espnId: '2', name: 'RB Two', team: 'BUF', position: 'RB', roleRank: 2 }, history: { recentGames: [{ snapShare: .28 }] }, depth: { depthRank: 2, carryShare: .25 }, availability: { eligible: true }, entry: { snapShare: .28, replacementPriority: 1 } },
  ]
  const contexts = buildTeamLineup(rows, { team: 'BUF', confirmed: true, offensiveLine: { startersAvailable: 5, continuity: .9 } }, { team: 'MIA', defense: { frontFactor: 1.04, nickelRate: .6 } }, { generatedAt: '2026-09-01T00:00:00Z', source: 'test' })
  const backup = contexts.find((row) => row.player.espnId === '2').lineup
  assert.equal(backup.confirmed, true)
  assert.equal(backup.replacement.inherited, true)
  assert.deepEqual(backup.replacement.replaces, ['RB One'])
  assert.ok(backup.expectedSnapShare > .28)
  assert.ok(backup.carryShare > .25)
  assert.ok(backup.marketFactors.rushing_yards > 1)
  assert.equal(backup.opponentDefense.nickelRate, .6)
  const coverage = summarizeLineupCoverage(contexts.map((row) => ({ lineup: row.lineup })), [{ offensiveLine: { available: true, starters: ['LT'] }, defense: { available: true, starters: ['CB'] } }])
  assert.equal(coverage.inheritedRoles, 1)
  assert.equal(coverage.offensiveLines, 1)
  assert.equal(coverage.defensiveLineups, 1)
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
  assert.equal(snapshot.dataQuality.officialAvailability, true)
  assert.equal(snapshot.source.providers.practice, 'espn-roster-reports')
  assert.ok(snapshot.players.every((player) => player.markets.first_td.source === 'game_normalized_model'))
  assert.ok(snapshot.players.every((player) => player.lineup?.projectionAdjusted))
  assert.equal(snapshot.lineupCoverage.players, snapshot.players.length)
  assert.equal(snapshot.dataQuality.lineups, false)
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
