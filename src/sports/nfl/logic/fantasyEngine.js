import { scoreNFLProp } from './ScoringEngine.js'

export const FANTASY_SCORING_PRESETS = Object.freeze({
  ppr: {
    id: 'ppr',
    label: 'Full PPR (1.0)',
    shortLabel: 'PPR',
    passYardsPerPoint: 25,
    passTdPoints: 4,
    passIntPoints: -2,
    rushYardsPerPoint: 10,
    rushTdPoints: 6,
    rushFumblePoints: -2,
    recYardsPerPoint: 10,
    recPoints: 1.0,
    recTdPoints: 6,
    teBonusRecPoints: 0,
    twoPtConversionPoints: 2,
  },
  half_ppr: {
    id: 'half_ppr',
    label: 'Half PPR (0.5)',
    shortLabel: '0.5 PPR',
    passYardsPerPoint: 25,
    passTdPoints: 4,
    passIntPoints: -2,
    rushYardsPerPoint: 10,
    rushTdPoints: 6,
    rushFumblePoints: -2,
    recYardsPerPoint: 10,
    recPoints: 0.5,
    recTdPoints: 6,
    teBonusRecPoints: 0,
    twoPtConversionPoints: 2,
  },
  standard: {
    id: 'standard',
    label: 'Standard (0.0)',
    shortLabel: 'Standard',
    passYardsPerPoint: 25,
    passTdPoints: 4,
    passIntPoints: -2,
    rushYardsPerPoint: 10,
    rushTdPoints: 6,
    rushFumblePoints: -2,
    recYardsPerPoint: 10,
    recPoints: 0.0,
    recTdPoints: 6,
    teBonusRecPoints: 0,
    twoPtConversionPoints: 2,
  },
  te_premium: {
    id: 'te_premium',
    label: 'TE Premium (1.5)',
    shortLabel: 'TE Prem',
    passYardsPerPoint: 25,
    passTdPoints: 4,
    passIntPoints: -2,
    rushYardsPerPoint: 10,
    rushTdPoints: 6,
    rushFumblePoints: -2,
    recYardsPerPoint: 10,
    recPoints: 1.0,
    recTdPoints: 6,
    teBonusRecPoints: 0.5,
    twoPtConversionPoints: 2,
  },
})

export const DEFAULT_ROSTER_SLOTS = Object.freeze([
  { id: 'QB', label: 'QB', count: 1, positions: ['QB'] },
  { id: 'RB', label: 'RB', count: 2, positions: ['RB'] },
  { id: 'WR', label: 'WR', count: 2, positions: ['WR'] },
  { id: 'TE', label: 'TE', count: 1, positions: ['TE'] },
  { id: 'FLEX', label: 'FLEX', count: 1, positions: ['RB', 'WR', 'TE'] },
  { id: 'DST', label: 'D/ST', count: 1, positions: ['DST', 'D/ST', 'DEF'] },
  { id: 'K', label: 'K', count: 1, positions: ['K'] },
])

const clamp = (val, min, max) => Math.max(min, Math.min(max, val))

const TEAM_NAMES = {
  BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',
  MIA: 'Miami Dolphins',
  DET: 'Detroit Lions',
  KC: 'Kansas City Chiefs',
  PHI: 'Philadelphia Eagles',
  SF: 'San Francisco 49ers',
  DAL: 'Dallas Cowboys',
  CIN: 'Cincinnati Bengals',
  HOU: 'Houston Texans',
  GB: 'Green Bay Packers',
  MIN: 'Minnesota Vikings',
  NYJ: 'New York Jets',
  PIT: 'Pittsburgh Steelers',
  ATL: 'Atlanta Falcons',
  TB: 'Tampa Bay Buccaneers',
  SEA: 'Seattle Seahawks',
  ARI: 'Arizona Cardinals',
  LAC: 'Los Angeles Chargers',
  LAR: 'Los Angeles Rams',
  DEN: 'Denver Broncos',
  LVR: 'Las Vegas Raiders',
  CHI: 'Chicago Bears',
  IND: 'Indianapolis Colts',
  JAX: 'Jacksonville Jaguars',
  NO: 'New Orleans Saints',
  CLE: 'Cleveland Browns',
  TEN: 'Tennessee Titans',
  NYG: 'New York Giants',
  WAS: 'Washington Commanders',
  CAR: 'Carolina Panthers',
  NE: 'New England Patriots',
}

const KNOWN_KICKERS = {
  BAL: 'Justin Tucker',
  BUF: 'Tyler Bass',
  MIA: 'Jason Sanders',
  DET: 'Jake Bates',
  KC: 'Harrison Butker',
  PHI: 'Jake Elliott',
  SF: 'Jake Moody',
  DAL: 'Brandon Aubrey',
  CIN: 'Evan McPherson',
  HOU: "Ka'imi Fairbairn",
  GB: 'Brayden Narveson',
  MIN: 'Will Reichard',
  NYJ: 'Greg Zuerlein',
  PIT: 'Chris Boswell',
  ATL: 'Younghoe Koo',
  TB: 'Chase McLaughlin',
  SEA: 'Jason Myers',
  ARI: 'Matt Prater',
  LAC: 'Cameron Dicker',
  LAR: 'Joshua Karty',
  DEN: 'Wil Lutz',
  LVR: 'Daniel Carlson',
  CHI: 'Cairo Santos',
  IND: 'Matt Gay',
  JAX: 'Cam Little',
  NO: 'Blake Grupe',
  CLE: 'Dustin Hopkins',
  TEN: 'Nick Folk',
  NYG: 'Graham Gano',
  WAS: 'Austin Seibert',
  CAR: 'Eddy Pineiro',
  NE: 'Joey Slye',
}

