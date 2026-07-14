import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAiHrHistoricalPrompt,
  buildAiHrHistoricalReplay,
  buildAiHrHistoricalSlate,
  buildAiHrWalkForwardBaseline,
  normalizeAiHrHistoricalContext,
  selectAiHrHistoricalDates,
  validateAiHrHistoricalReplay,
} from '../server/lib/aiHrHistorical.mjs'

const date = '2026-06-21'
const asOf = '2026-06-21T16:00:00.000Z'
const firstPitch = '2026-06-21T17:00:00.000Z'

const priorRows = Array.from({ length: 120 }, (_, index) => ({
  playerId: 10_000 + index,
  score: index % 100,
  simHRProb: 0.03 + (index % 10) / 200,
  homered: index % 17 === 0,
  actuallyPlayed: true,
}))

const targetRows = [
  {
    playerId: 7, gamePk: 101, name: 'Time Locked Bat', score: 82, grade: 'PRIME',
    simHRProb: 0.16, lineupConfirmed: true, homered: true, actuallyPlayed: true,
    postgameSecret: 'must never reach prompt',
  },
  {
    playerId: 8, gamePk: 101, name: 'Second Bat', score: 61, grade: 'STRONG',
    simHRProb: 0.09, lineupConfirmed: true, homered: false, actuallyPlayed: true,
  },
]

const backtestLog = {
  dates: ['2026-06-19', date],
  records: {
    '2026-06-19': priorRows,
    [date]: targetRows,
  },
}

const schedule = {
  dates: [{ games: [{
    gamePk: 101,
    gameDate: firstPitch,
    venue: { name: 'Safe Park' },
    teams: {
      away: { team: { id: 1, name: 'Away Club', abbreviation: 'AWY' } },
      home: { team: { id: 2, name: 'Home Club', abbreviation: 'HME' } },
    },
  }] }],
}

const boxscores = new Map([[101, {
  teams: {
    away: { players: {
      ID7: { person: { id: 7, fullName: 'Time Locked Bat' }, stats: { batting: { homeRuns: 1 } } },
    } },
    home: { players: {
      ID8: { person: { id: 8, fullName: 'Second Bat' }, stats: { batting: { homeRuns: 0 } } },
    } },
  },
}]])

function fixtureSlate() {
  const baseline = buildAiHrWalkForwardBaseline(backtestLog, date)
  return {
    baseline,
    slate: buildAiHrHistoricalSlate({ date, baselineRows: baseline.rows, schedule, boxscores }),
  }
}

function signal(overrides = {}) {
  return {
    entityKey: 'batter:7:101',
    kind: 'lineup-status',
    direction: 'boost',
    severity: 'info',
    confidence: 0.8,
    note: 'The batter was confirmed in the pregame lineup.',
    evidence: [{
      url: 'https://example.com/pregame-lineup',
      title: 'Pregame lineup',
      publishedAt: '2026-06-21T15:30:00.000Z',
    }],
    ...overrides,
  }
}

test('historical dates require exact player and game identity', () => {
  const dates = selectAiHrHistoricalDates({
    records: {
      '2026-06-19': [{ playerId: 1, score: 50 }],
      [date]: targetRows,
    },
  })
  assert.deepEqual(dates, [date])
})

test('walk-forward baseline trains strictly before target and strips outcomes', () => {
  const baseline = buildAiHrWalkForwardBaseline(backtestLog, date)
  assert.deepEqual(baseline.audit.trainingDates, ['2026-06-19'])
  assert.equal(baseline.audit.latestTrainingDate, '2026-06-19')
  assert.equal(baseline.audit.outcomeFieldsCopied, false)
  assert.equal(baseline.rows.length, 2)
  assert.ok(baseline.rows.every((row) => row.hrProbability > 0 && row.hrProbability < 1))
  assert.ok(baseline.rows.every((row) => !Object.hasOwn(row, 'homered') && !Object.hasOwn(row, 'actuallyPlayed')))
  assert.ok(baseline.rows.every((row) => !Object.hasOwn(row, 'postgameSecret')))
})

