/**
 * ProbabilityEngine — HRSauce HR probability scoring
 *
 * Score breakdown:
 *   45% Batter quality  (ISO, HR rate, launch angle, pull rate, hot bat, who's due, Statcast)
 *   30% Matchup         (pitcher HR/9 splits by hand, ERA, K/9, H2H career, pitcher contact quality)
 *   25% Environment     (ball carry = wind direction × stadium bearing + temp + park factor)
 *
 * Grade thresholds:
 *   PRIME  ≥ 72
 *   STRONG ≥ 52
 *   LEAN   ≥ 36
 *   SKIP   < 36
 *
 * "Who's Due" algorithm:
 *   Uses a 30-game window. Computes expected HRs based on season rate × 30-game AB.
 *   Returns a continuous dueScore (0–100) rather than a boolean, proportional to
 *   both the deficit (expected − actual) and the player's overall HR pace.
 *   Minimum pace filter: only meaningful for players projected ≥ 0.5 HR / 30 games.
 */

import stadiumsData from '../data/stadiums.json';
import { applyCalibration, setActiveCalibration } from './calibration';

// Re-export so the bundled server-side build (server/.build/model.mjs) can
// hydrate calibration multipliers from R2 before scoring. The on-device
// path never calls this — its activeCalibration stays at the dormant
// default and applyCalibration() is a no-op when `ready` is false.
export { setActiveCalibration };
import { simulateBatter } from './atBatSim';
import { shrinkSeasonStats, shrinkRecentStats } from './smallSampleShrinkage.js';
import { estimateIPDistribution, expectedHR9ForBatter } from './starterIPDistribution.js';
import { expectedHRMultiplierFromPitchMix } from './batterPitchTypeISO.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Score tier cutoffs. Exported so screens/components can filter without
 * duplicating magic numbers. Internal keys stay PRIME/STRONG/LEAN/SKIP for
 * code stability; display names (ELITE / STRONG / SLEEPER / PASS) live in
 * theme/index.js → GRADE_META.
 */
export const SCORE_TIERS = {
  PRIME:  72,   // 💎 ELITE
  STRONG: 52,   // ⚡ STRONG
  LEAN:   36,   // 👀 SLEEPER
  SKIP:    0,   // — PASS
};

const GRADE_THRESHOLDS = [
  { label: 'PRIME',  min: SCORE_TIERS.PRIME,  color: '#00D4FF' },
  { label: 'STRONG', min: SCORE_TIERS.STRONG, color: '#32D74B' },
  { label: 'LEAN',   min: SCORE_TIERS.LEAN,   color: '#FFD60A' },
  { label: 'SKIP',   min: SCORE_TIERS.SKIP,   color: '#444444' },
];

// MLB 2024/2025 league averages (used to center pitcher matchup scores)
const LEAGUE_AVG_ERA       = 4.10;
const LEAGUE_AVG_HR9       = 1.15;
const LEAGUE_AVG_K9        = 8.5;
const LEAGUE_AVG_HARD_HIT  = 37.5;  // % of batted balls ≥ 95 mph EV
const LEAGUE_AVG_BARREL    = 7.5;   // barrels per PA %
const LEAGUE_AVG_EV        = 88.0;  // mph average exit velocity against
const OPTIMAL_LAUNCH_MIN   = 16;    // degrees — low end of HR-productive launch angle band
const OPTIMAL_LAUNCH_MAX   = 32;    // degrees — high end

// ─── Batter quality helpers ───────────────────────────────────────────────────

function computeISO(s) {
  return Math.max(0, (s?.slg ?? 0) - (s?.avg ?? 0));
}

function computeHRRate(s) {
  return s?.ab ? s.hr / s.ab : 0;
}

/**
 * Look up a stadium by team abbreviation (e.g., "NYY" → Yankee Stadium).
 * Used for park-adjusting a batter's raw season stats against their home park.
 */
export function findStadiumByTeam(teamAbbr) {
  if (!teamAbbr) return null;
  return stadiumsData.stadiums.find(s => s.team === teamAbbr) || null;
}

/**
 * Park-adjust a raw hitter stat against the batter's home park factor.
 *
 * Half a batter's PAs are at his home park; the other half are spread across
 * various road parks that average to ~1.0. So the effective park inflation on
 * his raw stats is (homePF + 1) / 2. We divide by sqrt of that — the sqrt is
 * standard practice since park effects on rate stats compound less than 1:1.
 *
 *   Coors batter (PF 1.38):  effective 1.19, sqrt 1.091 → ISO/HR rate × 0.917
 *   Padres batter (PF 0.87): effective 0.935, sqrt 0.967 → ISO/HR rate × 1.034
 */
function parkAdjustStat(rawStat, homeParkFactor) {
  if (!homeParkFactor || homeParkFactor === 1.0) return rawStat;
  const effectivePF = (homeParkFactor + 1) / 2;
  return rawStat / Math.sqrt(effectivePF);
}

/**
 * Hot Bat score (0–15): continuous scale of how hot the bat is, based on
 * recent ISO vs season ISO.
 *   gap 0.020  → ~4 pts
 *   gap 0.040  → ~8 pts
 *   gap 0.060  → ~12 pts
 *   gap 0.075+ → capped at 15
 * Returns 0 below the 0.020 noise threshold.
 */
function hotBatScore(season, recent) {
  // Aligned with coldBatPenalty's 12-AB gate. Was 8 — meaning a player
  // with 8-11 recent ABs could trip HOT but never COLD. That asymmetry
  // biased the model upward in tiny-sample situations (early season,
  // post-IL, recent call-up). 12 ABs is the noise-immune floor for either.
  if (!season || !recent?.ab || recent.ab < 12) return 0;
  const gap = computeISO(recent) - computeISO(season);
  if (gap < 0.020) return 0;
  // Up-weighted: cap 15→20, slope 200→240. lab:audit shows hot bats beat their
  // own grademates by +17.6 (STRONG) / +16.2 (SKIP) / +8.6 (LEAN) — the single
  // strongest positive signal, previously under-credited. Modest bump, not fit
  // to the sample; confirm the gain with a held-out re-score before shipping.
  return Math.min(20, Math.round(gap * 240));
}

/**
 * Graduated cold bat penalty (0 to 18 points).
 *
 * Uses the sharper window (7-game when available, else 15-game) to catch current
 * slumps quickly. Returns a scaled penalty rather than a binary flag:
 *   mild slump (ISO 40–60% below baseline) → -5 to -10
 *   deep slump (ISO > 60% below baseline)  → -12 to -18
 *
 * Requires BOTH ISO and batting average suppression to avoid penalising batters
 * who are simply seeing tough pitching (which suppresses avg but not always power).
 */
function coldBatPenalty(season, recent15, recent7) {
  const window = (recent7?.ab ?? 0) >= 12 ? recent7 : recent15;
  if (!window?.ab || window.ab < 12) return 0;
  const sISO = computeISO(season);
  if (sISO < 0.100) return 0;  // below-average power hitter — noise dominates
  const rISO = computeISO(window);
  const isoRatio  = rISO / sISO;                    // 1.0 = on pace, 0 = no power at all
  const avgDrop   = (season.avg || 0) - (window.avg || 0);
  // Both must be depressed; avg drop of 0.055+ confirms the contact quality has fallen too
  if (isoRatio >= 0.60 || avgDrop < 0.040) return 0;
  // Scale: deeper hole = larger penalty, capped at 18
  const depth = Math.max(0, 0.60 - isoRatio) / 0.60;  // 0 at boundary, 1 if ISO → 0
  return Math.min(18, Math.round(5 + depth * 13));
}

/**
 * Cold Bat: boolean flag retained for reason-builder / display only.
 * Mirrors the penalty function — true whenever any cold-bat penalty applies.
 */
function isColdBat(season, recent15, recent7) {
  return coldBatPenalty(season, recent15, recent7) > 0;
}

/**
 * Who's Due score (0–100): how much is this batter "owed" HRs based on their
 * expected rate vs what they've actually produced in their last 30 games?
 *
 * Algorithm:
 *   expected30 = (season HR / season AB) × recent30.ab
 *   deficit    = expected30 − recent30.hr
 *   dueScore   = (deficit / expected30) × pace_weight × 100
 *
 *   pace_weight scales by how prolific a HR hitter they are — a player
 *   expected to hit 1.5 HRs in 30 games being 0 is more significant than a
 *   player expected to hit 0.6.
 *
 * Returns { isDue: boolean, dueScore: 0–100, expected30, deficit }.
 * isDue fires when expected30 ≥ 0.7 (meaningful sample) AND deficit ≥ 0.5.
 */
function computeDue(season, recent30) {
  const empty = { isDue: false, dueScore: 0, expected30: 0, deficit: 0 };
  if (!season?.ab || !recent30?.ab || recent30.ab < 18) return empty;

  const seasonRate  = season.hr / season.ab;
  const expected30  = seasonRate * recent30.ab;
  if (expected30 < 0.5) return empty;           // not enough of a HR threat to matter

  const actual      = recent30.hr ?? 0;
  const deficit     = Math.max(0, expected30 - actual);
  if (deficit < 0.4) return empty;              // basically on pace — not "due"

  // How deep in the hole are they?
  const deficitRatio = deficit / expected30;    // 0 = on pace, 1 = zero HRs vs full expectation

  // Pace weight: a 2-HR/30-game player being 0 for 30 is more notable than a 0.7-HR player
  const paceWeight = Math.min(1.5, expected30 / 1.0);

  const dueScore = Math.round(Math.min(100, deficitRatio * paceWeight * 70));
  const isDue    = expected30 >= 0.7 && deficit >= 0.5;

  return { isDue, dueScore, expected30, deficit };
}

/**
 * Launch angle bonus: batters who consistently hit the ball in the 16–32° band
 * (the "home run corridor") have a structural edge. Below 10° = ground ball tendencies,
 * above 35° = too much pop-up fly ball.
 */
function launchAngleBonus(savantStats) {
  const la = savantStats?.launchAngle;
  if (la == null) return 0;
  if (la >= OPTIMAL_LAUNCH_MIN && la <= OPTIMAL_LAUNCH_MAX) {
    // Peak at ~23° (center of HR band), taper toward edges
    const distFromCenter = Math.abs(la - 23);
    return Math.max(0, 8 - distFromCenter * 0.6);   // up to +8 pts
  }
  if (la > OPTIMAL_LAUNCH_MAX) return Math.max(-4, -(la - OPTIMAL_LAUNCH_MAX) * 0.4);
  if (la < 10) return -5;  // ground ball hitter — significant HR suppressor
  return 0;
}

/**
 * Pull rate bonus: pull hitters target the shorter dimensions (typically LF for RHBs).
 * Pull% ≥ 42% is a meaningful power-profile signal.
 * Extreme pull hitters (>52%) face defensive shifts but still generate more HRs.
 */
function pullRateBonus(savantStats) {
  const pull = savantStats?.pullPct;
  if (pull == null) return 0;
  if (pull >= 52) return 6;
  if (pull >= 42) return Math.round((pull - 42) * 0.5);  // 0–5 pts
  return 0;
}

/**
 * Spray × park interaction bonus (-1 to +3).
 *
 * A pull-heavy batter at a hitter-friendly park (for their handedness) gets
 * a real edge that pullRateBonus alone doesn't capture. RHB pulling to LF
 * at Camden Yards (RHB park factor 1.27) is structurally more HR-likely
 * than the same RHB pulling at Petco (RHB park factor 0.93).
 *
 * The interaction is multiplicative: a 38% pull rate doesn't get much
 * help from a 1.10 park factor, but a 52% pull rate at 1.30 absolutely
 * does. We require BOTH pull% above league average AND a park factor
 * that's at least neutral-to-friendly before applying.
 *
 * Penalty side: extreme pull hitters at pitcher-friendly parks (factor
 * <= 0.90) get -1 because they can't reach the deeper fence on their
 * preferred field.
 *
 * @param {object|null} savantStats   { pullPct, ... }
 * @param {number}      parkFactor    handedness-resolved park factor (from
 *                                    resolveParkFactor → carryResult.parkFactor)
 */
function sprayParkBonus(savantStats, parkFactor) {
  const pull = savantStats?.pullPct;
  if (pull == null || !parkFactor) return 0;
  // Below-average pull rate: no spray edge to amplify.
  if (pull < 38) return 0;

  // Pull-friendly park × pull-heavy bat → graduated bonus.
  if (parkFactor >= 1.10) {
    if (pull >= 52) return 3;
    if (pull >= 45) return 2;
    if (pull >= 42) return 1;
  }

  // Pitcher-friendly park × pull-heavy bat → small penalty (can't reach).
  if (parkFactor <= 0.90 && pull >= 45) return -1;

  return 0;
}

/**
 * Spray × FENCE-GEOMETRY fit (−2 to +3).
 *
 * Sharper than sprayParkBonus (pull% × the park's OVERALL hand factor): this
 * uses the actual pull-side POWER-ALLEY distance the batter pulls to — LF gap
 * for a RHB, RF gap for a LHB. Most pulled HRs land in the alley, not down the
 * line, so the gap is the right reference. A pull-heavy bat at a short-alley
 * park (GABP) gets a real edge; a pull hitter at a deep pull alley (Oracle RF,
 * Comerica LC) is dinged — distinctions the symmetric park factor blurs.
 * League-average power alley ≈ 378 ft. Returns 0 when fence data is absent.
 *
 * @param {object|null}  savantStats      { pullPct }
 * @param {object|null}  stadium          { fences: { lfGap, rfGap } }
 * @param {'L'|'R'|null} effectiveBatSide
 */
function sprayFenceFit(savantStats, stadium, effectiveBatSide) {
  const pull   = savantStats?.pullPct;
  const fences = stadium?.fences;
  if (pull == null || !fences || !effectiveBatSide) return 0;
  if (pull < 40) return 0;                                   // only meaningful for pull-heavy bats
  const pullGap = effectiveBatSide === 'L' ? fences.rfGap : fences.lfGap;
  if (!Number.isFinite(pullGap)) return 0;
  const shortness = 378 - pullGap;                           // + = shorter than league avg (HR-friendly)
  const lean      = pull - 40;                               // 0..~15 above the pull-heavy threshold
  const raw       = (shortness / 8) * (1 + lean / 25);       // shortness dominates, pull-lean amplifies
  return Math.max(-2, Math.min(3, Math.round(raw)));
}

