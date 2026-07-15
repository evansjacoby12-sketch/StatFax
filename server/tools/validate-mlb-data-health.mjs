import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertPublishableMlbDataHealth, assertValidMlbDataHealth } from '../lib/mlbDataHealth.mjs'

function arg(name, fallback) {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return resolve(value ? value.slice(prefix.length) : fallback)
}

function load(path, label) {
  if (!existsSync(path)) throw new Error(`${label}: file not found at ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

try {
  const slate = load(arg('slate', 'dist/daily.json'), 'daily.json')
  const report = load(arg('report', 'dist/mlb-data-health.json'), 'mlb-data-health.json')
  const validation = assertValidMlbDataHealth({ slate, report })
  assertPublishableMlbDataHealth(report)
  for (const warning of validation.warnings) console.warn(`[mlb-data-health] warning: ${warning}`)
  console.log(`[mlb-data-health] valid: ${validation.metrics.status} · ${validation.metrics.hardFailures} blocker(s) · ${validation.metrics.warnings} warning(s) · ${validation.metrics.aiAlerts} AI alert(s)`)
} catch (error) {
  console.error(`[mlb-data-health] ${error.message}`)
  process.exitCode = 1
}
