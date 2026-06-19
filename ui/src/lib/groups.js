// Auto-generate parlay combos — multi-leg HR parlays that take at most one
// batter per game (HRs by different batters are close enough to independent for
// a quick read; stacking the same game would break that). Several *strategies*
// each produce their own combo per leg-size, so the Groups page offers a range
// of angles — chalk, value, heat, power, lottery — not just the single top tier.

import { decimalToAmerican } from './format.js'
import { HOT_HEAT } from './constants.js'

// Only 2/3/4-leg combos are displayed and graded (server SIZES === [2,3,4]).
// Larger pools were built every rebuild but never shown, so we trim to match.
const SIZES = [2, 3, 4]

const barrelOf = (b) => (Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct)

// Per-leg weakness checks (shared by Parlay Combos + SGP). A leg trips a flag on
// a sub-PRIME grade, low barrel, an HR-stingy arm, or a pitcher's park; it's a
// "really bad" (red) leg on a long-shot HR%, a tiny barrel under a weak grade,
// or 2+ flags stacking.
const STINGY_HR9 = 0.85
const LOW_BARREL = 13
const PITCHER_PARK = 0.92
const LONGSHOT_PROB = 0.18
export function legFlags(b) {
  const f = []
  const grade = b.grade?.label || b.grade
  const sb = Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct
  const hr9 = b.pitcher?.season?.hrPer9
  const park = b.gameParkHRFactor
  if (grade !== 'PRIME') f.push(`${grade || 'SKIP'} (not PRIME)`)
  if (Number.isFinite(sb) && sb < LOW_BARREL) f.push(`low barrel ${sb.toFixed(0)}%`)
  if (Number.isFinite(hr9) && hr9 < STINGY_HR9) f.push(`HR-stingy arm ${hr9.toFixed(2)}`)
  if (Number.isFinite(park) && park <= PITCHER_PARK) f.push(`pitcher's park ${park.toFixed(2)}`)
  return f
}
export function legIsBad(b, flags = legFlags(b)) {
  const grade = b.grade?.label || b.grade
  const sb = Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct
  if (Number.isFinite(b.hrProbability) && b.hrProbability < LONGSHOT_PROB) return true
  if (grade !== 'PRIME' && Number.isFinite(sb) && sb < 8) return true
  return flags.length >= 2
}

// Blast rate (Statcast bat tracking) — recent ~2wk blasts-per-squared-up-contact
// preferred (needs a real swing sample), season as fallback. Mirrors
// server/parlay-combos.mjs blastRate(). 0-100 %. BLAST_ELITE flags a top blaster.
export const BLAST_ELITE = 25
export const blastOf = (b) => {
  const t = b.batTracking
  if (!t) return null
  if (Number.isFinite(t.recentBlastPerContact) && (t.recentSwings ?? 0) >= 25) return t.recentBlastPerContact
  return Number.isFinite(t.blastPerContact) ? t.blastPerContact : null
}
const norm01 = (v, hi) => Math.min(1, Math.max(0, (v ?? 0) / hi))

// Strikeout rate (K / PA, approximated as k/(ab+bb)) — a proxy for how boom-or-
// bust a bat is. Optional "favor consistency" lean down-weights high-K sluggers
// in the combo ranking so a streaky masher doesn't auto-anchor every strategy.
const kRateOf = (b) => {
  const s = b.season
  if (!s || !(s.ab > 0)) return null
  const pa = (s.ab || 0) + (s.bb || 0)
  return pa > 0 ? (s.k || 0) / pa : null
}
// 1.0 = no penalty at/below ~20% K; ramps to 0.75 for very high-K (~40%+) bats.
export const consistencyFactor = (b) => {
  const k = kRateOf(b)
  if (k == null) return 1
  return 1 - Math.min(1, Math.max(0, (k - 0.20) / 0.20)) * 0.25
}

// "Rising" signal — the Outlaw-style recency edge surfaced as a visible badge
// instead of a hidden ranking lean. A bat is RISING when its recent L14 barrel
// (real sample) is meaningfully above its season rate — it's heating up NOW.
// Returns { recent, season, delta } or null. RISING_DELTA is the bar in barrel
// points; ~+4 separates a genuine surge from sample noise.
export const RISING_DELTA = 4
export function risingForm(b) {
  const rb = b.recentBarrel?.recentBarrelPct
  const bbe = b.recentBarrel?.recentBBE ?? 0
  if (!Number.isFinite(rb) || bbe < 6) return null
  const season = Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct
  if (!Number.isFinite(season)) return null
  const delta = rb - season
  return delta >= RISING_DELTA ? { recent: rb, season, delta } : null
}

