import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildListBuilderRecipeTracking,
  captureListBuilderRecipePicks,
  listBuilderCriteriaSignature,
  normalizeListBuilderTrackingLedger,
  settleListBuilderRecipePicks,
} from '../ui/src/lib/list-builder-tracking.js'

const recipe = (id, criteria, version = 1) => ({ id, name: id.toUpperCase(), criteria, version })

function liveBatter(overrides = {}) {
  return {
    playerId: 1,
    gamePk: 100,
    name: 'Test Batter',
    team: 'TST',
    season: { iso: 0.24 },
    hrProbability: 0.12,
    game: { gamePk: 100, status: 'Scheduled', isLive: false, isFinal: false },
    ...overrides,
  }
}

function historyRecord(playerId, gamePk, iso, homered, simHRProb = 0.1, extra = {}) {
  return {
    playerId,
    gamePk,
    name: `Player ${playerId}`,
    feat: { iso },
    score: 60,
    simHRProb,
    homered,
    actuallyPlayed: true,
    ...extra,
  }
}

test('criteria signatures ignore sort order but change when selection gates change', () => {
  const base = listBuilderCriteriaSignature({ minISO: 0.2, sort: 'score' })
  assert.equal(base, listBuilderCriteriaSignature({ minISO: 0.2, sort: 'hrProbability' }))
  assert.notEqual(base, listBuilderCriteriaSignature({ minISO: 0.21, sort: 'score' }))
})

test('forward capture freezes exact pregame matches and never rewrites an existing pick', () => {
  const first = captureListBuilderRecipePicks({
    ledger: {},
    recipes: [recipe('power', { minISO: 0.2 })],
    batters: [
      liveBatter(),
      liveBatter({ playerId: 2, gamePk: 101, season: { iso: 0.18 }, game: { gamePk: 101, status: 'Scheduled' } }),
      liveBatter({ playerId: 3, gamePk: 102, season: { iso: 0.3 }, game: { gamePk: 102, isLive: true } }),
    ],
    slateDate: '2026-07-17',
    capturedAt: '2026-07-17T12:00:00.000Z',
  })
  assert.equal(first.picks.length, 1)
  assert.equal(first.picks[0].projection, 0.12)
  assert.equal(first.picks[0].status, 'pending')

  const refreshed = captureListBuilderRecipePicks({
    ledger: first,
    recipes: [recipe('power', { minISO: 0.2 })],
    batters: [liveBatter({ hrProbability: 0.2 })],
    slateDate: '2026-07-17',
    capturedAt: '2026-07-17T13:00:00.000Z',
  })
  assert.equal(refreshed.picks.length, 1)
  assert.equal(refreshed.picks[0].projection, 0.12)
  assert.equal(normalizeListBuilderTrackingLedger(refreshed).version, 1)
})

test('settlement joins outcomes by date, game, and player while excluding scratches', () => {
  const captured = captureListBuilderRecipePicks({
    recipes: [recipe('power', { minISO: 0.2 })],
    batters: [
      liveBatter(),
      liveBatter({ gamePk: 101, game: { gamePk: 101, status: 'Scheduled' } }),
      liveBatter({ playerId: 2, gamePk: 102, game: { gamePk: 102, status: 'Scheduled' } }),
    ],
    slateDate: '2026-07-17',
  })
  const settled = settleListBuilderRecipePicks(captured, {
    dates: ['2026-07-17'],
    records: {
      '2026-07-17': [
        historyRecord(1, 100, 0.24, true),
        historyRecord(1, 101, 0.24, false),
        historyRecord(2, 102, 0.24, false, 0.1, { actuallyPlayed: false }),
      ],
    },
  })
  assert.deepEqual(settled.picks.map((pick) => pick.status).sort(), ['hit', 'miss', 'scratch'])
})

test('recipe tracking reports replay lift, calibration, positive dates, streaks, and overlap', () => {
  const dates = ['2026-07-10', '2026-07-11']
  const records = {
    '2026-07-10': [
      historyRecord(1, 101, 0.30, true, 0.20),
      historyRecord(2, 102, 0.26, false, 0.10),
      historyRecord(3, 103, 0.15, false, 0.05),
      historyRecord(4, 104, 0.14, false, 0.05),
    ],
    '2026-07-11': [
      historyRecord(5, 105, 0.31, false, 0.15),
      historyRecord(6, 106, 0.27, true, 0.20),
      historyRecord(7, 107, 0.16, false, 0.05),
      historyRecord(8, 108, 0.12, false, 0.05),
    ],
  }
  const recipes = [
    recipe('wide', { minISO: 0.2 }),
    recipe('narrow', { minISO: 0.28 }),
  ]
  const report = buildListBuilderRecipeTracking({ backtestLog: { dates, records }, recipes })
  const wide = report.recipes.find((item) => item.id === 'wide')
  const narrow = report.recipes.find((item) => item.id === 'narrow')

  assert.equal(wide.historical.hits, 2)
  assert.equal(wide.historical.sample, 4)
  assert.equal(wide.historical.hitRate, 50)
  assert.equal(wide.historical.baselineRate, 25)
  assert.equal(wide.historical.lift, 2)
  assert.equal(wide.historical.calibration.meanProjection, 16.25)
  assert.equal(wide.historical.calibration.observedRate, 50)
  assert.equal(wide.historical.positiveLiftDates, 2)
  assert.equal(wide.historical.coldStreak, 0)
  assert.equal(wide.historical.overlap.shared, 2)
  assert.equal(narrow.historical.overlap.shared, 2)
  assert.equal(report.source.latestSettledDate, '2026-07-11')
  assert.equal(report.economics.available, false)
  assert.match(report.economics.reason, /sportsbook, stake/i)
})

test('criteria edits create a distinct forward version without rewriting prior picks', () => {
  const firstRecipe = recipe('power', { minISO: 0.2 }, 1)
  const first = captureListBuilderRecipePicks({
    recipes: [firstRecipe], batters: [liveBatter()], slateDate: '2026-07-17',
  })
  const secondRecipe = recipe('power', { minISO: 0.23 }, 2)
  const second = captureListBuilderRecipePicks({
    ledger: first, recipes: [secondRecipe], batters: [liveBatter()], slateDate: '2026-07-17',
  })
  assert.equal(second.picks.length, 2)
  assert.notEqual(second.picks[0].criteriaSignature, second.picks[1].criteriaSignature)

  const report = buildListBuilderRecipeTracking({ recipes: [secondRecipe], ledger: second })
  assert.equal(report.recipes[0].forward.total, 1)
  assert.equal(report.recipes[0].version, 2)
})
