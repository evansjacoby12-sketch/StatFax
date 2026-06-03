/**
 * atBatSim — at-bat-by-at-bat HR probability simulation.
 *
 * Replaces the implicit assumption in scoreBatter() that every batter gets
 * exactly the same number of opportunities under the same conditions. In
 * reality:
 *
 *   • Leadoff hitters get ~4.6 PAs; #9 hitters get ~3.5
 *   • PA #1 faces the starter at full strength; PA #4 might face a 4th
 *     reliever in the 8th inning
 *   • Times-through-the-order penalty: starters get hit harder each pass
 *
 * This module models each PA independently, computes a per-PA HR probability
 * for the specific pitcher likely to be on the mound at that point, and
 * closed-form aggregates into a single "≥1 HR today" probability:
 *
 *   P(≥1 HR) = 1 - Π(1 - p_i) for each PA's p_i
 *
 * Closed form rather than Monte Carlo so we don't pay 1000 sims × 270 batters
 * per slate refresh. The model is bounded by independence assumption between
 * PAs which is a reasonable approximation for HR rates.
 *
 * Returns an object with:
 *   { hrProbability, expectedHRs, perPA: [{ pa, p, pitcher }] }
 */

// League baselines — HR per AB rate roughly 3% in 2024-25 MLB; we work in
// HR-per-PA terms (~2.6%) since the model gets PAs not ABs.
const LEAGUE_HR_PER_PA = 0.026;
const LEAGUE_HR9       = 1.15;
const AB_PER_PA        = 0.88;   // ~88% of PAs result in an AB (rest are walks/HBP/sacs)

/**
 * Expected PAs per game for a batter in a given lineup spot.
 * Numbers from MLB-wide multi-year averages — leadoff gets ~1 more PA than #9
 * over a typical 9-inning game.
 */
export function expectedPAs(battingOrder) {
  if (!battingOrder) return 4.0;  // unknown spot → average
  // 1 → 4.65, 9 → 3.55, linear-ish in between
  const table = { 1: 4.65, 2: 4.50, 3: 4.40, 4: 4.30, 5: 4.15, 6: 4.00, 7: 3.85, 8: 3.70, 9: 3.55 };
  return table[battingOrder] ?? 4.0;
}

/**
 * Pitcher "stuff" relative to league at a given PA index.
 *
 * Captures three real effects:
 *   1. Times-through-the-order — starters get hit harder each pass. The
 *      3rd time through the order, batters slug ~25 points higher than
 *      the 1st. We bump the HR-allowed rate proportionally.
 *   2. Bullpen swap — by PA 4-5 the starter is usually out. We blend in
 *      bullpen quality (team-specific when available), weighted by how
 *      likely the starter has been pulled by then.
 *   3. Team-specific bullpen quality — a hitter facing the Rockies'
 *      bullpen in the 7th is in a very different spot than one facing the
 *      Phillies'. When we have a `bullpenHR9` estimate for the opposing
 *      team's relief corps, use it; otherwise fall back to league-average
 *      bullpen (slightly worse than league-avg starters at 1.21 HR/9).
 *
 * Returns the effective HR/9 the batter will face on this PA.
 */
function pitcherForPA(paIndex, starterHR9, opposingBullpenHR9 = null) {
  const ttoMultByPass = [1.00, 1.06, 1.14];   // 1st/2nd/3rd time through
  // Starter likelihood of still being in by this PA. By PA 4 it's a coin
  // flip (the 3rd time through ~7th inning); by PA 5 the starter is usually
  // gone in the modern game.
  const starterShareByPA = [1.00, 1.00, 0.85, 0.45, 0.20];
  const pass = Math.min(2, Math.floor((paIndex - 1) / 3));
  const tto  = ttoMultByPass[pass];

  const starterEffective = (starterHR9 ?? LEAGUE_HR9) * tto;
  // Bullpen quality: prefer team-specific HR9 when provided. Sanity-clamp
  // because tiny early-season relief samples can produce wild estimates.
  const teamBullpen = opposingBullpenHR9 != null
    ? Math.min(2.2, Math.max(0.6, opposingBullpenHR9))
    : LEAGUE_HR9 * 1.05;
  const starterShare = starterShareByPA[Math.min(4, paIndex - 1)] ?? 0.15;
  return starterEffective * starterShare + teamBullpen * (1 - starterShare);
}

/**
 * Per-PA HR probability for a batter on a given PA index.
 *
 * Builds from the batter's own HR rate, modulates by pitcher quality
 * (effective HR/9 at that PA), environment, and park factor. Clamped to
 * a sensible range so a single freak input can't dominate.
 */
