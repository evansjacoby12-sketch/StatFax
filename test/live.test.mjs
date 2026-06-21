import { test } from 'node:test'
import assert from 'node:assert/strict'
import { legStatus, comboStatus } from '../ui/src/lib/live.js'

const leg = ({ homered, isHR, final, live, abLeft } = {}) => ({
  homeredThisGame: homered,
  liveContext: isHR != null || abLeft != null ? { isHRThisGame: isHR, expectedRemainingABs: abLeft } : undefined,
  game: { isFinal: !!final, isLive: !!live },
})

test('legStatus: homeredThisGame persists after a game finalizes', () => {
  assert.equal(legStatus(leg({ homered: true, final: true })).code, 'hit')
})
test('legStatus: live in-game HR', () => {
  assert.equal(legStatus(leg({ isHR: true, live: true })).code, 'hit')
})
test('legStatus: final without HR is dead', () => {
  assert.equal(legStatus(leg({ final: true })).code, 'dead')
})
test('legStatus: live no HR yet shows AB left', () => {
  const s = legStatus(leg({ live: true, abLeft: 2 }))
  assert.equal(s.code, 'live')
  assert.match(s.label, /2 AB/)
})
test('legStatus: pregame is pending', () => {
  assert.equal(legStatus(leg({})).code, 'pending')
})

test('comboStatus: all legs homered → cashed', () => {
  const v = comboStatus([leg({ homered: true, final: true }), leg({ isHR: true, live: true })])
  assert.equal(v.code, 'cashed')
  assert.equal(v.hits, 2)
})
test('comboStatus: a finished no-HR leg kills it → dead', () => {
  const v = comboStatus([leg({ homered: true, final: true }), leg({ final: true })])
  assert.equal(v.code, 'dead')
  assert.equal(v.hits, 1)
})
test('comboStatus: in progress, still alive → live', () => {
  const v = comboStatus([leg({ isHR: true, live: true }), leg({ live: true, abLeft: 1 })])
  assert.equal(v.code, 'live')
  assert.equal(v.started, true)
})
test('comboStatus: nothing started → pending', () => {
  const v = comboStatus([leg({}), leg({})])
  assert.equal(v.code, 'pending')
  assert.equal(v.started, false)
})
