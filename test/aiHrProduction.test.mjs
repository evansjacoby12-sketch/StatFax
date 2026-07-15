import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeAiHrContext } from '../server/lib/aiHrContext.mjs'
import {
  AI_HR_PRODUCTION_VERSION,
  applyAiHrProduction,
  validateAiHrProduction,
} from '../server/lib/aiHrProduction.mjs'

const generatedAt = '2026-07-15T19:00:00.000Z'
const evidence = [{
  url: 'https://www.mlb.com/gameday/101',
  title: 'Official game update',
  publishedAt: '2026-07-15T18:00:00.000Z',
}]
const slate = {
  date: '2026-07-15',
  games: [{
    gamePk: 101,
    gameDate: '2026-07-15T23:05:00.000Z',
    status: 'Pre-Game',
    isLive: false,
    isFinal: false,
    awayTeam: { id: 1, abbr: 'NYY' },
    homeTeam: { id: 2, abbr: 'BOS' },
    awayPitcher: { id: 50, name: 'Away Arm' },
    homePitcher: { id: 60, name: 'Home Arm' },
  }],
  scoredBatters: {
    '7-101': {
      playerId: 7, gamePk: 101, name: 'Away Slugger', team: 'NYY', teamId: 1, isHome: false,
      score: 72, grade: { label: 'A' }, hrProbability: 0.12, simHRProb: 0.115,
      pitcher: { id: 60, name: 'Home Arm' },
    },
    '8-101': {
      playerId: 8, gamePk: 101, name: 'Home Slugger', team: 'BOS', teamId: 2, isHome: true,
      score: 64, grade: { label: 'B' }, hrProbability: 0.1, simHRProb: 0.098,
      pitcher: { id: 50, name: 'Away Arm' },
    },
  },
}

function contextFor(signals) {
  return normalizeAiHrContext({
    raw: { signals },
    slate,
    generatedAt,
    model: 'test-context-model',
    source: 'test-web-search',
  })
}

function candidate(entityKey, kind, direction, confidence, note) {
  return { entityKey, kind, direction, severity: 'info', confidence, note, evidence }
}

test('production promotion changes only HR probability and retains a sourced baseline audit trail', () => {
  const context = contextFor([
    candidate('game:101', 'weather', 'boost', 0.8, 'Wind is carrying to left field.'),
  ])
  const before = structuredClone(slate)
  const result = applyAiHrProduction({ slate, context, generatedAt })
  const row = result.slate.scoredBatters['7-101']

  assert.equal(slate.scoredBatters['7-101'].hrProbability, before.scoredBatters['7-101'].hrProbability)
  assert.equal(row.baselineHrProbability, 0.12)
  assert.ok(row.hrProbability > row.baselineHrProbability)
  assert.equal(row.score, before.scoredBatters['7-101'].score)
  assert.deepEqual(row.grade, before.scoredBatters['7-101'].grade)
  assert.equal(row.simHRProb, before.scoredBatters['7-101'].simHRProb)
  assert.equal(row.aiHr.productionVersion, AI_HR_PRODUCTION_VERSION)
  assert.equal(result.artifact.scoreImpact, true)
  assert.equal(result.artifact.gateOverride, true)
  assert.equal(result.artifact.records[0].appliedSignals[0].evidence[0].url, evidence[0].url)
  assert.equal(validateAiHrProduction(result).ok, true)
})

test('production promotion is idempotent and never compounds across refreshes', () => {
  const context = contextFor([
    candidate('game:101', 'weather', 'boost', 1, 'Strong carrying wind is documented.'),
  ])
  const first = applyAiHrProduction({ slate, context, generatedAt })
  const second = applyAiHrProduction({ slate: first.slate, context, generatedAt })
  assert.equal(second.slate.scoredBatters['7-101'].baselineHrProbability, 0.12)
  assert.equal(second.slate.scoredBatters['7-101'].hrProbability, first.slate.scoredBatters['7-101'].hrProbability)
  assert.deepEqual(second.artifact.records, first.artifact.records)
  assert.equal(validateAiHrProduction(second).ok, true)
})

test('non-scoring context publishes the untouched baseline with an explicit no-adjustments status', () => {
  const context = contextFor([
    candidate('batter:7:101', 'lineup-status', 'boost', 1, 'Away Slugger is confirmed.'),
  ])
  const result = applyAiHrProduction({ slate, context, generatedAt })
  assert.equal(result.artifact.status, 'no-adjustments')
  assert.equal(result.artifact.records.length, 0)
  assert.equal(result.slate.scoredBatters['7-101'].hrProbability, 0.12)
  assert.equal(result.slate.scoredBatters['7-101'].aiHr, undefined)
  assert.equal(validateAiHrProduction(result).ok, true)
})

test('production validator rejects tampering and an implicit gate override', () => {
  const context = contextFor([
    candidate('game:101', 'roof', 'suppress', 1, 'The roof will be closed.'),
  ])
  const result = applyAiHrProduction({ slate, context, generatedAt })
  result.artifact.gateOverride = false
  result.slate.scoredBatters['7-101'].hrProbability = 0.99
  const validation = validateAiHrProduction(result)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes('gateOverride')))
  assert.ok(validation.errors.some((error) => error.includes('row probability')))
})

test('production validator rejects stripped source provenance', () => {
  const context = contextFor([
    candidate('game:101', 'weather', 'boost', 0.8, 'Wind is carrying to left field.'),
  ])
  const result = applyAiHrProduction({ slate, context, generatedAt })
  result.artifact.records[0].appliedSignals[0].evidence = []
  const validation = validateAiHrProduction(result)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes('provenance') && error.includes('evidence')))
})

test('production validator reports malformed records without throwing', () => {
  const context = contextFor([])
  const result = applyAiHrProduction({ slate, context, generatedAt })
  result.artifact.records = { bad: true }
  assert.doesNotThrow(() => validateAiHrProduction(result))
  assert.equal(validateAiHrProduction(result).ok, false)
})

test('deploy applies and validates the overlay before publishing daily.json or building the UI', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const applyAt = workflow.indexOf('- name: Apply capped AI HR production adjustment')
  const validateAt = workflow.indexOf('- name: Validate AI HR production adjustment')
  const publishAt = workflow.indexOf('- name: Publish production slate and AI HR artifacts to R2')
  const buildAt = workflow.indexOf('- name: Build UI')
  assert.ok(applyAt > 0 && applyAt < validateAt && validateAt < publishAt && publishAt < buildAt)
  assert.match(workflow.slice(publishAt, buildAt), /for f in daily\.json .*ai-hr-production\.json/)
  assert.doesNotMatch(workflow.slice(0, applyAt), /for f in daily\.json/)
})
