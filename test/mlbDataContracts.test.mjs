import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBacktestLog, validateDailySnapshot } from '../server/lib/mlbDataContracts.mjs'
import {
  CLEAN_PREGAME_FEATURE_CAPTURE,
  CLEAN_PREGAME_FEATURE_GENERATION,
  buildHistoricalFeatureCoverage,
  normalizeHistoricalFeatureVector,
} from '../server/lib/historicalFeatureArchive.mjs'
import { buildPitcherContactLeak } from '../src/sports/mlb/logic/pitcherContactLeak.js'
import { buildGameProjection, evaluateGameForecasts } from '../src/sports/mlb/logic/gameProjection.js'
import {
  buildGameMarketPortfolio,
  evaluateGameMarketPerformance,
} from '../src/sports/mlb/logic/gameMarketEvaluation.js'
import {
  buildMlbGameHistory,
  evaluateGameHistoricalValidation,
} from '../src/sports/mlb/logic/gameHistoricalValidation.js'
import { evaluateMultiSeasonRunPrior } from '../src/sports/mlb/logic/multiSeasonRunPrior.js'

const batter = (playerId = 1, gamePk = 10) => ({
  playerId,
  gamePk,
  score: 72,
  hrProbability: 0.18,
  grade: { label: 'PRIME' },
})

test('daily contract validates the three-season historical game gate', () => {
  const history = buildMlbGameHistory([], {
    fetchedAt: '2026-07-28T12:00:00.000Z',
  })
  const snapshot = {
    version: 5,
    date: '2026-07-28',
    generatedAt: '2026-07-28T12:00:00.000Z',
    finishedAt: '2026-07-28T12:00:01.000Z',
    games: [],
    scoredBatters: {},
    stats: { scoredBatters: 0 },
    gameHistoricalValidation: evaluateGameHistoricalValidation(history),
  }

  const validated = validateDailySnapshot(snapshot)
  assert.deepEqual(validated.errors, [])
  assert.equal(validated.metrics.gameHistoricalValidationGames, 0)

  snapshot.gameHistoricalValidation.methodology = 'random-holdout'
  assert.ok(validateDailySnapshot(snapshot).errors.some((error) => (
    error.includes('gameHistoricalValidation.methodology')
  )))
})

test('daily contract validates the multi-season run prior gate', () => {
  const history = buildMlbGameHistory([], {
    fetchedAt: '2026-07-28T12:00:00.000Z',
  })
  const snapshot = {
    version: 5,
    date: '2026-07-28',
    generatedAt: '2026-07-28T12:00:00.000Z',
    finishedAt: '2026-07-28T12:00:01.000Z',
    games: [],
    scoredBatters: {},
    stats: { scoredBatters: 0 },
    gameRunHistoricalEvaluation: evaluateMultiSeasonRunPrior(history),
  }

  const validated = validateDailySnapshot(snapshot)
  assert.deepEqual(validated.errors, [])
  assert.equal(validated.metrics.gameRunHistoricalEvaluationGames, 0)

  snapshot.gameRunHistoricalEvaluation.methodology = 'random-holdout'
  assert.ok(validateDailySnapshot(snapshot).errors.some((error) => (
    error.includes('gameRunHistoricalEvaluation.methodology')
  )))
})

test('daily contract accepts schema-v5 composite rows and canonical K output', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': batter() },
    stats: { scoredBatters: 1 },
    kDistByPitcher: {
      '50-10': {
        k: 6.1, lo: 3, hi: 9, lambda: 6.1, expIP: 5.7, expBF: 23,
        adjustedKRate: 0.28, calibration: 0.86, volumeSource: 'recent-pitches-bf',
        trend: 'up', conf: 'high', modelVersion: 2, probs: { 5.5: 0.59 },
      },
    },
  }
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])
})

test('daily contract validates de-vigged MLB game markets', () => {
  const price = (american, decimal, impliedProbability, fairProbability) => ({
    american, decimal, impliedProbability, fairProbability,
  })
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': batter() },
    stats: { scoredBatters: 1 },
    gameOdds: {
      10: {
        books: {
          fanduel: {
            moneyline: {
              away: price(120, 2.2, 1 / 2.2),
              home: price(-140, 1.714, 1 / 1.714),
            },
          },
        },
        consensus: {
          moneyline: {
            books: 1,
            away: price(120, 2.2, 1 / 2.2, 0.438),
            home: price(-140, 1.714, 1 / 1.714, 0.562),
          },
          total: null,
        },
      },
    },
  }
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])

  snapshot.gameOdds[10].consensus.moneyline.home.fairProbability = 0.8
  assert.ok(validateDailySnapshot(snapshot).errors.some((error) => error.includes('fair probabilities must sum to 1')))
})

