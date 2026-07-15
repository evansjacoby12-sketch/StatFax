import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidAiHrProduction } from '../lib/aiHrProduction.mjs'

function arg(name, fallback) {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return resolve(value ? value.slice(prefix.length) : fallback)
}

const slatePath = arg('slate', 'dist/daily.json')
const artifactPath = arg('artifact', 'dist/ai-hr-production.json')

try {
  if (!existsSync(slatePath)) throw new Error(`slate not found at ${slatePath}`)
  if (!existsSync(artifactPath)) throw new Error(`artifact not found at ${artifactPath}`)
  const slate = JSON.parse(readFileSync(slatePath, 'utf8'))
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
  const validation = assertValidAiHrProduction({ slate, artifact })
  for (const warning of validation.warnings) console.warn(`[ai-hr-production] warning: ${warning}`)
  console.log(`[ai-hr-production] valid v${artifact.version}: ${validation.metrics.records} production adjustment(s), ${validation.metrics.signalApplications} signal application(s) · scoreImpact=true · gateOverride=true`)
} catch (error) {
  console.error(`[ai-hr-production] ${error.message}`)
  process.exitCode = 1
}
