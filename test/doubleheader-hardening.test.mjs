import test from 'node:test'
import assert from 'node:assert/strict'

import { summarizeSlateBrief } from '../server/slate-brief.mjs'
import { buildComboRecords, gradeCombos } from '../server/parlay-combos.mjs'
import { uniqueScoredBatters } from '../ui/src/lib/data.js'
import { gradeTicket } from '../ui/src/lib/ticketMath.js'
import { ticketId } from '../ui/src/lib/ticketIdentity.js'

const comboRow = (overrides = {}) => ({
  playerId: 1,
  gamePk: 100,
  name: 'Doubleheader Bat',
  team: 'NYY',
  score: 60,
  grade: 'STRONG',
  hrProb: 0.18,
  heat: 50,
  heatMult: 1,
  barrel: 8,
  recentBarrel: null,
  blast: null,
  pitcherHr9: 1,
  air: 1,
  ...overrides,
})

test('doubleheader identity survives slate, brief, combo, ticket, and outcome handling', () => {
  const games = [
    { gamePk: 100, gameNumber: 1, awayTeam: { abbr: 'NYY' }, homeTeam: { abbr: 'BOS' }, venueName: 'Test Park' },
    { gamePk: 101, gameNumber: 2, awayTeam: { abbr: 'NYY' }, homeTeam: { abbr: 'BOS' }, venueName: 'Test Park' },
    { gamePk: 102, awayTeam: { abbr: 'LAD' }, homeTeam: { abbr: 'SF' }, venueName: 'Bay Park' },
  ]
  const scoredBatters = {
    '1-100': { playerId: 1, gamePk: 100, name: 'Doubleheader Bat', team: 'NYY', score: 60, grade: 'STRONG', hrProbability: 0.18, pitcher: { name: 'Game One Arm' } },
    '1-101': { playerId: 1, gamePk: 101, name: 'Doubleheader Bat', team: 'NYY', score: 90, grade: 'PRIME', hrProbability: 0.28, pitcher: { name: 'Game Two Arm' } },
    '2-102': { playerId: 2, gamePk: 102, name: 'Other Bat', team: 'LAD', score: 80, grade: 'PRIME', hrProbability: 0.24, pitcher: { name: 'Bay Arm' } },
  }

  assert.deepEqual(uniqueScoredBatters(scoredBatters).map((row) => row.gamePk), [100, 101, 102])
  const brief = summarizeSlateBrief({ games, scoredBatters }, [])
  assert.ok(brief.leaders.some((leader) => leader.id === 'player:1:100'))
  assert.equal(brief.leaders[0].id, 'player:1:101')
  assert.equal(brief.leaders[0].pitcher, 'Game Two Arm')

  const records = buildComboRecords([
    comboRow(),
    comboRow({ gamePk: 101, score: 90, grade: 'PRIME', hrProb: 0.28 }),
    comboRow({ playerId: 2, gamePk: 102, name: 'Other Bat', score: 80, grade: 'PRIME', hrProb: 0.24 }),
  ], { sizes: [2] })
  assert.ok(records.length > 0)
  assert.ok(records.every((record) => record.legs.some((leg) => leg.playerId === 1 && leg.gamePk === 101)))

  const outcomes = {
    homerers: new Set([1, 2]),
    homerersByKey: new Set(['1-100', '2-102']),
  }
  assert.ok(gradeCombos(records, outcomes).every((record) => record.allHit === false))

  const firstId = ticketId([{ playerId: 1, gamePk: 100 }], '2026-07-16')
  const secondId = ticketId([{ playerId: 1, gamePk: 101 }], '2026-07-16')
  assert.notEqual(firstId, secondId)
  const ticket = { legs: [{ playerId: 1, gamePk: 101 }, { playerId: 2, gamePk: 102 }] }
  const gradedTicket = gradeTicket(ticket, [
    { playerId: 1, gamePk: 100, homeredThisGame: true, game: { isFinal: true } },
    { playerId: 1, gamePk: 101, homeredThisGame: false, game: { isFinal: true } },
    { playerId: 2, gamePk: 102, homeredThisGame: true, game: { isFinal: true } },
  ])
  assert.equal(gradedTicket.status, 'dead')
  assert.deepEqual(gradedTicket.legs.map((leg) => leg.code), ['dead', 'hit'])
})
