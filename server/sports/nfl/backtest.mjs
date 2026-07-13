/** Rolling, leakage-safe baseline evaluation for NFL prop projections. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
    version: 2,
    sport: 'nfl',
    generatedAt: new Date().toISOString(),
    seasons: history?.seasons || [],
    methodology: 'Rolling player-level walk-forward baseline; every forecast uses only earlier games. Probability buckets and projection bias corrections are consumed by the current slate.',
    markets: {
      ...Object.fromEntries(Object.entries(numeric).map(([id, records]) => [id, { type: 'projection', ...regressionMetrics(records) }])),
      ...Object.fromEntries(Object.entries(touchdown).map(([id, records]) => [id, { type: 'probability', ...probabilityMetrics(records) }])),
    },
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
