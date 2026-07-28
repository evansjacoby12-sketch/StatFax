import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGameMarketPortfolio,
  evaluateGameMarketPerformance,
  gameMarketResultRows,
} from '../src/sports/mlb/logic/gameMarketEvaluation.js'

function outcome({
  selectedSide,
  tier,
  result,
  unitProfit,
  american = -110,
  line = null,
}) {
  return {
    selectedSide,
    tier,
    rawTier: tier,
    provisional: tier !== 'play',
    american,
    line,
    result,
    unitProfit,
    includedInPerformance: ['play', 'lean'].includes(tier),
  }
}

function resultRow({
  gamePk,
  date,
  moneylineResult = 'win',
  totalResult = 'loss',
  tier = 'lean',
  homeProbability = 0.58,
  totalProbability = 0.56,
}) {
  const moneylineProfit = moneylineResult === 'win' ? 0.9091 : moneylineResult === 'push' ? 0 : -1
  const totalProfit = totalResult === 'win' ? 0.9091 : totalResult === 'push' ? 0 : -1
  return {
    gamePk,
    marketDecision: {
      moneyline: {
        selectedSide: 'home',
        tier,
        rawTier: tier,
        provisional: tier !== 'play',
        american: -110,
        modelProbability: homeProbability,
        marketFairProbability: 0.52,
        modelEdge: homeProbability - 0.52,
        expectedRoi: 0.08,
        coverage: 0.9,
        books: 5,
      },
      total: {
        selectedSide: 'over',
        tier,
        rawTier: tier,
        provisional: tier !== 'play',
        american: -110,
        line: 8.5,
        conditionalModelProbability: totalProbability,
        marketFairProbability: 0.5,
        modelEdge: totalProbability - 0.5,
        expectedRoi: 0.06,
        coverage: 0.9,
        books: 5,
      },
    },
    marketOutcome: {
      version: 1,
      advisoryOnly: true,
      moneyline: outcome({
        selectedSide: 'home',
        tier,
        result: moneylineResult,
        unitProfit: moneylineProfit,
      }),
      total: outcome({
        selectedSide: 'over',
        tier,
        result: totalResult,
        unitProfit: totalProfit,
        line: 8.5,
      }),
    },
    capturedAt: `${date}T18:00:00.000Z`,
  }
}

function logFromRows(rowsByDate) {
  return {
    gameForecasts: {
      resultsByDate: rowsByDate,
      callsByDate: Object.fromEntries(
        Object.entries(rowsByDate).map(([date, rows]) => [
          date,
          Object.fromEntries(rows.map((row) => [
            row.gamePk,
            {
              opening: {
                capturedAt: `${date}T16:00:00.000Z`,
                marketDecision: row.marketDecision,
                market: {
                  moneyline: {
                    awayFairProbability: 0.5,
                    homeFairProbability: 0.5,
                  },
                  total: { line: 8 },
                },
              },
              closing: {
                capturedAt: `${date}T18:00:00.000Z`,
                marketDecision: row.marketDecision,
                market: {
                  moneyline: {
                    awayFairProbability: 0.48,
                    homeFairProbability: 0.52,
                  },
                  total: { line: 8.5 },
                },
              },
            },
          ])),
        ]),
      ),
    },
  }
}

test('market evaluation reports exact call ROI, segments, and favorable movement', () => {
  const log = logFromRows({
    '2026-07-25': [
      resultRow({ gamePk: 1, date: '2026-07-25', moneylineResult: 'win', totalResult: 'loss' }),
      resultRow({ gamePk: 2, date: '2026-07-25', moneylineResult: 'loss', totalResult: 'push', tier: 'pass' }),
    ],
    '2026-07-26': [
      resultRow({ gamePk: 3, date: '2026-07-26', moneylineResult: 'win', totalResult: 'win', tier: 'play' }),
    ],
  })
  const rows = gameMarketResultRows(log)
  assert.equal(rows.length, 6)
  assert.equal(rows.find((row) => row.gamePk === 1 && row.market === 'moneyline').favorableMarketMove, 0.02)
  assert.equal(rows.find((row) => row.gamePk === 1 && row.market === 'total').favorableMarketMove, 0.5)

  const evaluation = evaluateGameMarketPerformance(log)
  assert.equal(evaluation.sample.calls, 6)
  assert.equal(evaluation.sample.actionable, 4)
  assert.equal(evaluation.markets.moneyline.actionable.decisions, 2)
  assert.equal(evaluation.markets.moneyline.actionable.wins, 2)
  assert.equal(evaluation.markets.moneyline.segments.tier.pass.decisions, 1)
  assert.equal(evaluation.markets.total.segments.side.over.decisions, 3)
  assert.equal(evaluation.markets.moneyline.promotion.status, 'collecting')
  assert.equal(evaluation.markets.moneyline.calibration.methodology, 'strict-prior-date-empirical-shrinkage')
})

