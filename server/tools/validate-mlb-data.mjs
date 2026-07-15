import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertValidMlbData,
  validateBacktestLog,
  validateDailySnapshot,
} from '../lib/mlbDataContracts.mjs'

function arg(name, fallback) {
  const prefix = `--${name}=`
  const value = process.argv.find((item) => item.startsWith(prefix))
  return resolve(value ? value.slice(prefix.length) : fallback)
}

function load(path, label) {
  if (!existsSync(path)) throw new Error(`${label}: file not found at ${path}`)
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label}: invalid JSON (${error.message})`)
  }
}

const dailyPath = arg('daily', 'dist/daily.json')
const backtestPath = arg('backtest', 'dist/backtest-log.json')

try {
  const daily = assertValidMlbData('daily.json', validateDailySnapshot(load(dailyPath, 'daily.json')))
  const backtest = assertValidMlbData('backtest-log.json', validateBacktestLog(load(backtestPath, 'backtest-log.json')))
  for (const warning of [...daily.warnings, ...backtest.warnings]) console.warn(`[mlb-data] warning: ${warning}`)
  console.log(`[mlb-data] valid daily v5: ${daily.metrics.games} games · ${daily.metrics.scoredBatters} batter-games · ${daily.metrics.kDistributions} K distributions`)
  console.log(`[mlb-data] valid history: ${backtest.metrics.operationalDays} operational days/${backtest.metrics.operationalRows} rows · ${backtest.metrics.modelHistoryDays} archive days/${backtest.metrics.modelHistoryRows} rows · ${backtest.metrics.kResultDays} K result days`)
  const featureArchive = backtest.metrics.featureArchive
  console.log(`[mlb-data] feature archive v${featureArchive.schemaVersion}: ${featureArchive.schemaV2Rows}/${featureArchive.population} settled hitter-games · bat tracking ${featureArchive.groups.batTracking.available} · pitcher recent ${featureArchive.groups.pitcherRecent.available} · pitch types ${featureArchive.groups.pitchTypes.available}`)
} catch (error) {
  console.error(`[mlb-data] ${error.message}`)
  process.exitCode = 1
}
