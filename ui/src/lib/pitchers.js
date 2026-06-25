// Group the slate's batters by the opposing STARTER they face, producing one
// entry per pitcher with his vulnerability and the lineup ranked as HR targets.
// Takes the already-filtered batter list, so the board's filters (game, search,
// grade, …) narrow the pool naturally.

import { pitcherVulnerability } from './vulnerability.js'

// Effective batter side vs this arm — a switch hitter bats opposite the pitcher.
export function effSide(batSide, pitcherHand) {
  if (batSide === 'S') return pitcherHand === 'L' ? 'R' : 'L'
  return batSide || 'R'
}

// Which batter hand to attack with = the side the starter allows more HR/9 to.
export function attackSideFor(pitcher) {
  const lH = pitcher?.splits?.vl?.hrPer9
  const rH = pitcher?.splits?.vr?.hrPer9
  if (lH != null && rH != null) return lH >= rH ? 'L' : 'R'
  if (lH != null) return 'L'
  if (rH != null) return 'R'
  return null
}

// Projected strikeouts for a start: the pitcher's K rate per batter faced
// (season, nudged toward recent form) × expected batters faced (recent avg IP
// per start × ~4.3 BF/IP) × an opponent adjustment (this lineup's K rate vs
// league). A transparent estimate, not a betting line — gives a "~6 K (5–8)"
// read on the Pitchers page. Returns { k, lo, hi, expIP } or null.
const LEAGUE_K_PCT = 0.22
const BF_PER_IP = 4.3
export function estimatedKs(pitcher, targets) {
  const s = pitcher?.season || {}
  let kRate = s.bf > 0 && Number.isFinite(s.k) ? s.k / s.bf
    : Number.isFinite(s.kPer9) ? (s.kPer9 / 9) / BF_PER_IP
    : null
  if (kRate == null) return null
  const rf = pitcher?.recentForm
  if (rf && Number.isFinite(rf.k9)) kRate = kRate * 0.7 + ((rf.k9 / 9) / BF_PER_IP) * 0.3
  // Expected innings — recent avg per start, clamped to a real start length.
  const ipVals = (rf?.recentStarts || []).map((x) => x.ip).filter(Number.isFinite).slice(0, 6)
  let expIP = ipVals.length ? ipVals.reduce((a, b) => a + b, 0) / ipVals.length
    : Number.isFinite(rf?.ip) && rf?.games ? rf.ip / rf.games : 5.3
  expIP = Math.max(3.5, Math.min(7, expIP))
  const expBF = expIP * BF_PER_IP
  // Opponent K rate — the lineup actually facing him.
  const oppKs = (targets || []).map((b) => {
    const ss = b.season
    if (!ss || !(ss.ab > 0)) return null
    const pa = (ss.ab || 0) + (ss.bb || 0)
    return pa > 0 ? (ss.k || 0) / pa : null
  }).filter((v) => v != null)
  const oppK = oppKs.length ? oppKs.reduce((a, b) => a + b, 0) / oppKs.length : LEAGUE_K_PCT
  const oppAdj = Math.max(0.85, Math.min(1.18, oppK / LEAGUE_K_PCT))
  const est = expBF * kRate * oppAdj
  return { k: est, lo: Math.max(0, Math.round(est - 1.6)), hi: Math.round(est + 1.6), expIP, oppK }
}

export function groupPitchers(batters) {
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
    e.estK = estimatedKs(e.pitcher, e.targets)
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
