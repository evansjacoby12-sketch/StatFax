import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BASELINE_LEAGUE_ISO,
  BASELINE_LEAGUE_K_RATE,
  buildTransparentStarterBaseline,
  projectStarterHRBaseline,
  projectStarterKBaseline,
} from '../src/sports/mlb/logic/transparentBaseline.js'

test('transparent K baseline follows the published formula exactly', () => {
  const projection = projectStarterKBaseline({
    kPer9: 9,
    expectedIP: 6,
    lineupKRate: 0.2442,
  })
  assert.ok(Math.abs(projection - 6.6) < 1e-12)
})

test('transparent HR baseline follows the starter ISO and environment formula', () => {
  const projection = projectStarterHRBaseline({
    hrPer9: 1.5,
    expectedIP: 6,
    lineupIso: 0.1815,
    parkFactor: 1.10,
    weatherFactor: 1.05,
  })
  assert.ok(Math.abs(projection - 1.2705) < 1e-12)
})

test('starter baseline derives lineup rates, handed park, and weather without changing fallbacks', () => {
  const pitcher = { season: { ip: 90, k: 90, hr: 15 } }
  const targets = [
    {
      season: { ab: 90, bb: 10, k: 20, avg: 0.250, slg: 0.430 },
      gameParkHRFactor: 1.10,
      parkWeatherHandFactor: 1.155,
    },
    {
      season: { ab: 80, bb: 20, k: 30, iso: 0.150 },
      gameParkHRFactor: 0.90,
      parkWeatherHandFactor: 0.945,
    },
  ]
  const baseline = buildTransparentStarterBaseline(pitcher, targets, { expectedIP: 6 })

  assert.equal(baseline.k.pitcherKPer9, 9)
  assert.equal(baseline.k.lineupKRate, 0.25)
  assert.equal(baseline.hr.pitcherHRPer9, 1.5)
  assert.ok(Math.abs(baseline.hr.lineupIso - 0.165) < 1e-12)
  assert.equal(baseline.hr.parkFactor, 1)
  assert.ok(Math.abs(baseline.hr.weatherFactor - 1.05) < 1e-12)
  assert.ok(Math.abs(baseline.k.projection - ((9 * 6 / 9) * (0.25 / BASELINE_LEAGUE_K_RATE))) < 1e-12)
  assert.ok(Math.abs(baseline.hr.projection - ((1.5 * 6 / 9) * (0.165 / BASELINE_LEAGUE_ISO) * 1 * 1.05)) < 1e-12)
})

test('missing lineup inputs use declared league baselines and report zero coverage', () => {
  const baseline = buildTransparentStarterBaseline(
    { season: { kPer9: 8, hrPer9: 1.2 } },
    [{ season: null }],
    { expectedIP: 5 },
  )
  assert.equal(baseline.k.lineupKRate, BASELINE_LEAGUE_K_RATE)
  assert.equal(baseline.hr.lineupIso, BASELINE_LEAGUE_ISO)
  assert.equal(baseline.k.lineupCoverage, 0)
  assert.equal(baseline.hr.lineupCoverage, 0)
  assert.ok(Number.isFinite(baseline.k.projection))
  assert.ok(Number.isFinite(baseline.hr.projection))
})
