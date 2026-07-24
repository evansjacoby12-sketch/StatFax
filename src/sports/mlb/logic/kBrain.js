// Canonical MLB starter-strikeout projection used by both the slate generator
// and the UI. Keep all K-distribution math here so a produced snapshot has the
// same contract and values as a client-side fallback projection.

const LEAGUE_K_PCT = 0.22
const BF_PER_IP = 4.3
const LEAGUE_WHIFF_PCT = 24.5
const LEAGUE_SWSTR_PCT = 11.0
const STAB_BF = 150
const RECENT_BATTER_K_PRIOR_PA = 60
const MAX_RECENT_BATTER_K_WEIGHT = 0.35
const MIN_PITCH_WHIFF_BATTERS = 5
const MIN_PITCH_WHIFF_COVERAGE = 0.50
const H2H_PRIOR_AB = 40
const MIN_H2H_AB = 10
const MIN_H2H_BATTERS = 2
const MIN_H2H_TOTAL_AB = 25

// Rechecked 2026-07-24 on 72 held-out v2 starts across four dates. v2 ran
// 0.446 K low and both Brier/RMSE selected a +8.5% scale. Apply only the
// guarded +5% step (0.86 × 1.05 = 0.903) because v3 also introduces
// lineup-aware opponent selection. The remaining gap must earn promotion on
// v3's final-pregame sample instead of being assumed from the v2 roster proxy.
export const K_CALIBRATION_PARENT = 0.86
export const K_CALIBRATION_SCALE = 1.05
export const K_CALIBRATION = 0.903
export const K_MODEL_VERSION = 4
export const K_LINES = [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

export function effSide(batSide, pitcherHand) {
  if (batSide === 'S') return pitcherHand === 'L' ? 'R' : 'L'
  return batSide || 'R'
}

export function orderPitcherGameLogs(splits) {
  const appearances = [...(splits || [])]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const startsOnly = appearances.filter((game) => (parseInt(game.stat?.gamesStarted, 10) || 0) > 0)
  return {
    appearances,
    starts: startsOnly.length ? startsOnly : appearances,
  }
}

function seasonPA(target) {
  const season = target?.season || {}
  return (Number(season.ab) || 0) + (Number(season.bb) || 0)
}

function stableTargetKey(target, index) {
  if (target?.playerId != null) return `player-${target.playerId}`
  if (target?.id != null) return `player-${target.id}`
  return `row-${index}`
}

function hasBattingOrder(target, field) {
  const value = Number(target?.[field])
  return Number.isInteger(value) && value >= 1 && value <= 9
}

function byOrderThenPA(a, b, field) {
  const aHasOrder = hasBattingOrder(a, field)
  const bHasOrder = hasBattingOrder(b, field)
  const aOrder = aHasOrder ? Number(a[field]) : null
  const bOrder = bHasOrder ? Number(b[field]) : null
  if (aHasOrder !== bHasOrder) return aHasOrder ? -1 : 1
  if (aHasOrder && aOrder !== bOrder) return aOrder - bOrder
  const paDiff = seasonPA(b) - seasonPA(a)
  if (paDiff) return paDiff
  return String(a?.playerId ?? a?.id ?? a?.name ?? '').localeCompare(
    String(b?.playerId ?? b?.id ?? b?.name ?? ''),
  )
}

/**
 * Select the nine batters a starter is actually expected to face.
 *
 * Confirmed batting orders win. Before lineups post, the most recent team
 * lineup is used and any missing/inactive slots are filled deterministically
 * from the current roster by season PA. The full-roster PA fallback is kept
 * intentionally deterministic so cron refreshes cannot shuffle a matchup.
 */
export function selectKBrainTargets(targets, { maxTargets = 9 } = {}) {
  const unique = []
  const seen = new Set()
  for (const [index, target] of (targets || []).entries()) {
    if (!target) continue
    const key = stableTargetKey(target, index)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(target)
  }

  const limit = Math.max(1, Math.floor(maxTargets))
  const confirmed = unique
    .filter((target) => target.lineupConfirmed === true && hasBattingOrder(target, 'battingOrder'))
    .sort((a, b) => byOrderThenPA(a, b, 'battingOrder'))

  if (confirmed.length) {
    const selected = confirmed.slice(0, limit)
    return {
      targets: selected,
      mode: 'confirmed',
      selected: selected.length,
      candidates: unique.length,
      coverage: Math.min(1, selected.length / limit),
      sourceGamePk: null,
      asOf: null,
    }
  }

  const projected = unique
    .filter((target) => hasBattingOrder(target, 'projectedBattingOrder'))
    .sort((a, b) => byOrderThenPA(a, b, 'projectedBattingOrder'))
  const selected = projected.slice(0, limit)
  const selectedKeys = new Set(selected.map((target, index) => stableTargetKey(target, index)))
  if (selected.length < limit) {
    const fallback = [...unique]
      .sort((a, b) => byOrderThenPA(a, b, 'projectedBattingOrder'))
      .filter((target, index) => !selectedKeys.has(stableTargetKey(target, index)))
    for (const target of fallback) {
      if (selected.length >= limit) break
      selected.push(target)
    }
  }

  if (projected.length) {
    return {
      targets: selected,
      mode: 'projected',
      selected: selected.length,
      candidates: unique.length,
      coverage: Math.min(1, projected.length / limit),
      sourceGamePk: projected.find((target) => target.lineupSourceGamePk != null)?.lineupSourceGamePk ?? null,
      asOf: projected.find((target) => target.lineupAsOf)?.lineupAsOf ?? null,
    }
  }

  const fallback = [...unique]
    .sort((a, b) => {
      const paDiff = seasonPA(b) - seasonPA(a)
      if (paDiff) return paDiff
      return String(a?.playerId ?? a?.id ?? a?.name ?? '').localeCompare(
        String(b?.playerId ?? b?.id ?? b?.name ?? ''),
      )
    })
    .slice(0, limit)
  return {
    targets: fallback,
    mode: 'roster-fallback',
    selected: fallback.length,
    candidates: unique.length,
    coverage: 0,
    sourceGamePk: null,
    asOf: null,
  }
}

function kRateFromLine(line) {
  const ab = Number(line?.ab) || 0
  const bb = Number(line?.bb) || 0
  const pa = ab + bb
  const k = Number(line?.k)
  return {
    pa,
    rate: pa > 0 && Number.isFinite(k) ? clamp(k / pa, 0.01, 0.60) : null,
  }
}

/**
 * Stabilize a batter's recent strikeout rate toward his season baseline.
 * The recent window can receive at most 35% of the weight, which keeps a hot
 * or cold two-week stretch from overpowering the larger season sample.
 */
export function stabilizedBatterKRate(batter) {
  const season = kRateFromLine(batter?.season)
  const recent = kRateFromLine(batter?.recent)
  const seasonRate = season.rate ?? LEAGUE_K_PCT
  if (recent.rate == null) {
    return {
      seasonRate,
      recentRate: null,
      recentPA: recent.pa,
      recentWeight: 0,
      rate: seasonRate,
    }
  }
  const recentWeight = Math.min(
    MAX_RECENT_BATTER_K_WEIGHT,
    (recent.pa / (recent.pa + RECENT_BATTER_K_PRIOR_PA)) * 0.50,
  )
  return {
    seasonRate,
    recentRate: recent.rate,
    recentPA: recent.pa,
    recentWeight,
    rate: seasonRate * (1 - recentWeight) + recent.rate * recentWeight,
  }
}

function batterPitchWhiffProfile(batter) {
  const rows = Array.isArray(batter?.pitchTypeSplits) ? batter.pitchTypeSplits : []
  let coveredUsage = 0
  let weightedWhiff = 0
  for (const row of rows) {
    const usage = Number(row?.usage)
    const whiff = Number(row?.whiff)
    if (!Number.isFinite(usage) || usage <= 0 || !Number.isFinite(whiff)) continue
    coveredUsage += usage
    weightedWhiff += whiff * usage
  }
  if (coveredUsage <= 0) return null
  return {
    whiffPct: weightedWhiff / coveredUsage,
    coverage: clamp(coveredUsage / 100, 0, 1),
  }
}

/**
 * Build lineup-specific K matchup inputs. Every adjustment is coverage-gated,
 * shrunk, and capped so it behaves as context around the core pitcher model.
 */
export function buildKMatchupInputs(targets) {
  const batters = (targets || []).filter(Boolean)
  const profiles = batters.map(stabilizedBatterKRate)
  const seasonRates = profiles.map((profile) => profile.seasonRate)
  const recentProfiles = profiles.filter((profile) => profile.recentRate != null && profile.recentPA >= 10)
  const oppSeasonK = seasonRates.length
    ? seasonRates.reduce((sum, rate) => sum + rate, 0) / seasonRates.length
    : LEAGUE_K_PCT
  const oppRecentK = profiles.length
    ? profiles.reduce((sum, profile) => sum + profile.rate, 0) / profiles.length
    : oppSeasonK
  const recentKCoverage = batters.length ? recentProfiles.length / batters.length : 0

  const pitchProfiles = batters.map(batterPitchWhiffProfile).filter(Boolean)
  const pitchWhiffCoverage = batters.length
    ? pitchProfiles.reduce((sum, profile) => sum + profile.coverage, 0) / batters.length
    : 0
  const pitchWhiffWeight = pitchProfiles.reduce((sum, profile) => sum + profile.coverage, 0)
  const pitchWhiffMatchup = pitchWhiffWeight > 0
    ? pitchProfiles.reduce((sum, profile) => sum + profile.whiffPct * profile.coverage, 0) / pitchWhiffWeight
    : null
  const pitchWhiffQualified = pitchProfiles.length >= MIN_PITCH_WHIFF_BATTERS
    && pitchWhiffCoverage >= MIN_PITCH_WHIFF_COVERAGE
    && Number.isFinite(pitchWhiffMatchup)
  const pitchWhiffAdj = pitchWhiffQualified
    ? clamp(1 + ((pitchWhiffMatchup - LEAGUE_WHIFF_PCT) / LEAGUE_WHIFF_PCT) * 0.15, 0.96, 1.04)
    : 1

  const h2hProfiles = batters.map((batter, index) => {
    const ab = Number(batter?.h2h?.ab)
    const k = Number(batter?.h2h?.k)
    if (!Number.isFinite(ab) || ab < MIN_H2H_AB || !Number.isFinite(k)) return null
    const priorRate = profiles[index]?.rate ?? LEAGUE_K_PCT
    return {
      ab,
      rate: (clamp(k / ab, 0, 1) * ab + priorRate * H2H_PRIOR_AB) / (ab + H2H_PRIOR_AB),
      priorRate,
    }
  }).filter(Boolean)
  const h2hSample = h2hProfiles.reduce((sum, profile) => sum + profile.ab, 0)
  const h2hKRate = h2hProfiles.length
    ? h2hProfiles.reduce((sum, profile) => sum + profile.rate * profile.ab, 0) / h2hSample
    : null
  const h2hPriorRate = h2hProfiles.length
    ? h2hProfiles.reduce((sum, profile) => sum + profile.priorRate * profile.ab, 0) / h2hSample
    : null
  const h2hQualified = h2hProfiles.length >= MIN_H2H_BATTERS
    && h2hSample >= MIN_H2H_TOTAL_AB
    && Number.isFinite(h2hKRate)
    && Number.isFinite(h2hPriorRate)
  const h2hCoverage = batters.length ? h2hProfiles.length / batters.length : 0
  const h2hKAdj = h2hQualified
    ? clamp(1 + ((h2hKRate - h2hPriorRate) / LEAGUE_K_PCT) * 0.20 * h2hCoverage, 0.98, 1.02)
    : 1
  const matchupAdj = clamp(pitchWhiffAdj * h2hKAdj, 0.94, 1.06)

  return {
    oppSeasonK,
    oppRecentK,
    recentKCoverage,
    pitchWhiffMatchup,
    pitchWhiffCoverage,
    pitchWhiffBatters: pitchProfiles.length,
    pitchWhiffAdj,
    h2hKRate,
    h2hKAdj,
    h2hSample,
    h2hBatters: h2hProfiles.length,
    matchupAdj,
  }
}

function poissonCDF(k, lambda) {
  if (lambda <= 0) return 1
  let sum = 0
  let term = Math.exp(-lambda)
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += term
    term *= lambda / (i + 1)
  }
  return Math.min(1, sum)
}

