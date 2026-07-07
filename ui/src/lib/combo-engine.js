// combo-engine.js — the single source of truth for Parlay Combo construction.
//
// Both consumers import THIS module so the combos a user sees == the combos the
// scorecard grades:
//   • ui/src/lib/groups.js      — live board (full batter objects, display)
//   • server/parlay-combos.mjs  — frozen pregame snapshot → graded record
//
// It owns the parts that must never drift: the strategy menu (rank + eligibility
// per strategy), the per-leg field-derivation helpers, the anti-flicker ranking
// comparator, and the diversity-capped selection algorithm. Each consumer keeps
// its OWN thin adapter mapping its raw rows into the canonical "combo row" shape
// below — that's the only place the two sides legitimately differ (the client
// reads LIVE fields; the server reads FROZEN pregame ones).
//
// Pure ESM: no React, no Vite-only syntax, no DOM, so Node (server + tests) can
// import it directly. The one import is HOT_HEAT from ./constants.js (the single
// hot-bat threshold shared with the UI filters); that chain is pure too.
//
// ── Canonical combo-row shape (what the strategies read) ──
//   playerId, gamePk            identity (one leg per gamePk)
//   score (number)             model score 0–100 — eligibility + several ranks
//   grade (string|null)        tier label; 'SKIP'/null is ineligible
//   heat (number)              Heat Index 0–100 (scout.heatIndex — see adapters)
//   heatMult (number)          live hotness multiplier (≈1)
//   barrel (number|null)       season barrel% (BBE-preferred)
//   recentBarrel (number|null) L14 barrel% when a real sample, else null
//   blast (number|null)        bat-tracking blast rate %
//   pitcherHr9 (number|null)   opposing starter HR/9 (1.25 prior when no sample)
//   air (number|null)          park × weather × hand factor
//   hot, homeEdge, awayEdge, bullpenLegend, barrelKing (bool) — Signal Stack
//   consistency (number)       optional client K-rate lean factor (default 1)

import { HOT_HEAT } from './constants.js'

export const SIZES = [2, 3, 4]
export const BLAST_ELITE = 25 // elite blast rate (≈ top ~8% of the slate)

// ── Per-leg field derivation (shared by both adapters) ──────────────────────
// Season barrel%, preferring the BBE-denominated rate.
export function barrelOf(raw) {
  if (Number.isFinite(raw?.barrelPctBBE)) return raw.barrelPctBBE
  return Number.isFinite(raw?.barrelPct) ? raw.barrelPct : null
}
// Recent (L14) barrel% — only when there's a real sample (≥6 BBE), else null so
// the power rank falls back to season instead of trusting a 1-ball blip.
export function recentBarrelOf(raw) {
  const rb = raw?.recentBarrel?.recentBarrelPct
  return Number.isFinite(rb) && (raw?.recentBarrel?.recentBBE ?? 0) >= 6 ? rb : null
}
// Blast rate (Statcast bat tracking) — "blast" = a swing that's both fast and
// squared-up, the most HR-predictive slice. Prefer the recent ~2-week window
// (live power) when it has a real swing sample; fall back to season.
export function blastRate(raw) {
  const t = raw?.batTracking
  if (!t) return null
  if (Number.isFinite(t.recentBlastPerContact) && (t.recentSwings ?? 0) >= 25) return t.recentBlastPerContact
  return Number.isFinite(t.blastPerContact) ? t.blastPerContact : null
}

// Count of eli5Reasons with tone === 'good' — the "positive trends" the user
// sees in the Trends tab. Shared by both adapters so neither recomputes it.
export const positiveReasonCount = (raw) =>
  (raw?.eli5Reasons || []).filter((r) => r?.tone === 'good').length

// Count of eli5Reasons with tone === 'bad' — negative flags in the Trends tab.
export const negativeReasonCount = (raw) =>
  (raw?.eli5Reasons || []).filter((r) => r?.tone === 'bad').length