// Matchup-relevant blast cuts (display): vs today's starter's HAND, and the
// usage-weighted blast vs his exact MIX (only when we cover ≥half the arsenal).
export const blastVsHandOf = (b) => {
  const t = b.batTracking
  return t && Number.isFinite(t.vsHandBlast) && (t.vsHandSwings ?? 0) >= 8 ? t.vsHandBlast : null
}
export const blastMixOf = (b) => {
  const t = b.batTracking
  return t && Number.isFinite(t.vsMixBlast) && (t.vsMixCoverage ?? 0) >= 0.5 ? t.vsMixBlast : null
}

// Proven HR signals, weighted by the badge audit's within-grade lift (hot &
// barrelKing carry the most; park/weather the least). "due" is excluded — it's
// the gambler's-fallacy signal we falsified. Drives the Signal Stack combo,
// which groups bats that light up the SAME signals — what the per-metric
// strategies miss (they rank on one number, never on shared badges).
// Kept identical to server/parlay-combos.mjs so the page and the scorecard build
// the SAME combos. (Dropped pitchEdge/wxEdge — weakest signals + shape-divergent.)
const STACK_SIGNALS = { hot: 3, barrelKing: 2, homeEdge: 2, bullpenLegend: 2, awayEdge: 1.5 }
const signalScore = (b) => Object.entries(STACK_SIGNALS).reduce((s, [k, w]) => s + (b[k] ? w : 0), 0)
const signalCount = (b) => Object.keys(STACK_SIGNALS).reduce((n, k) => n + (b[k] ? 1 : 0), 0)

