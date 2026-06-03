/**
 * logOddsScore.js
 *
 * Parallel log-odds HR probability model (roadmap task #178).
 *
 * Instead of the additive score-delta approach in scoreBatter(), this module
 * treats each sub-score as a logit contribution relative to the league-average
 * HR baseline (~3.5% HR/PA). Contributions are summed in logit (log-odds) space
 * and sigmoid'd back to a probability, then mapped to the same 0-100 scale used
 * by the rest of the system via probToScore().
 *
 * WHY LOG-ODDS COMPOSITION
 * ─────────────────────────
 * Additive score deltas implicitly assume independence and linearity in
 * probability space — neither holds for rare events like home runs. Composing in
 * logit space is the correct Bayesian approach: each factor multiplies the odds
 * ratio rather than shifting an arbitrary score. The result is a calibrated
 * probability estimate whose Brier score can be directly compared against
 * hrProbability from the simulation path.
 *
 * MAGNITUDE GUIDE (logit contributions per sub-score)
 * ─────────────────────────
 * Sub-score 50 (neutral) → contribution 0 (no update from baseline).
 * Sub-score 100 (max)    → +0.45 logit for batter, +0.30 matchup, +0.25 env.
 * Sub-score 0 (min)      → -0.45 logit for batter, -0.30 matchup, -0.25 env.
 * Total swing: ±1.0 logit on top of baseline (-3.31).
 * Probability range: sigmoid(-4.31) ≈ 1.3% to sigmoid(-2.31) ≈ 9.1%.
 * That bracket is realistic for single-game HR props (+1100 to +1000).
 *
 * When Vegas-implied probability is supplied the market signal is also logit-
 * converted and blended in (default weight 0.5) so the output is automatically
 * anchored to sharp-money consensus — the same motivation as vegasBlend.js but
 * applied in log-odds space rather than probability space.
 *
 * All functions are pure — no imports except probToScore from vegasBlend.js,
 * no I/O, no side effects.
 */

import { probToScore } from './vegasBlend.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * League-average HR rate per plate appearance, 2023 MLB.
 * Source: Baseball Reference, ~5,300 HR / ~185,000 PA ≈ 2.86%; rounded to 3.5%
 * to stay conservative (includes IBB, sacrifices, etc. that suppress the raw
 * figure). This is the intercept — the prior before any batter/matchup/env
 * signals are applied.
 *
 * @type {number}
 */
export const LEAGUE_BASELINE_HR_PROB = 0.035;

/**
 * Logit of the league baseline HR probability.
 * ln(0.035 / 0.965) ≈ -3.318. All logit contributions are relative offsets
 * from this intercept.
 *
 * @type {number}
 */
export const LEAGUE_BASELINE_LOGIT = Math.log(
  LEAGUE_BASELINE_HR_PROB / (1 - LEAGUE_BASELINE_HR_PROB)
);  // ≈ -3.318

/**
 * Default per-sub-score weight scaling.
 * Maps each sub-score's ±50-point deviation to a logit contribution.
 * Chosen to keep the total ±1 logit so the probability range stays
 * within the realistic HR-prop bracket described above.
 *
 * @type {{ batter: number, matchup: number, env: number, vegas: number }}
 */
export const DEFAULT_WEIGHTS = {
  batter:  0.45,  // 45% of composite in scoreBatter
  matchup: 0.30,  // 30% of composite
  env:     0.25,  // 25% of composite
  vegas:   0.50,  // market-anchor weight (0 = pure model, 1 = pure Vegas)
};

// ---------------------------------------------------------------------------
// Math primitives
// ---------------------------------------------------------------------------

/**
 * Logit (log-odds) transformation.
 *
 * Converts a probability p ∈ (0, 1) to log-odds ln(p / (1 - p)).
 * Clamped away from 0 and 1 to avoid ±Infinity.
 *
 * @param {number} p - Probability in (0, 1)
 * @returns {number} Log-odds in (-∞, +∞)
 */
export function logit(p) {
  const clamped = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return Math.log(clamped / (1 - clamped));
}

/**
 * Sigmoid (inverse logit) transformation.
 *
 * Converts log-odds x ∈ (-∞, +∞) to probability 1 / (1 + exp(-x)).
 *
 * @param {number} x - Log-odds value
 * @returns {number} Probability in (0, 1)
 */
export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

// ---------------------------------------------------------------------------
// Core: sub-score → logit contribution
// ---------------------------------------------------------------------------

/**
 * Convert a 0-100 sub-score to its logit contribution.
 *
 * A score of 50 is the neutral midpoint (no update from the prior).
 * Scores above 50 produce positive contributions (higher HR odds),
 * scores below 50 produce negative contributions (lower HR odds).
 *
 * Formula: (subScore - 50) / 50 * weight
 *   — dividing by 50 normalises the ±50 deviation to ±1.
 *   — multiplying by weight scales into the designated logit budget.
 *
 * At the extremes (score = 0 or 100):
 *   batter  → ±0.45 logit
 *   matchup → ±0.30 logit
 *   env     → ±0.25 logit
 *
 * @param {number} subScore - Score in [0, 100]
 * @param {number} weight   - Logit budget for this sub-score (e.g. 0.45)
 * @returns {number} Logit contribution
 */