// ── Matchup edge derivations — shared by both adapters ──────────────────────
// These pull raw per-batter fields into the booleans that both toComboRow
// (client) and comboRowFromSnapshot (server) attach to the canonical row.
// Keeping them here means a single code path defines the signal on both sides.
export const pitchEdgeOf     = (raw) => raw?.primaryPitchEdge?.passes === true
export const zoneEdgeOf      = (raw) => (raw?.zoneMatchup?.matchedZones?.length ?? 0) >= 2
export const flyBallMatchupOf = (raw) =>
  (raw?.pitcher?.season?.ip ?? 0) >= 30 && (raw?.pitcher?.season?.goAo ?? 99) <= 0.92
export function hrPlatoonEdgeOf(raw) {
  const sp = raw?.pitcher?.splits
  if (!sp) return false
  const phand = raw?.pitcher?.hand
  const effSide = raw?.batSide === 'S' ? (phand === 'L' ? 'R' : 'L') : raw?.batSide
  const onSide  = effSide === 'L' ? sp.vl : sp.vr
  const offSide = effSide === 'L' ? sp.vr : sp.vl
  if (!onSide || !offSide) return false
  if ((onSide.ip ?? 0) < 12 || (offSide.ip ?? 0) < 12) return false
  const on = onSide.hrPer9, off = offSide.hrPer9
  if (!Number.isFinite(on) || on < 1.2) return false
  return off > 0 ? on >= 1.3 * off : true
}

// ── Signal Stack ────────────────────────────────────────────────────────────
// Proven HR signals weighted by the badge audit's within-grade lift (hot &
// barrelKing carry the most; road edge the least). "due" is excluded — it's the
// gambler's-fallacy signal we falsified.
export const STACK_SIGNALS = { hot: 3, barrelKing: 2, homeEdge: 2, bullpenLegend: 2, awayEdge: 1.5 }
export const signalScore = (b) => Object.entries(STACK_SIGNALS).reduce((s, [k, w]) => s + (b[k] ? w : 0), 0)
export const signalCount = (b) => Object.keys(STACK_SIGNALS).reduce((n, k) => n + (b[k] ? 1 : 0), 0)

// ── Matchup Edge count ───────────────────────────────────────────────────────
// Counts how many pitch/zone/platoon/park matchup signals fire for a leg. The
// `edge` strategy gates on ≥2 and ranks primarily on count (more convergent
// signals = stronger leg), with model score as a tiebreaker inside the comparator.
export const EDGE_SIGNALS = ['pitchEdge', 'zoneEdge', 'pitchMixEdge', 'hrPlatoonEdge', 'flyBallMatchup']
export const edgeCount = (b) => EDGE_SIGNALS.reduce((n, k) => n + (b[k] ? 1 : 0), 0)

// Expected plate appearances by lineup slot (MLB averages), normalized to the
// 9-slot mean so the multiplier centers near 1.0. HR chance scales roughly
// linearly with PAs, so a leadoff bat is worth ~+10% and a 9-hole bat ~-11% vs
// an order-blind clone. Null / not-yet-posted order → 1.0 (neutral): before
// lineups drop the board stays order-agnostic, then tilts toward the bats who'll
// actually get the extra cut. Applied to the combo rank AND the leg HR prob so
// both the pick and the all-hit % stop being lineup-blind.
const PA_BY_SLOT = [4.65, 4.55, 4.45, 4.35, 4.25, 4.12, 4.0, 3.88, 3.76]
const PA_MEAN = PA_BY_SLOT.reduce((s, x) => s + x, 0) / PA_BY_SLOT.length
export function paWeight(battingOrder) {
  const o = Math.round(battingOrder)
  if (!Number.isFinite(o) || o < 1 || o > 9) return 1
  return PA_BY_SLOT[o - 1] / PA_MEAN
}

