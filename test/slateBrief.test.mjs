import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BRIEF_VERSION,
  assembleDecisionBrief,
  buildBriefPrompt,
  buildBriefSchema,
  summarizeSlateBrief,
} from '../server/slate-brief.mjs'
import { isRenderableBrief } from '../ui/src/lib/data.js'

const slate = {
  date: '2026-07-16',
  games: [
    {
      gamePk: 101,
      venueName: 'Test Park',
      awayTeam: { abbr: 'NYY' },
      homeTeam: { abbr: 'BOS' },
    },
    {
      gamePk: 102,
      venueName: 'Bay Park',
      awayTeam: { abbr: 'LAD' },
      homeTeam: { abbr: 'SF' },
    },
  ],
  scoredBatters: {
    '9-102': {
      playerId: 9,
      gamePk: 102,
      name: 'Casey Leader',
      team: 'LAD',
      score: 85,
      grade: { label: 'PRIME' },
      hrProbability: 0.22,
      envScore: 88,
      lineupConfirmed: true,
      pitcher: { name: 'Bay Arm' },
      reasons: ['Elite contact quality in the current model.'],
    },
    '7-101': {
      playerId: 7,
      gamePk: 101,
      name: 'Alex Power',
      team: 'NYY',
      score: 82,
      grade: 'PRIME',
      hrProbability: 0.18,
      envScore: 80,
      lineupConfirmed: true,
      pitcher: { name: 'Home Arm' },
      reasons: ['Strong barrel evidence.'],
    },
    '7-101-duplicate': {
      playerId: 7,
      gamePk: 101,
      name: 'Alex Power',
      team: 'NYY',
      score: 70,
      grade: 'STRONG',
      hrProbability: 0.12,
      envScore: 60,
      lineupConfirmed: false,
    },
    '8-101': {
      playerId: 8,
      gamePk: 101,
      name: 'Blake Bat',
      team: 'BOS',
      score: 79,
      grade: 'STRONG',
      hrProbability: 0.16,
      envScore: 75,
      lineupConfirmed: false,
      pitcher: { name: 'Away Arm' },
      reasons: ['Favorable pitch-shape matchup.'],
    },
  },
}

test('Decision Brief summary deduplicates and exposes deterministic candidates', () => {
  const summary = summarizeSlateBrief(slate, ['Alex Power (NYY): Lineup status needs review.'])

  assert.equal(summary.batCount, 3)
  assert.equal(summary.primeCount, 2)
  assert.equal(summary.strongCount, 1)
  assert.equal(summary.confirmedCount, 2)
  assert.deepEqual(summary.leaders.map((item) => item.id), ['player:9:102', 'player:7:101', 'player:8:101'])
  assert.deepEqual(summary.environments.map((item) => item.id), ['game:102', 'game:101'])
  assert.equal(summary.environments[0].venue, 'Bay Park')
  assert.equal(summary.environments[0].score, 88)
  assert.deepEqual(summary.watchouts.map((item) => item.id), ['alert:0', 'concentration', 'lineups', 'variance'])
  assert.equal(summary.watchouts[1].fact, '2 of 3 board entries come from NYY @ BOS.')
  assert.equal(summary.watchouts[2].fact, '2 of 3 board entries have confirmed lineup spots.')
})

test('Decision Brief keeps both doubleheader matchups distinct', () => {
  const doubleheader = {
    ...slate,
    games: [
      ...slate.games,
      { gamePk: 103, venueName: 'Test Park', awayTeam: { abbr: 'NYY' }, homeTeam: { abbr: 'BOS' } },
    ],
    scoredBatters: {
      ...slate.scoredBatters,
      '7-103': {
        ...slate.scoredBatters['7-101'],
        gamePk: 103,
        score: 91,
        hrProbability: 0.27,
        pitcher: { name: 'Game Two Arm' },
      },
    },
  }
  const summary = summarizeSlateBrief(doubleheader, [])
  assert.equal(summary.batCount, 4)
  assert.deepEqual(summary.leaders.slice(0, 2).map((item) => item.id), ['player:7:103', 'player:9:102'])
  assert.equal(summary.leaders[0].pitcher, 'Game Two Arm')
  assert.ok(summary.leaders.some((item) => item.id === 'player:7:101'))
})

