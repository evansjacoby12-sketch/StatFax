import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { evaluateOperationalHealth, monitorOperationalHealth } from '../server/cloudflare/src/worker.js'

test('operational health detects a stale slate, data blockers, and a failed deploy', () => {
  const report = evaluateOperationalHealth({
    health: {
      slateGeneratedAt: '2026-07-31T12:00:00.000Z',
      counts: { hardFailures: 2 },
    },
    workflowRuns: [{ status: 'completed', conclusion: 'failure', html_url: 'https://example.test/run' }],
    now: new Date('2026-07-31T13:00:00.000Z'),
    maxSlateAgeMinutes: 50,
  })

  assert.equal(report.ok, false)
  assert.deepEqual(report.incidents.map((incident) => incident.id), [
    'slate-stale',
    'slate-blocked',
    'workflow-failed',
  ])
})

test('operational monitor sends one alert per incident fingerprint per hour', async () => {
  const requests = []
  const stored = new Map()
  const cache = {
    async match(request) { return stored.get(request.url) || null },
    async put(request, response) { stored.set(request.url, response) },
  }
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options })
    if (String(url).includes('mlb-data-health.json')) {
      return Response.json({ slateGeneratedAt: '2026-07-31T12:00:00.000Z', counts: { hardFailures: 0 } })
    }
    if (String(url).includes('api.github.com')) {
      return Response.json({ workflow_runs: [{ status: 'completed', conclusion: 'success' }] })
    }
    if (String(url) === 'https://alerts.example/hook') return new Response(null, { status: 204 })
    throw new Error(`Unexpected URL ${url}`)
  }
  const env = {
    MLB_HEALTH_URL: 'https://data.example/mlb-data-health.json',
    GITHUB_REPO: 'owner/repo',
    ALERT_WEBHOOK_URL: 'https://alerts.example/hook',
    MAX_SLATE_AGE_MINUTES: '50',
  }
  const now = new Date('2026-07-31T13:00:00.000Z')

  const first = await monitorOperationalHealth(env, { fetchImpl, cache, now })
  const second = await monitorOperationalHealth(env, { fetchImpl, cache, now })

  assert.equal(first.alert.sent, true)
  assert.equal(second.alert.sent, false)
  assert.equal(second.alert.reason, 'deduplicated')
  assert.equal(requests.filter((request) => request.url === env.ALERT_WEBHOOK_URL).length, 1)
  const alertPayload = JSON.parse(requests.find((request) => request.url === env.ALERT_WEBHOOK_URL).options.body)
  assert.match(alertPayload.content, /60\.0 minutes old/)
  assert.equal(alertPayload.content, alertPayload.text)
})

test('deployment workflow has a non-blocking optional webhook job for production failures', async () => {
  const workflow = await readFile(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')

  assert.match(workflow, /notify-production-failure:/)
  assert.match(workflow, /needs\.build-deploy\.result == 'failure'/)
  assert.match(workflow, /secrets\.ALERT_WEBHOOK_URL/)
})
