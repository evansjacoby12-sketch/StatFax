import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { uniqueScoredBatters } from '../ui/src/lib/data.js'

test('uniqueScoredBatters accepts schema-v5 composite-only rows', () => {
  const first = { playerId: 10, gamePk: 100, name: 'A' }
  const second = { playerId: 10, gamePk: 101, name: 'A' }
  const rows = uniqueScoredBatters({ '10-100': first, '10-101': second })
  assert.deepEqual(rows, [first, second])
})

test('uniqueScoredBatters remains compatible with schema-v4 dual aliases', () => {
  const first = { playerId: 10, gamePk: 100, name: 'A' }
  const second = { playerId: 11, gamePk: 100, name: 'B' }
  const rows = uniqueScoredBatters({
    10: first,
    '10-100': first,
    11: second,
    '11-100': second,
  })
  assert.deepEqual(rows, [first, second])
})

test('slate writer publishes schema v5 without a bare-player alias', () => {
  const source = readFileSync(new URL('../server/fetch-slate.mjs', import.meta.url), 'utf8')
  assert.match(source, /version:\s+5/)
  assert.match(source, /scoredBatters\[`\$\{id\}-\$\{game\.gamePk\}`\]\s*=\s*row/)
  assert.doesNotMatch(source, /scoredBatters\[id\]\s*=\s*row/)
})

test('slate builds schedule context only after games are initialized', () => {
  const source = readFileSync(new URL('../server/fetch-slate.mjs', import.meta.url), 'utf8')
  const gamesInitialized = source.indexOf('const games = rawGames.filter')
  const scheduleContextBuilt = source.indexOf('const gameScheduleContexts = buildGameScheduleContexts')
  assert.ok(gamesInitialized >= 0, 'games initialization must remain present')
  assert.ok(scheduleContextBuilt > gamesInitialized, 'schedule context cannot read games before initialization')
})

test('slate writer retains health-checked batter rows and summary', () => {
  const source = readFileSync(new URL('../server/fetch-slate.mjs', import.meta.url), 'utf8')
  assert.match(source, /payload\.scoredBatters\s*=\s*healthApplied\.slate\.scoredBatters/)
  assert.match(source, /payload\.dataHealth\s*=\s*healthApplied\.slate\.dataHealth/)
  assert.doesNotMatch(source, /payload\.scoredBatters\s*=\s*healthApplied\.scoredBatters/)
})

test('day rating and persisted combo boards retain both doubleheader games', () => {
  const source = readFileSync(new URL('../server/fetch-slate.mjs', import.meta.url), 'utf8')
  const rating = source.slice(source.indexOf('function computeDayRating'), source.indexOf('// below', source.indexOf('function computeDayRating')))
  assert.match(rating, /const key = `\$\{r\.playerId\}-\$\{r\.gamePk\}`/)
  assert.match(rating, /scheduledGamePks/)
  assert.doesNotMatch(rating, /seen\.has\(r\.playerId\)/)
  assert.match(source, /const lockCr = comboRowsFromScoredBatters\(payload\.scoredBatters\)/)
  assert.match(source, /const allCr = comboRowsFromScoredBatters\(payload\.scoredBatters\)/)
})
