/**
 * metrics.mjs — dependency-free evaluation helpers for the offline model lab.
 * Pure functions; rows are {p, y} where p = predicted prob, y = 0|1 outcome.
 */

export const clamp01 = (p, eps = 1e-6) => Math.max(eps, Math.min(1 - eps, p));

export function baseRate(rows) {
  if (!rows.length) return 0;
  return rows.reduce((s, r) => s + (r.y ? 1 : 0), 0) / rows.length;
}

/** Mean squared error of probabilities vs outcomes. Lower = sharper. */
export function brier(rows) {
  if (!rows.length) return NaN;
  return rows.reduce((s, r) => s + (r.p - (r.y ? 1 : 0)) ** 2, 0) / rows.length;
}

/** Cross-entropy. Punishes confident-and-wrong harder than Brier. */
export function logLoss(rows) {
  if (!rows.length) return NaN;
  return -rows.reduce((s, r) => {
    const p = clamp01(r.p), y = r.y ? 1 : 0;
    return s + (y * Math.log(p) + (1 - y) * Math.log(1 - p));
  }, 0) / rows.length;
}

/** Rank-based AUC (Mann–Whitney U), tie-aware. 0.5 = coin flip, 1.0 = perfect. */
export function auc(rows) {
  const nPos = rows.reduce((s, r) => s + (r.y ? 1 : 0), 0);
  const nNeg = rows.length - nPos;
  if (!nPos || !nNeg) return NaN;
  const all = rows.map((r) => ({ p: r.p, y: r.y ? 1 : 0 })).sort((a, b) => a.p - b.p);
  let i = 0, rankSumPos = 0;
  while (i < all.length) {
    let j = i;
    while (j < all.length && all[j].p === all[i].p) j++;
    const avgRank = (i + 1 + j) / 2;            // average rank for the tie group
    for (let k = i; k < j; k++) if (all[k].y === 1) rankSumPos += avgRank;
    i = j;
  }
  return (rankSumPos - nPos * (nPos + 1) / 2) / (nPos * nNeg);
}

/** Reliability buckets: split predicted p into `bins` equal-width buckets. */
export function calibration(rows, bins = 10) {
  const out = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const inB = rows.filter((r) => r.p >= lo && (b === bins - 1 ? r.p <= hi : r.p < hi));
    if (!inB.length) continue;
    out.push({
      lo, hi, n: inB.length,
      pred: inB.reduce((s, r) => s + r.p, 0) / inB.length,
      obs: baseRate(inB),
    });
  }
  return out;
}

/**
 * Pool-Adjacent-Violators isotonic regression. points: [{x, y, n}].
 * Returns monotone non-decreasing blocks [{xMin, xMax, value}].
 */
export function isotonic(points) {
  const pts = [...points].sort((a, b) => a.x - b.x)
    .map((p) => ({ xMin: p.x, xMax: p.x, sum: p.y * p.n, n: p.n }));
  const stack = [];
  for (const p of pts) {
    let cur = { ...p };
    while (stack.length && (stack[stack.length - 1].sum / stack[stack.length - 1].n) >= (cur.sum / cur.n)) {
      const prev = stack.pop();
      cur = { xMin: prev.xMin, xMax: cur.xMax, sum: prev.sum + cur.sum, n: prev.n + cur.n };
    }
    stack.push(cur);
  }
  return stack.map((b) => ({ xMin: b.xMin, xMax: b.xMax, value: b.sum / b.n }));
}

/** Turn isotonic blocks into a lookup x → value (step function). */
export function isotonicLookup(blocks) {
  return (x) => {
    for (const b of blocks) if (x <= b.xMax) return b.value;
    return blocks.length ? blocks[blocks.length - 1].value : 0;
  };
}

/** Fit score→prob from rows {score, y} via 10-pt-score-bin isotonic. Returns p(score). */
export function fitScoreToProb(rows) {
  const bins = new Map();
  for (const r of rows) {
    const k = Math.min(9, Math.floor((r.score || 0) / 10));
    const e = bins.get(k) || { hr: 0, n: 0 };
    e.n++; if (r.y) e.hr++; bins.set(k, e);
  }
  const lookup = isotonicLookup(isotonic([...bins.entries()].map(([k, e]) => ({ x: k * 10 + 5, y: e.hr / e.n, n: e.n }))));
  return (score) => lookup(Math.min(9, Math.floor((score || 0) / 10)) * 10 + 5);
}
