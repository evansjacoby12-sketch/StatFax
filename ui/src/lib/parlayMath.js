// parlayMath.js — the single parlay probability and market-math core.
//
// Every parlay surface consumes THIS module so the numbers never drift:
//   • ParlayBuilder.jsx  — the unified builder (hand-pick + auto-suggest)
//   • ParlaySlip.jsx     — the floating quick slip
//   • SameGameView.jsx   — same-game parlays
//   • groups.js          — auto Parlay Combos market math (via comboMarket)
//
// What the rework fixes vs the old fragmented code:
//   1. ONE all-hit model. Every surface uses the independent product of the
//      calibrated leg rates. Same-game grouping is retained for disclosure and
//      for a future uplift only after it is fitted on settled outcomes.
//   2. De-vigged market everywhere. The slip showed a raw book price with no
//      vig removed; now every surface gets the fair (de-juiced) line, betting
//      EV, and the probability edge vs a fair market.
//
// Pure ESM (no React/DOM) so Node tests import it directly.

import { decimalToAmerican } from './format.js'
import { americanToDecimal, dejuicedImpliedProb, dejuicedEdge } from './odds.js'
import { gradeFor } from './combo-engine.js'

// ── Same-game correlation ────────────────────────────────────────────────────
// Disabled until a positive residual SGP correlation is fitted and validated
// on settled tickets. Shared park/weather are already known model inputs.
export const SGP_CORR_MAX = 0

// HR-environment tilt (park×weather multiplier, 1.0 = neutral) → correlation
// strength in [0, SGP_CORR_MAX]. Neutral / pitcher's parks → ~0 (independent);
// launch pads (≈1.30×+) → the max.
export function gameCorrelation(envTilt) {
  if (!Number.isFinite(envTilt)) return 0
  return Math.max(0, Math.min(1, (envTilt - 1) / 0.3)) * SGP_CORR_MAX
}

// Correlation-adjusted all-hit for a set of same-game legs. rho=0 returns the
// plain independent product; higher rho inflates it toward (never past) the
// weakest leg's own HR prob.
export function correlatedJoint(probs, rho) {
  const ps = probs.map((p) => (Number.isFinite(p) ? p : 0))
  const indep = ps.reduce((acc, p) => acc * p, 1)
  if (!(rho > 0) || ps.length < 2) return indep
  const kappa = 1 + rho * (ps.length - 1)
  return Math.min(Math.min(...ps), indep * kappa)
}

// Average HR-environment tilt for a game's legs: prefer the per-bat park ×
// weather × hand factor, fall back to the game's park-only factor, else neutral.
export function envTiltOf(legs) {
  const hand = legs.map((b) => b.parkWeatherHandFactor).filter(Number.isFinite)
  if (hand.length) return hand.reduce((s, x) => s + x, 0) / hand.length
  const park = legs.map((b) => b.gameParkHRFactor).filter(Number.isFinite)
  return park.length ? park.reduce((s, x) => s + x, 0) / park.length : 1
}

// Group legs by gamePk (legs without one are treated as solo games).
export function groupByGame(legs) {
  const m = new Map()
  for (const b of legs || []) {
    const k = b.gamePk != null ? `g${b.gamePk}` : `solo-${b.id ?? b.playerId ?? Math.random()}`
    if (!m.has(k)) m.set(k, { gamePk: b.gamePk ?? null, legs: [] })
    m.get(k).legs.push(b)
  }
  return [...m.values()]
}

/**
 * All-hit probability for an arbitrary parlay.
 *
 * Groups legs by game for disclosure. The fitted correlation cap is currently
 * zero, so every group uses the independent product.
 *
 * Returns { modelAllHit, independent, sameGame, allFinite, byGame } where byGame
 * carries each game's { gamePk, legs, rho, joint, indep } for display.
 */
export function parlayAllHit(legs, { correlate = true } = {}) {
  const list = legs || []
  const allFinite = list.every((b) => Number.isFinite(b.hrProbability))
  // An empty parlay has no chance to "all hit" — 0, not the reduce identity 1.
  const independent = list.length
    ? list.reduce((acc, b) => acc * (Number.isFinite(b.hrProbability) ? b.hrProbability : 0), 1)
    : 0
  if (!correlate || list.length === 0) {
    return { modelAllHit: independent, independent, sameGame: false, allFinite, byGame: [] }
  }
  let model = 1
  let sameGame = false
  const byGame = []
  for (const { gamePk, legs: gl } of groupByGame(list)) {
    const ps = gl.map((b) => b.hrProbability)
    const indep = ps.reduce((acc, p) => acc * (Number.isFinite(p) ? p : 0), 1)
    let rho = 0
    let joint = indep
    if (gl.length >= 2) {
      sameGame = true
      rho = gameCorrelation(envTiltOf(gl))
      joint = correlatedJoint(ps, rho)
    }
    model *= joint
    byGame.push({ gamePk, legs: gl, rho, joint, indep })
  }
  return { modelAllHit: model, independent, sameGame, allFinite, byGame }
}

