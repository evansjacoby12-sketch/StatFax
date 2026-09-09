import test from 'node:test'
import assert from 'node:assert/strict'

import snapshot from '../src/sports/nfl/data/demoSlate.js'
import {
  FANTASY_SCORING_PRESETS,
  DEFAULT_ROSTER_SLOTS,
  calculatePlayerFantasyStats,
  calculateFantasyPoints,
  calculatePlayerDistribution,
  enrichPlayerFantasyProfile,
  optimizeFantasyLineup,
  simulateH2HMatchup,
  compareStartSit,
  scoreWaiverTarget,
  parseRosterText,
  generateSlateSpecialUnits,
  evaluateFantasyTrade,
  calculateLiveMatchupStats,
  generateMatchupShareText,
} from '../src/sports/nfl/logic/fantasyEngine.js'

const player = (name) => snapshot.players.find((item) => item.name === name)

test('calculateFantasyPoints computes format-specific scoring (PPR, Half, Standard, TE Premium)', () => {
  const hill = player('Tyreek Hill')
  const laporta = player('Sam LaPorta')

  const pprHill = calculateFantasyPoints(hill, 'ppr')
  const halfHill = calculateFantasyPoints(hill, 'half_ppr')
  const stdHill = calculateFantasyPoints(hill, 'standard')

  assert.ok(pprHill > halfHill, 'PPR points should exceed Half-PPR')
  assert.ok(halfHill > stdHill, 'Half-PPR points should exceed Standard')

  const pprLaPorta = calculateFantasyPoints(laporta, 'ppr')
  const premLaPorta = calculateFantasyPoints(laporta, 'te_premium')
  assert.ok(premLaPorta > pprLaPorta, 'TE Premium should award bonus points for tight ends')
})

test('calculatePlayerDistribution produces valid floor, median, and ceiling bounds', () => {
  const henry = player('Derrick Henry')
  const dist = calculatePlayerDistribution(henry, 'ppr')

  assert.ok(dist.floor > 0, 'Floor must be positive')
  assert.ok(dist.floor <= dist.median, 'Floor must be <= Median')
  assert.ok(dist.median <= dist.ceiling, 'Median must be <= Ceiling')
  assert.ok(dist.stdDev > 0, 'Standard deviation must be positive')
  assert.ok(dist.boomProb >= 0 && dist.boomProb <= 1, 'Boom probability in [0, 1]')
  assert.ok(dist.bustProb >= 0 && dist.bustProb <= 1, 'Bust probability in [0, 1]')
})

test('optimizeFantasyLineup fills required positional slots and maximizes points', () => {
  const roster = [
    player('Josh Allen'),
    player('Derrick Henry'),
    player('Tyreek Hill'),
    player('Sam LaPorta'),
  ].filter(Boolean)

  const result = optimizeFantasyLineup(roster, DEFAULT_ROSTER_SLOTS, 'ppr', 'median')

  assert.ok(result.lineup.length === DEFAULT_ROSTER_SLOTS.reduce((sum, s) => sum + s.count, 0))
  assert.ok(result.totalPoints > 0)
  assert.ok(result.totalCeiling >= result.totalPoints)
  assert.ok(result.totalFloor <= result.totalPoints)

  // Verify QB slot has QB
  const qbSlot = result.lineup.find((item) => item.slot === 'QB')
  assert.equal(qbSlot.player?.position, 'QB')
})

test('simulateH2HMatchup computes win probability, score ranges, and slot differentials', () => {
  const teamA = [
    player('Josh Allen'),
    player('Derrick Henry'),
    player('Tyreek Hill'),
  ].filter(Boolean)

  const teamB = [
    player('Josh Allen'), // mirror
    player('Sam LaPorta'),
  ].filter(Boolean)

  const sim = simulateH2HMatchup(teamA, teamB, 'ppr', 1000)

  assert.ok(sim.winProbA >= 0 && sim.winProbA <= 100)
  assert.ok(sim.winProbB >= 0 && sim.winProbB <= 100)
  assert.ok(Math.abs((sim.winProbA + sim.winProbB) - 100) <= 2, 'Win probabilities sum to ~100%')
  assert.ok(sim.meanScoreA > 0 && sim.meanScoreB > 0)
  assert.ok(sim.floorA <= sim.meanScoreA && sim.meanScoreA <= sim.ceilingA)
  assert.ok(sim.slotBattles.length >= 2)
  assert.ok(sim.strategyAdvice.length > 0)
})

test('compareStartSit provides explicit recommendation and edge breakdown', () => {
  const hill = player('Tyreek Hill')
  const laporta = player('Sam LaPorta')

  const comp = compareStartSit(hill, laporta, 'ppr')

  assert.ok(comp.recommended)
  assert.ok(comp.recommendedDiff >= 0)
  assert.ok(comp.summary.length > 0)
})

