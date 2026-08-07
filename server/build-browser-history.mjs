import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_INPUT = resolve(__dirname, '../dist/backtest-log.json')
const DEFAULT_OUTPUT = resolve(__dirname, '../dist/browser-history.json')

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))

function recentDateMap(source = {}, limit = 30, transform = (value) => value) {
  const dates = Object.keys(source || {}).filter(isDate).sort().slice(-limit)
  return Object.fromEntries(dates.map((date) => [date, transform(source[date])]))
}

export function compactHistoryRecord(row = {}) {
  const keep = [
    'playerId', 'gamePk', 'name', 'score', 'grade', 'badges',
    'lineupConfirmed', 'dataTrusted', 'simHRProb', 'zoneEvidence',
    'rawScore', 'rawGrade', 'preCapScore', 'preCapGrade', 'displayGrade',
    'hrModelVersion', 'probabilityPipelineVersion', 'publishedHRProbability',
    'hrProbabilityTrace',
    'contactLeakEvidence', 'homered', 'actuallyPlayed',
  ]
  const out = {}
  for (const key of keep) if (row[key] !== undefined) out[key] = row[key]
  if (row.feat && typeof row.feat === 'object') out.feat = row.feat
  return out
}

export function buildBrowserHistory(log = {}) {
  const records = recentDateMap(log.records, 30, (rows) => Array.isArray(rows) ? rows.map(compactHistoryRecord) : [])
  const dates = Object.keys(records).sort()
  const combos = Object.fromEntries(Object.entries(log.combos || {}).map(([key, value]) => [
    key,
    value && typeof value === 'object' ? recentDateMap(value, 7) : value,
  ]))

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    dates,
    settledDates: (log.settledDates || []).filter((date) => dates.includes(date)),
    records,
    combos,
    kProps: {
      resultsByDate: recentDateMap(log.kProps?.resultsByDate, 30),
    },
    gameForecasts: {
      version: log.gameForecasts?.version || 1,
      resultsByDate: recentDateMap(log.gameForecasts?.resultsByDate, 7),
    },
  }
}

export function writeBrowserHistory(inputPath = DEFAULT_INPUT, outputPath = DEFAULT_OUTPUT) {
  if (!existsSync(inputPath)) throw new Error(`Missing backtest history: ${inputPath}`)
  const source = JSON.parse(readFileSync(inputPath, 'utf8'))
  const artifact = buildBrowserHistory(source)
  writeFileSync(outputPath, JSON.stringify(artifact))
  return {
    artifact,
    sourceBytes: Buffer.byteLength(JSON.stringify(source)),
    outputBytes: Buffer.byteLength(JSON.stringify(artifact)),
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const input = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_INPUT
  const output = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT
  const result = writeBrowserHistory(input, output)
  const saved = 1 - (result.outputBytes / Math.max(1, result.sourceBytes))
  console.log(`[browser-history] ${(result.sourceBytes / 1048576).toFixed(2)} MB -> ${(result.outputBytes / 1048576).toFixed(2)} MB (${(saved * 100).toFixed(1)}% smaller)`)
}
