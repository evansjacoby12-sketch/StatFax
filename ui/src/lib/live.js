// Live parlay tracking — grade a slip's legs against in-progress results so a
// built or saved combo becomes a live scoreboard. Reads the same fields the
// server stamps onto each batter: `homeredThisGame` (persists after a game goes
// FINAL — the field the live `liveContext.isHRThisGame` loses on finalization)
// and the game's live/final state.

// Per-leg live status.
//   hit     — homered (live OR already-final game)
//   live    — game in progress, no HR yet (may still have at-bats)
//   dead    — game FINAL, no HR (this leg lost)
//   pending — game hasn't started
export function legStatus(b) {
  const hit = b?.homeredThisGame === true || b?.liveContext?.isHRThisGame === true
  if (hit) return { code: 'hit', label: 'HR' }
  const g = b?.game
  if (g?.isFinal) return { code: 'dead', label: 'no HR' }
  if (g?.isLive) {
    const abLeft = b?.liveContext?.expectedRemainingABs
    return { code: 'live', label: Number.isFinite(abLeft) && abLeft > 0 ? `${abLeft} AB left` : 'live' }
  }
  return { code: 'pending', label: 'pregame' }
}

// Combo-level verdict from its legs.
//   cashed  — every leg homered
//   dead    — at least one leg's game finished without a HR (parlay lost)
//   live    — in progress, still alive (some legs hit/pending, none dead)
//   pending — nothing has started yet
// Returns { code, hits, n, started, sts } where sts is the per-leg statuses.
export function comboStatus(legs) {
  const list = legs || []
  const sts = list.map(legStatus)
  const hits = sts.filter((s) => s.code === 'hit').length
  const dead = sts.some((s) => s.code === 'dead')
  const started = sts.some((s) => s.code !== 'pending')
  let code = 'pending'
  if (list.length && hits === list.length) code = 'cashed'
  else if (dead) code = 'dead'
  else if (started) code = 'live'
  return { code, hits, n: list.length, started, sts }
}

// Display metadata for a verdict code (color + label).
export const VERDICT_META = {
  cashed: { color: 'var(--strong)', label: 'CASHED', icon: 'Check' },
  live: { color: 'var(--accent)', label: 'LIVE', icon: 'Activity' },
  dead: { color: 'var(--bad)', label: 'DEAD', icon: 'X' },
  pending: { color: 'var(--text-faint)', label: 'PREGAME', icon: 'Clock' },
}

// Per-leg status color/icon for the little inline pills.
export const LEG_META = {
  hit: { color: 'var(--strong)', icon: 'Check' },
  live: { color: 'var(--accent)', icon: 'Activity' },
  dead: { color: 'var(--bad)', icon: 'X' },
  pending: { color: 'var(--text-faint)', icon: 'Clock' },
}
