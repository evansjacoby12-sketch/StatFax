import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeParlay } from '../ui/src/lib/parlay.js'

const leg = (p, dec) => ({ hrProbability: p, odds: dec ? { best: { decimal: dec, american: dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1)) } } : null })

test('empty slip', () => {
  const r = computeParlay([])
  assert.equal(r.n, 0)
  assert.equal(r.modelProb, 0)
  assert.equal(r.allPriced, false)
})

test('two priced legs: independence product + parlay odds + edge', () => {
  const r = computeParlay([leg(0.25, 5), leg(0.2, 4)])
  assert.equal(r.n, 2)
  assert.ok(Math.abs(r.modelProb - 0.05) < 1e-9, 'modelProb = 0.25*0.2')
  assert.equal(r.allPriced, true)
  assert.ok(Math.abs(r.decimal - 20) < 1e-9, 'decimal = 5*4')
  assert.ok(Math.abs(r.impliedProb - 0.05) < 1e-9, 'implied = 1/20')
  // edge = modelProb*decimal - 1 = 0.05*20 - 1 = 0
  assert.ok(Math.abs(r.edge - 0) < 1e-9)
  assert.equal(r.american, 1900) // (20-1)*100
})

test('positive edge when model beats the book', () => {
  const r = computeParlay([leg(0.25, 6), leg(0.25, 6)])
  // modelProb 0.0625, decimal 36 → edge 0.0625*36-1 = 1.25
  assert.ok(r.edge > 1, 'big positive edge')
})

test('mixed pricing → not all priced, fair odds from model', () => {
  const r = computeParlay([leg(0.25, 5), leg(0.2, null)])
  assert.equal(r.allPriced, false)
  assert.equal(r.priced, 1)
  assert.equal(r.decimal, null)
  assert.equal(r.american, null)
  assert.ok(Number.isFinite(r.fairAmerican), 'fair american still computed from model prob')
})
