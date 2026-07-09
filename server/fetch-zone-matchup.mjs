/**
 * Zone matchup data fetcher.
 *
 * Pulls hot/cold zone heatmaps for a batter and pitch-location frequency
 * heatmaps for a pitcher, then computes "matched zones" — cells where the
 * batter does damage AND the pitcher throws frequently. Those cells are
 * the structural argument for a home run.
 *
 * Output shape (per batter-pitcher pair):
 *
 *   {
 *     batter:        { id, hand, grid: Cell[9], sampleBIP, season },
 *     pitcher:       { id, hand, grid: Cell[9], samplePitches, season },
 *     matchedZones:  number[]                  // indices into the 9-grid
 *     zoneRating:    number                    // 0..10 — how strong the matchup is
 *     badge:         'ZONE_MASTER' | null      // surfaces in modal when >= 2 matches
 *     asOf:          string (ISO timestamp)
 *   }
 *
 * Each Cell has:
 *
 *   { iso?, freq?, count, hrCount }
 *
 * iso is present on batter grids, freq on pitcher grids.
 *
 * Grid layout (catcher's perspective, same as the screenshot reference):
 *
 *   Index   Position
 *   ─────   ──────────────────
 *     0     Upper inside
 *     1     Upper middle
 *     2     Upper outside
 *     3     Middle inside
 *     4     Middle middle  ← the meatball cell
 *     5     Middle outside
 *     6     Lower inside
 *     7     Lower middle
 *     8     Lower outside
 *
 * "Inside" and "outside" are relative to the BATTER's stance — so for a
 * RHB, "inside" is the catcher's right (zone column 0). The MLB Stats API
 * returns zones already in this batter-relative orientation, which is
 * convenient.
 *
 * ────────────────────────────────────────────────────────────────────────
 *
 * Module is standalone — can be imported by `fetch-slate.mjs` to populate
 * the snapshot, OR run from the CLI for ad-hoc verification:
 *
 *   node server/fetch-zone-matchup.mjs --batter=683734 --pitcher=607200 --hand=R
 *
 * The CLI mode prints the full matchup object so you can sanity-check
 * against rude-bets or Statcast directly before relying on it in the
 * cron pipeline.
 */

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const SAVANT   = 'https://baseballsavant.mlb.com';
const SEASON   = new Date().getFullYear();

// 13-zone layout: the 3×3 strike zone (MLB/Statcast zones 1-9) PLUS the four
// outer "chase" quadrants (11-14). Grid index 0-8 = strike zone, 9-12 = the
// chase corners (11→9, 12→10, 13→11, 14→12). The client renders 0-8 in the
// center 3×3 and 9-12 in the four outer corners of a 5×5.
const ZONE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14];
const ZONE_N   = ZONE_IDS.length; // 13
const zoneToIdx = (z) => (z >= 1 && z <= 9 ? z - 1 : z >= 11 && z <= 14 ? z - 2 : -1);

// Browser-like UA so Cloudflare doesn't serve Savant's HTML challenge page.
// Lifted from the existing `fetch-slate.mjs` SAVANT_HEADERS so we behave
// identically to the rest of the pipeline.
const SAVANT_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept':          'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://baseballsavant.mlb.com/',
  'Origin':          'https://baseballsavant.mlb.com',
};

// In-process memoization so back-to-back lookups for the same player
// within one cron run hit a hot cache instead of re-fetching. Keyed by
// `${kind}-${playerId}-${hand}-${season}` with a `{ value, ts }` shape so
// we can persist across runs (see primeFromPriorCache / dumpCache).
//
// Within a single cron run, all entries are treated as fresh — we don't
// re-fetch mid-run. Across runs, the persistent layer enforces a 7-day
// TTL: zones don't shift meaningfully day-to-day, so re-fetching a
// player's heatmap every 10 minutes burns API calls for no real value.
const _memCache = new Map();

// Default TTL for cross-run persistence. Zone heatmaps and opener/bulk
// patterns evolve slowly — 7 days catches the realistic update cadence
// while cutting API load by ~98% vs no caching. Bump shorter (e.g. 1 day)
// for opener detection if the cron starts mis-predicting because a guy
// transitions from "starter" to "opener" or vice versa mid-week.
const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function _setCache(key, value) {
  _memCache.set(key, { value, ts: Date.now() });
}

function _getCache(key) {
  const entry = _memCache.get(key);
  if (!entry) return undefined;
  return entry.value;
}

function _hasCache(key) {
  return _memCache.has(key);
}

/**
 * Seed the in-memory cache from a previously dumped cache object (typically
 * loaded from R2 at cron start). Entries older than `ttlMs` are skipped so
 * stale data isn't carried forward indefinitely.
 *
 * Returns the count of entries primed — useful for logging the cache hit
 * potential at cron startup.
 */
