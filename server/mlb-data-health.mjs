import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidAiHrContext } from './lib/aiHrContext.mjs'
import { assertValidMlbData, validateDailySnapshot } from './lib/mlbDataContracts.mjs'
import {
  applyMlbDataHealth,
  assertPublishableMlbDataHealth,
  assertValidMlbDataHealth,
} from './lib/mlbDataHealth.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SLATE_PATH = resolve(__dirname, '../dist/daily.json')
const CONTEXT_PATH = resolve(__dirname, '../dist/context.json')
const OUT_PATH = resolve(__dirname, '../dist/mlb-data-health.json')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

try {
  if (!existsSync(SLATE_PATH)) throw new Error('daily.json is required')
  const slate = readJson(SLATE_PATH)
  const context = existsSync(CONTEXT_PATH) ? readJson(CONTEXT_PATH) : null
  assertValidMlbData('daily.json', validateDailySnapshot(slate))
  if (context) assertValidAiHrContext(context)

  const result = applyMlbDataHealth({ slate, context, generatedAt: new Date().toISOString() })
  const validation = assertValidMlbDataHealth(result)
  assertValidMlbData('daily.json', validateDailySnapshot(result.slate))
  writeFileSync(SLATE_PATH, JSON.stringify(result.slate))
  writeFileSync(OUT_PATH, JSON.stringify(result.report))
  for (const warning of validation.warnings) console.warn(`[mlb-data-health] warning: ${warning}`)
  console.log(`[mlb-data-health] ${result.report.status}: ${validation.metrics.hardFailures} blocker(s), ${validation.metrics.warnings} warning(s), ${validation.metrics.aiAlerts} sourced AI alert(s)`)
  assertPublishableMlbDataHealth(result.report)
} catch (error) {
  console.error(`[mlb-data-health] ${error.message}`)
  process.exitCode = 1
}
