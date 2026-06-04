// Auto-generate "Cross-Game HR Groups" — multi-leg parlays that take the single
// best HR bat from each of several different games (1 batter per game). Produces
// non-overlapping tiers per leg-size, each graded S–D. Reads the shaped batter
// list so it reflects whatever's live.

const SIZES = [2, 3, 4]
const MAX_PER_SIZE = 4 // cap groups shown per leg-size
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

// Best (highest HR-prob) eligible batter per game. Skip finals + SKIP-grade bats.
function bestPerGame(batters) {
  const byGame = new Map()
  for (const b of batters || []) {
    if (b.game?.isFinal) continue
    if ((b.grade?.label || 'SKIP') === 'SKIP') continue
    if (!Number.isFinite(b.hrProbability)) continue
    const cur = byGame.get(b.gamePk)
    if (!cur || b.hrProbability > cur.hrProbability || (b.hrProbability === cur.hrProbability && (b.score ?? 0) > (cur.score ?? 0))) {
      byGame.set(b.gamePk, b)
    }
  }
  return [...byGame.values()].sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0) || (b.score ?? 0) - (a.score ?? 0))
}

// Group letter grade from the legs' average model score.
function gradeFor(avgScore) {
  if (avgScore >= 76) return 'S'
  if (avgScore >= 70) return 'A'
  if (avgScore >= 62) return 'B'
  if (avgScore >= 54) return 'C'
  return 'D'
}

function makeGroup(legs, size, letterIdx) {
  const avgScore = legs.reduce((s, b) => s + (b.score ?? 0), 0) / legs.length
  // Parlay "all hit" probability = product of independent leg HR probs.
  const allHit = legs.reduce((p, b) => p * (b.hrProbability ?? 0), 1)
  return {
    id: `g${size}-${letterIdx}`,
    size,
    letter: LETTERS[letterIdx] || '?',
    grade: gradeFor(avgScore),
    avgScore,
    allHit,
    legs,
  }
}

export function buildGroups(batters) {
  const pool = bestPerGame(batters)
  const out = {}
  for (const size of SIZES) {
    const groups = []
    // Non-overlapping tiers: A = top `size`, B = next `size`, …
    for (let i = 0; i + size <= pool.length && groups.length < MAX_PER_SIZE; i += size) {
      groups.push(makeGroup(pool.slice(i, i + size), size, groups.length))
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
