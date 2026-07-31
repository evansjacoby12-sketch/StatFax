import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPitcherFirstInningProfile,
  parsePitcherMicroGame,
  selectPitcherStartSample,
} from '../server/lib/firstInningPitcherProfile.mjs'

function play({
  inning,
  batter,
  eventType,
  outs,
  score = 0,
  pitcher = 50,
}) {
  return {
    about: { inning, isTopInning: true, isComplete: true },
    matchup: {
      pitcher: { id: pitcher },
      batter: { id: batter },
    },
    result: { eventType, awayScore: score, homeScore: 0 },
    count: { outs },
  }
}

test('pitcher micro parser isolates inning one and each hitter’s first trip', () => {
  const record = parsePitcherMicroGame({
    allPlays: [
      play({ inning: 1, batter: 1, eventType: 'walk', outs: 0 }),
      play({ inning: 1, batter: 2, eventType: 'strikeout', outs: 1 }),
      play({ inning: 1, batter: 3, eventType: 'home_run', outs: 1, score: 2 }),
      play({ inning: 1, batter: 4, eventType: 'field_out', outs: 2, score: 2 }),
      play({ inning: 1, batter: 5, eventType: 'field_out', outs: 3, score: 2 }),
      play({ inning: 2, batter: 6, eventType: 'strikeout', outs: 1 }),
      play({ inning: 2, batter: 7, eventType: 'field_out', outs: 2 }),
      play({ inning: 2, batter: 8, eventType: 'walk', outs: 2 }),
      play({ inning: 2, batter: 9, eventType: 'strikeout', outs: 3 }),
      play({ inning: 3, batter: 1, eventType: 'strikeout', outs: 1 }),
      play({ inning: 3, batter: 2, eventType: 'walk', outs: 1 }),
    ],
  }, {
    pitcherId: 50,
    gamePk: 99,
    date: '2026-07-20',
    season: 2026,
  })

  assert.deepEqual(record.firstInning, {
    bf: 5,
    outs: 3,
    k: 1,
    bb: 1,
    hbp: 0,
    hr: 1,
    runs: 2,
  })
  assert.equal(record.firstTimeThrough.bf, 9)
  assert.equal(record.firstTimeThrough.k, 3)
  assert.equal(record.firstTimeThrough.bb, 2)
})

test('starter scoreless rate follows the entire first-inning half after an early hook', () => {
  const record = parsePitcherMicroGame({
    allPlays: [
      play({ inning: 1, batter: 1, eventType: 'walk', outs: 0, pitcher: 50 }),
      play({ inning: 1, batter: 2, eventType: 'field_out', outs: 1, pitcher: 50 }),
      play({ inning: 1, batter: 3, eventType: 'field_out', outs: 2, pitcher: 50 }),
      play({ inning: 1, batter: 4, eventType: 'single', outs: 2, pitcher: 51, score: 1 }),
      play({ inning: 1, batter: 5, eventType: 'field_out', outs: 3, pitcher: 51, score: 1 }),
    ],
  }, {
    pitcherId: 50,
    gamePk: 100,
    date: '2026-07-21',
    season: 2026,
  })

  assert.equal(record.firstInning.runs, 1)
  assert.equal(record.firstInning.bf, 3)
})

test('start sample uses a 60-day window and drops prior season at eight starts', () => {
  const currentStarts = Array.from({ length: 9 }, (_, index) => ({
    gamePk: 100 + index,
    date: new Date(Date.UTC(2026, 6, 20 - index * 5)).toISOString().slice(0, 10),
  }))
  const previousStarts = [{ gamePk: 1, date: '2025-09-20' }]
  const currentOnly = selectPitcherStartSample({
    currentStarts,
    previousStarts,
    currentSeasonStarts: 9,
    asOf: '2026-07-28',
  })

  assert.equal(currentOnly.sampleMode, 'current-season-only')
  assert.equal(currentOnly.previous.length, 0)
  assert.ok(currentOnly.current.every((row) => row.sampleWeight === 1 || row.sampleWeight === 0.7))
})

test('thin current-season samples blend previous starts and emit FIP/TTO rates', () => {
  const selected = selectPitcherStartSample({
    currentStarts: [
      { gamePk: 10, date: '2026-07-20' },
      { gamePk: 11, date: '2026-07-10' },
    ],
    previousStarts: Array.from({ length: 8 }, (_, index) => ({
      gamePk: 20 + index,
      date: `2025-09-${String(20 - index).padStart(2, '0')}`,
    })),
    currentSeasonStarts: 2,
    asOf: '2026-07-28',
  })
  const records = selected.selected.map((start) => ({
    ...start,
    firstInning: { bf: 4, outs: 3, k: 2, bb: 0, hbp: 0, hr: 0, runs: 0 },
    firstTimeThrough: { bf: 9, outs: 7, k: 3, bb: 1, hbp: 0, hr: 0 },
  }))
  const profile = buildPitcherFirstInningProfile(records, {
    pitcherId: 50,
    asOf: '2026-07-28',
    sampleMode: selected.sampleMode,
    currentSeasonStarts: 2,
    currentWindowStarts: selected.current.length,
    previousSeasonStartsUsed: selected.previous.length,
  })

  assert.equal(profile.sampleMode, 'blended-previous-season')
  assert.equal(profile.previousSeasonStartsUsed, 6)
  assert.ok(profile.firstInningFip < 3)
  assert.ok(profile.ttoK9 > 9)
  assert.ok(profile.ttoBb9 < 4)
  assert.equal(profile.scorelessFirstInningRate, 1)
  assert.ok(profile.adjustedScorelessFirstInningRate > 0.733)
  assert.ok(profile.adjustedScorelessFirstInningRate < 1)
  assert.equal(
    profile.firstInningScoringAllowedRate,
    Number((1 - profile.adjustedScorelessFirstInningRate).toFixed(4)),
  )
  assert.ok(profile.coverage > 0.5)
})
