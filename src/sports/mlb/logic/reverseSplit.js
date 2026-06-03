/**
 * reverseSplit — detect pitchers whose same-handed splits are WORSE than
 * their opposite-handed splits (i.e., the normal platoon advantage is
 * inverted for this pitcher).
 *
 * Background
 * ----------
 * Standard platoon theory says same-handed matchups favor the pitcher:
 *   - LHB vs LHP → pitcher advantage (LHB "can't see the break")
 *   - RHB vs RHP → pitcher advantage
 *
 * Roughly 15–20 MLB pitchers per season exhibit the *opposite* pattern —
 * they actually surrender MORE home runs (and more hard contact generally)
 * to same-handed batters than opposite-handed batters. This is called a
 * "reverse-split" pitcher.
 *
 * Causes include:
 *   • Cross-body / low slot deliveries (think Tyler Rogers, side-armers)
 *     where the arm path is harder for same-handed hitters to track.
 *   • Sinker/slider LHPs whose slider backs INTO same-handed hitters —
 *     RHBs get a swing-away pitch, LHBs get a pitch into their hands.
 *   • Fastball shape (ride vs run) that plays better against opposite side.
 *
 * Public examples of confirmed multi-year reverse-split pitchers:
 *   - Clayton Kershaw (peak years, LHP, RHBs hit him much harder)
 *   - Dallas Keuchel (LHP sinker specialist, LHBs feasted)
 *   - Various submarine/crossbody RHPs (Joe Smith era)
 *
 * The consequence for HR prop modeling: if we naïvely apply the standard
 * same-hand penalty, we UNDERESTIMATE HR probability for same-handed
 * batters facing reverse-split pitchers. This module detects the condition
 * and flips the factor.
 *
 * Usage
 * -----
 *   const { isReverseSplit } = detectReverseSplit(pitcherObj);
 *   const hr9 = effectivePlatoonHR9(pitcherObj, batterHand);
 */

'use strict';

// League-average HR/9 — used as fallback when splits are missing.
const LEAGUE_AVG_HR9 = 1.25;

// Default detection thresholds.
const DEFAULT_THRESHOLD_DELTA = 0.30; // sameHandHR9 must exceed oppHandHR9 by this much
const DEFAULT_MIN_IP_PER_SPLIT = 15;  // each split needs this many IP for the sample to count

/**
 * Resolve which split is "same-hand" and which is "opposite-hand" for a
 * pitcher given their throwing hand.
 *
 * @param {object} splits  - pitcher.splits object { vsL, vsR }
 * @param {string} hand    - pitcher hand: 'L' or 'R'
 * @returns {{ sameHandSplit: object, oppHandSplit: object }}
 */
export function resolveSplits(splits, hand) {
  if (hand === 'L') {
    return { sameHandSplit: splits.vsL, oppHandSplit: splits.vsR };
  }
  // Default to RHP orientation (also handles unknown hand gracefully).
  return { sameHandSplit: splits.vsR, oppHandSplit: splits.vsL };
}

/**
 * detectReverseSplit — determine whether a pitcher's same-handed split is
 * meaningfully worse than their opposite-handed split.
 *
 * @param {object} pitcher - pitcher object with shape:
 *   {
 *     hand: 'L'|'R',
 *     splits: {
 *       vsL: { hrPer9: number, ip: number },
 *       vsR: { hrPer9: number, ip: number }
 *     },
 *     // Optional: hrPer9 at season level for fallback
 *     hrPer9?: number
 *   }
 * @param {object} [opts]
 * @param {number} [opts.thresholdDelta=0.30]   sameHandHR9 must exceed oppHandHR9 by >= this
 * @param {number} [opts.minIPPerSplit=15]       each split must have >= this many IP
 * @returns {{
 *   isReverseSplit: boolean,
 *   severity: number,
 *   sampleAdequate: boolean,
 *   sameHandHR9: number,
 *   oppHandHR9: number
 * }}
 */
