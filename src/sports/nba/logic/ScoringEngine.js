/**
 * ScoringEngine — StatFax NBA prop probability scoring
 *
 * What this is:
 *   The NBA analog to the MLB HR ProbabilityEngine. Scores a single player's
 *   probability of hitting a given NBA prop tonight, returning a 0-100
 *   integer score plus a breakdown of the contributing factors. Every score
 *   must be explainable — breakdown.reasons feeds the user-facing modal
 *   (StatFax convention: no opaque numbers).
 *
 * Supported prop types (v1):
 *   THREES        — "3+ Made Threes". Poisson tail on expected makes (λ).
 *                   Each 3PA is a quasi-independent low-p event (~36% league
 *                   make rate) and the count of independent low-p events in
 *                   a fixed window is the textbook Poisson use case. We
 *                   project λ from 3PA × 3P% × game-context, then take
 *                   P(X >= 3) = 1 - P(0) - P(1) - P(2).
 *   PTS_20        — "20+ Points". Gaussian tail on expected points. Points
 *                   come in bursts of 2-3 (not single events), so the
 *                   variance is empirically tighter than Poisson — we model
 *                   σ ≈ 0.45 × √μ and take P(X >= 20) via Φ approximation.
 *                   Adds a minutesFactor (bench guys are runway-capped) and
 *                   a defensive-rating factor on top of the shared factors.
 *   PTS_30        — "30+ Points". Same Gaussian model as PTS_20, threshold
 *                   moved to 30. Tighter score-tier cutoffs (a 22% projected
 *                   hit rate is genuinely PRIME for 30+ pts).
 *   FIRST_BASKET  — "First Basket Scorer". Fundamentally different shape:
 *                   exactly one first basket per team per game, so per-team
 *                   probabilities must sum to ~1. We score each player with
 *                   a position × starter × usage × shot-proximity weight
 *                   and normalize across the team — a multinomial logit
 *                   over the roster.
 *
 * Why these four:
 *   Shape coverage. THREES + PTS_20 + PTS_30 are rate-based (count of
 *   accumulating events); FIRST_BASKET is binary single-event. Together they
 *   cover the bulk of board props the user actually plays — and they reuse
 *   the same UX surface (grade tiers, breakdown modal, parlay builder).
 *
 * Factors (v1 priors — see calibration note below):
 *   paceFactor       — combined possessions, more pace = more opportunities
 *   defenseFactor    — opp 3P% allowed (THREES) or opp Def Rtg (PTS_*)
 *   restFactor       — back-to-back fatigue (-5%) vs days rested (+2-3%)
 *   homeFactor       — home shooters tilt +3%, road -3% (well-documented edge)
 *   recentFormFactor — last 5 games' rate vs season, clamped [0.80, 1.20]
 *   minutesFactor    — PTS_*: 32+ min = full runway, bench is capped
 *
 * CALIBRATION:
 *   These factor weights are v1 priors picked from public-research consensus
 *   and league-average centering — they have NOT been tuned against StatFax
 *   backtest data yet. Once we have a few weeks of NBA scored slates +
 *   actuals in R2, this engine should be calibrated the same way the MLB
 *   engine is — see src/utils/backtest.js for the MLB calibration loop
 *   pattern (per-factor multipliers learned from realized hit-rate vs
 *   projected hit-rate, applied via applyCalibration() at score time).
 */

// ─── Prop type enum ──────────────────────────────────────────────────────────

/**
 * Enum-like map of supported prop types. Use these constants everywhere
 * the UI or dispatcher needs to refer to a prop — keeps strings centralized
 * and discoverable from one place.
 */
export const PROP_TYPES = {
  THREES:       'THREES',
  PTS_20:       'PTS_20',
  PTS_30:       'PTS_30',
  FIRST_BASKET: 'FIRST_BASKET',
};

// ─── Score tier constants ────────────────────────────────────────────────────

/**
 * Score tier cutoffs for 3+ Made Threes. Internal keys stay
 * PRIME/STRONG/LEAN/SKIP for code stability; display names live in
 * theme/index.js → GRADE_META.
 *
 * Thresholds are intentionally lower than the MLB HR engine's PRIME:72 —
 * 3+ made threes is a rarer outcome than 1+ HR even for prime candidates
 * (a 35% PRIME hit rate corresponds to a score of 35, not 72). These are
 * v1 priors; expect to retune after the first calibration pass.
 */
export const SCORE_TIERS_THREES = {
  PRIME:  32,   // 💎 ELITE  (~32%+ projected hit rate)
  STRONG: 22,   // ⚡ STRONG (~22-31%)
  LEAN:   14,   // 👀 SLEEPER (~14-21%)
  SKIP:    0,   // — PASS
};

/**
 * Back-compat alias. Older imports (e.g. NBAHomeScreen) reference
 * SCORE_TIERS directly — keep the name pointing at the threes table so
 * nothing breaks while we migrate call sites to the prop-typed names.
 */
export const SCORE_TIERS = SCORE_TIERS_THREES;

/**
 * Score tier cutoffs for 20+ Points. 20-pt outcomes are MORE common than
 * 3+ threes for starters (a healthy starter is at ~45-60% to clear 20),
 * so the bar for PRIME climbs accordingly — a 40% projected hit rate is
 * merely STRONG here.
 */
export const SCORE_TIERS_20PT = {
  PRIME:  50,   // 💎 ELITE  (~50%+ projected hit rate)
  STRONG: 35,   // ⚡ STRONG (~35-49%)
  LEAN:   22,   // 👀 SLEEPER (~22-34%)
  SKIP:    0,
};

/**
 * Score tier cutoffs for 30+ Points. 30-pt outcomes are RARER than 3+
 * threes even for top scorers (peak superstars cap around 25-30% nightly),
 * so cutoffs are tighter — a 22% hit rate is genuinely PRIME for 30+ pts.
 */
export const SCORE_TIERS_30PT = {
  PRIME:  22,   // 💎 ELITE  (~22%+ projected hit rate)
  STRONG: 14,   // ⚡ STRONG (~14-21%)
  LEAN:    8,   // 👀 SLEEPER (~8-13%)
  SKIP:    0,
};

/**
 * Score tier cutoffs for First Basket. Because per-team probabilities sum
 * to ~1 across a 12-15 man roster, even the most likely first-basket
 * scorer caps around 20-22%. PRIME at 14 picks out a real top-tier
 * candidate without being so loose that every team's PG qualifies.
 */
export const SCORE_TIERS_FIRST_BASKET = {
  PRIME:  14,   // 💎 ELITE  (~14%+ chance)
  STRONG:  9,   // ⚡ STRONG (~9-13%)
  LEAN:    6,   // 👀 SLEEPER (~6-8%)
  SKIP:    0,
};

// ─── League averages ────────────────────────────────────────────────────────