export function kOverProb(lambda, line) {
  if (!Number.isFinite(lambda) || lambda <= 0) return null
  return 1 - poissonCDF(Math.floor(line), lambda)
}

function findPoiQuantile(lambda, probability) {
  let k = Math.max(0, Math.round(lambda - 3))
  while (poissonCDF(k, lambda) < probability && k < 30) k++
  return k
}

const WHIFF_LIFT = { sl: 0.012, st: 0.015, cu: 0.010, kc: 0.010, ch: 0.009, fs: 0.011 }

function pitchMixKBoost(pitchMix) {
  if (!pitchMix) return 0
  let boost = 0
  for (const [code, lift] of Object.entries(WHIFF_LIFT)) {
    const raw = Number(pitchMix[`${code}Pct`] ?? 0)
    const pct = raw > 1.5 ? raw / 100 : raw
    boost += pct * lift
  }
  return Math.min(0.04, boost)
}

function temperatureAdjustment(weather) {
  if (!weather || weather.roofClosed) return 1
  const tempF = weather.tempF
  if (!Number.isFinite(tempF)) return 1
  return Math.max(0.92, Math.min(1.08, 1 + (tempF - 72) * 0.003))
}

function umpireKAdjustment(umpire) {
  const kFactor = umpire?.kFactor
  if (Number.isFinite(kFactor)) return Math.max(0.92, Math.min(1.08, kFactor))
  const hrFactor = umpire?.hrFactor
  if (!Number.isFinite(hrFactor)) return 1
  return Math.max(0.92, Math.min(1.08, 1 + (1 - hrFactor) * 0.15))
}

