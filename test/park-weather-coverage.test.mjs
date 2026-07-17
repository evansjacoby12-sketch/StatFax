import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasParkWeatherHandCoverage } from '../src/sports/mlb/logic/parkWeatherHand.js'

test('park/weather interaction coverage distinguishes mapped from fallback parks', () => {
  assert.equal(hasParkWeatherHandCoverage('Fenway Park'), true)
  assert.equal(hasParkWeatherHandCoverage('Yankee Stadium'), true)
  assert.equal(hasParkWeatherHandCoverage('Progressive Field'), false)
  assert.equal(hasParkWeatherHandCoverage('Angel Stadium'), false)
})
