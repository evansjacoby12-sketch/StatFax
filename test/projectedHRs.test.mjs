import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectedSlateHRs } from '../ui/src/lib/data.js'

const bat = (gamePk, isHome, { order = null, score = 50, hp = 0.1 } = {}) =>
  ({ gamePk, isHome, battingOrder: order, score, hrProbability: hp })

test('projectedSlateHRs caps each team-side at 9 starters (top-9 by score pre-lineup)', () => {
  // 2 sides of one game, 12 bats each, no lineup posted → top 9 per side counted.
  const bats = []
  for (let i = 0; i < 12; i++) { bats.push(bat(1, true, { score: 90 - i, hp: 0.1 })); bats.push(bat(1, false, { score: 90 - i, hp: 0.1 })) }
  assert.equal(projectedSlateHRs(bats).toFixed(2), '1.80')   // 18 counted × 0.10
})

test('uses the confirmed lineup (bats with an order) once posted, ignoring bench', () => {
  const posted = [
    ...Array.from({ length: 9 }, (_, i) => bat(2, true, { order: i + 1, hp: 0.2 })),
    ...Array.from({ length: 4 }, () => bat(2, true, { score: 99, hp: 0.3 })),  // high-score benchers, no order
  ]
  assert.equal(projectedSlateHRs(posted).toFixed(2), '1.80')   // 9 starters × 0.20, benchers excluded
})

test('separates the two team-sides of a game', () => {
  const bats = [bat(3, true, { hp: 0.25 }), bat(3, false, { hp: 0.15 })]
  assert.equal(projectedSlateHRs(bats).toFixed(2), '0.40')
})

test('null-safe', () => {
  assert.equal(projectedSlateHRs([]), null)
  assert.equal(projectedSlateHRs(null), null)
  assert.equal(projectedSlateHRs([{ gamePk: 1, isHome: true, hrProbability: null }]), null)
})
