import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildFirstInningProfiles,
  buildFirstInningProjection,
  evaluateFirstInningHistory,
  firstInningMatchupContext,
} from '../src/sports/mlb/logic/firstInningProjection.js'
import { buildMlbGameHistory } from '../src/sports/mlb/logic/gameHistoricalValidation.js'
import { parseMlbSeasonResults } from '../src/sports/mlb/logic/teamScoringForm.js'

function seasonArtifact(season, count = 10) {
  const dates = Array.from({ length: count }, (_, index) => {
    const day = String(index + 1).padStart(2, '0')
    const date = `${season}-04-${day}`
    const awayFirst = index % 4 === 0 ? 1 : 0
    const homeFirst = index % 3 === 0 ? 1 : 0
    return {
      date,
      games: [{
        gamePk: season * 100 + index,
        gameDate: `${date}T18:00:00.000Z`,
        officialDate: date,
        gameType: 'R',
        gameNumber: 1,
        doubleHeader: 'N',
        status: { abstractGameState: 'Final' },
        teams: {
          away: { team: { id: 1, name: 'Away' }, score: 4 },
          home: { team: { id: 2, name: 'Home' }, score: 3 },
        },
        linescore: {
          innings: [{
            num: 1,
            away: { runs: awayFirst },
            home: { runs: homeFirst },
          }],
        },
      }],
    }
  })
  return parseMlbSeasonResults({ dates }, {
    season,
    throughDate: `${season}-12-01`,
    fetchedAt: `${season}-12-02T12:00:00.000Z`,
  })
}

const history = buildMlbGameHistory([
  seasonArtifact(2024),
  seasonArtifact(2025),
  seasonArtifact(2026),
], {
  fetchedAt: '2026-07-28T12:00:00.000Z',
})

test('first-inning profiles are leakage-safe and combine offense with opponent allowance', () => {
  const profiles = buildFirstInningProfiles(history, { cutoffDate: '2026-04-06' })
  const matchup = firstInningMatchupContext(profiles, 1, 2)

  assert.equal(profiles.games, 25)
  assert.equal(profiles.halfInnings, 50)
  assert.ok(profiles.leagueHalfScoreRate > 0 && profiles.leagueHalfScoreRate < 1)
  assert.ok(matchup.scoringProbability >= 0.12 && matchup.scoringProbability <= 0.5)
  assert.ok(matchup.recent30ScoringProbability >= 0.12 && matchup.recent30ScoringProbability <= 0.5)
  assert.ok(Number.isFinite(matchup.teamRecent30YrfiRate))
  assert.ok(matchup.expectedRuns > 0)
  assert.ok(matchup.offenseGames > 0)
  assert.ok(matchup.defenseGames > 0)
})

test('Forecast V9 first-inning layer emits complementary NRFI and YRFI probabilities', () => {
  const game = {
    gamePk: 99,
    gameDate: '2026-07-28T23:10:00.000Z',
    awayTeam: { id: 1, name: 'Away', abbr: 'AWY' },
    homeTeam: { id: 2, name: 'Home', abbr: 'HME' },
    awayPitcher: { id: 50, name: 'Away Arm' },
    homePitcher: { id: 60, name: 'Home Arm' },
  }
  const rows = [
    ...Array.from({ length: 3 }, (_, index) => ({
      playerId: index + 1,
      name: `Away Hitter ${index + 1}`,
      teamId: 1,
      battingOrder: index + 1,
      lineupConfirmed: true,
      season: { ab: 300, obp: 0.34, slg: 0.46 },
      xStats: { xwOBA: 0.34 },
      pitcher: {
        id: 60,
        hand: 'R',
        recentForm: {
          firstInning: {
            coverage: 1,
            firstInningFip: 5.5,
            ttoK9: 6,
            ttoBb9: 4.5,
            sampleMode: 'current-season-only',
            currentWindowStarts: 8,
            previousSeasonStartsUsed: 0,
          },
        },
      },
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      playerId: index + 11,
      name: `Home Hitter ${index + 1}`,
      teamId: 2,
      battingOrder: index + 1,
      lineupConfirmed: true,
      season: { ab: 300, obp: 0.31, slg: 0.39 },
      xStats: { xwOBA: 0.31 },
      pitcher: {
        id: 50,
        hand: 'R',
        recentForm: {
          firstInning: {
            coverage: 1,
            firstInningFip: 2.7,
            ttoK9: 10,
            ttoBb9: 2,
            sampleMode: 'current-season-only',
            currentWindowStarts: 8,
            previousSeasonStartsUsed: 0,
          },
        },
      },
    })),
  ]
  const gameProjection = {
    awayTeam: game.awayTeam,
    homeTeam: game.homeTeam,
    probablePitchers: {
      away: game.awayPitcher,
      home: game.homePitcher,
    },
    awayExpectedRuns: 5.1,
    homeExpectedRuns: 4.0,
    inputs: {
      away: {
        lineupSource: 'confirmed',
        starterFactor: 1.18,
        runEnvironmentFactor: 1.04,
        runEnvironmentCoverage: 1,
        baseRunsPerTeam: 4.42,
      },
      home: {
        lineupSource: 'confirmed',
        starterFactor: 0.88,
        runEnvironmentFactor: 1.04,
        runEnvironmentCoverage: 1,
        baseRunsPerTeam: 4.42,
      },
    },
  }
  const projection = buildFirstInningProjection({
    game,
    rows,
    gameProjection,
    profiles: buildFirstInningProfiles(history, { cutoffDate: '2026-07-28' }),
  })

  assert.equal(projection.version, 1)
  assert.equal(projection.model, 'Forecast V9 + 1st Inning Layer')
  assert.ok(Math.abs(projection.nrfiProbability + projection.yrfiProbability - 1) < 0.001)
  assert.equal(projection.pricesAvailable, false)
  assert.equal(projection.halves.away.topOrder.length, 3)
  assert.ok(projection.halves.away.scoringProbability > projection.halves.home.scoringProbability)
  assert.ok(projection.halves.away.pitcherFirstInning.factor > 1)
  assert.ok(projection.halves.home.pitcherFirstInning.factor < 1)
  assert.equal(projection.shadow.recent30Applied, false)
  assert.ok(Number.isFinite(projection.shadow.recent30YrfiProbability))
  assert.ok(['nrfi', 'yrfi'].includes(projection.lean))
  assert.ok(['strong', 'lean', 'watch', 'limited'].includes(projection.tier))
  assert.match(projection.evidence.case, /%/)
})

test('first-inning history evaluation is expanding-date and reports honest eligibility', () => {
  const evaluation = evaluateFirstInningHistory(history, {
    minimumPriorGames: 4,
    minimumSeasons: 3,
    minimumGames: 12,
    minimumDates: 12,
  })

  assert.equal(evaluation.methodology, 'expanding-date walk-forward first-inning backbone')
  assert.ok(evaluation.sample.games >= 12)
  assert.equal(evaluation.sample.seasons, 3)
  assert.ok(Number.isFinite(evaluation.model.brier))
  assert.ok(Number.isFinite(evaluation.baseline.brier))
  assert.ok(Number.isFinite(evaluation.model.pairedStandardError))
  assert.ok(Number.isFinite(evaluation.model.improvementLowerBound90))
  assert.equal(evaluation.challengers.recent30Team.applied, false)
  assert.ok(Number.isFinite(evaluation.challengers.recent30Team.brier))
  assert.ok(['eligible', 'hold'].includes(evaluation.status))
})
