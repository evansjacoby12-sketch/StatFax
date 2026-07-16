import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { lineupActionability, selectTopModelPick } from '../ui/src/lib/actionability.js'

const batter = (id, score, lineupConfirmed, battingOrder = null) => ({
  id,
  playerId: id,
  gamePk: 100 + id,
  score,
  hrProbability: score / 400,
  expectedHRs: score / 200,
  grade: { label: 'PRIME' },
  lineupConfirmed,
  battingOrder,
})

test('lineup actionability separates research state from execution readiness', () => {
  assert.deepEqual(lineupActionability(batter(1, 80, false, 2)), {
    key: 'projected',
    actionReady: false,
    icon: 'Clock3',
    label: 'Projected · #2',
    shortLabel: 'Projected',
  })
  assert.equal(lineupActionability(batter(2, 80, true, 3)).label, 'Action ready · #3')
  assert.equal(lineupActionability(batter(3, 80, true)).key, 'out')
})

test('top model pick does not prefer a weaker confirmed hitter', () => {
  const projectedLeader = batter(1, 90, false, 2)
  const confirmedRunnerUp = batter(2, 80, true, 3)
  assert.equal(selectTopModelPick([confirmedRunnerUp, projectedLeader]), projectedLeader)
})

test('top model pick excludes confirmed non-starters and breaks ties deterministically', () => {
  const benchedLeader = batter(1, 95, true)
  const laterId = batter(9, 80, false, 2)
  const earlierId = batter(4, 80, true, 2)
  assert.equal(selectTopModelPick([laterId, benchedLeader, earlierId]), earlierId)
})

test('Top Straights and the board have no lineup-based research adjustment', () => {
  const straights = readFileSync(new URL('../ui/src/components/TopStraightsView.jsx', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../ui/src/App.jsx', import.meta.url), 'utf8')
  assert.doesNotMatch(straights, /lineupConfirmed[^\n]*(penalt|addEvidence)/i)
  assert.doesNotMatch(app, /const confirmed = pool|splitProjected/)
})
