import { NFL_PROP_MARKETS, isPropEligible, propLineFor } from './propEligibility.js'
import { buildNFLSignals } from './signals.js'
import { nflWeatherImpact } from './weather.js'
import { calibrateNFLProbability } from './calibration.js'

const clamp = (value, min = 0.001, max = 0.999) => Math.max(min, Math.min(max, value))

/**
 * Standard Normal Cumulative Distribution Function (Abramowitz & Stegun approximation).
 * Precision: |error| < 7.5e-8 across all real x.
 */
export function standardNormalCdf(x) {
  const p = 0.2316419
  const b1 = 0.319381530
  const b2 = -0.356563782
  const b3 = 1.781477937
  const b4 = -1.821255978
  const b5 = 1.330274429
  const t = 1 / (1 + p * Math.abs(x))
  const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x)
  const poly = ((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t
  const cdf = 1 - phi * poly
  return x >= 0 ? cdf : 1 - cdf
}

/**
 * Lognormal Over Probability P(Y > line) where Y ~ Lognormal(mu_ln, sigma_ln^2).
 * Correctly captures right-skewed NFL continuous yardage distributions.
 */
export function lognormalOverProbability(mean, line, cv = 0.45) {
  const mu = Number(mean)
  const L = Number(line)
  if (!Number.isFinite(mu) || mu <= 0) return 0.01
  if (!Number.isFinite(L) || L <= 0) return 0.99

  const sigmaSq = Math.log(1 + cv * cv)
  const sigma = Math.sqrt(sigmaSq)
  const muLn = Math.log(mu) - 0.5 * sigmaSq
  const z = (Math.log(L) - muLn) / sigma
  return clamp(1 - standardNormalCdf(z))
}

/**
 * Discrete Poisson Over Probability P(K > line) for integer counts like receptions.
 */
export function poissonOverProbability(lambda, line) {
  const l = Number(lambda)
  const L = Number(line)
  if (!Number.isFinite(l) || l <= 0) return 0.01
  if (!Number.isFinite(L) || L < 0) return 0.99

  const floorLine = Math.floor(L)
  let cumulative = 0
  let currentTerm = Math.exp(-l) // P(K = 0)
  cumulative += currentTerm

  for (let k = 1; k <= floorLine; k++) {
    currentTerm = (currentTerm * l) / k
    cumulative += currentTerm
  }

  return clamp(1 - cumulative)
}

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

/**
 * Touchdown probability modeling across Anytime TD, First TD, and 2+ TD markets.
 * Integrates goal-line volume, red-zone conversion share, and Negative-Binomial overdispersion.
 */
function touchdownProbability(player, marketId) {
  const explicit = Number(player?.markets?.[marketId]?.probability)
  if (Number.isFinite(explicit)) return clamp(explicit)

  const anytime = Number(player?.markets?.anytime_td?.probability ?? player?.projections?.anytimeTdProbability ?? 0.25)
  if (marketId === 'anytime_td') return clamp(anytime)

  // First TD Modeling: opening script target share & coin-toss receiving drive expectation
  if (marketId === 'first_td') {
    const explicitFirst = Number(player?.projections?.firstTdProbability)
    if (Number.isFinite(explicitFirst)) return clamp(explicitFirst, 0.005, 0.45)
    
    // Position-specific first TD share: RBs get higher opening-drive scripted run share
    const posMultiplier = player?.position === 'RB' ? 0.30 : player?.position === 'WR' ? 0.25 : 0.22
    const firstTdProb = anytime * posMultiplier
    return clamp(firstTdProb, 0.005, 0.45)
  }

  // 2+ Touchdown (Multi-TD) Modeling: Compound Poisson / Zero-Inflated Negative Binomial (ZINB)
  const lambda = -Math.log(Math.max(0.001, 1 - clamp(anytime)))
  const goalLine = Number(player?.usage?.goalLineOpportunityShare || player?.usage?.goalToGoOpportunityShare || 0)
  const touchesL3 = Number(player?.usage?.goalLineTouchesL3 || 0)

  if (goalLine >= 0.30 || touchesL3 >= 3) {
    // Lead red-zone workhorse: higher variance Gamma mixture (alpha = 0.22)
    const alpha = 0.22
    const p0 = Math.pow(1 + alpha * lambda, -1 / alpha)
    const p1 = lambda * Math.pow(1 + alpha * lambda, -(1 / alpha + 1))
    return clamp(1 - p0 - p1, 0.002, 0.65)
  }

  // Standard Poisson multi-TD formulation: P(TD >= 2) = 1 - e^-lambda * (1 + lambda)
  return clamp(1 - Math.exp(-lambda) * (1 + lambda), 0.002, 0.65)
}

function projectionMean(player, market) {
  const projections = player?.projections || {}
  if (market.id === 'rushing_receiving_yards') {
    return Number(projections.rushingReceivingYards ?? (Number(projections.rushingYards || 0) + Number(projections.receivingYards || 0)))
  }
  if (market.id === 'passing_rushing_yards') {
    return Number(projections.passingRushingYards ?? (Number(projections.passingYards || 0) + Number(projections.rushingYards || 0)))
  }
  return Number(projections[market.projectionKey])
}

function liveMean(player, market, pregameMean) {
  const live = player?.live
  if (!live?.isLive) return pregameMean
  const progress = clamp(Number(live.gameProgress ?? 0), 0, 0.98)
  const liveStats = live.stats || {}
  const keys = {
    passing_yards: 'passingYards',
    receptions: 'receptions',
    receiving_yards: 'receivingYards',
    rushing_yards: 'rushingYards',
  }
  const trailing = live.gameScript === 'trailing'
  const leading = live.gameScript === 'leading'
  const passLean = ['passing_yards', 'receiving_yards', 'receptions', 'passing_rushing_yards'].includes(market.id)
  const rushLean = ['rushing_yards', 'rushing_receiving_yards'].includes(market.id)
  const script = trailing ? (passLean ? 1.09 : rushLean ? 0.93 : 1) : leading ? (passLean ? 0.95 : rushLean ? 1.07 : 1) : 1

  if (market.id === 'rushing_receiving_yards') {
    return Number(liveStats.rushingYards || 0) + Number(liveStats.receivingYards || 0) + pregameMean * (1 - progress) * script
  }
  if (market.id === 'passing_rushing_yards') {
    return Number(liveStats.passingYards || 0) + Number(liveStats.rushingYards || 0) + pregameMean * (1 - progress) * script
  }
  const current = Number(liveStats[keys[market.id]] || 0)
  return current + pregameMean * (1 - progress) * script
}

/**
 * Archetype-Adaptive Coefficient of Variation (CV) per player and market.
 * Correctly captures variance differences between bellcow backs, slot receivers, deep threats, and dual-threat QBs.
 */
function marketCoefficientOfVariation(marketId, player) {
  const usage = player?.usage || {}
  const snap = Number(usage.snapShare || 0.65)
  const targetShare = Number(usage.targetShare || 0.18)
  const airYards = Number(usage.airYardsShare || 0.20)

  if (marketId === 'passing_yards') {
    const attempts = Number(player?.projections?.attempts || 32)
    return attempts >= 36 ? 0.24 : 0.28
  }

  if (marketId === 'passing_rushing_yards') {
    return 0.25
  }

  if (marketId === 'rushing_yards') {
    const carryShare = Number(player?.lineup?.carryShare || usage.carryShare || snap)
    if (snap >= 0.75 && carryShare >= 0.65) return 0.34 // Workhorse bellcow (e.g. Henry, Barkley)
    if (snap >= 0.60) return 0.40 // Primary committee lead
    return 0.52 // Change-of-pace / rotational back
  }

  if (marketId === 'receiving_yards') {
    if (targetShare >= 0.25 && snap >= 0.80) {
      // Alpha WR1 (e.g. AJ Brown, Tyreek Hill, Ja'Marr Chase)
      return airYards >= 0.35 ? 0.42 : 0.36
    }
    if (airYards >= 0.35) {
      // Deep threat / boom-bust receiver
      return 0.54
    }
    if (targetShare >= 0.20) {
      // High-volume WR2 / TE1
      return 0.44
    }
    return 0.56 // Rotational pass catcher
  }

  if (marketId === 'rushing_receiving_yards') {
    return snap >= 0.70 ? 0.32 : 0.38
  }

  return 0.45
}

function defenseFactor(player, marketId) {
  const entry = player?.defenseVsPosition || {}
  const direct = Number(entry.factors?.[marketId])
  let baseFactor = 1.0

  if (Number.isFinite(direct)) {
    baseFactor = clamp(direct, 0.84, 1.16)
  } else {
    const percentile = Number(entry.percentile)
    baseFactor = Number.isFinite(percentile) ? clamp(0.90 + percentile * 0.20, 0.84, 1.16) : 1
  }

  // Scheme & Pass/Run Funnel Interactions
  const oppDef = player?.lineup?.opponentDefense || {}
  const passFunnel = Boolean(oppDef.passFunnel || entry.passFunnel)
  const runFunnel = Boolean(oppDef.runFunnel || entry.runFunnel)

  if (passFunnel && ['passing_yards', 'receiving_yards', 'receptions', 'passing_rushing_yards'].includes(marketId)) {
    baseFactor *= 1.03
  } else if (runFunnel && ['rushing_yards', 'rushing_receiving_yards'].includes(marketId)) {
    baseFactor *= 1.03
  }

  return clamp(baseFactor, 0.82, 1.18)
}

function roleFactor(player, marketId) {
  const usage = player?.usage || {}
  if (['anytime_td', 'first_td', 'two_plus_td'].includes(marketId)) {
    const rz = Math.min(0.10, Number(usage.redZoneOpportunityShare || 0) * 0.12)
    const goal = Math.min(0.08, Number(usage.goalLineOpportunityShare || 0) * 0.10)
    return 1 + rz + goal
  }
  const share = marketId === 'receptions' || marketId === 'receiving_yards'
    ? Number(usage.targetShare || 0)
    : Number(usage.snapShare || 0)
  return clamp(0.95 + share * 0.10, 0.92, 1.08)
}

function lineupFactor(player, marketId) {
  const value = Number(player?.lineup?.marketFactors?.[marketId])
  return Number.isFinite(value) ? clamp(value, 0.60, 1.45) : 1
}

function liveDeploymentFactor(player, marketId) {
  const live = player?.live || {}
  if (!live.isLive || Number(live.observedSnaps || 0) < 5) return 1
  const expectedSnap = Number(player?.lineup?.expectedSnapShare || player?.usage?.snapShare || 0)
  const observedSnap = Number(live.observedSnapShare)
  let factor = expectedSnap > 0 && Number.isFinite(observedSnap) ? clamp(observedSnap / expectedSnap, 0.70, 1.30) : 1
  if (['receptions', 'receiving_yards', 'rushing_receiving_yards'].includes(marketId)) {
    const expectedRoutes = Number(player?.lineup?.routesPerDropback || 0)
    const observedRoutes = Number(live.observedRoutesPerDropback)
    if (expectedRoutes > 0 && Number.isFinite(observedRoutes)) {
      factor = factor * 0.4 + clamp(observedRoutes / expectedRoutes, 0.65, 1.35) * 0.6
    }
  }
  if (['anytime_td', 'first_td', 'two_plus_td'].includes(marketId) && Number(live.goalLineAppearances || 0) > 0) {
    factor *= 1.05
  }
  return clamp(factor, 0.65, 1.38)
}

function splitFactor(player) {
  return clamp(1 + Number(player?.splits?.activeEdge || 0), 0.88, 1.12)
}

function teamTotalFactor(player, marketId) {
  const teamTotal = Number(player?.teamTotal ?? player?.impliedTotal ?? player?.game?.teamTotal)
  if (!Number.isFinite(teamTotal) || teamTotal <= 0) return 1
  const leagueAvgTotal = 21.5
  const ratio = (teamTotal - leagueAvgTotal) / leagueAvgTotal
  if (['anytime_td', 'first_td', 'two_plus_td'].includes(marketId)) {
    return clamp(1 + ratio * 0.48, 0.80, 1.25)
  }
  return clamp(1 + ratio * 0.28, 0.86, 1.14)
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
    if (rushMarkets.includes(marketId)) return 1 + favMagnitude * 0.08
    if (passMarkets.includes(marketId)) return 1 - favMagnitude * 0.05
    if (player.position === 'RB' && ['anytime_td', 'first_td', 'two_plus_td'].includes(marketId)) return 1 + favMagnitude * 0.06
  } else if (isUnderdog) {
    const dogMagnitude = Math.min(14, Math.abs(spread)) / 14
    if (passMarkets.includes(marketId)) return 1 + dogMagnitude * 0.08
    if (rushMarkets.includes(marketId)) return 1 - dogMagnitude * 0.05
  }
  return 1
}

