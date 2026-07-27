import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGameProjection,
  evaluateGameForecasts,
  gameTotalProbabilities,
  settleGameForecasts,
  updateGameForecastLog,
  winProbabilities,
} from '../src/sports/mlb/logic/gameProjection.js'

const game = {
  gamePk: 10,
  gameDate: '2026-07-27T23:10:00.000Z',
  isLive: false,
  isFinal: false,
  awayTeam: { id: 1, name: 'Away', abbr: 'AWY' },
  homeTeam: { id: 2, name: 'Home', abbr: 'HME' },
  awayPitcher: { id: 50, name: 'Away Arm' },
  homePitcher: { id: 60, name: 'Home Arm' },
}

const batter = (playerId, teamId, pitcherId, {
  obp = 0.330,
  slg = 0.440,
  era = 4.25,
  order = playerId,
} = {}) => ({
  playerId,
  gamePk: 10,
  teamId,
  battingOrder: order,
  projectedBattingOrder: order,
  lineupConfirmed: true,
  expectedPAs: order <= 4 ? 4.5 : 4,
  season: { ab: 300, obp, slg, ops: obp + slg },
  recent: { ab: 40, slg },
  xStats: { xwOBA: obp },
  parkWeatherHandFactor: 1,
  pitcher: {
    id: pitcherId,
    season: { ip: 100, era },
    recentForm: { ip: 25, era },
    xStats: { xEra: era, xwOba: 0.320 },
  },
})

const balancedRows = () => [
  ...Array.from({ length: 9 }, (_, index) => batter(index + 1, 1, 60)),
  ...Array.from({ length: 9 }, (_, index) => batter(index + 11, 2, 50, { order: index + 1 })),
]

test('run and win distributions are normalized and respond to scoring strength', () => {
  const even = winProbabilities(4.4, 4.4)
  assert.ok(even.home > 0.5)
  assert.ok(Math.abs(even.home + even.away - 1) < 1e-12)
  const strongerHome = winProbabilities(3.5, 5.5)
  assert.ok(strongerHome.home > even.home)

  const totals = gameTotalProbabilities(8.8, 8.5)
  assert.ok(Math.abs(totals.over + totals.under + totals.push - 1) < 1e-12)
  assert.equal(totals.push, 0)
})

test('game projection emits expected score, transparent factors, and market comparison', () => {
  const rows = balancedRows()
  const output = buildGameProjection({
    game,
    rows,
    bullpenHR9: { 1: 1.2, 2: 1.2 },
    capturedAt: '2026-07-27T15:00:00.000Z',
    gameOdds: {
      consensus: {
        moneyline: {
          books: 2,
          away: { fairProbability: 0.47 },
          home: { fairProbability: 0.53 },
        },
        total: {
          books: 2,
          line: 8.5,
          over: { fairProbability: 0.49 },
          under: { fairProbability: 0.51 },
        },
      },
    },
  })

  assert.equal(output.advisoryOnly, true)
  assert.equal(output.captureState, 'pregame')
  assert.equal(output.modelVersion, 2)
  assert.ok(output.projectedTotal > 7 && output.projectedTotal < 11)
  assert.equal(output.estimatedScore.away + output.estimatedScore.home > 0, true)
  assert.ok(Math.abs(output.awayWinProbability + output.homeWinProbability - 1) < 0.0002)
  assert.equal(output.inputs.away.lineupSource, 'confirmed')
  assert.equal(output.marketComparison.total.line, 8.5)
  assert.ok(Number.isFinite(output.marketComparison.moneyline.homeModelEdge))
})

test('stronger offense and weaker opposing starter raise a team run projection', () => {
  const baseline = buildGameProjection({ game, rows: balancedRows() })
  const changed = balancedRows().map((row) => (
    row.teamId === 1
      ? batter(row.playerId, 1, 60, { obp: 0.380, slg: 0.540, era: 6.2, order: row.battingOrder })
      : row
  ))
  const aggressive = buildGameProjection({ game, rows: changed })
  assert.ok(aggressive.awayExpectedRuns > baseline.awayExpectedRuns)
})

test('season scoring form changes only the intended team and discloses its cutoff', () => {
  const baseline = buildGameProjection({ game, rows: balancedRows() })
  const teamScoringProfiles = {
    version: 1,
    source: 'MLB season final scores',
    season: 2026,
    cutoffDate: '2026-07-27',
    games: 100,
    leagueRunsPerTeam: 4.4,
    teams: {
      1: {
        games: 90,
        runsPerGame: 5.1,
        recent14: { runsPerGame: 5.4 },
        scoringIndex: 1.25,
        allowanceIndex: 1,
        coverage: 1,
      },
      2: {
        games: 90,
        runsAllowedPerGame: 4.9,
        recent14: { runsAllowedPerGame: 5.2 },
        scoringIndex: 1,
        allowanceIndex: 1.2,
        coverage: 1,
      },
    },
  }
  const withSeasonScores = buildGameProjection({
    game,
    rows: balancedRows(),
    teamScoringProfiles,
  })

  assert.ok(withSeasonScores.awayExpectedRuns > baseline.awayExpectedRuns)
  assert.ok(Math.abs(withSeasonScores.homeExpectedRuns - baseline.homeExpectedRuns) < 0.05)
  assert.equal(withSeasonScores.inputs.away.teamScoringFactor, 1.08)
  assert.equal(withSeasonScores.inputs.away.teamScoring.cutoffDate, '2026-07-27')
  assert.equal(withSeasonScores.inputs.away.teamScoring.teamGames, 90)
  assert.equal(withSeasonScores.inputs.away.baseRunsPerTeam, 4.4)
})