/**
 * Generates D/ST (Defense / Special Teams) and Kicker (K) units for all active teams on the slate.
 */
export function generateSlateSpecialUnits(allPlayers = []) {
  if (!Array.isArray(allPlayers)) return []

  const teamMap = new Map()
  for (const p of allPlayers) {
    if (p.team && !teamMap.has(p.team)) {
      teamMap.set(p.team, {
        team: p.team,
        opponent: p.opponent || 'OPP',
        isHome: Boolean(p.isHome),
        teamTotal: Number(p.teamTotal || 24.0),
        kickoff: p.kickoff || 'Sun · 1:00 PM',
        gameId: p.gameId || `${p.team}-${p.opponent || 'OPP'}`,
        weather: p.weather || { roof: 'outdoor', tempF: 70, windMph: 5, precipProbability: 0 },
      })
    }
  }

  const specialUnits = []
  const existingIds = new Set(allPlayers.map((p) => p.id))

  for (const [teamCode, meta] of teamMap.entries()) {
    const oppMeta = teamMap.get(meta.opponent)
    const oppTotal = oppMeta ? oppMeta.teamTotal : (meta.isHome ? meta.teamTotal - 3.5 : meta.teamTotal + 3.5)

    // 1. D/ST Unit
    const dstId = `dst-${teamCode.toLowerCase()}`
    if (!existingIds.has(dstId)) {
      const teamFullName = TEAM_NAMES[teamCode] || `${teamCode} Defense`
      specialUnits.push({
        id: dstId,
        name: `${teamFullName} D/ST`,
        position: 'DST',
        team: teamCode,
        opponent: meta.opponent,
        isHome: meta.isHome,
        kickoff: meta.kickoff,
        gameId: meta.gameId,
        teamTotal: meta.teamTotal,
        oppTeamTotal: oppTotal,
        status: 'Active Defense',
        statusTone: 'good',
        weather: meta.weather,
        usage: { snapShare: 1.0 },
        projections: {},
      })
    }

    // 2. Kicker Unit
    const kId = `k-${teamCode.toLowerCase()}`
    if (!existingIds.has(kId)) {
      const kickerName = KNOWN_KICKERS[teamCode] || `${teamCode} Kicker`
      specialUnits.push({
        id: kId,
        name: kickerName,
        position: 'K',
        team: teamCode,
        opponent: meta.opponent,
        isHome: meta.isHome,
        kickoff: meta.kickoff,
        gameId: meta.gameId,
        teamTotal: meta.teamTotal,
        oppTeamTotal: oppTotal,
        status: 'Starting Kicker',
        statusTone: 'good',
        weather: meta.weather,
        usage: { snapShare: 1.0 },
        projections: {},
      })
    }
  }

  return specialUnits
}

export function calculatePlayerFantasyStats(player) {
  if (!player) return {}
  const pos = player?.position || 'FLEX'

  if (pos === 'DST' || pos === 'D/ST' || pos === 'DEF') {
    const oppTotal = Number(player.oppTeamTotal || (player.isHome ? 20.0 : 23.0))
    const isHome = Boolean(player.isHome)
    const expSacks = Math.max(1.8, 3.4 - (oppTotal - 20) * 0.08 + (isHome ? 0.4 : 0))
    const expInts = Math.max(0.4, 1.15 - (oppTotal - 20) * 0.035)
    const expFumbles = 0.65
    const expTds = 0.12
    const expSafeties = 0.08
    const expBlocks = 0.06

    return {
      oppTotal,
      sacks: expSacks,
      interceptions: expInts,
      fumblesRecovered: expFumbles,
      defensiveTds: expTds,
      safeties: expSafeties,
      blockedKicks: expBlocks,
    }
  }

  if (pos === 'K') {
    const teamTotal = Number(player.teamTotal || 24.0)
    const isHome = Boolean(player.isHome)
    const expPATs = (teamTotal / 7.2)
    const expFGs = Math.max(1.1, 1.6 + (teamTotal - 20) * 0.06 + (isHome ? 0.15 : 0))
    return {
      teamTotal,
      extraPoints: expPATs,
      fieldGoals: expFGs,
    }
  }

  const p = player?.projections || {}
  const passYards = Number(p.passingYards || 0)
  const rushYards = Number(p.rushingYards || 0)
  const recYards = Number(p.receivingYards || 0)
  const receptions = Number(p.receptions || 0)
  const completions = Number(p.completions || 0)
  const attempts = Number(p.attempts || 0)

  // TD modeling
  const anytimeProb = Number(p.anytimeTdProbability ?? player?.markets?.anytime_td?.probability ?? 0.25)
  const twoPlusProb = Number(player?.markets?.two_plus_td?.probability ?? (anytimeProb > 0.4 ? anytimeProb * 0.25 : anytimeProb * 0.15))

  // Expected rushing / receiving TDs
  const isPassCatcher = ['WR', 'TE'].includes(player?.position)
  const isRusher = player?.position === 'RB'
  const isQB = player?.position === 'QB'

  let expRushTds = 0
  let expRecTds = 0
  let expPassTds = 0

  if (isQB) {
    // QB passing TDs scale with passing yards and team implied total
    expPassTds = Math.max(0.4, (passYards / 135) * 0.85)
    expRushTds = anytimeProb * 0.8
  } else if (isRusher) {
    expRushTds = anytimeProb + twoPlusProb * 0.6
    expRecTds = Math.max(0, anytimeProb * 0.18)
  } else if (isPassCatcher) {
    expRecTds = anytimeProb + twoPlusProb * 0.6
    expRushTds = Math.max(0, anytimeProb * 0.05)
  } else {
    expRecTds = anytimeProb
  }

  // Interceptions & fumbles
  const expInts = isQB ? Math.max(0.3, attempts * 0.024) : 0
  const expFumbles = isRusher ? 0.12 : isQB ? 0.15 : 0.06

  return {
    passYards,
    rushYards,
    recYards,
    receptions,
    completions,
    attempts,
    passTds: expPassTds,
    rushTds: expRushTds,
    recTds: expRecTds,
    totalScoringTds: expRushTds + expRecTds,
    interceptions: expInts,
    fumblesLost: expFumbles,
    anytimeProb,
    twoPlusProb,
  }
}

