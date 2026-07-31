import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { nflSeasonYear, selectCurrentNFLSlate } from './providers/espn.mjs'
import { summarizeNFLTracking, updateNFLTracking } from './tracking.mjs'

const basePlayer = {
  id: 'rehearsal-rb', espnId: '1', gameId: 'rehearsal-game', kickoffAt: '2026-09-10T00:00:00Z',
  name: 'Rehearsal Runner', position: 'RB', team: 'BUF', opponent: 'MIA',
  projections: { rushingYards: 61 },
  markets: { anytime_td: { probability: .42, odds: null }, rushing_yards: { probability: .58, projection: 61, line: 49.5, odds: null } },
}

export function runNFLGameDayRehearsal() {
  const events = [
    { id: 'w1', season: 2026, seasonType: 'regular-season', week: 1, date: '2026-09-04T00:00:00Z', status: { state: 'post' } },
    { id: 'w2', season: 2026, seasonType: 'regular-season', week: 2, date: '2026-09-10T00:00:00Z', status: { state: 'pre' } },
  ]
  assert.equal(selectCurrentNFLSlate(events, new Date('2026-09-08T12:00:00Z'))[0].id, 'w2')
  assert.equal(nflSeasonYear(new Date('2027-01-10T00:00:00Z')), 2026)
  const pre = { generatedAt: '2026-09-09T12:00:00Z', meta: { season: 2026, week: 'Week 2' }, players: [{ ...basePlayer, live: { isLive: false, isFinal: false, stats: {} } }] }
  const live = { ...pre, generatedAt: '2026-09-10T01:00:00Z', players: [{ ...basePlayer, live: { isLive: true, isFinal: false, stats: { rushingYards: 31, totalTds: 1 } } }] }
  const final = { ...pre, generatedAt: '2026-09-10T04:00:00Z', players: [{ ...basePlayer, live: { isLive: false, isFinal: true, firstTdKnown: true, isFirstTdScorer: false, stats: { rushingYards: 73, totalTds: 1 } } }] }
  let tracking = updateNFLTracking({}, null, pre, new Date(pre.generatedAt))
  tracking = updateNFLTracking(tracking, pre, live, new Date(live.generatedAt))
  tracking = updateNFLTracking(tracking, live, final, new Date(final.generatedAt))
  const summary = summarizeNFLTracking(tracking)
  assert.equal(summary.open, 0)
  assert.equal(summary.settled, 2)
  assert.equal(summary.markets.anytime_td.hitRate, 1)
  assert.equal(summary.markets.rushing_yards.samples, 1)
  return { ok: true, scenarios: ['automatic-week-rollover', 'january-season-resolution', 'pregame-freeze', 'live-update', 'final-settlement'], tracking: { open: summary.open, settled: summary.settled } }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(runNFLGameDayRehearsal(), null, 2))
