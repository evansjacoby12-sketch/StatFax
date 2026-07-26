import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trainFeatModel, scoreFeatProb, probToScore, FEAT_KEYS } from '../server/models/featModel.mjs'
import {
  CLEAN_PREGAME_FEATURE_CAPTURE,
  CLEAN_PREGAME_FEATURE_GENERATION,
} from '../server/lib/historicalFeatureArchive.mjs'

const clean = (row) => ({
  ...row,
  featureCapture: CLEAN_PREGAME_FEATURE_CAPTURE,
  featureGeneration: CLEAN_PREGAME_FEATURE_GENERATION,
})

const TABLE = [
  { scoreLo: 0, scoreHi: 20, observedProb: 0.05 },
  { scoreLo: 20, scoreHi: 40, observedProb: 0.05 },
  { scoreLo: 40, scoreHi: 60, observedProb: 0.12 },
  { scoreLo: 60, scoreHi: 80, observedProb: 0.22 },
  { scoreLo: 80, scoreHi: 100, observedProb: 0.26 },
]

test('probToScore inverts the isotonic table (monotonic)', () => {
  // mids: 10,30,50,70,90 ; probs: .05,.05,.12,.22,.26
  assert.equal(probToScore(0.05, TABLE), 10) // <= first prob → first midpoint
  assert.equal(probToScore(0.26, TABLE), 90) // >= last prob → last midpoint
  const mid = probToScore(0.17, TABLE) // halfway between .12(50) and .22(70)
  assert.ok(Math.abs(mid - 60) < 1e-6, `~60, got ${mid}`)
  // monotonic non-decreasing
  let prev = -1
  for (const p of [0.04, 0.08, 0.12, 0.17, 0.22, 0.30]) {
    const s = probToScore(p, TABLE)
    assert.ok(s >= prev, 'monotonic')
    prev = s
  }
})

test('probToScore guards bad input', () => {
  assert.equal(probToScore(0.2, []), null)
  assert.equal(probToScore(NaN, TABLE), null)
})

test('trainFeatModel: not ready below the minimum clean sample', () => {
  const tiny = { records: { '2026-06-01': [clean({ feat: Object.fromEntries(FEAT_KEYS.map((k) => [k, 1])), homered: true, score: 80 })] } }
  const m = trainFeatModel(tiny)
  assert.equal(m.ready, false)
  assert.equal(m.n, 1)
  assert.equal(m.reason, 'clean-sample-too-small')
})

test('trainFeatModel waits for seven clean slate dates even with enough rows', () => {
  const records = Object.fromEntries(
    Array.from({ length: 6 }, (_, day) => [
      `2026-06-${String(day + 1).padStart(2, '0')}`,
      Array.from({ length: 60 }, (_, index) => clean({
        feat: Object.fromEntries(FEAT_KEYS.map((key) => [key, index])),
        homered: index % 8 === 0,
        score: index,
      })),
    ]),
  )
  const m = trainFeatModel({ dates: Object.keys(records), records })
  assert.equal(m.ready, false)
  assert.equal(m.n, 360)
  assert.equal(m.dates, 6)
  assert.equal(m.reason, 'clean-history-too-young')
})

test('trainFeatModel: trains + ranks better than noise on a separable synthetic set', () => {
  // Build 400 rows where HR correlates with feature "bs"; model should learn it.
  const records = Object.fromEntries(
    Array.from({ length: 10 }, (_, day) => [`2026-06-${String(day + 1).padStart(2, '0')}`, []]),
  )
  const dates = Object.keys(records)
  for (let i = 0; i < 400; i++) {
    const high = i % 2 === 0
    const feat = Object.fromEntries(FEAT_KEYS.map((k) => [k, 0]))
    feat.bs = high ? 80 : 20
    records[dates[Math.floor(i / 40)]].push(clean({
      feat,
      homered: high ? i % 3 === 0 : i % 9 === 0,
      score: feat.bs,
    }))
  }
  records[dates[0]].push(clean({
    feat: Object.fromEntries(FEAT_KEYS.map((key) => [key, 999])),
    homered: false,
    score: 100,
    actuallyPlayed: false,
  }))
  records[dates[0]].push({
    feat: Object.fromEntries(FEAT_KEYS.map((key) => [key, 999])),
    homered: true,
    score: 100,
  })
  const m = trainFeatModel({
    records: { '2026-07-01': [{ feat: null, homered: false, score: 1 }] },
    modelHistory: { version: 1, dates, records },
  })
  assert.equal(m.ready, true)
  assert.equal(m.n, 400)
  assert.equal(m.generation, CLEAN_PREGAME_FEATURE_GENERATION)
  assert.equal(m.evaluation, 'temporal-holdout')
  assert.deepEqual(m.holdoutDates, dates.slice(-2))
  assert.equal(m.trainN, 320)
  assert.equal(m.holdoutN, 80)
  assert.equal(m.historySource, 'modelHistory')
  assert.equal(m.historyDays, 10)
  assert.ok(Number.isFinite(m.cvAuc) && m.cvAuc > 0.5, `learned signal (cvAuc ${m.cvAuc})`)
  const pHigh = scoreFeatProb({ ...Object.fromEntries(FEAT_KEYS.map((k) => [k, 0])), bs: 80 }, m)
  const pLow = scoreFeatProb({ ...Object.fromEntries(FEAT_KEYS.map((k) => [k, 0])), bs: 20 }, m)
  assert.ok(pHigh > pLow, 'higher bs → higher HR prob')
})

test('scoreFeatProb null when model not ready', () => {
  assert.equal(scoreFeatProb({}, { ready: false }), null)
})
