import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calibrationBandVerdict,
  probabilityBandForScore,
  summarizeRankPerformance,
} from '../ui/src/lib/hrTransparency.js'

test('probability band lookup includes the final score ceiling', () => {
  const scoreToProb = { table: [
    { scoreLo: 0, scoreHi: 50, observedProb: 0.08, n: 100 },
    { scoreLo: 50, scoreHi: 100, observedProb: 0.2, n: 40 },
  ] }
  assert.deepEqual(probabilityBandForScore(50, scoreToProb), {
    scoreLo: 50,
    scoreHi: 100,
    observedProb: 0.2,
    n: 40,
    label: '50–100',
  })
  assert.equal(probabilityBandForScore(100, scoreToProb).observedProb, 0.2)
  assert.equal(probabilityBandForScore(null, scoreToProb), null)
})

test('calibration verdict distinguishes aligned, low, and high bands', () => {
  assert.equal(calibrationBandVerdict({ avgPredicted: 0.15, observedRate: 0.16 }).key, 'aligned')
  assert.equal(calibrationBandVerdict({ avgPredicted: 0.15, observedRate: 0.19 }).key, 'low')
  assert.equal(calibrationBandVerdict({ avgPredicted: 0.15, observedRate: 0.1 }).key, 'high')
})

test('rank performance uses each settled slate top 3 and top 10 by model score', () => {
  const rows = (hits) => Array.from({ length: 12 }, (_, index) => ({
    playerId: index + 1,
    score: 100 - index,
    simHRProb: (12 - index) / 100,
    homered: hits.includes(index),
    actuallyPlayed: true,
  }))
  const records = {
    '2026-07-20': rows([0, 5, 11]),
    '2026-07-21': [...rows([3, 8]), { playerId: 99, score: 999, homered: true, actuallyPlayed: false }],
    '2026-07-22': rows([]),
    '2026-07-23': [{ playerId: 100, score: 100, homered: null, actuallyPlayed: true }],
  }

  const summary = summarizeRankPerformance(records, 7)
  assert.equal(summary.dateCount, 3)
  assert.equal(summary.summaries[3].n, 9)
  assert.equal(summary.summaries[3].hits, 1)
  assert.equal(summary.summaries[3].cashDays, 1)
  assert.equal(summary.summaries[10].n, 30)
  assert.equal(summary.summaries[10].hits, 4)
  assert.equal(summary.summaries[10].cashDays, 2)
  assert.equal(summary.daily[1].selections[3].hits, 0)
})