// A bat is benched when its side's lineup is CONFIRMED but it has no order slot —
// it won't hit, so it can't homer. Excluded from the combo pool. Before the
// lineup posts (unconfirmed) everyone is eligible on the projected board.
export const isBenched = (b) => b.lineupConfirmed === true && !Number.isFinite(b.battingOrder)

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x))
const norm01 = (v, hi) => clamp((v ?? 0) / hi, 0, 1)

// Best Mix — a cross-metric blend so a great-overall bat and an elite-barrel bat
// can land in the SAME combo (the single-metric strategies silo them). Weights:
// score 0.5 (grade is the dominant HR signal — PRIME 2.29× in the audit), barrel
// 0.25 and heat 0.25 (≈tied secondary signals, so they split the rest).
export const mixRank = (b) =>
  0.5 * ((b.score ?? 0) / 100) +
  0.25 * norm01(b.barrel, 25) +
  0.25 * ((b.heat ?? 0) / 100)

// Power — season barrel (45%) + recent L14 barrel (30%, season fallback) + blast
// rate (25%), all normalized 0–1. Blast is the bat-speed/squared-up leg of raw
// power; recent barrel rewards current form, not just career barrel kings.
export const powerRank = (b) =>
  0.45 * norm01(b.barrel, 25) +
  0.30 * (Number.isFinite(b.recentBarrel) ? norm01(b.recentBarrel, 25) : norm01(b.barrel, 25)) +
  0.25 * norm01(b.blast, 30)

// ── Strategy menu — the no-odds subset. Each ranks the eligible pool by its own
// metric; `require` gates which legs qualify. Display label/icon/desc live with
// the client (groups.js STRAT_META) — the engine only needs key/rank/require.
//
// matchup & park anchor on batter quality (score) × the environmental tilt, so a
// homer-prone matchup / launch pad LIFTS a good bat instead of ranking a weak
// bat on the ~1.0–1.3× signal alone. hot ranks on heatIndex × the recent-form
// multiplier (both heat signals) rather than the score, so it doesn't just
// re-pick `top`'s legs. Gates (barrel ≥ 11, hr9 ≥ 1.3, air ≥ 1.08) sit a notch
// above neutral so each strategy surfaces distinct bats, not the same elite tier.
// Ordered best-first by the 2026-07-05→07 reconciled record (21 graded days,
// 358 combos). Order matters: earlier strategies claim their picks first under
// the diversity caps and lead the display, so the proven earners (hot 14.9%,
// mix 11.1%, park 9.5% cash) sit up top and the laggards (matchup 6.3%; edge
// 0/18, precision 0/12) trail. Precision keeps its tight gate but is demoted off
// the top slot it used to hold; edge is last pending a re-tune.
export const STRATEGIES = [
  // Hot Hand — heat × recent-form multiplier. Best in the graded record:
  // 14.9% all-hit, 45% legs. Ranks on heat, not score, so it surfaces different
  // bats than mix/matchup.
  { key: 'hot',       rank: (b) => (b.heat ?? 0) * (b.heatMult ?? 1),                            require: (b) => (b.heat ?? 0) >= 58 },
  // Best Mix — score + barrel + heat blend. 11.1% all-hit, 36% legs.
  { key: 'mix',       rank: mixRank,                                                              require: null },
  // Park & Air — park × weather × hand factor. 9.5% all-hit, 43% legs.
  { key: 'park',      rank: (b) => (b.score ?? 0) * (b.air ?? 0),                               require: (b) => Number.isFinite(b.air) && b.air >= 1.08 },
  // Soft Matchup — batter quality × pitcher HR/9. Mid-pack: 6.3% all-hit, 31% legs.
  { key: 'matchup',   rank: (b) => (b.score ?? 0) * (b.pitcherHr9 ?? 0),                        require: (b) => Number.isFinite(b.pitcherHr9) && b.pitcherHr9 >= 1.3 },
  // Precision — pitch mix ≥7 · heat ≥48 · HR due 5/6+ · 8+ positive trends · ≤3
  // negatives. Tight gate, fires rarely (12 combos in 21d) and hasn't cashed —
  // kept as a high-conviction diversifier, demoted from the top slot. Its gate
  // is due a data-driven re-tune once more sample accrues.
  { key: 'precision', rank: (b) => (b.positiveReasons ?? 0) - (b.negativeReasons ?? 0) + ((b.heat ?? 0) / 100), require: (b) => b.pitchMixEdge === true && (b.heat ?? 0) >= 48 && (b.hrDueScore ?? 0) >= 5 && (b.positiveReasons ?? 0) >= 8 && (b.negativeReasons ?? 0) <= 3 },
  // Edge Stack — ≥2 matchup signals converge (pitch type, zone, arsenal, platoon,
  // fly-ball). 35% legs but 0/18 all-hit — decent leg-picker, never cashed as a
  // combo. Last in order pending a re-tune; a candidate to cut if it stays cold.
  { key: 'edge',      rank: edgeCount,                                                            require: (b) => edgeCount(b) >= 2 },
]

