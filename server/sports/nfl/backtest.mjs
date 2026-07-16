/** Rolling, leakage-safe baseline evaluation for NFL prop projections. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildNFLComboBoard, NFL_COMBO_STRATEGIES } from '../../../ui/src/lib/nflCombos.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..')
const DEFAULT_HISTORY = path.join(ROOT, 'dist', 'nfl', 'history.json')
const DEFAULT_OUTPUT = path.join(ROOT, 'dist', 'nfl', 'backtest.json')
const EPS = 1e-6

const MARKET_SPECS = {
  passing_yards: { positions: ['QB'], value: (g) => +g.passingYards || 0, min: 150 },
  receptions: { positions: ['RB', 'WR', 'TE'], value: (g) => +g.receptions || 0, min: 3 },
  receiving_yards: { positions: ['RB', 'WR', 'TE'], value: (g) => +g.receivingYards || 0, min: 150 },
  rushing_yards: { positions: ['QB', 'RB', 'WR'], value: (g) => +g.rushingYards || 0, min: 40 },
  rushing_receiving_yards: { positions: ['RB', 'WR', 'TE'], value: (g) => (+g.rushingYards || 0) + (+g.receivingYards || 0), min: 40 },
  passing_rushing_yards: { positions: ['QB'], value: (g) => (+g.passingYards || 0) + (+g.rushingYards || 0), min: 150 },
}
const TD_PRIOR = { QB: .2, RB: .34, WR: .28, TE: .25 }

export function rollingProjection(games, value) {
  let weighted = 0, weights = 0
  games.slice(-8).reverse().forEach((game, index) => {
    const weight = .82 ** index
    weighted += value(game) * weight
    weights += weight
  })
  return weights ? weighted / weights : 0
}

function tdProbability(games, position, threshold = 1) {
  const recent = games.slice(-12).reverse()
  let hits = 0, weights = 0
  recent.forEach((game, index) => {
    const weight = .86 ** index
    hits += ((+game.totalTds || 0) >= threshold ? 1 : 0) * weight
    weights += weight
  })
  const prior = threshold === 1 ? TD_PRIOR[position] ?? .25 : .08
  return Math.max(.01, Math.min(.99, (hits + prior * 4) / (weights + 4)))
}

function calibrationBuckets(records) {
  const buckets = Array.from({ length: 10 }, (_, index) => ({ from: index / 10, to: (index + 1) / 10, predictions: 0, predicted: 0, observed: 0 }))
  for (const record of records) {
    const bucket = buckets[Math.min(9, Math.floor(record.probability * 10))]
    bucket.predictions += 1; bucket.predicted += record.probability; bucket.observed += record.outcome
  }
  return buckets.filter((bucket) => bucket.predictions).map((bucket) => ({
    from: bucket.from,
    to: bucket.to,
    samples: bucket.predictions,
    predicted: bucket.predicted / bucket.predictions,
    observed: bucket.observed / bucket.predictions,
  }))
}

function probabilityMetrics(records) {
  if (!records.length) return { samples: 0, brier: null, logLoss: null, buckets: [] }
  const brier = records.reduce((sum, r) => sum + (r.probability - r.outcome) ** 2, 0) / records.length
  const logLoss = -records.reduce((sum, r) => { const p = Math.max(EPS, Math.min(1 - EPS, r.probability)); return sum + r.outcome * Math.log(p) + (1 - r.outcome) * Math.log(1 - p) }, 0) / records.length
  return { samples: records.length, brier, logLoss, buckets: calibrationBuckets(records) }
}

function historicalPlayer(player, actual, prior) {
  const recent = prior.slice(-12).reverse()
  const recentThree = recent.slice(0, 3)
  const anytime = tdProbability(prior, player.position, 1)
  const lambda = -Math.log(Math.max(.001, 1 - anytime))
  const twoPlus = Math.max(.002, Math.min(.65, 1 - Math.exp(-lambda) * (1 + lambda)))
  const sum = (key) => recentThree.reduce((total, game) => total + (+game[key] || 0), 0)
  return {
    id: player.id, name: player.name, position: player.position, team: actual.team, opponent: actual.opponent, gameId: actual.gameId,
    kickoffAt: `${actual.season}-09-01T00:00:00Z`, isHome: String(actual.gameId || '').split('_').at(-1) === actual.team,
    markets: { anytime_td: { probability: anytime, line: .5, odds: null }, first_td: { probability: anytime * .22, line: .5, odds: null }, two_plus_td: { probability: twoPlus, line: 1.5, odds: null } },
    projections: { anytimeTdProbability: anytime, firstTdProbability: anytime * .22 },
    recentGames: recent.slice(0, 8), historyMatch: { id: player.id, games: prior.length, seasons: [...new Set(prior.map((game) => game.season))] },
    usage: {
      redZoneTargetsL3: sum('redZoneTargets'), endZoneTargetsL3: sum('endZoneTargets'), redZoneTouchesL3: sum('redZoneCarries'), goalLineTouchesL3: sum('goalLineCarries'),
      redZoneOpportunityShare: Math.min(.65, (sum('redZoneTargets') + sum('redZoneCarries')) / 18), goalLineOpportunityShare: Math.min(.6, sum('goalLineCarries') / 10),
      endZoneTargetShare: sum('redZoneTargets') ? Math.min(1, sum('endZoneTargets') / sum('redZoneTargets')) : 0, roleRank: 1, roleLabel: 'Historical starter', depthSource: 'historical-role',
    },
    splits: { activeEdge: 0 }, availability: { eligible: true, multiplier: 1, tone: 'good' }, lineup: null,
  }
}

function normalizeHistoricalFirstTD(players) {
  const games = new Map()
  for (const player of players) {
    if (!games.has(player.gameId)) games.set(player.gameId, [])
    games.get(player.gameId).push(player)
  }
  for (const group of games.values()) {
    const weights = group.map((player) => Math.max(.002, player.markets.anytime_td.probability * .22 * (1 + Number(player.usage.redZoneOpportunityShare || 0) * .2)))
    const total = weights.reduce((sum, value) => sum + value, 0) || 1
    group.forEach((player, index) => {
      const probability = weights[index] / total * .86
      player.markets.first_td.probability = probability
      player.projections.firstTdProbability = probability
    })
  }
  return players
}

function stackOutcome(combo, outcomes) {
  let active = 0
  for (const leg of combo.legs) {
    const actual = outcomes.get(`${leg.gameKey}:${leg.playerId}`)
    if (!actual) return null
    if (leg.marketId === 'first_td' && actual.firstTd == null) continue
    active++
    const won = leg.marketId === 'anytime_td' ? (+actual.totalTds || 0) >= 1
      : leg.marketId === 'two_plus_td' ? (+actual.totalTds || 0) >= 2
        : Boolean(actual.firstTd)
    if (!won) return 0
  }
  return active ? 1 : null
}

export function evaluateNFLStackHistory(history) {
  const weeks = new Map()
  for (const player of history?.players || []) {
    const games = [...(player.recentGames || [])].sort((a, b) => (+a.season - +b.season) || (+a.week - +b.week))
    for (let index = 4; index < games.length; index++) {
      const actual = games[index]
      const key = `${actual.season}:${actual.week}`
      if (!weeks.has(key)) weeks.set(key, [])
      weeks.get(key).push({ player, actual, prior: games.slice(0, index) })
    }
  }
  const records = {}
  for (const [key, rows] of [...weeks].sort(([a], [b]) => a.localeCompare(b))) {
    const players = normalizeHistoricalFirstTD(rows.map(({ player, actual, prior }) => historicalPlayer(player, actual, prior)))
    const [season, week] = key.split(':').map(Number)
    const snapshot = { generatedAt: `${season}-01-01T00:00:00Z`, meta: { season, week: `Week ${week}` }, players, modelPerformance: null }
    const outcomes = new Map(rows.map(({ player, actual }) => [`${actual.gameId}:${player.id}`, actual]))
    for (const strategy of NFL_COMBO_STRATEGIES) for (const scope of strategy.scopes) for (const legs of [2, 3, 4]) {
      const board = buildNFLComboBoard(snapshot, { strategy: strategy.id, scope, legs, minGrade: 'LEAN' })
      const bucket = records[strategy.id] ||= {}
      const scopeBucket = bucket[scope] ||= {}
      const legBucket = scopeBucket[legs] ||= []
      for (const combo of board.combos) {
        const outcome = stackOutcome(combo, outcomes)
        if (outcome != null) legBucket.push({ probability: combo.independentProbability, outcome })
      }
    }
  }
  return Object.fromEntries(NFL_COMBO_STRATEGIES.map((strategy) => [strategy.id, {
    label: strategy.label,
    scopes: Object.fromEntries(strategy.scopes.map((scope) => [scope, {
      byLegCount: Object.fromEntries([2, 3, 4].map((legs) => {
        const rows = records[strategy.id]?.[scope]?.[legs] || []
        const metrics = probabilityMetrics(rows)
        const predicted = rows.length ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length : null
        const observed = rows.length ? rows.reduce((sum, row) => sum + row.outcome, 0) / rows.length : null
        return [legs, { ...metrics, predicted, observed, jointFactor: predicted ? Math.max(.5, Math.min(1.5, observed / predicted)) : null }]
      })),
    }]))
  }]))
}

function regressionMetrics(records) {
  if (!records.length) return { samples: 0, mae: null, rmse: null, bias: null, within10: null }
  const errors = records.map((r) => r.projection - r.outcome)
  return {
    samples: records.length,
    mae: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length),
    bias: errors.reduce((sum, error) => sum + error, 0) / errors.length,
    within10: errors.filter((error) => Math.abs(error) <= 10).length / errors.length,
    correction: -(errors.reduce((sum, error) => sum + error, 0) / errors.length),
  }
}

export function evaluateNFLHistory(history) {
  const numeric = Object.fromEntries(Object.keys(MARKET_SPECS).map((id) => [id, []]))
  const touchdown = { anytime_td: [], two_plus_td: [], first_td: [] }
  for (const player of history?.players || []) {
    const games = [...(player.recentGames || [])].sort((a, b) => (+a.season - +b.season) || (+a.week - +b.week))
    for (let index = 4; index < games.length; index += 1) {
      const prior = games.slice(0, index)
      const actual = games[index]
      for (const [marketId, spec] of Object.entries(MARKET_SPECS)) {
        if (!spec.positions.includes(player.position)) continue
        const projection = rollingProjection(prior, spec.value)
        if (projection >= spec.min) numeric[marketId].push({ projection, outcome: spec.value(actual) })
      }
      touchdown.anytime_td.push({ probability: tdProbability(prior, player.position, 1), outcome: (+actual.totalTds || 0) >= 1 ? 1 : 0 })
      touchdown.two_plus_td.push({ probability: tdProbability(prior, player.position, 2), outcome: (+actual.totalTds || 0) >= 2 ? 1 : 0 })
      if (actual.firstTd != null) touchdown.first_td.push({ probability: Math.max(.005, tdProbability(prior, player.position, 1) * .22), outcome: actual.firstTd ? 1 : 0 })
    }
  }
  return {
    version: 4,
    sport: 'nfl',
    generatedAt: new Date().toISOString(),
    seasons: history?.seasons || [],
    methodology: 'Rolling player-level walk-forward baseline; every forecast uses only earlier games. Probability buckets and projection bias corrections are consumed by the current slate.',
    markets: {
      ...Object.fromEntries(Object.entries(numeric).map(([id, records]) => [id, { type: 'projection', ...regressionMetrics(records) }])),
      ...Object.fromEntries(Object.entries(touchdown).map(([id, records]) => [id, { type: 'probability', ...probabilityMetrics(records) }])),
    },
    stacks: evaluateNFLStackHistory(history),
  }
}

export async function writeNFLBacktest({ historyPath = DEFAULT_HISTORY, outputPath = DEFAULT_OUTPUT } = {}) {
  const history = JSON.parse(await fs.readFile(historyPath, 'utf8'))
  const result = evaluateNFLHistory(history)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8')
  console.log(`[nfl-backtest] wrote ${outputPath} · ${Object.values(result.markets).reduce((sum, market) => sum + market.samples, 0)} forecasts`)
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeNFLBacktest().catch((error) => { console.error('[nfl-backtest] fatal:', error); process.exitCode = 1 })
