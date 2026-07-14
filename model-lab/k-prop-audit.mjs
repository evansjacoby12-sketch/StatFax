#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  findBestKScale,
  flattenKResults,
  summarizeKRows,
} from '../src/sports/mlb/logic/kMetrics.js'

const args = process.argv.slice(2)
const fromIndex = args.indexOf('--from')
const fromDate = fromIndex >= 0 ? args[fromIndex + 1] : null
const fileArg = args.find((arg, index) => !arg.startsWith('--') && index !== fromIndex + 1)
const file = resolve(fileArg || 'dist/backtest-log.json')
const log = JSON.parse(readFileSync(file, 'utf8'))
const rows = flattenKResults(log.kProps, { fromDate })

if (!rows.length) {
  console.error(`No graded K rows found in ${file}${fromDate ? ` from ${fromDate}` : ''}`)
  process.exitCode = 1
} else {
  const current = summarizeKRows(rows)
  const bestBrier = findBestKScale(rows, { objective: 'brier' })
  const bestRmse = findBestKScale(rows, { objective: 'rmse' })
  const round = (value, digits = 4) => Number.isFinite(value) ? +value.toFixed(digits) : null
  const compact = (metrics) => ({
    n: metrics.n,
    predictedMean: round(metrics.predictedMean, 3),
    actualMean: round(metrics.actualMean, 3),
    bias: round(metrics.bias, 3),
    mae: round(metrics.mae, 3),
    rmse: round(metrics.rmse, 3),
    brier: round(metrics.brier, 5),
    probabilityBias: round(metrics.probabilityBias, 4),
    ipN: metrics.ipN,
    ipBias: round(metrics.ipBias, 3),
    bfN: metrics.bfN,
    bfBias: round(metrics.bfBias, 3),
  })

  console.log(`K prop audit: ${file}${fromDate ? ` (from ${fromDate})` : ''}`)
  console.log('current', compact(current))
  console.log('best Brier scale', bestBrier.scale, compact(bestBrier.metrics))
  console.log('best RMSE scale', bestRmse.scale, compact(bestRmse.metrics))
  console.log('line calibration')
  for (const [line, values] of Object.entries(current.byLine)) {
    console.log(`  O ${line}: predicted=${round(values.predicted, 3)} actual=${round(values.actual, 3)} n=${values.n}`)
  }
}
