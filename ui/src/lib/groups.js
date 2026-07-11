// Auto-generate parlay combos — multi-leg HR parlays that take at most one
// batter per game (HRs by different batters are close enough to independent for
// a quick read; stacking the same game would break that). Several *strategies*
// each produce their own combo per leg-size, so the Groups page offers a range
// of angles — chalk, value, heat, power, lottery — not just the single top tier.
//
// Combo CONSTRUCTION (the strategy menu, ranking, and selection) lives in
// ./combo-engine.js, imported verbatim by the server scorecard too
// (server/parlay-combos.mjs) so the combos shown here == the combos graded. This
// file is the CLIENT side: it maps live batters into the engine's canonical row
// shape, then wraps the engine's combos into display groups (grade, all-hit %,
// market price/edge). The per-leg display helpers below (blast cuts, weakness
// flags, rising form) are UI-only and stay here.

import {
  buildCombos,
  gradeFor,
  allHitProb,
  barrelOf,
  recentBarrelOf,
  blastRate,
  BLAST_ELITE,
  pitchEdgeOf,
  zoneEdgeOf,
  hrPlatoonEdgeOf,
  flyBallMatchupOf,
  positiveReasonCount,
  negativeReasonCount,
  paWeight,
  isBenched,
} from './combo-engine.js'
import { hrSetup } from './scout.js'
import { comboMarket } from './odds.js'
import { NAME_SUFFIXES } from './format.js'

// Re-export the engine's blast threshold for any UI that references it.
export { BLAST_ELITE }

// Only 2/3/4-leg combos are displayed and graded (engine SIZES === [2,3,4]).
const SIZES = [2, 3, 4]

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

// Blast rate (Statcast bat tracking) — the engine owns the recent-preferred
// definition; re-export under the name the rest of the UI already imports.
export const blastOf = (b) => blastRate(b)

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

// Returns true when this batter meets every precision parlay gate — the same
// criteria the precision strategy uses when auto-building combos.
// Precision signal — the hottest elite-barrel bats. RE-TUNED 2026-07-07 to match
// the combo strategy's validated gate (hot & barrel ≥ 12% → 30.3% HR, 2.30× base
// over 7,143 reconciled bats); the old pitch-mix/heat/HR-due/pos/neg gate was
// unvalidatable and never cashed. Keeps the board badge in step with the combo.
export function precisionSignal(b) {
  return b.hot === true && (barrelOf(b) ?? 0) >= 12
}

