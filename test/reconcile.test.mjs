import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reconcileOutcomes, extractPredictionRecord } from '../server/reconcile.mjs'

// Outcome sets shaped the way fetchHomerersForDate now returns them: bare
// playerId sets (combo scorecard) + composite `playerId-gamePk` sets (per-batter).
const outcomes = ({ homer = [], play = [], homerKeys = [], playKeys = [] }) => ({
  homerers: new Set(homer),
  played: new Set(play),
  homerersByKey: new Set(homerKeys),
  playedByKey: new Set(playKeys),
})

test('doubleheader: a HR in game 1 does NOT mark the game-2 prediction homered', () => {
  // Same playerId 100 across two games; homered only in game 1. The OLD bare-
  // playerId join marked BOTH rows homered (the calibration up-bias bug).
  const preds = [
    { playerId: 100, gamePk: 1, score: 70 },
    { playerId: 100, gamePk: 2, score: 70 },
  ]
  const out = outcomes({
    homer: [100], play: [100],
    homerKeys: ['100-1'], playKeys: ['100-1', '100-2'],
  })
  const r = reconcileOutcomes(preds, out)
  assert.equal(r[0].homered, true, 'game 1 row homered')
  assert.equal(r[1].homered, false, 'game 2 row did NOT homer')
  assert.equal(r[0].actuallyPlayed, true)
  assert.equal(r[1].actuallyPlayed, true)
})

test('single game: composite join marks the homer', () => {
  const preds = [{ playerId: 5, gamePk: 42, score: 80 }]
  const out = outcomes({ homer: [5], play: [5], homerKeys: ['5-42'], playKeys: ['5-42'] })
  const r = reconcileOutcomes(preds, out)
  assert.equal(r[0].homered, true)
  assert.equal(r[0].actuallyPlayed, true)
})

test('scratch: predicted but never batted → played=false, homered=false (survivorship)', () => {
  const preds = [{ playerId: 9, gamePk: 7, score: 65 }]
  const out = outcomes({})
  const r = reconcileOutcomes(preds, out)
  assert.equal(r[0].homered, false)
  assert.equal(r[0].actuallyPlayed, false)
})

test('legacy record without gamePk falls back to bare-playerId join', () => {
  const preds = [{ playerId: 100, score: 70 }] // pre-fix log row, no gamePk
  const out = outcomes({ homer: [100], play: [100], homerKeys: ['100-1'], playKeys: ['100-1'] })
  const r = reconcileOutcomes(preds, out)
  assert.equal(r[0].homered, true, 'legacy join uses the bare-playerId set')
  assert.equal(r[0].actuallyPlayed, true)
})

test('extractPredictionRecord carries gamePk and logs hot/homeEdge in feat', () => {
  const rec = extractPredictionRecord({
    playerId: 1, gamePk: 99, name: 'X', score: 70, preGameScore: 72,
    grade: { label: 'STRONG' }, hot: true, homeEdge: true, due: false,
  })
  assert.equal(rec.gamePk, 99)
  assert.equal(rec.feat.hot, 1)
  assert.equal(rec.feat.he, 1)
  assert.equal(rec.score, 72, 'logs the frozen preGameScore, not the live score')
})
