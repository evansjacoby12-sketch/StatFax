import test from 'node:test'
import assert from 'node:assert/strict'

import {
  standardNormalCdf,
  lognormalOverProbability,
  poissonOverProbability,
  americanImpliedProbability,
  deviggedImpliedProbability,
  calculateQuarterKelly,
  scoreNFLProp,
  scoreNFLSnapshot,
} from '../src/sports/nfl/logic/ScoringEngine.js'

import NFL_DEMO_SNAPSHOT from '../src/sports/nfl/data/demoSlate.js'

const player = (name) => NFL_DEMO_SNAPSHOT.players.find((item) => item.name === name)

test('standardNormalCdf matches high-precision normal distribution values', () => {
  // cdf(0) == 0.5
  assert.ok(Math.abs(standardNormalCdf(0) - 0.5) < 1e-6)

  // Symmetry: cdf(x) + cdf(-x) == 1
  for (const x of [0.5, 1.0, 1.645, 1.96, 2.576, 3.0]) {
    assert.ok(Math.abs((standardNormalCdf(x) + standardNormalCdf(-x)) - 1.0) < 1e-6, `Symmetry failed at x = ${x}`)
  }

  // 1-sigma, 2-sigma, 3-sigma standard benchmarks
  assert.ok(Math.abs(standardNormalCdf(1.0) - 0.8413447) < 1e-5)
  assert.ok(Math.abs(standardNormalCdf(1.96) - 0.9750021) < 1e-5)
  assert.ok(Math.abs(standardNormalCdf(2.576) - 0.995004) < 1e-4)
})

test('lognormalOverProbability correctly models continuous right-skewed NFL yardage', () => {
  // Mean = 75, Line = 75 -> probability should be < 0.50 due to right-skew (mean > median for lognormal)
  const probAtMean = lognormalOverProbability(75, 75, 0.45)
  assert.ok(probAtMean < 0.50 && probAtMean > 0.40, `probAtMean was ${probAtMean}`)

  // Monotonicity: higher line -> strictly lower over probability
  const prob60 = lognormalOverProbability(75, 60, 0.45)
  const prob75 = lognormalOverProbability(75, 75, 0.45)
  const prob90 = lognormalOverProbability(75, 90, 0.45)
  assert.ok(prob60 > prob75, 'Over 60 yds should be higher probability than Over 75 yds')
  assert.ok(prob75 > prob90, 'Over 75 yds should be higher probability than Over 90 yds')

  // Higher mean -> higher over probability for same line
  const probHigherProj = lognormalOverProbability(90, 75, 0.45)
  assert.ok(probHigherProj > prob75, 'Projected 90 yds should beat projected 75 yds for 75 yd line')

  // Robustness to non-positive inputs
  assert.equal(lognormalOverProbability(0, 50), 0.01)
  assert.equal(lognormalOverProbability(75, 0), 0.99)
})

test('poissonOverProbability calculates exact discrete reception line probabilities', () => {
  // Mean = 5.0 catches, Line = 4.5 -> P(K >= 5)
  const pOver4_5 = poissonOverProbability(5.0, 4.5)
  // Analytical Poisson(lambda=5): P(K <= 4) = e^-5 * (1 + 5 + 25/2 + 125/6 + 625/24) = e^-5 * 65.375 ≈ 0.44049
  // P(K >= 5) = 1 - 0.44049 = 0.5595
  assert.ok(Math.abs(pOver4_5 - 0.5595) < 0.01, `Expected ~0.5595, got ${pOver4_5}`)

  // Monotonicity across reception lines
  const pOver3_5 = poissonOverProbability(5.0, 3.5)
  const pOver5_5 = poissonOverProbability(5.0, 5.5)
  assert.ok(pOver3_5 > pOver4_5, 'Over 3.5 catches > Over 4.5 catches')
  assert.ok(pOver4_5 > pOver5_5, 'Over 4.5 catches > Over 5.5 catches')

  // Input boundaries
  assert.equal(poissonOverProbability(0, 4.5), 0.01)
  assert.equal(poissonOverProbability(5.0, -1), 0.99)
})

test('touchdown distributions calibrate across Anytime, First TD, and 2+ Multi-TD', () => {
  const henry = player('Derrick Henry')
  const hill = player('Tyreek Hill')

  const anytimeHenry = scoreNFLProp(henry, 'anytime_td')
  const firstHenry = scoreNFLProp(henry, 'first_td')
  const multiHenry = scoreNFLProp(henry, 'two_plus_td')

  // Bounds and hierarchy: First TD < 2+ TD < Anytime TD
  assert.ok(anytimeHenry.probability > multiHenry.probability, 'Anytime TD must exceed Multi TD')
  assert.ok(anytimeHenry.probability > firstHenry.probability, 'Anytime TD must exceed First TD')
  assert.ok(firstHenry.probability > 0.01 && firstHenry.probability < 0.35)
  assert.ok(multiHenry.probability > 0.02 && multiHenry.probability < 0.50)

  // Position-specific first TD multiplier: RB gets higher opening drive scripted share than WR
  const anytimeHill = scoreNFLProp(hill, 'anytime_td')
  const firstHill = scoreNFLProp(hill, 'first_td')
  const rbRatio = firstHenry.probability / anytimeHenry.probability
  const wrRatio = firstHill.probability / anytimeHill.probability
  assert.ok(rbRatio >= wrRatio, 'RB first TD share ratio should exceed WR share ratio')
})

