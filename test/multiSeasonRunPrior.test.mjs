import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMlbGameHistory } from '../src/sports/mlb/logic/gameHistoricalValidation.js'
import {
  buildTeamScoringProfiles,
  teamScoringMatchupContext,
} from '../src/sports/mlb/logic/teamScoringForm.js'
import {
  buildMultiSeasonRunProfiles,
  evaluateMultiSeasonRunPrior,
  multiSeasonRunMatchupContext,
} from '../src/sports/mlb/logic/multiSeasonRunPrior.js'

function seasonArtifact(season, scores) {
  const games = scores.map(([awayRuns, homeRuns], index) => {
    const day = String(index + 1).padStart(2, '0')
    return {
      gamePk: season * 1000 + index,
      officialDate: `${season}-04-${day}`,
      gameDate: `${season}-04-${day}T18:00:00.000Z`,
      gameType: 'R',
      gameNumber: 1,
      doubleHeader: 'N',
      awayTeam: { id: 1, name: 'Away' },
      homeTeam: { id: 2, name: 'Home' },
      awayRuns,
      homeRuns,
      awayFirstInningRuns: awayRuns > 4 ? 1 : 0,
      homeFirstInningRuns: homeRuns > 4 ? 1 : 0,
    }
  })
  return {
    version: 2,
    season,
    source: 'MLB Stats API schedule',
    fetchedAt: `${season}-10-01T12:00:00.000Z`,
    throughDate: `${season}-09-30`,
    fromDate: games[0]?.officialDate || null,
    games,
  }
}

test('multi-season run profiles use only completed seasons before the target year', () => {
  const history = buildMlbGameHistory([
    seasonArtifact(2024, [[8, 2], [7, 3]]),
    seasonArtifact(2025, [[6, 4], [5, 3]]),
    seasonArtifact(2026, [[1, 9], [2, 8]]),
    seasonArtifact(2027, [[0, 10], [1, 9]]),
  ], { fetchedAt: '2027-04-10T12:00:00.000Z' })

  const profile = buildMultiSeasonRunProfiles(history, {
    season: 2026,
    cutoffDate: '2026-07-28',
    enabled: true,
  })

  assert.deepEqual(profile.seasons, [2024, 2025])
  assert.equal(profile.games, 4)
  assert.equal(profile.enabled, true)
  assert.deepEqual(profile.teams[1].seasonWeights, { 2024: 0.55, 2025: 1 })
})

test('prior-season influence decays as current-season team evidence accumulates', () => {
  const historical = {
    version: 1,
    source: 'prior-season regular-season final scores',
    season: 2026,
    cutoffDate: '2026-07-28',
    enabled: true,
    seasons: [2024, 2025],
    games: 4860,
    leagueRunsPerTeam: 4.5,
    teams: {
      1: { games: 324, scoringIndex: 1.15, allowanceIndex: 1, coverage: 1 },
      2: { games: 324, scoringIndex: 1, allowanceIndex: 1.12, coverage: 1 },
    },
  }
  const current = (games) => ({
    games: games * 15,
    cutoffDate: '2026-07-28',
    leagueRunsPerTeam: 4.4,
    teams: {
      1: {
        games,
        runsPerGame: 4.4,
        recent14: { runsPerGame: 4.4 },
        scoringIndex: 1,
        allowanceIndex: 1,
        coverage: 1,
      },
      2: {
        games,
        runsAllowedPerGame: 4.4,
        recent14: { runsAllowedPerGame: 4.4 },
        scoringIndex: 1,
        allowanceIndex: 1,
        coverage: 1,
      },
    },
  })

  const early = multiSeasonRunMatchupContext(current(5), historical, 1, 2)
  const mature = multiSeasonRunMatchupContext(current(100), historical, 1, 2)

  assert.ok(early.historicalWeight > mature.historicalWeight)
  assert.ok(early.leagueHistoricalWeight > mature.leagueHistoricalWeight)
  assert.ok(early.factor > mature.factor)
})

test('a disabled prior preserves current-season scoring and discloses zero influence', () => {
  const artifact = seasonArtifact(2026, [[5, 4], [6, 2], [3, 4]])
  const current = buildTeamScoringProfiles(artifact, '2026-04-10')
  const champion = teamScoringMatchupContext(current, 1, 2)
  const challenger = multiSeasonRunMatchupContext(current, {
    enabled: false,
    seasons: [2024, 2025],
    games: 4860,
  }, 1, 2)

  assert.equal(challenger.factor, champion.factor)
  assert.equal(challenger.leagueRunsPerTeam, champion.leagueRunsPerTeam)
  assert.equal(challenger.source, 'current-season-only')
  assert.equal(challenger.historicalEnabled, false)
  assert.equal(challenger.historicalWeight, 0)
  assert.equal(challenger.leagueHistoricalWeight, 0)
})

test('run-prior evaluation is season-isolated and returns finite walk-forward metrics', () => {
  const scores = [
    [5, 4], [4, 6], [7, 3], [3, 5], [6, 2], [2, 4],
    [5, 3], [4, 7], [8, 2], [3, 6], [5, 4], [4, 5],
  ]
  const history = buildMlbGameHistory([
    seasonArtifact(2024, scores),
    seasonArtifact(2025, scores),
    seasonArtifact(2026, scores),
  ], { fetchedAt: '2026-07-28T12:00:00.000Z' })
  const evaluation = evaluateMultiSeasonRunPrior(history, {
    minimumPriorGames: 1,
    minimumCoverage: 0,
    minimumSeasons: 2,
    minimumGames: 1,
    minimumDates: 1,
  })

  assert.deepEqual(evaluation.seasons.map((row) => row.season), [2025, 2026])
  assert.ok(evaluation.sample.games > 0)
  assert.ok(Number.isFinite(evaluation.currentSeason.teamRunMae))
  assert.ok(Number.isFinite(evaluation.multiSeason.totalMae))
  assert.equal(
    evaluation.eligible,
    Object.values(evaluation.checks).every(Boolean),
  )
})