export function calculateFantasyPoints(player, scoringRules = FANTASY_SCORING_PRESETS.ppr) {
  if (!player) return 0
  const rules = typeof scoringRules === 'string' ? FANTASY_SCORING_PRESETS[scoringRules] || FANTASY_SCORING_PRESETS.ppr : scoringRules || FANTASY_SCORING_PRESETS.ppr
  const stats = calculatePlayerFantasyStats(player)
  const pos = player?.position || 'FLEX'

  // D/ST Scoring Engine
  if (pos === 'DST' || pos === 'D/ST' || pos === 'DEF') {
    const oppTotal = Number(stats.oppTotal || 21.0)
    let ptsAllowedScore = 0
    if (oppTotal <= 9) ptsAllowedScore = 7.0
    else if (oppTotal <= 15) ptsAllowedScore = 4.0
    else if (oppTotal <= 20) ptsAllowedScore = 1.0
    else if (oppTotal <= 27) ptsAllowedScore = 0.0
    else if (oppTotal <= 34) ptsAllowedScore = -1.0
    else ptsAllowedScore = -3.0

    const sackPts = (stats.sacks || 2.5) * 1.0
    const turnoverPts = ((stats.interceptions || 0.9) + (stats.fumblesRecovered || 0.6)) * 2.0
    const tdPts = (stats.defensiveTds || 0.12) * 6.0
    const misc = (stats.safeties || 0.08) * 2.0 + (stats.blockedKicks || 0.06) * 2.0

    const total = Math.max(0, ptsAllowedScore + sackPts + turnoverPts + tdPts + misc)
    return Math.round(total * 100) / 100
  }

  // Kicker Scoring Engine
  if (pos === 'K') {
    const patPts = (stats.extraPoints || 2.5) * 1.0
    const fgPts = (stats.fieldGoals || 1.8) * 3.4 // blended 30/40/50 yd FG average
    const total = patPts + fgPts
    return Math.round(total * 100) / 100
  }

  let points = 0

  // Passing
  points += stats.passYards / rules.passYardsPerPoint
  points += stats.passTds * rules.passTdPoints
  points += stats.interceptions * rules.passIntPoints

  // Rushing
  points += stats.rushYards / rules.rushYardsPerPoint
  points += stats.rushTds * rules.rushTdPoints
  points += stats.fumblesLost * rules.rushFumblePoints

  // Receiving
  points += stats.recYards / rules.recYardsPerPoint
  points += stats.recTds * rules.recTdPoints
  points += stats.receptions * rules.recPoints

  // TE Premium bonus
  if (player.position === 'TE' && rules.teBonusRecPoints) {
    points += stats.receptions * rules.teBonusRecPoints
  }

  // Situational adjustments from ScoringEngine (Team total, defense matchup, game script)
  const anyTdModel = scoreNFLProp(player, 'anytime_td')
  const defenseFactor = Number(anyTdModel.defenseFactor || 1)
  const roleFactor = Number(anyTdModel.roleFactor || 1)
  const weatherFactor = Number(anyTdModel.weather?.factor || 1)

  // Overall situational scale
  const situationScale = clamp(defenseFactor * 0.4 + roleFactor * 0.3 + weatherFactor * 0.3, 0.88, 1.15)
  points *= situationScale

  return Math.max(0, Math.round(points * 100) / 100)
}


export function calculatePlayerDistribution(player, scoringRules = FANTASY_SCORING_PRESETS.ppr) {
  const median = calculateFantasyPoints(player, scoringRules)
  if (median <= 0) return { floor: 0, median: 0, ceiling: 0, stdDev: 0, boomProb: 0, bustProb: 0 }

  const pos = player?.position || 'FLEX'
  const usage = player?.usage || {}

  // Position-specific variance scale
  let volRatio = 0.32
  if (pos === 'QB') volRatio = 0.26
  else if (pos === 'RB') volRatio = Number(usage.snapShare || 0.6) > 0.7 ? 0.30 : 0.38
  else if (pos === 'WR') volRatio = Number(usage.airYardsShare || 0.25) > 0.35 ? 0.44 : 0.36
  else if (pos === 'TE') volRatio = 0.42

  const stdDev = Math.max(2.5, median * volRatio)

  // Floor (10th percentile): median - 1.28 * stdDev, clamped by baseline snaps
  const rawFloor = median - 1.28 * stdDev
  const snapGuarantee = Number(usage.snapShare || 0.5) * (pos === 'QB' ? 10 : pos === 'RB' ? 4.5 : 3.0)
  const floor = Math.max(0.5, Math.round(Math.max(rawFloor, snapGuarantee * 0.8) * 10) / 10)

  // Ceiling (90th percentile): median + 1.28 * stdDev + multi-TD overdispersion bonus
  const multiTdBonus = Number(player?.markets?.two_plus_td?.probability || 0.05) * 12
  const ceiling = Math.round((median + 1.28 * stdDev + multiTdBonus) * 10) / 10

  // Boom (probability of reaching >= 18 pts for FLEX, 24 for QB)
  const boomThreshold = pos === 'QB' ? 24 : 18
  const bustThreshold = pos === 'QB' ? 12 : 7
  const boomZ = (boomThreshold - median) / stdDev
  const bustZ = (bustThreshold - median) / stdDev

  const normalCdf = (z) => 1 / (1 + Math.exp(-0.07056 * Math.pow(z, 3) - 1.5976 * z))
  const boomProb = clamp(1 - normalCdf(boomZ), 0.01, 0.95)
  const bustProb = clamp(normalCdf(bustZ), 0.01, 0.95)

  return {
    floor,
    median,
    ceiling,
    stdDev: Math.round(stdDev * 10) / 10,
    boomProb: Math.round(boomProb * 100) / 100,
    bustProb: Math.round(bustProb * 100) / 100,
  }
}

