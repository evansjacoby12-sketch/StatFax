import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidAiHrContext } from '../lib/aiHrContext.mjs'

const prefix = '--context='
const arg = process.argv.find((item) => item.startsWith(prefix))
const path = resolve(arg ? arg.slice(prefix.length) : 'dist/context.json')

if (!existsSync(path)) {
  console.log(`[ai-hr-context] skipped: no artifact at ${path}`)
  process.exit(0)
}

try {
  const context = JSON.parse(readFileSync(path, 'utf8'))
  const validation = assertValidAiHrContext(context)
  for (const warning of validation.warnings) console.warn(`[ai-hr-context] warning: ${warning}`)
  console.log(`[ai-hr-context] valid v${context.version}: ${validation.metrics.signals} sourced signal(s) across ${validation.metrics.entities} entities · scoreImpact=false`)
} catch (error) {
  console.error(`[ai-hr-context] ${error.message}`)
  process.exitCode = 1
}
