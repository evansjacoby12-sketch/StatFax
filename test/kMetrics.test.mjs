import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  findBestKScale,
  flattenKResults,
  summarizeKRows,
} from '../src/sports/mlb/logic/kMetrics.js'

const ROWS = [
  { estK: 6, actualK: 5, expIP: 5.5, actualIP: 5, expBF: 24, actualBF: 22 },
  { estK: 8, actualK: 7, expIP: 6.2, actualIP: 6, expBF: 26, actualBF: 25 },
  { estK: 4, actualK: 3, expIP: 4.8, actualIP: 4.2, expBF: 20, actualBF: 18 },
]

test('K metrics report mean, probability, and volume bias', () => {
  const metrics = summarizeKRows(ROWS)
  assert.equal(metrics.n, 3)
  assert.equal(metrics.bias, 1)
  assert.equal(metrics.ipN, 3)
  assert.equal(metrics.bfN, 3)
  assert.ok(metrics.ipBias > 0)
  assert.ok(metrics.bfBias > 0)
  assert.ok(metrics.brier >= 0 && metrics.brier <= 1)
  assert.equal(Object.keys(metrics.byLine).length, 8)
})

test('K scale search improves RMSE for a consistently high projection', () => {
  const current = summarizeKRows(ROWS)
  const best = findBestKScale(ROWS, { min: 0.7, max: 1, step: 0.01, objective: 'rmse' })
  assert.ok(best.scale < 1)
  assert.ok(best.metrics.rmse < current.rmse)
})

test('K result flattener respects the temporal cutoff and valid outcomes', () => {
  const values = flattenKResults({
    resultsByDate: {
      '2026-07-10': [{ estK: 5, actualK: 4 }],
      '2026-07-11': [{ estK: 6, actualK: 5 }, { estK: null, actualK: 3 }],
    },
  }, { fromDate: '2026-07-11' })
  assert.deepEqual(values, [{ estK: 6, actualK: 5, date: '2026-07-11' }])
})
