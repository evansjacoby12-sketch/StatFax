/**
 * blast-model.mjs — the definitive "does blast improve the HR PROBABILITY"
 * test. Fits logistic P(HR) on the model score ALONE vs score + blast, on a
 * time-based split, and compares held-out Brier / LogLoss / AUC. If adding
 * blast lowers Brier/LogLoss and lifts AUC out-of-sample, it improves the
 * probability beyond what the score already knows — the bar for the core model.
 *
 * Blast is the season bat-tracking proxy joined by playerId (same caveat as
 * blast-audit: not game-time blast, synthetic slate). Reuses the lab metrics.
 *
 *   node model-lab/blast-model.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brier, logLoss, auc, baseRate } from './lib/metrics.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = [resolve(__dirname, 'data/backtest-log.json'), resolve(__dirname, '../dist/backtest-log.json')].find(existsSync)
const log = JSON.parse(readFileSync(SRC, 'utf8'))
const YEAR = new Date().getFullYear()

const HEADERS = { 'User-Agent': 'Mozilla/5.0', Referer: 'https://baseballsavant.mlb.com/', Accept: 'text/csv' }
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  const split = (l) => { const o = []; let c = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(c); c = '' } else c += ch } o.push(c); return o }
  const hdr = split(lines[0].replace(/^﻿/, ''))
  return lines.slice(1).map((l) => { const c = split(l); const o = {}; hdr.forEach((h, i) => (o[h] = c[i])); return o })
}
async function fetchSeasonBlast() {
  const res = await fetch(`https://baseballsavant.mlb.com/leaderboard/bat-tracking?minSwings=q&minGroupSwings=1&type=batter&year=${YEAR}&csv=true`, { headers: HEADERS })
  const map = new Map()
  for (const r of parseCSV(await res.text())) {
    const id = Number(r.id ?? r.player_id); const pc = parseFloat(r.blast_per_bat_contact)
    if (id && Number.isFinite(pc)) map.set(id, pc * 100)
  }
  return map
}

const blastMap = await fetchSeasonBlast()
const rows = []
for (const d of log.dates || []) {
  for (const r of log.records?.[d] || []) {
    if (r.actuallyPlayed === false || typeof r.homered !== 'boolean' || !Number.isFinite(r.score)) continue
    const blast = blastMap.get(Number(r.playerId))
    if (blast == null) continue
    rows.push({ date: d, score: r.score, blast, y: r.homered ? 1 : 0 })
  }
}
// Time split: earliest ~70% of days train, latest ~30% test (no leakage).
const days = [...new Set(rows.map((r) => r.date))].sort()
const cut = days[Math.floor(days.length * 0.7)]
const train = rows.filter((r) => r.date < cut), test = rows.filter((r) => r.date >= cut)
console.log(`\nBLAST → PROBABILITY  ·  ${rows.length} rows over ${days.length} days  ·  time split (train <${cut}≤ test)`)
console.log(`train ${train.length} · test ${test.length} · base HR train ${(baseRate(train) * 100).toFixed(1)}% / test ${(baseRate(test) * 100).toFixed(1)}%\n${'─'.repeat(64)}`)

// Standardize on train stats.
const stat = (f) => { const v = train.map((r) => r[f]); const m = v.reduce((s, x) => s + x, 0) / v.length; const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1; return { m, sd } }
const S = { score: stat('score'), blast: stat('blast') }
const z = (r, fs) => fs.map((f) => (r[f] - S[f].m) / S[f].sd)

// Logistic regression — batch GD + small L2 (cribbed from train-logreg).
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
const mBlast = fit(train, ['score', 'blast'])
const evalM = (m) => { const rs = test.map((r) => ({ p: m.predict(r), y: r.y })); return { brier: brier(rs), ll: logLoss(rs), auc: auc(rs) } }
const a = evalM(mBase), c = evalM(mBlast)
const fmt = (m) => `Brier ${m.brier.toFixed(4)}   LogLoss ${m.ll.toFixed(4)}   AUC ${m.auc.toFixed(4)}`
console.log(`score only        ${fmt(a)}`)
console.log(`score + blast     ${fmt(c)}`)
const d = (x, y) => (y - x >= 0 ? '+' : '') + (y - x).toFixed(4)
console.log(`Δ (blast − base)  Brier ${d(a.brier, c.brier)}   LogLoss ${d(a.ll, c.ll)}   AUC ${d(a.auc, c.auc)}`)
console.log(`\nblast weight (standardized): ${mBlast.w[1].toFixed(3)}  (>0 ⇒ more blast → higher HR prob)`)
console.log(`${'─'.repeat(64)}\nLower Brier/LogLoss + higher AUC with blast = it improves the probability\nout-of-sample. Proxy season blast; confirm with game-time blast forward.\n`)
