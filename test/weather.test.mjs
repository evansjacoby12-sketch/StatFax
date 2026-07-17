import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildOpenMeteoForecast } from '../server/weather.mjs'

test('international weather is normalized to the MLB seven-hour contract', () => {
  const start = Date.parse('2026-07-17T22:00:00.000Z') / 1000
  const time = Array.from({ length: 9 }, (_, index) => start + index * 3600)
  const series = (base) => time.map((_, index) => base + index)
  const payload = {
    timezone: 'UTC',
    hourly: {
      time,
      temperature_2m: series(70),
      relative_humidity_2m: series(40),
      precipitation_probability: series(5),
      cloud_cover: series(20),
      surface_pressure: series(1000),
      wind_speed_10m: series(3),
      wind_direction_10m: series(180),
      wind_gusts_10m: series(7),
    },
  }

  const weather = buildOpenMeteoForecast(
    payload,
    '2026-07-17T23:15:00.000Z',
    '2026-07-17T12:00:00.000Z',
  )

  assert.equal(weather.source, 'open-meteo')
  assert.equal(weather.providerScope, 'international')
  assert.equal(weather.hours.length, 7)
  assert.equal(weather.hours[0].tIso, '2026-07-17T23:00:00.000Z')
  assert.equal(weather.tempF, 71)
  assert.equal(weather.windSpeedMph, 4)
  assert.equal(weather.pressureMb, 1001)
  assert.equal(weather.fetchedAt, '2026-07-17T12:00:00.000Z')
})

test('international weather preserves unavailable measurements as null', () => {
  const time = Date.parse('2026-07-17T23:00:00.000Z') / 1000
  const weather = buildOpenMeteoForecast({
    timezone: 'UTC',
    hourly: {
      time: [time],
      temperature_2m: [null],
      wind_speed_10m: [null],
      wind_direction_10m: [null],
    },
  }, '2026-07-17T23:15:00.000Z')

  assert.equal(weather.tempF, null)
  assert.equal(weather.windSpeedMph, null)
  assert.equal(weather.windDirDeg, null)
  assert.equal(weather.precipProbPct, null)
})

test('Rogers Centre is explicitly routed as an international venue', () => {
  const stadiums = JSON.parse(readFileSync(new URL('../src/sports/mlb/data/stadiums.json', import.meta.url), 'utf8')).stadiums
  const rogersCentre = stadiums.find((stadium) => stadium.team === 'TOR')
  assert.equal(rogersCentre.country, 'CA')
})
