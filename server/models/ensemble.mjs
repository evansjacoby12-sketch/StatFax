/**
 * ensemble.mjs — Phase 3 ML: rule + learned stacker blend.
 *
 * The "ML model" here is a self-contained logistic-regression stacker fit on
 * the reconciled backtest log (server/models/trainEnsembleWeights.mjs). No
 * external libraries, no pretrained artifact — the cron retrains weights from
 * the current backtest log each run and writes them to
 * dist/ensemble-weights.json. loadMLModel() reads that file; scoreWithML()
 * applies sigmoid(intercept + Σwᵢxᵢ) to the same feature vector the trainer
 * used and converts the probability back to the 0-100 StatFax scale via the
 * same `prob / 0.28 * 100` mapping the rule path uses.
 *
 * If the weights file is missing or malformed, loadMLModel() returns null and
 * combineModels() falls back to pure-rule scoring unchanged. Zero-impact
 * rollback by deleting the weights file.
 *
 * @module ensemble
 */

import { promises as fs } from 'node:fs';
import { extractFeatures } from './trainEnsembleWeights.mjs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Default weight / feature-flag config for the ensemble.
 *
 * mlEnabled:            Gating flag. Flip to true once scoreWithML() and
 *                       loadMLModel() are functional. Callers SHOULD check
 *                       this before calling scoreWithML so they don't burn
 *                       compute when ML is inactive.
 *
 * weights:              Fallback weights used when autoWeightFromBrier is
 *                       false. rule:1, ml:0 = pure rule model until further
 *                       notice.
 *
 * autoWeightFromBrier:  When true, the caller is expected to accumulate Brier
 *                       scores for both models each week and call
 *                       weightsFromBrier() to derive live weights. Set false
 *                       until enough live ML predictions have been logged to
 *                       make that calibration meaningful (suggested minimum:
 *                       200 batter-game samples with known outcomes).
 */
export const DEFAULT_ENSEMBLE_OPTS = Object.freeze({
  // 80/20 rule/ML to start — the stacker is unproven on out-of-sample data
  // and we want any miscalibration to nudge the score, not dominate it.
  // Bump toward 50/50 once we have a few weeks of live ensembled outcomes to
  // compare via weightsFromBrier().
  weights: Object.freeze({ rule: 0.80, ml: 0.20 }),
  mlEnabled: true,
  autoWeightFromBrier: false,
});

// ---------------------------------------------------------------------------
// combineModels
// ---------------------------------------------------------------------------

/**
 * Blend a rule-based score and an (optional) ML score into a single ensembled
 * 0-100 score.
 *
 * Decision table:
 *   mlScore is null/undefined  → return ruleScore (no blending)
 *   ruleScore is null          → return Math.round(mlScore)
 *   both present               → Math.round(weights.rule * ruleScore + weights.ml * mlScore)
 *
 * Inputs are defensively clamped to [0, 100] before blending. If weights are
 * missing or do not appear to be valid numbers, they fall back to
 * { rule: 1, ml: 0 } (pure rule).
 *
 * @param {object} params
 * @param {number|null|undefined} params.ruleScore  - Rule-based score, 0-100.
 * @param {number|null|undefined} params.mlScore    - ML score, 0-100. Pass
 *   null/undefined to indicate the ML model did not produce a score.
 * @param {{ rule: number, ml: number }} [params.weights] - Linear blend
 *   weights. Both values should be in [0, 1] and sum to ~1.0.
 * @returns {number|null} Ensembled 0-100 integer score, or null if both
 *   inputs are null/undefined.
 */
export function combineModels({ ruleScore, mlScore, weights } = {}) {
  // Validate / default weights.
  const w = _resolveWeights(weights);

  // Both absent — nothing to blend.
  if (ruleScore == null && mlScore == null) return null;

  // ML absent — rule model only, no change to its value.
  if (mlScore == null) return ruleScore;

  // Rule absent — ML model only.
  if (ruleScore == null) return Math.round(_clamp(mlScore, 0, 100));

  // Both present — weighted blend.
  const clampedRule = _clamp(ruleScore, 0, 100);
  const clampedMl   = _clamp(mlScore,   0, 100);

  return Math.round(w.rule * clampedRule + w.ml * clampedMl);
}

