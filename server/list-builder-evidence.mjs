import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildListBuilderEvidence, validateListBuilderEvidence } from './lib/listBuilderEvidence.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return resolve(value ? value.slice(prefix.length) : fallback)
}

const backtestPath = arg('backtest', resolve(__dirname, '../dist/backtest-log.json'))
const outputPath = arg('out', resolve(__dirname, '../dist/list-builder-evidence.json'))
if (!existsSync(backtestPath)) throw new Error(`backtest log not found: ${backtestPath}`)

const backtestLog = JSON.parse(readFileSync(backtestPath, 'utf8'))
const artifact = buildListBuilderEvidence({ backtestLog })
const validation = validateListBuilderEvidence(artifact)
if (!validation.ok) throw new Error(`list builder evidence invalid:\n${validation.errors.join('\n')}`)

writeFileSync(outputPath, JSON.stringify(artifact, null, 2))
console.log(`[list-builder-evidence] wrote ${outputPath} · ${validation.metrics.recipes} recipes · ${validation.metrics.historyDates} settled date(s) · latest ${validation.metrics.latestSettledDate || 'none'}`)
