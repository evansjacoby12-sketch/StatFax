import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidAiHrEvaluation } from '../lib/aiHrEvaluation.mjs'

const prefix = '--report='
const arg = process.argv.find((item) => item.startsWith(prefix))
const path = resolve(arg ? arg.slice(prefix.length) : 'dist/ai-hr-evaluation.json')

if (!existsSync(path)) {
  console.log(`[ai-hr-evaluation] skipped: no artifact at ${path}`)
  process.exit(0)
}

try {
  const report = JSON.parse(readFileSync(path, 'utf8'))
  const validation = assertValidAiHrEvaluation(report)
  for (const warning of validation.warnings) console.warn(`[ai-hr-evaluation] warning: ${warning}`)
  const delta = validation.metrics.brierImprovement
  console.log(`[ai-hr-evaluation] valid v${report.version}: ${validation.metrics.settled} settled, Brier Δ ${delta == null ? 'n/a' : delta.toFixed(6)} · gate=${validation.metrics.gateStatus} · scoreImpact=false`)
} catch (error) {
  console.error(`[ai-hr-evaluation] ${error.message}`)
  process.exitCode = 1
}
