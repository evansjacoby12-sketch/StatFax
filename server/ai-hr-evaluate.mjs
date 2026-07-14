import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidAiHrEvaluation, buildAiHrEvaluation } from './lib/aiHrEvaluation.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LEDGER_PATH = resolve(__dirname, '../dist/ai-hr-shadow.json')
const BACKTEST_PATH = resolve(__dirname, '../dist/backtest-log.json')
const OUT_PATH = resolve(__dirname, '../dist/ai-hr-evaluation.json')
const R2_BASE = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev'

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function fetchJson(url) {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' })
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  }
}

async function load(localPath, remoteName) {
  if (existsSync(localPath)) return readJson(localPath)
  return fetchJson(`${R2_BASE}/${remoteName}`)
}

try {
  const ledger = await load(LEDGER_PATH, 'ai-hr-shadow.json')
  if (!ledger) {
    console.log('[ai-hr-evaluation] skipped: no shadow ledger available')
    process.exit(0)
  }
  const backtestLog = await load(BACKTEST_PATH, 'backtest-log.json') || {}
  const report = buildAiHrEvaluation({ ledger, backtestLog })
  const validation = assertValidAiHrEvaluation(report)
  writeFileSync(OUT_PATH, JSON.stringify(report))
  for (const warning of validation.warnings) console.warn(`[ai-hr-evaluation] warning: ${warning}`)
  const delta = validation.metrics.brierImprovement
  console.log(`[ai-hr-evaluation] wrote ${OUT_PATH} — ${validation.metrics.settled} settled, ${validation.metrics.pending} pending, Brier Δ ${delta == null ? 'n/a' : delta.toFixed(6)} · gate=${validation.metrics.gateStatus} · production unchanged`)
} catch (error) {
  console.error(`[ai-hr-evaluation] ${error.message}`)
  process.exitCode = 1
}
