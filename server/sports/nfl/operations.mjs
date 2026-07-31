import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const NFL_DIR = path.join(ROOT, 'dist', 'nfl')
const ARTIFACTS = ['daily.json', 'tracking.json', 'backtest.json', 'history.json', 'preseason.json', 'readiness.json']

async function validJSON(file) {
  try { JSON.parse(await fs.readFile(file, 'utf8')); return true } catch { return false }
}

export async function archiveNFLArtifacts({ directory = NFL_DIR, now = new Date(), keep = 40 } = {}) {
  const available = []
  for (const name of ARTIFACTS) if (await validJSON(path.join(directory, name))) available.push(name)
  if (!available.length) return null
  const id = new Date(now).toISOString().replace(/[:.]/g, '-')
  const target = path.join(directory, 'archive', id)
  await fs.mkdir(target, { recursive: true })
  for (const name of available) await fs.copyFile(path.join(directory, name), path.join(target, name))
  await fs.writeFile(path.join(target, 'manifest.json'), JSON.stringify({ version: 1, archivedAt: new Date(now).toISOString(), artifacts: available }, null, 2))
  const archiveRoot = path.join(directory, 'archive')
  const entries = (await fs.readdir(archiveRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()
  for (const stale of entries.slice(keep)) await fs.rm(path.join(archiveRoot, stale), { recursive: true, force: true })
  return target
}

export async function rollbackNFLArtifacts(snapshotId, { directory = NFL_DIR } = {}) {
  const archiveRoot = path.join(directory, 'archive')
  const entries = (await fs.readdir(archiveRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()
  const selected = snapshotId || entries[0]
  if (!selected || !entries.includes(selected)) throw new Error(`NFL archive not found: ${selected || 'latest'}`)
  const source = path.join(archiveRoot, selected)
  const manifest = JSON.parse(await fs.readFile(path.join(source, 'manifest.json'), 'utf8'))
  for (const name of manifest.artifacts || []) await fs.copyFile(path.join(source, name), path.join(directory, name))
  return { snapshotId: selected, artifacts: manifest.artifacts || [] }
}

export async function recoverNFLArtifacts({ baseUrl = process.env.NFL_R2_PUBLIC_BASE_URL, directory = NFL_DIR } = {}) {
  if (!baseUrl) throw new Error('Set NFL_R2_PUBLIC_BASE_URL to the public bucket base URL')
  await fs.mkdir(directory, { recursive: true })
  const restored = []
  for (const name of ARTIFACTS.filter((item) => item !== 'daily.json')) {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/nfl/${name}`, { headers: { Accept: 'application/json' } })
    if (!response.ok) continue
    const text = await response.text()
    JSON.parse(text)
    await fs.writeFile(`${path.join(directory, name)}.tmp`, text)
    await fs.rename(`${path.join(directory, name)}.tmp`, path.join(directory, name))
    restored.push(name)
  }
  if (!restored.includes('tracking.json')) throw new Error('R2 recovery did not return nfl/tracking.json')
  return restored
}

export async function auditNFLArtifacts({ directory = NFL_DIR } = {}) {
  const result = {}
  for (const name of ARTIFACTS) result[name] = await validJSON(path.join(directory, name))
  const daily = result['daily.json'] ? JSON.parse(await fs.readFile(path.join(directory, 'daily.json'), 'utf8')) : null
  const readiness = daily?.dataHealth?.readiness || (result['readiness.json'] ? JSON.parse(await fs.readFile(path.join(directory, 'readiness.json'), 'utf8')) : null)
  const critical = [...(daily?.dataHealth?.alarms?.filter((alarm) => alarm.severity === 'critical') || [])]
  const ageHours = daily?.generatedAt ? (Date.now() - +new Date(daily.generatedAt)) / 3600000 : null
  const hasLiveGame = (daily?.games || []).some((game) => game.status?.state === 'in')
  const staleAfterHours = hasLiveGame ? .75 : 36
  if (ageHours == null || !Number.isFinite(ageHours) || ageHours > staleAfterHours) critical.push({ id: 'stale-snapshot', severity: 'critical', message: ageHours == null ? 'Snapshot timestamp is missing' : `Snapshot is ${ageHours.toFixed(1)} hours old` })
  const tracking = result['tracking.json'] ? JSON.parse(await fs.readFile(path.join(directory, 'tracking.json'), 'utf8')) : null
  if ((daily?.players?.length || 0) > 0 && !Array.isArray(tracking?.records)) critical.push({ id: 'tracking-reset', severity: 'critical', message: 'Tracking ledger is missing its records array' })
  return { ok: Boolean(result['daily.json'] && result['tracking.json'] && result['backtest.json'] && critical.length === 0), artifacts: result, readiness, ageHours, critical }
}

async function cli() {
  const [command = 'audit', value] = process.argv.slice(2)
  const output = command === 'archive' ? await archiveNFLArtifacts()
    : command === 'rollback' ? await rollbackNFLArtifacts(value)
      : command === 'recover' ? await recoverNFLArtifacts()
        : await auditNFLArtifacts()
  console.log(JSON.stringify(output, null, 2))
  if (command === 'audit' && !output.ok) process.exitCode = 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) cli().catch((error) => { console.error(`[nfl-ops] ${error.message}`); process.exitCode = 1 })