/**
 * Spray × wind bonus (0 to +3).
 *
 * The existing wind model factors LAUNCH ANGLE × wind alignment with the
 * stadium axis. It misses CROSSWINDS that help pull hitters specifically:
 * a 12 mph wind blowing from RF toward LF is "neutral" to axial wind math
 * but is a real tailwind for a pull-heavy RHB whose flies go to LF.
 *
 * This helper computes wind's component ALONG the batter's pull-direction
 * line and rewards pull-heavy bats when that component is positive
 * (wind helping the ball reach their preferred fence). Magnitude scales
 * with wind speed and how pull-heavy the batter is.
 *
 * Pull direction approximation: a pulled fly ball lands ~70° off the
 * center-field line. RHB pulls left (bearing − 70°), LHB pulls right
 * (bearing + 70°). Switch hitters use their effective side vs the
 * pitcher (resolved upstream).
 *
 * @param {object|null} weather          { windSpeedMph, windDirDeg }
 * @param {object|null} stadium          { bearing, type }
 * @param {'L'|'R'|null} effectiveBatSide
 * @param {number|null} pullPct          batter's pull-rate % (Savant)
 * @returns {number} 0 to ~3, capped — added to batter score
 */
function sprayWindAdj(weather, stadium, effectiveBatSide, pullPct) {
  if (!weather || !stadium || !effectiveBatSide || pullPct == null) return 0;
  // Domes: no wind in play. Retractable + Open use the wind input.
  if (stadium.type === 'Fixed Dome') return 0;
  if (pullPct < 42) return 0;  // need pull tendency to get the benefit
  const speed = weather.windSpeedMph || 0;
  if (speed < 6) return 0;     // wind too light to matter

  // Pull-direction angle (TO direction, compass degrees).
  const pullDir = effectiveBatSide === 'L'
    ? (stadium.bearing + 70 + 360) % 360
    : (stadium.bearing - 70 + 360) % 360;

  // windDirDeg is "FROM" direction (meteorological). Flip to "TO".
  const windToDir = (weather.windDirDeg + 180) % 360;

  // Smallest angular distance between wind-TO and pull-direction.
  const rawDiff   = Math.abs(((windToDir - pullDir + 540) % 360) - 180);
  // Cosine of that diff: 1 = perfectly aligned (wind into pull direction),
  // 0 = perpendicular, -1 = opposite (wind toward catcher).
  const alignment = Math.cos((rawDiff * Math.PI) / 180);
  if (alignment <= 0) return 0;  // not a tailwind for this pull direction

  // Pull weight: 0 at 42%, 1 at 52%+. Caps the bonus to truly pull-heavy bats.
  const pullFactor = Math.min(1, (pullPct - 42) / 10);

  // Final bonus: alignment × wind speed × pull weight × small scaler.
  // Worst case (alignment 1, wind 15 mph, pullFactor 1) = 15 × 0.15 = 2.25
  // → rounded to 2. Capped at +3 to avoid this single signal dominating.
  return Math.min(3, Math.round(alignment * speed * pullFactor * 0.15));
}

/**
 * In-zone contact bonus (−2 to +2).
 * High iz-contact means the batter makes solid contact when the pitcher throws strikes.
 * Low iz-contact means he whiffs even on pitches in the zone — fewer HR opportunities.
 * League average iz-contact is ~78%.
 */
function izContactBonus(savantStats) {
  const izc = savantStats?.izContactPct;
  if (izc == null) return 0;
  if (izc >= 84) return 2;
  if (izc >= 80) return 1;
  if (izc <= 68) return -2;
  if (izc <= 72) return -1;
  return 0;
}

/**
 * Batting order PA-opportunity bonus (−3 to +5).
 * Higher-order hitters get more plate appearances per game, directly translating
 * to more HR opportunities. Based on MLB average PA by lineup slot:
 *   #1–2: ~4.35 PA · #3–4: ~4.15 PA · #5: ~4.0 PA · #6: ~3.85 PA · #7–9: ~3.7 PA
 */
function orderBonus(battingOrder) {
  if (!battingOrder) return 0;
  if (battingOrder <= 2) return 5;
  if (battingOrder <= 4) return 4;
  if (battingOrder === 5) return 2;
  if (battingOrder === 6) return -1;
  return -3;
}

/**
 * xSLG adjustment: Statcast's expected slugging strips out BABIP luck and measures
 * true in-zone power. Rewards unlucky batters (xSLG > actualSLG) and penalizes
 * lucky ones (actualSLG >> xSLG) since both gaps tend to correct.
 */
function xSlgBonus(savantStats, season) {
  const xSlg = savantStats?.xSlg;
  if (xSlg == null) return 0;
  const actualSlg = season?.slg ?? 0;
  const gap = xSlg - actualSlg;
  if (gap > 0.060) return 5;    // meaningfully unlucky — positive regression likely
  if (gap > 0.030) return 3;
  if (gap < -0.060) return -4;  // overperforming luck — negative regression likely
  if (gap < -0.030) return -2;
  return 0;
}

/**
 * Platoon advantage bonus (0 to +4).
 * RHB vs LHP and LHB vs RHP both carry a structural OPS edge (~20–30 pts).
 * Switch hitters have no platoon disadvantage by definition.
 */
function platoonBonus(batSide, pitcherHand) {
  if (!batSide || !pitcherHand || batSide === 'S') return 0;
  const hasAdvantage = (batSide === 'R' && pitcherHand === 'L') ||
                       (batSide === 'L' && pitcherHand === 'R');
  return hasAdvantage ? 4 : 0;
}

// ─── Ball Carry (Environment) ────────────────────────────────────────────────

/**
 * Air-density factor for HR ball flight.
 *
 * Real ball-flight physics: a fly ball's distance is roughly inversely
 * proportional to air density. The denser the air, the more drag, the shorter
 * the ball flies. Three big inputs drive air density:
 *
 *   1. TEMPERATURE — Warmer air is less dense (kelvin-linear, ρ ∝ 1/T).
 *                    Already partially captured by tempBoost; we factor the
 *                    physics-correct contribution back into the wind term.
 *   2. ELEVATION   — Pressure drops exponentially with altitude. Coors at
 *                    5200 ft has ~17% lower pressure than sea level → balls
 *                    fly ~5% farther just from density. (The remainder of
 *                    Coors's 1.38 PF comes from dimensions/atmospheric quirks
 *                    already baked into the static parkFactor — we don't
 *                    want to double-count, so this is additive vs neutral
 *                    NOT vs the park's own elevation.)
 *   3. HUMIDITY    — Counterintuitive: humid air is LESS dense than dry,
 *                    because H₂O molecules (18 g/mol) are lighter than the
 *                    N₂/O₂ (avg ~29 g/mol) they displace. Effect is small
 *                    but real (~0.5% per 30% humidity swing).
 *   4. PRESSURE    — Low-pressure systems (storms incoming) thin the air;
 *                    high-pressure systems compress it. ~30 hPa swing
 *                    between weather regimes = ~3% density change.
 *
 * Returns a multiplier where 1.00 = neutral standard atmosphere, >1 = balls
 * carry farther, <1 = shorter. Typical real-world range: 0.96–1.06.
 *
 * Math: We compute relative density vs ICAO standard (15°C, 1013 hPa, dry).
 *   ρ_dry      = P / (R_d × T)  ; R_d = 287.058 J/(kg·K)
 *   With humidity, partial pressures of dry air and water vapor split out;
 *   approximation: ρ ≈ (Pd / R_d + Pv / R_v) / T.  Simplified below.
 */
/**
 * Whether a venue should be scored with OUTDOOR weather (wind + actual
 * temp/humidity) right now. Fixed domes never are; open parks always are;
 * retractables use the live-feed roof state (weather.roofClosed), falling back
 * PRE-GAME (roofClosed == null) to the park's empirical recent open-rate
 * (stadium.roofOpenRate, from server/tools/compute_roof_rates.mjs): majority-
 * open parks (SEA 0.76, ARI 0.67) default outdoor, the rest indoor. This
 * replaces the old blanket "all retractables → indoor" pre-game default, which
 * wrongly suppressed carry for usually-open parks. No weather → indoor (we
 * have no wind/temp to apply anyway).
 */
function treatVenueAsOutdoor(stadium, weather) {
  if (!stadium || !weather) return false;
  const t = stadium.type;
  if (t === 'Fixed Dome') return false;
  if (t !== 'Retractable') return true;            // open-air park
  if (weather.roofClosed === false) return true;   // live feed: confirmed open
  if (weather.roofClosed === true)  return false;  // live feed: confirmed closed
  return Number.isFinite(stadium.roofOpenRate) && stadium.roofOpenRate >= 0.5; // pre-game default
}

function calculateBallCarryMultiplier(weather, stadium) {
  if (!stadium) return 1.0;
  const elevationFt = stadium.elevationFt ?? 0;

  // Standard sea-level conditions (ICAO): 1013.25 hPa, 15°C, 0% RH.
  // Barometric formula for pressure at altitude (isothermal approximation
  // — overshoots slightly at high altitude but is fine for ballpark range):
  //   P(h) ≈ P₀ × exp(-h / 27000)  where h is in feet
  // This gives Coors (~5200 ft) → P ≈ 838 hPa, matching real values.
  const elevationPressureMb = 1013.25 * Math.exp(-elevationFt / 27000);

  // Indoor games — outdoor humidity, pressure, and temp don't apply
  // because the roof is closed and the building runs HVAC-controlled
  // air. Elevation still matters (it sets the static density of the
  // interior). Use standard indoor assumptions: ~72°F, 50% RH,
  // elevation-derived pressure.
  //
  // Roof-state resolution:
  //   Fixed Dome   → always indoor (Tropicana etc., permanently closed)
  //   Retractable  → check weather.roofClosed (populated by the cron's
  //                  MLB live-feed query):
  //                    true   → roof confirmed closed   → indoor
  //                    false  → roof confirmed open     → outdoor weather
  //                    null   → couldn't determine yet  → indoor (safe default)
  //   Open         → always outdoor (Wrigley, Fenway, etc.)
  //
  // Conservative-default rationale: when roofClosed is null (live feed
  // not yet populated — typical for games hours away from first pitch),
  // we err toward indoor. Earlier we were unconditionally applying
  // outdoor weather to retractables, which caused PRIME→STRONG drops on
  // dry-air days like 23% humidity in Arizona — the model thought balls
  // weren't carrying when in reality the roof was closed and indoor
  // conditions made them carry normally.
  //
  // Companion logic exists in calculateGameHREnvBreakdown which already
  // zeros windPct/tempPct/humidityPct for domes — this brings the carry
  // multiplier into agreement so the Park Report breakdown matches the
  // score the engine actually computed.
  // Indoor iff the venue isn't being treated as outdoor — see treatVenueAsOutdoor
  // (dome, confirmed-closed retractable, or a pre-game retractable whose
  // empirical roofOpenRate is < 0.5).
  const isIndoor = !treatVenueAsOutdoor(stadium, weather);
  const pressureMb  = isIndoor ? elevationPressureMb : (weather?.pressureMb ?? elevationPressureMb);
  const tempF       = isIndoor ? 72                  : (weather?.tempF      ?? 72);
  const humidity    = isIndoor ? 50                  : (weather?.humidity   ?? 50);

  const tempC = (tempF - 32) * 5 / 9;
  const tempK = tempC + 273.15;

  // Vapor pressure of water at this temperature (Tetens equation, hPa):
  //   e_s = 6.1078 × 10 ^ (7.5T / (T + 237.3))
  const vaporSat = 6.1078 * Math.pow(10, (7.5 * tempC) / (tempC + 237.3));
  const vaporActual = (humidity / 100) * vaporSat;
  const dryPressure = pressureMb - vaporActual;

  // Density in kg/m³.  R_d (dry air) = 2.8705, R_v (water vapor) = 4.6150
  // (in J/(g·K) after unit-juggling — convenient for hPa input).
  const rho = (dryPressure / (2.8705 * tempK)) + (vaporActual / (4.6150 * tempK));
  const RHO_STD = 1.225;  // kg/m³ at ICAO standard

  // Distance multiplier — first-order approximation for HR-range fly balls.
  // Less dense air → less drag → longer flight, roughly linear in (1/ρ).
  let multiplier = RHO_STD / rho;

  // Bound the multiplier so a freak weather reading can't dominate scoring.
  // Real-world MLB range is ~0.96 (cold humid Pittsburgh April) to ~1.07
  // (hot dry Coors August). Clamping to [0.94, 1.08] keeps outliers sane.
  if (!Number.isFinite(multiplier)) multiplier = 1.0;
  return Math.min(1.08, Math.max(0.94, multiplier));
}

/**
 * Resolve the handedness-correct park factor.
 * Switch hitters bat opposite to pitcher, so the effective side is passed in.
 * Falls back to the symmetric parkFactor when handedness-specific data isn't available.
 */
function resolveParkFactor(stadium, effectiveBatSide) {
  if (effectiveBatSide === 'L' && stadium.parkFactorL != null) return stadium.parkFactorL;
  if (effectiveBatSide === 'R' && stadium.parkFactorR != null) return stadium.parkFactorR;
  return stadium.parkFactor ?? 1.0;
}

/**
 * Calculate environment score (0–100) from weather + stadium data.
 *
 * IMPORTANT — wind convention:
 *   WeatherAPI's `wind_degree` is the direction the wind is COMING FROM.
 *   Stadium `bearing` is the direction the outfield faces FROM home plate.
 *   For a HR-helping wind we want it blowing TOWARD the outfield, which means
 *   the wind's "from" direction should be the OPPOSITE of the outfield bearing.
 *   So we negate the cos() result: aligned (windDir === bearing) means wind is
 *   blowing IN (suppressive); opposite means wind is blowing OUT (helpful).
 *
 * temp boost = (temp − 72°F) × 0.15  (ball carries ~1% farther per 10°F above 72)
 *
 * @param {string|null} effectiveBatSide  'L' / 'R' (switch hitters resolved upstream)
 */
