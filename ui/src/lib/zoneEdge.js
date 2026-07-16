// Shared zone/arsenal edge math — used by BOTH the full Zone view and the
// drawer's Zone teaser so they always show the same numbers (they drifted apart
// once the full view gained an Arsenal rating; this keeps them locked together).

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
  return z?.zoneRating != null ? Math.max(0, Math.min(5, Math.round((z.zoneRating / 2) * 10) / 10)) : null
}

// Headline edge = the stronger of location vs arsenal, so the real edge shows
// even when one lens is flat. Null when neither is available.
export function combinedEdge5(b) {
  const vals = [locationRating5(b?.zoneMatchup), arsenalRating5(b)].filter((v) => v != null)
  return vals.length ? Math.max(...vals) : null
}
