/**
 * Offline validation for the sim-resolution blend (server/lib/simResolution.mjs).
 *
 * Reconstructs the calibrated anchor (isotonic + ML) from each row's SCORE — so
 * it's robust even if daily.json's hrProbability was already blended — then
 * applies the blend and reports:
 *   1. calibration preservation — per-score-bucket mean prob, before vs after
 *   2. monotonicity — does any lower-score row outrank a higher-score row?
 *   3. resolution gain — distinct prob values + spread in flat top/bottom
 *   4. example re-rankings
 *
 *   node server/tools/validate-sim-blend.mjs            # report only
 *   node server/tools/validate-sim-blend.mjs --write    # also rewrite dist/daily.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applySimResolution } from '../lib/simResolution.mjs'
import { lookupProb } from '../../src/sports/mlb/logic/isotonicCalibration.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DAILY = path.resolve(__dirname, '..', '..', 'dist', 'daily.json')
const WRITE = process.argv.includes('--write')

const d = JSON.parse(fs.readFileSync(DAILY, 'utf8'))
const table = d.scoreToProb?.table
if (!table?.length) {
  console.error('no scoreToProb table in daily.json — cannot validate')
  process.exit(1)
}

const mlW = d.ensembleMeta?.mlWeight || 0
// Reconstruct the calibrated anchor exactly as fetch-slate does (isotonic + ML).
function anchorOf(r) {
  const iso = lookupProb(r.score, table)
  if (mlW > 0 && Number.isFinite(r.mlScore)) {
    const mlProb = Math.max(0.005, Math.min(0.3, (r.mlScore / 100) * 0.18))
    return (1 - mlW) * iso + mlW * mlProb
  }
  return iso
}

const seen = new Set()
const rows = []
for (const [key, r] of Object.entries(d.scoredBatters)) {
  if (!key.includes('-')) continue
  if (!r || !Number.isFinite(r.score)) continue
  const id = `${r.playerId}-${r.gamePk}`
  if (seen.has(id)) continue
  seen.add(id)
  const anchor = anchorOf(r)
  rows.push({ name: r.name, score: r.score, simHRProb: r.simHRProb, _anchorProb: anchor, hrProbability: anchor })
}

const bucketOf = (s) => {
  for (let i = 0; i < table.length; i++) if (s >= table[i].scoreLo && s < table[i].scoreHi) return i
  return s >= table[table.length - 1].scoreHi ? table.length - 1 : 0
}
const meanBy = (arr, f) => (arr.length ? arr.reduce((s, x) => s + f(x), 0) / arr.length : 0)
const distinct = (arr, f) => new Set(arr.map(f)).size

const res = applySimResolution(rows, { table, lookupProb })

console.log(`\nrows: ${rows.length} | sim-resolution adjusted ${res.adjusted} across ${res.buckets} buckets\n`)

console.log('CALIBRATION (per score bucket — mean prob must be preserved):')
console.log('  bucket    n   mean(anchor)  mean(blend)    Δ')
let maxDelta = 0
for (let i = 0; i < table.length; i++) {
  const grp = rows.filter((r) => bucketOf(r.score) === i)
  if (!grp.length) continue
  const a = meanBy(grp, (r) => r._anchorProb)
  const b = meanBy(grp, (r) => r.hrProbability)
  maxDelta = Math.max(maxDelta, Math.abs(a - b))
  console.log(`  ${String(table[i].scoreLo).padStart(2)}-${String(table[i].scoreHi).padEnd(3)} ${String(grp.length).padStart(4)}   ${a.toFixed(4)}        ${b.toFixed(4)}       ${(b - a >= 0 ? '+' : '') + (b - a).toFixed(4)}`)
}
console.log(`  → max |Δ mean| across buckets: ${maxDelta.toFixed(5)} (≈0 = calibration preserved)\n`)

// Monotonicity: sort by score desc; flag any row whose prob exceeds a row with a
// meaningfully higher score (> 2 pts) — that would be a grade/prob inversion.
const byScore = rows.slice().sort((a, b) => b.score - a.score)
let inversions = 0
let worst = 0
for (let i = 0; i < byScore.length; i++) {
  for (let j = i + 1; j < byScore.length; j++) {
    if (byScore[j].score <= byScore[i].score - 2 && byScore[j].hrProbability > byScore[i].hrProbability + 1e-6) {
      inversions++
      worst = Math.max(worst, byScore[i].score - byScore[j].score)
      break
    }
  }
}
console.log('MONOTONICITY:')
console.log(`  score-inversions (a lower-by-≥2 score outranks on prob): ${inversions}  (worst score gap: ${worst})\n`)

console.log('RESOLUTION:')
console.log(`  distinct prob values: ${distinct(rows, (r) => +r._anchorProb.toFixed(4))} → ${distinct(rows, (r) => +r.hrProbability.toFixed(4))}`)
const top = rows.filter((r) => r.score >= 70)
console.log(`  upper region (score ≥ 70): n=${top.length}  distinct before=${distinct(top, (r) => +r._anchorProb.toFixed(4))}  after=${distinct(top, (r) => +r.hrProbability.toFixed(4))}`)
const bot = rows.filter((r) => r.score < 35)
console.log(`  flat bottom (score < 35): n=${bot.length}  distinct before=${distinct(bot, (r) => +r._anchorProb.toFixed(4))}  after=${distinct(bot, (r) => +r.hrProbability.toFixed(4))}\n`)

console.log('EXAMPLE — top 12 by blended prob (score · sim · anchor → blend):')
const ex = rows.slice().sort((a, b) => b.hrProbability - a.hrProbability).slice(0, 12)
for (const r of ex) {
  console.log(`  ${r.name.padEnd(20)} score ${String(r.score).padStart(3)}  sim ${(r.simHRProb ?? NaN).toFixed?.(3) ?? '  —'}  ${r._anchorProb.toFixed(4)} → ${r.hrProbability.toFixed(4)}`)
}

if (WRITE) {
  const all = Object.values(d.scoredBatters).filter((r) => r && Number.isFinite(r.score))
  for (const r of all) r._anchorProb = anchorOf(r)
  applySimResolution(all, { table, lookupProb })
  for (const r of all) delete r._anchorProb
  fs.writeFileSync(DAILY, JSON.stringify(d))
  console.log(`\n[write] re-applied blend to ${all.length} rows and rewrote ${path.relative(process.cwd(), DAILY)}`)
}
