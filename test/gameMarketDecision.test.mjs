import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGameMarketDecision,
  gameMarketDecisionPolicy,
} from '../src/sports/mlb/logic/gameMarketDecision.js'

const awayTeam = { id: 1, name: 'Away', abbr: 'AWY' }
const homeTeam = { id: 2, name: 'Home', abbr: 'HME' }
const confidence = { status: 'medium', coverage: 0.9 }

const readyPolicy = () => gameMarketDecisionPolicy({
  minimumSample: { games: 100, dates: 10 },
  winner: { marketSample: 120, marketDates: 12 },
  total: { marketSample: 120, marketDates: 12 },
})

test('market decision keeps the forecast favorite separate from the value side', () => {
  const decision = buildGameMarketDecision({
    awayTeam,
    homeTeam,
    awayWinProbability: 0.45,
    homeWinProbability: 0.55,
    projectedTotal: 8.6,
    confidence,
    policy: readyPolicy(),
    marketComparison: {
      moneyline: {
        books: 6,
        awayMarketProbability: 0.35,
        homeMarketProbability: 0.65,
        awayAmerican: 200,
        homeAmerican: -190,
      },
    },
  })

  assert.equal(decision.moneyline.forecastSide, 'home')
  assert.equal(decision.moneyline.forecastTeam.abbr, 'HME')
  assert.equal(decision.moneyline.selectedSide, 'away')
  assert.equal(decision.moneyline.selectedTeam.abbr, 'AWY')
  assert.equal(decision.moneyline.rawTier, 'play')
  assert.equal(decision.moneyline.tier, 'play')
  assert.ok(decision.moneyline.expectedRoi > 0)
})

test('tiny total separation is a PASS even when one side has the better probability', () => {
  const decision = buildGameMarketDecision({
    awayTeam,
    homeTeam,
    awayWinProbability: 0.48,
    homeWinProbability: 0.52,
    projectedTotal: 8.49,
    confidence,
    policy: readyPolicy(),
    marketComparison: {
      total: {
        line: 8.5,
        books: 8,
        modelOverProbability: 0.44,
        modelUnderProbability: 0.56,
        modelPushProbability: 0,
        marketOverProbability: 0.5,
        marketUnderProbability: 0.5,
        overAmerican: -110,
        underAmerican: -110,
      },
    },
  })

  assert.equal(decision.total.selectedSide, 'under')
  assert.equal(decision.total.runSeparation, 0.01)
  assert.equal(decision.total.gates.separation, false)
  assert.equal(decision.total.tier, 'pass')
})

test('totals use push-adjusted probability and price EV instead of mean direction alone', () => {
  const decision = buildGameMarketDecision({
    awayTeam,
    homeTeam,
    awayWinProbability: 0.4,
    homeWinProbability: 0.6,
    projectedTotal: 11.12,
    confidence,
    policy: readyPolicy(),
    marketComparison: {
      total: {
        line: 10,
        books: 8,
        modelOverProbability: 0.4935,
        modelUnderProbability: 0.4288,
        modelPushProbability: 0.0777,
        marketOverProbability: 0.5128,
        marketUnderProbability: 0.4872,
        overAmerican: -116,
        underAmerican: -104,
      },
    },
  })

  assert.equal(decision.total.selectedSide, 'over')
  assert.ok(decision.total.conditionalModelProbability > decision.total.modelWinProbability)
  assert.ok(decision.total.expectedRoi < 0)
  assert.equal(decision.total.tier, 'pass')
})

test('unvalidated PLAY thresholds are capped to LEAN until forward evidence is ready', () => {
  const input = {
    awayTeam,
    homeTeam,
    awayWinProbability: 0.4,
    homeWinProbability: 0.6,
    projectedTotal: 10,
    confidence,
    marketComparison: {
      total: {
        line: 8.5,
        books: 8,
        modelOverProbability: 0.62,
        modelUnderProbability: 0.38,
        modelPushProbability: 0,
        marketOverProbability: 0.5,
        marketUnderProbability: 0.5,
        overAmerican: -110,
        underAmerican: -110,
      },
    },
  }

  const collecting = buildGameMarketDecision(input)
  assert.equal(collecting.total.rawTier, 'play')
  assert.equal(collecting.total.tier, 'lean')
  assert.equal(collecting.total.provisional, true)
  assert.match(collecting.total.reason, /forward validation/i)

  const ready = buildGameMarketDecision({ ...input, policy: readyPolicy() })
  assert.equal(ready.total.rawTier, 'play')
  assert.equal(ready.total.tier, 'play')
  assert.equal(ready.total.provisional, false)
})

test('missing prices produce unavailable decisions without inventing an edge', () => {
  const decision = buildGameMarketDecision({
    awayTeam,
    homeTeam,
    awayWinProbability: 0.48,
    homeWinProbability: 0.52,
    projectedTotal: 8.7,
    confidence,
  })

  assert.equal(decision.moneyline.forecastSide, 'home')
  assert.equal(decision.moneyline.tier, 'unavailable')
  assert.equal(decision.moneyline.selectedSide, null)
  assert.equal(decision.total.tier, 'unavailable')
  assert.equal(decision.total.selectedSide, null)
})
