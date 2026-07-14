import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  backtestCoverage,
  chooseFreshestBacktest,
  modelHistoryView,
} from '../model-lab/lib/loadBacktest.mjs'

const log = (dates, rowsPerDay = 1) => ({
  dates,
  records: Object.fromEntries(dates.map((date) => [date, Array.from({ length: rowsPerDay }, () => ({}))])),
})

test('model lab selects the newest evidence date instead of the first existing file', () => {
  const selected = chooseFreshestBacktest([
    { path: 'model-lab/data/backtest-log.json', log: log(['2026-06-19']), mtimeMs: 999 },
    { path: 'dist/backtest-log.json', log: log(['2026-07-13']), mtimeMs: 1 },
  ])
  assert.equal(selected.path, 'dist/backtest-log.json')
  assert.equal(selected.coverage.latestDate, '2026-07-13')
})

test('model lab prefers wider coverage when latest dates tie', () => {
  const selected = chooseFreshestBacktest([
    { path: 'short', log: log(['2026-07-13']) },
    { path: 'long', log: log(['2026-07-12', '2026-07-13']) },
  ])
  assert.equal(selected.path, 'long')
})

test('model lab ignores a newer malformed candidate with no record rows', () => {
  const selected = chooseFreshestBacktest([
    { path: 'broken', log: { dates: ['2026-07-14'], records: {} } },
    { path: 'usable', log: log(['2026-07-13']) },
  ])
  assert.equal(selected.path, 'usable')
})

test('model history view exposes durable archive rows without dropping operational state', () => {
  const raw = {
    ...log(['2026-07-13']),
    modelHistory: {
      version: 1,
      dates: ['2026-06-01', '2026-07-13'],
      records: { '2026-06-01': [{ score: 50 }], '2026-07-13': [{ score: 70 }] },
    },
  }
  assert.deepEqual(backtestCoverage(raw), {
    latestDate: '2026-07-13', days: 2, rows: 2, source: 'modelHistory',
  })
  const view = modelHistoryView(raw)
  assert.deepEqual(view.dates, ['2026-06-01', '2026-07-13'])
  assert.deepEqual(view.operational.dates, ['2026-07-13'])
  assert.equal(view.historySource, 'modelHistory')
})

test('walk-forward report labels the deployed feature-blend cap', () => {
  const slateSource = readFileSync(new URL('../server/fetch-slate.mjs', import.meta.url), 'utf8')
  const labSource = readFileSync(new URL('../model-lab/wf-eval.mjs', import.meta.url), 'utf8')
  const deployed = Number(slateSource.match(/EXPERIMENTAL_ML_RANK_CAP\s*=\s*([\d.]+)/)?.[1])
  const reported = Number(labSource.match(/CURRENT_BLEND_CAP\s*=\s*([\d.]+)/)?.[1])
  assert.equal(Number.isFinite(deployed), true)
  assert.equal(reported, deployed)
})
