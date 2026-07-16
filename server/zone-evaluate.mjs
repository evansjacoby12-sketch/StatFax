import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidZoneEvaluation, buildZoneEvaluation } from './lib/zoneEvaluation.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BACKTEST_PATH = resolve(__dirname, '../dist/backtest-log.json')
const OUT_PATH = resolve(__dirname, '../dist/zone-evaluation.json')
const R2_URL = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev/backtest-log.json'

async function loadBacktest() {
  if (existsSync(BACKTEST_PATH)) return JSON.parse(readFileSync(BACKTEST_PATH, 'utf8'))
  try {
    const response = await fetch(`${R2_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (response.ok) return response.json()
  } catch {}
  return {}
}

try {
  const backtestLog = await loadBacktest()
  const report = buildZoneEvaluation({ backtestLog })
  const validation = assertValidZoneEvaluation(report, backtestLog)
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(report))
  for (const warning of validation.warnings) console.warn(`[zone-evaluation] warning: ${warning}`)
  const delta = validation.metrics.brierImprovement
  console.log(`[zone-evaluation] wrote ${OUT_PATH} — ${validation.metrics.settled} settled v2 rows, ${validation.metrics.qualified} qualified, Brier Δ ${delta == null ? 'n/a' : delta.toFixed(6)} · gate=${validation.metrics.gateStatus} · production unchanged`)
} catch (error) {
  console.error(`[zone-evaluation] ${error.message}`)
  process.exitCode = 1
}
