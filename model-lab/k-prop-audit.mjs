#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  findBestKScale,
  flattenKResults,
  recommendKCalibration,
  summarizeKRows,
} from '../src/sports/mlb/logic/kMetrics.js'
import {
  K_CALIBRATION,
  K_MODEL_VERSION,
} from '../src/sports/mlb/logic/kBrain.js'

const args = process.argv.slice(2)
const fromIndex = args.indexOf('--from')
const fromDate = fromIndex >= 0 ? args[fromIndex + 1] : null
const fileArg = args.find((arg, index) => !arg.startsWith('--') && index !== fromIndex + 1)
const file = resolve(fileArg || 'dist/backtest-log.json')
const log = JSON.parse(readFileSync(file, 'utf8'))
const rows = flattenKResults(log.kProps, { fromDate })
const versions = rows.map((row) => row.modelVersion).filter(Number.isFinite)
const assessedModelVersion = versions.length ? Math.max(...versions) : null
const assessedRows = assessedModelVersion == null
  ? rows
  : rows.filter((row) => row.modelVersion === assessedModelVersion)

if (!assessedRows.length) {
  console.error(`No graded K rows found in ${file}${fromDate ? ` from ${fromDate}` : ''}`)
  process.exitCode = 1
} else {
  const assessedCalibration = assessedRows.find((row) => Number.isFinite(row.calibration))?.calibration ?? K_CALIBRATION
  const current = summarizeKRows(assessedRows)
  const bestBrier = findBestKScale(assessedRows, { objective: 'brier' })
  const bestRmse = findBestKScale(assessedRows, { objective: 'rmse' })
  const recommendation = recommendKCalibration(assessedRows, assessedCalibration, {
    modelVersion: assessedModelVersion,
  })
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

  console.log(`K prop audit: ${file}${fromDate ? ` (from ${fromDate})` : ''}${assessedModelVersion == null ? '' : ` (model v${assessedModelVersion})`}`)
  console.log('current', compact(current))
  console.log('best Brier scale', bestBrier.scale, compact(bestBrier.metrics))
  console.log('best RMSE scale', bestRmse.scale, compact(bestRmse.metrics))
  console.log('guarded recommendation', {
    status: recommendation.status,
    assessedModelVersion: recommendation.modelVersion,
    deployedModelVersion: K_MODEL_VERSION,
    samples: recommendation.n,
    dates: recommendation.dates,
    rawScale: round(recommendation.rawScale, 3),
    proposedScale: round(recommendation.proposedScale, 3),
    proposedCalibration: recommendation.proposedCalibration,
    checks: recommendation.checks,
  })
  console.log('line calibration')
  for (const [line, values] of Object.entries(current.byLine)) {
    console.log(`  O ${line}: predicted=${round(values.predicted, 3)} actual=${round(values.actual, 3)} n=${values.n}`)
  }
}
