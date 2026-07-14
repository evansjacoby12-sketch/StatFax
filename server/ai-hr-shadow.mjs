import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidAiHrContext, isPregameMlbGame } from './lib/aiHrContext.mjs'
import {
  assertValidAiHrShadowLedger,
  buildAiHrShadowRecords,
  mergeAiHrShadowLedger,
  validateAiHrShadowLedger,
} from './lib/aiHrShadow.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SLATE_PATH = resolve(__dirname, '../dist/daily.json')
const CONTEXT_PATH = resolve(__dirname, '../dist/context.json')
const OUT_PATH = resolve(__dirname, '../dist/ai-hr-shadow.json')
const R2_BASE = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function fetchJson(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) return null
  return response.json()
}

async function loadSlate() {
  if (existsSync(SLATE_PATH)) return readJson(SLATE_PATH)
  const slate = await fetchJson(`${R2_BASE}/daily.json`)
  if (!slate) throw new Error('no local slate and R2 fetch failed')
  return slate
}

async function priorLedger() {
  if (!existsSync(OUT_PATH)) {
    try {
      const remote = await fetchJson(`${R2_BASE}/ai-hr-shadow.json`)
      if (remote && validateAiHrShadowLedger(remote).ok) return remote
    } catch (error) {
      console.warn(`[ai-hr-shadow] R2 ledger unavailable; starting clean: ${error.message}`)
    }
    return null
  }
  try {
    const prior = readJson(OUT_PATH)
    if (!validateAiHrShadowLedger(prior).ok) console.warn('[ai-hr-shadow] prior ledger invalid; starting a clean v1 ledger')
    return prior
  } catch (error) {
    console.warn(`[ai-hr-shadow] prior ledger unreadable; starting clean: ${error.message}`)
    return null
  }
}

if (!existsSync(CONTEXT_PATH)) {
  console.log('[ai-hr-shadow] skipped: context.json is required')
  process.exit(0)
}

try {
  const slate = await loadSlate()
  const context = readJson(CONTEXT_PATH)
  assertValidAiHrContext(context)
  const updatedAt = new Date().toISOString()
  const records = buildAiHrShadowRecords({ slate, context, generatedAt: updatedAt })
  const shouldReplacePregame = !context.skipped && context.date === slate.date
  const replaceGamePks = shouldReplacePregame
    ? (slate.games || []).filter(isPregameMlbGame).map((game) => Number(game.gamePk))
    : []
  const ledger = mergeAiHrShadowLedger({
    previous: await priorLedger(),
    date: slate.date,
    records,
    replaceGamePks,
    updatedAt,
  })
  const validation = assertValidAiHrShadowLedger(ledger)
  writeFileSync(OUT_PATH, JSON.stringify(ledger))
  for (const warning of validation.warnings) console.warn(`[ai-hr-shadow] warning: ${warning}`)
  console.log(`[ai-hr-shadow] wrote ${OUT_PATH} — ${records.length} current projection(s), ${validation.metrics.records} retained · production unchanged`)
} catch (error) {
  console.error(`[ai-hr-shadow] ${error.message}`)
  process.exitCode = 1
}
