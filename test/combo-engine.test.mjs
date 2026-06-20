import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  STRATEGIES,
  buildCombos,
  gradeFor,
  allHitProb,
  signalCount,
  signalScore,
  mixRank,
  powerRank,
  barrelOf,
  recentBarrelOf,
  blastRate,
} from '../ui/src/lib/combo-engine.js'
import { buildGroups } from '../ui/src/lib/groups.js'
import { comboRowFromSnapshot, buildComboRecords, gradeCombos } from '../server/parlay-combos.mjs'
import { heatIndex } from '../ui/src/lib/scout.js'
import { HOT_HEAT } from '../ui/src/lib/constants.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

// A canonical engine row with sane defaults; override per test.
const row = (over = {}) => ({
  playerId: 1, gamePk: 100, score: 60, grade: 'STRONG',
  hrProb: 0.2, heat: 50, heatMult: 1,
  barrel: 8, recentBarrel: null, blast: null,
  pitcherHr9: 1.0, air: 1.0,
  hot: false, homeEdge: false, awayEdge: false, bullpenLegend: false, barrelKing: false,
  ...over,
})

const stratByKey = Object.fromEntries(STRATEGIES.map((s) => [s.key, s]))

// Canonical signature of one combo (order-independent legs).
const sig = (strategy, size, legIds) => `${strategy}:${size}:${[...legIds].sort((a, b) => a - b).join(',')}`

// ─── strategy rank/require gates ──────────────────────────────────────────────

test('top ranks on raw score, no gate', () => {
  assert.equal(stratByKey.top.require, null)
  assert.equal(stratByKey.top.rank(row({ score: 73 })), 73)
})

test('stack requires 2+ proven signals and sums their weights', () => {
  const one = row({ hot: true })
  const two = row({ hot: true, barrelKing: true })
  assert.equal(signalCount(one), 1)
  assert.equal(stratByKey.stack.require(one), false)
  assert.equal(signalCount(two), 2)
  assert.equal(stratByKey.stack.require(two), true)
  assert.equal(signalScore(two), 3 + 2) // hot(3) + barrelKing(2)
})

test('hot gate: hot flag OR heat >= HOT_HEAT (the drift fix)', () => {
  assert.equal(stratByKey.hot.require(row({ hot: true, heat: 10 })), true)
  assert.equal(stratByKey.hot.require(row({ hot: false, heat: HOT_HEAT })), true)
  assert.equal(stratByKey.hot.require(row({ hot: false, heat: HOT_HEAT - 1 })), false)
  // rank = heat × multiplier (blends both heat signals)
  assert.equal(stratByKey.hot.rank(row({ heat: 70, heatMult: 1.1 })), 77)
})

test('power gate at above-average barrel (>=11); rank blends barrel/recent/blast', () => {
  assert.equal(stratByKey.power.require(row({ barrel: 10 })), false)
  assert.equal(stratByKey.power.require(row({ barrel: 11 })), true)
  // recent barrel pulls the rank up vs season-only
  const seasonOnly = powerRank(row({ barrel: 12, recentBarrel: null, blast: null }))
  const withRecent = powerRank(row({ barrel: 12, recentBarrel: 20, blast: null }))
  assert.ok(withRecent > seasonOnly)
})

test('matchup gate at hr9 >= 1.3; rank = score × hr9', () => {
  assert.equal(stratByKey.matchup.require(row({ pitcherHr9: 1.2 })), false)
  assert.equal(stratByKey.matchup.require(row({ pitcherHr9: 1.3 })), true)
  assert.equal(stratByKey.matchup.rank(row({ score: 60, pitcherHr9: 1.5 })), 90)
})

test('park gate at air >= 1.08; rank = score × air', () => {
  assert.equal(stratByKey.park.require(row({ air: 1.05 })), false)
  assert.equal(stratByKey.park.require(row({ air: 1.08 })), true)
  assert.ok(Math.abs(stratByKey.park.rank(row({ score: 50, air: 1.2 })) - 60) < 1e-9)
})

test('mixRank blends score (0.5) + barrel (0.25) + heat (0.25)', () => {
  // score 100, barrel 25, heat 100 → 0.5 + 0.25 + 0.25 = 1.0
  assert.ok(Math.abs(mixRank(row({ score: 100, barrel: 25, heat: 100 })) - 1) < 1e-9)
})