test('3-factor composite scoring rewards volume dominance and touchdown likelihood', () => {
  const henry = player('Derrick Henry')

  // Dominant volume & high TD equity bellcow
  const bellcowPlayer = {
    ...henry,
    usage: { snapShare: 0.85, carryShare: 0.75, goalLineOpportunityShare: 0.70, redZoneOpportunityShare: 0.60 },
    projections: { anytimeTdProbability: 0.65 },
  }
  const resultBellcow = scoreNFLProp(bellcowPlayer, 'anytime_td')
  assert.ok(resultBellcow.score >= 75, `Score should be high for bellcow, was ${resultBellcow.score}`)
  assert.equal(resultBellcow.grade, 'PRIME')

  // Low-volume rotational backup with low TD equity
  const backupPlayer = {
    ...henry,
    markets: { anytime_td: { probability: 0.12 } },
    usage: { snapShare: 0.20, carryShare: 0.15, goalLineOpportunityShare: 0.05, redZoneOpportunityShare: 0.05 },
    projections: { anytimeTdProbability: 0.12 },
  }
  const resultBackup = scoreNFLProp(backupPlayer, 'anytime_td')
  assert.ok(resultBackup.score < 50, `Score should be low for backup, was ${resultBackup.score}`)
  assert.equal(resultBackup.grade, 'SKIP')
})

test('quarter-Kelly stake sizing bounds recommendations to [0.25, 2.0] units', () => {
  // Moderate edge (+5% edge on +110 odds)
  const unitsMod = calculateQuarterKelly(0.53, 110)
  assert.ok(unitsMod >= 0.25 && unitsMod <= 1.0, `Expected 0.25 - 1.0, got ${unitsMod}`)
  assert.equal(unitsMod % 0.25, 0, 'Quarter Kelly must be rounded in 0.25 unit steps')

  // Strong edge (+20% edge on +150 odds)
  const unitsStrong = calculateQuarterKelly(0.60, 150)
  assert.ok(unitsStrong >= 0.75 && unitsStrong <= 1.5, `Expected 0.75 - 1.5, got ${unitsStrong}`)
  assert.equal(unitsStrong % 0.25, 0)

  // Massive edge (70% on +150)
  const unitsMassive = calculateQuarterKelly(0.70, 150)
  assert.ok(unitsMassive >= 1.25 && unitsMassive <= 2.0, `Expected 1.25 - 2.0, got ${unitsMassive}`)

  // Negative EV -> 0 units
  const unitsNeg = calculateQuarterKelly(0.40, -110)
  assert.equal(unitsNeg, 0)
})

test('standardization gates enforce minimum evidence for PRIME and STRONG tiers', () => {
  const hill = player('Tyreek Hill')

  // Gate 1: Rotational backup (roleRank > 2) cannot claim PRIME unless confirmed
  const backupWr = {
    ...hill,
    roleRank: 3,
    lineup: { confirmed: false },
    projections: { receivingYards: 95 },
  }
  const scoredBackup = scoreNFLProp(backupWr, 'receiving_yards')
  assert.notEqual(scoredBackup.grade, 'PRIME', 'Unconfirmed backup cannot claim PRIME')

  // Gate 2: Thin sample size (< 3 games) forces cap of otherwise PRIME/STRONG picks to LEAN
  const thinPlayer = {
    ...hill,
    historyMatch: { games: 2 },
    recentGames: [{ season: 2025, week: 1, receivingYards: 110 }],
    propLines: { ...hill.propLines, receiving_yards: 75.5 },
    projections: { receivingYards: 110 },
  }
  const scoredThin = scoreNFLProp(thinPlayer, 'receiving_yards')
  assert.equal(scoredThin.grade, 'LEAN', 'Thin sample must be capped at LEAN')
  assert.ok(scoredThin.reasons.some((r) => r.includes('Thin sample (<3 games)')))
})

test('scoreNFLSnapshot sorts eligible players by composite rank score descending', () => {
  const recProps = scoreNFLSnapshot(NFL_DEMO_SNAPSHOT, 'receptions')
  assert.ok(recProps.length > 0)
  for (let i = 1; i < recProps.length; i++) {
    const prev = recProps[i - 1].model.score ?? 0
    const curr = recProps[i].model.score ?? 0
    assert.ok(prev >= curr, `Sort order violated at index ${i}: prev ${prev} < curr ${curr}`)
  }
})

test('superstar WR alpha profile (AJ Brown) achieves PRIME/STRONG tiers across props', () => {
  const ajBrown = player('A.J. Brown')
  assert.ok(ajBrown, 'AJ Brown should exist in demo slate')

  const recYards = scoreNFLProp(ajBrown, 'receiving_yards')
  assert.equal(recYards.eligible, true)
  assert.ok(recYards.score >= 75, `Expected score >= 75, got ${recYards.score}`)
  assert.equal(recYards.grade, 'PRIME')

  const receptions = scoreNFLProp(ajBrown, 'receptions')
  assert.equal(receptions.eligible, true)
  assert.ok(receptions.score >= 70, `Expected receptions score >= 70, got ${receptions.score}`)
  assert.ok(['PRIME', 'STRONG'].includes(receptions.grade))

  const anytimeTd = scoreNFLProp(ajBrown, 'anytime_td')
  assert.equal(anytimeTd.eligible, true)
  assert.ok(anytimeTd.score >= 75, `Expected anytime TD score >= 75, got ${anytimeTd.score}`)
  assert.ok(['PRIME', 'STRONG'].includes(anytimeTd.grade))
})