test('daily and backtest contracts validate frozen game projections', () => {
  const projection = {
    modelVersion: 1,
    advisoryOnly: true,
    captureState: 'pregame',
    gamePk: 10,
    gameDate: '2026-07-14T23:00:00.000Z',
    capturedAt: '2026-07-14T20:00:00.000Z',
    awayExpectedRuns: 4.1,
    homeExpectedRuns: 4.5,
    projectedTotal: 8.6,
    estimatedScore: { away: 4, home: 5 },
    awayWinProbability: 0.46,
    homeWinProbability: 0.54,
    tieAfterNineProbability: 0.12,
    projectedWinner: 'home',
    projectedWinnerProbability: 0.54,
    confidence: { status: 'medium', coverage: 0.9 },
    inputs: { away: {}, home: {} },
    freezeState: 'final-pregame',
  }
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': batter() },
    stats: { scoredBatters: 1 },
    gameProjections: { 10: projection },
    gameProjectionEvaluation: evaluateGameForecasts({}),
    gameMarketEvaluation: evaluateGameMarketPerformance({}),
    gameMarketPortfolio: buildGameMarketPortfolio([projection]),
  }
  const validatedSnapshot = validateDailySnapshot(snapshot)
  assert.deepEqual(validatedSnapshot.errors, [])
  assert.equal(validatedSnapshot.metrics.gameMarketEvaluationCalls, 0)
  assert.equal(validatedSnapshot.metrics.gameMarketPortfolioSelections, 0)

  const result = {
    ...projection,
    actualAwayRuns: 3,
    actualHomeRuns: 5,
    actualTotal: 8,
    actualWinner: 'home',
    totalError: 0.6,
    absoluteTotalError: 0.6,
    winnerCorrect: true,
    winnerBrier: 0.2116,
  }
  const call = {
    capturedAt: projection.capturedAt,
    modelVersion: 1,
    projectionRevision: 1,
    estimatedScore: projection.estimatedScore,
    awayExpectedRuns: projection.awayExpectedRuns,
    homeExpectedRuns: projection.homeExpectedRuns,
    projectedTotal: projection.projectedTotal,
    awayWinProbability: projection.awayWinProbability,
    homeWinProbability: projection.homeWinProbability,
    projectedWinner: projection.projectedWinner,
    projectedWinnerProbability: projection.projectedWinnerProbability,
    marketDecision: null,
    market: null,
  }
  const ungradedOutcome = {
    version: 1,
    advisoryOnly: true,
    moneyline: {
      selectedSide: null,
      tier: 'unavailable',
      rawTier: 'unavailable',
      provisional: false,
      american: null,
      line: null,
      result: 'ungraded',
      unitProfit: null,
      includedInPerformance: false,
    },
    total: {
      selectedSide: null,
      tier: 'unavailable',
      rawTier: 'unavailable',
      provisional: false,
      american: null,
      line: null,
      result: 'ungraded',
      unitProfit: null,
      includedInPerformance: false,
    },
  }
  const log = {
    dates: [],
    records: {},
    gameForecasts: {
      version: 1,
      predictionsByDate: { '2026-07-14': [projection] },
      resultsByDate: { '2026-07-14': [result] },
      callsByDate: {
        '2026-07-14': {
          10: {
            gamePk: 10,
            gameDate: projection.gameDate,
            awayTeam: { id: 1, name: 'Away', abbr: 'AWY' },
            homeTeam: { id: 2, name: 'Home', abbr: 'HME' },
            status: 'frozen',
            opening: call,
            current: call,
            closing: call,
            firstCapturedAt: projection.capturedAt,
            lastObservedAt: projection.capturedAt,
            lastChangedAt: projection.capturedAt,
            closedAt: projection.gameDate,
            observationCount: 1,
            revisionCount: 1,
            revisions: [call],
            settlement: {
              actualAwayRuns: 3,
              actualHomeRuns: 5,
              actualTotal: 8,
              actualWinner: 'home',
              marketOutcome: ungradedOutcome,
              settlementSource: 'official-season-results',
              settledAt: '2026-07-15T12:00:00.000Z',
            },
          },
        },
      },
    },
  }
  const validatedLog = validateBacktestLog(log)
  assert.deepEqual(validatedLog.errors, [])
  assert.equal(validatedLog.metrics.gameMarketCallDays, 1)
  assert.equal(validatedLog.metrics.gameMarketCalls, 1)
  assert.equal(validatedLog.metrics.gameMarketCallRevisions, 1)

  const badCall = structuredClone(log)
  badCall.gameForecasts.callsByDate['2026-07-14']['10'].settlement.marketOutcome.total.includedInPerformance = true
  assert.ok(validateBacktestLog(badCall).errors.some((error) => error.includes('includedInPerformance')))

  const badEvaluation = structuredClone(snapshot)
  badEvaluation.gameProjectionEvaluation.status = 'production'
  assert.ok(validateDailySnapshot(badEvaluation).errors.some((error) => error.includes('gameProjectionEvaluation.status')))

  const badMarketEvaluation = structuredClone(snapshot)
  badMarketEvaluation.gameMarketEvaluation.markets.total.promotion.eligible = true
  assert.ok(validateDailySnapshot(badMarketEvaluation).errors.some((error) => error.includes('promotion.eligible')))

  snapshot.gameProjections[10].captureState = 'live'
  assert.ok(validateDailySnapshot(snapshot).errors.some((error) => error.includes('captureState')))
})

