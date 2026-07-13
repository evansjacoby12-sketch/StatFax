import { normalizePlayerName } from './providers/odds.mjs'
import { calibrateNFLProbability, correctedNFLProjection } from '../../../src/sports/nfl/logic/calibration.js'

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const n = (value, fallback = 0) => value == null || value === '' ? fallback : Number.isFinite(Number(value)) ? Number(value) : fallback
const roundHalf = (value) => Math.max(0, Math.round(n(value) * 2) / 2)

const PRIORS = {
  QB: { passingYards: 210, completions: 18, attempts: 30, rushingYards: 15, receptions: 0, receivingYards: 0, td: .20, snapShare: .92 },
  RB: { passingYards: 0, completions: 0, attempts: 0, rushingYards: 35, receptions: 2, receivingYards: 15, td: .34, snapShare: .58 },
  WR: { passingYards: 0, completions: 0, attempts: 0, rushingYards: 2, receptions: 3, receivingYards: 38, td: .28, snapShare: .72 },
  TE: { passingYards: 0, completions: 0, attempts: 0, rushingYards: 0, receptions: 3, receivingYards: 31, td: .25, snapShare: .68 },
}

export function indexNFLHistory(history) {
  const index = new Map()
  for (const player of history?.players || []) {
    const key = normalizePlayerName(player.name)
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(player)
  }
  return index
}

export function matchHistoryPlayer(rosterPlayer, historyIndex) {
  const candidates = historyIndex.get(normalizePlayerName(rosterPlayer.name)) || []
  return candidates.find((candidate) => candidate.teams?.includes(rosterPlayer.team)) || candidates[0] || null
}

function weighted(games, key, fallback) {
  let value = 0, weights = 0
  games.slice(0, 8).forEach((game, index) => {
    const weight = .82 ** index
    value += n(game[key]) * weight
    weights += weight
  })
  return weights ? value / weights : fallback
}

function weightedPresent(games, key, fallback) {
  const present = games.filter((game) => Number.isFinite(Number(game[key])))
  return present.length ? weighted(present, key, fallback) : fallback
}

function touchdownProbability(games, prior) {
  const sample = games.slice(0, 12)
  const weightedHits = sample.reduce((sum, game, index) => sum + (n(game.totalTds) > 0 ? .86 ** index : 0), 0)
  const weights = sample.reduce((sum, _game, index) => sum + .86 ** index, 0)
  return clamp((weightedHits + prior * 4) / (weights + 4), .06, .78)
}

function splitEdge(history, isHome) {
  const active = history?.splits?.[isHome ? 'home' : 'away']?.tdRate
  const other = history?.splits?.[isHome ? 'away' : 'home']?.tdRate
  if (!Number.isFinite(active) || !Number.isFinite(other)) return 0
  return clamp((active - other) * .12, -.1, .1)
}

function redZoneUsage(history, games) {
  const recent = games.slice(0, 3)
  const rz = history?.redZone || {}
  const sum = (key) => recent.reduce((total, game) => total + n(game[key]), 0)
  const careerPerThree = (key) => Math.round(n(rz[key]) / Math.max(1, games.length) * 3)
  return {
    redZoneTargetsL3: recent.some((game) => game.redZoneTargets != null) ? sum('redZoneTargets') : careerPerThree('redZoneTargets'),
    endZoneTargetsL3: recent.some((game) => game.endZoneTargets != null) ? sum('endZoneTargets') : careerPerThree('endZoneTargets'),
    redZoneTouchesL3: recent.some((game) => game.redZoneCarries != null) ? sum('redZoneCarries') : careerPerThree('redZoneCarries'),
    goalLineTouchesL3: recent.some((game) => game.goalLineCarries != null) ? sum('goalLineCarries') : careerPerThree('goalLineCarries'),
  }
}

