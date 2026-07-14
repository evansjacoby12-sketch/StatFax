import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAiHrEntityIndex,
  emptyAiHrContext,
  normalizeAiHrContext,
  summarizeAiHrTargets,
  validateAiHrContext,
} from '../server/lib/aiHrContext.mjs'

const slate = {
  date: '2026-07-15',
  games: [
    {
      gamePk: 101,
      gameDate: '2026-07-15T23:05:00.000Z',
      venueName: 'Test Park',
      awayTeam: { id: 1, abbr: 'NYY' },
      homeTeam: { id: 2, abbr: 'BOS' },
      awayPitcher: { id: 50, name: 'Away Arm' },
      homePitcher: { id: 60, name: 'Home Arm' },
    },
    {
      gamePk: 102,
      gameDate: '2026-07-16T02:05:00.000Z',
      venueName: 'Test Park',
      awayTeam: { id: 1, abbr: 'NYY' },
      homeTeam: { id: 2, abbr: 'BOS' },
      awayPitcher: { id: 50, name: 'Away Arm' },
      homePitcher: { id: 61, name: 'Second Home Arm' },
    },
  ],
  scoredBatters: {
    '7-101': {
      playerId: 7, gamePk: 101, name: 'Test Slugger', team: 'NYY', score: 82,
      grade: { label: 'PRIME' }, pitcher: { id: 60, name: 'Home Arm' },
    },
    '7-102': {
      playerId: 7, gamePk: 102, name: 'Test Slugger', team: 'NYY', score: 78,
      grade: { label: 'STRONG' }, pitcher: { id: 61, name: 'Second Home Arm' },
    },
  },
}

const sourced = (overrides = {}) => ({
  entityKey: 'batter:7:101',
  kind: 'lineup-status',
  direction: 'boost',
  severity: 'info',
  confidence: 0.88,
  note: 'Confirmed in the leadoff spot for the first game.',
  evidence: [{
    url: 'https://www.mlb.com/gameday/101',
    title: 'Official starting lineup',
    publishedAt: '2026-07-15T18:00:00.000Z',
  }],
  ...overrides,
})

test('AI HR entity keys preserve player and pitcher identity across doubleheaders', () => {
  const index = buildAiHrEntityIndex(slate)
  assert.ok(index.has('batter:7:101'))
  assert.ok(index.has('batter:7:102'))
  assert.ok(index.has('pitcher:50:101'))
  assert.ok(index.has('pitcher:50:102'))
  assert.ok(index.has('game:101'))
  assert.ok(index.has('bullpen:2:101'))

  const summary = summarizeAiHrTargets(slate)
  assert.equal(summary.batters.length, 2)
  assert.equal(summary.games[0].pitchers[0].entityKey, 'pitcher:50:101')
})

test('normalizer binds sourced AI context to slate-owned entities without scoring impact', () => {
  const context = normalizeAiHrContext({
    raw: { signals: [sourced()] },
    slate,
    generatedAt: '2026-07-15T19:00:00.000Z',
    model: 'test-model',
    source: 'test-web-search',
  })

  assert.equal(context.scoreImpact, false)
  assert.equal(context.mode, 'advisory')
  assert.equal(context.signals.length, 1)
  assert.deepEqual(
    {
      entityKey: context.signals[0].entityKey,
      entityType: context.signals[0].entityType,
      entityId: context.signals[0].entityId,
      gamePk: context.signals[0].gamePk,
    },
    { entityKey: 'batter:7:101', entityType: 'batter', entityId: 7, gamePk: 101 },
  )
  assert.equal(context.signals[0].evidence[0].url, 'https://www.mlb.com/gameday/101')
  assert.deepEqual(validateAiHrContext(context).errors, [])
})

test('normalizer rejects unsourced, hallucinated, and mis-targeted signals', () => {
  const context = normalizeAiHrContext({
    raw: { signals: [
      sourced({ evidence: [] }),
      sourced({ entityKey: 'batter:999:101' }),
      sourced({ entityKey: 'game:101', kind: 'pitch-limit' }),
      sourced({ entityKey: 'pitcher:60:101', kind: 'pitch-limit', direction: 'suppress' }),
    ] },
    slate,
    generatedAt: '2026-07-15T19:00:00.000Z',
    model: 'test-model',
  })

  assert.equal(context.stats.requested, 4)
  assert.equal(context.stats.accepted, 1)
  assert.equal(context.stats.rejected, 3)
  assert.equal(context.signals[0].entityKey, 'pitcher:60:101')
})

test('contract rejects any attempt to smuggle probability math into advisory context', () => {
  const context = normalizeAiHrContext({
    raw: { signals: [sourced()] },
    slate,
    generatedAt: '2026-07-15T19:00:00.000Z',
    model: 'test-model',
  })
  context.signals[0].probabilityAdjustment = 0.05
  context.signals[0].expiresAt = context.signals[0].observedAt

  const check = validateAiHrContext(context)
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => error.includes('probabilityAdjustment')))
  assert.ok(check.errors.some((error) => error.includes('must be after observedAt')))
})

test('AI research targets exclude games that have already started', () => {
  const mixedSlate = structuredClone(slate)
  mixedSlate.games[0].isLive = true
  mixedSlate.games[0].status = 'In Progress'
  const summary = summarizeAiHrTargets(mixedSlate)
  assert.deepEqual(summary.games.map((game) => game.entityKey), ['game:102'])
  assert.deepEqual(summary.batters.map((batter) => batter.entityKey), ['batter:7:102'])
})

test('contract rejects an entity key that disagrees with its bound IDs', () => {
  const context = normalizeAiHrContext({
    raw: { signals: [sourced()] },
    slate,
    generatedAt: '2026-07-15T19:00:00.000Z',
    model: 'test-model',
  })
  context.signals[0].entityId = 999
  const check = validateAiHrContext(context)
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => error.includes('does not reconcile')))
})

test('empty skipped AI context remains a valid non-scoring pipeline artifact', () => {
  const context = emptyAiHrContext({
    date: '2026-07-15',
    generatedAt: '2026-07-15T19:00:00.000Z',
    model: 'test-model',
    skipped: true,
  })
  assert.deepEqual(validateAiHrContext(context).errors, [])
})
