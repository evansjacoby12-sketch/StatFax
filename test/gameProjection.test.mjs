import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGameProjection,
  evaluateGameForecasts,
  gameMarketBlendPolicy,
  gameTotalProbabilities,
  negativeBinomialDistribution,
  scoreDistributionSummary,
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
  recentIp = 25,
  recentGames = 5,
  seasonIp = 100,
  seasonStarts = 18,
  isOpener = false,
  pitcherHand = 'R',
  platoon = null,
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
  platoon,
  parkWeatherHandFactor: 1,
  pitcher: {
    id: pitcherId,
    hand: pitcherHand,
    isOpener,
    season: { ip: seasonIp, gs: seasonStarts, era },
    recentForm: { ip: recentIp, games: recentGames, era },
    xStats: { xEra: era, xwOba: 0.320 },
  },
})

const balancedRows = () => [
  ...Array.from({ length: 9 }, (_, index) => batter(index + 1, 1, 60)),
  ...Array.from({ length: 9 }, (_, index) => batter(index + 11, 2, 50, { order: index + 1 })),
]

test('overdispersed run and win distributions are normalized and respond to scoring strength', () => {
  const runDistribution = negativeBinomialDistribution(4.5)
  const runMean = runDistribution.reduce((sum, probability, runs) => sum + probability * runs, 0)
  const runVariance = runDistribution.reduce(
    (sum, probability, runs) => sum + probability * ((runs - runMean) ** 2),
    0,
  )
  assert.ok(Math.abs(runDistribution.reduce((sum, probability) => sum + probability, 0) - 1) < 1e-12)
  assert.ok(Math.abs(runMean - 4.5) < 0.01)
  assert.ok(runVariance > runMean * 2)

  const even = winProbabilities(4.4, 4.4)
  assert.ok(even.home > 0.5)
  assert.ok(Math.abs(even.home + even.away - 1) < 1e-12)
  const strongerHome = winProbabilities(3.5, 5.5)
  assert.ok(strongerHome.home > even.home)

  const totals = gameTotalProbabilities(8.8, 8.5)
  assert.ok(Math.abs(totals.over + totals.under + totals.push - 1) < 1e-12)
  assert.equal(totals.push, 0)
})

test('score summary exposes central 80% ranges and permits an honest tied mode', () => {
  const summary = scoreDistributionSummary(4.5, 4.5)
  assert.equal(summary.family, 'negative-binomial')
  assert.equal(summary.parameterization, 'NB2')
  assert.equal(summary.intervalLevel, 0.8)
  assert.equal(summary.mostLikelyScore.away, summary.mostLikelyScore.home)
  assert.ok(summary.away.low <= summary.away.mean && summary.away.high >= summary.away.mean)
  assert.ok(summary.total.low <= summary.total.mean && summary.total.high >= summary.total.mean)
  assert.ok(summary.away.coverage >= 0.8)
  assert.ok(summary.total.coverage >= 0.8)
})

test('game projection emits run ranges, transparent factors, and market comparison', () => {
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
  assert.equal(output.modelVersion, 7)
  assert.ok(output.projectedTotal > 7 && output.projectedTotal < 11)
  assert.equal(output.estimatedScore.away + output.estimatedScore.home > 0, true)
  assert.deepEqual(output.estimatedScore, {
    away: output.scoreDistribution.mostLikelyScore.away,
    home: output.scoreDistribution.mostLikelyScore.home,
  })
  assert.equal(output.scoreDistribution.family, 'negative-binomial')
  assert.equal(output.scoreDistribution.dispersion, 3.5)
  assert.ok(output.scoreDistribution.total.high > output.scoreDistribution.total.low)
  assert.equal(output.marketBlend.policyStatus, 'collecting')
  assert.equal(output.marketBlend.applied, false)
  assert.ok(Math.abs(output.awayWinProbability + output.homeWinProbability - 1) < 0.0002)
  assert.equal(output.inputs.away.lineupSource, 'confirmed')
  assert.equal(output.inputs.away.starterWorkloadSource, 'recent-starts')
  assert.ok(output.inputs.away.expectedStarterIP > 4)
  assert.ok(Math.abs(output.inputs.away.starterShare + output.inputs.away.bullpenShare - 1) < 0.001)
  assert.ok(Number.isFinite(output.inputs.away.pitchingFactor))
  assert.equal(output.marketComparison.total.line, 8.5)
  assert.ok(Number.isFinite(output.marketComparison.moneyline.homeModelEdge))
})

