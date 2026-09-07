import test from 'node:test'
import assert from 'node:assert/strict'
import snapshot from '../src/sports/nfl/data/demoSlate.js'
import { buildNFLComboBoard, buildNFLCombos, buildNFLComboShowcase, calculateNFLJointTDProbability, NFL_COMBO_STRATEGIES } from '../ui/src/lib/nflCombos.js'

test('NFL Bet Lab builds deterministic 2-4 leg combos without duplicate players', () => {
  for (const legs of [2, 3, 4]) {
    const first = buildNFLCombos(snapshot, { legs, strategy: 'scorer-core', scope: 'all', minGrade: 'LEAN' })
    const second = buildNFLCombos(snapshot, { legs, strategy: 'scorer-core', scope: 'all', minGrade: 'LEAN' })
    assert.deepEqual(first.map((combo) => combo.id), second.map((combo) => combo.id))
    for (const combo of first) {
      assert.equal(combo.legs.length, legs)
      assert.equal(new Set(combo.legs.map((leg) => leg.playerId)).size, legs)
      assert.ok(combo.probability > 0 && combo.probability < 1)
      assert.ok(combo.legs.every((leg) => ['anytime_td', 'first_td', 'two_plus_td'].includes(leg.marketId)))
    }
  }
})

test('same-game combos keep every leg inside one matchup', () => {
  const combos = buildNFLCombos(snapshot, { legs: 2, strategy: 'scorer-core', scope: 'same-game', minGrade: 'LEAN' })
  assert.ok(combos.length > 0)
  for (const combo of combos) {
    assert.equal(new Set(combo.legs.map((leg) => leg.gameKey)).size, 1)
    assert.ok(combo.legs.filter((leg) => leg.marketId === 'first_td').length <= 1)
  }
})

test('every named NFL stack has a distinct touchdown recipe and disclosed risk', () => {
  const byId = Object.fromEntries(NFL_COMBO_STRATEGIES.map((stack) => [stack.id, stack]))
  assert.deepEqual(Object.keys(byId), ['scorer-core', 'goal-line-hammer', 'end-zone-alpha', 'first-strike', 'double-tap'])
  for (const stack of NFL_COMBO_STRATEGIES) {
    assert.ok(stack.meaning)
    assert.ok(stack.risk)
    assert.ok(['good', 'caution', 'avoid'].includes(stack.riskTone))
    const combos = buildNFLCombos(snapshot, { legs: 2, strategy: stack.id, scope: 'all', minGrade: 'SKIP' })
    assert.ok(combos.length > 0)
    assert.ok(combos.every((combo) => combo.legs.every((leg) => ['anytime_td', 'first_td', 'two_plus_td'].includes(leg.marketId))))
  }
  const builds = Object.fromEntries(NFL_COMBO_STRATEGIES.map((stack) => [stack.id, buildNFLCombos(snapshot, { legs: 2, strategy: stack.id, scope: 'all', minGrade: 'SKIP' })]))
  assert.ok(builds['scorer-core'].every((combo) => combo.legs.every((leg) => leg.marketId === 'anytime_td')))
  assert.ok(builds['goal-line-hammer'].every((combo) => combo.legs.every((leg) => ['QB', 'RB'].includes(leg.position) && (leg.scoringRole.goalLineTouchesL3 >= 1 || leg.scoringRole.goalLineOpportunityShare >= .12 || leg.scoringRole.designedTouchShare >= .12))))
  assert.ok(builds['end-zone-alpha'].every((combo) => combo.legs.every((leg) => ['WR', 'TE'].includes(leg.position) && (leg.scoringRole.endZoneTargetsL3 >= 1 || leg.scoringRole.redZoneTargetsL3 >= 2 || leg.scoringRole.endZoneTargetShare >= .1))))
  assert.ok(builds['first-strike'].every((combo) => combo.legs.every((leg) => leg.marketId === 'first_td') && new Set(combo.legs.map((leg) => leg.gameKey)).size === combo.legs.length))
  assert.ok(builds['double-tap'].every((combo) => combo.legs.every((leg) => leg.marketId === 'two_plus_td')))
  assert.deepEqual(byId['first-strike'].scopes, ['all'])
})

test('TD stack board enforces exposure caps and reports coverage', () => {
  const board = buildNFLComboBoard(snapshot, { legs: 2, strategy: 'scorer-core', scope: 'all', minGrade: 'SKIP' })
  assert.ok(board.combos.length > 0)
  assert.ok(board.combos.length <= board.coverage.requestedBuilds)
  assert.ok(Math.max(...Object.values(board.exposure.players)) <= board.exposure.caps.player)
  assert.ok(Math.max(...Object.values(board.exposure.teams)) <= board.exposure.caps.team)
  assert.ok(['ready', 'limited'].includes(board.coverage.status))
})