// ---------------------------------------------------------------------------
// weightsFromBrier
// ---------------------------------------------------------------------------

/**
 * Compute ensemble weights from accumulated Brier scores via inverse-Brier
 * weighting. A lower Brier score indicates a better-calibrated model and
 * therefore earns more weight.
 *
 * Formula (unclamped):
 *   ruleWeight = mlBrier / (ruleBrier + mlBrier)
 *   mlWeight   = 1 - ruleWeight
 *
 * Both weights are clamped to [minWeight, maxWeight] to prevent either model
 * from being effectively silenced during a run of bad form.
 *
 * When mlBrier is null or undefined (i.e. ML model has not produced enough
 * scored predictions yet) the function returns pure-rule weights so callers
 * can call this unconditionally without branching.
 *
 * @param {number}  ruleBrier - Brier score for the rule model (0-1 scale).
 *   A perfectly calibrated model would score 0; random coin-flip ≈ 0.25.
 * @param {number|null|undefined} mlBrier - Brier score for the ML model.
 *   Pass null/undefined to indicate ML scores are not yet available.
 * @param {object} [opts]
 * @param {number} [opts.minWeight=0.20] - Floor applied to both weights after
 *   inversion. Keeps the weaker model in the blend so one bad week does not
 *   permanently silence it.
 * @param {number} [opts.maxWeight=0.80] - Ceiling. Symmetric with minWeight
 *   when both are 0.20 / 0.80 (default).
 * @returns {{ rule: number, ml: number }} Weights that sum to 1.0.
 */
export function weightsFromBrier(ruleBrier, mlBrier, opts = {}) {
  const minWeight = opts.minWeight ?? 0.20;
  const maxWeight = opts.maxWeight ?? 0.80;

  // ML Brier not yet available → pure-rule fallback.
  if (mlBrier == null) {
    return { rule: 1.0, ml: 0.0 };
  }

  // Guard against degenerate denominator (both Briers are zero = perfect).
  const denom = ruleBrier + mlBrier;
  if (denom === 0) {
    // Both models are perfect — split evenly.
    return { rule: 0.5, ml: 0.5 };
  }

  // Inverse-Brier: rule gets more weight when ML Brier is high.
  const rawRuleWeight = mlBrier / denom;
  const ruleWeight    = _clamp(rawRuleWeight, minWeight, maxWeight);
  const mlWeight      = _round2(1.0 - ruleWeight);

  return { rule: _round2(ruleWeight), ml: mlWeight };
}

// ---------------------------------------------------------------------------
// scoreWithML
// ---------------------------------------------------------------------------

/**
 * Run learned-stacker inference for a single batter row.
 *
 * The "ML model" is a logistic-regression stacker over the rule model's own
 * outputs (final score + active badges + grade one-hots). See
 * trainEnsembleWeights.mjs for the feature contract — extractFeatures() is
 * shared with the trainer so any change to the feature schema can only be
 * inconsistent if the weights file is stale (in which case the feature-length
 * check below logs a one-time warning and returns null).
 *
 * `opposingPitcher` is accepted for forward compatibility with a future
 * matchup-aware feature extractor; the current logistic stacker only consumes
 * the batter row.
 *
 * @param {object} batter         - The full scoredBatters[key] row (has
 *   `score`, `grade`, plus boolean badge fields hot/due/cold/...).
 * @param {object} opposingPitcher - Unused by current model. Kept in the
 *   signature so the caller doesn't change when richer features ship.
 * @param {object|null} modelHandle - Result of loadMLModel(). Null = ML off,
 *   short-circuit and return null so combineModels() passes through unchanged.
 *
 * @returns {number|null} 0-100 score (same scale as rule scorer) or null when
 *   ML is unavailable.
 */
