import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lookupProb } from '../src/sports/mlb/logic/isotonicCalibration.js'

// A monotonic isotonic table (what fitIsotonic produces after PAV).
const TABLE = [
  { scoreLo: 0,  scoreHi: 20,  observedProb: 0.04 },
  { scoreLo: 20, scoreHi: 40,  observedProb: 0.06 },
  { scoreLo: 40, scoreHi: 60,  observedProb: 0.10 },
  { scoreLo: 60, scoreHi: 80,  observedProb: 0.18 },
  { scoreLo: 80, scoreHi: 100, observedProb: 0.26 },
]

test('lookupProb is finite and monotonic non-decreasing across the score range', () => {
  let prev = -1
  for (let s = 0; s <= 100; s += 2) {
    const p = lookupProb(s, TABLE)
    assert.ok(Number.isFinite(p), `finite at score ${s}`)
    assert.ok(p >= 0 && p <= 1, `in [0,1] at score ${s} (got ${p})`)
    assert.ok(p >= prev - 1e-9, `non-decreasing at ${s}: ${p} >= ${prev}`)
    prev = p
  }
})

test('lookupProb stays within the table value range (no extrapolation blow-up)', () => {
  const lo = TABLE[0].observedProb
  const hi = TABLE[TABLE.length - 1].observedProb
  for (let s = 0; s <= 100; s += 5) {
    const p = lookupProb(s, TABLE)
    assert.ok(p >= lo - 1e-9 && p <= hi + 1e-9, `between ${lo} and ${hi} at ${s} (got ${p})`)
  }
})

test('lookupProb falls back when the table is missing or empty', () => {
  const fb = (s) => 0.01 + s * 0.001
  assert.equal(lookupProb(50, null, fb), fb(50))
  assert.equal(lookupProb(50, [], fb), fb(50))
  assert.equal(lookupProb(50, undefined, fb), fb(50))
})
