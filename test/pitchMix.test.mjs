import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MIN_PITCH_MIX_COVERED_USAGE,
  expectedHRMultiplierFromPitchMix,
  getPitchAlignmentScore,
} from '../src/sports/mlb/logic/batterPitchTypeISO.js'
import { arsenalRating5 } from '../ui/src/lib/zoneEdge.js'

test('exact pitch model recognizes sweepers with the current-season baseline', () => {
  const arsenal = { stSlg: 0.465, leagueSlg: { st: 0.365 } }
  const mix = { stPct: 60 }
  assert.equal(expectedHRMultiplierFromPitchMix(arsenal, mix), 1.2)
  assert.equal(getPitchAlignmentScore(arsenal, mix), 74)
  assert.equal(arsenalRating5({ arsenal, pitchMix: mix }), 4)
})

test('exact pitch model stays neutral below its coverage gate', () => {
  const arsenal = { ffSlg: 0.700, leagueSlg: { ff: 0.432 } }
  const mix = { ffPct: MIN_PITCH_MIX_COVERED_USAGE - 1 }
  assert.equal(expectedHRMultiplierFromPitchMix(arsenal, mix), 1)
  assert.equal(getPitchAlignmentScore(arsenal, mix), 50)
  assert.equal(arsenalRating5({ arsenal, pitchMix: mix }), null)
})
