/**
 * batterPitchTypeISO.js
 *
 * Pure functions — no fetch, no async, no I/O. Lives in src/sports/mlb/logic/
 * (not server/) so it rides the model.mjs bundle and is re-exported through
 * ProbabilityEngine.js for both server-side scoring and on-device fallback.
 *
 * WHY THIS EXISTS
 * ───────────────
 * The existing arsenal-edge logic (`computeArsenalEdge`) in ProbabilityEngine
 * buckets pitches into three families (fastball / breaking / offspeed) before
 * crossing with the batter's SLG. That bucketing loses within-family signal:
 * a batter who mashes 4-seamers (.570 SLG) but is below average on cutters
 * (.310 SLG) looks the same against a 60% cutter pitcher as against a
 * 60% 4-seam pitcher under the old approach.
 *
 * These functions operate at full pitch-type granularity:
 *   • ff (4-Seam Fastball)
 *   • si (Sinker)
 *   • fc (Cutter)
 *   • sl (Slider)
 *   • cu (Curveball)
 *   • kc (Knuckle-Curve)
 *   • ch (Changeup)
 *   • fs (Splitter)
 *
 * DATA SOURCES (already in the snapshot — no new fetches required)
 * ────────────────────────────────────────────────────────────────
 *   batterArsenal  — from fetchSavantBatterPitchPerf():
 *                    { ffSlg, siSlg, fcSlg, slSlg, cuSlg, kcSlg, chSlg, fsSlg, … }
 *   pitchMix       — from fetchSavantPitcherPitchMix():
 *                    { ffPct, siPct, fcPct, slPct, cuPct, kcPct, chPct, fsPct, … }
 */

/** MLB 2024/2025 league-average SLG per pitch type (rounded).
 *  Used as the normalisation baseline so the multiplier centres at 1.0
 *  for a league-average batter facing a league-average arsenal. */
const LEAGUE_AVG_SLG_BY_PITCH = {
  ff: 0.415,
  si: 0.405,
  fc: 0.395,
  sl: 0.375,
  cu: 0.360,
  kc: 0.370,
  ch: 0.410,
  fs: 0.390,
};

/** Pitch codes that have matching keys in batterArsenal and pitchMix. */
const PITCH_CODES = ['ff', 'si', 'fc', 'sl', 'cu', 'kc', 'ch', 'fs'];

/**
 * Compute a per-PA HR-probability multiplier from the batter's SLG vs each
 * pitch type crossed with the opposing pitcher's pitch-usage distribution.
 *
 * MATH
 * ────
 *   weightedSLG = Σ (batterSLG[p] × pitcherPct[p]) / Σ pitcherPct[p]
 *                   for all pitch types where both values exist
 *
 *   multiplier  = clamp(weightedSLG / LEAGUE_AVG_SLG[p-mix], 0.85, 1.20)
 *
 * CLAMP RATIONALE (0.85 – 1.20)
 * ──────────────────────────────
 * A multiplier is a nudge on top of the existing model score, not a
 * standalone prediction. Capping at ±15–20% means this signal contributes
 * ≈ 4–6 pts on a 0-100 scale, which is consistent with the expected
 * 5-8% Brier-score improvement target. Wider bounds would let a single
 * pitch-type mismatch override every other signal in the model; tighter
 * bounds would make the function pointless.
 *
 * @param {object|null} batterArsenal  Batter's SLG by pitch from fetchSavantBatterPitchPerf.
 *                                     Expected shape: { ffSlg, siSlg, fcSlg, … }
 * @param {object|null} pitchMix       Pitcher's usage % from fetchSavantPitcherPitchMix.
 *                                     Expected shape: { ffPct, siPct, fcPct, … }
 * @returns {number} Multiplier in [0.85, 1.20]. Returns 1.0 on missing / insufficient data.
 */
export function expectedHRMultiplierFromPitchMix(batterArsenal, pitchMix) {
  if (!batterArsenal || !pitchMix) return 1.0;

  let weightedSlgSum  = 0;
  let weightedBaseSum = 0;
  let totalFreq       = 0;

  for (const code of PITCH_CODES) {
    const freq = pitchMix[`${code}Pct`];
    const slg  = batterArsenal[`${code}Slg`];
    const base = LEAGUE_AVG_SLG_BY_PITCH[code];

    if (freq == null || freq <= 0) continue;
    if (slg  == null)              continue;

    weightedSlgSum  += slg  * freq;
    weightedBaseSum += base * freq;
    totalFreq       += freq;
  }

  // Need at least two pitch types worth of overlap to form a meaningful signal.
  if (totalFreq < 10 || weightedBaseSum === 0) return 1.0;

  const multiplier = weightedSlgSum / weightedBaseSum;
  return Math.min(1.20, Math.max(0.85, multiplier));
}

/**
 * Human-readable "alignment score": how well does this batter's pitch-type
 * strengths match the pitcher's arsenal? Intended for PlayerDetailModal display.
 *
 * Algorithm
 * ─────────
 * For each pitch type where both sides have data, compute
 *   edge[p] = (batterSLG[p] - LEAGUE_AVG_SLG[p]) × pitcherPct[p]
 * Positive edge  → batter above-average on a pitch the pitcher throws a lot.
 * Negative edge  → batter below-average on a pitch the pitcher leans on.
 *
 * Raw sum is normalised to 0–100 with:
 *   50 = league-average batter vs any pitcher (neutral alignment)
 *   70+ = strong batter-favourable mismatch (pitcher telegraphing weakness)
 *   30- = pitcher-favourable mismatch (batter can be exploited)
 *
 * @param {object|null} batterArsenal  Same shape as expectedHRMultiplierFromPitchMix.
 * @param {object|null} pitchMix       Same shape as expectedHRMultiplierFromPitchMix.
 * @returns {number} Integer 0–100. Returns 50 on missing data.
 */
export function getPitchAlignmentScore(batterArsenal, pitchMix) {
  if (!batterArsenal || !pitchMix) return 50;

  let rawEdge   = 0;
  let totalFreq = 0;

  for (const code of PITCH_CODES) {
    const freq = pitchMix[`${code}Pct`];
    const slg  = batterArsenal[`${code}Slg`];
    const base = LEAGUE_AVG_SLG_BY_PITCH[code];

    if (freq == null || freq <= 0) continue;
    if (slg  == null)              continue;

    rawEdge   += (slg - base) * (freq / 100);
    totalFreq += freq;
  }

  if (totalFreq < 10) return 50;

  // rawEdge typical range: -0.10 to +0.10 (SLG deviation × usage fraction).
  // Map to 0-100: 0 → 50, ±0.10 → ±40 pts, clamped.
  const score = 50 + rawEdge * 400;
  return Math.round(Math.min(100, Math.max(0, score)));
}
