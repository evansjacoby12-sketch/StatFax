import { normalizePlayerName } from './providers/odds.mjs'

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
  const totalGames = Math.max(1, games.length)
  const rz = history?.redZone || {}
  return {
    redZoneTargetsL3: Math.round(n(rz.redZoneTargets) / totalGames * 3),
    redZoneTouchesL3: Math.round(n(rz.redZoneCarries) / totalGames * 3),
    goalLineTouchesL3: Math.round(n(rz.goalLineCarries) / totalGames * 3),
  }
}

export function projectNFLPlayer(rosterPlayer, history, { isHome, odds = null } = {}) {
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
  projections.firstTdProbability = clamp(projections.anytimeTdProbability * .22, .01, .24)
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
  const targetShare = weighted(games, 'targetShare', rosterPlayer.position === 'WR' ? .18 : rosterPlayer.position === 'TE' ? .14 : .08)
  return {
    projections,
    markets,
    propLines,
    recentGames: games.slice(0, 8),
    usage: { snapShare: prior.snapShare, targetShare: clamp(targetShare, 0, .45), ...redZoneUsage(history, games), redZoneOpportunityShare: clamp(projections.anytimeTdProbability * .75, .05, .6), goalLineOpportunityShare: clamp(projections.anytimeTdProbability * .65, .03, .55) },
    splits: { home: history?.splits?.home?.tdRate ?? null, away: history?.splits?.away?.tdRate ?? null, activeEdge: splitEdge(history, isHome) },
    historyMatch: history ? { id: history.id, games: games.length, seasons: [...new Set(games.map((game) => game.season))] } : null,
  }
}

export function playerRoleScore(player, history) {
  const games = history?.recentGames || []
  return games.length * 10 + weighted(games, 'attempts', 0) + weighted(games, 'carries', 0) + weighted(games, 'targets', 0)
}