export function enrichPlayerFantasyProfile(player, scoringRules = FANTASY_SCORING_PRESETS.ppr) {
  const dist = calculatePlayerDistribution(player, scoringRules)
  const stats = calculatePlayerFantasyStats(player)
  const tdModel = scoreNFLProp(player, 'anytime_td')
  return {
    ...player,
    fantasy: {
      points: dist.median,
      floor: dist.floor,
      ceiling: dist.ceiling,
      stdDev: dist.stdDev,
      boomProb: dist.boomProb,
      bustProb: dist.bustProb,
      stats,
      signals: tdModel.signals || [],
      defenseFactor: tdModel.defenseFactor || 1,
      weather: tdModel.weather || {},
    },
  }
}

export function optimizeFantasyLineup(roster = [], slots = DEFAULT_ROSTER_SLOTS, scoringRules = FANTASY_SCORING_PRESETS.ppr, mode = 'median') {
  const enriched = roster.map((p) => enrichPlayerFantasyProfile(p, scoringRules))
  const metricKey = mode === 'floor' ? 'floor' : mode === 'ceiling' ? 'ceiling' : 'points'

  // Sort by target metric descending
  const pool = [...enriched].sort((a, b) => (b.fantasy[metricKey] || 0) - (a.fantasy[metricKey] || 0))
  const assigned = new Set()
  const lineup = []

  // Pass 1: Assign strict primary positional slots (QB, RB, WR, TE)
  for (const slot of slots) {
    if (slot.id === 'FLEX' || slot.id === 'SUPERFLEX') continue
    let countNeeded = slot.count
    for (const player of pool) {
      if (countNeeded <= 0) break
      if (assigned.has(player.id)) continue
      if (slot.positions.includes(player.position)) {
        assigned.add(player.id)
        lineup.push({ slot: slot.id, slotLabel: slot.label, player, points: player.fantasy[metricKey] })
        countNeeded -= 1
      }
    }
    // Fill remaining empty slots with null if roster lacked eligible players
    while (countNeeded > 0) {
      lineup.push({ slot: slot.id, slotLabel: slot.label, player: null, points: 0 })
      countNeeded -= 1
    }
  }

  // Pass 2: Assign flex slots (FLEX, SUPERFLEX)
  for (const slot of slots) {
    if (slot.id !== 'FLEX' && slot.id !== 'SUPERFLEX') continue
    let countNeeded = slot.count
    for (const player of pool) {
      if (countNeeded <= 0) break
      if (assigned.has(player.id)) continue
      if (slot.positions.includes(player.position)) {
        assigned.add(player.id)
        lineup.push({ slot: slot.id, slotLabel: slot.label, player, points: player.fantasy[metricKey] })
        countNeeded -= 1
      }
    }
    while (countNeeded > 0) {
      lineup.push({ slot: slot.id, slotLabel: slot.label, player: null, points: 0 })
      countNeeded -= 1
    }
  }

  // Bench: remaining unassigned players
  const bench = pool.filter((p) => !assigned.has(p.id))

  const totalPoints = lineup.reduce((sum, item) => sum + (item.points || 0), 0)
  const totalFloor = lineup.reduce((sum, item) => sum + (item.player?.fantasy?.floor || 0), 0)
  const totalCeiling = lineup.reduce((sum, item) => sum + (item.player?.fantasy?.ceiling || 0), 0)

  return {
    lineup,
    bench,
    totalPoints: Math.round(totalPoints * 10) / 10,
    totalFloor: Math.round(totalFloor * 10) / 10,
    totalCeiling: Math.round(totalCeiling * 10) / 10,
    mode,
  }
}

// Pseudo-random Gaussian using Box-Muller transform
function sampleGaussian(mean, stdDev) {
  let u = 0
  let v = 0
  while (u === 0) u = Math.random()
  while (v === 0) v = Math.random()
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
  return Math.max(0, mean + num * stdDev)
}

