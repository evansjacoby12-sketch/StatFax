import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  buildTeamScoringProfiles,
  evaluateTeamScoringForm,
  mergeMlbSeasonResults,
  parseMlbSeasonResults,
  teamScoringMatchupContext,
  validateMlbSeasonResults,
} from '../src/sports/mlb/logic/teamScoringForm.js'
import { refreshMlbSeasonResults } from '../server/lib/mlbGameResults.mjs'

function scheduleGame({
  gamePk,
  date,
  awayId = 1,
  homeId = 2,
  awayRuns,
  homeRuns,
  gameNumber = 1,
  doubleHeader = 'N',
  state = 'Final',
  gameType = 'R',
  awayFirstInningRuns = 0,
  homeFirstInningRuns = 0,
}) {
  return {
    gamePk,
    gameDate: `${date}T18:00:00.000Z`,
    officialDate: date,
    gameType,
    gameNumber,
    doubleHeader,
    status: { abstractGameState: state },
    linescore: {
      innings: [{
        num: 1,
        away: { runs: awayFirstInningRuns },
        home: { runs: homeFirstInningRuns },
      }],
    },
    teams: {
      away: { team: { id: awayId, name: `Team ${awayId}` }, score: awayRuns },
      home: { team: { id: homeId, name: `Team ${homeId}` }, score: homeRuns },
    },
  }
}

function payload(games) {
  const byDate = new Map()
  for (const game of games) {
    if (!byDate.has(game.officialDate)) byDate.set(game.officialDate, [])
    byDate.get(game.officialDate).push(game)
  }
  return {
    dates: [...byDate].map(([date, dateGames]) => ({ date, games: dateGames })),
  }
}

test('season results parser keeps only completed regular-season scores and stable game identity', () => {
  const artifact = parseMlbSeasonResults(payload([
    scheduleGame({ gamePk: 11, date: '2026-07-25', awayRuns: 6, homeRuns: 2 }),
    scheduleGame({ gamePk: 12, date: '2026-07-25', awayRuns: 4, homeRuns: 3, gameType: 'S' }),
    scheduleGame({ gamePk: 13, date: '2026-07-26', awayRuns: 1, homeRuns: 0, state: 'Live' }),
    scheduleGame({ gamePk: 14, date: '2026-07-27', awayRuns: 5, homeRuns: 4 }),
  ]), {
    season: 2026,
    throughDate: '2026-07-26',
    fetchedAt: '2026-07-27T12:00:00.000Z',
  })

  assert.deepEqual(artifact.games.map((game) => game.gamePk), [11])
  assert.deepEqual(artifact.games[0].awayTeam, { id: 1, name: 'Team 1' })
  assert.equal(artifact.games[0].awayRuns, 6)
  assert.equal(artifact.games[0].awayFirstInningRuns, 0)
  assert.equal(validateMlbSeasonResults(artifact).ok, true)
})

test('incremental merge updates by gamePk without duplicating a doubleheader', () => {
  const prior = parseMlbSeasonResults(payload([
    scheduleGame({ gamePk: 21, date: '2026-07-25', awayRuns: 3, homeRuns: 2, gameNumber: 1, doubleHeader: 'Y' }),
  ]), {
    season: 2026,
    throughDate: '2026-07-25',
    fetchedAt: '2026-07-25T23:00:00.000Z',
  })
  const incoming = parseMlbSeasonResults(payload([
    scheduleGame({ gamePk: 21, date: '2026-07-25', awayRuns: 4, homeRuns: 2, gameNumber: 1, doubleHeader: 'Y' }),
    scheduleGame({ gamePk: 22, date: '2026-07-25', awayRuns: 1, homeRuns: 5, gameNumber: 2, doubleHeader: 'Y' }),
  ]), {
    season: 2026,
    throughDate: '2026-07-26',
    fetchedAt: '2026-07-26T12:00:00.000Z',
  })
  const merged = mergeMlbSeasonResults(prior, incoming)

  assert.deepEqual(merged.games.map((game) => game.gamePk), [21, 22])
  assert.equal(merged.games[0].awayRuns, 4)
  assert.equal(validateMlbSeasonResults(merged).ok, true)
})

test('team scoring profiles exclude every target-date result, including both doubleheader games', () => {
  const games = []
  for (let index = 0; index < 35; index++) {
    const day = String(index + 1).padStart(2, '0')
    const date = index < 30 ? `2026-06-${day}` : `2026-07-0${index - 29}`
    games.push(scheduleGame({
      gamePk: 100 + index,
      date,
      awayRuns: index % 2 ? 6 : 5,
      homeRuns: index % 2 ? 3 : 4,
    }))
  }
  games.push(
    scheduleGame({ gamePk: 201, date: '2026-07-27', awayRuns: 12, homeRuns: 0, gameNumber: 1, doubleHeader: 'Y' }),
    scheduleGame({ gamePk: 202, date: '2026-07-27', awayRuns: 11, homeRuns: 1, gameNumber: 2, doubleHeader: 'Y' }),
  )
  const artifact = parseMlbSeasonResults(payload(games), {
    season: 2026,
    throughDate: '2026-07-27',
    fetchedAt: '2026-07-27T23:00:00.000Z',
  })
  const profiles = buildTeamScoringProfiles(artifact, '2026-07-27')

  assert.equal(profiles.games, 35)
  assert.equal(profiles.teams[1].games, 35)
  assert.equal(profiles.teams[1].recent7.games, 7)
  assert.equal(profiles.teams[1].recent14.games, 14)
  assert.equal(profiles.teams[1].recent30.games, 30)
  assert.ok(profiles.teams[1].runsPerGame < 7)
})