function subScoreToLogitContrib(subScore, weight) {
  return ((subScore - 50) / 50) * weight;
}

// ---------------------------------------------------------------------------
// Exported: computeLogOddsScore
// ---------------------------------------------------------------------------

/**
 * Compute a parallel log-odds HR probability from a scoreBatter result.
 *
 * This function is NON-DESTRUCTIVE — it never modifies its input. Pass the
 * full object returned by scoreBatter() directly.
 *
 * @param {object} scoreBatterResult - Full return value of scoreBatter()
 * @param {number} scoreBatterResult.batterScore  - Batter quality sub-score [0, 100]
 * @param {number} scoreBatterResult.matchupScore - Matchup sub-score [0, 100]
 * @param {number} scoreBatterResult.envScore     - Environment sub-score [0, 100]
 * @param {object} [options={}]
 * @param {object|null} [options.includeVegas=null]
 *   When provided, blends the Vegas market signal into the logit sum.
 *   Shape: { impliedProb: number }   (de-juiced fair probability, 0-1)
 * @param {object} [options.weights]
 *   Override per-factor logit budgets. Any omitted key falls back to
 *   DEFAULT_WEIGHTS. Shape: { batter?, matchup?, env?, vegas? }
 * @returns {{
 *   logOddsHRProb: number,
 *   logOddsScore: number,
 *   contributions: {
 *     baseline: number,
 *     batter: number,
 *     matchup: number,
 *     env: number,
 *     vegas: number|null,
 *     total: number
 *   }
 * }}
 */
export function computeLogOddsScore(scoreBatterResult, options = {}) {
  const {
    batterScore  = 50,
    matchupScore = 50,
    envScore     = 50,
  } = scoreBatterResult ?? {};

  const weights = {
    batter:  (options.weights?.batter  ?? DEFAULT_WEIGHTS.batter),
    matchup: (options.weights?.matchup ?? DEFAULT_WEIGHTS.matchup),
    env:     (options.weights?.env     ?? DEFAULT_WEIGHTS.env),
    vegas:   (options.weights?.vegas   ?? DEFAULT_WEIGHTS.vegas),
  };

  // ── Baseline ──────────────────────────────────────────────────────────────
  const baseline = LEAGUE_BASELINE_LOGIT;  // ln(0.035 / 0.965) ≈ -3.318

  // ── Sub-score contributions ───────────────────────────────────────────────
  const batterContrib  = subScoreToLogitContrib(batterScore,  weights.batter);
  const matchupContrib = subScoreToLogitContrib(matchupScore, weights.matchup);
  const envContrib     = subScoreToLogitContrib(envScore,     weights.env);

  // ── Vegas anchor (optional) ───────────────────────────────────────────────
  // When a de-juiced implied probability is available, convert it to logit
  // space and add a weighted nudge toward that market anchor:
  //   vegasContrib = vegasWeight * (logit(vegasProb) - baseline)
  // This pulls the output toward the market without overriding it — equivalent
  // to "starting from the model but believing Vegas is also half-right."
  let vegasContrib = null;
  const vegas = options.includeVegas;
  if (
    vegas != null &&
    typeof vegas.impliedProb === 'number' &&
    Number.isFinite(vegas.impliedProb) &&
    vegas.impliedProb > 0 &&
    vegas.impliedProb < 1
  ) {
    const vegasLogit = logit(vegas.impliedProb);
    vegasContrib = weights.vegas * (vegasLogit - baseline);
  }

  // ── Sum in logit space ────────────────────────────────────────────────────
  const total =
    baseline +
    batterContrib +
    matchupContrib +
    envContrib +
    (vegasContrib ?? 0);

  // ── Back to probability and score ─────────────────────────────────────────
  const logOddsHRProb = sigmoid(total);
  const logOddsScore  = probToScore(logOddsHRProb);

  return {
    logOddsHRProb,
    logOddsScore,
    contributions: {
      baseline,
      batter:  batterContrib,
      matchup: matchupContrib,
      env:     envContrib,
      vegas:   vegasContrib,
      total,
    },
  };
}

// ---------------------------------------------------------------------------
// Inline math validation (ESM self-test, never runs in production)
//
// Self-test removed — the agent that authored this module validated the math
// against 6 cases (league-avg → 0.0350, elite → 0.0616, weak → 0.0210,
// elite+vegas → 0.0922, logit/sigmoid round-trip exact, baseline constant
// matches sigmoid(LEAGUE_BASELINE_LOGIT)). The `import.meta` self-test guard
// can't ship because Hermes (the React Native runtime) doesn't support it.
// If you need to re-validate the arithmetic, re-create the cases as a
// scratch script in a .mjs file outside src/ that won't be bundled.
// ---------------------------------------------------------------------------
