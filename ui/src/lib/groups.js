// Auto-generate parlay combos — multi-leg HR parlays that take at most one
// batter per game (HRs by different batters are close enough to independent for
// a quick read; stacking the same game would break that). Several *strategies*
// each produce their own combo per leg-size, so the Groups page offers a range
// of angles — chalk, value, heat, power, lottery — not just the single top tier.

import { decimalToAmerican } from './format.js'
import { HOT_HEAT } from './constants.js'

const SIZES = [2, 3, 4, 5, 6, 7, 8]

const barrelOf = (b) => (Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct)

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
const consistencyFactor = (b) => {
  const k = kRateOf(b)
  if (k == null) return 1
  return 1 - Math.min(1, Math.max(0, (k - 0.20) / 0.20)) * 0.25
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
    require: (b) => Number.isFinite(barrelOf(b)) && barrelOf(b) >= 9,
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
    require: (b) => (b.parkWeatherHandFactor ?? 1) >= 1.05,
  },
]

// Best eligible batter per game by a given metric (skip finals + SKIP bats).
function topPerGame(batters, rank, require) {
  const byGame = new Map()
  for (const b of batters || []) {
    if (b.game?.isFinal) continue
    if ((b.grade?.label || 'SKIP') === 'SKIP') continue
    if (!Number.isFinite(b.hrProbability)) continue
    if (require && !require(b)) continue
    const cur = byGame.get(b.gamePk)
    if (!cur || rank(b) > rank(cur) || (rank(b) === rank(cur) && (b.score ?? 0) > (cur.score ?? 0))) {
      byGame.set(b.gamePk, b)
    }
  }
  return [...byGame.values()].sort((a, b) => rank(b) - rank(a) || (b.score ?? 0) - (a.score ?? 0))
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
  // Parlay "all hit" probability = product of independent leg HR probs.
  const allHit = legs.reduce((p, b) => p * (b.hrProbability ?? 0), 1)
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
    edge: allPriced ? allHit * decimal - 1 : null,
  }
}

export function buildGroups(batters, { maxPerBat = 3, favorConsistency = false } = {}) {
  // Each strategy's ranked pool is size-independent — compute once, slice per size.
  // favorConsistency wraps each rank with a K%-based factor so high-strikeout
  // boom-or-bust bats are demoted (don't anchor every strategy).
  const rankOf = (strat) => (favorConsistency ? (b) => strat.rank(b) * consistencyFactor(b) : strat.rank)
  const pools = STRATEGIES.map((strat) => ({ strat, pool: topPerGame(batters, rankOf(strat), strat.require) }))
  const out = {}
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
      for (const b of g.legs) used[b.id] = (used[b.id] || 0) + 1
      groups.push(g)
    }
    // Pick `size` legs from `pool` starting at `start`, preferring under-cap bats
    // so the same studs don't anchor every strategy; fall back to the pure slice.
    const pick = (pool, start) => {
      const legs = []
      for (let i = start; i < pool.length && legs.length < size; i++) {
        if ((used[pool[i].id] || 0) >= maxPerBat) continue
        legs.push(pool[i])
      }
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