/**
 * Project a starter's full strikeout distribution.
 *
 * @returns {null|{
 *   k:number, lo:number, hi:number, lambda:number, probs:Object,
 *   expIP:number, expBF:number, ipSD:number, volumeSource:string,
 *   oppK:number, oppRecentK:number, recentKCoverage:number,
 *   pitchWhiffMatchup:number|null, pitchWhiffCoverage:number,
 *   pitchWhiffAdj:number, h2hKRate:number|null, h2hKAdj:number,
 *   h2hSample:number, matchupAdj:number, trend:string, conf:string,
 *   boost:number, splitKRate:number|null, swStrPct:number|null,
 *   whiffPct:number|null, tempAdj:number, umpireAdj:number,
 *   parkKAdj:number, tttoPenalty:number, vegasTrim:number,
 *   adjustedKRate:number, calibration:number, calibrationScale:number,
 *   calibrationBasis:string, modelVersion:number,
 *   tempF:number|null
 * }}
 */
export function kBrain(pitcher, targets, { weather, umpire, parkFactorK } = {}) {
  const season = pitcher?.season || {}
  const lineup = selectKBrainTargets(targets)
  const selectedTargets = lineup.targets
  const matchup = buildKMatchupInputs(selectedTargets)

  let seasonKRate = season.bf > 0 && Number.isFinite(season.k)
    ? season.k / season.bf
    : Number.isFinite(season.kPer9)
      ? (season.kPer9 / 9) / BF_PER_IP
      : null

  const vl = pitcher?.splits?.vl
  const vr = pitcher?.splits?.vr
  const vlKRate = vl?.kPct != null && Number.isFinite(vl.kPct) ? vl.kPct / 100 : null
  const vrKRate = vr?.kPct != null && Number.isFinite(vr.kPct) ? vr.kPct / 100 : null

  let splitKRate = null
  if (seasonKRate != null && (vlKRate != null || vrKRate != null)) {
    const stabVl = vlKRate != null
      ? Number.isFinite(vl?.bf) && vl.bf < STAB_BF
        ? (vlKRate * vl.bf + seasonKRate * STAB_BF) / (vl.bf + STAB_BF)
        : vlKRate
      : seasonKRate
    const stabVr = vrKRate != null
      ? Number.isFinite(vr?.bf) && vr.bf < STAB_BF
        ? (vrKRate * vr.bf + seasonKRate * STAB_BF) / (vr.bf + STAB_BF)
        : vrKRate
      : seasonKRate

    const leagueOdds = LEAGUE_K_PCT / (1 - LEAGUE_K_PCT)
    const perBatterK = selectedTargets.map((batter) => {
      const side = effSide(batter.batSide, pitcher?.hand)
      const pitcherK = Math.min(0.99, side === 'L' ? stabVl : stabVr)
      const batterK = clamp(stabilizedBatterKRate(batter).rate, 0.01, 0.60)
      const matchupOdds = (pitcherK / (1 - pitcherK)) * (batterK / (1 - batterK)) / leagueOdds
      return matchupOdds / (1 + matchupOdds)
    })
    if (perBatterK.length) {
      splitKRate = perBatterK.reduce((sum, rate) => sum + rate, 0) / perBatterK.length
    }
  }

  if (seasonKRate == null && splitKRate == null) return null
  if (seasonKRate == null) seasonKRate = splitKRate

  const recentForm = pitcher?.recentForm
  const recentStarts = (recentForm?.recentStarts || [])
    .filter((start) => Number.isFinite(start.ip) && start.ip > 0)

  let recentKRate = null
  if (recentStarts.length >= 2) {
    const rates = recentStarts.slice(0, 6).map((start) => {
      const bf = start.bf ?? (start.ip * BF_PER_IP)
      return bf > 0 && Number.isFinite(start.k) ? start.k / bf : null
    }).filter((rate) => rate != null)
    if (rates.length) recentKRate = rates.reduce((sum, rate) => sum + rate, 0) / rates.length
  } else if (Number.isFinite(recentForm?.k9)) {
    recentKRate = (recentForm.k9 / 9) / BF_PER_IP
  }

  let baseKRate
  if (splitKRate != null) {
    baseKRate = recentKRate != null ? splitKRate * 0.55 + recentKRate * 0.45 : splitKRate
  } else {
    baseKRate = recentKRate != null ? seasonKRate * 0.60 + recentKRate * 0.40 : seasonKRate
  }

  const swStrPct = pitcher?.savant?.swStrPct
  const whiffPct = pitcher?.savant?.whiffPct
  let kRate = baseKRate
  if (Number.isFinite(swStrPct)) {
    kRate = baseKRate * (1 + ((swStrPct - LEAGUE_SWSTR_PCT) / LEAGUE_SWSTR_PCT) * 0.30)
  } else if (Number.isFinite(whiffPct)) {
    kRate = baseKRate * (1 + ((whiffPct - LEAGUE_WHIFF_PCT) / LEAGUE_WHIFF_PCT) * 0.25)
  }
  kRate = Math.min(0.45, kRate)

  const hasMissMetric = Number.isFinite(swStrPct) || Number.isFinite(whiffPct)
  const boost = hasMissMetric ? 0 : pitchMixKBoost(pitcher?.pitchMix)
  const adjustedKRate = kRate + boost

  const oppK = matchup.oppSeasonK
  const oppAdj = clamp(matchup.oppRecentK / LEAGUE_K_PCT, 0.82, 1.22)

  const vegasTrim = matchup.oppRecentK < 0.185 ? 0.95 : 1.0
  const recentSix = recentStarts.slice(0, 6)
  const pitchVolumeStarts = recentSix.filter((start) => (
    Number.isFinite(start.pitches) && start.pitches > 50 && Number.isFinite(start.bf) && start.bf > 0
  ))

  let expIP
  let ipSD
  let expBF
  let volumeSource
  if (pitchVolumeStarts.length >= 2) {
    const avgPitches = pitchVolumeStarts.reduce((sum, start) => sum + start.pitches, 0) / pitchVolumeStarts.length
    const avgBF = pitchVolumeStarts.reduce((sum, start) => sum + start.bf, 0) / pitchVolumeStarts.length
    const pitchesPerBF = Math.max(3.5, Math.min(4.5, avgPitches / avgBF))
    expBF = Math.max(3.5 * BF_PER_IP, Math.min(7.5 * BF_PER_IP, (avgPitches * vegasTrim) / pitchesPerBF))
    expIP = expBF / BF_PER_IP
    ipSD = 0.8
    volumeSource = 'recent-pitches-bf'
  } else {
    const ipValues = recentSix.map((start) => start.ip).filter(Number.isFinite)
    if (ipValues.length >= 2) {
      expIP = ipValues.reduce((sum, value) => sum + value, 0) / ipValues.length
      const variance = ipValues.reduce((sum, value) => sum + (value - expIP) ** 2, 0) / ipValues.length
      ipSD = Math.sqrt(variance)
      volumeSource = 'recent-ip'
    } else {
      expIP = Number.isFinite(recentForm?.ip) && recentForm?.games > 0
        ? recentForm.ip / recentForm.games
        : 5.3
      ipSD = 1.2
      volumeSource = 'season-ip'
    }
    expIP = Math.max(3.5, Math.min(7.5, expIP))
    expBF = Math.max(3.5 * BF_PER_IP, Math.min(7.5 * BF_PER_IP, expIP * BF_PER_IP * vegasTrim))
  }

  const pitchMix = pitcher?.pitchMix
  const pitchDiversity = pitchMix
    ? ['ffPct', 'siPct', 'fcPct', 'slPct', 'stPct', 'svPct', 'cuPct', 'kcPct', 'chPct', 'fsPct', 'knPct']
      .filter((field) => (pitchMix[field] ?? 0) >= 10).length
    : 2
  const tttoRate = pitchDiversity >= 4 ? 0.096 : pitchDiversity <= 2 ? 0.144 : 0.12
  const tttoBF = Math.max(0, expBF - 18)
  const tttoPenalty = expBF > 0 ? 1 - (tttoBF * tttoRate / expBF) : 1

  const tempAdj = temperatureAdjustment(weather)
  let umpireAdj = umpireKAdjustment(umpire)
  const umpireZone = umpire?.zoneStyle
  if (umpireZone && pitchMix) {
    const fastballPct = ((pitchMix.ffPct ?? 0) + (pitchMix.siPct ?? 0) + (pitchMix.fcPct ?? 0)) / 100
    const breakingPct = ((pitchMix.slPct ?? 0) + (pitchMix.stPct ?? 0) + (pitchMix.svPct ?? 0) + (pitchMix.cuPct ?? 0) + (pitchMix.kcPct ?? 0)) / 100
    let zoneInteraction = 1
    if (umpireZone === 'high' && fastballPct > 0.40) zoneInteraction = 1 + (fastballPct - 0.40) * 0.08
    else if (umpireZone === 'low' && breakingPct > 0.25) zoneInteraction = 1 + (breakingPct - 0.25) * 0.08
    else if (umpireZone === 'wide') zoneInteraction = 1.015
    umpireAdj = Math.min(1.12, umpireAdj * zoneInteraction)
  }

  const rawParkFactor = Number.isFinite(parkFactorK) ? parkFactorK : pitcher?.gameParkKFactor
  const parkKAdj = Number.isFinite(rawParkFactor) && rawParkFactor > 0 ? rawParkFactor : 1
  const lambda = expBF * adjustedKRate * oppAdj * matchup.matchupAdj
    * tempAdj * umpireAdj * parkKAdj * tttoPenalty * K_CALIBRATION

  const probs = {}
  for (const line of K_LINES) probs[line] = kOverProb(lambda, line)

  let trend = 'flat'
  if (recentStarts.length >= 4) {
    const recentRates = recentSix.map((start) => {
      const bf = start.bf ?? (start.ip * BF_PER_IP)
      return bf > 0 && Number.isFinite(start.k) ? start.k / bf : null
    }).filter((rate) => rate != null)
    if (recentRates.length >= 4) {
      const newest = recentRates.slice(0, 3).reduce((sum, rate) => sum + rate, 0) / 3
      const older = recentRates.slice(3)
      const prior = older.reduce((sum, rate) => sum + rate, 0) / older.length
      if (newest > prior * 1.07) trend = 'up'
      else if (newest < prior * 0.93) trend = 'down'
    }
  }

  let conf = recentStarts.length >= 4 && season.bf >= 100
    ? 'high'
    : recentStarts.length >= 2 || season.bf >= 50
      ? 'med'
      : 'low'
  const lineupUncertain = lineup.candidates >= 9 && (
    lineup.mode === 'roster-fallback'
    || lineup.selected < 8
    || (lineup.mode === 'projected' && lineup.coverage < (2 / 3))
  )
  if (lineupUncertain) conf = conf === 'high' ? 'med' : 'low'

  return {
    k: lambda,
    lo: Math.max(0, findPoiQuantile(lambda, 0.10)),
    hi: findPoiQuantile(lambda, 0.90),
    lambda,
    probs,
    expIP,
    expBF,
    ipSD,
    volumeSource,
    oppK,
    oppRecentK: matchup.oppRecentK,
    recentKCoverage: matchup.recentKCoverage,
    pitchWhiffMatchup: matchup.pitchWhiffMatchup,
    pitchWhiffCoverage: matchup.pitchWhiffCoverage,
    pitchWhiffBatters: matchup.pitchWhiffBatters,
    pitchWhiffAdj: matchup.pitchWhiffAdj,
    h2hKRate: matchup.h2hKRate,
    h2hKAdj: matchup.h2hKAdj,
    h2hSample: matchup.h2hSample,
    h2hBatters: matchup.h2hBatters,
    matchupAdj: matchup.matchupAdj,
    trend,
    conf,
    boost,
    splitKRate,
    swStrPct: swStrPct ?? null,
    whiffPct: whiffPct ?? null,
    tempAdj,
    umpireAdj,
    parkKAdj,
    tttoPenalty,
    vegasTrim,
    adjustedKRate,
    calibration: K_CALIBRATION,
    calibrationScale: K_CALIBRATION_SCALE,
    calibrationBasis: 'v2-heldout-72-guarded-step-plus-v4-matchup',
    modelVersion: K_MODEL_VERSION,
    tempF: weather?.tempF ?? null,
    lineupMode: lineup.mode,
    lineupSize: lineup.selected,
    lineupCandidates: lineup.candidates,
    lineupCoverage: lineup.coverage,
    lineupSourceGamePk: lineup.sourceGamePk,
    lineupAsOf: lineup.asOf,
  }
}

export function estimatedKs(pitcher, targets) {
  return kBrain(pitcher, targets)
}