export function calculateBallCarry(weather, stadium, effectiveBatSide = null, batterLaunchAngle = null) {
  const parkFactor = resolveParkFactor(stadium, effectiveBatSide);

  // Air-density physics — computed for every stadium regardless of dome
  // status (a dome still has elevation pressure, just no wind). The
  // multiplier is 1.00 at standard atmosphere; >1 means thinner air →
  // longer fly balls. Coors typically lands at ~1.05; April Fenway ~0.97.
  const carryMult  = calculateBallCarryMultiplier(weather, stadium);
  // Convert the density multiplier into a "carry boost" delta around the
  // 1.00 neutral. A typical Coors day might be carryMult=1.05 → carryDelta
  // = 5 → roughly +10 added to the env score baseline of 50.
  const carryDelta = (carryMult - 1.0) * 100;

  if (!treatVenueAsOutdoor(stadium, weather)) {
    // Indoor venues (dome / closed-or-likely-closed retractable) still get
    // elevation/dome-temp effects via density (no wind input), so we surface
    // the carry multiplier even when ignoring wind.
    const score = Math.max(0, Math.min(100, 50 + carryDelta * 2));
    return { score, windComponent: 0, tempBoost: 0, parkFactor, carryMult };
  }

  // ── Wind at altitude (1.3× ground-level) ──────────────────────────────────
  // Weather stations report wind at 10m. Fly balls peak at 80-100ft where
  // boundary-layer friction is gone — wind is roughly 30% stronger up there.
  // Same DIRECTION (no change to angleDiff), just bigger magnitude.
  const WIND_ALT_MULT = 1.3;

  // ── Launch-angle × wind interaction ───────────────────────────────────────
  // The differentiator that almost no consumer model does cleanly. A steep
  // flyball (28°+) spends 5+ seconds in the air and rides the wind hard.
  // A low liner (15-) pierces the air on a straight line — wind barely
  // affects it. This is real physics, not a heuristic.
  let laWindMult = 1.0;
  if (batterLaunchAngle != null) {
    if      (batterLaunchAngle >= 28) laWindMult = 1.40;  // bomb-or-bust profile, wind matters most
    else if (batterLaunchAngle >= 22) laWindMult = 1.15;  // HR-optimal LA band
    else if (batterLaunchAngle >= 17) laWindMult = 1.00;  // line-drive baseline
    else                              laWindMult = 0.80;  // low liners cut through wind
  }

  const angleDiff     = ((weather.windDirDeg - stadium.bearing) % 360 + 360) % 360;
  const angleRad      = (angleDiff * Math.PI) / 180;
  // Negate: wind "from" outfield (cos=+1) blows INWARD = suppressive (negative carry)
  //         wind "from" home plate (cos=-1) blows OUTWARD = helpful (positive carry)
  // Compound the altitude + launch-angle multipliers onto the raw component.
  const windRaw       = -weather.windSpeedMph * Math.cos(angleRad);
  const windComponent = windRaw * WIND_ALT_MULT * laWindMult;
  // Keep the legacy tempBoost so existing UI components can still surface
  // a clean "temperature" line — the physics-based density model implicitly
  // includes temperature, but we don't want to triple-count it. The tempBoost
  // is reduced (was *0.15, now *0.08) since density carries part of the load.
  const tempBoost     = (weather.tempF - 72) * 0.08;
  const total         = windComponent + tempBoost + carryDelta;

  const score = Math.max(0, Math.min(100, 50 + total * 2));
  return { score, windComponent, tempBoost, parkFactor, carryMult };
}

/**
 * Game-level HR-friendliness score (0–100). Independent of any specific batter
 * — combines park factor, wind, and temperature into a single comparable number
 * for sorting games by "best weather for HRs today."
 */
export function calculateGameHREnv(weather, stadium) {
  if (!stadium) return 50;
  const pf = stadium.parkFactor ?? 1.0;
  // Air-density multiplier applies even when wind is irrelevant (domes).
  // Elevation alone is worth ~5% boost at Coors; humidity/pressure swings
  // are smaller but real.
  const carryMult  = calculateBallCarryMultiplier(weather, stadium);
  const carryDelta = (carryMult - 1.0) * 100;

  // Indoor venues ignore wind but still feel park factor + density (elevation,
  // indoor temp). Roof-state aware — see treatVenueAsOutdoor.
  if (!treatVenueAsOutdoor(stadium, weather)) {
    return Math.max(0, Math.min(100, (50 + carryDelta * 2) * pf));
  }

  let envBase = 50;
  if (weather) {
    const angleDiff      = ((weather.windDirDeg - stadium.bearing) % 360 + 360) % 360;
    const angleRad       = (angleDiff * Math.PI) / 180;
    const windOutComponent = -weather.windSpeedMph * Math.cos(angleRad); // out = positive
    const tempBoost      = (weather.tempF - 72) * 0.08;  // dampened — density carries most of the temp signal
    envBase = 50 + (windOutComponent + tempBoost + carryDelta) * 2;
  } else {
    // No weather data but we still know elevation
    envBase = 50 + carryDelta * 2;
  }

  return Math.max(0, Math.min(100, envBase * pf));
}

/**
 * Park Report breakdown — splits HR boost into park, wind, and temperature
 * contributions so users can see WHY a game ranks where it does.
 *
 * Returns percentage contributions (additive estimates, real-world is roughly multiplicative
 * but for small effects additive is close enough and far more readable):
 *   parkPct  — park factor minus 1, as a percentage
 *   windPct  — wind blowing out contribution
 *   tempPct  — temperature contribution
 *   totalPct — sum of the above
 */
export function calculateGameHREnvBreakdown(weather, stadium) {
  if (!stadium) {
    return { parkPct: 0, windPct: 0, tempPct: 0, altPct: 0, humidityPct: 0, totalPct: 0, isOutdoor: false, isDome: false };
  }

  const pf       = stadium.parkFactor ?? 1.0;
  const parkPct  = Math.round((pf - 1.0) * 100);
  const isDome   = stadium.type === 'Fixed Dome';
  const isRetractable = stadium.type === 'Retractable';
  // Roof-state aware: an open (or likely-open) retractable counts as outdoor so
  // the Park Report shows wind/temp contributions matching the scored env.
  const isOutdoor = treatVenueAsOutdoor(stadium, weather);

  // Air-density physics — elevation alone matters even indoors. Surface
  // altitude separately from "weather" because altitude is permanent and
  // doesn't change between games. Humidity ride-along is reported when we
  // have weather data; otherwise the altitude effect stands on its own.
  const elevationFt = stadium.elevationFt ?? 0;
  const altMult     = Math.exp(-elevationFt / 27000);  // pressure ratio vs sea level
  const altPct      = Math.round((1 / altMult - 1) * 100);  // distance bonus from elevation

  // Domes / retractables ignore wind but DO get the elevation bonus
  if (isDome || isRetractable || !weather) {
    return {
      parkPct, windPct: 0, tempPct: 0, altPct, humidityPct: 0,
      totalPct: parkPct + altPct,
      isOutdoor, isDome,
    };
  }

  // Wind: blowing-out mph translates roughly to ~1.5% HR boost per mph of out-component
  const angleDiff = ((weather.windDirDeg - stadium.bearing) % 360 + 360) % 360;
  const angleRad  = (angleDiff * Math.PI) / 180;
  const windOut   = -weather.windSpeedMph * Math.cos(angleRad);
  const windPct   = Math.round(windOut * 1.5);

  // Temp: dampened — physics density also captures part of this.
  const tempPct = Math.round((weather.tempF - 72) * 0.25);

  // Humidity: counterintuitive but real — humid air is LESS dense (water
  // vapor displaces heavier dry air molecules). ~0.05% per % humidity over
  // a 50% baseline, so swing from 30% RH to 80% RH ≈ 2.5% boost.
  const humidityPct = weather.humidity != null
    ? Math.round((weather.humidity - 50) * 0.05)
    : 0;

  return {
    parkPct, windPct, tempPct, altPct, humidityPct,
    totalPct: parkPct + windPct + tempPct + altPct + humidityPct,
    isOutdoor: true,
    isDome:    false,
  };
}

// ─── Pitcher matchup helpers ──────────────────────────────────────────────────

/**
 * Resolve the effective batSide for a switch hitter facing a given pitcher hand.
 * Switch hitters bat opposite to the pitcher's arm.
 */
function resolveEffectiveSide(batSide, pitcherHand) {
  if (batSide !== 'S') return batSide;
  return pitcherHand === 'L' ? 'R' : 'L';
}

/**
 * Blend a split stat with the season stat based on sample size.
 * Splits with low innings are noisy — a pitcher with 4 IP vs LHB and 1 HR allowed
 * shouldn't be treated as HR/9 of ~22. Blending settles the noise.
 *
 *   k = 35 IP gives 100% weight to the split, scales linearly below.
 *   25 IP → ~71% split / 29% season
 *   10 IP → ~29% split / 71% season
 */
function blendStat(splitVal, seasonVal, splitIP, k = 35) {
  if (splitVal == null) return seasonVal;
  if (seasonVal == null) return splitVal;
  const weight = Math.min(1, (splitIP || 0) / k);
  return splitVal * weight + seasonVal * (1 - weight);
}

/**
 * Get the handedness-correct pitcher vulnerability stats.
 * RHB → pitcher's vsR split; LHB → pitcher's vsL split.
 * Split stats are blended with season stats based on innings pitched to dampen
 * small-sample noise (especially relevant in early season).
 */
function getPitcherVulnerability(pitcherSplits, pitcherSeason, batSide, pitcherHand) {
  const effectiveSide = resolveEffectiveSide(batSide, pitcherHand);

  const split    = effectiveSide === 'L' ? pitcherSplits?.vsL : pitcherSplits?.vsR;
  const fallback = pitcherSplits?.vsR || pitcherSplits?.vsL || null;
  const chosen   = split || fallback;

  const splitIP  = chosen?.ip ?? 0;

  return {
    hrPer9:           blendStat(chosen?.hrPer9, pitcherSeason?.hrPer9, splitIP) ?? LEAGUE_AVG_HR9,
    era:              blendStat(chosen?.era,    pitcherSeason?.era,    splitIP) ?? LEAGUE_AVG_ERA,
    splitLabel:       effectiveSide === 'L' ? 'vs LHB' : 'vs RHB',
    hasSpecificSplit: !!split && splitIP >= 8,  // require minimum IP to call it "specific"
    splitIP,
    effectiveSide,
  };
}

/**
 * Pitch-arsenal matchup edge (−4 to +8).
 *
 * Cross-references batter's SLG by pitch category against pitcher's usage %.
 * If the pitcher leans on something the batter crushes, +8 territory. If
 * the pitcher leans on something the batter can't touch, deep negative.
 *
 * Calculation: weighted SLG = (FB% × batterFbSlg) + (Breaking% × batterBkSlg) + (Off% × batterOffSlg)
 *   weightedSlg ≥ .500 → big edge
 *   weightedSlg ≤ .320 → big disadvantage
 *   .400 → neutral
 */
/**
 * Pitch shape physics — "Stuff Edge".
 *
 * The biggest gap between mid-tier and elite paid HR models. Goes beyond
 * "batter's SLG vs pitcher's pitch types" into actual stuff metrics:
 *
 *   • Velocity differential vs MLB average for that pitch type
 *   • Pitcher's per-pitch whiff% vs the MLB baseline for that pitch type
 *   • Batter's per-pitch whiff% — does he handle this kind of pitch?
 *   • Batter's per-pitch SLG — interaction term so a high-SLG hitter isn't
 *     double-penalized by the arsenal edge already paid in upstream.
 *
 * The intuition: a batter who SLG's .470 against fastballs has the WRONG
 * read on a 99 mph high-spin riding fastball thrown by Hunter Brown vs a
 * 91 mph low-spin fastball thrown by a #5 starter. The "fastball" bucket
 * lumps them together. Stuff edge unbumps the difference.
 *
 * Returns ±10 (clamped, rounded to int). Positive = batter has the edge
 * (pitcher's stuff doesn't beat batter's contact). Negative = pitcher's
 * stuff outclasses batter's ability and we shave matchup score.
 *
 * Calibration (May 2026 retune — see commit log for spot-check):
 *   • Elite arm (98 FB, 45% slider whiff)   vs avg batter →  ~−5 to −7
 *   • Average MLB pitcher                    vs avg batter →  ~0
 *   • Below-avg #5 starter (91 FB, 16% whiff) vs avg batter →  ~+3 to +5
 *   • Elite arm vs high-whiff slugger        →  ~−6 to −8
 *   • Average arm vs contact-oriented batter →  small + tilt
 *
 * Effective per-pitch-type signal weights (rough share of |pitchEdge| at
 * the elite tail): pitcher whiff% ~40%, velocity ~35%, batter whiff/SLG
 * interaction ~25% combined. Neutral batter buckets contribute 0 and are
 * skipped in the divisor so they don't dilute the physics signals when
 * the batter is league-average on that pitch type.
 *
 * Inputs:
 *   batterPerf = batter's per-pitch slg/whiff (from getSavantBatterPitchPerf)
 *   pitchMix   = pitcher's pitch usage + shape data (pitchMix.shape)
 */
function computeStuffEdge(batterPerf, pitchMix) {
  if (!batterPerf || !pitchMix?.shape) return 0;

  // MLB baseline velocity per pitch type (rounded 2024 league averages).
  // A 99 mph 4-seamer is +5 vs the 94 avg; a 87 mph slider is +3 vs the 84 avg.
  const VELO_AVG = { ff: 94.0, si: 93.5, fc: 89.5, sl: 84.5, cu: 79.5, kc: 81.5, ch: 84.5, fs: 86.0 };
  // MLB baseline pitcher whiff% per pitch type. Above-avg = nasty pitch.
  const WHIFF_AVG = { ff: 22, si: 17, fc: 25, sl: 35, cu: 31, kc: 33, ch: 30, fs: 33 };

  // Pair each pitch type with the batter's per-pitch metrics for that type
  const PITCH_KEYS = [
    { code: 'ff', slgKey: 'ffSlg', whiffKey: 'ffWhiff' },
    { code: 'si', slgKey: 'siSlg', whiffKey: 'siWhiff' },
    { code: 'fc', slgKey: 'fcSlg', whiffKey: 'fcWhiff' },
    { code: 'sl', slgKey: 'slSlg', whiffKey: 'slWhiff' },
    { code: 'cu', slgKey: 'cuSlg', whiffKey: 'cuWhiff' },
    { code: 'kc', slgKey: 'kcSlg', whiffKey: 'kcWhiff' },
    { code: 'ch', slgKey: 'chSlg', whiffKey: 'chWhiff' },
    { code: 'fs', slgKey: 'fsSlg', whiffKey: 'fsWhiff' },
  ];

  let weightedEdge = 0;
  let totalWeight  = 0;

  for (const { code, slgKey, whiffKey } of PITCH_KEYS) {
    const shape   = pitchMix.shape[code];
    if (!shape || !shape.pct || shape.pct < 5) continue;  // ignore rarely-thrown pitches

    const usageWeight = shape.pct / 100;
    let pitchEdge = 0;
    let signals = 0;

    // ── Velocity edge ──
    // Pitcher above league-avg velocity for this pitch type → harder to
    // square up. Bumped 0.5 → 0.6 per mph and cap from ±3 to +4/−3 so an
    // elite 98 FB (+4 mph over avg) actually swings the matchup.
    if (shape.speed != null && VELO_AVG[code] != null) {
      const veloDelta = shape.speed - VELO_AVG[code];
      const v = veloDelta * 0.6;
      if (Math.abs(v) >= 0.1) {
        pitchEdge -= Math.min(4, Math.max(-3, v));
        signals++;
      }
    }

    // ── Pitcher whiff% edge ──
    // Pitcher generates above-avg whiffs on this pitch type → tough to hit
    // for HRs (you can't homer on a pitch you swing through). Bumped 0.15
    // → 0.20 per pp delta; whiff is the single best stuff signal we have.
    if (shape.whiff != null && WHIFF_AVG[code] != null) {
      const whiffDelta = shape.whiff - WHIFF_AVG[code];
      const w = whiffDelta * 0.20;
      if (Math.abs(w) >= 0.1) {
        pitchEdge -= Math.min(4, Math.max(-3, w));
        signals++;
      }
    }

    // ── Batter whiff% vs this specific pitch ──
    // Batter who whiffs at >32% on this pitch type is highly exposed; a
    // contact-oriented batter (<22%) handles it fine. Neutral bucket
    // contributes 0 AND is skipped from the signal count so physics
    // signals above aren't diluted when the batter is league-average.
    const batterWhiff = batterPerf[whiffKey];
    if (batterWhiff != null) {
      let bw = 0;
      if      (batterWhiff > 35) bw = -2.5;
      else if (batterWhiff > 30) bw = -1.5;
      else if (batterWhiff < 18) bw = +1.5;
      else if (batterWhiff < 22) bw = +0.5;
      if (bw !== 0) { pitchEdge += bw; signals++; }
    }

    // ── Batter SLG vs this specific pitch ──
    // Already weighted in computeArsenalEdge; we add a small interaction
    // term here so a high-SLG batter doesn't get over-penalized for facing
    // nasty stuff. If batter slugs .550 on the pitcher's primary pitch,
    // partial offset to the stuff penalty. Neutral bucket skipped from
    // the signal count for the same reason as the whiff signal above.
    const batterSlg = batterPerf[slgKey];
    if (batterSlg != null) {
      let bs = 0;
      if      (batterSlg > 0.550) bs = +1.5;
      else if (batterSlg > 0.480) bs = +0.5;
      else if (batterSlg < 0.330) bs = -1.0;
      if (bs !== 0) { pitchEdge += bs; signals++; }
    }

    if (signals === 0) continue;
    // Average the signals for this pitch type, then weight by usage.
    weightedEdge += (pitchEdge / signals) * usageWeight;
    totalWeight  += usageWeight;
  }

  if (!totalWeight) return 0;
  // Per-pitch averaged signal is roughly ±3.5 raw at the tails. Multiply
  // by 2.2 so elite vs avg lands around 5-7 points; final clamp keeps
  // the rare blowout matchups at ±10.
  const finalEdge = (weightedEdge / totalWeight) * 2.2;
  return Math.round(Math.min(10, Math.max(-10, finalEdge)));
}

