import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBrowserHistory, compactHistoryRecord } from '../server/build-browser-history.mjs'

test('browser history keeps UI evidence but drops server-only record payload', () => {
  const compact = compactHistoryRecord({
    playerId: 1, gamePk: 2, name: 'Test Hitter', score: 91, grade: 'PRIME',
    homered: true, feat: { brl: 14 }, pitchTypes: ['FF'], featureCapture: { large: true },
  })
  assert.deepEqual(compact, {
    playerId: 1, gamePk: 2, name: 'Test Hitter', score: 91, grade: 'PRIME',
    homered: true, feat: { brl: 14 },
  })
})

test('browser history exposes only bounded operational windows', () => {
  const records = {}
  for (let day = 0; day < 35; day += 1) {
    const date = new Date(Date.UTC(2026, 4, 27 + day)).toISOString().slice(0, 10)
    records[date] = [{ playerId: day, score: day, homered: false }]
  }
  const artifact = buildBrowserHistory({
    records,
    settledDates: Object.keys(records),
    modelHistory: { records: { '2025-01-01': [{ huge: true }] } },
    gameForecasts: { resultsByDate: { '2026-06-30': [{ call: 'LEAN' }] }, callsByDate: { huge: true } },
  })
  assert.equal(artifact.dates.length, 30)
  assert.equal(artifact.dates[0], '2026-06-01')
  assert.equal(artifact.modelHistory, undefined)
  assert.equal(artifact.gameForecasts.callsByDate, undefined)
  assert.equal(artifact.gameForecasts.resultsByDate['2026-06-30'][0].call, 'LEAN')
})
