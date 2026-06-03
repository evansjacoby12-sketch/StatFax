/**
 * smallSampleShrinkage.js
 *
 * Bayesian shrinkage toward league average for batters with small samples.
 *
 * PROBLEM: A September call-up with 5 AB and 2 HR gets rated PRIME because the raw
 * HR rate is 40%. This is pure noise. Bayesian shrinkage mixes the observed rate
 * with a prior (league average) weighted by sample size, so tiny samples collapse
 * toward average and large samples trust the observed data.
 *
 * APPROACH — Normal-Normal / Beta-Binomial conjugate prior:
 *   "We act as if we've already seen `priorN` PAs at the league average, then add
 *   the actual observed PAs on top. The posterior mean is a weighted blend."
 *
 *   shrunk = (n * observed + priorN * prior) / (n + priorN)
 *
 * RELIABILITY BENCHMARKS (public sabermetric research):
 *   - K%   stabilises around ~250 PA (high variance, but tracks quickly)
 *   - BB%   stabilises around ~400 PA
 *   - ISO   stabilises around ~1500 PA (very noisy, needs large N)
 *   - AVG   stabilises around ~900 PA
 *   - SLG   stabilises around ~1200 PA
 *   - Barrel% stabilises around ~1000 PA
 * For our purposes a softer priorN (100 for a full season, 30/15 for recency windows)
 * is the right tradeoff between signal stability and responsiveness to hot streaks.
 *
 * WARNING — DO NOT apply this to opposing pitcher stats aggressively.
 * A pitcher with 12 IP and a terrible HR/9 might genuinely be a HR-prone pitcher.
 * Shrinking that back toward league average would mute the very signal we want to
 * exploit in HR prop models. Pitcher stats should use much larger priorN (≥300 IP-equiv)
 * or be left unshrunk entirely at small sample sizes.
 *
 * Pure JS, no imports.
 */

// ---------------------------------------------------------------------------
// League-average priors (rough MLB-wide baselines, update annually)
// ---------------------------------------------------------------------------

/**
 * LEAGUE_PRIORS
 *
 * Rough MLB league-wide baselines used as the Bayesian prior mean.
 * These are "what would we expect from a random league-average batter"
 * before seeing any plate appearances.
 *
 * Sources: MLB Statcast / Baseball Reference league averages, ~2022-2024 blend.
 *
 * @type {{
 *   avg: number,
 *   slg: number,
 *   iso: number,
 *   hrRate: number,
 *   bbPct: number,
 *   kPct: number,
 *   barrelPct: number,
 *   hardHitPct: number,
 *   exitVelo: number,
 *   launchAngle: number,
 *   pullPct: number
 * }}
 */
export const LEAGUE_PRIORS = {
  avg: 0.245,         // batting average
  slg: 0.405,         // slugging percentage
  iso: 0.160,         // isolated power (slg - avg)
  hrRate: 0.035,      // HR per PA
  bbPct: 0.085,       // walk rate (BB / PA)
  kPct: 0.225,        // strikeout rate (K / PA)
  barrelPct: 0.080,   // barrel rate (Statcast)
  hardHitPct: 0.380,  // hard-hit rate (exit velo ≥ 95 mph)
  exitVelo: 89.0,     // average exit velocity (mph)
  launchAngle: 12.0,  // average launch angle (degrees)
  pullPct: 0.40,      // pull-side contact rate
};

// ---------------------------------------------------------------------------
// Prior strength — how many PAs of "imaginary prior data" we mix in
// ---------------------------------------------------------------------------

/**
 * PRIOR_STRENGTH
 *
 * Controls how aggressively we shrink toward the league average.
 * Larger priorN = more shrinkage = less trust in small observed samples.
 *
 * - season:   100 PA  — full-season stats shrink hard below 100 PA
 * - recent30: 30 PA   — 30-game rolling window; shrinkage kicks in sooner
 * - recent7:  15 PA   — 7-game rolling window; very heavy shrinkage, mostly prior
 *
 * Interpretation: a batter with N=priorN actual PAs gets a 50/50 blend of
 * observed vs. prior. Below that threshold, the prior dominates.
 *
 * @type {{ season: number, recent30: number, recent7: number }}
 */
export const PRIOR_STRENGTH = {
  season: 100,
  recent30: 30,
  recent7: 15,
};

// ---------------------------------------------------------------------------
// Core shrinkage formula
// ---------------------------------------------------------------------------

/**
 * Shrink a single observed statistic toward a prior mean using the
 * Normal-Normal / Beta-Binomial conjugate prior formula.
 *
 * Formula:
 *   shrunk = (n * observed + priorN * prior) / (n + priorN)
 *
 * Boundary behaviour:
 *   - n = 0  → returns prior  (no data at all — fall back entirely to league avg)
 *   - n → ∞  → returns observed  (large sample — trust the data)
 *   - null/undefined inputs → graceful no-op, returns observed as-is
 *
 * @param {number} observed  - The raw observed rate/stat (e.g. 0.40 for 40% HR rate)
 * @param {number} n         - Sample size in PAs (or ABs for avg-style stats)
 * @param {number} prior     - League-average prior mean (e.g. LEAGUE_PRIORS.hrRate)
 * @param {number} priorN    - Prior strength in pseudo-PAs (e.g. PRIOR_STRENGTH.season)
 * @returns {number} Shrunk posterior mean
 */
export function shrinkStat(observed, n, prior, priorN) {
  // Graceful no-op: if any key input is missing, return observed unchanged
  if (observed == null || n == null || prior == null || priorN == null) {
    return observed;
  }

  // Edge case: zero observed PAs — return pure prior
  if (n === 0) {
    return prior;
  }

  // Standard weighted-average shrinkage formula
  return (n * observed + priorN * prior) / (n + priorN);
}