test('each stack board stays focused on at most five diversified builds', () => {
  for (const strategy of NFL_COMBO_STRATEGIES) for (const scope of strategy.scopes) {
    const board = buildNFLComboBoard(snapshot, { legs: 2, strategy: strategy.id, scope, minGrade: 'SKIP' })
    assert.equal(board.coverage.requestedBuilds, 5)
    assert.ok(board.combos.length <= 5)
  }
})

test('same-game boards compute structural joint probability and disclose calibration state', () => {
  const board = buildNFLComboBoard(snapshot, { legs: 2, strategy: 'scorer-core', scope: 'same-game', minGrade: 'LEAN' })
  assert.equal(board.calibration.ready, false)
  assert.ok(board.combos.every((combo) => combo.probabilityMethod === 'structural-joint' && combo.actionableProbability === false))
  assert.ok(board.coverage.limitations.some((message) => /joint calibration/i.test(message)))
})

test('same-game boards consume stack-level joint calibration when its sample is ready', () => {
  const calibrated = {
    ...snapshot,
    modelPerformance: { stacks: { 'scorer-core': { scopes: { 'same-game': { byLegCount: { 2: { samples: 100, buckets: [{ samples: 100, predicted: .2, observed: .1 }] } } } } } } },
  }
  const board = buildNFLComboBoard(calibrated, { legs: 2, strategy: 'scorer-core', scope: 'same-game', minGrade: 'LEAN' })
  assert.equal(board.calibration.ready, true)
  assert.ok(board.combos.every((combo) => combo.probabilityMethod === 'stack-calibrated-joint' && combo.actionableProbability === true && combo.probability < combo.independentProbability))
})

test('specialized role stacks reject unconfirmed projection-only evidence', () => {
  const projectedOnly = {
    ...snapshot,
    players: snapshot.players.map((player) => ({
      ...player,
      usage: { ...player.usage, goalLineTouchesL3: 0, endZoneTargetsL3: 0, redZoneTargetsL3: 0 },
      lineup: { ...player.lineup, confirmed: false, redZone: { insideFiveShare: .9, designedTouchShare: .9, endZoneRouteShare: .9 } },
    })),
  }
  assert.equal(buildNFLComboBoard(projectedOnly, { strategy: 'goal-line-hammer', minGrade: 'SKIP' }).combos.length, 0)
  assert.equal(buildNFLComboBoard(projectedOnly, { strategy: 'end-zone-alpha', minGrade: 'SKIP' }).combos.length, 0)
})

test('Double Tap same-game coverage admits only disclosed 4% longshots with observed scoring-area usage', () => {
  const players = snapshot.players.slice(0, 2).map((player, index) => ({
    ...player,
    gameId: 'same-game', team: index ? 'AWY' : 'HME', opponent: index ? 'HME' : 'AWY',
    markets: { ...player.markets, two_plus_td: { probability: .032 } },
    historyMatch: { games: 8 }, lineup: null,
    usage: { ...player.usage, goalLineTouchesL3: 1, endZoneTargetsL3: 0, redZoneTargetsL3: 0 },
  }))
  const board = buildNFLComboBoard({ ...snapshot, players, modelPerformance: null }, { strategy: 'double-tap', scope: 'same-game', legs: 2, minGrade: 'LEAN' })
  assert.equal(board.combos.length, 1)
  assert.ok(board.combos[0].legs.every((leg) => leg.grade === 'SKIP' && leg.probability >= .04 && leg.scoringRole.goalLineTouchesL3 >= 1))
  assert.ok(board.coverage.limitations.some((message) => /4%\+ legs/i.test(message)))
})

test('buildNFLComboShowcase applies cross-strategy exposure tracking across cards', () => {
  const showcase = buildNFLComboShowcase(snapshot, { legs: 2, scope: 'all', minGrade: 'SKIP', playerCap: 1 })
  const validCards = showcase.filter((c) => c.combo)
  assert.ok(validCards.length >= 3)
  // Check that not all cards share the exact same player pairs
  const signatures = new Set(validCards.map((c) => c.combo.legs.map((l) => l.playerId).sort().join('-')))
  assert.ok(signatures.size > 1)
})

