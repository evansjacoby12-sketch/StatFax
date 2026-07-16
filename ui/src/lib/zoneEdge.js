// Shared location and arsenal research helpers. These are separate lenses:
// neither is allowed to hide weakness in the other, and neither changes the
// production HR projection.

import { MIN_PITCH_MIX_COVERED_USAGE, pitchLeagueSlg } from './scout.js'

const PITCH_CODES = ['ff', 'si', 'fc', 'sl', 'st', 'sv', 'cu', 'kc', 'ch', 'fs', 'kn']
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

// Pitch-arsenal edge on the 0–5 scale: usage-weighted (batter SLG − league SLG)
// across the pitcher's mix, mapped so a big positive SLG edge → 5. Only counts
// pitches the batter actually has a book on. Null when nothing is covered.
export function arsenalRating5(b) {
  const mix = b?.pitchMix || {}
  const arsenal = b?.arsenal || {}
  let wSum = 0, eSum = 0
  for (const code of PITCH_CODES) {
    const usage = mix[`${code}Pct`]
    const slg = arsenal[`${code}Slg`]
    if (!(usage > 0) || !Number.isFinite(slg)) continue
    const league = pitchLeagueSlg({ key: code, leagueSlg: arsenal.leagueSlg?.[code] })
    const w = usage / 100
    eSum += w * (slg - league)
    wSum += w
  }
  if (wSum * 100 < MIN_PITCH_MIX_COVERED_USAGE) return null
  return +clamp(2.5 + (eSum / wSum) * 15, 0, 5).toFixed(1)
}

// Location rating (0–5) from the server's 0–10 zoneRating.
export function locationRating5(z) {
  return Number.isFinite(z?.zoneRating)
    ? Math.max(0, Math.min(5, Math.round((z.zoneRating / 2) * 10) / 10))
    : null
}

export function verifiedAttackCount(z) {
  if ((z?.modelVersion ?? 0) < 2) return 0
  return Array.isArray(z?.attackZones) ? z.attackZones.length : 0
}

export function hasVerifiedZoneEdge(z) {
  return (z?.modelVersion ?? 0) >= 2
    && z?.advisoryOnly === true
    && z?.reliability?.status !== 'limited'
    && verifiedAttackCount(z) >= 2
    && Number.isFinite(z?.zoneRating)
    && z.zoneRating >= 6.5
}
