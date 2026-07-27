import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateIPDistribution,
  expectedStarterInnings,
} from '../src/sports/mlb/logic/starterIPDistribution.js'

test('starter innings expectation follows recent workload before season workload', () => {
  const recent = expectedStarterInnings({
    recentForm: { games: 5, ip: 33 },
    season: { gs: 20, ip: 100 },
  })
  const season = expectedStarterInnings({
    season: { gs: 20, ip: 100 },
  })

  assert.equal(recent.source, 'recent-starts')
  assert.equal(season.source, 'season-starts')
  assert.ok(recent.expectedIP > season.expectedIP)
})

test('opener expectation is short and every distribution remains normalized', () => {
  const opener = expectedStarterInnings({ isOpener: true })
  const fallback = estimateIPDistribution({})
  const total = Object.values(fallback).reduce((sum, probability) => sum + probability, 0)

  assert.equal(opener.source, 'opener')
  assert.ok(opener.expectedIP < 4)
  assert.ok(Math.abs(total - 1) < 1e-12)
})