export function simulateH2HMatchup(teamAStarters = [], teamBStarters = [], scoringRules = FANTASY_SCORING_PRESETS.ppr, iterations = 5000) {
  const teamAProfiles = teamAStarters.filter(Boolean).map((p) => enrichPlayerFantasyProfile(p, scoringRules))
  const teamBProfiles = teamBStarters.filter(Boolean).map((p) => enrichPlayerFantasyProfile(p, scoringRules))

  let teamAWins = 0
  let teamBWins = 0
  let ties = 0

  const teamAScores = []
  const teamBScores = []

  for (let i = 0; i < iterations; i += 1) {
    let scoreA = 0
    for (const p of teamAProfiles) {
      scoreA += sampleGaussian(p.fantasy.points, p.fantasy.stdDev)
    }
    let scoreB = 0
    for (const p of teamBProfiles) {
      scoreB += sampleGaussian(p.fantasy.points, p.fantasy.stdDev)
    }

    teamAScores.push(scoreA)
    teamBScores.push(scoreB)

    if (scoreA > scoreB) teamAWins += 1
    else if (scoreB > scoreA) teamBWins += 1
    else ties += 1
  }

  const winProbA = Math.round((teamAWins / iterations) * 1000) / 10
  const winProbB = Math.round((teamBWins / iterations) * 1000) / 10

  const meanScoreA = teamAProfiles.reduce((sum, p) => sum + p.fantasy.points, 0)
  const meanScoreB = teamBProfiles.reduce((sum, p) => sum + p.fantasy.points, 0)

  const floorA = teamAProfiles.reduce((sum, p) => sum + p.fantasy.floor, 0)
  const ceilingA = teamAProfiles.reduce((sum, p) => sum + p.fantasy.ceiling, 0)

  const floorB = teamBProfiles.reduce((sum, p) => sum + p.fantasy.floor, 0)
  const ceilingB = teamBProfiles.reduce((sum, p) => sum + p.fantasy.ceiling, 0)

  // Positional Matchup Comparisons (Slot-by-Slot)
  const slotBattles = []
  const maxSlots = Math.max(teamAProfiles.length, teamBProfiles.length)
  for (let i = 0; i < maxSlots; i += 1) {
    const pA = teamAProfiles[i] || null
    const pB = teamBProfiles[i] || null
    const ptsA = pA ? pA.fantasy.points : 0
    const ptsB = pB ? pB.fantasy.points : 0
    const diff = Math.round((ptsA - ptsB) * 10) / 10
    slotBattles.push({
      slotIndex: i,
      playerA: pA,
      playerB: pB,
      pointsA: ptsA,
      pointsB: ptsB,
      diff,
      advantage: diff > 0.5 ? 'teamA' : diff < -0.5 ? 'teamB' : 'even',
    })
  }

  // Tactical strategy advice
  let strategyAdvice = ''
  let strategyTone = 'neutral'
  if (winProbA <= 42) {
    strategyAdvice = `You are an underdog (${winProbA}% win prob). To pull off the upset, pivot your FLEX to a high-ceiling WR or multi-TD scorer rather than a safe-floor grinder.`
    strategyTone = 'warn'
  } else if (winProbA >= 65) {
    strategyAdvice = `You hold a solid projection advantage (${winProbA}% win prob). Protect your lead with high snap-share bellcows and high-target volume receivers to eliminate bust risk.`
    strategyTone = 'good'
  } else {
    strategyAdvice = `Tightly contested coin-flip matchup (${winProbA}% vs ${winProbB}%). Matchup will come down to touchdown variance in your WR2 and FLEX slots.`
    strategyTone = 'prime'
  }

  // Conflict / Correlation Radar
  const correlations = []

  // 1. Intra-Team A internal synergies & anti-correlations
  for (let i = 0; i < teamAProfiles.length; i += 1) {
    for (let j = i + 1; j < teamAProfiles.length; j += 1) {
      const p1 = teamAProfiles[i]
      const p2 = teamAProfiles[j]
      if (p1.team && p1.team === p2.team) {
        // QB + Pass Catcher stack
        if (p1.position === 'QB' && ['WR', 'TE'].includes(p2.position)) {
          correlations.push({
            type: 'synergy',
            title: `QB-Pass Catcher Stack (${p1.team})`,
            description: `${p1.name} + ${p2.name} stack multiplies touchdown upside in high-scoring shootouts.`,
          })
        }
        // RB + Defense Positive Game Script Synergy
        if (['RB'].includes(p1.position) && ['DST', 'D/ST', 'DEF'].includes(p2.position)) {
          correlations.push({
            type: 'synergy',
            title: `Lead Script Synergy (${p1.team} RB + D/ST)`,
            description: `${p2.name} holding a lead protects ${p1.name}'s second-half clock-killing rush volume.`,
          })
        }
      }
      // Anti-correlation: Starting offensive player against your own D/ST
      if (p1.team && p2.team && p1.opponent === p2.team) {
        if (['DST', 'D/ST', 'DEF'].includes(p1.position) || ['DST', 'D/ST', 'DEF'].includes(p2.position)) {
          const dst = ['DST', 'D/ST', 'DEF'].includes(p1.position) ? p1 : p2
          const off = dst === p1 ? p2 : p1
          correlations.push({
            type: 'hedge',
            title: 'Offense vs Defense Conflict (Own Roster)',
            description: `Starting ${off.name} against your own ${dst.name} caps your ceiling (offensive scores lower defensive points allowed).`,
          })
        }
      }
    }
  }

  // 2. Inter-Team H2H Clashes
  for (const pA of teamAProfiles) {
    for (const pB of teamBProfiles) {
      if (pA.team && pB.team) {
        // Direct H2H Clash: Your defense against opponent's star
        if (['DST', 'D/ST', 'DEF'].includes(pA.position) && pA.opponent === pB.team) {
          correlations.push({
            type: 'hedge',
            title: `Direct H2H Matchup Clash`,
            description: `Your ${pA.name} is tasked with shutting down opponent's ${pB.name} (${pB.team}).`,
          })
        }
        // Teammate hedge (e.g. You start QB, Opponent starts WR)
        if (pA.team === pB.team && pA.position === 'QB' && ['WR', 'TE'].includes(pB.position)) {
          correlations.push({
            type: 'hedge',
            title: 'QB / WR Teammate Hedge',
            description: `You start ${pA.name} (QB) and opponent starts ${pB.name} (WR). Touchdown passes between them reward both teams.`,
          })
        }
        // Same-Game Shootout Stacking
        if (pA.opponent === pB.team && !['DST', 'D/ST', 'DEF', 'K'].includes(pA.position) && !['DST', 'D/ST', 'DEF', 'K'].includes(pB.position)) {
          correlations.push({
            type: 'shootout',
            title: 'Same-Game Shootout Stacking',
            description: `${pA.name} (${pA.team}) and ${pB.name} (${pB.team}) face each other. A fast-paced shootout elevates scoring for both rosters.`,
          })
        }
      }
    }
  }

  return {
    iterations,
    winProbA,
    winProbB,
    meanScoreA: Math.round(meanScoreA * 10) / 10,
    meanScoreB: Math.round(meanScoreB * 10) / 10,
    floorA: Math.round(floorA * 10) / 10,
    ceilingA: Math.round(ceilingA * 10) / 10,
    floorB: Math.round(floorB * 10) / 10,
    ceilingB: Math.round(ceilingB * 10) / 10,
    slotBattles,
    strategyAdvice,
    strategyTone,
    correlations: correlations.slice(0, 4),
  }

}

