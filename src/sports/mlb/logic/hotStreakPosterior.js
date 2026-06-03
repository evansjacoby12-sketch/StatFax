/**
 * hotStreakPosterior — Bayesian change-point detection for batter hot streaks.
 *
 * Why not the binary `hot` flag?
 * --------------------------------
 * The legacy `isHot` flag is a step function: a batter is either Hot or Not.
 * Two problems:
 *
 *   (1) CONTINUOUS vs DISCRETE signal
 *       A batter who just started heating up (ISO trending from 0.100 → 0.180)
 *       gets the same weight as a batter who's been absolutely mashing for two
 *       weeks (ISO 0.320). The posterior gives them different scores: ~0.52 vs
 *       ~0.89. This translates directly into a finer-grained HR-probability
 *       adjustment instead of a flat ±X% override.
 *
 *   (2) EFFECT SIZE weighting
 *       A batter barely above his rolling average is not generating the same
 *       evidence of a regime shift as one who is 3 sigma above. Bayesian
 *       log-likelihood accumulates evidence across all recent games; the
 *       binary flag treats "one good week" the same regardless of how good.
 *
 * Algorithm
 * ---------
 * We model two regimes:
 *   hot    — ISO drawn from N(hotMean,  sigma²)
 *   normal — ISO drawn from N(coldMean, sigma²)
 *
 * For each game in the rolling window, we compute the log-likelihood of the
 * observed ISO under each regime. We then apply Bayes' theorem:
 *
 *   P(hot | data) = P(data | hot) × P(hot) / P(data)
 *
 * where P(data) = P(data|hot)×P(hot) + P(data|normal)×P(normal).
 *
 * "Change likelihood" is a secondary signal: we split the window into the
 * last 3 games vs the prior 7, compute the mean ISO difference, and
 * normalize it to [0,1] via a sigmoid-like transform. This lets the UI
 * surface "just heated up" differently from "been hot all week."
 *
 * Multiplier mapping
 * ------------------
 * The posterior → multiplier function is deliberately conservative:
 *   • Neutral band [0.4, 0.6] → multiplier = 1.0 (noise floor, no adjustment)
 *   • > 0.6 → linear ramp to +10% at posterior = 1.0
 *   • < 0.4 → linear ramp to -5% at posterior = 0.0
 *
 * Usage
 * -----
 *   const { posterior, isHot } = computeHotnessPosterior(batter.recentLogs);
 *   const mult = hotnessMultiplier(posterior);
 *   adjustedHRProb = baseHRProb * mult;
 */

'use strict';

// Gaussian defaults.
const DEFAULT_WINDOW_SIZE   = 10;
const DEFAULT_THRESHOLD     = 0.65;
const DEFAULT_PRIOR_HOT     = 0.30;
const DEFAULT_HOT_MEAN      = 0.250;
const DEFAULT_COLD_MEAN     = 0.100;
const DEFAULT_SIGMA         = 0.080;

// Multiplier defaults.
const DEFAULT_MAX_BOOST     =  0.10;
const DEFAULT_MIN_PENALTY   = -0.05;
const DEFAULT_NEUTRAL_LOW   =  0.40;
const DEFAULT_NEUTRAL_HIGH  =  0.60;

/**
 * Compute the Gaussian log-likelihood of a single observed value.
 *
 * log P(x | mean, sigma) = -0.5 * ((x - mean) / sigma)^2 - log(sigma * sqrt(2π))
 *
 * We skip the normalisation constant because it cancels in the Bayes ratio,
 * so we only need the exponent term for the likelihood comparison.
 *
 * @param {number} x     - observed ISO value
 * @param {number} mean  - regime mean
 * @param {number} sigma - regime std dev
 * @returns {number} log-likelihood (unnormalised)
 */
export function gaussianLogLikelihood(x, mean, sigma) {
  const z = (x - mean) / sigma;
  return -0.5 * z * z;
}

/**
 * computeHotnessPosterior — Bayesian regime classification for a batter's
 * recent ISO trajectory.
 *
 * @param {Array<{iso: number, ab: number}>} recentLogs - game logs oldest→newest
 * @param {object} [opts]
 * @param {number} [opts.windowSize=10]      number of recent games to examine
 * @param {number} [opts.threshold=0.65]     posterior >= threshold → isHot=true
 * @param {number} [opts.priorHotRate=0.30]  prior P(hot) for any given batter
 * @param {number} [opts.hotMean=0.250]      ISO mean under "hot" regime
 * @param {number} [opts.coldMean=0.100]     ISO mean under "cold/normal" regime
 * @param {number} [opts.sigma=0.080]        assumed ISO std dev per game
 * @returns {{
 *   posterior: number,
 *   isHot: boolean,
 *   changeLikelihood: number,
 *   recentMean: number,
 *   baselineMean: number
 * }}
 */
