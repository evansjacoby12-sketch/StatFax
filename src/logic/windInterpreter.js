/**
 * windInterpreter — single source of truth for wind direction + verdict.
 *
 * Before this module existed, the same wind interpretation lived in 3+ files
 * with subtle differences:
 *   - WindCompass.js          (today page game card chip)
 *   - StadiumWindOverlay.js   (player modal stadium SVG)
 *   - MobileWeatherStrip      (mobile player modal chip in PlayerDetailModal)
 *   - ProbabilityEngine.calculateBallCarry (scoring physics)
 *
 * Each component implemented its own version of:
 *   - "FROM angle → TO angle" inversion (forecast provider gives FROM, model wants TO)
 *   - Bucketing into OUT / IN / CROSS based on cosine projection onto CF axis
 *   - Arrow rotation degrees
 *   - Side label (LF / CF / RF etc.)
 *
 * Over the past few weeks we had several rounds of "the arrow is flipped",
 * "OUT label disagrees with IN visual", and "Cubs is right but others are
 * wrong" — all stemming from these reimplementations drifting apart. This
 * module collapses them to ONE function so any future change happens in
 * exactly one place and propagates everywhere.
 *
 * The CANONICAL conventions (locked in — see CONVENTIONS.md):
 *
 *   1. weather.windDirDeg is "wind FROM" direction (meteorological standard,
 *      what Open-Meteo returns). We never flip the underlying snapshot data.
 *
 *   2. The interpreter's `toAngle` and `relativeToCf` outputs are in the
 *      "wind blowing TO" direction, relative to compass north (toAngle) or
 *      to the stadium's CF (relativeToCf). These are what arrows + side
 *      labels work in.
 *
 *   3. Verdict (OUT / IN / CROSS) uses the cosine projection of wind speed
 *      onto the home-plate→CF axis:
 *         windOutMph = -mph * cos(relativeFromCf * π/180)
 *      Positive = blowing OUT (helpful), negative = blowing IN (suppressive).
 *      Thresholds: ±2 mph cross/cross, ±6 mph strong/weak split for tint.
 *
 *   4. Arrow rotation = TO direction relative to CF (0 = arrow UP toward CF,
 *      180 = arrow DOWN toward home). This makes the arrow agree with the
 *      label visually: OUT → arrow up; IN → arrow down.
 *
 *   5. Side label ("to CF" / "to LF line" / etc.) describes WHERE the wind
 *      is headed, in field-frame terms (CF at top, home at bottom).
 */

const TWO_PI = Math.PI / 180;

/**
 * Pick the entry from weather.hours[] that's closest to "now" without
 * being in the future. Returns null if hours[] is absent or empty, OR
 * if every entry is in the future (game hasn't started — caller should
 * fall back to the snapshot's first-pitch headline).
 *
 * The hours[] entries have ISO timestamps in venue-local time
 * (no TZ suffix). We compare against the "current local time at the
 * device" rather than building a venue-local Date — close enough since
 * we're picking the nearest hour, not minute-precise.
 */
export function pickCurrentHour(weather) {
  const hours = weather?.hours;
  if (!Array.isArray(hours) || hours.length === 0) return null;
  const nowMs = Date.now();
  let best = null;
  for (const h of hours) {
    if (!h?.tIso) continue;
    // tIso is venue-local but our `now` is device-local. For a same-TZ
    // user this is exact. For a cross-TZ user the rough match (±1 hour
    // off) still produces the right verdict — wind doesn't change
    // drastically between adjacent hours.
    const t = Date.parse(h.tIso);
    if (!Number.isFinite(t)) continue;
    if (t > nowMs) break;
    best = h;
  }
  return best;
}

/**
 * Side label for a wind blowing TO `angle` (degrees relative to CF, clockwise
 * from CF at top). 0=CF (straight away from home), 90=RF, 180=home, 270=LF.
 */
function sideLabelFor(angle) {
  const a = ((angle % 360) + 360) % 360;
  if (a >= 337.5 || a <  22.5) return 'CF';
  if (a <  67.5)              return 'RCF';
  if (a < 112.5)              return 'RF';
  if (a < 157.5)              return 'RF line';
  if (a < 202.5)              return 'home';
  if (a < 247.5)              return 'LF line';
  if (a < 292.5)              return 'LF';
  return 'LCF';
}

/**
 * Map a verdict + magnitude to the visual tint each surface uses. Caller
 * passes in their theme colors so we don't have to import the theme here
 * (lets this module stay pure and JSON-friendly for the scoring engine).
 */
function pickTint({ verdict, magnitude }, colors) {
  if (verdict === 'OUT')   return magnitude === 'strong' ? '#32D74B' : '#64D2FF';
  if (verdict === 'IN')    return magnitude === 'strong' ? '#FF453A' : '#FF9F0A';
  if (verdict === 'CROSS') return colors?.textMuted || '#8E8E93';
  return colors?.textFaint || '#636366';
}