export function projectNFLPlayer(rosterPlayer, history, { isHome, odds = null, availability = null, calibration = {} } = {}) {
  const prior = PRIORS[rosterPlayer.position]
  const games = history?.recentGames || []
  const projections = {
    passingYards: weighted(games, 'passingYards', prior.passingYards),
    completions: weighted(games, 'completions', prior.completions),
    attempts: weighted(games, 'attempts', prior.attempts),
    rushingYards: weighted(games, 'rushingYards', prior.rushingYards),
    receptions: weighted(games, 'receptions', prior.receptions),
    receivingYards: weighted(games, 'receivingYards', prior.receivingYards),
  }
  projections.rushingReceivingYards = projections.rushingYards + projections.receivingYards
  projections.passingRushingYards = projections.passingYards + projections.rushingYards
  projections.anytimeTdProbability = touchdownProbability(games, prior.td)
  projections.firstTdProbability = clamp(projections.anytimeTdProbability * .22, .005, .24)
  const availabilityMultiplier = availability?.multiplier ?? 1
  for (const key of ['passingYards', 'completions', 'attempts', 'rushingYards', 'receptions', 'receivingYards', 'rushingReceivingYards', 'passingRushingYards']) projections[key] *= availabilityMultiplier
  projections.anytimeTdProbability *= availabilityMultiplier
  projections.firstTdProbability *= availabilityMultiplier
  const projectionMarkets = {
    passingYards: 'passing_yards', receptions: 'receptions', receivingYards: 'receiving_yards', rushingYards: 'rushing_yards',
    rushingReceivingYards: 'rushing_receiving_yards', passingRushingYards: 'passing_rushing_yards',
  }
  for (const [key, marketId] of Object.entries(projectionMarkets)) projections[key] = correctedNFLProjection(projections[key], calibration[marketId])
  projections.anytimeTdProbability = calibrateNFLProbability(projections.anytimeTdProbability, calibration.anytime_td)
  for (const key of ['passingYards', 'completions', 'attempts', 'rushingYards', 'receptions', 'receivingYards', 'rushingReceivingYards', 'passingRushingYards']) projections[key] = Math.round(projections[key] * 10) / 10
  projections.anytimeTdProbability = Math.round(projections.anytimeTdProbability * 1000) / 1000
  projections.firstTdProbability = Math.round(projections.firstTdProbability * 1000) / 1000

  const referenceLines = {
    passing_yards: roundHalf(projections.passingYards), receptions: roundHalf(projections.receptions), receiving_yards: roundHalf(projections.receivingYards),
    rushing_yards: roundHalf(projections.rushingYards), rushing_receiving_yards: roundHalf(projections.rushingReceivingYards), passing_rushing_yards: roundHalf(projections.passingRushingYards),
  }
  const markets = {
    anytime_td: { probability: projections.anytimeTdProbability, line: .5, odds: null, source: 'model' },
    first_td: { probability: projections.firstTdProbability, line: .5, odds: null, source: 'model' },
  }
  for (const [marketId, line] of Object.entries(referenceLines)) markets[marketId] = { line, odds: null, source: 'model_reference' }
  for (const [marketId, quote] of Object.entries(odds?.markets || {})) markets[marketId] = { ...markets[marketId], ...quote }
  const propLines = Object.fromEntries(Object.entries(markets).filter(([, quote]) => Number.isFinite(Number(quote.line))).map(([id, quote]) => [id, Number(quote.line)]))
  const targetShare = n(rosterPlayer.depthChart?.targetShare, weighted(games, 'targetShare', rosterPlayer.position === 'WR' ? .18 : rosterPlayer.position === 'TE' ? .14 : .08))
  const snapShare = n(rosterPlayer.depthChart?.snapShare, weightedPresent(games, 'snapShare', prior.snapShare))
  const redZone = redZoneUsage(history, games)
  const redZoneTotal = redZone.redZoneTargetsL3 + redZone.redZoneTouchesL3
  const roleLabel = rosterPlayer.depthChart?.role || (rosterPlayer.roleRank === 1 ? 'Primary role' : rosterPlayer.roleRank === 2 ? 'Secondary role' : 'Rotation role')
  return {
    projections,
    markets,
    propLines,
    recentGames: games.slice(0, 8),
    usage: { snapShare: clamp(snapShare, .05, 1), targetShare: clamp(targetShare, 0, .45), carryShare: rosterPlayer.depthChart?.carryShare ?? null, ...redZone, redZoneOpportunityShare: clamp(redZoneTotal ? redZoneTotal / 18 : projections.anytimeTdProbability * .75, .03, .65), goalLineOpportunityShare: clamp(rosterPlayer.depthChart?.goalLineShare ?? (redZone.goalLineTouchesL3 ? redZone.goalLineTouchesL3 / 10 : projections.anytimeTdProbability * .65), .02, .6), roleRank: rosterPlayer.roleRank || null, roleLabel, depthSource: rosterPlayer.depthChart ? 'overlay' : 'historical-role' },
    splits: { home: history?.splits?.home?.tdRate ?? null, away: history?.splits?.away?.tdRate ?? null, activeEdge: splitEdge(history, isHome) },
    historyMatch: history ? { id: history.id, games: games.length, seasons: [...new Set(games.map((game) => game.season))] } : null,
    availability: availability || { eligible: true, multiplier: 1, label: 'Active', tone: 'good', reason: 'active' },
    modelCalibration: calibration,
  }
}

export function playerRoleScore(player, history) {
  const games = history?.recentGames || []
  return games.length * 10 + weighted(games, 'attempts', 0) + weighted(games, 'carries', 0) + weighted(games, 'targets', 0)
}
