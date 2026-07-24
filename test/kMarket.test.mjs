import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  evaluateKMarket,
  noVigProbability,
  normalizeAmericanOdds,
} from '../ui/src/lib/kMarket.js'

test('K market normalizes only usable American prices', () => {
  assert.equal(normalizeAmericanOdds('+125'), 125)
  assert.equal(normalizeAmericanOdds('-105'), -105)
  assert.equal(normalizeAmericanOdds(''), null)
  assert.equal(normalizeAmericanOdds('-99'), null)
  assert.equal(normalizeAmericanOdds(0), null)
})

test('K market removes vig only when both sides are supplied', () => {
  const noVig = noVigProbability(-105, -115)
  assert.ok(noVig > 0.48 && noVig < 0.50)
  assert.equal(noVigProbability(-105, null), null)
})

test('K market emits a bet only when edge and expected ROI both clear the gates', () => {
  const result = evaluateKMarket({
    overProbability: 0.64,
    overOdds: -105,
    underOdds: -115,
    side: 'over',
  })
  assert.equal(result.status, 'bet')
  assert.equal(result.label, 'BET OVER')
  assert.equal(result.edgeBasis, 'no-vig')
  assert.ok(result.edge > 0.14)
  assert.ok(result.expectedRoi > 0.24)
})

test('K market passes thin prices and never fabricates no-vig probability', () => {
  const result = evaluateKMarket({
    overProbability: 0.53,
    overOdds: -110,
    side: 'over',
  })
  assert.equal(result.status, 'pass')
  assert.equal(result.noVigProbability, null)
  assert.equal(result.edgeBasis, 'raw-implied')
})

test('K market asks for line or selected-side price when decision inputs are incomplete', () => {
  assert.equal(evaluateKMarket({ overOdds: -110 }).status, 'add-line')
  const unpriced = evaluateKMarket({ overProbability: 0.61, side: 'under', overOdds: -110 })
  assert.equal(unpriced.status, 'add-price')
  assert.equal(unpriced.fairProbability, 0.39)
  assert.equal(unpriced.impliedProbability, null)
  assert.equal(unpriced.expectedRoi, null)
})

test('K market keeps an integer-line push out of both win and loss probability', () => {
  const result = evaluateKMarket({
    overProbability: 0.40,
    underProbability: 0.45,
    overOdds: 120,
    underOdds: -130,
    side: 'over',
  })
  assert.ok(Math.abs(result.pushProbability - 0.15) < 1e-9)
  assert.ok(Math.abs(result.expectedRoi - (0.40 * 1.2 - 0.45)) < 1e-9)
})