export function compareStartSit(playerA, playerB, scoringRules = FANTASY_SCORING_PRESETS.ppr) {
  const pA = enrichPlayerFantasyProfile(playerA, scoringRules)
  const pB = enrichPlayerFantasyProfile(playerB, scoringRules)

  const diff = Math.round((pA.fantasy.points - pB.fantasy.points) * 10) / 10
  const floorDiff = Math.round((pA.fantasy.floor - pB.fantasy.floor) * 10) / 10
  const ceilingDiff = Math.round((pA.fantasy.ceiling - pB.fantasy.ceiling) * 10) / 10

  const recommended = diff >= 0 ? pA : pB
  const recommendedDiff = Math.abs(diff)

  let summary = ''
  if (recommendedDiff >= 3.5) {
    summary = `Clear start: ${recommended.name} projects for +${recommendedDiff.toFixed(1)} more fantasy points with stronger overall opportunity volume.`
  } else if (recommendedDiff >= 1.0) {
    summary = `Lean ${recommended.name} (+${recommendedDiff.toFixed(1)} pts), backed by a favorable team scoring environment.`
  } else {
    summary = `Virtual toss-up (${pA.name} ${pA.fantasy.points} vs ${pB.name} ${pB.fantasy.points}). Start ${pA.fantasy.floor >= pB.fantasy.floor ? pA.name : pB.name} for floor, or ${pA.fantasy.ceiling >= pB.fantasy.ceiling ? pA.name : pB.name} for ceiling.`
  }

  return {
    playerA: pA,
    playerB: pB,
    diff,
    floorDiff,
    ceilingDiff,
    recommended,
    recommendedDiff,
    summary,
  }
}

export function scoreWaiverTarget(player, scoringRules = FANTASY_SCORING_PRESETS.ppr) {
  const profile = enrichPlayerFantasyProfile(player, scoringRules)
  const signals = profile.fantasy.signals || []

  let score = profile.fantasy.points * 3.5

  // Boost for high-value breakout signals
  if (signals.some((s) => s.key === 'role-inheritance')) score += 25
  if (signals.some((s) => s.key === 'goal-to-go-dominator' || s.key === 'end-zone-alpha')) score += 18
  if (signals.some((s) => s.key === 'opportunity-spike')) score += 15
  if (signals.some((s) => s.key === 'drive-participation')) score += 12
  if (profile.fantasy.defenseFactor >= 1.05) score += 8

  // Penalize for active red flags
  if (signals.some((s) => s.key === 'snap-limit')) score -= 20
  if (signals.some((s) => s.key === 'scoring-role-lost')) score -= 15

  return {
    ...profile,
    waiverScore: Math.round(score),
    breakoutRating: score >= 75 ? 'HIGH_PRIORITY' : score >= 50 ? 'TARGET' : 'STASH',
  }
}

/**
 * Normalizes a player name for robust fuzzy matching across ESPN, Yahoo, Sleeper, and NFL slates.
 */
