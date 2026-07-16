import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  applyZoneShadowDelta,
  buildZoneEvaluation,
  buildZoneEvidenceArchive,
  evaluateZonePromotionGate,
  validateZoneEvaluation,
  validateZoneEvidenceArchive,
  zoneShadowLogitDelta,
} from '../server/lib/zoneEvaluation.mjs'

const matchup = ({ attacks = 1, rating = 7, reliability = 'high', chase = 0 } = {}) => ({
  modelVersion: 2,
  advisoryOnly: true,
  attackZones: Array.from({ length: attacks }, (_, index) => index),
  chaseZones: Array.from({ length: chase }, (_, index) => index + 9),
  zoneRating: rating,
  reliability: { status: reliability },
  locationBaseline: { source: 'warm-cache', samplePitches: 25_000 },
})

function archivedRow({ playerId, gamePk, score, homered, attacks, baseline = 0.1, reliability = 'high' }) {
  return {
    playerId,
    gamePk,
    score,
    homered,
    actuallyPlayed: true,
    simHRProb: baseline,
    zoneEvidence: buildZoneEvidenceArchive(matchup({ attacks, reliability }), baseline),
    badges: [],
  }
}

test('fixed zone shadow hypothesis is capped, neutral when unqualified, and archive-valid', () => {
  const qualified = matchup({ attacks: 2, rating: 8 })
  const delta = zoneShadowLogitDelta(qualified)
  assert.ok(delta > 0 && delta <= 0.2)
  const archive = buildZoneEvidenceArchive(qualified, 0.12)
  assert.equal(archive.version, 1)
  assert.equal(archive.attackCount, 2)
  assert.equal(archive.shadowLogitDelta, delta)
  assert.equal(archive.shadowProbability, applyZoneShadowDelta(0.12, delta))
  assert.deepEqual(validateZoneEvidenceArchive(archive, 0.12), [])

  const limited = buildZoneEvidenceArchive(matchup({ attacks: 2, reliability: 'limited' }), 0.12)
  assert.equal(limited.shadowLogitDelta, 0)
  assert.equal(limited.shadowProbability, 0.12)
})

test('prospective evaluator keeps legacy Zone Master history descriptive only', () => {
  const backtestLog = {
    modelHistory: {
      records: {
        '2026-07-10': [{ playerId: 1, gamePk: 10, score: 70, homered: true, actuallyPlayed: true, badges: ['zoneMaster'], simHRProb: 0.15 }],
      },
    },
  }
  const report = buildZoneEvaluation({ backtestLog, generatedAt: '2026-07-16T12:00:00.000Z' })
  assert.equal(report.coverage.settledRecords, 0)
  assert.equal(report.coverage.legacyBadgeRecords, 1)
  assert.equal(report.legacyReference.promotionEligible, false)
  assert.equal(report.gate.status, 'collecting')
  assert.equal(report.scoreImpact, false)
  assert.equal(report.probabilityImpact, false)
  assert.equal(validateZoneEvaluation(report, backtestLog).ok, true)
})

test('evaluation reports shadow accuracy and same-score attack controls', () => {
  const records = {}
  let playerId = 1
  for (let day = 1; day <= 4; day++) {
    const date = `2026-07-${String(day).padStart(2, '0')}`
    records[date] = []
    for (let index = 0; index < 10; index++) {
      const qualified = index < 5
      records[date].push(archivedRow({
        playerId: playerId++,
        gamePk: day * 100 + index,
        score: 70 + (index % 2),
        homered: qualified && index % 3 === 0,
        attacks: qualified ? 1 : 0,
      }))
    }
  }
  const backtestLog = { modelHistory: { records }, records: {} }
  const report = buildZoneEvaluation({ backtestLog, generatedAt: '2026-07-16T12:00:00.000Z' })
  assert.equal(report.coverage.settledRecords, 40)
  assert.equal(report.coverage.qualifiedRecords, 20)
  assert.equal(report.performance.sampleSize, 20)
  assert.equal(report.scoreMatched.qualifiedRecords, 20)
  assert.equal(report.scoreMatched.controlRecords, 20)
  assert.equal(report.gate.status, 'collecting')
  assert.equal(validateZoneEvaluation(report, backtestLog).ok, true)

  const tampered = structuredClone(report)
  tampered.scoreImpact = true
  assert.equal(validateZoneEvaluation(tampered, backtestLog).ok, false)
})

test('passing statistics can only become eligible for review, never auto-promote', () => {
  const requirements = {
    minSettledRecords: 1,
    minQualifiedRecords: 1,
    minQualifiedHomers: 1,
    minSettledGames: 1,
    minSettledDates: 1,
    minScoreMatchedRecords: 1,
    maxEceRegression: 0.002,
  }
  const performance = {
    baseline: { ece: 0.02 },
    shadow: { ece: 0.019 },
    comparison: { pairedBrier95CI: { low: 0.001 }, logLossImprovement: 0.002 },
  }
  const coverage = { settledRecords: 1, qualifiedRecords: 1, qualifiedHomers: 1, settledGames: 1, settledDates: 1 }
  const matched = { qualifiedRecords: 1, observedVsControlLift: 1.2 }
  const gate = evaluateZonePromotionGate(performance, coverage, matched, requirements)
  assert.equal(gate.status, 'eligible-for-review')
  assert.equal(gate.passed, true)
  assert.equal(gate.autoPromotion, false)
  assert.equal(gate.productionImpact, false)
})

test('deployment derives, validates, publishes, and bundles the zone evaluation artifact', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const vite = readFileSync(new URL('../ui/vite.config.js', import.meta.url), 'utf8')
  const build = workflow.indexOf('npm run mlb:zone-evaluate')
  const validate = workflow.indexOf('npm run validate:zone-evaluation')
  const uiBuild = workflow.lastIndexOf('npm --prefix ui run build')
  assert.ok(build > 0 && validate > build && uiBuild > validate)
  assert.match(workflow, /zone-evaluation\.json/)
  assert.match(vite, /zone-evaluation\.json/)
})
