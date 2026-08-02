import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { callOpenAiStructured } from '../server/lib/aiProviders.mjs'

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
    async text() { return JSON.stringify(body) },
  }
}

test('OpenAI extraction uses strict Responses API JSON Schema', async () => {
  let request
  const result = await callOpenAiStructured({
    apiKey: 'openai-test',
    model: 'gpt-test',
    instructions: 'Extract.',
    input: 'Source text.',
    schemaName: 'fixture',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) }
      return response({
        id: 'resp-1',
        model: 'gpt-test-snapshot',
        output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }],
      })
    },
  })
  assert.equal(request.init.headers.authorization, 'Bearer openai-test')
  assert.equal(request.body.text.format.type, 'json_schema')
  assert.equal(request.body.text.format.strict, true)
  assert.deepEqual(result.value, { ok: true })
  assert.equal(result.responseId, 'resp-1')
})

test('OpenAI provider retries transient failures', async () => {
  let attempts = 0
  const result = await callOpenAiStructured({
    apiKey: 'openai-test',
    model: 'gpt-test',
    instructions: 'Extract.',
    input: 'Source.',
    schemaName: 'retry_fixture',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    sleepImpl: async () => {},
    fetchImpl: async () => {
      attempts++
      if (attempts === 1) throw new Error('temporary network failure')
      return response({ id: 'resp-retry', output_text: '{"ok":true}' })
    },
  })
  assert.equal(attempts, 2)
  assert.deepEqual(result.value, { ok: true })
})

test('OpenAI insufficient quota fails immediately instead of retrying', async () => {
  let attempts = 0
  await assert.rejects(callOpenAiStructured({
    apiKey: 'openai-test',
    model: 'gpt-test',
    instructions: 'Extract.',
    input: 'Source.',
    schemaName: 'quota_fixture',
    schema: {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    },
    sleepImpl: async () => {},
    fetchImpl: async () => {
      attempts++
      return response({ error: { code: 'insufficient_quota' } }, 429)
    },
  }), /insufficient_quota/)
  assert.equal(attempts, 1)
})

test('remaining AI surfaces contain no Anthropic dependency', () => {
  for (const path of [
    'server/slate-brief.mjs',
    'server/cloudflare/src/worker.js',
    '.github/workflows/deploy.yml',
  ]) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.equal(/anthropic|claude/i.test(text), false, path)
  }
})
