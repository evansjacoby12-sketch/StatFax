import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildCombos, STRATEGIES } from '../ui/src/lib/combo-engine.js'

// A PRIME bat in its own game. `pr` = carries the POWER READY β signal.
const bat = (id, { pr = false, score = 90, prob = 0.15 } = {}) => ({
  playerId: id, gamePk: 100 + id, name: `P${id}`, grade: 'PRIME',
  benched: false, paWeight: 1, powerReady: pr, hrProb: prob,
  score, heat: 70, barrel: 15, hot: true,
})

// Non-PR high-score bats (other strategies anchor these) + PR bats with lower
// score but high hrProb, so powerReady picks a DISTINCT leg set (not deduped).
const slate = () => [
  ...[1, 2, 3, 4].map((i) => bat(i, { pr: false, score: 92, prob: 0.15 })),
  ...[5, 6, 7, 8, 9, 10].map((i) => bat(i, { pr: true, score: 72, prob: 0.28 - (i - 5) * 0.01 })),
]

test('powerReady is a beta strategy (off by default)', () => {
  assert.equal(STRATEGIES.find((s) => s.key === 'powerReady')?.beta, true)
  const off = buildCombos(slate(), { includeBeta: false }).filter((c) => c.strategy === 'powerReady')
  assert.equal(off.length, 0)
})

test('with includeBeta, powerReady builds from ONLY signal bats, ranked by hrProb', () => {
  const on = buildCombos(slate(), { includeBeta: true }).filter((c) => c.strategy === 'powerReady')
  assert.ok(on.length > 0, 'expected powerReady combos when includeBeta is on')
  // every leg carries the signal (the score-92 non-PR bats are excluded)
  assert.ok(on.every((c) => c.legs.every((l) => l.powerReady === true)))
  // ranked by calibrated HR prob — the two highest-prob PR bats lead the 2-leg
  const two = on.find((c) => c.size === 2)
  assert.deepEqual(two.legs.map((l) => l.playerId), [5, 6])
})

test('powerReady require rejects bats without the signal', () => {
  const s = STRATEGIES.find((x) => x.key === 'powerReady')
  assert.equal(s.require({ powerReady: true }), true)
  assert.equal(s.require({ powerReady: false }), false)
  assert.equal(s.require({}), false)
})