/**
 * Main interpreter. Returns null when there isn't enough data to render
 * anything useful (no weather, dome game, sub-1 mph wind, missing bearing).
 * That null-check is what the UI checks against before mounting any wind
 * widget; it's intentional that ALL components see the same "is there
 * something to show?" signal.
 *
 * @param {object|null} weather  - { windSpeedMph, windDirDeg, tempF, ... }
 * @param {object|null} stadium  - { bearing, ... } (the stadium object from
 *                                  stadiums.json or anything with .bearing)
 * @param {object}      [colors] - theme tokens, used only for picking the
 *                                  CROSS tint (defaults to neutral grays if
 *                                  omitted, so the scoring engine can call
 *                                  this with no UI context).
 * @returns {{
 *   mph: number,
 *   tempF: number|null,
 *   fromAngleCompass: number,      // raw windDirDeg (FROM, compass)
 *   toAngleCompass:   number,      // (FROM + 180) % 360
 *   relativeFromCf:   number,      // FROM angle relative to CF (used by physics)
 *   relativeToCf:     number,      // TO angle relative to CF (used by arrows)
 *   windOutMph:       number,      // projection onto CF axis; +OUT / -IN
 *   verdict:          'OUT'|'IN'|'CROSS',
 *   magnitude:        'strong'|'mild',
 *   tint:             string,      // hex color for label + arrow
 *   arrowRotation:    number,      // degrees CW from UP; matches verdict visually
 *   side:             string,      // 'CF', 'RF line', 'home', etc.
 *   caption:          string,      // 'Wind 11 mph, blowing OUT to CF'
 * } | null}
 */
export function interpretWind(weather, stadium, colors) {
  // Auto-select the hours[] entry closest to (but not after) "now" when
  // the weather object has the hourly progression array. This handles the
  // mid-game freshness issue: at 6pm clock-time during a 1pm game, the
  // wind has often shifted significantly from the first-pitch reading
  // that lives on the headline. Without this, we'd render the +0h wind
  // for the entire game.
  //
  // The headline (weather.windSpeedMph / windDirDeg) remains the
  // first-pitch values — we just prefer a later hour's data when
  // clock-time has advanced. If no hours[] is present (old snapshot
  // shape) or "now" is before first pitch, we fall back to the headline.
  const effective = pickCurrentHour(weather) || weather;

  const mph     = Number(effective?.windSpeedMph);
  const fromDeg = Number(effective?.windDirDeg);
  const bearing = Number(stadium?.bearing);

  if (!Number.isFinite(mph) || mph < 1) return null;
  if (!Number.isFinite(fromDeg))         return null;
  if (!Number.isFinite(bearing))         return null;

  // FROM and TO in compass terms (CW from north).
  const fromAngleCompass = ((fromDeg % 360) + 360) % 360;
  const toAngleCompass   = (fromAngleCompass + 180) % 360;

  // Same angles, but relative to the stadium's CF direction.
  // 0 = aligned with CF; 90 = perpendicular (toward right field area in
  // field frame); 180 = anti-aligned with CF.
  const relativeFromCf = ((fromAngleCompass - bearing) % 360 + 360) % 360;
  const relativeToCf   = (relativeFromCf + 180) % 360;

  // Cosine projection of wind speed onto the home→CF axis.
  // Negative cos(FROM) = wind coming from behind home, blowing OUT → positive
  // windOut. Positive cos(FROM) = wind coming from outfield, blowing IN.
  const windOutMph = -mph * Math.cos(relativeFromCf * TWO_PI);

  let verdict, magnitude;
  if      (windOutMph >=  6) { verdict = 'OUT';   magnitude = 'strong'; }
  else if (windOutMph >=  2) { verdict = 'OUT';   magnitude = 'mild';   }
  else if (windOutMph <= -6) { verdict = 'IN';    magnitude = 'strong'; }
  else if (windOutMph <= -2) { verdict = 'IN';    magnitude = 'mild';   }
  else                       { verdict = 'CROSS'; magnitude = 'mild';   }

  const tint     = pickTint({ verdict, magnitude }, colors);
  const side     = sideLabelFor(relativeToCf);
  // `fromSide` is the inverse of `side` — describes where the wind is
  // COMING FROM in field-frame terms. Useful for IN winds where the
  // natural English phrasing is "IN from RCF" rather than "IN to LF line"
  // (which is technically the TO direction but reads awkwardly).
  const fromSide = sideLabelFor((relativeToCf + 180) % 360);

  // Arrow rotation:
  //   relativeToCf=0   → arrow stays UP (toward CF, matches OUT cases)
  //   relativeToCf=180 → arrow flips DOWN (toward home, matches IN cases)
  //   relativeToCf=90  → arrow points RIGHT (toward RF, cross-to-RF)
  // The arrow heading agrees with the verdict label visually and matches
  // the wind's actual physical heading. This is the "TO direction"
  // convention from CONVENTIONS.md.
  const arrowRotation = relativeToCf;

  let caption;
  const mphStr = `${Math.round(mph)} mph`;
  if      (verdict === 'OUT')   caption = `Wind ${mphStr}, blowing OUT to ${side}`;
  else if (verdict === 'IN')    caption = `Wind ${mphStr}, blowing IN from ${fromSide}`;
  else                          caption = `Wind ${mphStr}, cross to ${side}`;

  return {
    mph,
    tempF: Number.isFinite(effective?.tempF) ? effective.tempF : null,
    fromAngleCompass,
    toAngleCompass,
    relativeFromCf,
    relativeToCf,
    windOutMph,
    verdict,
    magnitude,
    tint,
    arrowRotation,
    side,
    fromSide,
    caption,
  };
}

/**
 * Short-form interpreter for when you only need the chip-style "OUT 11"
 * label without computing the full caption + side. Lighter weight, same
 * conventions. Returns null on insufficient data, same as interpretWind.
 */
export function interpretWindLabel(weather, stadium) {
  const w = interpretWind(weather, stadium);
  if (!w) return null;
  return {
    text: `${w.verdict} ${Math.round(w.mph)}`,
    tint: w.tint,
    rotation: w.arrowRotation,
    tempF: w.tempF,
  };
}