/**
 * Market figures for a parlay's legs against modelAllHit.
 * De-vigs each leg, multiplies the book decimals, and derives betting EV + the
 * probability edge vs a fair line. Reads each leg's posted odds from
 * b.odds.best. Returns market fields + a perLeg breakdown.
 */
export function parlayMarket(legs, modelAllHit) {
  let decimal = 1
  let priced = 0
  let dj = 1
  let djOk = true
  const perLeg = []
  for (const b of legs || []) {
    const am = b.odds?.best?.american
    const dec = b.odds?.best?.decimal
    const d = Number.isFinite(dec) ? dec : americanToDecimal(am)
    if (d && d > 1) {
      decimal *= d
      priced++
    }
    const fair = dejuicedImpliedProb(am, b.odds?.best?.noAmerican ?? null)
    if (fair != null) dj *= fair
    else djOk = false
    perLeg.push({
      id: b.id,
      american: am ?? null,
      decimal: d ?? null,
      fairImplied: fair,
      edge: dejuicedEdge(b.hrProbability, am ?? null, b.odds?.best?.noAmerican ?? null),
    })
  }
  const n = (legs || []).length
  const allPriced = n > 0 && priced === n
  const deJuicedImplied = allPriced && djOk ? dj : null
  const ev = allPriced && Number.isFinite(modelAllHit) ? modelAllHit * decimal - 1 : null
  const edge = deJuicedImplied != null && Number.isFinite(modelAllHit) ? modelAllHit - deJuicedImplied : null
  return {
    allPriced,
    priced,
    decimal: allPriced ? decimal : null,
    american: allPriced ? decimalToAmerican(decimal) : null,
    deJuicedImplied,
    ev,
    edge,
    perLeg,
  }
}

// Quality grade for a parlay — the legs' average model score on the shared
// S/A/B/D ladder. Reflects how strong the picks are, not the all-hit odds.
export function parlayGrade(legs) {
  if (!legs?.length) return null
  const avgScore = legs.reduce((s, b) => s + (b.score ?? 0), 0) / legs.length
  return { letter: gradeFor(avgScore), avgScore }
}

// The weakest leg (lowest HR prob, score as tiebreak) — the parlay's "link most
// likely to break". null for singles.
export function weakestLeg(legs) {
  if (!legs || legs.length < 2) return null
  return [...legs].sort(
    (a, b) =>
      (a.hrProbability ?? 1) - (b.hrProbability ?? 1) ||
      (a.score ?? 0) - (b.score ?? 0) ||
      String(a.id).localeCompare(String(b.id)),
  )[0]
}

/**
 * One-stop parlay summary consumed by every surface. Combines all-hit,
 * de-vigged market, fair price, grade, and weak link. `correlate` remains in the
 * contract for a future validated model; with the current zero cap it adds no uplift.
 */
export function buildParlay(legs, { correlate = true } = {}) {
  const list = legs || []
  const n = list.length
  const { modelAllHit, independent, sameGame, allFinite, byGame } = parlayAllHit(list, { correlate })
  const market = parlayMarket(list, modelAllHit)
  const fairDecimal = modelAllHit > 0 ? 1 / modelAllHit : null
  return {
    n,
    legs: list,
    allFinite,
    modelAllHit,
    independent,
    sameGame,
    byGame,
    // Market
    allPriced: market.allPriced,
    priced: market.priced,
    decimal: market.decimal,
    american: market.american,
    deJuicedImplied: market.deJuicedImplied,
    ev: market.ev,
    edge: market.edge,
    perLeg: market.perLeg,
    // Fair (model-implied) price when the book line is missing
    fairDecimal,
    fairAmerican: fairDecimal ? decimalToAmerican(fairDecimal) : null,
    // Quality
    grade: parlayGrade(list),
    weak: weakestLeg(list),
  }
}
