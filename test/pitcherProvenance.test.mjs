import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PREGAME_FREEZE_PITCHER_PROVENANCE,
  restoreFrozenLiveRow,
} from '../server/lib/pitcherProvenance.mjs'

test('live freeze retains prediction pitcher and exposes a corrected current starter', () => {
  const row = {
    score: 44,
    pitcher: { id: 60, name: 'Corrected Starter' },
    liveContext: { inning: 2 },
  }
  const snapshot = {
    score: 72,
    pitcher: { id: 55, name: 'Prediction Starter' },
  }

  assert.deepEqual(restoreFrozenLiveRow(row, snapshot), { pitcherChanged: true })
  assert.equal(row.score, 72)
  assert.equal(row.pitcher.id, 55)
  assert.equal(row.currentPitcher.id, 60)
  assert.equal(row.pitcherChanged, true)
  assert.equal(row.pitcherProvenance, PREGAME_FREEZE_PITCHER_PROVENANCE)
  assert.deepEqual(row.liveContext, { inning: 2 })
})

test('live freeze adds no correction provenance when the starter is unchanged', () => {
  const row = {
    pitcher: { id: 60, name: 'Starter' },
    liveContext: { inning: 1 },
  }
  const snapshot = {
    score: 70,
    pitcher: { id: 60, name: 'Starter' },
  }

  assert.deepEqual(restoreFrozenLiveRow(row, snapshot), { pitcherChanged: false })
  assert.equal(row.currentPitcher, undefined)
  assert.equal(row.pitcherProvenance, undefined)
  assert.deepEqual(row.liveContext, { inning: 1 })
})