// Strategy menu. Each ranks the eligible pool by its own metric and may require
// a leg to clear a bar (e.g. Hot Hand only takes hot bats). `top` additionally
// spins off a second non-overlapping tier so there's always a backup combo.
const STRATEGIES = [
  {
    key: 'top',
    label: 'Top Picks',
    icon: 'TrendingUp',
    desc: 'highest model score',
    // Match the server: rank by score (uncapped, so it separates the elite tier
    // that HR% pins together). No tiers — the server builds one combo per strategy.
    rank: (b) => b.score ?? 0,
  },
  {
    key: 'mix',
    label: 'Best Mix',
    icon: 'Sparkles',
    desc: 'best blend of grade, power & heat',
    // Cross-metric blend so a great-overall bat and an elite-barrel bat can pair
    // in one combo (single-metric strategies silo them). Mirrors the server's
    // mixRank: score 0.5, barrel 0.25, heat 0.25 (barrel & heat ~tied in the audit).
    rank: (b) =>
      0.5 * ((b.score ?? 0) / 100) +
      0.25 * Math.min(1, Math.max(0, (barrelOf(b) ?? 0) / 25)) +
      0.25 * ((b.heatIndex ?? 0) / 100),
  },
  {
    key: 'stack',
    label: 'Signal Stack',
    icon: 'Layers',
    desc: 'most proven signals stacked',
    rank: signalScore,
    require: (b) => signalCount(b) >= 2, // a real stack, not a lone badge
  },
  {
    key: 'hot',
    label: 'Hot Hand',
    icon: 'Flame',
    desc: 'hottest bats on the slate',
    // Blend both heat signals: heatIndex × recent-form multiplier (mirrors the
    // server's hot strategy in parlay-combos.mjs).
    rank: (b) => (b.heatIndex ?? 0) * (b.hotnessMultiplier ?? 1),
    require: (b) => b.hot === true || (b.heatIndex ?? 0) >= HOT_HEAT,
  },
  {
    key: 'power',
    label: 'Power Bats',
    icon: 'Crosshair',
    desc: 'barrel + blast rate',
    // Barrel (45%) + recent L14 barrel (30%) + BLAST rate (25%), all normalized
    // 0-1. Blast (fast + squared-up contact) is the bat-speed leg of raw power.
    // Mirrors server/parlay-combos.mjs powerRank().
    rank: (b) => {
      const barrel = norm01(barrelOf(b), 25)
      const rb = b.recentBarrel?.recentBarrelPct
      const recent = Number.isFinite(rb) && (b.recentBarrel?.recentBBE ?? 0) >= 6 ? norm01(rb, 25) : barrel
      return 0.45 * barrel + 0.30 * recent + 0.25 * norm01(blastOf(b), 30)
    },
    // Gate at an above-average barrel (11), not league-average (9): a league-avg
    // bar lets this strategy re-pick the same elite bats as `top`/`mix` instead of
    // surfacing distinct power arms. Kept identical to server powerRank gate.
    require: (b) => Number.isFinite(barrelOf(b)) && barrelOf(b) >= 11,
  },
  {
    key: 'matchup',
    label: 'Soft Matchup',
    icon: 'Target',
    desc: 'facing HR-prone pitchers',
    // Anchor on batter quality (model HR prob) × the matchup tilt, so a soft
    // matchup lifts a good bat rather than ranking a weak bat on hrPer9 alone
    // (grade is 2.29× HR lift in the audit; the matchup signal alone is weak).
    // No-season-sample arms (call-ups) fall back to a league prior (~1.25) so
    // they read as neutral, not blind — still below the 1.3 gate.
    rank: (b) => (b.score ?? 0) * (b.pitcher?.season?.hrPer9 ?? (b.pitcher?.id != null ? 1.25 : 0)),
    require: (b) => (b.pitcher?.season?.hrPer9 ?? (b.pitcher?.id != null ? 1.25 : 0)) >= 1.3,
  },
  {
    key: 'park',
    label: 'Park & Air',
    icon: 'Wind',
    desc: 'park × weather boosts HR',
    // Anchor on batter quality (model HR prob) × the park/air tilt, same reason
    // as matchup — a launch pad should lift a good bat, not rank a weak one.
    rank: (b) => (b.score ?? 0) * (b.parkWeatherHandFactor ?? 0),
    // Gate at a genuine launch-pad tilt (1.08), not a barely-above-neutral 1.05:
    // a near-neutral bar lets this strategy re-pick `top`'s legs instead of
    // surfacing bats in real HR-friendly air. Kept identical to the server gate.
    require: (b) => (b.parkWeatherHandFactor ?? 1) >= 1.08,
  },
]

// Noise-filter tolerance, as a FRACTION of a pool's rank spread (max−min). Two
// bats whose ranks differ by less than this share of the spread are treated as
// tied, so sub-threshold wobble can't reorder near-tied legs run-to-run — the
// main source of combo-leg flicker. Expressing it relative to the spread makes
// the filter comparable across strategies whose raw ranks live on wildly
// different scales (integer 'stack' weights vs 0–1 'mix' vs ~60–130 score×factor):
// a flat 3-sig-fig quantize was too coarse on big ranks and too fine on 0–1 ones.
// The server (parlay-combos.mjs) uses the same fraction so client and server
// quantize in the same normalized space.
const RANK_TOL = 0.002
// Quantize `x` to a grid of step = tol, then re-scale to its original units.
// With tol derived from the pool spread, equal buckets => treated as tied.
function quantize(x, tol) {
  if (!Number.isFinite(x)) return -Infinity
  if (!(tol > 0)) return x
  return Math.round(x / tol) * tol
}
// Build a total-order comparator for ONE pool: ranks are quantized to a grid
// sized to this pool's own rank spread, then exact ties break by quantized score
// and finally a STABLE playerId. Returns <0 when `a` outranks `b`. The playerId
// tiebreak guarantees two genuinely equal-strength legs always resolve the same
// way, so they never trade places between rebuilds.
function makeLegCmp(rank, items) {
  let lo = Infinity, hi = -Infinity
  let sLo = Infinity, sHi = -Infinity
  for (const b of items) {
    const r = rank(b)
    if (Number.isFinite(r)) { if (r < lo) lo = r; if (r > hi) hi = r }
    const s = b.score ?? 0
    if (s < sLo) sLo = s; if (s > sHi) sHi = s
  }
  const rTol = hi > lo ? (hi - lo) * RANK_TOL : 0
  const sTol = sHi > sLo ? (sHi - sLo) * RANK_TOL : 0
  return (a, b) =>
    (quantize(rank(b), rTol) - quantize(rank(a), rTol)) ||
    (quantize(b.score ?? 0, sTol) - quantize(a.score ?? 0, sTol)) ||
    ((a.playerId ?? 0) - (b.playerId ?? 0))
}