function computeArsenalEdge(batterArsenal, pitchMix) {
  if (!batterArsenal || !pitchMix) return 0;
  const { fastballPct, breakingPct, offspeedPct } = pitchMix;
  const { fastballSlg, breakingSlg, offspeedSlg } = batterArsenal;
  const { fastballRV, breakingRV, offspeedRV }    = batterArsenal;
  const totalPct = (fastballPct || 0) + (breakingPct || 0) + (offspeedPct || 0);
  if (!totalPct) return 0;

  // ── Signal 1: weighted SLG ─────────────────────────────────────────────
  // "What does the batter slug against the pitcher's most-used pitches?"
  const slgParts = [];
  if (fastballSlg != null && fastballPct) slgParts.push({ v: fastballSlg, w: fastballPct / totalPct });
  if (breakingSlg != null && breakingPct) slgParts.push({ v: breakingSlg, w: breakingPct / totalPct });
  if (offspeedSlg != null && offspeedPct) slgParts.push({ v: offspeedSlg, w: offspeedPct / totalPct });

  let slgEdge = 0;
  if (slgParts.length) {
    const tw = slgParts.reduce((s, p) => s + p.w, 0) || 1;
    const weightedSlg = slgParts.reduce((s, p) => s + p.v * p.w, 0) / tw;
    if      (weightedSlg <= 0.300) slgEdge = -4;
    else if (weightedSlg >= 0.520) slgEdge =  8;
    else                            slgEdge = ((weightedSlg - 0.400) / 0.120) * 8;
  }

  // ── Signal 2: weighted run value per 100 (pitch-shape proxy) ───────────
  // RV captures whiffs, takes, and contact quality — not just damage. A
  // batter who slugs .450 against fastballs but has -2.0 RV/100 because he
  // whiffs at 35% is not a good matchup vs a fastball-heavy pitcher even
  // though the SLG looks fine. This is the closest we can get to "pitch
  // shape modeling" without per-pitch velo/spin/movement input — the RV
  // already integrates over those underlying physics signals.
  const rvParts = [];
  if (fastballRV != null && fastballPct) rvParts.push({ v: fastballRV, w: fastballPct / totalPct });
  if (breakingRV != null && breakingPct) rvParts.push({ v: breakingRV, w: breakingPct / totalPct });
  if (offspeedRV != null && offspeedPct) rvParts.push({ v: offspeedRV, w: offspeedPct / totalPct });

  let rvEdge = 0;
  if (rvParts.length) {
    const tw = rvParts.reduce((s, p) => s + p.w, 0) || 1;
    const weightedRV = rvParts.reduce((s, p) => s + p.v * p.w, 0) / tw;
    // Batter RV/100 is typically -3 to +3. Map to ±5.
    rvEdge = Math.min(5, Math.max(-5, weightedRV * 1.7));
  }

  // ── Signal 3: best/worst-pitch interaction ─────────────────────────────
  // If the pitcher's MOST-used pitch family is the batter's BEST pitch
  // (high SLG bucket), apply a +2 bonus. If it's the batter's WORST family,
  // apply a -2 penalty. This compounds correctly with the weighted SLG
  // average — a pitcher who lives on a batter's weak pitch should rate
  // worse than the simple average suggests.
  let interactionEdge = 0;
  const mostUsedFamily = (fastballPct || 0) >= Math.max(breakingPct || 0, offspeedPct || 0) ? 'fastball'
                      : (breakingPct || 0) >= (offspeedPct || 0)                            ? 'breaking'
                      :                                                                       'offspeed';
  const batterFamilySlg = mostUsedFamily === 'fastball' ? fastballSlg
                        : mostUsedFamily === 'breaking' ? breakingSlg
                        :                                 offspeedSlg;
  if (batterFamilySlg != null) {
    if      (batterFamilySlg >= 0.500) interactionEdge =  2;  // pitcher feeding the strength
    else if (batterFamilySlg <= 0.330) interactionEdge = -2;  // pitcher attacking the weakness
  }

  // Sum and clamp. Caps at ±10 so this single component can't dominate.
  const total = slgEdge + rvEdge + interactionEdge;
  return Math.round(Math.min(10, Math.max(-6, total)));
}

/**
 * Recent pitcher form factor (−5 to +7).
 *
 * Compares last 5 starts to season averages. A pitcher with season ERA 3.50
 * but a recent 6.50 ERA is way more vulnerable today than his season line
 * suggests — that gap is real, predictive information.
 *
 *   recent HR/9 > season HR/9 by >0.7 → batter edge
 *   recent ERA  > season ERA  by >1.5 → batter edge
 *   (also reverses for pitcher rounding into form)
 */
function computeRecentFormFactor(recentForm, pitcherSeason) {
  if (!recentForm || !pitcherSeason) return 0;
  if (recentForm.ip < 10) return 0;  // need at least 10 innings of recent work

  const hrGap  = (recentForm.hrPer9 || 0) - (pitcherSeason.hrPer9 || LEAGUE_AVG_HR9);
  const eraGap = (recentForm.era    || 0) - (pitcherSeason.era    || LEAGUE_AVG_ERA);

  // Weighted: HR/9 gap matters more for HR props than ERA gap
  let factor = hrGap * 4 + eraGap * 0.6;

  // Fatigue overlay — pitches thrown across games in the last 3 calendar
  // days. Normal-rest starters (4-day rotation) sit at 0 and this branch
  // no-ops. Short-rest or heavy bullpen usage pushes batter edge up:
  //   - 80-129 pitches → likely a starter on 1-day short rest. Velo
  //     dips ~0.5 mph, fastball spin drops slightly, ball plays "flatter."
  //     Modest +1 to batter edge.
  //   - 130+ pitches → either multiple recent appearances (reliever/opener)
  //     OR very short rest. +2 to batter edge.
  // Conservative thresholds — we don't want a one-day-short-rest starter
  // to look as bad as a true bullpen game.
  const pL3D = recentForm.pitchesL3D || 0;
  if      (pL3D >= 130) factor += 2;
  else if (pL3D >=  80) factor += 1;

  // Clamp to [-5, 7] — recent-form signal shouldn't overwhelm season baseline
  return Math.round(Math.max(-5, Math.min(7, factor)));
}

/**
 * Times-through-order bonus (+1 to +3) added to matchup score.
 *
 * Modern starters average ~5.2 IP. Top-of-order hitters get 2–3 ABs vs the
 * starter and benefit most from the TTO effect (HR rate climbs ~30% on the
 * 2nd PA, ~40% on the 3rd). Bottom-of-order hitters may only see the starter
 * once before the bullpen.
 */
function ttoBonus(battingOrder) {
  if (!battingOrder) return 2;          // unknown order — assume average exposure
  if (battingOrder <= 3) return 3;
  if (battingOrder <= 6) return 2;
  return 1;
}

/**
 * Pitcher contact-quality score from Savant (0–100, 50 = league avg).
 *
 * Combines three contact-outcome signals:
 *   hardHitPctAllowed: % of batted balls at 95+ mph EV  (league avg ~37.5%)
 *   barrelPctAllowed:  barrels per PA                    (league avg ~7.5%)
 *   exitVeloAgainst:   avg exit velocity against         (league avg ~88.0 mph)
 */
function pitcherContactScore(pitcherSavant) {
  if (!pitcherSavant) return 50;

  const hhFactor  = pitcherSavant.hardHitPctAllowed != null
    ? (pitcherSavant.hardHitPctAllowed - LEAGUE_AVG_HARD_HIT) * 1.2
    : 0;
  const brlFactor = pitcherSavant.barrelPctAllowed != null
    ? (pitcherSavant.barrelPctAllowed - LEAGUE_AVG_BARREL) * 3.0
    : 0;
  const evFactor  = pitcherSavant.exitVeloAgainst != null
    ? (pitcherSavant.exitVeloAgainst - LEAGUE_AVG_EV) * 0.8
    : 0;

  return Math.min(100, Math.max(0, 50 + hhFactor + brlFactor + evFactor));
}

/**
 * Zone location factor (−8 to +8).
 *
 * Uses the pitcher's zone% and heart% to detect location tendencies:
 *
 *   heartPct   — % thrown in the "heart" of the plate. League avg ~10%.
 *                Each 1% above avg = more pitches in the HR zone = +1.2 pts.
 *
 *   zonePct    — % in strike zone. League avg ~47%.
 *                Zone% alone is neutral — what matters is whether they're
 *                hitting the heart or the edges. Interacts with heartPct:
 *                high zone + high heart = "groove thrower" = strong HR signal.
 *                high zone + low heart  = living on edges = slight negative.
 *
 *   edgePct    — % on the black. League avg ~14%.
 *                High edge% = elite command = batters can't square it up = negative.
 */
function zoneLocationFactor(pitcherSavant) {
  if (!pitcherSavant) return 0;

  const LEAGUE_HEART_PCT = 10.0;
  const LEAGUE_ZONE_PCT  = 47.0;
  const LEAGUE_EDGE_PCT  = 14.0;

  let factor = 0;

  if (pitcherSavant.heartPct != null) {
    // Heart of plate: each 1% above league avg = +1.2 pts (big HR signal)
    factor += (pitcherSavant.heartPct - LEAGUE_HEART_PCT) * 1.2;
  }

  if (pitcherSavant.zonePct != null && pitcherSavant.heartPct != null) {
    // Groove thrower amplifier: high zone AND high heart = stays in zone AND in the middle
    const zoneAboveAvg  = pitcherSavant.zonePct  - LEAGUE_ZONE_PCT;
    const heartAboveAvg = pitcherSavant.heartPct - LEAGUE_HEART_PCT;
    if (zoneAboveAvg > 3 && heartAboveAvg > 2) factor += 2.5;  // groove thrower bonus
  }

  if (pitcherSavant.edgePct != null) {
    // Elite command on the edges suppresses solid contact
    factor += (LEAGUE_EDGE_PCT - pitcherSavant.edgePct) * 0.4;  // above avg edge = negative
  }

  return Math.min(8, Math.max(-5, factor));
}

/**
 * Pitch mix factor (−5 to +8).
 *
 * Scores the pitcher's arsenal based on two dimensions:
 *
 * 1. Fastball reliance: high FB% (>55%) pitchers face more HR risk because
 *    power hitters feast on velocity. Multiplied by how much the fastball is
 *    getting hit (fastballRunVal > 0 = hitters winning on FBs).
 *
 * 2. Total arsenal run value: weighted sum of all pitch run values.
 *    Positive total = pitcher's entire arsenal is getting exploited.
 *    Negative total = pitcher is winning with his mix = hard to HR off.
 *
 * 3. Breaking ball reliance as a suppressor: high curveball/slider usage
 *    with negative run values = effective mix that limits hard contact.
 */
function pitchMixFactor(pitchMix) {
  if (!pitchMix) return 0;

  let factor = 0;

  // Fastball reliance × fastball damage: the most powerful HR signal.
  // A pitcher throwing 60% FBs who's getting crushed on them is prime HR territory.
  if (pitchMix.fastballPct > 0 && pitchMix.fastballRunVal != null) {
    const fbReliance = Math.max(0, pitchMix.fastballPct - 45) / 10;   // 0 at 45%, 1.5 at 60%
    const fbDamage   = Math.min(3, Math.max(-1, pitchMix.fastballRunVal / 5));
    factor += fbReliance * fbDamage * 2.0;
  }

  // Total arsenal run value: each unit of positive RV = pitcher getting hurt broadly
  if (pitchMix.totalRunVal != null) {
    factor += Math.min(4, Math.max(-4, pitchMix.totalRunVal * 0.5));
  }

  // Breaking ball suppressor: effective breaking balls reduce hard contact
  if (pitchMix.breakingPct > 40 && pitchMix.breakingRunVal != null && pitchMix.breakingRunVal < -1) {
    factor -= 1.5;  // pitcher mixing in effective breaking stuff = harder to HR
  }

  return Math.min(8, Math.max(-5, factor));
}

// ─── Main Scoring ─────────────────────────────────────────────────────────────