test('buildNFLComboBoard supports gameKey filtering for same-game and cross-game scopes', () => {
  const bufMiaKey = 'BUF-MIA'
  const sameGameBoard = buildNFLComboBoard(snapshot, { legs: 2, strategy: 'scorer-core', scope: 'same-game', minGrade: 'SKIP', gameKey: bufMiaKey })
  for (const combo of sameGameBoard.combos) {
    assert.equal(new Set(combo.legs.map((l) => l.gameKey)).size, 1)
    assert.equal(combo.legs[0].gameKey, bufMiaKey)
  }

  const crossGameBoard = buildNFLComboBoard(snapshot, { legs: 2, strategy: 'scorer-core', scope: 'all', minGrade: 'SKIP', gameKey: bufMiaKey })
  for (const combo of crossGameBoard.combos) {
    assert.ok(combo.legs.some((l) => l.gameKey === bufMiaKey))
    assert.equal(new Set(combo.legs.map((l) => l.gameKey)).size, combo.legs.length)
  }
})

test('calculateNFLJointTDProbability flags same-game First TD mutual exclusivity', () => {
  const conflictingLegs = [
    { name: 'Josh Allen', gameKey: 'BUF-MIA', team: 'BUF', position: 'QB', marketId: 'first_td', probability: 0.18 },
    { name: 'Tyreek Hill', gameKey: 'BUF-MIA', team: 'MIA', position: 'WR', marketId: 'first_td', probability: 0.15 },
  ]
  const result = calculateNFLJointTDProbability(conflictingLegs)
  assert.equal(result.isValid, false)
  assert.equal(result.probability, 0)
  assert.equal(result.correlationType, 'conflict')
  assert.ok(result.conflictReason.includes('mutually exclusive'))
})

test('calculateNFLJointTDProbability computes same-team RB cannibalization discount', () => {
  const sameTeamRBs = [
    { name: 'James Cook', gameKey: 'BUF-MIA', team: 'BUF', position: 'RB', marketId: 'anytime_td', probability: 0.45 },
    { name: 'Ray Davis', gameKey: 'BUF-MIA', team: 'BUF', position: 'RB', marketId: 'anytime_td', probability: 0.25 },
  ]
  const result = calculateNFLJointTDProbability(sameTeamRBs)
  assert.equal(result.isValid, true)
  assert.ok(result.probability < result.independentProbability)
  assert.equal(result.correlationType, 'cannibalization')
  assert.ok(result.correlationFactor < 0.90)
})

test('calculateNFLJointTDProbability computes cross-team shootout synergy uplift', () => {
  const opposingScorers = [
    { name: 'Josh Allen', gameKey: 'BUF-MIA', team: 'BUF', position: 'QB', marketId: 'anytime_td', probability: 0.45 },
    { name: 'Tyreek Hill', gameKey: 'BUF-MIA', team: 'MIA', position: 'WR', marketId: 'anytime_td', probability: 0.42 },
  ]
  const result = calculateNFLJointTDProbability(opposingScorers)
  assert.equal(result.isValid, true)
  assert.ok(result.probability > result.independentProbability)
  assert.equal(result.correlationType, 'synergy')
  assert.ok(result.correlationFactor > 1.02)
})

test('calculateNFLJointTDProbability treats cross-game legs as independent product', () => {
  const crossGameLegs = [
    { name: 'Josh Allen', gameKey: 'BUF-MIA', team: 'BUF', position: 'QB', marketId: 'anytime_td', probability: 0.45 },
    { name: 'Patrick Mahomes', gameKey: 'KC-BAL', team: 'KC', position: 'QB', marketId: 'anytime_td', probability: 0.30 },
  ]
  const result = calculateNFLJointTDProbability(crossGameLegs)
  assert.equal(result.isValid, true)
  assert.equal(result.probability, result.independentProbability)
  assert.equal(result.correlationType, 'independent')
})

test('calculateNFLJointTDProbability correctly handles mixed multi-game clusters', () => {
  const mixedLegs = [
    { name: 'Josh Allen', gameKey: 'BUF-MIA', team: 'BUF', position: 'QB', marketId: 'anytime_td', probability: 0.45 },
    { name: 'Tyreek Hill', gameKey: 'BUF-MIA', team: 'MIA', position: 'WR', marketId: 'anytime_td', probability: 0.40 },
    { name: 'Derrick Henry', gameKey: 'KC-BAL', team: 'BAL', position: 'RB', marketId: 'anytime_td', probability: 0.55 },
  ]
  const result = calculateNFLJointTDProbability(mixedLegs)
  assert.equal(result.isValid, true)
  assert.equal(result.gameClusters.length, 2)
  assert.ok(result.probability > result.independentProbability)
  assert.equal(result.correlationType, 'synergy')
})



