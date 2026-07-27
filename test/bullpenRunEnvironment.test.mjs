import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBullpenAvailability,
  buildBullpenRunProfile,
} from '../src/sports/mlb/logic/bullpenRunEnvironment.js'

const stat = (overrides = {}) => ({
  inningsPitched: '160.0',
  era: '4.10',
  runsScoredPer9: '4.30',
  whip: '1.28',
  homeRuns: 20,
  strikeOuts: 170,
  baseOnBalls: 55,
  hitByPitch: 5,
  ...overrides,
})

const pitcher = (id, name, appearances, positionType = 'Pitcher') => ({
  position: { type: positionType },
  person: {
    id,
    fullName: name,
    stats: [{ splits: appearances }],
  },
})

const appearance = (date, pitches, overrides = {}) => ({
  date,
  stat: {
    inningsPitched: '1.0',
    numberOfPitches: pitches,
    gamesStarted: 0,
    saves: 0,
    holds: 0,
    ...overrides,
  },
})

test('bullpen run profile requires a meaningful innings sample', () => {
  assert.equal(buildBullpenRunProfile(stat({ inningsPitched: '29.2' })), null)
})

test('bullpen run profile orders strong and weak relief units', () => {
  const strong = buildBullpenRunProfile(stat({
    era: '2.80',
    runsScoredPer9: '3.05',
    whip: '1.05',
    homeRuns: 12,
    strikeOuts: 205,
    baseOnBalls: 42,
  }))
  const weak = buildBullpenRunProfile(stat({
    era: '5.70',
    runsScoredPer9: '5.95',
    whip: '1.55',
    homeRuns: 30,
    strikeOuts: 125,
    baseOnBalls: 80,
  }))

  assert.ok(strong.qualityFactor < 1)
  assert.ok(weak.qualityFactor > 1)
  assert.ok(strong.estimatedRunsAllowed9 < weak.estimatedRunsAllowed9)
})

test('bullpen availability identifies worked leverage relievers and excludes the probable starter', () => {
  const routine = [
    appearance('2026-07-20', 13),
    appearance('2026-07-18', 12),
    appearance('2026-07-16', 14),
  ]
  const roster = [
    pitcher(1, 'Closer A', [
      appearance('2026-07-26', 28, { saves: 1 }),
      appearance('2026-07-24', 16, { holds: 1 }),
      appearance('2026-07-20', 14, { saves: 1 }),
    ]),
    pitcher(2, 'Setup B', [
      appearance('2026-07-26', 18, { holds: 1 }),
      appearance('2026-07-25', 18, { holds: 1 }),
      appearance('2026-07-20', 12),
    ]),
    pitcher(3, 'Fresh C', routine),
    pitcher(99, 'Probable Starter', [
      appearance('2026-07-26', 30),
      ...routine,
    ]),
  ]
  const result = buildBullpenAvailability(roster, {
    targetDate: '2026-07-27',
    excludedPitcherIds: [99],
  })

  assert.equal(result.relievers, 3)
  assert.equal(result.unavailable, 2)
  assert.ok(result.factor > 1)
  assert.deepEqual(result.unavailableNames, ['Closer A', 'Setup B'])
})

test('bullpen availability ignores target-day appearances to prevent leakage', () => {
  const roster = [
    pitcher(1, 'Same Day Arm', [
      appearance('2026-07-27', 40, { saves: 1 }),
      appearance('2026-07-20', 12),
      appearance('2026-07-18', 12),
    ]),
  ]
  const result = buildBullpenAvailability(roster, { targetDate: '2026-07-27' })

  assert.equal(result.unavailable, 0)
  assert.equal(result.taxed, 0)
  assert.equal(result.factor, 1)
})
