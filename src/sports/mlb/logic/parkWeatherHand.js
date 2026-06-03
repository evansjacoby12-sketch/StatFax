/**
 * parkWeatherHand — true 3-way park × weather × handedness interaction factor.
 *
 * MOTIVATION
 * ----------
 * Prior to this module the scoring pipeline multiplied three independent signals:
 *   park factor  ×  wind carry multiplier  ×  handedness park split
 *
 * Independence is wrong. A short porch amplifies wind help only when the wind
 * is blowing TOWARD that porch AND the batter pulls in that direction. Coors
 * Field is already a hitter's paradise at any wind; a modest tailwind barely
 * moves the needle. Fenway's Green Monster suppresses LHB HRs in ways a flat
 * park-factor number doesn't capture.
 *
 * This module replaces those three separate calls with ONE 3-way interaction
 * multiplier, keyed on:
 *   1. Park identity     (stadiumId — matched by name since stadiums.json has no venueId)
 *   2. Wind direction    (relative to the park's home-plate bearing)
 *   3. Batter side       ('L' | 'R')
 *
 * INTEGRATION NOTE
 * ----------------
 * When calling parkWeatherHandFactor(), **do not** also apply the separate
 * park × wind × hand multipliers — this value replaces all three. Double-
 * counting will over-amplify. The caller should do:
 *
 *   const env = parkWeatherHandFactor(stadiumId, windDirDeg, windSpeedMph, batSide);
 *   // replaces: parkFactor * windMultiplier * handSplit
 *
 * OUTPUT RANGE
 * ------------
 * Multiplier is bounded ~0.85–1.18. Callers do not need to clamp further.
 * Returns exactly 1.0 on any missing input or wind speed < 4 mph.
 *
 * EMPIRICAL BASIS
 * ---------------
 * Values are hand-tuned starting points informed by:
 *   - Statcast park factors (Baseball Savant park factor leaderboards, 2021-2024)
 *   - Baseball Reference park factors (BR park-adjusted HR rates)
 *   - Left/right split park factor data (fangraphs.com/guts)
 *   - Qualitative ballpark geometry (short porches, prevailing wind corridors)
 *
 * Published 3-way interaction values are sparse — these are calibrated
 * approximations that respect known directional asymmetries per venue.
 */

// ---------------------------------------------------------------------------
// PARK INTERACTION TABLE
// ---------------------------------------------------------------------------

/**
 * Hand-tuned 3-way interaction table for the ~15 parks where wind × side
 * matters most. Each entry provides per-batter-side HR multipliers for each
 * of six "wind blowing OUT toward" sectors, plus an inFactor for wind coming
 * IN from the outfield, plus an indoor flag.
 *
 * Sector keys (wind blowing OUT toward):
 *   LF   = toward left field (pull direction for RHB)
 *   LCF  = toward left-center
 *   CF   = straight out to center
 *   RCF  = toward right-center
 *   RF   = toward right field (pull direction for LHB)
 *   in*  = wind blowing IN from that sector — returns inFactor instead
 *
 * Batter sides:
 *   L    = left-handed batter (pulls to RF; benefits most from RF/RCF tailwinds)
 *   R    = right-handed batter (pulls to LF; benefits most from LF/LCF tailwinds)
 *
 * @type {Object.<string, {
 *   name: string,
 *   L: {LF:number, LCF:number, CF:number, RCF:number, RF:number},
 *   R: {LF:number, LCF:number, CF:number, RCF:number, RF:number},
 *   inFactor: number,
 *   indoor: boolean
 * }>}
 */
