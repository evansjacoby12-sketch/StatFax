import { test } from 'node:test'
import assert from 'node:assert/strict'

import worker from '../server/cloudflare/src/worker.js'
import {
  buildPlayerExplainSignals,
  normalizePlayerExplain,
  playerExplainPayload,
} from '../ui/src/lib/playerExplain.js'

const batter = {
  playerId: 665742,
  gamePk: 823440,
  name: 'Juan Soto',
  grade: { label: 'PRIME' },
  hrProbability: 0.237,
  pitcher: { name: 'Aaron Nola' },
  game: { venueName: 'Citizens Bank Park' },
  reasons: [
    'Elite ISO (.273) — top-tier power',
    'Nola HR/9: 1.9 — very HR-prone',
  ],
  eli5Reasons: [
    { icon: 'flame', tone: 'good', text: 'Serious power hitter with a strong extra-base profile.' },
    { icon: 'alert', tone: 'good', text: 'The opposing pitcher has allowed frequent home-run contact.' },
    { icon: 'shield', tone: 'bad', text: 'The pitcher can still limit damage when his best secondary pitch is working.' },
  ],
}

test('player explainer builds engine-owned case, caution, and variance candidates', () => {
  const signals = buildPlayerExplainSignals(batter)
  assert.deepEqual(signals.slice(0, 3).map(({ id, tone }) => ({ id, tone })), [
    { id: 'signal:0', tone: 'case' },
    { id: 'signal:1', tone: 'case' },
    { id: 'signal:2', tone: 'caution' },
  ])
  assert.equal(signals.at(-1).id, 'variance')
  assert.equal(signals.at(-1).tone, 'caution')
  assert.match(signals.at(-1).text, /hittable pitch/)

  const payload = playerExplainPayload(batter)
  assert.equal(payload.kind, 'player')
  assert.equal(payload.version, 3)
  assert.equal(payload.hrProb, 0.237)
  assert.equal(payload.pitcher, 'Aaron Nola')
  assert.deepEqual(Object.keys(payload).sort(), ['grade', 'hrProb', 'kind', 'name', 'park', 'pitcher', 'signals', 'version'])
})

test('browser normalization rejects invented IDs, duplicate evidence, and numeric AI claims', () => {
  const result = normalizePlayerExplain(batter, {
    version: 3,
    caseIds: ['signal:1', 'signal:1', 'invented'],
    cautionId: 'invented-caution',
    bottomLine: 'This is a 99% lock and the best value on the slate.',
    probabilityBoost: 0.5,
  })

  assert.deepEqual(result.caseSignals.map((signal) => signal.id), ['signal:1', 'signal:0'])
  assert.equal(result.caseSignals[0].text, batter.eli5Reasons[1].text)
  assert.equal(result.cautionSignal.id, 'signal:2')
  assert.equal(result.cautionSignal.text, batter.eli5Reasons[2].text)
  assert.equal(result.bottomLine, 'The engine sees a favorable combination, but the home-run outcome remains high variance.')
  assert.equal('probabilityBoost' in result, false)
})

test('fallback caution avoids repeating the model probability disclaimer', () => {
  const positiveOnly = { ...batter, eli5Reasons: batter.eli5Reasons.slice(0, 2) }
  const result = normalizePlayerExplain(positiveOnly, {
    version: 3,
    caseIds: ['signal:0', 'signal:1'],
    cautionId: 'variance',
    bottomLine: 'Power and matchup evidence support the model while outcome variance remains central.',
  })
  assert.equal(result.cautionSignal.id, 'variance')
  assert.match(result.cautionSignal.text, /hittable pitch/)
  assert.doesNotMatch(result.cautionSignal.text, /estimated home-run chance|predicted outcome/)
})