test('matchup context combines scoring and allowance form with conservative caps', () => {
  const profiles = {
    cutoffDate: '2026-07-27',
    leagueRunsPerTeam: 4.4,
    teams: {
      1: {
        games: 80,
        runsPerGame: 5.5,
        recent14: { runsPerGame: 6 },
        scoringIndex: 1.4,
        allowanceIndex: 1,
        coverage: 1,
      },
      2: {
        games: 80,
        runsAllowedPerGame: 5.4,
        recent14: { runsAllowedPerGame: 5.8 },
        scoringIndex: 1,
        allowanceIndex: 1.35,
        coverage: 1,
      },
    },
  }
  const context = teamScoringMatchupContext(profiles, 1, 2)

  assert.equal(context.factor, 1.08)
  assert.equal(context.coverage, 1)
  assert.equal(context.teamGames, 80)
  assert.equal(context.opponentGames, 80)
})

test('season score refresh backfills once, then requests only a 14-day overlap', async () => {
  const calls = []
  const fetchImpl = async (url) => {
    calls.push(url)
    return {
      ok: true,
      json: async () => payload([
        scheduleGame({ gamePk: 301, date: '2026-07-25', awayRuns: 4, homeRuns: 2 }),
      ]),
    }
  }
  const first = await refreshMlbSeasonResults({
    season: 2026,
    throughDate: '2026-07-27',
    fetchImpl,
    fetchedAt: '2026-07-27T12:00:00.000Z',
  })
  assert.match(calls[0], /startDate=2026-03-01/)
  assert.match(calls[0], /hydrate=team,linescore/)
  assert.equal(first.artifact.games.length, 1)

  await refreshMlbSeasonResults({
    season: 2026,
    throughDate: '2026-07-28',
    prior: first.artifact,
    fetchImpl,
    fetchedAt: '2026-07-28T12:00:00.000Z',
  })
  assert.match(calls[1], /startDate=2026-07-14/)
})

test('team scoring evaluation is expanding-window and never trains on its target date', () => {
  const games = Array.from({ length: 40 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 3, index + 1)).toISOString().slice(0, 10)
    return scheduleGame({
      gamePk: 400 + index,
      date,
      awayRuns: 7,
      homeRuns: 2,
    })
  })
  const artifact = parseMlbSeasonResults(payload(games), {
    season: 2026,
    throughDate: '2026-05-10',
    fetchedAt: '2026-05-11T12:00:00.000Z',
  })
  const evaluation = evaluateTeamScoringForm(artifact, {
    minimumPriorGames: 10,
    minimumCoverage: 0.3,
  })

  assert.ok(evaluation.sample.games > 0)
  assert.equal(evaluation.methodology, 'expanding-date walk-forward')
  assert.ok(evaluation.seasonForm.teamRunMae < evaluation.baseline.teamRunMae)
  assert.ok(Number.isFinite(evaluation.seasonForm.totalMae))
  assert.ok(evaluation.seasonForm.winnerAccuracy > evaluation.baseline.winnerAccuracy)
  assert.ok(evaluation.seasonForm.winnerBrier < evaluation.baseline.winnerBrier)
})

test('deployment restores, validates, publishes, and bundles game score archives', async () => {
  const [workflow, packageJson, vite] = await Promise.all([
    readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
    readFile(new URL('../ui/vite.config.js', import.meta.url), 'utf8'),
  ])

  assert.match(workflow, /Restore MLB game results/)
  assert.match(workflow, /Restore MLB game history/)
  assert.match(workflow, /Restore first-inning pitcher cache/)
  assert.match(workflow, /npm run validate:mlb-game-results/)
  assert.match(workflow, /npm run validate:mlb-game-history/)
  for (const artifact of [
    'backtest-log.json',
    'mlb-game-results.json',
    'mlb-game-history.json',
    'first-inning-pitcher-cache.json',
    'list-builder-evidence.json',
  ]) {
    assert.match(workflow, new RegExp(artifact.replace('.', '\\.')))
  }
  assert.match(packageJson, /"validate:mlb-game-results"/)
  assert.match(packageJson, /"validate:mlb-game-history"/)
  assert.match(vite, /mlb-game-results\.json/)
})