// Keys of strategies that CURRENTLY exist — used to prune the scorecard of dead
// strategies (top/power were removed but still sit in old graded records).
export const STRATEGY_KEYS = new Set(STRATEGIES.map((s) => s.key))

// Letter grade from a combo's average leg score (the shared S/A/B/C/D ladder).
export function gradeFor(avgScore) {
  if (avgScore >= 76) return 'S'
  if (avgScore >= 70) return 'A'
  if (avgScore >= 62) return 'B'
  if (avgScore >= 54) return 'C'
  return 'D'
}

// Parlay all-hit probability = product of independent leg HR probs. Returns null
// when ANY leg lacks a finite prob, so a missing leg reads as "unknown" instead
// of silently collapsing the whole combo to 0.
export function allHitProb(probs) {
  return probs.every((p) => Number.isFinite(p)) ? probs.reduce((acc, p) => acc * p, 1) : null
}

// ── Anti-flicker ranking ─────────────────────────────────────────────────────
// Ranks are quantized to a grid sized to the pool's own rank spread (RANK_TOL
// fraction of max−min), so sub-threshold wobble can't reorder near-tied legs
// run-to-run; exact ties break by a STABLE playerId. Quantizing relative to the
// spread keeps the tolerance comparable across strategies whose raw ranks live
// on very different scales (integer stack weights vs 0–1 mix vs score×factor).
export const RANK_TOL = 0.002
function quantize(x, tol) {
  if (!Number.isFinite(x)) return -Infinity
  if (!(tol > 0)) return x
  return Math.round(x / tol) * tol
}
function rankSpan(rank, items) {
  let lo = Infinity, hi = -Infinity
  for (const b of items) {
    const r = rank(b)
    if (Number.isFinite(r)) { if (r < lo) lo = r; if (r > hi) hi = r }
  }
  return hi > lo ? hi - lo : 0
}
function makeLegCmp(rank, items) {
  let lo = Infinity, hi = -Infinity, sLo = Infinity, sHi = -Infinity
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

const COMBO_TIERS = new Set(['PRIME', 'STRONG'])

// Eligible legs for a strategy: only PRIME/STRONG grades, scoreless rows and
// gamePk-less rows are dropped, then anything the strategy's require-gate rejects.
// Game-state filtering (live/final) is the caller's job.
function eligible(rows, require) {
  const out = []
  for (const b of rows || []) {
    if (!b || b.gamePk == null) continue
    if (!COMBO_TIERS.has(b.grade || 'SKIP')) continue
    if (!Number.isFinite(b.score)) continue
    if (require && !require(b)) continue
    out.push(b)
  }
  return out
}

// Best eligible leg per game by a metric.
function topPerGame(elig, rank) {
  const cmp = makeLegCmp(rank, elig)
  const byGame = new Map()
  for (const b of elig) {
    const cur = byGame.get(b.gamePk)
    if (!cur || cmp(b, cur) < 0) byGame.set(b.gamePk, b)
  }
  return [...byGame.values()].sort(cmp)
}

/**
 * Build the canonical combos — one per strategy per size, deduped, with leg
 * diversity caps. Returns [{ strategy, size, legs: [row, …] }] where each `row`
 * is the SAME object the caller passed in (so the client recovers its batter via
 * row.ref and the server its playerId).
 *
 * Caps (anti-correlated-wipeout): a bat anchors at most `maxPerBat` combos per
 * size and ~`globalMaxPerBat` across all sizes, so one cold night can't sink the
 * whole board. Strategies run in array order, so the headline ones (top, mix)
 * keep their purest picks while the tail diversifies. A two-pass take prefers
 * bats under the global cap, relaxes to per-size only, then falls back to the
 * pure slice rather than drop a strategy.
 *
 * Optional client-only leans: `favorConsistency` (down-weights high-K bats via
 * row.consistency) and `incumbents` (sticky legs — an additive rank bonus sized
 * to the pool's spread, so a leg only changes when a challenger is clearly
 * better). The server passes neither, so its build is deterministic.
 */
export function buildCombos(rows, {
  sizes = SIZES,
  maxPerBat = 2,
  globalMaxPerBat = 4,
  favorConsistency = false,
  incumbents = null,
  stickMargin = 0.05,
} = {}) {
  // Drop benched bats (confirmed lineup, no order slot — they can't homer). The
  // adapters precompute `benched` and `paWeight` from the (live) lineup so the
  // freeze can't pin them: bench status + batting order are the FACTS meant to
  // move the board as lineups post, distinct from the frozen strategy signals.
  const usable = (rows || []).filter((r) => !r.benched)
  // Each strategy's ranked pool is size-independent — compute once, slice per size.
  const pools = STRATEGIES.map((strat) => {
    // Tilt every strategy's rank by the leg's expected-PA weight (lineup slot),
    // so a hot 8-hole bat doesn't beat a comparable top-of-order bat who gets an
    // extra cut. Neutral (×1) until the order posts. Consistency lean still opt-in.
    const base = (b) => strat.rank(b) * (b.paWeight ?? 1) * (favorConsistency ? (b.consistency ?? 1) : 1)
    const elig = eligible(usable, strat.require)
    const inc = incumbents?.[strat.key]
    let rank = base
    if (inc && inc.size) {
      const bonus = stickMargin * rankSpan(base, elig)
      rank = (b) => base(b) + (inc.has(b.playerId) ? bonus : 0)
    }
    return { strat, pool: topPerGame(elig, rank) }
  })

  const out = []
  const usedGlobal = {} // exposure across ALL sizes
  for (const size of sizes) {
    const seen = new Set() // dedupe identical leg sets across strategies, per size
    const used = {} // per-size diversity cap
    for (const { strat, pool } of pools) {
      if (pool.length < size) continue
      const take = (globalCapped) => {
        const legs = []
        for (let i = 0; i < pool.length && legs.length < size; i++) {
          const b = pool[i]
          if ((used[b.playerId] || 0) >= maxPerBat) continue
          if (globalCapped && (usedGlobal[b.playerId] || 0) >= globalMaxPerBat) continue
          legs.push(b)
        }
        return legs
      }
      let legs = take(true) // prefer under-global-cap bats
      if (legs.length < size) legs = take(false) // relax global cap before dropping
      if (legs.length < size) legs = pool.slice(0, size) // keep the strategy pure rather than drop it
      const sig = legs.map((l) => l.playerId).slice().sort((a, b) => a - b).join('-')
      if (seen.has(sig)) continue
      seen.add(sig)
      for (const l of legs) {
        used[l.playerId] = (used[l.playerId] || 0) + 1
        usedGlobal[l.playerId] = (usedGlobal[l.playerId] || 0) + 1
      }
      out.push({ strategy: strat.key, size, legs })
    }
  }
  return out
}
