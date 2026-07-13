import { NFL_PROP_MARKETS, isPropEligible, propLineFor } from './propEligibility.js'
import { buildNFLSignals } from './signals.js'
import { nflWeatherImpact } from './weather.js'

const clamp = (value, min = 0.01, max = 0.99) => Math.max(min, Math.min(max, value))
const logistic = (value) => 1 / (1 + Math.exp(-value))

export function americanImpliedProbability(odds) {
  const value = Number(odds)
  if (!Number.isFinite(value) || value === 0) return null
  return value < 0 ? Math.abs(value) / (Math.abs(value) + 100) : 100 / (value + 100)
}

function touchdownProbability(player, marketId) {
  const explicit = Number(player?.markets?.[marketId]?.probability)
  if (Number.isFinite(explicit)) return clamp(explicit)
  const anytime = Number(player?.markets?.anytime_td?.probability ?? player?.projections?.anytimeTdProbability ?? 0.25)
  if (marketId === 'anytime_td') return clamp(anytime)
  if (marketId === 'first_td') return clamp(Number(player?.projections?.firstTdProbability ?? anytime * 0.27), 0.005, 0.45)
  const lambda = -Math.log(Math.max(0.001, 1 - clamp(anytime)))
  return clamp(1 - Math.exp(-lambda) * (1 + lambda), 0.002, 0.65)
}

function projectionMean(player, market) {
  const projections = player?.projections || {}
  if (market.id === 'rushing_receiving_yards') return Number(projections.rushingReceivingYards ?? (Number(projections.rushingYards || 0) + Number(projections.receivingYards || 0)))
  if (market.id === 'passing_rushing_yards') return Number(projections.passingRushingYards ?? (Number(projections.passingYards || 0) + Number(projections.rushingYards || 0)))
  return Number(projections[market.projectionKey])
}

function liveMean(player, market, pregameMean) {
  const live = player?.live
  if (!live?.isLive) return pregameMean
  const progress = clamp(Number(live.gameProgress ?? 0), 0, 0.98)
  const liveStats = live.stats || {}
  const keys = {
    passing_yards: 'passingYards', receptions: 'receptions', receiving_yards: 'receivingYards', rushing_yards: 'rushingYards',
  }
  if (market.id === 'rushing_receiving_yards') return Number(liveStats.rushingYards || 0) + Number(liveStats.receivingYards || 0) + pregameMean * (1 - progress)
  if (market.id === 'passing_rushing_yards') return Number(liveStats.passingYards || 0) + Number(liveStats.rushingYards || 0) + pregameMean * (1 - progress)
  const current = Number(liveStats[keys[market.id]] || 0)
  return current + pregameMean * (1 - progress)
}

function distributionScale(market, mean) {
  if (market.id === 'receptions') return Math.max(1.25, Math.sqrt(Math.max(1, mean)) * 0.85)
  if (market.id === 'passing_yards' || market.id === 'passing_rushing_yards') return Math.max(34, mean * 0.18)
  return Math.max(16, mean * 0.28)
}

function defenseFactor(player, marketId) {
  const entry = player?.defenseVsPosition || {}
  const direct = Number(entry.factors?.[marketId])
  if (Number.isFinite(direct)) return clamp(direct, 0.86, 1.14)
  const percentile = Number(entry.percentile)
  return Number.isFinite(percentile) ? clamp(0.92 + percentile * 0.16, 0.86, 1.14) : 1
}

function roleFactor(player, marketId) {
  const usage = player?.usage || {}
  if (['anytime_td', 'first_td', 'two_plus_td'].includes(marketId)) {
    const rz = Math.min(0.08, Number(usage.redZoneOpportunityShare || 0) * 0.1)
    const goal = Math.min(0.06, Number(usage.goalLineOpportunityShare || 0) * 0.08)
    return 1 + rz + goal
  }
  const share = marketId === 'receptions' || marketId === 'receiving_yards' ? Number(usage.targetShare || 0) : Number(usage.snapShare || 0)
  return clamp(0.96 + share * 0.08, 0.94, 1.04)
}

function splitFactor(player) {
  return clamp(1 + Number(player?.splits?.activeEdge || 0), 0.9, 1.1)
}

export function scoreNFLProp(player, marketId) {
  const market = NFL_PROP_MARKETS[marketId]
  const eligible = isPropEligible(player, marketId)
  if (!market || !eligible) return { marketId, eligible: false, probability: null, score: null, grade: 'INELIGIBLE', reasons: [] }

  const weather = nflWeatherImpact(player.weather, marketId)
  const defense = defenseFactor(player, marketId)
  const role = roleFactor(player, marketId)
  const split = splitFactor(player)
  let probability
  let line = propLineFor(player, marketId)
  let mean = null

  if (market.kind === 'touchdown') {
    probability = touchdownProbability(player, marketId)
  } else {
    mean = projectionMean(player, market)
    mean = liveMean(player, market, mean) * weather.factor * defense * role * split
    const scale = distributionScale(market, mean)
    probability = logistic((mean - line) / scale)
  }

  if (market.kind === 'touchdown') probability *= weather.factor * defense * role * split
  probability = clamp(probability)
  const odds = Number(player?.markets?.[marketId]?.odds)
  const implied = americanImpliedProbability(odds)
  const edge = implied == null ? null : probability - implied
  const score = Math.round(clamp(probability * 100 + (edge == null ? 0 : edge * 75), 0, 100))
  const grade = score >= 72 ? 'PRIME' : score >= 58 ? 'STRONG' : score >= 45 ? 'LEAN' : 'SKIP'
  const reasons = [
    `${Math.round((role - 1) * 100)}% role adjustment`,
    `${Math.round((defense - 1) * 100)}% defense-vs-${player.position} adjustment`,
    weather.label,
    `${player.isHome ? 'Home' : 'Away'} split ${Number(player?.splits?.activeEdge || 0) >= 0 ? '+' : ''}${Math.round(Number(player?.splits?.activeEdge || 0) * 100)}%`,
  ]

  return { marketId, eligible, probability, score, grade, line, odds: Number.isFinite(odds) ? odds : null, implied, edge, mean, weather, defenseFactor: defense, roleFactor: role, signals: buildNFLSignals(player), reasons }
}

export function scoreNFLSnapshot(snapshot, marketId) {
  return (snapshot?.players || [])
    .map((player) => ({ ...player, model: scoreNFLProp(player, marketId) }))
    .filter((player) => player.model.eligible)
    .sort((a, b) => (b.model.score ?? -1) - (a.model.score ?? -1) || a.name.localeCompare(b.name))
}
