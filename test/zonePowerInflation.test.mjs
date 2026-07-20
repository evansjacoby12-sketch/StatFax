import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ZONE_POWER_MAX_LOGIT_DELTA,
  ZONE_POWER_PROBABILITY_CEILING,
  applyZonePowerProbabilityInflation,
  zonePowerLogitDelta,
  zonePowerQualification,
} from '../server/lib/zonePowerInflation.mjs'

const liveRow = ({ attacks = 1, reliability = 'high', hardHitPct = 45, rating = 7, probability = 0.12 } = {}) => ({
  score: 68,
  grade: 'STRONG',
  hrProbability: probability,
  hardHitPct,
  zoneMatchup: {
    modelVersion: 2,
    advisoryOnly: true,
    attackZones: Array.from({ length: attacks }, (_, index) => index),
    reliability: { status: reliability },
    zoneRating: rating,
  },
})

test('qualified zone + hard-hit collision raises only HR probability', () => {
  const row = liveRow()
  const before = { score: row.score, grade: row.grade, probability: row.hrProbability }
  const result = applyZonePowerProbabilityInflation(row)

  assert.equal(result.applied, true)
  assert.ok(row.hrProbability > before.probability)
  assert.equal(row.score, before.score)
  assert.equal(row.grade, before.grade)
  assert.equal(row.zonePowerCollision.scoreImpact, false)
  assert.equal(row.zonePowerCollision.probabilityImpact, true)
  assert.equal(row.zonePowerCollision.baselineProbability, before.probability)
})

test('production delta is capped in log-odds and headline probability space', () => {
  const row = liveRow({ attacks: 3, hardHitPct: 60, rating: 10, probability: 0.44 })
  assert.equal(zonePowerLogitDelta(row), ZONE_POWER_MAX_LOGIT_DELTA)
  const result = applyZonePowerProbabilityInflation(row)
  assert.equal(result.applied, true)
  assert.equal(row.hrProbability, ZONE_POWER_PROBABILITY_CEILING)
})

test('production inflation is idempotent and cannot compound on a row', () => {
  const row = liveRow()
  const first = applyZonePowerProbabilityInflation(row)
  const firstProbability = row.hrProbability
  const second = applyZonePowerProbabilityInflation(row)
  assert.deepEqual(second, first)
  assert.equal(row.hrProbability, firstProbability)
})

test('raw zone evidence cannot inflate without reliable attacks and 40% hard-hit contact', () => {
  for (const row of [
    liveRow({ attacks: 0 }),
    liveRow({ reliability: 'limited' }),
    liveRow({ hardHitPct: 39.9 }),
    liveRow({ hardHitPct: null }),
  ]) {
    const baseline = row.hrProbability
    const result = applyZonePowerProbabilityInflation(row)
    assert.equal(result.applied, false)
    assert.equal(row.hrProbability, baseline)
    assert.equal(row.zonePowerCollision, undefined)
  }
})

test('archived evidence uses the same production qualification contract', () => {
  const row = {
    hrProbability: 0.1,
    feat: { hh: 47.3 },
    zoneEvidence: {
      modelVersion: 2,
      advisoryOnly: true,
      attackCount: 2,
      reliability: 'medium',
      zoneRating: 6.5,
    },
  }
  assert.equal(zonePowerQualification(row).qualified, true)
  assert.equal(applyZonePowerProbabilityInflation(row).applied, true)
})

test('invalid headline probability is never replaced by the zone overlay', () => {
  const row = liveRow({ probability: null })
  assert.equal(applyZonePowerProbabilityInflation(row).applied, false)
  assert.equal(row.hrProbability, null)
})