export function computeHotnessPosterior(recentLogs, opts) {
  const windowSize   = (opts && opts.windowSize   != null) ? opts.windowSize   : DEFAULT_WINDOW_SIZE;
  const threshold    = (opts && opts.threshold    != null) ? opts.threshold    : DEFAULT_THRESHOLD;
  const priorHotRate = (opts && opts.priorHotRate != null) ? opts.priorHotRate : DEFAULT_PRIOR_HOT;
  const hotMean      = (opts && opts.hotMean      != null) ? opts.hotMean      : DEFAULT_HOT_MEAN;
  const coldMean     = (opts && opts.coldMean     != null) ? opts.coldMean     : DEFAULT_COLD_MEAN;
  const sigma        = (opts && opts.sigma        != null) ? opts.sigma        : DEFAULT_SIGMA;

  const defaultResult = {
    posterior: 0.5,
    isHot: false,
    changeLikelihood: 0,
    recentMean: coldMean,
    baselineMean: coldMean,
  };

  // Validate input.
  if (!Array.isArray(recentLogs) || recentLogs.length === 0) return defaultResult;

  // Filter to valid game entries (must have numeric iso field).
  const validLogs = recentLogs.filter(
    g => g && typeof g.iso === 'number' && isFinite(g.iso)
  );
  if (validLogs.length === 0) return defaultResult;

  // Take the last windowSize games.
  const window = validLogs.slice(-windowSize);

  // Accumulate log-likelihoods across the window.
  let logLikHot  = 0;
  let logLikCold = 0;
  for (let i = 0; i < window.length; i++) {
    const iso = window[i].iso;
    logLikHot  += gaussianLogLikelihood(iso, hotMean,  sigma);
    logLikCold += gaussianLogLikelihood(iso, coldMean, sigma);
  }

  // Convert from log-space to probability-space for Bayes combination.
  // Subtract max for numerical stability before exponentiation.
  const maxLL = Math.max(logLikHot, logLikCold);
  const likHot  = Math.exp(logLikHot  - maxLL);
  const likCold = Math.exp(logLikCold - maxLL);

  const priorCold = 1 - priorHotRate;
  const unnormHot  = likHot  * priorHotRate;
  const unnormCold = likCold * priorCold;
  const total      = unnormHot + unnormCold;

  const posterior = total > 0 ? unnormHot / total : 0.5;
  const isHot     = posterior >= threshold;

  // ----- Change likelihood -----
  // Split the window: last 3 games vs prior games.
  const RECENT_N = 3;
  const recentSlice   = window.slice(-RECENT_N);
  const baselineSlice = window.length > RECENT_N
    ? window.slice(0, window.length - RECENT_N)
    : [];

  const mean = (arr) => arr.length === 0
    ? coldMean
    : arr.reduce((s, g) => s + g.iso, 0) / arr.length;

  const recentMean   = mean(recentSlice);
  const baselineMean = mean(baselineSlice);

  // Normalise the delta to [0,1] using a soft cap at 3× sigma.
  const rawDelta  = recentMean - baselineMean;
  const normDelta = Math.max(0, Math.min(1, rawDelta / (3 * sigma)));
  const changeLikelihood = normDelta;

  return { posterior, isHot, changeLikelihood, recentMean, baselineMean };
}

/**
 * hotnessMultiplier — convert a hotness posterior to a score multiplier.
 *
 * Design intent:
 *   - Inside the neutral band [0.4, 0.6] the model is uncertain — return 1.0
 *     to avoid adding noise when the signal is weak.
 *   - Above 0.6: linear ramp to +10% (maxBoost) at posterior = 1.0.
 *   - Below 0.4: linear ramp to -5% (minPenalty) at posterior = 0.0.
 *
 * This asymmetry (larger upside than downside) reflects the fact that cold
 * batters still have floor value — a HR prop at 0+ can always hit — while
 * hot batters genuinely sustain elevated contact quality.
 *
 * @param {number} posterior  - P(hot | data), from computeHotnessPosterior
 * @param {object} [opts]
 * @param {number} [opts.maxBoost=0.10]           max multiplicative boost (as a fraction)
 * @param {number} [opts.minPenalty=-0.05]        max multiplicative penalty (as a fraction)
 * @param {number[]} [opts.neutralBand=[0.4,0.6]] [low, high] — no adjustment within this band
 * @returns {number} multiplier (e.g. 1.05 = +5%, 0.97 = -3%)
 */
export function hotnessMultiplier(posterior, opts) {
  const maxBoost    = (opts && opts.maxBoost    != null) ? opts.maxBoost    : DEFAULT_MAX_BOOST;
  const minPenalty  = (opts && opts.minPenalty  != null) ? opts.minPenalty  : DEFAULT_MIN_PENALTY;
  const neutralBand = (opts && Array.isArray(opts.neutralBand) && opts.neutralBand.length === 2)
    ? opts.neutralBand
    : [DEFAULT_NEUTRAL_LOW, DEFAULT_NEUTRAL_HIGH];

  const neutralLow  = neutralBand[0];
  const neutralHigh = neutralBand[1];

  // Clamp input to [0, 1].
  const p = Math.max(0, Math.min(1, posterior));

  if (p >= neutralLow && p <= neutralHigh) {
    return 1.0;
  }

  if (p > neutralHigh) {
    // Hot zone: linear from 1.0 (at neutralHigh) to 1 + maxBoost (at 1.0).
    const t = (p - neutralHigh) / (1.0 - neutralHigh);
    return 1.0 + t * maxBoost;
  }

  // Cold zone: linear from 1.0 (at neutralLow) to 1 + minPenalty (at 0.0).
  const t = (neutralLow - p) / neutralLow;
  return 1.0 + t * minPenalty;
}

