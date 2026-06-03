/**
 * starterIPDistribution.js
 *
 * Estimates a probability distribution over how many innings a starter will
 * pitch, then computes per-PA HR9 as a weighted average of starter HR9 (when
 * the batter faces the starter) and bullpen HR9 (when the starter has exited).
 *
 * WHY THIS EXISTS
 * ───────────────
 * The previous model assumed a binary split: "starter for the first 6 IP, then
 * bullpen." That overstates starter exposure. In 2024-2025 MLB, starters go 7+
 * innings in only ~10% of outings. The average outing is closer to 5.2 IP.
 *
 * By replacing the binary split with a probability distribution, we can
 * down-weight the starter's HR9 for late-game PAs — most critically for
 * batters in the 1-3 spots who can accumulate 4-5 PAs and are disproportionately
 * exposed to the bullpen in innings 6+.
 *
 * All functions are pure (no imports, no side effects).
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * League-average IP distribution for starting pitchers, 2024-2025.
 * Source: ~10% of starts reach 7+ IP; mode is the 5-6 IP bucket.
 */
const LEAGUE_AVG_DISTRIBUTION = {
  under4:    0.10,
  fourToFive: 0.25,
  fiveToSix:  0.35,
  sixToSeven: 0.20,
  sevenPlus:  0.10,
};

/**
 * Distribution for openers (pitchers flagged as opener, i.e. expected to face
 * only 1 inning / the top of the order once before handing off).
 */
const OPENER_DISTRIBUTION = {
  under4:    0.85,
  fourToFive: 0.12,
  fiveToSix:  0.03,
  sixToSeven: 0.00,
  sevenPlus:  0.00,
};

/** Standard deviation (in IP) assumed for a normal distribution around a
 *  starter's mean IP/start. 1.2 IP reflects real-game variance — a pitcher
 *  who averages 5.5 IP can exit anywhere from 3.5 to 7.5 IP with meaningful
 *  probability.
 */
const DEFAULT_IP_STD = 1.2;

// ─── Math helpers ────────────────────────────────────────────────────────────

/**
 * Approximation of the standard normal CDF using the Abramowitz & Stegun
 * rational polynomial (maximum error < 7.5e-8). Pure JS, no imports needed.
 *
 * @param {number} x
 * @returns {number} P(Z ≤ x)
 */
function normalCDF(x) {
  const t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 +
    t * (-0.356563782 +
    t * (1.781477937 +
    t * (-1.821255978 +
    t * 1.330274429))));
  const pdf = Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  const cdf = 1.0 - pdf * poly;
  return x >= 0 ? cdf : 1.0 - cdf;
}

/**
 * P(a < X ≤ b) where X ~ Normal(mean, std).
 *
 * @param {number} a  — lower bound (exclusive), use -Infinity for open left
 * @param {number} b  — upper bound (inclusive), use +Infinity for open right
 * @param {number} mean
 * @param {number} std
 * @returns {number}
 */
function normalBucketProb(a, b, mean, std) {
  const lo = a === -Infinity ? 0 : normalCDF((a - mean) / std);
  const hi = b === Infinity  ? 1 : normalCDF((b - mean) / std);
  return Math.max(0, hi - lo);
}

// ─── 1. estimateIPDistribution ────────────────────────────────────────────────

/**
 * Estimates the probability distribution over how many innings the starter
 * will throw in tonight's game.
 *
 * Uses the pitcher's recent form (last ~5 starts) as the primary signal, with
 * season-level IP/GS as a fallback. When no data is present, returns the
 * 2024-2025 league-average distribution.
 *
 * @param {object} pitcher
 * @param {boolean} [pitcher.isOpener=false] — true if this pitcher is being
 *   used as an opener (e.g. "piggyback" strategy). Forces a short-outing dist.
 * @param {object} [pitcher.recentForm]
 * @param {number} [pitcher.recentForm.games] — number of recent starts sampled
 * @param {number} [pitcher.recentForm.ip]    — total IP across those starts
 * @param {object} [pitcher.season]
 * @param {number} [pitcher.season.ip]        — season IP total
 * @param {number} [pitcher.season.gs]        — season games started
 * @param {object} [opts]
 * @param {number} [opts.stdOverride]         — override the 1.2 IP std assumption
 *
 * @returns {{ under4: number, fourToFive: number, fiveToSix: number,
 *             sixToSeven: number, sevenPlus: number }}
 *   Probabilities summing to 1.0 (±floating-point rounding).
 */
