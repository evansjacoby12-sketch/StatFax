import { test } from 'node:test'
import assert from 'node:assert/strict'

import worker from '../server/cloudflare/src/worker.js'
import { translateListBuilderQuery } from '../ui/src/lib/list-builder-ai.js'

test('browser translator sends only the query and sanitizes returned criteria', async () => {
  let requestBody = null
  const result = await translateListBuilderQuery(' confirmed hot bats ', {
    workerUrl: 'https://worker.example/',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://worker.example/list-builder')
      assert.equal(init.method, 'POST')
      requestBody = JSON.parse(init.body)
      return {
        ok: true,
        async json() {
          return {
            criteria: { minBarrel: 12, signals: ['hot', 'not-real'], confirmedOnly: true, scoringDelta: 9 },
            summary: 'Confirmed hot bats with a barrel floor.',
          }
        },
      }
    },
  })
  assert.deepEqual(requestBody, { query: 'confirmed hot bats' })
  assert.equal(result.criteria.minBarrel, 12)
  assert.deepEqual(result.criteria.signals, ['hot'])
  assert.equal(result.criteria.confirmedOnly, true)
  assert.equal('scoringDelta' in result.criteria, false)
})

test('worker returns strict visible criteria without receiving slate data', async () => {
  const originalFetch = globalThis.fetch
  let openAiRequest = null
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    openAiRequest = JSON.parse(init.body)
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        criteria: {
          minOppHr9: 99,
          minBarrel: 12,
          minISO: 0.2,
          maxPitcherK9: 8,
          signals: ['hot', 'invented'],
          signalMode: 'any',
          pregameOnly: true,
          confirmedOnly: true,
          trustedOnly: false,
          sort: 'score',
        },
        summary: 'Confirmed hot bats with power against exposed pitching.',
      }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const response = await worker.fetch(new Request('https://worker.example/list-builder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'confirmed hot power bats against HR-prone pitching' }),
    }), { OPENAI_API_KEY: 'test-key' }, {})
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.criteria.minOppHr9, 4)
    assert.equal(payload.criteria.minBarrel, 12)
    assert.equal(payload.criteria.minISO, 0.2)
    assert.equal(payload.criteria.maxPitcherK9, 8)
    assert.deepEqual(payload.criteria.signals, ['hot'])
    assert.equal(payload.criteria.minHeat, null)
    assert.equal(payload.criteria.confirmedOnly, true)

    assert.equal(openAiRequest.text.format.type, 'json_schema')
    assert.equal(openAiRequest.text.format.strict, true)
    assert.equal('uniqueItems' in openAiRequest.text.format.schema.properties.criteria.properties.signals, false)
    assert.equal(openAiRequest.input, 'confirmed hot power bats against HR-prone pitching')
    assert.equal(JSON.stringify(openAiRequest).includes('playerId'), false)
    assert.equal('slate' in openAiRequest, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('worker rejects an empty List Builder prompt before calling OpenAI', async () => {
  const response = await worker.fetch(new Request('https://worker.example/list-builder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '   ' }),
  }), { OPENAI_API_KEY: 'test-key' }, {})
  assert.equal(response.status, 400)
})
