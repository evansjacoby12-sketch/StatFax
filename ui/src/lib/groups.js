// Auto-generate parlay combos — multi-leg HR parlays that take at most one
// batter per game (HRs by different batters are close enough to independent for
// a quick read; stacking the same game would break that). Several *strategies*
// each produce their own combo per leg-size, so the Groups page offers a range
// of angles — chalk, value, heat, power, lottery — not just the single top tier.

import { decimalToAmerican } from './format.js'
import { HOT_HEAT } from './constants.js'

const SIZES = [2, 3, 4]

const barrelOf = (b) => (Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct)

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
    key: 'value',
    label: 'Best Value',
    icon: 'Percent',
    desc: 'biggest edge vs the market',
    rank: (b) => b.edge ?? -Infinity,
    require: (b) => Number.isFinite(b.edge) && b.edge > 0,
  },
  {
    key: 'hot',
    label: 'Hot Hand',
    icon: 'Flame',
    desc: 'hottest bats on the slate',
    rank: (b) => b.heatIndex ?? 0,
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
    rank: (b) => b.pitcher?.season?.hrPer9 ?? 0,
    require: (b) => (b.pitcher?.season?.hrPer9 ?? 0) >= 1.3,
  },
  {
    key: 'park',
    label: 'Park & Air',
    icon: 'Wind',
    desc: 'park × weather boosts HR',
    rank: (b) => b.parkWeatherHandFactor ?? 0,
    require: (b) => (b.parkWeatherHandFactor ?? 1) >= 1.05,
  },
  {
    key: 'longshot',
    label: 'Long Shots',
    icon: 'Zap',
    desc: 'longest odds, biggest payout',
    rank: (b) => b.odds?.best?.decimal ?? 0,
    require: (b) => (b.odds?.best?.decimal ?? 0) >= 4, // ~+300 or longer
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
    for (const strat of STRATEGIES) {
      const pool = topPerGame(batters, strat.rank, strat.require)
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