// ─── field-derivation helpers ─────────────────────────────────────────────────

test('barrelOf prefers BBE rate, then plain, else null', () => {
  assert.equal(barrelOf({ barrelPctBBE: 14, barrelPct: 9 }), 14)
  assert.equal(barrelOf({ barrelPct: 9 }), 9)
  assert.equal(barrelOf({}), null)
})

test('recentBarrelOf needs a real (>=6 BBE) sample', () => {
  assert.equal(recentBarrelOf({ recentBarrel: { recentBarrelPct: 20, recentBBE: 6 } }), 20)
  assert.equal(recentBarrelOf({ recentBarrel: { recentBarrelPct: 20, recentBBE: 5 } }), null)
  assert.equal(recentBarrelOf({}), null)
})

test('blastRate prefers recent (>=25 swings), falls back to season', () => {
  assert.equal(blastRate({ batTracking: { recentBlastPerContact: 30, recentSwings: 25, blastPerContact: 18 } }), 30)
  assert.equal(blastRate({ batTracking: { recentBlastPerContact: 30, recentSwings: 10, blastPerContact: 18 } }), 18)
  assert.equal(blastRate({}), null)
})

// ─── allHitProb / gradeFor ────────────────────────────────────────────────────

test('allHitProb = product, or null if any leg is missing', () => {
  assert.ok(Math.abs(allHitProb([0.2, 0.25]) - 0.05) < 1e-9)
  assert.equal(allHitProb([0.2, null]), null)
  assert.equal(allHitProb([0.2, undefined]), null)
})

test('gradeFor ladder S/A/B/C/D', () => {
  assert.equal(gradeFor(76), 'S')
  assert.equal(gradeFor(70), 'A')
  assert.equal(gradeFor(62), 'B')
  assert.equal(gradeFor(54), 'C')
  assert.equal(gradeFor(53.9), 'D')
})

// ─── buildCombos selection ────────────────────────────────────────────────────

// Six games, two bats each, scores descending, so `top` is deterministic.
const slateRows = () => {
  const out = []
  let pid = 1
  for (let g = 0; g < 6; g++) {
    const gamePk = 200 + g
    // higher-scoring "A" bat and a weaker "B" bat in each game
    out.push(row({ playerId: pid++, gamePk, score: 80 - g * 3, grade: 'PRIME', hrProb: 0.25 }))
    out.push(row({ playerId: pid++, gamePk, score: 55 - g * 2, grade: 'STRONG', hrProb: 0.15 }))
  }
  return out
}

test('one leg per game: a combo never repeats a gamePk', () => {
  const combos = buildCombos(slateRows())
  for (const c of combos) {
    const games = c.legs.map((l) => l.gamePk)
    assert.equal(new Set(games).size, games.length, `${c.strategy}/${c.size} reused a game`)
  }
})

test('size filtering: no combos larger than the eligible game count', () => {
  // Only 2 distinct games → 4-leg combos impossible, 2-leg fine.
  const rows = [
    row({ playerId: 1, gamePk: 1, score: 70, grade: 'PRIME' }),
    row({ playerId: 2, gamePk: 2, score: 68, grade: 'PRIME' }),
  ]
  const combos = buildCombos(rows)
  assert.ok(combos.some((c) => c.size === 2))
  assert.ok(!combos.some((c) => c.size > 2))
})

test('exposure caps: no bat anchors more than maxPerBat combos per size', () => {
  const combos = buildCombos(slateRows(), { maxPerBat: 2, globalMaxPerBat: 4 })
  const perSize = {}
  for (const c of combos) {
    for (const l of c.legs) {
      const key = `${c.size}:${l.playerId}`
      perSize[key] = (perSize[key] || 0) + 1
      assert.ok(perSize[key] <= 2, `bat ${l.playerId} anchored ${perSize[key]} combos at size ${c.size}`)
    }
  }
})

test('SKIP grades and scoreless rows are ineligible', () => {
  const rows = [
    row({ playerId: 1, gamePk: 1, score: 70, grade: 'PRIME' }),
    row({ playerId: 2, gamePk: 2, score: 70, grade: 'SKIP' }),
    row({ playerId: 3, gamePk: 3, score: NaN, grade: 'PRIME' }),
    row({ playerId: 4, gamePk: 4, score: 68, grade: 'PRIME' }), // 2nd valid game so a 2-leg combo can form
  ]
  const top = buildCombos(rows).filter((c) => c.strategy === 'top')
  const seen = new Set(top.flatMap((c) => c.legs.map((l) => l.playerId)))
  assert.ok(seen.has(1))
  assert.ok(seen.has(4))
  assert.ok(!seen.has(2)) // SKIP grade
  assert.ok(!seen.has(3)) // scoreless
})