// Eligible bats for a strategy: skip finals, SKIP grades, prob-less rows, and
// anything the strategy's require-gate rejects.
function eligibleFor(batters, require) {
  const eligible = []
  for (const b of batters || []) {
    if (b.game?.isFinal) continue
    if ((b.grade?.label || 'SKIP') === 'SKIP') continue
    if (!Number.isFinite(b.hrProbability)) continue
    if (require && !require(b)) continue
    eligible.push(b)
  }
  return eligible
}

// Span of a rank function over a pool (max−min of finite ranks), used to size
// the additive incumbency bonus relative to the strategy's own scale.
function rankSpan(rank, items) {
  let lo = Infinity, hi = -Infinity
  for (const b of items) {
    const r = rank(b)
    if (Number.isFinite(r)) { if (r < lo) lo = r; if (r > hi) hi = r }
  }
  return hi > lo ? hi - lo : 0
}

// Best eligible batter per game by a given metric. `eligible` is pre-filtered by
// eligibleFor so the caller can also derive the rank span from the same pool.
function topPerGame(eligible, rank) {
  const cmp = makeLegCmp(rank, eligible)
  const byGame = new Map()
  for (const b of eligible) {
    const cur = byGame.get(b.gamePk)
    if (!cur || cmp(b, cur) < 0) byGame.set(b.gamePk, b)
  }
  return [...byGame.values()].sort(cmp)
}

// Group letter grade from the legs' average model score.
function gradeFor(avgScore) {
  if (avgScore >= 76) return 'S'
  if (avgScore >= 70) return 'A'
  if (avgScore >= 62) return 'B'
  if (avgScore >= 54) return 'C'
  return 'D'
}

function makeGroup(legs, size, strat, idSuffix = '') {
  const avgScore = legs.reduce((s, b) => s + (b.score ?? 0), 0) / legs.length
  // Parlay "all hit" probability = product of independent leg HR probs. Null when
  // ANY leg lacks a finite prob — mirrors the server's `every(finite) ? product :
  // null` so a missing leg reads as "unknown" instead of silently collapsing the
  // whole combo to 0 while it's still displayed.
  const allHit = legs.every((b) => Number.isFinite(b.hrProbability))
    ? legs.reduce((p, b) => p * b.hrProbability, 1)
    : null
  // Combined market price (only meaningful when every leg has a priced book).
  let decimal = 1
  let priced = 0
  for (const b of legs) {
    const d = b.odds?.best?.decimal
    if (d && d > 1) {
      decimal *= d
      priced++
    }
  }
  const allPriced = priced === legs.length
  return {
    id: `${strat.key}${idSuffix}-${size}`,
    size,
    strategy: strat.key,
    label: strat.label,
    icon: strat.icon,
    desc: strat.desc,
    grade: gradeFor(avgScore),
    avgScore,
    allHit,
    legs,
    american: allPriced ? decimalToAmerican(decimal) : null,
    edge: allPriced && allHit != null ? allHit * decimal - 1 : null,
  }
}

