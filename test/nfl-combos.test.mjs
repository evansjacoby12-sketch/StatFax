import test from 'node:test'
import assert from 'node:assert/strict'
import snapshot from '../src/sports/nfl/data/demoSlate.js'
import { buildNFLCombos, NFL_COMBO_STRATEGIES } from '../ui/src/lib/nflCombos.js'

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
