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

test('decision grade validation exposes exact actionable calls and dates', () => {
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

  assert.deepEqual(gameMarketValidation(evaluation, 'moneyline'), {
    status: 'collecting',
    label: 'Collecting',
    decisions: 83,
    dates: 9,
    minimumGames: 100,
    minimumDates: 10,
    drift: 'watch',
  })
  assert.equal(gameMarketValidation(evaluation, 'total').label, 'Validated')
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
