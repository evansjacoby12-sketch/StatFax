import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildZoneMatchup,
  effectiveBatterSide,
  FALLBACK_ZONE_FREQUENCIES,
  ZONE_MODEL_VERSION,
} from '../src/sports/mlb/logic/zoneMatchup.js'
import {
  primeFromPriorCache,
  zoneFrequencyBaselineFromCache,
} from '../server/fetch-zone-matchup.mjs'
import {
  hasVerifiedZoneEdge,
  locationRating5,
  verifiedAttackCount,
} from '../ui/src/lib/zoneEdge.js'
import { zoneEdgeOf } from '../ui/src/lib/combo-engine.js'

const batterGrid = (iso = 0.16, count = 12) => Array.from({ length: 13 }, () => ({ iso, count }))
const pitcherGrid = (hand = 'R', samplePitches = 1_000) => {
  const frequencies = FALLBACK_ZONE_FREQUENCIES[hand]
  return frequencies.map((freq) => ({ freq, count: Math.max(1, Math.round(freq * samplePitches)) }))
}
const matchup = (bGrid, pGrid, options = {}) => buildZoneMatchup(
  { id: 1, batSide: options.batSide || 'R', grid: bGrid, sampleBIP: options.sampleBIP ?? 180, season: 2026 },
  { id: 2, pitcherHand: options.pitcherHand || 'R', vsHand: options.vsHand || 'R', grid: pGrid, samplePitches: options.samplePitches ?? 1_000, season: 2026 },
  { effectiveBatterSide: options.effectiveSide || 'R', pitcherHand: options.pitcherHand || 'R' },
)

test('neutral handedness baseline stays near 5 and does not manufacture an attack', () => {
  const result = matchup(batterGrid(0.2, 15), pitcherGrid('R'))
  assert.equal(result.modelVersion, ZONE_MODEL_VERSION)
  assert.equal(result.advisoryOnly, true)
  assert.equal(result.zoneRating, 5)
  assert.deepEqual(result.attackZones, [])
  assert.equal(result.badge, null)
})

test('supported damage plus pitcher overexposure creates an absolute strike-zone attack', () => {
  const bGrid = batterGrid()
  bGrid[0] = { iso: 0.48, count: 30 }
  const pGrid = pitcherGrid('R')
  pGrid[0] = { freq: 0.11, count: 110 }

  const result = matchup(bGrid, pGrid)
  assert.deepEqual(result.attackZones, [0])
  assert.deepEqual(result.matchedZones, result.attackZones)
  assert.equal(result.cellEvidence[0].qualified, true)
  assert.equal(result.cellEvidence[0].qualifiesAs, 'attack')
  assert.ok(result.cellEvidence[0].adjustedISO >= 0.2)
  assert.ok(result.cellEvidence[0].locationRatio >= 1.1)
})

test('zero and small cell samples are shrunk and cannot qualify', () => {
  const bGrid = batterGrid()
  bGrid[0] = { iso: 0.8, count: 0 }
  bGrid[1] = { iso: 0.8, count: 4 }
  const pGrid = pitcherGrid('R')
  pGrid[0] = { freq: 0.2, count: 200 }
  pGrid[1] = { freq: 0.2, count: 200 }

  const result = matchup(bGrid, pGrid)
  assert.equal(result.cellEvidence[0].sampleStatus, 'unavailable')
  assert.equal(result.cellEvidence[1].sampleStatus, 'limited')
  assert.equal(result.cellEvidence[0].qualified, false)
  assert.equal(result.cellEvidence[1].qualified, false)
  assert.deepEqual(result.attackZones, [])
})

test('overall split sample gates block otherwise strong cells', () => {
  const bGrid = batterGrid()
  bGrid[4] = { iso: 0.6, count: 20 }
  const pGrid = pitcherGrid('R', 100)
  pGrid[4] = { freq: 0.2, count: 20 }

  const result = matchup(bGrid, pGrid, { sampleBIP: 40, samplePitches: 100 })
  assert.equal(result.reliability.status, 'limited')
  assert.equal(result.cellEvidence[4].qualified, false)
  assert.deepEqual(result.attackZones, [])
})