test('daily contract validates forecast v2 season-score provenance', () => {
  const scoring = {
    factor: 1.03,
    coverage: 1,
    cutoffDate: '2026-07-14',
    leagueRunsPerTeam: 4.45,
    teamGames: 94,
    teamRunsPerGame: 4.8,
    teamRecent14RunsPerGame: 5.1,
    opponentGames: 95,
    opponentRunsAllowedPerGame: 4.7,
    opponentRecent14RunsAllowedPerGame: 5,
  }
  const projection = {
    modelVersion: 2,
    advisoryOnly: true,
    captureState: 'pregame',
    gamePk: 10,
    gameDate: '2026-07-14T23:00:00.000Z',
    capturedAt: '2026-07-14T20:00:00.000Z',
    awayExpectedRuns: 4.3,
    homeExpectedRuns: 4.6,
    projectedTotal: 8.9,
    estimatedScore: { away: 4, home: 5 },
    awayWinProbability: 0.46,
    homeWinProbability: 0.54,
    tieAfterNineProbability: 0.12,
    projectedWinner: 'home',
    projectedWinnerProbability: 0.54,
    confidence: { status: 'medium', coverage: 0.92 },
    inputs: {
      away: { baseRunsPerTeam: 4.45, teamScoringFactor: 1.03, teamScoring: scoring },
      home: { baseRunsPerTeam: 4.45, teamScoringFactor: 0.98, teamScoring: { ...scoring, factor: 0.98 } },
    },
    freezeState: 'refreshing-pregame',
  }
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': batter() },
    stats: { scoredBatters: 1 },
    gameProjections: { 10: projection },
    gameScoreData: {
      version: 1,
      source: 'MLB season final scores',
      season: 2026,
      cutoffDate: '2026-07-14',
      archivedFinals: 1400,
      eligibleFinals: 1390,
      teams: 30,
      leagueRunsPerTeam: 4.45,
      evaluation: {
        version: 1,
        advisoryOnly: true,
        methodology: 'expanding-date walk-forward',
        minimumPriorGames: 100,
        minimumCoverage: 0.5,
        sample: {
          games: 1200,
          teamRuns: 2400,
          dates: 90,
          fromDate: '2026-04-10',
          throughDate: '2026-07-13',
        },
        baseline: { teamRunMae: 2.6, teamRunRmse: 3.3, winnerAccuracy: 0.52 },
        seasonForm: { teamRunMae: 2.55, teamRunRmse: 3.25, winnerAccuracy: 0.55 },
        improvement: { teamRunMae: 0.05, teamRunRmse: 0.05, winnerAccuracy: 0.03 },
      },
    },
  }

  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])
  delete snapshot.gameProjections[10].inputs.away.teamScoring
  assert.ok(validateDailySnapshot(snapshot).errors.some((error) => error.includes('teamScoring: expected an object')))
})

