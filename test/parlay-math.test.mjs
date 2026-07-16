import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parlayAllHit,
  parlayMarket,
  buildParlay,
  groupByGame,
  envTiltOf,
  weakestLeg,
} from '../ui/src/lib/parlayMath.js'

const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps

// leg(prob, gamePk, decimal, factor) — minimal shape the core reads.
const leg = (hrProbability, gamePk, decimal, parkWeatherHandFactor, score = 60, id = `${gamePk}-${hrProbability}`) => ({
  id,
  hrProbability,
  gamePk,
  score,
  parkWeatherHandFactor,
  odds: decimal ? { best: { decimal, american: decimal >= 2 ? Math.round((decimal - 1) * 100) : Math.round(-100 / (decimal - 1)) } } : null,
})

test('groupByGame buckets legs by gamePk', () => {
  const groups = groupByGame([leg(0.2, 1), leg(0.2, 1), leg(0.2, 2)])
  assert.equal(groups.length, 2)
  assert.equal(groups.find((g) => g.gamePk === 1).legs.length, 2)
})

test('envTiltOf prefers the per-bat park×weather×hand factor', () => {
  assert.ok(approx(envTiltOf([leg(0.2, 1, null, 1.2), leg(0.2, 1, null, 1.4)]), 1.3))
})

test('parlayAllHit: cross-game legs multiply independently', () => {
  const r = parlayAllHit([leg(0.25, 1), leg(0.2, 2)])
  assert.ok(approx(r.modelAllHit, 0.05))
  assert.ok(approx(r.independent, 0.05))
  assert.equal(r.sameGame, false)
})

test('parlayAllHit: same-game legs stay independent while uplift is disabled', () => {
  const r = parlayAllHit([leg(0.2, 1, null, 1.3), leg(0.25, 1, null, 1.3)])
  assert.equal(r.sameGame, true)
  assert.ok(approx(r.modelAllHit, r.independent))
})

test('parlayAllHit: mixed parlay remains independent with uplift disabled', () => {
  // Two legs share game 1 (launch pad); a third is in game 2.
  const sameGame = [leg(0.2, 1, null, 1.3), leg(0.25, 1, null, 1.3)]
  const r = parlayAllHit([...sameGame, leg(0.3, 2, null, 1.0)])
  const innerJoint = parlayAllHit(sameGame).modelAllHit
  assert.ok(approx(r.modelAllHit, innerJoint * 0.3), 'game-1 joint × game-2 leg')
  assert.ok(approx(r.modelAllHit, r.independent))
})

test('parlayAllHit: correlate=false forces the independent product', () => {
  const r = parlayAllHit([leg(0.2, 1, null, 1.3), leg(0.25, 1, null, 1.3)], { correlate: false })
  assert.ok(approx(r.modelAllHit, 0.05))
  assert.equal(r.sameGame, true)
  assert.equal(r.byGame.length, 1)
  assert.equal(r.byGame[0].legs.length, 2)
})

test('parlayAllHit: empty parlay is 0', () => {
  assert.equal(parlayAllHit([]).modelAllHit, 0)
})

test('parlayMarket: de-vigs, multiplies decimals, computes EV + edge', () => {
  const legs = [leg(0.25, 1, 5), leg(0.2, 2, 4)]
  const model = 0.05
  const m = parlayMarket(legs, model)
  assert.equal(m.allPriced, true)
  assert.ok(approx(m.decimal, 20))
  assert.ok(approx(m.ev, model * 20 - 1)) // 0.05*20 - 1 = 0
  assert.ok(m.deJuicedImplied < 0.05, 'de-vigged fair implied sits below the raw 1/decimal')
  assert.equal(m.perLeg.length, 2)
})

test('parlayMarket: one unpriced leg → not all priced, no EV', () => {
  const m = parlayMarket([leg(0.25, 1, 5), leg(0.2, 2, null)], 0.05)
  assert.equal(m.allPriced, false)
  assert.equal(m.ev, null)
  assert.equal(m.decimal, null)
})

test('buildParlay: full summary identifies same-game legs without an uplift', () => {
  const p = buildParlay([leg(0.2, 1, 6, 1.3), leg(0.25, 1, 6, 1.3)], { correlate: false })
  assert.equal(p.n, 2)
  assert.equal(p.sameGame, true)
  assert.ok(approx(p.modelAllHit, p.independent))
  assert.ok(p.allPriced)
  assert.ok(p.grade && typeof p.grade.letter === 'string')
  assert.ok(Number.isFinite(p.fairDecimal))
})

test('weakestLeg picks the lowest HR prob; null for singles', () => {
  assert.equal(weakestLeg([leg(0.3, 1)]), null)
  const w = weakestLeg([leg(0.3, 1), leg(0.15, 2), leg(0.22, 3)])
  assert.ok(approx(w.hrProbability, 0.15))
})
