import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeAiHrContext } from '../server/lib/aiHrContext.mjs'
import { applyAiHrProduction } from '../server/lib/aiHrProduction.mjs'
import {
  applyMlbDataHealth,
  assertPublishableMlbDataHealth,
  buildMlbDataHealth,
  validateMlbDataHealth,
} from '../server/lib/mlbDataHealth.mjs'

const generatedAt = '2026-07-15T19:00:00.000Z'
const evidence = [{
  url: 'https://www.mlb.com/gameday/101',
  title: 'Official game update',
  publishedAt: '2026-07-15T18:00:00.000Z',
}]

function makeSlate() {
  const game = {
    gamePk: 101,
    gameDate: '2026-07-15T23:05:00.000Z',
    status: 'Pre-Game',
    isLive: false,
    isFinal: false,
    venueName: 'Test Park',
    awayTeam: { id: 1, abbr: 'NYY' },
    homeTeam: { id: 2, abbr: 'BOS' },
    awayPitcher: { id: 50, name: 'Away Arm' },
    homePitcher: { id: 60, name: 'Home Arm' },
  }
  const scoredBatters = {}
  for (let index = 0; index < 6; index++) {
    const away = index < 3
    const playerId = 7 + index
    scoredBatters[`${playerId}-101`] = {
      playerId,
      gamePk: 101,
      name: `${away ? 'Away' : 'Home'} Batter ${index + 1}`,
      team: away ? 'NYY' : 'BOS',
      teamId: away ? 1 : 2,
      isHome: !away,
      score: 60 + index,
      grade: { label: 'STRONG' },
      hrProbability: 0.1 + index / 100,
      pitcher: away ? { id: 60, name: 'Home Arm' } : { id: 50, name: 'Away Arm' },
    }
  }
  return {
    version: 5,
    date: '2026-07-15',
    generatedAt: '2026-07-15T18:55:00.000Z',
    finishedAt: '2026-07-15T18:56:00.000Z',
    games: [game],
    weatherByGame: { 101: { tempF: 78 } },
    scoredBatters,
    stats: { scoredBatters: 6 },
    _qaFlags: { gamesMissingStadium: [], insaneHrRate: [], nanFallbacks: 0 },
  }
}

function contextFor(slate, signals, at = generatedAt) {
  return normalizeAiHrContext({
    raw: { signals },
    slate,
    generatedAt: at,
    model: 'test-context-model',
    source: 'test-web-search',
  })
}

test('healthy slate is publishable and health annotations never alter projections', () => {
  const slate = makeSlate()
  const before = structuredClone(slate.scoredBatters)
  const result = applyMlbDataHealth({ slate, context: contextFor(slate, []), generatedAt })

  assert.equal(result.report.status, 'ready')
  assert.equal(result.report.counts.hardFailures, 0)
  assert.equal(result.slate.dataHealth.scoreImpact, false)
  assert.deepEqual(result.slate.scoredBatters, before)
  assert.doesNotThrow(() => assertPublishableMlbDataHealth(result.report))
  assert.equal(validateMlbDataHealth(result).ok, true)
})

test('feed identity contradictions block publishing', () => {
  const slate = makeSlate()
  slate.scoredBatters['7-101'].teamId = 999
  slate.scoredBatters['7-101'].pitcher = { id: 50, name: 'Away Arm' }
  const result = applyMlbDataHealth({ slate, context: contextFor(slate, []), generatedAt })

  assert.equal(result.report.status, 'critical')
  assert.ok(result.report.issues.some((issue) => issue.code === 'batter-team-mismatch' && issue.blocksPublish))
  assert.ok(result.report.issues.some((issue) => issue.code === 'opposing-pitcher-mismatch' && issue.blocksPublish))
  assert.equal(result.slate.scoredBatters['7-101'].dataTrust.status, 'blocked')
  assert.throws(() => assertPublishableMlbDataHealth(result.report), /blocked publish/)
})

test('missing supporting feeds produce visible warnings without blocking', () => {
  const slate = makeSlate()
  slate.scoredBatters = Object.fromEntries(Object.entries(slate.scoredBatters).slice(0, 2))
  slate.stats.scoredBatters = 2
  slate.weatherByGame = {}
  const result = applyMlbDataHealth({ slate, context: contextFor(slate, []), generatedAt })

  assert.equal(result.report.status, 'limited')
  assert.ok(result.report.issues.some((issue) => issue.code === 'few-scored-batters' && !issue.blocksPublish))
  assert.ok(result.report.issues.some((issue) => issue.code === 'weather-missing' && !issue.blocksPublish))
  assert.doesNotThrow(() => assertPublishableMlbDataHealth(result.report))
})

test('pitch-mix watchdog catches taxonomy usage dropped from the exact arsenal', () => {
  const slate = makeSlate()
  slate.pitcherPitchMix = {
    50: { fastballPct: 45, breakingPct: 50, offspeedPct: 5, ffPct: 45, slPct: 10, chPct: 5 },
    60: { fastballPct: 55, breakingPct: 35, offspeedPct: 10, ffPct: 55, stPct: 35, chPct: 10 },
  }
  const result = applyMlbDataHealth({ slate, context: contextFor(slate, []), generatedAt })
  const gaps = result.report.issues.filter((issue) => issue.code === 'pitch-mix-taxonomy-gap')

  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].gamePk, 101)
  assert.match(gaps[0].message, /40% of arsenal usage/)
  assert.equal(result.report.status, 'limited')
})

