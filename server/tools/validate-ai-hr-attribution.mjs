import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidAiHrAttribution } from '../lib/aiHrAttribution.mjs'

const prefix = '--report='
const arg = process.argv.find((item) => item.startsWith(prefix))
const path = resolve(arg ? arg.slice(prefix.length) : 'dist/ai-hr-attribution.json')

try {
  if (!existsSync(path)) throw new Error(`artifact not found at ${path}`)
  const validation = assertValidAiHrAttribution(JSON.parse(readFileSync(path, 'utf8')))
  for (const warning of validation.warnings) console.warn(`[ai-hr-attribution] warning: ${warning}`)
  console.log(`[ai-hr-attribution] valid: ${validation.metrics.settledRecords} settled · Brier Δ ${validation.metrics.brierImprovement ?? 'n/a'}`)
} catch (error) {
  console.error(`[ai-hr-attribution] ${error.message}`)
  process.exitCode = 1
}
