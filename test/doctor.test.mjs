import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { assessFreshness, formatDoctor, runDoctor } from '../server/doctor.mjs'

test('doctor freshness reports exact decimal age and enforces the threshold', () => {
  const now = new Date('2026-07-31T19:00:00.000Z')
  assert.deepEqual(assessFreshness('2026-07-31T18:30:00.000Z', now, 50), { ok: true, ageMinutes: 30, reason: 'fresh' })
  assert.deepEqual(assessFreshness('2026-07-31T18:00:00.000Z', now, 50), { ok: false, ageMinutes: 60, reason: 'older than 50 minutes' })
})

test('offline doctor validates required repo files without reading secrets', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statfax-doctor-'))
  fs.mkdirSync(path.join(root, 'ui'), { recursive: true })
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), '{}')
  fs.writeFileSync(path.join(root, 'ui', 'package.json'), '{}')
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'deploy.yml'), 'name: test')
  fs.writeFileSync(path.join(root, 'dist', 'backtest-log.json'), '{}')

  const report = await runDoctor({ root, offline: true, now: new Date('2026-07-31T19:00:00Z') })
  assert.equal(report.status, 'pass')
  assert.equal(report.counts.fail, 0)
  assert.match(formatDoctor(report), /never reads or prints secret values/i)
  assert.equal(JSON.stringify(report).includes('test-key'), false)
})

test('online doctor fails a stale slate and a failed workflow', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'statfax-doctor-'))
  for (const relative of ['package.json', 'ui/package.json', '.github/workflows/deploy.yml', 'dist/backtest-log.json']) {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, relative.endsWith('.json') ? '{}' : 'name: test')
  }
  const now = new Date('2026-07-31T19:00:00Z')
  const fetchImpl = async (url) => {
    let body
    if (url.includes('version.json')) body = { sha: 'abcdef123', builtAt: now.toISOString() }
    else if (url.includes('/health?')) body = { ok: true, checks: { dispatchConfigured: true, aiConfigured: true, aiRateLimitConfigured: true, dataRateLimitConfigured: true } }
    else if (url.includes('api.github.com')) body = { workflow_runs: [{ status: 'completed', conclusion: 'failure', html_url: 'https://example.test/run', head_sha: 'bad' }] }
    else body = { status: 'healthy', slateGeneratedAt: '2026-07-31T17:00:00Z', counts: { hardFailures: 0, warnings: 0 } }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const report = await runDoctor({ root, now, fetchImpl })
  assert.equal(report.status, 'fail')
  assert.equal(report.checks.find((check) => check.id === 'site:slate').status, 'fail')
  assert.equal(report.checks.find((check) => check.id === 'github:deploy').status, 'fail')
})
