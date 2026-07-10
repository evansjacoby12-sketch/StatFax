import test from 'node:test'
import assert from 'node:assert/strict'
import { powerReadySignal } from '../ui/src/lib/powerReady.js'

const ready = (overrides = {}) => ({
  ceilScore: 78,
  formScore: 62,
  matchupScore: 71,
  recentBarrel: { recentBBE: 9 },
  ...overrides,
})

test('powerReady requires ceiling, matchup, form, and a recent sample', () => {
  assert.equal(powerReadySignal(ready()), true)
  assert.equal(powerReadySignal(ready({ ceilScore: 74 })), false)
  assert.equal(powerReadySignal(ready({ formScore: 34 })), false)
  assert.equal(powerReadySignal(ready({ matchupScore: 59 })), false)
  assert.equal(powerReadySignal(ready({ recentBarrel: { recentBBE: 5 } })), false)
})

test('powerReady accepts a qualified recent swing sample when BBE is sparse', () => {
  assert.equal(powerReadySignal(ready({ recentBarrel: null, batTracking: { recentSwings: 25 } })), true)
  assert.equal(powerReadySignal(ready({ recentBarrel: null, batTracking: { recentSwings: 24 } })), false)
})

test('powerReady is null-safe', () => {
  assert.equal(powerReadySignal(null), false)
  assert.equal(powerReadySignal({}), false)
})