export function detectReverseSplit(pitcher, opts) {
  const thresholdDelta = (opts && opts.thresholdDelta != null)
    ? opts.thresholdDelta
    : DEFAULT_THRESHOLD_DELTA;
  const minIPPerSplit = (opts && opts.minIPPerSplit != null)
    ? opts.minIPPerSplit
    : DEFAULT_MIN_IP_PER_SPLIT;

  const nullResult = {
    isReverseSplit: false,
    severity: 0,
    sampleAdequate: false,
    sameHandHR9: LEAGUE_AVG_HR9,
    oppHandHR9: LEAGUE_AVG_HR9,
  };

  // Defensive: validate pitcher shape.
  if (!pitcher || typeof pitcher !== 'object') return nullResult;
  if (!pitcher.splits || typeof pitcher.splits !== 'object') return nullResult;

  const { vsL, vsR } = pitcher.splits;
  if (!vsL || !vsR) return nullResult;

  const hand = pitcher.hand;
  if (hand !== 'L' && hand !== 'R') return nullResult;

  const { sameHandSplit, oppHandSplit } = resolveSplits(pitcher.splits, hand);

  // Validate numeric fields.
  const sameHandHR9 = (sameHandSplit && typeof sameHandSplit.hrPer9 === 'number')
    ? sameHandSplit.hrPer9
    : null;
  const oppHandHR9 = (oppHandSplit && typeof oppHandSplit.hrPer9 === 'number')
    ? oppHandSplit.hrPer9
    : null;

  if (sameHandHR9 === null || oppHandHR9 === null) return nullResult;

  const sameIP = (sameHandSplit && typeof sameHandSplit.ip === 'number')
    ? sameHandSplit.ip
    : 0;
  const oppIP = (oppHandSplit && typeof oppHandSplit.ip === 'number')
    ? oppHandSplit.ip
    : 0;

  const sampleAdequate = sameIP >= minIPPerSplit && oppIP >= minIPPerSplit;

  const severity = sameHandHR9 - oppHandHR9; // positive = same-hand hitters have the edge
  const isReverseSplit = sampleAdequate && severity >= thresholdDelta;

  return { isReverseSplit, severity, sampleAdequate, sameHandHR9, oppHandHR9 };
}

/**
 * effectivePlatoonHR9 — return the HR/9 a specific batter should actually
 * face against this pitcher, accounting for reverse-split detection.
 *
 * Normal platoon logic:
 *   same-hand matchup  → sameHandHR9  (historically higher for pitcher — fewer HRs allowed)
 *   opp-hand matchup   → oppHandHR9   (historically lower for pitcher — more HRs allowed)
 *
 * Reverse-split flip:
 *   If detectReverseSplit() fires, the same-hand batter actually faces the
 *   *worse* split for this particular pitcher — so we return the higher
 *   (oppHandHR9) value instead, which correctly predicts more HRs allowed.
 *
 * Switch hitters:
 *   Always flip to their platoon-advantaged side → we use LEAGUE_AVG_HR9
 *   as a neutral approximation (they neither get the penalty nor the full
 *   advantage in our model).
 *
 * @param {object} pitcher    - same pitcher shape as detectReverseSplit
 * @param {string} batterHand - 'L', 'R', or 'S' (switch)
 * @returns {number} HR/9 the batter effectively faces
 */
export function effectivePlatoonHR9(pitcher, batterHand) {
  // Switch hitters always face their best platoon side — approximate with league avg.
  if (batterHand === 'S') return LEAGUE_AVG_HR9;

  // Season-level fallback if splits are absent.
  const seasonHR9 = (pitcher && typeof pitcher.hrPer9 === 'number')
    ? pitcher.hrPer9
    : LEAGUE_AVG_HR9;

  if (!pitcher || !pitcher.splits || !pitcher.splits.vsL || !pitcher.splits.vsR) {
    return seasonHR9;
  }

  const pitcherHand = pitcher.hand;
  if (pitcherHand !== 'L' && pitcherHand !== 'R') return seasonHR9;

  const { sameHandSplit, oppHandSplit } = resolveSplits(pitcher.splits, pitcherHand);

  const sameHandHR9 = (sameHandSplit && typeof sameHandSplit.hrPer9 === 'number')
    ? sameHandSplit.hrPer9
    : seasonHR9;
  const oppHandHR9 = (oppHandSplit && typeof oppHandSplit.hrPer9 === 'number')
    ? oppHandSplit.hrPer9
    : seasonHR9;

  // Determine if this batter faces the same hand as the pitcher.
  const isSameHand = batterHand === pitcherHand;

  const { isReverseSplit } = detectReverseSplit(pitcher);

  if (!isSameHand) {
    // Opposite-hand matchup — standard platoon advantage for the batter.
    return oppHandHR9;
  }

  if (isReverseSplit) {
    // Same-hand BUT pitcher is reverse-split: batter actually has an advantage.
    // Return the higher HR9 value — the pitcher allows more HRs to same-handers.
    return sameHandHR9; // sameHandHR9 is already the higher one (that's what flagged it)
  }

  // Same-hand, normal pitcher: standard platoon disadvantage for the batter.
  return sameHandHR9;
}

