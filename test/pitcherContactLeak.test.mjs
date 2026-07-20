import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PITCHER_CONTACT_LEAK_THRESHOLD,
  buildPitcherContactLeak,
  compactPitcherContactLeakEvidence,
  effectiveContactSide,
  validatePitcherContactLeakEvidence,
} from '../src/sports/mlb/logic/pitcherContactLeak.js'

const batter = (overrides = {}) => ({
  batSide: 'L',
  pitcher: {
    hand: 'R',
    season: { ip: 120, goAo: 0.7, kPer9: 6.8 },
    savant: { hardHitPctAllowed: 44, barrelPctAllowed: 10, exitVeloAgainst: 91 },
    splits: {
      vl: { bf: 220, iso: 0.23, hrPer9: 1.8 },
      vr: { bf: 200, iso: 0.12, hrPer9: 0.8 },
    },
  },
  ...overrides,
})

test('Pitcher Contact Leak qualifies a complete weak-contact matchup without changing a projection', () => {
  const row = batter({ score: 70, hrProbability: 0.18 })
  const evidence = buildPitcherContactLeak(row)
  assert.equal(evidence.version, 1)
  assert.equal(evidence.advisoryOnly, true)
  assert.equal(evidence.reliability, 'full')
  assert.equal(evidence.componentCount, 4)
  assert.ok(evidence.score >= PITCHER_CONTACT_LEAK_THRESHOLD)
  assert.equal(evidence.qualifies, true)
  assert.equal(row.score, 70)
  assert.equal(row.hrProbability, 0.18)
})

test('handed damage resolves switch hitters against the side they will bat from', () => {
  assert.equal(effectiveContactSide('S', 'R'), 'L')
  assert.equal(effectiveContactSide('S', 'L'), 'R')
  const left = buildPitcherContactLeak(batter({ batSide: 'S' }))
  const right = buildPitcherContactLeak(batter({ batSide: 'S', pitcher: { ...batter().pitcher, hand: 'L' } }))
  assert.equal(left.effectiveBatterSide, 'L')
  assert.equal(right.effectiveBatterSide, 'R')
  assert.ok(left.components.handedDamage > right.components.handedDamage)
})

test('thin pitcher data does not manufacture a Contact Leak score', () => {
  const evidence = buildPitcherContactLeak(batter({
    pitcher: {
      hand: 'R',
      season: { ip: 8, goAo: 0.4, kPer9: 4 },
      savant: { hardHitPctAllowed: 50 },
      splits: { vl: { bf: 12, iso: 0.5, hrPer9: 4 } },
    },
  }))
  assert.equal(evidence, null)
})

test('archived Contact Leak evidence is compact and contract-validated', () => {
  const archive = compactPitcherContactLeakEvidence(buildPitcherContactLeak(batter()))
  assert.deepEqual(validatePitcherContactLeakEvidence(archive), [])
  const tampered = structuredClone(archive)
  tampered.qualifies = !tampered.qualifies
  assert.ok(validatePitcherContactLeakEvidence(tampered).some((error) => error.includes('qualifies')))
})