export function estimateIPDistribution(pitcher, opts = {}) {
  // Opener shortcut — extremely short expected outing by design.
  if (pitcher && pitcher.isOpener) {
    return { ...OPENER_DISTRIBUTION };
  }

  const std = opts.stdOverride != null ? opts.stdOverride : DEFAULT_IP_STD;

  // Derive mean IP/start from recentForm, then season, then fallback.
  let mean = null;

  const rf = pitcher && pitcher.recentForm;
  if (rf && rf.games > 0 && rf.ip != null && rf.ip > 0) {
    mean = rf.ip / rf.games;
  } else {
    const s = pitcher && pitcher.season;
    if (s && s.gs > 0 && s.ip != null && s.ip > 0) {
      mean = s.ip / s.gs;
    }
  }

  // No data — return league-average distribution verbatim.
  if (mean == null) {
    return { ...LEAGUE_AVG_DISTRIBUTION };
  }

  // Integrate normal(mean, std) over each IP bucket.
  // Bucket boundaries: <4, [4,5), [5,6), [6,7), ≥7
  const raw = {
    under4:    normalBucketProb(-Infinity, 4, mean, std),
    fourToFive: normalBucketProb(4, 5, mean, std),
    fiveToSix:  normalBucketProb(5, 6, mean, std),
    sixToSeven: normalBucketProb(6, 7, mean, std),
    sevenPlus:  normalBucketProb(7, Infinity, mean, std),
  };

  // Renormalize to ensure exact sum = 1.0 (floats can drift).
  const total = raw.under4 + raw.fourToFive + raw.fiveToSix + raw.sixToSeven + raw.sevenPlus;
  if (total <= 0) return { ...LEAGUE_AVG_DISTRIBUTION };

  return {
    under4:    raw.under4    / total,
    fourToFive: raw.fourToFive / total,
    fiveToSix:  raw.fiveToSix  / total,
    sixToSeven: raw.sixToSeven / total,
    sevenPlus:  raw.sevenPlus  / total,
  };
}

// ─── 2. probFaceStarterAtPA ───────────────────────────────────────────────────

/**
 * Returns the probability that the starter is still pitching when a given
 * batter reaches their Nth plate appearance.
 *
 * INNING ESTIMATION HEURISTIC
 * ───────────────────────────
 * Each PA for a batter arrives roughly at:
 *   inningAtPA ≈ 1 + (batterSpot - 1) / 9 + (paIndex - 1) * 1.0
 *
 * Rationale: in the 1st inning the #1 hitter bats at ~inning 1.0 and the #9
 * hitter bats at ~inning 1.9. The next time through the order adds ~1 inning
 * per full lineup cycle (~paIndex - 1 additional innings). This is a
 * deliberate coarse heuristic — the variance in real game situations is large.
 *
 * P(starter still in) uses the ipDistribution CDF: it's the probability that
 * the starter threw AT LEAST `inningAtPA` innings before exiting.
 *
 * @param {number} paIndex      — which PA for this batter (1 = first, 2 = second …)
 * @param {number} batterSpot   — batting-order position (1–9)
 * @param {{ under4, fourToFive, fiveToSix, sixToSeven, sevenPlus }} ipDistribution
 * @param {object} [opts]
 * @param {number} [opts.relievesAfter=0.5] — fractional-inning smoothing;
 *   0.5 means the starter is assumed to exit at the midpoint of their last
 *   full inning rather than exactly at the boundary.
 *
 * @returns {number} probability in [0, 1]
 */
export function probFaceStarterAtPA(paIndex, batterSpot, ipDistribution, opts = {}) {
  const relievesAfter = opts.relievesAfter != null ? opts.relievesAfter : 0.5;

  // Estimate which inning the batter is at for this PA.
  const inningAtPA = 1 + (batterSpot - 1) / 9 + (paIndex - 1) * 1.0;

  // Adjusted inning: starter typically exits partway through their last inning.
  const effectiveInning = inningAtPA - relievesAfter;

  // P(starter still in) = P(starter IP ≥ effectiveInning)
  // Derived by summing the portion of each bucket that exceeds effectiveInning.
  const d = ipDistribution;

  // Bucket midpoints and coverage fractions used to compute survival probability.
  // For each bucket we ask: what fraction of starts in this bucket had the
  // starter still pitching at `effectiveInning`?
  // We approximate this with the bucket's upper-bound check.
  // under4   → starter out by inning ~3.5 mid (bucket 0–4)
  // fourToFive → still in through ~4.5 (bucket 4–5)
  // etc.

  const buckets = [
    { prob: d.under4,     threshold: 3.5 },  // exits before inning 4
    { prob: d.fourToFive, threshold: 4.5 },  // exits ~inning 4-5
    { prob: d.fiveToSix,  threshold: 5.5 },  // exits ~inning 5-6
    { prob: d.sixToSeven, threshold: 6.5 },  // exits ~inning 6-7
    { prob: d.sevenPlus,  threshold: 8.0 },  // goes deep (7+)
  ];

  let pStarter = 0;
  for (const bucket of buckets) {
    if (bucket.threshold > effectiveInning) {
      pStarter += bucket.prob;
    }
  }

  return Math.min(1, Math.max(0, pStarter));
}

