import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  K_CALIBRATION,
  K_LINES,
  kBrain,
  orderPitcherGameLogs,
  selectKBrainTargets,
} from '../src/sports/mlb/logic/kBrain.js'
import {
  groupPitchers,
  kBrain as uiKBrain,
  projectedK,
  summarizeKProjectionResults,
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
    'k', 'lo', 'hi', 'lambda', 'probs', 'expIP', 'expBF', 'ipSD', 'volumeSource', 'oppK',
    'trend', 'conf', 'boost', 'splitKRate', 'swStrPct', 'whiffPct',
    'tempAdj', 'umpireAdj', 'parkKAdj', 'tttoPenalty', 'vegasTrim',
    'adjustedKRate', 'calibration', 'modelVersion', 'tempF',
    'lineupMode', 'lineupSize', 'lineupCandidates', 'lineupCoverage',
    'lineupSourceGamePk', 'lineupAsOf',
  ]) {
    assert.ok(Object.hasOwn(result, field), `missing K snapshot field: ${field}`)
  }

  assert.equal(result.k, result.lambda)
  assert.equal(result.conf, 'high')
  assert.equal(result.trend, 'up')
  assert.equal(result.parkKAdj, 1.04, 'explicit server park factor wins over pitcher fallback')
  assert.equal(result.ipSD, 0.8)
  assert.equal(result.volumeSource, 'recent-pitches-bf')
  assert.equal(result.expBF, 22.5)
  assert.equal(result.calibration, K_CALIBRATION)
  assert.ok(result.lo <= result.lambda && result.lambda <= result.hi)

  let previous = 1
  for (const line of K_LINES) {
    assert.ok(Number.isFinite(result.probs[line]))
    assert.ok(result.probs[line] >= 0 && result.probs[line] <= 1)
    assert.ok(result.probs[line] <= previous, 'over probability must fall as the line rises')
    previous = result.probs[line]
  }
})

test('K Brain uses a confirmed batting order instead of the full active roster', () => {
  const roster = Array.from({ length: 13 }, (_, index) => ({
    playerId: 100 + index,
    lineupConfirmed: index < 9,
    battingOrder: index < 9 ? index + 1 : null,
    season: { ab: 500 - index, bb: 30, k: index < 9 ? 60 : 220 },
  }))
  const selection = selectKBrainTargets(roster)
  assert.equal(selection.mode, 'confirmed')
  assert.equal(selection.selected, 9)
  assert.deepEqual(selection.targets.map((row) => row.playerId), roster.slice(0, 9).map((row) => row.playerId))
})

test('K Brain uses the recent projected nine and fills missing slots without shuffling', () => {
  const roster = Array.from({ length: 12 }, (_, index) => ({
    playerId: 200 + index,
    projectedBattingOrder: index < 8 ? index + 1 : null,
    lineupSourceGamePk: index < 8 ? 991 : null,
    lineupAsOf: index < 8 ? '2026-07-23T23:00:00Z' : null,
    season: { ab: index < 8 ? 300 : 600 - index, bb: 20, k: 80 },
  }))
  const first = selectKBrainTargets(roster)
  const second = selectKBrainTargets([...roster].reverse())
  assert.equal(first.mode, 'projected')
  assert.equal(first.selected, 9)
  assert.equal(first.sourceGamePk, 991)
  assert.equal(first.coverage, 8 / 9)
  assert.deepEqual(first.targets.map((row) => row.playerId), second.targets.map((row) => row.playerId))
})

test('K Brain full-roster fallback takes the deterministic top nine by season PA', () => {
  const roster = Array.from({ length: 12 }, (_, index) => ({
    playerId: 300 + index,
    season: { ab: 100 + index * 20, bb: index, k: 50 },
  }))
  const selection = selectKBrainTargets(roster)
  assert.equal(selection.mode, 'roster-fallback')
  assert.equal(selection.selected, 9)
  assert.deepEqual(
    selection.targets.map((row) => row.playerId),
    [...roster].sort((a, b) => (b.season.ab + b.season.bb) - (a.season.ab + a.season.bb)).slice(0, 9).map((row) => row.playerId),
  )
})

test('K volume falls back to recent innings when actual batters faced are absent', () => {
  const withoutBF = {
    ...PITCHER,
    recentForm: {
      ...PITCHER.recentForm,
      recentStarts: PITCHER.recentForm.recentStarts.map(({ bf, ...start }) => start),
    },
  }
  const result = kBrain(withoutBF, TARGETS)
  assert.equal(result.volumeSource, 'recent-ip')
  assert.ok(Number.isFinite(result.expBF))
})

test('starter history excludes interleaved relief appearances but preserves all workload logs', () => {
  const relief = { date: '2026-07-12', stat: { gamesStarted: 0, inningsPitched: '1.0' } }
  const newestStart = { date: '2026-07-10', stat: { gamesStarted: 1, inningsPitched: '6.0' } }
  const olderStart = { date: '2026-07-05', stat: { gamesStarted: 1, inningsPitched: '5.0' } }
  const ordered = orderPitcherGameLogs([olderStart, relief, newestStart])
  assert.deepEqual(ordered.appearances, [relief, newestStart, olderStart])
  assert.deepEqual(ordered.starts, [newestStart, olderStart])
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

test('K projection helpers use the expected total, not the uncertainty range', () => {
  assert.equal(projectedK({ k: 6.4, lambda: 6.4, lo: 3, hi: 10 }), 6.4)
  assert.equal(projectedK({ estK: 7.2, lo: 4, hi: 11 }), 7.2)
  assert.equal(projectedK({ lo: 4, hi: 8 }), 6, 'legacy range-only rows fall back to midpoint')

  const summary = summarizeKProjectionResults([
    { estK: 6.6, actualK: 8, lo: 3, hi: 10 },
    { estK: 8.2, actualK: 6, lo: 5, hi: 12 },
    { estK: 7.4, actualK: 7, lo: 4, hi: 11 },
  ])
  assert.equal(summary.n, 3)
  assert.equal(summary.exactCount, 1)
  assert.equal(summary.withinCount, 2, 'within-one accuracy uses the rounded whole-K projection')
  assert.ok(Math.abs(summary.mae - (4 / 3)) < 1e-9, 'MAE keeps the decimal projection')
})

test('K Brain UI is projection-first and does not invent betting value without odds', () => {
  const source = readFileSync(new URL('../ui/src/components/PitchersView.jsx', import.meta.url), 'utf8')
  assert.match(source, /Projected K/)
  assert.match(source, /chance to go over/)
  assert.match(source, /Why this projection/)
  assert.doesNotMatch(source, /value ✓|fade ✗|neutral/)
})
