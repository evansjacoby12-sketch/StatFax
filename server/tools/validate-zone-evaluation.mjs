import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidZoneEvaluation } from '../lib/zoneEvaluation.mjs'

const reportArg = process.argv.find((item) => item.startsWith('--report='))
const backtestArg = process.argv.find((item) => item.startsWith('--backtest='))
const reportPath = resolve(reportArg ? reportArg.slice('--report='.length) : 'dist/zone-evaluation.json')
const backtestPath = resolve(backtestArg ? backtestArg.slice('--backtest='.length) : 'dist/backtest-log.json')

if (!existsSync(reportPath)) {
  console.log(`[zone-evaluation] skipped: no artifact at ${reportPath}`)
  process.exit(0)
}

try {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const backtestLog = existsSync(backtestPath) ? JSON.parse(readFileSync(backtestPath, 'utf8')) : null
  const validation = assertValidZoneEvaluation(report, backtestLog)
  for (const warning of validation.warnings) console.warn(`[zone-evaluation] warning: ${warning}`)
  const delta = validation.metrics.brierImprovement
  console.log(`[zone-evaluation] valid v${report.version}: ${validation.metrics.settled} settled, ${validation.metrics.qualified} qualified, Brier Δ ${delta == null ? 'n/a' : delta.toFixed(6)} · gate=${validation.metrics.gateStatus} · scoreImpact=false`)
} catch (error) {
  console.error(`[zone-evaluation] ${error.message}`)
  process.exitCode = 1
}