// ─── 3. weightedPerPAHR9 ─────────────────────────────────────────────────────

/**
 * Computes the blended HR9 for a single plate appearance, weighting starter
 * and bullpen HR9 by the probability the starter is still pitching.
 *
 * When `bullpenHR9` is null (no bullpen signal available), the starter's HR9
 * is used for all PAs regardless of inning — a conservative fallback.
 *
 * When `starterHR9` is null (extreme edge case: no starter data at all), the
 * full bullpen HR9 is returned.
 *
 * @param {number}      paIndex        — PA number for this batter (1-based)
 * @param {number}      batterSpot     — batting-order spot (1–9)
 * @param {number|null} starterHR9     — starter's HR/9 against this batter's hand
 * @param {number|null} bullpenHR9     — bullpen HR/9 against this batter's hand
 * @param {{ under4, fourToFive, fiveToSix, sixToSeven, sevenPlus }} ipDistribution
 *
 * @returns {number} blended HR9 for this PA
 */
export function weightedPerPAHR9(paIndex, batterSpot, starterHR9, bullpenHR9, ipDistribution) {
  // Edge cases first.
  if (starterHR9 == null && bullpenHR9 == null) return 0;
  if (starterHR9 == null) return bullpenHR9;
  if (bullpenHR9 == null) return starterHR9; // no bullpen signal — use starter everywhere

  const p = probFaceStarterAtPA(paIndex, batterSpot, ipDistribution);
  return p * starterHR9 + (1 - p) * bullpenHR9;
}

// ─── 4. expectedHR9ForBatter ─────────────────────────────────────────────────

/**
 * Computes the total expected HR9 for a batter across their likely PA
 * distribution in tonight's game.
 *
 * Each PA is weighted by its probability of occurring, then contributes a
 * blended HR9 (starter vs. bullpen) based on where in the game it falls.
 * The result is a single scalar used by ProbabilityEngine's matchup factor.
 *
 * WHY THIS MATTERS FOR TOP-OF-ORDER BATTERS
 * ──────────────────────────────────────────
 * Batters in the 1-3 spots can accumulate 4-5 PAs, meaning their 4th and 5th
 * PAs frequently occur in the 7th inning or later — well into bullpen territory.
 * The current binary model treats those late PAs as "still facing the starter,"
 * overstating their starter-specific matchup quality.
 *
 * @param {number} batterSpot   — batting-order spot (1–9)
 * @param {number[]|null} paBreakdown
 *   Array of per-PA probabilities [p(PA1), p(PA2), p(PA3), ...].
 *   If null or empty, defaults to a 4-PA model: [1.0, 0.95, 0.80, 0.60, 0.20].
 * @param {number|null} starterHR9
 * @param {number|null} bullpenHR9
 * @param {{ under4, fourToFive, fiveToSix, sixToSeven, sevenPlus }} ipDistribution
 *
 * @returns {number} expected HR9 scalar for use in matchup scoring
 */
export function expectedHR9ForBatter(batterSpot, paBreakdown, starterHR9, bullpenHR9, ipDistribution) {
  // Default 5-PA breakdown when none provided.
  // Probabilities reflect the likelihood of reaching each successive PA in a
  // 9-inning game for an average lineup position: nearly certain for PA1,
  // declining as the game progresses.
  const defaultBreakdown = [1.0, 0.95, 0.80, 0.60, 0.20];
  const paProbs = (Array.isArray(paBreakdown) && paBreakdown.length > 0)
    ? paBreakdown
    : defaultBreakdown;

  let totalWeight = 0;
  let weightedHR9 = 0;

  for (let i = 0; i < paProbs.length; i++) {
    const paIndex = i + 1;        // 1-based PA index
    const paProb  = paProbs[i];   // probability this PA occurs

    const hr9 = weightedPerPAHR9(paIndex, batterSpot, starterHR9, bullpenHR9, ipDistribution);

    weightedHR9 += paProb * hr9;
    totalWeight += paProb;
  }

  if (totalWeight === 0) return starterHR9 != null ? starterHR9 : (bullpenHR9 != null ? bullpenHR9 : 0);

  return weightedHR9 / totalWeight;
}