test('chase opportunities remain separate from strike-zone attacks and badges', () => {
  const bGrid = batterGrid()
  bGrid[9] = { iso: 0.65, count: 25 }
  const pGrid = pitcherGrid('R')
  pGrid[9] = { freq: 0.3, count: 300 }

  const result = matchup(bGrid, pGrid)
  assert.deepEqual(result.attackZones, [])
  assert.deepEqual(result.chaseZones, [9])
  assert.equal(result.cellEvidence[9].qualifiesAs, 'chase')
  assert.equal(result.badge, null)
})

test('switch hitters use the opposite stance from the target pitcher hand', () => {
  assert.equal(effectiveBatterSide('S', 'R'), 'L')
  assert.equal(effectiveBatterSide('S', 'L'), 'R')
  assert.equal(effectiveBatterSide('L', 'R'), 'L')
  assert.equal(effectiveBatterSide('R', 'L'), 'R')
})

test('warm-cache league baseline pools pitch counts by effective batter side', () => {
  const prior = {}
  for (let pitcher = 1; pitcher <= 10; pitcher++) {
    const grid = Array.from({ length: 13 }, (_, index) => ({
      freq: index === 0 ? 0.2 : 0.8 / 12,
      count: index === 0 ? 220 : 73,
      slg: null,
    }))
    prior[`pitcher-${pitcher}-vsL-2026`] = {
      ts: Date.now(),
      value: { grid, samplePitches: 1_096, season: 2026, hand: 'L', vsHand: 'L' },
    }
  }
  assert.equal(primeFromPriorCache(prior), 10)
  const baseline = zoneFrequencyBaselineFromCache('L')
  assert.equal(baseline.source, 'warm-cache')
  assert.equal(baseline.pitcherEntries, 10)
  assert.ok(baseline.samplePitches >= 10_000)
  assert.ok(baseline.frequencies[0] > 0.19)
})

test('zone power can inflate probability without mutating projection scores or grades', () => {
  const source = readFileSync(new URL('../server/fetch-slate.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /row\.zoneBonus\s*=/)
  assert.doesNotMatch(source, /row\.baseScore\s*=/)
  assert.doesNotMatch(source, /zone bonus applied/i)
  assert.match(source, /applyZonePowerProbabilityInflation\(row\)/)
  assert.match(source, /score\/grade unchanged/)
})

test('frontend edge helpers reject legacy relative matches and require reliable v2 evidence', () => {
  const legacy = { matchedZones: [0, 1], zoneRating: 9, badge: 'ZONE_MASTER' }
  assert.equal(verifiedAttackCount(legacy), 0)
  assert.equal(hasVerifiedZoneEdge(legacy), false)
  assert.equal(zoneEdgeOf({ zoneMatchup: legacy }), false)

  const current = {
    modelVersion: 2,
    advisoryOnly: true,
    attackZones: [0, 1],
    matchedZones: [0, 1],
    zoneRating: 7,
    reliability: { status: 'high' },
    badge: 'ZONE_MASTER',
  }
  assert.equal(verifiedAttackCount(current), 2)
  assert.equal(hasVerifiedZoneEdge(current), true)
  assert.equal(zoneEdgeOf({ zoneMatchup: current }), true)
  assert.equal(locationRating5(current), 3.5)

  current.reliability.status = 'limited'
  assert.equal(hasVerifiedZoneEdge(current), false)
  assert.equal(zoneEdgeOf({ zoneMatchup: current }), false)
})

test('zone UI consumes canonical evidence without best-of scoring or forced attacks', () => {
  const view = readFileSync(new URL('../ui/src/components/ZoneView.jsx', import.meta.url), 'utf8')
  const drawer = readFileSync(new URL('../ui/src/components/PlayerDrawer.jsx', import.meta.url), 'utf8')
  const straights = readFileSync(new URL('../ui/src/components/TopStraightsView.jsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../ui/src/App.jsx', import.meta.url), 'utf8')
  assert.match(view, /No verified attack/)
  assert.match(view, /zoneEvidence\?\.attackZones/)
  assert.doesNotMatch(view, /combinedEdge5|Attack first|\.iso \?\? .*\.slg/)
  assert.doesNotMatch(drawer, /zoneBonus|combinedEdge5/)
  assert.doesNotMatch(straights, /combinedEdge5|\(zone - 2\.5\)/)
  assert.match(app, /setSelectedId\(null\)[\s\S]*setZoneId\(bb\.id\)/)
})
