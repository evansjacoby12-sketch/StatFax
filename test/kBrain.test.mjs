import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  K_LINES,
  kBrain,
} from '../src/sports/mlb/logic/kBrain.js'
import {
  groupPitchers,
  kBrain as uiKBrain,
} from '../ui/src/lib/pitchers.js'

const PITCHER = {
  id: 42,
  hand: 'R',
  season: { bf: 500, k: 130, kPer9: 10.1 },
  splits: {
    vl: { bf: 210, kPct: 27.5, hrPer9: 1.1 },
    vr: { bf: 290, kPct: 24.8, hrPer9: 0.9 },
  },
  savant: { swStrPct: 12.8, whiffPct: 29.1 },
  pitchMix: { ffPct: 46, slPct: 31, chPct: 18 },
  gameParkKFactor: 0.95,
  recentForm: {
    games: 6,
    ip: 34.2,
    recentStarts: [
      { ip: 6.0, bf: 24, pitches: 98, k: 10 },
      { ip: 5.2, bf: 23, pitches: 94, k: 9 },
      { ip: 5.1, bf: 22, pitches: 91, k: 8 },
      { ip: 6.0, bf: 23, pitches: 96, k: 5 },
      { ip: 5.0, bf: 22, pitches: 88, k: 4 },
      { ip: 4.2, bf: 21, pitches: 84, k: 4 },
    ],
  },
}

const TARGETS = [
  { batSide: 'L', season: { ab: 360, bb: 42, k: 104 } },
  { batSide: 'R', season: { ab: 330, bb: 30, k: 72 } },
  { batSide: 'S', season: { ab: 280, bb: 35, k: 80 } },
]

test('canonical K Brain emits the complete server/UI contract', () => {
  const result = kBrain(PITCHER, TARGETS, {
    weather: { tempF: 82, roofClosed: false },
    umpire: { kFactor: 1.03, zoneStyle: 'high' },
    parkFactorK: 1.04,
  })

  assert.ok(result)
  for (const field of [
    'k', 'lo', 'hi', 'lambda', 'probs', 'expIP', 'ipSD', 'oppK',
    'trend', 'conf', 'boost', 'splitKRate', 'swStrPct', 'whiffPct',
    'tempAdj', 'umpireAdj', 'parkKAdj', 'tttoPenalty', 'vegasTrim', 'tempF',
  ]) {
    assert.ok(Object.hasOwn(result, field), `missing K snapshot field: ${field}`)
  }

  assert.equal(result.k, result.lambda)
  assert.equal(result.conf, 'high')
  assert.equal(result.trend, 'up')
  assert.equal(result.parkKAdj, 1.04, 'explicit server park factor wins over pitcher fallback')
  assert.equal(result.ipSD, 0.8)
  assert.ok(result.lo <= result.lambda && result.lambda <= result.hi)

  let previous = 1
  for (const line of K_LINES) {
    assert.ok(Number.isFinite(result.probs[line]))
    assert.ok(result.probs[line] >= 0 && result.probs[line] <= 1)
    assert.ok(result.probs[line] <= previous, 'over probability must fall as the line rises')
    previous = result.probs[line]
  }
})

test('UI imports the canonical K Brain instead of maintaining a second model', () => {
  assert.equal(uiKBrain, kBrain)
  const direct = kBrain(PITCHER, TARGETS)
  const fromUi = uiKBrain(PITCHER, TARGETS)
  assert.deepEqual(fromUi, direct)
  assert.equal(fromUi.parkKAdj, PITCHER.gameParkKFactor)
})

test('groupPitchers preserves a server-produced K contract with confidence metadata', () => {
  const serverProjection = kBrain(PITCHER, TARGETS, { parkFactorK: 1.02 })
  const batters = TARGETS.map((target, index) => ({
    ...target,
    playerId: 100 + index,
    gamePk: 777,
    opponent: 'CHC',
    pitcher: PITCHER,
    hrProbability: 0.10 - index * 0.01,
    score: 70 - index,
  }))

  const [group] = groupPitchers(batters, { '42-777': serverProjection })
  assert.equal(group.estK, serverProjection)
  assert.match(group.estK.conf, /^(high|med|low)$/)
  assert.match(group.estK.trend, /^(up|down|flat)$/)
})

test('K Brain returns null without a usable season or split strikeout rate', () => {
  assert.equal(kBrain({ recentForm: {} }, TARGETS), null)
})
