/**
 * MLBService — live data fetcher for StatFax
 *
 * Data sources:
 *   MLB Stats API  → statsapi.mlb.com (no auth required)
 *   WeatherAPI.com → direct call from mobile (no CORS restriction)
 */

const MLB_BASE    = 'https://statsapi.mlb.com/api/v1';
const MLB_BASE_V11 = 'https://statsapi.mlb.com/api/v1.1';

// Dynamically use current MLB season year
const SEASON = new Date().getFullYear();

// ---------- helpers ----------

async function mlbGet(path) {
  const res = await fetch(`${MLB_BASE}${path}`);
  if (!res.ok) throw new Error(`MLB API ${res.status}: ${path}`);
  return res.json();
}

// Browser-like headers for all Baseball Savant requests.
// Savant uses Cloudflare; without these it may return an HTML challenge page
// even with a 200 status. These mimic Safari on iPhone.
const SAVANT_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://baseballsavant.mlb.com/',
  'Origin':          'https://baseballsavant.mlb.com',
};

/**
 * Fetch a Baseball Savant JSON endpoint.
 * Validates the body is actual JSON (not an HTML redirect/challenge page).
 * Returns parsed JSON on success, null on any failure.
 */
async function savantGet(url) {
  const res = await fetch(url, { headers: SAVANT_HEADERS });
  if (!res.ok) return null;
  const raw = await res.text();
  // Strip UTF-8 BOM (﻿) that some responses include, then trim whitespace
  const text = raw.replace(/^﻿/, '').trimStart();
  // Bail out early if it's an HTML page (Cloudflare challenge, redirect, etc.)
  if (!text.startsWith('[') && !text.startsWith('{')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Fetch a Baseball Savant CSV download endpoint.
 * These "Download CSV" links have more permissive Cloudflare rules than the
 * internal JSON API endpoints — they're designed for direct download.
 * Returns an array of row-objects (header → value), empty array on failure.
 */
async function savantCSV(url) {
  try {
    const res = await fetch(url, {
      headers: { ...SAVANT_HEADERS, Accept: 'text/csv, text/plain, */*' },
    });
    if (!res.ok) return [];
    const raw = await res.text();
    const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    // Must look like CSV (first char is a letter or quote — not HTML '<' or '{')
    if (!text || text.startsWith('<') || text.startsWith('{')) return [];

    const lines = text.split('\n');
    if (lines.length < 2) return [];

    // Parse a single CSV line, handling quoted fields that may contain commas
    const parseRow = (line) => {
      const vals = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          // Escaped quote inside a quoted field
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (c === ',' && !inQ) {
          vals.push(cur); cur = '';
        } else {
          cur += c;
        }
      }
      vals.push(cur);
      return vals;
    };

    const headers = parseRow(lines[0]);
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = parseRow(line);
      const obj  = {};
      headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? '').trim(); });
      return obj;
    });
  } catch {
    return [];
  }
}