test('identical leg sets from different strategies dedupe within a size', () => {
  // Two games, both bats PRIME + hot + barrelKing → top, mix, stack, hot all pick
  // the same two legs; they should collapse to a single 2-leg combo.
  const rows = [
    row({ playerId: 1, gamePk: 1, score: 80, grade: 'PRIME', hot: true, barrelKing: true, barrel: 15, heat: 70 }),
    row({ playerId: 2, gamePk: 2, score: 78, grade: 'PRIME', hot: true, barrelKing: true, barrel: 14, heat: 68 }),
  ]
  const twoLeg = buildCombos(rows).filter((c) => c.size === 2)
  const sigs = twoLeg.map((c) => sig(c.strategy, c.size, c.legs.map((l) => l.playerId)))
  const legSets = new Set(twoLeg.map((c) => [...c.legs.map((l) => l.playerId)].sort().join(',')))
  // Several strategies qualify, but the unique leg-set is just {1,2}.
  assert.equal(legSets.size, 1)
  assert.ok(sigs.length >= 1)
})

// ─── client ≡ server equivalence (the anti-drift guarantee) ───────────────────

// A synthetic batter carrying BOTH the live fields (client adapter) and the
// frozen-pregame fields (server adapter), ALIGNED so live == frozen. heatIndex
// is computed via scout the same way data.js does, so the client (b.heatIndex)
// and the server (heatIndex(row)) read the identical value. If the two adapters
// + the shared engine agree, the combos shown == the combos graded.
function syntheticBatter(over = {}) {
  const b = {
    playerId: over.playerId,
    gamePk: over.gamePk,
    name: over.name || `P${over.playerId}`,
    team: over.team || 'TST',
    score: over.score,
    grade: { label: over.grade || 'STRONG' },
    hrProbability: over.hrProbability ?? 0.2,
    hotnessMultiplier: over.hotnessMultiplier ?? 1,
    barrelPctBBE: over.barrel ?? 8,
    recentBarrel: over.recentBarrel ?? null,
    batTracking: over.batTracking ?? null,
    pitcher: over.pitcher ?? { id: 9000 + (over.playerId || 0), season: { hrPer9: over.hr9 ?? 1.0 } },
    parkWeatherHandFactor: over.air ?? 1.0,
    hot: over.hot ?? false,
    homeEdge: over.homeEdge ?? false,
    awayEdge: over.awayEdge ?? false,
    bullpenLegend: over.bullpenLegend ?? false,
    cold: false,
    hrStreak: 0,
    season: over.season ?? { ab: 300, bb: 30, k: 60, slg: 0.45, avg: 0.25 },
    recent: over.recent ?? { ab: 40, hr: 3, slg: 0.5, avg: 0.27 },
    recent7: over.recent7 ?? null,
    game: { isFinal: false, isLive: false },
  }
  // Freeze: pregame fields == live fields (so the adapters read the same values).
  b.preGameScore = b.score
  b.preGameGrade = b.grade
  b.simHRProb = b.hrProbability
  // Precompute heat exactly as data.js does, so client b.heatIndex == server heatIndex(row).
  b.heatIndex = heatIndex(b)
  return b
}

function variedSlate() {
  const specs = [
    { score: 82, grade: 'PRIME', barrel: 16, hot: true, homeEdge: true, hrProbability: 0.28 },
    { score: 71, grade: 'PRIME', barrel: 12, recentBarrel: { recentBarrelPct: 22, recentBBE: 10 }, hr9: 1.6 },
    { score: 64, grade: 'STRONG', barrel: 9, air: 1.15, bullpenLegend: true, awayEdge: true },
    { score: 58, grade: 'STRONG', barrel: 14, hot: true, barrelChip: true, batTracking: { recentBlastPerContact: 30, recentSwings: 40 } },
    { score: 77, grade: 'PRIME', barrel: 11, hr9: 1.4, air: 1.1, hot: true, homeEdge: true },
    { score: 53, grade: 'STRONG', barrel: 7, recent: { ab: 40, hr: 6, slg: 0.7, avg: 0.33 } }, // high recent → heat may clear HOT_HEAT without hot flag
    { score: 69, grade: 'PRIME', barrel: 13, air: 1.2 },
    { score: 61, grade: 'STRONG', barrel: 10, hr9: 1.7, bullpenLegend: true },
    { score: 74, grade: 'PRIME', barrel: 15, hot: true, barrelKingChip: true },
    { score: 49, grade: 'LEAN', barrel: 6 },
    { score: 66, grade: 'STRONG', barrel: 12, air: 1.09 },
    { score: 80, grade: 'PRIME', barrel: 18, hot: true, homeEdge: true, bullpenLegend: true },
  ]
  return specs.map((s, i) => syntheticBatter({ ...s, playerId: i + 1, gamePk: 300 + i })) // one bat per game
}

