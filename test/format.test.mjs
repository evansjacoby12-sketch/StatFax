import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pct, rate, american, decimalToAmerican, signedPct, num } from '../ui/src/lib/format.js'

test('pct', () => {
  assert.equal(pct(0.2638, 1), '26.4%')
  assert.equal(pct(0.05, 0), '5%')
  assert.equal(pct(null), '—')
  assert.equal(pct(NaN), '—')
})

test('rate drops the leading zero (baseball style)', () => {
  assert.equal(rate(0.268), '.268')
  assert.equal(rate(0), '.000')
  assert.equal(rate(1.5), '1.500')
  assert.equal(rate(-0.05), '-.050')
  assert.equal(rate(null), '—')
})

test('american odds formatting', () => {
  assert.equal(american(150), '+150')
  assert.equal(american(-110), '-110')
  assert.equal(american(null), '—')
})

test('decimalToAmerican', () => {
  assert.equal(decimalToAmerican(2.5), 150)
  assert.equal(decimalToAmerican(1.5), -200)
  assert.equal(decimalToAmerican(2), 100)
  assert.equal(decimalToAmerican(1), null)
})

test('signedPct', () => {
  assert.equal(signedPct(0.039, 0), '+4%')
  assert.equal(signedPct(-0.02, 1), '-2.0%')
})

test('num', () => {
  assert.equal(num(3.14159, 2), '3.14')
  assert.equal(num(null), '—')
})