/**
 * Composite 0-100 Rank Score calculation.
 * 50% Model Production Likelihood + 30% Role & Volume Dominance + 20% Matchup Environment.
 * Evaluates the player's true statistical excellence and scoring power independent of bookmaker odds.
 */
function calculateCompositeScore(probability, player, defense, teamEnv, gameScript, marketId) {
  // Factor 1: Model Production Likelihood (50%)
  let probScore
  if (marketId === 'first_td') {
    probScore = clamp(probability * 550, 15, 98)
  } else if (marketId === 'two_plus_td') {
    probScore = clamp(probability * 400, 15, 98)
  } else if (marketId === 'anytime_td') {
    probScore = clamp(probability * 160, 15, 98)
  } else {
    probScore = clamp(probability * 135, 15, 98)
  }

  // Factor 2: Role & Volume Dominance (30%) - normalized to position-specific ceilings
  const usage = player?.usage || {}
  const snap = Number(usage.snapShare || 0.6)
  const target = Number(usage.targetShare || 0.15)
  const rz = Number(usage.redZoneOpportunityShare || usage.goalLineOpportunityShare || 0.2)
  const goalLine = Number(usage.goalLineOpportunityShare || usage.goalToGoOpportunityShare || 0)
  const carry = Number(player?.lineup?.carryShare || usage.carryShare || snap)

  let roleScore
  if (player?.position === 'RB') {
    const snapPts = clamp(snap, 0, 1) * 35
    const carryPts = clamp(Math.max(carry, snap * 0.7) / 0.65, 0, 1) * 35
    const rzPts = clamp(Math.max(goalLine, rz) / 0.50, 0, 1) * 30
    roleScore = clamp(snapPts + carryPts + rzPts, 20, 98)
  } else if (player?.position === 'WR' || player?.position === 'TE') {
    const snapPts = clamp(snap, 0, 1) * 35
    const targetPts = clamp(target / 0.28, 0, 1) * 40
    const rzPts = clamp(rz / 0.30, 0, 1) * 25
    roleScore = clamp(snapPts + targetPts + rzPts, 20, 98)
  } else if (player?.position === 'QB') {
    const snapPts = clamp(snap, 0, 1) * 60
    const rzPts = clamp(rz / 0.35, 0, 1) * 40
    roleScore = clamp(snapPts + rzPts, 20, 98)
  } else {
    const snapPts = clamp(snap, 0, 1) * 35
    const targetPts = clamp(target / 0.25, 0, 1) * 35
    const rzPts = clamp(rz / 0.30, 0, 1) * 30
    roleScore = clamp(snapPts + targetPts + rzPts, 20, 98)
  }

  // Factor 3: Matchup & Script Environment (20%) - centered on 50 for neutral conditions
  const defPercentile = Number(player?.defenseVsPosition?.percentile ?? 0.5)
  const defPts = clamp(defPercentile, 0, 1) * 60
  const envRatio = Number.isFinite(Number(teamEnv)) && teamEnv > 0 ? teamEnv : 1
  const envPts = clamp(envRatio, 0.7, 1.3) * 25
  const scriptPts = clamp(gameScript || 1, 0.8, 1.2) * 15
  const matchupScore = clamp(defPts + envPts + scriptPts, 15, 98)

  const composite = probScore * 0.50 + roleScore * 0.30 + matchupScore * 0.20
  return Math.round(clamp(composite, 0, 100))
}

