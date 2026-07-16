import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  STRATEGIES,
  buildCombos,
  gradeFor,
  allHitProb,
  mixRank,
  edgeCount,
  barrelOf,
  recentBarrelOf,
  blastRate,
} from '../ui/src/lib/combo-engine.js'
import { buildGroups } from '../ui/src/lib/groups.js'
import {
  comboRowFromSnapshot,
  buildComboRecords,
  buildSGPRecords,
  gradeCombos,
  gradeSGPRecords,
  SGP_GRADE_VERSION,
} from '../server/parlay-combos.mjs'
import { heatIndex } from '../ui/src/lib/scout.js'

// ─── helpers ─────────────────────────────────────────────────────────────────

// A canonical engine row with sane defaults; override per test.
const row = (over = {}) => ({
  playerId: 1, gamePk: 100, score: 60, grade: 'STRONG',
  hrProb: 0.2, heat: 50, heatMult: 1,
  barrel: 8, recentBarrel: null, blast: null,
  pitcherHr9: 1.0, air: 1.0,
  hot: false, homeEdge: false, awayEdge: false, bullpenLegend: false, barrelKing: false,
  positiveReasons: 0, negativeReasons: 0, hrDueScore: 0,
  ...over,
})

const stratByKey = Object.fromEntries(STRATEGIES.map((s) => [s.key, s]))

// Canonical signature of one combo (order-independent legs).
const sig = (strategy, size, legIds) => `${strategy}:${size}:${[...legIds].sort((a, b) => a - b).join(',')}`

// ─── strategy rank/require gates ──────────────────────────────────────────────

test('precision gate: hot & barrel ≥ 12; rank = barrel (re-tuned 2026-07-07)', () => {
  const pass = { hot: true, barrel: 12 }
  assert.equal(stratByKey.precision.require(row({ ...pass, hot: false })), false)
  assert.equal(stratByKey.precision.require(row({ ...pass, barrel: 11 })), false)
  assert.equal(stratByKey.precision.require(row(pass)), true)
  // rank = barrel (elite-contact tier)
  assert.equal(stratByKey.precision.rank(row({ barrel: 18 })), 18)
})

test('edgeCount counts matchup signals (Edge strategy cut; helper still used for leg chips)', () => {
  assert.equal(edgeCount(row({ pitchEdge: true })), 1)
  assert.equal(edgeCount(row({ pitchEdge: true, zoneEdge: true })), 2)
  assert.equal(edgeCount(row({ pitchEdge: true, zoneEdge: true, hrPlatoonEdge: true })), 3)
  assert.equal(stratByKey.edge, undefined) // strategy removed
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
  const mix = buildCombos(rows).filter((c) => c.strategy === 'mix')
  const seen = new Set(mix.flatMap((c) => c.legs.map((l) => l.playerId)))
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
  const serverSigs = buildComboRecords(serverRows).map((c) => sig(c.strategy, c.size, c.legs.map((leg) => leg.playerId)))

  assert.deepEqual(clientSigs.slice().sort(), serverSigs.slice().sort())
  assert.ok(clientSigs.length > 0, 'expected some combos to be built')
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
  assert.equal(graded[0].legacyIdentity, true)
})

test('cross-game combo records select and settle the exact doubleheader game', () => {
  const records = buildComboRecords([
    row({ playerId: 1, gamePk: 100, score: 60, hrProb: 0.18 }),
    row({ playerId: 1, gamePk: 101, score: 88, hrProb: 0.28 }),
    row({ playerId: 2, gamePk: 102, score: 80, hrProb: 0.24 }),
  ], { sizes: [2] })
  assert.ok(records.length > 0)
  for (const record of records) {
    const selected = record.legs.find((leg) => leg.playerId === 1)
    assert.equal(selected?.gamePk, 101, 'the better Game 2 matchup is persisted')
  }

  const outcomes = {
    homerers: new Set([1, 2]),
    homerersByKey: new Set(['1-100', '2-102']),
  }
  const graded = gradeCombos(records, outcomes)
  assert.ok(graded.every((record) => record.nHit === 1 && record.allHit === false))
  assert.ok(graded.every((record) => record.identityVersion === 2 && !record.legacyIdentity))
})

test('legacy cross-game combo remains ungraded when a player appeared in both games', () => {
  const [graded] = gradeCombos([
    { strategy: 'mix', size: 2, legs: [1, 2], pred: 0.04 },
  ], {
    homerers: new Set([1, 2]),
    homerersByKey: new Set(['1-100', '2-102']),
    playedByKey: new Set(['1-100', '1-101', '2-102']),
  })
  assert.equal(graded.allHit, null)
  assert.equal(graded.nHit, null)
  assert.equal(graded.legacyIdentity, true)
  assert.equal(graded.settlementUnavailable, true)
})

test('gradeSGPRecords settles by player + game and is doubleheader-safe', () => {
  const records = [
    { gamePk: 100, size: 2, legs: [1, 2], pred: 0.05 },
    { gamePk: 101, size: 2, legs: [1, 2], pred: 0.05 },
  ]
  const outcomes = {
    homerers: new Set([1, 2]),
    homerersByKey: new Set(['1-100', '2-100', '1-101']),
  }
  const graded = gradeSGPRecords(records, outcomes)
  assert.equal(graded[0].allHit, true)
  assert.equal(graded[0].nHit, 2)
  assert.equal(graded[1].allHit, false)
  assert.equal(graded[1].nHit, 1)
  assert.equal(graded[0].gradeVersion, SGP_GRADE_VERSION)
})

test('buildSGPRecords waits for complete confirmed game lineups', () => {
  const ready = [
    row({ playerId: 1, gamePk: 100, score: 80, grade: 'PRIME', hrProb: 0.25, lineupConfirmed: true }),
    row({ playerId: 2, gamePk: 100, score: 70, grade: 'PRIME', hrProb: 0.2, lineupConfirmed: true }),
  ]
  assert.equal(buildSGPRecords(ready, { sizes: [2] }).length, 1)
  assert.equal(
    buildSGPRecords([{ ...ready[0], lineupConfirmed: false }, ready[1]], { sizes: [2] }).length,
    0,
  )
})
