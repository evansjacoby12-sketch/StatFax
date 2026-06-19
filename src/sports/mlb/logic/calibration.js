/**
 * calibration — feeds empirical hit rates from the backtest log back into the
 * scoring model. The base scoreBatter() weights are fixed best-guesses; this
 * layer nudges them gently based on what's actually predicted vs. what's
 * actually happened.
 *
 * Loop:
 *   1. On app boot, load the cached calibration map from AsyncStorage.
 *   2. After every reconcileDay() succeeds, recompute (with sample-size guard).
 *   3. ProbabilityEngine reads `getCalibration()` synchronously and applies
 *      bounded multipliers (±15%) to the final score per active badge/grade.
 *
 * Why bounded:
 *   - Tiny samples produce wild ratios — capping prevents a 2-out-of-3 streak
 *     from cratering or doubling a player's score.
 *   - Even with rock-solid data, we don't want runaway feedback: a slightly
 *     hot signal shouldn't get aggressively reinforced into a "must-pick"
 *     across the board, because the rest of the model assumes the OG weights.
 *
 * Storage shape (key: 'statfax_model_calibration'):
 *   {
 *     samples:    482,
 *     computedAt: '2025-05-20T03:14:00Z',
 *     badges: { hot: 1.05, due: 1.02, cold: 0.95, bullpenLegend: 1.08, ... },
 *     grades: { PRIME: 1.02, STRONG: 1.00, LEAN: 0.99, SKIP: 0.95 },
 *   }
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getPerformanceReport } from '../../../utils/backtest';

const STORAGE_KEY = 'statfax_model_calibration';

// Require a real mountain of data before letting empirical calibration
// shift any score. Previously 300 was enough, which meant two devices with
// different reconciliation histories could produce different grades for the
// SAME player on the SAME day (e.g. friend's calibration nudges Brandon Lowe
// across the 72 PRIME boundary, yours leaves him at STRONG 70). Pushing this
// to 1500 + tightening MAX_DELTA keeps the model effectively identical across
// devices until we have enough data for everyone to converge.
const MIN_SAMPLES_TO_CALIBRATE = 1500;

// Cap any single multiplier at ±8% from 1.0 (was ±15%). Combined with the
// existing geometric-mean dampening, a stacked-badge player can't be moved
// more than ~5 score points from their raw value.
const MAX_DELTA = 0.08;

// In-memory cache — scoreBatter reads this synchronously every call.
let activeCalibration = {
  samples:    0,
  badges:     {},
  grades:     {},
  computedAt: null,
  ready:      false,   // true once samples >= MIN_SAMPLES_TO_CALIBRATE
};

// Per-device dynamic recompute is disabled. We never let on-device backtest
// history drive scoring multipliers, because two users with different
// reconciliation histories would see different scores for the same player.
// Calibration now happens SERVER-SIDE only — server/reconcile.mjs computes
// multipliers from a shared 30-day log, writes calibration.json to R2, and
// server/fetch-slate.mjs hydrates the model via setActiveCalibration()
// BEFORE running scoreBatter, so every device reads the same calibrated
// scores from the snapshot. Multiplier reads (badge/grade) still flow
// through this module — they just consult `activeCalibration.ready` set by
// setActiveCalibration() rather than by a local recompute.
const ALLOW_DEVICE_RECOMPUTE = false;

/** Synchronous read for scoreBatter. Returns a stable shape even pre-load. */
export function getCalibration() {
  return activeCalibration;
}

/**
 * Server-side hydration: replace activeCalibration with a precomputed bundle
 * shipped via R2. Called from server/fetch-slate.mjs before the scoring loop
 * runs, so the bundled scoreBatter() applies the same multipliers everywhere.
 * No-op when called with falsy input. On the client this is never called,
 * so activeCalibration stays at its default `ready:false` and the multiplier
 * lookups below return 1.0 (no client-side drift).
 */
export function setActiveCalibration(next) {
  if (!next || typeof next !== 'object') return activeCalibration;
  activeCalibration = {
    samples:    next.samples    ?? 0,
    badges:     next.badges     ?? {},
    grades:     next.grades     ?? {},
    computedAt: next.computedAt ?? null,
    ready:      (next.samples ?? 0) >= MIN_SAMPLES_TO_CALIBRATE,
  };
  return activeCalibration;
}