export async function scoreWithML(
  batter,
  opposingPitcher, // eslint-disable-line no-unused-vars
  modelHandle,
) {
  // Preserve "ML off" semantics — combineModels() will return ruleScore as-is.
  if (modelHandle == null) return null;
  if (batter == null) return null;

  const { intercept, weights } = modelHandle;
  const features = extractFeatures(batter);

  if (features.length !== weights.length) {
    // Weights file is for a different feature schema than this build expects.
    // Warn once (loadMLModel's cache means this only fires per process), then
    // bail out so we don't score garbage.
    if (!_loggedFeatureMismatch) {
      console.warn(
        `[ml] feature/weights length mismatch (features=${features.length}, weights=${weights.length}) — disabling ML scoring`,
      );
      _loggedFeatureMismatch = true;
    }
    return null;
  }

  let z = intercept;
  for (let i = 0; i < weights.length; i++) z += weights[i] * features[i];
  const prob = _sigmoid(z);

  // Same prob-to-score mapping the rule path uses: 28% prob = score of 100.
  // KEEP IN SYNC with PROB_AT_MAX_SCORE in src/sports/mlb/logic/vegasBlend.js and
  // the mlScore/100*0.28 read in server/fetch-slate.mjs — this is one closed
  // ml-prob↔mlScore round-trip; both ends must use the same constant.
  return _clamp(Math.round((prob / 0.28) * 100), 0, 100);
}

// ---------------------------------------------------------------------------
// loadMLModel
// ---------------------------------------------------------------------------

/**
 * Read the trained logistic-regression weights from disk and cache them.
 *
 * Default path: `${process.cwd()}/dist/ensemble-weights.json` — same dist
 * directory the cron uses for its other published artifacts (daily.json,
 * calibration.json, backtest-log.json). The cron's training step writes the
 * weights file just before scoring, so this should be available on every run
 * after the first one that includes the training patch (see Integration spec).
 *
 * Returns a cached handle on subsequent calls so we only hit disk once per
 * process. To force a reload, set `_cachedModel = null` from a test seam — we
 * deliberately don't expose a public clear() because production callers
 * shouldn't need it.
 *
 * All failure modes return null with a `console.warn`:
 *   - file missing (no training run has produced weights yet)
 *   - JSON parse error (corrupted file)
 *   - schema validation (intercept not finite OR weights not an array)
 * A null handle is the sentinel scoreWithML() uses to short-circuit, so the
 * rule path keeps working unchanged whenever ML is unavailable.
 *
 * @param {string} [path] - Override the default weights path.
 * @returns {Promise<{intercept:number, weights:number[], featureNames?:string[]}|null>}
 */
export async function loadMLModel(path) {
  if (_cachedModel !== null) return _cachedModel;

  const resolved = path ?? `${process.cwd()}/dist/ensemble-weights.json`;

  let raw;
  try {
    raw = await fs.readFile(resolved, 'utf8');
  } catch (e) {
    // ENOENT is the expected first-run case — log it at warn level so cron
    // operators can see why ML hasn't kicked in yet, but don't escalate.
    console.warn(`[ml] weights file not loaded (${e?.code || e?.message}) at ${resolved} — falling back to rule-only`);
    _cachedModel = null;
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn(`[ml] weights file at ${resolved} is not valid JSON (${e?.message}) — falling back to rule-only`);
    _cachedModel = null;
    return null;
  }

  // Schema validation: intercept must be a finite number, weights must be an
  // array of finite numbers. Featurenames is recommended but not required for
  // inference (the length check in scoreWithML catches schema drift).
  if (
    typeof parsed?.intercept !== 'number' ||
    !isFinite(parsed.intercept) ||
    !Array.isArray(parsed.weights) ||
    parsed.weights.some(w => typeof w !== 'number' || !isFinite(w))
  ) {
    console.warn(`[ml] weights file at ${resolved} failed schema validation — falling back to rule-only`);
    _cachedModel = null;
    return null;
  }

  _cachedModel = parsed;
  return _cachedModel;
}

// Module-scope cache so loadMLModel() only reads the weights file once per
// process. The cron runs the whole pipeline in a single Node process per
// invocation so a per-process cache is the right granularity.
let _cachedModel = null;

