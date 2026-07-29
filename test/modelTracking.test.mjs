import test from 'node:test'
import assert from 'node:assert/strict'
import { buildModelTracking } from '../ui/src/lib/modelTracking.js'

function game(gamePk, overrides = {}) {
  return {
    gamePk,
    isLive: false,
    isFinal: false,
    currentInning: null,
    awayScore: 0,
    homeScore: 0,
    awayFirstInningRuns: null,
    homeFirstInningRuns: null,
    ...overrides,
  }
}

function projection({
  mlTier = 'pass',
  mlSide = 'home',
  mlPrice = -110,
  totalTier = 'pass',
  totalSide = 'over',
  totalLine = 8.5,
  totalPrice = -110,
  firstTier = 'watch',
  firstLean = 'nrfi',
  firstQualified = false,
} = {}) {
  return {
    marketDecision: {
      moneyline: {
        tier: mlTier,
        selectedSide: mlSide,
        american: mlPrice,
      },
      total: {
        tier: totalTier,
        selectedSide: totalSide,
        line: totalLine,
        american: totalPrice,
      },
    },
    firstInning: {
      tier: firstTier,
      lean: firstLean,
      qualified: firstQualified,
    },
  }
}

test('live model tracking keeps settled calls, active leads, and diagnostics separate', () => {
  const games = [
    game(1, {
      isFinal: true,
      awayScore: 5,
      homeScore: 3,
      awayFirstInningRuns: 0,
      homeFirstInningRuns: 0,
    }),
    game(2, {
      isLive: true,
      currentInning: 5,
      awayScore: 4,
      homeScore: 1,
      awayFirstInningRuns: 1,
      homeFirstInningRuns: 0,
    }),
    game(3, {
      isLive: true,
      currentInning: 2,
      awayScore: 0,
      homeScore: 0,
      awayFirstInningRuns: 0,
      homeFirstInningRuns: 0,
    }),
    game(4),
  ]
  const projections = {
    1: projection({
      mlTier: 'play',
      mlSide: 'away',
      mlPrice: 150,
      totalTier: 'play',
      totalSide: 'over',
      totalLine: 7.5,
      firstTier: 'lean',
      firstLean: 'yrfi',
      firstQualified: true,
    }),
    2: projection({
      mlTier: 'lean',
      mlSide: 'away',
      totalTier: 'play',
      totalSide: 'over',
      totalLine: 3.5,
      firstTier: 'watch',
      firstLean: 'yrfi',
    }),
    3: projection({
      mlTier: 'pass',
      mlSide: 'home',
      totalTier: 'pass',
      totalSide: 'under',
      totalLine: 8.5,
      firstTier: 'watch',
      firstLean: 'nrfi',
    }),
    4: projection({
      mlTier: 'play',
      totalTier: 'lean',
      firstTier: 'strong',
      firstLean: 'yrfi',
      firstQualified: true,
    }),
  }

  const tracking = buildModelTracking(games, projections)

  assert.equal(tracking.moneyline.primary.wins, 1)
  assert.equal(tracking.moneyline.primary.leading, 1)
  assert.equal(tracking.moneyline.primary.pending, 1)
  assert.equal(tracking.moneyline.primary.units, 1.5)
  assert.equal(tracking.moneyline.primary.roi, 1.5)
  assert.equal(tracking.moneyline.diagnostic.tied, 1)

  assert.equal(tracking.total.primary.wins, 1)
  assert.equal(tracking.total.primary.clinchedWins, 1)
  assert.equal(tracking.total.primary.pending, 1)
  assert.equal(tracking.total.primary.settled, 1)

  assert.equal(tracking.firstInning.primary.losses, 1)
  assert.equal(tracking.firstInning.primary.pending, 1)
  assert.equal(tracking.firstInning.diagnostic.wins, 2)
  assert.equal(tracking.firstInning.diagnostic.losses, 0)
})