test('walk-forward calibration never uses same-date results', () => {
  const rowsByDate = {}
  let gamePk = 1
  for (let day = 1; day <= 8; day++) {
    const date = `2026-06-${String(day).padStart(2, '0')}`
    rowsByDate[date] = Array.from({ length: 10 }, (_, index) => resultRow({
      gamePk: gamePk++,
      date,
      moneylineResult: index < 6 ? 'win' : 'loss',
      totalResult: index < 5 ? 'win' : 'loss',
    }))
  }
  const evaluation = evaluateGameMarketPerformance(logFromRows(rowsByDate))
  const calibration = evaluation.markets.moneyline.calibration
  assert.equal(calibration.sample, 30)
  assert.equal(calibration.dates, 3)
  assert.equal(calibration.ready, false)
})

test('promotion requires conservative profit and calibration evidence after sample gates', () => {
  const rowsByDate = {}
  let gamePk = 1000
  for (let day = 1; day <= 12; day++) {
    const date = `2026-05-${String(day).padStart(2, '0')}`
    rowsByDate[date] = Array.from({ length: 10 }, () => resultRow({
      gamePk: gamePk++,
      date,
      moneylineResult: 'win',
      totalResult: 'win',
      tier: 'play',
    }))
  }
  const evaluation = evaluateGameMarketPerformance(logFromRows(rowsByDate))
  assert.equal(evaluation.markets.moneyline.actionable.decisions, 120)
  assert.ok(evaluation.markets.moneyline.actionable.roiLower95 > 0)
  assert.ok(evaluation.markets.moneyline.actionable.brierAdvantageVsMarket > 0)
  assert.equal(evaluation.markets.moneyline.promotion.status, 'eligible')
  assert.equal(evaluation.markets.total.promotion.status, 'eligible')
  assert.equal(evaluation.status, 'eligible')
})

test('drift compares the most recent 14 dates only with the preceding 30', () => {
  const rowsByDate = {}
  let gamePk = 2000
  const start = new Date('2026-04-01T00:00:00.000Z')
  for (let day = 0; day < 44; day++) {
    const date = new Date(start.getTime() + day * 86400000).toISOString().slice(0, 10)
    const recent = day >= 30
    rowsByDate[date] = Array.from({ length: 2 }, () => resultRow({
      gamePk: gamePk++,
      date,
      moneylineResult: recent ? 'loss' : 'win',
      totalResult: recent ? 'loss' : 'win',
    }))
  }
  const evaluation = evaluateGameMarketPerformance(logFromRows(rowsByDate))
  const drift = evaluation.markets.moneyline.drift
  assert.equal(drift.ready, true)
  assert.equal(drift.prior.decisions, 60)
  assert.equal(drift.recent.decisions, 28)
  assert.equal(drift.status, 'drift')
  assert.ok(drift.roiDrop > 1)
})

test('portfolio ranks actionable calls and enforces one selection per game', () => {
  const projection = (gamePk, {
    moneylineTier = 'lean',
    totalTier = 'lean',
    moneylineRoi = 0.08,
    totalRoi = 0.07,
  } = {}) => ({
    gamePk,
    gameDate: '2026-07-28T23:00:00.000Z',
    marketDecision: {
      moneyline: {
        tier: moneylineTier,
        rawTier: moneylineTier,
        provisional: true,
        selectedSide: 'home',
        selectedTeam: { id: gamePk, abbr: `T${gamePk}` },
        forecastSide: gamePk === 1 ? 'away' : 'home',
        american: -110,
        modelProbability: 0.58,
        marketFairProbability: 0.52,
        modelEdge: 0.06,
        expectedRoi: moneylineRoi,
        coverage: 0.9,
        books: 5,
      },
      total: {
        tier: totalTier,
        rawTier: totalTier,
        provisional: true,
        selectedSide: 'over',
        line: 8.5,
        american: -110,
        conditionalModelProbability: 0.56,
        marketFairProbability: 0.5,
        modelEdge: 0.06,
        expectedRoi: totalRoi,
        coverage: 0.9,
        books: 5,
      },
    },
  })
  const portfolio = buildGameMarketPortfolio([
    projection(1),
    projection(2, { moneylineTier: 'pass', totalRoi: 0.09 }),
    projection(3, { moneylineTier: 'play', totalTier: 'pass', moneylineRoi: 0.1 }),
  ], null, {
    maximumSelections: 4,
    maximumPerMarket: 2,
    maximumPerGame: 1,
  })
  assert.equal(portfolio.selections.length, 3)
  assert.equal(new Set(portfolio.selections.map((row) => row.gamePk)).size, 3)
  assert.equal(portfolio.selections[0].gamePk, 3)
  assert.ok(portfolio.excluded.some((row) => row.exclusionReason === 'game-exposure'))
  assert.ok(
    portfolio.selections
      .find((row) => row.gamePk === 1)
      .conflicts.includes('value-side-opposes-forecast-favorite'),
  )
})
