import { decimalToAmerican } from './format.js'
import { gradeFor } from './combo-engine.js'

// Quality grade for a built parlay — the legs' average model score mapped to a
// letter via the shared combo-engine ladder, so the manual builder and the auto
// Parlay Combos cards read consistently. Reflects how strong the picks are, not
// how likely all legs hit (that's the all-hit probability).
export function parlayGrade(legs) {
  if (!legs?.length) return null
  const avgScore = legs.reduce((s, b) => s + (b.score ?? 0), 0) / legs.length
  return { letter: gradeFor(avgScore), avgScore }
}

// ── Same-game correlation ─────────────────────────────────────────────────────
// Same-game HR legs are positively correlated — a shared park, weather, and "this
// game goes off" state lift every bat together — so the true all-hit chance is
// HIGHER than the independent product. We scale the independent joint up by a
// factor that grows with the game's HR environment and the leg count, capped so
// it can never exceed the least-likely single leg (P(all) ≤ P(any)). This is a
// transparent, environment-scaled ESTIMATE, not a fitted model; books still price
// SGPs with a correlation discount, so treat it as directional.
const SGP_CORR_MAX = 0.30

// HR-environment tilt (a park×weather multiplier, 1.0 = neutral) → correlation
// strength in [0, SGP_CORR_MAX]. Neutral / pitcher's parks → ~0 (independent);
// launch pads (≈1.30×+) → the max. Anything below neutral contributes nothing.
export function gameCorrelation(envTilt) {
  if (!Number.isFinite(envTilt)) return 0
  return Math.max(0, Math.min(1, (envTilt - 1) / 0.30)) * SGP_CORR_MAX
}

// Correlation-adjusted all-hit probability for same-game legs. rho=0 returns the
// plain independent product; higher rho inflates it toward (but never past) the
// weakest leg's own HR prob.
export function correlatedJoint(probs, rho) {
  const ps = probs.map((p) => (Number.isFinite(p) ? p : 0))
  const indep = ps.reduce((acc, p) => acc * p, 1)
  if (!(rho > 0) || ps.length < 2) return indep
  const kappa = 1 + rho * (ps.length - 1)
  return Math.min(Math.min(...ps), indep * kappa)
}

// Combine parlay legs. Model probability assumes leg independence (HRs by
// different batters are close enough to independent for a quick read).
// Market figures only resolve when EVERY leg has a priced book.
export function computeParlay(legs) {
  const n = legs.length
  let modelProb = n ? 1 : 0
  let decimal = 1
  let priced = 0
  for (const b of legs) {
    modelProb *= b.hrProbability ?? 0
    const d = b.odds?.best?.decimal
    if (d && d > 1) {
      decimal *= d
      priced++
    }
  }
  const allPriced = n > 0 && priced === n
  const fairDecimal = modelProb > 0 ? 1 / modelProb : null
  return {
    n,
    priced,
    allPriced,
    modelProb,
    fairDecimal,
    fairAmerican: fairDecimal ? decimalToAmerican(fairDecimal) : null,
    decimal: allPriced ? decimal : null,
    american: allPriced ? decimalToAmerican(decimal) : null,
    impliedProb: allPriced ? 1 / decimal : null,
    edge: allPriced ? modelProb * decimal - 1 : null,
  }
}