/**
 * 2024-25 NBA league averages — exported so they're tunable from one place
 * and discoverable from documentation / debug tooling.
 *
 *   LEAGUE_AVG_PACE              — possessions per 48 min, ~99.5 in 2024-25
 *   LEAGUE_AVG_3PT_PCT_ALLOWED   — defensive 3P% allowed, ~35.8% league-wide
 *   LEAGUE_AVG_DEF_RTG           — points allowed per 100 poss, ~115.5
 */
export const LEAGUE_AVG_PACE = 99.5;
export const LEAGUE_AVG_3PT_PCT_ALLOWED = 0.358;
export const LEAGUE_AVG_DEF_RTG = 115.5;

// ─── Factor clamps ──────────────────────────────────────────────────────────

// Keep any single signal from running away with the model. Centered so a
// missing input → 1.00 (neutral, no nudge in either direction).
const PACE_CLAMP_MIN     = 0.92;
const PACE_CLAMP_MAX     = 1.08;
const DEFENSE_CLAMP_MIN  = 0.90;
const DEFENSE_CLAMP_MAX  = 1.10;
const FORM_CLAMP_MIN     = 0.80;
const FORM_CLAMP_MAX     = 1.20;
const MINUTES_CLAMP_MIN  = 0.60;
const MINUTES_CLAMP_MAX  = 1.15;

// First-basket factor priors. See computeFirstBasketWeights() docblock
// for the rationale on each constant.
const FB_POSITION_FACTOR = {
  C:  1.40,   // bigs catch tip-back possessions and inside opens
  PF: 1.20,   // similar but a tier down
  SF: 1.00,   // baseline — wings get the average mix
  SG: 1.00,   // baseline
  PG: 1.10,   // small bump — PG brings the ball up, often initiates
};
const FB_SHOT_PROXIMITY_FACTOR = {
  C:  1.30,   // closest avg shot location, highest expected make rate
  PF: 1.15,
  SF: 1.00,
  SG: 0.90,   // more catch-and-shoot 3s, lower per-attempt make
  PG: 0.95,
};
const FB_STARTER_WEIGHT     = 1.00;
const FB_BENCH_WEIGHT       = 0.05;   // bench guys almost never score first basket
const FB_USAGE_DIVISOR      = 18;     // ~league-avg PPG for a starter
const FB_USAGE_CLAMP_MIN    = 0.40;
const FB_USAGE_CLAMP_MAX    = 2.00;

// ─── Math helpers ────────────────────────────────────────────────────────────

/**
 * Clamp x into [min, max]. Tiny helper but used enough that inlining
 * Math.min(max, Math.max(min, x)) everywhere obscures intent.
 */
function clamp(x, min, max) {
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

/**
 * Poisson tail probability: P(X >= 3) given rate λ.
 *
 *   P(X = k) = e^(-λ) × λ^k / k!
 *   P(X >= 3) = 1 - P(0) - P(1) - P(2)
 *            = 1 - e^(-λ) × (1 + λ + λ²/2)
 *
 * Closed form for k=0,1,2 — no need to loop. Numerically stable across the
 * realistic λ range (0.5-8). Returns a probability in [0, 1].
 */
function poissonAtLeast3(lambda) {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0;
  const eNegLambda = Math.exp(-lambda);
  const headMass   = eNegLambda * (1 + lambda + (lambda * lambda) / 2);
  return Math.max(0, Math.min(1, 1 - headMass));
}

/**
 * Standard normal CDF Φ(z) via Abramowitz-Stegun 26.2.17 approximation.
 *
 * Max abs error ~7.5e-8 across all z — well below any signal we care about
 * (our σ inputs are themselves only known to ~1% precision). We use this
 * instead of Math.erf because erf is not in JS until very recent engines
 * and Hermes (our runtime) does not ship it.
 *
 * The trick: A&S provides an explicit polynomial in t = 1/(1+px) that
 * approximates the right-tail of Φ for x >= 0 in 5 multiplications. We
 * compute that tail and reflect for negative z via Φ(-z) = 1 - Φ(z).
 */
function normalCdf(z) {
  if (!Number.isFinite(z)) return 0.5;
  // Constants from A&S 26.2.17.
  const p  =  0.2316419;
  const b1 =  0.319381530;
  const b2 = -0.356563782;
  const b3 =  1.781477937;
  const b4 = -1.821255978;
  const b5 =  1.330274429;

  const absZ = Math.abs(z);
  // Standard normal pdf φ(z) = (1/√2π) e^(-z²/2).
  const phi = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI);
  const t   = 1 / (1 + p * absZ);
  // Horner's-form 5-term polynomial — the 5 multiplications.
  const poly = t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  const tailRight = phi * poly;        // ≈ 1 - Φ(absZ)
  return z >= 0 ? 1 - tailRight : tailRight;
}

/**
 * P(X >= threshold) for X ~ Normal(μ, σ²). Returns 0 when σ is degenerate.
 *
 * σ = 0.45 × √μ comes from public NBA points-distribution studies:
 * because points arrive in 2-3 point bursts (not single-point events), the
 * variance is tighter than Poisson — empirically about half the √μ a true
 * Poisson model would predict. We hold the 0.45 prior across thresholds.
 */
