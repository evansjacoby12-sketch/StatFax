/**
 * badge-audit.mjs — the "lie detector" for signals. For every badge/flag the
 * engine sets, it checks whether holders actually homer MORE than non-holders,
 * both overall and WITHIN each grade (the decisive test — it conditions on the
 * tier, so a signal that just selects weaker bats can't hide behind it). This is
 * the instrument that caught the "Due" bonus (due bats homered LESS, and inside
 * PRIME hit 32% vs 46% for grademates). Re-run as reconciled days accrue:
 *
 *   npm run lab:audit
 *
 * Reads model-lab/data/backtest-log.json (pulled) or dist/backtest-log.json
 * (local). Each reconciled record carries { grade, badges:[...], homered,
 * actuallyPlayed }, logged by server/reconcile.mjs.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SOURCES = [resolve(__dirname, 'data/backtest-log.json'), resolve(__dirname, '../dist/backtest-log.json')]
const path = SOURCES.find(existsSync)
if (!path) {
  console.error('No backtest-log.json found — run `npm run lab:pull` or `npm run slate` first.')
  process.exit(1)
}
const log = JSON.parse(readFileSync(path, 'utf8'))

// Flatten every reconciled prediction; drop scratches (no PA → can't homer).
const rows = []
for (const d of log.dates || []) {
  for (const r of log.records?.[d] || []) {
    if (r.actuallyPlayed === false) continue
    if (typeof r.homered !== 'boolean') continue
    rows.push({ grade: r.grade || 'SKIP', badges: Array.isArray(r.badges) ? r.badges : [], hr: r.homered ? 1 : 0 })
  }
}
if (!rows.length) {
  console.error(`backtest-log has no reconciled rows yet (${log.dates?.length || 0} dates). Let a few days accrue.`)
  process.exit(1)
}

const GRADES = ['PRIME', 'STRONG', 'LEAN', 'SKIP']
const pct = (x) => (x * 100).toFixed(1) + '%'
const rate = (rs) => (rs.length ? rs.reduce((s, r) => s + r.hr, 0) / rs.length : 0)

// Wald z for the difference between two independent proportions (pooled).
function waldZ(rsA, rsB) {
  const nA = rsA.length, nB = rsB.length
  if (!nA || !nB) return 0
  const xA = rsA.reduce((s, r) => s + r.hr, 0)
  const xB = rsB.reduce((s, r) => s + r.hr, 0)
  const p = (xA + xB) / (nA + nB)
  const se = Math.sqrt(p * (1 - p) * (1 / nA + 1 / nB))
  return se === 0 ? 0 : (xA / nA - xB / nB) / se
}

const base = rate(rows)
const days = log.dates?.length || 0
console.log(`\nBADGE AUDIT — ${rows.length} reconciled bats over ${days} day(s) · base HR rate ${pct(base)}\n${'─'.repeat(72)}`)

// All badge keys present in the log.
const keys = [...new Set(rows.flatMap((r) => r.badges))].sort()
if (!keys.length) console.log('(no badge flags logged in these records yet)')

// 1) Univariate lift + Wald z.
console.log('\nUNIVARIATE  (badge present vs absent)')
console.log(`  ${'badge'.padEnd(14)} ${'n'.padStart(5)}  ${'with'.padStart(7)}  ${'without'.padStart(8)}  ${'lift'.padStart(5)}  ${'z'.padStart(6)}`)
const uni = keys.map((k) => {
  const withK = rows.filter((r) => r.badges.includes(k))
  const without = rows.filter((r) => !r.badges.includes(k))
  const rW = rate(withK), rO = rate(without)
  return { k, n: withK.length, rW, rO, lift: rO ? rW / rO : 0, z: waldZ(withK, without) }
})
for (const u of uni.sort((a, b) => b.lift - a.lift)) {
  const flag = u.lift < 1 && u.z <= -0.8 ? '  ⚠ negative' : ''
  console.log(`  ${u.k.padEnd(14)} ${String(u.n).padStart(5)}  ${pct(u.rW).padStart(7)}  ${pct(u.rO).padStart(8)}  ${u.lift.toFixed(2).padStart(5)}  ${u.z.toFixed(1).padStart(6)}${flag}`)
}

// 2) Within-grade lift — the decisive test. Holders underperforming grademates
//    by ≥3 pts means the signal is promoting weak bats inside its tier.
console.log('\nWITHIN-GRADE  (holders vs same-grade non-holders; ⚠ = holders worse by ≥3 pts)')
for (const k of keys) {
  const parts = []
  let flagged = false
  for (const g of GRADES) {
    const inG = rows.filter((r) => r.grade === g)
    const withK = inG.filter((r) => r.badges.includes(k))
    const without = inG.filter((r) => !r.badges.includes(k))
    if (withK.length < 5 || without.length < 5) continue
    const diff = (rate(withK) - rate(without)) * 100
    if (diff <= -3) flagged = true
    parts.push(`${g}:${diff >= 0 ? '+' : ''}${diff.toFixed(1)}(n${withK.length})`)
  }
  if (parts.length) console.log(`  ${flagged ? '⚠' : ' '} ${k.padEnd(14)} ${parts.join('  ')}`)
}

// 3) Key interaction: hot & due vs hot alone (the combo-bonus check).
if (keys.includes('hot') && keys.includes('due')) {
  const hotDue = rows.filter((r) => r.badges.includes('hot') && r.badges.includes('due'))
  const hotOnly = rows.filter((r) => r.badges.includes('hot') && !r.badges.includes('due'))
  if (hotDue.length >= 5 && hotOnly.length >= 5) {
    console.log('\nINTERACTION  hot&due vs hot-alone')
    console.log(`  hot&due ${pct(rate(hotDue))} (n${hotDue.length})   ·   hot&!due ${pct(rate(hotOnly))} (n${hotOnly.length})`)
  }
}
console.log(`\n${'─'.repeat(72)}\nReads outcomes only — a signal that looks negative here is a candidate to zero/down-weight;\none that beats its grade is a candidate to up-weight. Confirm with score-offline before shipping.\n`)
