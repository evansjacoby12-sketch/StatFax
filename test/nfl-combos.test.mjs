import test from 'node:test'
import assert from 'node:assert/strict'
import snapshot from '../src/sports/nfl/data/demoSlate.js'
import { buildNFLCombos } from '../ui/src/lib/nflCombos.js'

test('NFL Bet Lab builds deterministic 2-4 leg combos without duplicate players', () => {
  for (const legs of [2, 3, 4]) {
    const first = buildNFLCombos(snapshot, { legs, strategy: 'balanced', scope: 'all', minGrade: 'LEAN' })
    const second = buildNFLCombos(snapshot, { legs, strategy: 'balanced', scope: 'all', minGrade: 'LEAN' })
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
  const combos = buildNFLCombos(snapshot, { legs: 2, strategy: 'balanced', scope: 'same-game', minGrade: 'LEAN' })
  assert.ok(combos.length > 0)
  for (const combo of combos) {
    assert.equal(new Set(combo.legs.map((leg) => leg.gameKey)).size, 1)
    assert.ok(combo.legs.filter((leg) => leg.marketId === 'first_td').length <= 1)
  }
})

test('every NFL Bet Lab strategy is touchdown-only', () => {
  for (const strategy of ['balanced', 'safe', 'value', 'red-zone']) {
    const combos = buildNFLCombos(snapshot, { legs: 2, strategy, minGrade: 'LEAN' })
    assert.ok(combos.length > 0)
    assert.ok(combos.every((combo) => combo.legs.every((leg) => ['anytime_td', 'first_td', 'two_plus_td'].includes(leg.marketId))))
  }
})
