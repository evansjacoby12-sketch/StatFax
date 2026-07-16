/**
 * Versioned, advisory-only MLB location matchup model.
 *
 * This module deliberately does not alter the HR projection. It answers a
 * narrower research question: does a pitcher feed a sufficiently supported
 * strike-zone area where this batter has shown extra-base damage?
 */

export const ZONE_MODEL_VERSION = 2
export const ZONE_IDS = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14])
export const STRIKE_ZONE_COUNT = 9

export const ZONE_THRESHOLDS = Object.freeze({
  minCellBIP: 10,
  minBatterBIP: 60,
  minPitcherPitches: 200,
  minAdjustedISO: 0.2,
  minLocationRatio: 1.1,
  minAttackScore: 25,
  shrinkK: 12,
  minBadgeRating: 6.5,
  minBadgeAttacks: 2,
})

// Handedness-specific pitch-location priors calculated from the persisted
// StatFax pitcher-zone cache (149 pitcher/side entries, 91,765 pitches).
// They are a safe fallback when a warm cache is not available at slate time.
export const FALLBACK_ZONE_FREQUENCIES = Object.freeze({
  L: Object.freeze([0.04933, 0.05252, 0.03178, 0.06570, 0.07283, 0.04656, 0.05583, 0.06295, 0.04250, 0.14912, 0.06695, 0.15920, 0.14472]),
  R: Object.freeze([0.03919, 0.05377, 0.04168, 0.04706, 0.07083, 0.06709, 0.03802, 0.05974, 0.06244, 0.09248, 0.10740, 0.10996, 0.21035]),
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null
const round = (value, digits = 3) => Number(value.toFixed(digits))

export function effectiveBatterSide(batSide, pitcherHand) {
  const side = String(batSide || '').toUpperCase()
  const hand = String(pitcherHand || '').toUpperCase()
  if (side === 'S') return hand === 'L' ? 'R' : 'L'
  return side === 'L' ? 'L' : 'R'
}

function normalizedFrequencies(values, fallback) {
  const candidate = Array.from({ length: ZONE_IDS.length }, (_, index) => {
    const value = finite(values?.[index])
    return value != null && value >= 0 ? value : 0
  })
  const sum = candidate.reduce((total, value) => total + value, 0)
  if (sum <= 0) return [...fallback]
  return candidate.map((value) => value / sum)
}

function weightedBatterBaseline(grid) {
  let weighted = 0
  let weight = 0
  const unweighted = []
  for (const cell of grid) {
    const iso = finite(cell?.iso)
    if (iso == null) continue
    unweighted.push(iso)
    const count = Math.max(0, finite(cell?.count) || 0)
    if (count > 0) {
      weighted += iso * count
      weight += count
    }
  }
  if (weight > 0) return weighted / weight
  if (unweighted.length > 0) return unweighted.reduce((sum, value) => sum + value, 0) / unweighted.length
  return null
}

function reliabilityFor({ sampleBIP, samplePitches, reliableStrikeCells, thresholds }) {
  if (sampleBIP < thresholds.minBatterBIP || samplePitches < thresholds.minPitcherPitches) {
    return {
      status: 'limited',
      label: 'Limited sample',
      reason: sampleBIP < thresholds.minBatterBIP
        ? `Batter split has ${sampleBIP} BIP; ${thresholds.minBatterBIP} required.`
        : `Pitcher split has ${samplePitches} pitches; ${thresholds.minPitcherPitches} required.`,
      reliableStrikeCells,
    }
  }
  if (reliableStrikeCells >= 6) {
    return { status: 'high', label: 'High reliability', reason: null, reliableStrikeCells }
  }
  if (reliableStrikeCells >= 3) {
    return { status: 'medium', label: 'Medium reliability', reason: null, reliableStrikeCells }
  }
  return {
    status: 'limited',
    label: 'Limited sample',
    reason: `Only ${reliableStrikeCells} strike-zone cells meet the ${thresholds.minCellBIP} BIP minimum.`,
    reliableStrikeCells,
  }
}

/**
 * Build a location matchup from two 13-cell grids.
 *
 * `leagueFrequencies` may be supplied from the warm pitcher cache. If it is
 * absent, the versioned handedness prior above is used. Strike-zone attacks
 * and chase opportunities are intentionally kept separate.
 */
export function buildZoneMatchup(batter, pitcher, options = {}) {
  if (!Array.isArray(batter?.grid) || !Array.isArray(pitcher?.grid)) return null

  const thresholds = { ...ZONE_THRESHOLDS, ...(options.thresholds || {}) }
  const effectiveSide = effectiveBatterSide(
    options.effectiveBatterSide || batter.effectiveSide || batter.stance || batter.batSide,
    pitcher.pitcherHand || options.pitcherHand,
  )
  const fallback = FALLBACK_ZONE_FREQUENCIES[effectiveSide] || FALLBACK_ZONE_FREQUENCIES.R
  const leagueFrequencies = normalizedFrequencies(options.leagueFrequencies, fallback)
  const baselineSource = options.baselineSource || (options.leagueFrequencies ? 'warm-cache' : 'versioned-fallback')
  const bGrid = Array.from({ length: ZONE_IDS.length }, (_, index) => batter.grid[index] || {})
  const pGrid = Array.from({ length: ZONE_IDS.length }, (_, index) => pitcher.grid[index] || {})
  const batterBaselineISO = weightedBatterBaseline(bGrid)
  const sampleBIP = Math.max(0, finite(batter.sampleBIP) || 0)
  const samplePitches = Math.max(0, finite(pitcher.samplePitches) || 0)
  const overallSampleQualified = sampleBIP >= thresholds.minBatterBIP
    && samplePitches >= thresholds.minPitcherPitches

  const cellEvidence = bGrid.map((bCell, index) => {
    const pCell = pGrid[index]
    const rawISO = finite(bCell?.iso)
    const batterCount = Math.max(0, finite(bCell?.count) || 0)
    const pitcherCount = Math.max(0, finite(pCell?.count) || 0)
    const pitcherFreq = finite(pCell?.freq)
    const leagueFreq = leagueFrequencies[index]
    const shrinkWeight = batterCount / (batterCount + thresholds.shrinkK)
    const adjustedISO = rawISO != null && batterBaselineISO != null
      ? rawISO * shrinkWeight + batterBaselineISO * (1 - shrinkWeight)
      : null
    const locationRatio = pitcherFreq != null && leagueFreq > 0 ? pitcherFreq / leagueFreq : null
    const sampleStatus = batterCount >= thresholds.minCellBIP
      ? 'reliable'
      : batterCount > 0 ? 'limited' : 'unavailable'
    const damage = adjustedISO == null ? 0 : clamp((adjustedISO - 0.15) / 0.25, 0, 1)
    const feed = locationRatio == null ? 0 : clamp((locationRatio - 1) / 0.75, 0, 1)
    const sample = clamp(batterCount / thresholds.minCellBIP, 0, 1)
    const attackScore = Math.round(100 * Math.sqrt(damage * feed) * sample)
    const qualified = overallSampleQualified
      && batterCount >= thresholds.minCellBIP
      && pitcherCount > 0
      && adjustedISO >= thresholds.minAdjustedISO
      && locationRatio >= thresholds.minLocationRatio
      && attackScore >= thresholds.minAttackScore
    const scope = index < STRIKE_ZONE_COUNT ? 'strike' : 'chase'

    return {
      index,
      zoneId: ZONE_IDS[index],
      scope,
      rawISO: rawISO == null ? null : round(rawISO),
      adjustedISO: adjustedISO == null ? null : round(adjustedISO),
      batterCount,
      pitcherFreq: pitcherFreq == null ? null : round(pitcherFreq, 4),
      pitcherCount,
      leagueFreq: round(leagueFreq, 4),
      locationRatio: locationRatio == null ? null : round(locationRatio, 2),
      attackScore,
      sampleStatus,
      qualified,
      qualifiesAs: qualified ? (scope === 'strike' ? 'attack' : 'chase') : null,
    }
  })

  const ranked = (scope, qualifiedOnly) => cellEvidence
    .filter((cell) => cell.scope === scope && (!qualifiedOnly || cell.qualified))
    .filter((cell) => cell.adjustedISO != null && cell.locationRatio != null && cell.batterCount > 0)
    .sort((a, b) => b.attackScore - a.attackScore || b.adjustedISO - a.adjustedISO)

  const attackZones = ranked('strike', true).slice(0, 3).map((cell) => cell.index)
  const chaseZones = ranked('chase', true).slice(0, 2).map((cell) => cell.index)
  const relativeZones = ranked('strike', false)
    .filter((cell) => !cell.qualified)
    .slice(0, 2)
    .map((cell) => cell.index)
  const reliableStrikeCells = cellEvidence
    .slice(0, STRIKE_ZONE_COUNT)
    .filter((cell) => cell.sampleStatus === 'reliable').length
  const reliability = reliabilityFor({ sampleBIP, samplePitches, reliableStrikeCells, thresholds })

  let pitcherWeighted = 0
  let pitcherWeight = 0
  let leagueWeighted = 0
  let leagueWeight = 0
  for (const cell of cellEvidence.slice(0, STRIKE_ZONE_COUNT)) {
    if (cell.adjustedISO == null || cell.pitcherFreq == null) continue
    pitcherWeighted += cell.adjustedISO * cell.pitcherFreq
    pitcherWeight += cell.pitcherFreq
    leagueWeighted += cell.adjustedISO * cell.leagueFreq
    leagueWeight += cell.leagueFreq
  }
  const deliveredISO = pitcherWeight > 0 ? pitcherWeighted / pitcherWeight : null
  const expectedISO = leagueWeight > 0 ? leagueWeighted / leagueWeight : null
  const zoneRating = deliveredISO != null && expectedISO != null
    ? round(clamp(5 + (deliveredISO - expectedISO) * 40, 0, 10), 1)
    : null
  const badge = reliability.status !== 'limited'
    && attackZones.length >= thresholds.minBadgeAttacks
    && zoneRating >= thresholds.minBadgeRating
      ? 'ZONE_MASTER'
      : null

  return {
    modelVersion: ZONE_MODEL_VERSION,
    advisoryOnly: true,
    batter: {
      id: batter.id ?? null,
      hand: batter.hand ?? null,
      effectiveSide,
      grid: bGrid,
      sampleBIP,
      season: batter.season,
    },
    pitcher: {
      id: pitcher.id ?? null,
      hand: pitcher.hand ?? null,
      pitcherHand: pitcher.pitcherHand ?? options.pitcherHand ?? null,
      vsHand: pitcher.vsHand ?? effectiveSide,
      grid: pGrid,
      samplePitches,
      season: pitcher.season,
    },
    attackZones,
    chaseZones,
    relativeZones,
    matchedZones: attackZones,
    cellEvidence,
    zoneRating,
    badge,
    reliability,
    batterBaselineISO: batterBaselineISO == null ? null : round(batterBaselineISO),
    deliveredISO: deliveredISO == null ? null : round(deliveredISO),
    expectedISO: expectedISO == null ? null : round(expectedISO),
    locationBaseline: {
      source: baselineSource,
      effectiveSide,
      samplePitches: Math.max(0, finite(options.baselineSamplePitches) || 0),
      frequencies: leagueFrequencies.map((value) => round(value, 5)),
    },
    thresholds,
    asOf: new Date().toISOString(),
  }
}
