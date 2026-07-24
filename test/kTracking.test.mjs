import { test } from 'node:test'
import assert from 'node:assert/strict'

import { mergeKEstimateRows } from '../src/sports/mlb/logic/kTracking.js'

const base = {
  key: '42-777',
  pitcherId: 42,
  gamePk: 777,
  name: 'Test Starter',
  lineupMode: 'projected',
  estK: 5.1,
}

test('K tracker refreshes estimates while the individual game remains pregame', () => {
  const next = mergeKEstimateRows(
    [{ ...base, estK: 4.8, capturedAt: 'early' }],
    [{ ...base, estK: 5.4, lineupMode: 'confirmed' }],
    [{ gamePk: 777, isLive: false, isFinal: false, status: 'Scheduled' }],
    { capturedAt: 'latest' },
  )
  assert.equal(next.length, 1)
  assert.equal(next[0].estK, 5.4)
  assert.equal(next[0].capturedAt, 'latest')
  assert.equal(next[0].freezeState, 'confirmed-live')
  assert.equal(next[0].finalPregame, false)
})

test('K tracker freezes the last pregame estimate when that game starts', () => {
  const prior = [{ ...base, estK: 5.4, capturedAt: 'latest', freezeState: 'confirmed-live' }]
  const next = mergeKEstimateRows(
    prior,
    [{ ...base, estK: 6.2, lineupMode: 'confirmed' }],
    [{ gamePk: 777, isLive: true, isFinal: false, status: 'In Progress' }],
    { capturedAt: 'after-first-pitch' },
  )
  assert.equal(next[0].estK, 5.4)
  assert.equal(next[0].capturedAt, 'latest')
  assert.equal(next[0].frozenAt, 'after-first-pitch')
  assert.equal(next[0].freezeState, 'final-pregame')
  assert.equal(next[0].finalPregame, true)
})

test('K tracker drops a stale probable pitcher before first pitch and keeps doubleheaders separate', () => {
  const prior = [
    { ...base, key: '42-777', gamePk: 777 },
    { ...base, key: '42-778', gamePk: 778 },
  ]
  const current = [{ ...base, key: '99-777', pitcherId: 99, gamePk: 777 }]
  const next = mergeKEstimateRows(prior, current, [
    { gamePk: 777, isLive: false, isFinal: false, status: 'Scheduled' },
    { gamePk: 778, isLive: true, isFinal: false, status: 'In Progress' },
  ])
  assert.deepEqual(next.map((row) => row.key), ['99-777', '42-778'])
  assert.equal(next[1].finalPregame, true)
})

test('K tracker never promotes an after-first-pitch capture into the actionable sample', () => {
  const first = mergeKEstimateRows(
    [],
    [base],
    [{ gamePk: 777, isLive: true, isFinal: false, status: 'In Progress' }],
    { capturedAt: 'late' },
  )
  const second = mergeKEstimateRows(
    first,
    [{ ...base, estK: 6.8 }],
    [{ gamePk: 777, isLive: true, isFinal: false, status: 'In Progress' }],
    { capturedAt: 'later' },
  )
  assert.equal(second[0].lateCapture, true)
  assert.equal(second[0].finalPregame, false)
  assert.equal(second[0].freezeState, 'late-capture')
  assert.equal(second[0].estK, 5.1)
})
