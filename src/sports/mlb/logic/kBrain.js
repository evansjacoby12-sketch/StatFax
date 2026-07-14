// Canonical MLB starter-strikeout projection used by both the slate generator
// and the UI. Keep all K-distribution math here so a produced snapshot has the
// same contract and values as a client-side fallback projection.

const LEAGUE_K_PCT = 0.22
const BF_PER_IP = 4.3
const LEAGUE_WHIFF_PCT = 24.5
const LEAGUE_SWSTR_PCT = 11.0
const STAB_BF = 150

// Rechecked 2026-07-14: the 211-start tracker remained +0.53 K high, including
// +0.50 across 56 starts after the prior 0.92 recenter. A 0.86 factor removes
// most of that persistent bias without applying the small-sample optimum (~0.83).
export const K_CALIBRATION = 0.86
export const K_MODEL_VERSION = 2
export const K_LINES = [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]

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
 *   oppK:number, trend:string, conf:string,
 *   boost:number, splitKRate:number|null, swStrPct:number|null,
 *   whiffPct:number|null, tempAdj:number, umpireAdj:number,
 *   parkKAdj:number, tttoPenalty:number, vegasTrim:number,
 *   adjustedKRate:number, calibration:number, modelVersion:number,
 *   tempF:number|null
 * }}
 */
export function kBrain(pitcher, targets, { weather, umpire, parkFactorK } = {}) {
  const season = pitcher?.season || {}

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
    const perBatterK = (targets || []).map((batter) => {
      const side = effSide(batter.batSide, pitcher?.hand)
      const pitcherK = Math.min(0.99, side === 'L' ? stabVl : stabVr)
      const batterSeason = batter.season
      const pa = (batterSeason?.ab || 0) + (batterSeason?.bb || 0)
      const batterK = Math.min(0.99, pa > 0 ? (batterSeason?.k || 0) / pa : LEAGUE_K_PCT)
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

  const opponentRates = (targets || []).map((batter) => {
    const batterSeason = batter.season
    if (!batterSeason || !(batterSeason.ab > 0)) return null
    const pa = (batterSeason.ab || 0) + (batterSeason.bb || 0)
    return pa > 0 ? (batterSeason.k || 0) / pa : null
  }).filter((rate) => rate != null)
  const oppK = opponentRates.length
    ? opponentRates.reduce((sum, rate) => sum + rate, 0) / opponentRates.length
    : LEAGUE_K_PCT
  const oppAdj = Math.max(0.82, Math.min(1.22, oppK / LEAGUE_K_PCT))

  const vegasTrim = oppK < 0.185 ? 0.95 : 1.0
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
    ? ['ffPct', 'siPct', 'fcPct', 'slPct', 'cuPct', 'kcPct', 'chPct', 'fsPct']
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
    const breakingPct = ((pitchMix.slPct ?? 0) + (pitchMix.cuPct ?? 0) + (pitchMix.kcPct ?? 0)) / 100
    let zoneInteraction = 1
    if (umpireZone === 'high' && fastballPct > 0.40) zoneInteraction = 1 + (fastballPct - 0.40) * 0.08
    else if (umpireZone === 'low' && breakingPct > 0.25) zoneInteraction = 1 + (breakingPct - 0.25) * 0.08
    else if (umpireZone === 'wide') zoneInteraction = 1.015
    umpireAdj = Math.min(1.12, umpireAdj * zoneInteraction)
  }

  const rawParkFactor = Number.isFinite(parkFactorK) ? parkFactorK : pitcher?.gameParkKFactor
  const parkKAdj = Number.isFinite(rawParkFactor) && rawParkFactor > 0 ? rawParkFactor : 1
  const lambda = expBF * adjustedKRate * oppAdj * tempAdj * umpireAdj * parkKAdj * tttoPenalty * K_CALIBRATION

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

  const conf = recentStarts.length >= 4 && season.bf >= 100
    ? 'high'
    : recentStarts.length >= 2 || season.bf >= 50
      ? 'med'
      : 'low'

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
    modelVersion: K_MODEL_VERSION,
    tempF: weather?.tempF ?? null,
  }
}

export function estimatedKs(pitcher, targets) {
  return kBrain(pitcher, targets)
}