test('daily contract validates forecast v3 workload and bullpen provenance', () => {
  const scoring = {
    factor: 1,
    coverage: 1,
    cutoffDate: '2026-07-14',
    leagueRunsPerTeam: 4.45,
    teamGames: 94,
    teamRunsPerGame: 4.5,
    teamRecent14RunsPerGame: 4.6,
    opponentGames: 95,
    opponentRunsAllowedPerGame: 4.4,
    opponentRecent14RunsAllowedPerGame: 4.3,
  }
  const inputs = {
    baseRunsPerTeam: 4.45,
    teamScoringFactor: 1,
    teamScoring: scoring,
    starterFactor: 0.92,
    bullpenFactor: 1.04,
    bullpenAvailabilityFactor: 1.02,
    pitchingFactor: 0.97,
    expectedStarterIP: 5.4,
    starterWorkloadSource: 'recent-starts',
    starterWorkloadCoverage: 1,
    starterShare: 0.6,
    bullpenShare: 0.4,
    bullpenEstimatedRunsAllowed9: 4.42,
    bullpenUnavailable: 1,
    bullpenTaxed: 2,
    bullpenContext: {
      qualityFactor: 1.04,
      availabilityFactor: 1.02,
      unavailableShare: 0.2,
      taxedShare: 0.3,
      unavailableNames: ['Closer A'],
      coverage: 1,
    },
  }
  const projection = {
    modelVersion: 3,
    advisoryOnly: true,
    captureState: 'pregame',
    gamePk: 10,
    gameDate: '2026-07-14T23:00:00.000Z',
    capturedAt: '2026-07-14T20:00:00.000Z',
    awayExpectedRuns: 4.3,
    homeExpectedRuns: 4.6,
    projectedTotal: 8.9,
    estimatedScore: { away: 4, home: 5 },
    awayWinProbability: 0.46,
    homeWinProbability: 0.54,
    tieAfterNineProbability: 0.12,
    projectedWinner: 'home',
    projectedWinnerProbability: 0.54,
    confidence: { status: 'medium', coverage: 0.92 },
    inputs: {
      away: inputs,
      home: { ...inputs, bullpenContext: { ...inputs.bullpenContext } },
    },
    freezeState: 'refreshing-pregame',
  }
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': batter() },
    stats: { scoredBatters: 1 },
    gameProjections: { 10: projection },
  }

  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])

  const tampered = structuredClone(snapshot)
  tampered.gameProjections[10].inputs.away.bullpenShare = 0.6
  assert.ok(validateDailySnapshot(tampered).errors.some((error) => error.includes('must sum to 1')))

  const mismatched = structuredClone(snapshot)
  mismatched.gameProjections[10].inputs.home.bullpenContext.qualityFactor = 1.2
  assert.ok(validateDailySnapshot(mismatched).errors.some((error) => error.includes('must match bullpenContext')))
})

test('daily contract validates forecast v4 platoon and run-environment provenance', () => {
  const projection = {
    ...buildGameProjection({
      game: {
        gamePk: 10,
        gameDate: '2026-07-14T23:00:00.000Z',
        isLive: false,
        isFinal: false,
        awayTeam: { id: 1, name: 'Away', abbr: 'AWY' },
        homeTeam: { id: 2, name: 'Home', abbr: 'HME' },
      },
      rows: [],
      capturedAt: '2026-07-14T20:00:00.000Z',
      gameRunEnvironments: {
        10: {
          factor: 1.05,
          rawParkFactor: 1.06,
          appliedParkFactor: 1.039,
          weatherFactor: 1.0106,
          tempFactor: 1.012,
          windFactor: 0.9986,
          windComponent: -0.1,
          tempF: 80,
          windSpeedMph: 7,
          parkPeriod: '2024-2026',
          parkSource: 'Baseball Savant Statcast Park Factors',
          weatherStatus: 'outdoor',
          roofClosed: false,
          roofPending: false,
          coverage: 1,
        },
      },
    }),
    modelVersion: 4,
    freezeState: 'refreshing-pregame',
  }
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': batter() },
    stats: { scoredBatters: 1 },
    gameProjections: { 10: projection },
  }

  assert.equal(projection.modelVersion, 4)
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])

  const wrongSource = structuredClone(snapshot)
  wrongSource.gameProjections[10].inputs.away.environmentSource = 'legacy-hr-fallback'
  assert.ok(validateDailySnapshot(wrongSource).errors.some((error) => error.includes('expected run-specific')))

  const mismatched = structuredClone(snapshot)
  mismatched.gameProjections[10].inputs.home.runEnvironment.factor = 0.9
  assert.ok(validateDailySnapshot(mismatched).errors.some((error) => error.includes('must match runEnvironment.factor')))
})

