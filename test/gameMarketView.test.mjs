import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  gameMarketMovementCaution,
  gameMarketPortfolioSelection,
  gameMarketValidation,
} from '../ui/src/lib/gameMarketView.js'

test('decision grade portfolio badges remain scoped to the exact gamePk and market', () => {
  const portfolio = {
    selections: [
      { gamePk: 101, market: 'moneyline', selectedSide: 'away' },
      { gamePk: 102, market: 'total', selectedSide: 'under' },
    ],
  }

  assert.equal(
    gameMarketPortfolioSelection(portfolio, 101, 'moneyline')?.selectedSide,
    'away',
  )
  assert.equal(gameMarketPortfolioSelection(portfolio, 102, 'moneyline'), null)
  assert.equal(
    gameMarketPortfolioSelection(portfolio, '102', 'total')?.selectedSide,
    'under',
  )
})

test('decision grade validation separates historical readiness from forward calls', () => {
  const evaluation = {
    minimumSample: { games: 100, dates: 10 },
    markets: {
      moneyline: {
        actionable: { decisions: 83, dates: 9 },
        promotion: {
          status: 'collecting',
          minimumGames: 100,
          minimumDates: 10,
        },
        drift: { status: 'watch' },
      },
      total: {
        actionable: { decisions: 132, dates: 18 },
        promotion: {
          status: 'eligible',
          minimumGames: 100,
          minimumDates: 10,
        },
        drift: { status: 'stable' },
      },
    },
  }
  const historicalPolicy = {
    historicalStatus: 'eligible',
    historicalSample: { seasons: 3, games: 5905, dates: 448 },
    driftStatus: 'watch',
  }

  assert.deepEqual(gameMarketValidation(historicalPolicy, evaluation, 'moneyline'), {
    status: 'eligible',
    label: '3-season validated',
    historicalSeasons: 3,
    historicalGames: 5905,
    historicalDates: 448,
    decisions: 83,
    dates: 9,
    minimumGames: 100,
    minimumDates: 10,
    drift: 'watch',
    forwardStatus: 'collecting',
  })
  assert.equal(
    gameMarketValidation(
      { ...historicalPolicy, driftStatus: 'stable' },
      evaluation,
      'total',
    ).label,
    '3-season validated',
  )
  assert.equal(
    gameMarketValidation(
      historicalPolicy,
      {
        ...evaluation,
        markets: {
          ...evaluation.markets,
          moneyline: {
            ...evaluation.markets.moneyline,
            drift: { status: 'drift' },
          },
        },
      },
      'moneyline',
    ).label,
    'Drift hold',
  )
})

test('decision grade cautions only flag material movement against the selected side', () => {
  const homeSupport = {
    marketTracking: {
      movement: {
        material: true,
        moneylineHomeProbability: 0.03,
        totalLine: -0.5,
        changed: ['moneyline-probability', 'total-line'],
      },
    },
  }

  assert.equal(
    gameMarketMovementCaution(homeSupport, 'moneyline', { selectedSide: 'away' }),
    'Market moved against this side',
  )
  assert.equal(
    gameMarketMovementCaution(homeSupport, 'moneyline', { selectedSide: 'home' }),
    null,
  )
  assert.equal(
    gameMarketMovementCaution(homeSupport, 'total', { selectedSide: 'over' }),
    'Market moved against this total',
  )
  assert.equal(
    gameMarketMovementCaution(homeSupport, 'total', { selectedSide: 'under' }),
    null,
  )
})

test('decision grade catches adverse price-only movement when the line is unchanged', () => {
  const priceOnly = {
    marketTracking: {
      movement: {
        material: true,
        moneylineHomeProbability: 0,
        moneylineHomePrice: 20,
        totalLine: 0,
        overPrice: 15,
        changed: ['moneyline-price', 'total-price'],
      },
    },
  }

  assert.equal(
    gameMarketMovementCaution(priceOnly, 'moneyline', { selectedSide: 'home' }),
    'Market moved against this side',
  )
  assert.equal(
    gameMarketMovementCaution(priceOnly, 'total', { selectedSide: 'over' }),
    'Market moved against this total',
  )
})
