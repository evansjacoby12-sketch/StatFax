import { test } from 'node:test'
import assert from 'node:assert/strict'

import { normalizeAiHrContext } from '../server/lib/aiHrContext.mjs'
import {
  AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA,
  aiHrSignalLogitDelta,
  applyAiHrLogitDelta,
  buildAiHrShadowRecords,
  mergeAiHrShadowLedger,
  validateAiHrShadowLedger,
} from '../server/lib/aiHrShadow.mjs'

const generatedAt = '2026-07-15T19:00:00.000Z'
const evidence = [{
  url: 'https://www.mlb.com/gameday/101',
  title: 'Official game update',
  publishedAt: '2026-07-15T18:00:00.000Z',
}]

const slate = {
  date: '2026-07-15',
  games: [
    {
      gamePk: 101,
      gameDate: '2026-07-15T23:05:00.000Z',
      status: 'Pre-Game',
      isLive: false,
      isFinal: false,
      awayTeam: { id: 1, abbr: 'NYY' },
      homeTeam: { id: 2, abbr: 'BOS' },
      awayPitcher: { id: 50, name: 'Away Arm' },
      homePitcher: { id: 60, name: 'Home Arm' },
    },
    {
      gamePk: 102,
      gameDate: '2026-07-16T02:05:00.000Z',
      status: 'Pre-Game',
      isLive: false,
      isFinal: false,
      awayTeam: { id: 1, abbr: 'NYY' },
      homeTeam: { id: 2, abbr: 'BOS' },
      awayPitcher: { id: 50, name: 'Away Arm' },
      homePitcher: { id: 61, name: 'Second Home Arm' },
    },
  ],
  scoredBatters: {
    '7-101': {
      playerId: 7, gamePk: 101, name: 'Away Slugger', team: 'NYY', teamId: 1, isHome: false,
      hrProbability: 0.12, pitcher: { id: 60, name: 'Home Arm' },
    },
    '8-101': {
      playerId: 8, gamePk: 101, name: 'Home Slugger', team: 'BOS', teamId: 2, isHome: true,
      hrProbability: 0.1, pitcher: { id: 50, name: 'Away Arm' },
    },
    '7-102': {
      playerId: 7, gamePk: 102, name: 'Away Slugger', team: 'NYY', teamId: 1, isHome: false,
      hrProbability: 0.11, pitcher: { id: 61, name: 'Second Home Arm' },
    },
  },
}

function candidate(entityKey, kind, direction, confidence, note) {
  return { entityKey, kind, direction, severity: 'info', confidence, note, evidence }
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

test('shadow math is monotonic, confidence-scaled, and capped in log-odds space', () => {
  assert.equal(aiHrSignalLogitDelta({ direction: 'boost', confidence: 0.8 }), 0.08)
  assert.equal(aiHrSignalLogitDelta({ direction: 'suppress', confidence: 0.5 }), -0.05)
  assert.equal(aiHrSignalLogitDelta({ direction: 'uncertain', confidence: 1 }), 0)
  assert.ok(applyAiHrLogitDelta(0.1, 0.1) > 0.1)
  assert.ok(applyAiHrLogitDelta(0.1, -0.1) < 0.1)
  assert.equal(applyAiHrLogitDelta(0.1, 99), applyAiHrLogitDelta(0.1, AI_HR_SHADOW_MAX_ABS_LOGIT_DELTA))
})

test('batter, pitcher, game, and opposing-bullpen signals map to exact batter-game rows', () => {
  const context = contextFor([
    candidate('batter:7:101', 'lineup-status', 'boost', 0.8, 'Away Slugger is confirmed.'),
    candidate('pitcher:60:101', 'pitch-limit', 'suppress', 0.5, 'Home Arm has a documented limit.'),
    candidate('game:101', 'weather', 'boost', 0.4, 'Wind is carrying to left field.'),
    candidate('bullpen:2:101', 'bullpen', 'boost', 0.6, 'Boston relievers worked heavily yesterday.'),
  ])
  const before = JSON.stringify(slate)
  const records = buildAiHrShadowRecords({ slate, context, generatedAt })

  assert.equal(JSON.stringify(slate), before, 'production slate must not be mutated')
  assert.equal(records.length, 2)
  const away = records.find((record) => record.playerId === 7)
  const home = records.find((record) => record.playerId === 8)
  assert.equal(away.appliedSignals.length, 4)
  assert.equal(away.shadowLogitDelta, 0.13)
  assert.equal(home.appliedSignals.length, 1)
  assert.equal(home.shadowLogitDelta, 0.04)
  assert.ok(away.shadowHrProbability > away.baselineHrProbability)
})

test('entity keys remain doubleheader-safe and expired context is ignored', () => {
  const context = contextFor([
    candidate('batter:7:101', 'lineup-status', 'boost', 1, 'Confirmed for game one.'),
  ])
  const records = buildAiHrShadowRecords({ slate, context, generatedAt })
  assert.deepEqual(records.map((record) => record.id), ['2026-07-15:101:7'])

  context.signals[0].expiresAt = '2026-07-15T18:59:59.000Z'
  context.signals[0].observedAt = '2026-07-15T18:00:00.000Z'
  assert.deepEqual(buildAiHrShadowRecords({ slate, context, generatedAt }), [])
})

test('ledger refresh replaces only pregame games and preserves frozen started-game records', () => {
  const context = contextFor([
    candidate('game:101', 'weather', 'boost', 0.4, 'Game one has a carrying wind.'),
    candidate('game:102', 'weather', 'suppress', 0.5, 'Game two roof will be closed.'),
  ])
  const records = buildAiHrShadowRecords({ slate, context, generatedAt })
  const previous = mergeAiHrShadowLedger({
    previous: null,
    date: slate.date,
    records,
    replaceGamePks: [101, 102],
    updatedAt: generatedAt,
  })
  const refreshed = mergeAiHrShadowLedger({
    previous,
    date: slate.date,
    records: [],
    replaceGamePks: [102],
    updatedAt: '2026-07-15T23:30:00.000Z',
  })

  assert.ok(refreshed.recordsByDate[slate.date].every((record) => record.gamePk === 101))
  assert.equal(validateAiHrShadowLedger(refreshed).ok, true)
})

test('shadow contract rejects production impact and tampered probability math', () => {
  const context = contextFor([
    candidate('game:101', 'weather', 'boost', 0.4, 'Game one has a carrying wind.'),
  ])
  const ledger = mergeAiHrShadowLedger({
    previous: null,
    date: slate.date,
    records: buildAiHrShadowRecords({ slate, context, generatedAt }),
    replaceGamePks: [101],
    updatedAt: generatedAt,
  })
  ledger.scoreImpact = true
  ledger.recordsByDate[slate.date][0].shadowHrProbability = 0.99
  const validation = validateAiHrShadowLedger(ledger)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes('production scoring')))
  assert.ok(validation.errors.some((error) => error.includes('deterministic log-odds')))
})

test('shadow validator reports malformed records without throwing', () => {
  const ledger = mergeAiHrShadowLedger({
    previous: null,
    date: slate.date,
    records: [],
    updatedAt: generatedAt,
  })
  ledger.recordsByDate[slate.date] = [{
    id: 'bad', date: slate.date, gamePk: 101, playerId: 7,
    baselineHrProbability: 0, shadowHrProbability: 2, shadowLogitDelta: 0,
    appliedSignals: [null],
  }]
  assert.doesNotThrow(() => validateAiHrShadowLedger(ledger))
  assert.equal(validateAiHrShadowLedger(ledger).ok, false)
})