/** Returns the multiplier for a given badge key. Defaults to 1.0. */
export function badgeMultiplier(key) {
  if (!activeCalibration.ready) return 1.0;
  return activeCalibration.badges[key] ?? 1.0;
}

/** Returns the multiplier for a grade band. Defaults to 1.0. */
export function gradeMultiplier(gradeKey) {
  if (!activeCalibration.ready) return 1.0;
  return activeCalibration.grades[gradeKey] ?? 1.0;
}

/**
 * Load cached calibration from on-device AsyncStorage. Kept for the rare
 * fallback where a device runs the slow-path scorer (snapshot missing).
 * Gated by ALLOW_DEVICE_RECOMPUTE so stale per-device data can't influence
 * scoring while the server-side path is the source of truth.
 */
export async function loadCalibration() {
  if (!ALLOW_DEVICE_RECOMPUTE) return activeCalibration;
  let raw;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
  } catch {
    return activeCalibration;
  }
  if (!raw) return activeCalibration;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      activeCalibration = {
        samples:    parsed.samples    ?? 0,
        badges:     parsed.badges     ?? {},
        grades:     parsed.grades     ?? {},
        computedAt: parsed.computedAt ?? null,
        ready:      (parsed.samples ?? 0) >= MIN_SAMPLES_TO_CALIBRATE,
      };
    }
  } catch {
    // Corrupted stored calibration (partial write, malformed JSON). Wipe so
    // the next session starts clean instead of retrying the same bad data
    // every load.
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  }
  return activeCalibration;
}

/**
 * Recompute calibration from the last 30 days of reconciled predictions.
 * Stores the result and updates the in-memory cache. No-op if sample size
 * is below MIN_SAMPLES_TO_CALIBRATE — we leave the previous calibration in
 * place rather than reverting to all-1.0s with a small batch.
 */
