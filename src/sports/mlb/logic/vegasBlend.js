/**
 * vegasBlend.js
 *
 * Blends StatFax model scores with Vegas-implied probabilities to produce
 * a calibrated final score. Vegas HR-prop lines represent aggregated sharp
 * money and are the strongest publicly available market signal for single-game
 * player props. Anchoring to them corrects overconfidence in the model,
 * especially in thin-sample edge cases (new pitchers, park factors, matchup
 * novelty).
 *
 * All functions are pure — no imports, no I/O, no side effects.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Assumed total overround (vig) when only one side of an HR prop is available
 * (the common case — books rarely post the "No / 0 HR" line). Two-way *game*
 * markets hold ~8%, but player HR props are juiced far harder: 15–25% is typical.
 * 0.15 keeps the single-side de-juice realistic instead of over-trusting the
 * vigged "Yes" price. When BOTH sides are present we de-juice exactly and this
 * constant isn't used.
 */
export const DEFAULT_HOLD = 0.15;

/**
 * Score calibration constant: this implied probability maps to a score of 100.
 *
 * Was 0.18, which capped the ML/feat probability paths under-confident: a
 * top-of-scale score implied only an 18% HR chance, but the rolling backtest
 * shows PRIME bats actually homer ~27% (the fetch-slate isotonic note observes
 * ~37% at the very top). 0.18 therefore pinned probToScore at 100 for anyone
 * priced above ~18% and squashed the gradient at the top end. Raised to a
 * conservative 0.28 — close to the empirical PRIME rate without chasing the
 * ~37% tail, so the upper buckets spread out again.
 *
 * Round-trip note: probToScore() and scoreToProb() are exact inverses through
 * THIS constant, and every consumer that round-trips a rule-path score
 * (livePADecay, ProbabilityEngine, logOddsScore) imports this same symbol — so
 * changing it here keeps write+read consistent everywhere it's imported. The
 * separate hardcoded `0.18` in server/models/ensemble.mjs and the matching
 * `mlScore/100*0.18` in server/fetch-slate.mjs form their OWN ml-prob↔mlScore
 * round-trip and are intentionally left in lockstep with each other (both ends
 * must move together), so they are NOT touched here.
 */
export const PROB_AT_MAX_SCORE = 0.28;

/** Probability floor — never return 0 from scoreToProb. */
export const PROB_FLOOR = 0.005;

/** Probability ceiling — cap at 30%; above this, HR props typically don't exist. */
export const PROB_CEIL = 0.30;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Clamp a number between min and max (inclusive).
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

/**
 * Return true when x is a finite number (not NaN, not Infinity).
 * @param {*} x
 * @returns {boolean}
 */
function isFiniteNumber(x) {
  return typeof x === 'number' && isFinite(x);
}

// ---------------------------------------------------------------------------
// Exported: americanToImpliedProb
// ---------------------------------------------------------------------------

/**
 * Convert American odds to a raw (vigged) implied probability.
 *
 * American odds express how much you win per $100 wagered (positive) or
 * how much you must wager to win $100 (negative). The sportsbook bakes vig
 * into both sides, so the sum of both sides' implied probabilities exceeds 1.
 * Use dejuicedImpliedProb() when you have both sides.
 *
 * @param {number} american - American odds, e.g. +350 or -120
 * @returns {number|null} Raw implied probability [0, 1], or null on bad input
 */
export function americanToImpliedProb(american) {
  if (!isFiniteNumber(american) || american === 0) return null;

  if (american > 0) {
    // Underdog: $100 wins $american
    return 100 / (american + 100);
  } else {
    // Favorite: must wager $|american| to win $100
    const abs = Math.abs(american);
    return abs / (abs + 100);
  }
}

// ---------------------------------------------------------------------------
// Exported: dejuicedImpliedProb
// ---------------------------------------------------------------------------