test('daily contract validates forecast v11 pricing, blow-up risk, decisions, team context, and run-prior provenance', () => {
  const runEnvironment = {
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
  }
  const team = (teamId, defenseFactor, baserunningFactor) => ({
    teamId,
    teamName: `Team ${teamId}`,
    games: 100,
    errorsPerGame: 0.5,
    doublePlaysPerGame: 0.8,
    caughtStealingDefensePerGame: 0.15,
    stolenBases: 70,
    caughtStealing: 20,
    baserunningRunsPerGame: 0.05,
    defenseRunsAdjustment: (defenseFactor - 1) * 4.42,
    baserunningRunsAdjustment: (baserunningFactor - 1) * 4.42,
    defenseFactor,
    baserunningFactor,
    coverage: 1,
  })
  const schedule = {
    factor: 0.995,
    targetDate: '2026-07-14',
    lastGameDate: '2026-07-13',
    daysRest: 0,
    previousDayGames: 1,
    consecutiveDays: 3,
    sameSeries: false,
    travelSpot: true,
    secondDoubleheaderGame: false,
    historyGames: 90,
    coverage: 1,
  }
  const projection = {
    ...buildGameProjection({
      game: {
        gamePk: 10,
        gameDate: '2026-07-14T23:00:00.000Z',
        isLive: false,
        isFinal: false,
        awayTeam: { id: 1, name: 'Away', abbr: 'AWY' },
        homeTeam: { id: 2, name: 'Home', abbr: 'HME' },
      },
      rows: [],
      capturedAt: '2026-07-14T20:00:00.000Z',
      gameRunEnvironments: { 10: runEnvironment },
      teamSeasonRunProfiles: {
        teams: {
          1: team(1, 1.01, 0.99),
          2: team(2, 0.98, 1.01),
        },
      },
      gameScheduleContexts: {
        byGame: { 10: { 1: schedule, 2: { ...schedule } } },
      },
      gameOdds: {
        consensus: {
          total: {
            books: 2,
            line: 8.5,
            over: { fairProbability: 0.49 },
            under: { fairProbability: 0.51 },
          },
        },
      },
    }),
    freezeState: 'refreshing-pregame',
  }
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': batter() },
    stats: { scoredBatters: 1 },
    gameProjections: { 10: projection },
  }

  assert.equal(projection.modelVersion, 11)
  assert.equal(projection.marketDecision.version, 2)
  assert.ok(projection.marketDecision.total.blowUpRisk)
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])

  const missingBlowUpRisk = structuredClone(snapshot)
  delete missingBlowUpRisk.gameProjections[10].marketDecision.total.blowUpRisk
  assert.ok(validateDailySnapshot(missingBlowUpRisk).errors.some((error) => (
    error.includes('total.blowUpRisk: required')
  )))

  const invalidBlowUpCap = structuredClone(snapshot)
  invalidBlowUpCap.gameProjections[10].marketDecision.total.blowUpRisk.capApplied = true
  assert.ok(validateDailySnapshot(invalidBlowUpCap).errors.some((error) => (
    error.includes('capApplied: inconsistent')
  )))

  const missingRunPriorProvenance = structuredClone(snapshot)
  delete missingRunPriorProvenance.gameProjections[10].inputs.away.teamScoring.currentSeasonFactor
  assert.ok(validateDailySnapshot(missingRunPriorProvenance).errors.some((error) => (
    error.includes('teamScoring.currentSeasonFactor')
  )))

  const undisclosedRunPrior = structuredClone(snapshot)
  undisclosedRunPrior.gameProjections[10].inputs.away.teamScoring.historicalEnabled = true
  assert.ok(validateDailySnapshot(undisclosedRunPrior).errors.some((error) => (
    error.includes('must disclose an enabled historical blend')
  )))

  const legacyPolicy = structuredClone(snapshot)
  for (const market of ['moneyline', 'total']) {
    const policy = legacyPolicy.gameProjections[10].marketDecision.policy[market]
    for (const field of [
      'historicalGate',
      'historicalStatus',
      'driftStatus',
      'evidenceSource',
      'historicalSample',
    ]) delete policy[field]
  }
  assert.deepEqual(validateDailySnapshot(legacyPolicy).errors, [])

  const incompleteHistoricalPolicy = structuredClone(snapshot)
  delete incompleteHistoricalPolicy.gameProjections[10].marketDecision.policy.moneyline.evidenceSource
  assert.ok(validateDailySnapshot(incompleteHistoricalPolicy).errors.some((error) => (
    error.includes('policy.moneyline.evidenceSource')
  )))

  const tampered = structuredClone(snapshot)
  tampered.gameProjections[10].inputs.away.teamRunContext.schedule.factor = 0.96
  assert.ok(validateDailySnapshot(tampered).errors.some((error) => error.includes('must match teamRunContext.schedule.factor')))

  const underdispersed = structuredClone(snapshot)
  underdispersed.gameProjections[10].scoreDistribution.away.variance = 1
  assert.ok(validateDailySnapshot(underdispersed).errors.some((error) => error.includes('must be overdispersed')))

  const mismatchedMode = structuredClone(snapshot)
  mismatchedMode.gameProjections[10].scoreDistribution.mostLikelyScore.away += 1
  assert.ok(validateDailySnapshot(mismatchedMode).errors.some((error) => error.includes('must match away.mode')))

  const badBlend = structuredClone(snapshot)
  badBlend.gameProjections[10].marketBlend.total.finalProjectedTotal += 1
  assert.ok(validateDailySnapshot(badBlend).errors.some((error) => error.includes('must match projectedTotal')))

  const badDecision = structuredClone(snapshot)
  badDecision.gameProjections[10].marketDecision.moneyline.tier = 'play'
  assert.ok(validateDailySnapshot(badDecision).errors.some((error) => error.includes('PLAY cannot be provisional')))
})