// Sleeper — a non-PRIME bat with PRIME-adjacent form the board doesn't
// headline. Tuned 2026-07-03 on 30d of reconciled outcomes: STRONG/LEAN bats
// with heat ≥48 + HR setup 3/6+ + a live power surge (hot or rising) homered
// at 20.7% over the trailing 14 days (1.69x base, n=440) — a whisker under
// PRIME's 24.5%, from bats priced much longer. Setup ≥4 measured NO better
// (19.1%) at half the pool, so the gate stays at 3.
export function sleeperSignal(b) {
  const g = b.grade?.label
  if (g !== 'STRONG' && g !== 'LEAN') return false // sleepers aren't the chalk
  if ((b.heatIndex ?? 0) < 48) return false
  if (hrSetup(b).n < 3) return false
  return b.hot === true || risingForm(b) !== null
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

// Display metadata per strategy key — the label/icon/desc the engine doesn't
// carry (it only needs key/rank/require). Keys match combo-engine.js STRATEGIES.
const STRAT_META = {
  precision: { label: 'Precision',    icon: 'ScanSearch', desc: 'hottest elite-barrel bats — power surge + barrel ≥12% · 2.3× HR lift' },
  hot:       { label: 'Hot Hand',     icon: 'Flame',      desc: 'heat-led bats on live power — best audited leg hit rate (42.9%)' },
  matchup:   { label: 'Soft Matchup', icon: 'Target',     desc: 'facing HR-prone pitchers (HR/9 ≥1.3)' },
  mix:       { label: 'Best Mix',     icon: 'Sparkles',   desc: 'grade + barrel + heat blend — best audited all-hit rate' },
  park:      { label: 'Park & Air',   icon: 'Wind',       desc: 'park × weather × hand boosts HR' },
  value:     { label: 'Value',        icon: 'DollarSign', desc: 'the +EV pairing — bats the market underprices (model HR% > the fair line)' },
  edge:      { label: 'Edge Stack',   icon: 'Zap',        desc: '2+ matchup signals converge (pitch type, zones, platoon, fly-ball)' },
  powerReady: { label: 'Power Ready (beta)', icon: 'Gauge',    desc: 'every leg carries the POWER READY (beta) signal — elite ceiling + soft matchup + live form. Unvalidated beta; forward-testing its hit rate.' },
  barrelReady: { label: 'Barrel Ready (beta)', icon: 'Flame',  desc: 'every leg carries the BARREL READY (beta) signal — solid power + genuinely hot form (no matchup gate). Unvalidated beta; forward-testing its hit rate.' },
}

// Map a live scored batter → the engine's canonical combo row. `ref` carries the
// full batter back for display. `heat` is the precomputed Heat Index (scout.js
// via data.js) — the SAME formula the server calls, so neither side recomputes
// it differently. `consistency` feeds the optional favor-consistency lean.
function toComboRow(b, applyLock = false) {
  const barrel = barrelOf(b)
  // Lineup facts — stay LIVE (never frozen): drop benched bats, and scale the
  // pick + HR prob by the batting-order PA weight so the board isn't order-blind.
  const pw = paWeight(b.battingOrder)
  const rawProb = Number.isFinite(b.hrProbability) ? b.hrProbability : null
  const row = {
    ref: b,
    playerId: b.playerId,
    gamePk: b.gamePk,
    battingOrder: Number.isFinite(b.battingOrder) ? b.battingOrder : null,
    paWeight: pw,
    benched: isBenched(b),
    score: b.score,
    grade: b.grade?.label || b.grade || null,
    hrProb: rawProb != null ? rawProb * pw : null,
    heat: Number.isFinite(b.heatIndex) ? b.heatIndex : 0,
    heatMult: Number.isFinite(b.hotnessMultiplier) ? b.hotnessMultiplier : 1,
    barrel,
    recentBarrel: recentBarrelOf(b),
    blast: blastRate(b),
    pitcherHr9: Number.isFinite(b.pitcher?.season?.hrPer9)
      ? b.pitcher.season.hrPer9
      : b.pitcher?.id != null ? 1.25 : null,
    air: Number.isFinite(b.parkWeatherHandFactor) ? b.parkWeatherHandFactor : null,
    // Market edge (model HR prob − de-vigged fair line) — the Value strategy
    // ranks on this to pair the bats the market most underprices. Null pre-odds.
    edge: Number.isFinite(b.edge) ? b.edge : null,
    hot: b.hot === true,
    powerReady: b.powerReady === true,
    barrelReady: b.barrelReady === true,
    homeEdge: b.homeEdge === true,
    awayEdge: b.awayEdge === true,
    bullpenLegend: b.bullpenLegend === true,
    barrelKing: Number.isFinite(barrel) && barrel >= 13,
    // Matchup edge signals (pre-computed by data.js; helpers as canonical fallback)
    pitchEdge:     b.pitchEdge     === true || pitchEdgeOf(b),
    zoneEdge:      b.zoneEdge      === true || zoneEdgeOf(b),
    pitchMixEdge:  b.pitchMixEdge  === true,
    hrPlatoonEdge: b.hrPlatoonEdge === true || hrPlatoonEdgeOf(b),
    flyBallMatchup: b.flyBallMatchup === true || flyBallMatchupOf(b),
    positiveReasons: positiveReasonCount(b),
    negativeReasons: negativeReasonCount(b),
    hrDueScore: hrSetup(b).n,
    consistency: consistencyFactor(b),
  }
  // Morning combo lock (opt-in via the comboLock setting): if the server pinned
  // this bat's strategy-ranking inputs at the lock (b.comboFreeze — see
  // server/parlay-combos freezeComboInputs), use those verbatim so the board's
  // leg selection is frozen for the day and matches the graded record. When the
  // lock is OFF the board re-ranks live from current heat/park/edge signals.
  if (applyLock && b.comboFreeze) Object.assign(row, b.comboFreeze)
  return row
}

// Wrap one engine combo (legs = canonical rows) into a display group: letter
// grade from the legs' avg score, parlay all-hit %, and combined market price /
// edge (only meaningful when every leg has a priced book).
function makeGroup({ strategy, size, legs: rows }) {
  const legs = rows.map((r) => r.ref)
  const meta = STRAT_META[strategy] || { label: strategy, icon: 'Layers', desc: '' }
  // How many legs sit on an unconfirmed (projected/roster) lineup — those bats
  // could still be benched or hit out of a run-producing slot before first pitch.
  const projectedLegs = legs.filter((b) => b.lineupConfirmed !== true).length
  const avgScore = legs.reduce((s, b) => s + (b.score ?? 0), 0) / legs.length
  // Use the comboRow's hrProb (PA-weighted by lineup slot), NOT the raw batter
  // prob, so the all-hit % / EV shown match the pick logic and the graded pred.
  const allHit = allHitProb(rows.map((r) => r.hrProb))
  // Market math (de-juiced) — combined price, betting EV, and the de-vigged
  // "model vs fair line" edge. All null unless every leg has a posted book.
  const market = comboMarket(
    rows.map((r) => ({ american: r.ref.odds?.best?.american, decimal: r.ref.odds?.best?.decimal, modelProb: r.hrProb })),
  )
  return {
    id: `${strategy}-${size}`,
    size,
    strategy,
    label: meta.label,
    icon: meta.icon,
    desc: meta.desc,
    grade: gradeFor(avgScore),
    avgScore,
    allHit,
    projectedLegs,
    legs,
    american: market.american,
    ev: market.ev, // betting EV per $1 (modelAllHit × decimal − 1) — the value sort key
    deJuicedEdge: market.deJuicedEdge, // model all-hit − de-vigged market implied
  }
}

// Fuse two overlapping combos into one bigger ticket (union of the legs).
// Built for the "both 2-legs are green and share a bat — why not the 3-man?"
// case: the shared stud anchors, the union is the model's highest-conviction
// trio. Returns null unless the merge is clean: exactly one shared bat, and
// every leg in a different game (keeps the 1-per-game independence rule).
// Display-only — stacks aren't part of the graded record.
export function mergeGroups(a, b) {
  const aIds = new Set(a.legs.map((x) => x.id))
  const shared = b.legs.filter((x) => aIds.has(x.id))
  if (shared.length !== 1) return null
  const legs = [...a.legs, ...b.legs.filter((x) => !aIds.has(x.id))]
  if (new Set(legs.map((x) => x.gamePk)).size !== legs.length) return null
  const size = legs.length
  const avgScore = legs.reduce((s, x) => s + (x.score ?? 0), 0) / legs.length
  // PA-weight each leg's prob by lineup slot, same as the base combos.
  const legProb = (x) => (Number.isFinite(x.hrProbability) ? x.hrProbability * paWeight(x.battingOrder) : null)
  const allHit = allHitProb(legs.map(legProb))
  const market = comboMarket(
    legs.map((x) => ({ american: x.odds?.best?.american, decimal: x.odds?.best?.decimal, modelProb: legProb(x) })),
  )
  const anchor = shared[0].name
  return {
    id: `stack-${a.strategy}+${b.strategy}-${size}`,
    size,
    strategy: 'stack',
    label: 'Fused Stack',
    icon: 'GitMerge',
    desc: `${a.label} + ${b.label} both run clean and share ${anchor} — fused into one ticket`,
    grade: gradeFor(avgScore),
    avgScore,
    allHit,
    projectedLegs: legs.filter((x) => x.lineupConfirmed !== true).length,
    legs,
    american: market.american,
    ev: market.ev,
    deJuicedEdge: market.deJuicedEdge,
  }
}

// Build the parlay combos for the board, grouped by size. Maps live batters to
// canonical engine rows (skipping finals — not bettable pregame), delegates the
// construction to combo-engine.buildCombos, then wraps each combo for display.
// favorConsistency / incumbents / stickMargin are client-only leans passed
// straight through to the engine (see buildCombos). `includeFinals` keeps
// finished games in the pool — used by the Live tracker (not the betting board)
// so a combo can be followed all day, not dropped the moment a game ends.
export function buildGroups(batters, { maxPerBat = 2, globalMaxPerBat = 4, favorConsistency = false, incumbents = null, stickMargin = 0.05, includeFinals = false, scorecard = null, applyComboLock = false, includeBeta = false } = {}) {
  const rows = (batters || []).filter((b) => includeFinals || !b.game?.isFinal).map((b) => toComboRow(b, applyComboLock))
  const combos = buildCombos(rows, { sizes: SIZES, maxPerBat, globalMaxPerBat, favorConsistency, incumbents, stickMargin, includeBeta })
  const out = {}
  for (const c of combos) {
    ;(out[c.size] ||= []).push(makeGroup(c))
  }
  // Sort within each size by historical leg hit rate (descending) when scorecard
  // data is available. Strategies with no history (null) sort after those with a
  // real track record; ties fall back to STRATEGIES array order (already stable).
  if (scorecard?.byStrategy) {
    const hr = (g) => scorecard.byStrategy[g.strategy]?.legHitRate ?? -1
    for (const size of Object.keys(out)) out[size].sort((a, b) => hr(b) - hr(a))
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
  let last = parts[parts.length - 1]
  let firstEnd = parts.length - 1
  // Keep a generational suffix attached to the surname so "Luis García Jr." →
  // "García Jr., Luis" (and its split(',')[0] shows "García Jr.", not "Jr.").
  if (NAME_SUFFIXES.has(last.toLowerCase()) && parts.length >= 3) {
    last = `${parts[parts.length - 2]} ${last}`
    firstEnd = parts.length - 2
  }
  const first = parts.slice(0, firstEnd).join(' ')
  return `${last}, ${first}`
}

// ISO (slugging minus average) — prefer the hot recent-7 window, else season.
export function isoOf(b) {
  if (Number.isFinite(b.recent7?.iso)) return b.recent7.iso
  const s = b.season
  if (s && Number.isFinite(s.slg) && Number.isFinite(s.avg)) return s.slg - s.avg
  return null
}