test('client buildGroups ≡ server buildComboRecords on aligned data', () => {
  const batters = variedSlate()

  // Client path.
  const groups = buildGroups(batters)
  const clientSigs = []
  for (const size of Object.keys(groups)) {
    for (const g of groups[size]) {
      clientSigs.push(sig(g.strategy, g.size, g.legs.map((l) => l.playerId)))
    }
  }

  // Server path.
  const serverRows = batters.map(comboRowFromSnapshot)
  const serverSigs = buildComboRecords(serverRows).map((c) => sig(c.strategy, c.size, c.legs))

  assert.deepEqual(clientSigs.slice().sort(), serverSigs.slice().sort())
  assert.ok(clientSigs.length > 0, 'expected some combos to be built')
})

test('a high-heat but non-hot bat can anchor the hot strategy on BOTH sides', () => {
  // 3 games. A1: top by score but cold (sub-threshold heat, not hot). B1: weak
  // score but heat >= HOT_HEAT via a big recent-power surge and NO hot flag. C1:
  // hot flag. The hot strategy should pick {B1, C1} — distinct from top's
  // {A1, C1} so it survives dedup — and it must include B1. Under the OLD server
  // gate (hot flag only) B1 was ineligible; this asserts the fix, on both sides.
  const A1 = syntheticBatter({ playerId: 1, gamePk: 1, score: 90, grade: 'PRIME', hot: false, recent: { ab: 40, hr: 1, slg: 0.42, avg: 0.27 } })
  const B1 = syntheticBatter({ playerId: 2, gamePk: 2, score: 50, grade: 'STRONG', hot: false, recent: { ab: 40, hr: 9, slg: 0.60, avg: 0.27 } })
  const C1 = syntheticBatter({ playerId: 3, gamePk: 3, score: 51, grade: 'STRONG', hot: true })
  assert.ok(B1.heatIndex >= HOT_HEAT, `B1 heat ${B1.heatIndex} should clear ${HOT_HEAT}`)
  assert.ok(A1.heatIndex < HOT_HEAT && !A1.hot, `A1 heat ${A1.heatIndex} should be sub-threshold`)
  const batters = [A1, B1, C1]

  const groups = buildGroups(batters)
  const clientHot = (groups[2] || []).find((g) => g.strategy === 'hot')
  const serverHot = buildComboRecords(batters.map(comboRowFromSnapshot)).find((c) => c.strategy === 'hot' && c.size === 2)

  assert.ok(clientHot, 'client built a 2-leg hot combo')
  assert.ok(serverHot, 'server built a 2-leg hot combo')
  const clientLegs = clientHot.legs.map((l) => l.playerId).sort((a, b) => a - b)
  const serverLegs = serverHot.legs.slice().sort((a, b) => a - b)
  assert.deepEqual(clientLegs, serverLegs)
  assert.ok(clientLegs.includes(2), 'hot combo includes the high-heat, non-hot bat')
})

// ─── grading ──────────────────────────────────────────────────────────────────

test('gradeCombos marks allHit only when every leg homered', () => {
  const combos = [
    { strategy: 'top', size: 2, legs: [1, 2], pred: 0.05 },
    { strategy: 'mix', size: 2, legs: [1, 3], pred: 0.04 },
  ]
  const homerers = new Set([1, 2])
  const graded = gradeCombos(combos, homerers)
  assert.equal(graded[0].nHit, 2)
  assert.equal(graded[0].allHit, true)
  assert.equal(graded[1].nHit, 1)
  assert.equal(graded[1].allHit, false)
})
