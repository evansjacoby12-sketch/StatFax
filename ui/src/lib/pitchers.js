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

const LEAGUE_K_PCT   = 0.22
const BF_PER_IP      = 4.3
const LEAGUE_WHIFF_PCT = 24.5
const LEAGUE_SWSTR_PCT = 11.0  // SwStr% league avg (swinging-strikes / total pitches)
const STAB_BF          = 150   // regression threshold for pitcher platoon splits

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

// Temperature and umpire adjustments — same logic as server-side computeKDist.
function tempAdj(weather) {
  if (!weather || weather.roofClosed) return 1
  const t = weather.tempF
  if (!Number.isFinite(t)) return 1
  return Math.max(0.92, Math.min(1.08, 1 + (t - 72) * 0.003))
}
function umpireKAdj(umpire) {
  // Use dedicated kFactor when available; fall back to hrFactor proxy.
  const kf = umpire?.kFactor
  if (Number.isFinite(kf)) return Math.max(0.92, Math.min(1.08, kf))
  const hf = umpire?.hrFactor
  if (!Number.isFinite(hf)) return 1
  return Math.max(0.92, Math.min(1.08, 1 + (1 - hf) * 0.15))
}

export function kBrain(pitcher, targets, { weather, umpire } = {}) {
  const s = pitcher?.season || {}

  // Season K rate — anchor for stabilization and fallback
  let seasonKRate = s.bf > 0 && Number.isFinite(s.k) ? s.k / s.bf
    : Number.isFinite(s.kPer9) ? (s.kPer9 / 9) / BF_PER_IP
    : null

  // ── Step A: Per-batter log-odds matchup with split stabilization ──────────
  // Log-odds formula: matchupOdds = (pitcherOdds × batterOdds) / leagueOdds.
  // Pitcher splits < STAB_BF BF vs a hand are regressed toward season rate
  // to prevent early-season small-sample noise from distorting the projection.
  const vl = pitcher?.splits?.vl
  const vr = pitcher?.splits?.vr
  const vlKRate = (vl?.kPct != null && Number.isFinite(vl.kPct)) ? vl.kPct / 100 : null
  const vrKRate = (vr?.kPct != null && Number.isFinite(vr.kPct)) ? vr.kPct / 100 : null

  let splitKRate = null
  if (seasonKRate != null && (vlKRate != null || vrKRate != null)) {
    const stabVl = vlKRate != null
      ? (Number.isFinite(vl?.bf) && vl.bf < STAB_BF
          ? (vlKRate * vl.bf + seasonKRate * STAB_BF) / (vl.bf + STAB_BF)
          : vlKRate)
      : seasonKRate
    const stabVr = vrKRate != null
      ? (Number.isFinite(vr?.bf) && vr.bf < STAB_BF
          ? (vrKRate * vr.bf + seasonKRate * STAB_BF) / (vr.bf + STAB_BF)
          : vrKRate)
      : seasonKRate

    const leagueOdds = LEAGUE_K_PCT / (1 - LEAGUE_K_PCT)
    const perBatterK = (targets || []).map((b) => {
      const side = effSide(b.batSide, pitcher?.hand)
      const pK   = Math.min(0.99, side === 'L' ? stabVl : stabVr)
      const ss   = b.season
      const pa   = (ss?.ab || 0) + (ss?.bb || 0)
      const bK   = Math.min(0.99, pa > 0 ? (ss?.k || 0) / pa : LEAGUE_K_PCT)
      const matchupOdds = (pK / (1 - pK)) * (bK / (1 - bK)) / leagueOdds
      return matchupOdds / (1 + matchupOdds)
    })
    if (perBatterK.length) splitKRate = perBatterK.reduce((a, b) => a + b, 0) / perBatterK.length
  }

  if (seasonKRate == null && splitKRate == null) return null
  if (seasonKRate == null) seasonKRate = splitKRate

  // ── Step B: Recent form blend ───────────────────────────────────────────────
  const rf = pitcher?.recentForm
  let recentKRate = null
  const recentStarts = (rf?.recentStarts || []).filter((x) => Number.isFinite(x.ip) && x.ip > 0)
  if (recentStarts.length >= 2) {
    const kbf = recentStarts.slice(0, 6).map((x) => {
      const bf = x.bf ?? (x.ip * BF_PER_IP)
      return bf > 0 && Number.isFinite(x.k) ? x.k / bf : null
    }).filter((v) => v != null)
    if (kbf.length) recentKRate = kbf.reduce((a, b) => a + b, 0) / kbf.length
  } else if (Number.isFinite(rf?.k9)) {
    recentKRate = (rf.k9 / 9) / BF_PER_IP
  }

  let baseKRate
  if (splitKRate != null) {
    baseKRate = recentKRate != null ? splitKRate * 0.55 + recentKRate * 0.45 : splitKRate
  } else {
    baseKRate = recentKRate != null ? seasonKRate * 0.60 + recentKRate * 0.40 : seasonKRate
  }

  // ── Step C: SwStr% (preferred) or Whiff% ─────────────────────────────────
  // SwStr% (swinging-strikes / total pitches) correlates more tightly to raw
  // K% than Whiff% (swinging-strikes / swings). Use whiff% as fallback.
  const swStrPct = pitcher?.savant?.swStrPct
  const whiffPct = pitcher?.savant?.whiffPct
  let kRate = baseKRate
  if (swStrPct != null && Number.isFinite(swStrPct)) {
    kRate = baseKRate * (1 + ((swStrPct - LEAGUE_SWSTR_PCT) / LEAGUE_SWSTR_PCT) * 0.30)
  } else if (whiffPct != null && Number.isFinite(whiffPct)) {
    kRate = baseKRate * (1 + ((whiffPct - LEAGUE_WHIFF_PCT) / LEAGUE_WHIFF_PCT) * 0.25)
  }
  kRate = Math.min(0.45, kRate)

  // ── Step D: Pitch-mix boost (only when SwStr%/Whiff% unavailable) ─────────
  const hasMissMetric = (swStrPct != null && Number.isFinite(swStrPct)) || (whiffPct != null && Number.isFinite(whiffPct))
  const boost = hasMissMetric ? 0 : pitchMixKBoost(pitcher?.pitchMix)
  const adjustedKRate = kRate + boost

  // ── Opponent K adjustment ─────────────────────────────────────────────────
  // Computed before expBF — used by Vegas proxy below.
  const oppKs = (targets || []).map((b) => {
    const ss = b.season
    if (!ss || !(ss.ab > 0)) return null
    const pa = (ss.ab || 0) + (ss.bb || 0)
    return pa > 0 ? (ss.k || 0) / pa : null
  }).filter((v) => v != null)
  const oppK   = oppKs.length ? oppKs.reduce((a, b) => a + b, 0) / oppKs.length : LEAGUE_K_PCT
  const oppAdj = Math.max(0.82, Math.min(1.22, oppK / LEAGUE_K_PCT))

  // ── Expected BF (pitch-volume model with Vegas proxy) ─────────────────────
  // Prefer pitch-count-based volume when recentStarts carry numberOfPitches.
  // Vegas proxy: elite-contact lineup (oppK < 0.185) → earlier hook → −5%.
  const vegasTrim = oppK < 0.185 ? 0.95 : 1.0
  const pitchVals = recentStarts.slice(0, 6).map((x) => x.pitches).filter((v) => Number.isFinite(v) && v > 50)
  const bfVals    = recentStarts.slice(0, 6).map((x) => x.bf ?? (Number.isFinite(x.ip) ? x.ip * BF_PER_IP : null)).filter(Number.isFinite)
  let expIP, ipSD, expBF
  if (pitchVals.length >= 2 && bfVals.length >= 2) {
    const avgPitches = pitchVals.reduce((a, b) => a + b, 0) / pitchVals.length
    const avgBF      = bfVals.reduce((a, b) => a + b, 0) / bfVals.length
    const pPerBF     = Math.max(3.5, Math.min(4.5, avgPitches / avgBF))
    expBF  = Math.max(3.5 * BF_PER_IP, Math.min(7.5 * BF_PER_IP, (avgPitches * vegasTrim) / pPerBF))
    expIP  = expBF / BF_PER_IP
    ipSD   = 0.8
  } else {
    const ipVals = recentStarts.map((x) => x.ip).filter(Number.isFinite).slice(0, 6)
    if (ipVals.length >= 2) {
      expIP = ipVals.reduce((a, b) => a + b, 0) / ipVals.length
      const variance = ipVals.reduce((a, b) => a + (b - expIP) ** 2, 0) / ipVals.length
      ipSD = Math.sqrt(variance)
    } else {
      expIP = Number.isFinite(rf?.ip) && rf?.games > 0 ? rf.ip / rf.games : 5.3
      ipSD  = 1.2
    }
    expIP = Math.max(3.5, Math.min(7.5, expIP))
    expBF = expIP * BF_PER_IP * vegasTrim
    expBF = Math.max(3.5 * BF_PER_IP, Math.min(7.5 * BF_PER_IP, expBF))
  }

  // ── TTTO penalty (Third Time Through the Order) ────────────────────────────
  // K rates decay ~12% for batters seeing the starter a 3rd time (BF 19+).
  // Applied proportionally: fraction of outing beyond BF 18 × 0.12 decay.
  const tttoBF      = Math.max(0, expBF - 18)
  const tttoPenalty = expBF > 0 ? (1 - tttoBF * 0.12 / expBF) : 1.0

  // ── Environmental multipliers ──────────────────────────────────────────────
  const tAdj = tempAdj(weather)
  const uAdj = umpireKAdj(umpire)
  const rawPKAdj = pitcher?.gameParkKFactor
  const pAdj = Number.isFinite(rawPKAdj) && rawPKAdj > 0 ? rawPKAdj : 1.0

  const lambda = expBF * adjustedKRate * oppAdj * tAdj * uAdj * pAdj * tttoPenalty

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

  const conf = recentStarts.length >= 4 && s.bf >= 100 ? 'high'
    : recentStarts.length >= 2 || s.bf >= 50 ? 'med'
    : 'low'

  const lo = Math.max(0, findPoiQuantile(lambda, 0.10))
  const hi = findPoiQuantile(lambda, 0.90)

  return { k: lambda, lo, hi, expIP, ipSD, oppK, lambda, probs, trend, conf, boost, splitKRate,
           swStrPct: swStrPct ?? null, whiffPct: whiffPct ?? null,
           tempAdj: tAdj, umpireAdj: uAdj, parkKAdj: pAdj, tttoPenalty,
           tempF: weather?.tempF ?? null }
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
