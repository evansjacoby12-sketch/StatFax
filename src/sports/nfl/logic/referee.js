import REFEREE_CREWS_RAW from '../data/referee-crews.json' with { type: 'json' }

const clamp = (val, min = 0.95, max = 1.05) => Math.max(min, Math.min(max, val))
const n = (val, fallback = 0) => val == null || !Number.isFinite(Number(val)) ? fallback : Number(val)

const DEFAULT_CREW = REFEREE_CREWS_RAW._default || {
  flagsPerGame: 12.2,
  penaltyYardsPerGame: 102.0,
  dpiPerGame: 2.1,
  offHoldingPerGame: 2.8,
  totalScoreFactor: 1.0,
  passFactor: 1.0,
  rushFactor: 1.0,
  tdFactor: 1.0,
  homeBiasYards: 0.0,
  style: 'Balanced',
}

/**
 * Resolves referee crew metrics by head referee name or object.
 * Returns null if no referee is specified.
 */
export function getRefereeCrew(refereeInput) {
  if (!refereeInput) return null
  const name = typeof refereeInput === 'string' ? refereeInput.trim() : refereeInput?.name?.trim() || refereeInput?.referee?.trim()
  if (!name) return null

  const direct = REFEREE_CREWS_RAW.crews?.[name]
  if (direct) {
    return { name, ...direct }
  }

  // Case-insensitive / partial match
  const lower = name.toLowerCase()
  for (const [crewName, stats] of Object.entries(REFEREE_CREWS_RAW.crews || {})) {
    if (crewName.toLowerCase() === lower || lower.includes(crewName.toLowerCase()) || crewName.toLowerCase().includes(lower)) {
      return { name: crewName, ...stats }
    }
  }

  return {
    name,
    ...DEFAULT_CREW,
  }
}

/**
 * Calculates the exact referee officiating multiplier for a player and prop market.
 * Pure mathematical adjustment bounded in [0.95, 1.05].
 */
export function nflRefereeImpact(refereeInput, marketId, player = {}) {
  const crew = getRefereeCrew(refereeInput || player?.game?.referee || player?.referee)
  if (!crew) {
    return { factor: 1.0, crew: null, style: 'Neutral', label: 'Neutral officiating baseline' }
  }

  let factor = 1.0
  const pos = player?.position

  // 1. Total Game Scoring / Penalty Friction Adjustment
  const totalScoreAdj = n(crew.totalScoreFactor, 1.0)

  if (['anytime_td', 'first_td', 'two_plus_td'].includes(marketId)) {
    // Touchdown markets scale with crew total score and TD factor
    factor *= (totalScoreAdj * 0.5 + n(crew.tdFactor, 1.0) * 0.5)
  } else if (['passing_yards', 'receiving_yards', 'receptions', 'passing_rushing_yards'].includes(marketId)) {
    // Passing/Receiving markets: High DPI crews boost outside deep threats and volume
    const passAdj = n(crew.passFactor, 1.0)
    const isDeepThreat = Number(player?.usage?.airYardsShare || 0) >= 0.30
    if (isDeepThreat && crew.dpiPerGame >= 2.8) {
      factor *= (passAdj * 1.015)
    } else {
      factor *= passAdj
    }
  } else if (['rushing_yards', 'rushing_receiving_yards'].includes(marketId)) {
    // Rushing markets: Heavy offensive holding crews stall rush drives
    const rushAdj = n(crew.rushFactor, 1.0)
    factor *= rushAdj
  }

  // 2. Home / Away Officiating Whistle Bias
  if (player?.isHome && crew.homeBiasYards >= 10.0) {
    factor *= 1.01
  } else if (!player?.isHome && crew.homeBiasYards >= 10.0) {
    factor *= 0.99
  }

  factor = clamp(factor)

  const diffPct = Math.round((factor - 1.0) * 100)
  const sign = diffPct > 0 ? '+' : ''
  const label = `${crew.name} (${crew.style}) · ${crew.flagsPerGame} flags/gm ${diffPct !== 0 ? `(${sign}${diffPct}% impact)` : ''}`.trim()

  return {
    factor,
    crew,
    style: crew.style,
    label,
  }
}
