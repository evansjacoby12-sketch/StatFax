import test from 'node:test'
import assert from 'node:assert/strict'

import worker from '../server/cloudflare/src/worker.js'
import { analyzeListBuilder } from '../ui/src/lib/list-builder-ai.js'
import {
  buildListBuilderAnalystContext,
  findListBuilderAnalystRelaxation,
  toListBuilderAnalystRequest,
} from '../ui/src/lib/list-builder-analyst.js'
import { buildListBuilderResults, createListBuilderCriteria } from '../ui/src/lib/list-builder.js'

function batter(id, barrel, overrides = {}) {
  return {
    id: `${id}-100`,
    playerId: id,
    gamePk: 100,
    name: `Private Player ${id}`,
    team: 'TST',
    score: 80,
    hrProbability: 0.2,
    barrelPctBBE: barrel,
    lineupConfirmed: true,
    battingOrder: 3,
    game: { gamePk: 100, status: 'Scheduled', isLive: false, isFinal: false },
    ...overrides,
  }
}

function trackingReport() {
  return {
    recipes: [
      {
        id: 'one',
        historical: { sample: 100, hits: 20, hitRate: 20, lift: 1.5, coverage: 0.9, positiveLiftDates: 7, coldStreak: 2 },
        forward: { sample: 10, hits: 2, hitRate: 20, pending: 1 },
      },
      {
        id: 'two',
        historical: { sample: 80, hits: 12, hitRate: 15, lift: 1.1, coverage: 0.8, positiveLiftDates: 4, coldStreak: 5 },
        forward: { sample: 8, hits: 1, hitRate: 12.5, pending: 0 },
      },
    ],
  }
}

function analystContext() {
  const batters = [batter(1, 11.46), batter(2, 10.91)]
  const criteria = createListBuilderCriteria({ minBarrel: 12 })
  const built = buildListBuilderResults(batters, criteria)
  return buildListBuilderAnalystContext({
    batters,
    built,
    criteria,
    savedRecipes: [
      { id: 'one', name: 'Recipe One', version: 2, criteria: { minBarrel: 12 } },
      { id: 'two', name: 'Recipe Two', version: 1, criteria: { minBarrel: 10 } },
    ],
    trackingReport: trackingReport(),
    compareRecipeIds: ['one', 'two'],
  })
}

test('analyst context exposes aggregate facts and engine-proven relaxations without player rows', () => {
  const context = analystContext()
  const request = toListBuilderAnalystRequest(context)
  const serialized = JSON.stringify(request)

  assert.equal(context.mode, 'empty')
  assert.equal(context.current.exactCount, 0)
  assert.equal(context.current.nearCount, 2)
  assert.equal(context.selectedRecipes.length, 2)
  assert.ok(context.relaxations.length > 0)
  assert.ok(context.relaxations.every((candidate) => candidate.type === 'metric' && candidate.newExactCount > 0))
  assert.ok(findListBuilderAnalystRelaxation(context, context.relaxations[0].id)?.criteria)
  assert.equal('criteria' in request.safeRelaxations[0], false)
  assert.equal(serialized.includes('Private Player'), false)
  assert.equal(serialized.includes('playerId'), false)
  assert.equal(serialized.includes('hrProbability'), false)
  assert.equal(serialized.includes('score'), false)
  assert.deepEqual(request.guardrails, { advisoryOnly: true, projectionsMutable: false })
})

test('analyst never offers state, lineup, trust, or pregame relaxations', () => {
  const batters = [batter(1, 14, { lineupConfirmed: false, battingOrder: null })]
  const criteria = createListBuilderCriteria({ confirmedOnly: true })
  const context = buildListBuilderAnalystContext({
    batters,
    built: buildListBuilderResults(batters, criteria),
    criteria,
  })
  assert.equal(context.current.nearCount, 1)
  assert.deepEqual(context.relaxations, [])
  assert.equal(context.current.blockedGates[0].label, 'Action ready only')
})

