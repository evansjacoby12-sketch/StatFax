export const ZONE_POWER_VERSION = 1
export const ZONE_POWER_MIN_HARD_HIT_PCT = 40
export const ZONE_POWER_MAX_LOGIT_DELTA = 0.2
export const ZONE_POWER_PROBABILITY_CEILING = 0.45

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const round = (value, digits = 6) => Number(Number(value).toFixed(digits))
const clamp = (value, low, high) => Math.max(low, Math.min(high, value))

function evidenceOf(row) {
  const live = row?.zoneMatchup
  if (live) {
    return {
      modelVersion: Number(live.modelVersion) || 0,
      advisoryOnly: live.advisoryOnly === true,
      attackCount: clamp(Math.trunc(Number(live.attackZones?.length) || 0), 0, 3),
      reliability: live.reliability?.status || 'limited',
      zoneRating: finite(live.zoneRating) ? Number(live.zoneRating) : 5,
    }
  }

  const archived = row?.zoneEvidence
  if (archived) {
    return {
      modelVersion: Number(archived.modelVersion) || 0,
      advisoryOnly: archived.advisoryOnly === true,
      attackCount: clamp(Math.trunc(Number(archived.attackCount) || 0), 0, 3),
      reliability: archived.reliability || 'limited',
      zoneRating: finite(archived.zoneRating) ? Number(archived.zoneRating) : 5,
    }
  }

  return null
}

function hardHitPctOf(row) {
  if (finite(row?.hardHitPct)) return Number(row.hardHitPct)
  if (finite(row?.feat?.hh)) return Number(row.feat.hh)
  return null
}

/**
 * A production zone boost needs two independent ingredients: reliable verified
 * location attacks and established contact quality. Raw zone evidence remains
 * advisory; only this bounded collision is allowed into the headline HR rate.
 */
export function zonePowerQualification(row) {
  const evidence = evidenceOf(row)
  const hardHitPct = hardHitPctOf(row)
  const base = {
    qualified: false,
    reason: 'missing-zone-evidence',
    attackCount: evidence?.attackCount || 0,
    reliability: evidence?.reliability || 'limited',
    hardHitPct: finite(hardHitPct) ? round(hardHitPct, 1) : null,
    zoneRating: evidence ? round(clamp(evidence.zoneRating, 0, 10), 1) : null,
  }

  if (!evidence || evidence.modelVersion < 2 || evidence.advisoryOnly !== true) return base
  if (!['high', 'medium'].includes(evidence.reliability)) return { ...base, reason: 'limited-zone-reliability' }
  if (evidence.attackCount < 1) return { ...base, reason: 'no-verified-attack-zone' }
  if (!finite(hardHitPct)) return { ...base, reason: 'missing-hard-hit-rate' }
  if (hardHitPct < ZONE_POWER_MIN_HARD_HIT_PCT) return { ...base, reason: 'hard-hit-below-gate' }
  return { ...base, qualified: true, reason: 'qualified' }
}

export function zonePowerLogitDelta(row) {
  const qualification = zonePowerQualification(row)
  if (!qualification.qualified) return 0
  const ratingTilt = clamp((qualification.zoneRating - 5) * 0.012, -0.03, 0.04)
  return round(clamp(qualification.attackCount * 0.06 + ratingTilt, 0, ZONE_POWER_MAX_LOGIT_DELTA))
}

export function applyLogitProbabilityDelta(probability, logitDelta) {
  if (!finite(probability) || Number(probability) <= 0 || Number(probability) >= 1) return null
  if (!finite(logitDelta) || Number(logitDelta) < 0) return null
  const probabilityN = clamp(Number(probability), 1e-9, 1 - 1e-9)
  const logit = Math.log(probabilityN / (1 - probabilityN))
  return round(1 / (1 + Math.exp(-(logit + Number(logitDelta)))))
}

/** Mutates only hrProbability and the auditable zonePowerCollision metadata. */
export function applyZonePowerProbabilityInflation(row) {
  if (
    row?.zonePowerCollision?.version === ZONE_POWER_VERSION &&
    row.zonePowerCollision.applied === true &&
    Number(row.hrProbability) === Number(row.zonePowerCollision.inflatedProbability)
  ) return row.zonePowerCollision

  const qualification = zonePowerQualification(row)
  const baselineProbability = Number(row?.hrProbability)
  const logitDelta = zonePowerLogitDelta(row)

  if (!qualification.qualified || !finite(baselineProbability) || baselineProbability <= 0 || baselineProbability >= 1 || logitDelta <= 0) {
    return { ...qualification, applied: false, logitDelta: 0 }
  }

  const rawInflated = applyLogitProbabilityDelta(baselineProbability, logitDelta)
  const inflatedProbability = round(clamp(rawInflated, 0.005, ZONE_POWER_PROBABILITY_CEILING))
  if (!(inflatedProbability > baselineProbability)) {
    return { ...qualification, applied: false, reason: 'probability-ceiling', logitDelta }
  }

  const collision = {
    version: ZONE_POWER_VERSION,
    applied: true,
    scoreImpact: false,
    probabilityImpact: true,
    attackCount: qualification.attackCount,
    reliability: qualification.reliability,
    hardHitPct: qualification.hardHitPct,
    zoneRating: qualification.zoneRating,
    logitDelta,
    baselineProbability: round(baselineProbability),
    inflatedProbability,
  }
  row.hrProbability = inflatedProbability
  row.zonePowerCollision = collision
  return collision
}