// ---------------------------------------------------------------------------
// Shrinkage diagnostics
// ---------------------------------------------------------------------------

/**
 * Returns a 0–1 value indicating how much the observed stat WAS shrunk
 * toward the prior. Useful for UI "low confidence" / "small sample" badges.
 *
 *   penalty = priorN / (n + priorN)
 *
 * Interpretation:
 *   - 1.0  → pure prior (n = 0, no actual data)
 *   - 0.5  → half prior, half observed (n = priorN)
 *   - 0.0  → pure observed (n → ∞)
 *
 * Suggested badge threshold: penalty > 0.5 (i.e. n < priorN PA observed)
 *
 * @param {number} actualN  - Actual observed PA count
 * @param {number} priorN   - Prior strength (pseudo-PA count)
 * @returns {number} Shrinkage fraction in [0, 1]
 */
export function shrinkagePenalty(actualN, priorN) {
  if (actualN == null || priorN == null) return 0;
  if (actualN <= 0) return 1;
  return priorN / (actualN + priorN);
}

// ---------------------------------------------------------------------------
// Season-level stats shrinkage
// ---------------------------------------------------------------------------

/**
 * Given a season-level batter stats object, return a NEW object with all rate
 * stats shrunk toward LEAGUE_PRIORS using the batter's PA count as n.
 *
 * Counting stats (ab, hr, h, tb, r, rbi, sb) are passed through unchanged —
 * shrinking raw counts makes no sense and would distort downstream calculations.
 *
 * ISO is RECOMPUTED as (shrunk_slg - shrunk_avg) after shrinking both components,
 * ensuring internal consistency (a direct shrink of iso would drift from slg - avg).
 *
 * @param {Object} stats - Season stats object. Expected shape:
 *   {
 *     pa?: number,    // plate appearances (preferred for n)
 *     ab?: number,    // at-bats (fallback for n if pa missing)
 *     hr?: number,    // raw HR count
 *     h?:  number,    // raw hit count
 *     tb?: number,    // raw total bases
 *     bb?: number,    // raw walk count
 *     k?:  number,    // raw strikeout count
 *     avg?: number,   // batting average rate
 *     slg?: number,   // slugging percentage rate
 *     iso?: number,   // isolated power (will be recomputed if avg+slg present)
 *     hrRate?: number,
 *     bbPct?: number,
 *     kPct?: number,
 *     barrelPct?: number,
 *     hardHitPct?: number,
 *     exitVelo?: number,
 *     launchAngle?: number,
 *     pullPct?: number,
 *   }
 * @param {Object} [opts={}]
 * @param {number} [opts.priorStrength=PRIOR_STRENGTH.season] - Override prior N
 * @param {Object} [opts.priorOverride={}] - Partial { stat: value } to override
 *   individual prior means (e.g. { hrRate: 0.045 } for a power-heavy lineup context)
 * @returns {Object} New stats object with shrunk rate stats
 */
export function shrinkSeasonStats(stats, opts = {}) {
  if (!stats || typeof stats !== 'object') return stats;

  const priorN = opts.priorStrength != null ? opts.priorStrength : PRIOR_STRENGTH.season;
  const priorOverride = opts.priorOverride || {};

  // Use PA as sample size; fall back to AB if PA not provided
  const n = stats.pa != null ? stats.pa : (stats.ab != null ? stats.ab : 0);

  // Build effective priors (merge overrides)
  const priors = Object.assign({}, LEAGUE_PRIORS, priorOverride);

  // Rate stats we shrink (counting stats are explicitly excluded)
  const rateStats = ['avg', 'slg', 'hrRate', 'bbPct', 'kPct',
                     'barrelPct', 'hardHitPct', 'exitVelo', 'launchAngle', 'pullPct'];

  // Start with a shallow copy of the original (preserves counting stats)
  const result = Object.assign({}, stats);

  // Shrink each rate stat if present
  for (const stat of rateStats) {
    if (result[stat] != null) {
      result[stat] = shrinkStat(result[stat], n, priors[stat], priorN);
    }
  }

  // Recompute ISO from shrunk slg and avg for internal consistency
  if (result.slg != null && result.avg != null) {
    result.iso = result.slg - result.avg;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Recent-window stats shrinkage (30-game or 7-game rolling)
// ---------------------------------------------------------------------------

/**
 * Same as shrinkSeasonStats but defaults to heavier shrinkage appropriate for
 * small recent-window samples (30-game or 7-game rolling stats).
 *
 * Default priorN:
 *   - opts.window === 7  → PRIOR_STRENGTH.recent7  (15 pseudo-PAs)
 *   - otherwise          → PRIOR_STRENGTH.recent30 (30 pseudo-PAs)
 *
 * At a 7-game window a batter might have only 25–30 real PAs, so the prior
 * dominates heavily — that's intentional. We only want to reward players who
 * are *truly* hot, not statistical noise.
 *
 * @param {Object} stats    - Recent-window stats object (same shape as shrinkSeasonStats)
 * @param {Object} [opts={}]
 * @param {number} [opts.window=30]          - Window size (7 or 30) for default priorN selection
 * @param {number} [opts.priorStrength]      - Explicit override for priorN
 * @param {Object} [opts.priorOverride={}]   - Per-stat prior mean overrides
 * @returns {Object} New stats object with shrunk rate stats
 */
export function shrinkRecentStats(stats, opts = {}) {
  const window = opts.window === 7 ? 7 : 30;
  const defaultPriorN = window === 7 ? PRIOR_STRENGTH.recent7 : PRIOR_STRENGTH.recent30;
  const priorN = opts.priorStrength != null ? opts.priorStrength : defaultPriorN;

  return shrinkSeasonStats(stats, Object.assign({}, opts, { priorStrength: priorN }));
}

