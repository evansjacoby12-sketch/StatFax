import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidAiHrContext } from './lib/aiHrContext.mjs'
import { assertValidMlbData, validateDailySnapshot } from './lib/mlbDataContracts.mjs'
import { applyAiHrProduction, assertValidAiHrProduction } from './lib/aiHrProduction.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SLATE_PATH = resolve(__dirname, '../dist/daily.json')
const CONTEXT_PATH = resolve(__dirname, '../dist/context.json')
const OUT_PATH = resolve(__dirname, '../dist/ai-hr-production.json')

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

try {
  if (!existsSync(SLATE_PATH)) throw new Error('daily.json is required')
  if (!existsSync(CONTEXT_PATH)) throw new Error('context.json is required')
  const slate = readJson(SLATE_PATH)
  const context = readJson(CONTEXT_PATH)
  assertValidMlbData('daily.json', validateDailySnapshot(slate))
  assertValidAiHrContext(context)

  const result = applyAiHrProduction({ slate, context, generatedAt: new Date().toISOString() })
  const validation = assertValidAiHrProduction(result)
  assertValidMlbData('daily.json', validateDailySnapshot(result.slate))
  writeFileSync(SLATE_PATH, JSON.stringify(result.slate))
  writeFileSync(OUT_PATH, JSON.stringify(result.artifact))
  for (const warning of validation.warnings) console.warn(`[ai-hr-production] warning: ${warning}`)
  console.log(`[ai-hr-production] ${result.artifact.status}: ${validation.metrics.records} batter(s), ${validation.metrics.signalApplications} signal application(s), max probability move ${validation.metrics.maxAbsoluteProbabilityMove}`)
} catch (error) {
  console.error(`[ai-hr-production] ${error.message}`)
  process.exitCode = 1
}
