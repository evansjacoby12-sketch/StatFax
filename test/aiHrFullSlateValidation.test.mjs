import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildAiHrHistoricalReplay,
  buildAiHrHistoricalSlate,
  buildAiHrWalkForwardBaseline,
  normalizeAiHrHistoricalContext,
} from '../server/lib/aiHrHistorical.mjs'
import {
  buildAiHrFullSlateValidation,
  validateAiHrFullSlateValidation,
} from '../server/lib/aiHrFullSlateValidation.mjs'
import { aiHrProductionHypothesis } from '../server/lib/aiHrProduction.mjs'

const targetDate = '2026-06-21'
const asOf = '2026-06-21T16:00:00.000Z'

function fixtureReplay() {
  const prior = Array.from({ length: 120 }, (_, index) => ({
    playerId: 1_000 + index,
    score: index % 100,
    simHRProb: 0.05,
    homered: index % 20 === 0,
    actuallyPlayed: true,
  }))
  const target = [
    { playerId: 7, gamePk: 101, name: 'Replay Bat', score: 82, grade: 'PRIME', simHRProb: 0.16, homered: true, actuallyPlayed: true },
    { playerId: 8, gamePk: 101, name: 'Other Bat', score: 61, grade: 'STRONG', simHRProb: 0.09, homered: false, actuallyPlayed: true },
  ]
  const backtestLog = {
    records: { '2026-06-20': prior, [targetDate]: target },
  }
  const baseline = buildAiHrWalkForwardBaseline(backtestLog, targetDate)
  const slate = buildAiHrHistoricalSlate({
    date: targetDate,
    baselineRows: baseline.rows,
    schedule: { dates: [{ games: [{
      gamePk: 101,
      gameDate: '2026-06-21T17:00:00.000Z',
      venue: { name: 'Replay Park' },
      teams: {
        away: { team: { id: 1, name: 'Away', abbreviation: 'AWY' } },
        home: { team: { id: 2, name: 'Home', abbreviation: 'HME' } },
      },
    }] }] },
    boxscores: new Map([[101, { teams: {
      away: { players: { ID7: { person: { id: 7 } } } },
      home: { players: { ID8: { person: { id: 8 } } } },
    } }]]),
  })
  const context = normalizeAiHrHistoricalContext({
    raw: { signals: [{
      entityKey: 'batter:7:101', kind: 'scratch-risk', direction: 'suppress', severity: 'warn', confidence: 0.8,
      note: 'Pregame concern was reported.',
      evidence: [{ url: 'https://example.com/pregame', title: 'Pregame', publishedAt: '2026-06-21T15:30:00.000Z' }],
    }] },
    slate,
    asOf,
    model: 'test-model',
  })
  return buildAiHrHistoricalReplay({
    runs: [{ date: targetDate, slate, baselineAudit: baseline.audit, asOf, context }],
    backtestLog,
    generatedAt: '2026-06-22T12:00:00.000Z',
  })
}

test('full-slate report proves identity coverage and exact production hypothesis', () => {
  const replay = fixtureReplay()
  const report = buildAiHrFullSlateValidation({
    replay,
    generatedAt: replay.generatedAt,
    requirements: { minGamesPerSlate: 1, minRowsPerSlate: 2, minIdentityCoverage: 1, minFullSlateDates: 1 },
  })
  assert.equal(report.coverage.fullSlateDates, 1)
  assert.equal(report.coverage.identityCoverage, 1)
  assert.equal(report.coverage.settledAdjustedRows, 1)
  assert.deepEqual({ ...report.productionHypothesis, version: undefined }, { version: undefined, ...aiHrProductionHypothesis() })
  assert.equal(report.decision.status, 'collecting-adjusted-outcomes')
  assert.equal(report.decision.productionChanged, false)
  assert.equal(validateAiHrFullSlateValidation(report, replay).ok, true)
})

test('full-slate validator rejects hypothesis and coverage tampering', () => {
  const replay = fixtureReplay()
  const report = buildAiHrFullSlateValidation({ replay, generatedAt: replay.generatedAt })
  report.productionHypothesis.perSignalLogit += 0.01
  report.coverage.fullSlateDates += 1
  report.decision.status = 'promising'
  const validation = validateAiHrFullSlateValidation(report, replay)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes('productionHypothesis')))
  assert.ok(validation.errors.some((error) => error.includes('coverage.fullSlateDates')))
  assert.ok(validation.errors.some((error) => error.includes('decision does not reconcile')))
})
