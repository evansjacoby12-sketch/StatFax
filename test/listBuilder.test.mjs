import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildListBuilderResults,
  createListBuilderCriteria,
  effectiveOppHr9,
  evaluateListBuilderBatter,
  relaxListBuilderGate,
  sanitizeListBuilderCriteria,
} from '../ui/src/lib/list-builder.js'

function batter(overrides = {}) {
  return {
    id: '7-101', playerId: 7, gamePk: 101, name: 'Test Slugger',
    game: { isLive: false, isFinal: false, status: 'Scheduled' },
    pitcher: { season: { hrPer9: 1.1, kPer9: 7.5 }, recentForm: { hrPer9: 1.8 } }, effectiveHR9: 1.5,
    season: { iso: 0.24 },
    matchupSignals: { contactFactor: 3 },
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

test('advanced matchup gates pair hitter power with pitcher weakness', () => {
  const row = batter()
  assert.equal(evaluateListBuilderBatter(row, { minISO: 0.2, maxPitcherK9: 8 }).matches, true)
  assert.equal(evaluateListBuilderBatter(row, { minISO: 0.2, minRecentPitcherHr9: 1.5 }).matches, true)
  assert.equal(evaluateListBuilderBatter(row, { minBarrel: 10, minContactCollision: 2 }).matches, true)
  assert.equal(evaluateListBuilderBatter(row, { minISO: 0.2, maxBattingOrder: 4 }).matches, true)
  assert.equal(evaluateListBuilderBatter(batter({ battingOrder: 5 }), { maxBattingOrder: 4 }).matches, false)
  assert.equal(evaluateListBuilderBatter(batter({ pitcher: { season: { kPer9: 9 }, recentForm: { hrPer9: 1.8 } } }), { maxPitcherK9: 8 }).matches, false)
})

test('new advanced gates report missing live features instead of assuming a pass', () => {
  const row = batter({ pitcher: { season: { kPer9: 7.5 }, recentForm: null }, matchupSignals: null })
  const evaluation = evaluateListBuilderBatter(row, { minRecentPitcherHr9: 1.5, minContactCollision: 2 })
  assert.equal(evaluation.matches, false)
  assert.deepEqual(evaluation.missing.map((item) => item.key), ['minRecentPitcherHr9', 'minContactCollision'])
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
  const twoMissing = buildListBuilderResults([batter({ hot: false, barrelKing: false })], { signals: ['hot', 'barrelKing'], signalMode: 'all' })
  assert.equal(twoMissing.evaluated[0].evaluation.failed.length, 2)
  assert.equal(twoMissing.nearMisses.length, 0)
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

test('builder separates exact matches from ranked one-gate near misses', () => {
  const result = buildListBuilderResults([
    batter({ id: 'exact', barrelPctBBE: 13, score: 75 }),
    batter({ id: 'close', barrelPctBBE: 11.5, score: 70 }),
    batter({ id: 'farther', barrelPctBBE: 9, score: 90 }),
  ], { minBarrel: 12 })
  assert.deepEqual(result.results.map((item) => item.batter.id), ['exact'])
  assert.equal(result.results[0].evaluation.fitScore, 100)
  assert.deepEqual(result.nearMisses.map((item) => item.batter.id), ['close', 'farther'])
  assert.ok(result.nearMisses[0].evaluation.fitScore > result.nearMisses[1].evaluation.fitScore)
  assert.equal(result.nearMisses[0].evaluation.failed[0].delta, 0.5)
  assert.equal(result.nearMisses[0].evaluation.failed[0].deltaText, '0.5%')
})

test('near misses exclude missing data, multiple failures, and unsupported relaxations', () => {
  const result = buildListBuilderResults([
    batter({ id: 'missing', barrelPctBBE: null, barrelPct: null }),
    batter({ id: 'two-away', barrelPctBBE: 8, score: 60 }),
    batter({ id: 'outside-input-range', barrelPctBBE: -2, score: 95 }),
    batter({ id: 'live', game: { isLive: true, status: 'In Progress' }, barrelPctBBE: 14, score: 95 }),
  ], { minBarrel: 12, minScore: 70 })
  assert.deepEqual(result.nearMisses, [])
  assert.equal(result.evaluated.find((item) => item.batter.id === 'missing').evaluation.missing.length, 1)
  assert.equal(result.evaluated.find((item) => item.batter.id === 'two-away').evaluation.failed.length, 2)
})

test('relax gate applies the disclosed threshold and makes the candidate exact', () => {
  const criteria = createListBuilderCriteria({ minBarrel: 12 })
  const row = batter({ barrelPctBBE: 11.46 })
  const failure = evaluateListBuilderBatter(row, criteria).failed[0]
  assert.equal(failure.relaxation.description, 'Barrel rate ≥ 12% → ≥ 11.4%')
  const relaxed = relaxListBuilderGate(criteria, failure)
  assert.equal(relaxed.minBarrel, 11.4)
  assert.equal(evaluateListBuilderBatter(row, relaxed).matches, true)

  const ceilingRow = batter({ launchAngle: 32.14 })
  const ceilingFailure = evaluateListBuilderBatter(ceilingRow, { maxLaunchAngle: 32 }).failed[0]
  assert.equal(ceilingFailure.relaxation.value, 32.2)
  assert.equal(evaluateListBuilderBatter(ceilingRow, relaxListBuilderGate({ maxLaunchAngle: 32 }, ceilingFailure)).matches, true)
})

test('state-gate near misses disclose and apply an explicit relaxation', () => {
  const criteria = createListBuilderCriteria({ confirmedOnly: true })
  const row = batter({ lineupConfirmed: false, battingOrder: null })
  const result = buildListBuilderResults([row], criteria)
  assert.equal(result.nearMisses.length, 1)
  const failure = result.nearMisses[0].evaluation.failed[0]
  assert.equal(failure.label, 'Action ready only')
  assert.equal(failure.relaxation.description, 'Action ready only: required → off')
  assert.equal(relaxListBuilderGate(criteria, failure).confirmedOnly, false)
})

test('external criteria are allow-listed, bounded, and safe to restore', () => {
  const criteria = sanitizeListBuilderCriteria({
    minOppHr9: 99,
    minLaunchAngle: -50,
    minBarrel: '12',
    signals: ['hot', 'invented', 'hot'],
    signalMode: 'any',
    pregameOnly: false,
    confirmedOnly: true,
    sort: 'invented',
    hiddenScoringBoost: 100,
  })
  assert.equal(criteria.minOppHr9, 4)
  assert.equal(criteria.minLaunchAngle, -10)
  assert.equal(criteria.minBarrel, 12)
  assert.deepEqual(criteria.signals, ['hot'])
  assert.equal(criteria.signalMode, 'any')
  assert.equal(criteria.pregameOnly, false)
  assert.equal(criteria.confirmedOnly, true)
  assert.equal(criteria.sort, 'hrProbability')
  assert.equal('hiddenScoringBoost' in criteria, false)
})
