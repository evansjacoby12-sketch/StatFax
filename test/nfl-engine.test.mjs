import test from 'node:test'
import assert from 'node:assert/strict'

import NFL_DEMO_SNAPSHOT from '../src/sports/nfl/data/demoSlate.js'
import { loadNFLSnapshot, mergeNFLLiveUpdate, validateNFLSnapshot } from '../src/sports/nfl/api/NFLService.js'
import { isPropEligible, eligiblePropMarkets } from '../src/sports/nfl/logic/propEligibility.js'
import { scoreNFLProp, scoreNFLSnapshot } from '../src/sports/nfl/logic/ScoringEngine.js'
import { assessNFLSignals, buildNFLSignals, nflStreakSignals } from '../src/sports/nfl/logic/signals.js'
import { nflWeatherImpact } from '../src/sports/nfl/logic/weather.js'

const player = (name) => NFL_DEMO_SNAPSHOT.players.find((item) => item.name === name)

test('eligibility enforces positions and exact minimum lines', () => {
  const allen = player('Josh Allen')
  const hill = player('Tyreek Hill')
  assert.equal(isPropEligible(allen, 'passing_yards'), true)
  assert.equal(isPropEligible(hill, 'passing_yards'), false)
  assert.equal(isPropEligible(hill, 'receptions'), true)
  assert.equal(isPropEligible(hill, 'receiving_yards'), true)
  assert.equal(isPropEligible(hill, 'rushing_yards'), true)
  assert.ok(eligiblePropMarkets(allen).some((market) => market.id === 'passing_rushing_yards'))
  assert.equal(isPropEligible({ ...hill, propLines: { ...hill.propLines, receiving_yards: 149.5 } }, 'receiving_yards'), false)
  assert.equal(isPropEligible({ ...hill, propLines: { ...hill.propLines, receiving_yards: 150 } }, 'receiving_yards'), true)
})

test('2+ TD probability uses multi-score math and remains below Anytime TD', () => {
  const henry = player('Derrick Henry')
  const anytime = scoreNFLProp(henry, 'anytime_td')
  const twoPlus = scoreNFLProp(henry, 'two_plus_td')
  assert.equal(twoPlus.eligible, true)
  assert.ok(twoPlus.probability > 0)
  assert.ok(twoPlus.probability < anytime.probability)
  assert.notEqual(twoPlus.probability, anytime.probability)
})

test('unpriced NFL markets stay null and use market-specific grade bands', () => {
  const henry = player('Derrick Henry')
  const unpriced = { ...henry, markets: { ...henry.markets, anytime_td: { ...henry.markets.anytime_td, odds: null, probability: .4 } } }
  const result = scoreNFLProp(unpriced, 'anytime_td')
  assert.equal(result.odds, null)
  assert.equal(result.implied, null)
  assert.notEqual(result.grade, 'SKIP')
})

test('weather adjustments are small and market-specific', () => {
  const weather = { roof: 'outdoor', tempF: 55, windMph: 22, precipProbability: 70 }
  assert.ok(nflWeatherImpact(weather, 'passing_yards').factor < 1)
  assert.ok(nflWeatherImpact(weather, 'rushing_yards').factor > 1)
  assert.equal(nflWeatherImpact({ roof: 'dome' }, 'passing_yards').factor, 1)
})

test('streak badges cover touchdown, reception, passing, rushing, and receiving production', () => {
  const signals = nflStreakSignals({ recentGames: [
    { season: 2025, week: 2, totalTds: 1, receptions: 5, passingYards: 240, rushingYards: 55, receivingYards: 80 },
    { season: 2025, week: 1, totalTds: 2, receptions: 4, passingYards: 210, rushingYards: 42, receivingYards: 65 },
  ] })
  assert.deepEqual(new Set(signals.map((signal) => signal.key)), new Set(['touchdown', 'receptions', 'passing', 'rushing', 'receiving']))
})

test('role, efficiency, matchup, and verified tracking badges use decision-grade thresholds', () => {
  const signals = buildNFLSignals({
    position: 'RB',
    usage: { endZoneTargetsL3: 3, endZoneTargetShare: .5, goalLineTouchesL3: 4, goalToGoOpportunitiesL3: 7, goalToGoOpportunityShare: .7, airYardsShare: .36 },
    lineup: {
      carryShare: .48,
      offensiveLine: { passProtectionFactor: .9 },
      opponentDefense: { trackingVerified: true, pressureRate: .31, quickPressureRate: .27 },
      tracking: { verified: true, scoringDriveParticipation: .84, yacAboveExpectationPerReception: 1.8, rushingYardsOverExpectedPerAttempt: .7, averageSeparation: 3.4 },
    },
    defenseVsPosition: { percentile: .8, factors: { rushing_yards: 1.06 } },
    recentGames: [
      { season: 2025, week: 6, carries: 17, targets: 4 }, { season: 2025, week: 5, carries: 16, targets: 5 },
      { season: 2025, week: 4, carries: 8, targets: 2 }, { season: 2025, week: 3, carries: 7, targets: 3 },
      { season: 2025, week: 2, carries: 8, targets: 2 }, { season: 2025, week: 1, carries: 7, targets: 3 },
    ],
  })
  const keys = new Set(signals.map((signal) => signal.key))
  for (const key of ['end-zone-alpha', 'goal-to-go-dominator', 'opportunity-spike', 'drive-participation', 'committee-risk', 'defense-funnel', 'air-yards-leader', 'yac-creator', 'rushing-over-expected', 'separation-edge', 'protection-mismatch', 'quick-pressure-risk']) assert.ok(keys.has(key), key)
  assert.equal(signals[0].tone, 'bad')
})

