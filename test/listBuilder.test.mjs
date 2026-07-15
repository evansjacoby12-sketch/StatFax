import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildListBuilderResults,
  createListBuilderCriteria,
  effectiveOppHr9,
  evaluateListBuilderBatter,
} from '../ui/src/lib/list-builder.js'

function batter(overrides = {}) {
  return {
    id: '7-101', playerId: 7, gamePk: 101, name: 'Test Slugger',
    game: { isLive: false, isFinal: false, status: 'Scheduled' },
    pitcher: { season: { hrPer9: 1.1 } }, effectiveHR9: 1.5,
    score: 80, hrProbability: 0.2, heatIndex: 70,
    exitVelo: 92, barrelPctBBE: 13, hardHitPct: 48,
    launchAngle: 20, pullPct: 45, gameParkHRFactor: 1.1,
    recentBarrel: { recentBarrelPct: 15, recentBBE: 8 },
    lineupConfirmed: true, battingOrder: 3,
    eli5Reasons: [{ tone: 'good' }, { tone: 'bad' }],
    hot: true, barrelKing: true,
    ...overrides,
  }
}

test('list builder uses blended pitcher exposure instead of raw starter HR/9', () => {
  const row = batter()
  assert.equal(effectiveOppHr9(row), 1.5)
  assert.equal(evaluateListBuilderBatter(row, { minOppHr9: 1.4 }).matches, true)
  assert.equal(evaluateListBuilderBatter({ ...row, effectiveHR9: null }, { minOppHr9: 1.4 }).matches, false)
})

test('launch angle is a bounded HR window and pull tendency is a minimum', () => {
  const criteria = { minLaunchAngle: 8, maxLaunchAngle: 32, minPullPct: 42 }
  assert.equal(evaluateListBuilderBatter(batter(), criteria).matches, true)
  assert.equal(evaluateListBuilderBatter(batter({ launchAngle: 36 }), criteria).matches, false)
  assert.equal(evaluateListBuilderBatter(batter({ pullPct: 38 }), criteria).matches, false)
})

test('recent barrel filters require a real six-BBE sample', () => {
  assert.equal(evaluateListBuilderBatter(batter(), { minRecBarrel: 12 }).matches, true)
  const evaluation = evaluateListBuilderBatter(batter({ recentBarrel: { recentBarrelPct: 30, recentBBE: 5 } }), { minRecBarrel: 12 })
  assert.equal(evaluation.matches, false)
  assert.deepEqual(evaluation.missing.map((item) => item.key), ['minRecBarrel'])
})

test('pregame, confirmed-lineup, and trust gates reject unactionable rows', () => {
  assert.equal(evaluateListBuilderBatter(batter({ game: { isLive: true } }), {}).matches, false)
  assert.equal(evaluateListBuilderBatter(batter({ lineupConfirmed: false }), { confirmedOnly: true }).matches, false)
  assert.equal(evaluateListBuilderBatter(batter({ battingOrder: null }), { confirmedOnly: true }).matches, false)
  assert.equal(evaluateListBuilderBatter(batter({ dataTrust: { status: 'review' } }), { trustedOnly: true }).matches, false)
})

test('selected signals support explicit ALL and ANY logic', () => {
  const row = batter({ hot: true, barrelKing: false })
  assert.equal(evaluateListBuilderBatter(row, { signals: ['hot', 'barrelKing'], signalMode: 'all' }).matches, false)
  assert.equal(evaluateListBuilderBatter(row, { signals: ['hot', 'barrelKing'], signalMode: 'any' }).matches, true)
})

test('builder returns evidence, missing-data coverage, and deterministic sorting', () => {
  const criteria = createListBuilderCriteria({ minBarrel: 10, pregameOnly: false, sort: 'score' })
  const result = buildListBuilderResults([
    batter({ id: '1', score: 70 }),
    batter({ id: '2', score: 90, barrelPctBBE: null, barrelPct: null }),
    batter({ id: '3', score: 80 }),
  ], criteria)
  assert.deepEqual(result.results.map((item) => item.batter.id), ['3', '1'])
  assert.deepEqual(result.coverage.minBarrel, { available: 2, total: 3 })
  assert.ok(result.results[0].evaluation.passed.some((item) => item.key === 'minBarrel'))
})
