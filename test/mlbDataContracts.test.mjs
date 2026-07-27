import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateBacktestLog, validateDailySnapshot } from '../server/lib/mlbDataContracts.mjs'
import {
  CLEAN_PREGAME_FEATURE_CAPTURE,
  CLEAN_PREGAME_FEATURE_GENERATION,
  buildHistoricalFeatureCoverage,
  normalizeHistoricalFeatureVector,
} from '../server/lib/historicalFeatureArchive.mjs'
import { buildPitcherContactLeak } from '../src/sports/mlb/logic/pitcherContactLeak.js'

const batter = (playerId = 1, gamePk = 10) => ({
  playerId,
  gamePk,
  score: 72,
  hrProbability: 0.18,
  grade: { label: 'PRIME' },
})

test('daily contract accepts schema-v5 composite rows and canonical K output', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': batter() },
    stats: { scoredBatters: 1 },
    kDistByPitcher: {
      '50-10': {
        k: 6.1, lo: 3, hi: 9, lambda: 6.1, expIP: 5.7, expBF: 23,
        adjustedKRate: 0.28, calibration: 0.86, volumeSource: 'recent-pitches-bf',
        trend: 'up', conf: 'high', modelVersion: 2, probs: { 5.5: 0.59 },
      },
    },
  }
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])
})

test('daily contract validates de-vigged MLB game markets', () => {
  const price = (american, decimal, impliedProbability, fairProbability) => ({
    american, decimal, impliedProbability, fairProbability,
  })
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': batter() },
    stats: { scoredBatters: 1 },
    gameOdds: {
      10: {
        books: {
          fanduel: {
            moneyline: {
              away: price(120, 2.2, 1 / 2.2),
              home: price(-140, 1.714, 1 / 1.714),
            },
          },
        },
        consensus: {
          moneyline: {
            books: 1,
            away: price(120, 2.2, 1 / 2.2, 0.438),
            home: price(-140, 1.714, 1 / 1.714, 0.562),
          },
          total: null,
        },
      },
    },
  }
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])

  snapshot.gameOdds[10].consensus.moneyline.home.fairProbability = 0.8
  assert.ok(validateDailySnapshot(snapshot).errors.some((error) => error.includes('fair probabilities must sum to 1')))
})

test('daily contract rejects the retired bare alias and invalid probability', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { 1: { ...batter(), hrProbability: 1.4 } },
    stats: { scoredBatters: 1 },
  }
  const check = validateDailySnapshot(snapshot)
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => error.includes('expected composite key 1-10')))
  assert.ok(check.errors.some((error) => error.includes('hrProbability')))
})

test('daily contract validates attached Pitcher Contact Leak evidence', () => {
  const pitcherContactLeak = buildPitcherContactLeak({
    batSide: 'L',
    pitcher: {
      hand: 'R',
      season: { ip: 100, goAo: 0.7, kPer9: 7 },
      savant: { hardHitPctAllowed: 44, barrelPctAllowed: 10, exitVeloAgainst: 91 },
      splits: { vl: { bf: 180, iso: 0.22, hrPer9: 1.7 } },
    },
  })
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: { '1-10': { ...batter(), pitcherContactLeak } },
    stats: { scoredBatters: 1 },
  }
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])
  snapshot.scoredBatters['1-10'].pitcherContactLeak.qualifies = false
  assert.ok(validateDailySnapshot(snapshot).errors.some((error) => error.includes('qualifies')))
})

test('daily contract rejects team, side, and opposing-starter identity contradictions', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-14',
    generatedAt: '2026-07-14T12:00:00.000Z',
    finishedAt: '2026-07-14T12:00:01.000Z',
    games: [{
      gamePk: 10,
      awayTeam: { id: 1 },
      homeTeam: { id: 2 },
      awayPitcher: { id: 50 },
      homePitcher: { id: 60 },
    }],
    scoredBatters: {
      '1-10': {
        ...batter(), teamId: 1, isHome: true, pitcher: { id: 50 },
      },
      '2-10': {
        ...batter(2), teamId: 999, isHome: false, pitcher: { id: 60 },
      },
    },
    stats: { scoredBatters: 2 },
  }
  const check = validateDailySnapshot(snapshot)
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => error.includes('isHome: contradicts teamId')))
  assert.ok(check.errors.some((error) => error.includes('pitcher.id: expected opposing starter 60')))
  assert.ok(check.errors.some((error) => error.includes('teamId: does not belong to game')))
})

test('daily contract permits only explicit live pregame-freeze pitcher corrections', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-25',
    generatedAt: '2026-07-25T23:50:00.000Z',
    finishedAt: '2026-07-25T23:50:01.000Z',
    games: [{
      gamePk: 10,
      isLive: true,
      awayTeam: { id: 1 },
      homeTeam: { id: 2 },
      awayPitcher: { id: 50, name: 'Away Arm' },
      homePitcher: { id: 60, name: 'Corrected Starter' },
    }],
    scoredBatters: {
      '1-10': {
        ...batter(),
        teamId: 1,
        isHome: false,
        pitcher: { id: 55, name: 'Prediction Starter' },
        currentPitcher: { id: 60, name: 'Corrected Starter' },
        pitcherChanged: true,
        pitcherProvenance: 'pregame-freeze',
      },
    },
    stats: { scoredBatters: 1 },
  }

  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])

  const unmarked = structuredClone(snapshot)
  delete unmarked.scoredBatters['1-10'].pitcherProvenance
  assert.ok(validateDailySnapshot(unmarked).errors.some((error) => error.includes('expected opposing starter 60')))

  const pregame = structuredClone(snapshot)
  pregame.games[0].isLive = false
  assert.ok(validateDailySnapshot(pregame).errors.some((error) => error.includes('expected opposing starter 60')))

  const wrongCorrection = structuredClone(snapshot)
  wrongCorrection.scoredBatters['1-10'].currentPitcher.id = 61
  assert.ok(validateDailySnapshot(wrongCorrection).errors.some((error) => error.includes('expected opposing starter 60')))
})

