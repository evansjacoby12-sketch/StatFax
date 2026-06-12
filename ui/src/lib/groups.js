// Auto-generate parlay combos — multi-leg HR parlays that take at most one
// batter per game (HRs by different batters are close enough to independent for
// a quick read; stacking the same game would break that). Several *strategies*
// each produce their own combo per leg-size, so the Groups page offers a range
// of angles — chalk, value, heat, power, lottery — not just the single top tier.

import { decimalToAmerican } from './format.js'
import { HOT_HEAT } from './constants.js'

const SIZES = [2, 3, 4, 5, 6, 7, 8]

const barrelOf = (b) => (Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct)

// Proven HR signals, weighted by the badge audit's within-grade lift (hot &
// barrelKing carry the most; park/weather the least). "due" is excluded — it's
// the gambler's-fallacy signal we falsified. Drives the Signal Stack combo,
// which groups bats that light up the SAME signals — what the per-metric
// strategies miss (they rank on one number, never on shared badges).
const STACK_SIGNALS = { hot: 3, barrelKing: 2, homeEdge: 2, bullpenLegend: 2, awayEdge: 1.5, pitchEdge: 1, wxEdge: 0.5 }
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
    desc: 'highest HR probability',
    rank: (b) => b.hrProbability ?? 0,
    tiers: 2,
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
    desc: 'elite barrel rate',
    rank: (b) => barrelOf(b) ?? 0,
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
    rank: (b) => (b.hrProbability ?? 0) * (b.pitcher?.season?.hrPer9 ?? 0),
    require: (b) => (b.pitcher?.season?.hrPer9 ?? 0) >= 1.3,
  },
  {
    key: 'park',
    label: 'Park & Air',
    icon: 'Wind',
    desc: 'park × weather boosts HR',
    // Anchor on batter quality (model HR prob) × the park/air tilt, same reason
    // as matchup — a launch pad should lift a good bat, not rank a weak one.
    rank: (b) => (b.hrProbability ?? 0) * (b.parkWeatherHandFactor ?? 0),
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

export function buildGroups(batters) {
  // Each strategy's ranked pool is size-independent — compute once, slice per size.
  const pools = STRATEGIES.map((strat) => ({ strat, pool: topPerGame(batters, strat.rank, strat.require) }))
  const out = {}
  for (const size of SIZES) {
    const groups = []
    const seen = new Set() // dedupe identical leg sets across strategies
    const push = (g) => {
      const sig = g.legs
        .map((b) => b.id)
        .sort()
        .join('|')
      if (seen.has(sig)) return
      seen.add(sig)
      groups.push(g)
    }
    for (const { strat, pool } of pools) {
      const tiers = strat.tiers || 1
      for (let t = 0, i = 0; t < tiers && i + size <= pool.length; t++, i += size) {
        push(makeGroup(pool.slice(i, i + size), size, strat, t ? `-t${t}` : ''))
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
