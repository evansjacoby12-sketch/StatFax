import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  appendToLog,
  extractPredictionRecord,
  mergeModelHistories,
  reconcileOutcomes,
  syncModelHistory,
} from '../server/reconcile.mjs'

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

test('extractPredictionRecord freezes the complete schema-v2 feature archive', () => {
  const rec = extractPredictionRecord({
    playerId: 1, gamePk: 99, name: 'X', score: 70, preGameScore: 72,
    grade: { label: 'STRONG' }, hot: true, homeEdge: true, due: false,
    lineupConfirmed: true, dataTrust: { status: 'review' },
    pullPct: 46.2,
    xStats: { xISO: 0.28, xSLG: 0.54 },
    batTracking: {
      batSpeed: 75.1234, blastPct: 14, blastPerContact: 18.2,
      recentBlastPct: 20, recentBlastPerContact: 24.4, recentSwings: 30,
      squaredUpPct: 22.3, hardSwingPct: 19, vsHandBlast: 21,
      vsHandSwings: 40, vsMixBlast: 20.5, vsMixCoverage: 0.8,
    },
    pitcher: {
      season: { hrPer9: 1.4, era: 4.2, kPer9: 8.1 },
      recentForm: { games: 5, ip: 27.1, era: 5.1, hrPer9: 2.0, k9: 7.4, pitchesL3D: 12 },
    },
    matchupSignals: { arsenalEdge: 3, stuffEdge: -1, zoneFactor: 2, mixFactor: 1, pitchISOAdj: 0.5, recentForm: 6, contactFactor: 4 },
    pitchTypeSplits: [
      { key: 'ff', usage: 35, slg: 0.5, whiff: 22 },
      { key: 'sl', usage: 45, slg: 0.42, whiff: 36 },
    ],
  })
  assert.equal(rec.gamePk, 99)
  assert.equal(rec.featureVersion, 2)
  assert.equal(rec.feat.hot, 1)
  assert.equal(rec.feat.he, 1)
  assert.equal(rec.feat.bspd, 75.123)
  assert.equal(rec.feat.blast, 24.4, 'freezes the exact recent-sample List Builder blast gate')
  assert.equal(rec.feat.sq, 22.3)
  assert.equal(rec.feat.xiso, 0.28)
  assert.equal(rec.feat.xslg, 0.54)
  assert.equal(rec.feat.pull, 46.2)
  assert.equal(rec.feat.prera, 5.1)
  assert.equal(rec.feat.prhr9, 2)
  assert.equal(rec.feat.prk9, 7.4)
  assert.equal(rec.feat.mrf, 6)
  assert.equal(rec.feat.mcf, 4)
  assert.deepEqual(rec.pitchTypes, [['sl', 45, 0.42, 36], ['ff', 35, 0.5, 22]])
  assert.equal(rec.score, 72, 'logs the frozen preGameScore, not the live score')
  assert.equal(rec.lineupConfirmed, true)
  assert.equal(rec.dataTrusted, false, 'mirrors the List Builder clean-data gate')
})

test('appendToLog keeps 30 operational days and a compact 180-day model archive', () => {
  let log = { dates: [], records: {} }
  for (let day = 1; day <= 35; day++) {
    const date = new Date(Date.UTC(2026, 4, day)).toISOString().slice(0, 10)
    log = appendToLog(log, date, [{
      playerId: day,
      gamePk: 1000 + day,
      name: `Player ${day}`,
      score: 50 + day,
      homered: day % 5 === 0,
      actuallyPlayed: true,
      grade: 'LEAN',
      badges: ['hot'],
      simHRProb: 0.15,
      feat: { bs: day },
    }])
  }
  assert.equal(log.dates.length, 30)
  assert.equal(log.modelHistory.dates.length, 35)
  const archived = log.modelHistory.records['2026-05-01'][0]
  assert.deepEqual(Object.keys(archived).sort(), [
    'actuallyPlayed', 'badges', 'dataTrusted', 'feat', 'featureVersion', 'gamePk', 'grade', 'homered',
    'lineupConfirmed', 'pitchTypes', 'playerId', 'score', 'simHRProb',
  ])
  assert.equal(archived.name, undefined)
  assert.equal(archived.featureVersion, 1, 'legacy vectors remain explicitly legacy')
  assert.equal(archived.feat.bs, 1)
  assert.deepEqual(archived.pitchTypes, [])
  assert.equal(archived.simHRProb, 0.15)
  assert.equal(log.featureArchive.schemaVersion, 2)
  assert.equal(log.featureArchive.schemaV2Rows, 0)
  assert.equal(log.featureArchive.legacyRows, 35)
})

test('syncModelHistory propagates repaired outcomes and merges older archives', () => {
  const log = {
    dates: ['2026-06-02'],
    records: {
      '2026-06-02': [{ playerId: 7, gamePk: 70, score: 80, homered: true, actuallyPlayed: true, feat: { bs: 80 } }],
    },
    modelHistory: {
      version: 1,
      dates: ['2026-06-01', '2026-06-02'],
      records: {
        '2026-06-01': [{ playerId: 1, gamePk: 10, score: 60, homered: false, actuallyPlayed: true, feat: { bs: 60 } }],
        '2026-06-02': [{ playerId: 7, gamePk: 70, score: 80, homered: false, actuallyPlayed: false, feat: { bs: 80 } }],
      },
    },
  }
  const synced = syncModelHistory(log)
  assert.deepEqual(synced.modelHistory.dates, ['2026-06-01', '2026-06-02'])
  assert.equal(synced.modelHistory.records['2026-06-02'][0].homered, true)
  assert.equal(synced.modelHistory.records['2026-06-02'][0].actuallyPlayed, true)

  const merged = mergeModelHistories(
    synced.modelHistory,
    { dates: ['2026-06-03'], records: { '2026-06-03': [] } },
  )
  assert.deepEqual(merged.dates, ['2026-06-01', '2026-06-02', '2026-06-03'])
})