/**
 * Score a batter (0–100) for HR probability today.
 *
 * @param {object}      batter         - { id, name, batSide, season, recent }
 * @param {object|null} pitcher        - { id, name }
 * @param {object|null} pitcherSplits  - { vsL, vsR } from getPitcherSplits
 * @param {object|null} pitcherSeason  - { era, hrPer9, kPer9, whip } from getPitcherSeasonStats
 * @param {object}      carryResult    - from calculateBallCarry
 * @param {object|null} savantStats    - batter Statcast: { exitVelo, barrelPct, launchAngle, pullPct, ... }
 * @param {object|null} h2h            - career vs this pitcher: { ab, hr, avg, hrRate }
 * @param {object|null} pitcherSavant  - pitcher Statcast: { hardHitPctAllowed, barrelPctAllowed, zonePct, heartPct, ... }
 * @param {object|null} recent30       - batter's last 30 games stats: { avg, slg, ab, hr, pa }
 * @param {object|null} pitchMix       - pitcher arsenal: { fastballPct, fastballRunVal, totalRunVal, worstPitch, ... }
 * @param {number|null} battingOrder   - 1–9 lineup slot (determines PA opportunities)
 * @param {object|null} recent7        - batter's last 7 games stats (sharper hot-bat window)
 * @param {string|null} pitcherHand    - 'L' or 'R' (needed for switch-hitter split resolution)
 */
export function scoreBatter(
  batter, pitcher,
  pitcherSplits, pitcherSeason,
  carryResult,
  savantStats        = null,
  h2h                = null,
  pitcherSavant      = null,
  recent30           = null,
  pitchMix           = null,
  battingOrder       = null,
  recent7            = null,
  pitcherHand        = null,
  batterHomeParkFactor = 1.0,
  batterArsenal      = null,   // batter's SLG by pitch type (Savant)
  pitcherRecentForm  = null,   // pitcher's last 5 starts aggregated
  dayNightSplits     = null,   // { dayISO, nightISO, dayHRRate, nightHRRate, dayAB, nightAB }
  isDayGame          = false,  // whether today's game starts before ~5pm local time
  homeAwaySplits     = null,   // { homeISO, awayISO, homeAB, awayAB }
  isHomeGame         = false,  // whether this batter is playing at their home park today
  bullpenSplits      = null,   // { spAb, spHr, spHrRate, rpAb, rpHr, rpHrRate, bullpenLegend, bullpenRatio }
  opposingBullpenHR9 = null,   // composite HR/9 for the opposing team's bullpen (relievers only)
  weather            = null,   // raw weather (for spray × wind interaction; carryResult already used it for ENV)
  stadium            = null,   // raw stadium (bearing for pull-direction wind math)
  opposingCatcherFramingRuns = null, // opposing catcher's Statcast framing runs (season total)
  recentBarrel       = null,   // { recentBarrelPct, recentEV, recentBBE } — batter's last ~14d batted-ball quality
  pitcherVeloTrend   = null,   // { recentFastballVelo, seasonFastballVelo, veloDelta } — opposing starter velo trend
) {
  // ── Bayesian shrinkage — collapse small samples toward league prior ────
  //
  // A September call-up with 5 AB and 2 HR has a raw HR rate of 40% — pure
  // noise that would dominate every other signal. shrinkSeasonStats mixes
  // the observed rate with a league prior weighted by sample size: at
  // priorN=100 PA, a batter with 100 actual PA gets a 50/50 blend; below
  // that the prior dominates. recent7 / recent30 use heavier priors (15 /
  // 30) since those windows are intentionally small. Counting stats (ab,
  // hr, h, pa) pass through unchanged; only rate stats are shrunk. ISO is
  // recomputed as (shrunkSLG - shrunkAVG) for internal consistency.
  const season   = batter.season ? shrinkSeasonStats(batter.season) : null;
  const recent15 = batter.recent ? shrinkRecentStats(batter.recent, { window: 30 }) : null;
  // Reassign the param bindings so downstream code reads shrunk versions
  // without renaming references.
  recent7  = recent7  ? shrinkRecentStats(recent7,  { window: 7  }) : null;
  recent30 = recent30 ? shrinkRecentStats(recent30, { window: 30 }) : null;

  // ── Batter quality (50%) ─────────────────────────────────────────────────

  // Raw stats are inflated/deflated by the batter's home park. Adjust so power
  // hitters in Coors aren't overrated and Padres bats aren't underrated.
  //
  // xISO BLEND: Statcast's expected ISO (xSLG - xBA) strips out batted-ball
  // luck — it's what the batter's contact quality should produce. Public
  // research consistently ranks xISO among the most predictive short-window
  // HR features. When available, blend 50/50 with the (shrunk) observed
  // ISO. Falls back to observed alone when Savant data is missing.
  const observedIso = computeISO(season);
  const xIso        = savantStats?.xISO;
  const blendedIso  = Number.isFinite(xIso) ? 0.5 * observedIso + 0.5 * xIso : observedIso;
  const rawHrRate = computeHRRate(season);
  const iso    = parkAdjustStat(blendedIso, batterHomeParkFactor);
  const hrRate = parkAdjustStat(rawHrRate,  batterHomeParkFactor);
  // Hot bat: continuous 0–15 scale. Prefer 7-game window (catches current streaks);
  // fall back to 15-game when 7-game data unavailable.
  const hotScore = hotBatScore(season, recent7 ?? recent15);
  const hot      = hotScore > 0;
  // Cold bat: graduated penalty (0–18 pts) based on severity of the slump
  const coldPenalty = coldBatPenalty(season, recent15, recent7);
  const cold        = coldPenalty > 0;

  // Who's Due: use 30-game window when available, fall back to 15-game
  const dueResult = computeDue(season, recent30 ?? recent15);
  const { isDue: due, dueScore, expected30, deficit } = dueResult;

  // Power fundamentals: normalize to reference ceilings, blend into a 0–58 base.
  // Ceilings are set at strong-but-not-elite levels (ISO 0.260, HR rate 0.050)
  // so truly elite hitters hit ~58 and average hitters land around 25–35.
  // This keeps room for matchup (30%) and environment (25%) to move the needle.
  const isoNorm    = Math.min(1.0, iso    / 0.260);
  const hrRateNorm = Math.min(1.0, hrRate / 0.050);
  const powerBase  = (isoNorm * 0.55 + hrRateNorm * 0.45) * 58;

  // Statcast contact quality
  const exitVeloBonus = savantStats?.exitVelo >= 90
    ? Math.min(7, (savantStats.exitVelo - 88) * 1.2)
    : 0;
  const barrelBonus = savantStats?.barrelPct >= 5
    ? Math.min(9, (savantStats.barrelPct - 3) * 1.3)
    : 0;

  // New: launch angle + pull rate + xSLG luck correction + iz-contact + batting order + platoon
  const launchBonus  = launchAngleBonus(savantStats);
  const pullBonus    = pullRateBonus(savantStats);
  // Spray × park: amplifies pull bonus when the game's park favors this
  // batter's pull direction. carryResult.parkFactor is already
  // handedness-resolved by calculateBallCarry (see resolveParkFactor),
  // so feeding it in here gives us the right L/R-specific lens.
  const sprayParkAdj = sprayParkBonus(savantStats, carryResult?.parkFactor);
  // Spray × wind: separate signal for "wind blowing toward this batter's
  // pull direction" (crosswinds the axial wind math in calculateBallCarry
  // doesn't catch). Optional — defaults to 0 when weather/stadium aren't
  // passed (e.g., on-device fallback before the snapshot is loaded).
  const effectiveBatSideForWind = batter.batSide === 'S'
    ? (pitcherHand === 'L' ? 'R' : 'L')
    : batter.batSide;
  const sprayWindBonus = sprayWindAdj(weather, stadium, effectiveBatSideForWind, savantStats?.pullPct);
  // Spray × fence geometry — pull-side power-alley distance vs the batter's
  // pull tendency (uses the new per-park stadium.fences data; 0 when absent).
  const sprayFenceFitAdj = sprayFenceFit(savantStats, stadium, effectiveBatSideForWind);
  const xSlgAdj      = xSlgBonus(savantStats, season);
  const izBonus      = izContactBonus(savantStats);
  const orderAdj     = orderBonus(battingOrder);
  const platoonAdj   = platoonBonus(batter.batSide, pitcherHand);

  // ── Day / Night edge — REMOVED (was noise) ────────────────────────────────
  // Day/night ISO splits are the noisiest split in baseball: a typical
  // regular sees ~3× more night AB than day AB, so the day-ISO standard error
  // is large enough that the old ±5 thresholds tripped on sampling scatter
  // (NIGHT GUY fired for ~23% of the slate — noise, not skill), reshuffling
  // tier placements on a non-signal. The score contribution AND the
  // dayEdge/nightEdge badges were both dropped. Home/away splits (kept below)
  // are a slightly realer effect — park familiarity + travel. `dayNightSplits`
  // is still threaded onto the row in case we ever want it purely for display.

  // Home/away edge — some hitters are meaningfully better at home (comfortable park,
  // crowd energy, no travel fatigue) or away (road warriors). Only apply with ≥50 AB
  // each split so small samples don't distort. Same thresholds as day/night.
  let homeAwayAdj = 0;
  let homeEdge    = false;
  let awayEdge    = false;
  let homeBad     = false;
  let awayBad     = false;
  if (homeAwaySplits) {
    const { homeISO, awayISO, homeAB = 0, awayAB = 0 } = homeAwaySplits;
    const hasEnoughSample = homeAB >= 50 && awayAB >= 50;
    if (hasEnoughSample && homeISO != null && awayISO != null) {
      const diff = isHomeGame ? (homeISO - awayISO) : (awayISO - homeISO);
      // Up-weighted tiers (5→7, 3→5): lab:audit shows homeEdge bats beat their
      // grademates by +8.4 (PRIME) / +8.0 (STRONG) — consistently under-credited.
      if (diff >= 0.045) {
        homeAwayAdj = 7;
        if (isHomeGame) homeEdge = true; else awayEdge = true;
      } else if (diff >= 0.025) {
        homeAwayAdj = 5;
        if (isHomeGame) homeEdge = true; else awayEdge = true;
      } else if (diff <= -0.025) {
        homeAwayAdj = -2;
        if (isHomeGame) homeBad = true; else awayBad = true;
      }
    }
  }

  // Who's Due — ZERO score contribution (was dueScore*0.12, max +12). The "due"
  // hunch is the gambler's fallacy: an 11-day / 2,646-row audit found due bats
  // homer LESS, not more (univariate lift 0.88×; within PRIME 32.2% vs 46.3%
  // for grademates; L2-logistic weight −0.517). It was promoting cold bats into
  // good tiers. `due`/`dueScore` are still computed for the narrative badge —
  // they just no longer move the score. See README "Capturing inputs".
  const dueBonus = 0;

  // Due + Hot combo removed (was +5): audit showed hot&due ≈ hot alone (25.1% vs
  // 24.3%) — the combo carried no extra information.
  const dueAndHotBonus = 0;

  // Recent batted-ball surge (−4 to +6): barrel% over the last ~14 days vs the
  // batter's season barrel rate. Squaring the ball up RIGHT NOW is a sharper
  // short-term HR signal than season-long contact quality — the single most
  // predictive 7-14 day metric in public research. Needs a real sample (≥8 BBE).
  let recentBarrelAdj = 0;
  if (recentBarrel && Number.isFinite(recentBarrel.recentBarrelPct) && recentBarrel.recentBBE >= 8) {
    const seasonBarrel = Number.isFinite(savantStats?.barrelPctBBE) ? savantStats.barrelPctBBE
                       : Number.isFinite(savantStats?.barrelPct)    ? savantStats.barrelPct
                       : null;
    if (seasonBarrel != null) {
      recentBarrelAdj = Math.max(-4, Math.min(6, Math.round((recentBarrel.recentBarrelPct - seasonBarrel) * 0.5)));
    } else if (recentBarrel.recentBarrelPct >= 12) {
      recentBarrelAdj = 3; // strong absolute recent rate, no season baseline to compare against
    }
  }

  // Cap at 88 instead of 100 so matchup + environment always matter.
  // Even a Judge-level batter (powerBase ~58) + all bonuses maxes around 88,
  // leaving meaningful room for a bad matchup or pitchers-park to pull him down.
  const batterScore = Math.min(88, Math.max(0,
    powerBase
    + hotScore
    - coldPenalty                // graduated: -5 to -18 based on slump depth
    + dueBonus
    + dueAndHotBonus
    + exitVeloBonus
    + barrelBonus
    + launchBonus
    + pullBonus
    + sprayParkAdj
    + sprayWindBonus
    + sprayFenceFitAdj
    + xSlgAdj
    + izBonus
    + orderAdj
    + platoonAdj
    + homeAwayAdj
    + recentBarrelAdj
  ));

  // ── Matchup (30%) ────────────────────────────────────────────────────────

  const vuln        = getPitcherVulnerability(pitcherSplits, pitcherSeason, batter.batSide, pitcherHand);
  const pitcherHRPer9 = vuln.hrPer9;
  const pitcherERA    = vuln.era;

  // ── PA-aware HR9 — blends starter + bullpen by expected exposure ─────
  //
  // The legacy hr9Factor treated `pitcherHRPer9` as the only signal: every
  // batter gets the same starter's HR9 regardless of when they actually
  // bat. In reality, the 1-3 spots see the starter 2-3x while 7-9 spots
  // get more bullpen exposure. estimateIPDistribution returns a probability
  // distribution over how long the starter will pitch (built from recent
  // form and season IP/start). expectedHR9ForBatter walks the batter's 5
  // likely PAs and weights starterHR9 + bullpenHR9 by probability the
  // starter is still in at each PA.
  //
  // Conservative blend: 50% original starter HR9 + 50% weighted version.
  // A pure swap would shift every score; the blend lets calibration adapt
  // gradually. Falls back to starter-only when bullpen data is missing.
  let effectiveHR9 = pitcherHRPer9;
  if (Number.isFinite(pitcherHRPer9) && Number.isFinite(opposingBullpenHR9) && Number.isFinite(battingOrder)) {
    const ipDist = estimateIPDistribution(pitcher);
    const weightedHR9 = expectedHR9ForBatter(battingOrder, null, pitcherHRPer9, opposingBullpenHR9, ipDist);
    if (Number.isFinite(weightedHR9)) {
      effectiveHR9 = 0.5 * pitcherHRPer9 + 0.5 * weightedHR9;
    }
  }

  // Catcher framing — an elite pitch-framer steals strikes, tilting counts to
  // the pitcher's favor → fewer hitter's counts → fewer HRs. A GOOD framer
  // (positive framingRuns) therefore SUPPRESSES HRs, so it LOWERS effectiveHR9
  // (note the minus sign — the original TODO had the direction backwards).
  // 0.5% per run, clamped to ±20 runs (~±10% for an elite/terrible framer).
  // Only applies when the opposing catcher was resolved at the call site.
  if (Number.isFinite(opposingCatcherFramingRuns) && opposingCatcherFramingRuns !== 0) {
    const fr = Math.max(-20, Math.min(20, opposingCatcherFramingRuns));
    effectiveHR9 *= (1 - fr * 0.005);
  }

  // Traditional matchup signals — all clamped so a tiny-sample pitcher
  // (e.g., a September call-up with 1 IP and 1 HR allowed → hrPer9 = 9.0)
  // can't peg matchupScore at 100 and collapse the whole model into a
  // "any pitcher who's given up a HR in <3 IP is the perfect target."
  const hr9Factor = Math.min(25, Math.max(-15, (effectiveHR9 - LEAGUE_AVG_HR9) * 18));
  const eraFactor = Math.min(12, Math.max(-12, (pitcherERA - LEAGUE_AVG_ERA) * 3));
  const kFactor   = pitcherSeason?.kPer9
    ? Math.min(8, Math.max(-8, (LEAGUE_AVG_K9 - pitcherSeason.kPer9) * 1.2))
    : 0;

  // H2H career history (+6 / -4): positive history is more reliable signal than
  // a small sample of failures, so we allow a higher upside than downside.
  // Belt-and-suspenders: require hrRate to be a finite number. Earlier a
  // backend h2h emitter shipped the object without an `hrRate` field, and
  // `(undefined - 0.04) * 100 = NaN` cascaded into matchupScore NaN for
  // every batter with prior history against today's pitcher. The truthy
  // check on `h2h` alone wasn't enough — the field has to actually be
  // there too.
  const h2hFactor = h2h && Number.isFinite(h2h.hrRate)
    ? Math.min(6, Math.max(-4, (h2h.hrRate - 0.04) * 100))
    : 0;

  // Contact quality (Statcast outcomes): how badly batters are squaring this pitcher up
  const contactQScore = pitcherContactScore(pitcherSavant);
  const contactFactor = Math.min(10, Math.max(-10, (contactQScore - 50) * 0.2));

  // Zone location: is this pitcher living in the heart of the plate?
  const zoneFactor = zoneLocationFactor(pitcherSavant);

  // Pitch mix: fastball-heavy pitchers getting hurt on FBs + overall arsenal run value
  const mixFactor = pitchMixFactor(pitchMix);

  // Times-through-order bump — modern starters get exposed late, top of order benefits most
  const ttoAdj = ttoBonus(battingOrder);

  // ── Pitch-arsenal matchup edge (−6 to +10) ────────────────────────────────
  // Cross-references batter's SLG/RV by pitch family vs pitcher's usage.
  const arsenalEdge = computeArsenalEdge(batterArsenal, pitchMix);

  // ── Stuff edge — pitch shape physics (±10) ────────────────────────────────
  // Beyond aggregate SLG/RV by family — compares pitcher's per-pitch velocity,
  // whiff%, and break to MLB averages, weighted by the batter's per-pitch
  // whiff/SLG. Catches matchups the arsenal edge alone misses: a 99mph high-
  // spin fastball is wildly different from a 91mph sinker, even though they
  // both bucket as "fastball."
  const stuffEdge = computeStuffEdge(batterArsenal, pitchMix);

  // ── Recent pitcher form factor (−5 to +7) ─────────────────────────────────
  // If a pitcher's last 5 starts look much worse than his season line, batters
  // get an edge today (he's trending in the wrong direction). Also captures
  // the reverse — a pitcher rounding into form should be tougher than his
  // season ERA suggests.
  const recentFormFactor = computeRecentFormFactor(pitcherRecentForm, pitcherSeason);

  // ── Pitch-type × ISO mismatch (−3 to +4) ──────────────────────────────────
  // Fine-grained complement to arsenalEdge: arsenalEdge buckets pitches into
  // fastball/breaking/offspeed families, losing within-family signal. This
  // multiplier reads SLG vs each individual pitch type (FF, SI, FC, SL, CU,
  // KC, CH, FS) crossed with the pitcher's exact usage distribution. Then
  // converted to ±points scaled to 0.05-multiplier-per-point so the signal
  // is commensurable with the other matchup edges.
  const pitchISOMultiplier = expectedHRMultiplierFromPitchMix(batterArsenal, pitchMix);
  const pitchISOAdj        = Math.round((pitchISOMultiplier - 1.0) * 20);

  // NaN firewall — coalesce every additive term to 0 if a single upstream
  // input went non-finite. One NaN term (classic offender: an h2h object
  // missing hrRate) used to cascade into a NaN matchupScore, dumping ~48
  // batters/day into a batter-only fallback that silently zeroed ~55% of the
  // model for them. Coalescing degrades gracefully — we lose ONE term, not the
  // whole matchup + env signal.
  // Pitcher velocity trend (−4 to +6): a starter sitting below his OWN season
  // fastball velo is more hittable (velo decline leads ERA/HR9 by 2-3 starts).
  // Each mph down ≈ +2 matchup points; clamped so a one-start blip can't dominate.
  let veloTrendAdj = 0;
  if (pitcherVeloTrend && Number.isFinite(pitcherVeloTrend.veloDelta)) {
    veloTrendAdj = Math.max(-4, Math.min(6, Math.round(-pitcherVeloTrend.veloDelta * 2)));
  }

  // Pitch-level CSW% (−3 to +3): a high called-strike+whiff rate means the
  // pitcher controls counts → fewer hitter's counts (2-0/3-1) where HRs
  // cluster → fewer HRs allowed. Modest weight since it overlaps the whiff-
  // based stuffEdge. League ~28%; above → tougher matchup (negative term).
  let cswFactor = 0;
  if (pitcherVeloTrend && Number.isFinite(pitcherVeloTrend.seasonCswPct)) {
    cswFactor = Math.max(-3, Math.min(3, -(pitcherVeloTrend.seasonCswPct - 28) * 0.5));
  }

  const _finite = (x) => (Number.isFinite(x) ? x : 0);
  const matchupScore = Math.min(100, Math.max(8,
    50 + _finite(hr9Factor) + _finite(eraFactor) * 0.4 + _finite(kFactor) * 0.3 + _finite(h2hFactor)
    + _finite(contactFactor) + _finite(zoneFactor) + _finite(mixFactor) + _finite(ttoAdj)
    + _finite(arsenalEdge) + _finite(stuffEdge) + _finite(recentFormFactor)
    + _finite(pitchISOAdj) + _finite(veloTrendAdj) + _finite(cswFactor)
  ));

  // ── Environment (20%) ────────────────────────────────────────────────────

  const parkMult = carryResult.parkFactor || 1.0;
  // Coalesce a non-finite carry score to the neutral 50 so env can't NaN the
  // composite either (same firewall rationale as matchupScore above).
  const envScore = Math.min(100, (Number.isFinite(carryResult.score) ? carryResult.score : 50) * parkMult);

  // ── Final composite ──────────────────────────────────────────────────────

  // 45/30/25: environment gets more weight vs old 50/30/20, reflecting that
  // park + wind genuinely moves the needle for HR props.
  const base = batterScore * 0.45 + matchupScore * 0.30 + envScore * 0.25;

  // ── Synergy multiplier ───────────────────────────────────────────────────
  // Real HR probability isn't purely additive — when signals stack
  // (elite hitter + bad pitcher + hitter park + wind), the joint chance is
  // higher than the sum. Count independent positive signals and amplify.
  let signalCount = 0;
  if (iso >= 0.200)                          signalCount++;  // elite power
  if (hotScore >= 10)                        signalCount++;  // really hot bat
  if (pitcherHRPer9 >= 1.6)                  signalCount++;  // HR-prone pitcher
  if (carryResult.parkFactor >= 1.08)        signalCount++;  // hitter-friendly park (stable, independent)
  // NOTE: carryResult.score (wind/temp) intentionally excluded — weather is already
  // priced at 25% of the composite via envScore. Including it here double-counts it
  // and amplifies weather API noise, causing borderline players to flip grades
  // between refreshes when wind readings shift by only 1–3 mph.
  if (savantStats?.barrelPct >= 10)          signalCount++;  // elite contact quality
  if (pitcherSavant?.barrelPctAllowed >= 10) signalCount++;  // pitcher giving up barrels
  if (h2h?.hr >= 2)                          signalCount++;  // proven history vs this pitcher
  if (dueAndHotBonus > 0)                    signalCount++;  // regression candidate + hot — potent combo
  // Require a real batting order — `null <= 4` is true (null coerces to 0)
  // and was crediting projected-lineup players (no order yet) with this
  // signal whenever they had any platoon edge.
  if (platoonAdj > 0 && battingOrder != null && battingOrder <= 4) signalCount++;  // platoon edge + lineup spot (max exposure)
  if (homeEdge || awayEdge)                  signalCount++;  // confirmed home/away power edge

  // Tighter multipliers: the recalibrated powerBase already gives elite players
  // a realistic base, so we don't need a big synergy push to reach PRIME.
  // 1.10 max prevents a pile-up of every signal from inflating scores beyond 100.
  const synergyMult = signalCount >= 6 ? 1.10
                    : signalCount >= 5 ? 1.08
                    : signalCount >= 4 ? 1.05
                    : signalCount >= 3 ? 1.02
                    : 1.0;

  const rawScore = base * synergyMult;

  const score = Math.round(Math.min(100, rawScore));

  const grade = gradeFromScore(score);

  // 1–10 rating for the player card quick-read
  const rating = Math.max(1, Math.min(10, Math.round(score / 10)));

  const reasonArgs = {
    iso, hrRate, hot, due, dueScore, expected30, deficit,
    cold, dueAndHotBonus, coldPenalty, savantStats, pitcherSavant, pitchMix,
    pitcherHRPer9, pitcherERA,
    pitcherKPer9:     pitcherSeason?.kPer9 ?? null,
    pitcherWhip:      pitcherSeason?.whip  ?? null,
    splitLabel:       vuln.splitLabel,
    hasSpecificSplit: vuln.hasSpecificSplit,
    effectiveSide:    vuln.effectiveSide,
    windComponent:    carryResult.windComponent,
    tempBoost:        carryResult.tempBoost,
    parkFactor:       carryResult.parkFactor,
    pitcherName:      pitcher?.name || 'Unknown',
    pitcherHand,
    batSide:          batter.batSide,
    platoonAdj,
    battingOrder,
    seasonSlg:        season?.slg ?? 0,
    h2h,
    batterArsenal,
    arsenalEdge,
    pitcherRecentForm,
    recentFormFactor,
    pitcherSeasonHr9: pitcherSeason?.hrPer9 ?? null,
    pitcherSeasonEra: pitcherSeason?.era    ?? null,
    score,
    gradeLabel:       grade.label,
    bullpenSplits,
  };

  // ── Calibration pass ─────────────────────────────────────────────────────
  // Nudge the score using empirical hit-rate data from prior reconciled days
  // (see src/logic/calibration.js). No-op until 300+ reconciled predictions
  // exist; bounded to ±15% per multiplier with geometric-mean dampening so
  // stacked badges can't compound runaway.
  const activeBadgeKeys = [];
  if (hot)                              activeBadgeKeys.push('hot');
  if (due)                              activeBadgeKeys.push('due');
  if (cold)                             activeBadgeKeys.push('cold');
  if (bullpenSplits?.bullpenLegend)     activeBadgeKeys.push('bullpenLegend');
  if (homeEdge)                         activeBadgeKeys.push('homeEdge');
  if (awayEdge)                         activeBadgeKeys.push('awayEdge');
  const calibrated = applyCalibration(score, grade.label, activeBadgeKeys);
  const finalScore = calibrated.score;
  // Re-derive the grade object from the calibrated score so the displayed
  // tier always matches the displayed number (calibration can shift a score
  // across a threshold — we don't want "PRIME 64" or "LEAN 75" labels).
  const finalGrade = (calibrated.gradeKey !== grade.label)
    ? gradeFromScore(finalScore)
    : grade;

  // ── AB-by-AB simulation ───────────────────────────────────────────────────
  // Closed-form HR probability that respects lineup-spot PA count, times-
  // through-the-order penalty, and the late-game bullpen swap. Independent
  // of the composite score so users can see both a ranking (score/grade)
  // AND a calibrated probability ("23% to homer today").
  // The simulateBatter function reads `opposingPitcher.season.hrPer9`. The
  // `pitcher` parameter here is just { id, name }; the actual season HR/9
  // lives on `pitcherSeason`. Shape it before passing.
  const sim = simulateBatter({
    batter,
    opposingPitcher: pitcher ? { ...pitcher, season: pitcherSeason } : null,
    carry:           carryResult,
    battingOrder,
    platoonAdj,
    opposingBullpenHR9,
  });

  return {
    score:  finalScore,
    grade:  finalGrade,
    hrProbability:  sim.hrProbability,   // 0..1, "≥1 HR today"
    expectedHRs:    sim.expectedHRs,     // sum of per-PA p_i
    expectedPAs:    sim.expectedPAs,
    paBreakdown:    sim.perPA,
    rating,
    hot,
    due,
    dueScore,
    expected30,
    deficit,
    cold,
    batterScore:  Math.round(batterScore),
    matchupScore: Math.round(matchupScore),
    envScore:     Math.round(envScore),
    homeEdge,
    awayEdge,
    homeBad,
    awayBad,
    bullpenLegend: bullpenSplits?.bullpenLegend ?? false,
    bullpenSplits,
    // Raw split data attached so the player-detail modal can show the actual
    // numbers behind each flag (e.g. "Day ISO .250 vs Night .195").
    dayNightSplits,
    homeAwaySplits,
    // Recent windows kept for the badge-detail sheet — hot/cold need the
    // recent ISO to display the supporting comparison vs season.
    recent7,
    reasons:      buildReasons(reasonArgs),
    eli5Reasons:  buildEli5Reasons(reasonArgs),
  };
}