export async function recomputeCalibration() {
  // Per-device recompute stays off — the server-side loop is the single
  // source of truth for multipliers. This function stays callable so
  // older callers don't blow up; it just returns the current state.
  if (!ALLOW_DEVICE_RECOMPUTE) return activeCalibration;

  // Guard: once-per-calendar-day in CENTRAL time (matches the reconcile
  // schedule). Was using UTC slice — caused an extra recompute every
  // evening in CT (when UTC ticks over to "tomorrow") even though no new
  // backtest data had landed yet. Anchoring to CT avoids the duplicate work.
  const ctFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today      = ctFmt.format(new Date());
  const lastCT     = activeCalibration?.computedAt
    ? ctFmt.format(new Date(activeCalibration.computedAt))
    : null;
  if (lastCT === today) {
    return activeCalibration;
  }

  let report;
  try {
    report = await getPerformanceReport(30);
  } catch {
    return activeCalibration;
  }
  if (!report || !report.overall || report.totalPredictions < MIN_SAMPLES_TO_CALIBRATE) {
    return activeCalibration;
  }

  const overallRate = report.overall.rate;
  if (!overallRate) return activeCalibration;

  // ── Per-badge multipliers ─────────────────────────────────────────────────
  // For each badge, compare hit rate WITH the badge to overall hit rate. If
  // batters with HOT BAT homer at 7.2% but the overall pool homers at 5.8%,
  // the lift ratio is 1.24 — so we nudge HOT batters slightly higher.
  // Square-root dampens the signal so a 24% empirical lift becomes a ~12%
  // multiplier rather than a full 24% (which would compound badly with the
  // existing badge logic in scoreBatter that already favors these flags).
  const badges = {};
  for (const b of report.badges) {
    if (!b.with || b.with.total < 50) continue;  // need at least 50 with-badge samples
    const liftRatio = b.with.rate / overallRate;
    if (!isFinite(liftRatio) || liftRatio <= 0) continue;
    const dampened = Math.sqrt(liftRatio);  // 1.24 → 1.11, 0.80 → 0.89
    const clamped  = Math.min(1 + MAX_DELTA, Math.max(1 - MAX_DELTA, dampened));
    badges[b.key] = Number(clamped.toFixed(3));
  }

  // ── Per-grade multipliers ────────────────────────────────────────────────
  // PRIME should homer more than STRONG, etc. If the actual gradient is
  // weaker than the score implies, gently flatten; if it's stronger, leave
  // alone. We compare each grade's hit rate to the overall rate and nudge.
  const grades = {};
  if (report.grades) {
    for (const [gradeKey, stats] of Object.entries(report.grades)) {
      if (!stats || stats.total < 80) continue;
      const liftRatio = stats.rate / overallRate;
      if (!isFinite(liftRatio) || liftRatio <= 0) continue;
      const dampened = Math.sqrt(liftRatio);
      const clamped  = Math.min(1 + MAX_DELTA, Math.max(1 - MAX_DELTA, dampened));
      grades[gradeKey] = Number(clamped.toFixed(3));
    }
  }

  const next = {
    samples:    report.totalPredictions,
    badges,
    grades,
    computedAt: new Date().toISOString(),
    ready:      true,
  };

  activeCalibration = next;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

/**
 * Apply calibration to a finished score. Returns { score, gradeKey } where
 * gradeKey is **re-derived from the adjusted score** so the displayed grade
 * always matches the score (avoids the "PRIME 64" inconsistency we'd get if
 * a strong score got dampened below the 72 threshold but kept its old label).
 *
 * Caller passes the active-badge keys so we know which multipliers to use.
 * Bounded by MAX_DELTA per multiplier and clamped to [0, 100].
 */
export function applyCalibration(score, gradeKey, activeBadgeKeys = []) {
  if (!activeCalibration.ready) return { score, gradeKey };

  // Grade multiplier is the PRIMARY empirical correction and must NOT be
  // diluted by the geometric mean. Folding it into pow(·, 1/(badges+1)) — as
  // the old code did — shrank a PRIME grade nudge toward 1.0 the moment a batter
  // had any badges (e.g. a 1.45 grade mult with 3 badges became its cube-root
  // ~1.13), so the wide per-grade band computed server-side (GRADE_DELTA_MAX)
  // was thrown away here. Apply the grade multiplier DIRECTLY, and geometric-
  // mean-dampen ONLY the badge product to prevent multi-badge pile-on inflation.
  const gradeMult = gradeMultiplier(gradeKey);

  let badgeProduct = 1;
  for (const k of activeBadgeKeys) {
    badgeProduct *= badgeMultiplier(k);
  }
  // Geometric-mean dampening over the BADGES only: if a player has 5 active
  // badges each nudged 1.1, the raw product is 1.61; the dampened version is
  // 1.1. Empty badge list → 1.0 (no-op). Grade is excluded from this mean.
  const dampedBadges = activeBadgeKeys.length
    ? Math.pow(badgeProduct, 1 / activeBadgeKeys.length)
    : 1;

  const damped = gradeMult * dampedBadges;

  let adjusted = Math.min(100, Math.max(0, Math.round(score * damped)));

  // Grade-boundary safeguard. If calibration would push a score ACROSS a
  // tier boundary by ≤2 points, don't let it. This stops cross-device
  // disagreement on edge cases (e.g. raw 71 → calibrated 72 = PRIME on
  // one phone, raw 71 → calibrated 70 = STRONG on another). The raw score
  // already implies a clear verdict; calibration shouldn't tip a borderline.
  const BOUNDARIES = [72, 52, 36];
  for (const b of BOUNDARIES) {
    const crossedUp   = score <  b && adjusted >= b;
    const crossedDown = score >= b && adjusted <  b;
    if ((crossedUp || crossedDown) && Math.abs(adjusted - score) <= 2) {
      adjusted = score;
      break;
    }
  }

  // Re-derive grade from the (possibly de-clamped) score. Same thresholds as
  // ProbabilityEngine's SCORE_TIERS (PRIME 72 / STRONG 52 / LEAN 36) —
  // duplicated as constants here to avoid a circular import.
  let newGrade;
  if      (adjusted >= 72) newGrade = 'PRIME';
  else if (adjusted >= 52) newGrade = 'STRONG';
  else if (adjusted >= 36) newGrade = 'LEAN';
  else                     newGrade = 'SKIP';
  return { score: adjusted, gradeKey: newGrade };
}
