import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { archiveMLBArtifacts, auditMLBArtifacts, recoverMLBArtifacts, rollbackMLBArtifacts } from '../server/mlb-operations.mjs'

const fixtures = {
  'backtest-log.json': { dates: ['2026-07-30'], records: {} },
  'mlb-game-results.json': { games: [{ gamePk: 1 }] },
  'mlb-game-history.json': { seasons: [{ season: 2026 }] },
  'pregame-freeze.json': { date: '2026-07-31', byKey: {} },
}

async function tempDirectory() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'statfax-mlb-ops-'))
}

async function seed(directory, values = fixtures) {
  for (const [name, value] of Object.entries(values)) await fs.writeFile(path.join(directory, name), JSON.stringify(value))
}

test('MLB archive and rollback restore a validated known-good snapshot', async () => {
  const directory = await tempDirectory()
  await seed(directory)
  const target = await archiveMLBArtifacts({ directory, now: new Date('2026-08-01T00:00:00Z') })
  await fs.writeFile(path.join(directory, 'backtest-log.json'), JSON.stringify({ dates: [], records: {} }))

  const result = await rollbackMLBArtifacts(path.basename(target), { directory })
  const restored = JSON.parse(await fs.readFile(path.join(directory, 'backtest-log.json'), 'utf8'))
  assert.deepEqual(restored.dates, ['2026-07-30'])
  assert.ok(result.artifacts.includes('pregame-freeze.json'))
})

test('MLB R2 recovery writes valid artifacts atomically and preserves missing-only state', async () => {
  const directory = await tempDirectory()
  await seed(directory, { 'backtest-log.json': fixtures['backtest-log.json'] })
  const fetchImpl = async (url) => {
    const name = url.split('/').pop()
    const value = fixtures[name]
    return value
      ? new Response(JSON.stringify(value), { status: 200 })
      : new Response('missing', { status: 404 })
  }
  const result = await recoverMLBArtifacts({ directory, fetchImpl, baseUrl: 'https://r2.example', missingOnly: true })
  assert.ok(result.skipped.includes('backtest-log.json'))
  assert.ok(result.restored.includes('mlb-game-results.json'))
  assert.ok(result.restored.includes('mlb-game-history.json'))
  assert.equal((await auditMLBArtifacts({ directory })).ok, true)
  assert.equal((await fs.readdir(directory)).some((name) => name.includes('.tmp-')), false)
})

test('MLB recovery refuses to report success without all critical artifacts', async () => {
  const directory = await tempDirectory()
  const fetchImpl = async () => new Response('missing', { status: 404 })
  await assert.rejects(
    recoverMLBArtifacts({ directory, fetchImpl, baseUrl: 'https://r2.example' }),
    /missing critical artifacts/i,
  )
})

test('deployment recovers optional MLB state and writes a daily R2 archive', async () => {
  const workflow = await fs.readFile(path.resolve('.github/workflows/deploy.yml'), 'utf8')
  assert.match(workflow, /npm run mlb:recover -- --missing-only/)
  assert.match(workflow, /mlb\/archive\/\$ARCHIVE_DATE/)
  assert.match(workflow, /pregame-freeze\.json/)
})