function safeFloat(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

/**
 * MLB-style innings-pitched strings ("5.2" = 5⅔ innings, "6.1" = 6⅓) need
 * baseball-math, NOT decimal-math. parseFloat("5.2") returns 5.2, which is
 * 0.467 IP short of reality. Summing partial innings across multiple starts
 * compounds the error: 5.2+6.1+4.2+5.0+6.1 decimally = 26.6, baseball = 28.0.
 * That bias makes recent-form ERA/HR9 read ~5% high for almost every pitcher.
 */
function parseIP(val) {
  const s = String(val ?? '').trim();
  if (!s) return 0;
  const [whole, third] = s.split('.');
  const w = parseInt(whole, 10);
  const t = parseInt(third ?? '0', 10);
  if (isNaN(w)) return 0;
  // MLB uses .1 = 1 out, .2 = 2 outs. Anything else (decimals from another
  // source?) gets treated as a normal decimal fraction so we don't crash.
  const fraction = (t === 1 || t === 2) ? t / 3 : (isNaN(t) ? 0 : t / 10);
  return w + fraction;
}

// ─── Day-scoped Savant cache ──────────────────────────────────────────────────
// League-wide Savant CSVs/JSON (5-8 MB total) change at most once per day, but
// we were re-downloading them on EVERY slate refresh, every live-rankings tick,
// and every PitcherVulnerability visit. This wraps each getter in a memoized
// "first call today wins" cache. Keyed by the function name + year so multiple
// concurrent callers share one in-flight promise.
const _savantCache = new Map();  // key: `${fnName}-${year}` → { day, value }
const _savantInflight = new Map();  // key → Promise resolving to value
function _todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function _cachedSavant(key, fetchFn) {
  const today = _todayKey();
  const hit = _savantCache.get(key);
  if (hit && hit.day === today) return hit.value;
  // De-dupe concurrent callers waiting on the same fetch
  if (_savantInflight.has(key)) return _savantInflight.get(key);
  const promise = (async () => {
    try {
      const value = await fetchFn();
      _savantCache.set(key, { day: today, value });
      return value;
    } finally {
      _savantInflight.delete(key);
    }
  })();
  _savantInflight.set(key, promise);
  return promise;
}

function parseStat(stat = {}) {
  const avg  = safeFloat(stat.avg);
  const slg  = safeFloat(stat.slg);
  const ab   = stat.atBats   || 0;
  const hr   = stat.homeRuns || 0;
  const pa   = stat.plateAppearances || ab || 1;
  const iso  = slg - avg;
  const hrRate = ab > 0 ? hr / ab : 0;
  return { avg, slg, ab, hr, pa, iso, hrRate };
}

// ---------- public API ----------

export const MLBService = {

  /**
   * Get today's game schedule with team + venue + probable pitchers.
   * Returns an array of game objects.
   */
  async getSchedule(date) {
    const data = await mlbGet(
      `/schedule?sportId=1&date=${date}&hydrate=team,venue,probablePitcher,linescore`
    );
    const games = [];
    for (const dateEntry of data.dates || []) {
      for (const g of dateEntry.games || []) {
        const state = g.status?.abstractGameState;
        if (state === 'Final') continue; // skip completed games
        games.push({
          gamePk:         g.gamePk,
          gameDate:       g.gameDate,
          isLive:         state === 'Live',
          currentInning:  g.linescore?.currentInning ?? null,   // null = not started
          inningHalf:     g.linescore?.inningHalf    ?? null,   // 'Top' | 'Bottom'
          awayTeam:    {
            id:   g.teams.away.team.id,
            name: g.teams.away.team.name,
            abbr: g.teams.away.team.abbreviation,
          },
          homeTeam:    {
            id:   g.teams.home.team.id,
            name: g.teams.home.team.name,
            abbr: g.teams.home.team.abbreviation,
          },
          venueName:   g.venue?.name || '',
          venueId:     g.venue?.id,
          awayPitcher: g.teams.away.probablePitcher
            ? { id: g.teams.away.probablePitcher.id, name: g.teams.away.probablePitcher.fullName }
            : null,
          homePitcher: g.teams.home.probablePitcher
            ? { id: g.teams.home.probablePitcher.id, name: g.teams.home.probablePitcher.fullName }
            : null,
        });
      }
    }
    return games;
  },

  /**
   * Get confirmed lineups for a game.
   *
   * Strategy:
   *   1. Schedule hydration (hydrate=lineups) — works ~40 min before first pitch
   *   2. Boxscore battingOrder — reliable for live/completed games where the
   *      schedule hydration no longer populates the lineups object
   *
   * Returns { away: [playerId, ...], home: [playerId, ...] } or null.
   */
  async getLineups(gamePk) {
    // ── Pass 1: schedule lineup hydration (pre-game) ──────────────────────────
    try {
      const data = await mlbGet(`/schedule?sportId=1&gamePk=${gamePk}&hydrate=lineups`);
      const game = data.dates?.[0]?.games?.[0];
      if (game?.lineups) {
        const awayIds = (game.lineups.awayPlayers || []).map(p => p.id ?? p).filter(Number.isInteger);
        const homeIds = (game.lineups.homePlayers || []).map(p => p.id ?? p).filter(Number.isInteger);
        if (awayIds.length || homeIds.length) return { away: awayIds, home: homeIds };
      }
    } catch {}

    // ── Pass 2: boxscore batting order (live & completed games) ──────────────
    // battingOrder can be an array of bare integer IDs *or* player objects
    try {
      const bs = await mlbGet(`/game/${gamePk}/boxscore`);
      const normalize = arr =>
        (arr || []).map(p => (typeof p === 'object' ? p.id : p)).filter(Boolean);
      const away = normalize(bs.teams?.away?.battingOrder);
      const home = normalize(bs.teams?.home?.battingOrder);
      if (away.length || home.length) return { away, home };
    } catch {}

    return null;
  },

  /**
   * Get the active roster for a team, filtered to position players (no pitchers).
   * Returns an array of { id, name, batSide } objects.
   */
  async getActiveBatters(teamId) {
    const data = await mlbGet(`/teams/${teamId}/roster/active`);
    return (data.roster || [])
      .filter(p => p.position?.type !== 'Pitcher')
      .map(p => ({
        id:      p.person.id,
        name:    p.person.fullName,
        batSide: p.person.batSide?.code || 'R',
      }));
  },

  /**
   * Batch fetch season + recent (last 15 games) hitting stats for a list of batter IDs.
   * Returns a Map<playerId, { name, batSide, season, recent }>.
   *
   * Chunks requests to stay under URL length limits (max 50 IDs per call).
   */
  async getBatterStatsBatch(playerIds) {
    const result = new Map();
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += 50) {
      chunks.push(playerIds.slice(i, i + 50));
    }

    // Parallelize chunks — was a sequential `for (const chunk of chunks)`
    // loop which serialized ~6 round-trips per slate refresh. Each chunk is
    // an independent /people batch and can fire concurrently. Same pattern
    // applied to the 5 other batch endpoints below.
    await Promise.all(chunks.map(async chunk => {
      try {
        const ids = chunk.join(',');
        const data = await mlbGet(
          `/people?personIds=${ids}` +
          `&hydrate=stats(group=[hitting],type=[season,lastXGames],season=${SEASON},gameType=[R],limit=15)`
        );
        for (const person of data.people || []) {
          let season = null;
          let recent = null;
          for (const statGroup of person.stats || []) {
            const splits = statGroup.splits || [];
            if (!splits.length) continue;
            const raw = splits[splits.length - 1].stat;
            const parsed = parseStat(raw);
            const typeName = statGroup.type?.displayName?.toLowerCase() || '';
            if (typeName === 'season')     season = parsed;
            if (typeName === 'lastxgames') recent = parsed;
          }
          if (season) {
            result.set(person.id, {
              id:      person.id,
              name:    person.fullName,
              batSide: person.batSide?.code || 'R',
              season,
              recent: recent || season,
            });
          }
        }
      } catch (e) {
        if (__DEV__) console.warn('getBatterStatsBatch chunk error:', e.message);
      }
    }));
    return result;
  },

  /**
   * Fetch hitting stats for a single player across three recent-game windows
   * (last 7, 15, and 30 games) in parallel.
   * Returns { w7, w15, w30 } — each is { avg, slg, ab, hr, pa } or null.
   */
  async getPlayerWindowStats(playerId) {
    const fetchWindow = async (limit) => {
      try {
        const data = await mlbGet(
          `/people?personIds=${playerId}` +
          `&hydrate=stats(group=[hitting],type=[lastXGames],season=${SEASON},gameType=[R],limit=${limit})`
        );
        const person     = (data.people || [])[0];
        const statGroup  = (person?.stats || []).find(
          s => s.type?.displayName?.toLowerCase() === 'lastxgames'
        );
        const splits = statGroup?.splits || [];
        if (!splits.length) return null;
        return parseStat(splits[splits.length - 1].stat);
      } catch {
        return null;
      }
    };

    const [w7, w15, w30] = await Promise.all([
      fetchWindow(7),
      fetchWindow(15),
      fetchWindow(30),
    ]);
    return { w7, w15, w30 };
  },

  /**
   * Get a pitcher's season stats (ERA, HR/9, IP, HR allowed).
   * Returns { era, hrPer9, inningsPitched, homeRunsAllowed } or null.
   */
  async getPitcherSeasonStats(pitcherId) {
    try {
      const data = await mlbGet(
        `/people/${pitcherId}/stats?stats=season&group=pitching&season=${SEASON}&gameType=R`
      );
      const splits = data.stats?.[0]?.splits || [];
      if (!splits.length) return null;
      const s  = splits[splits.length - 1].stat;
      const ip = parseIP(s.inningsPitched);
      const hrAllowed = parseInt(s.homeRuns, 10) || 0;
      // MLB API's homeRunsPer9Inn is often "0.00" or "-.--" early in the season
      // even when HR count is non-zero. Always compute it from raw counts instead.
      const hrPer9 = ip > 0 ? (hrAllowed * 9) / ip : 0;
      return {
        era:              safeFloat(s.era),
        hrPer9,
        kPer9:            safeFloat(s.strikeoutsPer9Inn),
        whip:             safeFloat(s.whip),
        bb9:              safeFloat(s.walksPer9Inn),
        inningsPitched:   ip,
        homeRunsAllowed:  hrAllowed,
      };
    } catch {
      return null;
    }
  },

  /**
   * Get a pitcher's splits vs RHB ('vr') and vs LHB ('vl').
   * Returns { vsR: { hrPer9, era }, vsL: { hrPer9, era } } or null.
   */
  async getPitcherSplits(pitcherId) {
    try {
      const data = await mlbGet(
        `/people/${pitcherId}/stats?stats=statSplits&group=pitching` +
        `&sitCodes=vr,vl&season=${SEASON}&gameType=R`
      );
      const splits = data.stats?.[0]?.splits || [];
      const result = { vsR: null, vsL: null };
      for (const s of splits) {
        const code = s.split?.code;
        const stat = s.stat || {};
        const ip   = parseIP(stat.inningsPitched);
        const hr   = parseInt(stat.homeRuns, 10) || 0;
        // Same fix: compute from raw counts, not the pre-computed rate field
        const hrPer9 = ip > 0 ? (hr * 9) / ip : 0;
        const parsed = {
          hrPer9,
          era:  safeFloat(stat.era),
          kPer9: safeFloat(stat.strikeoutsPer9Inn),
          whip:  safeFloat(stat.whip),
          ip,   // sample size for split blending
        };
        if (code === 'vr') result.vsR = parsed;
        if (code === 'vl') result.vsL = parsed;
      }
      return (result.vsR || result.vsL) ? result : null;
    } catch {
      return null;
    }
  },

  // getWeather() was removed in the weather rewrite. Client-side weather
  // fetching is gone — every device reads weatherByGame from the shared
  // snapshot (cron pulls Open-Meteo hourly forecasts; see server/weather.mjs).

  /**
   * Fetch a player's hitting stats for a specific season (default: previous year).
   * Returns { avg, slg, ab, hr, pa, iso, hrRate } or null.
   */
  async getPlayerPrevSeasonStats(playerId, season = SEASON - 1) {
    try {
      const data = await mlbGet(
        `/people/${playerId}/stats?stats=season&group=hitting&season=${season}&gameType=R`
      );
      const splits = data.stats?.[0]?.splits || [];
      if (!splits.length) return null;
      const raw    = splits[splits.length - 1].stat;
      const parsed = parseStat(raw);
      const iso    = Math.max(0, parsed.slg - parsed.avg);
      const hrRate = parsed.ab ? parsed.hr / parsed.ab : 0;
      return { ...parsed, iso, hrRate, season };
    } catch {
      return null;
    }
  },

  /**
   * Fetch Statcast percentile data for all qualified batters from Baseball Savant.
   * Returns a Map<playerId, { exitVelo, hardHitPct, barrelPct, whiffPct,
   *                           launchAngle, pullPct, izContactPct, xSlg }>.
   *
   * Key additions:
   *   launchAngle   — avg launch angle; 18-28° is the HR-optimal band
   *   pullPct       — pull rate; high pull hitters target the short porch more
   *   izContactPct  — in-zone contact rate; high = solid contact more likely
   *   xSlg          — expected slugging; Statcast's power prediction independent of luck
   */
  async getSavantBatterStats(year = new Date().getFullYear()) {
    return _cachedSavant(`savant-batter-${year}`, async () => {
      const pf = v => (v != null && v !== '' ? parseFloat(v) : null);

      // ── Pass 1: JSON percentile-rankings endpoint ─────────────────────────────
      try {
        const data = await savantGet(
          `https://baseballsavant.mlb.com/percentile-rankings?type=batter&year=${year}`
        );
        if (Array.isArray(data) && data.length > 0) {
          const map = new Map();
          for (const p of data) {
            if (!p.player_id) continue;
            map.set(Number(p.player_id), {
              exitVelo:     pf(p.avg_hit_speed),
              hardHitPct:   pf(p.hard_hit_percent),
              barrelPct:    pf(p.brl_pa),
              whiffPct:     pf(p.whiff_percent),
              launchAngle:  pf(p.launch_angle_avg),
              pullPct:      pf(p.pull_percent),
              izContactPct: pf(p.iz_contact_percent),
              xSlg:         pf(p.xslg),
            });
          }
          return map;
        }
      } catch {}

      // ── Pass 2: CSV leaderboard endpoints (download links, less restricted) ───
      // Fetch contact-quality and expected-stats CSVs in parallel.
      try {
        const [statRows, xRows] = await Promise.all([
          savantCSV(`https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${year}&position=&team=&min=q&csv=true`),
          savantCSV(`https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=q&csv=true`),
        ]);
        if (!statRows.length && !xRows.length) return new Map();

        const map = new Map();

        for (const p of statRows) {
          const id = Number(p.player_id);
          if (!id) continue;
          const pa       = parseFloat(p.pa)       || 1;
          const attempts = parseFloat(p.attempts) || pa;  // BIP attempts for HH%
          const whiffs   = parseFloat(p.whiffs)   || 0;
          const swings   = parseFloat(p.swing)    || 0;
          map.set(id, {
            exitVelo:    pf(p.avg_hit_speed),
            hardHitPct:  p.hard_hit_percent ? pf(p.hard_hit_percent)
                       : p.hard_hit        ? (parseFloat(p.hard_hit) / attempts) * 100
                       : null,
            barrelPct:   p.brl_pa   ? pf(p.brl_pa)
                       : p.barreled ? (parseFloat(p.barreled) / pa) * 100
                       : null,
            launchAngle: pf(p.avg_launch_angle),
            whiffPct:    p.whiff_percent ? pf(p.whiff_percent)
                       : swings > 0     ? (whiffs / swings) * 100
                       : null,
            pullPct:     pf(p.pull_percent) ?? null,
            izContactPct: pf(p.iz_contact_percent) ?? null,
            xSlg:        null,  // from xstats endpoint below
          });
        }

        // Merge in expected SLG from the xstats CSV
        for (const p of xRows) {
          const id  = Number(p.player_id);
          if (!id) continue;
          const xSlg = pf(p.est_slg);
          const existing = map.get(id);
          if (existing) {
            existing.xSlg = xSlg;
          } else {
            map.set(id, {
              exitVelo: null, hardHitPct: null, barrelPct: null,
              launchAngle: null, whiffPct: null, pullPct: null,
              izContactPct: null, xSlg,
            });
          }
        }

        return map;
      } catch {
        return new Map();
      }
    });
  },

  /**
   * Fetch Statcast contact-quality + zone data for all qualified pitchers.
   * Returns a Map<pitcherId, { hardHitPctAllowed, barrelPctAllowed, exitVeloAgainst,
   *                            whiffPct, zonePct, heartPct, outZonePct, edgePct }>.
   *
   * Zone fields:
   *   zonePct     — % of pitches thrown in the strike zone
   *   heartPct    — % thrown in the "heart" of the plate (easiest to square up, most HRs)
   *   outZonePct  — % thrown outside the zone entirely (harder to do damage, but walks)
   *   edgePct     — % on the black (hardest to hit well; elite location)
   *
   * High zonePct + high heartPct + high barrelPctAllowed = pitcher living in the
   * middle of the plate and getting punished for it → strong HR-prone signal.
   */
  async getSavantPitcherStats(year = new Date().getFullYear()) {
    return _cachedSavant(`savant-pitcher-${year}`, async () => {
      const pf = v => (v != null && v !== '' ? parseFloat(v) : null);

      // ── Pass 1: JSON percentile-rankings endpoint ─────────────────────────────
      try {
        const data = await savantGet(
          `https://baseballsavant.mlb.com/percentile-rankings?type=pitcher&year=${year}`
        );
        if (Array.isArray(data) && data.length > 0) {
          const map = new Map();
          for (const p of data) {
            if (!p.player_id) continue;
            map.set(Number(p.player_id), {
              hardHitPctAllowed: pf(p.hard_hit_percent),
              barrelPctAllowed:  pf(p.brl_pa),
              exitVeloAgainst:   pf(p.avg_hit_speed),
              whiffPct:          pf(p.whiff_percent),
              zonePct:           pf(p.zone_percent),
              heartPct:          pf(p.meatball_percent) ?? pf(p.heart_percent),
              outZonePct:        pf(p.out_zone_percent),
              edgePct:           pf(p.edge_percent),
            });
          }
          return map;
        }
      } catch {}

      // ── Pass 2: CSV statcast leaderboard for pitchers ─────────────────────────
      try {
        const rows = await savantCSV(
          `https://baseballsavant.mlb.com/leaderboard/statcast?type=pitcher&year=${year}&position=&team=&min=q&csv=true`
        );
        if (!rows.length) return new Map();
        const map = new Map();
        for (const p of rows) {
          const id = Number(p.player_id);
          if (!id) continue;
          const pa       = parseFloat(p.pa)       || 1;
          const attempts = parseFloat(p.attempts) || pa;
          map.set(id, {
            // Statcast CSV exposes Hard Hit% as `ev95percent` (% of batted
            // balls >= 95 mph). There is NO `hard_hit_percent` column on this
            // endpoint, so the old read was always null → "—". The pitcher
            // percentile-rankings endpoint (pass 1) 404s, so this CSV path is
            // what actually runs. Prefer ev95percent; keep legacy names as
            // fallbacks in case the schema ever changes.
            hardHitPctAllowed: pf(p.ev95percent)
                             ?? (p.hard_hit_percent ? pf(p.hard_hit_percent)
                             :   p.hard_hit         ? (parseFloat(p.hard_hit) / attempts) * 100
                             :   null),
            barrelPctAllowed:  p.brl_pa   ? pf(p.brl_pa)
                             : p.barreled ? (parseFloat(p.barreled) / pa) * 100
                             : null,
            exitVeloAgainst:   pf(p.avg_hit_speed),
            whiffPct:          pf(p.whiff_percent) ?? null,
            zonePct:           pf(p.zone_percent)  ?? null,
            heartPct:          pf(p.meatball_percent) ?? pf(p.heart_percent) ?? null,
            outZonePct:        pf(p.out_zone_percent) ?? null,
            edgePct:           pf(p.edge_percent)     ?? null,
          });
        }
        return map;
      } catch {
        return new Map();
      }
    });
  },

  /**
   * Fetch the real pitch arsenal for every qualified pitcher from Baseball Savant.
   * Returns a Map<pitcherId, PitchMix> where PitchMix = {
   *   fastballPct,   breakingPct,   offspeedPct,   // grouped usage %
   *   ffPct, siPct, fcPct,                          // individual fastball types
   *   slPct, cuPct, kcPct,                          // breaking balls
   *   chPct, fsPct,                                 // offspeed
   *   fastballRunVal,  // run value on fastballs — positive = hitters winning on FBs
   *   breakingRunVal,  // run value on breaking balls
   *   offspeedRunVal,  // run value on offspeed
   *   totalRunVal,     // weighted sum across all pitches
   *   worstPitch,      // name of the pitch getting crushed most (highest positive RV)
   * }
   *
   * Run value convention (Baseball Savant):
   *   Positive = hitters are benefiting from that pitch (pitcher is getting hurt)
   *   Negative = pitcher is dominating on that pitch
   *
   * Key scoring insight:
   *   A pitcher with high fastballPct (>55%) AND positive fastballRunVal is being
   *   exploited on his primary weapon — power hitters will especially punish this.
   */
  async getSavantPitcherPitchMix(year = new Date().getFullYear()) {
    return _cachedSavant(`savant-pitcher-mix-${year}`, async () => {
      try {
        // pitch-arsenal-stats CSV: usage + run value + whiff per player per
        // pitch type. (The old /pitch-arsenals page only carries movement, so
        // ff_pct / ff_run_value were null and this whole map came back empty.)
        // LONG format → group by player_id, pivot pitch_type into the wide shape.
        const rows = await savantCSV(
          `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&pitchType=&year=${year}&team=&min=10&csv=true`
        );
        if (!rows.length) return new Map();
        const pf = (v) => (v != null && v !== '' ? parseFloat(v) : null);
        const PT_KEY = { FF: 'ff', SI: 'si', FC: 'fc', SL: 'sl', CU: 'cu', KC: 'kc', CH: 'ch', FS: 'fs' };
        const bucketOf = (pt) =>
          ['FF', 'SI', 'FC', 'FA'].includes(pt)               ? 'fastball'
          : ['CH', 'FS', 'FO', 'SC', 'KN', 'EP'].includes(pt) ? 'offspeed'
          : 'breaking';
        const byId = new Map();
        for (const r of rows) { const id = Number(r.player_id); if (!id) continue; if (!byId.has(id)) byId.set(id, []); byId.get(id).push(r); }

        const map = new Map();
        for (const [id, prs] of byId) {
          const pct = {}, rv100 = {};
          let fastballPct = 0, breakingPct = 0, offspeedPct = 0, rvNum = 0, rvDen = 0;
          const all = [];
          for (const r of prs) {
            const pt    = (r.pitch_type || '').toUpperCase();
            const usage = pf(r.pitch_usage) ?? 0;   // season usage %
            const rv    = pf(r.run_value_per_100);   // + = hitters winning
            const key = PT_KEY[pt];
            if (key) { pct[key] = usage; rv100[key] = rv; }
            const b = bucketOf(pt);
            if      (b === 'fastball') fastballPct += usage;
            else if (b === 'breaking') breakingPct += usage;
            else                       offspeedPct += usage;
            if (rv != null) { rvNum += rv * usage; rvDen += usage; }
            all.push({ name: r.pitch_name || pt, rv, usage });
          }
          const ranked = all.filter(p => p.rv != null && p.usage >= 5).sort((a, b) => b.rv - a.rv);
          const worstPitch = ranked.length ? { name: ranked[0].name, rv: ranked[0].rv } : null;
          const wAvg = (ks) => { let n = 0, d = 0; for (const k of ks) { if (rv100[k] != null && pct[k]) { n += rv100[k] * pct[k]; d += pct[k]; } } return d ? n / d : null; };

          map.set(id, {
            fastballPct, breakingPct, offspeedPct,
            ffPct: pct.ff ?? 0, siPct: pct.si ?? 0, fcPct: pct.fc ?? 0, slPct: pct.sl ?? 0,
            cuPct: pct.cu ?? 0, kcPct: pct.kc ?? 0, chPct: pct.ch ?? 0, fsPct: pct.fs ?? 0,
            fastballRunVal: wAvg(['ff', 'si', 'fc']),
            breakingRunVal: wAvg(['sl', 'cu', 'kc']),
            offspeedRunVal: wAvg(['ch', 'fs']),
            totalRunVal: rvDen ? rvNum / rvDen : 0,
            worstPitch,
            shape: null,  // movement not in this CSV; modal uses the snapshot's
          });
        }

        return map;
      } catch {
        return new Map();
      }
    });
  },

  /**
   * Fetch each batter's performance by pitch type from Baseball Savant.
   * Returns Map<batterId, BatterArsenal> with SLG against each pitch category +
   * which pitch type they CRUSH vs which they STRUGGLE against.
   *
   * Lets us cross-reference pitcher's arsenal vs batter strengths/weaknesses:
   *   if pitcher throws 60% FB and batter slugs .700 vs FB → big edge
   *   if pitcher throws 35% sliders and batter slugs .200 vs sliders → big disadvantage
   */
  async getSavantBatterPitchPerf(year = new Date().getFullYear()) {
    return _cachedSavant(`savant-batter-pitch-${year}`, async () => {
      try {
        // pitch-arsenal-stats CSV (type=batter): per-pitch slg / run value /
        // whiff, grouped by player_id + pivoted. (The old /pitch-arsenals page
        // ignored type=batter and returned pitcher movement → every field null.)
        const rows = await savantCSV(
          `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=batter&pitchType=&year=${year}&team=&min=10&csv=true`
        );
        if (!rows.length) return new Map();
        const pf = (v) => (v != null && v !== '' ? parseFloat(v) : null);
        const avg = (...vals) => { const xs = vals.filter(v => v != null); return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null; };
        const PT_KEY = { FF: 'ff', SI: 'si', FC: 'fc', SL: 'sl', CU: 'cu', KC: 'kc', CH: 'ch', FS: 'fs' };
        const byId = new Map();
        for (const r of rows) { const id = Number(r.player_id); if (!id) continue; if (!byId.has(id)) byId.set(id, []); byId.get(id).push(r); }

        const map = new Map();
        for (const [id, prs] of byId) {
          const slg = {}, rv = {}, whiff = {};
          const all = [];
          for (const r of prs) {
            const pt  = (r.pitch_type || '').toUpperCase();
            const key = PT_KEY[pt];
            const sg  = pf(r.slg), rvv = pf(r.run_value_per_100), wh = pf(r.whiff_percent), us = pf(r.pitch_usage) ?? 0;
            if (key) { slg[key] = sg; rv[key] = rvv; whiff[key] = wh; }
            all.push({ name: r.pitch_name || pt, slg: sg, rv: rvv, usage: us });
          }
          // Best/worst pitch for the batter by SLG among pitches seen 8%+.
          const seen = all.filter(p => p.slg != null && p.usage >= 8);
          const pick = (cmp) => { const x = [...seen].sort(cmp)[0]; return { name: x.name, slg: x.slg, rv: x.rv }; };
          const bestPitch  = seen.length ? pick((a, b) => b.slg - a.slg) : null;
          const worstPitch = seen.length ? pick((a, b) => a.slg - b.slg) : null;

          map.set(id, {
            fastballSlg: avg(slg.ff, slg.si, slg.fc),
            breakingSlg: avg(slg.sl, slg.cu, slg.kc),
            offspeedSlg: avg(slg.ch, slg.fs),
            fastballRV:  avg(rv.ff, rv.si, rv.fc),
            breakingRV:  avg(rv.sl, rv.cu, rv.kc),
            offspeedRV:  avg(rv.ch, rv.fs),
            ffSlg: slg.ff ?? null, siSlg: slg.si ?? null, fcSlg: slg.fc ?? null, slSlg: slg.sl ?? null,
            cuSlg: slg.cu ?? null, kcSlg: slg.kc ?? null, chSlg: slg.ch ?? null, fsSlg: slg.fs ?? null,
            ffRV: rv.ff ?? null, siRV: rv.si ?? null, fcRV: rv.fc ?? null, slRV: rv.sl ?? null,
            cuRV: rv.cu ?? null, kcRV: rv.kc ?? null, chRV: rv.ch ?? null, fsRV: rv.fs ?? null,
            ffWhiff: whiff.ff ?? null, siWhiff: whiff.si ?? null, fcWhiff: whiff.fc ?? null, slWhiff: whiff.sl ?? null,
            cuWhiff: whiff.cu ?? null, kcWhiff: whiff.kc ?? null, chWhiff: whiff.ch ?? null, fsWhiff: whiff.fs ?? null,
            bestPitch,   // batter's best pitch type to hit
            worstPitch,  // batter's worst pitch type
          });
        }

        return map;
      } catch {
        return new Map();
      }
    });
  },

  /**
   * Batch fetch 30-game hitting stats for a list of batter IDs.
   * Used specifically for the "Who's Due" calculation — a longer window
   * gives a more reliable expected-vs-actual HR deficit.
   * Returns a Map<playerId, { avg, slg, ab, hr, pa }>.
   */
  async getBatterStats30Game(playerIds) {
    const result = new Map();
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += 50) {
      chunks.push(playerIds.slice(i, i + 50));
    }
    await Promise.all(chunks.map(async chunk => {
      try {
        const ids  = chunk.join(',');
        const data = await mlbGet(
          `/people?personIds=${ids}` +
          `&hydrate=stats(group=[hitting],type=[lastXGames],season=${SEASON},gameType=[R],limit=30)`
        );
        for (const person of data.people || []) {
          const statGroup = (person.stats || []).find(
            s => s.type?.displayName?.toLowerCase() === 'lastxgames'
          );
          const splits = statGroup?.splits || [];
          if (!splits.length) continue;
          result.set(person.id, parseStat(splits[splits.length - 1].stat));
        }
      } catch (e) {
        if (__DEV__) console.warn('getBatterStats30Game chunk error:', e.message);
      }
    }));
    return result;
  },

  /**
   * Batch-fetch day/night hitting splits for all batters.
   * Returns Map<playerId, { dayISO, nightISO, dayHRRate, nightHRRate }>.
   * Used to apply a day-edge or night-edge bonus in scoring.
   */
  async getDayNightSplitsBatch(playerIds) {
    const result = new Map();
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += 50) {
      chunks.push(playerIds.slice(i, i + 50));
    }
    await Promise.all(chunks.map(async chunk => {
      try {
        const ids  = chunk.join(',');
        const data = await mlbGet(
          `/people?personIds=${ids}` +
          `&hydrate=stats(group=[hitting],type=[statSplits],sitCodes=[d,n],season=${SEASON},gameType=[R])`
        );
        for (const person of data.people || []) {
          const statGroup = (person.stats || []).find(
            s => s.type?.displayName?.toLowerCase().includes('split')
          );
          if (!statGroup) continue;
          let day = null, night = null;
          for (const s of statGroup.splits || []) {
            const code = s.split?.code;
            const p = parseStat(s.stat);
            if (code === 'd') day   = p;
            if (code === 'n') night = p;
          }
          if (day || night) {
            result.set(person.id, {
              dayISO:    day?.iso    ?? null,
              nightISO:  night?.iso  ?? null,
              dayHRRate: day?.hrRate ?? null,
              nightHRRate: night?.hrRate ?? null,
              dayAB:    day?.ab     ?? 0,
              nightAB:  night?.ab   ?? 0,
            });
          }
        }
      } catch (e) {
        if (__DEV__) console.warn('getDayNightSplitsBatch chunk error:', e.message);
      }
    }));
    return result;
  },

  /**
   * Batch-fetch home/away hitting splits for all batters.
   * Returns Map<playerId, { homeISO, awayISO, homeAB, awayAB }>.
   * Used to apply a home-edge or away-edge bonus in scoring.
   */
  async getHomeAwaySplitsBatch(playerIds) {
    const result = new Map();
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += 50) {
      chunks.push(playerIds.slice(i, i + 50));
    }
    await Promise.all(chunks.map(async chunk => {
      try {
        const ids  = chunk.join(',');
        const data = await mlbGet(
          `/people?personIds=${ids}` +
          `&hydrate=stats(group=[hitting],type=[statSplits],sitCodes=[h,a],season=${SEASON},gameType=[R])`
        );
        for (const person of data.people || []) {
          const statGroup = (person.stats || []).find(
            s => s.type?.displayName?.toLowerCase().includes('split')
          );
          if (!statGroup) continue;
          let home = null, away = null;
          for (const s of statGroup.splits || []) {
            const code = s.split?.code;
            const p = parseStat(s.stat);
            if (code === 'h') home = p;
            if (code === 'a') away = p;
          }
          if (home || away) {
            result.set(person.id, {
              homeISO: home?.iso ?? null,
              awayISO: away?.iso ?? null,
              homeAB:  home?.ab  ?? 0,
              awayAB:  away?.ab  ?? 0,
            });
          }
        }
      } catch (e) {
        if (__DEV__) console.warn('getHomeAwaySplitsBatch chunk error:', e.message);
      }
    }));
    return result;
  },

  /**
   * Batch-fetch hitting splits vs starting pitchers (sp) and relief pitchers (rp).
   * Used to flag "Bullpen Legend" batters — guys who crush bullpens at a rate
   * meaningfully higher than their performance vs starters.
   *
   * Returns Map<playerId, {
   *   spAb, spHr, spHrRate, spIso,
   *   rpAb, rpHr, rpHrRate, rpIso,
   *   bullpenLegend,                 // computed flag
   *   bullpenRatio                   // rpHrRate / spHrRate (for ELI5 context)
   * }>
   *
   * Bullpen Legend logic (deliberately conservative so we don't flag noise):
   *   - At least 30 ABs vs relievers and 3 HRs vs relievers (sample floor)
   *   - rpHrRate ≥ 5.5% AND rpHrRate ≥ 1.35 × spHrRate     (clear lift), OR
   *   - rpHrRate ≥ 7.5%                                     (elite absolute rate)
   */
  async getBullpenSplitsBatch(playerIds) {
    const result = new Map();
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += 50) {
      chunks.push(playerIds.slice(i, i + 50));
    }
    await Promise.all(chunks.map(async chunk => {
      try {
        const ids  = chunk.join(',');
        const data = await mlbGet(
          `/people?personIds=${ids}` +
          `&hydrate=stats(group=[hitting],type=[statSplits],sitCodes=[sp,rp],season=${SEASON},gameType=[R])`
        );
        for (const person of data.people || []) {
          const statGroup = (person.stats || []).find(
            s => s.type?.displayName?.toLowerCase().includes('split')
          );
          if (!statGroup) continue;
          let sp = null, rp = null;
          for (const s of statGroup.splits || []) {
            const code = s.split?.code;
            const p = parseStat(s.stat);
            if (code === 'sp') sp = p;
            if (code === 'rp') rp = p;
          }
          if (!sp && !rp) continue;

          const spAb     = sp?.ab ?? 0;
          const spHr     = sp?.hr ?? 0;
          const spHrRate = spAb > 0 ? spHr / spAb : 0;
          const rpAb     = rp?.ab ?? 0;
          const rpHr     = rp?.hr ?? 0;
          const rpHrRate = rpAb > 0 ? rpHr / rpAb : 0;

          // Threshold check — see jsdoc above for the rationale.
          const hasSample      = rpAb >= 30 && rpHr >= 3;
          const elevatedRate   = rpHrRate >= 0.055 && (spHrRate === 0 || rpHrRate >= spHrRate * 1.35);
          const eliteAbsolute  = rpHrRate >= 0.075;
          const bullpenLegend  = hasSample && (elevatedRate || eliteAbsolute);

          const bullpenRatio   = spHrRate > 0 ? rpHrRate / spHrRate : null;

          result.set(person.id, {
            spAb, spHr, spHrRate, spIso: sp?.iso ?? null,
            rpAb, rpHr, rpHrRate, rpIso: rp?.iso ?? null,
            bullpenLegend,
            bullpenRatio,
          });
        }
      } catch (e) {
        if (__DEV__) console.warn('getBullpenSplitsBatch chunk error:', e.message);
      }
    }));
    return result;
  },

  /**
   * Batch-fetch pitcher throwing hand for all probable pitchers.
   * Returns an object { [pitcherId]: 'L' | 'R' }.
   * Used to correctly resolve switch-hitter split sides.
   */
  async getPitcherHands(pitcherIds) {
    if (!pitcherIds.length) return {};
    try {
      const ids  = pitcherIds.join(',');
      const data = await mlbGet(`/people?personIds=${ids}`);
      const out  = {};
      for (const p of data.people || []) {
        if (p.id && p.pitchHand?.code) out[p.id] = p.pitchHand.code; // 'L' or 'R'
      }
      return out;
    } catch {
      return {};
    }
  },

  /**
   * Batch fetch last-7-game hitting stats for all batter IDs.
   * Used for the hot-bat signal — a tighter window catches current streaks
   * that a 15-game window can dilute.
   * Returns a Map<playerId, { avg, slg, ab, hr, pa }>.
   */
  /**
   * Recent pitcher form — last 5 starts aggregated.
   * Reveals when a pitcher is trending way worse (or way better) than his season line.
   * Returns null if insufficient data.
   *
   *   { games, ip, era, hrPer9, k9, lastStartDate }
   */
  async getPitcherRecentForm(pitcherId) {
    try {
      const data = await mlbGet(
        `/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${SEASON}&gameType=R`
      );
      const splits = data.stats?.[0]?.splits || [];
      if (!splits.length) return null;

      // Newest first
      const ordered = [...splits].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const lastN   = ordered.slice(0, 5);

      // Per-game rows for the last 10 starts — powers the Recent Starts
      // table on the Pitcher Vulnerability screen. Mirrors the server-side
      // fetchPitcherRecentForm shape so both surfaces (snapshot + on-demand
      // client fetch) render the same table. Each row carries date / opp /
      // IP / H / ER / BB / K / HR / per-game ERA; missing fields → null
      // so the row renders "—" cleanly.
      // MLB gameLog `opponent` is { id, name } only (no abbreviation), so the
      // old read was always null → "—" in the OPP column. Map id → abbr.
      const TEAM_ABBR_BY_ID = {
        108:'LAA',109:'ARI',110:'BAL',111:'BOS',112:'CHC',113:'CIN',114:'CLE',115:'COL',
        116:'DET',117:'HOU',118:'KC',119:'LAD',120:'WSH',121:'NYM',133:'ATH',134:'PIT',
        135:'SD',136:'SEA',137:'SF',138:'STL',139:'TB',140:'TEX',141:'TOR',142:'MIN',
        143:'PHI',144:'ATL',145:'CWS',146:'MIA',147:'NYY',158:'MIL',
      };
      const recentStarts = ordered.slice(0, 10).map(g => {
        const stat = g.stat || {};
        const gameIp = parseIP(stat.inningsPitched);
        const gameEr = parseInt(stat.earnedRuns, 10);
        const opp = TEAM_ABBR_BY_ID[g.opponent?.id] || g.opponent?.name || null;
        const isHome = !!(g.isHome);
        return {
          date:   g.date || null,
          opp,
          isHome,
          ip:     Number.isFinite(gameIp) ? gameIp : null,
          h:      Number.isFinite(parseInt(stat.hits, 10))         ? parseInt(stat.hits, 10)         : null,
          er:     Number.isFinite(gameEr)                          ? gameEr                          : null,
          bb:     Number.isFinite(parseInt(stat.baseOnBalls, 10))  ? parseInt(stat.baseOnBalls, 10)  : null,
          k:      Number.isFinite(parseInt(stat.strikeOuts, 10))   ? parseInt(stat.strikeOuts, 10)   : null,
          hr:     Number.isFinite(parseInt(stat.homeRuns, 10))     ? parseInt(stat.homeRuns, 10)     : null,
          era:    (Number.isFinite(gameIp) && gameIp > 0 && Number.isFinite(gameEr))
                    ? (gameEr * 9) / gameIp
                    : null,
        };
      });

      let ip = 0, er = 0, hr = 0, k = 0;
      for (const g of lastN) {
        const stat = g.stat || {};
        ip += parseIP(stat.inningsPitched);
        er += parseInt(stat.earnedRuns,  10) || 0;
        hr += parseInt(stat.homeRuns,    10) || 0;
        k  += parseInt(stat.strikeOuts,  10) || 0;
      }
      if (ip < 5) return null;  // not enough recent volume to be meaningful

      return {
        games:         lastN.length,
        ip,
        era:           (er * 9) / ip,
        hrPer9:        (hr * 9) / ip,
        k9:            (k  * 9) / ip,
        lastStartDate: ordered[0]?.date || null,
        recentStarts,
      };
    } catch {
      return null;
    }
  },

  /**
   * Fetch a pitcher's stats for a prior season (default: previous calendar year).
   * Same shape as getPitcherSeasonStats but includes the `year` field.
   */
  async getPitcherPrevSeasonStats(pitcherId, year = SEASON - 1) {
    try {
      const data = await mlbGet(
        `/people/${pitcherId}/stats?stats=season&group=pitching&season=${year}&gameType=R`
      );
      const splits = data.stats?.[0]?.splits || [];
      if (!splits.length) return null;
      const s  = splits[splits.length - 1].stat;
      const ip = parseIP(s.inningsPitched);
      const hrAllowed = parseInt(s.homeRuns, 10) || 0;
      const hrPer9 = ip > 0 ? (hrAllowed * 9) / ip : 0;
      return {
        year,
        era:             safeFloat(s.era),
        hrPer9,
        kPer9:           safeFloat(s.strikeoutsPer9Inn),
        whip:            safeFloat(s.whip),
        bb9:             safeFloat(s.walksPer9Inn),
        inningsPitched:  ip,
        homeRunsAllowed: hrAllowed,
      };
    } catch {
      return null;
    }
  },

  /**
   * Fetch pitcher expected stats (xERA, xwOBA against) from Baseball Savant.
   * Returns Map<pitcherId, { xEra, xwOba }>.
   */
  async getPitcherExpectedStats(year = SEASON) {
    return _cachedSavant(`savant-pitcher-xstats-${year}`, async () => {
      try {
        const rows = await savantCSV(
          `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher` +
          `&year=${year}&position=&team=&min=q&csv=true`
        );
        const pf  = v => (v != null && v !== '' ? parseFloat(v) : null);
        const map = new Map();
        for (const p of rows) {
          const id = Number(p.player_id);
          if (!id) continue;
          map.set(id, { xEra: pf(p.est_era), xwOba: pf(p.est_woba) });
        }
        return map;
      } catch {
        return new Map();
      }
    });
  },

  /**
   * Return a Set of batter IDs who have homered today across any game.
   * Pulls each live/final game's play feed in parallel and harvests HR plays.
   */
  async getTodaysHRHitters(date) {
    // Convenience wrapper around getTodaysHRMap that returns just the Set
    // of player IDs (existing API surface — HR ticker, HR-today badges).
    const map = await this.getTodaysHRMap(date);
    return new Set(map.keys());
  },

  /**
   * Returns Map<playerId, { count, name, team }> for every batter who
   * homered on `date`. Map values are the HR COUNT (so a batter who went
   * 2-for-2 returns 2) plus the player's display name and team abbr —
   * which lets the reconciliation surface a "MLB HR hitters NOT in your
   * picks" diagnostic so users can see exactly who got missed and why
   * (late lineup confirmation, recent trade, call-up, etc.) instead of
   * guessing.
   *
   * Uses the boxscore endpoint (`/game/{gamePk}/boxscore`) as the canonical
   * post-game stat sheet — stable for any historical date, ~10 KB per game.
   * Falls back to the live-feed play harvest per-game if boxscore fails so
   * a single bad fetch can't wipe out an entire day's reconciliation.
   */
  async getTodaysHRMap(date) {
    try {
      const games = await this.getLiveGames(date);
      const inProgressOrDone = games.filter(g => g.isLive || g.isFinal);
      const map = new Map();
      await Promise.all(inProgressOrDone.map(async (g) => {
        const awayAbbr = g.awayTeam?.abbr;
        const homeAbbr = g.homeTeam?.abbr;
        try {
          const data = await mlbGet(`/game/${g.gamePk}/boxscore`);
          for (const sideKey of ['away', 'home']) {
            const side = data.teams?.[sideKey];
            const players = side?.players || {};
            const teamAbbr = sideKey === 'away' ? awayAbbr : homeAbbr;
            for (const pKey of Object.keys(players)) {
              const pl = players[pKey];
              const hr = parseInt(pl?.stats?.batting?.homeRuns, 10) || 0;
              if (hr > 0 && pl?.person?.id) {
                // Sum in case a player somehow appears across multiple
                // game entries (doubleheader same-day, suspended-game
                // resume). Map.get returns undefined for first-add.
                const existing = map.get(pl.person.id);
                map.set(pl.person.id, {
                  count: (existing?.count || 0) + hr,
                  name:  existing?.name || pl.person.fullName || pl.person.boxscoreName || 'Unknown',
                  team:  existing?.team || teamAbbr || '',
                });
              }
            }
          }
        } catch {
          // Boxscore failed — fall back to live-feed play harvest. Plays
          // give us individual HR events so we can count multi-HR games too.
          try {
            const res = await fetch(`${MLB_BASE_V11}/game/${g.gamePk}/feed/live`);
            if (!res.ok) return;
            const data  = await res.json();
            const plays = data.liveData?.plays?.allPlays || [];
            for (const p of plays) {
              if (p.result?.eventType === 'home_run' && p.matchup?.batter?.id) {
                const id = p.matchup.batter.id;
                const isAway = p.about?.halfInning === 'top';
                const existing = map.get(id);
                map.set(id, {
                  count: (existing?.count || 0) + 1,
                  name:  existing?.name || p.matchup.batter.fullName || 'Unknown',
                  team:  existing?.team || (isAway ? awayAbbr : homeAbbr) || '',
                });
              }
            }
          } catch {}
        }
      }));
      return map;
    } catch {
      return new Map();
    }
  },

  /**
   * Get HR + hit streaks for a single batter using game log.
   * Returns { lastGameHR, lastGameDate, lastGameWasToday, hrStreak, hitStreak, lastHrGamesAgo }.
   *   lastGameHR        — did they homer in their most recent recorded game?
   *   lastGameDate      — date string of the most recent game (YYYY-MM-DD)
   *   lastGameWasToday  — true if the most recent game is today's date
   *   hrStreak          — consecutive games with ≥1 HR (most recent backward)
   *   hitStreak         — consecutive games with ≥1 hit
   *   lastHrGamesAgo    — games since last HR (null if no HR yet this season)
   */
  async getBatterStreaks(playerId) {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const empty = {
      lastGameHR: false, lastGameDate: null, lastGameWasToday: false,
      hrStreak: 0, hitStreak: 0, lastHrGamesAgo: null,
    };

    try {
      const data = await mlbGet(
        `/people/${playerId}/stats?stats=gameLog&group=hitting&season=${SEASON}&gameType=R`
      );
      const splits = data.stats?.[0]?.splits || [];
      if (!splits.length) return empty;

      // Sort newest first by date
      const ordered = [...splits].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

      const games = ordered.map(s => ({
        date: s.date,
        hr:   parseInt(s.stat?.homeRuns, 10) || 0,
        h:    parseInt(s.stat?.hits,     10) || 0,
      }));

      const last = games[0];
      const lastGameHR       = last?.hr > 0;
      const lastGameDate     = last?.date || null;
      const lastGameWasToday = lastGameDate === todayStr;

      let hrStreak = 0;
      for (const g of games) { if (g.hr > 0) hrStreak++; else break; }

      let hitStreak = 0;
      for (const g of games) { if (g.h > 0)  hitStreak++; else break; }

      let lastHrGamesAgo = null;
      for (let i = 0; i < games.length; i++) {
        if (games[i].hr > 0) { lastHrGamesAgo = i; break; }
      }
      if (lastHrGamesAgo === null && games.length) lastHrGamesAgo = games.length;

      return { lastGameHR, lastGameDate, lastGameWasToday, hrStreak, hitStreak, lastHrGamesAgo };
    } catch {
      return empty;
    }
  },

  async getBatterStats7Game(playerIds) {
    const result = new Map();
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += 50) {
      chunks.push(playerIds.slice(i, i + 50));
    }
    await Promise.all(chunks.map(async chunk => {
      try {
        const ids  = chunk.join(',');
        const data = await mlbGet(
          `/people?personIds=${ids}` +
          `&hydrate=stats(group=[hitting],type=[lastXGames],season=${SEASON},gameType=[R],limit=7)`
        );
        for (const person of data.people || []) {
          const statGroup = (person.stats || []).find(
            s => s.type?.displayName?.toLowerCase() === 'lastxgames'
          );
          const splits = statGroup?.splits || [];
          if (!splits.length) continue;
          result.set(person.id, parseStat(splits[splits.length - 1].stat));
        }
      } catch (e) {
        if (__DEV__) console.warn('getBatterStats7Game chunk error:', e.message);
      }
    }));
    return result;
  },

  /**
   * Fetch a batter's career stats vs a specific pitcher (head-to-head).
   * Returns { ab, hr, avg, hrRate } or null if insufficient data (< 5 AB).
   */
  async getH2HStats(batterId, pitcherId) {
    try {
      const data = await mlbGet(
        `/people/${batterId}/stats?stats=vsPlayer&opposingPlayerId=${pitcherId}&group=hitting&gameType=R`
      );
      const splits = data.stats?.[0]?.splits || [];
      if (!splits.length) return null;
      const s  = splits[splits.length - 1].stat;
      const ab = s.atBats || 0;
      if (ab < 5) return null;
      const hr  = s.homeRuns || 0;
      const avg = parseFloat(s.avg) || 0;
      return { ab, hr, avg, hrRate: ab > 0 ? hr / ab : 0 };
    } catch {
      return null;
    }
  },

  /**
   * Get today's live/completed games for the Live tab.
   * Returns an array of lightweight game objects (score, inning, teams).
   * Uses hydrate=linescore so one call covers all games.
   */
  async getLiveGames(date) {
    const data = await mlbGet(
      `/schedule?sportId=1&date=${date}&hydrate=linescore,team`
    );
    const games = [];
    for (const dateEntry of data.dates || []) {
      for (const g of dateEntry.games || []) {
        const state    = g.status?.abstractGameState;
        const detailed = g.status?.detailedState;
        // Include Suspended games so reconciliation captures HRs that
        // already happened before play was halted (rain delay, lights, etc).
        // The old `state !== 'Live' && state !== 'Final'` filter dropped
        // those entirely — and silently degraded backtest accuracy.
        const isSuspended = detailed === 'Suspended' || detailed?.startsWith?.('Suspended');
        if (state !== 'Live' && state !== 'Final' && !isSuspended) continue;
        games.push({
          gamePk:    g.gamePk,
          status:    detailed || state,
          isLive:    state === 'Live',
          isFinal:   state === 'Final' || isSuspended,
          gameDate:  g.gameDate,
          awayTeam:  { id: g.teams.away.team.id, name: g.teams.away.team.name, abbr: g.teams.away.team.abbreviation },
          homeTeam:  { id: g.teams.home.team.id, name: g.teams.home.team.name, abbr: g.teams.home.team.abbreviation },
          awayScore:      g.teams.away.score ?? 0,
          homeScore:      g.teams.home.score ?? 0,
          inning:         g.linescore?.currentInning          ?? null,
          ordinal:        g.linescore?.currentInningOrdinal   ?? null,
          half:           g.linescore?.inningHalf             ?? null,
          currentBatter:  g.linescore?.offense?.batter?.fullName  ?? null,
          currentPitcher: g.linescore?.defense?.pitcher?.fullName ?? null,
          balls:          g.linescore?.balls   ?? null,
          strikes:        g.linescore?.strikes ?? null,
          outs:           g.linescore?.outs    ?? null,
        });
      }
    }
    return games;
  },

  /**
   * Fetch the live situation + key play log for a single game.
   * Returns { currentBatter, currentPitcher, awayRuns, homeRuns, inning, half, keyPlays }.
   *
   * keyPlays items: { eventType, label, batter, batterId, pitcher, pitcherId, inning, half, desc }
   *
   * We pull the full live feed but only read the fields we need.
   * The feed is ~100-300 KB — fine over mobile LTE; it's only loaded when the user
   * expands a game card, not on every refresh of the live list.
   */
  async getLiveGameSituation(gamePk) {
    const res  = await fetch(`${MLB_BASE_V11}/game/${gamePk}/feed/live`);
    if (!res.ok) throw new Error(`MLB API ${res.status}: live feed`);
    const data = await res.json();
    const liveData  = data.liveData  || {};
    const gameData  = data.gameData  || {};
    const linescore = liveData.linescore || {};
    const defense   = linescore.defense  || {};
    const offense   = linescore.offense  || {};

    // All hit/contact event types we care about, with display config
    const KEY_EVENTS = {
      home_run: { label: 'HOMER',   emoji: '🏠' },
      single:   { label: 'RBI 1B',  emoji: '🎯' },
      double:   { label: 'RBI 2B',  emoji: '⚡' },
      triple:   { label: 'RBI 3B',  emoji: '🚀' },
      sac_fly:  { label: 'SAC FLY', emoji: '🪃' },
    };

    const allPlays = liveData.plays?.allPlays || [];
    const keyPlays = [];

    for (const play of allPlays) {
      // Skip incomplete at-bats — only log finished plays
      if (!play.about?.isComplete) continue;

      const et  = play.result?.eventType;
      const rbi = play.result?.rbi ?? 0;
      const cfg = KEY_EVENTS[et];

      if (!cfg) continue;

      // Home runs always show (solo HR is still a scoring play).
      // Everything else only shows when at least one run actually scored.
      if (et !== 'home_run' && rbi === 0) continue;

      // For singles/doubles/triples, prefix label with RBI count when > 1
      const label = (et !== 'home_run' && et !== 'sac_fly' && rbi > 1)
        ? `${rbi}-RBI ${cfg.label.replace('RBI ', '')}`
        : cfg.label;

      keyPlays.push({
        eventType:  et,
        label,
        emoji:      cfg.emoji,
        rbi,
        desc:       play.result?.description || '',
        batter:     play.matchup?.batter?.fullName ?? null,
        batterId:   play.matchup?.batter?.id       ?? null,
        pitcher:    play.matchup?.pitcher?.fullName ?? null,
        pitcherId:  play.matchup?.pitcher?.id       ?? null,
        inning:     play.about?.inning              ?? null,
        half:       play.about?.halfInning          ?? '',
        teamAbbr:   play.about?.halfInning === 'top'
          ? gameData.teams?.away?.abbreviation
          : gameData.teams?.home?.abbreviation,
      });
    }
    keyPlays.reverse(); // most recent first

    // Detect pitching changes (substitution plays)
    const pitcherChanges = allPlays
      .filter(p =>
        (p.result?.event || '').toLowerCase().includes('pitching substitution') ||
        p.result?.eventType === 'pitching_substitution'
      )
      .map(p => ({
        desc:   p.result?.description || 'Pitching change',
        inning: p.about?.inning,
        half:   p.about?.halfInning,
      }))
      .reverse();

    // Which batters have already homered this game?
    const batcherHomers = new Map(); // batterId → count
    for (const p of keyPlays) {
      if (p.eventType === 'home_run' && p.batterId) {
        batcherHomers.set(p.batterId, (batcherHomers.get(p.batterId) || 0) + 1);
      }
    }

    return {
      currentInning:    linescore.currentInning            ?? null,
      currentOrdinal:   linescore.currentInningOrdinal     ?? '',
      inningHalf:       linescore.inningHalf               ?? '',
      awayRuns:         linescore.teams?.away?.runs        ?? 0,
      homeRuns:         linescore.teams?.home?.runs        ?? 0,
      currentBatter:    offense?.batter?.fullName          ?? null,
      currentBatterId:  offense?.batter?.id                ?? null,
      currentPitcher:   defense?.pitcher?.fullName         ?? null,
      currentPitcherId: defense?.pitcher?.id               ?? null,
      outs:             linescore.outs                     ?? 0,
      balls:            linescore.balls                    ?? 0,
      strikes:          linescore.strikes                  ?? 0,
      keyPlays,
      pitcherChanges,
      batcherHomers,     // Map of batterId → HR count this game
    };
  },

  // Legacy alias
  async getDailySchedule(date) {
    return this.getSchedule(date);
  },

  // ─── Milestone data fetchers ──────────────────────────────────────────────

  /**
   * Batch fetch FULL season hitting stats for milestone tracking.
   * Returns Map<playerId, { hr, hits, rbi, doubles, triples, xbh, games }>
   * Separate from getBatterStatsBatch which only needs a slim parseStat subset.
   */
  async getMilestoneSeasonStats(playerIds) {
    const result = new Map();
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const data = await mlbGet(
          `/people?personIds=${chunk.join(',')}&hydrate=stats(group=[hitting],type=[season],season=${SEASON},gameType=[R])`
        );
        for (const person of data.people || []) {
          const sg = (person.stats || []).find(s => s.type?.displayName?.toLowerCase() === 'season');
          const stat = sg?.splits?.[sg.splits.length - 1]?.stat;
          if (!stat) continue;
          const d = stat.doubles    || 0;
          const t = stat.triples    || 0;
          const h = stat.homeRuns   || 0;
          result.set(person.id, {
            hr:      h,
            hits:    stat.hits    || 0,
            rbi:     stat.rbi     || 0,
            doubles: d, triples: t,
            xbh:     d + t + h,
            games:   stat.gamesPlayed || 0,
          });
        }
      } catch {}
    }));
    return result;
  },

  /**
   * Batch fetch career hitting totals.
   * Returns Map<playerId, { hr, hits, xbh, rbi, doubles, triples }>
   */
  async getPlayersCareerStats(playerIds) {
    const result = new Map();
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const data = await mlbGet(
          `/people?personIds=${chunk.join(',')}&hydrate=stats(group=[hitting],type=[career])`
        );
        for (const person of data.people || []) {
          const sg = (person.stats || []).find(s => s.type?.displayName?.toLowerCase() === 'career');
          const stat = sg?.splits?.[sg.splits.length - 1]?.stat;
          if (!stat) continue;
          const d = stat.doubles  || 0;
          const t = stat.triples  || 0;
          const h = stat.homeRuns || 0;
          result.set(person.id, {
            hr:      h,
            hits:    stat.hits || 0,
            rbi:     stat.rbi  || 0,
            doubles: d, triples: t,
            xbh:     d + t + h,
          });
        }
      } catch {}
    }));
    return result;
  },

  /**
   * Batch fetch player birth dates.
   * Returns Map<playerId, 'YYYY-MM-DD'>
   */
  async getPlayersBirthdays(playerIds) {
    const result = new Map();
    const chunks = [];
    for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
    await Promise.all(chunks.map(async (chunk) => {
      try {
        const res  = await fetch(`${MLB_BASE}/people?personIds=${chunk.join(',')}&fields=people,id,birthDate`);
        const data = await res.json();
        for (const p of data.people || []) {
          if (p.birthDate) result.set(p.id, p.birthDate);
        }
      } catch {}
    }));
    return result;
  },

  /**
   * Batch fetch each team's bullpen HR/9 (composite across all relievers).
   * Used by the AB-by-AB simulation to model the late-game bullpen swap with
   * team-specific quality — facing the Rockies' pen in PA #5 is very different
   * from facing the Phillies'.
   *
   * Returns Map<teamId, hrPer9>. Skips any team where the reliever IP sample
   * is too small to trust (<30 IP) — the simulator falls back to the league
   * average for those.
   */
  async getTeamBullpenHR9Batch(teamIds) {
    const result = new Map();
    const ids = [...new Set(teamIds.filter(Boolean))];
    const CONCURRENCY = 8;
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const slice = ids.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map(async (teamId) => {
        try {
          const data = await mlbGet(
            `/teams/${teamId}/stats?stats=statSplits&group=pitching` +
            `&sitCodes=rp&season=${SEASON}&gameType=R`
          );
          const splits = data.stats?.[0]?.splits || [];
          const rp = splits.find(s => s.split?.code === 'rp') || splits[0];
          if (!rp) return;
          const ip = parseIP(rp.stat?.inningsPitched);
          const hr = parseInt(rp.stat?.homeRuns, 10) || 0;
          // Need ≥30 IP to trust the rate — anything less is noise.
          if (ip < 30) return;
          result.set(teamId, (hr * 9) / ip);
        } catch (e) {
          if (__DEV__) console.warn(`getTeamBullpenHR9Batch team ${teamId} error:`, e.message);
        }
      }));
    }
    return result;
  },

  /**
   * Batch fetch current hit streaks for a list of players.
   * Expensive (one game-log call per player) — cap at 60 to avoid hammering the API.
   * Returns Map<playerId, number>  (0 if no active streak)
   */
  async getPlayersHitStreaks(playerIds) {
    // Removed the 60-player cap — long hit streaks on lower-scored players
    // were getting silently dropped from the Milestones "Hit Streaks" tab.
    // Throttle to 15-at-a-time instead so we don't fire all 270+ requests
    // simultaneously.
    const result = new Map();
    const CONCURRENCY = 15;
    for (let i = 0; i < playerIds.length; i += CONCURRENCY) {
      const slice = playerIds.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map(async (pid) => {
        try {
          const s = await this.getBatterStreaks(pid);
          result.set(pid, s.hitStreak || 0);
        } catch {}
      }));
    }
    return result;
  },
};
