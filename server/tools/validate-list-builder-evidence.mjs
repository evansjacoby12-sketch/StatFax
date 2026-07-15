import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateListBuilderEvidence } from '../lib/listBuilderEvidence.mjs'

const prefix = '--path='
const value = process.argv.find((item) => item.startsWith(prefix))
const path = resolve(value ? value.slice(prefix.length) : 'dist/list-builder-evidence.json')
const artifact = JSON.parse(readFileSync(path, 'utf8'))
const validation = validateListBuilderEvidence(artifact)
if (!validation.ok) {
  console.error(`[list-builder-evidence] invalid:\n${validation.errors.join('\n')}`)
  process.exit(1)
}
for (const warning of validation.warnings) console.warn(`[list-builder-evidence] warning: ${warning}`)
console.log(`[list-builder-evidence] valid v${artifact.version}: ${validation.metrics.recipes} recipes · ${validation.metrics.historyDates} date(s) · d14 population ${validation.metrics.d14Population}`)