export function primeFromPriorCache(prior, { ttlMs = DEFAULT_CACHE_TTL_MS } = {}) {
  if (!prior || typeof prior !== 'object') return 0;
  const now = Date.now();
  let primed = 0;
  let skippedShape = 0;
  for (const [key, entry] of Object.entries(prior)) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.value == null || !Number.isFinite(entry.ts)) continue;
    if (now - entry.ts > ttlMs) continue;

    // SHAPE GUARD: skip cached entries that pre-date a metric-shape
    // expansion. Forces a refetch on next access, which populates the
    // new fields. Whenever the cell shape changes in fetch*Zones, add
    // a new presence check here to invalidate stale caches.
    //
    // Batter expansion: old cells had {iso, count, hrCount}; current cells
    // also carry {slg, avg, obp, ops, ev, hardHitPct, barrelPct, xwoba}.
    //
    // Pitcher expansion: old cells had {freq, count, hrCount}; current
    // cells also carry {whiffPct, hardHitPct, barrelPct, ev, xwoba, contacts}.
    //
    // Using `'KEY' in firstCell` rather than `firstCell.KEY != null`
    // because new-shape cells can legitimately have KEY = null for
    // sparse zones (e.g., a cell with no batted balls has xwoba=null).
    // Any cached grid that isn't the new 13-cell shape (old 9-cell, or the
    // older cell schemas) is dropped so it refetches with the chase zones.
    if (Array.isArray(entry.value?.grid) && entry.value.grid.length !== ZONE_N) {
      skippedShape++;
      continue;
    }
    if (key.startsWith('batter-')) {
      const firstCell = entry.value?.grid?.[0];
      // barrelPct is the newest batter field (HH%/barrel%/xwOBA expansion);
      // an iso-bearing cell without it is a pre-expansion shape → refetch.
      if (firstCell && 'iso' in firstCell && !('barrelPct' in firstCell)) {
        skippedShape++;
        continue;
      }
    }
    if (key.startsWith('pitcher-')) {
      const firstCell = entry.value?.grid?.[0];
      // slg (batting line allowed) is the newest pitcher field; a freq-bearing
      // cell without it is a pre-expansion shape → refetch.
      if (firstCell && 'freq' in firstCell && !('slg' in firstCell)) {
        skippedShape++;
        continue;
      }
    }

    // Preserve original timestamp instead of resetting the clock (don't
    // use _setCache here — it would re-stamp with Date.now()).
    _memCache.set(key, entry);
    primed++;
  }
  if (skippedShape > 0) {
    console.log(`[zone] skipped ${skippedShape} cache entries with old shape — will refetch`);
  }
  return primed;
}

/**
 * Export the current cache as a plain object that can be JSON-stringified
 * and written to disk / uploaded to R2. The next cron run calls
 * primeFromPriorCache(thisOutput) to warm-start.
 */
export function dumpCache() {
  const out = {};
  for (const [key, entry] of _memCache.entries()) {
    if (entry?.value == null) continue;
    out[key] = entry;
  }
  return out;
}

// ─── HTTP helpers ───────────────────────────────────────────────────────

async function getJson(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  return res.json();
}

async function savantGet(url) {
  return getJson(url, { headers: SAVANT_HEADERS });
}

// ─── Batter zones ───────────────────────────────────────────────────────

/**
 * Fetch a batter's ISO-by-zone heatmap, split by pitcher handedness.
 *
 * Uses MLB Stats API's `hotColdZones` stat type, which returns the value
 * for an arbitrary metric per zone (default = batting average). We pull
 * SLG and AVG separately and derive ISO = SLG - AVG ourselves, because
 * the API doesn't expose ISO directly and ISO is the right metric for
 * HR-prediction (pure power, strips out singles).
 *
 * @param {number} batterId   MLB person id
 * @param {object} opts
 * @param {'L'|'R'} opts.vsHand   pitcher handedness to split on
 * @param {number=} opts.season   defaults to current year
 * @returns {Promise<{grid: Cell[9], sampleBIP, season} | null>}
 */
export async function fetchBatterZones(batterId, { vsHand = 'R', season = SEASON } = {}) {
  const key = `batter-${batterId}-vs${vsHand}-${season}`;
  if (_hasCache(key)) return _getCache(key);

  try {
    // The MLB API IGNORES the `metric` query parameter and just returns
    // all 5 metric splits in one response (sluggingPercentage,
    // onBasePercentage, battingAverage, exitVelocity, onBasePlusSlugging).
    // Verified empirically May 2026 — passing `metric=slg` is a no-op
    // and the splits come back in inconsistent order across requests.
    // So: one call, look up metrics by NAME rather than positional index.
    const sitCode = vsHand === 'L' ? 'vl' : 'vr';
    const url =
      `${MLB_BASE}/people/${batterId}/stats` +
      `?stats=hotColdZones&group=hitting&season=${season}` +
      `&sitCodes=${sitCode}`;

    // Pull two things in parallel:
    //   1. hotColdZones from MLB Stats API — gives us ISO per cell
    //   2. Per-zone batted-ball counts from Savant — gives us BIP + HR
    //      per cell so the UI can render sample sizes and HR markers.
    // Both are independent so parallel saves ~1 round-trip per batter.
    const [raw, countsData] = await Promise.all([
      getJson(url).catch(() => null),
      fetchBatterZoneCounts(batterId, { vsHand, season }),
    ]);

    if (!raw) {
      _setCache(key, null);
      return null;
    }

    // Pull ALL 5 metrics from the hotColdZones response so the client can
    // offer a metric switcher (ISO / SLG / AVG / OBP / OPS / EV) without
    // any extra fetches. MLB returns these in one shot regardless of the
    // metric query param, so reading more than one is free here.
    const slgZones = findZonesByMetric(raw, 'sluggingPercentage');
    const avgZones = findZonesByMetric(raw, 'battingAverage');
    const obpZones = findZonesByMetric(raw, 'onBasePercentage');
    const opsZones = findZonesByMetric(raw, 'onBasePlusSlugging');
    const evZones  = findZonesByMetric(raw, 'exitVelocity');
    if (!slgZones && !avgZones) {
      _setCache(key, null);
      return null;
    }

    // Build 9-cell grid. ISO is derived (SLG - AVG); other metrics are
    // read straight from the API. count/hrCount come from the Savant
    // batted-ball log when available; fall back to 0 if Savant returned
    // nothing (rare — usually means the batter has no batted-ball events
    // yet, e.g., a new call-up).
    const grid = new Array(ZONE_N).fill(null).map(() => ({
      iso: null, slg: null, avg: null, obp: null, ops: null, ev: null,
      hardHitPct: null, barrelPct: null, xwoba: null,
      count: 0, hrCount: 0,
    }));

    for (let i = 0; i < ZONE_N; i++) {
      const zid = ZONE_IDS[i];
      const mlbZone = String(zid).padStart(2, '0');  // '01'..'09','11'..'14'
      const slgVal = parseZoneValue(slgZones, mlbZone, zid);
      const avgVal = parseZoneValue(avgZones, mlbZone, zid);
      const obpVal = parseZoneValue(obpZones, mlbZone, zid);
      const opsVal = parseZoneValue(opsZones, mlbZone, zid);
      const evVal  = parseZoneValue(evZones,  mlbZone, zid);
      const iso    = (Number.isFinite(slgVal) && Number.isFinite(avgVal))
                       ? +(slgVal - avgVal).toFixed(3)
                       : null;
      const evN = countsData?.evCount?.[i] || 0;
      const xwN = countsData?.xwCount?.[i] || 0;
      grid[i] = {
        iso,
        slg:     slgVal,
        avg:     avgVal,
        obp:     obpVal,
        ops:     opsVal,
        ev:      evVal,
        hardHitPct: evN > 0 ? +(countsData.hardHits[i] / evN).toFixed(4) : null,
        barrelPct:  evN > 0 ? +(countsData.barrels[i]  / evN).toFixed(4) : null,
        xwoba:      xwN > 0 ? +(countsData.xwSum[i]     / xwN).toFixed(3) : null,
        count:   countsData?.counts?.[i] || 0,
        hrCount: countsData?.hrs?.[i]    || 0,
      };
    }

    // Prefer the Savant-derived BIP total (it matches the per-cell counts
    // we just rendered). Fall back to MLB's atBats roll-up when Savant
    // returned no data — slightly different metric (atBats includes
    // strikeouts) but better than nothing.
    const sampleBIP = countsData?.totalBip ?? raw?.stats?.[0]?.splits?.[0]?.stat?.atBats ?? 0;

    const out = { grid, sampleBIP, season, hand: vsHand };
    _setCache(key, out);
    return out;
  } catch {
    _setCache(key, null);
    return null;
  }
}

