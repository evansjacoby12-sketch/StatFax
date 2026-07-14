/**
 * matchup-model.mjs — does pitcher MATCHUP (opposing HR/9) add HR-predictive
 * signal BEYOND the model score? i.e. is matchup under-weighted in the engine?
 * The score already folds matchup in; this asks whether layering phr9 on top
 * improves out-of-sample prediction (it shouldn't, if matchup is well-weighted).
 *
 * Uses the LOGGED game-time feat.phr9 — not a proxy. Mirrors blast-model.mjs:
 * logistic P(HR) on score vs score+phr9, time-split, Brier/LogLoss/AUC, plus a
 * within-grade tertile lift.
 *
 *   node model-lab/matchup-model.mjs
 */
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brier, logLoss, auc, baseRate } from './lib/metrics.mjs'
import { loadFreshestBacktest } from './lib/loadBacktest.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const { log, path: SRC, coverage } = loadFreshestBacktest([
  resolve(__dirname, 'data/backtest-log.json'),
  resolve(__dirname, '../dist/backtest-log.json'),
])
console.log(`[data] ${SRC} · latest ${coverage.latestDate} · ${coverage.days} day(s) via ${coverage.source}`)

const rows = []
for (const d of log.dates || []) {
  for (const r of log.records?.[d] || []) {
    if (r.actuallyPlayed === false || typeof r.homered !== 'boolean') continue
    if (!r.feat || !Number.isFinite(r.feat.phr9) || !Number.isFinite(r.score)) continue
    rows.push({ date: d, score: r.score, phr9: r.feat.phr9, grade: r.grade || 'SKIP', y: r.homered ? 1 : 0 })
  }
}
const days = [...new Set(rows.map((r) => r.date))].sort()
const cut = days[Math.floor(days.length * 0.7)]
const train = rows.filter((r) => r.date < cut), test = rows.filter((r) => r.date >= cut)
console.log(`\nMATCHUP → PROBABILITY  ·  ${rows.length} rows over ${days.length} days  ·  time split (train <${cut}≤ test)`)
console.log(`train ${train.length} · test ${test.length} · base HR ${(baseRate(test) * 100).toFixed(1)}%\n${'─'.repeat(64)}`)

const stat = (f) => { const v = train.map((r) => r[f]); const m = v.reduce((s, x) => s + x, 0) / v.length; const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1; return { m, sd } }
const S = { score: stat('score'), phr9: stat('phr9') }
const z = (r, fs) => fs.map((f) => (r[f] - S[f].m) / S[f].sd)
function fit(rowsTr, feats, { iters = 4000, lr = 0.1, l2 = 1e-3 } = {}) {
  const X = rowsTr.map((r) => z(r, feats)), y = rowsTr.map((r) => r.y)
  let w = feats.map(() => 0), b = 0
  const sig = (t) => 1 / (1 + Math.exp(-t))
  for (let it = 0; it < iters; it++) {
    const gw = w.map(() => 0); let gb = 0
    for (let i = 0; i < X.length; i++) {
      const p = sig(b + X[i].reduce((s, x, j) => s + x * w[j], 0))
      const e = p - y[i]; gb += e; for (let j = 0; j < w.length; j++) gw[j] += e * X[i][j]
    }
    b -= lr * gb / X.length; for (let j = 0; j < w.length; j++) w[j] -= lr * (gw[j] / X.length + l2 * w[j])
  }
  return { w, b, feats, predict: (r) => sig(b + z(r, feats).reduce((s, x, j) => s + x * w[j], 0)) }
}

const mBase = fit(train, ['score'])
const mMix = fit(train, ['score', 'phr9'])
const evalM = (m) => { const rs = test.map((r) => ({ p: m.predict(r), y: r.y })); return { brier: brier(rs), ll: logLoss(rs), auc: auc(rs) } }
const a = evalM(mBase), c = evalM(mMix)
const fmt = (m) => `Brier ${m.brier.toFixed(4)}   LogLoss ${m.ll.toFixed(4)}   AUC ${m.auc.toFixed(4)}`
const dd = (x, y) => (y - x >= 0 ? '+' : '') + (y - x).toFixed(4)
console.log(`score only        ${fmt(a)}`)
console.log(`score + phr9      ${fmt(c)}`)
console.log(`Δ (matchup − base) Brier ${dd(a.brier, c.brier)}   LogLoss ${dd(a.ll, c.ll)}   AUC ${dd(a.auc, c.auc)}`)
console.log(`\nphr9 weight (standardized): ${mMix.w[1].toFixed(3)}  (>0 ⇒ matchup adds HR signal the score misses → under-weighted)`)

// Within-grade tertile lift — does HR rate rise with matchup INSIDE each tier?
const rate = (rs) => (rs.length ? rs.reduce((s, r) => s + r.y, 0) / rs.length : 0)
console.log('\nWITHIN-GRADE  (HR rate by opposing HR/9 tertile, inside each grade)')
for (const g of ['PRIME', 'STRONG', 'LEAN', 'SKIP']) {
  const inG = rows.filter((r) => r.grade === g)
  if (inG.length < 30) { console.log(`  ${g.padEnd(7)} (only n${inG.length})`); continue }
  const s = [...inG].sort((x, y) => x.phr9 - y.phr9); const t = Math.floor(s.length / 3)
  const lo = s.slice(0, t), hi = s.slice(2 * t)
  console.log(`  ${g.padEnd(7)} low-HR/9 ${(rate(lo) * 100).toFixed(1)}% (≤${lo[lo.length - 1].phr9.toFixed(2)}) → high-HR/9 ${(rate(hi) * 100).toFixed(1)}% (≥${hi[0].phr9.toFixed(2)})  Δ ${((rate(hi) - rate(lo)) * 100 >= 0 ? '+' : '')}${((rate(hi) - rate(lo)) * 100).toFixed(1)}pts`)
}
console.log(`\n${'─'.repeat(64)}\nΔ improves + phr9 weight >0 + within-grade Δ positive = matchup is under-weighted\n(up-weight it). All ~0 = it's already well-captured by the score.\n`)
