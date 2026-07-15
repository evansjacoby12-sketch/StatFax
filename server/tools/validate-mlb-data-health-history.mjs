import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidMlbDataHealthHistory } from '../lib/mlbDataHealthHistory.mjs'

const prefix = '--history='
const arg = process.argv.find((item) => item.startsWith(prefix))
const path = resolve(arg ? arg.slice(prefix.length) : 'dist/mlb-data-health-history.json')

try {
  if (!existsSync(path)) throw new Error(`artifact not found at ${path}`)
  const validation = assertValidMlbDataHealthHistory(JSON.parse(readFileSync(path, 'utf8')))
  for (const warning of validation.warnings) console.warn(`[mlb-data-health-history] warning: ${warning}`)
  console.log(`[mlb-data-health-history] valid: ${validation.metrics.days} day(s) · ${validation.metrics.alerts} alert(s) · confirmation rate ${validation.metrics.confirmationRate ?? 'n/a'}`)
} catch (error) {
  console.error(`[mlb-data-health-history] ${error.message}`)
  process.exitCode = 1
}
