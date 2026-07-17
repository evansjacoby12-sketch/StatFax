import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  LIST_BUILDER_PARLAY_EVIDENCE_MIN_SAMPLE,
  auditListBuilderParlayPool,
  buildListBuilderParlays,
  createSeededRandom,
  normalizeListBuilderParlayEvidence,
  randomizeListBuilderParlays,
  wilsonInterval95,
} from '../ui/src/lib/list-builder-parlays.js'

function match(overrides = {}) {
  const playerId = overrides.playerId ?? 1
  const gamePk = overrides.gamePk ?? 100
  const batter = {
    id: overrides.id ?? `${playerId}-${gamePk}`,
    playerId,
    gamePk,
    name: overrides.name ?? `Player ${playerId}`,
    team: overrides.team ?? 'TST',
    opponent: { abbr: overrides.opponent ?? 'OPP' },
    grade: { label: overrides.grade ?? 'PRIME' },
    score: overrides.score ?? 80,
    hrProbability: Object.hasOwn(overrides, 'hrProbability') ? overrides.hrProbability : 0.2,
    game: overrides.game ?? { gamePk, isLive: false, isFinal: false, status: 'Scheduled' },
    lineupConfirmed: overrides.lineupConfirmed ?? false,
    battingOrder: overrides.battingOrder ?? null,
    dataTrust: overrides.dataTrust,
  }
  return { batter, evaluation: { fitScore: overrides.fitScore ?? 90 } }
}

test('parlay pool accepts projected hitters but rejects every hard eligibility failure', () => {
  const projected = match({ playerId: 1, gamePk: 1, lineupConfirmed: false })
  const rows = [
    projected,
    match({ playerId: 2, gamePk: 2, grade: 'LEAN' }),
    match({ playerId: 3, gamePk: 3, hrProbability: null }),
    match({ playerId: 4, gamePk: 4, score: NaN }),
    match({ playerId: 5, gamePk: 5, game: { gamePk: 5, isLive: true, isFinal: false } }),
    match({ playerId: 6, gamePk: 6, dataTrust: { status: 'review' } }),
    match({ playerId: 7, gamePk: 7, lineupConfirmed: true, battingOrder: null }),
  ]
  const audit = auditListBuilderParlayPool(rows)
  assert.deepEqual(audit.eligible.map((candidate) => candidate.playerKey), ['1'])
  assert.equal(audit.excluded.grade, 1)
  assert.equal(audit.excluded.projection, 1)
  assert.equal(audit.excluded.score, 1)
  assert.equal(audit.excluded.pregame, 1)
  assert.equal(audit.excluded.dataTrust, 1)
  assert.equal(audit.excluded.notStarting, 1)
})

test('engine supports 2/3/4 legs only when enough distinct players and games exist', () => {
  const rows = [1, 2, 3, 4].map((playerId) => match({ playerId, gamePk: 100 + playerId }))
  const engine = buildListBuilderParlays(rows, { size: 4 })
  assert.deepEqual(engine.supportedSizes, [2, 3, 4])
  assert.ok(engine.combinations.length > 0)

  const short = buildListBuilderParlays(rows.slice(0, 2), { size: 4 })
  assert.deepEqual(short.supportedSizes, [2])
  assert.equal(short.combinations.length, 0)
})

test('best curated ranking uses the exact independent product of the shown legs', () => {
  const rows = [
    match({ playerId: 1, gamePk: 1, hrProbability: 0.25 }),
    match({ playerId: 2, gamePk: 2, hrProbability: 0.2 }),
    match({ playerId: 3, gamePk: 3, hrProbability: 0.15 }),
  ]
  const engine = buildListBuilderParlays(rows, { size: 2 })
  assert.deepEqual(engine.curated[0].legs.map((leg) => leg.playerKey), ['1', '2'])
  assert.ok(Math.abs(engine.curated[0].allHit - 0.05) < 1e-12)
  assert.equal(engine.curated[0].weakest.playerKey, '2')
})

test('doubleheader rows can never duplicate a player or a game inside one parlay', () => {
  const rows = [
    match({ id: '7-101', playerId: 7, gamePk: 101, hrProbability: 0.3 }),
    match({ id: '7-102', playerId: 7, gamePk: 102, hrProbability: 0.29 }),
    match({ playerId: 8, gamePk: 101, hrProbability: 0.22 }),
    match({ playerId: 9, gamePk: 103, hrProbability: 0.21 }),
    match({ playerId: 10, gamePk: 104, hrProbability: 0.2 }),
  ]
  const engine = buildListBuilderParlays(rows, { size: 3 })
  for (const combo of engine.combinations) {
    assert.equal(new Set(combo.legs.map((leg) => leg.playerKey)).size, combo.size)
    assert.equal(new Set(combo.legs.map((leg) => leg.gameKey)).size, combo.size)
  }
})

test('best and random curated outputs cap a player at two of three displayed tickets', () => {
  const rows = [1, 2, 3, 4, 5, 6].map((playerId) => match({
    playerId,
    gamePk: 200 + playerId,
    hrProbability: 0.3 - playerId * 0.01,
  }))
  const engine = buildListBuilderParlays(rows, { size: 2 })
  for (const cards of [engine.curated, randomizeListBuilderParlays(engine, createSeededRandom(44))]) {
    const exposure = new Map()
    for (const combo of cards) {
      for (const leg of combo.legs) exposure.set(leg.playerKey, (exposure.get(leg.playerKey) || 0) + 1)
    }
    assert.ok([...exposure.values()].every((count) => count <= 2))
  }
})

test('Random curated is deterministic by seed and cannot leave the qualified top pool', () => {
  const rows = [1, 2, 3, 4, 5, 6, 7].map((playerId) => match({
    playerId,
    gamePk: 300 + playerId,
    hrProbability: 0.31 - playerId * 0.01,
  }))
  const engine = buildListBuilderParlays(rows, { size: 3 })
  const first = randomizeListBuilderParlays(engine, createSeededRandom(90210))
  const second = randomizeListBuilderParlays(engine, createSeededRandom(90210))
  assert.deepEqual(first.map((combo) => combo.signature), second.map((combo) => combo.signature))
  const allowed = new Set(engine.randomPool.map((combo) => combo.signature))
  assert.ok(first.every((combo) => allowed.has(combo.signature)))
  assert.ok(engine.randomPool.every((combo) => combo.allHit >= engine.combinations[0].allHit * 0.8))
})

test('recipe evidence requires a real sample and supplies a 95% interval', () => {
  const valid = normalizeListBuilderParlayEvidence({ hits: 20, sample: 100, hitRate: 99 }, { label: 'Power surge' })
  assert.equal(valid.valid, true)
  assert.equal(valid.hitRate, 20)
  assert.equal(valid.sample, 100)
  assert.ok(valid.confidence95.low < 20)
  assert.ok(valid.confidence95.high > 20)

  const collecting = normalizeListBuilderParlayEvidence({ hits: 5, sample: LIST_BUILDER_PARLAY_EVIDENCE_MIN_SAMPLE - 1 })
  assert.equal(collecting.valid, false)
  assert.equal(collecting.hitRate, null)
  assert.equal(collecting.confidence95, null)

  assert.equal(wilsonInterval95(4, 0), null)
})