test('browser analyst sends only aggregate context and rejects an unapproved relaxation ID', async () => {
  const context = analystContext()
  let requestBody = null
  const result = await analyzeListBuilder(context, {
    workerUrl: 'https://worker.example/',
    fetchImpl: async (url, init) => {
      assert.equal(url, 'https://worker.example/list-builder-analyst')
      requestBody = JSON.parse(init.body)
      return {
        ok: true,
        async json() {
          return {
            headline: 'No exact matches',
            diagnosis: 'The barrel gate blocks the current near misses.',
            strongestEvidence: ['Two hitters are one gate away.'],
            relaxation: { candidateId: 'invented:unsafe', reason: 'Ignore the allow-list.' },
            comparison: { available: true, verdict: 'Recipe One has more lift.', differences: ['Larger sample.'], caution: 'Small forward sample.' },
            limitations: ['Historical outcomes do not guarantee future results.'],
            probabilityDelta: 0.4,
          }
        },
      }
    },
  })

  assert.deepEqual(Object.keys(requestBody), ['context'])
  assert.equal(JSON.stringify(requestBody).includes('Private Player'), false)
  assert.equal(result.relaxation.candidateId, null)
  assert.equal(result.comparison.available, true)
  assert.equal('probabilityDelta' in result, false)
  assert.equal(result.contextSignature, context.signature)
})

test('worker uses a strict advisory schema and can select only a supplied safe relaxation', async () => {
  const context = analystContext()
  const requestContext = toListBuilderAnalystRequest(context)
  const allowedId = requestContext.safeRelaxations[0].id
  const originalFetch = globalThis.fetch
  let openAiRequest = null
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    openAiRequest = JSON.parse(init.body)
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        headline: 'Barrel gate is the bottleneck',
        diagnosis: 'Both current candidates miss only the barrel threshold.',
        strongestEvidence: ['Recipe One owns the larger historical lift and sample.'],
        relaxation: { candidateId: allowedId, reason: 'This is the smallest supplied change that creates an exact match.' },
        comparison: { available: true, verdict: 'Recipe One has stronger historical support.', differences: ['100 vs 80 replay rows.'], caution: 'Forward samples remain small.' },
        limitations: ['Settled history does not guarantee future outcomes.'],
      }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const response = await worker.fetch(new Request('https://worker.example/list-builder-analyst', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: requestContext }),
    }), { OPENAI_API_KEY: 'test-key' }, {})
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.relaxation.candidateId, allowedId)
    assert.deepEqual(payload.guardrails, { advisoryOnly: true, projectionsChanged: false })

    assert.equal(openAiRequest.text.format.type, 'json_schema')
    assert.equal(openAiRequest.text.format.strict, true)
    assert.equal(openAiRequest.text.format.schema.additionalProperties, false)
    assert.deepEqual(openAiRequest.text.format.schema.properties.relaxation.properties.candidateId.enum, [
      ...requestContext.safeRelaxations.map((candidate) => candidate.id),
      null,
    ])
    assert.equal(JSON.stringify(openAiRequest.text.format.schema).includes('probability'), false)
    assert.equal(openAiRequest.input.includes('Private Player'), false)
    assert.equal(openAiRequest.input.includes('playerId'), false)
    assert.equal(openAiRequest.instructions.includes('Never calculate, change, or recommend HR probabilities'), true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('worker rejects malformed analyst guardrails before calling OpenAI', async () => {
  const context = toListBuilderAnalystRequest(analystContext())
  context.guardrails.projectionsMutable = true
  const response = await worker.fetch(new Request('https://worker.example/list-builder-analyst', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context }),
  }), { OPENAI_API_KEY: 'test-key' }, {})
  assert.equal(response.status, 400)
})

test('worker reports unconfigured analyst after validating aggregate context', async () => {
  const response = await worker.fetch(new Request('https://worker.example/list-builder-analyst', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: toListBuilderAnalystRequest(analystContext()) }),
  }), {}, {})
  assert.equal(response.status, 503)
})
