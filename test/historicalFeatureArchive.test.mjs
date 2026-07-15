import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  HISTORICAL_FEATURE_KEYS,
  buildHistoricalFeatureCoverage,
  compactHistoricalPitchTypes,
  normalizeHistoricalFeatureVector,
  validateHistoricalFeatureRecord,
} from '../server/lib/historicalFeatureArchive.mjs'
import { compactModelRecord } from '../server/reconcile.mjs'
import { FEAT_KEYS } from '../server/models/featModel.mjs'

test('schema-v2 normalization is complete, numeric, and null-safe', () => {
  const feat = normalizeHistoricalFeatureVector({ bspd: 75.1239, blast: 22, xslg: Number.NaN, invented: 99 })
  assert.deepEqual(Object.keys(feat), [...HISTORICAL_FEATURE_KEYS])
  assert.equal(feat.bspd, 75.124)
  assert.equal(feat.blast, 22)
  assert.equal(feat.xslg, null)
  assert.equal('invented' in feat, false)
})

test('pitch-type rows are compact, bounded, deduplicated, and usage-sorted', () => {
  const rows = compactHistoricalPitchTypes([
    { key: 'SL', usage: 35.1239, slg: 0.51, whiff: 38.2 },
    { key: 'ff', usage: 51, slg: 0.44, whiff: 22 },
    { key: 'sl', usage: 20, slg: 0.9, whiff: 50 },
    { key: 'bad pitch', usage: 99, slg: 0.1, whiff: 1 },
  ])
  assert.deepEqual(rows, [['ff', 51, 0.44, 22], ['sl', 35.124, 0.51, 38.2]])
  assert.deepEqual(compactHistoricalPitchTypes(rows), rows, 'compaction is idempotent for archived tuples')
})

test('coverage distinguishes prospective schema-v2 rows from honest legacy history', () => {
  const complete = normalizeHistoricalFeatureVector({
    bspd: 75, blast: 22, sq: 24,
    mxev: 112, ss: 36, xiso: 0.25, xslg: 0.52, rev: 91,
    prera: 4.8, prhr9: 1.7, prk9: 7.8,
    pm: 8, arse: 2, stuff: 1, zone: 1, mixf: 1, piso: 0.5,
  })
  const legacy = { mxev: 110, ss: 34, xiso: 0.22, xslg: 0.49, rev: 90 }
  const history = {
    dates: ['2026-07-14', '2026-07-15'],
    records: {
      '2026-07-14': [
        { actuallyPlayed: true, feat: legacy },
        { actuallyPlayed: true, feat: null },
      ],
      '2026-07-15': [
        { actuallyPlayed: true, featureVersion: 2, feat: complete, pitchTypes: [['ff', 50, 0.5, 20]] },
        { actuallyPlayed: false, featureVersion: 2, feat: complete, pitchTypes: [['ff', 50, 0.5, 20]] },
      ],
    },
  }
  const coverage = buildHistoricalFeatureCoverage(history)
  assert.equal(coverage.population, 3, 'scratches are excluded from readiness coverage')
  assert.equal(coverage.schemaV2Rows, 1)
  assert.equal(coverage.legacyRows, 1)
  assert.equal(coverage.missingFeatureRows, 1)
  assert.equal(coverage.firstSchemaV2Date, '2026-07-15')
  assert.deepEqual(coverage.groups.battedBall, { available: 2, coverage: 0.6667 })
  assert.deepEqual(coverage.groups.batTracking, { available: 1, coverage: 0.3333 })
  assert.deepEqual(coverage.groups.pitchTypes, { available: 1, coverage: 0.3333 })
  assert.deepEqual(coverage.fields.xiso, { available: 2, coverage: 0.6667 })
  assert.deepEqual(coverage.fields.bspd, { available: 1, coverage: 0.3333 })
})

test('legacy compaction never invents unavailable schema-v2 history', () => {
  const compact = compactModelRecord({
    playerId: 7, gamePk: 70, score: 75, homered: false, actuallyPlayed: true,
    feat: { xiso: 0.24, mxev: 110 },
  })
  assert.equal(compact.featureVersion, 1)
  assert.deepEqual(compact.feat, { xiso: 0.24, mxev: 110 })
  assert.equal('xslg' in compact.feat, false)
  assert.deepEqual(compact.pitchTypes, [])
})

test('schema-v2 validator rejects incomplete vectors and malformed pitch rows', () => {
  const feat = normalizeHistoricalFeatureVector({ bspd: 74 })
  delete feat.xslg
  const errors = validateHistoricalFeatureRecord({
    featureVersion: 2,
    feat,
    pitchTypes: [['ff', 40, 0.5, 20], ['sl', 50, 0.4, 30]],
  }, 'row')
  assert.ok(errors.some((error) => error.includes('feat.xslg: missing')))
  assert.ok(errors.some((error) => error.includes('sorted by usage descending')))
})

test('slate persistence refreshes feature coverage even when no game settles', () => {
  const source = readFileSync(new URL('../server/fetch-slate.mjs', import.meta.url), 'utf8')
  const refresh = source.indexOf('backtestLog = syncModelHistory(backtestLog)')
  const persist = source.indexOf('writeFileSync(BACKTEST_OUT_PATH, JSON.stringify(backtestLog))')
  assert.ok(refresh > 0)
  assert.ok(persist > refresh)
})

test('new archive fields remain outside production feature scoring', () => {
  for (const key of ['bspd', 'blast', 'sq', 'xslg', 'prhr9', 'mrf', 'mcf']) {
    assert.equal(FEAT_KEYS.includes(key), false, `${key} must stay archive-only until held-out validation`)
  }
})