/** Map 0–100 score to a grade object. */
export function gradeFromScore(score) {
  for (const t of GRADE_THRESHOLDS) {
    if (score >= t.min) return t;
  }
  return GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];
}

// ─── Reason builders ─────────────────────────────────────────────────────────

function buildReasons({
  iso, hrRate, hot, due, dueScore, expected30, deficit,
  cold, dueAndHotBonus, coldPenalty, savantStats, pitcherSavant, pitchMix,
  pitcherHRPer9, pitcherERA, pitcherKPer9, pitcherWhip,
  splitLabel, hasSpecificSplit, effectiveSide, pitcherHand,
  windComponent, tempBoost, parkFactor,
  pitcherName, batSide, platoonAdj, battingOrder, seasonSlg, h2h,
  batterArsenal, arsenalEdge,
  pitcherRecentForm, pitcherSeasonHr9, pitcherSeasonEra,
}) {
  const lines = [];
  const pName  = pitcherName !== 'Unknown' ? pitcherName.split(' ').slice(-1)[0] : 'P';
  const split  = hasSpecificSplit ? ` ${splitLabel}` : '';

  // ── Power fundamentals ──
  if (iso >= 0.220)      lines.push(`Elite ISO (.${Math.round(iso * 1000)}) — top-tier power`);
  else if (iso >= 0.170) lines.push(`Strong ISO (.${Math.round(iso * 1000)})`);
  else if (iso >= 0.120) lines.push(`Solid ISO (.${Math.round(iso * 1000)})`);

  if (hrRate >= 0.050)      lines.push(`HR rate ${(hrRate * 100).toFixed(1)}% per AB (elite pace)`);
  else if (hrRate >= 0.035) lines.push(`HR rate ${(hrRate * 100).toFixed(1)}% per AB`);

  // ── Situational flags ──
  if (hot && due)
    lines.push(`🔥⏰ Due + Hot Bat — power trending up while owed ${deficit.toFixed(1)} HRs vs expected pace (due score ${dueScore})`);
  else if (hot)
    lines.push('🔥 Hot Bat — ISO trending well above season avg (last 7–15 games)');
  else if (due)
    lines.push(`⏰ Due — expected ${expected30.toFixed(1)} HR in 30 games, has ${Math.round(deficit > 0 ? expected30 - deficit : 0)} (score ${dueScore})`);
  if (cold) lines.push('🧊 Cold Bat — recent ISO + avg well below season baseline (penalty applied)');

  // ── Statcast contact quality ──
  if (savantStats?.exitVelo >= 93)
    lines.push(`Exit velo ${savantStats.exitVelo.toFixed(1)} mph — elite contact quality`);
  else if (savantStats?.exitVelo >= 90)
    lines.push(`Exit velo ${savantStats.exitVelo.toFixed(1)} mph — above avg contact`);

  if (savantStats?.barrelPct >= 10)
    lines.push(`Barrel rate ${savantStats.barrelPct.toFixed(1)}% — elite in-zone power`);
  else if (savantStats?.barrelPct >= 7)
    lines.push(`Barrel rate ${savantStats.barrelPct.toFixed(1)}% — strong hard contact`);

  // ── Launch angle & pull rate ──
  if (savantStats?.launchAngle != null) {
    const la = savantStats.launchAngle;
    if (la >= OPTIMAL_LAUNCH_MIN && la <= OPTIMAL_LAUNCH_MAX)
      lines.push(`Launch angle ${la.toFixed(1)}° — in the HR-optimal corridor (16–32°)`);
    else if (la < 10)
      lines.push(`Launch angle ${la.toFixed(1)}° — ground ball tendency, hurts HR probability`);
    else if (la > 32)
      lines.push(`Launch angle ${la.toFixed(1)}° — elevated fly ball / pop-up tendency`);
  }

  if (savantStats?.pullPct != null && savantStats.pullPct >= 42)
    lines.push(`Pull rate ${savantStats.pullPct.toFixed(0)}% — targets shorter dimensions`);

  if (savantStats?.izContactPct != null) {
    const izc = savantStats.izContactPct;
    if (izc >= 84)      lines.push(`In-zone contact ${izc.toFixed(0)}% — makes contact when pitcher attacks the zone`);
    else if (izc <= 68) lines.push(`In-zone contact ${izc.toFixed(0)}% — misses a lot in zone, limits HR opportunities`);
  }

  if (battingOrder && battingOrder <= 4)
    lines.push(`Batting ${battingOrder === 1 ? 'leadoff' : `#${battingOrder}`} — top of order, maximum PA opportunities`);

  if (platoonAdj > 0)
    lines.push(`Platoon edge: ${batSide === 'R' ? 'RHB vs LHP' : 'LHB vs RHP'} — structural OPS advantage`);
  if (batSide === 'S')
    lines.push(`Switch hitter batting ${effectiveSide === 'L' ? 'left' : 'right'} vs ${pitcherHand === 'L' ? 'LHP' : 'RHP'}`);

  if (savantStats?.xSlg != null) {
    const gap = savantStats.xSlg - seasonSlg;
    if (gap > 0.060) lines.push(`xSLG ${savantStats.xSlg.toFixed(3)} vs actual SLG .${Math.round(seasonSlg * 1000).toString().padStart(3,'0')} — power running above luck`);
    else if (gap > 0.030) lines.push(`xSLG ${savantStats.xSlg.toFixed(3)} — slight positive power regression signal`);
  }

  // ── Pitcher traditional ──
  if (pitcherHRPer9 >= 1.8)
    lines.push(`${pName} HR/9${split}: ${pitcherHRPer9.toFixed(1)} — very HR-prone`);
  else if (pitcherHRPer9 >= 1.3)
    lines.push(`${pName} HR/9${split}: ${pitcherHRPer9.toFixed(1)} — above avg`);
  else if (pitcherHRPer9 < 0.7)
    lines.push(`${pName} HR/9${split}: ${pitcherHRPer9.toFixed(1)} — stingy, tough draw`);

  if (pitcherERA >= 5.0)
    lines.push(`${pName} ERA ${pitcherERA.toFixed(2)} — hittable overall`);
  else if (pitcherERA <= 2.80)
    lines.push(`${pName} ERA ${pitcherERA.toFixed(2)} — ace-level, tough`);

  if (pitcherKPer9 != null) {
    if (pitcherKPer9 >= 11)    lines.push(`${pName} K/9 ${pitcherKPer9.toFixed(1)} — swing-and-miss arm`);
    else if (pitcherKPer9 < 6) lines.push(`${pName} K/9 ${pitcherKPer9.toFixed(1)} — contact-friendly arm`);
  }
  if (pitcherWhip != null && pitcherWhip >= 1.45)
    lines.push(`${pName} WHIP ${pitcherWhip.toFixed(2)} — tends to give up hard contact`);

  // ── Pitcher Statcast contact quality (zone/pitch mix proxy) ──
  if (pitcherSavant?.barrelPctAllowed != null) {
    const brl = pitcherSavant.barrelPctAllowed;
    if (brl >= 10)        lines.push(`${pName} barrel% against ${brl.toFixed(1)}% — gets squared up often`);
    else if (brl <= 5.5)  lines.push(`${pName} barrel% against ${brl.toFixed(1)}% — limits hard contact well`);
  }
  if (pitcherSavant?.hardHitPctAllowed != null) {
    const hh = pitcherSavant.hardHitPctAllowed;
    if (hh >= 42)        lines.push(`${pName} hard-hit% against ${hh.toFixed(1)}% — batters are squaring him up`);
    else if (hh <= 32)   lines.push(`${pName} hard-hit% against ${hh.toFixed(1)}% — suppresses quality contact`);
  }
  if (pitcherSavant?.exitVeloAgainst != null) {
    const ev = pitcherSavant.exitVeloAgainst;
    if (ev >= 90)        lines.push(`${pName} avg EV against ${ev.toFixed(1)} mph — elite contact allowed`);
    else if (ev <= 85.5) lines.push(`${pName} avg EV against ${ev.toFixed(1)} mph — weak contact profile`);
  }

  // ── Pitch mix ──
  if (pitchMix) {
    // Fastball reliance + damage
    if (pitchMix.fastballPct >= 55 && pitchMix.fastballRunVal != null) {
      if (pitchMix.fastballRunVal > 1.5)
        lines.push(`${pName} throws ${pitchMix.fastballPct.toFixed(0)}% fastballs and is getting hurt on them (RV: +${pitchMix.fastballRunVal.toFixed(1)}) — power hitters' dream`);
      else if (pitchMix.fastballRunVal > 0)
        lines.push(`${pName} is fastball-heavy (${pitchMix.fastballPct.toFixed(0)}%) — can be exploited by power hitters`);
    }
    // Total arsenal damage
    if (pitchMix.totalRunVal != null) {
      if (pitchMix.totalRunVal > 2)
        lines.push(`${pName} overall arsenal run value: +${pitchMix.totalRunVal.toFixed(1)} — batters winning across all pitch types`);
      else if (pitchMix.totalRunVal < -2)
        lines.push(`${pName} arsenal run value: ${pitchMix.totalRunVal.toFixed(1)} — pitcher dominating with his mix`);
    }
    // Worst pitch callout
    if (pitchMix.worstPitch?.rv > 1.5)
      lines.push(`${pName} worst pitch: ${pitchMix.worstPitch.name} getting hit at +${pitchMix.worstPitch.rv.toFixed(1)} RV/100`);
    // Breaking ball suppressor
    if (pitchMix.breakingPct >= 40 && pitchMix.breakingRunVal != null && pitchMix.breakingRunVal < -1.5)
      lines.push(`${pName} leans on breaking balls (${pitchMix.breakingPct.toFixed(0)}%) that are working — limits hard contact`);
  }

  // ── Zone location ──
  if (pitcherSavant?.heartPct != null && pitcherSavant.heartPct > 13)
    lines.push(`${pName} heart-of-plate rate ${pitcherSavant.heartPct.toFixed(1)}% — leaving too many pitches in the middle`);
  else if (pitcherSavant?.heartPct != null && pitcherSavant.heartPct < 7)
    lines.push(`${pName} rarely misses middle (${pitcherSavant.heartPct.toFixed(1)}% heart rate) — sharp command`);
  if (pitcherSavant?.edgePct != null && pitcherSavant.edgePct > 17)
    lines.push(`${pName} edge rate ${pitcherSavant.edgePct.toFixed(1)}% — elite location, hard to square up`);

  // ── Pitcher recent form (last 5 starts vs season line) ──
  if (pitcherRecentForm && pitcherRecentForm.ip >= 10) {
    const recERA = pitcherRecentForm.era;
    const recHR9 = pitcherRecentForm.hrPer9;
    const games  = pitcherRecentForm.games;
    if (pitcherSeasonEra != null && recERA - pitcherSeasonEra >= 1.5)
      lines.push(`${pName} last ${games} starts: ${recERA.toFixed(2)} ERA (season ${pitcherSeasonEra.toFixed(2)}) — trending wrong way`);
    else if (pitcherSeasonEra != null && pitcherSeasonEra - recERA >= 1.5)
      lines.push(`${pName} last ${games} starts: ${recERA.toFixed(2)} ERA (season ${pitcherSeasonEra.toFixed(2)}) — locked in`);
    if (pitcherSeasonHr9 != null && recHR9 - pitcherSeasonHr9 >= 0.7)
      lines.push(`${pName} HR/9 in last ${games}: ${recHR9.toFixed(1)} (season ${pitcherSeasonHr9.toFixed(1)}) — giving up bombs lately`);
  }

  // ── Pitch-arsenal matchup (the most actionable matchup signal) ──
  if (batterArsenal && pitchMix) {
    const fmt = (s) => `.${Math.round((s || 0) * 1000).toString().padStart(3, '0')}`;
    // Pitcher's most-thrown category
    const cats = [
      { name: 'fastballs', pct: pitchMix.fastballPct || 0, batSlg: batterArsenal.fastballSlg },
      { name: 'breaking balls', pct: pitchMix.breakingPct || 0, batSlg: batterArsenal.breakingSlg },
      { name: 'offspeed', pct: pitchMix.offspeedPct || 0, batSlg: batterArsenal.offspeedSlg },
    ].filter(c => c.batSlg != null);
    if (cats.length) {
      const top = [...cats].sort((a, b) => b.pct - a.pct)[0];
      if (top.pct >= 35 && top.batSlg >= 0.500)
        lines.push(`Crushes ${top.name} (${fmt(top.batSlg)} SLG) — ${pName} throws ${top.pct.toFixed(0)}% of them`);
      else if (top.pct >= 40 && top.batSlg <= 0.330)
        lines.push(`Struggles vs ${top.name} (${fmt(top.batSlg)} SLG) — ${pName} leans on them ${top.pct.toFixed(0)}%`);
    }
    // Specific best/worst pitch callout when very strong
    if (batterArsenal.bestPitch?.slg >= 0.600) {
      lines.push(`Best pitch to hit: ${batterArsenal.bestPitch.name} (${fmt(batterArsenal.bestPitch.slg)} SLG)`);
    }
  }

  // ── Head-to-head ──
  if (h2h) {
    if (h2h.hr > 0)
      lines.push(`Career vs ${pName}: ${h2h.hr} HR in ${h2h.ab} AB (.${Math.round(h2h.avg * 1000).toString().padStart(3, '0')} avg)`);
    else if (h2h.ab >= 10)
      lines.push(`Career vs ${pName}: 0 HR in ${h2h.ab} AB — no history here`);
  }

  // ── Environment ──
  if (windComponent > 5)        lines.push(`Wind blowing out ${windComponent.toFixed(0)} mph`);
  else if (windComponent < -5)  lines.push(`Wind blowing in ${Math.abs(windComponent).toFixed(0)} mph — suppressed`);
  if (tempBoost > 3)            lines.push(`Warm temps boost carry (+${tempBoost.toFixed(1)})`);
  if (parkFactor >= 1.05)       lines.push(`Hitter-friendly park (${parkFactor.toFixed(2)}x)`);
  else if (parkFactor <= 0.93)  lines.push(`Pitcher-friendly park (${parkFactor.toFixed(2)}x)`);

  return lines.length ? lines : ['Balanced profile across all factors'];
}

// Sentiment tag — drives the icon AND color used in the modal renderer.
// 'good'    → favors a HR (greens)
// 'bad'     → works against a HR (reds)
// 'neutral' → context/info (muted)
// The `icon` key is mapped to a lucide component in PlayerDetailModal.
const E = (icon, tone, text) => ({ icon, tone, text });

function buildEli5Reasons({
  iso, hrRate, hot, due, dueScore, expected30, deficit,
  cold, dueAndHotBonus, coldPenalty, savantStats, pitcherSavant, pitchMix,
  pitcherHRPer9, pitcherERA, pitcherKPer9,
  bullpenSplits,
  splitLabel, hasSpecificSplit, effectiveSide, pitcherHand,
  windComponent, tempBoost, parkFactor,
  pitcherName, gradeLabel, battingOrder, seasonSlg, batSide, platoonAdj, h2h,
}) {
  const lines = [];

  // Lead with the overall grade summary — names WHICH factors are driving the call
  if (gradeLabel === 'PRIME') {
    const drivers = [];
    if (iso >= 0.200) drivers.push('elite power');
    if (hot) drivers.push('hot bat');
    if (due) drivers.push('overdue');
    if (pitcherHRPer9 >= 1.6) drivers.push('HR-prone pitcher');
    if (windComponent > 5) drivers.push('wind blowing out');
    if (parkFactor >= 1.08) drivers.push('hitter-friendly park');
    const summary = drivers.length >= 2 ? drivers.slice(0, 3).join(', ') : null;
    lines.push(E('gem', 'good', summary
      ? `Everything lines up — ${summary}. About as good as it gets.`
      : 'Everything lines up — power, matchup, and conditions all point to a home run.'));
  } else if (gradeLabel === 'STRONG') {
    const drivers = [];
    if (hot) drivers.push('hot bat right now');
    if (due) drivers.push('overdue for a HR');
    if (pitcherHRPer9 >= 1.3) drivers.push('hittable pitcher');
    if (iso >= 0.170) drivers.push('strong power hitter');
    if (parkFactor >= 1.05) drivers.push('hitter-friendly park');
    const summary = drivers.length >= 2 ? drivers.slice(0, 2).join(' and ') : null;
    lines.push(E('zap', 'good', summary
      ? `Solid pick — ${summary}. Multiple signals pointing the same direction.`
      : 'Multiple things working in his favor — solid pick with real upside.'));
  } else if (gradeLabel === 'LEAN') {
    lines.push(E('eye', 'neutral', 'Some things line up but not everything. Worth a look, not a lock.'));
  } else {
    lines.push(E('minus', 'bad', 'Tough spot today — better options probably exist on the slate.'));
  }

  // ── Power ──
  if (iso >= 0.220)      lines.push(E('flame', 'good', "Serious power hitter — racks up extra bases all season."));
  else if (iso >= 0.170) lines.push(E('flame', 'good', "Above-average power — hits his share of bombs."));
  else if (iso >= 0.120) lines.push(E('activity', 'neutral', "Decent pop but not elite HR power."));

  if (hrRate >= 0.050)      lines.push(E('trending-up', 'good', "Homers about every 20 at-bats — elite pace."));
  else if (hrRate >= 0.035) lines.push(E('trending-up', 'good', "Solid HR pace this season."));
  else if (hrRate > 0)      lines.push(E('trending-down', 'bad', "HR rate is below average — power isn't his main strength."));

  // ── Launch angle & pull ──
  if (savantStats?.launchAngle != null) {
    const la = savantStats.launchAngle;
    if (la >= OPTIMAL_LAUNCH_MIN && la <= OPTIMAL_LAUNCH_MAX)
      lines.push(E('target', 'good', `Launch angle ${la.toFixed(0)}° is right in the HR zone — perfect trajectory to clear the fence.`));
    else if (la < 10)
      lines.push(E('trending-down', 'bad', `Tends to hit the ball into the ground (${la.toFixed(0)}° avg). Ground balls don't leave the yard.`));
  }

  if (savantStats?.pullPct != null && savantStats.pullPct >= 42)
    lines.push(E('crosshair', 'good', `Pulls the ball ${savantStats.pullPct.toFixed(0)}% of the time — pull hitters target the short side of the park where HRs live.`));

  if (savantStats?.xSlg != null && (savantStats.xSlg - seasonSlg) > 0.050)
    lines.push(E('trending-up', 'good', `Statcast says he's been unlucky — expected slugging is way above actual. Gaps like this tend to correct with more HRs.`));
  if (savantStats?.xSlg != null && (seasonSlg - savantStats.xSlg) > 0.050)
    lines.push(E('trending-down', 'bad', `Statcast says he's been lucky — actual slugging is well above his contact quality. Regression is likely.`));

  if (savantStats?.izContactPct != null && savantStats.izContactPct <= 68)
    lines.push(E('alert', 'bad', `Struggles to make contact even in the zone — limits chances to square one up.`));

  if (battingOrder && battingOrder <= 2)
    lines.push(E('layers', 'good', `Batting ${battingOrder === 1 ? 'leadoff' : '#2'} — top of the order gets more at-bats than anyone else.`));

  if (platoonAdj > 0)
    lines.push(E('crosshair', 'good', `Platoon advantage — ${batSide === 'R' ? 'righties' : 'lefties'} historically crush ${pitcherHand === 'L' ? 'lefty' : 'righty'} pitching. Real edge.`));
  if (batSide === 'S')
    lines.push(E('shuffle', 'neutral', `Switch hitter facing a ${pitcherHand === 'L' ? 'lefty' : 'righty'} — batting from the ${effectiveSide === 'L' ? 'left' : 'right'} side today.`));

  // ── Situational flags ──
  if (hot && due)
    lines.push(E('zap', 'good', `Hot AND overdue — a rare combo. His bat's coming alive exactly when the math says he's owed.`));
  else if (hot)
    lines.push(E('flame', 'good', "Crushing the ball recently — well above his normal power pace."));
  else if (due)
    lines.push(E('clock', 'good', `Expected ~${expected30.toFixed(1)} HRs in his last 30 games but has come up short. The math says he's overdue.`));
  if (cold) lines.push(E('snowflake', 'bad', "Cold streak — not hitting with his usual power. Factor that in."));

  // ── Bullpen Legend ──
  // Surface this AFTER hot/due/cold so it reads as a "by the way, when the
  // pen comes in he punishes them" footnote — relievers usually appear in the
  // 6th+, so this is most actionable on full-game props.
  if (bullpenSplits?.bullpenLegend) {
    const rpPct = (bullpenSplits.rpHrRate * 100).toFixed(1);
    const ratio = bullpenSplits.bullpenRatio;
    const ratioNote = ratio && ratio >= 1.4
      ? ` — ${(ratio).toFixed(1)}× his vs-starter rate`
      : '';
    lines.push(E('award', 'good',
      `Bullpen Legend — ${bullpenSplits.rpHr} HR in ${bullpenSplits.rpAb} ABs vs relievers (${rpPct}%)${ratioNote}. Tees off when the pen comes in.`
    ));
  }

  // ── Statcast contact quality ──
  if (savantStats?.exitVelo >= 93)
    lines.push(E('activity', 'good', "Crushes the ball — exit velo near the top of the league."));
  if (savantStats?.barrelPct >= 10)
    lines.push(E('target', 'good', "Elite barrel rate — when he connects, the ball goes far."));
  else if (savantStats?.barrelPct >= 7)
    lines.push(E('target', 'good', "Solid barrel rate — hard contact regularly turns into extra-base hits."));

  // ── Pitcher ──
  const pShort    = pitcherName !== 'Unknown' ? pitcherName.split(' ').slice(-1)[0] : 'This pitcher';
  const splitNote = hasSpecificSplit ? ` (specifically ${splitLabel})` : '';

  if (pitcherHRPer9 >= 1.8)
    lines.push(E('alert', 'good', `${pShort} gives up a LOT of home runs${splitNote} — hitters feast on him.`));
  else if (pitcherHRPer9 >= 1.2)
    lines.push(E('trending-up', 'good', `${pShort} gives up HRs at an above-average clip${splitNote}.`));
  else if (pitcherHRPer9 < 0.6)
    lines.push(E('shield', 'bad', `${pShort} is stingy — rarely gives up HRs${splitNote}. Tough matchup.`));

  if (pitcherERA >= 5.0)
    lines.push(E('trending-up', 'good', `${pShort}'s ${pitcherERA.toFixed(2)} ERA — getting hit hard all year.`));
  else if (pitcherERA <= 2.80)
    lines.push(E('shield', 'bad', `${pShort} has been dominant — one of the tougher arms on the slate.`));

  if (pitcherKPer9 != null && pitcherKPer9 >= 11)
    lines.push(E('alert', 'bad', `${pShort} strikes guys out at a high rate — hard to square up even when he leaves one over the plate.`));

  // ── Pitcher Statcast ──
  if (pitcherSavant?.barrelPctAllowed != null) {
    const brl = pitcherSavant.barrelPctAllowed;
    if (brl >= 10)
      lines.push(E('alert', 'good', `Batters square ${pShort} up hard — ${brl.toFixed(1)}% barrel rate against. Contact does damage.`));
    else if (brl <= 5.5)
      lines.push(E('shield', 'bad', `${pShort} barely allows barrels — even solid contact tends to be weak. Tough for HRs.`));
  }

  if (pitcherSavant?.hardHitPctAllowed != null && pitcherSavant.hardHitPctAllowed >= 42)
    lines.push(E('activity', 'good', `Batters consistently hit the ball hard vs ${pShort} — good sign for power hitters.`));

  // ── Pitch mix & zones ──
  if (pitchMix) {
    if (pitchMix.fastballPct >= 55 && pitchMix.fastballRunVal != null && pitchMix.fastballRunVal > 1) {
      lines.push(E('alert', 'good', `${pShort} throws fastballs ${pitchMix.fastballPct.toFixed(0)}% of the time AND hitters are teeing off on them — recipe for HRs.`));
    } else if (pitchMix.fastballPct >= 55) {
      lines.push(E('zap', 'good', `${pShort} is fastball-first (${pitchMix.fastballPct.toFixed(0)}%) — power hitters do their best damage against heater-heavy arms.`));
    }
    if (pitchMix.totalRunVal != null && pitchMix.totalRunVal > 2) {
      lines.push(E('trending-up', 'good', `${pShort}'s whole arsenal is getting hit — batters aren't being fooled.`));
    } else if (pitchMix.totalRunVal != null && pitchMix.totalRunVal < -2) {
      lines.push(E('shield', 'bad', `${pShort}'s arsenal is working — batters are struggling across all his pitches.`));
    }
    if (pitchMix.worstPitch?.rv > 2)
      lines.push(E('alert', 'good', `His ${pitchMix.worstPitch.name} is getting hammered — if he throws it today, expect damage.`));
  }

  if (pitcherSavant?.heartPct != null && pitcherSavant.heartPct > 13)
    lines.push(E('target', 'good', `${pShort} leaves a lot of pitches over the middle (${pitcherSavant.heartPct.toFixed(0)}% heart). Middle pitches get hit into the seats.`));
  else if (pitcherSavant?.heartPct != null && pitcherSavant.heartPct < 7)
    lines.push(E('shield', 'bad', `${pShort} rarely misses over the heart — painting corners makes him hard to drive.`));
  if (pitcherSavant?.edgePct != null && pitcherSavant.edgePct > 17)
    lines.push(E('shield', 'bad', `${pShort} hits the edges constantly — batters can't square those up.`));

  // ── H2H ──
  if (h2h) {
    if (h2h.hr > 0)
      lines.push(E('book', 'good', `Has homered off ${pShort} before — ${h2h.hr} time${h2h.hr !== 1 ? 's' : ''} in ${h2h.ab} career ABs. Real track record.`));
    else if (h2h.ab >= 10)
      lines.push(E('book', 'neutral', `Has faced ${pShort} ${h2h.ab} times and hasn't taken him deep yet.`));
  }

  // ── Environment ──
  if (windComponent > 8)
    lines.push(E('wind', 'good', "Wind blowing hard out — balls will carry farther."));
  else if (windComponent > 4)
    lines.push(E('wind', 'good', "Light wind blowing out — slight carry boost."));
  else if (windComponent < -5)
    lines.push(E('wind', 'bad', "Wind blowing IN — harder to clear the fence."));

  if (tempBoost > 3)
    lines.push(E('sun', 'good', "Warm out — hot air helps the ball fly."));

  if (parkFactor >= 1.10)
    lines.push(E('home', 'good', "One of the best HR parks in baseball."));
  else if (parkFactor >= 1.05)
    lines.push(E('home', 'good', "Hitter-friendly park — slight edge."));
  else if (parkFactor <= 0.93)
    lines.push(E('home', 'bad', "Pitcher-friendly park — harder to hit HRs here."));

  return lines;
}

// applyInningScalar was a draft live-game compression curve that was never
// wired in. The newer HomeScreen live-rankings clamp (scores can only drop,
// never rise mid-game) supersedes it. Removed to prevent future devs from
// picking up half-implemented logic.

// ─── Stadium lookup ───────────────────────────────────────────────────────────

/**
 * Find a stadium by venue name using two-level fuzzy matching.
 *   1. Full name substring match (either direction)
 *   2. Distinctive word match (≥5 chars, not a generic venue word)
 */
export function findStadium(venueName) {
  if (!venueName) return null;
  const stadiums = stadiumsData.stadiums;
  const norm = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const vn   = norm(venueName);

  let match = stadiums.find(s => vn.includes(norm(s.name)));
  if (match) return match;
  match = stadiums.find(s => norm(s.name).includes(vn));
  if (match) return match;

  const GENERIC = new Set(['park', 'field', 'stadium', 'centre', 'center', 'arena', 'garden', 'grounds']);
  match = stadiums.find(s => {
    const words = norm(s.name).split(' ').filter(w => w.length >= 5 && !GENERIC.has(w));
    return words.length > 0 && words.some(w => vn.includes(w));
  });
  return match || null;
}

// ─── Math improvement re-exports (Tier 1-3 from math roadmap) ─────────────
// These pure-function helpers are kept in sibling files for clarity but
// re-exported here so they ride along inside the model.mjs bundle and
// reach the server's fetch-slate.mjs alongside scoreBatter. The client
// imports them directly via Metro bundler.
export {
  americanToImpliedProb,
  dejuicedImpliedProb,
  bestPriceFromBooks,
  blendScoreWithVegas,
  probToScore as probToScoreVegas,
  scoreToProb as scoreToProbVegas,
  recommendedWeight,
} from './vegasBlend.js';
export {
  fitIsotonicFromBacktest,
  lookupProb,
  serializeTable as serializeIsotonicTable,
  deserializeTable as deserializeIsotonicTable,
  DEFAULT_LOOKUP_TABLE,
} from './isotonicCalibration.js';
export {
  computeBrier,
  computeLogLoss,
  computeReliabilityCurve,
  computeMetricsFromBacktest,
  baselineBrierForRate,
  baselineLogLossForRate,
} from './scoringMetrics.js';
export {
  shrinkStat,
  LEAGUE_PRIORS,
  PRIOR_STRENGTH,
  shrinkSeasonStats,
  shrinkRecentStats,
  shrinkagePenalty,
} from './smallSampleShrinkage.js';
export {
  estimateIPDistribution,
  probFaceStarterAtPA,
  weightedPerPAHR9,
  expectedHR9ForBatter,
} from './starterIPDistribution.js';
export {
  detectReverseSplit,
  effectivePlatoonHR9,
} from './reverseSplit.js';
export {
  computeHotnessPosterior,
  hotnessMultiplier,
} from './hotStreakPosterior.js';
export {
  PARK_INTERACTION_TABLE,
  parkSilhouette,
  relativeWindDirection,
  sideFromRelativeDeg,
  parkWeatherHandFactor,
} from './parkWeatherHand.js';
export {
  expectedHRMultiplierFromPitchMix,
  getPitchAlignmentScore,
} from './batterPitchTypeISO.js';
export {
  estimateRemainingPAs,
  applyPADecay,
} from './livePADecay.js';
export {
  computeLogOddsScore,
  logit,
  sigmoid,
  LEAGUE_BASELINE_LOGIT,
  LEAGUE_BASELINE_HR_PROB,
  DEFAULT_WEIGHTS as LOG_ODDS_DEFAULT_WEIGHTS,
} from './logOddsScore.js';