/**
 * Pull the `zones` array for a specific metric name (e.g., 'sluggingPercentage')
 * out of the hotColdZones response. The API returns 5 splits (one per metric)
 * in inconsistent order, so we look up by `stat.name` instead of position.
 */
function findZonesByMetric(apiResponse, metricName) {
  const splits = apiResponse?.stats?.[0]?.splits || [];
  for (const sp of splits) {
    if (sp?.stat?.name === metricName) return sp.stat.zones || null;
  }
  return null;
}

/**
 * Parse a zone's value. Accepts both '01' and '1' zone keys for safety,
 * and returns null for the API's '-' placeholder (no data).
 */
function parseZoneValue(zones, padded, unpadded) {
  if (!zones) return null;
  const z = zones.find(x => x.zone === padded || x.zone === String(unpadded));
  if (!z || z.value === '-' || z.value == null) return null;
  const n = parseFloat(z.value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull this batter's batted-ball log from Baseball Savant and bucket it
 * into the same 9-cell strike zone. Used to populate per-cell BIP counts
 * and HR markers — neither of which the MLB hotColdZones endpoint
 * provides directly (it returns the metric per zone but rolls up sample
 * sizes at the split level).
 *
 * Returns `{ counts: number[9], hrs: number[9], totalBip: number }` —
 * `counts[i]` is the number of batted-ball events in zone i+1, `hrs[i]`
 * is how many of those left the yard.
 */
async function fetchBatterZoneCounts(batterId, { vsHand = 'R', season = SEASON } = {}) {
  try {
    // Savant CSV search for THIS batter, filtered by pitcher handedness.
    // type=details returns one row per pitch; we filter to rows with an
    // event set (i.e., actual batted-ball outcomes — singles, HRs, outs).
    const url =
      `${SAVANT}/statcast_search/csv` +
      `?all=true&hfPT=&hfAB=&hfBBT=&hfPR=&hfZ=&stadium=&hfBBL=` +
      `&hfNewZones=&hfGT=R%7C&hfC=&hfSea=${season}%7C` +
      `&hfSit=&player_type=batter&hfOuts=&opponent=` +
      `&pitcher_throws=${vsHand}` +
      `&batter_stands=&hfBatHand=&hfPull=&metric_1=&hfInn=&min_pitches=0&min_results=0` +
      `&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc` +
      `&min_pas=0&type=details` +
      `&batters_lookup%5B%5D=${batterId}`;

    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) return null;
    const csv = await res.text();
    const rows = parseSavantCsv(csv);

    const counts = new Array(ZONE_N).fill(0);
    const hrs    = new Array(ZONE_N).fill(0);
    // Quality-of-contact accumulators (per zone), all derived from the same
    // batted-ball rows we already fetched — so HH%, barrel% and xwOBA cost no
    // extra request. Denominator for the rates is evCount (batted balls with a
    // tracked launch speed), not `counts` (which includes the odd strikeout row).
    const hardHits = new Array(ZONE_N).fill(0);
    const barrels  = new Array(ZONE_N).fill(0);
    const evSum    = new Array(ZONE_N).fill(0);
    const evCount  = new Array(ZONE_N).fill(0);
    const xwSum    = new Array(ZONE_N).fill(0);
    const xwCount  = new Array(ZONE_N).fill(0);
    let totalBip = 0;

    for (const r of rows) {
      // Only count rows with an actual event — Savant returns one row per
      // pitch including takes/fouls, but BIP-by-zone math should only
      // include batted balls.
      if (!r.events || r.events === '' || r.events === 'null') continue;
      const idx = zoneToIdx(parseInt(r.zone, 10));
      if (idx < 0) continue;
      counts[idx]++;
      totalBip++;
      if (r.events === 'home_run') hrs[idx]++;

      const ev = parseFloat(r.launch_speed);
      if (Number.isFinite(ev)) {
        evSum[idx] += ev;
        evCount[idx]++;
        if (ev >= 95) hardHits[idx]++;
      }
      // Statcast classifies each batted ball; launch_speed_angle bucket 6 = Barrel.
      if (parseInt(r.launch_speed_angle, 10) === 6) barrels[idx]++;
      const xw = parseFloat(r.estimated_woba_using_speedangle);
      if (Number.isFinite(xw)) { xwSum[idx] += xw; xwCount[idx]++; }
    }

    return { counts, hrs, totalBip, hardHits, barrels, evSum, evCount, xwSum, xwCount };
  } catch {
    return null;
  }
}

// ─── Pitcher location frequency ─────────────────────────────────────────

/**
 * Fetch a pitcher's location-frequency heatmap, split by batter handedness.
 *
 * Pulls aggregated pitch-by-pitch from Baseball Savant's `statcast_search`
 * CSV endpoint (filtered by pitcher_id + bat-side), then buckets each
 * pitch's `zone` field into our 9-cell grid. Statcast zones 1-9 are the
 * 3×3 strike-zone cells we want; 11-14 are the four outside-corner
 * "shadow" zones, which we drop for the MVP (they could be aggregated
 * into the matching edge cells later if the UI wants them).
 *
 * @param {number} pitcherId
 * @param {object} opts
 * @param {'L'|'R'} opts.vsHand   batter handedness split
 * @param {number=} opts.season
 * @returns {Promise<{grid: Cell[9], samplePitches, season} | null>}
 */
export async function fetchPitcherZones(pitcherId, { vsHand = 'R', season = SEASON } = {}) {
  const key = `pitcher-${pitcherId}-vs${vsHand}-${season}`;
  if (_hasCache(key)) return _getCache(key);

  try {
    // Savant CSV search. The pitcher_id filter narrows to one pitcher,
    // hfBatHand splits by batter stance. We request only the columns we
    // actually need (zone) to keep the payload small.
    //
    // Note: stand=R URL param is also accepted alongside hfBatHand —
    // we use both to be safe across Savant's filter aliases.
    const url =
      `${SAVANT}/statcast_search/csv` +
      `?all=true&hfPT=&hfAB=&hfBBT=&hfPR=&hfZ=&stadium=&hfBBL=` +
      `&hfNewZones=&hfGT=R%7C&hfC=&hfSea=${season}%7C` +
      `&hfSit=&player_type=pitcher&hfOuts=&opponent=&pitcher_throws=` +
      `&batter_stands=${vsHand}` +
      `&hfBatHand=${vsHand}` +
      `&hfPull=&metric_1=&hfInn=&min_pitches=0&min_results=0` +
      `&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc` +
      `&min_pas=0&type=details` +
      `&pitchers_lookup%5B%5D=${pitcherId}`;

    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) {
      _setCache(key, null);
      return null;
    }
    const csv = await res.text();
    const rows = parseSavantCsv(csv);

    // Bucket each row into our 9-cell strike-zone grid. Savant zones
    // 1..9 map directly to our indices 0..8 (catcher-perspective,
    // top-left = 1, bottom-right = 9). Drop 11..14 (shadow zones).
    //
    // For each zone we track multiple stats from the same pitch log so
    // the client's metric switcher can show different lenses without
    // any extra API calls:
    //
    //   pitches     — raw count of pitches in this zone (drives freq%)
    //   hrs         — HRs allowed in this zone (drives the ⚾ markers)
    //   swings      — pitches where the batter swung
    //   whiffs      — swings that missed (swinging strikes)
    //   contacts    — batted balls (BIP events)
    //   hardHits    — batted balls with EV >= 95 mph
    //   xwobaSum    — sum of estimated_woba_using_speedangle across BIPs
    //   xwobaCount  — # of BIPs with a valid xwOBA reading
    //
    // Derived rates: whiff%/swings, hardHit%/contacts, xwoba = sum/count.
    const stats = new Array(ZONE_N).fill(null).map(() => ({
      pitches: 0, hrs: 0, swings: 0, whiffs: 0,
      contacts: 0, hardHits: 0, xwobaSum: 0, xwobaCount: 0,
      evSum: 0, barrels: 0,
      // Batting line allowed, attributed to the zone of the PA-ending pitch.
      // These are intentionally sparse per cell (a pitcher allows few batted
      // balls per zone) — the client flags them as small-sample.
      ab: 0, hits: 0, tb: 0,
    }));
    let total = 0;

    // PA outcome → total bases (for SLG). Any other AB-ending outcome counts
    // toward AB only (AVG/SLG denominator). Walks/HBP/sacs are NOT at-bats and
    // are intentionally absent from both maps.
    const HIT_TB = { single: 1, double: 2, triple: 3, home_run: 4 };
    const OUT_AB = new Set([
      'strikeout', 'strikeout_double_play', 'field_out', 'force_out',
      'grounded_into_double_play', 'double_play', 'triple_play',
      'fielders_choice', 'fielders_choice_out', 'field_error',
    ]);

    // Savant `description` values that count as the batter SWUNG. Anything
    // resulting in a batted-ball event counts too (a hit/out IS a swing).
    const SWING_DESCS = new Set([
      'swinging_strike', 'swinging_strike_blocked',
      'foul', 'foul_tip', 'foul_bunt',
      'hit_into_play', 'hit_into_play_no_out', 'hit_into_play_score',
      'missed_bunt',
    ]);
    const WHIFF_DESCS = new Set([
      'swinging_strike', 'swinging_strike_blocked',
      'missed_bunt',
    ]);

    for (const r of rows) {
      const idx = zoneToIdx(parseInt(r.zone, 10));
      if (idx < 0) continue;
      const s = stats[idx];
      s.pitches++;
      total++;

      if (r.events === 'home_run') s.hrs++;

      // Batting line allowed (AVG/SLG/ISO). `events` is only set on the final
      // pitch of a PA, so each PA is counted once, in that pitch's zone.
      if (r.events && HIT_TB[r.events] != null) {
        s.hits++; s.tb += HIT_TB[r.events]; s.ab++;
      } else if (r.events && OUT_AB.has(r.events)) {
        s.ab++;
      }

      const desc = r.description || '';
      const hasEvent = r.events && r.events !== '' && r.events !== 'null';
      if (SWING_DESCS.has(desc) || hasEvent) s.swings++;
      if (WHIFF_DESCS.has(desc))             s.whiffs++;

      // Batted-ball-only metrics. hasEvent is the canonical "ball was
      // put in play" check; description alone doesn't capture every
      // contact path (e.g., a HR is `events=home_run` but the
      // description varies).
      if (hasEvent && r.events !== 'walk' && r.events !== 'hit_by_pitch'
                   && r.events !== 'strikeout' && r.events !== 'caught_stealing_3b') {
        const ev = parseFloat(r.launch_speed);
        if (Number.isFinite(ev)) {
          s.contacts++;
          s.evSum += ev;
          if (ev >= 95) s.hardHits++;
        }
        // Statcast barrel bucket (launch_speed_angle === 6).
        if (parseInt(r.launch_speed_angle, 10) === 6) s.barrels++;
        const xw = parseFloat(r.estimated_woba_using_speedangle);
        if (Number.isFinite(xw)) {
          s.xwobaSum   += xw;
          s.xwobaCount += 1;
        }
      }
    }

    const grid = stats.map((s) => ({
      freq:       total > 0 ? +(s.pitches / total).toFixed(4) : 0,
      count:      s.pitches,
      hrCount:    s.hrs,
      whiffPct:   s.swings   > 0 ? +(s.whiffs   / s.swings).toFixed(4)   : null,
      hardHitPct: s.contacts > 0 ? +(s.hardHits / s.contacts).toFixed(4) : null,
      barrelPct:  s.contacts > 0 ? +(s.barrels  / s.contacts).toFixed(4) : null,
      ev:         s.contacts > 0 ? +(s.evSum    / s.contacts).toFixed(1) : null,
      xwoba:      s.xwobaCount > 0 ? +(s.xwobaSum / s.xwobaCount).toFixed(3) : null,
      // Batting line allowed — sparse per zone; client flags small samples.
      avg:        s.ab > 0 ? +(s.hits / s.ab).toFixed(3) : null,
      slg:        s.ab > 0 ? +(s.tb / s.ab).toFixed(3) : null,
      iso:        s.ab > 0 ? +((s.tb - s.hits) / s.ab).toFixed(3) : null,
      abAllowed:  s.ab,
      contacts:   s.contacts,
    }));

    const out = { grid, samplePitches: total, season, hand: vsHand };
    _setCache(key, out);
    return out;
  } catch {
    _setCache(key, null);
    return null;
  }
}

