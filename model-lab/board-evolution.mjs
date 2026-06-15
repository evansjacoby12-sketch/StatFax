/**
 * board-evolution.mjs — how much does the combo board CHANGE through the day,
 * and is the early (unconfirmed-lineup) board worse? Reads the intraday
 * board-history.json (per-run snapshots of the canonical combos + lineup
 * confirmation), and — if a settled backtest-log day matches — grades each
 * snapshot's board against actual HRs so you can see early-vs-late hit rate.
 *
 *   node model-lab/board-evolution.mjs
 *
 * The whole point: prove (or disprove) the "6 AM board is a different, worse
 * board" lesson with data, so we know how long to wait before betting.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const histPath = [resolve(__dirname, 'data/board-history.json'), resolve(__dirname, '../dist/board-history.json')].find(existsSync)
if (!histPath) { console.error('No board-history.json yet — let the cron accrue a day of runs, then `npm run lab:pull`.'); process.exit(1) }
const hist = JSON.parse(readFileSync(histPath, 'utf8'))
const snaps = hist.snapshots || []
if (!snaps.length) { console.error('board-history has no snapshots yet.'); process.exit(1) }

const et = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' })
const keyOf = (c) => `${c.s}${c.n}:${[...c.legs].sort().join('-')}`

console.log(`\nBOARD EVOLUTION — ${hist.date} · ${snaps.length} snapshots (${et(snaps[0].at)}–${et(snaps.at(-1).at)} ET)\n${'─'.repeat(64)}`)

// 1) Churn: how much did the combo set change between consecutive snapshots?
console.log('\nCHURN  (combos changed vs the prior snapshot, as lineups fill in)')
let prev = null
for (const s of snaps) {
  const set = new Set(s.combos.map(keyOf))
  let changed = '—'
  if (prev) {
    const inter = [...set].filter((k) => prev.has(k)).length
    changed = `${set.size - inter}/${set.size} new`
  }
  console.log(`  ${et(s.at)}  lineups ${String(s.lineupsConfirmed).padStart(2)}/${s.lineupsTotal}  combos ${String(s.combos.length).padStart(2)}  ${changed}`)
  prev = set
}

// 2) Drift from FINAL: how different was each snapshot's board from the last
//    (lineups-in) board of the day — i.e. how wrong was betting early?
const final = new Set(snaps.at(-1).combos.map(keyOf))
console.log('\nDRIFT FROM FINAL BOARD  (share of each snapshot already matching the by-first-pitch board)')
for (const s of snaps) {
  const set = s.combos.map(keyOf)
  const match = set.filter((k) => final.has(k)).length
  const pctMatch = set.length ? Math.round((match / set.length) * 100) : 0
  const bar = '█'.repeat(Math.round(pctMatch / 5)).padEnd(20)
  console.log(`  ${et(s.at)}  ${bar} ${pctMatch}%  (lineups ${s.lineupsConfirmed}/${s.lineupsTotal})`)
}

// 3) If a settled day's HRs are available, grade early vs final board hit rate.
const logPath = [resolve(__dirname, 'data/backtest-log.json'), resolve(__dirname, '../dist/backtest-log.json')].find(existsSync)
if (logPath) {
  const log = JSON.parse(readFileSync(logPath, 'utf8'))
  const recs = log.records?.[hist.date]
  if (recs?.length) {
    const hr = new Set(recs.filter((r) => r.homered).map((r) => Number(r.playerId)))
    const hitRate = (combos) => {
      const cashed = combos.filter((c) => c.legs.every((id) => hr.has(Number(id)))).length
      return { cashed, n: combos.length }
    }
    console.log(`\nGRADED HIT RATE vs actual HRs (${hr.size} homered ${hist.date})`)
    const first = snaps[0], last = snaps.at(-1)
    const f = hitRate(first.combos), l = hitRate(last.combos)
    console.log(`  earliest board ${et(first.at)} (lineups ${first.lineupsConfirmed}/${first.lineupsTotal}):  ${f.cashed}/${f.n} cashed`)
    console.log(`  final board    ${et(last.at)} (lineups ${last.lineupsConfirmed}/${last.lineupsTotal}):  ${l.cashed}/${l.n} cashed`)
  } else {
    console.log(`\n(no settled HR outcomes for ${hist.date} in the backtest log yet — re-run after it reconciles to grade early-vs-final.)`)
  }
}
console.log(`\n${'─'.repeat(64)}\nHigh churn + low early-match = betting before lineups is betting a different board.\n`)
