import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyWeatherGame, isFavorableWeatherGame, airSortValue } from '../ui/src/lib/weatherDecision.js'

const game = ({ parkHR = 1, envFactor = null, verdict = 'CROSS', windOutMph = 0, windSpeedMph = 5, windDirDeg = 180, precipProbPct = 0 } = {}) => ({
  parkHR,
  envFactor,
  closed: false,
  stadium: { type: 'Open' },
  weather: { windSpeedMph, windDirDeg, precipProbPct },
  wind: { verdict, windOutMph },
})

test('supported mild out wind offsets a suppressive park instead of reading neutral', () => {
  assert.equal(classifyWeatherGame(game({ parkHR: 0.915, envFactor: 1.02, verdict: 'OUT', windOutMph: 3 })).key, 'offset')
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
  assert.equal(classifyWeatherGame({ ...game(), closed: true, stadium: { type: 'Fixed Dome' } }).key, 'dome')
})

test('uncovered parks get a directional air sort value instead of zero coverage penalty', () => {
  assert.ok(airSortValue(game({ envFactor: null, windOutMph: 8 })) > airSortValue(game({ envFactor: null, windOutMph: -3 })))
})