test('market blend stays off without evidence and applies only cleared components', () => {
  const market = {
    consensus: {
      moneyline: {
        books: 2,
        away: { fairProbability: 0.35 },
        home: { fairProbability: 0.65 },
      },
      total: {
        books: 2,
        line: 10.5,
        over: { fairProbability: 0.5 },
        under: { fairProbability: 0.5 },
      },
    },
  }
  const baseline = buildGameProjection({ game, rows: balancedRows(), gameOdds: market })
  assert.equal(baseline.marketBlend.applied, false)
  assert.equal(baseline.marketBlend.total.baseProjectedTotal, baseline.projectedTotal)

  const policy = gameMarketBlendPolicy({
    minimumSample: { games: 100, dates: 10 },
    sample: { dates: 12 },
    winner: { marketSample: 140, marketDates: 12, baseImprovementVsMarket: -0.02 },
    total: { marketSample: 135, marketDates: 11, baseImprovementVsMarket: -0.5 },
  })
  assert.equal(policy.status, 'active')
  assert.equal(policy.side.active, true)
  assert.equal(policy.total.active, true)
  assert.ok(policy.side.weight > 0 && policy.side.weight <= 0.2)
  assert.ok(policy.total.weight > 0 && policy.total.weight <= 0.2)
  assert.equal(gameMarketBlendPolicy({
    minimumSample: { games: 100, dates: 10 },
    winner: { marketSample: 140, marketDates: 9, baseImprovementVsMarket: -0.02 },
    total: { marketSample: 135, marketDates: 9, baseImprovementVsMarket: -0.5 },
  }).status, 'collecting')
  assert.equal(gameMarketBlendPolicy({
    minimumSample: { games: 100, dates: 10 },
    winner: { marketSample: 140, marketDates: 12, baseImprovementVsMarket: 0.01 },
    total: { marketSample: 135, marketDates: 11, baseImprovementVsMarket: 0.2 },
  }).status, 'inactive')

  const blended = buildGameProjection({
    game,
    rows: balancedRows(),
    gameOdds: market,
    marketBlendPolicy: policy,
  })
  assert.equal(blended.marketBlend.applied, true)
  assert.equal(blended.marketBlend.side.applied, true)
  assert.equal(blended.marketBlend.total.applied, true)
  assert.ok(blended.projectedTotal > baseline.projectedTotal)
  assert.ok(blended.projectedTotal < market.consensus.total.line)
  assert.ok(
    blended.homeWinProbability > blended.marketBlend.side.preBlendHomeWinProbability
    && blended.homeWinProbability < market.consensus.moneyline.home.fairProbability,
  )
})

test('handed lineup production adds a bounded matchup adjustment', () => {
  const baseline = buildGameProjection({ game, rows: balancedRows() })
  const splitRows = balancedRows().map((row) => (
    row.teamId === 1
      ? batter(row.playerId, 1, 60, {
        order: row.battingOrder,
        pitcherHand: 'R',
        platoon: {
          vr: { pa: 240, ab: 210, obp: 0.405, slg: 0.590 },
          vl: { pa: 80, ab: 70, obp: 0.280, slg: 0.330 },
        },
      })
      : row
  ))
  const favorable = buildGameProjection({ game, rows: splitRows })

  assert.equal(favorable.inputs.away.opposingPitcherHand, 'R')
  assert.equal(favorable.inputs.away.platoonCoverage, 1)
  assert.ok(favorable.inputs.away.platoonFactor > 1)
  assert.ok(favorable.awayExpectedRuns > baseline.awayExpectedRuns)
  assert.ok(favorable.homeExpectedRuns === baseline.homeExpectedRuns)
})

test('run-specific park and weather context replaces the HR environment proxy', () => {
  const neutral = buildGameProjection({
    game,
    rows: balancedRows(),
    gameRunEnvironments: {
      10: {
        factor: 1,
        rawParkFactor: 1,
        appliedParkFactor: 1,
        weatherFactor: 1,
        tempFactor: 1,
        windFactor: 1,
        windComponent: 0,
        tempF: 72,
        windSpeedMph: 0,
        parkPeriod: '2024-2026',
        parkSource: 'Baseball Savant Statcast Park Factors',
        weatherStatus: 'outdoor',
        roofClosed: false,
        roofPending: false,
        coverage: 1,
      },
    },
  })
  const boosted = buildGameProjection({
    game,
    rows: balancedRows(),
    gameRunEnvironments: {
      10: {
        ...neutral.inputs.away.runEnvironment,
        factor: 1.1,
        rawParkFactor: 1.1,
        appliedParkFactor: 1.065,
        weatherFactor: 1.033,
      },
    },
  })

  assert.equal(boosted.inputs.away.environmentSource, 'run-specific')
  assert.equal(boosted.inputs.away.runEnvironmentFactor, 1.1)
  assert.ok(boosted.projectedTotal > neutral.projectedTotal)
})

