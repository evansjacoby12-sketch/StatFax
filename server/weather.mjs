/**
 * server/weather.mjs — National Weather Service (NWS) hourly forecast client.
 *
 * Single weather provider for the StatFax cron. Replaces Open-Meteo, which
 * was producing forecasts ~7°F off on temperature and ~90° off on wind
 * direction for US ballparks vs the NWS-derived data RotoGrinders /
 * Weather.com / Wunderground use. NWS is the US government source those
 * services derive from — pulling it directly eliminates the disagreement.
 *
 * ── Why NWS instead of Open-Meteo ─────────────────────────────────────────
 *
 *   - Free, no API key, no signup. ~5 req/sec per IP rate limit; we use
 *     ~30 req/cron at peak (15 games × 2 endpoints).
 *   - Official US gov source. Same data feeds every major US weather site,
 *     including the ones RG and Weather.com show. Pulling it directly means
 *     our chip + their chip read identical values — no more user trust hits
 *     from "your app says 61° but RG says 68°."
 *   - All MLB venues are in the US (Toronto's Rogers Centre is a permanently
 *     domed venue — roof closed → no outdoor weather needed → no need to
 *     handle non-US venues).
 *   - Numeric `windDirection` (degrees) in the gridpoint endpoint — better
 *     than parsing the hourly endpoint's "NNW" / "NE" text codes.
 *
 * ── API contract (per game) ───────────────────────────────────────────────
 *
 * Two NWS endpoints chained:
 *
 *   1. /points/{lat},{lon} → static per-venue lookup that returns the
 *      gridded-forecast office (e.g. "BOX" for Boston) plus (x, y) grid
 *      coordinates. The response body's `forecastHourly` +
 *      `forecastGridData` URLs are what we hit next. We cache the result
 *      per-venue forever (per cron process) since stadium coordinates
 *      never change.
 *
 *   2. /gridpoints/{office}/{x},{y}/forecast/hourly →
 *      Array of hourly "periods" with temp (F), wind speed (string "8 mph"),
 *      wind direction (text "NNW"), precip %, humidity %, dewpoint (°C).
 *
 *   3. /gridpoints/{office}/{x},{y} (raw grid) →
 *      Numeric wind direction (degrees), wind gust (km/h, converted to mph
 *      here), cloud cover %, optional pressure. Indexed by validTime
 *      intervals (e.g. "2026-05-28T16:00:00+00:00/PT1H"). Used to fill in
 *      fields the hourly endpoint lacks.
 *
 * We merge both per hour-bucket so the final shape exactly matches the
 * Open-Meteo legacy shape that the rest of the cron + client read.
 *
 * ── Headers NWS requires ──────────────────────────────────────────────────
 *
 * User-Agent must be set and include identifying info (NWS will reject
 * requests without it). The string format is loose; we send our github
 * URL so the NWS team can reach us if usage looks problematic.
 *
 * ── Snapshot shape produced (unchanged from Open-Meteo) ───────────────────
 *
 *   weatherByGame[gamePk] = {
 *     tempF, windSpeedMph, windDirDeg, windGustMph,
 *     humidity, pressureMb, precipProbPct, cloudCoverPct,
 *     hours: [
 *       { hourOffset, tIso, tempF, windSpeedMph, windDirDeg, ... },
 *       ...
 *     ],
 *     source:        'nws',
 *     fetchedAt:     ISO,
 *     gameStartIso:  ISO,
 *     timezone:      'America/New_York' | etc,
 *   }
 *
 * `tIso` is the NWS startTime ISO with TZ offset (e.g.
 * "2026-05-28T16:00:00-04:00"). That's parseable by Date.parse() correctly
 * in both Node and Hermes — no more "is this local or UTC" ambiguity that
 * the old Open-Meteo format required us to handle with utc_offset_seconds.
 */

const NWS_BASE = 'https://api.weather.gov';
// NWS rejects requests without a User-Agent that includes contact info.
// Identify our app + a way to reach the maintainer.
const NWS_UA =
  'StatFax/1.0 (https://github.com/evansjacoby12-sketch/StatFax, evansjacoby12@gmail.com)';

// How many hourly buckets to include per game, starting at first-pitch
// hour. 7 covers a ~4h game plus pre-pitch + post-final buffer so the
// client can pick a fresh hour all the way through extra innings.
const GAME_HOURS_AHEAD = 7;

// NWS occasionally returns transient 500s under load. Two retries with a
// modest backoff recovers virtually all of them without burning rate
// limit on aggressive retries.
const FETCH_RETRIES  = 2;
const RETRY_DELAY_MS = 800;

// Per-process caches.
//   pointCache:    venue lat/lon → static grid coords. Stadium coords
//                  don't change so the result is good for the whole cron.
//   snapshotCache: venue lat/lon → processed hourly + grid blob. Dedupes
//                  doubleheaders at the same venue (two games, one fetch).
const pointCache    = new Map();
const snapshotCache = new Map();
function pointKey(lat, lon) { return `${lat.toFixed(4)},${lon.toFixed(4)}`; }
function snapKey(lat, lon)  { return `${lat.toFixed(2)},${lon.toFixed(2)}`; }

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function nwsFetch(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': NWS_UA,
      'Accept':     'application/geo+json',
    },
  });
  if (!res.ok) throw new Error(`NWS HTTP ${res.status} ${url}`);
  return res.json();
}

