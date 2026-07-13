/**
 * livePADecay.js
 *
 * Bayesian PA-remaining decay for live games.
 *
 * As a game progresses and a batter consumes plate appearances, their
 * remaining HR probability falls — fewer chances left. This module
 * converts an original 0-100 score into a decayed score proportional
 * to remaining PAs in the game.
 *
 * Math:
 *   perPAProb  = 1 - (1 - fullGameProb)^(1/4)   // invert 4-PA binomial
 *   remainProb = 1 - (1 - perPAProb)^remainingPAs
 *   newScore   = probToScore(remainProb)
 *
 * Uses scoreToProb / probToScore from vegasBlend.js — no duplication.
 */

import { scoreToProb, probToScore } from './vegasBlend.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Assumed average plate appearances per game for a typical lineup slot. */
const AVG_GAME_PAS = 4;

// ---------------------------------------------------------------------------
// Exported: estimateRemainingPAs
// ---------------------------------------------------------------------------

/**
 * Estimate the number of plate appearances a batter has remaining in a game.
 *
 * Model:
 *   - A batter in the 9-man lineup gets approximately 4 PAs across a 9-inning game.
 *   - completedPAs ≈ currentInning × (1 - (battingOrder - 1) / 9)
 *     but simplified to: how many full lineup cycles have passed, discounted
 *     by the batter's position in the order.
 *   - inningProgress ∈ [0, 9]: treat currentInning as fully-elapsed innings.
 *   - remainingPAs = max(0, 4 - floor(currentInning × (1 + (battingOrder-1)/9) / 9 × 4))
 *
 * Simpler, robust form (used here):
 *   completedFraction = (currentInning - 1 + (battingOrder - 1) / 9) / 9
 *   remainingPAs = round(max(0, AVG_GAME_PAS × (1 - completedFraction)))
 *   clamped to [0, AVG_GAME_PAS]
 *
 * @param {number} battingOrder - 1-indexed batting spot (1-9)
 * @param {number} currentInning - current inning (1-based; 0 or null → pre-game)
 * @returns {number} Estimated remaining PAs, integer in [0, AVG_GAME_PAS]
 */
export function estimateRemainingPAs(battingOrder, currentInning) {
  const spot   = (typeof battingOrder === 'number' && battingOrder >= 1 && battingOrder <= 9) ? battingOrder : 5;
  const inning = (typeof currentInning === 'number' && currentInning >= 1) ? currentInning : 0;

  // Fraction of the game elapsed from the perspective of this batter's slot.
  // A leadoff hitter (spot=1) has batted more by any given inning than a 9-hole hitter.
  const completedFraction = (inning - 1 + (spot - 1) / 9) / 9;

  const remaining = AVG_GAME_PAS * (1 - completedFraction);
  return Math.min(AVG_GAME_PAS, Math.max(0, Math.round(remaining)));
}

// ---------------------------------------------------------------------------
// Exported: applyPADecay
// ---------------------------------------------------------------------------

/**
 * Apply Bayesian PA-remaining decay to a pre-game score.
 *
 * Converts the full-game score to a probability, derives per-PA probability
 * by inverting the binomial CDF over AVG_GAME_PAS chances, then recomputes
 * the probability for only remainingPAs chances. The result is re-scored.
 *
 * Edge cases:
 *   - remainingPAs === 0 → probability is 0 → returns score 0
 *   - remainingPAs >= AVG_GAME_PAS → full game ahead → returns original score
 *
 * @param {number} score - Original 0-100 StatFax score (pre-game)
 * @param {number} remainingPAs - Integer [0, AVG_GAME_PAS] from estimateRemainingPAs()
 * @returns {number} Decayed score [0, 100]
 */
export function applyPADecay(score, remainingPAs) {
  if (remainingPAs >= AVG_GAME_PAS) return score;
  if (remainingPAs <= 0) return 0;

  const fullGameProb = scoreToProb(score);

  // Derive per-PA probability from the full-game binomial model.
  // fullGameProb = 1 - (1 - perPA)^N  →  perPA = 1 - (1 - fullGameProb)^(1/N)
  const perPAProb = 1 - Math.pow(1 - fullGameProb, 1 / AVG_GAME_PAS);

  // Recompute probability for the remaining PA count.
  const remainingProb = 1 - Math.pow(1 - perPAProb, remainingPAs);

  return probToScore(remainingProb);
}
