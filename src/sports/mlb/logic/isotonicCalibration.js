/**
 * isotonicCalibration — fits a monotonic mapping from raw score buckets (0-100)
 * to observed HR hit rates using the rolling backtest log.
 *
 * Why isotonic regression (Pool Adjacent Violators — PAV)?
 *   A plain histogram of hit-rate per bucket is noisy: a thin bucket might show
 *   10% while the next shows 4%, even though higher scores should predict more
 *   homers, not fewer. PAV enforces the monotonicity constraint by iteratively
 *   merging any bucket pair where the left bucket has a *higher* rate than the
 *   right, replacing both with their pooled average. This continues until the
 *   entire sequence is non-decreasing. The result is the closest monotone
 *   sequence to the raw rates in a least-squares sense.
 *
 * Boundary preservation note:
 *   When PAV merges two buckets internally, we still output the original bucket
 *   boundaries ([60-70], [70-80], …) so the client can render "60-70 → 8.7%"
 *   cleanly. Merged siblings share an observedProb value.
 *
 * Server vs. client:
 *   Fitting (fitIsotonicFromBacktest) runs server-side only. The resulting
 *   table is serialized into the snapshot payload. Clients call lookupProb()
 *   with the received table — zero fitting work on-device.
 *
 * Pure JS, no imports.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** League-wide baseline HR rate used for Bayesian smoothing. */
export const LEAGUE_PRIOR = 0.035;

/** Linear approximation used as a last-resort fallback. */
export const LINEAR_BASE  = 0.025;
export const LINEAR_SLOPE = 0.0015;

// ---------------------------------------------------------------------------
// DEFAULT_LOOKUP_TABLE
// Hand-tuned fallback reflecting rough league HR rates by score bucket.
// Used on first-ever runs before any backtest data exists.
// n: null signals "not fitted from real data".
// ---------------------------------------------------------------------------

/**
 * @type {Array<{scoreLo: number, scoreHi: number, observedProb: number, n: number|null}>}
 */
export const DEFAULT_LOOKUP_TABLE = [
  { scoreLo:  0, scoreHi:  10, observedProb: 0.012, n: null },
  { scoreLo: 10, scoreHi:  20, observedProb: 0.020, n: null },
  { scoreLo: 20, scoreHi:  30, observedProb: 0.030, n: null },
  { scoreLo: 30, scoreHi:  40, observedProb: 0.040, n: null },
  { scoreLo: 40, scoreHi:  50, observedProb: 0.052, n: null },
  { scoreLo: 50, scoreHi:  60, observedProb: 0.067, n: null },
  { scoreLo: 60, scoreHi:  70, observedProb: 0.087, n: null },
  { scoreLo: 70, scoreHi:  80, observedProb: 0.112, n: null },
  { scoreLo: 80, scoreHi:  90, observedProb: 0.140, n: null },
  { scoreLo: 90, scoreHi: 100, observedProb: 0.165, n: null },
];

// ---------------------------------------------------------------------------
// fitIsotonicFromBacktest
// ---------------------------------------------------------------------------

/**
 * Fit a monotonic score → HR-probability mapping from the backtest log.
 *
 * @param {Object} backtestLog - Shape: { dates: string[], records: { 'YYYY-MM-DD': Array<{playerId, score, grade, homered}> } }
 * @param {Object} [opts]
 * @param {number} [opts.bucketSize=10]      - Width of each score bucket (0-10, 10-20, …)
 * @param {number} [opts.minNPerBucket=10]   - Minimum samples before a bucket is used as-is; sparser buckets are merged into their neighbor
 * @param {number} [opts.lookbackDays=30]    - How many calendar days of records to include
 * @returns {{ table: Array<{scoreLo, scoreHi, observedProb, n}>, totalN: number, fittedAt: string }}
 */