test('active leads and clinched totals never enter the settled record early', () => {
  const tracking = buildModelTracking([
    game(10, {
      isLive: true,
      currentInning: 6,
      awayScore: 7,
      homeScore: 2,
      awayFirstInningRuns: 0,
      homeFirstInningRuns: 0,
    }),
  ], {
    10: projection({
      mlTier: 'play',
      mlSide: 'away',
      totalTier: 'play',
      totalSide: 'over',
      totalLine: 7.5,
      firstTier: 'watch',
      firstLean: 'nrfi',
    }),
  })

  assert.equal(tracking.moneyline.primary.settled, 0)
  assert.equal(tracking.moneyline.primary.leading, 1)
  assert.equal(tracking.total.primary.settled, 0)
  assert.equal(tracking.total.primary.clinchedWins, 1)
  assert.equal(tracking.firstInning.diagnostic.wins, 1)
})

test('seven-day tracking combines archived settlements with today and excludes older dates', () => {
  const archived = (gamePk, moneylineResult, totalResult, firstInningCorrect) => ({
    gamePk,
    marketOutcome: {
      moneyline: {
        tier: 'lean',
        result: moneylineResult,
        american: 100,
      },
      total: {
        tier: 'play',
        result: totalResult,
        american: -110,
      },
    },
    firstInning: {
      tier: 'lean',
      qualified: true,
      lean: 'nrfi',
    },
    firstInningCorrect,
  })
  const tracking = buildModelTracking([], {}, {
    asOfDate: '2026-07-29',
    windowDays: 7,
    resultsByDate: {
      '2026-07-22': [archived(1, 'loss', 'loss', false)],
      '2026-07-23': [archived(2, 'win', 'loss', true)],
      '2026-07-28': [archived(3, 'loss', 'win', false)],
    },
  })

  assert.equal(tracking.windowStart, '2026-07-23')
  assert.equal(tracking.windowEnd, '2026-07-29')
  assert.equal(tracking.settledDays, 2)
  assert.deepEqual(
    [tracking.moneyline.primary.wins, tracking.moneyline.primary.losses],
    [1, 1],
  )
  assert.deepEqual(
    [tracking.total.primary.wins, tracking.total.primary.losses],
    [1, 1],
  )
  assert.deepEqual(
    [tracking.firstInning.primary.wins, tracking.firstInning.primary.losses],
    [1, 1],
  )
})

test('today current-slate settlement overrides the same archived game', () => {
  const game = {
    gamePk: 99,
    gameDate: '2026-07-29T18:00:00Z',
    isFinal: true,
    awayScore: 4,
    homeScore: 2,
    awayFirstInningRuns: 0,
    homeFirstInningRuns: 0,
  }
  const projection = {
    marketDecision: {
      moneyline: { tier: 'lean', selectedSide: 'away', american: 120 },
      total: { tier: 'pass', selectedSide: 'under', line: 7.5, american: -110 },
    },
    firstInning: {
      tier: 'lean',
      qualified: true,
      lean: 'nrfi',
    },
  }
  const tracking = buildModelTracking([game], { 99: projection }, {
    asOfDate: '2026-07-29',
    windowDays: 7,
    resultsByDate: {
      '2026-07-29': [{
        gamePk: 99,
        marketOutcome: {
          moneyline: { tier: 'lean', result: 'loss', american: 120 },
          total: { tier: 'pass', result: 'win', american: -110 },
        },
        firstInning: { tier: 'lean', qualified: true, lean: 'nrfi' },
        firstInningCorrect: false,
      }],
    },
  })

  assert.equal(tracking.moneyline.primary.wins, 1)
  assert.equal(tracking.moneyline.primary.losses, 0)
  assert.equal(tracking.total.diagnostic.wins, 1)
  assert.equal(tracking.firstInning.primary.wins, 1)
  assert.equal(tracking.details.length, 1)
  assert.equal(tracking.details[0].moneyline.tracking.outcome, 'win')
  assert.equal(tracking.details[0].total.tracking.outcome, 'win')
  assert.equal(tracking.details[0].firstInning.tracking.outcome, 'win')
})

