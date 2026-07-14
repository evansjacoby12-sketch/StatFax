/**
 * Offline model evaluation on dist/backtest-log.json.
 *
 * Reports the metrics that actually matter for an HR-prop model:
 *   - Discrimination: AUC + top-decile lift (how well the ranking separates
 *     HR from no-HR). This is THE model-quality number; it can only improve by
 *     changing the score, not the calibration.
 *   - Calibration: Brier + log-loss vs the base-rate baseline, and temporal CV
 *     comparison of calibration methods (isotonic vs logistic/Platt)
 *     so we can graduate whichever generalizes best.
 *   - Reliability by score decile.
 *
 *   node server/tools/model-metrics.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fitIsotonicAdaptive, lookupProb } from '../../src/sports/mlb/logic/isotonicCalibration.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG = path.resolve(__dirname, '..', '..', 'dist', 'backtest-log.json')

const log = JSON.parse(fs.readFileSync(LOG, 'utf8'))
const records = log.records || {}
const rows = []
for (const date of Object.keys(records)) {
  for (const r of records[date]) {
    if (r.actuallyPlayed !== false && Number.isFinite(r.score) && (r.homered === true || r.homered === false)) {
      rows.push({ date, score: r.score, y: r.homered ? 1 : 0, sim: r.simHRProb ?? null, feat: r.feat ?? null })
    }
  }
}
const N = rows.length
const base = rows.reduce((s, r) => s + r.y, 0) / N

const clamp = (p) => Math.max(1e-6, Math.min(1 - 1e-6, p))
const brier = (rs, pf) => rs.reduce((s, r) => s + (pf(r) - r.y) ** 2, 0) / rs.length
const logloss = (rs, pf) => -rs.reduce((s, r) => { const p = clamp(pf(r)); return s + (r.y * Math.log(p) + (1 - r.y) * Math.log(1 - p)) }, 0) / rs.length

// AUC via Mann–Whitney U (ties handled by averaging ranks).
function auc(rs, sf) {
  const pos = rs.filter((r) => r.y === 1).map(sf)
  const neg = rs.filter((r) => r.y === 0).map(sf)
  if (!pos.length || !neg.length) return NaN
  const all = rs.map((r) => ({ v: sf(r), y: r.y })).sort((a, b) => a.v - b.v)
  let i = 0, rankSum = 0
  while (i < all.length) {
    let j = i
    while (j < all.length && all[j].v === all[i].v) j++
    const avgRank = (i + 1 + j) / 2
    for (let k = i; k < j; k++) if (all[k].y === 1) rankSum += avgRank
    i = j
  }
  return (rankSum - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length)
}

// Expanding-window folds: every validation date is later than its training set.
function temporalFolds(rs, foldCount = 5) {
  const dates = [...new Set(rs.map((row) => row.date))].sort()
  const firstTest = Math.max(2, Math.floor(dates.length / 2))
  const testDates = dates.slice(firstTest)
  const blockSize = Math.max(1, Math.ceil(testDates.length / foldCount))
  const folds = []
  for (let start = 0; start < testDates.length; start += blockSize) {
    const block = new Set(testDates.slice(start, start + blockSize))
    const firstBlockDate = testDates[start]
    const train = rs.filter((row) => row.date < firstBlockDate)
    const test = rs.filter((row) => block.has(row.date))
    if (train.length && test.length) folds.push({ train, test })
  }
  return folds
}

// --- Calibration methods (fit on train → predict prob) ---
function isotonicCal(train) {
  const records = {}
  for (const row of train) (records[row.date] ||= []).push({ score: row.score, homered: !!row.y })
  const sub = { dates: Object.keys(records).sort(), records }
  const { table } = fitIsotonicAdaptive(sub, { lookbackDays: 9999 })
  return (r) => lookupProb(r.score, table, (s) => Math.max(0.005, Math.min(0.3, 0.025 + s * 0.0015)))
}
function logisticCal(train) {
  // Standardize score, fit sigmoid(a + b*z) by gradient descent.
  const mean = train.reduce((s, r) => s + r.score, 0) / train.length
  const sd = Math.sqrt(train.reduce((s, r) => s + (r.score - mean) ** 2, 0) / train.length) || 1
  const trainBase = train.reduce((sum, row) => sum + row.y, 0) / train.length
  let a = Math.log(trainBase / (1 - trainBase)), b = 0
  const lr = 0.1
  for (let it = 0; it < 4000; it++) {
    let ga = 0, gb = 0
    for (const r of train) {
      const z = (r.score - mean) / sd
      const p = 1 / (1 + Math.exp(-(a + b * z)))
      ga += p - r.y
      gb += (p - r.y) * z
    }
    a -= (lr * ga) / train.length
    b -= (lr * gb) / train.length
  }
  return (r) => 1 / (1 + Math.exp(-(a + b * ((r.score - mean) / sd))))
}

function cv(method) {
  const folds = temporalFolds(rows)
  let bSum = 0, llSum = 0, n = 0
  for (const { train, test } of folds) {
    const pf = method(train)
    bSum += brier(test, pf) * test.length
    llSum += logloss(test, pf) * test.length
    n += test.length
  }
  return { brier: bSum / n, logloss: llSum / n, n, folds: folds.length }
}

// --- Report ---
console.log(`\nbacktest-log: ${N} records · ${rows.filter((r) => r.y).length} HR · base rate ${(base * 100).toFixed(2)}%\n`)

console.log('DISCRIMINATION (ranking quality — depends on the score, not calibration):')
const scoreAuc = auc(rows, (r) => r.score)
console.log(`  AUC (model score):           ${scoreAuc.toFixed(4)}`)
// top-decile lift
const sorted = rows.slice().sort((a, b) => b.score - a.score)
const topN = Math.round(N * 0.1)
const topRate = sorted.slice(0, topN).reduce((s, r) => s + r.y, 0) / topN
console.log(`  Top-decile HR rate:          ${(topRate * 100).toFixed(1)}%  (lift ${(topRate / base).toFixed(2)}× vs base)`)
const top5 = sorted.slice(0, Math.round(N * 0.05))
console.log(`  Top-5% HR rate:              ${((top5.reduce((s, r) => s + r.y, 0) / top5.length) * 100).toFixed(1)}%`)

console.log('\nCALIBRATION (expanding-window validation — lower is better):')
const baseB = brier(rows, () => base), baseLL = logloss(rows, () => base)
console.log(`  Baseline (base rate):        Brier ${baseB.toFixed(4)}  LogLoss ${baseLL.toFixed(4)}`)
const iso = cv(isotonicCal)
console.log(`  Isotonic candidate:          Brier ${iso.brier.toFixed(4)}  LogLoss ${iso.logloss.toFixed(4)}  n=${iso.n}`)
const lr = cv(logisticCal)
console.log(`  Logistic / Platt:            Brier ${lr.brier.toFixed(4)}  LogLoss ${lr.logloss.toFixed(4)}  n=${lr.n}`)
const better = lr.brier < iso.brier - 0.0003 ? 'PLATT' : 'ISOTONIC'
console.log(`  → deployed selector: ${better} (0.0003 Brier promotion margin)\n`)

console.log('RELIABILITY by score decile (predicted band → observed):')
const byScore = rows.slice().sort((a, b) => a.score - b.score)
for (let d = 0; d < 10; d++) {
  const seg = byScore.slice(Math.floor((d * N) / 10), Math.floor(((d + 1) * N) / 10))
  if (!seg.length) continue
  const lo = seg[0].score, hi = seg[seg.length - 1].score
  const obs = seg.reduce((s, r) => s + r.y, 0) / seg.length
  console.log(`  score ${String(lo).padStart(3)}-${String(hi).padEnd(3)} (n=${String(seg.length).padStart(4)}): ${(obs * 100).toFixed(1)}%`)
}

const withFeat = rows.filter((r) => r.feat)
console.log(`\nfeature vectors available: ${withFeat.length} / ${N} (needed to improve discrimination via a learned model)`)