test('active sourced AI anomalies become non-blocking review markers on affected rows only', () => {
  const slate = makeSlate()
  const context = contextFor(slate, [{
    entityKey: 'pitcher:60:101',
    kind: 'starter-change',
    direction: 'uncertain',
    severity: 'alert',
    confidence: 0.92,
    note: 'The listed home starter may be replaced before first pitch.',
    observedAt: '2026-07-15T18:30:00.000Z',
    expiresAt: '2026-07-15T23:30:00.000Z',
    evidence,
  }])
  const result = applyMlbDataHealth({ slate, context, generatedAt })

  assert.equal(result.report.counts.aiAlerts, 1)
  const issue = result.report.issues.find((item) => item.source === 'ai-context')
  assert.equal(issue.blocksPublish, false)
  assert.equal(issue.evidence[0].url, evidence[0].url)
  assert.equal(result.slate.scoredBatters['7-101'].dataTrust.status, 'review')
  assert.equal(result.slate.scoredBatters['10-101'].dataTrust, undefined)
  assert.doesNotThrow(() => assertPublishableMlbDataHealth(result.report))
})

test('expired AI anomalies are ignored and stripped source provenance fails validation', () => {
  const slate = makeSlate()
  const context = contextFor(slate, [{
    entityKey: 'game:101', kind: 'roof', direction: 'uncertain', severity: 'warn', confidence: 0.8,
    note: 'Roof decision was pending.', observedAt: '2026-07-15T17:00:00.000Z',
    expiresAt: '2026-07-15T18:00:00.000Z', evidence,
  }], '2026-07-15T17:00:00.000Z')
  const expired = applyMlbDataHealth({ slate, context, generatedAt })
  assert.equal(expired.report.counts.aiAlerts, 0)

  const activeContext = contextFor(slate, [{
    entityKey: 'game:101', kind: 'roof', direction: 'uncertain', severity: 'warn', confidence: 0.8,
    note: 'Roof decision is pending.', evidence,
  }])
  const active = applyMlbDataHealth({ slate, context: activeContext, generatedAt })
  active.report.issues.find((issue) => issue.source === 'ai-context').evidence = []
  assert.equal(validateMlbDataHealth(active).ok, false)
})

test('production HR overlay preserves the watchdog summary and row trust markers', () => {
  const slate = makeSlate()
  const context = contextFor(slate, [{
    entityKey: 'pitcher:60:101', kind: 'starter-change', direction: 'uncertain', severity: 'warn', confidence: 0.8,
    note: 'The listed home starter may change.', evidence,
  }])
  const watched = applyMlbDataHealth({ slate, context, generatedAt })
  const production = applyAiHrProduction({ slate: watched.slate, context, generatedAt })
  assert.deepEqual(production.slate.dataHealth, watched.slate.dataHealth)
  assert.deepEqual(production.slate.scoredBatters['7-101'].dataTrust, watched.slate.scoredBatters['7-101'].dataTrust)
  assert.equal(validateMlbDataHealth({ slate: production.slate, report: watched.report }).ok, true)
})

test('deploy runs the watchdog after sourced context and before production publishing', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const contextAt = workflow.indexOf('- name: Validate AI HR context contract')
  const healthAt = workflow.indexOf('- name: Build MLB data health watchdog report')
  const healthValidateAt = workflow.indexOf('- name: Validate MLB data health watchdog')
  const productionAt = workflow.indexOf('- name: Apply capped AI HR production adjustment')
  const publishAt = workflow.indexOf('- name: Publish production slate and AI HR artifacts to R2')
  assert.ok(contextAt > 0 && contextAt < healthAt && healthAt < healthValidateAt && healthValidateAt < productionAt && productionAt < publishAt)
  assert.match(workflow.slice(productionAt, publishAt), /validate:mlb-data-health/)
  assert.match(workflow.slice(publishAt), /mlb-data-health\.json/)
  const vite = readFileSync(new URL('../ui/vite.config.js', import.meta.url), 'utf8')
  assert.match(vite, /'mlb-data-health\.json'/)
})

test('MLB site stays quiet when healthy and exposes sourced review details when limited', () => {
  const app = readFileSync(new URL('../ui/src/App.jsx', import.meta.url), 'utf8')
  const loader = readFileSync(new URL('../ui/src/lib/data.js', import.meta.url), 'utf8')
  const banner = readFileSync(new URL('../ui/src/components/MlbDataHealthBanner.jsx', import.meta.url), 'utf8')
  assert.match(app, /<MlbDataHealthBanner health=\{data\.meta\.dataHealth\}/)
  assert.match(loader, /dataHealth: d\.dataHealth \|\| null/)
  assert.match(banner, /health\.status === 'ready'/)
  assert.match(banner, /Projections were not changed by this warning/)
  assert.match(banner, /target="_blank"/)
})