export function buildGroups(batters, { maxPerBat = 2, globalMaxPerBat = 4, favorConsistency = false, incumbents = null, stickMargin = 0.05 } = {}) {
  // Each strategy's ranked pool is size-independent — compute once, slice per size.
  // The favorConsistency lean wraps each rank with a factor that demotes high-K
  // boom-or-bust bats. (Recent form is now a visible RISING signal, not a lean.)
  //
  // INCUMBENCY (anti-flicker): a bat that was a leg of THIS strategy on the last
  // build gets an ADDITIVE rank bonus of stickMargin × the strategy pool's rank
  // span (max−min). Sizing the bonus to each strategy's own scale makes the
  // stickiness comparable across all 7 strategies — the old (1+stickMargin)
  // RELATIVE multiplier swung wildly (huge on ~60–130 score×factor ranks, a
  // near-no-op on small integer 'stack' weights). With an additive span-fraction
  // bonus, an incumbent holds unless a challenger beats it by more than
  // stickMargin of the spread — a consistent "meaningfully better" bar everywhere.
  // Empty/absent incumbents → normal behavior.
  const pools = STRATEGIES.map((strat) => {
    const base = favorConsistency ? (b) => strat.rank(b) * consistencyFactor(b) : strat.rank
    const eligible = eligibleFor(batters, strat.require)
    const inc = incumbents?.[strat.key]
    let rank = base
    if (inc && inc.size) {
      const bonus = stickMargin * rankSpan(base, eligible)
      rank = (b) => base(b) + (inc.has(b.playerId) ? bonus : 0)
    }
    return { strat, pool: topPerGame(eligible, rank) }
  })
  const out = {}
  // GLOBAL exposure cap (Fix #1): track each bat's usage across the WHOLE build,
  // not per-size. The old per-size cap let one stud land in up to maxPerBat combos
  // PER SIZE — so with sizes [2,3,4] a single bat (e.g. Soto) could anchor most of
  // the board, and one cold night wiped out nearly every combo (correlated
  // failure). usedGlobal caps a bat at ~globalMaxPerBat combos TOTAL across all
  // sizes; the per-size `used` keeps it from stacking within a single size.
  const usedGlobal = {}
  for (const size of SIZES) {
    const groups = []
    const seen = new Set() // dedupe identical leg sets across strategies
    const used = {} // diversity cap: a bat anchors at most maxPerBat groups per size
    const push = (g) => {
      const sig = g.legs
        .map((b) => b.id)
        .sort()
        .join('|')
      if (seen.has(sig)) return
      seen.add(sig)
      for (const b of g.legs) {
        used[b.id] = (used[b.id] || 0) + 1
        usedGlobal[b.id] = (usedGlobal[b.id] || 0) + 1
      }
      groups.push(g)
    }
    // Pick `size` legs from `pool` starting at `start`, preferring bats under BOTH
    // the per-size and global caps so the same studs don't anchor every strategy
    // and every size. Two-pass: first take bats under the global cap; if that
    // leaves us short, relax to per-size only; finally fall back to the pure slice
    // rather than drop the strategy (the audited safety we must keep).
    const pick = (pool, start) => {
      const take = (globalCapped) => {
        const legs = []
        for (let i = start; i < pool.length && legs.length < size; i++) {
          const b = pool[i]
          if ((used[b.id] || 0) >= maxPerBat) continue
          if (globalCapped && (usedGlobal[b.id] || 0) >= globalMaxPerBat) continue
          legs.push(b)
        }
        return legs
      }
      let legs = take(true) // prefer under-global-cap bats
      if (legs.length < size) legs = take(false) // relax global cap before dropping
      return legs.length === size ? legs : pool.slice(start, start + size)
    }
    for (const { strat, pool } of pools) {
      const tiers = strat.tiers || 1
      for (let t = 0, i = 0; t < tiers && i + size <= pool.length; t++, i += size) {
        push(makeGroup(pick(pool, i), size, strat, t ? `-t${t}` : ''))
      }
    }
    if (groups.length) out[size] = groups
  }
  return out
}

// Collect each strategy's current leg playerIds (across all sizes) so the caller
// can persist them and feed them back as next build's `incumbents` for sticky,
// flicker-free legs.
export function legsByStrategy(groupsOut) {
  const m = {}
  for (const size of Object.keys(groupsOut || {})) {
    for (const g of groupsOut[size] || []) {
      const set = (m[g.strategy] = m[g.strategy] || new Set())
      for (const b of g.legs) if (b.playerId != null) set.add(b.playerId)
    }
  }
  return m
}

// "Dillon Dingler" → "Dingler, Dillon" (matches the group-card convention).
export function lastFirst(name) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  if (parts.length < 2) return name
  const last = parts[parts.length - 1]
  const first = parts.slice(0, -1).join(' ')
  return `${last}, ${first}`
}

// ISO (slugging minus average) — prefer the hot recent-7 window, else season.
export function isoOf(b) {
  if (Number.isFinite(b.recent7?.iso)) return b.recent7.iso
  const s = b.season
  if (s && Number.isFinite(s.slg) && Number.isFinite(s.avg)) return s.slg - s.avg
  return null
}
