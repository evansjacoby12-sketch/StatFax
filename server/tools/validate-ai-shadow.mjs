import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidAiHrShadowLedger } from '../lib/aiHrShadow.mjs'

const prefix = '--ledger='
const arg = process.argv.find((item) => item.startsWith(prefix))
const path = resolve(arg ? arg.slice(prefix.length) : 'dist/ai-hr-shadow.json')

if (!existsSync(path)) {
  console.log(`[ai-hr-shadow] skipped: no artifact at ${path}`)
  process.exit(0)
}

try {
  const ledger = JSON.parse(readFileSync(path, 'utf8'))
  const validation = assertValidAiHrShadowLedger(ledger)
  for (const warning of validation.warnings) console.warn(`[ai-hr-shadow] warning: ${warning}`)
  console.log(`[ai-hr-shadow] valid v${ledger.version}: ${validation.metrics.records} projection(s), ${validation.metrics.signalApplications} signal application(s) · scoreImpact=false`)
} catch (error) {
  console.error(`[ai-hr-shadow] ${error.message}`)
  process.exitCode = 1
}