test('daily contract rejects the retired bare alias and invalid probability', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { 1: { ...batter(), hrProbability: 1.4 } },
    stats: { scoredBatters: 1 },
  }
  const check = validateDailySnapshot(snapshot)
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => error.includes('expected composite key 1-10')))
  assert.ok(check.errors.some((error) => error.includes('hrProbability')))
})

test('daily contract validates attached Pitcher Contact Leak evidence', () => {
  const pitcherContactLeak = buildPitcherContactLeak({
    batSide: 'L',
    pitcher: {
      hand: 'R',
      season: { ip: 100, goAo: 0.7, kPer9: 7 },
      savant: { hardHitPctAllowed: 44, barrelPctAllowed: 10, exitVeloAgainst: 91 },
      splits: { vl: { bf: 180, iso: 0.22, hrPer9: 1.7 } },
    },
  })
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': { ...batter(), pitcherContactLeak } },
    stats: { scoredBatters: 1 },
  }
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])
  snapshot.scoredBatters['1-10'].pitcherContactLeak.qualifies = false
  assert.ok(validateDailySnapshot(snapshot).errors.some((error) => error.includes('qualifies')))
})

test('daily contract rejects team, side, and opposing-starter identity contradictions', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{
      gamePk: 10,
      awayTeam: { id: 1 },
      homeTeam: { id: 2 },
      awayPitcher: { id: 50 },
      homePitcher: { id: 60 },
    }],
    scoredBatters: {
      '1-10': {
        ...batter(), teamId: 1, isHome: true, pitcher: { id: 50 },
      },
      '2-10': {
        ...batter(2), teamId: 999, isHome: false, pitcher: { id: 60 },
      },
    },
    stats: { scoredBatters: 2 },
  }
  const check = validateDailySnapshot(snapshot)
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => error.includes('isHome: contradicts teamId')))
  assert.ok(check.errors.some((error) => error.includes('pitcher.id: expected opposing starter 60')))
  assert.ok(check.errors.some((error) => error.includes('teamId: does not belong to game')))
})