export const PARK_INTERACTION_TABLE = {
  // -------------------------------------------------------------------------
  // Yankee Stadium — short RF porch (314 ft) is the most famous park-wind
  // interaction in baseball. LHBs pulling RF get an enormous benefit when
  // wind pushes right; RHBs pulling LF also benefit but less dramatically
  // (LF is 318 ft, deeper gap). Statcast park factor ~1.11 HR overall.
  // -------------------------------------------------------------------------
  'Yankee Stadium': {
    name: 'Yankee Stadium',
    L: { LF: 1.04, LCF: 1.06, CF: 1.05, RCF: 1.14, RF: 1.18 },
    R: { LF: 1.12, LCF: 1.07, CF: 1.05, RCF: 1.04, RF: 1.02 },
    inFactor: 0.88,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Fenway Park — Green Monster (37-ft wall in LF, 310 ft) suppresses LHB
  // HRs to LF (high wall = fly outs that would be HRs elsewhere). RHBs
  // pulling toward RF Pesky Pole (302 ft) benefit from a right-to-left wind.
  // When wind pushes OUT to LF, LHBs lose because the wall still catches
  // them; RHBs are the primary beneficiary.
  // Statcast park factor ~0.85 HR (the Monster converts many HR to doubles).
  // -------------------------------------------------------------------------
  'Fenway Park': {
    name: 'Fenway Park',
    L: { LF: 0.91, LCF: 0.94, CF: 1.00, RCF: 1.08, RF: 1.12 },
    R: { LF: 1.10, LCF: 1.06, CF: 1.02, RCF: 0.98, RF: 0.96 },
    inFactor: 0.91,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Coors Field — thin air (5280 ft elevation) already makes this the most
  // HR-friendly park in baseball. Wind adds marginal benefit on top; the
  // interaction is nearly symmetric since the ball travels so far in any
  // direction. inFactor is less suppressive because even headwinds can't
  // fully overcome the altitude carry.
  // Statcast park factor ~1.12 HR.
  // -------------------------------------------------------------------------
  'Coors Field': {
    name: 'Coors Field',
    L: { LF: 1.01, LCF: 1.03, CF: 1.04, RCF: 1.05, RF: 1.06 },
    R: { LF: 1.06, LCF: 1.05, CF: 1.04, RCF: 1.03, RF: 1.01 },
    inFactor: 0.93,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Great American Ball Park (Cincinnati) — small dimensions, CF 404 ft but
  // short gaps. Wind blowing OUT toward the gaps (LCF/RCF) amplifies a
  // park already favorable. Both sides benefit; RHBs pulling LF slightly
  // more since LF power alley is shorter.
  // Statcast park factor ~1.33 HR.
  // -------------------------------------------------------------------------
  'Great American Ball Park': {
    name: 'Great American Ball Park',
    L: { LF: 1.03, LCF: 1.05, CF: 1.06, RCF: 1.10, RF: 1.12 },
    R: { LF: 1.12, LCF: 1.10, CF: 1.06, RCF: 1.04, RF: 1.02 },
    inFactor: 0.90,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Camden Yards (Baltimore) — above-average park factor (1.17). Shallow RF
  // stands and a slight left-to-right prevailing breeze make LHB pull
  // tailwinds particularly potent.
  // -------------------------------------------------------------------------
  'Camden Yards': {
    name: 'Camden Yards',
    L: { LF: 1.03, LCF: 1.04, CF: 1.05, RCF: 1.08, RF: 1.10 },
    R: { LF: 1.10, LCF: 1.08, CF: 1.05, RCF: 1.03, RF: 1.01 },
    inFactor: 0.89,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Globe Life Field (Texas Rangers) — retractable; roof is usually open in
  // cool weather, closed in summer heat. When open, mild effect since park
  // is symmetrical and moderately sized. Slight RHB advantage from park
  // geometry (LF 332 ft, RF 326 ft).
  // -------------------------------------------------------------------------
  'Globe Life Field': {
    name: 'Globe Life Field',
    L: { LF: 1.02, LCF: 1.04, CF: 1.05, RCF: 1.07, RF: 1.08 },
    R: { LF: 1.08, LCF: 1.06, CF: 1.05, RCF: 1.03, RF: 1.02 },
    inFactor: 0.91,
    indoor: false, // retractable; treat as open when roof is open (default)
  },

  // -------------------------------------------------------------------------
  // Citizens Bank Park (Philadelphia) — one of the highest HR park factors
  // in baseball (~1.25 HR). Cozy dimensions + prevailing SW breeze (toward
  // RF side for LHBs). LHBs especially benefit from wind pushing toward the
  // short RF (330 ft).
  // -------------------------------------------------------------------------
  'Citizens Bank Park': {
    name: 'Citizens Bank Park',
    L: { LF: 1.04, LCF: 1.06, CF: 1.07, RCF: 1.12, RF: 1.14 },
    R: { LF: 1.13, LCF: 1.10, CF: 1.07, RCF: 1.04, RF: 1.03 },
    inFactor: 0.88,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Wrigley Field (Chicago Cubs) — famous for capricious wind off Lake
  // Michigan. When the wind blows OUT it's among the best HR parks in
  // baseball; when it blows IN it suppresses HRs dramatically. Strong
  // OUT-to-CF interaction is symmetric by side (410 ft CF is the choke
  // point, not the foul lines). Asymmetric inFactor because IN from LF
  // can still carry over RF seats.
  // -------------------------------------------------------------------------
  'Wrigley Field': {
    name: 'Wrigley Field',
    L: { LF: 1.05, LCF: 1.08, CF: 1.10, RCF: 1.12, RF: 1.14 },
    R: { LF: 1.14, LCF: 1.12, CF: 1.10, RCF: 1.08, RF: 1.05 },
    inFactor: 0.86,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Oracle Park (San Francisco) — McCovey Cove in right. Strong marine
  // prevailing wind blows IN from right-center (off the Bay), making RF
  // the hardest direction to hit a HR. LHBs pulling to RF are suppressed.
  // RHBs pulling to LF (327 ft, no prevailing headwind) get a slight boost.
  // Park factor is very low (~0.82 HR) largely because of this geometry.
  // -------------------------------------------------------------------------
  'Oracle Park': {
    name: 'Oracle Park',
    L: { LF: 1.04, LCF: 1.02, CF: 0.97, RCF: 0.93, RF: 0.90 },
    R: { LF: 1.06, LCF: 1.03, CF: 0.97, RCF: 0.94, RF: 0.92 },
    inFactor: 0.87,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // T-Mobile Park (Seattle) — retractable; often closed. When open,
  // prevailing SW breeze tends to blow across (LF-to-RF). Moderate effect,
  // suppressed HR environment overall (park factor ~0.78).
  // -------------------------------------------------------------------------
  'T-Mobile Park': {
    name: 'T-Mobile Park',
    L: { LF: 1.01, LCF: 1.03, CF: 1.04, RCF: 1.06, RF: 1.07 },
    R: { LF: 1.07, LCF: 1.05, CF: 1.04, RCF: 1.02, RF: 1.01 },
    inFactor: 0.92,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Petco Park (San Diego) — marine layer + ocean breeze suppress HRs. Park
  // bearing is nearly due north (358°). Prevailing SW onshore wind blows
  // roughly toward right-center, which for RHBs pulling LF is a headwind.
  // Park factor ~1.00 HR (neutral, but wind has suppressive history).
  // -------------------------------------------------------------------------
  'Petco Park': {
    name: 'Petco Park',
    L: { LF: 1.02, LCF: 1.04, CF: 1.03, RCF: 1.05, RF: 1.06 },
    R: { LF: 1.05, LCF: 1.04, CF: 1.03, RCF: 1.02, RF: 1.01 },
    inFactor: 0.90,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Comerica Park (Detroit) — deep park (CF 420 ft) with LF 345 ft but
  // tall 17-ft wall. Large park suppresses HRs; wind to CF has limited
  // effect due to depth. LF wall catches some would-be HRs. Park factor
  // ~1.06 HR (above average but the geometry makes wind less impactful
  // than smaller parks).
  // -------------------------------------------------------------------------
  'Comerica Park': {
    name: 'Comerica Park',
    L: { LF: 1.02, LCF: 1.04, CF: 1.03, RCF: 1.07, RF: 1.08 },
    R: { LF: 1.06, LCF: 1.05, CF: 1.03, RCF: 1.03, RF: 1.01 },
    inFactor: 0.90,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Tropicana Field (Tampa Bay) — Fixed dome. Wind never factors in.
  // All multipliers 1.0; inFactor 1.0. Park factor ~1.04 HR.
  // -------------------------------------------------------------------------
  'Tropicana Field': {
    name: 'Tropicana Field',
    L: { LF: 1.0, LCF: 1.0, CF: 1.0, RCF: 1.0, RF: 1.0 },
    R: { LF: 1.0, LCF: 1.0, CF: 1.0, RCF: 1.0, RF: 1.0 },
    inFactor: 1.0,
    indoor: true,
  },

  // -------------------------------------------------------------------------
  // American Family Field (Milwaukee) — retractable. Moderate HR park
  // (~1.11 HR). Slight LHB advantage from park geometry; when open and
  // wind blows toward RF, LHBs get a meaningful boost. Typically treated
  // as open for day games.
  // -------------------------------------------------------------------------
  'American Family Field': {
    name: 'American Family Field',
    L: { LF: 1.02, LCF: 1.04, CF: 1.05, RCF: 1.08, RF: 1.10 },
    R: { LF: 1.09, LCF: 1.07, CF: 1.05, RCF: 1.03, RF: 1.01 },
    inFactor: 0.91,
    indoor: false,
  },

  // -------------------------------------------------------------------------
  // Truist Park (Atlanta) — above-average HR park (~0.99 HR recent, but
  // historically 1.03-1.05). Symmetric design; slight RHB advantage.
  // Wind effects are moderate and fairly balanced.
  // -------------------------------------------------------------------------
  'Truist Park': {
    name: 'Truist Park',
    L: { LF: 1.02, LCF: 1.04, CF: 1.05, RCF: 1.07, RF: 1.09 },
    R: { LF: 1.09, LCF: 1.07, CF: 1.05, RCF: 1.03, RF: 1.02 },
    inFactor: 0.91,
    indoor: false,
  },
};

// ---------------------------------------------------------------------------
// parkSilhouette
// ---------------------------------------------------------------------------

/**
 * Returns a brief silhouette record for a park, keyed by name.
 * Used by both WindCompass and parkWeatherHandFactor internally.
 *
 * Bearings are taken from stadiums.json (server/tools/compute-bearings.mjs
 * derives them from satellite coordinates — see that file for methodology).
 * Direction is FROM home plate TOWARD center field (compass degrees, 0 = north).
 *
 * `indoor` is true only for fixed-dome venues (Tropicana Field). Retractable-
 * roof parks are treated as open because the roof is frequently not closed
 * during MLB games and the caller controls the roof-open override if needed.
 *
 * @param {string|number} stadiumId - park name (string) or numeric venueId (unused/future)
 * @returns {{ name: string, indoor: boolean, bearing: number } | null}
 */
export function parkSilhouette(stadiumId) {
  const entry = _lookupEntry(stadiumId);
  if (!entry) return null;
  return {
    name:    entry.name,
    indoor:  entry.indoor,
    bearing: _PARK_BEARINGS[entry.name] ?? null,
  };
}

// ---------------------------------------------------------------------------
// relativeWindDirection
// ---------------------------------------------------------------------------

/**
 * Convert a meteorological "wind FROM" compass direction and a park's
 * home-plate-to-CF bearing into a wind direction relative to home plate,
 * expressed as the direction the wind is blowing OUT toward:
 *
 *   0°   = blowing straight OUT to CF
 *   90°  = blowing toward RF side (outfield right)
 *   180° = blowing IN from CF (toward home plate)
 *   270° = blowing toward LF side (outfield left)
 *
 * Note: The convention "0° = straight out to CF" means the function returns
 * the "wind blowing TO" angle in field-frame coordinates, not the "FROM" angle.
 * This matches the `relativeToCf` value in windInterpreter.js.
 *
 * @param {number} windDirDeg  - meteorological "wind FROM" direction (0–360, compass)
 * @param {number} parkBearing - park's home-plate → CF bearing (0–360, compass)
 * @returns {number} relative direction in degrees (0–360), 0 = blowing to CF
 */
export function relativeWindDirection(windDirDeg, parkBearing) {
  // FROM → TO: add 180°
  const windToDeg = (windDirDeg + 180) % 360;
  // Subtract park bearing so 0 = aligned with CF (blowing straight out)
  return ((windToDeg - parkBearing) % 360 + 360) % 360;
}

// ---------------------------------------------------------------------------
// sideFromRelativeDeg
// ---------------------------------------------------------------------------

/**
 * Convert a relative wind direction (0 = blowing OUT to CF) to a sector label.
 *
 * OUT sectors (wind helpful — blowing toward outfield):
 *   'CF'   : 337.5° – 22.5°  (straight out)
 *   'RCF'  : 22.5°  – 67.5°  (out toward right-center)
 *   'RF'   : 67.5°  – 112.5° (out toward right field)
 *   'LF'   : 247.5° – 292.5° (out toward left field)
 *   'LCF'  : 292.5° – 337.5° (out toward left-center)
 *
 * IN sectors (wind suppressive — blowing toward home plate):
 *   'inCF'  : 157.5° – 202.5° (straight in from CF)
 *   'inRCF' : 112.5° – 157.5° (in from right-center)
 *   'inRF'  : (folded into inRCF — no distinct bin)
 *   'inLCF' : 202.5° – 247.5° (in from left-center)
 *   'inLF'  : (folded into inLCF — no distinct bin)
 *
 * Uses 45° bands centred on each sector midpoint. The two "RF line" and
 * "LF line" foul-territory bands in windInterpreter are folded into RF/LF
 * here since pull-hit fly balls don't go to the foul line.
 *
 * @param {number} relDeg - relative wind direction (0–360, 0 = blowing to CF)
 * @returns {'LF'|'LCF'|'CF'|'RCF'|'RF'|'inLF'|'inLCF'|'inCF'|'inRCF'|'inRF'}
 */
export function sideFromRelativeDeg(relDeg) {
  const d = ((relDeg % 360) + 360) % 360;

  // OUT quadrant (0 ± 112.5° — blowing toward outfield)
  if (d >= 337.5 || d <  22.5) return 'CF';
  if (d <   67.5)               return 'RCF';
  if (d <  112.5)               return 'RF';

  // IN quadrant (180 ± 67.5° — blowing toward home plate)
  if (d <  157.5)               return 'inRF';
  if (d <  202.5)               return 'inCF';
  if (d <  247.5)               return 'inLF';

  // Out-left quadrant
  if (d <  292.5)               return 'LF';
  return 'LCF';
}

// ---------------------------------------------------------------------------
// parkWeatherHandFactor  (primary export)
// ---------------------------------------------------------------------------

/**
 * Primary export. Returns the 3-way park × weather × handedness HR multiplier.
 *
 * This value REPLACES independent park-factor, wind-carry, and handedness-split
 * multipliers in the scoring pipeline — do not multiply this on top of those.
 *
 * Algorithm:
 *   1. Validate inputs; return 1.0 on any missing/invalid value.
 *   2. Return 1.0 if wind speed < 4 mph (no meaningful wind effect; park-only
 *      factors should be applied by the caller separately).
 *   3. Look up the park in PARK_INTERACTION_TABLE by name (opts.name) or by
 *      stadiumId string. Fall back to 1.0 if not in the table.
 *   4. Return 1.0 for indoor parks (wind irrelevant).
 *   5. Look up the park's bearing via parkSilhouette; return 1.0 if unavailable.
 *   6. Compute relativeWindDirection → sideFromRelativeDeg to get a sector label.
 *   7. For IN sectors, return entry.inFactor.
 *   8. For OUT sectors, return entry[batSide][sector].
 *
 * @param {string|number} stadiumId  - park name string (preferred) or numeric venueId
 * @param {number}        windDirDeg - meteorological "wind FROM" direction (compass degrees)
 * @param {number}        windSpeedMph - wind speed in mph
 * @param {'L'|'R'}       batSide    - batter side ('L' = left, 'R' = right)
 * @param {object}        [opts]     - optional overrides
 * @param {string}        [opts.name]    - explicit park name (skips ID lookup)
 * @param {number}        [opts.bearing] - explicit park bearing (skips silhouette lookup)
 * @returns {number} multiplier in range ~0.85–1.18; 1.0 = neutral
 */
export function parkWeatherHandFactor(stadiumId, windDirDeg, windSpeedMph, batSide, opts) {
  // --- 1. Input validation ---
  if (stadiumId == null && (!opts || !opts.name)) return 1.0;
  if (!Number.isFinite(windDirDeg))               return 1.0;
  if (!Number.isFinite(windSpeedMph))             return 1.0;
  if (batSide !== 'L' && batSide !== 'R')         return 1.0;

  // --- 2. Low-wind short-circuit ---
  if (windSpeedMph < 4) return 1.0;

  // --- 3. Park lookup ---
  const entry = _lookupEntry(opts && opts.name ? opts.name : stadiumId);
  if (!entry) return 1.0;

  // --- 4. Indoor / dome check ---
  if (entry.indoor) return 1.0;

  // --- 5. Bearing ---
  const bearing = (opts && Number.isFinite(opts.bearing))
    ? opts.bearing
    : (_PARK_BEARINGS[entry.name] ?? null);
  if (bearing === null || !Number.isFinite(bearing)) return 1.0;

  // --- 6. Relative wind direction → sector ---
  const relDeg = relativeWindDirection(windDirDeg, bearing);
  const sector = sideFromRelativeDeg(relDeg);

  // --- 7/8. Return factor ---
  if (sector.startsWith('in')) {
    return entry.inFactor;
  }
  const sideFactor = entry[batSide];
  if (!sideFactor) return 1.0;
  return sideFactor[sector] ?? 1.0;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Park bearings mirrored from stadiums.json.
 * Format: { [name]: bearing_degrees }
 * Updated from server/tools/compute-bearings.mjs output 2025-05.
 * Only includes parks present in PARK_INTERACTION_TABLE (others not needed here).
 *
 * @private
 */
const _PARK_BEARINGS = {
  'Yankee Stadium':           75,
  'Fenway Park':              46,
  'Coors Field':               6,
  'Great American Ball Park': 115,
  'Camden Yards':             32,
  'Globe Life Field':         60,
  'Citizens Bank Park':       14,
  'Wrigley Field':            36,
  'Oracle Park':              93,
  'T-Mobile Park':            52,
  'Petco Park':              358,
  'Comerica Park':           150,
  'Tropicana Field':          45,
  'American Family Field':   128,
  'Truist Park':             152,
};

/**
 * Look up a PARK_INTERACTION_TABLE entry by name string (direct key match)
 * or by any alias the caller might pass. Returns null if not found.
 *
 * The table is keyed by the canonical park name as it appears in stadiums.json.
 * Numeric venueIds are not currently mapped; callers should prefer name-based
 * lookup. A future venueId → name mapping can be layered in here without
 * changing the public API.
 *
 * @private
 * @param {string|number} id
 * @returns {object|null}
 */
function _lookupEntry(id) {
  if (id == null) return null;
  const key = String(id);
  if (PARK_INTERACTION_TABLE[key]) return PARK_INTERACTION_TABLE[key];
  // Case-insensitive fallback
  const lower = key.toLowerCase();
  for (const k of Object.keys(PARK_INTERACTION_TABLE)) {
    if (k.toLowerCase() === lower) return PARK_INTERACTION_TABLE[k];
  }
  return null;
}