export function normalizePlayerName(name) {
  if (!name || typeof name !== 'string') return ''
  return name
    .toLowerCase()
    .replace(/^(qb|rb|wr|te|k|def|dst|d\/st|flex|flx|bn|bench|ir|op)\s*[:-]?\s*/i, '') // Remove position prefixes
    .replace(/\s*(jr\.?|sr\.?|iii|ii|iv|v)$/i, '') // Remove suffixes
    .replace(/[^a-z0-9\s]/g, '') // Remove punctuation (periods, apostrophes, hyphens)
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Parses raw text copied from ESPN Fantasy, Yahoo Fantasy, Sleeper, or plain text lists
 * and matches players against the current NFL slate.
 *
 * @param {string} rawText - Unstructured or structured text containing player names.
 * @param {Array<Object>} allPlayers - Complete list of player objects on the active slate.
 * @returns {Object} { matchedPlayers: Array, matchedIds: Array, unmatched: Array, count: number }
 */
export function parseRosterText(rawText, allPlayers = []) {
  if (!rawText || typeof rawText !== 'string' || !Array.isArray(allPlayers)) {
    return { matchedPlayers: [], matchedIds: [], unmatched: [], count: 0 }
  }

  // Common fantasy noise words to ignore
  const IGNORE_WORDS = new Set([
    'qb', 'rb', 'wr', 'te', 'k', 'def', 'dst', 'd/st', 'flex', 'flx', 'bn', 'bench', 'ir', 'op',
    'starter', 'starters', 'lineup', 'roster', 'projected', 'proj', 'fpts', 'pts', 'vs', 'at', '@',
    'sun', 'mon', 'thu', 'fri', 'sat', 'pm', 'am', 'et', 'ct', 'pt', 'healthy', 'questionable',
    'doubtful', 'out', 'ir-r', 'dnp', 'fp', 'lp', 'q', 'p', 'o', 'ir', 'sspd', 'slot', 'player',
    'action', 'opp', 'status', 'prk', '%rooked', 'avg', 'last', 'rank'
  ])

  // Split lines
  const rawLines = rawText.split(/[\r\n;,]+/)
  const matchedPlayers = []
  const matchedIds = new Set()
  const unmatched = []

  // Precompute normalized names for all slate players
  const playerMap = allPlayers.map((p) => ({
    player: p,
    rawName: p.name,
    normName: normalizePlayerName(p.name),
    normTokens: normalizePlayerName(p.name).split(' ').filter(Boolean),
    team: (p.team || '').toLowerCase(),
  }))

  for (const line of rawLines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Filter out obvious header lines
    const lowerLine = trimmed.toLowerCase()
    if (lowerLine === 'starters' || lowerLine === 'bench' || lowerLine === 'lineup' || lowerLine === 'my team') {
      continue
    }

    // Clean up line
    let cleaned = trimmed
      .replace(/^(qb|rb|wr|te|k|def|dst|d\/st|flex|flx|bn|bench|ir|op)\s*[:-]?\s*/i, '') // slot prefix
      .replace(/\((q|p|o|d|ir|sspd)\)/gi, '') // status in parens
      .replace(/\[(q|p|o|d|ir|sspd)\]/gi, '')
      .replace(/(\b\d+(\.\d+)?\s*(pts|fpts|proj)?\b)/gi, '') // fantasy points like 18.4 pts
      .replace(/\s+/g, ' ')
      .trim()

    const normLine = normalizePlayerName(cleaned)
    if (!normLine || IGNORE_WORDS.has(normLine)) continue

    // 1. Direct normalized match
    let match = playerMap.find((item) => item.normName === normLine && !matchedIds.has(item.player.id))

    // 2. Substring match: slate player name starts with or equals normLine, or normLine includes slate player name
    if (!match) {
      match = playerMap.find(
        (item) =>
          !matchedIds.has(item.player.id) &&
          (item.normName.includes(normLine) || normLine.includes(item.normName))
      )
    }

    // 3. Token-based match: both first name and last name tokens match
    if (!match) {
      const lineTokens = normLine.split(' ').filter((t) => !IGNORE_WORDS.has(t) && t.length > 1)
      if (lineTokens.length >= 2) {
        match = playerMap.find((item) => {
          if (matchedIds.has(item.player.id)) return false
          const hasTokens = lineTokens.every((t) => item.normTokens.includes(t))
          return hasTokens
        })
      }
    }

    // 4. Last name + initial check (e.g. "D. Henry" or "J. Allen")
    if (!match) {
      const initialMatch = normLine.match(/^([a-z])\s+([a-z]+)$/)
      if (initialMatch) {
        const [, firstInit, lastName] = initialMatch
        match = playerMap.find((item) => {
          if (matchedIds.has(item.player.id)) return false
          const itemFirst = item.normTokens[0] || ''
          const itemLast = item.normTokens[item.normTokens.length - 1] || ''
          return itemFirst.startsWith(firstInit) && itemLast === lastName
        })
      }
    }

    if (match) {
      matchedPlayers.push(match.player)
      matchedIds.add(match.player.id)
    } else {
      // Record unmatched candidate if it looks like a person's name (at least 2 letters, not a pure number)
      if (normLine.length >= 3 && !/^\d+$/.test(normLine)) {
        unmatched.push(trimmed)
      }
    }
  }

  return {
    matchedPlayers,
    matchedIds: Array.from(matchedIds),
    unmatched,
    count: matchedPlayers.length,
  }
}

/**
 * Calculates in-game live scoring and Player Minutes Remaining (PMR) during active games.
 */
export function calculateLiveMatchupStats(teamAStarters = [], teamBStarters = [], scoringRules = FANTASY_SCORING_PRESETS.ppr) {
  const rules = typeof scoringRules === 'string' ? FANTASY_SCORING_PRESETS[scoringRules] || FANTASY_SCORING_PRESETS.ppr : scoringRules || FANTASY_SCORING_PRESETS.ppr

  const processPlayer = (p) => {
    if (!p) return { livePts: 0, remPts: 0, pmr: 0, progress: 0, isLive: false, isFinal: false }
    const profile = enrichPlayerFantasyProfile(p, rules)
    const live = p.live || {}
    const isLive = Boolean(live.isLive)
    const progress = Number(live.gameProgress ?? (live.label?.includes('FINAL') ? 1.0 : isLive ? 0.5 : 0))
    const isFinal = progress >= 1.0

    // Compute live points from current box score stats
    const st = live.stats || {}
    let livePts = 0
    if (st.passingYards) livePts += st.passingYards / rules.passYardsPerPoint
    if (st.totalTds) livePts += st.totalTds * 6
    if (st.rushingYards) livePts += st.rushingYards / rules.rushYardsPerPoint
    if (st.receivingYards) livePts += st.receivingYards / rules.recYardsPerPoint
    if (st.receptions) livePts += st.receptions * rules.recPoints

    // If pregame, livePts is 0 and full projection remains
    if (progress === 0 && !isLive) {
      return {
        player: profile,
        livePts: 0,
        remPts: profile.fantasy.points,
        projTotal: profile.fantasy.points,
        pmr: 60,
        progress: 0,
        isLive: false,
        isFinal: false,
      }
    }

    // Remaining expectation is projected median * remaining game time
    const remFrac = Math.max(0, 1.0 - progress)
    const remPts = Math.round(profile.fantasy.points * remFrac * 10) / 10
    const pmr = Math.round(60 * remFrac)
    const projTotal = Math.round((livePts + remPts) * 10) / 10

    return {
      player: profile,
      livePts: Math.round(livePts * 10) / 10,
      remPts,
      projTotal,
      pmr,
      progress,
      isLive,
      isFinal,
    }
  }

  const listA = teamAStarters.filter(Boolean).map(processPlayer)
  const listB = teamBStarters.filter(Boolean).map(processPlayer)

  const liveScoreA = Math.round(listA.reduce((sum, item) => sum + item.livePts, 0) * 10) / 10
  const liveScoreB = Math.round(listB.reduce((sum, item) => sum + item.livePts, 0) * 10) / 10

  const projFinalA = Math.round(listA.reduce((sum, item) => sum + item.projTotal, 0) * 10) / 10
  const projFinalB = Math.round(listB.reduce((sum, item) => sum + item.projTotal, 0) * 10) / 10

  const pmrA = listA.reduce((sum, item) => sum + item.pmr, 0)
  const pmrB = listB.reduce((sum, item) => sum + item.pmr, 0)

  const activeGamesCount = listA.filter((i) => i.isLive).length + listB.filter((i) => i.isLive).length

  return {
    listA,
    listB,
    liveScoreA,
    liveScoreB,
    projFinalA,
    projFinalB,
    pmrA,
    pmrB,
    activeGamesCount,
    isGameDayActive: activeGamesCount > 0 || listA.some((i) => i.isFinal) || listB.some((i) => i.isFinal),
  }
}

/**
 * Evaluates a proposed fantasy trade and calculates net starting lineup impact.
 */
export function evaluateFantasyTrade(giving = [], receiving = [], currentRoster = [], slots = DEFAULT_ROSTER_SLOTS, scoringRules = FANTASY_SCORING_PRESETS.ppr) {
  const rules = typeof scoringRules === 'string' ? FANTASY_SCORING_PRESETS[scoringRules] || FANTASY_SCORING_PRESETS.ppr : scoringRules || FANTASY_SCORING_PRESETS.ppr

  // Base optimized lineup
  const baseOptimized = optimizeFantasyLineup(currentRoster, slots, rules, 'median')

  // Simulated roster post-trade
  const givingIds = new Set(giving.map((p) => p.id))
  const newRoster = currentRoster.filter((p) => !givingIds.has(p.id)).concat(receiving)
  const postOptimized = optimizeFantasyLineup(newRoster, slots, rules, 'median')

  const pointDelta = Math.round((postOptimized.totalPoints - baseOptimized.totalPoints) * 10) / 10
  const floorDelta = Math.round((postOptimized.totalFloor - baseOptimized.totalFloor) * 10) / 10
  const ceilingDelta = Math.round((postOptimized.totalCeiling - baseOptimized.totalCeiling) * 10) / 10

  const givingPoints = Math.round(giving.reduce((sum, p) => sum + calculateFantasyPoints(p, rules), 0) * 10) / 10
  const receivingPoints = Math.round(receiving.reduce((sum, p) => sum + calculateFantasyPoints(p, rules), 0) * 10) / 10
  const grossValueDelta = Math.round((receivingPoints - givingPoints) * 10) / 10

  let grade = 'B'
  let verdict = 'FAIR VALUE DEAL'
  let tone = 'prime'
  let summary = ''

  if (pointDelta >= 3.5) {
    grade = 'A+'
    verdict = 'SMASH ACCEPT'
    tone = 'good'
    summary = `Major starting lineup upgrade (+${pointDelta.toFixed(1)} pts/wk). You gain top-tier starter equity.`
  } else if (pointDelta >= 1.0) {
    grade = 'A'
    verdict = 'ACCEPT TRADE'
    tone = 'good'
    summary = `Net positive trade (+${pointDelta.toFixed(1)} pts/wk) improving your active starting roster.`
  } else if (pointDelta >= -0.8) {
    grade = 'B'
    verdict = 'FAIR VALUE DEAL'
    tone = 'prime'
    summary = `Even-money trade (${pointDelta >= 0 ? `+${pointDelta}` : pointDelta} pts/wk). Balanced exchange of position need and depth.`
  } else if (pointDelta >= -2.8) {
    grade = 'C'
    verdict = 'LEAN REJECT'
    tone = 'warn'
    summary = `Slight downgrade to starting lineup (${pointDelta} pts/wk). Consider asking for an additional bench asset.`
  } else {
    grade = 'F'
    verdict = 'REJECT TRADE'
    tone = 'bad'
    summary = `Significant loss of starting firepower (${pointDelta} pts/wk). Do not accept without major draft/player compensation.`
  }

  return {
    giving,
    receiving,
    givingPoints,
    receivingPoints,
    grossValueDelta,
    pointDelta,
    floorDelta,
    ceilingDelta,
    basePoints: baseOptimized.totalPoints,
    postPoints: postOptimized.totalPoints,
    grade,
    verdict,
    tone,
    summary,
  }
}

/**
 * Generates a clean Markdown / League Chat export of the H2H matchup.
 */
export function generateMatchupShareText(h2hSim, myTeamName = 'My Squad', oppTeamName = 'Rival', format = 'ppr') {
  const fmtLabel = FANTASY_SCORING_PRESETS[format]?.shortLabel || 'PPR'
  const battlesText = (h2hSim.slotBattles || [])
    .slice(0, 6)
    .map((b) => {
      const nameA = b.playerA?.name || 'Empty'
      const nameB = b.playerB?.name || 'Empty'
      const edge = b.diff > 0 ? `(+${b.diff})` : b.diff < 0 ? `(${b.diff})` : '(EVEN)'
      return `• ${nameA} vs ${nameB} ${edge}`
    })
    .join('\n')

  return `🏆 StatFax H2H Matchup Preview (${fmtLabel})
━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚔️ ${myTeamName} (${h2hSim.winProbA}%) vs ${oppTeamName} (${h2hSim.winProbB}%)
📊 Projected Score: ${h2hSim.meanScoreA} – ${h2hSim.meanScoreB}
📈 Score Range: [${h2hSim.floorA}–${h2hSim.ceilingA}] vs [${h2hSim.floorB}–${h2hSim.ceilingB}]

🔥 Key Slot Battles:
${battlesText}

🎯 Strategy Coach:
"${h2hSim.strategyAdvice}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Generated by StatFax NFL Fantasy Lab`
}

