import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  K_FORWARD_SEGMENT_DIMENSIONS,
  buildKForwardValidation,
  evaluateKPromotion,
  findBestKScale,
  flattenKResults,
  kProjectionBand,
  recommendKCalibration,
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

test('K result flattener can require the frozen final-pregame capture', () => {
  const values = flattenKResults({
    resultsByDate: {
      '2026-07-11': [
        { estK: 6, actualK: 5, finalPregame: true, lateCapture: false },
        { estK: 5, actualK: 4, finalPregame: false, lateCapture: false },
        { estK: 4, actualK: 3, finalPregame: true, lateCapture: true },
      ],
    },
  }, { finalPregameOnly: true })
  assert.equal(values.length, 1)
  assert.equal(values[0].estK, 6)
})

function forwardRows({ finalPregame = true } = {}) {
  return Array.from({ length: 120 }, (_, index) => {
    const actualK = 5 + (index % 4)
    return {
      estK: actualK / 1.08,
      actualK,
      modelVersion: 4,
      date: `2026-08-${String(1 + (index % 10)).padStart(2, '0')}`,
      finalPregame,
      lateCapture: false,
      lineupMode: index % 2 ? 'confirmed' : 'projected',
      conf: index % 2 ? 'high' : 'med',
      volumeSource: index % 2 ? 'recent-pitches-bf' : 'recent-ip',
    }
  })
}

test('K forward validation holds out the newest dates and segments the decision sample', () => {
  const report = buildKForwardValidation(forwardRows(), {
    modelVersion: 4,
    candidateScale: 1.05,
  })
  assert.deepEqual(report.trainingDates, [
    '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04',
    '2026-08-05', '2026-08-06', '2026-08-07',
  ])
  assert.deepEqual(report.validationDates, ['2026-08-08', '2026-08-09', '2026-08-10'])
  assert.equal(report.counts.eligible, 120)
  assert.equal(report.validationRows.length, 36)
  assert.deepEqual(Object.keys(report.segments), K_FORWARD_SEGMENT_DIMENSIONS)
  assert.equal(report.segmentDimensionsCovered, K_FORWARD_SEGMENT_DIMENSIONS.length)
  assert.equal(kProjectionBand({ estK: 4.49 }), 'low (<4.5)')
  assert.equal(kProjectionBand({ estK: 6.5 }), 'high (6.5+)')
})

test('K promotion gate stays collecting without final-pregame evidence', () => {
  const promotion = evaluateKPromotion(forwardRows({ finalPregame: false }), 0.903, {
    modelVersion: 4,
  })
  assert.equal(promotion.status, 'collecting')
  assert.equal(promotion.forward.counts.eligible, 0)
  assert.equal(promotion.proposedCalibration, 0.903)
})

test('K promotion gate requires a training improvement to repeat on later dates', () => {
  const promotion = evaluateKPromotion(forwardRows(), 0.903, {
    modelVersion: 4,
  })
  assert.equal(promotion.status, 'promote')
  assert.equal(promotion.candidateScale, 1.05)
  assert.equal(promotion.proposedScale, 1.05)
  assert.equal(promotion.proposedCalibration, 0.94815)
  assert.ok(promotion.forward.brierImprovement > 0)
  assert.ok(promotion.forward.rmseImprovement > 0)
  assert.ok(Object.values(promotion.checks).every(Boolean))
})

test('K forward gate exposes a regressing material segment', () => {
  const rows = forwardRows().map((row) => (
    row.date >= '2026-08-08' && row.lineupMode === 'projected'
      ? { ...row, actualK: row.estK * 0.90 }
      : row
  ))
  const report = buildKForwardValidation(rows, {
    modelVersion: 4,
    candidateScale: 1.05,
    minSegmentSample: 10,
    maxSegmentBrierRegression: 0,
    maxSegmentRmseRegression: 0,
  })
  const projected = report.segments.lineupMode.find((segment) => segment.key === 'projected')
  assert.equal(projected.material, true)
  assert.equal(projected.pass, false)
  assert.equal(report.noMaterialSegmentRegression, false)
})

test('guarded K calibration requires enough starts across multiple dates', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    estK: 4 + (index % 3),
    actualK: 5 + (index % 3),
    modelVersion: 2,
    date: '2026-07-20',
  }))
  const recommendation = recommendKCalibration(rows, 0.86, { modelVersion: 2 })
  assert.equal(recommendation.status, 'collecting')
  assert.equal(recommendation.proposedCalibration, 0.86)
  assert.equal(recommendation.proposedScale, 1)
})

test('guarded K calibration caps an agreed improvement to one five-percent step', () => {
  const rows = Array.from({ length: 72 }, (_, index) => {
    const estK = 3.5 + (index % 6) * 0.6
    return {
      estK,
      actualK: Math.round(estK * 1.12),
      modelVersion: 2,
      date: `2026-07-${20 + (index % 4)}`,
    }
  })
  const recommendation = recommendKCalibration(rows, 0.86, { modelVersion: 2 })
  assert.equal(recommendation.status, 'promote')
  assert.equal(recommendation.proposedScale, 1.05)
  assert.equal(recommendation.proposedCalibration, 0.903)
  assert.ok(recommendation.rawScale > recommendation.proposedScale)
  assert.ok(recommendation.candidate.brier < recommendation.current.brier)
  assert.ok(recommendation.candidate.rmse < recommendation.current.rmse)
  assert.deepEqual(recommendation.checks, {
    samples: true,
    dates: true,
    objectiveAgreement: true,
    materialBias: true,
    brierImproves: true,
    rmseImproves: true,
  })
})
