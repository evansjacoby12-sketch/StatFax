import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  applyMlbDataHealth,
  assertPublishableMlbDataHealth,
  validateMlbDataHealth,
} from '../server/lib/mlbDataHealth.mjs'

const generatedAt = '2026-07-15T19:00:00.000Z'
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

test('healthy slate is publishable and health annotations never alter projections', () => {
  const slate = makeSlate()
  const before = structuredClone(slate.scoredBatters)
  const result = applyMlbDataHealth({ slate, generatedAt })

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
  const result = applyMlbDataHealth({ slate, generatedAt })

  assert.equal(result.report.status, 'critical')
  assert.ok(result.report.issues.some((issue) => issue.code === 'batter-team-mismatch' && issue.blocksPublish))
  assert.ok(result.report.issues.some((issue) => issue.code === 'opposing-pitcher-mismatch' && issue.blocksPublish))
  assert.equal(result.slate.scoredBatters['7-101'].dataTrust.status, 'blocked')
  assert.throws(() => assertPublishableMlbDataHealth(result.report), /blocked publish/)
})

test('watchdog accepts an explicitly corrected starter on frozen live predictions', () => {
  const slate = makeSlate()
  slate.games[0].status = 'In Progress'
  slate.games[0].isLive = true
  for (const row of Object.values(slate.scoredBatters)) {
    if (row.teamId !== 1) continue
    row.pitcher = { id: 55, name: 'Prediction Starter' }
    row.currentPitcher = { id: 60, name: 'Home Arm' }
    row.pitcherChanged = true
    row.pitcherProvenance = 'pregame-freeze'
  }

  const result = applyMlbDataHealth({ slate, generatedAt })

  assert.equal(result.report.issues.some((issue) => issue.code === 'opposing-pitcher-mismatch'), false)
  assert.doesNotThrow(() => assertPublishableMlbDataHealth(result.report))
})

test('missing supporting feeds produce visible warnings without blocking', () => {
  const slate = makeSlate()
  slate.scoredBatters = Object.fromEntries(Object.entries(slate.scoredBatters).slice(0, 2))
  slate.stats.scoredBatters = 2
  slate.weatherByGame = {}
  const result = applyMlbDataHealth({ slate, generatedAt })

  assert.equal(result.report.status, 'limited')
  assert.ok(result.report.issues.some((issue) => issue.code === 'few-scored-batters' && !issue.blocksPublish))
  assert.ok(result.report.issues.some((issue) => issue.code === 'weather-missing' && !issue.blocksPublish))
  assert.doesNotThrow(() => assertPublishableMlbDataHealth(result.report))
})

test('an unlisted probable starter produces one side-level check and scopes trust to opposing hitters', () => {
  const slate = makeSlate()
  slate.games[0].awayPitcher = null
  for (const row of Object.values(slate.scoredBatters)) {
    if (row.teamId === 2) row.pitcher = null
  }
  const result = applyMlbDataHealth({ slate, generatedAt })
  const starterIssues = result.report.issues.filter((issue) => issue.code === 'listed-starter-missing')

  assert.equal(starterIssues.length, 1)
  assert.equal(starterIssues[0].teamId, 2)
  assert.deepEqual(starterIssues[0].affectedPlayerIds, [10, 11, 12])
  assert.match(starterIssues[0].message, /NYY pitcher is TBD/)
  assert.match(starterIssues[0].message, /3 BOS hitters use pitcher-neutral inputs/)
  assert.equal(result.report.counts.warnings, 1)
  assert.equal(result.report.counts.affectedBatters, 3)
  assert.equal(result.slate.scoredBatters['7-101'].dataTrust, undefined)
  assert.equal(result.slate.scoredBatters['10-101'].dataTrust.status, 'review')
  assert.doesNotThrow(() => assertPublishableMlbDataHealth(result.report))
})

test('doubleheader health checks identify the exact game number', () => {
  const slate = makeSlate()
  slate.games[0].doubleHeader = 'S'
  slate.games[0].gameNumber = 2
  slate.games[0].awayPitcher = null
  for (const row of Object.values(slate.scoredBatters)) {
    if (row.teamId === 2) row.pitcher = null
  }
  const result = applyMlbDataHealth({ slate, generatedAt })
  const starterIssue = result.report.issues.find((issue) => issue.code === 'listed-starter-missing')

  assert.match(starterIssue.message, /^NYY@BOS \(Game 2\):/)
  assert.doesNotMatch(starterIssue.message, /Game 1/)
})

test('failure to attach an already-listed starter remains a publish blocker', () => {
  const slate = makeSlate()
  slate.scoredBatters['7-101'].pitcher = null
  const result = applyMlbDataHealth({ slate, generatedAt })

  assert.ok(result.report.issues.some((issue) => issue.code === 'opposing-pitcher-attachment-missing' && issue.blocksPublish))
  assert.equal(result.slate.scoredBatters['7-101'].dataTrust.status, 'blocked')
  assert.throws(() => assertPublishableMlbDataHealth(result.report), /blocked publish/)
})

test('pitch-mix watchdog catches taxonomy usage dropped from the exact arsenal', () => {
  const slate = makeSlate()
  slate.pitcherPitchMix = {
    50: { fastballPct: 45, breakingPct: 50, offspeedPct: 5, ffPct: 45, slPct: 10, chPct: 5 },
    60: { fastballPct: 55, breakingPct: 35, offspeedPct: 10, ffPct: 55, stPct: 35, chPct: 10 },
  }
  const result = applyMlbDataHealth({ slate, generatedAt })
  const gaps = result.report.issues.filter((issue) => issue.code === 'pitch-mix-taxonomy-gap')

  assert.equal(gaps.length, 1)
  assert.equal(gaps[0].gamePk, 101)
  assert.match(gaps[0].message, /40% of arsenal usage/)
  assert.equal(result.report.status, 'limited')
})

test('deploy validates the deterministic watchdog before publishing the current slate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const healthAt = workflow.indexOf('- name: Build MLB data health watchdog report')
  const healthValidateAt = workflow.indexOf('- name: Validate MLB data health watchdog')
  const publishAt = workflow.indexOf('- name: Publish current MLB slate to R2')
  assert.ok(healthAt > 0 && healthAt < healthValidateAt && healthValidateAt < publishAt)
  assert.doesNotMatch(workflow, /AI HR|ai:hr|TAVILY_API_KEY/)
  assert.match(workflow.slice(publishAt), /mlb-data-health\.json/)
  const vite = readFileSync(new URL('../ui/vite.config.js', import.meta.url), 'utf8')
  assert.match(vite, /'mlb-data-health\.json'/)
})

test('MLB site stays quiet when healthy and exposes deterministic review details when limited', () => {
  const app = readFileSync(new URL('../ui/src/App.jsx', import.meta.url), 'utf8')
  const loader = readFileSync(new URL('../ui/src/lib/data.js', import.meta.url), 'utf8')
  const banner = readFileSync(new URL('../ui/src/components/MlbDataHealthBanner.jsx', import.meta.url), 'utf8')
  assert.match(app, /<MlbDataHealthBanner health=\{data\.meta\.dataHealth\}/)
  assert.match(loader, /dataHealth: d\.dataHealth \|\| null/)
  assert.match(banner, /health\.status === 'ready'/)
  assert.match(banner, /affectedBatters/)
  assert.match(banner, /Projections were not changed by/)
  assert.match(banner, /target="_blank"/)
})