export function fitIsotonicFromBacktest(backtestLog, opts = {}) {
  const bucketSize    = opts.bucketSize    ?? 10;
  const minNPerBucket = opts.minNPerBucket ?? 10;
  const lookbackDays  = opts.lookbackDays  ?? 30;

  // Guard: empty or malformed input → return the fallback table.
  if (
    !backtestLog ||
    typeof backtestLog !== 'object' ||
    !backtestLog.records ||
    typeof backtestLog.records !== 'object'
  ) {
    return _fallbackResult();
  }

  // ── Step a: Walk recent N days, accumulate (n, hits) per bucket ──────────
  const numBuckets = Math.ceil(100 / bucketSize); // 10 for default
  const counts = new Array(numBuckets).fill(null).map(() => ({ n: 0, hits: 0 }));

  const cutoffDate = _dateMinus(lookbackDays);
  let totalN = 0;

  const dates = Array.isArray(backtestLog.dates) ? backtestLog.dates : Object.keys(backtestLog.records);
  for (const dateStr of dates) {
    if (dateStr < cutoffDate) continue;
    const dayRecords = backtestLog.records[dateStr];
    if (!Array.isArray(dayRecords)) continue;

    for (const rec of dayRecords) {
      const score = typeof rec.score === 'number' ? rec.score : null;
      if (score === null || score < 0 || score > 100) continue;
      const bucketIdx = Math.min(Math.floor(score / bucketSize), numBuckets - 1);
      counts[bucketIdx].n    += 1;
      counts[bucketIdx].hits += rec.homered ? 1 : 0;
      totalN += 1;
    }
  }

  // Guard: too few samples overall → fallback.
  if (totalN < numBuckets * minNPerBucket) {
    return _fallbackResult();
  }

  // ── Step b: Merge sparse buckets into their right neighbor ───────────────
  // Work left-to-right: if a bucket has fewer than minNPerBucket samples, absorb
  // it into the next bucket. The last bucket absorbs leftward instead.
  const merged = counts.map((c, i) => ({
    scoreLo:  i * bucketSize,
    scoreHi:  (i + 1) * bucketSize,
    n:        c.n,
    hits:     c.hits,
    origIdxs: [i],  // original bucket indices sharing this group
  }));

  let i = 0;
  while (i < merged.length) {
    if (merged[i].n < minNPerBucket) {
      if (i + 1 < merged.length) {
        // Absorb into right neighbor.
        merged[i + 1].n    += merged[i].n;
        merged[i + 1].hits += merged[i].hits;
        merged[i + 1].origIdxs = merged[i].origIdxs.concat(merged[i + 1].origIdxs);
        merged.splice(i, 1);
        // Don't advance i — the new element at i needs to be re-checked.
      } else if (i > 0) {
        // Last bucket: absorb into left neighbor.
        merged[i - 1].n    += merged[i].n;
        merged[i - 1].hits += merged[i].hits;
        merged[i - 1].origIdxs = merged[i - 1].origIdxs.concat(merged[i].origIdxs);
        merged.splice(i, 1);
        i = Math.max(0, i - 1);
      } else {
        // Single bucket with no neighbors — stop; will get smoothed below.
        break;
      }
    } else {
      i++;
    }
  }

  // ── Step c: Pool Adjacent Violators (PAV) — enforce monotonicity ─────────
  // Raw hit rate per group.
  for (const g of merged) {
    g.rawRate = g.n > 0 ? g.hits / g.n : 0;
  }

  // PAV: scan left-to-right; if group[k].rawRate > group[k+1].rawRate, merge.
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 0; k < merged.length - 1; k++) {
      if (merged[k].rawRate > merged[k + 1].rawRate) {
        // Merge k and k+1 into k.
        merged[k].n        += merged[k + 1].n;
        merged[k].hits     += merged[k + 1].hits;
        merged[k].origIdxs  = merged[k].origIdxs.concat(merged[k + 1].origIdxs);
        merged[k].rawRate   = merged[k].n > 0 ? merged[k].hits / merged[k].n : 0;
        merged.splice(k + 1, 1);
        changed = true;
        break; // Restart scan — earlier groups may now violate.
      }
    }
  }

  // ── Step d: Bayesian smoothing ────────────────────────────────────────────
  // observedProb = (hits + 2 * leaguePrior) / (n + 2 * (1 / leaguePrior))
  // This prevents a 0-hit bucket from producing 0% (a true zero is very
  // unlikely over ≥10 observations; small-sample buckets should regress to
  // the league prior rather than claiming near-zero probability).
  const alpha = 2 * LEAGUE_PRIOR;
  const beta  = 2 * (1 / LEAGUE_PRIOR);
  for (const g of merged) {
    g.smoothedProb = (g.hits + alpha) / (g.n + beta);
  }

  // ── Expand back to original bucket boundaries ─────────────────────────────
  // PAV groups share a smoothedProb. We output one row per original bucket,
  // so the client can render "60-70 → 8.7%" while internally merged siblings
  // share the same observedProb.
  const origBuckets = Array.from({ length: numBuckets }, (_, idx) => ({
    scoreLo:     idx * bucketSize,
    scoreHi:     (idx + 1) * bucketSize,
    observedProb: null,
    n:           counts[idx].n,
  }));

  for (const g of merged) {
    for (const origIdx of g.origIdxs) {
      origBuckets[origIdx].observedProb = Number(g.smoothedProb.toFixed(4));
    }
  }

  // Safety: fill any nulls (shouldn't occur, but defensive).
  for (const b of origBuckets) {
    if (b.observedProb === null) {
      b.observedProb = _linearFallback(b.scoreLo + bucketSize / 2);
    }
  }

  return {
    table:    origBuckets,
    totalN,
    fittedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// fitIsotonicAdaptive — CV-selected bucket width
// ---------------------------------------------------------------------------

/** Candidate bucket widths, coarse → fine. The selector starts coarse and only
 *  adopts a finer grid when it MEASURABLY improves cross-validated Brier. */
const ADAPTIVE_BUCKET_SIZES = [20, 15, 12, 10, 8, 6, 5];

/** A finer grid must beat the current incumbent's CV Brier by at least this
 *  much to be adopted. Keeps day-to-day bucket choice stable (their own CV gap
 *  between bucket 15 and 10 was ~0.0008, so this is ~1/3 of a real signal). */
const ADAPTIVE_BRIER_EPS = 0.0003;

/** Below this many reconciled rows there isn't enough data to CV-select a grid
 *  without chasing noise — fall back to the plain fit at the proven default. */
const ADAPTIVE_MIN_ROWS = 750;

const _defaultIsoFallback = (s) => Math.max(0.005, Math.min(0.30, (Math.max(0, Math.min(100, s)) / 100) * 0.18));

/** One-fold Brier: fit the isotonic table on `train` at `bucketSize`, score
 *  `test` with it (out-of-sample). */
function _isoFoldBrier(train, test, bucketSize, fallbackFn) {
  const sub = { dates: ['_'], records: { _: train } };
  const { table } = fitIsotonicFromBacktest(sub, { lookbackDays: 9999, bucketSize });
  let s = 0;
  for (const r of test) {
    const p = lookupProb(r.score, table, fallbackFn);
    const y = r.homered ? 1 : 0;
    s += (p - y) * (p - y);
  }
  return test.length ? s / test.length : null;
}

/** Deterministic k-fold (index % k, no RNG) mean out-of-sample Brier at a grid. */
function _isoCvBrier(rows, bucketSize, fallbackFn, k = 5) {
  const folds = Array.from({ length: k }, () => []);
  rows.forEach((r, i) => folds[i % k].push(r));
  let sum = 0;
  let used = 0;
  for (let f = 0; f < k; f++) {
    const test = folds[f];
    const train = folds.filter((_, i) => i !== f).flat();
    if (!test.length || !train.length) continue;
    const b = _isoFoldBrier(train, test, bucketSize, fallbackFn);
    if (b == null) continue;
    sum += b;
    used += 1;
  }
  return used ? sum / used : null;
}

/**
 * Fit the score→prob table at the bucket width that GENERALIZES best, chosen by
 * 5-fold CV on the current log rather than a hardcoded constant.
 *
 * Background: the deployed call hardcoded `bucketSize: 15` because an offline
 * 5-fold CV found 15 beat 10 (Brier 0.1000 vs 0.1008). But that CV ran on a log
 * whose pre-game scores had drifted (the live-decay/Final freeze bug — since
 * fixed), so coarse buckets were "winning" partly by smearing over corrupted
 * scores. Coarse buckets also pin the ceiling low: the top 75-90 band genuinely
 * homers ~37% lately, but a single wide, thin top bucket regresses that toward
 * the bucket mean. Letting CV re-pick the grid each run on the now-clean log
 * lifts the ceiling exactly when the data supports finer resolution — and can
 * never do worse than the old default, since 15 stays in the candidate set and
 * a finer grid is adopted only when it clearly wins.
 *
 * Returns the same shape as fitIsotonicFromBacktest plus { bucketSize, cv,
 * adaptive } for observability.
 */
export function fitIsotonicAdaptive(backtestLog, opts = {}) {
  const lookbackDays  = opts.lookbackDays  ?? 30;
  const minNPerBucket = opts.minNPerBucket ?? 10;
  const fallbackFn    = opts.fallbackFn    ?? _defaultIsoFallback;
  const candidates    = opts.bucketSizes   ?? ADAPTIVE_BUCKET_SIZES;
  const defaultBucket = opts.bucketSize    ?? 15;

  // Gather the resolved rows (score + outcome) within the lookback window.
  const rows = [];
  if (backtestLog && typeof backtestLog === 'object' && backtestLog.records && typeof backtestLog.records === 'object') {
    const cutoff = _dateMinus(lookbackDays);
    const dates = Array.isArray(backtestLog.dates) ? backtestLog.dates : Object.keys(backtestLog.records);
    for (const d of dates) {
      if (d < cutoff) continue;
      const day = backtestLog.records[d];
      if (!Array.isArray(day)) continue;
      for (const r of day) {
        const score = typeof r.score === 'number' ? r.score : null;
        if (score === null || score < 0 || score > 100) continue;
        if (r.homered !== true && r.homered !== false) continue;
        rows.push({ score, homered: r.homered === true });
      }
    }
  }

  // Thin log → behave exactly like the old hardcoded path.
  if (rows.length < ADAPTIVE_MIN_ROWS) {
    const res = fitIsotonicFromBacktest(backtestLog, { lookbackDays, minNPerBucket, bucketSize: defaultBucket });
    return { ...res, bucketSize: defaultBucket, cv: null, adaptive: false };
  }

  // CV every candidate grid; keep the finite ones, coarse → fine.
  const cv = candidates
    .slice()
    .sort((a, b) => b - a)
    .map((bs) => ({ bucketSize: bs, brier: _isoCvBrier(rows, bs, fallbackFn) }))
    .filter((c) => Number.isFinite(c.brier));

  // Pick the coarsest as incumbent, then walk finer; adopt a finer grid only
  // when it beats the incumbent by more than EPS (conservative — finer must
  // clearly win, not edge ahead on noise).
  let chosen = cv[0] || { bucketSize: defaultBucket, brier: null };
  for (let i = 1; i < cv.length; i++) {
    if (chosen.brier == null || cv[i].brier < chosen.brier - ADAPTIVE_BRIER_EPS) chosen = cv[i];
  }

  const res = fitIsotonicFromBacktest(backtestLog, { lookbackDays, minNPerBucket, bucketSize: chosen.bucketSize });
  return { ...res, bucketSize: chosen.bucketSize, cv, adaptive: true };
}

// ---------------------------------------------------------------------------
// lookupProb
// ---------------------------------------------------------------------------

/**
 * Look up the calibrated HR probability for a given score using a fitted table.
 *
 * Uses linear interpolation between bucket midpoints for smooth transitions.
 * When no table is provided, or the score is out of range, falls back to
 * fallbackFn(score) if supplied, otherwise uses the rough linear approximation.
 *
 * @param {number} score          - Batter score [0, 100]
 * @param {Array}  table          - Fitted lookup table from fitIsotonicFromBacktest()
 * @param {Function|null} [fallbackFn] - Optional fallback: (score) => probability
 * @returns {number} Calibrated probability
 */
export function lookupProb(score, table, fallbackFn = null) {
  const fallback = (s) =>
    typeof fallbackFn === 'function' ? fallbackFn(s) : _linearFallback(s);

  if (!Array.isArray(table) || table.length === 0) return fallback(score);
  if (typeof score !== 'number' || !isFinite(score)) return fallback(score);

  const s = Math.max(0, Math.min(100, score));

  // Build midpoints for interpolation.
  const midpoints = table.map((b) => (b.scoreLo + b.scoreHi) / 2);
  const probs     = table.map((b) => b.observedProb);

  // Below the first midpoint: use the first bucket's probability.
  if (s <= midpoints[0]) return probs[0];

  // Above the last midpoint: use the last bucket's probability.
  if (s >= midpoints[midpoints.length - 1]) return probs[probs.length - 1];

  // Find the two surrounding midpoints and linearly interpolate.
  for (let i = 0; i < midpoints.length - 1; i++) {
    if (s >= midpoints[i] && s <= midpoints[i + 1]) {
      const t = (s - midpoints[i]) / (midpoints[i + 1] - midpoints[i]);
      return probs[i] + t * (probs[i + 1] - probs[i]);
    }
  }

  return fallback(score);
}

// ---------------------------------------------------------------------------
// serializeTable / deserializeTable
// ---------------------------------------------------------------------------

/**
 * Serialize a lookup table to a JSON string for snapshot payloads.
 *
 * @param {Array} table - Lookup table from fitIsotonicFromBacktest()
 * @returns {string} JSON string
 */
export function serializeTable(table) {
  if (!Array.isArray(table)) return JSON.stringify([]);
  return JSON.stringify(table);
}

/**
 * Deserialize a lookup table from a JSON string (e.g. from a snapshot payload).
 * Returns DEFAULT_LOOKUP_TABLE on parse failure so the client always has a
 * usable table.
 *
 * @param {string} json - JSON string produced by serializeTable()
 * @returns {Array} Lookup table
 */
export function deserializeTable(json) {
  if (typeof json !== 'string' || !json) return DEFAULT_LOOKUP_TABLE;
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    return DEFAULT_LOOKUP_TABLE;
  } catch {
    return DEFAULT_LOOKUP_TABLE;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Linear approximation: 0.025 + score * 0.0015. Used as the last-resort
 * fallback when no fitted table is available.
 * @param {number} score
 * @returns {number}
 */
function _linearFallback(score) {
  return LINEAR_BASE + Math.max(0, Math.min(100, score)) * LINEAR_SLOPE;
}

/**
 * Return the ISO date string for `daysAgo` days before today (Chicago time).
 * @param {number} daysAgo
 * @returns {string} 'YYYY-MM-DD'
 */
function _dateMinus(daysAgo) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return fmt.format(d);
}

/**
 * Build the fallback result shape using DEFAULT_LOOKUP_TABLE.
 * @returns {{ table: Array, totalN: number, fittedAt: string }}
 */
function _fallbackResult() {
  return {
    table:    DEFAULT_LOOKUP_TABLE,
    totalN:   0,
    fittedAt: new Date().toISOString(),
  };
}

