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
export const STRATEGIES = [
  { key: 'top',     rank: (b) => b.score ?? 0,                         require: null },
  { key: 'mix',     rank: mixRank,                                     require: null },
  { key: 'stack',   rank: signalScore,                                 require: (b) => signalCount(b) >= 2 },
  { key: 'hot',     rank: (b) => (b.heat ?? 0) * (b.heatMult ?? 1),    require: (b) => b.hot === true || (b.heat ?? 0) >= HOT_HEAT },
  { key: 'power',   rank: powerRank,                                   require: (b) => Number.isFinite(b.barrel) && b.barrel >= 11 },
  { key: 'matchup', rank: (b) => (b.score ?? 0) * (b.pitcherHr9 ?? 0), require: (b) => Number.isFinite(b.pitcherHr9) && b.pitcherHr9 >= 1.3 },
  { key: 'park',    rank: (b) => (b.score ?? 0) * (b.air ?? 0),        require: (b) => Number.isFinite(b.air) && b.air >= 1.08 },
  // Edge Stack — legs where ≥2 distinct matchup signals converge (pitch type,
  // zone, arsenal, platoon, fly-ball environment). Count is the primary rank;
  // model score breaks ties inside makeLegCmp. Orthogonal to `stack`, which
  // surfaces form-based signals (hot/barrel/home/bullpen) from the badge audit.
  { key: 'edge',      rank: edgeCount,                                             require: (b) => edgeCount(b) >= 2 },
  // Precision — requires ALL THREE: pitch mix ≥7, heat ≥75, and ≥9 positive
  // reasons in Today's Outlook. Highly selective; when it has enough legs the
  // picks are the convergence of favorable pitch matchup, genuinely hot form,
  // and a deep stack of positive model signals. Ranks on reasons count + heat.
  { key: 'precision', rank: (b) => (b.positiveReasons ?? 0) + ((b.heat ?? 0) / 100), require: (b) => b.pitchMixEdge === true && (b.heat ?? 0) >= 75 && (b.positiveReasons ?? 0) >= 9 },
]

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

// Eligible legs for a strategy: drop SKIP grades, scoreless rows, gamePk-less
// rows, then anything the strategy's require-gate rejects. Game-state filtering
// (live/final) is the caller's job — both adapters pass pregame-only rows.
function eligible(rows, require) {
  const out = []
  for (const b of rows || []) {
    if (!b || b.gamePk == null) continue
    if ((b.grade || 'SKIP') === 'SKIP') continue
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
  // Each strategy's ranked pool is size-independent — compute once, slice per size.
  const pools = STRATEGIES.map((strat) => {
    const base = favorConsistency ? (b) => strat.rank(b) * (b.consistency ?? 1) : strat.rank
    const elig = eligible(rows, strat.require)
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
