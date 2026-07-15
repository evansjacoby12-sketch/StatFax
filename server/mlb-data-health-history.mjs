import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertValidMlbDataHealthHistory,
  captureMlbDataHealthHistory,
  fetchMlbOfficialFacts,
  settleMlbDataHealthHistory,
  validateMlbDataHealthHistory,
} from './lib/mlbDataHealthHistory.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '../dist')
const HISTORY_PATH = resolve(DIST, 'mlb-data-health-history.json')
const R2 = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev'
const read = (name) => JSON.parse(readFileSync(resolve(DIST, name), 'utf8'))

async function priorHistory() {
  if (existsSync(HISTORY_PATH)) return read('mlb-data-health-history.json')
  try {
    const response = await fetch(`${R2}/mlb-data-health-history.json?t=${Date.now()}`, { cache: 'no-store' })
    if (response.ok) return response.json()
  } catch { /* first run or R2 unavailable */ }
  return null
}

try {
  for (const name of ['daily.json', 'context.json', 'mlb-data-health.json']) {
    if (!existsSync(resolve(DIST, name))) throw new Error(`${name} is required`)
  }
  const slate = read('daily.json')
  const context = read('context.json')
  const report = read('mlb-data-health.json')
  let history = captureMlbDataHealthHistory({ previous: await priorHistory(), slate, report, context })
  const pendingDates = Object.entries(history.recordsByDate)
    .filter(([, entry]) => entry.alerts.some((alert) => alert.outcome === 'pending'))
    .map(([date]) => date)
    .slice(-14)
  const factsByDate = {}
  for (const date of pendingDates) {
    try { factsByDate[date] = await fetchMlbOfficialFacts(date) }
    catch (error) { console.warn(`[mlb-data-health-history] ${date} settlement deferred: ${error.message}`) }
  }
  history = settleMlbDataHealthHistory({ history, factsByDate })
  const validation = assertValidMlbDataHealthHistory(history)
  writeFileSync(HISTORY_PATH, JSON.stringify(history))
  for (const warning of validation.warnings) console.warn(`[mlb-data-health-history] warning: ${warning}`)
  console.log(`[mlb-data-health-history] ${validation.metrics.days} day(s) · ${validation.metrics.alerts} alert(s) · ${validation.metrics.settled} objectively settled · ${validation.metrics.confirmed} confirmed`)
} catch (error) {
  console.error(`[mlb-data-health-history] ${error.message}`)
  process.exitCode = 1
}
