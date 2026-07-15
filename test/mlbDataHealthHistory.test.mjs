import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeAiHrContext } from '../server/lib/aiHrContext.mjs'
import { applyMlbDataHealth } from '../server/lib/mlbDataHealth.mjs'
import {
  captureMlbDataHealthHistory,
  parseMlbOfficialFacts,
  settleMlbDataHealthHistory,
  validateMlbDataHealthHistory,
} from '../server/lib/mlbDataHealthHistory.mjs'

const date = '2026-07-15'
const capturedAt = '2026-07-15T19:00:00.000Z'
const settledAt = '2026-07-16T05:00:00.000Z'
const evidence = [{ url: 'https://www.mlb.com/gameday/101', title: 'Official update', publishedAt: '2026-07-15T18:00:00.000Z' }]

function slateFixture() {
  const scoredBatters = {}
  for (let index = 0; index < 6; index++) {
    const away = index < 3
    const playerId = 7 + index
    scoredBatters[`${playerId}-101`] = {
      playerId, gamePk: 101, name: `Batter ${playerId}`, teamId: away ? 1 : 2, isHome: !away,
      score: 60, grade: { label: 'STRONG' }, hrProbability: 0.1,
      pitcher: away ? { id: 60, name: 'Listed Home Arm' } : { id: 50, name: 'Away Arm' },
    }
  }
  return {
    version: 5,
    date,
    generatedAt: '2026-07-15T18:55:00.000Z',
    finishedAt: '2026-07-15T18:56:00.000Z',
    games: [{
      gamePk: 101, gameDate: '2026-07-15T23:05:00.000Z', status: 'Pre-Game', isLive: false, isFinal: false,
      venueName: 'Test Park', awayTeam: { id: 1, abbr: 'NYY' }, homeTeam: { id: 2, abbr: 'BOS' },
      awayPitcher: { id: 50, name: 'Away Arm' }, homePitcher: { id: 60, name: 'Listed Home Arm' },
    }],
    weatherByGame: { 101: { tempF: 78 } },
    scoredBatters,
    stats: { scoredBatters: 6 },
    _qaFlags: { gamesMissingStadium: [], insaneHrRate: [], nanFallbacks: 0 },
  }
}

function candidate(entityKey, kind, note) {
  return {
    entityKey, kind, direction: 'uncertain', severity: 'warn', confidence: 0.85,
    note, evidence,
  }
}

function capturedHistory() {
  const slate = slateFixture()
  const context = normalizeAiHrContext({
    raw: { signals: [
      candidate('pitcher:60:101', 'starter-change', 'A different home starter may be used.'),
      candidate('batter:7:101', 'lineup-status', 'Batter 7 may not start.'),
      candidate('batter:8:101', 'scratch-risk', 'Batter 8 may be scratched.'),
      candidate('game:101', 'roof', 'Roof status is pending.'),
    ] },
    slate,
    generatedAt: capturedAt,
    model: 'test-model',
    source: 'tavily+openai',
  })
  const health = applyMlbDataHealth({ slate, context, generatedAt: capturedAt })
  const history = captureMlbDataHealthHistory({ previous: null, slate: health.slate, report: health.report, context, updatedAt: capturedAt })
  return { slate: health.slate, report: health.report, context, history }
}

function finalFacts() {
  const schedule = { dates: [{ games: [{ gamePk: 101, status: { abstractGameState: 'Final', detailedState: 'Final', codedGameState: 'F' } }] }] }
  const boxscoresByGame = {
    101: {
      teams: {
        away: {
          pitchers: [50],
          players: {
            ID50: { person: { id: 50 }, stats: { pitching: { gamesStarted: 1, numberOfPitches: 88, inningsPitched: '5.2' } } },
            ID7: { person: { id: 7 }, battingOrder: '100', stats: { batting: { plateAppearances: 4 } } },
          },
        },
        home: {
          pitchers: [61],
          players: {
            ID61: { person: { id: 61 }, stats: { pitching: { gamesStarted: 1, numberOfPitches: 42, inningsPitched: '3.0' } } },
          },
        },
      },
    },
  }
  return parseMlbOfficialFacts({ date, schedule, boxscoresByGame, fetchedAt: settledAt })
}

test('watchdog history preserves sourced alerts across repeat intraday captures', () => {
  const first = capturedHistory()
  const second = captureMlbDataHealthHistory({
    previous: first.history,
    slate: first.slate,
    report: first.report,
    context: first.context,
    updatedAt: '2026-07-15T20:00:00.000Z',
  })
  assert.equal(first.history.recordsByDate[date].alerts.length, 4)
  assert.equal(second.recordsByDate[date].alerts.length, 4)
  assert.equal(second.metrics.pending, 4)
  assert.equal(validateMlbDataHealthHistory(second).ok, true)
})

test('objective MLB facts settle measurable alerts and leave unsupported claims unverifiable', () => {
  const { history } = capturedHistory()
  const settled = settleMlbDataHealthHistory({ history, factsByDate: { [date]: finalFacts() }, updatedAt: settledAt })
  const alerts = settled.recordsByDate[date].alerts
  const byKind = Object.fromEntries(alerts.map((alert) => [alert.kind, alert]))

  assert.equal(byKind['starter-change'].outcome, 'confirmed')
  assert.equal(byKind['lineup-status'].outcome, 'not-confirmed')
  assert.equal(byKind['scratch-risk'].outcome, 'confirmed')
  assert.equal(byKind.roof.outcome, 'unverifiable')
  assert.deepEqual(byKind['starter-change'].settlement.observed.actualStarterIds, [50, 61])
  assert.equal(settled.metrics.settled, 3)
  assert.equal(settled.metrics.confirmed, 2)
  assert.equal(settled.metrics.confirmationRate, 0.6667)
  assert.equal(validateMlbDataHealthHistory(settled).ok, true)
})

test('a final schedule without an available box score does not falsely settle alerts', () => {
  const { history } = capturedHistory()
  const incomplete = finalFacts()
  incomplete.games[101].boxscoreAvailable = false
  const result = settleMlbDataHealthHistory({ history, factsByDate: { [date]: incomplete }, updatedAt: settledAt })
  assert.equal(result.metrics.pending, 4)
  assert.equal(result.metrics.settled, 0)
})

test('history validator rejects stripped evidence and inconsistent aggregate metrics', () => {
  const { history } = capturedHistory()
  history.recordsByDate[date].alerts[0].evidence = []
  history.metrics.alerts = 999
  const validation = validateMlbDataHealthHistory(history)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes('evidence')))
  assert.ok(validation.errors.some((error) => error.includes('metrics')))
})

test('deploy restores, settles, validates, and publishes watchdog history after the current report', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const restoreAt = workflow.indexOf('- name: Restore MLB data health history')
  const currentAt = workflow.indexOf('- name: Validate MLB data health watchdog')
  const captureAt = workflow.indexOf('- name: Capture and settle MLB data health history')
  const validateAt = workflow.indexOf('- name: Validate MLB data health history')
  const publishAt = workflow.indexOf('- name: Publish production slate and AI HR artifacts to R2')
  assert.ok(restoreAt > 0 && currentAt < captureAt && captureAt < validateAt && validateAt < publishAt)
  assert.match(workflow.slice(publishAt), /mlb-data-health-history\.json/)
})