test('player-specific matchup context replaces generic variance without treating lineup state as model evidence', () => {
  const projected = {
    ...batter,
    lineupConfirmed: false,
    pitcher: { name: 'Aaron Nola', season: { kPer9: 9.46 }, savant: { barrelPctAllowed: 6.8 } },
    eli5Reasons: batter.eli5Reasons.slice(0, 2),
  }
  const signals = buildPlayerExplainSignals(projected)
  assert.equal(signals.some((signal) => signal.id === 'context:lineup'), false)
  assert.ok(signals.some((signal) => signal.id === 'context:pitcher-k'))
  const result = normalizePlayerExplain(projected, {
    version: 3,
    caseIds: ['signal:0', 'signal:1'],
    cautionId: 'variance',
    bottomLine: 'Power and matchup evidence lead, while the opposing starter can still limit contact.',
  })
  assert.equal(result.cautionSignal.id, 'context:pitcher-k')
  assert.match(result.cautionSignal.text, /strikeout (rate|ability)/i)
})

test('variance survives the candidate cap on a large legacy evidence set', () => {
  const legacy = {
    ...batter,
    eli5Reasons: Array.from({ length: 14 }, (_, index) => ({
      icon: 'activity', tone: 'neutral', text: `Limited plain-language evidence ${index}.`,
    })),
    reasons: Array.from({ length: 30 }, (_, index) => `Positive engine reason ${index}`),
  }
  const signals = buildPlayerExplainSignals(legacy)
  assert.equal(signals.length, 18)
  assert.equal(signals.at(-1).id, 'variance')
})

test('worker schema permits only supplied evidence IDs and repairs a hostile response', async () => {
  const originalFetch = globalThis.fetch
  let openAiRequest = null
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    openAiRequest = JSON.parse(init.body)
    return new Response(JSON.stringify({
      output_text: JSON.stringify({
        caseIds: ['signal:1', 'signal:1', 'invented'],
        cautionId: 'invented-caution',
        bottomLine: 'This is a 99% lock with unmatched value.',
        probabilityBoost: 0.5,
      }),
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  try {
    const requestPayload = { ...playerExplainPayload(batter), probabilityBoost: 0.9, hiddenScore: 100 }
    const response = await worker.fetch(new Request('https://worker.example/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload),
    }), { OPENAI_API_KEY: 'test-key' }, {})
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.version, 3)
    assert.deepEqual(payload.caseIds, ['signal:1', 'signal:0'])
    assert.equal(payload.cautionId, 'signal:2')
    assert.equal(payload.bottomLine, 'The engine sees a favorable combination, but the home-run outcome remains high variance.')
    assert.deepEqual(payload.guardrails, { advisoryOnly: true, projectionsChanged: false })
    assert.equal('probabilityBoost' in payload, false)

    const schema = openAiRequest.text.format.schema
    assert.deepEqual(schema.properties.caseIds.items.enum, ['signal:0', 'signal:1'])
    assert.deepEqual(schema.properties.cautionId.enum, ['signal:2'])
    assert.equal(JSON.stringify(schema).includes('probability'), false)
    assert.equal(openAiRequest.input.includes('probabilityBoost'), false)
    assert.equal(openAiRequest.input.includes('hiddenScore'), false)
    assert.match(openAiRequest.instructions, /Do not put numbers in the bottom line/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('worker rejects a structured player request without allow-listed case evidence', async () => {
  const response = await worker.fetch(new Request('https://worker.example/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'player', version: 2, name: 'Test Player', signals: [] }),
  }), { OPENAI_API_KEY: 'test-key' }, {})
  assert.equal(response.status, 400)
})

test('legacy combo explanations retain the paragraph contract', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({
    output_text: JSON.stringify({ text: 'The supplied legs share a strong engine-backed construction.' }),
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })

  try {
    const response = await worker.fetch(new Request('https://worker.example/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'combo', name: 'Two-leg combo', grade: 'A', reasons: ['Engine reason one', 'Engine reason two'] }),
    }), { OPENAI_API_KEY: 'test-key' }, {})
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { text: 'The supplied legs share a strong engine-backed construction.' })
  } finally {
    globalThis.fetch = originalFetch
  }
})