/**
 * Return a vig-removed (fair) implied probability for the YES side.
 *
 * When both YES and NO prices are available, the vig is stripped by dividing
 * p_yes by the sum (p_yes + p_no) — this is the standard "additive" de-juice
 * used by most sharp books. When only the YES side is present we assume an
 * 8% total hold and work back from that.
 *
 * @param {number} yesAmerican - American odds for the over/yes side
 * @param {number|null} [noAmerican=null] - American odds for the under/no side
 * @returns {number|null} Fair probability [0, 1], or null on bad input
 */
export function dejuicedImpliedProb(yesAmerican, noAmerican = null) {
  const pYes = americanToImpliedProb(yesAmerican);
  if (pYes === null) return null;

  if (noAmerican !== null) {
    const pNo = americanToImpliedProb(noAmerican);
    if (pNo === null) return null;
    const total = pYes + pNo;
    if (total <= 0) return null;
    return pYes / total;
  }

  // Single-side fallback: assume DEFAULT_HOLD is split proportionally.
  // fair_prob ≈ raw_prob / (1 + hold)
  return pYes / (1 + DEFAULT_HOLD);
}

// ---------------------------------------------------------------------------
// Exported: bestPriceFromBooks
// ---------------------------------------------------------------------------

/**
 * Given a multi-book odds object, return the most favorable (longest/highest)
 * American price available on the YES side.
 *
 * Accepts two shapes:
 *   { books: { dk: { price: +320 }, fd: { price: +310 } } }  — multi-book
 *   { best: { price: +320 } }                                  — pre-aggregated
 *
 * The "best price" is the highest American number because a larger positive
 * number (or least-negative number) means the bettor collects more on a win.
 * We use this to ensure the de-juice step uses the sharpest available market.
 *
 * @param {Object} oddsObject
 * @returns {number|null} Best American price, or null when nothing usable found
 */