test('game ledger preserves diagnostic calls, no-calls, and archived identities', () => {
  const tracking = buildModelTracking([], {}, {
    asOfDate: '2026-07-29',
    windowDays: 7,
    resultsByDate: {
      '2026-07-28': [{
        gamePk: 824243,
        gameDate: '2026-07-28T22:40:00Z',
        gameNumber: 1,
        awayTeam: { id: 110, name: 'Baltimore Orioles', abbr: 'BAL' },
        homeTeam: { id: 116, name: 'Detroit Tigers', abbr: 'DET' },
        actualAwayRuns: 0,
        actualHomeRuns: 14,
        actualAwayFirstInningRuns: 0,
        actualHomeFirstInningRuns: 1,
        actualYrfi: true,
        marketOutcome: {
          moneyline: {
            tier: 'play',
            selectedSide: 'home',
            result: 'win',
            american: -143,
          },
          total: {
            tier: 'pass',
            selectedSide: 'under',
            line: 9,
            result: 'loss',
            american: 100,
          },
        },
        firstInning: {
          tier: 'watch',
          qualified: false,
          lean: 'nrfi',
        },
      }, {
        gamePk: 824244,
        gameDate: '2026-07-28T23:10:00Z',
        gameNumber: 2,
        doubleHeader: 'Y',
        awayTeam: { id: 110, name: 'Baltimore Orioles', abbr: 'BAL' },
        homeTeam: { id: 116, name: 'Detroit Tigers', abbr: 'DET' },
        actualAwayRuns: 2,
        actualHomeRuns: 1,
        actualYrfi: false,
        marketOutcome: {
          moneyline: {
            tier: 'unavailable',
            selectedSide: null,
            result: 'ungraded',
          },
          total: {
            tier: 'unavailable',
            selectedSide: null,
            result: 'ungraded',
          },
        },
      }],
    },
  })

  assert.equal(tracking.detailGames, 2)
  assert.equal(tracking.detailCalls, 3)
  const firstGame = tracking.details.find((row) => row.gamePk === 824243)
  const secondGame = tracking.details.find((row) => row.gamePk === 824244)
  assert.equal(firstGame.away.abbr, 'BAL')
  assert.equal(firstGame.home.abbr, 'DET')
  assert.equal(firstGame.moneyline.selectedTeam.abbr, 'DET')
  assert.equal(firstGame.moneyline.tracking.outcome, 'win')
  assert.equal(firstGame.total.tier, 'pass')
  assert.equal(firstGame.total.tracking.outcome, 'loss')
  assert.equal(firstGame.firstInning.tier, 'watch')
  assert.equal(firstGame.firstInning.tracking.outcome, 'loss')
  assert.equal(secondGame.gameNumber, 2)
  assert.equal(secondGame.moneyline.available, false)
  assert.equal(secondGame.total.available, false)
  assert.equal(secondGame.firstInning.available, false)
})

test('ledger never marks live moneyline or total calls as settled early', () => {
  const tracking = buildModelTracking([
    game(501, {
      gameDate: '2026-07-29T18:00:00Z',
      awayTeam: { id: 1, name: 'Away', abbr: 'AWY' },
      homeTeam: { id: 2, name: 'Home', abbr: 'HME' },
      isLive: true,
      currentInning: 5,
      awayScore: 6,
      homeScore: 1,
      awayFirstInningRuns: 0,
      homeFirstInningRuns: 0,
    }),
  ], {
    501: projection({
      mlTier: 'play',
      mlSide: 'away',
      totalTier: 'play',
      totalSide: 'over',
      totalLine: 4.5,
      firstTier: 'strong',
      firstLean: 'nrfi',
      firstQualified: true,
    }),
  }, {
    asOfDate: '2026-07-29',
    windowDays: 7,
  })

  const [row] = tracking.details
  assert.equal(row.state, 'live')
  assert.equal(row.moneyline.tracking.outcome, null)
  assert.equal(row.moneyline.tracking.liveState.kind, 'leading')
  assert.equal(row.total.tracking.outcome, null)
  assert.equal(row.total.tracking.liveState.kind, 'clinched-win')
  assert.equal(row.firstInning.tracking.outcome, 'win')
})
