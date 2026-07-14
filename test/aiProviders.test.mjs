import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  callOpenAiStructured,
  normalizeTavilySources,
  searchTavily,
} from '../server/lib/aiProviders.mjs'
import {
  bindAiHrEvidenceToSources,
  buildAiHrExtractionInput,
  researchAiHrSignals,
} from '../server/lib/aiHrResearch.mjs'

const slate = {
  date: '2026-07-15',
  games: [{
    gamePk: 101,
    gameDate: '2026-07-15T23:05:00.000Z',
    venueName: 'Test Park',
    status: 'Scheduled',
    awayTeam: { id: 1, abbr: 'NYY' },
    homeTeam: { id: 2, abbr: 'BOS' },
  }],
  scoredBatters: {
    '7-101': {
      playerId: 7,
      gamePk: 101,
      name: 'Test Slugger',
      team: 'NYY',
      teamId: 1,
      score: 82,
      grade: 'PRIME',
      hrProbability: 0.18,
    },
  },
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body },
    async text() { return JSON.stringify(body) },
  }
}

test('Tavily request enforces date bounds and date-only sources stay timestamp-unknown', async () => {
  let request
  const result = await searchTavily({
    apiKey: 'tvly-test',
    query: 'MLB lineups',
    startDate: '2026-07-14',
    endDate: '2026-07-16',
    fetchImpl: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) }
      return response({
        request_id: 'tvly-1',
        usage: { credits: 1 },
        results: [
          { url: 'https://example.com/exact', title: 'Exact time', content: 'Pregame report', published_date: '2026-07-15T18:30:00Z', score: 0.9 },
          { url: 'https://example.com/date-only', title: 'Date only', content: 'Ambiguous report', published_date: '2026-07-15', score: 0.8 },
        ],
      })
    },
  })
  assert.equal(request.init.headers.authorization, 'Bearer tvly-test')
  assert.equal(request.body.start_date, '2026-07-14')
  assert.equal(request.body.end_date, '2026-07-16')
  assert.equal(request.body.include_answer, false)
  assert.equal(result.sources[0].publishedAt, '2026-07-15T18:30:00.000Z')
  assert.equal(result.sources[1].publishedAt, null)
})

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

test('provider requests retry throttling and transient failures', async () => {
  let tavilyAttempts = 0
  const tavily = await searchTavily({
    apiKey: 'tvly-test',
    query: 'MLB weather',
    sleepImpl: async () => {},
    fetchImpl: async () => {
      tavilyAttempts++
      if (tavilyAttempts === 1) return response({ error: 'rate limited' }, 429)
      return response({ request_id: 'retry-ok', results: [] })
    },
  })
  assert.equal(tavilyAttempts, 2)
  assert.equal(tavily.requestId, 'retry-ok')

  let openAiAttempts = 0
  const openAi = await callOpenAiStructured({
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
      openAiAttempts++
      if (openAiAttempts === 1) throw new Error('temporary network failure')
      return response({ id: 'resp-retry', output_text: '{"ok":true}' })
    },
  })
  assert.equal(openAiAttempts, 2)
  assert.deepEqual(openAi.value, { ok: true })
})

test('evidence binding drops invented URLs and overwrites model metadata', () => {
  const sources = [{
    url: 'https://example.com/lineup',
    title: 'Retrieved lineup',
    publishedAt: '2026-07-15T18:00:00.000Z',
    content: 'Source content',
  }]
  const bound = bindAiHrEvidenceToSources({ signals: [{
    entityKey: 'batter:7:101',
    evidence: [
      { url: sources[0].url, title: 'Model rewrite', publishedAt: '2099-01-01T00:00:00Z' },
      { url: 'https://invented.example/hallucination', title: 'Invented', publishedAt: null },
    ],
  }] }, sources)
  assert.deepEqual(bound.signals[0].evidence, [{
    url: sources[0].url,
    title: sources[0].title,
    publishedAt: sources[0].publishedAt,
  }])
})

test('Tavily plus OpenAI research is source-locked and never receives outcome fields', async () => {
  let tavilyCalls = 0
  let openAiBody
  const fetchImpl = async (url, init) => {
    if (url.includes('tavily.com')) {
      tavilyCalls++
      return response({
        request_id: `tvly-${tavilyCalls}`,
        usage: { credits: 1 },
        results: [{
          url: 'https://example.com/lineup',
          title: 'Official pregame lineup',
          content: 'Test Slugger is listed in the starting lineup.',
          published_date: '2026-07-15T18:00:00Z',
          score: 0.9,
        }],
      })
    }
    openAiBody = JSON.parse(init.body)
    return response({
      id: 'resp-hr',
      model: 'gpt-test',
      output: [{ content: [{ type: 'output_text', text: JSON.stringify({ signals: [{
        entityKey: 'batter:7:101',
        kind: 'lineup-status',
        direction: 'boost',
        severity: 'info',
        confidence: 0.8,
        note: 'Test Slugger is confirmed in the lineup.',
        observedAt: '2026-07-15T18:00:00Z',
        expiresAt: '2026-07-16T00:00:00Z',
        evidence: [{ url: 'https://example.com/lineup', title: 'Wrong title', publishedAt: null }],
      }] }) }] }],
    })
  }
  const result = await researchAiHrSignals({
    slate,
    generatedAt: '2026-07-15T19:00:00.000Z',
    historical: true,
    tavilyApiKey: 'tvly-test',
    openAiApiKey: 'openai-test',
    model: 'gpt-test',
    fetchImpl,
  })
  assert.equal(tavilyCalls, 3)
  assert.equal(result.provider, 'tavily+openai')
  assert.equal(result.audit.sourceCount, 1)
  assert.equal(result.raw.signals[0].evidence[0].title, 'Official pregame lineup')
  assert.ok(openAiBody.text.format.schema.properties.signals.items.properties.entityKey.enum.includes('batter:7:101'))
  assert.ok(openAiBody.text.format.schema.properties.signals.items.properties.evidence.items.properties.url.enum.includes('https://example.com/lineup'))
  assert.equal(openAiBody.input.includes('homered'), false)
  assert.equal(openAiBody.input.includes('actuallyPlayed'), false)
})

test('extraction input contains only sanitized slate targets and retrieved sources', () => {
  const input = buildAiHrExtractionInput({
    slate,
    generatedAt: '2026-07-15T19:00:00.000Z',
    historical: true,
    sources: [{ url: 'https://example.com/source', title: 'Source', content: 'Pregame fact', publishedAt: '2026-07-15T18:00:00.000Z' }],
  })
  assert.ok(input.includes('batter:7:101'))
  assert.ok(input.includes('https://example.com/source'))
  assert.equal(input.includes('hrProbability'), false)
})

test('active AI surfaces contain no Anthropic dependency', () => {
  const paths = [
    'server/context-pass.mjs',
    'server/ai-hr-history.mjs',
    'server/slate-brief.mjs',
    'server/cloudflare/src/worker.js',
    '.github/workflows/deploy.yml',
    '.github/workflows/ai-hr-history.yml',
  ]
  for (const path of paths) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.equal(/anthropic|claude/i.test(text), false, path)
  }
})
