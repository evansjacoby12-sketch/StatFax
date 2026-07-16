import test from 'node:test'
import assert from 'node:assert/strict'
import snapshot from '../src/sports/nfl/data/demoSlate.js'
import { buildNFLComboBoard, buildNFLCombos, NFL_COMBO_STRATEGIES } from '../ui/src/lib/nflCombos.js'

test('NFL Bet Lab builds deterministic 2-4 leg combos without duplicate players', () => {
  for (const legs of [2, 3, 4]) {
    const first = buildNFLCombos(snapshot, { legs, strategy: 'scorer-core', scope: 'all', minGrade: 'LEAN' })
    const second = buildNFLCombos(snapshot, { legs, strategy: 'scorer-core', scope: 'all', minGrade: 'LEAN' })
    assert.ok(first.length > 0)
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

test('same-game boards disclose an independent baseline until joint calibration is ready', () => {
  const board = buildNFLComboBoard(snapshot, { legs: 2, strategy: 'scorer-core', scope: 'same-game', minGrade: 'LEAN' })
  assert.equal(board.calibration.ready, false)
  assert.ok(board.combos.every((combo) => combo.probabilityMethod === 'independent-baseline' && combo.actionableProbability === false))
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
    markets: { ...player.markets, two_plus_td: { probability: .041 } },
    historyMatch: { games: 8 }, lineup: null,
    usage: { ...player.usage, goalLineTouchesL3: 1, endZoneTargetsL3: 0, redZoneTargetsL3: 0 },
  }))
  const board = buildNFLComboBoard({ ...snapshot, players, modelPerformance: null }, { strategy: 'double-tap', scope: 'same-game', legs: 2, minGrade: 'LEAN' })
  assert.equal(board.combos.length, 1)
  assert.ok(board.combos[0].legs.every((leg) => leg.grade === 'SKIP' && leg.probability >= .04 && leg.scoringRole.goalLineTouchesL3 >= 1))
  assert.ok(board.coverage.limitations.some((message) => /4%\+ legs/i.test(message)))
})
