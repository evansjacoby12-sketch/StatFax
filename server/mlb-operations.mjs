import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')
const DEFAULT_R2 = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev'

export const MLB_ARTIFACTS = Object.freeze([
  'daily.json',
  'backtest-log.json',
  'calibration.json',
  'mlb-game-results.json',
  'mlb-game-history.json',
  'first-inning-pitcher-cache.json',
  'pregame-freeze.json',
  'list-builder-evidence.json',
  'board-history.json',
  'zone-cache.json',
  'zone-evaluation.json',
  'context.json',
  'mlb-data-health.json',
  'mlb-data-health-history.json',
  'ai-hr-shadow.json',
  'ai-hr-evaluation.json',
  'ai-hr-attribution.json',
  'ai-hr-production.json',
  'brief.json',
])

const CRITICAL = Object.freeze(['backtest-log.json', 'mlb-game-results.json', 'mlb-game-history.json'])

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function validateMLBArtifact(name, value) {
  if (/^inputs-\d{4}-\d{2}-\d{2}\.json$/.test(name)) return Array.isArray(value)
  if (!isObject(value)) return false
  if (name === 'daily.json') return typeof value.date === 'string' && Array.isArray(value.games)
  if (name === 'backtest-log.json') return Array.isArray(value.dates) && isObject(value.records)
  if (name === 'mlb-game-results.json') return Array.isArray(value.games)
  if (name === 'mlb-game-history.json') return Array.isArray(value.seasons)
  if (name === 'first-inning-pitcher-cache.json') return Array.isArray(value.records)
  if (name === 'pregame-freeze.json') return typeof value.date === 'string' && isObject(value.byKey)
  return true
}

async function readArtifact(file, name = path.basename(file)) {
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'))
    return validateMLBArtifact(name, parsed) ? parsed : null
  } catch {
    return null
  }
}

async function atomicWrite(file, text) {
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(temporary, text)
  await fs.rename(temporary, file)
}

export async function archiveMLBArtifacts({ directory = DIST, now = new Date(), keep = 14 } = {}) {
  const available = []
  for (const name of MLB_ARTIFACTS) {
    if (await readArtifact(path.join(directory, name), name)) available.push(name)
  }
  const inputFiles = (await fs.readdir(directory).catch(() => []))
    .filter((name) => /^inputs-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  for (const name of inputFiles) {
    if (await readArtifact(path.join(directory, name), name)) available.push(name)
  }
  if (!available.length) return null

  const archivedAt = new Date(now).toISOString()
  const id = archivedAt.replace(/[:.]/g, '-')
  const archiveRoot = path.join(directory, 'mlb-archive')
  const target = path.join(archiveRoot, id)
  await fs.mkdir(target, { recursive: true })
  for (const name of available) await fs.copyFile(path.join(directory, name), path.join(target, name))
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify({ version: 1, sport: 'mlb', archivedAt, artifacts: available }, null, 2))

  const entries = (await fs.readdir(archiveRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()
  for (const stale of entries.slice(keep)) await fs.rm(path.join(archiveRoot, stale), { recursive: true, force: true })
  return target
}

export async function rollbackMLBArtifacts(snapshotId, { directory = DIST } = {}) {
  const archiveRoot = path.join(directory, 'mlb-archive')
  const entries = (await fs.readdir(archiveRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()
  const selected = snapshotId || entries[0]
  if (!selected || !entries.includes(selected)) throw new Error(`MLB archive not found: ${selected || 'latest'}`)
  const source = path.join(archiveRoot, selected)
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'))
  const restored = []
  for (const name of manifest.artifacts || []) {
    if (!MLB_ARTIFACTS.includes(name) && !/^inputs-\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue
    const text = await fs.readFile(path.join(source, name), 'utf8')
    const parsed = JSON.parse(text)
    if (!validateMLBArtifact(name, parsed)) throw new Error(`Invalid archived MLB artifact: ${name}`)
    await atomicWrite(path.join(directory, name), text)
    restored.push(name)
  }
  return { snapshotId: selected, artifacts: restored }
}

export async function recoverMLBArtifacts({
  baseUrl = process.env.MLB_R2_PUBLIC_BASE_URL || DEFAULT_R2,
  archiveDate = process.env.MLB_R2_ARCHIVE_DATE || null,
  directory = DIST,
  fetchImpl = globalThis.fetch,
  missingOnly = false,
} = {}) {
  const base = baseUrl.replace(/\/$/, '')
  const prefix = archiveDate ? `${base}/mlb/archive/${archiveDate}` : base
  const restored = []
  const skipped = []
  const unavailable = []
  await fs.mkdir(directory, { recursive: true })

  for (const name of MLB_ARTIFACTS) {
    const target = path.join(directory, name)
    if (missingOnly && await readArtifact(target, name)) {
      skipped.push(name)
      continue
    }
    let response
    try {
      response = await fetchImpl(`${prefix}/${name}`, { headers: { Accept: 'application/json' } })
    } catch {
      unavailable.push(name)
      continue
    }
    if (!response.ok) {
      unavailable.push(name)
      continue
    }
    const text = await response.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = null }
    if (!validateMLBArtifact(name, parsed)) {
      unavailable.push(name)
      continue
    }
    await atomicWrite(target, text)
    restored.push(name)
  }

  const missingCritical = []
  for (const name of CRITICAL) {
    if (!await readArtifact(path.join(directory, name), name)) missingCritical.push(name)
  }
  if (missingCritical.length) throw new Error(`MLB recovery missing critical artifacts: ${missingCritical.join(', ')}`)
  return { source: prefix, restored, skipped, unavailable, missingCritical }
}

export async function auditMLBArtifacts({ directory = DIST } = {}) {
  const artifacts = {}
  for (const name of MLB_ARTIFACTS) artifacts[name] = Boolean(await readArtifact(path.join(directory, name), name))
  const missingCritical = CRITICAL.filter((name) => !artifacts[name])
  return { ok: missingCritical.length === 0, artifacts, missingCritical }
}

async function cli() {
  const args = process.argv.slice(2)
  const command = args[0] || 'audit'
  const value = args[1] && !args[1].startsWith('--') ? args[1] : null
  const output = command === 'archive' ? await archiveMLBArtifacts()
    : command === 'rollback' ? await rollbackMLBArtifacts(value)
      : command === 'recover' ? await recoverMLBArtifacts({
        archiveDate: value || process.env.MLB_R2_ARCHIVE_DATE || null,
        missingOnly: args.includes('--missing-only'),
      })
        : await auditMLBArtifacts()
  console.log(JSON.stringify(output, null, 2))
  if (command === 'audit' && !output.ok) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => { console.error(`[mlb-ops] ${error.message}`); process.exitCode = 1 })
}