export function bestPriceFromBooks(oddsObject) {
  if (!oddsObject || typeof oddsObject !== 'object') return null;

  // Pre-aggregated shape
  if (oddsObject.best && isFiniteNumber(oddsObject.best.price)) {
    return oddsObject.best.price;
  }

  // Multi-book shape
  const books = oddsObject.books;
  if (!books || typeof books !== 'object') return null;

  let best = null;
  for (const bookKey of Object.keys(books)) {
    const book = books[bookKey];
    if (!book) continue;
    const price = book.price;
    if (!isFiniteNumber(price) || price === 0) continue;
    if (best === null || price > best) {
      best = price;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Exported: probToScore / scoreToProb
// ---------------------------------------------------------------------------

/**
 * Convert a probability to a score on the 0-100 StatFax scale.
 *
 * Calibration constant: PROB_AT_MAX_SCORE (0.28 — 28% implied probability maps
 * to a score of 100). This reflects the empirical PRIME HR rate; a batter
 * priced around +260 (≈28%) would be the highest-confidence play in the model.
 *
 * When isotonic regression calibration data is available, the caller should
 * substitute their own calibrated curve. This function is the deterministic
 * fallback.
 *
 * @param {number} p - Probability [0, 1]
 * @returns {number} Integer score [0, 100]
 */
export function probToScore(p) {
  if (!isFiniteNumber(p)) return 0;
  return Math.round(clamp((p * 100) / PROB_AT_MAX_SCORE, 0, 100));
}

/**
 * Convert a score (0-100) back to an approximate probability.
 *
 * Inverse of probToScore(). Used to translate the blended score back into
 * probability space for display or downstream stacking logic.
 *
 * @param {number} s - Score [0, 100]
 * @returns {number} Probability clamped to [PROB_FLOOR, PROB_CEIL]
 */
export function scoreToProb(s) {
  if (!isFiniteNumber(s)) return PROB_FLOOR;
  return clamp((s / 100) * PROB_AT_MAX_SCORE, PROB_FLOOR, PROB_CEIL);
}

// ---------------------------------------------------------------------------
// Exported: blendScoreWithVegas
// ---------------------------------------------------------------------------

/**
 * Produce a blended score anchored to the Vegas-implied probability.
 *
 * WHY THIS WORKS
 * ──────────────
 * Sportsbook HR-prop lines are set by risk managers watching sharp action and
 * CLV (closing line value). They encode information our model cannot: late
 * lineup confirmations, ballpark wind readings, injury status not yet in the
 * feed, and any other signal sharp money has already acted on. Blending 50/50
 * by default captures this without abandoning the model's edge on volume and
 * park/matchup interactions.
 *
 * WHY 0.5 DEFAULT
 * ───────────────
 * Without backtest data showing the model consistently beats or trails closing
 * lines, a 50/50 split is the epistemically honest prior. Once you accumulate
 * ≥200 graded prop outcomes, wire recommendedWeight() into opts.weight.
 *
 * GRACEFUL DEGRADATION
 * ────────────────────
 * When Vegas data is absent (line not yet posted, prop not offered, bad input),
 * the function returns rawScore unchanged so the UI never breaks.
 *
 * @param {number} rawScore - Model's raw score [0, 100]
 * @param {number|null} modelProb - Probability corresponding to rawScore
 * @param {number|null} vegasImpliedProb - De-juiced Vegas implied probability
 * @param {Object} [opts={}]
 * @param {number} [opts.weight=0.5] - Vegas weight [0, 1]. 0 = pure model, 1 = pure Vegas
 * @returns {{
 *   blendedScore: number,
 *   blendedProb: number|null,
 *   vegasImpliedProb: number|null,
 *   weight: number,
 *   hasVegas: boolean
 * }}
 */
export function blendScoreWithVegas(rawScore, modelProb, vegasImpliedProb, opts = {}) {
  const weight = isFiniteNumber(opts.weight)
    ? clamp(opts.weight, 0, 1)
    : 0.5;

  const hasVegas =
    isFiniteNumber(vegasImpliedProb) &&
    vegasImpliedProb > 0 &&
    vegasImpliedProb < 1;

  // Graceful degradation: no Vegas data or model prob → pass through unchanged
  if (!hasVegas || !isFiniteNumber(modelProb)) {
    return {
      blendedScore: rawScore,
      blendedProb: null,
      vegasImpliedProb: hasVegas ? vegasImpliedProb : null,
      weight,
      hasVegas,
    };
  }

  const blendedProb = (1 - weight) * modelProb + weight * vegasImpliedProb;
  const blendedScore = probToScore(blendedProb);

  return {
    blendedScore,
    blendedProb,
    vegasImpliedProb,
    weight,
    hasVegas: true,
  };
}

// ---------------------------------------------------------------------------
// Exported: recommendedWeight
// ---------------------------------------------------------------------------

/**
 * Suggest a Vegas blend weight based on backtest sample size.
 *
 * As the number of graded outcomes grows, the model accumulates evidence about
 * its own accuracy relative to the closing line. More data → more trust in the
 * model → lower Vegas weight. At small sample sizes the market is the safer
 * anchor.
 *
 * HOW TO WIRE THIS UP
 * ───────────────────
 * Pull rolling30dHitRate and primeBucketCount from your backtester output
 * (e.g. the nightly grade-props job). Pass them here and use the return value
 * as opts.weight in blendScoreWithVegas(). Re-run nightly so the weight tracks
 * model form.
 *
 * Tiers:
 *   primeBucketCount < 50   → 0.6  (lean Vegas — not enough data to trust model)
 *   50 ≤ count ≤ 200        → 0.5  (balanced blend)
 *   count > 200             → 0.4  (lean model — we have real edge evidence)
 *
 * rolling30dHitRate is accepted but not yet incorporated into the formula;
 * it's wired in as a parameter now so callers don't need a signature change
 * when the calibration logic is extended.
 *
 * @param {number|null} rolling30dHitRate - Hit rate of prime-scored props over last 30 days [0, 1]
 * @param {number|null} primeBucketCount - Count of graded outcomes in the prime bucket
 * @returns {number} Suggested weight in [0.3, 0.7]
 */
export function recommendedWeight(rolling30dHitRate, primeBucketCount) {
  if (!isFiniteNumber(primeBucketCount) || primeBucketCount < 0) return 0.5;

  if (primeBucketCount < 50) return 0.6;
  if (primeBucketCount <= 200) return 0.5;
  return 0.4;
}

