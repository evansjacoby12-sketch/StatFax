/**
 * blast-audit.mjs — does BLAST rate (Statcast bat tracking) actually predict
 * HRs, and does it add lift WITHIN grade (the decisive test — a signal that
 * just reselects good bats earns nothing new)? Mirrors badge-audit.mjs.
 *
 * The logged backtest records never carried blast (the field is new), so we
 * reconstruct it: pull the CURRENT season bat-tracking leaderboard and join
 * blast% onto each reconciled outcome by playerId. Season bat tracking is
 * slowly varying, so it's a fair proxy for the ~2 weeks the log spans. This is
 * a screen, not the final word — a positive read here graduates to logging
 * blast in the live feature vector and re-auditing forward.
 *
 *   node model-lab/blast-audit.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCES = [resolve(__dirname, 'data/backtest-log.json'), resolve(__dirname, '../dist/backtest-log.json')]
const logPath = SOURCES.find(existsSync)
if (!logPath) { console.error('No backtest-log.json — run `npm run slate` first.'); process.exit(1) }
const log = JSON.parse(readFileSync(logPath, 'utf8'))
const YEAR = new Date().getFullYear()

const SAVANT_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Referer: 'https://baseballsavant.mlb.com/',
  Accept: 'text/csv, text/plain, */*',
}
// Minimal CSV parse (quoted fields w/ commas — names are "Last, First").
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  const split = (l) => {
    const out = []; let cur = '', q = false
    for (const ch of l) {
      if (ch === '"') q = !q
      else if (ch === ',' && !q) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur); return out
  }
  const hdr = split(lines[0].replace(/^﻿/, ''))
  return lines.slice(1).map((line) => {
    const c = split(line); const o = {}; hdr.forEach((h, i) => (o[h] = c[i])); return o
  })
}
async function fetchSeasonBlast() {
  const url = `https://baseballsavant.mlb.com/leaderboard/bat-tracking?minSwings=q&minGroupSwings=1&type=batter&year=${YEAR}&csv=true`
  const res = await fetch(url, { headers: SAVANT_HEADERS })
  if (!res.ok) throw new Error(`savant ${res.status}`)
  const rows = parseCSV(await res.text())
  const map = new Map()
  for (const r of rows) {
    const id = Number(r.id ?? r.player_id)
    if (!id) continue
    const pc = parseFloat(r.blast_per_bat_contact)
    const ps = parseFloat(r.blast_per_swing)
    map.set(id, { blastPerContact: Number.isFinite(pc) ? pc * 100 : null, blastPerSwing: Number.isFinite(ps) ? ps * 100 : null })
  }
  return map
}

const pct = (x) => (x * 100).toFixed(1) + '%'
const rate = (rs) => (rs.length ? rs.reduce((s, r) => s + r.hr, 0) / rs.length : 0)
function waldZ(rsA, rsB) {
  const nA = rsA.length, nB = rsB.length
  if (!nA || !nB) return 0
  const xA = rsA.reduce((s, r) => s + r.hr, 0), xB = rsB.reduce((s, r) => s + r.hr, 0)
  const p = (xA + xB) / (nA + nB)
  const se = Math.sqrt(p * (1 - p) * (1 / nA + 1 / nB))
  return se === 0 ? 0 : (xA / nA - xB / nB) / se
}

const blastMap = await fetchSeasonBlast()
console.log(`pulled season blast for ${blastMap.size} batters`)

// Flatten reconciled outcomes, attach blast by playerId. Drop scratches + bats
// with no bat-tracking sample (can't judge them).
const rows = []
for (const d of log.dates || []) {
  for (const r of log.records?.[d] || []) {
    if (r.actuallyPlayed === false || typeof r.homered !== 'boolean') continue
    const bt = blastMap.get(Number(r.playerId))
    if (!bt || bt.blastPerContact == null) continue
    rows.push({ grade: r.grade || 'SKIP', hr: r.homered ? 1 : 0, blast: bt.blastPerContact })
  }
}
if (rows.length < 30) { console.error(`only ${rows.length} joined rows — too few to read.`); process.exit(1) }

