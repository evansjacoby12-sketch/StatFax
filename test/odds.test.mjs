import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  americanToDecimal,
  americanToRawImplied,
  dejuicedImpliedProb,
  dejuicedEdge,
  comboMarket,
} from '../ui/src/lib/odds.js'

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

test('americanToDecimal: + and - lines, junk → null', () => {
  assert.ok(approx(americanToDecimal(100), 2))
  assert.ok(approx(americanToDecimal(450), 5.5))
  assert.ok(approx(americanToDecimal(-120), 100 / 120 + 1))
  assert.equal(americanToDecimal(0), null)
  assert.equal(americanToDecimal('x'), null)
})

test('americanToRawImplied includes the vig', () => {
  assert.ok(approx(americanToRawImplied(100), 0.5))
  assert.ok(approx(americanToRawImplied(-120), 120 / 220))
  assert.equal(americanToRawImplied(0), null)
})

test('dejuicedImpliedProb: two-sided normalizes (yes/(yes+no))', () => {
  const py = americanToRawImplied(120)
  const pn = americanToRawImplied(-140)
  assert.ok(approx(dejuicedImpliedProb(120, -140), py / (py + pn)))
})

test('dejuicedImpliedProb: one-sided divides out a flat hold (< raw implied)', () => {
  const raw = americanToRawImplied(150)
  const dj = dejuicedImpliedProb(150)
  assert.ok(dj < raw, 'de-juiced sits below the vigged implied')
  assert.ok(approx(dj, raw / 1.08))
  assert.equal(dejuicedImpliedProb(null), null)
})

test('dejuicedEdge = modelProb − fair implied', () => {
  const fair = dejuicedImpliedProb(150)
  assert.ok(approx(dejuicedEdge(0.3, 150), 0.3 - fair))
  assert.equal(dejuicedEdge(0.3, null), null)
  assert.equal(dejuicedEdge(NaN, 150), null)
})

test('comboMarket: any unpriced leg → null market figures', () => {
  const m = comboMarket([{ american: 150, modelProb: 0.2 }, { american: null, modelProb: 0.2 }])
  assert.equal(m.allPriced, false)
  assert.equal(m.american, null)
  assert.equal(m.ev, null)
  assert.equal(m.deJuicedEdge, null)
})

test('comboMarket: priced legs → decimal product, EV, de-juiced edge', () => {
  // two +150 legs → decimal 2.5 each, combo 6.25; model 0.3·0.3 = 0.09
  const m = comboMarket([{ american: 150, modelProb: 0.3 }, { american: 150, modelProb: 0.3 }])
  assert.equal(m.allPriced, true)
  assert.ok(approx(m.decimal, 6.25))
  assert.ok(approx(m.ev, 0.09 * 6.25 - 1))
  const fair = dejuicedImpliedProb(150)
  assert.ok(approx(m.deJuicedEdge, 0.09 - fair * fair))
})

test('comboMarket: prefers an explicit decimal but still derives from american', () => {
  const m = comboMarket([{ decimal: 3, american: 200, modelProb: 0.25 }, { american: 100, modelProb: 0.5 }])
  assert.equal(m.allPriced, true)
  assert.ok(approx(m.decimal, 3 * 2)) // 3 (explicit) × 2 (+100)
})
