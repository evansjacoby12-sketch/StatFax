import assert from 'node:assert/strict'
import test from 'node:test'

import worker from '../server/cloudflare/src/worker.js'

const URL = 'https://statfax-cron.example.workers.dev/parse'

function request(method, origin) {
  return new Request(URL, {
    method,
    headers: origin ? { Origin: origin, 'Content-Type': 'application/json' } : {},
    body: method === 'POST' ? JSON.stringify({ query: 'prime bats', grades: ['PRIME'], signals: [] }) : undefined,
  })
}

test('Worker rejects missing and foreign origins before a paid AI request', async () => {
  let checks = 0
  const env = { AI_RATE_LIMITER: { limit: async () => { checks++; return { success: true } } } }

  const missing = await worker.fetch(request('POST'), env, {})
  const foreign = await worker.fetch(request('POST', 'https://evil.example'), env, {})

  assert.equal(missing.status, 403)
  assert.equal(foreign.status, 403)
  assert.equal(checks, 0)
})

test('Worker reflects an allowed origin for preflight requests', async () => {
  const origin = 'https://statfax.online'
  const response = await worker.fetch(request('OPTIONS', origin), {}, {})

  assert.equal(response.status, 204)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.equal(response.headers.get('vary'), 'Origin')
})

test('Worker rate limit blocks a paid AI request with a retry hint', async () => {
  const origin = 'http://127.0.0.1:4174'
  const env = {
    AI_RATE_LIMITER: { limit: async () => ({ success: false }) },
  }
  const response = await worker.fetch(request('POST', origin), env, {})

  assert.equal(response.status, 429)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  assert.equal(response.headers.get('retry-after'), '60')
})

test('Worker health endpoint is read-only and reports configured dependencies', async () => {
  const response = await worker.fetch(new Request('https://worker.example/health'), {
    GITHUB_TOKEN: 'configured',
    GITHUB_REPO: 'owner/repo',
    OPENAI_API_KEY: 'configured',
    MLB_HEALTH_URL: 'https://data.example/mlb-data-health.json',
    AI_RATE_LIMITER: { limit: async () => ({ success: true }) },
    DATA_RATE_LIMITER: { limit: async () => ({ success: true }) },
  }, {})
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload.ok, true)
  assert.deepEqual(payload.checks, {
    dispatchConfigured: true,
    aiConfigured: true,
    aiRateLimitConfigured: true,
    dataRateLimitConfigured: true,
    monitorConfigured: true,
  })
  assert.deepEqual(payload.optional, { alertsConfigured: false })
  assert.equal(JSON.stringify(payload).includes('owner/repo'), false)
  assert.equal(JSON.stringify(payload).includes('GITHUB_TOKEN'), false)
})