test('daily contract identity-binds a frozen pregame prediction record', () => {
  const snapshot = {
    version: 5,
    date: '2026-07-25',
    generatedAt: '2026-07-25T23:50:00.000Z',
    finishedAt: '2026-07-25T23:50:01.000Z',
    games: [{ gamePk: 10 }],
    scoredBatters: {
      '1-10': {
        ...batter(),
        preGamePredictionRecord: {
          featureCapture: CLEAN_PREGAME_FEATURE_CAPTURE,
          featureGeneration: CLEAN_PREGAME_FEATURE_GENERATION,
          featureVersion: 2,
          feat: normalizeHistoricalFeatureVector({}),
          pitchTypes: [],
          playerId: 1,
          gamePk: 10,
          name: 'Batter',
          score: 72,
          grade: 'PRIME',
          badges: [],
          lineupConfirmed: true,
          dataTrusted: true,
          simHRProb: 0.12,
          zoneEvidence: null,
          contactLeakEvidence: null,
        },
      },
    },
    stats: { scoredBatters: 1 },
  }
  assert.deepEqual(validateDailySnapshot(snapshot).errors, [])

  snapshot.scoredBatters['1-10'].preGamePredictionRecord.gamePk = 11
  const invalid = validateDailySnapshot(snapshot)
  assert.equal(invalid.ok, false)
  assert.ok(invalid.errors.some((error) => error.includes('preGamePredictionRecord.gamePk')))
})

test('backtest contract enforces operational/archive caps and synchronization', () => {
  const row = {
    playerId: 1, gamePk: 10, score: 70, homered: false, actuallyPlayed: true,
    grade: 'STRONG', badges: [], simHRProb: 0.12, feat: { bs: 60 },
  }
  const log = {
    dates: ['2026-07-13'],
    records: { '2026-07-13': [row] },
    modelHistory: { version: 1, dates: ['2026-07-13'], records: { '2026-07-13': [row] } },
    kProps: { estByDate: {}, resultsByDate: {} },
  }
  assert.deepEqual(validateBacktestLog(log).errors, [])

  const broken = structuredClone(log)
  broken.modelHistory.dates = []
  const check = validateBacktestLog(broken)
  assert.equal(check.ok, false)
  assert.ok(check.errors.some((error) => error.includes('missing operational date')))
})

test('backtest contract verifies schema-v2 features and the derived coverage summary', () => {
  const row = {
    playerId: 1, gamePk: 10, score: 70, homered: false, actuallyPlayed: true,
    featureVersion: 2,
    feat: normalizeHistoricalFeatureVector({ bspd: 75, blast: 20, sq: 24 }),
    pitchTypes: [['ff', 55, 0.48, 21]],
  }
  const modelHistory = { version: 1, dates: ['2026-07-15'], records: { '2026-07-15': [row] } }
  const log = {
    dates: ['2026-07-15'], records: { '2026-07-15': [row] }, modelHistory,
    featureArchive: buildHistoricalFeatureCoverage(modelHistory),
  }
  assert.deepEqual(validateBacktestLog(log).errors, [])

  const incomplete = structuredClone(log)
  delete incomplete.modelHistory.records['2026-07-15'][0].feat.xslg
  assert.ok(validateBacktestLog(incomplete).errors.some((error) => error.includes('feat.xslg: missing')))

  const tampered = structuredClone(log)
  tampered.featureArchive.schemaV2Rows = 99
  assert.ok(validateBacktestLog(tampered).errors.some((error) => error.includes('featureArchive: inconsistent')))
})

test('backtest contract tolerates pre-gamePk legacy rows but still rejects composite duplicates', () => {
  const legacy = { playerId: 1, gamePk: null, score: 50, homered: false, actuallyPlayed: true, feat: null }
  const composite = { playerId: 2, gamePk: 20, score: 60, homered: false, actuallyPlayed: true, feat: { bs: 50 } }
  const log = {
    dates: ['2026-06-01'],
    records: { '2026-06-01': [legacy, legacy, composite, composite] },
    modelHistory: {
      version: 1,
      dates: ['2026-06-01'],
      records: { '2026-06-01': [legacy, legacy, composite, composite] },
    },
  }
  const check = validateBacktestLog(log)
  assert.ok(check.warnings.some((warning) => warning.includes('legacy row')))
  assert.equal(check.errors.filter((error) => error.includes('duplicate 2-20')).length, 2)
  assert.equal(check.errors.some((error) => error.includes('duplicate 1-legacy')), false)
})