function probabilityGrade(probability, marketId, score, { historyGames = 0, roleRank = 1, isConfirmed = false } = {}) {
  let grade
  if (marketId === 'first_td') {
    grade = probability >= 0.12 ? 'PRIME' : probability >= 0.08 ? 'STRONG' : probability >= 0.045 ? 'LEAN' : 'SKIP'
  } else if (marketId === 'two_plus_td') {
    grade = probability >= 0.18 ? 'PRIME' : probability >= 0.10 ? 'STRONG' : probability >= 0.055 ? 'LEAN' : 'SKIP'
  } else if (marketId === 'anytime_td') {
    grade = probability >= 0.48 ? 'PRIME' : probability >= 0.36 ? 'STRONG' : probability >= 0.24 ? 'LEAN' : 'SKIP'
  } else {
    // Yardage and volume props (Passing, Rushing, Receiving, Combos, Receptions)
    grade = (probability >= 0.62 || score >= 75) ? 'PRIME' : (probability >= 0.54 || score >= 60) ? 'STRONG' : (probability >= 0.46 || score >= 45) ? 'LEAN' : 'SKIP'
  }

  // Standardization Gate 1: Rotational backup without confirmation cannot claim PRIME
  if (roleRank > 2 && !isConfirmed && grade === 'PRIME') {
    grade = 'STRONG'
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
  if (!market || !eligible) {
    return { marketId, eligible: false, probability: null, score: null, grade: 'INELIGIBLE', reasons: [] }
  }

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
    probability *= weather.factor * defense * role * split * lineup * liveDeployment * teamEnv * gameScript
    if (marketId === 'two_plus_td') {
      probability = calibrateNFLProbability(probability, player?.modelCalibration?.two_plus_td)
    }
  } else {
    mean = projectionMean(player, market)
    mean = liveMean(player, market, mean) * weather.factor * defense * role * split * lineup * liveDeployment * teamEnv * gameScript

    if (market.id === 'receptions') {
      // Discrete Poisson CDF for integer receptions
      probability = poissonOverProbability(mean, line)
    } else {
      // Parametric Lognormal CDF for right-skewed yardage markets
      const cv = marketCoefficientOfVariation(market.id, player)
      probability = lognormalOverProbability(mean, line, cv)
    }
  }

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

  const score = calculateCompositeScore(probability, player, defense, teamEnv, gameScript, marketId)

  const historyCount = Number(player?.historyMatch?.games ?? player?.recentGames?.length ?? 0)
  const roleRank = Number(player?.roleRank ?? player?.usage?.roleRank ?? 1)
  const isConfirmed = Boolean(player?.lineup?.confirmed)

  const grade = probabilityGrade(probability, marketId, score, {
    historyGames: historyCount,
    roleRank,
    isConfirmed,
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