test('daily contract permits only explicit live pregame-freeze pitcher corrections', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-25',
    generatedAt: '2026-07-25T23:50:00.000Z',
    finishedAt: '2026-07-25T23:50:01.000Z',
    games: [{
      gamePk: 10,
      isLive: true,
      awayTeam: { id: 1 },
      homeTeam: { id: 2 },
      awayPitcher: { id: 50, name: 'Away Arm' },
      homePitcher: { id: 60, name: 'Corrected Starter' },
    }],
    scoredBatters: {
      '1-10': {
        ...batter(),
        teamId: 1,
        isHome: false,
        pitcher: { id: 55, name: 'Prediction Starter' },
        currentPitcher: { id: 60, name: 'Corrected Starter' },
        pitcherChanged: true,
        pitcherProvenance: 'pregame-freeze',
      },
    },
    stats: { scoredBatters: 1 },
  }

  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])

  const unmarked = structuredClone(snapshot)
  delete unmarked.scoredBatters['1-10'].pitcherProvenance
  assert.ok(validateDailySnapshot(unmarked).errors.some((error) => error.includes('expected opposing starter 60')))

  const pregame = structuredClone(snapshot)
  pregame.games[0].isLive = false
  assert.ok(validateDailySnapshot(pregame).errors.some((error) => error.includes('expected opposing starter 60')))

  const wrongCorrection = structuredClone(snapshot)
  wrongCorrection.scoredBatters['1-10'].currentPitcher.id = 61
  assert.ok(validateDailySnapshot(wrongCorrection).errors.some((error) => error.includes('expected opposing starter 60')))
})

test('daily contract identity-binds a frozen pregame prediction record', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-25',
    generatedAt: '2026-07-25T23:50:00.000Z',
    finishedAt: '2026-07-25T23:50:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: {
      '1-10': {
        ...batter(),
        preGamePredictionRecord: {
          featureCapture: CLEAN_PREGAME_FEATURE_CAPTURE,
          featureGeneration: CLEAN_PREGAME_FEATURE_GENERATION,
          featureVersion: 2,
          feat: normalizeHistoricalFeatureVector({}),
          pitchTypes: [],
          playerId: 1,
          gamePk: 10,
          name: 'Batter',
          score: 72,
          grade: 'PRIME',
          badges: [],
          lineupConfirmed: true,
          dataTrusted: true,
          simHRProb: 0.12,
          rawScore: 70,
          rawGrade: 'STRONG',
          preCapScore: 72,
          preCapGrade: 'PRIME',
          displayGrade: 'PRIME',
          hrModelVersion: 2,
          probabilityPipelineVersion: 2,
          publishedHRProbability: 0.16,
          hrProbabilityTrace: {
            telemetryVersion: 1,
            modelVersion: 2,
            probabilityPipelineVersion: 2,
            calibrationSource: 'current-version',
            rawSimulation: 0.12,
            calibratedAnchor: 0.15,
            simResolutionWeight: 0,
            simResolved: 0.15,
            leaguePowerFactor: 1,
            powerAdjusted: 0.15,
            zoneLogitDelta: 0.08,
            published: 0.16,
          },
          zoneEvidence: null,
          contactLeakEvidence: null,
        },
      },
    },
    stats: { scoredBatters: 1 },
  }
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])

  const badTelemetry = structuredClone(snapshot)
  badTelemetry.scoredBatters['1-10'].preGamePredictionRecord.hrProbabilityTrace.published = 0.20
  assert.ok(validateDailySnapshot(badTelemetry).errors.some((error) => error.includes('must match publishedHRProbability')))

  snapshot.scoredBatters['1-10'].preGamePredictionRecord.gamePk = 11
  const invalid = validateDailySnapshot(snapshot)
  assert.equal(invalid.ok, false)
  assert.ok(invalid.errors.some((error) => error.includes('preGamePredictionRecord.gamePk')))
})

test('backtest contract enforces operational/archive caps and synchronization', () => {
  const row = {
    playerId: 1, gamePk: 10, score: 70, homered: false, actuallyPlayed: true,
    grade: 'STRONG', badges: [], simHRProb: 0.12, feat: { bs: 60 },
  }
  const log = {
    dates: ['2026-07-13'],
    records: { '2026-07-13': [row] },
    modelHistory: { version: 1, dates: ['2026-07-13'], records: { '2026-07-13': [row] } },
    kProps: { estByDate: {}, resultsByDate: {} },
  }
  assert.deepEqual(validateBacktestLog(log).errors, [])

  const broken = structuredClone(log)
  broken.modelHistory.dates = []
  const check = validateBacktestLog(broken)
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => error.includes('missing operational date')))
})