test('opponent defense, team baserunning, and schedule fatigue move expected runs conservatively', () => {
  const schedule = (factor) => ({
    factor,
    targetDate: '2026-07-27',
    lastGameDate: '2026-07-26',
    daysRest: 0,
    previousDayGames: factor < 1 ? 2 : 1,
    consecutiveDays: factor < 1 ? 8 : 2,
    sameSeries: factor === 1,
    travelSpot: factor < 1,
    secondDoubleheaderGame: false,
    historyGames: 100,
    coverage: 1,
  })
  const profile = (teamId, defenseFactor, baserunningFactor) => ({
    teamId,
    teamName: `Team ${teamId}`,
    games: 100,
    errorsPerGame: 0.5,
    doublePlaysPerGame: 0.8,
    caughtStealingDefensePerGame: 0.15,
    stolenBases: 80,
    caughtStealing: 20,
    baserunningRunsPerGame: 0.1,
    defenseRunsAdjustment: (defenseFactor - 1) * 4.42,
    baserunningRunsAdjustment: (baserunningFactor - 1) * 4.42,
    defenseFactor,
    baserunningFactor,
    coverage: 1,
  })
  const favorable = buildGameProjection({
    game,
    rows: balancedRows(),
    teamSeasonRunProfiles: {
      teams: {
        1: profile(1, 1, 1.02),
        2: profile(2, 1.04, 1),
      },
    },
    gameScheduleContexts: {
      byGame: { 10: { 1: schedule(1), 2: schedule(1) } },
    },
  })
  const fatigued = buildGameProjection({
    game,
    rows: balancedRows(),
    teamSeasonRunProfiles: {
      teams: {
        1: profile(1, 1, 0.98),
        2: profile(2, 0.96, 1),
      },
    },
    gameScheduleContexts: {
      byGame: { 10: { 1: schedule(0.96), 2: schedule(1) } },
    },
  })

  assert.ok(favorable.awayExpectedRuns > fatigued.awayExpectedRuns)
  assert.equal(favorable.inputs.away.opponentDefenseFactor, 1.04)
  assert.equal(fatigued.inputs.away.scheduleFactor, 0.96)
  assert.equal(fatigued.inputs.away.teamRunContext.schedule.previousDayGames, 2)
})

test('starter quality carries more weight for a long outing than an opener', () => {
  const longAce = balancedRows().map((row) => (
    row.teamId === 1
      ? batter(row.playerId, 1, 60, {
        era: 2.2,
        order: row.battingOrder,
        recentIp: 34,
        recentGames: 5,
        seasonIp: 125,
        seasonStarts: 19,
      })
      : row
  ))
  const opener = balancedRows().map((row) => (
    row.teamId === 1
      ? batter(row.playerId, 1, 60, {
        era: 2.2,
        order: row.battingOrder,
        recentIp: 5,
        recentGames: 5,
        seasonIp: 30,
        seasonStarts: 20,
        isOpener: true,
      })
      : row
  ))
  const longProjection = buildGameProjection({ game, rows: longAce })
  const openerProjection = buildGameProjection({ game, rows: opener })

  assert.ok(longProjection.inputs.away.expectedStarterIP > openerProjection.inputs.away.expectedStarterIP)
  assert.ok(longProjection.inputs.away.starterShare > openerProjection.inputs.away.starterShare)
  assert.ok(longProjection.awayExpectedRuns < openerProjection.awayExpectedRuns)
})

test('weak or depleted bullpen context raises opponent expected runs', () => {
  const strong = buildGameProjection({
    game,
    rows: balancedRows(),
    bullpenRunProfiles: {
      2: { qualityFactor: 0.82, estimatedRunsAllowed9: 3.5, hr9: 0.9, coverage: 1 },
    },
    bullpenAvailability: {
      2: {
        factor: 1,
        unavailable: 0,
        taxed: 0,
        unavailableShare: 0,
        taxedShare: 0,
        unavailableNames: [],
        coverage: 1,
      },
    },
  })
  const depleted = buildGameProjection({
    game,
    rows: balancedRows(),
    bullpenRunProfiles: {
      2: { qualityFactor: 1.24, estimatedRunsAllowed9: 5.4, hr9: 1.5, coverage: 1 },
    },
    bullpenAvailability: {
      2: {
        factor: 1.07,
        unavailable: 2,
        taxed: 3,
        unavailableShare: 0.4,
        taxedShare: 0.3,
        unavailableNames: ['Closer A', 'Setup B'],
        coverage: 1,
      },
    },
  })

  assert.ok(depleted.awayExpectedRuns > strong.awayExpectedRuns)
  assert.equal(depleted.inputs.away.bullpenUnavailable, 2)
  assert.equal(depleted.inputs.away.bullpenTaxed, 3)
  assert.deepEqual(depleted.inputs.away.bullpenContext.unavailableNames, ['Closer A', 'Setup B'])
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
  assert.equal(evaluation.version, 2)
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
  assert.equal(evaluation.winner.marketDates, 2)
  assert.equal(evaluation.total.marketDates, 2)
  assert.equal(evaluation.winner.pairedBaseBrier, evaluation.winner.pairedModelBrier)
  assert.equal(evaluation.total.pairedBaseMae, evaluation.total.pairedModelMae)
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
  assert.equal(gameMarketBlendPolicy(evaluation).status, 'collecting')
})
