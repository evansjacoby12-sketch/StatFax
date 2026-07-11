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
  // Hot but middling matchup → BARREL yes, POWER no (matchup 40 < 60)
  const hotSoftMatchup = { ceilScore: 76, formScore: 70, matchupScore: 40, recentBarrel: { recentBBE: 20 } }
  assert.equal(barrelReadySignal(hotSoftMatchup), true)
  assert.equal(powerReadySignal(hotSoftMatchup), false)
  // Great matchup but lukewarm form → POWER yes, BARREL no (form 45 < 60)
  const coolGoodMatchup = { ceilScore: 80, formScore: 45, matchupScore: 65, recentBarrel: { recentBBE: 20 } }
  assert.equal(powerReadySignal(coolGoodMatchup), true)
  assert.equal(barrelReadySignal(coolGoodMatchup), false)
})

test('barrelReady criteria breakdown is null-safe and labeled', () => {
  const crit = barrelReadyCriteria(ready())
  assert.deepEqual(crit.map((c) => c.key), ['ceiling', 'form', 'sample'])
  assert.ok(crit.every((c) => c.met))
  assert.equal(barrelReadySignal(null), false)
})

test('barrelReady is a beta combo strategy, off by default', () => {
  const s = STRATEGIES.find((x) => x.key === 'barrelReady')
  assert.equal(s?.beta, true)
  // Non-signal high-score bats (other strategies anchor these) + signal bats with
  // lower score but high hrProb, so barrelReady picks a DISTINCT (non-deduped) set.
  const bat = (id, { br = false, score = 90, prob = 0.15 } = {}) => ({ playerId: id, gamePk: 100 + id, name: `P${id}`, grade: 'PRIME', benched: false, paWeight: 1, barrelReady: br, hrProb: prob, score, heat: 70, barrel: 15, hot: true })
  const rows = [
    ...[1, 2, 3, 4].map((i) => bat(i, { br: false, score: 92, prob: 0.15 })),
    ...[5, 6, 7, 8, 9, 10].map((i) => bat(i, { br: true, score: 72, prob: 0.28 - (i - 5) * 0.01 })),
  ]
  assert.equal(buildCombos(rows, { includeBeta: false }).filter((c) => c.strategy === 'barrelReady').length, 0)
  const on = buildCombos(rows, { includeBeta: true }).filter((c) => c.strategy === 'barrelReady')
  assert.ok(on.length > 0)
  assert.ok(on.every((c) => c.legs.every((l) => l.barrelReady === true)))
})