test('forecast tracker refreshes pregame rows and freezes them when the game starts', () => {
  const projection = buildGameProjection({
    game,
    rows: balancedRows(),
    capturedAt: '2026-07-27T22:30:00.000Z',
  })
  const first = updateGameForecastLog({}, '2026-07-27', [projection], [game], {
    capturedAt: '2026-07-27T22:30:00.000Z',
  })
  assert.equal(first.projections[0].freezeState, 'refreshing-pregame')

  const startedGame = { ...game, isLive: true }
  const second = updateGameForecastLog(first.log, '2026-07-27', [], [startedGame], {
    capturedAt: '2026-07-27T23:15:00.000Z',
  })
  assert.equal(second.projections[0].freezeState, 'final-pregame')
  assert.equal(second.projections[0].awayExpectedRuns, projection.awayExpectedRuns)
})

test('settlement uses only an explicitly frozen pregame capture', () => {
  const projection = {
    ...buildGameProjection({
      game,
      rows: balancedRows(),
      capturedAt: '2026-07-27T22:30:00.000Z',
    }),
    freezeState: 'final-pregame',
  }
  const snapshot = {
    date: '2026-07-27',
    finishedAt: '2026-07-28T04:00:00.000Z',
    games: [{ ...game, isFinal: true, awayScore: 3, homeScore: 5 }],
    gameProjections: { 10: projection },
  }
  const settled = settleGameForecasts({}, '2026-07-27', snapshot)
  const result = settled.gameForecasts.resultsByDate['2026-07-27'][0]
  assert.equal(result.actualTotal, 8)
  assert.equal(result.actualWinner, 'home')
  assert.equal(result.winnerCorrect, projection.projectedWinner === 'home')

  const leaked = structuredClone(snapshot)
  leaked.gameProjections[10].captureState = 'live'
  const rejected = settleGameForecasts({}, '2026-07-27', leaked)
  assert.equal(rejected.gameForecasts.resultsByDate['2026-07-27'], undefined)
})

test('forward evaluation reports winner calibration and total error against simple and market baselines', () => {
  const result = ({
    gamePk,
    date,
    homeProbability,
    homeWon,
    projectedTotal,
    actualTotal,
    marketHomeProbability,
    marketTotal,
  }) => ({
    modelVersion: 1,
    advisoryOnly: true,
    captureState: 'pregame',
    freezeState: 'final-pregame',
    gamePk,
    gameDate: `${date}T23:00:00.000Z`,
    capturedAt: `${date}T20:00:00.000Z`,
    settledAt: `${date}T23:59:00.000Z`,
    awayExpectedRuns: projectedTotal / 2,
    homeExpectedRuns: projectedTotal / 2,
    projectedTotal,
    estimatedScore: { away: 4, home: 5 },
    awayWinProbability: 1 - homeProbability,
    homeWinProbability: homeProbability,
    tieAfterNineProbability: 0.1,
    projectedWinner: homeProbability >= 0.5 ? 'home' : 'away',
    projectedWinnerProbability: Math.max(homeProbability, 1 - homeProbability),
    confidence: { status: 'medium', coverage: 0.9 },
    inputs: { away: {}, home: {} },
    actualAwayRuns: homeWon ? 3 : 5,
    actualHomeRuns: homeWon ? 5 : 3,
    actualTotal,
    actualWinner: homeWon ? 'home' : 'away',
    winnerCorrect: (homeProbability >= 0.5) === homeWon,
    marketComparison: {
      moneyline: { homeMarketProbability: marketHomeProbability },
      total: { line: marketTotal },
    },
  })
  const rows = [
    result({ gamePk: 1, date: '2026-07-25', homeProbability: 0.62, homeWon: true, projectedTotal: 8.5, actualTotal: 9, marketHomeProbability: 0.55, marketTotal: 8 }),
    result({ gamePk: 2, date: '2026-07-25', homeProbability: 0.58, homeWon: false, projectedTotal: 7.5, actualTotal: 7, marketHomeProbability: 0.52, marketTotal: 8.5 }),
    result({ gamePk: 3, date: '2026-07-26', homeProbability: 0.45, homeWon: false, projectedTotal: 10, actualTotal: 8, marketHomeProbability: 0.48, marketTotal: 8.5 }),
  ]
  const evaluation = evaluateGameForecasts({
    gameForecasts: {
      resultsByDate: {
        '2026-07-25': rows.slice(0, 2),
        '2026-07-26': rows.slice(2),
      },
    },
  })

  assert.equal(evaluation.status, 'collecting')
  assert.deepEqual(evaluation.sample, {
    games: 3,
    dates: 2,
    winnerGames: 3,
    totalGames: 3,
    marketMoneylineGames: 3,
    marketTotalGames: 3,
    progress: 0.03,
  })
  assert.equal(evaluation.winner.accuracy, 0.6667)
  assert.ok(evaluation.winner.brier < evaluation.winner.coinFlipBrier)
  assert.equal(evaluation.total.mae, 1)
  assert.equal(evaluation.total.bias, 0.667)
  assert.equal(evaluation.winner.calibration.reduce((sum, bin) => sum + bin.sample, 0), 3)
})

test('empty forward evaluation stays null-safe while results collect', () => {
  const evaluation = evaluateGameForecasts({})
  assert.equal(evaluation.sample.games, 0)
  assert.equal(evaluation.winner.brier, null)
  assert.equal(evaluation.total.rmse, null)
  assert.equal(evaluation.status, 'collecting')
})
