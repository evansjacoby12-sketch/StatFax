#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  evaluateKPromotion,
  findBestKScale,
  flattenKResults,
  summarizeKRows,
} from '../src/sports/mlb/logic/kMetrics.js'
import {
  K_CALIBRATION,
  K_MODEL_VERSION,
} from '../src/sports/mlb/logic/kBrain.js'

const args = process.argv.slice(2)
const fromIndex = args.indexOf('--from')
const fromDate = fromIndex >= 0 ? args[fromIndex + 1] : null
const versionIndex = args.indexOf('--model-version')
const requestedVersion = versionIndex >= 0 ? Number(args[versionIndex + 1]) : K_MODEL_VERSION
const optionValueIndexes = new Set()
if (fromIndex >= 0) optionValueIndexes.add(fromIndex + 1)
if (versionIndex >= 0) optionValueIndexes.add(versionIndex + 1)
const fileArg = args.find((arg, index) => !arg.startsWith('--') && !optionValueIndexes.has(index))
const file = resolve(fileArg || 'dist/backtest-log.json')
const log = JSON.parse(readFileSync(file, 'utf8'))
const rows = flattenKResults(log.kProps, { fromDate })
const assessedModelVersion = Number.isInteger(requestedVersion) ? requestedVersion : K_MODEL_VERSION
const assessedRows = rows.filter((row) => row.modelVersion === assessedModelVersion)
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

if (!assessedRows.length) {
  console.log(`K prop audit: ${file}${fromDate ? ` (from ${fromDate})` : ''} (model v${assessedModelVersion})`)
  console.log('forward gate', {
    status: 'collecting',
    assessedModelVersion,
    deployedModelVersion: K_MODEL_VERSION,
    finalPregameSamples: 0,
    dates: 0,
    message: 'No graded final-pregame rows exist for this model version yet.',
  })
} else {
  const assessedCalibration = assessedRows.find((row) => Number.isFinite(row.calibration))?.calibration ?? K_CALIBRATION
  const current = summarizeKRows(assessedRows)
  const bestBrier = findBestKScale(assessedRows, { objective: 'brier' })
  const bestRmse = findBestKScale(assessedRows, { objective: 'rmse' })
  const promotion = evaluateKPromotion(rows, assessedCalibration, {
    modelVersion: assessedModelVersion,
  })

  console.log(`K prop audit: ${file}${fromDate ? ` (from ${fromDate})` : ''}${assessedModelVersion == null ? '' : ` (model v${assessedModelVersion})`}`)
  console.log('current', compact(current))
  console.log('best Brier scale', bestBrier.scale, compact(bestBrier.metrics))
  console.log('best RMSE scale', bestRmse.scale, compact(bestRmse.metrics))
  console.log('forward gate', {
    status: promotion.status,
    assessedModelVersion: promotion.modelVersion,
    deployedModelVersion: K_MODEL_VERSION,
    finalPregameSamples: promotion.forward.counts.eligible,
    dates: promotion.forward.dates.length,
    trainingSamples: promotion.forward.trainingRows.length,
    trainingDates: promotion.forward.trainingDates.length,
    validationSamples: promotion.forward.validationRows.length,
    validationDates: promotion.forward.validationDates.length,
    candidateScale: round(promotion.candidateScale, 3),
    proposedScale: round(promotion.proposedScale, 3),
    proposedCalibration: promotion.proposedCalibration,
    validationBrierImprovement: round(promotion.forward.brierImprovement, 5),
    validationRmseImprovement: round(promotion.forward.rmseImprovement, 4),
    checks: promotion.checks,
  })
  console.log('validation segments')
  for (const [dimension, segments] of Object.entries(promotion.forward.segments)) {
    console.log(`  ${dimension}`)
    for (const segment of segments) {
      console.log(`    ${segment.key}: n=${segment.n} material=${segment.material} pass=${segment.pass} brierΔ=${round(segment.brierRegression, 5)} rmseΔ=${round(segment.rmseRegression, 4)}`)
    }
  }
  console.log('line calibration')
  for (const [line, values] of Object.entries(current.byLine)) {
    console.log(`  O ${line}: predicted=${round(values.predicted, 3)} actual=${round(values.actual, 3)} n=${values.n}`)
  }
}
