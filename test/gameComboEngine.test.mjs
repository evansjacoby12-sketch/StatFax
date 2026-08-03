import test from 'node:test'
import assert from 'node:assert/strict'
import {
  archivedGameComboLegs,
  buildGameCombos,
  buildHistoricalGameComboTracking,
  currentGameComboLegs,
} from '../ui/src/lib/gameComboEngine.js'

function game(gamePk, away, home, overrides = {}) {
  return {
    gamePk,
    gameDate: `2026-08-03T${String(17 + (gamePk % 5)).padStart(2, '0')}:10:00Z`,
    gameNumber: 1,
    awayTeam: { id: gamePk * 2, name: away, abbr: away },
    homeTeam: { id: gamePk * 2 + 1, name: home, abbr: home },
    isLive: false,
    isFinal: false,
    ...overrides,
  }
}

function projection(gamePk, options = {}) {
  const mlProbability = options.mlProbability ?? 0.57
  const underProbability = options.underProbability ?? 0.56
  const nrfiProbability = options.nrfiProbability ?? 0.58
  return {
    probablePitchers: options.missingStarter
      ? { away: { name: 'TBD' }, home: { name: `Pitcher H${gamePk}` } }
      : { away: { name: `Pitcher A${gamePk}` }, home: { name: `Pitcher H${gamePk}` } },
    marketDecision: {
      moneyline: {
        tier: options.mlTier ?? 'lean',
        selectedSide: 'away',
        selectedTeam: { abbr: options.away ?? `A${gamePk}` },
        modelProbability: mlProbability,
        coverage: options.coverage ?? 0.9,
        american: -110,
      },
      total: {
        tier: options.totalTier ?? 'pass',
        selectedSide: options.totalSide ?? 'under',
        line: 8.5,
        conditionalModelProbability: underProbability,
        coverage: options.coverage ?? 0.9,
        american: -105,
        blowUpRisk: { level: options.blowUpRisk ?? 'low' },
      },
    },
    firstInning: {
      tier: options.fiTier ?? 'watch',
      lean: options.fiSide ?? 'nrfi',
      selectedProbability: nrfiProbability,
      nrfiProbability,
      coverage: options.coverage ?? 0.9,
    },
  }
}

function slate() {
  const games = [game(101, 'AAA', 'BBB'), game(102, 'CCC', 'DDD'), game(103, 'EEE', 'FFF')]
  const projections = Object.fromEntries(games.map((row, index) => [
    row.gamePk,
    projection(row.gamePk, {
      away: row.awayTeam.abbr,
      mlProbability: 0.61 - index * 0.02,
      underProbability: 0.59 - index * 0.02,
      nrfiProbability: 0.62 - index * 0.02,
    }),
  ]))
  return { games, projections }
}

test('builds exactly the three approved deterministic recipes from different gamePks', () => {
  const { games, projections } = slate()
  const first = buildGameCombos(currentGameComboLegs(games, projections))
  const second = buildGameCombos(currentGameComboLegs(games, projections))

  assert.deepEqual(first.map((combo) => combo.id), ['steady-pair', 'under-pair', 'trend-trio'])
  assert.deepEqual(first.map((combo) => combo.signature), second.map((combo) => combo.signature))
  for (const combo of first) {
    assert.equal(new Set(combo.legs.map((leg) => leg.gamePk)).size, combo.size)
    assert.equal(combo.priced, false)
    assert.ok(combo.probability > 0 && combo.probability < 1)
  }
})

test('excludes live games, missing starters, weak coverage, YRFI, Over, and high-risk Unders', () => {
  const games = [
    game(1, 'AAA', 'BBB'),
    game(2, 'CCC', 'DDD', { isLive: true }),
    game(3, 'EEE', 'FFF'),
    game(4, 'GGG', 'HHH'),
  ]
  const projections = {
    1: projection(1, { blowUpRisk: 'high' }),
    2: projection(2),
    3: projection(3, { missingStarter: true }),
    4: projection(4, { coverage: 0.6, totalSide: 'over', fiSide: 'yrfi' }),
  }
  const legs = currentGameComboLegs(games, projections)
  assert.deepEqual(legs.map((leg) => leg.id), ['1:moneyline', '1:nrfi'])
  assert.equal(buildGameCombos(legs).length, 0)
})

function archivedRecord(source, calls, results = {}) {
  return {
    ...source,
    probablePitchers: calls.probablePitchers,
    marketDecision: calls.marketDecision,
    firstInning: calls.firstInning,
    marketOutcome: {
      moneyline: { result: results.moneyline ?? 'win' },
      total: { result: results.total ?? 'win' },
    },
    firstInningCorrect: results.firstInning ?? true,
  }
}

test('historical combo selection ignores results and tracks 2-leg and 3-leg records separately', () => {
  const { games, projections } = slate()
  const winners = games.map((row) => archivedRecord(row, projections[row.gamePk]))
  const losers = games.map((row) => archivedRecord(row, projections[row.gamePk], {
    moneyline: 'loss',
    total: 'loss',
    firstInning: false,
  }))

  const winningSignatures = buildGameCombos(archivedGameComboLegs(winners, '2026-08-03')).map((combo) => combo.signature)
  const losingSignatures = buildGameCombos(archivedGameComboLegs(losers, '2026-08-03')).map((combo) => combo.signature)
  assert.deepEqual(winningSignatures, losingSignatures)

  const tracking = buildHistoricalGameComboTracking({
    '2026-08-02': winners,
    '2026-08-03': losers,
  }, '2026-08-03', 7)
  assert.deepEqual(tracking.twoLeg, { wins: 2, losses: 2, pushes: 0, pending: 0 })
  assert.deepEqual(tracking.threeLeg, { wins: 1, losses: 1, pushes: 0, pending: 0 })
  assert.deepEqual(tracking.byRecipe['trend-trio'], { wins: 1, losses: 1, pushes: 0, pending: 0 })
})
