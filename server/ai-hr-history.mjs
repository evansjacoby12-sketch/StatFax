/**
 * Leakage-safe historical AI HR replay.
 *
 * Each target date rebuilds its baseline from strictly earlier outcomes, then
 * asks the context model for web evidence available one hour before that day's
 * first pitch. Historical MLB responses provide IDs and team membership only;
 * boxscore statistics and target-date outcomes never enter the research prompt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertValidAiHrHistoricalReplay,
  buildAiHrHistoricalReplay,
  buildAiHrHistoricalSlate,
  buildAiHrWalkForwardBaseline,
  historicalAsOf,
  normalizeAiHrHistoricalContext,
  selectAiHrHistoricalDates,
} from './lib/aiHrHistorical.mjs'
import {
  buildAiHrFullSlateValidation,
} from './lib/aiHrFullSlateValidation.mjs'
import { researchAiHrSignals } from './lib/aiHrResearch.mjs'
import { OPENAI_DEFAULT_MODEL } from './lib/aiProviders.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(__dirname, '../dist')
const BACKTEST_PATH = resolve(DIST, 'backtest-log.json')
const OUT_PATH = resolve(DIST, 'ai-hr-historical.json')
const SHADOW_PATH = resolve(DIST, 'ai-hr-history-shadow.json')
const EVALUATION_PATH = resolve(DIST, 'ai-hr-history-evaluation.json')
const FULL_SLATE_PATH = resolve(DIST, 'ai-hr-full-slate-validation.json')
const MODEL = process.env.AI_HR_HISTORY_MODEL || process.env.AI_HR_MODEL || OPENAI_DEFAULT_MODEL
const MLB_API = 'https://statsapi.mlb.com/api/v1'

function arg(name) {
  const prefix = `--${name}=`
  const token = process.argv.find((value) => value.startsWith(prefix))
  return token ? token.slice(prefix.length) : null
}

const DRY_RUN = process.argv.includes('--dry-run')
const FROM = arg('from')
const TO = arg('to')
const MAX_DATES = Number(arg('max-dates')) || null
const FULL_SLATES_ONLY = process.argv.includes('--full-slates-only')

const wait = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds))

async function fetchJson(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'StatFax-AI-HR-Historical/1.0' } })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await wait(500 * attempt)
    }
  }
  throw new Error(`GET ${url} failed: ${lastError?.message || 'unknown error'}`)
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await worker(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

async function hydrateHistoricalSlate(backtestLog, date) {
  const baseline = buildAiHrWalkForwardBaseline(backtestLog, date)
  if (baseline.audit.latestTrainingDate && baseline.audit.latestTrainingDate >= date) throw new Error(`walk-forward leak on ${date}`)
  const schedule = await fetchJson(`${MLB_API}/schedule?sportId=1&date=${date}&hydrate=team,venue`)
  const wantedGamePks = [...new Set(baseline.rows.map((row) => row.gamePk))]
  const boxscorePairs = await mapLimit(wantedGamePks, 6, async (gamePk) => [
    gamePk,
    await fetchJson(`${MLB_API}/game/${gamePk}/boxscore`),
  ])
  const slate = buildAiHrHistoricalSlate({
    date,
    baselineRows: baseline.rows,
    schedule,
    boxscores: new Map(boxscorePairs),
  })
  if (!slate.games.length || !Object.keys(slate.scoredBatters).length) throw new Error(`no historical identities hydrated for ${date}`)
  return { slate, baselineAudit: baseline.audit }
}

async function main() {
  if (!existsSync(BACKTEST_PATH)) throw new Error(`missing ${BACKTEST_PATH}`)
  if (!DRY_RUN && (!process.env.TAVILY_API_KEY || !process.env.OPENAI_API_KEY)) {
    throw new Error('TAVILY_API_KEY and OPENAI_API_KEY are required unless --dry-run is used')
  }
  const backtestLog = JSON.parse(readFileSync(BACKTEST_PATH, 'utf8'))
  const dates = selectAiHrHistoricalDates(backtestLog, {
    from: FROM,
    to: TO,
    maxDates: MAX_DATES,
    fullSlatesOnly: FULL_SLATES_ONLY,
  })
  if (!dates.length) throw new Error('no exact-game historical dates matched the requested range')
  console.log(`[ai-hr-history] ${DRY_RUN ? 'dry-running' : 'researching'} ${dates.length} date(s): ${dates[0]} through ${dates.at(-1)}`)

  const runs = []
  for (const [index, date] of dates.entries()) {
    const { slate, baselineAudit } = await hydrateHistoricalSlate(backtestLog, date)
    const asOf = historicalAsOf(slate, 60)
    let raw = { signals: [] }
    let research = null
    if (!DRY_RUN) {
      research = await researchAiHrSignals({ slate, generatedAt: asOf, historical: true, model: MODEL })
      raw = research.raw
    }
    const context = normalizeAiHrHistoricalContext({
      raw,
      slate,
      asOf,
      model: research?.model || MODEL,
      source: research?.provider || 'tavily+openai',
    })
    if (DRY_RUN) context.dryRun = true
    if (research) context.research = research.audit
    runs.push({ date, slate, baselineAudit, asOf, context })
    console.log(`[ai-hr-history] ${index + 1}/${dates.length} ${date}: ${Object.keys(slate.scoredBatters).length} baseline rows, ${context.stats.accepted}/${context.stats.requested} signals accepted`)
  }

  const replay = buildAiHrHistoricalReplay({ runs, backtestLog })
  const validation = assertValidAiHrHistoricalReplay(replay)
  const fullSlateValidation = buildAiHrFullSlateValidation({ replay, generatedAt: replay.generatedAt })
  writeFileSync(OUT_PATH, JSON.stringify(replay, null, 2))
  writeFileSync(SHADOW_PATH, JSON.stringify(replay.ledger, null, 2))
  writeFileSync(EVALUATION_PATH, JSON.stringify(replay.evaluation, null, 2))
  writeFileSync(FULL_SLATE_PATH, JSON.stringify(fullSlateValidation, null, 2))
  console.log(`[ai-hr-history] wrote ${OUT_PATH}`)
  console.log(`[ai-hr-history] full-slate validation ${fullSlateValidation.decision.status}: ${fullSlateValidation.coverage.fullSlateDates}/${fullSlateValidation.coverage.replayDates} dates qualified`)
  console.log(`[ai-hr-history] ${validation.metrics.signals} signal(s), ${validation.metrics.settled} settled rows, Brier improvement ${validation.metrics.brierImprovement ?? 'n/a'}, gate ${validation.metrics.gateStatus}`)
}

main().catch((error) => {
  console.error(`[ai-hr-history] fatal: ${error.stack || error.message}`)
  process.exitCode = 1
})