test('backtest contract validates doubleheader-safe game market history', () => {
  const snapshot = (line) => ({
    capturedAt: '2026-07-28T18:00:00.000Z',
    sourceUpdatedAt: '2026-07-28T17:59:00.000Z',
    moneyline: {
      books: 5,
      awayAmerican: 110,
      homeAmerican: -120,
      awayFairProbability: 0.4762,
      homeFairProbability: 0.5238,
    },
    total: {
      books: 5,
      line,
      overAmerican: -110,
      underAmerican: -110,
      overFairProbability: 0.5,
      underFairProbability: 0.5,
    },
  })
  const entry = (gamePk, gameNumber, line) => ({
    gamePk,
    gameDate: '2026-07-28T23:10:00.000Z',
    awayTeamId: 1,
    homeTeamId: 2,
    gameNumber,
    status: 'pregame',
    opening: snapshot(line),
    current: snapshot(line),
    closing: null,
    firstCapturedAt: '2026-07-28T18:00:00.000Z',
    lastObservedAt: '2026-07-28T18:00:00.000Z',
    lastChangedAt: '2026-07-28T18:00:00.000Z',
    closedAt: null,
    observationCount: 1,
    revisionCount: 1,
    movement: {
      moneylineHomeProbability: 0,
      moneylineHomePrice: 0,
      totalLine: 0,
      overPrice: 0,
      material: false,
      changed: [],
    },
  })
  const log = {
    dates: [],
    records: {},
    gameMarketHistory: {
      version: 1,
      byDate: {
        '2026-07-28': {
          10: entry(10, 1, 8),
          11: entry(11, 2, 9.5),
        },
      },
    },
  }
  const valid = validateBacktestLog(log)
  assert.deepEqual(valid.errors, [])
  assert.equal(valid.metrics.gameMarketDays, 1)
  assert.equal(valid.metrics.gameMarketGames, 2)

  const mismatched = structuredClone(log)
  mismatched.gameMarketHistory.byDate['2026-07-28']['11'].gamePk = 10
  assert.ok(validateBacktestLog(mismatched).errors.some((error) => error.includes('must match map key')))

  const invalidClose = structuredClone(log)
  invalidClose.gameMarketHistory.byDate['2026-07-28']['10'].closing = snapshot(8)
  assert.ok(validateBacktestLog(invalidClose).errors.some((error) => error.includes('must be null while pregame')))
})

test('backtest contract verifies schema-v2 features and the derived coverage summary', () => {
  const row = {
    playerId: 1, gamePk: 10, score: 70, homered: false, actuallyPlayed: true,
    featureVersion: 2,
    feat: normalizeHistoricalFeatureVector({ bspd: 75, blast: 20, sq: 24 }),
    pitchTypes: [['ff', 55, 0.48, 21]],
  }
  const modelHistory = { version: 1, dates: ['2026-07-15'], records: { '2026-07-15': [row] } }
  const log = {
    dates: ['2026-07-15'], records: { '2026-07-15': [row] }, modelHistory,
    featureArchive: buildHistoricalFeatureCoverage(modelHistory),
  }
  assert.deepEqual(validateBacktestLog(log).errors, [])

  const incomplete = structuredClone(log)
  delete incomplete.modelHistory.records['2026-07-15'][0].feat.xslg
  assert.ok(validateBacktestLog(incomplete).errors.some((error) => error.includes('feat.xslg: missing')))

  const tampered = structuredClone(log)
  tampered.featureArchive.schemaV2Rows = 99
  assert.ok(validateBacktestLog(tampered).errors.some((error) => error.includes('featureArchive: inconsistent')))
})

test('backtest contract tolerates pre-gamePk legacy rows but still rejects composite duplicates', () => {
  const legacy = { playerId: 1, gamePk: null, score: 50, homered: false, actuallyPlayed: true, feat: null }
  const composite = { playerId: 2, gamePk: 20, score: 60, homered: false, actuallyPlayed: true, feat: { bs: 50 } }
  const log = {
    dates: ['2026-06-01'],
    records: { '2026-06-01': [legacy, legacy, composite, composite] },
    modelHistory: {
      version: 1,
      dates: ['2026-06-01'],
      records: { '2026-06-01': [legacy, legacy, composite, composite] },
    },
  }
  const check = validateBacktestLog(log)
  assert.ok(check.warnings.some((warning) => warning.includes('legacy row')))
  assert.equal(check.errors.filter((error) => error.includes('duplicate 2-20')).length, 2)
  assert.equal(check.errors.some((error) => error.includes('duplicate 1-legacy')), false)
})