function normalTailAtLeast(threshold, mu) {
  if (!Number.isFinite(mu) || mu <= 0) return 0;
  const sigma = 0.45 * Math.sqrt(mu);
  if (sigma <= 0) return 0;
  const z = (threshold - mu) / sigma;
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

// ─── Game-context factors ────────────────────────────────────────────────────

/**
 * Pace factor: average of own + opp pace, normalized to league avg, clamped.
 *
 * More possessions = more shot opportunities of every kind. We average both
 * teams because a single fast team can be slowed by a grindy opponent (and
 * vice versa) — the realized game pace lands in the middle. Clamped to
 * [0.92, 1.08] so even Wizards-vs-Hawks track-meet vs Heat-vs-Magic
 * rock-fight stays within a sane ±8% swing.
 */
function computePaceFactor(ownPace, oppPace) {
  if (!Number.isFinite(ownPace) || !Number.isFinite(oppPace)) return 1.0;
  const gamePace = (ownPace + oppPace) / 2;
  return clamp(gamePace / LEAGUE_AVG_PACE, PACE_CLAMP_MIN, PACE_CLAMP_MAX);
}

/**
 * 3-point defense factor: opp 3P% allowed normalized to league avg, clamped.
 *
 * Weak opp 3-point defense (high opp3PtPct) lifts our guy's expected makes;
 * elite perimeter defense suppresses them. Clamped to [0.90, 1.10] — the
 * gap between the worst and best 3P-defense teams in a season is rarely
 * more than ±2% off league avg, which already yields a ~6% swing here.
 */
function computeDefenseFactor(opp3PtPctAllowed) {
  if (!Number.isFinite(opp3PtPctAllowed) || opp3PtPctAllowed <= 0) return 1.0;
  return clamp(opp3PtPctAllowed / LEAGUE_AVG_3PT_PCT_ALLOWED, DEFENSE_CLAMP_MIN, DEFENSE_CLAMP_MAX);
}

/**
 * Points defense factor: opp defensive rating normalized to league avg.
 *
 * Higher oppDefRtg = the opponent allows more points per 100 possessions =
 * easier scoring environment = bump expected points. Clamped on the same
 * [0.90, 1.10] band as 3-point defense for the same reason: the worst vs
 * best team gap in any season is small enough that uncapped weights would
 * over-fit. A DRtg of 120 vs 110 is the realistic NBA range.
 */
function computePointsDefenseFactor(oppDefRtg) {
  if (!Number.isFinite(oppDefRtg) || oppDefRtg <= 0) return 1.0;
  return clamp(oppDefRtg / LEAGUE_AVG_DEF_RTG, DEFENSE_CLAMP_MIN, DEFENSE_CLAMP_MAX);
}

/**
 * Rest factor: NBA fatigue / freshness curve.
 *
 *   0 days  — back-to-back (played yesterday): 0.95 (well-documented dip
 *             in 3P% and shot quality on the second night of a B2B)
 *   1 day   — normal rest: 1.00 (baseline)
 *   2 days  — fresh: 1.02 (small tick up — body recovered, legs under shots)
 *   3+ days — capped at 1.03; more is "rust" territory and the literature
 *             stops showing additional benefit
 *
 * The asymmetry (B2B penalty larger than rested bonus) matches public
 * tracking-data studies — fatigue costs more than freshness gains.
 */
function computeRestFactor(daysRest) {
  if (!Number.isFinite(daysRest) || daysRest < 0) return 1.00;
  if (daysRest === 0) return 0.95;
  if (daysRest === 1) return 1.00;
  if (daysRest === 2) return 1.02;
  return 1.03;
}

/**
 * Home factor: home shooters get a small but real edge (~3%).
 *
 * Mechanisms are well-studied: familiar shooting backdrop, no travel,
 * supportive crowd noise on rhythm 3s, friendly rims. Magnitude is small
 * but consistent — we go ±3% so the round-trip swing between home and
 * road is ~6%, in line with public splits.
 */
function computeHomeFactor(isHome) {
  return isHome ? 1.03 : 0.97;
}

/**
 * Recent form factor: last 5 games' rate vs season pace.
 *
 *   Hot streak  → ratio > 1.00 → bumps expectation up
 *   Cold streak → ratio < 1.00 → drags expectation down
 *   Missing data → 1.00 (neutral — never penalize a missing input)
 *
 * Clamped to [0.80, 1.20] so a 5-game sample of pure noise can't flip
 * the model on its head. 5 games is small — without the clamp a guy who
 * happened to drop 8/game in his hot stretch would project as a 2.5x
 * shooter, which we know regresses hard.
 */
function computeRecentFormFactor(recentPerGame, seasonPerGame) {
  if (recentPerGame == null || !Number.isFinite(recentPerGame)) return 1.00;
  if (!Number.isFinite(seasonPerGame) || seasonPerGame <= 0)    return 1.00;
  return clamp(recentPerGame / seasonPerGame, FORM_CLAMP_MIN, FORM_CLAMP_MAX);
}

/**
 * Weighted recency decay — last game weighs more than 5 games ago.
 *
 * Replaces the flat last-5-average approach. Why this is better:
 *   - A player on a 3-game heater is genuinely more likely to keep
 *     producing than the 5-game average suggests (confidence + role
 *     compound, defensive coverage adjusts slowly)
 *   - A player whose last game was 2 weeks ago (injury return) should
 *     not have his 5-game average dominated by ancient pre-injury form
 *   - Smooths out single-game blowups without throwing them away
 *
 * Weights are tuned to give the last game ~30% influence vs ~70%
 * collective from games 2-5. Math: sum(weights) = 3.50, last/total = 0.286.
 *
 * Accepts an array of per-game numeric values in most-recent-first order.
 * Missing trailing values are simply not summed (no padding) — a player
 * with only 3 recent games gets their weighted avg over the first 3
 * weights.
 */
export const RECENCY_WEIGHTS = [1.00, 0.85, 0.70, 0.55, 0.40];

export function weightedRecencyAvg(recentValuesNewestFirst) {
  if (!Array.isArray(recentValuesNewestFirst)) return null;
  const valid = recentValuesNewestFirst
    .slice(0, RECENCY_WEIGHTS.length)
    .filter(v => Number.isFinite(v));
  if (valid.length === 0) return null;
  let num = 0, den = 0;
  for (let i = 0; i < valid.length; i++) {
    num += valid[i] * RECENCY_WEIGHTS[i];
    den += RECENCY_WEIGHTS[i];
  }
  return den > 0 ? num / den : null;
}

/**
 * Extract per-prop metric from the recent gamelog. Returns an array of
 * per-game values in newest-first order ready for weightedRecencyAvg.
 *
 * Why a helper: lets the per-prop scoring functions just say "give me the
 * weighted threes per game" without each one re-implementing the gamelog
 * scan. Centralizes the metric→field mapping in one place.
 *
 * recentLogs: array of game objects from NBAService.getPlayerRecentLogs,
 * already sorted newest-first. Returns the recent-weighted value or null
 * if the gamelog is missing/empty.
 */
export function weightedRecent(recentLogs, metric) {
  if (!Array.isArray(recentLogs) || recentLogs.length === 0) return null;
  const values = recentLogs.map(g => {
    switch (metric) {
      case 'threes':  return g.threesMade;
      case 'points':  return g.points;
      case 'fga':     return g.fga;
      case 'minutes': return g.minutes;
      default:        return null;
    }
  });
  return weightedRecencyAvg(values);
}

/**
 * Minutes factor: scales prop runway by how much a player actually plays.
 *
 * 32 min is the rough threshold where a starter sees enough touches to
 * sustain a true 20+ projection. Below that — backups, fringe rotation —
 * the prop becomes a long shot regardless of efficiency. Above 32 we cap
 * at 1.15 because nobody plays 48 min and even 38-40 min doesn't multiply
 * shot volume proportionally (defenses focus, conditioning matters).
 *
 * Floor at 0.60 — even a 15-min bench scorer occasionally gets hot, so
 * we don't zero out the prop entirely.
 */
function computeMinutesFactor(minutesPerGame) {
  if (!Number.isFinite(minutesPerGame) || minutesPerGame <= 0) return MINUTES_CLAMP_MIN;
  return clamp(minutesPerGame / 32, MINUTES_CLAMP_MIN, MINUTES_CLAMP_MAX);
}

// ─── Grade resolution ────────────────────────────────────────────────────────

/**
 * Map a 0-100 score to a grade key against the THREES tier table.
 * Returns 'PRIME' | 'STRONG' | 'LEAN' | 'SKIP'.
 */
export function gradeFromScoreThrees(score) {
  if (!Number.isFinite(score)) return 'SKIP';
  if (score >= SCORE_TIERS_THREES.PRIME)  return 'PRIME';
  if (score >= SCORE_TIERS_THREES.STRONG) return 'STRONG';
  if (score >= SCORE_TIERS_THREES.LEAN)   return 'LEAN';
  return 'SKIP';
}

/**
 * Back-compat alias. Existing call sites import `gradeFromScore`; keep
 * the name pointing at the threes grader so nothing breaks while we
 * migrate call sites to the prop-typed names.
 */
export const gradeFromScore = gradeFromScoreThrees;

/**
 * Map a 0-100 score to a grade key against the 20-pt tier table.
 */
export function gradeFromScore20Pt(score) {
  if (!Number.isFinite(score)) return 'SKIP';
  if (score >= SCORE_TIERS_20PT.PRIME)  return 'PRIME';
  if (score >= SCORE_TIERS_20PT.STRONG) return 'STRONG';
  if (score >= SCORE_TIERS_20PT.LEAN)   return 'LEAN';
  return 'SKIP';
}

/**
 * Map a 0-100 score to a grade key against the 30-pt tier table.
 */
export function gradeFromScore30Pt(score) {
  if (!Number.isFinite(score)) return 'SKIP';
  if (score >= SCORE_TIERS_30PT.PRIME)  return 'PRIME';
  if (score >= SCORE_TIERS_30PT.STRONG) return 'STRONG';
  if (score >= SCORE_TIERS_30PT.LEAN)   return 'LEAN';
  return 'SKIP';
}

/**
 * Map a 0-100 score to a grade key against the first-basket tier table.
 */
export function gradeFromScoreFirstBasket(score) {
  if (!Number.isFinite(score)) return 'SKIP';
  if (score >= SCORE_TIERS_FIRST_BASKET.PRIME)  return 'PRIME';
  if (score >= SCORE_TIERS_FIRST_BASKET.STRONG) return 'STRONG';
  if (score >= SCORE_TIERS_FIRST_BASKET.LEAN)   return 'LEAN';
  return 'SKIP';
}

// ─── 3+ Made Threes ──────────────────────────────────────────────────────────

/**
 * Score a single NBA player's "3+ Made Threes" prop for a given game.
 *
 * Pure function — no React, no AsyncStorage, no fetch. All inputs come in
 * via the args object; all outputs come out via the return value. Safe to
 * call from the cron-side bundle and the on-device runtime alike.
 *
 * @param {object} args
 * @param {object} args.player        { name, playerId, seasonStats: { threesMadePerGame, threesAttemptedPerGame, threePointPct, ... }, recentForm: { threesPerGameLast5 } | null }
 * @param {object} args.opponent      { teamStats: { opp3PtPct, pace } }     opposing team
 * @param {object} args.ownTeam       { teamStats: { pace } }                player's own team
 * @param {object} args.game          { isHome: bool, daysRest: number, ... }
 *
 * @returns {{
 *   score:           number,                    // 0-100, rounded int
 *   grade:           'PRIME'|'STRONG'|'LEAN'|'SKIP',
 *   expectedThrees:  number,                    // λ — projected makes
 *   probAtLeast3:    number,                    // 0-1 raw probability
 *   breakdown: {
 *     baseExpectation:   number,                // 3PA × 3P% pre-context
 *     paceFactor:        number,
 *     defenseFactor:     number,
 *     restFactor:        number,
 *     homeFactor:        number,
 *     recentFormFactor:  number,
 *     reasons:           string[],              // human-readable bullets
 *   }
 * }}
 */
export function scoreNBAPlayerThreesProp({ player, opponent, ownTeam, game }) {
  const season    = player?.seasonStats || {};
  const recent    = player?.recentForm || null;
  const oppTeam   = opponent?.teamStats || {};
  const ownStats  = ownTeam?.teamStats || {};
  const isHome    = !!game?.isHome;
  const daysRest  = game?.daysRest;

  // ── Base expectation: attempts × make rate ─────────────────────────────
  // This is the "no-context" Poisson λ — what we'd project if every game
  // were league-neutral. The factors below shift it up or down for tonight.
  const threesAttempted = Number.isFinite(season.threesAttemptedPerGame) ? season.threesAttemptedPerGame : 0;
  const threePointPct   = Number.isFinite(season.threePointPct)          ? season.threePointPct          : 0;
  const baseLambda      = threesAttempted * threePointPct;

  // ── Context factors ────────────────────────────────────────────────────
  const paceFactor       = computePaceFactor(ownStats.pace, oppTeam.pace);
  const defenseFactor    = computeDefenseFactor(oppTeam.opp3PtPct);
  const restFactor       = computeRestFactor(daysRest);
  const homeFactor       = computeHomeFactor(isHome);
  const recentFormFactor = computeRecentFormFactor(
    recent?.threesPerGameLast5,
    season.threesMadePerGame
  );

  // ── Combine into final expected makes (λ) ──────────────────────────────
  const expectedThrees = baseLambda
    * paceFactor
    * defenseFactor
    * restFactor
    * homeFactor
    * recentFormFactor;

  // ── Poisson tail → probability → 0-100 score ───────────────────────────
  const probAtLeast3 = poissonAtLeast3(expectedThrees);
  const score        = Math.round(probAtLeast3 * 100);
  const grade        = gradeFromScoreThrees(score);

  // ── Human-readable reasons (for the user-facing modal) ─────────────────
  // 2-5 bullets. First one is always the base expectation so the user can
  // see the raw shooting profile; subsequent bullets surface meaningful
  // deviations from neutral. We skip bullets for factors close to 1.00
  // (within ±1%) to keep the list short and focused on signal.
  const reasons = [];

  const playerLabel = player?.name || 'Player';
  reasons.push(
    `${playerLabel}: ${threesAttempted.toFixed(1)} 3PA × ${(threePointPct * 100).toFixed(1)}% = base ${baseLambda.toFixed(2)} expected threes`
  );

  if (Number.isFinite(oppTeam.opp3PtPct)) {
    const oppLabel  = opponent?.name || opponent?.abbr || 'opp';
    const defDelta  = ((defenseFactor - 1) * 100);
    const defSign   = defDelta >= 0 ? '+' : '';
    reasons.push(
      `vs ${oppLabel}: opp allows ${(oppTeam.opp3PtPct * 100).toFixed(1)}% from 3 (${defSign}${defDelta.toFixed(1)}% adj)`
    );
  }

  if (Number.isFinite(ownStats.pace) && Number.isFinite(oppTeam.pace)) {
    const gamePace  = (ownStats.pace + oppTeam.pace) / 2;
    const paceDelta = ((paceFactor - 1) * 100);
    if (Math.abs(paceDelta) >= 1) {
      const paceSign = paceDelta >= 0 ? '+' : '';
      reasons.push(
        `Pace ${gamePace.toFixed(1)} (${paceSign}${paceDelta.toFixed(1)}% vs league avg)`
      );
    }
  }

  if (Number.isFinite(daysRest)) {
    if (daysRest === 0)      reasons.push('Back-to-back (-5% fatigue)');
    else if (daysRest === 1) reasons.push('1 day rest (baseline)');
    else if (daysRest === 2) reasons.push('2 days rest (+2%, fresh legs)');
    else                     reasons.push(`${daysRest}+ days rest (+3%, fully rested)`);
  }

  const venueLabel = game?.venue || (isHome ? 'home' : 'road');
  reasons.push(isHome
    ? `Home at ${venueLabel} (+3%)`
    : `Away at ${venueLabel} (-3%)`);

  if (recent?.threesPerGameLast5 != null && Math.abs(recentFormFactor - 1) >= 0.02) {
    const formDelta = ((recentFormFactor - 1) * 100);
    const formSign  = formDelta >= 0 ? '+' : '';
    const heat      = formDelta >= 0 ? 'hot' : 'cold';
    reasons.push(
      `L5: ${recent.threesPerGameLast5.toFixed(1)}/g vs season ${(season.threesMadePerGame ?? 0).toFixed(1)}/g (${formSign}${formDelta.toFixed(1)}% ${heat})`
    );
  }

  return {
    score,
    grade,
    expectedThrees,
    probAtLeast3,
    breakdown: {
      baseExpectation: baseLambda,
      paceFactor,
      defenseFactor,
      restFactor,
      homeFactor,
      recentFormFactor,
      reasons,
    },
  };
}

// ─── 20+ / 30+ Points (shared Gaussian core) ─────────────────────────────────

/**
 * Internal core for points-threshold props. Both 20+ and 30+ use the same
 * Gaussian-tail model and the same factor set — they differ only in
 * threshold + which tier table they grade against. Pulling the math into
 * one function keeps the two public wrappers thin and consistent.
 */
function scorePointsProp({ player, opponent, ownTeam, game }, threshold, grader, probFieldName) {
  const season    = player?.seasonStats || {};
  const recent    = player?.recentForm || null;
  const oppTeam   = opponent?.teamStats || {};
  const ownStats  = ownTeam?.teamStats || {};
  const isHome    = !!game?.isHome;
  const daysRest  = game?.daysRest;

  // ── Base expectation: season PPG, no game context applied yet ──────────
  const pointsPerGame   = Number.isFinite(season.pointsPerGame)   ? season.pointsPerGame   : 0;
  const minutesPerGame  = Number.isFinite(season.minutesPerGame)  ? season.minutesPerGame  : 0;

  // ── Context factors ────────────────────────────────────────────────────
  const paceFactor       = computePaceFactor(ownStats.pace, oppTeam.pace);
  const defenseFactor    = computePointsDefenseFactor(oppTeam.oppDefRtg);
  const restFactor       = computeRestFactor(daysRest);
  const homeFactor       = computeHomeFactor(isHome);
  const recentFormFactor = computeRecentFormFactor(
    recent?.pointsPerGameLast5,
    season.pointsPerGame
  );
  const minutesFactor    = computeMinutesFactor(minutesPerGame);

  // ── Combine into final expected points (μ) ─────────────────────────────
  const expectedPoints = pointsPerGame
    * paceFactor
    * defenseFactor
    * restFactor
    * homeFactor
    * recentFormFactor
    * minutesFactor;

  // ── Gaussian tail → probability → 0-100 score ──────────────────────────
  const prob  = normalTailAtLeast(threshold, expectedPoints);
  const score = Math.round(prob * 100);
  const grade = grader(score);

  // ── Human-readable reasons (for the user-facing modal) ─────────────────
  const reasons = [];

  const playerLabel = player?.name || 'Player';
  reasons.push(
    `${playerLabel}: ${pointsPerGame.toFixed(1)} PPG base, projected ${expectedPoints.toFixed(1)} tonight`
  );

  if (Number.isFinite(oppTeam.oppDefRtg)) {
    const oppLabel = opponent?.name || opponent?.abbr || 'opp';
    const defDelta = ((defenseFactor - 1) * 100);
    const defSign  = defDelta >= 0 ? '+' : '';
    reasons.push(
      `vs ${oppLabel}: DRtg ${oppTeam.oppDefRtg.toFixed(1)} (${defSign}${defDelta.toFixed(1)}% adj)`
    );
  }

  if (Number.isFinite(ownStats.pace) && Number.isFinite(oppTeam.pace)) {
    const gamePace  = (ownStats.pace + oppTeam.pace) / 2;
    const paceDelta = ((paceFactor - 1) * 100);
    if (Math.abs(paceDelta) >= 1) {
      const paceSign = paceDelta >= 0 ? '+' : '';
      reasons.push(
        `Pace ${gamePace.toFixed(1)} (${paceSign}${paceDelta.toFixed(1)}% vs league avg)`
      );
    }
  }

  if (Number.isFinite(minutesPerGame) && minutesPerGame > 0) {
    const minDelta = ((minutesFactor - 1) * 100);
    const minSign  = minDelta >= 0 ? '+' : '';
    reasons.push(
      `${minutesPerGame.toFixed(1)} MPG runway (${minSign}${minDelta.toFixed(1)}%)`
    );
  }

  if (Number.isFinite(daysRest)) {
    if (daysRest === 0)      reasons.push('Back-to-back (-5% fatigue)');
    else if (daysRest === 1) reasons.push('1 day rest (baseline)');
    else if (daysRest === 2) reasons.push('2 days rest (+2%, fresh legs)');
    else                     reasons.push(`${daysRest}+ days rest (+3%, fully rested)`);
  }

  const venueLabel = game?.venue || (isHome ? 'home' : 'road');
  reasons.push(isHome
    ? `Home at ${venueLabel} (+3%)`
    : `Away at ${venueLabel} (-3%)`);

  if (recent?.pointsPerGameLast5 != null && Math.abs(recentFormFactor - 1) >= 0.02) {
    const formDelta = ((recentFormFactor - 1) * 100);
    const formSign  = formDelta >= 0 ? '+' : '';
    const heat      = formDelta >= 0 ? 'hot' : 'cold';
    reasons.push(
      `L5: ${recent.pointsPerGameLast5.toFixed(1)}/g vs season ${pointsPerGame.toFixed(1)}/g (${formSign}${formDelta.toFixed(1)}% ${heat})`
    );
  }

  return {
    score,
    grade,
    expectedPoints,
    [probFieldName]: prob,
    breakdown: {
      baseExpectation: pointsPerGame,
      paceFactor,
      defenseFactor,
      restFactor,
      homeFactor,
      recentFormFactor,
      minutesFactor,
      reasons,
    },
  };
}

/**
 * Score a single NBA player's "20+ Points" prop for a given game.
 *
 * Same shape as scoreNBAPlayerThreesProp but uses a Gaussian tail on
 * projected points instead of a Poisson tail on projected makes. The
 * Gaussian fits empirically tighter than Poisson because points arrive
 * in 2-3 point bursts, not single-point events — see normalTailAtLeast()
 * for the σ derivation.
 *
 * @param {object} args
 * @param {object} args.player    { name, seasonStats: { pointsPerGame, minutesPerGame, ... }, recentForm: { pointsPerGameLast5 } | null }
 * @param {object} args.opponent  { teamStats: { oppDefRtg, pace } }
 * @param {object} args.ownTeam   { teamStats: { pace } }
 * @param {object} args.game      { isHome, daysRest }
 *
 * @returns {{
 *   score:           number,
 *   grade:           'PRIME'|'STRONG'|'LEAN'|'SKIP',
 *   expectedPoints:  number,
 *   probAtLeast20:   number,
 *   breakdown: { baseExpectation, paceFactor, defenseFactor, restFactor, homeFactor, recentFormFactor, minutesFactor, reasons }
 * }}
 */
export function scoreNBAPlayer20PointsProp(args) {
  return scorePointsProp(args, 20, gradeFromScore20Pt, 'probAtLeast20');
}

/**
 * Score a single NBA player's "30+ Points" prop for a given game.
 *
 * Identical model to scoreNBAPlayer20PointsProp, just with the threshold
 * moved to 30 and a tighter tier table for grading. 30+ is genuinely rare —
 * even peak superstars top out at ~25-30% nightly — so the cutoffs reflect
 * that the bar for PRIME is a 22% projected hit rate, not 50%.
 *
 * @returns Same shape as scoreNBAPlayer20PointsProp but with
 *          `probAtLeast30` in place of `probAtLeast20`.
 */
export function scoreNBAPlayer30PointsProp(args) {
  return scorePointsProp(args, 30, gradeFromScore30Pt, 'probAtLeast30');
}

// ─── First Basket Scorer ─────────────────────────────────────────────────────

/**
 * Resolve a player's position to a normalized key in our factor tables.
 * NBA APIs return positions in a few flavors ("PG", "G", "Guard",
 * "PG-SG", ...) — collapse them to the 5 canonical keys we score against.
 * Unknown positions fall through to SF (a true baseline — neutral on every
 * first-basket factor).
 */
function normalizePosition(rawPos) {
  if (!rawPos || typeof rawPos !== 'string') return 'SF';
  const p = rawPos.toUpperCase().trim();
  // Take the primary slot of a dual-position string ("PF-C" → "PF").
  const primary = p.split(/[-/,\s]/)[0];
  if (primary === 'PG' || primary === 'POINT' || primary === 'POINTGUARD')   return 'PG';
  if (primary === 'SG' || primary === 'SHOOTING' || primary === 'G')         return 'SG';
  if (primary === 'SF' || primary === 'F' || primary === 'FORWARD')          return 'SF';
  if (primary === 'PF' || primary === 'POWER')                               return 'PF';
  if (primary === 'C'  || primary === 'CENTER')                              return 'C';
  return 'SF';
}

/**
 * Decide whether a given player is a starter, given the full team roster.
 *
 * Heuristic (conservative — better to under-rank than over-rank):
 *   1. Honor an explicit `player.isStarter` boolean if present.
 *   2. Otherwise look up the player by id/name in `allTeamPlayers` and call
 *      them a starter iff their index is < 5. ESPN and most public APIs
 *      return the roster in depth-chart order, so the first 5 are the
 *      announced starters in the vast majority of cases.
 *   3. If we can't find them in the roster array, default to bench.
 *
 * Why default to bench: the FB_BENCH_WEIGHT is tiny (0.05), so a false
 * negative just sinks that player's first-basket weight to near zero,
 * which is the safe failure mode. A false positive would crowd the
 * starter normalization and dilute everyone else's prob.
 */
function isStarter(player, allTeamPlayers) {
  if (typeof player?.isStarter === 'boolean') return player.isStarter;
  if (!Array.isArray(allTeamPlayers) || allTeamPlayers.length === 0) return false;
  const idx = allTeamPlayers.findIndex(p =>
    (player?.playerId != null && p?.playerId === player.playerId) ||
    (player?.name     != null && p?.name     === player.name)
  );
  if (idx < 0) return false;
  return idx < 5;
}

/**
 * Compute the un-normalized first-basket weight for one player. The
 * multinomial normalization happens in computeFirstBasketWeights() —
 * this returns the raw weight only.
 *
 * Weight components (all multiplied):
 *   positionFactor       — bigs catch tip-back possessions and inside
 *                          opens; PGs get a small bump for initiating the
 *                          half-court set; wings are baseline. Priors live
 *                          in FB_POSITION_FACTOR.
 *   startingFactor       — starters take ~90% of first baskets per
 *                          public play-by-play studies; bench guys get
 *                          0.05 (essentially zero, accounting for the
 *                          rare blowout / injury early sub).
 *   usageFactor          — proxy for share-of-team-shots in v1. True usage
 *                          rate isn't in our player stats yet, so we use
 *                          PPG normalized by the league-avg-starter PPG
 *                          (≈18). High-usage scoring options score first
 *                          baskets more often even controlling for
 *                          position.
 *   shotProximityFactor  — bigs convert close-range looks at a much
 *                          higher per-attempt rate than wings shooting
 *                          catch-and-shoot 3s. Priors in
 *                          FB_SHOT_PROXIMITY_FACTOR.
 */
function computeRawFirstBasketWeight(player, allTeamPlayers) {
  const pos = normalizePosition(player?.position);
  const positionFactor      = FB_POSITION_FACTOR[pos]      ?? 1.00;
  const shotProximityFactor = FB_SHOT_PROXIMITY_FACTOR[pos] ?? 1.00;
  const startingFactor      = isStarter(player, allTeamPlayers) ? FB_STARTER_WEIGHT : FB_BENCH_WEIGHT;

  // Usage factor — prefer the canonical proxy (FGA + 0.44 × FTA + TOV per game)
  // when available; fall back to PPG-as-proxy for players where the components
  // weren't extracted. The canonical proxy is materially better than PPG
  // because it captures VOLUME (touches that end possessions) rather than
  // efficiency. A 14 PPG center who shoots 18 FGA outranks a 14 PPG sniper
  // who shoots 9 FGA — accurate for first-basket likelihood.
  //
  // Both proxies use the same divisor + clamp range so the contribution
  // weight stays comparable across players regardless of which path fed it.
  // Adjusted divisor (FB_USAGE_DIVISOR_PROXY = 18) lines up with the league-
  // average starter possession-end count, mirroring the original PPG divisor's
  // calibration.
  const usageProxy = Number.isFinite(player?.seasonStats?.usageProxy)
    ? player.seasonStats.usageProxy
    : null;
  const ppg = Number.isFinite(player?.seasonStats?.pointsPerGame)
    ? player.seasonStats.pointsPerGame
    : 0;
  const usageRaw    = usageProxy ?? ppg;
  const usageFactor = clamp(usageRaw / FB_USAGE_DIVISOR, FB_USAGE_CLAMP_MIN, FB_USAGE_CLAMP_MAX);
  const usageSource = usageProxy !== null ? 'proxy' : 'ppg';   // for breakdown.reasons traceability

  const weight = positionFactor * startingFactor * usageFactor * shotProximityFactor;
  return {
    weight,
    positionFactor,
    startingFactor,
    usageFactor,
    usageSource,           // 'proxy' (canonical) or 'ppg' (fallback)
    usageRaw,              // raw value used for the factor calc, for breakdown
    shotProximityFactor,
    positionKey: pos,
    isStarter:   startingFactor === FB_STARTER_WEIGHT,
  };
}

/**
 * Compute normalized first-basket probabilities for an entire team roster.
 *
 * This is the multinomial normalization step: each player's raw weight
 * (position × starter × usage × shot-proximity) is divided by the sum of
 * all raw weights on the team, so the per-team probabilities sum to ~1.0
 * by construction. That's the right shape — there's exactly one first
 * basket per team per game, so the probabilities have to be a proper
 * probability distribution over the roster, not independent rates.
 *
 * Returns an array parallel to allTeamPlayers with the raw factors and the
 * final normalized probability. Caller is responsible for wrapping these
 * in full score objects (see scoreNBAFirstBasketProp / scoreFirstBasketForTeam).
 */
function computeFirstBasketWeights(allTeamPlayers) {
  const list = Array.isArray(allTeamPlayers) ? allTeamPlayers : [];
  const raws = list.map(p => computeRawFirstBasketWeight(p, list));
  const total = raws.reduce((acc, r) => acc + (r.weight || 0), 0);
  return raws.map(r => ({
    ...r,
    prob: total > 0 ? r.weight / total : 0,
  }));
}

/**
 * Score a single NBA player's "First Basket Scorer" prop for a given game.
 *
 * Fundamentally different shape from the rate-based props above: there is
 * exactly one first basket per team per game, so the per-team probabilities
 * must form a proper distribution that sums to ~1.0. We use a multinomial
 * logit over the roster — each player's weight is the product of position,
 * starter status, usage proxy, and shot-proximity factors, then normalized
 * within the team.
 *
 * @param {object} args
 * @param {object} args.player          { name, position, playerId, seasonStats: { pointsPerGame } }
 * @param {object} args.ownTeam         { name, abbr } (used for display only)
 * @param {object} args.game            { ... } (currently unused, reserved for tip-off winner)
 * @param {Array}  args.allTeamPlayers  full roster array for this team (denominator
 *                                      for the multinomial normalization)
 *
 * @returns {{
 *   score:           number,
 *   grade:           'PRIME'|'STRONG'|'LEAN'|'SKIP',
 *   probFirstBasket: number,
 *   breakdown: {
 *     positionFactor, startingFactor, usageFactor, shotProximityFactor,
 *     teamRosterSize, reasons
 *   }
 * }}
 */
export function scoreNBAFirstBasketProp({ player, ownTeam, game, allTeamPlayers }) {
  void game; void ownTeam;  // reserved — tip-off-winner bonus lands here in v2.
  const roster  = Array.isArray(allTeamPlayers) ? allTeamPlayers : [];
  const weights = computeFirstBasketWeights(roster);

  // Find this player's row in the normalized weights.
  const idx = roster.findIndex(p =>
    (player?.playerId != null && p?.playerId === player.playerId) ||
    (player?.name     != null && p?.name     === player.name)
  );

  const row = idx >= 0
    ? weights[idx]
    // Player wasn't in the roster array — score them as bench, prob ≈ 0.
    : { ...computeRawFirstBasketWeight(player, roster), prob: 0 };

  const score = Math.round(row.prob * 100);
  const grade = gradeFromScoreFirstBasket(score);

  // ── Reasons ────────────────────────────────────────────────────────────
  const reasons = [];
  const playerLabel = player?.name || 'Player';
  const posLabel    = row.positionKey;

  reasons.push(
    `${playerLabel} (${posLabel}): position ×${row.positionFactor.toFixed(2)} × shotProximity ×${row.shotProximityFactor.toFixed(2)}`
  );
  reasons.push(
    row.isStarter
      ? `Starter: weight ×${FB_STARTER_WEIGHT.toFixed(2)}`
      : `Bench: weight ×${FB_BENCH_WEIGHT.toFixed(2)} (first basket extremely unlikely)`
  );

  // Surface which usage signal fed the factor — 'proxy' is the canonical
  // FGA+0.44×FTA+TOV computation (more accurate); 'ppg' is the fallback
  // when components weren't available. Helps the modal explain to a user
  // why two similar-PPG players have very different first-basket weights.
  if (row.usageSource === 'proxy') {
    reasons.push(
      `Usage: ${row.usageRaw.toFixed(1)} possession-ends/g (FGA+0.44·FTA+TOV) → ×${row.usageFactor.toFixed(2)}`
    );
  } else {
    const ppg = Number.isFinite(player?.seasonStats?.pointsPerGame) ? player.seasonStats.pointsPerGame : 0;
    reasons.push(
      `Usage: ${ppg.toFixed(1)} PPG (proxy unavailable) → ×${row.usageFactor.toFixed(2)}`
    );
  }

  // Team rank: where does this player land vs teammates by normalized prob?
  if (idx >= 0 && weights.length > 0) {
    const sortedDesc = [...weights]
      .map((w, i) => ({ i, prob: w.prob }))
      .sort((a, b) => b.prob - a.prob);
    const rank = sortedDesc.findIndex(x => x.i === idx) + 1;
    const starterCount = weights.filter(w => w.isStarter).length;
    reasons.push(`Team-normalized rank: ${rank} of ${weights.length} (${starterCount} starters)`);
  }

  return {
    score,
    grade,
    probFirstBasket: row.prob,
    breakdown: {
      positionFactor:      row.positionFactor,
      startingFactor:      row.startingFactor,
      usageFactor:         row.usageFactor,
      shotProximityFactor: row.shotProximityFactor,
      teamRosterSize:      roster.length,
      reasons,
    },
  };
}

/**
 * Score every player on a team for the First Basket prop at once and
 * return them sorted by score desc, with a teamRank field added.
 *
 * Most UI surfaces want the per-team view ("show me the top 3 first-basket
 * candidates for LAL"), not per-player one-offs — this is the convenience
 * wrapper for that. Each entry is a full scoreNBAFirstBasketProp result
 * with `teamRank` (1-N) appended.
 *
 * Note: we compute weights once across the whole roster, then build each
 * player's per-row output from that single normalization — guarantees the
 * probs sum to ~1 by construction and avoids N redundant normalizations.
 *
 * @param {Array}  teamPlayers   full roster array
 * @param {object} game          { ... } (passed through to per-player scoring)
 * @param {object} ownTeam       { name, abbr } (passed through to per-player scoring)
 *
 * @returns {Array<object>}      per-player score objects sorted desc by score,
 *                               each with a `teamRank` field (1 = highest)
 */
export function scoreFirstBasketForTeam(teamPlayers, game, ownTeam) {
  const roster = Array.isArray(teamPlayers) ? teamPlayers : [];
  if (roster.length === 0) return [];

  const scored = roster.map(player => scoreNBAFirstBasketProp({
    player,
    ownTeam,
    game,
    allTeamPlayers: roster,
  }));

  // Pair each result with its original roster index so we can re-rank
  // without losing the player identity. Then sort by score descending,
  // assign a teamRank, and return.
  const indexed = scored.map((s, i) => ({ s, originalIdx: i }));
  indexed.sort((a, b) => b.s.score - a.s.score);

  return indexed.map((entry, sortedIdx) => ({
    ...entry.s,
    teamRank: sortedIdx + 1,
  }));
}

// ─── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Injury status multipliers applied AFTER the prop-specific scoring.
 * Status strings match what NBAService.getInjuries normalizes them to
 * (lowercase, hyphenated for 'day-to-day').
 *
 * Rationale per status:
 *   - 'out':         player isn't playing — return null upstream so the row
 *                    is hidden entirely. No multiplier needed.
 *   - 'doubtful':    historically ~25% chance of playing, severely limited
 *                    minutes if they do — score × 0.4 expresses "probably
 *                    skip but don't auto-hide."
 *   - 'questionable': ~50/50 game-time decision, often plays close to normal
 *                    minutes if cleared — score × 0.6 is the right balance.
 *   - 'day-to-day':  usually plays but worth a small risk discount —
 *                    score × 0.85.
 *
 * Tunable later via the calibration loop — these are reasonable v1 priors
 * based on historical "did they play after this status" hit rates.
 */
const INJURY_MULTIPLIERS = {
  out:           0,      // hard zero — caller should drop the row
  doubtful:      0.40,
  questionable:  0.60,
  'day-to-day':  0.85,
};

/**
 * Apply injury multiplier to a scored result. Returns null if the player
 * is 'out' (signal to caller to drop the row entirely). Otherwise mutates
 * `score` and adds an injury note to `breakdown.reasons` so the user can
 * see why their score is muted in the modal.
 *
 * Healthy players (no injury record) pass through unchanged.
 */
function applyInjuryAdjustment(result, injury) {
  if (!result || !injury || !injury.status) return result;
  const mult = INJURY_MULTIPLIERS[injury.status];
  if (mult === undefined) return result;          // unknown status — pass through
  if (mult === 0) return null;                    // 'out' — drop row upstream

  const adjustedScore = Math.round(result.score * mult);
  const note = `Injury: ${injury.abbreviation || injury.status.toUpperCase()}` +
               (injury.comment ? ` — ${injury.comment.slice(0, 90)}` : '') +
               ` (score × ${mult.toFixed(2)})`;
  return {
    ...result,
    score:         adjustedScore,
    grade:         gradeFromScoreForProp(result, adjustedScore),
    injuryStatus:  injury.status,                 // surfaced for UI chip
    injuryAbbr:    injury.abbreviation || null,
    breakdown: {
      ...result.breakdown,
      reasons: [
        ...(result.breakdown?.reasons || []),
        note,
      ],
    },
  };
}

/**
 * Re-derive grade from adjusted score using whichever tier set matches the
 * shape of the result. Cheaper than tracking propType through the post-
 * processor — we infer from the field set the result already carries.
 */
function gradeFromScoreForProp(result, score) {
  if (result.probAtLeast3 !== undefined)    return gradeFromScoreThrees(score);
  if (result.probAtLeast20 !== undefined)   return gradeFromScore20Pt(score);
  if (result.probAtLeast30 !== undefined)   return gradeFromScore30Pt(score);
  if (result.probFirstBasket !== undefined) return gradeFromScoreFirstBasket(score);
  return result.grade;
}

/**
 * Generic dispatcher — route to the right scoring function by prop type.
 * Keeps UI code clean (just pass the prop type). Returns null for
 * unknown prop types so callers can detect bad inputs without a throw.
 *
 * If `args.player.injury` is present (shape: { status, abbreviation, comment }),
 * applies an injury multiplier after the prop-specific scoring. Returns null
 * for 'out' players so the caller can drop the row entirely.
 *
 * @param {string} propType   one of PROP_TYPES.*
 * @param {object} args       passed through to the underlying function;
 *                            may include `player.injury` for adjustment
 */
export function scoreForProp(propType, args) {
  let result;
  switch (propType) {
    case PROP_TYPES.THREES:       result = scoreNBAPlayerThreesProp(args);   break;
    case PROP_TYPES.PTS_20:       result = scoreNBAPlayer20PointsProp(args); break;
    case PROP_TYPES.PTS_30:       result = scoreNBAPlayer30PointsProp(args); break;
    case PROP_TYPES.FIRST_BASKET: result = scoreNBAFirstBasketProp(args);    break;
    default:                      return null;
  }
  if (!result) return null;
  // Apply injury multiplier if the caller passed an injury record.
  return applyInjuryAdjustment(result, args?.player?.injury);
}

// ─── Sort helper: prop-agnostic comparator with tiebreakers ──────────────────

/**
 * Extract the raw (un-rounded) probability from any scored-result shape.
 *
 * Each prop's scoring function writes its tail probability under a
 * different key (probAtLeast3 / probAtLeast20 / probAtLeast30 / probFirstBasket)
 * so the field set itself doubles as a prop-type marker. Returns 0 when no
 * known prob field is present so the caller's sort still has a stable value.
 */
function rawProbOf(result) {
  if (!result || typeof result !== 'object') return 0;
  if (typeof result.probAtLeast30   === 'number') return result.probAtLeast30;
  if (typeof result.probAtLeast20   === 'number') return result.probAtLeast20;
  if (typeof result.probAtLeast3    === 'number') return result.probAtLeast3;
  if (typeof result.probFirstBasket === 'number') return result.probFirstBasket;
  return 0;
}

/**
 * Extract the expected-value (μ) from any scored-result shape — used as a
 * final tiebreaker when even raw prob is effectively identical (deep-bench
 * players where everything underflows to ~0).
 */
function expectedOf(result) {
  if (!result || typeof result !== 'object') return 0;
  const e = result.expectedPoints ?? result.expectedThrees ?? 0;
  return Number(e) || 0;
}

/**
 * Comparator for sorting scored player rows in DESC order of "how good a pick."
 *
 * Why this exists: `score` is `Math.round(prob * 100)` — a 0-100 integer.
 * For tight tails (especially 30+ Pts, where P(30+) is essentially 0% for
 * anyone with μ < ~22 PPG), the vast majority of players collapse to
 * score=0. JS's stable sort then preserves insertion order for those ties,
 * which is roster-traversal order — NOT talent order. Result: the 30+ tab
 * surfaces random bench players above genuine stars.
 *
 * Tiebreaker chain:
 *   1. rounded score (the user-facing number)
 *   2. raw probability (full float precision — discriminates within score=0)
 *   3. expected value μ (final fallback when raw prob also underflows)
 *
 * Use this everywhere we currently sort scored NBA rows so the home cards,
 * rankings, and any future surface all stay consistent.
 */
export function compareScoredResults(a, b) {
  const sa = Number(a?.score) || 0;
  const sb = Number(b?.score) || 0;
  if (sb !== sa) return sb - sa;
  const pa = rawProbOf(a);
  const pb = rawProbOf(b);
  if (pb !== pa) return pb - pa;
  return expectedOf(b) - expectedOf(a);
}
