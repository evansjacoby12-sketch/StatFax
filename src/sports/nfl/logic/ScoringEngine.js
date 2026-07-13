import { NFL_PROP_MARKETS, isPropEligible, propLineFor } from './propEligibility.js'
import { buildNFLSignals } from './signals.js'
import { nflWeatherImpact } from './weather.js'
import { calibrateNFLProbability } from './calibration.js'

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
  const trailing = live.gameScript === 'trailing'
  const leading = live.gameScript === 'leading'
  const passLean = ['passing_yards', 'receiving_yards', 'receptions', 'passing_rushing_yards'].includes(market.id)
  const rushLean = ['rushing_yards', 'rushing_receiving_yards'].includes(market.id)
  const script = trailing ? (passLean ? 1.08 : rushLean ? .94 : 1) : leading ? (passLean ? .96 : rushLean ? 1.06 : 1) : 1
  if (market.id === 'rushing_receiving_yards') return Number(liveStats.rushingYards || 0) + Number(liveStats.receivingYards || 0) + pregameMean * (1 - progress) * script
  if (market.id === 'passing_rushing_yards') return Number(liveStats.passingYards || 0) + Number(liveStats.rushingYards || 0) + pregameMean * (1 - progress) * script
  const current = Number(liveStats[keys[market.id]] || 0)
  return current + pregameMean * (1 - progress) * script
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

function lineupFactor(player, marketId) {
  const value = Number(player?.lineup?.marketFactors?.[marketId])
  return Number.isFinite(value) ? clamp(value, .62, 1.42) : 1
}

function liveDeploymentFactor(player, marketId) {
  const live = player?.live || {}
  if (!live.isLive || Number(live.observedSnaps || 0) < 5) return 1
  const expectedSnap = Number(player?.lineup?.expectedSnapShare || player?.usage?.snapShare || 0)
  const observedSnap = Number(live.observedSnapShare)
  let factor = expectedSnap > 0 && Number.isFinite(observedSnap) ? clamp(observedSnap / expectedSnap, .72, 1.28) : 1
  if (['receptions', 'receiving_yards', 'rushing_receiving_yards'].includes(marketId)) {
    const expectedRoutes = Number(player?.lineup?.routesPerDropback || 0)
    const observedRoutes = Number(live.observedRoutesPerDropback)
    if (expectedRoutes > 0 && Number.isFinite(observedRoutes)) factor = factor * .4 + clamp(observedRoutes / expectedRoutes, .68, 1.32) * .6
  }
  if (['anytime_td', 'first_td', 'two_plus_td'].includes(marketId) && Number(live.goalLineAppearances || 0) > 0) factor *= 1.04
  return clamp(factor, .68, 1.35)
}

function splitFactor(player) {
  return clamp(1 + Number(player?.splits?.activeEdge || 0), 0.9, 1.1)
}

function probabilityGrade(probability, marketId, score, hasPrice) {
  if (hasPrice) return score >= 72 ? 'PRIME' : score >= 58 ? 'STRONG' : score >= 45 ? 'LEAN' : 'SKIP'
  const bands = marketId === 'first_td' ? [.12, .08, .045]
    : marketId === 'two_plus_td' ? [.18, .10, .055]
      : marketId === 'anytime_td' ? [.48, .36, .24]
        : [.65, .57, .50]
  return probability >= bands[0] ? 'PRIME' : probability >= bands[1] ? 'STRONG' : probability >= bands[2] ? 'LEAN' : 'SKIP'
}

export function scoreNFLProp(player, marketId) {
  const market = NFL_PROP_MARKETS[marketId]
  const eligible = isPropEligible(player, marketId)
  if (!market || !eligible) return { marketId, eligible: false, probability: null, score: null, grade: 'INELIGIBLE', reasons: [] }

  const weather = nflWeatherImpact(player.weather, marketId)
  const defense = defenseFactor(player, marketId)
  const role = roleFactor(player, marketId)
  const rawLineup = lineupFactor(player, marketId)
  const lineup = player?.lineup?.projectionAdjusted ? 1 : rawLineup
  const liveDeployment = liveDeploymentFactor(player, marketId)
  const split = splitFactor(player)
  let probability
  let line = propLineFor(player, marketId)
  let mean = null

  if (market.kind === 'touchdown') {
    probability = touchdownProbability(player, marketId)
    if (marketId === 'two_plus_td') probability = calibrateNFLProbability(probability, player?.modelCalibration?.two_plus_td)
  } else {
    mean = projectionMean(player, market)
    mean = liveMean(player, market, mean) * weather.factor * defense * role * split * lineup * liveDeployment
    const scale = distributionScale(market, mean)
    probability = logistic((mean - line) / scale)
  }

  if (market.kind === 'touchdown') probability *= weather.factor * defense * role * split * lineup * liveDeployment
  probability = clamp(probability)
  const rawOdds = player?.markets?.[marketId]?.odds
  const odds = rawOdds == null || rawOdds === '' ? null : Number(rawOdds)
  const implied = americanImpliedProbability(odds)
  const edge = implied == null ? null : probability - implied
  const score = Math.round(clamp(probability * 100 + (edge == null ? 0 : edge * 75), 0, 100))
  const grade = probabilityGrade(probability, marketId, score, implied != null)
  const reasons = [
    `${Math.round((role - 1) * 100)}% role adjustment`,
    `${Math.round((rawLineup - 1) * 100)}% lineup projection adjustment`,
    `${Math.round((liveDeployment - 1) * 100)}% live deployment adjustment`,
    `${Math.round((defense - 1) * 100)}% defense-vs-${player.position} adjustment`,
    weather.label,
    `${player.isHome ? 'Home' : 'Away'} split ${Number(player?.splits?.activeEdge || 0) >= 0 ? '+' : ''}${Math.round(Number(player?.splits?.activeEdge || 0) * 100)}%`,
    player?.usage?.roleLabel || 'Role not confirmed',
  ]

  return { marketId, eligible, probability, score, grade, line, odds: Number.isFinite(odds) && odds !== 0 ? odds : null, implied, edge, mean, weather, defenseFactor: defense, roleFactor: role, signals: buildNFLSignals(player), reasons }
}

export function scoreNFLSnapshot(snapshot, marketId) {
  return (snapshot?.players || [])
    .map((player) => ({ ...player, model: scoreNFLProp(player, marketId) }))
    .filter((player) => player.model.eligible)
    .sort((a, b) => (b.model.score ?? -1) - (a.model.score ?? -1) || a.name.localeCompare(b.name))
}