test('scoreWaiverTarget prioritizes high opportunity and breakout signals', () => {
  const henry = player('Derrick Henry')
  const scored = scoreWaiverTarget(henry, 'ppr')

  assert.ok(scored.waiverScore > 0)
  assert.ok(['HIGH_PRIORITY', 'TARGET', 'STASH'].includes(scored.breakoutRating))
})

test('parseRosterText accurately parses ESPN copy-paste and unstructured roster text', () => {
  const rawESPN = `
    QB Josh Allen BUF vs MIA
    RB Derrick Henry (Q) - BAL
    WR Tyreek Hill 18.5 pts
    TE Sam LaPorta
    FLEX Unknown Random Guy
  `

  const parsed = parseRosterText(rawESPN, snapshot.players)

  assert.equal(parsed.count, 4)
  assert.ok(parsed.matchedPlayers.some((p) => p.name === 'Josh Allen'))
  assert.ok(parsed.matchedPlayers.some((p) => p.name === 'Derrick Henry'))
  assert.ok(parsed.matchedPlayers.some((p) => p.name === 'Tyreek Hill'))
  assert.ok(parsed.matchedPlayers.some((p) => p.name === 'Sam LaPorta'))
  assert.ok(parsed.unmatched.some((u) => u.includes('Unknown Random Guy')))
})

test('generateSlateSpecialUnits synthesizes D/ST and Kickers for all teams', () => {
  const specialUnits = generateSlateSpecialUnits(snapshot.players)
  assert.ok(specialUnits.length >= 6, 'Should generate D/ST and K for all active teams')

  const balDst = specialUnits.find((u) => u.id === 'dst-bal')
  assert.ok(balDst)
  assert.equal(balDst.position, 'DST')
  assert.equal(balDst.team, 'BAL')

  const pts = calculateFantasyPoints(balDst, 'ppr')
  assert.ok(pts >= 4.0 && pts <= 15.0, `D/ST points ${pts} should fall in realistic 4-15 range`)

  const balK = specialUnits.find((u) => u.id === 'k-bal')
  assert.ok(balK)
  assert.equal(balK.position, 'K')
  assert.equal(balK.name, 'Justin Tucker')

  const kPts = calculateFantasyPoints(balK, 'ppr')
  assert.ok(kPts >= 5.0 && kPts <= 14.0, `Kicker points ${kPts} should fall in realistic 5-14 range`)
})

test('simulateH2HMatchup detects D/ST vs Opponent offensive clashes and RB-D/ST script synergy', () => {
  const specialUnits = generateSlateSpecialUnits(snapshot.players)
  const balDst = specialUnits.find((u) => u.id === 'dst-bal')

  const teamA = [
    player('Josh Allen'),
    player('Derrick Henry'),
    balDst,
  ].filter(Boolean)

  const teamB = [
    player('Sam LaPorta'),
  ].filter(Boolean)

  const sim = simulateH2HMatchup(teamA, teamB, 'ppr', 1000)
  assert.ok(sim.correlations.some((c) => c.title.includes('Lead Script Synergy')), 'Should detect Derrick Henry + BAL D/ST synergy')
})

test('evaluateFantasyTrade evaluates weekly point impact and produces trade grade', () => {
  const currentRoster = [
    player('Derrick Henry'),
    player('Sam LaPorta'),
  ].filter(Boolean)

  const giving = [player('Sam LaPorta')].filter(Boolean)
  const receiving = [player('Tyreek Hill')].filter(Boolean)

  const evalResult = evaluateFantasyTrade(giving, receiving, currentRoster, DEFAULT_ROSTER_SLOTS, 'ppr')

  assert.ok(evalResult.pointDelta > 0, 'Receiving Tyreek Hill for LaPorta in PPR should increase starting points')
  assert.ok(['A+', 'A', 'B'].includes(evalResult.grade))
  assert.ok(evalResult.summary.length > 0)
})

test('calculateLiveMatchupStats computes live points and PMR during game action', () => {
  const teamA = [player('Derrick Henry')].filter(Boolean)
  const teamB = [player('Josh Allen')].filter(Boolean)

  const liveStats = calculateLiveMatchupStats(teamA, teamB, 'ppr')

  assert.ok(liveStats.pmrA >= 0)
  assert.ok(liveStats.pmrB >= 0)
  assert.ok(liveStats.projFinalA > 0)
  assert.ok(liveStats.projFinalB > 0)
})

test('generateMatchupShareText creates shareable league chat breakdown', () => {
  const teamA = [player('Josh Allen'), player('Derrick Henry')].filter(Boolean)
  const teamB = [player('Tyreek Hill'), player('Sam LaPorta')].filter(Boolean)
  const sim = simulateH2HMatchup(teamA, teamB, 'ppr', 500)

  const shareText = generateMatchupShareText(sim, 'Dynasty Kings', 'Gridiron Gurus', 'ppr')

  assert.ok(shareText.includes('Dynasty Kings'))
  assert.ok(shareText.includes('Gridiron Gurus'))
  assert.ok(shareText.includes('Projected Score'))
  assert.ok(shareText.includes('Strategy Coach'))
})

