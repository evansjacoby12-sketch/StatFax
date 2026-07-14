import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fitIsotonicAdaptive,
  fitIsotonicFromBacktest,
  fitPlattFromBacktest,
  fitScoreCalibrationAdaptive,
  lookupProb,
} from '../src/sports/mlb/logic/isotonicCalibration.js'

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

test('Bayesian smoothing preserves the empirical board prior instead of crushing it', () => {
  const rows = Array.from({ length: 100 }, (_, index) => ({
    score: 55,
    homered: index < 20,
    actuallyPlayed: true,
  }))
  const fit = fitIsotonicFromBacktest({ dates: ['2026-07-01'], records: { '2026-07-01': rows } })
  assert.equal(fit.totalN, 100)
  assert.equal(fit.priorMean, 0.2)
  for (const bucket of fit.table) assert.ok(Math.abs(bucket.observedProb - 0.2) < 1e-9)
})

test('calibration excludes confirmed scratches from its population and prior', () => {
  const played = Array.from({ length: 100 }, (_, index) => ({ score: 50, homered: index < 10 }))
  const scratched = Array.from({ length: 100 }, () => ({ score: 90, homered: false, actuallyPlayed: false }))
  const fit = fitIsotonicFromBacktest({
    dates: ['2026-07-01'],
    records: { '2026-07-01': [...played, ...scratched] },
  })
  assert.equal(fit.totalN, 100)
  assert.equal(fit.priorMean, 0.1)
})

test('adaptive calibration reports expanding-window temporal validation', () => {
  const dates = Array.from({ length: 10 }, (_, day) => `2026-07-${String(day + 1).padStart(2, '0')}`)
  const records = Object.fromEntries(dates.map((date, day) => [
    date,
    Array.from({ length: 100 }, (_, index) => ({
      score: (index % 10) * 10 + 5,
      homered: index % 10 >= 7 && (index + day) % 3 === 0,
    })),
  ]))
  const fit = fitIsotonicAdaptive({ dates, records }, { lookbackDays: 10 })
  assert.equal(fit.evaluation, 'expanding-window')
  assert.ok(fit.cv.length > 0)
  assert.ok(fit.cv.every((candidate) => candidate.holdoutN === 500 && candidate.folds > 0))
})

test('Platt calibration emits a smooth monotone lookup table', () => {
  const dates = Array.from({ length: 10 }, (_, day) => `2026-06-${String(day + 1).padStart(2, '0')}`)
  const records = Object.fromEntries(dates.map((date, day) => [
    date,
    Array.from({ length: 100 }, (_, score) => ({
      score,
      homered: ((score * 37 + day * 83) % 1000) / 1000 < 0.02 + score * 0.002,
    })),
  ]))
  const fit = fitPlattFromBacktest({ dates, records }, { lookbackDays: 10 })
  assert.equal(fit.method, 'platt')
  assert.equal(fit.totalN, 1000)
  for (let index = 1; index < fit.table.length; index++) {
    assert.ok(fit.table[index].observedProb >= fit.table[index - 1].observedProb)
  }
})

test('production calibration selector compares isotonic and Platt on future dates', () => {
  const dates = Array.from({ length: 10 }, (_, day) => `2026-05-${String(day + 1).padStart(2, '0')}`)
  const records = Object.fromEntries(dates.map((date, day) => [
    date,
    Array.from({ length: 100 }, (_, index) => ({
      score: index,
      homered: ((index * 53 + day * 97) % 1000) / 1000 < 0.025 + index * 0.0018,
    })),
  ]))
  const fit = fitScoreCalibrationAdaptive({ dates, records }, { lookbackDays: 10 })
  assert.match(fit.method, /^(isotonic|platt)$/)
  assert.equal(fit.evaluation, 'expanding-window')
  assert.ok(Number.isFinite(fit.candidates.isotonic.brier))
  assert.ok(Number.isFinite(fit.candidates.platt.brier))
  assert.equal(fit.validationN, 500)
})