/**
 * Tiny CSV parser tuned for Savant's output. Savant CSVs are well-formed
 * (header row + RFC-4180-ish quoting) but we don't pull in a full
 * dependency just for this. Returns an array of row objects keyed by
 * the header field names.
 */
function parseSavantCsv(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = cells[j];
    out.push(row);
  }
  return out;
}

function splitCsvLine(line) {
  // Naive but works for Savant — no embedded newlines in cells, quoted
  // strings only when commas appear inside. If Savant ever changes
  // format, swap this for `csv-parse` from npm.
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

// ─── Opener / bulk pitcher resolution ───────────────────────────────────

/**
 * Returns true if the given pitcher is most likely being used as an opener
 * (i.e., they "start" the game but only face the top of the order and hand
 * off after 1-2 innings). Detection: avg innings-per-start across their
 * last 5 starts is < 3.0 IP.
 *
 * The threshold is generous — a "true" opener averages ~1.0 IP, so 3.0
 * gives plenty of margin. Includes returning starters whose recent ramp-
 * up starts are short (e.g., post-IL rehab), which is acceptable noise:
 * the worst case is we predict a bulk pitcher for someone who's actually
 * back to throwing 6 IP, and the matchup we surface is slightly off.
 *
 * Returns `{ isOpener, recentAvgIP, recentStartsCount }` so callers can
 * decide how to handle low-confidence calls (e.g., < 3 recent starts).
 */
export async function isLikelyOpener(pitcherId, { season = SEASON } = {}) {
  const cacheKey = `opener-${pitcherId}-${season}`;
  if (_hasCache(cacheKey)) return _getCache(cacheKey);

  try {
    const url = `${MLB_BASE}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}`;
    const data = await getJson(url);
    const splits = data?.stats?.[0]?.splits || [];

    // Only count actual starts. Relief appearances skew the average down
    // and would mis-flag every reliever as an "opener."
    const starts = splits.filter(s => Number(s.stat?.gamesStarted) === 1);
    const recent = starts.slice(-5);

    if (recent.length === 0) {
      // No starts at all this season → not a starter, so not an opener
      // in the meaningful "we expected a starter but got a 1-inning guy"
      // sense. The caller can still decide what to do.
      const out = { isOpener: false, recentAvgIP: null, recentStartsCount: 0 };
      _setCache(cacheKey, out);
      return out;
    }

    const totalIP    = recent.reduce((a, s) => a + (+s.stat.inningsPitched || 0), 0);
    const avgIP      = totalIP / recent.length;
    const isOpener   = avgIP < 3.0;

    const out = { isOpener, recentAvgIP: +avgIP.toFixed(2), recentStartsCount: recent.length };
    _setCache(cacheKey, out);
    return out;
  } catch {
    const out = { isOpener: false, recentAvgIP: null, recentStartsCount: 0 };
    _setCache(cacheKey, out);
    return out;
  }
}

/**
 * Given an opener and their team, predict which pitcher will most likely
 * take over as the "bulk" (the long-relief arm who does the heavy lifting
 * after the opener's 1-2 innings).
 *
 * Strategy: look at this opener's last ~10 starts. For each, grab the
 * box score and find the pitcher who threw the MOST innings after them.
 * Aggregate counts. Return the most frequent bulk + a confidence score
 * (how often that same pitcher actually bulked).
 *
 *   confidence 1.0 = same bulk pitcher every time (predictable rotation)
 *   confidence 0.5 = bulk role rotates between 2 pitchers evenly
 *   confidence 0.0 = total noise / first opener appearance
 *
 * MLB API doesn't expose the bulk pitcher in any schedule field, so this
 * is the best signal we have without scraping beat reporters. ~70%
 * accurate for teams with stable opener-bulk pairings (TB, OAK, MIA);
 * less accurate for teams that mix and match.
 *
 * Returns null when we can't make a confident prediction — caller should
 * fall back to "show opener with warning" in that case.
 */
export async function resolveBulkPitcher(openerId, { season = SEASON, lookback = 10 } = {}) {
  const cacheKey = `bulk-${openerId}-${season}`;
  if (_hasCache(cacheKey)) return _getCache(cacheKey);

  try {
    // Find this pitcher's last N starts via gameLog.
    const logUrl = `${MLB_BASE}/people/${openerId}/stats?stats=gameLog&group=pitching&season=${season}`;
    const log = await getJson(logUrl);
    const starts = (log?.stats?.[0]?.splits || [])
      .filter(s => Number(s.stat?.gamesStarted) === 1)
      .slice(-lookback);

    if (starts.length === 0) {
      _setCache(cacheKey, null);
      return null;
    }

    // Resolve the opener's team id so we know which side of each box score
    // to read. gameLog splits include `team.id`.
    const teamId = starts[0]?.team?.id;
    if (!teamId) {
      _setCache(cacheKey, null);
      return null;
    }

    // For each prior start, pull the box score and find who threw the
    // most innings AFTER the opener. That's the bulk for that game.
    // Tally across all starts.
    const bulkTally = new Map();   // pitcherId → { name, count }

    await Promise.all(starts.map(async (start) => {
      const gpk = start?.game?.gamePk;
      if (!gpk) return;
      try {
        const box = await getJson(`${MLB_BASE}/game/${gpk}/boxscore`);
        const sideKey = box?.teams?.home?.team?.id === teamId ? 'home'
                      : box?.teams?.away?.team?.id === teamId ? 'away' : null;
        if (!sideKey) return;
        const team = box.teams[sideKey];

        // `team.pitchers` is an array of pitcher IDs in the order they
        // entered. The first should be the opener; we want whoever
        // followed and threw the most innings.
        const order = team.pitchers || [];
        const openerIdx = order.indexOf(openerId);
        if (openerIdx < 0) return;

        let bestBulk = null;
        let bestIP   = 0;
        for (let i = openerIdx + 1; i < order.length; i++) {
          const pid = order[i];
          const pdata = team.players['ID' + pid];
          const ip   = +pdata?.stats?.pitching?.inningsPitched || 0;
          if (ip > bestIP) {
            bestIP = ip;
            bestBulk = { id: pid, name: pdata.person.fullName };
          }
        }

        if (bestBulk && bestIP >= 2.0) {   // require real bulk effort, not 0.1 IP
          const existing = bulkTally.get(bestBulk.id) || { name: bestBulk.name, count: 0 };
          existing.count++;
          bulkTally.set(bestBulk.id, existing);
        }
      } catch {}
    }));

    if (bulkTally.size === 0) {
      _setCache(cacheKey, null);
      return null;
    }

    // Rank candidates by frequency. The top is our prediction; confidence
    // is its share of total bulk-eligible games.
    const totalGames = starts.length;
    const ranked = [...bulkTally.entries()]
      .map(([id, v]) => ({ id: +id, name: v.name, count: v.count, confidence: v.count / totalGames }))
      .sort((a, b) => b.count - a.count);

    const top = ranked[0];
    const out = {
      id:         top.id,
      name:       top.name,
      confidence: +top.confidence.toFixed(2),
      candidates: ranked.slice(0, 3),     // top 3 for UI to show "or X / Y"
      basis:      `${top.count}/${totalGames} recent opener games`,
    };
    _setCache(cacheKey, out);
    return out;
  } catch {
    _setCache(cacheKey, null);
    return null;
  }
}

// ─── Matchup logic ──────────────────────────────────────────────────────

/**
 * Pure function — given a batter grid and pitcher grid (both 9-cells),
 * compute matched zones + an overall zone-matchup rating.
 *
 * Matched zone = cell where the batter is in their HOT tier (top-third
 * by ISO) AND the pitcher throws ABOVE-AVERAGE frequency there. The
 * thresholds are deliberately gentle — over-tightening these makes the
 * "Zone Master" badge so rare it stops being useful. We want it to
 * trigger ~once or twice per slate, not once a week.
 *
 * Zone rating: weighted sum of (batter ISO × pitcher freq) across all
 * cells, normalized to a 0..10 scale where 5.0 is "league average
 * matchup, no edge in either direction." This is the visible "Zone
 * Rating X.X / 10" number from the reference screenshot.
 */
export function buildZoneMatchup(batter, pitcher, { minBIPPerCell = 5 } = {}) {
  if (!batter?.grid || !pitcher?.grid) return null;

  const bGrid = batter.grid;
  const pGrid = pitcher.grid;

  // ── Batter "hot cell" criterion ─────────────────────────────────────────
  // A cell qualifies as hot if it clears EITHER of two gates:
  //
  //   1. Per-player relative gate — cell ISO ≥ player's own mean ISO +
  //      0.25σ. Adapts to the batter's profile so a slap hitter with
  //      .080 league-wide can still surface their best zones. The 0.25σ
  //      (loosened from 0.5σ) admits cells that are noticeably above the
  //      batter's baseline without requiring an extreme peak.
  //
  //   2. League-absolute gate — cell ISO ≥ ABSOLUTE_HOT_ISO_FLOOR
  //      (0.200, which is well above the ~0.160 league average so true
  //      league-mean bats don't trigger it). This catches power hitters
  //      who are hot EVERYWHERE — Schwarber, Judge, Soto — whose flat,
  //      uniformly-elite zone profiles meant no individual cell cleared
  //      a pure per-player σ gate. The previous bug: a batter who's
  //      .250 in every cell has σ≈0, so 0.5σ above his own mean was
  //      still .250 — exactly the cell value — and would just barely
  //      qualify. Worse, players whose hot cells regressed slightly
  //      under the σ-spread cutoff would silently drop out of matched
  //      counts even though they're elite by absolute standards.
  //
  // The OR combination is intentional: each gate catches a class of
  // hitter the other misses. The pitcher-frequency gate (below) still
  // applies in the AND, so a cell only counts as "matched" when it
  // clears at least one hot gate AND the pitcher actually pitches there.
  const ABSOLUTE_HOT_ISO_FLOOR = 0.200;
  const validISOs = bGrid.map(c => c.iso).filter(v => Number.isFinite(v));
  const meanISO   = validISOs.reduce((a, b) => a + b, 0) / Math.max(1, validISOs.length);
  const varISO    = validISOs.reduce((s, v) => s + (v - meanISO) ** 2, 0) / Math.max(1, validISOs.length);
  const stdISO    = Math.sqrt(varISO);
  const hotISORel = meanISO + stdISO * 0.25;
  const isHotCell = (iso) => iso >= ABSOLUTE_HOT_ISO_FLOOR || iso >= hotISORel;

  // Pitcher's "above-average frequency" threshold = mean across cells.
  // Pitcher freqs sum to ~1.0 across the grid, so mean is roughly 0.111.
  const validFreqs = pGrid.map(c => c.freq).filter(v => Number.isFinite(v));
  const meanFreq   = validFreqs.reduce((a, b) => a + b, 0) / Math.max(1, validFreqs.length);
  const freqGate   = meanFreq;

  const matchedZones = [];
  // Location matchup accumulators. `num`/`fsum` build the pitcher-frequency-
  // weighted ISO (the damage the pitcher's LOCATIONS actually deliver to this
  // batter); `isoSum`/`n` build the uniform-location ISO (if he threw evenly).
  let num = 0, fsum = 0, isoSum = 0, n = 0;

  for (let i = 0; i < Math.min(bGrid.length, pGrid.length); i++) {
    const bCell = bGrid[i];
    const pCell = pGrid[i];
    const iso   = bCell?.iso;
    const freq  = pCell?.freq;

    // Skip cells that lack data or have a tiny batter sample (would be
    // noise dressed as signal). Most batters have at least 5 BIP per
    // strike-zone cell by late May, so this only filters the very
    // sparse cells.
    if (!Number.isFinite(iso) || !Number.isFinite(freq)) continue;
    if (bCell.count > 0 && bCell.count < minBIPPerCell) continue;

    num += iso * freq;
    fsum += freq;
    isoSum += iso;
    n++;

    if (isHotCell(iso) && freq >= freqGate) {
      matchedZones.push(i);
    }
  }

  // Zone (location) rating 0..10. RE-CALIBRATED 2026-07-09: the old formula
  // normalized against an unrealistic "40% into one cell" max, so real per-cell
  // frequency (~6%) pinned EVERY batter to ≤2.2/10 (≤1.1/5) — verified across
  // 540 live bats. Instead, measure whether the pitcher's LOCATION tilts toward
  // this batter's damage zones vs a neutral (uniform) baseline: 5 = neutral,
  // higher = he feeds the batter's hot zones, lower = he pitches away from them.
  // deliveredISO = ISO weighted by pitcher frequency; uniformISO = flat ISO.
  // Scaled (×100) so a real location edge spans the range (neutral ≈2.6/5,
  // strong ≈4.5/5). Display-only — not a model input.
  const delivered = fsum > 0 ? num / fsum : 0;
  const uniform   = n > 0 ? isoSum / n : 0;
  const zoneRating = (fsum > 0 && n > 0)
    ? +Math.max(0, Math.min(10, 5 + (delivered - uniform) * 100)).toFixed(1)
    : 0;

  const badge = matchedZones.length >= 2 ? 'ZONE_MASTER' : null;

  return {
    batter:       { id: batter.id ?? null, hand: batter.hand, grid: bGrid, sampleBIP: batter.sampleBIP || 0, season: batter.season },
    pitcher:      { id: pitcher.id ?? null, hand: pitcher.hand, grid: pGrid, samplePitches: pitcher.samplePitches || 0, season: pitcher.season },
    matchedZones,
    zoneRating,
    badge,
    asOf:         new Date().toISOString(),
  };
}

// ─── High-level wrapper ─────────────────────────────────────────────────

/**
 * One-call API used by the cron: given a batter and the OPPOSING TEAM's
 * scheduled probable pitcher, returns a complete zone-matchup payload —
 * including opener/bulk detection, bulk resolution, and the right
 * pitcher's zones threaded through `buildZoneMatchup`.
 *
 * @param {object} args
 * @param {number} args.batterId
 * @param {'L'|'R'} args.batterHand   batter's own stance
 * @param {number} args.probablePitcherId
 * @param {'L'|'R'} args.probablePitcherHand
 * @param {(pid: number) => Promise<'L'|'R'|null>} [args.resolvePitcherHand]
 *        optional callback to look up the bulk pitcher's hand. Required
 *        for opener games — the bulk pitcher's hand may differ from the
 *        opener's, and we need the right hand for the batter zone split.
 *        If omitted, we assume the bulk pitcher shares the opener's hand
 *        (acceptable noise — most teams pair like-handed openers/bulks).
 *
 * @returns {Promise<Matchup | null>}
 *
 * Matchup payload extends the buildZoneMatchup result with:
 *
 *   opener:        { id, name, recentAvgIP } | null
 *   bulk:          { id, name, confidence, candidates } | null
 *   matchupAgainst: 'starter' | 'bulk' | 'opener-no-bulk'
 *
 * If matchupAgainst === 'opener-no-bulk', no reliable bulk was found —
 * UI should show the opener's zones with a "Bulk TBD" warning.
 */
export async function buildZoneMatchupForGame({
  batterId,
  batterHand,
  probablePitcherId,
  probablePitcherHand,
  resolvePitcherHand,
}) {
  if (!batterId || !probablePitcherId) return null;

  // 1. Probe opener status
  const opener = await isLikelyOpener(probablePitcherId);

  let targetPitcherId   = probablePitcherId;
  let targetPitcherHand = probablePitcherHand;
  let bulkInfo          = null;
  let matchupAgainst    = 'starter';

  // 2. If opener, try to resolve the bulk pitcher
  if (opener.isOpener) {
    bulkInfo = await resolveBulkPitcher(probablePitcherId);
    if (bulkInfo?.id) {
      targetPitcherId = bulkInfo.id;
      // Resolve bulk pitcher's hand if a resolver was provided. We need
      // the correct hand for the batter's vs-hand zone split — using
      // the opener's hand here would mis-split when opener/bulk are
      // opposite-handed (e.g., LHP opener → RHP bulk).
      if (resolvePitcherHand) {
        const resolvedHand = await resolvePitcherHand(bulkInfo.id);
        if (resolvedHand) targetPitcherHand = resolvedHand;
      }
      matchupAgainst = 'bulk';
    } else {
      // Opener detected but no bulk prediction available. Fall back to
      // opener-only matchup, with a flag the UI can use to warn.
      matchupAgainst = 'opener-no-bulk';
    }
  }

  // 3. Fetch zones for the target pitcher (bulk if available, else opener
  //    or normal starter) and the batter split by pitcher hand.
  const [batterZones, pitcherZones] = await Promise.all([
    fetchBatterZones(batterId,        { vsHand: targetPitcherHand }),
    fetchPitcherZones(targetPitcherId, { vsHand: batterHand }),
  ]);

  if (!batterZones || !pitcherZones) return null;

  // 4. Build the matchup with the right pitcher's zones
  const matchup = buildZoneMatchup(
    { ...batterZones,  id: batterId },
    { ...pitcherZones, id: targetPitcherId },
  );

  if (!matchup) return null;

  // 5. Enrich with opener/bulk metadata
  return {
    ...matchup,
    opener: opener.isOpener
              ? { id: probablePitcherId, recentAvgIP: opener.recentAvgIP }
              : null,
    bulk: bulkInfo
            ? { id: bulkInfo.id, name: bulkInfo.name, confidence: bulkInfo.confidence, candidates: bulkInfo.candidates }
            : null,
    matchupAgainst,
  };
}

// ─── CLI test harness ────────────────────────────────────────────────────
//
// Run manually for ad-hoc verification:
//
//   node server/fetch-zone-matchup.mjs --batter=683734 --pitcher=607200 --hand=R
//
// Prints the matchup JSON so you can compare against Savant / rude-bets
// directly. If a fetch returns null, the matching API endpoint failed —
// check the URL by hand to see what shape Savant or the MLB API actually
// returned (their endpoints occasionally drift).

// CLI detection that works across platforms — compare resolved file paths
// instead of trying to reconstruct file:// URLs (Windows uses `file:///C:/`
// with three slashes, POSIX uses `file:///foo` with three slashes too, but
// the path part after needs OS-specific normalization). Easier to just
// strip both down to a normal path and compare.
const isCli = (() => {
  if (!process.argv[1]) return false;
  const metaPath = decodeURIComponent(import.meta.url.replace(/^file:\/+/, '/'))
    .replace(/^\/([A-Za-z]):/, '$1:')   // /C:/foo → C:/foo on Windows
    .replace(/\\/g, '/');
  const argvPath = process.argv[1].replace(/\\/g, '/');
  return metaPath === argvPath;
})();
if (isCli) {
  const args = Object.fromEntries(
    process.argv.slice(2).map(a => a.replace(/^--/, '').split('='))
  );
  const batterId  = Number(args.batter);
  const pitcherId = Number(args.pitcher);
  const hand      = args.hand || 'R';     // pitcher hand for batter split

  if (!pitcherId) {
    console.error('Usage:');
    console.error('  node server/fetch-zone-matchup.mjs --pitcher=ID                # opener probe only');
    console.error('  node server/fetch-zone-matchup.mjs --batter=ID --pitcher=ID [--hand=R|L]');
    process.exit(1);
  }

  // Always probe opener status first — it informs the matchup target.
  const opener = await isLikelyOpener(pitcherId);
  console.log('Opener probe:', JSON.stringify(opener, null, 2));

  if (opener.isOpener) {
    const bulk = await resolveBulkPitcher(pitcherId);
    console.log('Predicted bulk:', JSON.stringify(bulk, null, 2));
  }

  if (!batterId) {
    process.exit(0);    // pitcher-only probe mode, we're done
  }

  const [batterGrid, pitcherGrid] = await Promise.all([
    fetchBatterZones(batterId,   { vsHand: hand }),
    fetchPitcherZones(pitcherId, { vsHand: 'R' }),   // assume RHB looking up vs this pitcher
  ]);

  console.log('Batter:',  JSON.stringify(batterGrid, null, 2));
  console.log('Pitcher:', JSON.stringify(pitcherGrid, null, 2));

  if (batterGrid && pitcherGrid) {
    const matchup = buildZoneMatchup(
      { ...batterGrid, id: batterId },
      { ...pitcherGrid, id: pitcherId },
    );
    console.log('Matchup:', JSON.stringify(matchup, null, 2));
  } else {
    console.warn('One or both fetches returned null — check API URLs above.');
  }
}
