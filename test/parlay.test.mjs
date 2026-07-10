import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeParlay, correlatedJoint, gameCorrelation } from '../ui/src/lib/parlay.js'

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

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

// ─── same-game correlation (SGP) ──────────────────────────────────────────────

test('gameCorrelation stays disabled until SGP uplift is fitted', () => {
  assert.equal(gameCorrelation(1.0), 0)
  assert.equal(gameCorrelation(0.9), 0)
  assert.equal(gameCorrelation(1.15), 0)
  assert.equal(gameCorrelation(1.3), 0)
  assert.equal(gameCorrelation(1.6), 0)
  assert.equal(gameCorrelation(NaN), 0)
})

test('correlatedJoint: rho=0 is the independent product', () => {
  assert.ok(approx(correlatedJoint([0.2, 0.25], 0), 0.05))
})

test('correlatedJoint: positive rho lifts the joint above independent', () => {
  const indep = 0.2 * 0.25
  const corr = correlatedJoint([0.2, 0.25], 0.3)
  assert.ok(corr > indep, 'correlation raises the joint')
  assert.ok(corr <= 0.2, 'but never above the weakest leg')
})

test('correlatedJoint: caps at the weakest leg (P(all) ≤ P(any))', () => {
  // 0.81 × 1.3 = 1.053 would exceed 1; the min-leg cap pulls it to 0.9
  assert.ok(approx(correlatedJoint([0.9, 0.9], 0.3), 0.9))
})

test('correlatedJoint: single leg is unaffected by rho', () => {
  assert.ok(approx(correlatedJoint([0.2], 0.3), 0.2))
})
