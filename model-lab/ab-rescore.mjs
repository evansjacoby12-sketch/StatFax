/**
 * ab-rescore.mjs — A/B two engine bundles on the SAME frozen inputs, with zero
 * network. Quantifies what a rule-weight change actually does: mean score shift,
 * grade migration, and the targeted effect on the cohort the change aims at.
 *
 *   node model-lab/ab-rescore.mjs <baseBundle> <treatBundle>
 *
 * Build the two bundles around a working-tree change, e.g.:
 *   npm run build-model && cp server/.build/model.mjs /tmp/treat.mjs
 *   git stash push <engine> && npm run build-model && cp server/.build/model.mjs /tmp/base.mjs && git stash pop
 *   node model-lab/ab-rescore.mjs /tmp/base.mjs /tmp/treat.mjs
 *
 * NOTE: this is an INPUT-effect A/B (how the change re-ranks identical inputs).
 * A true outcome-validated AUC/Brier delta needs a multi-day inputs corpus
 * joined to reconciled results — let dist/inputs-<date>.json accrue first.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const [basePath, treatPath] = process.argv.slice(2)
if (!basePath || !treatPath) {
  console.error('usage: node model-lab/ab-rescore.mjs <baseBundle> <treatBundle>')
  process.exit(1)
}
const base = await import(pathToFileURL(resolve(basePath)).href)
const treat = await import(pathToFileURL(resolve(treatPath)).href)

// Frozen input corpus (dist/ = freshest local run, data/ = pulled history).
const corpusIn = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => /^inputs-.*\.json$/.test(f)).map((f) => resolve(dir, f)) : []
const byName = new Map()
for (const p of [...corpusIn(resolve(__dirname, '../dist')), ...corpusIn(resolve(__dirname, 'data'))]) byName.set(basename(p), p)
const files = [...byName.values()]
if (!files.length) {
  console.error('No inputs-*.json corpus — run `npm run slate` first.')
  process.exit(1)
}

const ORD = { PRIME: 3, STRONG: 2, LEAN: 1, SKIP: 0 }
const gl = (r) => r?.grade?.label ?? r?.grade ?? 'SKIP'
const rows = []
for (const f of files) {
  for (const row of JSON.parse(readFileSync(f, 'utf8'))) {
    let b, t
    try { b = base.scoreBatter(...row.args); t = treat.scoreBatter(...row.args) } catch { continue }
    if (!Number.isFinite(b?.score) || !Number.isFinite(t?.score)) continue
    rows.push({
      name: row.name,
      bs: b.score, ts: t.score, d: t.score - b.score,
      bg: gl(b), tg: gl(t),
      hot: !!t.hot, homeEdge: !!t.homeEdge,
    })
  }
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const cohort = (pred) => {
  const c = rows.filter(pred)
  return `${c.length} bats · mean Δ ${mean(c.map((r) => r.d)).toFixed(2)} · changed ${c.filter((r) => r.d !== 0).length}`
}
const up = rows.filter((r) => ORD[r.tg] > ORD[r.bg]).length
const down = rows.filter((r) => ORD[r.tg] < ORD[r.bg]).length

console.log(`\nA/B RE-SCORE — ${rows.length} bats on frozen inputs`)
console.log(`${'─'.repeat(60)}`)
console.log(`mean score   base ${mean(rows.map((r) => r.bs)).toFixed(2)}  →  treat ${mean(rows.map((r) => r.ts)).toFixed(2)}  (Δ ${mean(rows.map((r) => r.d)).toFixed(2)})`)
console.log(`grade moves   ↑${up}  ↓${down}  (of ${rows.length})`)
console.log(`\ntargeted cohorts (treatment flags):`)
console.log(`  hot       ${cohort((r) => r.hot)}`)
console.log(`  homeEdge  ${cohort((r) => r.homeEdge)}`)
console.log(`  neither   ${cohort((r) => !r.hot && !r.homeEdge)}`)

const movers = rows.filter((r) => r.d !== 0).sort((a, b) => b.d - a.d)
console.log(`\ntop risers:`)
for (const r of movers.slice(0, 8)) {
  const tag = [r.hot && 'hot', r.homeEdge && 'home'].filter(Boolean).join('+') || '—'
  const grade = r.tg !== r.bg ? `  ${r.bg}→${r.tg}` : ''
  console.log(`  +${r.d.toFixed(0).padStart(2)}  ${r.name.padEnd(22)} ${r.bs}→${r.ts} [${tag}]${grade}`)
}
console.log(`\n${'─'.repeat(60)}\nInput-effect only. Outcome-validated AUC/Brier needs the multi-day inputs corpus joined to results.\n`)
