import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeAiHrContext } from '../server/lib/aiHrContext.mjs'
import { buildAiHrShadowRecords, mergeAiHrShadowLedger } from '../server/lib/aiHrShadow.mjs'
import {
  buildAiHrEvaluation,
  buildAiHrOutcomeIndex,
  evaluateAiHrPromotionGate,
  scoreAiHrForecasts,
  settleAiHrShadowRecords,
  validateAiHrEvaluation,
} from '../server/lib/aiHrEvaluation.mjs'

const date = '2026-07-15'
const generatedAt = '2026-07-15T19:00:00.000Z'
const evidence = [{
  url: 'https://www.mlb.com/gameday/101',
  title: 'Official game update',
  publishedAt: '2026-07-15T18:00:00.000Z',
}]

const slate = {
  date,
  games: [
    {
      gamePk: 101, gameDate: '2026-07-15T23:05:00.000Z', status: 'Pre-Game', isLive: false, isFinal: false,
      awayTeam: { id: 1, abbr: 'NYY' }, homeTeam: { id: 2, abbr: 'BOS' },
      awayPitcher: { id: 50, name: 'Away Arm' }, homePitcher: { id: 60, name: 'Home Arm' },
    },
    {
      gamePk: 102, gameDate: '2026-07-16T02:05:00.000Z', status: 'Pre-Game', isLive: false, isFinal: false,
      awayTeam: { id: 1, abbr: 'NYY' }, homeTeam: { id: 2, abbr: 'BOS' },
      awayPitcher: { id: 50, name: 'Away Arm' }, homePitcher: { id: 61, name: 'Second Home Arm' },
    },
  ],
  scoredBatters: {
    '7-101': { playerId: 7, gamePk: 101, name: 'Doubleheader Bat', team: 'NYY', teamId: 1, isHome: false, hrProbability: 0.1, pitcher: { id: 60 } },
    '8-101': { playerId: 8, gamePk: 101, name: 'Scratch Bat', team: 'BOS', teamId: 2, isHome: true, hrProbability: 0.08, pitcher: { id: 50 } },
    '7-102': { playerId: 7, gamePk: 102, name: 'Doubleheader Bat', team: 'NYY', teamId: 1, isHome: false, hrProbability: 0.12, pitcher: { id: 61 } },
  },
}

function candidate(entityKey, kind, direction, confidence, note) {
  return { entityKey, kind, direction, severity: 'info', confidence, note, evidence }
}

function fixtureLedger() {
  const context = normalizeAiHrContext({
    raw: { signals: [
      candidate('game:101', 'weather', 'boost', 0.8, 'Game one has a carrying wind.'),
      candidate('game:102', 'roof', 'suppress', 0.6, 'Game two will close the roof.'),
    ] },
    slate,
    generatedAt,
    model: 'test-context-model',
    source: 'test-web-search',
  })
  const records = buildAiHrShadowRecords({ slate, context, generatedAt })
  return mergeAiHrShadowLedger({
    previous: null,
    date,
    records,
    replaceGamePks: [101, 102],
    updatedAt: generatedAt,
  })
}

const backtestLog = {
  modelHistory: {
    records: {
      [date]: [
        { playerId: 7, gamePk: 101, homered: true, actuallyPlayed: true },
        { playerId: 7, gamePk: 102, homered: false, actuallyPlayed: true },
        { playerId: 8, gamePk: 101, homered: false, actuallyPlayed: false },
      ],
    },
  },
}

test('outcome index lets repaired operational results override model history', () => {
  const index = buildAiHrOutcomeIndex({
    modelHistory: { records: { [date]: [{ playerId: 7, gamePk: 101, homered: false, actuallyPlayed: true }] } },
    records: { [date]: [{ playerId: 7, gamePk: 101, homered: true, actuallyPlayed: true }] },
  })
  assert.deepEqual(index.get(`${date}:101:7`), { homered: true, actuallyPlayed: true })
})