test('tracking-only badges stay dormant until the source is verified', () => {
  const signals = buildNFLSignals({ position: 'WR', lineup: { tracking: { verified: false, scoringDriveParticipation: 1, yacAboveExpectationPerReception: 9, averageSeparation: 9 } } })
  assert.equal(signals.some((signal) => ['drive-participation', 'yac-creator', 'separation-edge'].includes(signal.key)), false)
})

test('declining opportunity creates a negative scoring-role signal', () => {
  const signals = buildNFLSignals({ position: 'WR', recentGames: [
    { season: 2025, week: 6, targets: 4 }, { season: 2025, week: 5, targets: 5 },
    { season: 2025, week: 4, targets: 12 }, { season: 2025, week: 3, targets: 13 },
    { season: 2025, week: 2, targets: 12 }, { season: 2025, week: 1, targets: 11 },
  ] })
  assert.ok(signals.some((signal) => signal.key === 'scoring-role-lost' && signal.tone === 'bad'))
})

test('QB keeper threat requires repeated red-zone rushing work', () => {
  const signals = buildNFLSignals({ position: 'QB', usage: { goalLineTouchesL3: 3 } })
  assert.ok(signals.some((signal) => signal.key === 'qb-keeper-threat'))
})

test('signal assessment labels risk clearly and sorts every red flag first', () => {
  const signals = buildNFLSignals({
    position: 'WR',
    usage: { targetShare: .31, redZoneTargetsL3: 6 },
    lineup: { restrictions: { snapLimit: .55 } },
  })
  const firstNonAvoid = signals.findIndex((signal) => signal.assessment !== 'avoid')
  assert.ok(firstNonAvoid > 0)
  assert.ok(signals.slice(0, firstNonAvoid).every((signal) => signal.assessment === 'avoid'))
  assert.equal(signals[0].key, 'snap-limit')
  assert.equal(signals[0].tone, 'bad')
  assert.equal(assessNFLSignals(signals).label, 'Be wary')
})

test('assessment uses explicit positive, caution, and avoid-read-first language', () => {
  assert.equal(assessNFLSignals([{ key: 'target-share', tone: 'strong' }]).label, 'Positive')
  assert.equal(assessNFLSignals([{ key: 'split', tone: 'warn' }]).label, 'Caution')
  assert.equal(assessNFLSignals([{ key: 'committee-risk', tone: 'bad' }, { key: 'scoring-role-lost', tone: 'bad' }]).label, 'Avoid · read first')
})

test('snapshot scoring returns only eligible players in score order', () => {
  const passers = scoreNFLSnapshot(NFL_DEMO_SNAPSHOT, 'passing_yards')
  assert.deepEqual(passers.map((item) => item.position), ['QB'])
  assert.ok(passers.every((item, index) => index === 0 || passers[index - 1].model.score >= item.model.score))
})

test('live stats are blended with remaining expectation', () => {
  const henry = player('Derrick Henry')
  const live = scoreNFLProp(henry, 'rushing_yards')
  const pregame = scoreNFLProp({ ...henry, live: { isLive: false, stats: {} } }, 'rushing_yards')
  assert.ok(live.mean > pregame.mean)
  assert.ok(live.probability > pregame.probability)
})

test('service validates, falls back to demo, and merges live updates', async () => {
  assert.equal(validateNFLSnapshot(NFL_DEMO_SNAPSHOT), NFL_DEMO_SNAPSHOT)
  assert.throws(() => validateNFLSnapshot({ sport: 'nfl' }), /Invalid NFL snapshot/)
  const fallback = await loadNFLSnapshot({ fetchImpl: async () => { throw new Error('offline') } })
  assert.equal(fallback.source.mode, 'demo')
  const original = player('Josh Allen')
  const merged = mergeNFLLiveUpdate(NFL_DEMO_SNAPSHOT, { players: [{ id: original.id, live: { isLive: true, stats: { completions: 12, attempts: 16 } } }] })
  const updated = merged.players.find((item) => item.id === original.id)
  assert.equal(updated.live.stats.completions, 12)
  assert.equal(updated.live.stats.attempts, 16)
})

test('QB cards have completions and attempts projections', () => {
  const allen = player('Josh Allen')
  assert.ok(allen.projections.completions > 0)
  assert.ok(allen.projections.attempts > allen.projections.completions)
})

test('unapplied lineup factors change scoring while pipeline-adjusted projections are not doubled', () => {
  const henry = player('Derrick Henry')
  const boosted = scoreNFLProp({ ...henry, lineup: { marketFactors: { rushing_yards: 1.2 } } }, 'rushing_yards')
  const adjusted = scoreNFLProp({ ...henry, lineup: { projectionAdjusted: true, marketFactors: { rushing_yards: 1.2 } } }, 'rushing_yards')
  const baseline = scoreNFLProp(henry, 'rushing_yards')
  assert.ok(boosted.mean > baseline.mean)
  assert.equal(adjusted.mean, baseline.mean)
})

test('live observed snaps and routes override pregame deployment after a real sample', () => {
  const henry = player('Derrick Henry')
  const basePlayer = { ...henry, lineup: { expectedSnapShare: .7, routesPerDropback: .4, projectionAdjusted: true, marketFactors: {} }, live: { ...henry.live, observedSnaps: 8 } }
  const baseline = scoreNFLProp(basePlayer, 'rushing_yards')
  const expanded = scoreNFLProp({ ...basePlayer, live: { ...basePlayer.live, observedSnapShare: .9 } }, 'rushing_yards')
  assert.ok(expanded.mean > baseline.mean)
})
