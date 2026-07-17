import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyWeatherGame, isFavorableWeatherGame, airSortValue, roofStatusForGame } from '../ui/src/lib/weatherDecision.js'

const game = ({ parkHR = 1, envFactor = null, verdict = 'CROSS', windOutMph = 0, windSpeedMph = 5, windDirDeg = 180, precipProbPct = 0 } = {}) => ({
  parkHR,
  envFactor,
  closed: false,
  stadium: { type: 'Open' },
  weather: { windSpeedMph, windDirDeg, precipProbPct },
  wind: { verdict, windOutMph },
})

test('supported mild out wind offsets a suppressive park instead of reading neutral', () => {
  const state = classifyWeatherGame(game({ parkHR: 0.915, envFactor: 1.02, verdict: 'OUT', windOutMph: 3 }))
  assert.equal(state.key, 'offset')
  assert.equal(state.label, 'Mixed signals')
})

test('unmapped strong out wind becomes a directional wind boost', () => {
  const g = game({ parkHR: 1.014, verdict: 'OUT', windOutMph: 8.5, windSpeedMph: 10 })
  assert.equal(classifyWeatherGame(g).key, 'wind-boost')
  assert.equal(isFavorableWeatherGame(g), true)
})

test('out wind opposing a strongly suppressive unmapped park is offsetting', () => {
  assert.equal(classifyWeatherGame(game({ parkHR: 0.9, verdict: 'OUT', windOutMph: 7 })).key, 'offset')
})

test('suppressive park plus in wind is suppressed', () => {
  assert.equal(classifyWeatherGame(game({ parkHR: 0.907, verdict: 'IN', windOutMph: -4 })).key, 'suppressed')
})

test('unmapped crosswind is unrated rather than falsely neutral', () => {
  assert.equal(classifyWeatherGame(game({ parkHR: 0.999, verdict: 'CROSS', windOutMph: 0.2 })).key, 'unrated')
})

test('mapped near-neutral interaction remains truly neutral', () => {
  assert.equal(classifyWeatherGame(game({ parkHR: 1.01, envFactor: 1.01, verdict: 'CROSS', windOutMph: 0.2 })).key, 'neutral')
})

test('rain and roof states take precedence', () => {
  assert.equal(classifyWeatherGame(game({ precipProbPct: 65 })).key, 'rain')
  const closed = classifyWeatherGame({ ...game(), stadium: { type: 'Fixed Dome' } })
  assert.equal(closed.key, 'dome')
  assert.equal(closed.label, 'Dome game · Closed')
})

test('retractable roofs show confirmed open, closed, and pending states honestly', () => {
  const retractable = { ...game({ parkHR: 1.05, verdict: 'OUT', windOutMph: 5 }), stadium: { type: 'Retractable' } }

  const openGame = { ...retractable, weather: { ...retractable.weather, roofClosed: false } }
  const open = classifyWeatherGame(openGame)
  assert.equal(roofStatusForGame(openGame), 'open')
  assert.equal(open.label, 'Dome game · Open')
  assert.equal(open.key, 'favorable')
  assert.equal(open.favorable, true)

  const closed = classifyWeatherGame({ ...retractable, weather: { ...retractable.weather, roofClosed: true } })
  assert.equal(closed.label, 'Dome game · Closed')
  assert.equal(closed.key, 'dome')

  const pending = classifyWeatherGame(retractable)
  assert.equal(pending.label, 'Dome game · Pending')
  assert.equal(pending.key, 'roof-pending')
  assert.equal(pending.favorable, false)
  assert.ok(airSortValue(retractable) < airSortValue(game()))
})

test('uncovered parks get a directional air sort value instead of zero coverage penalty', () => {
  assert.ok(airSortValue(game({ envFactor: null, windOutMph: 8 })) > airSortValue(game({ envFactor: null, windOutMph: -3 })))
})
