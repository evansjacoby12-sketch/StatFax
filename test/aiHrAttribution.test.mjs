import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeAiHrContext } from '../server/lib/aiHrContext.mjs'
import { buildAiHrShadowRecords, mergeAiHrShadowLedger } from '../server/lib/aiHrShadow.mjs'
import { buildAiHrAttribution, validateAiHrAttribution } from '../server/lib/aiHrAttribution.mjs'

const date = '2026-07-15'
const generatedAt = '2026-07-15T19:00:00.000Z'
const evidence = [{ url: 'https://www.mlb.com/gameday/101', title: 'Weather update', publishedAt: '2026-07-15T18:00:00.000Z' }]

function fixture() {
  const slate = {
    date,
    games: [{
      gamePk: 101, gameDate: '2026-07-15T23:05:00.000Z', status: 'Pre-Game', isLive: false, isFinal: false,
      awayTeam: { id: 1, abbr: 'NYY' }, homeTeam: { id: 2, abbr: 'BOS' },
      awayPitcher: { id: 50, name: 'Away Arm' }, homePitcher: { id: 60, name: 'Home Arm' },
    }],
    scoredBatters: {
      '7-101': { playerId: 7, gamePk: 101, name: 'Surprise Homer', team: 'NYY', teamId: 1, isHome: false, score: 40, hrProbability: 0.05, pitcher: { id: 60 } },
      '8-101': { playerId: 8, gamePk: 101, name: 'Popular Blank', team: 'BOS', teamId: 2, isHome: true, score: 80, hrProbability: 0.2, pitcher: { id: 50 } },
    },
  }
  const context = normalizeAiHrContext({
    raw: { signals: [{
      entityKey: 'game:101', kind: 'weather', direction: 'boost', severity: 'warn', confidence: 1,
      note: 'Strong carrying wind was documented.', evidence,
    }] },
    slate,
    generatedAt,
    model: 'test-model',
    source: 'tavily+openai',
  })
  const records = buildAiHrShadowRecords({ slate, context, generatedAt })
  const ledger = mergeAiHrShadowLedger({ previous: null, date, records, replaceGamePks: [101], updatedAt: generatedAt })
  const backtestLog = {
    modelHistory: {
      records: {
        [date]: [
          { playerId: 7, gamePk: 101, homered: true, actuallyPlayed: true, feat: { brl: 14, iso: 0.27, park: 1.1 } },
          { playerId: 8, gamePk: 101, homered: false, actuallyPlayed: true, feat: { heat: 70, vig: 0.19 } },
        ],
      },
    },
  }
  const watchdogHistory = {
    recordsByDate: {
      [date]: {
        alerts: [{
          signalId: context.signals[0].id,
          entityKey: context.signals[0].entityKey,
          kind: context.signals[0].kind,
          gamePk: 101,
          outcome: 'confirmed',
        }],
      },
    },
  }
  return { ledger, backtestLog, watchdogHistory }
}

test('postgame attribution measures whether the AI adjustment helped and diagnoses extreme misses', () => {
  const report = buildAiHrAttribution({ ...fixture(), generatedAt: '2026-07-16T05:00:00.000Z' })
  const homer = report.records.find((record) => record.playerId === 7)
  const blank = report.records.find((record) => record.playerId === 8)

  assert.equal(homer.aiImpact, 'helped')
  assert.equal(homer.missType, 'surprise-homer')
  assert.ok(homer.diagnostics.some((item) => item.code === 'elite-barrel-signal'))
  assert.equal(blank.aiImpact, 'hurt')
  assert.equal(blank.missType, 'high-probability-blank')
  assert.equal(homer.signals[0].outcomeAlignment, 'aligned')
  assert.equal(blank.signals[0].outcomeAlignment, 'opposed')
  assert.equal(homer.signals[0].watchdogOutcome, 'confirmed')
  assert.equal(report.methodology.causalityClaimed, false)
  assert.equal(report.scoreImpact, false)
  assert.equal(validateAiHrAttribution(report).ok, true)
})

test('attribution excludes scratches and preserves pending coverage', () => {
  const input = fixture()
  input.backtestLog.modelHistory.records[date][0].actuallyPlayed = false
  input.backtestLog.modelHistory.records[date].pop()
  const report = buildAiHrAttribution(input)
  assert.equal(report.metrics.shadowRecords, 2)
  assert.equal(report.metrics.scratches, 1)
  assert.equal(report.metrics.pendingRecords, 1)
  assert.equal(report.metrics.settledRecords, 0)
  assert.equal(validateAiHrAttribution(report).ok, true)
})

test('attribution validator rejects probability math, impact, and aggregate tampering', () => {
  const report = buildAiHrAttribution(fixture())
  report.records[0].aiSquaredError = 99
  report.records[0].aiImpact = 'hurt'
  report.metrics.helped = 999
  const validation = validateAiHrAttribution(report)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes('paired Brier')))
  assert.ok(validation.errors.some((error) => error.includes('aiImpact')))
  assert.ok(validation.errors.some((error) => error.includes('metrics')))
})

test('deploy builds and validates attribution after evaluation and publishes its artifact', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const evaluationAt = workflow.indexOf('- name: Validate AI HR evaluation report')
  const buildAt = workflow.indexOf('- name: Build AI HR postgame attribution')
  const validateAt = workflow.indexOf('- name: Validate AI HR postgame attribution')
  const productionAt = workflow.indexOf('- name: Apply capped AI HR production adjustment')
  const publishAt = workflow.indexOf('- name: Publish production slate and AI HR artifacts to R2')
  assert.ok(evaluationAt < buildAt && buildAt < validateAt && validateAt < productionAt && productionAt < publishAt)
  assert.match(workflow.slice(publishAt), /ai-hr-attribution\.json/)
})
