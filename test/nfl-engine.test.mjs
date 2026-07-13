import test from 'node:test'
import assert from 'node:assert/strict'

import NFL_DEMO_SNAPSHOT from '../src/sports/nfl/data/demoSlate.js'
import { loadNFLSnapshot, mergeNFLLiveUpdate, validateNFLSnapshot } from '../src/sports/nfl/api/NFLService.js'
import { isPropEligible, eligiblePropMarkets } from '../src/sports/nfl/logic/propEligibility.js'
import { scoreNFLProp, scoreNFLSnapshot } from '../src/sports/nfl/logic/ScoringEngine.js'
import { nflStreakSignals } from '../src/sports/nfl/logic/signals.js'
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
  assert.equal(isPropEligible({ ...hill, propLines: { ...hill.propLines, receiving_yards: 14.5 } }, 'receiving_yards'), false)
  assert.equal(isPropEligible({ ...hill, propLines: { ...hill.propLines, receiving_yards: 15 } }, 'receiving_yards'), true)
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
