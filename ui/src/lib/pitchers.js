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

const LEAGUE_K_PCT = 0.22
const BF_PER_IP = 4.3

// Poisson CDF — P(X ≤ k) for X ~ Poisson(lambda). Used to compute K-over
// probabilities without any lookup tables. Fast for k ≤ 20.
function poissonCDF(k, lambda) {
  if (lambda <= 0) return 1
  let sum = 0, term = Math.exp(-lambda)
  for (let i = 0; i <= Math.floor(k); i++) {
    sum += term
    term *= lambda / (i + 1)
  }
  return Math.min(1, sum)
}
// P(K > line) for a half-integer sportsbook line (e.g. 6.5 → P(K ≥ 7)).
export function kOverProb(lambda, line) {
  if (!Number.isFinite(lambda) || lambda <= 0) return null
  return 1 - poissonCDF(Math.floor(line), lambda)
}

// Whiff-rate boost from pitch mix: pitches with above-average swing-and-miss
// rates lift the pitcher's K rate beyond what raw K/9 captures. Coefficients
// are approximate relative whiff lift per 10% usage vs. a 4-seam-only arm.
const WHIFF_LIFT = { sl: 0.012, st: 0.015, cu: 0.010, kc: 0.010, ch: 0.009, fs: 0.011 }
function pitchMixKBoost(pitchMix) {
  if (!pitchMix) return 0
  let boost = 0
  for (const [code, lift] of Object.entries(WHIFF_LIFT)) {
    const raw = Number(pitchMix[`${code}Pct`] ?? 0)
    const pct = raw > 1.5 ? raw / 100 : raw // normalise fractions
    boost += pct * lift
  }
  return Math.min(0.04, boost) // cap at +4 pp so outliers don't blow up
}

// ─── Core K brain ────────────────────────────────────────────────────────────
// Returns full Poisson-based K distribution for a pitcher start.
//
//   lambda  = kRate × expBF × oppAdj    (mean K expectation)
//   probs   = P(K ≥ n) at every half-integer sportsbook threshold 3.5–10.5
//   trend   = 'up' | 'down' | 'flat'    from last-3 vs prior-3 recent starts
//   conf    = 'high' | 'med' | 'low'    data quality flag
//
// Returns null when there's not enough data to form a meaningful estimate.
export const K_LINES = [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5]

export function kBrain(pitcher, targets) {
  const s = pitcher?.season || {}
  // Blended K rate: 60% season + 40% recent-form, each expressed as K per BF.
  let seasonKRate = s.bf > 0 && Number.isFinite(s.k) ? s.k / s.bf
    : Number.isFinite(s.kPer9) ? (s.kPer9 / 9) / BF_PER_IP
    : null
  if (seasonKRate == null) return null

  const rf = pitcher?.recentForm
  let recentKRate = null
  const recentStarts = (rf?.recentStarts || []).filter((x) => Number.isFinite(x.ip) && x.ip > 0)
  if (recentStarts.length >= 2) {
    // Per-start K/BF from game logs — most accurate recent signal.
    const kbf = recentStarts.slice(0, 6).map((x) => {
      const bf = x.bf ?? (x.ip * BF_PER_IP)
      return bf > 0 && Number.isFinite(x.k) ? x.k / bf : null
    }).filter((v) => v != null)
    if (kbf.length) recentKRate = kbf.reduce((a, b) => a + b, 0) / kbf.length
  } else if (Number.isFinite(rf?.k9)) {
    recentKRate = (rf.k9 / 9) / BF_PER_IP
  }

  const kRate = recentKRate != null
    ? seasonKRate * 0.6 + recentKRate * 0.4
    : seasonKRate

  // Pitch-mix whiff boost — elevates kRate for swing-and-miss arsenals.
  const boost = pitchMixKBoost(pitcher?.pitchMix)
  const adjustedKRate = kRate + boost

  // Expected IP: mean of recent starts (trimmed to 6), with variance for the
  // confidence interval. Falls back to season avg then a league-average 5.3.
  const ipVals = recentStarts.map((x) => x.ip).filter(Number.isFinite).slice(0, 6)
  let expIP, ipSD
  if (ipVals.length >= 2) {
    expIP = ipVals.reduce((a, b) => a + b, 0) / ipVals.length
    const variance = ipVals.reduce((a, b) => a + (b - expIP) ** 2, 0) / ipVals.length
    ipSD = Math.sqrt(variance)
  } else {
    expIP = Number.isFinite(rf?.ip) && rf?.games > 0 ? rf.ip / rf.games : 5.3
    ipSD = 1.2 // default uncertainty when we don't have game logs
  }
  expIP = Math.max(3.5, Math.min(7.5, expIP))
  const expBF = expIP * BF_PER_IP

  // Opponent adjustment: compare this lineup's K rate to league average.
  const oppKs = (targets || []).map((b) => {
    const ss = b.season
    if (!ss || !(ss.ab > 0)) return null
    const pa = (ss.ab || 0) + (ss.bb || 0)
    return pa > 0 ? (ss.k || 0) / pa : null
  }).filter((v) => v != null)
  const oppK = oppKs.length ? oppKs.reduce((a, b) => a + b, 0) / oppKs.length : LEAGUE_K_PCT
  const oppAdj = Math.max(0.82, Math.min(1.22, oppK / LEAGUE_K_PCT))

  // λ = mean K count this start (Poisson parameter).
  const lambda = expBF * adjustedKRate * oppAdj

  // P(K ≥ n) at every sportsbook threshold.
  const probs = {}
  for (const line of K_LINES) probs[line] = kOverProb(lambda, line)

  // Trend: compare K/BF in last 3 vs the 3 before that.
  let trend = 'flat'
  if (recentStarts.length >= 4) {
    const byKBF = recentStarts.slice(0, 6).map((x) => {
      const bf = x.bf ?? (x.ip * BF_PER_IP)
      return bf > 0 && Number.isFinite(x.k) ? x.k / bf : null
    }).filter((v) => v != null)
    if (byKBF.length >= 4) {
      const recent3 = byKBF.slice(0, 3).reduce((a, b) => a + b, 0) / 3
      const prior3  = byKBF.slice(3).reduce((a, b) => a + b, 0) / byKBF.slice(3).length
      if (recent3 > prior3 * 1.07) trend = 'up'
      else if (recent3 < prior3 * 0.93) trend = 'down'
    }
  }

  // Confidence flag.
  const conf = recentStarts.length >= 4 && s.bf >= 100 ? 'high'
    : recentStarts.length >= 2 || s.bf >= 50 ? 'med'
    : 'low'

  const est = lambda
  // lo/hi = 10th–90th percentile via Poisson quantile (simple binary search).
  const lo = Math.max(0, findPoiQuantile(lambda, 0.10))
  const hi = findPoiQuantile(lambda, 0.90)

  return { k: est, lo, hi, expIP, ipSD, oppK, lambda, probs, trend, conf, boost }
}

// Binary search for the smallest k s.t. P(X ≤ k) ≥ p.
function findPoiQuantile(lambda, p) {
  let k = Math.max(0, Math.round(lambda - 3))
  while (poissonCDF(k, lambda) < p && k < 30) k++
  return k
}

// Backwards-compat alias — existing callers (PitchersView, PlayerDrawer) get
// the same shape they expect; kBrain adds lambda/probs/trend/conf on top.
export function estimatedKs(pitcher, targets) {
  return kBrain(pitcher, targets)
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
