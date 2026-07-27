import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parkRunFactorForVenue } from '../src/sports/mlb/data/parkRunFactors.js'
import { buildGameRunEnvironment } from '../src/sports/mlb/logic/gameRunEnvironment.js'

test('official Statcast run factors resolve canonical and alternate venue names', () => {
  assert.equal(parkRunFactorForVenue('Coors Field').factor, 1.28)
  assert.equal(parkRunFactorForVenue('Oriole Park at Camden Yards').factor, 1.06)
  assert.equal(parkRunFactorForVenue('UNIQLO Field at Dodger Stadium').factor, 1.02)
  assert.equal(parkRunFactorForVenue('Unknown Park'), null)
})

test('run environment distinguishes run-friendly and suppressive parks', () => {
  const weather = { tempF: 72, windSpeedMph: 0, windDirDeg: 0 }
  const coors = buildGameRunEnvironment({
    weather,
    stadium: { name: 'Coors Field', type: 'Open', bearing: 0 },
  })
  const seattle = buildGameRunEnvironment({
    weather,
    stadium: { name: 'T-Mobile Park', type: 'Open', bearing: 0 },
  })

  assert.ok(coors.factor > 1)
  assert.ok(seattle.factor < 1)
  assert.ok(coors.factor > seattle.factor)
  assert.equal(coors.parkSource, 'Baseball Savant Statcast Park Factors')
})

test('warm outfield wind raises runs while cold headwind suppresses them', () => {
  const stadium = { name: 'Truist Park', type: 'Open', bearing: 0 }
  const warmOut = buildGameRunEnvironment({
    weather: { tempF: 90, windSpeedMph: 15, windDirDeg: 180 },
    stadium,
  })
  const coldIn = buildGameRunEnvironment({
    weather: { tempF: 50, windSpeedMph: 15, windDirDeg: 0 },
    stadium,
  })

  assert.ok(warmOut.weatherFactor > 1)
  assert.ok(coldIn.weatherFactor < 1)
  assert.ok(warmOut.factor > coldIn.factor)
  assert.equal(warmOut.coverage, 1)
})

test('closed roofs neutralize weather and pending roofs do not assume outdoor conditions', () => {
  const stadium = { name: 'Chase Field', type: 'Retractable', bearing: 0 }
  const closed = buildGameRunEnvironment({
    weather: { tempF: 105, windSpeedMph: 20, windDirDeg: 180, roofClosed: true },
    stadium,
  })
  const pending = buildGameRunEnvironment({
    weather: { tempF: 105, windSpeedMph: 20, windDirDeg: 180 },
    stadium,
  })

  assert.equal(closed.weatherFactor, 1)
  assert.equal(closed.weatherStatus, 'indoor')
  assert.equal(closed.coverage, 1)
  assert.equal(pending.weatherFactor, 1)
  assert.equal(pending.weatherStatus, 'roof-pending')
  assert.equal(pending.coverage, 0.6)
})
