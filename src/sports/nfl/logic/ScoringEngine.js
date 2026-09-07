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

export function deviggedImpliedProbability(overOdds, underOdds) {
  const over = americanImpliedProbability(overOdds)
  const under = americanImpliedProbability(underOdds)
  if (over == null) return null
  if (under == null) {
    return Math.max(0.005, Math.min(0.995, over / 1.045))
  }
  const total = over + under
  return total > 0 ? over / total : over
}

export function calculateQuarterKelly(probability, americanOddsValue, fraction = 0.25) {
  const prob = Number(probability)
  const odds = Number(americanOddsValue)
  if (!Number.isFinite(prob) || !Number.isFinite(odds) || prob <= 0 || prob >= 1) return null
  const decimal = odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds)
  const b = decimal - 1
  if (b <= 0) return null
  const q = 1 - prob
  const fullKelly = (b * prob - q) / b
  if (fullKelly <= 0) return 0
  const quarterKelly = fullKelly * fraction
  const units = Math.round(quarterKelly * 10 * 4) / 4
  return Math.max(0.25, Math.min(2.0, units))
}

function touchdownProbability(player, marketId) {
  const explicit = Number(player?.markets?.[marketId]?.probability)
  if (Number.isFinite(explicit)) return clamp(explicit)
  const anytime = Number(player?.markets?.anytime_td?.probability ?? player?.projections?.anytimeTdProbability ?? 0.25)
  if (marketId === 'anytime_td') return clamp(anytime)
  if (marketId === 'first_td') return clamp(Number(player?.projections?.firstTdProbability ?? anytime * 0.27), 0.005, 0.45)
  const lambda = -Math.log(Math.max(0.001, 1 - clamp(anytime)))

  // Negative-Binomial overdispersion for lead goal-line rushers / alpha red-zone targets
  const goalLine = Number(player?.usage?.goalLineOpportunityShare || player?.usage?.goalToGoOpportunityShare || 0)
  const touchesL3 = Number(player?.usage?.goalLineTouchesL3 || 0)
  if (goalLine >= 0.35 || touchesL3 >= 3) {
    const alpha = 0.20
    const p0 = Math.pow(1 + alpha * lambda, -1 / alpha)
    const p1 = lambda * Math.pow(1 + alpha * lambda, -(1 / alpha + 1))
    return clamp(1 - p0 - p1, 0.002, 0.65)
  }
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

function teamTotalFactor(player, marketId) {
  const teamTotal = Number(player?.teamTotal ?? player?.impliedTotal ?? player?.game?.teamTotal)
  if (!Number.isFinite(teamTotal) || teamTotal <= 0) return 1
  const leagueAvgTotal = 21.5
  const ratio = (teamTotal - leagueAvgTotal) / leagueAvgTotal
  if (['anytime_td', 'first_td', 'two_plus_td'].includes(marketId)) {
    return clamp(1 + ratio * 0.45, 0.82, 1.22)
  }
  return clamp(1 + ratio * 0.25, 0.88, 1.12)
}

function spreadGameScriptFactor(player, marketId) {
  const spread = Number(player?.spread ?? player?.game?.spread ?? player?.lineup?.spread)
  if (!Number.isFinite(spread) || spread === 0) return 1
  const isFavorite = spread < -1.5
  const isUnderdog = spread > 1.5
  const passMarkets = ['passing_yards', 'receiving_yards', 'receptions', 'passing_rushing_yards']
  const rushMarkets = ['rushing_yards', 'rushing_receiving_yards']

  if (isFavorite) {
    const favMagnitude = Math.min(14, Math.abs(spread)) / 14
    if (rushMarkets.includes(marketId)) return 1 + favMagnitude * 0.06
    if (passMarkets.includes(marketId)) return 1 - favMagnitude * 0.04
    if (player.position === 'RB' && ['anytime_td', 'first_td', 'two_plus_td'].includes(marketId)) return 1 + favMagnitude * 0.05
  } else if (isUnderdog) {
    const dogMagnitude = Math.min(14, Math.abs(spread)) / 14
    if (passMarkets.includes(marketId)) return 1 + dogMagnitude * 0.06
    if (rushMarkets.includes(marketId)) return 1 - dogMagnitude * 0.04
  }
  return 1
}

function probabilityGrade(probability, marketId, score, hasPrice, { historyGames = 0, roleRank = 1, isConfirmed = false, edge = 0 } = {}) {
  let grade
  if (hasPrice) {
    grade = score >= 72 ? 'PRIME' : score >= 58 ? 'STRONG' : score >= 45 ? 'LEAN' : 'SKIP'
  } else {
    const bands = marketId === 'first_td' ? [.12, .08, .045]
      : marketId === 'two_plus_td' ? [.18, .10, .055]
        : marketId === 'anytime_td' ? [.48, .36, .24]
          : [.65, .57, .50]
    grade = probability >= bands[0] ? 'PRIME' : probability >= bands[1] ? 'STRONG' : probability >= bands[2] ? 'LEAN' : 'SKIP'
  }

  // Standardization Gate 1: PRIME requires verified positive edge (when priced) and primary role
  if (grade === 'PRIME') {
    if (hasPrice && edge <= 0) grade = 'STRONG'
    if (roleRank > 2 && !isConfirmed) grade = 'STRONG'
  }

  // Standardization Gate 2: Thin history (< 3 games) cannot claim PRIME or STRONG
  if (historyGames > 0 && historyGames < 3 && ['PRIME', 'STRONG'].includes(grade)) {
    grade = 'LEAN'
  }

  return grade
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
  const teamEnv = teamTotalFactor(player, marketId)
  const gameScript = spreadGameScriptFactor(player, marketId)
  let probability
  let line = propLineFor(player, marketId)
  let mean = null

  if (market.kind === 'touchdown') {
    probability = touchdownProbability(player, marketId)
    if (marketId === 'two_plus_td') probability = calibrateNFLProbability(probability, player?.modelCalibration?.two_plus_td)
  } else {
    mean = projectionMean(player, market)
    mean = liveMean(player, market, mean) * weather.factor * defense * role * split * lineup * liveDeployment * teamEnv * gameScript
    const scale = distributionScale(market, mean)
    probability = logistic((mean - line) / scale)
  }

  if (market.kind === 'touchdown') probability *= weather.factor * defense * role * split * lineup * liveDeployment * teamEnv * gameScript
  probability = clamp(probability)
  const marketEntry = player?.markets?.[marketId]
  const rawOdds = marketEntry?.odds
    ?? marketEntry?.overOdds
    ?? marketEntry?.price
    ?? marketEntry?.american
    ?? player?.propOdds?.[marketId]
    ?? player?.odds?.[marketId]
    ?? (marketId === 'anytime_td' ? (player?.odds ?? player?.markets?.anytime_td?.odds) : null)

  const parsedOdds = rawOdds == null || rawOdds === '' ? null : Number(rawOdds)
  const explicitOdds = Number.isFinite(parsedOdds) && parsedOdds !== 0 ? parsedOdds : null

  const parsedUnder = marketEntry?.underOdds == null || marketEntry?.underOdds === '' ? null : Number(marketEntry?.underOdds)
  const explicitUnder = Number.isFinite(parsedUnder) && parsedUnder !== 0 ? parsedUnder : null

  // For yardage/volume markets with an active line, benchmark against standard -110 juice if unquoted
  const effectiveOdds = explicitOdds != null
    ? explicitOdds
    : (market.kind !== 'touchdown' && line != null ? -110 : null)
  const effectiveUnder = explicitUnder != null
    ? explicitUnder
    : (effectiveOdds === -110 ? -110 : null)

  const rawImplied = americanImpliedProbability(effectiveOdds)
  const implied = deviggedImpliedProbability(effectiveOdds, effectiveUnder)
  const edge = implied == null ? null : probability - implied
  const score = Math.round(clamp(probability * 100 + (edge == null ? 0 : edge * 75), 0, 100))

  const historyCount = Number(player?.historyMatch?.games ?? player?.recentGames?.length ?? 0)
  const roleRank = Number(player?.roleRank ?? player?.usage?.roleRank ?? 1)
  const isConfirmed = Boolean(player?.lineup?.confirmed)

  const grade = probabilityGrade(probability, marketId, score, implied != null, {
    historyGames: historyCount,
    roleRank,
    isConfirmed,
    edge: edge ?? 0,
  })

  const suggestedUnits = effectiveOdds != null && edge != null && edge > 0
    ? calculateQuarterKelly(probability, effectiveOdds)
    : null

  const reasons = [
    `${Math.round((role - 1) * 100)}% role adjustment`,
    `${Math.round((rawLineup - 1) * 100)}% lineup projection adjustment`,
    `${Math.round((liveDeployment - 1) * 100)}% live deployment adjustment`,
    `${Math.round((defense - 1) * 100)}% defense-vs-${player.position} adjustment`,
    weather.label,
    teamEnv !== 1 ? `${Math.round((teamEnv - 1) * 100)}% team total scoring adjustment` : null,
    gameScript !== 1 ? `${Math.round((gameScript - 1) * 100)}% spread script adjustment` : null,
    historyCount > 0 && historyCount < 3 ? 'Thin sample (<3 games) · capped at LEAN' : null,
    roleRank > 2 && !isConfirmed ? 'Rotational role · capped below PRIME' : null,
    `${player.isHome ? 'Home' : 'Away'} split ${Number(player?.splits?.activeEdge || 0) >= 0 ? '+' : ''}${Math.round(Number(player?.splits?.activeEdge || 0) * 100)}%`,
    player?.usage?.roleLabel || 'Role not confirmed',
  ].filter(Boolean)

  return {
    marketId,
    eligible,
    probability,
    score,
    grade,
    line,
    odds: effectiveOdds,
    underOdds: effectiveUnder,
    implied,
    rawImplied,
    edge,
    suggestedUnits,
    mean,
    weather,
    defenseFactor: defense,
    roleFactor: role,
    signals: buildNFLSignals(player),
    reasons,
  }
}

export function scoreNFLSnapshot(snapshot, marketId) {
  return (snapshot?.players || [])
    .map((player) => ({ ...player, model: scoreNFLProp(player, marketId) }))
    .filter((player) => player.model.eligible)
    .sort((a, b) => (b.model.score ?? -1) - (a.model.score ?? -1) || a.name.localeCompare(b.name))
}