// One-time warning flag for the schema-mismatch path in scoreWithML.
let _loggedFeatureMismatch = false;

// ---------------------------------------------------------------------------
// ENSEMBLE_README
// ---------------------------------------------------------------------------

/**
 * Human-readable (and agent-readable) activation guide.
 *
 * Embedded as an export so it surfaces in automated tooling (e.g. an
 * /explain command can import and print it) without having to grep comments.
 *
 * @type {string}
 */
export const ENSEMBLE_README = `
=============================================================
  StatFax — Ensemble Guide (Phase 3, learned stacker)
=============================================================

CURRENT STATE
  The scoring pipeline runs the rule scorer + a logistic-regression stacker
  fit on the reconciled backtest log. No external ML deps; weights are
  retrained each cron run and written to dist/ensemble-weights.json.
  DEFAULT_ENSEMBLE_OPTS.mlEnabled = true
  DEFAULT_ENSEMBLE_OPTS.weights   = { rule: 0.80, ml: 0.20 }  (conservative)

PIPELINE
  1. fetch-slate.mjs loads backtest-log.json from R2 as usual.
  2. trainEnsembleWeights(backtestLog, { lookbackDays: 30 }) fits the
     stacker in ~50 ms and writes dist/ensemble-weights.json.
  3. Scoring loop calls loadMLModel() once (cached), then scoreWithML(row, ...)
     per batter. combineModels() blends rule + ML at 80/20.

FEATURES (in fixed FEATURE_NAMES order, see trainEnsembleWeights.mjs)
  - score (normalised to 0-1)
  - 6 badge booleans: hot, due, cold, bullpenLegend, dayEdge, nightEdge
  - 4 grade one-hots: PRIME, STRONG, LEAN, SKIP

ROLLBACK
  Two options, both reversible by file edit alone:
    (a) Delete dist/ensemble-weights.json — loadMLModel() returns null,
        scoreWithML() returns null, combineModels() passes ruleScore
        through unchanged.
    (b) Flip DEFAULT_ENSEMBLE_OPTS.mlEnabled back to false (kill-switch).

CALIBRATION GROWTH PLAN
  Once a few weeks of ensembled scores are reconciled, flip
    autoWeightFromBrier: true
  and accumulate per-model Brier scores. weightsFromBrier(ruleBrier, mlBrier)
  will move the blend toward whichever model is better-calibrated.

=============================================================
`.trim();

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a number to [min, max].
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function _clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Numerically-stable sigmoid. The two-branch form avoids Math.exp on large
 * positive z (overflow to Infinity → NaN downstream) while keeping the result
 * mathematically identical to 1/(1+e^-z).
 *
 * @param {number} z
 * @returns {number} sigmoid in [0, 1]
 */
function _sigmoid(z) {
  if (z >= 0) {
    const ez = Math.exp(-z);
    return 1 / (1 + ez);
  }
  const ez = Math.exp(z);
  return ez / (1 + ez);
}

/**
 * Round to 2 decimal places for weight display clarity.
 * @param {number} value
 * @returns {number}
 */
function _round2(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Resolve and validate a weights object, returning safe defaults on failure.
 *
 * Accepts { rule, ml } where both should be finite numbers in [0, 1].
 * Falls back to { rule: 1, ml: 0 } when the input is missing or malformed.
 *
 * @param {{ rule: number, ml: number }|null|undefined} weights
 * @returns {{ rule: number, ml: number }}
 */
function _resolveWeights(weights) {
  const fallback = { rule: 1, ml: 0 };

  if (!weights || typeof weights !== 'object') return fallback;

  const r = weights.rule;
  const m = weights.ml;

  if (typeof r !== 'number' || !isFinite(r)) return fallback;
  if (typeof m !== 'number' || !isFinite(m)) return fallback;

  // Weights that are both 0 or otherwise degenerate → use fallback.
  if (r === 0 && m === 0) return fallback;

  // Accept weights even if they don't sum exactly to 1.0 — the caller might
  // have rounding drift. We do NOT re-normalise here; that is the caller's
  // responsibility. combineModels() simply uses them as given.
  return { rule: r, ml: m };
}
