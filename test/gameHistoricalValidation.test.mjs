import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMlbGameHistory,
  evaluateGameHistoricalValidation,
  validateMlbGameHistory,
} from '../src/sports/mlb/logic/gameHistoricalValidation.js'
import { parseMlbSeasonResults } from '../src/sports/mlb/logic/teamScoringForm.js'
import { refreshMlbGameHistory } from '../server/lib/mlbGameHistory.mjs'

function seasonArtifact(season, {
  games = 45,
  throughDate = `${season}-12-01`,
} = {}) {
  const dates = []
  for (let index = 0; index < games; index++) {
    const date = new Date(Date.UTC(season, 3, index + 1)).toISOString().slice(0, 10)
    dates.push({
      date,
      games: [{
        gamePk: season * 1000 + index,
        gameDate: `${date}T18:00:00.000Z`,
        officialDate: date,
        gameType: 'R',
        gameNumber: 1,
        doubleHeader: 'N',
        status: { abstractGameState: 'Final' },
        teams: {
          away: {
            team: { id: index % 2 ? 1 : 3, name: index % 2 ? 'Away A' : 'Away B' },
            score: index % 2 ? 7 : 6,
          },
          home: {
            team: { id: index % 2 ? 2 : 4, name: index % 2 ? 'Home A' : 'Home B' },
            score: index % 2 ? 2 : 3,
          },
        },
      }],
    })
  }
  return parseMlbSeasonResults({ dates }, {
    season,
    throughDate,
    fetchedAt: '2026-07-28T12:00:00.000Z',
  })
}

test('three-season history validates and evaluates every season in isolation', () => {
  const history = buildMlbGameHistory([
    seasonArtifact(2024),
    seasonArtifact(2025),
    seasonArtifact(2026, { throughDate: '2026-07-28' }),
  ], { fetchedAt: '2026-07-28T12:00:00.000Z' })
  const validation = validateMlbGameHistory(history)
  const evaluation = evaluateGameHistoricalValidation(history, {
    minimumSeasons: 3,
    minimumGames: 30,
    minimumDates: 15,
    minimumPriorGames: 10,
    minimumCoverage: 0.15,
  })

  assert.equal(validation.ok, true)
  assert.equal(validation.metrics.seasons, 3)
  assert.equal(evaluation.methodology, 'season-isolated-expanding-date-walk-forward')
  assert.equal(evaluation.sample.seasons, 3)
  assert.deepEqual(evaluation.seasons.map((row) => row.season), [2024, 2025, 2026])
  assert.ok(evaluation.seasons.every((row) => row.sample.fromDate.startsWith(String(row.season))))
  assert.ok(Number.isFinite(evaluation.forecastBackbone.winnerBrier))
  assert.ok(Number.isFinite(evaluation.forecastBackbone.totalMae))
})

test('historical refresh reuses completed seasons and the current season artifact', async () => {
  const prior = buildMlbGameHistory([
    seasonArtifact(2024),
    seasonArtifact(2025),
  ], { fetchedAt: '2026-07-27T12:00:00.000Z' })
  const current = seasonArtifact(2026, { throughDate: '2026-07-28' })
  let calls = 0
  const refreshed = await refreshMlbGameHistory({
    seasons: [2024, 2025, 2026],
    currentSeason: 2026,
    currentSeasonArtifact: current,
    prior,
    throughDate: '2026-07-28',
    fetchedAt: '2026-07-28T12:00:00.000Z',
    minimumCompletedSeasonGames: 1,
    fetchImpl: async () => {
      calls++
      throw new Error('completed seasons should not refetch')
    },
  })

  assert.equal(calls, 0)
  assert.deepEqual(refreshed.metrics.reused, [2024, 2025, 2026])
  assert.deepEqual(refreshed.artifact.seasons.map((row) => row.season), [2024, 2025, 2026])
})

test('history validation rejects duplicate seasons', () => {
  const artifact = seasonArtifact(2025)
  const history = {
    ...buildMlbGameHistory([artifact]),
    seasons: [artifact, artifact],
  }

  assert.equal(validateMlbGameHistory(history).ok, false)
  assert.ok(validateMlbGameHistory(history).errors.some((error) => error.includes('duplicate')))
})
