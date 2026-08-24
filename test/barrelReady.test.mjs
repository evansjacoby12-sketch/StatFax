import { test } from 'node:test'
import assert from 'node:assert/strict'
import { barrelReadySignal, barrelReadyCriteria, powerReadySignal } from '../ui/src/lib/powerReady.js'
import { buildCombos, STRATEGIES } from '../ui/src/lib/combo-engine.js'

// Solid power + hot form + a real recent sample, NO matchup requirement.
const ready = (over = {}) => ({
  ceilScore: 72, formScore: 65, matchupScore: 40,
  recentBarrel: { recentBBE: 20 }, ...over,
})

test('barrelReady needs ceiling ≥70, form ≥60, and a recent sample — but NOT matchup', () => {
  assert.equal(barrelReadySignal(ready()), true)
  assert.equal(barrelReadySignal(ready({ matchupScore: 20 })), true)     // matchup irrelevant
  assert.equal(barrelReadySignal(ready({ ceilScore: 69 })), false)       // power too low
  assert.equal(barrelReadySignal(ready({ formScore: 59 })), false)       // form not hot enough
  assert.equal(barrelReadySignal(ready({ recentBarrel: { recentBBE: 5 } })), false) // sample too thin
})

test('barrelReady and powerReady are distinct signals', () => {
  // Hot but middling matchup → BARREL yes, POWER no (matchup 40 < 70)
  const hotSoftMatchup = { ceilScore: 76, formScore: 70, matchupScore: 40, recentBarrel: { recentBBE: 20 } }
  assert.equal(barrelReadySignal(hotSoftMatchup), true)
  assert.equal(powerReadySignal(hotSoftMatchup), false)
  // Under graduated gates, powerReady is a subset of barrelReady, so we test that
  // a batter satisfying both triggers both signals.
  const goodMatchupAndForm = { ceilScore: 80, formScore: 60, matchupScore: 75, recentBarrel: { recentBBE: 20 } }
  assert.equal(powerReadySignal(goodMatchupAndForm), true)
  assert.equal(barrelReadySignal(goodMatchupAndForm), true)
})

test('barrelReady criteria breakdown is null-safe and labeled', () => {
  const crit = barrelReadyCriteria(ready())
  assert.deepEqual(crit.map((c) => c.key), ['ceiling', 'form', 'sample'])
  assert.ok(crit.every((c) => c.met))
  assert.equal(barrelReadySignal(null), false)
})


