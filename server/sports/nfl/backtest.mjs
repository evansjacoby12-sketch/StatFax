/** Leakage-safe replay of the production NFL projection and scoring paths. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectNFLPlayer } from './projections.mjs'
import { defenseProfileFromTable, normalizeFirstTouchdownProbabilities } from './fetch-nfl-slate.mjs'
import { scoreNFLProp } from '../../../src/sports/nfl/logic/ScoringEngine.js'
import { calibrateNFLProbability } from '../../../src/sports/nfl/logic/calibration.js'
import { NFL_PROP_MARKETS } from '../../../src/sports/nfl/logic/propEligibility.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..')
const DEFAULT_HISTORY = path.join(ROOT, 'dist', 'nfl', 'history.json')
const DEFAULT_OUTPUT = path.join(ROOT, 'dist', 'nfl', 'backtest.json')
const EPS = 1e-6
const MIN_PRIOR_GAMES = 4
const MIN_TEMPORAL_TRAINING = 100

const MARKET_SPECS = {
  passing_yards: { positions: ['QB'], value: (g) => +g.passingYards || 0 },
  receptions: { positions: ['RB', 'WR', 'TE'], value: (g) => +g.receptions || 0 },
  receiving_yards: { positions: ['RB', 'WR', 'TE'], value: (g) => +g.receivingYards || 0 },
  rushing_yards: { positions: ['QB', 'RB', 'WR'], value: (g) => +g.rushingYards || 0 },
  rushing_receiving_yards: { positions: ['RB', 'WR', 'TE'], value: (g) => (+g.rushingYards || 0) + (+g.receivingYards || 0) },
  passing_rushing_yards: { positions: ['QB'], value: (g) => (+g.passingYards || 0) + (+g.rushingYards || 0) },
}

const eventOrder = (game) => Number(game?.season || 0) * 100 + Number(game?.week || 0)
const gameIsHome = (game) => String(game?.gameId || '').split('_').at(-1) === String(game?.team || '')

export function rollingProjection(games, value) {
  let weighted = 0, weights = 0
  games.slice(-8).reverse().forEach((game, index) => {
    const weight = .82 ** index
    weighted += value(game) * weight
    weights += weight
  })
  return weights ? weighted / weights : 0
}

function priorHistory(games) {
  const recentGames = games.slice().sort((a, b) => eventOrder(b) - eventOrder(a))
  const splits = { home: { games: 0, totalTds: 0 }, away: { games: 0, totalTds: 0 } }
  const redZone = { redZoneTargets: 0, endZoneTargets: 0, redZoneCarries: 0, goalLineCarries: 0, touchdowns: 0 }
  for (const game of games) {
    const split = gameIsHome(game) ? splits.home : splits.away
    split.games++; split.totalTds += Number(game.totalTds || 0)
    for (const key of ['redZoneTargets', 'endZoneTargets', 'redZoneCarries', 'goalLineCarries']) redZone[key] += Number(game[key] || 0)
    redZone.touchdowns += Number(game.totalTds || 0)
  }
  for (const split of Object.values(splits)) split.tdRate = split.games ? split.totalTds / split.games : null
  return { recentGames, splits, redZone }
}

function calibrationBuckets(records) {
  const buckets = Array.from({ length: 10 }, (_, index) => ({ from: index / 10, to: (index + 1) / 10, predictions: 0, predicted: 0, observed: 0 }))
  for (const record of records) {
    const bucket = buckets[Math.min(9, Math.floor(record.probability * 10))]
    bucket.predictions += 1; bucket.predicted += record.probability; bucket.observed += record.outcome
  }
  return buckets.filter((bucket) => bucket.predictions).map((bucket) => ({
    from: bucket.from, to: bucket.to, samples: bucket.predictions,
    predicted: bucket.predicted / bucket.predictions, observed: bucket.observed / bucket.predictions,
  }))
}

function probabilityMetrics(records) {
  if (!records.length) return { samples: 0, brier: null, logLoss: null, buckets: [] }
  const brier = records.reduce((sum, r) => sum + (r.probability - r.outcome) ** 2, 0) / records.length
  const logLoss = -records.reduce((sum, r) => { const p = Math.max(EPS, Math.min(1 - EPS, r.probability)); return sum + r.outcome * Math.log(p) + (1 - r.outcome) * Math.log(1 - p) }, 0) / records.length
  return { samples: records.length, brier, logLoss, buckets: calibrationBuckets(records) }
}

function regressionMetrics(records) {
  if (!records.length) return { samples: 0, mae: null, rmse: null, bias: null, within10: null, correction: null }
  const errors = records.map((r) => r.projection - r.outcome)
  const bias = errors.reduce((sum, error) => sum + error, 0) / errors.length
  return {
    samples: records.length,
    mae: errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length,
    rmse: Math.sqrt(errors.reduce((sum, error) => sum + error ** 2, 0) / errors.length),
    bias,
    within10: errors.filter((error) => Math.abs(error) <= 10).length / errors.length,
    correction: -bias,
  }
}

function expandingProjectionMetrics(records) {
  let errorTotal = 0, training = 0
  const validated = []
  for (const record of records.slice().sort((a, b) => a.order - b.order || a.gameId.localeCompare(b.gameId))) {
    if (training >= MIN_TEMPORAL_TRAINING) validated.push({ ...record, projection: record.projection - errorTotal / training })
    errorTotal += record.projection - record.outcome
    training++
  }
  return { ...regressionMetrics(validated), minimumTrainingSamples: MIN_TEMPORAL_TRAINING }
}

function expandingProbabilityMetrics(records, marketId) {
  const groups = new Map()
  for (const record of records.slice().sort((a, b) => a.order - b.order || a.gameId.localeCompare(b.gameId))) {
    const key = `${record.order}:${record.gameId}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(record)
  }
  const training = []
  const validated = []
  for (const group of groups.values()) {
    if (training.length >= MIN_TEMPORAL_TRAINING) {
      const calibration = { buckets: calibrationBuckets(training) }
      let probabilities = group.map((record) => calibrateNFLProbability(record.probability, calibration))
      if (marketId === 'first_td') {
        const total = probabilities.reduce((sum, value) => sum + value, 0) || 1
        probabilities = probabilities.map((value) => value / total * .86)
      }
      group.forEach((record, index) => validated.push({ ...record, probability: probabilities[index] }))
    }
    training.push(...group)
  }
  return { ...probabilityMetrics(validated), minimumTrainingSamples: MIN_TEMPORAL_TRAINING }
}

function compactDefense(ledger) {
  const table = {}
  for (const [key, value] of ledger) {
    const [team, position] = key.split(':')
    const games = value.games.size
    if (!games) continue
    table[team] ||= {}
    table[team][position] = Object.fromEntries(['touchdowns', 'redZoneTargets', 'redZoneCarries', 'passingYards', 'rushingYards', 'receivingYards'].map((field) => [field, value[field] / games]))
    table[team][position].games = games
  }
  return table
}

function updateDefense(ledger, rows) {
  for (const { player, actual } of rows) {
    const key = `${actual.opponent}:${player.position}`
    const entry = ledger.get(key) || { games: new Set(), touchdowns: 0, redZoneTargets: 0, redZoneCarries: 0, passingYards: 0, rushingYards: 0, receivingYards: 0 }
    entry.games.add(actual.gameId)
    entry.touchdowns += Number(actual.totalTds || 0)
    entry.redZoneTargets += Number(actual.redZoneTargets || 0)
    entry.redZoneCarries += Number(actual.redZoneCarries || 0)
    entry.passingYards += Number(actual.passingYards || 0)
    entry.rushingYards += Number(actual.rushingYards || 0)
    entry.receivingYards += Number(actual.receivingYards || 0)
    ledger.set(key, entry)
  }
}

function scoreProjection(player, marketId) {
  const market = NFL_PROP_MARKETS[marketId]
  const currentLine = Number(player.propLines?.[marketId])
  const launchEligible = Number.isFinite(currentLine) && currentLine >= Number(market.lineMin || 0)
  const validationPlayer = launchEligible ? player : { ...player, propLines: { ...player.propLines, [marketId]: Number(market.lineMin || 0) } }
  return { model: scoreNFLProp(validationPlayer, marketId), launchEligible }
}

function buildReplayRows(history) {
  const events = new Map()
  for (const player of history?.players || []) {
    const games = [...(player.recentGames || [])].sort((a, b) => eventOrder(a) - eventOrder(b))
    for (let index = MIN_PRIOR_GAMES; index < games.length; index++) {
      const source = games[index]
      const actual = {
        ...source,
        gameId: source.gameId || `${source.season}_${source.week}_${player.id || player.name || 'player'}`,
        team: source.team || player.teams?.[0] || 'TEAM',
        opponent: source.opponent || 'OPP',
      }
      if (!events.has(actual.gameId)) events.set(actual.gameId, [])
      events.get(actual.gameId).push({ player, actual, prior: games.slice(0, index) })
    }
  }
  return [...events.entries()].map(([gameId, rows]) => ({ gameId, order: eventOrder(rows[0]?.actual), rows })).sort((a, b) => a.order - b.order || a.gameId.localeCompare(b.gameId))
}

export function evaluateNFLHistory(history) {
  const numeric = Object.fromEntries(Object.keys(MARKET_SPECS).map((id) => [id, []]))
  const touchdown = { anytime_td: [], two_plus_td: [], first_td: [] }
  const defenseLedger = new Map()
  const weatherByGame = history?.weatherByGame || {}

  for (const event of buildReplayRows(history)) {
    const defenseTable = compactDefense(defenseLedger)
    const forecastPlayers = event.rows.map(({ player, actual, prior }) => {
      const historical = priorHistory(prior)
      const projected = projectNFLPlayer({ id: player.id, name: player.name, position: player.position, team: actual.team, roleRank: 1 }, historical, { isHome: gameIsHome(actual), calibration: {} })
      return {
        id: player.id, name: player.name, position: player.position, team: actual.team, opponent: actual.opponent,
        isHome: gameIsHome(actual), gameId: event.gameId, weather: weatherByGame[event.gameId] || {},
        defenseVsPosition: defenseProfileFromTable(defenseTable, actual.opponent, player.position),
        live: { isLive: false, isFinal: false }, ...projected,
      }
    })
    normalizeFirstTouchdownProbabilities(forecastPlayers, {})

    event.rows.forEach(({ player, actual }, index) => {
      const forecast = forecastPlayers[index]
      for (const [marketId, spec] of Object.entries(MARKET_SPECS)) {
        if (!spec.positions.includes(player.position)) continue
        const { model, launchEligible } = scoreProjection(forecast, marketId)
        if (!Number.isFinite(model.mean)) continue
        numeric[marketId].push({ projection: model.mean, outcome: spec.value(actual), launchEligible, order: event.order, gameId: event.gameId })
      }
      for (const marketId of ['anytime_td', 'two_plus_td']) {
        const model = scoreNFLProp(forecast, marketId)
        touchdown[marketId].push({ probability: model.probability, outcome: Number(actual.totalTds || 0) >= (marketId === 'two_plus_td' ? 2 : 1) ? 1 : 0, order: event.order, gameId: event.gameId })
      }
      if (actual.firstTd != null) {
        const model = scoreNFLProp(forecast, 'first_td')
        touchdown.first_td.push({ probability: model.probability, outcome: actual.firstTd ? 1 : 0, order: event.order, gameId: event.gameId })
      }
    })
    updateDefense(defenseLedger, event.rows)
  }

  const projectionMarkets = Object.fromEntries(Object.entries(numeric).map(([id, records]) => {
    const launchRecords = records.filter((record) => record.launchEligible)
    return [id, {
      type: 'projection', validationPath: 'production-v3', ...regressionMetrics(records),
      eligibleSegment: regressionMetrics(launchRecords), temporalCorrection: expandingProjectionMetrics(records),
    }]
  }))
  const probabilityMarkets = Object.fromEntries(Object.entries(touchdown).map(([id, records]) => [id, {
    type: 'probability', validationPath: 'production-v3', ...probabilityMetrics(records),
    temporalCalibration: expandingProbabilityMetrics(records, id),
  }]))
  return {
    version: 3,
    sport: 'nfl',
    generatedAt: new Date().toISOString(),
    seasons: history?.seasons || [],
    methodology: 'Leakage-safe game replay through the production projection, defense, role, split, weather, First TD normalization and scoring paths. Corrections and calibration are also evaluated with expanding-window temporal validation.',
    requirements: { minimumPriorGames: MIN_PRIOR_GAMES, minimumTemporalTrainingSamples: MIN_TEMPORAL_TRAINING, exactProductionScoring: true, firstTdGameNormalized: true, twoPlusProductionFormula: true },
    markets: { ...projectionMarkets, ...probabilityMarkets },
  }
}

export async function writeNFLBacktest({ historyPath = DEFAULT_HISTORY, outputPath = DEFAULT_OUTPUT } = {}) {
  const history = JSON.parse(await fs.readFile(historyPath, 'utf8'))
  const result = evaluateNFLHistory(history)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, JSON.stringify(result, null, 2), 'utf8')
  console.log(`[nfl-backtest] wrote ${outputPath} · ${Object.values(result.markets).reduce((sum, market) => sum + market.samples, 0)} production-path forecasts`)
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) writeNFLBacktest().catch((error) => { console.error('[nfl-backtest] fatal:', error); process.exitCode = 1 })