test('historical slate uses boxscore identity but never copies boxscore statistics', () => {
  const { slate } = fixtureSlate()
  assert.equal(slate.games.length, 1)
  assert.equal(slate.scoredBatters['7-101'].team, 'AWY')
  assert.equal(slate.scoredBatters['8-101'].team, 'HME')
  assert.equal(slate.scoredBatters['7-101'].isHome, false)
  assert.equal(JSON.stringify(slate).includes('homeRuns'), false)
})

test('historical research prompt cannot contain reconcile outcomes or hidden fields', () => {
  const { slate } = fixtureSlate()
  const prompt = buildAiHrHistoricalPrompt(slate, asOf)
  assert.ok(prompt.includes(asOf))
  assert.ok(prompt.includes('batter:7:101'))
  assert.equal(prompt.includes('postgameSecret'), false)
  assert.equal(prompt.includes('actuallyPlayed'), false)
  assert.equal(prompt.includes('homered'), false)
  assert.equal(prompt.includes('homeRuns'), false)
})

test('historical normalizer rejects the entire signal on missing or future evidence time', () => {
  const { slate } = fixtureSlate()
  const context = normalizeAiHrHistoricalContext({
    raw: { signals: [
      signal(),
      signal({ note: 'Missing source time.', evidence: [{ url: 'https://example.com/no-time', title: 'No time', publishedAt: null }] }),
      signal({ note: 'Published too late.', evidence: [{ url: 'https://example.com/late', title: 'Late', publishedAt: '2026-06-21T16:01:00.000Z' }] }),
      signal({ note: 'Mixed evidence.', evidence: [signal().evidence[0], { url: 'https://example.com/mixed-late', title: 'Late', publishedAt: '2026-06-21T16:01:00.000Z' }] }),
    ] },
    slate,
    asOf,
    model: 'test-history-model',
  })
  assert.equal(context.stats.requested, 4)
  assert.equal(context.stats.accepted, 1)
  assert.equal(context.stats.rejected, 3)
  assert.equal(context.replay.timeRejected, 3)
  assert.equal(context.signals[0].observedAt, '2026-06-21T15:30:00.000Z')
})

test('historical replay settles only after research and remains non-production', () => {
  const { slate, baseline } = fixtureSlate()
  const context = normalizeAiHrHistoricalContext({
    raw: { signals: [signal()] },
    slate,
    asOf,
    model: 'test-history-model',
  })
  const replay = buildAiHrHistoricalReplay({
    runs: [{ date, slate, baselineAudit: baseline.audit, asOf, context }],
    backtestLog,
    generatedAt: '2026-06-22T12:00:00.000Z',
  })
  assert.equal(replay.scoreImpact, false)
  assert.equal(replay.autoPromotion, false)
  assert.equal(replay.baseline.outcomesExposedToResearchPrompt, false)
  assert.equal(replay.evaluation.coverage.settledRecords, 1)
  assert.equal(replay.evaluation.gate.status, 'collecting')
  assert.equal(validateAiHrHistoricalReplay(replay).ok, true)

  replay.contexts[0].signals[0].evidence[0].publishedAt = '2026-06-21T16:01:00.000Z'
  const tampered = validateAiHrHistoricalReplay(replay)
  assert.equal(tampered.ok, false)
  assert.ok(tampered.errors.some((error) => error.includes('historical cutoff')))
})

test('validator rejects a target date included in its own training window', () => {
  const { slate, baseline } = fixtureSlate()
  const context = normalizeAiHrHistoricalContext({ raw: { signals: [] }, slate, asOf, model: 'test-history-model' })
  const replay = buildAiHrHistoricalReplay({
    runs: [{ date, slate, baselineAudit: baseline.audit, asOf, context }],
    backtestLog,
    generatedAt: '2026-06-22T12:00:00.000Z',
  })
  replay.dates[0].latestTrainingDate = date
  assert.equal(validateAiHrHistoricalReplay(replay).ok, false)
})