function paHRProbability({ batterHRPerPA, pitcherHR9AtPA, envMult, parkMult, platoonMult }) {
  // Modulate batter's base rate by pitcher quality vs league
  const matchupMult = (pitcherHR9AtPA ?? LEAGUE_HR9) / LEAGUE_HR9;
  const p = batterHRPerPA * matchupMult * envMult * parkMult * platoonMult;
  // Clamp to [0.3%, 12%] per PA — anything outside is almost certainly bad input
  return Math.min(0.12, Math.max(0.003, p));
}

/**
 * Run the simulation for one batter.
 *
 * @param {Object} args
 * @param {Object} args.batter         — { season: { hrRate, ab, pa } }
 * @param {Object} args.opposingPitcher — pitcher info { season: { hrPer9 } }
 * @param {Object} args.carry          — { score, parkFactor } from calculateBallCarry
 * @param {number} args.battingOrder   — 1-9 or null for projected lineup
 * @param {number} args.platoonAdj     — small +/- from scoreBatter's platoon edge
 *
 * @returns {Object} { hrProbability, expectedHRs, perPA }
 */
export function simulateBatter({ batter, opposingPitcher, carry, battingOrder, platoonAdj = 0, opposingBullpenHR9 = null }) {
  // Batter base HR-per-PA rate — derive from season HR/AB, convert to per-PA.
  // Fall back to league avg when the batter has tiny early-season sample.
  const rawHRPerAB = batter?.season?.hrRate ?? 0;
  const ab         = batter?.season?.ab ?? 0;
  // Bayesian shrinkage: a player with 5 ABs and 1 HR (.200 rate) should
  // not be treated as a true .200 HR/AB hitter. Blend toward league mean
  // proportional to sample size — full weight by 250 ABs.
  const SHRINK_K = 250;
  const shrunkHRPerAB = (rawHRPerAB * ab + (LEAGUE_HR_PER_PA / AB_PER_PA) * SHRINK_K)
                      / (ab + SHRINK_K);
  const batterHRPerPA = shrunkHRPerAB * AB_PER_PA;

  // Environment multiplier — carry.score is 0-100, 50 = neutral. Convert
  // to a multiplier centered on 1.0 (50 → 1.00, 100 → 1.30, 0 → 0.70).
  const envScore = carry?.score ?? 50;
  const envMult  = 0.70 + (envScore / 100) * 0.60;
  const parkMult = carry?.parkFactor ?? 1.0;

  // Platoon edge in score units → small multiplier (capped ±10%).
  const platoonMult = 1.0 + Math.min(0.10, Math.max(-0.10, platoonAdj / 50));

  const starterHR9 = opposingPitcher?.season?.hrPer9 ?? LEAGUE_HR9;
  const nPA = expectedPAs(battingOrder);
  // Use whole-PA contributions for the first N integer PAs, then a
  // fractional PA at the end (e.g., #2 hitter projects 4.5 PAs → 4 full + 0.5 partial).
  const fullPAs = Math.floor(nPA);
  const partial = nPA - fullPAs;

  const perPA = [];
  let logSurvival = 0;     // sum of log(1 - p_i) — numerically stable for many PAs
  let expectedHRs = 0;

  for (let i = 1; i <= fullPAs; i++) {
    const pitcherHR9AtPA = pitcherForPA(i, starterHR9, opposingBullpenHR9);
    const p = paHRProbability({ batterHRPerPA, pitcherHR9AtPA, envMult, parkMult, platoonMult });
    perPA.push({ pa: i, p, pitcherHR9: pitcherHR9AtPA });
    logSurvival += Math.log(1 - p);
    expectedHRs += p;
  }
  // Partial PA: treat as a fractional opportunity by scaling p
  if (partial > 0.05) {
    const i = fullPAs + 1;
    const pitcherHR9AtPA = pitcherForPA(i, starterHR9, opposingBullpenHR9);
    const pFull = paHRProbability({ batterHRPerPA, pitcherHR9AtPA, envMult, parkMult, platoonMult });
    const p = pFull * partial;
    perPA.push({ pa: i, p, pitcherHR9: pitcherHR9AtPA, partial });
    logSurvival += Math.log(1 - p);
    expectedHRs += p;
  }

  // P(≥1 HR) = 1 - Π(1-p_i)
  const hrProbability = 1 - Math.exp(logSurvival);
  return {
    hrProbability,
    expectedHRs,
    expectedPAs: nPA,
    perPA,
  };
}