test('settlement is doubleheader-safe and excludes scratches from scoring', () => {
  const result = settleAiHrShadowRecords(fixtureLedger(), backtestLog)
  assert.deepEqual(result.coverage, {
    shadowRecords: 3,
    settledRecords: 2,
    pendingRecords: 0,
    scratches: 1,
    settledGames: 2,
    settledDates: 1,
    firstSettledDate: date,
    lastSettledDate: date,
  })
  assert.deepEqual(
    result.settled.map((item) => [item.record.gamePk, item.record.playerId, item.outcome]),
    [[101, 7, 1], [102, 7, 0]],
  )
})

test('paired scoring reports baseline minus shadow improvement exactly', () => {
  const metrics = scoreAiHrForecasts([
    { baseline: 0.1, shadow: 0.2, outcome: 1 },
    { baseline: 0.2, shadow: 0.1, outcome: 0 },
  ])
  assert.equal(metrics.baseline.brier, 0.425)
  assert.equal(metrics.shadow.brier, 0.325)
  assert.equal(metrics.comparison.brierImprovement, 0.1)
  assert.equal(metrics.sampleSize, 2)
  assert.equal(metrics.homers, 1)
})

test('evaluation emits calibration segments and remains collecting at low sample', () => {
  const report = buildAiHrEvaluation({ ledger: fixtureLedger(), backtestLog, generatedAt: '2026-07-16T12:00:00.000Z' })
  assert.equal(report.overall.sampleSize, 2)
  assert.equal(report.coverage.scratches, 1)
  assert.equal(report.segments.byNetDirection.boost.sampleSize, 1)
  assert.equal(report.segments.byNetDirection.suppress.sampleSize, 1)
  assert.equal(report.segments.byKind.weather.sampleSize, 1)
  assert.equal(report.segments.byKind.roof.sampleSize, 1)
  assert.equal(report.gate.status, 'collecting')
  assert.equal(report.gate.autoPromotion, false)
  assert.equal(report.scoreImpact, false)
  assert.equal(validateAiHrEvaluation(report).ok, true)
})

test('promotion requires statistically positive performance and still cannot auto-promote', () => {
  const rows = Array.from({ length: 500 }, () => ({ baseline: 0.1, shadow: 0.2, outcome: 1 }))
  const overall = scoreAiHrForecasts(rows)
  const coverage = { settledRecords: 500, settledGames: 500, settledDates: 14 }
  const gate = evaluateAiHrPromotionGate(overall, coverage)
  assert.equal(gate.passed, true)
  assert.equal(gate.status, 'eligible-for-review')
  assert.equal(gate.autoPromotion, false)

  const worse = scoreAiHrForecasts(Array.from({ length: 500 }, () => ({ baseline: 0.2, shadow: 0.1, outcome: 1 })))
  const held = evaluateAiHrPromotionGate(worse, coverage)
  assert.equal(held.passed, false)
  assert.equal(held.status, 'hold')
})

test('evaluation validator rejects production impact and inconsistent coverage', () => {
  const report = buildAiHrEvaluation({ ledger: fixtureLedger(), backtestLog, generatedAt: '2026-07-16T12:00:00.000Z' })
  report.scoreImpact = true
  report.coverage.pendingRecords = 99
  const validation = validateAiHrEvaluation(report)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes('production controls')))
  assert.ok(validation.errors.some((error) => error.includes('do not reconcile')))
})

test('evaluation validator cannot be bypassed by hand-editing promotion checks', () => {
  const report = buildAiHrEvaluation({ ledger: fixtureLedger(), backtestLog, generatedAt: '2026-07-16T12:00:00.000Z' })
  report.gate.checks = Object.fromEntries(Object.keys(report.gate.checks).map((key) => [key, true]))
  report.gate.passed = true
  report.gate.status = 'eligible-for-review'
  report.gate.reasons = []
  const validation = validateAiHrEvaluation(report)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes('versioned requirements')))
})

test('evaluation validator reports malformed calibration bins without throwing', () => {
  const report = buildAiHrEvaluation({ ledger: fixtureLedger(), backtestLog, generatedAt: '2026-07-16T12:00:00.000Z' })
  report.overall.baseline.calibrationBins = [null]
  assert.doesNotThrow(() => validateAiHrEvaluation(report))
  assert.equal(validateAiHrEvaluation(report).ok, false)
})
