/**
 * barrelScore.mjs — ADVISORY ceiling + form metrics for HR props.
 *
 * These quantify a batter's raw-power CEILING (how much damage when squared up)
 * and current FORM (recent contact quality), modeled on how sharps read HR
 * props. They are DISPLAY/SHORTLIST signals only — they NEVER feed scoreBatter,
 * the HR probability, the grade, or any prediction. They exist to be logged and
 * forward-validated (see model-lab/validate-ceil.mjs); nothing ships to the
 * board off them until the reconciled shortlist hit-rate earns it.
 *
 * Design: fixed MLB reference anchors (not pool z-scores) so a single batter's
 * score is stable run-to-run and interpretable (~50 = league avg, 70+ = strong,
 * 85+ = elite). Each sub-score is a clamped linear map; the composite averages
 * over the inputs that are PRESENT so a missing Savant field degrades gracefully
 * instead of zeroing the score. Returns null when too little is known.
 */

// Linear map x∈[lo,hi] → [0,1], clamped. lo≈below-avg floor, hi≈elite.
const unit = (x, lo, hi) => {
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
};

// ── CEILING (barrelScore) ────────────────────────────────────────────────────
// Top-end power: what happens when this batter connects. maxEV + HR distance are
// the purest ceiling stats (top-end outcomes, not averages), which is exactly the
// axis the median-based HR score under-weights. Barrel% / sweet-spot% capture how
// OFTEN he gets to that ceiling; xISO / hardHit / blast round out impact.
// Anchors centered so the LEAGUE-AVERAGE value maps to ~0.5 (lo/hi straddle the
// MLB mean), elite tops out near 1.0, below-replacement floors near 0 → the
// composite reads ~50 avg / ~95 elite / ~10 weak.
const CEIL_TERMS = [
  { key: 'maxEV',        w: 1.4, lo: 103,   hi: 115,   get: b => b?.maxEV },              // mph (avg ~109)
  { key: 'barrelPctBBE', w: 1.3, lo: 3,     hi: 13,    get: b => b?.barrelPctBBE },       // %   (avg ~8)
  { key: 'xISO',         w: 1.1, lo: 0.080, hi: 0.240, get: b => b?.xStats?.xISO },       // pts (avg ~.160)
  { key: 'hrDistance',   w: 1.0, lo: 385,   hi: 415,   get: b => b?.hrDistance },         // ft  (avg ~400)
  { key: 'blastPct',     w: 0.9, lo: 6,     hi: 20,    get: b => b?.batTracking?.blastPct }, // % (avg ~13)
  { key: 'sweetSpotPct', w: 0.8, lo: 27,    hi: 39,    get: b => b?.sweetSpotPct },       // %   (avg ~33)
  { key: 'hardHitPct',   w: 0.7, lo: 30,    hi: 50,    get: b => b?.hardHitPct },         // %   (avg ~40)
];

/**
 * Ceiling score 0-100 (~50 avg, 75+ strong, 85+ elite). Null if <3 inputs known.
 * @returns {number|null}
 */
export function barrelScore(b) {
  let sw = 0, acc = 0, n = 0;
  for (const t of CEIL_TERMS) {
    const u = unit(t.get(b), t.lo, t.hi);
    if (u == null) continue;
    acc += u * t.w; sw += t.w; n++;
  }
  if (n < 3 || sw === 0) return null;            // too little signal to trust
  return Math.round((acc / sw) * 100);
}

// ── FORM (formScore) ─────────────────────────────────────────────────────────
// Recent power/contact quality (last ~2 weeks), Bayesian-shrunk toward the
// batter's season barrel so a 2-BBE fluke can't read elite. This is the
// MAGNITUDE of current form — deliberately NOT a directional up/down claim,
// because reconciled data shows the DIRECTION of a hot/cold swing carries no
// forward HR signal (heating and cooling bats homer alike); only the recent
// power LEVEL does.
const FORM_SHRINK_BBE = 10;   // full weight on the recent window by ~10 BBE

/**
 * Form score 0-100 from the recent power level. Null when no recent window.
 * @returns {number|null}
 */
export function formScore(b) {
  const rb = b?.recentBarrel;
  const recentBrl = rb?.recentBarrelPct;         // last ~14d barrel% (per BBE)
  const recentBBE = rb?.recentBBE;
  const seasonBrl = b?.barrelPctBBE;             // stable prior
  if (!Number.isFinite(recentBrl) && !Number.isFinite(b?.batTracking?.recentBlastPct)) return null;

  let level = recentBrl;
  if (Number.isFinite(recentBrl) && Number.isFinite(seasonBrl) && Number.isFinite(recentBBE)) {
    // shrink recent toward season by sample size
    level = (recentBrl * recentBBE + seasonBrl * FORM_SHRINK_BBE) / (recentBBE + FORM_SHRINK_BBE);
  } else if (!Number.isFinite(recentBrl)) {
    level = seasonBrl;                            // no recent barrel — fall back to season
  }

  const brlUnit  = unit(level, 3, 13);                                   // recent barrel level (avg ~8)
  const evUnit   = unit(rb?.recentEV, 86, 92);                           // recent avg EV (avg ~89)
  const blastUnit = unit(b?.batTracking?.recentBlastPct, 6, 20);         // recent bat-tracking blast (avg ~13)

  const parts = [[brlUnit, 1.3], [blastUnit, 0.9], [evUnit, 0.6]].filter(([u]) => u != null);
  if (!parts.length) return null;
  const sw = parts.reduce((s, [, w]) => s + w, 0);
  const acc = parts.reduce((s, [u, w]) => s + u * w, 0);
  return Math.round((acc / sw) * 100);
}

/**
 * Advisory bundle for a row: { ceil, form }. Both null-safe. Attach to the row
 * so it's logged; render nothing off it until validate-ceil earns the hit-rate.
 */
export function advisoryBarrel(b) {
  return { ceil: barrelScore(b), form: formScore(b) };
}
