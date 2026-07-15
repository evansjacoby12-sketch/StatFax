import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildHistoricalFeatureCoverage } from '../lib/historicalFeatureArchive.mjs'

function arg(name, fallback) {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return resolve(value ? value.slice(prefix.length) : fallback)
}

const path = arg('backtest', 'dist/backtest-log.json')
if (!existsSync(path)) throw new Error(`backtest-log.json not found at ${path}`)
const log = JSON.parse(readFileSync(path, 'utf8'))
const history = log.modelHistory?.records ? log.modelHistory : { dates: log.dates || [], records: log.records || {} }
const coverage = buildHistoricalFeatureCoverage(history)

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(coverage, null, 2))
} else {
  console.log(`[feature-archive] schema v${coverage.schemaVersion}: ${coverage.schemaV2Rows}/${coverage.population} settled hitter-games · ${coverage.legacyRows} legacy · ${coverage.missingFeatureRows} without features`)
  console.log(`[feature-archive] v2 range: ${coverage.firstSchemaV2Date || 'collecting'} to ${coverage.lastSchemaV2Date || 'collecting'}`)
  for (const [group, result] of Object.entries(coverage.groups)) {
    const percent = result.coverage == null ? '—' : `${(result.coverage * 100).toFixed(1)}%`
    console.log(`[feature-archive] ${group}: ${result.available}/${coverage.population} (${percent})`)
  }
  const priorityFields = {
    bspd: 'bat speed', blast: 'blast rate', sq: 'squared-up rate', mxev: 'max EV',
    ss: 'sweet-spot rate', xiso: 'xISO', xslg: 'xSLG', rev: 'recent EV',
    prhr9: 'pitcher recent HR/9', pitchTypes: 'raw pitch types',
  }
  for (const [key, label] of Object.entries(priorityFields)) {
    const result = coverage.fields[key]
    const percent = result.coverage == null ? '—' : `${(result.coverage * 100).toFixed(1)}%`
    console.log(`[feature-archive] field ${label}: ${result.available}/${coverage.population} (${percent})`)
  }
}