test('Decision Brief schema restricts every selection to engine IDs', () => {
  const summary = summarizeSlateBrief(slate, [])
  const schema = buildBriefSchema(summary)

  assert.equal(schema.properties.leaders.minItems, 2)
  assert.equal(schema.properties.leaders.maxItems, 2)
  assert.deepEqual(
    schema.properties.leaders.items.properties.id.enum,
    ['player:9:102', 'player:7:101', 'player:8:101'],
  )
  assert.deepEqual(
    schema.properties.environment.properties.id.enum,
    ['game:102', 'game:101', null],
  )
  assert.deepEqual(
    schema.properties.watchout.properties.id.enum,
    ['concentration', 'lineups', 'variance'],
  )

  const prompt = buildBriefPrompt(summary)
  assert.match(prompt, /Choose exactly 2 distinct leader IDs/)
  assert.match(prompt, /Never invent or alter/)
  assert.match(prompt, /player:9:102/)
})

test('Decision Brief assembly rejects invented facts and preserves engine values', () => {
  const summary = summarizeSlateBrief(slate, ['Weather desk: Roof status is pending.'])
  const result = assembleDecisionBrief(summary, {
    headline: 'Ninety nine percent lock of the day',
    leaders: [
      { id: 'player:7:101', note: 'A 24% lock with massive value', probability: 0.99 },
      { id: 'player:7:101', note: 'Duplicate selection' },
      { id: 'player:999:999', note: 'Invented player' },
    ],
    environment: { id: 'game:999', note: 'Invented environment' },
    watchout: { id: 'alert:999', note: 'Invented alert' },
    probability: 0.99,
  }, {
    generatedAt: '2026-07-16T12:00:00.000Z',
    model: 'gpt-test',
  })

  assert.equal(result.version, BRIEF_VERSION)
  assert.equal(result.generatedAt, '2026-07-16T12:00:00.000Z')
  assert.equal(result.model, 'gpt-test')
  assert.equal(result.headline, 'Alex Power leads the current home-run board.')
  assert.deepEqual(result.leaders.map((item) => item.id), ['player:7:101', 'player:9:102'])
  assert.equal(result.leaders[0].name, 'Alex Power')
  assert.equal(result.leaders[0].grade, 'PRIME')
  assert.equal(result.leaders[0].hrProbability, 0.18)
  assert.equal(result.leaders[0].note, 'Strong barrel evidence.')
  assert.equal('probability' in result.leaders[0], false)
  assert.equal(result.environment.id, 'game:102')
  assert.equal(result.environment.score, 88)
  assert.equal(result.watchout.id, 'alert:0')
  assert.equal(result.watchout.fact, 'Weather desk: Roof status is pending.')
  assert.equal(result.watchout.note, '')
  assert.equal('probability' in result, false)
})

test('Decision Brief accepts concise narrative for valid allow-listed selections', () => {
  const summary = summarizeSlateBrief(slate, [])
  const result = assembleDecisionBrief(summary, {
    headline: 'A concentrated board puts matchup quality ahead of volume.',
    leaders: [
      { id: 'player:9:102', note: 'Contact quality and matchup shape reinforce the model lead.' },
      { id: 'player:8:101', note: 'Pitch shape creates a useful secondary path.' },
    ],
    environment: { id: 'game:101', note: 'The park context supports both sides of this matchup.' },
    watchout: { id: 'lineups', note: 'Wait for the remaining batting order to settle.' },
  })

  assert.equal(result.headline, 'A concentrated board puts matchup quality ahead of volume.')
  assert.deepEqual(result.leaders.map((item) => item.id), ['player:9:102', 'player:8:101'])
  assert.match(result.leaders[0].note, /Contact quality/)
  assert.equal(result.environment.id, 'game:101')
  assert.match(result.watchout.note, /batting order/)
})

test('browser loader accepts structured and legacy briefs but rejects failed artifacts', () => {
  assert.equal(isRenderableBrief({ version: 2, headline: 'Board shape.', leaders: [] }), true)
  assert.equal(isRenderableBrief({ text: 'Legacy paragraph.' }), true)
  assert.equal(isRenderableBrief({ version: 2, headline: '', leaders: [] }), false)
  assert.equal(isRenderableBrief({ version: 2, headline: 'Board shape.' }), false)
  assert.equal(isRenderableBrief({ version: 2, headline: 'Board shape.', leaders: [], skipped: true }), false)
  assert.equal(isRenderableBrief({ text: 'Legacy paragraph.', error: 'failed' }), false)
})