const base = rate(rows)
const ELITE = 25
console.log(`\nBLAST AUDIT — ${rows.length} reconciled bats w/ bat tracking · base HR ${pct(base)} · blast = blasts/squared-up-contact %\n${'─'.repeat(72)}`)

// 1) Tertiles — monotonic? (does HR rate climb with blast?)
const sorted = [...rows].sort((a, b) => a.blast - b.blast)
const t = Math.floor(sorted.length / 3)
const buckets = [['low', sorted.slice(0, t)], ['mid', sorted.slice(t, 2 * t)], ['high', sorted.slice(2 * t)]]
console.log('\nTERTILE  (HR rate by blast bucket — should rise low→high)')
for (const [name, rs] of buckets) {
  const lo = Math.min(...rs.map((r) => r.blast)).toFixed(0), hi = Math.max(...rs.map((r) => r.blast)).toFixed(0)
  console.log(`  ${name.padEnd(5)} blast ${lo}-${hi}%  HR ${pct(rate(rs)).padStart(7)}  (n${rs.length})`)
}

// 2) Univariate: elite blaster (>=25%) vs rest + Wald z.
const withK = rows.filter((r) => r.blast >= ELITE)
const without = rows.filter((r) => r.blast < ELITE)
console.log(`\nUNIVARIATE  (blast ≥ ${ELITE}% vs below)`)
console.log(`  elite ${pct(rate(withK))} (n${withK.length})  ·  rest ${pct(rate(without))} (n${without.length})  ·  lift ${(rate(without) ? rate(withK) / rate(without) : 0).toFixed(2)}  ·  z ${waldZ(withK, without).toFixed(1)}`)

// 3) Within-grade MEDIAN SPLIT — the decisive, properly-powered test. Inside
//    each grade, split bats at that grade's median blast (top vs bottom half).
//    If the top half still homers more, blast carries signal the GRADE doesn't
//    already capture — i.e. it earns a feature slot. Halving keeps n usable.
console.log('\nWITHIN-GRADE  (top-half vs bottom-half blast INSIDE each grade; +pts = blast adds lift the grade misses)')
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
for (const g of ['PRIME', 'STRONG', 'LEAN', 'SKIP']) {
  const inG = rows.filter((r) => r.grade === g)
  if (inG.length < 20) { console.log(`   ${g.padEnd(7)} (only n${inG.length} — too thin)`); continue }
  const med = median(inG.map((r) => r.blast))
  const hi = inG.filter((r) => r.blast >= med), lo = inG.filter((r) => r.blast < med)
  if (hi.length < 5 || lo.length < 5) { console.log(`   ${g.padEnd(7)} (split too thin)`); continue }
  const diff = (rate(hi) - rate(lo)) * 100
  console.log(`   ${g.padEnd(7)} ${diff >= 0 ? '+' : ''}${diff.toFixed(1)}pts   hi-blast ${pct(rate(hi))}(n${hi.length})  lo-blast ${pct(rate(lo))}(n${lo.length})  med ${med.toFixed(0)}%  z ${waldZ(hi, lo).toFixed(1)}`)
}

// 4) Correlation of blast with HR, and continuous slope per +10% blast.
const mb = rows.reduce((s, r) => s + r.blast, 0) / rows.length
const mh = base
let cov = 0, vb = 0
for (const r of rows) { cov += (r.blast - mb) * (r.hr - mh); vb += (r.blast - mb) ** 2 }
const slopePer10 = vb ? (cov / vb) * 10 * 100 : 0
console.log(`\nSLOPE  ~${slopePer10 >= 0 ? '+' : ''}${slopePer10.toFixed(1)} HR-rate pts per +10% blast (raw, uncontrolled)`)
console.log(`\n${'─'.repeat(72)}\nProxy audit (season blast on ${log.dates?.length || 0} logged days). A clean positive WITHIN-GRADE\nsignal earns blast a feature slot; a flat/negative one says keep it display-only.\n`)