async function nwsFetchWithRetry(url) {
  let lastErr = null;
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt++) {
    try {
      return await nwsFetch(url);
    } catch (e) {
      lastErr = e;
      if (attempt < FETCH_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  throw lastErr || new Error('NWS fetch failed');
}

// ─── Point → grid lookup ────────────────────────────────────────────────────

/**
 * Resolve venue lat/lon to NWS gridpoint metadata (one-time per venue).
 * Returns the URLs for the hourly forecast + raw grid endpoints, plus the
 * IANA timezone NWS associates with the gridpoint.
 */
async function getPoint(lat, lon) {
  const key = pointKey(lat, lon);
  if (pointCache.has(key)) return pointCache.get(key);
  const data  = await nwsFetchWithRetry(`${NWS_BASE}/points/${key}`);
  const props = data?.properties || {};
  const point = {
    forecastHourly:   props.forecastHourly   || null,
    forecastGridData: props.forecastGridData || null,
    timezone:         props.timeZone         || null,
  };
  pointCache.set(key, point);
  return point;
}

// ─── Parsing helpers ────────────────────────────────────────────────────────

/**
 * Parse NWS windSpeed strings like "5 mph", "8 to 13 mph", "0 mph".
 * Returns the lower-bound number (matches RotoGrinders' display convention)
 * or null on unparseable input.
 */
function parseWindSpeed(str) {
  if (str == null) return null;
  const m = String(str).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function kmhToMph(v) {
  return v == null ? null : v * 0.621371192;
}

// NWS gridpoint values are occasionally garbled (e.g. a windGust of ~994 km/h →
// 618 mph). No wind relevant to a playable ballgame approaches triple digits,
// so treat anything beyond a physical ceiling — or negative — as missing data.
const MAX_SANE_MPH = 90;
function saneMph(v) {
  return Number.isFinite(v) && v >= 0 && v <= MAX_SANE_MPH ? v : null;
}

/**
 * NWS gridpoint properties carry per-hour values keyed by an ISO interval
 * like "2026-05-28T16:00:00+00:00/PT1H" (start + duration). Some intervals
 * span multiple hours when conditions are forecast to hold steady. Find
 * the entry whose interval contains the requested UTC timestamp.
 */
function getGridValueAt(prop, utcMs) {
  const values = prop?.values;
  if (!Array.isArray(values)) return null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const validTime = String(v?.validTime || '');
    const slashIdx  = validTime.indexOf('/');
    if (slashIdx < 0) continue;
    const startMs = Date.parse(validTime.slice(0, slashIdx));
    if (!Number.isFinite(startMs)) continue;
    const durStr  = validTime.slice(slashIdx + 1);
    const hMatch  = durStr.match(/PT(\d+)H/);
    const durHrs  = hMatch ? Number(hMatch[1]) : 1;
    const endMs   = startMs + durHrs * 3600 * 1000;
    if (utcMs >= startMs && utcMs < endMs) {
      return v.value;
    }
  }
  return null;
}

/**
 * Fallback: NWS hourly text wind-direction code ("NNW") → degrees. The
 * gridpoint numeric value is preferred; this only runs when grid lookup
 * misses (rare). Returns null for "" or unknown codes (e.g. "VAR" for
 * variable wind).
 */
const WIND_DIR_DEG = Object.freeze({
  N:   0,    NNE:  22.5, NE:   45,   ENE:  67.5,
  E:   90,   ESE: 112.5, SE:  135,   SSE: 157.5,
  S:   180,  SSW: 202.5, SW:  225,   WSW: 247.5,
  W:   270,  WNW: 292.5, NW:  315,   NNW: 337.5,
});
function windDirTextToDeg(s) {
  if (!s || typeof s !== 'string') return null;
  const code = s.toUpperCase().trim();
  return WIND_DIR_DEG[code] ?? null;
}

// ─── Hour-window assembly ───────────────────────────────────────────────────

/**
 * Index into the cached periods array to find the bucket starting at or
 * just before gameStart. Mirrors the legacy Open-Meteo behavior (first
 * bucket ≤ game start) so the rest of the pipeline behaves identically.
 */
function findFirstPitchIndex(periods, gameStartUtcMs) {
  let idx = -1;
  for (let i = 0; i < periods.length; i++) {
    const t = Date.parse(periods[i].startTime);
    if (!Number.isFinite(t)) continue;
    if (t <= gameStartUtcMs) idx = i;
    else break;
  }
  return idx === -1 ? 0 : idx;
}

/**
 * Build the GAME_HOURS_AHEAD-length hours array starting at firstPitchIdx,
 * merging hourly forecast (temp, wind speed, precip, humidity) with grid
 * data (numeric wind direction, gust, cloud cover).
 */
function buildHours(periods, gridProps, firstPitchIdx) {
  const out = [];
  for (let i = 0; i < GAME_HOURS_AHEAD; i++) {
    const j = firstPitchIdx + i;
    if (j >= periods.length) break;
    const p   = periods[j];
    const ts  = Date.parse(p?.startTime);
    if (!Number.isFinite(ts)) continue;

    // Wind direction: prefer numeric grid value; fall back to hourly text.
    const gridDirDeg = getGridValueAt(gridProps?.windDirection, ts);
    const windDirDeg = Number.isFinite(gridDirDeg)
      ? gridDirDeg
      : windDirTextToDeg(p.windDirection);

    // Gust comes from grid in km/h; convert to mph, dropping garbled values.
    const gustKmh    = getGridValueAt(gridProps?.windGust, ts);
    const gustMph    = gustKmh == null ? null : saneMph(Math.round(kmhToMph(gustKmh) * 10) / 10);

    // Cloud cover lives in grid as skyCover (%).
    const cloudPct   = getGridValueAt(gridProps?.skyCover, ts);

    // NWS gridpoint pressure is frequently empty for most offices; default
    // to null and let air-density model fall back to its dry-air estimate.
    const pressureMb = null;

    out.push({
      hourOffset:    i,
      tIso:          p.startTime,            // ISO with TZ offset
      tempF:         Number.isFinite(p.temperature) ? p.temperature : null,
      windSpeedMph:  saneMph(parseWindSpeed(p.windSpeed)),
      windDirDeg:    Number.isFinite(windDirDeg) ? windDirDeg : null,
      windGustMph:   gustMph,
      humidity:      p?.relativeHumidity?.value ?? null,
      pressureMb,
      precipProbPct: p?.probabilityOfPrecipitation?.value ?? null,
      cloudCoverPct: Number.isFinite(cloudPct) ? Math.round(cloudPct) : null,
    });
  }
  return out;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch hourly forecast for a venue and return the headline (first-pitch
 * hour) plus the GAME_HOURS_AHEAD-hour game window. Returns null on any
 * fetch failure — caller treats null as "no weather available" (the cron
 * has a separate carry-forward path that reuses the prior snapshot's
 * weather for the same venue when this returns null).
 *
 * @param {object} venue            { lat, lon } — typically from stadiums.json
 * @param {string} gameStartIso     ISO UTC timestamp of first pitch
 *                                  (e.g. games[i].gameDate from MLB API)
 * @returns {Promise<object|null>}  See snapshot shape comment at top of file
 */
export async function fetchHourlyForecast(venue, gameStartIso) {
  const lat = Number(venue?.lat);
  const lon = Number(venue?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!gameStartIso) return null;

  const gameStartUtcMs = Date.parse(gameStartIso);
  if (!Number.isFinite(gameStartUtcMs)) return null;

  // Doubleheader dedupe: if we already pulled the processed payload for
  // this venue, just re-window it for this game's start time.
  const sk = snapKey(lat, lon);
  let processed = snapshotCache.get(sk);

  if (!processed) {
    try {
      const point = await getPoint(lat, lon);
      if (!point.forecastHourly || !point.forecastGridData) return null;

      // Fetch hourly + grid in parallel — both are required to fill the
      // hour buckets, no point serializing.
      const [hourlyData, gridData] = await Promise.all([
        nwsFetchWithRetry(point.forecastHourly),
        nwsFetchWithRetry(point.forecastGridData),
      ]);

      const periods = hourlyData?.properties?.periods || [];
      if (periods.length === 0) return null;

      processed = {
        periods,
        gridProps: gridData?.properties || {},
        timezone:  point.timezone,
      };
      snapshotCache.set(sk, processed);
    } catch {
      return null;
    }
  }

  const idx   = findFirstPitchIndex(processed.periods, gameStartUtcMs);
  const hours = buildHours(processed.periods, processed.gridProps, idx);
  if (hours.length === 0) return null;

  // Headline mirrors the first-pitch hour so the legacy flat shape that
  // windInterpreter + ProbabilityEngine.calculateBallCarry read continues
  // to work unchanged.
  const h0 = hours[0];
  return {
    tempF:         h0.tempF,
    windSpeedMph:  h0.windSpeedMph,
    windDirDeg:    h0.windDirDeg,
    windGustMph:   h0.windGustMph,
    humidity:      h0.humidity,
    pressureMb:    h0.pressureMb,
    precipProbPct: h0.precipProbPct,
    cloudCoverPct: h0.cloudCoverPct,
    hours,
    source:        'nws',
    fetchedAt:     new Date().toISOString(),
    gameStartIso,
    timezone:      processed.timezone || null,
  };
}

/**
 * Clear the in-process caches. Useful for tests; not called in production.
 * Cron runs spawn a fresh process so cache lifetime is naturally bounded
 * to one slate generation.
 */
export function _clearWeatherCache() {
  pointCache.clear();
  snapshotCache.clear();
}
