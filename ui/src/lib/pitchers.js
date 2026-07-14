// Group the slate's batters by the opposing STARTER they face, producing one
// entry per pitcher with his vulnerability and the lineup ranked as HR targets.
// Takes the already-filtered batter list, so the board's filters (game, search,
// grade, …) narrow the pool naturally.

import { pitcherVulnerability } from './vulnerability.js'
import {
  K_LINES,
  effSide,
  estimatedKs,
  kBrain,
  kOverProb,
} from '../../../src/sports/mlb/logic/kBrain.js'

export { K_LINES, effSide, estimatedKs, kBrain, kOverProb }

// The actionable K Brain output is the expected strikeout total. The model's
// lo/hi values are uncertainty bounds, not the projection itself. Accept both
// live distribution objects and frozen result rows for backward compatibility.
export function projectedK(value) {
  if (Number.isFinite(value)) return value
  if (!value || typeof value !== 'object') return null
  if (Number.isFinite(value.k)) return value.k
  if (Number.isFinite(value.lambda)) return value.lambda
  if (Number.isFinite(value.estK)) return value.estK
  if (Number.isFinite(value.lo) && Number.isFinite(value.hi)) return (value.lo + value.hi) / 2
  return null
}

export function summarizeKProjectionResults(rows, within = 1) {
  let n = 0
  let absoluteError = 0
  let withinCount = 0
  for (const row of rows || []) {
    const projection = projectedK(row)
    if (!Number.isFinite(projection) || !Number.isFinite(row?.actualK)) continue
    const error = Math.abs(row.actualK - projection)
    n++
    absoluteError += error
    if (error <= within) withinCount++
  }
  return {
    n,
    mae: n ? absoluteError / n : null,
    within,
    withinCount,
  }
}

// Effective batter side vs this arm — a switch hitter bats opposite the pitcher.
// Which batter hand to attack with = the side the starter allows more HR/9 to.
export function attackSideFor(pitcher) {
  const lH = pitcher?.splits?.vl?.hrPer9
  const rH = pitcher?.splits?.vr?.hrPer9
  if (lH != null && rH != null) return lH >= rH ? 'L' : 'R'
  if (lH != null) return 'L'
  if (rH != null) return 'R'
  return null
}

export function groupPitchers(batters, kDistByPitcher = {}) {
  const map = new Map()
  for (const b of batters || []) {
    const p = b.pitcher
    if (!p || p.id == null) continue
    // Key on pitcher + game so a doubleheader (same arm, two gamePks) stays split.
    const key = `${p.id}-${b.gamePk}`
    let entry = map.get(key)
    if (!entry) {
      entry = {
        key,
        id: p.id,
        pitcher: p,
        gamePk: b.gamePk,
        game: b.game || null,
        // The pitcher plays for the team opposing the batters facing him.
        team: b.opponent || null,
        targets: [],
      }
      map.set(key, entry)
    }
    entry.targets.push(b)
  }

  const list = [...map.values()].map((e) => {
    e.vuln = pitcherVulnerability(e.pitcher)
    e.attackSide = attackSideFor(e.pitcher)
    // Bump batters on the attack side (+0.012 effective HR%) — enough to jump
    // them past similar bats on the wrong side without leapfrogging clearly
    // better targets. The model's own platoonAdj already nudges the score; this
    // makes the platoon edge explicit in the target order.
    const boost = (b) =>
      e.attackSide && effSide(b.batSide, e.pitcher.hand) === e.attackSide ? 0.012 : 0
    e.targets.sort(
      (a, b) =>
        (b.hrProbability ?? 0) + boost(b) - ((a.hrProbability ?? 0) + boost(a)) ||
        (b.score ?? 0) - (a.score ?? 0) ||
        (a.battingOrder ?? 99) - (b.battingOrder ?? 99) ||
        (a.playerId ?? 0) - (b.playerId ?? 0), // stable final key — no shuffle on full ties
    )
    e.topProb = e.targets[0]?.hrProbability ?? 0
    e.estK = kDistByPitcher[e.key] ?? estimatedKs(e.pitcher, e.targets)
    return e
  })

  // Most vulnerable first; tie-break by the single best target's HR probability.
  list.sort((a, b) => (b.vuln?.score ?? 0) - (a.vuln?.score ?? 0) || b.topProb - a.topProb)
  return list
}

// Pitch-type code → display label. Covers the Statcast families the slate emits.
export const PITCH_LABELS = {
  ff: '4-Seam',
  si: 'Sinker',
  fc: 'Cutter',
  sl: 'Slider',
  st: 'Sweeper',
  cu: 'Curve',
  kc: 'Knuckle-Curve',
  sv: 'Slurve',
  ch: 'Change',
  fs: 'Splitter',
  fo: 'Forkball',
}

// Build a sorted, display-ready pitch-usage list from pitcher.pitchMix. Handles
// both 0–1 fractions and 0–100 percentages by normalizing the whole set.
export function pitchUsage(pitchMix) {
  if (!pitchMix) return []
  const raw = Object.keys(PITCH_LABELS)
    .map((code) => ({ code, label: PITCH_LABELS[code], pct: Number(pitchMix[`${code}Pct`]) }))
    .filter((x) => Number.isFinite(x.pct) && x.pct > 0)
  const sum = raw.reduce((s, x) => s + x.pct, 0)
  const toPct = sum > 0 && sum <= 1.5 ? (x) => x * 100 : (x) => x // fractions → %
  return raw.map((x) => ({ ...x, pct: toPct(x.pct) })).sort((a, b) => b.pct - a.pct)
}
