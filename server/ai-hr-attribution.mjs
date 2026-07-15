import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidAiHrAttribution, buildAiHrAttribution } from './lib/aiHrAttribution.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '../dist')
const R2 = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev'
const read = (name) => JSON.parse(readFileSync(resolve(DIST, name), 'utf8'))

async function load(name, required = false) {
  if (existsSync(resolve(DIST, name))) return read(name)
  try {
    const response = await fetch(`${R2}/${name}?t=${Date.now()}`, { cache: 'no-store' })
    if (response.ok) return response.json()
  } catch { /* handled below */ }
  if (required) throw new Error(`${name} is required`)
  return null
}

try {
  const ledger = await load('ai-hr-shadow.json', true)
  const backtestLog = await load('backtest-log.json') || {}
  const watchdogHistory = await load('mlb-data-health-history.json')
  const report = buildAiHrAttribution({ ledger, backtestLog, watchdogHistory })
  const validation = assertValidAiHrAttribution(report)
  writeFileSync(resolve(DIST, 'ai-hr-attribution.json'), JSON.stringify(report))
  for (const warning of validation.warnings) console.warn(`[ai-hr-attribution] warning: ${warning}`)
  console.log(`[ai-hr-attribution] ${validation.metrics.settledRecords} settled · ${validation.metrics.helped} helped · ${validation.metrics.hurt} hurt · Brier Δ ${validation.metrics.brierImprovement ?? 'n/a'}`)
} catch (error) {
  console.error(`[ai-hr-attribution] ${error.message}`)
  process.exitCode = 1
}
