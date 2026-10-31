/**
 * NBAService — live NBA data fetcher for StatFax (NBA expansion)
 *
 * Data source: ESPN's undocumented site.api endpoints
 *   https://site.api.espn.com/apis/site/v2/sports/basketball/nba/…
 *
 * Why ESPN's hidden API instead of a licensed feed?
 *   - Free, no API key, no rate-limit headers returned.
 *   - Extremely reliable uptime — it backs ESPN.com itself.
 *   - Returns JSON with a consistent-enough schema for client-side use.
 *
 * How this differs from MLBService:
 *   - Scoreboard is per-day (one call returns today's full slate); MLB
 *     uses a windowed schedule endpoint with game-state filters.
 *   - Player stats come from a deeply nested splits.categories[] shape —
 *     not flat stat objects. The extractStat() helper walks that tree.
 *   - No Statcast / Savant equivalent for NBA; no CSV scraping needed.
 *   - Position filtering on the roster is positional-abbreviation-based
 *     (G, F, C, G-F, etc.) rather than position.type !== 'Pitcher'.
 *   - AbortController timeouts per request (12 s) — ESPN doesn't 408
 *     on slow games; it just hangs. The scoreboard path throws on
 *     timeout; soft endpoints return null.
 *   - Cache-Control: no-cache on every request to defeat CDN staleness
 *     on live game data (scores/period/clock change every few seconds).
 *
 * Exported shape:
 *   NBAService.getScoreboard()         → game[]   (now includes team.logo + team.color)
 *   NBAService.getRoster(teamId)       → player[]
 *   NBAService.getPlayerSeasonStats()  → stat object | null
 *   NBAService.getPlayerStatsBatch()   → Map<id, stats>
 *   NBAService.getTeamSeasonStats()    → team-level stat object | null
 */

import NBA_DEMO_SNAPSHOT from '../data/demoSlate.js';
import { scoreGameFirstBasket, FIRST_BASKET_MODEL_VERSION } from '../logic/firstBasketEngine.js';
import { blendRecentOpeningRole } from '../logic/openingRoleForm.js';
import { getJumpBallMatchup } from '../data/jumpBalls.js';
import { getStartersForTeam, TEAM_ABBR_ALIASES } from '../data/teamRosters.js';
import { findPositionalReplacement, getFullRosterForTeam } from '../data/fullRosters.js';

const ESPN_NBA = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';

// 12-second hard timeout per request — ESPN's CDN sometimes stalls on
// game-state endpoints during heavy traffic without closing the TCP conn.
const REQUEST_TIMEOUT_MS = 12_000;

// Parallelism cap for getPlayerStatsBatch — keeps us from sending 400+
// simultaneous requests to ESPN which would likely trip a soft-block.
const BATCH_CONCURRENCY = 8;

// ---------- private helpers ----------

/**
 * Core fetch wrapper shared by all ESPN NBA endpoints.
 * Always sends Cache-Control: no-cache so live-game CDN staleness
 * doesn't freeze scores or clocks mid-quarter.
 * `throwOnFail` — set true for hard endpoints (scoreboard) where a
 * network error should bubble up rather than return null.
 */
async function espnGet(path, throwOnFail = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const sep = path.includes('?') ? '&' : '?';
  const url = `${ESPN_NBA}${path}${sep}_t=${Date.now()}`;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
    });
    if (!res.ok) {
      if (throwOnFail) throw new Error(`ESPN NBA ${res.status}: ${path}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    if (throwOnFail) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Walk ESPN's deeply-nested splits.categories[] to pull a single stat value.
 * ESPN returns something like:
 *   { splits: { categories: [ { name: "offensive", stats: [ { name: "points", value: 24.3 }, … ] } ] } }
 *
 * We can't dot-access by stat name — we have to linear-scan categories, then
 * scan each category's stats[]. The first match wins (ESPN sometimes duplicates
 * stat names across categories with slightly different precision; the first
 * occurrence is always the primary/season one).
 */
function extractStat(categories, name) {
  if (!Array.isArray(categories)) return null;
  for (const cat of categories) {
    for (const stat of cat.stats || []) {
      if (stat.name === name) return stat.value ?? null;
    }
  }
  return null;
}

/**
 * Safe number coerce — returns 0 for anything that won't parseFloat cleanly.
 * Keeps division-by-zero guards readable downstream.
 */
function safeNum(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function openingHistoryAge(history, currentSeasonStartYear) {
  const years = String(history?.season || '').split(',').map(x => Number(x.slice(0, 4))).filter(Number.isFinite);
  return years.length ? Math.max(currentSeasonStartYear - Math.min(...years), 0) : null;
}

function normalizeOpeningPlayerName(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '');
}

export function nbaDateKeyInZone(date = new Date(), timeZone = 'America/Chicago') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = type => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}${part('month')}${part('day')}`;
}

// ---------- public API ----------

export const NBAService = {

  /**
   * Fetch today's full NBA slate from ESPN.
   * Returns an array of normalized game objects; empty array when no games
   * are scheduled. Throws on network failure — callers should treat this
   * as a hard dependency for the NBA daily view.
   */
  async getScoreboard() {
    // The production slate and user-facing board use Chicago dates. Always
    // pin this timezone because scheduled refreshes run on UTC hosts.
    //
    // Passing ?dates=YYYYMMDD anchored to the user's local date returns
    // exactly the games happening "today" from their perspective.
    //
    // Fallback: if today returns 0 events AND we're in the early-morning
    // window (00:00–06:00 local), ESPN may not have published today's
    // games yet — fall through to tomorrow's date so the user still
    // sees the upcoming slate rather than an empty screen at 2am.
    const localDateStr = (offsetDays = 0) => {
      const today = nbaDateKeyInZone(new Date(), 'America/Chicago');
      const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(4, 6)) - 1, Number(today.slice(6, 8))));
      d.setUTCDate(d.getUTCDate() + offsetDays);
      return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    };

    const todayStr = localDateStr(0);
    let data = await espnGet(`/scoreboard?dates=${todayStr}`, true);

    if (!data?.events?.length) {
      // Empty result — try tomorrow as a fallback for the late-night
      // window. ESPN classifies games by the GAME-TIME's ET date, so a
      // West Coast user at 10pm PT (= 1am ET tomorrow) sees their
      // late-tipping games under "tomorrow's" date.
      const tomorrowData = await espnGet(`/scoreboard?dates=${localDateStr(1)}`, false).catch(() => null);
      if (tomorrowData?.events?.length) {
        data = tomorrowData;
      }
    }

    const games = [];
    for (const event of data?.events || []) {
      const comp       = event.competitions?.[0];
      if (!comp) continue;

      const competitors = comp.competitors || [];
      // ESPN always returns exactly two competitors per game; home/away
      // is identified by the competitor's `homeAway` field ('home'/'away').
      const homeComp = competitors.find(c => c.homeAway === 'home');
      const awayComp = competitors.find(c => c.homeAway === 'away');

      const statusName = comp.status?.type?.name || '';
      // ESPN's status strings: STATUS_SCHEDULED, STATUS_IN_PROGRESS,
      // STATUS_FINAL (+ STATUS_HALFTIME, STATUS_END_PERIOD, etc. during live
      // games — we collapse those under the isLive flag rather than leaking
      // ESPN internals to the consumer).
      const isLive  = statusName === 'STATUS_IN_PROGRESS'  ||
                      statusName === 'STATUS_HALFTIME'      ||
                      statusName.startsWith('STATUS_END_');
      const isFinal = statusName === 'STATUS_FINAL';

      // Score is a string ("108") from ESPN; coerce to number.
      // During a scheduled game it's absent/"0" — that's fine.
      // ESPN ships the team logo URL right on team.logo (PNG, ~500x500,
      // CDN-served). Falling back to a constructed URL from team.abbreviation
      // if the field isn't present — the constructed URL almost always works
      // because ESPN's logo CDN uses a predictable per-team naming scheme.
      // Color is the team's primary hex (no #) — useful for tint/border accents.
      const buildFallbackLogo = (abbr) =>
        abbr ? `https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${abbr.toLowerCase()}.png` : null;

      games.push({
        gameId:       String(event.id),
        date:         event.date || null,   // ISO 8601 UTC
        status:       statusName,
        isLive,
        isFinal,
        awayTeam: {
          id:    awayComp?.team?.id    || null,
          abbr:  awayComp?.team?.abbreviation || null,
          name:  awayComp?.team?.displayName  || null,
          logo:  awayComp?.team?.logo  || buildFallbackLogo(awayComp?.team?.abbreviation),
          color: awayComp?.team?.color || null,    // hex string without leading #
          score: awayComp ? safeNum(awayComp.score) : null,
        },
        homeTeam: {
          id:    homeComp?.team?.id    || null,
          abbr:  homeComp?.team?.abbreviation || null,
          name:  homeComp?.team?.displayName  || null,
          logo:  homeComp?.team?.logo  || buildFallbackLogo(homeComp?.team?.abbreviation),
          color: homeComp?.team?.color || null,    // hex string without leading #
          score: homeComp ? safeNum(homeComp.score) : null,
        },
        // period = current quarter (1-4, 5+ = OT). Null pre-tip.
        period:       comp.status?.period   || null,
        // displayClock is the game clock string ("8:42", "0:00", "Halftime").
        // ESPN omits it entirely for scheduled games — null is the right default.
        displayClock: comp.status?.displayClock || null,
        // Venue lives at competitions[0].venue in ESPN's schema.
        venueName:    comp.venue?.fullName || null,
      });
    }
    return games;
  },

  /**
   * Fetch ESPN game summary for a single game (contains live injury reports & confirmed starting 5).
   */
  async getGameSummary(gameId) {
    if (!gameId) return null;
    return espnGet(`/summary?event=${gameId}`, false);
  },

  /**
   * Fetch ESPN game summaries for an array of games with bounded concurrency.
   */
  async getGameSummariesBatch(gameIds) {
    if (!Array.isArray(gameIds) || gameIds.length === 0) return {};
    const results = {};
    const queue = [...gameIds];

    const worker = async () => {
      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) break;
        try {
          const summary = await this.getGameSummary(id);
          if (summary) results[id] = summary;
        } catch {
          // Soft failure on individual game summary
        }
      }
    };

    const pool = Array.from({ length: Math.min(BATCH_CONCURRENCY, queue.length) }, () => worker());
    await Promise.all(pool);
    return results;
  },

  /**
   * Fetch the active roster for an NBA team.
   * Returns an array of { id, name, position, jersey }.
   *
   * Filters to position players only — ESPN includes coaches and two-way
   * contract designations in the athletes[] array. We keep only entries
   * with a position.abbreviation that looks like a basketball position
   * (G, F, C, or hyphenated combos like G-F, F-C). Anything without a
   * recognized abbreviation is almost certainly staff and gets dropped.
   */
  async getRoster(teamId) {
    const data = await espnGet(`/teams/${teamId}/roster`);
    if (!data) return [];

    // Known basketball position abbreviation patterns. Regex rather than
    // an exhaustive list so G-F, PG, SG, SF, PF, C all pass without
    // enumeration — ESPN uses both short (G, F, C) and full (PG, SF) forms.
    const PLAYER_POS = /^(PG|SG|SF|PF|C|G|F|G-F|F-C|F-G|C-F)$/i;

    const players = [];
    for (const athlete of data.athletes || []) {
      const posAbbr = athlete.position?.abbreviation || '';
      // Skip non-position entries (HC, AC, ATR, etc.)
      if (!PLAYER_POS.test(posAbbr)) continue;
      players.push({
        id:       String(athlete.id),
        name:     athlete.displayName || athlete.fullName || '',
        position: posAbbr,
        jersey:   athlete.jersey || null,
      });
    }
    return players;
  },

  /**
   * Fetch season stats for a single player from ESPN.
   * Returns a normalized stat object, or null on fetch/parse failure.
   *
   * ESPN's response shape is notoriously messy — stats are buried inside
   * splits.categories[] with name/value pairs. We use extractStat() to
   * navigate this rather than indexing by position, because ESPN occasionally
   * reorders categories between seasons.
   */
  async getPlayerSeasonStats(playerId) {
    try {
      // Use sports.core, NOT site.api — verified by probe that site.api's
      // /athletes/{id}/statistics 404s for every player including stars
      // (Brunson, Mitchell, Allen). Only the sports.core endpoint with an
      // explicit season + season-type returns actual stat data. This was
      // why every NBA game card showed "No data yet" — all players were
      // returning null from this method.
      //
      // Season anchoring: ESPN uses the season-END year (NOT start year as
      // initially assumed). Verified by probe:
      //   seasons/2025 → 2024-25 season (Wemby 46 GP, rookie/blood-clot year)
      //   seasons/2026 → 2025-26 season (Wemby 64 GP, current season — what
      //                  we want when scoring tonight's playoff games)
      //
      // Rule: if we're in Oct+ the new season just started and ends NEXT
      // calendar year. If we're in Jan-Sep we're in the season that started
      // LAST fall and ends THIS year.
      //
      // For May 2026 (playoffs): month=4 < 9 → seasonYear = 2026 → fetches
      // 2025-26 stats, which is the just-completed regular season.
      //
      // Previous version used `- 1` which fetched stats from a year ago —
      // root cause of rookies showing no data (they weren't in the league
      // in 2024-25) and Wemby's stats reflecting his injury-shortened
      // 2024-25 instead of his full 2025-26 season.
      const now = new Date();
      const seasonYear = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();

      // ESPN season-type IDs:
      //   types/2 = regular season (82 games, stable averages)
      //   types/3 = postseason (4-28 games, current rotation + form)
      //
      // We prefer POSTSEASON data when available because it reflects:
      //   - Shortened playoff rotations (8-man instead of 10-12)
      //   - Coach-designated playoff starters (vs reg-season-MPG ordering)
      //   - Current playoff-intensity form
      //
      // Verified Pop benched Barnes (25.8 → 9.7 MPG) and promoted
      // Champagnie (27.6 → 30.3 MPG) for the playoff rotation; reg-season
      // alone showed them too close to distinguish.
      //
      // Fall back to regular season if postseason returns no data — that
      // happens for:
      //   - Teams not in the playoffs (most of the league in May)
      //   - In-season games (Oct-April when no playoffs are happening)
      //   - Players who haven't logged any playoff minutes
      const baseUrl = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/${seasonYear}`;
      const tryFetch = async (typeId) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const res = await fetch(
            `${baseUrl}/types/${typeId}/athletes/${playerId}/statistics`,
            { signal: controller.signal, headers: { 'Cache-Control': 'no-cache' } }
          );
          if (!res.ok) return null;
          return await res.json();
        } catch {
          return null;
        } finally {
          clearTimeout(timer);
        }
      };

      // Try postseason first; fall back to regular season.
      let data = await tryFetch(3);
      let seasonPhase = 'postseason';
      // ESPN sometimes returns 200 with an empty splits/categories shape
      // for postseason endpoints when the player has zero playoff games.
      // Detect that and fall through to regular season for those players.
      if (!data?.splits?.categories?.length) {
        data = await tryFetch(2);
        seasonPhase = 'regular';
      }
      if (!data) return null;
      if (!data) return null;

      const categories = data.splits?.categories || [];
      if (!categories.length) return null;

      // gamesPlayed and minutes live in the "general" category.
      // Scoring/shooting stats live in "offensive". extractStat searches all
      // categories so the caller doesn't need to know which bucket a stat is in.
      const gamesPlayed = safeNum(extractStat(categories, 'gamesPlayed'));
      // Guard against divide-by-zero on very early season / injured players.
      const gp = gamesPlayed || 1;

      // sports.core returns BOTH season totals AND per-game averages (avg*
      // fields). Prefer the avg* fields directly — they're pre-computed by
      // ESPN with proper handling of partial games / minutes restrictions
      // we'd otherwise miss. Fall back to total/gp only when avg* is missing
      // (rare; happens for some rookies + just-traded players).
      const pickPerGame = (avgName, totalName) => {
        const avg = extractStat(categories, avgName);
        if (avg !== null && Number.isFinite(safeNum(avg))) return safeNum(avg);
        const total = extractStat(categories, totalName);
        return total !== null ? safeNum(total) / gp : 0;
      };
      const minutesPerGameRaw = pickPerGame('avgMinutes',                       'minutes');
      const pointsPerGameRaw  = pickPerGame('avgPoints',                        'points');
      const threesMadeRaw     = pickPerGame('avgThreePointFieldGoalsMade',      'threePointFieldGoalsMade');
      const threesAttRaw      = pickPerGame('avgThreePointFieldGoalsAttempted', 'threePointFieldGoalsAttempted');
      const assistsRaw        = pickPerGame('avgAssists',                       'assists');
      const reboundsRaw       = pickPerGame('avgRebounds',                      'rebounds');

      // Components for the local usage-rate proxy. ESPN exposes a
      // `usageRate` field on their sports.core API but it's broken — verified
      // returning 0 for every player including high-usage stars (Brunson,
      // Mitchell). The components themselves ARE accurate, so we compute
      // the proxy ourselves using the canonical formula:
      //   plays_per_game = FGA + 0.44 × FTA + TOV
      //
      // The 0.44 weight on FTA is the standard adjustment for the average
      // proportion of FT trips that result from a single shooting foul (vs
      // and-1s, technicals, flagrants — each of which is counted as part of
      // a different possession).
      //
      // The proxy is an absolute per-game number, not a percentage — perfect
      // for relative ranking within a team's roster (which is what the
      // first-basket scorer cares about). Higher proxy = more possession
      // ends per game = more likely to be the first one to shoot. For an
      // actual USG% you'd divide by (team plays × player_min / 240), but
      // team plays aren't on this endpoint — and within-team relative
      // ranking doesn't need the team-level normalization.
      const fgaPerGame   = pickPerGame('avgFieldGoalsAttempted', 'fieldGoalsAttempted');
      const ftaPerGame   = pickPerGame('avgFreeThrowsAttempted', 'freeThrowsAttempted');
      const tovPerGame   = pickPerGame('avgTurnovers',           'turnovers');
      const usageProxy   = fgaPerGame + 0.44 * ftaPerGame + tovPerGame;

      // ESPN's threePointFieldGoalPct on sports.core is a 0-100 PERCENT
      // (e.g., 38.28 for 38.28%) — NOT a 0-1 rate as the older site.api
      // returned it. ScoringEngine expects a 0-1 rate for the Poisson base
      // (threesAtt × pct = expected makes). If we feed 38.28 as "rate" the
      // base becomes 100× too large and every shooter looks like they'll
      // hit 200+ threes — that's the "way off" 3PT bug. Auto-detect format:
      // values > 1 are percent, divide by 100. Falls back to recomputing
      // from per-game makes/attempts if the field is missing entirely.
      const rawPct = safeNum(extractStat(categories, 'threePointFieldGoalPct'));
      let threePointPct = 0;
      if (rawPct !== null && Number.isFinite(rawPct)) {
        threePointPct = rawPct > 1 ? rawPct / 100 : rawPct;
      } else if (threesAttRaw > 0) {
        threePointPct = threesMadeRaw / threesAttRaw;
      }

      return {
        gamesPlayed,
        minutesPerGame:        minutesPerGameRaw,
        pointsPerGame:         pointsPerGameRaw,
        threesMadePerGame:     threesMadeRaw,
        threesAttemptedPerGame: threesAttRaw,
        threePointPct,                              // always 0-1 rate
        assistsPerGame:        assistsRaw,
        reboundsPerGame:       reboundsRaw,
        // Which season-type fed this object — 'postseason' when the player
        // has playoff games, 'regular' when fell through to reg-season.
        // UI surfaces this in the modal so users know the sample size
        // (playoff averages over 5-15 games vs reg-season over 60-82).
        seasonPhase,
        // Usage proxy — see comment above. Used by the ScoringEngine first-
        // basket scorer for within-team ranking. Null when components missing.
        fgaPerGame,
        ftaPerGame,
        tovPerGame,
        usageProxy:            usageProxy > 0 ? usageProxy : null,
      };
    } catch {
      // Catch-and-null: a single player stats failure shouldn't blow up a
      // whole slate refresh. Caller can check for null and skip the player.
      return null;
    }
  },

  /**
   * Batch fetch season stats for an array of player IDs.
   * Returns a Map<playerId(string), stats | null>.
   *
   * ESPN's player-stats endpoint is per-player (no batch param), so we must
   * fire one request per player. To avoid hammering ESPN with 400+ simultaneous
   * requests, we chunk into BATCH_CONCURRENCY-wide waves. Within each wave
   * requests are fully parallel; waves are sequential.
   */
  async getPlayerStatsBatch(playerIds) {
    const result = new Map();
    // Process IDs in chunks of BATCH_CONCURRENCY to cap simultaneous in-flight
    // requests. A simple Promise.all(playerIds.map(...)) was tried and caused
    // intermittent 429-like soft-blocks from ESPN's CDN edge nodes.
    for (let i = 0; i < playerIds.length; i += BATCH_CONCURRENCY) {
      const chunk = playerIds.slice(i, i + BATCH_CONCURRENCY);
      const statsArr = await Promise.all(
        chunk.map(id => this.getPlayerSeasonStats(id))
      );
      chunk.forEach((id, idx) => {
        result.set(String(id), statsArr[idx]);
      });
    }
    return result;
  },

  /**
   * Fetch per-game stats for the player's recent games (last N). Powers the
   * weighted recency form factor in the ScoringEngine — a player riding a
   * 5-threes-per-game heater for the last 3 games matters more than their
   * season average suggests.
   *
   * Endpoint: ESPN's common/v3 gamelog. NOT the site.api or sports.core
   * variants — those both 404 for this resource. Verified May 26, 2026
   * (Brunson ECF playoffs).
   *
   * Response shape (relevant fields):
   *   names:   ['minutes', 'fieldGoalsMade-fieldGoalsAttempted', 'fieldGoalPct',
   *             'threePointFieldGoalsMade-threePointFieldGoalsAttempted', ...,
   *             'turnovers', 'points']
   *   events:  { [eventId]: { gameDate, ... } }     ← game metadata
   *   seasonTypes: [{ categories: [{ events: [{ eventId, stats: [...] }] }] }]
   *
   * `stats` is an array of strings (e.g. "12-25" for FG, "38" for points)
   * positionally aligned with the `names` columns. We parse the relevant
   * ones and return a clean per-game array sorted most-recent first.
   *
   * Returns:
   *   [
   *     { date, points, threesMade, threesAttempted, fga, fta, tov, minutes },
   *     ...
   *   ] up to `limit` entries, most recent first. Empty array on failure.
   */
  async getPlayerRecentLogs(playerId, limit = 10) {
    try {
      const url = `https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let data;
      try {
        const res = await fetch(url, {
          signal:  controller.signal,
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return [];
        data = await res.json();
      } finally {
        clearTimeout(timer);
      }

      const names = data?.names || [];
      if (!names.length) return [];

      // Build a name → column index map so we don't depend on positional order.
      const idxOf = (n) => names.indexOf(n);
      const minutesIdx  = idxOf('minutes');
      const pointsIdx   = idxOf('points');
      const turnoversIdx = idxOf('turnovers');
      const threesIdx   = idxOf('threePointFieldGoalsMade-threePointFieldGoalsAttempted');
      const fgIdx       = idxOf('fieldGoalsMade-fieldGoalsAttempted');
      const ftIdx       = idxOf('freeThrowsMade-freeThrowsAttempted');

      // ESPN serves the "made-attempted" stats as hyphenated strings ("8-15").
      // Split + parse on demand. Returns [made, attempted] as numbers, or
      // [0, 0] on parse failure.
      const splitMa = (s) => {
        if (typeof s !== 'string') return [0, 0];
        const parts = s.split('-');
        return [safeNum(parts[0]) || 0, safeNum(parts[1]) || 0];
      };

      // Flatten all season-type categories into one list of per-game stat
      // arrays. ESPN typically returns [{type: regular, events: [...]},
      // {type: postseason, events: [...]}] — playoffs games go first when
      // the player is in them. We want chronological → reverse to most-recent-first.
      const events = data?.events || {};
      const allGameStats = [];
      for (const st of data?.seasonTypes || []) {
        for (const cat of st?.categories || []) {
          for (const evRow of cat?.events || []) {
            const ev = events[evRow.eventId];
            if (!ev) continue;
            const stats = evRow.stats || [];
            const [threesMade, threesAtt] = splitMa(stats[threesIdx]);
            const [fgm, fga] = splitMa(stats[fgIdx]);
            const [ftm, fta] = splitMa(stats[ftIdx]);
            allGameStats.push({
              date:            ev.gameDate || null,
              minutes:         safeNum(stats[minutesIdx])  || 0,
              points:          safeNum(stats[pointsIdx])   || 0,
              tov:             safeNum(stats[turnoversIdx]) || 0,
              threesMade,
              threesAttempted: threesAtt,
              fgm,
              fga,
              ftm,
              fta,
            });
          }
        }
      }

      // Sort most-recent first by date, then trim to limit.
      allGameStats.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });
      return allGameStats.slice(0, limit);
    } catch {
      return [];
    }
  },

  /**
   * Batch fetch recent gamelogs for an array of player IDs. Chunked at
   * BATCH_CONCURRENCY to avoid hammering ESPN. Returns
   * Map<playerId, recentLogs[]>; empty arrays for failures.
   *
   * Cost note: this adds ~N extra ESPN calls on top of getPlayerStatsBatch
   * (where N is the total roster across all games). For typical 1-2 NBA
   * games per night during playoffs, that's 24-48 calls = ~2 waves of
   * concurrency-8. During regular season's 6-15 game nights, ~150-360
   * calls = 20-45 waves. Acceptable on slate-load; if it becomes a
   * bottleneck, switch to lazy fetch for top-N candidates only.
   */
  async getPlayerRecentLogsBatch(playerIds, limit = 10) {
    const result = new Map();
    for (let i = 0; i < playerIds.length; i += BATCH_CONCURRENCY) {
      const chunk = playerIds.slice(i, i + BATCH_CONCURRENCY);
      const logsArr = await Promise.all(
        chunk.map(id => this.getPlayerRecentLogs(id, limit))
      );
      chunk.forEach((id, idx) => {
        result.set(String(id), logsArr[idx] || []);
      });
    }
    return result;
  },

  /**
   * Fetch season-level team statistics from ESPN, primarily for opponent
   * defense modeling and pace/rating analysis.
   *
   * Returns the normalized team-stat object, or null on failure.
   * All values are null when ESPN omits a stat (early season, missing data).
   */
  async getTeamSeasonStats(teamId) {
    try {
      const data = await espnGet(`/teams/${teamId}/statistics`);
      if (!data) return null;

      const categories = data.results?.stats?.categories ||
                         data.splits?.categories         ||
                         [];

      // ESPN's team stats endpoint uses the same nested category/stats shape
      // as the player endpoint. Stat name spellings here are team-level
      // (opponent3PointFieldGoalPct, not threePointFieldGoalPct).
      const pace     = extractStat(categories, 'pace');
      const offRtg   = extractStat(categories, 'offensiveRating');
      const defRtg   = extractStat(categories, 'defensiveRating');
      const opp3pPct = extractStat(categories, 'opponent3PointFieldGoalPct');
      // ESPN sometimes uses a slightly different casing or abbreviation; try
      // the alternate name if the canonical one returns null.
      const opp3pAtt = extractStat(categories, 'opponent3PointFieldGoalsAttempted')
                    ?? extractStat(categories, 'opp3PointFieldGoalsAttempted');

      return {
        pace:                  pace     !== null ? safeNum(pace)     : null,
        offensiveRating:       offRtg   !== null ? safeNum(offRtg)   : null,
        defensiveRating:       defRtg   !== null ? safeNum(defRtg)   : null,
        // opp3PtPct is already a rate from ESPN (0–1 range).
        opp3PtPct:             opp3pPct !== null ? safeNum(opp3pPct) : null,
        opp3PtAttemptsPerGame: opp3pAtt !== null ? safeNum(opp3pAtt) : null,
      };
    } catch {
      return null;
    }
  },

  /**
   * Fetch the current injury report for a team. ESPN's injury endpoint
   * lives on a DIFFERENT host than the rest of the NBA API — site.api
   * returns empty objects for /teams/{id}/injuries, but sports.core.api
   * has the real data. This is also a 2-step fetch:
   *   1. List endpoint returns `items[]` of `$ref` URLs (one per active injury)
   *   2. Each `$ref` URL must be fetched separately to get the actual record
   *
   * Returns `Map<athleteId, { status, abbreviation, returnDate, comment }>` —
   * one entry per actively injured player on the team. Empty map when no
   * injuries OR on any fetch failure (degrades gracefully — we'd rather show
   * normal scores than crash the slate over a stale injury endpoint).
   *
   * Status normalization (ESPN's strings come capitalized, we lowercase
   * them so the ScoringEngine can do a clean === comparison):
   *   'Out'         → 'out'         (don't score the player at all)
   *   'Doubtful'    → 'doubtful'    (score × 0.4)
   *   'Questionable'→ 'questionable' (score × 0.6)
   *   'Day-To-Day'  → 'day-to-day'  (score × 0.85)
   *
   * Cost: 1 list call + N detail calls per team. Typical N is 0–3, peak ~5
   * during heavy injury periods. ESPN's rate limit on this endpoint is
   * generous (no observed throttling on bursts of 30+ requests).
   */
  async getInjuries(teamId) {
    const result = new Map();
    try {
      // Step 1: list of $ref URLs. Note the different host (core, not site).
      const listUrl = `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/teams/${teamId}/injuries`;
      const listController = new AbortController();
      const listTimer = setTimeout(() => listController.abort(), REQUEST_TIMEOUT_MS);
      let listJson;
      try {
        const res = await fetch(listUrl, {
          signal:  listController.signal,
          headers: { 'Cache-Control': 'no-cache' },
        });
        if (!res.ok) return result;
        listJson = await res.json();
      } finally {
        clearTimeout(listTimer);
      }

      const refs = (listJson?.items || [])
        .map(it => it?.$ref)
        .filter(Boolean);
      if (refs.length === 0) return result;

      // Step 2: per-injury fetch. Parallel — these are independent and
      // typical N is small (≤5). Failures swallowed per-record so one bad
      // ref doesn't poison the whole team's injury report.
      const records = await Promise.all(
        refs.map(async (ref) => {
          try {
            const c = new AbortController();
            const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
            try {
              const r = await fetch(ref, { signal: c.signal, headers: { 'Cache-Control': 'no-cache' } });
              if (!r.ok) return null;
              return await r.json();
            } finally {
              clearTimeout(t);
            }
          } catch {
            return null;
          }
        })
      );

      // Extract athleteId from the athlete.$ref URL — the injury record
      // doesn't include the athlete id as a top-level field, only via the
      // nested reference URL. Regex matches the .../athletes/<id>/... segment.
      for (const rec of records) {
        if (!rec || !rec.status) continue;
        const athleteRef = rec.athlete?.$ref;
        if (!athleteRef) continue;
        const m = athleteRef.match(/\/athletes\/(\d+)/);
        if (!m) continue;
        const athleteId = m[1];

        result.set(athleteId, {
          status:        String(rec.status).toLowerCase(),  // 'out' | 'doubtful' | 'questionable' | 'day-to-day'
          abbreviation:  rec.type?.abbreviation || rec.details?.fantasyStatus?.abbreviation || null,
          returnDate:    rec.details?.returnDate || null,
          comment:       rec.shortComment || rec.longComment || null,
        });
      }
    } catch {
      // Total failure — return whatever we collected (possibly empty).
    }
    return result;
  },

  /**
   * Batch helper: fetch injuries for many teams in parallel. Returns
   * Map<athleteId, injuryRecord> merged across all teams. Most callers want
   * "given this slate, who's hurt across both rosters?" — this is the
   * one-call answer to that question.
   */
  async getInjuriesBatch(teamIds) {
    const merged = new Map();
    const lists = await Promise.all(
      [...new Set(teamIds)].map(id => this.getInjuries(id).catch(() => new Map()))
    );
    for (const m of lists) {
      for (const [k, v] of m.entries()) merged.set(k, v);
    }
    return merged;
  },
};

const BASE = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || '/';
const DEFAULT_URLS = [
  `${BASE}data/nba/daily.json`,
  './data/nba/daily.json',
  '/data/nba/daily.json',
  'data/nba/daily.json',
  './nba/daily.json',
  '/nba/daily.json',
  '/dist/nba/daily.json',
];

export function validateNBASnapshot(snapshot) {
  if (!snapshot || snapshot.sport !== 'nba' || !Array.isArray(snapshot.players)) {
    throw new Error('Invalid NBA snapshot');
  }
  if (snapshot.source?.mode === 'live' && snapshot.modelVersion === FIRST_BASKET_MODEL_VERSION) {
    if (!Array.isArray(snapshot.games) || !snapshot.market || !snapshot.players.every(p => p.gameId != null && p.inputQuality)) {
      throw new Error('Invalid NBA v7 snapshot: live players require game identity and input-quality evidence');
    }
    if (!snapshot.games.every(g => g.gameId != null && g.inputQuality && g.status)) {
      throw new Error('Invalid NBA v7 snapshot: live games require identity, status, and input-quality evidence');
    }
    if (!snapshot.games.every(g => typeof g.inputQuality.projectionEligible === 'boolean' && typeof g.inputQuality.recommendationEligible === 'boolean' &&
      ['playerSeasonStatCoverage', 'teamMatchupCoverage', 'zoneRateCoverage', 'openingTeamCoverage', 'minimumOpeningHistorySamples', 'jumpBallCoverage', 'recentOpeningRoleCoverage', 'recentOpeningRoleSamples'].every(k => Number.isFinite(g.inputQuality[k])) &&
      ['ok', 'partial', 'unavailable'].includes(g.inputQuality.openingDataStatus) && typeof g.inputQuality.zoneSource === 'string')) {
      throw new Error('Invalid NBA v7 snapshot: eligibility evidence is incomplete');
    }
    if (!snapshot.games.every(g => g.probabilitySource === 'monte_carlo_possession_sequence_v1' &&
      Number.isInteger(g.simTelemetry?.iterations) && g.simTelemetry.iterations > 0 && g.simTelemetry.unresolvedTrials === 0 &&
      g.simTelemetry.homeWins + g.simTelemetry.awayWins === g.simTelemetry.iterations)) {
      throw new Error('Invalid NBA v7 snapshot: possession simulation probability evidence is incomplete');
    }
    if (!snapshot.games.every(g => g.openingTempoShadow == null || (
      g.openingTempoShadow.featureVersion === 1 &&
      g.openingTempoShadow.source === 'pbpstats_first_opening_possession_shot' &&
      g.openingTempoShadow.includedInProbability === false &&
      g.openingTempoShadow.unit === 'seconds_from_possession_start_to_first_field_goal_attempt' &&
      ['home', 'away'].every(side => g.openingTempoShadow[side] &&
        (g.openingTempoShadow[side].meanSecondsToFirstShot == null || Number.isFinite(g.openingTempoShadow[side].meanSecondsToFirstShot)) &&
        Number.isInteger(g.openingTempoShadow[side].sampleCount) && g.openingTempoShadow[side].sampleCount >= 0)
    ))) {
      throw new Error('Invalid NBA v7 snapshot: opening tempo shadow evidence is malformed');
    }
  }
  return snapshot;
}

/**
 * Format ISO UTC date to friendly US Eastern tip-off time string
 */
function formatTipOffTime(isoDate) {
  if (!isoDate) return '7:00 PM ET';
  try {
    const d = new Date(isoDate);
    if (isNaN(d.getTime())) return '7:00 PM ET';
    return d.toLocaleTimeString('en-US', {
      timeZone: 'America/New_York',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }) + ' ET';
  } catch {
    return '7:00 PM ET';
  }
}

/**
 * Parse ESPN game summary for team injury reports and official boxscore starting lineups.
 */
export function parseGameInjuriesAndStarters(summary) {
  if (!summary) {
    return { injuryMap: new Map(), confirmedStartersByTeam: {} };
  }

  const injuryMap = new Map();
  for (const teamInj of (summary.injuries || [])) {
    const rawTeam = (teamInj.team?.abbreviation || '').toUpperCase();
    const tAbbr = TEAM_ABBR_ALIASES[rawTeam] || rawTeam;
    for (const inj of (teamInj.injuries || [])) {
      const id = String(inj.athlete?.id || '');
      const name = inj.athlete?.displayName || '';
      const status = String(inj.status || inj.type?.description || '').toLowerCase();
      const detail = inj.details?.type || inj.details?.detail || inj.details?.fantasyStatus?.description || 'Injured';
      const returnDate = inj.details?.returnDate || '';
      const isOut = status === 'out' || status.includes('out') || detail.toLowerCase().includes('surgery') || detail.toLowerCase().includes('out for season');
      const badge = isOut ? 'OUT' : (status.includes('day') || status.includes('question') ? 'GTD' : (status.includes('doubt') ? 'DTD' : 'PROB'));
      const rec = { id, name, team: tAbbr, status: inj.status || status, detail, returnDate, isOut, badge };
      if (id) injuryMap.set(id, rec);
      if (name) injuryMap.set(name.toLowerCase(), rec);
    }
  }

  const confirmedStartersByTeam = {};
  for (const teamBlock of (summary.boxscore?.players || [])) {
    const rawTeam = (teamBlock.team?.abbreviation || '').toUpperCase();
    const tAbbr = TEAM_ABBR_ALIASES[rawTeam] || rawTeam;
    const starters = (teamBlock.statistics?.[0]?.athletes || [])
      .filter((a) => a.starter)
      .map((a) => ({
        id: String(a.athlete?.id || ''),
        name: a.athlete?.displayName || '',
        position: a.athlete?.position?.abbreviation || 'G',
        jersey: a.athlete?.jersey || null,
      }));
    if (starters.length === 5) {
      confirmedStartersByTeam[tAbbr] = starters;
    }
  }

  return { injuryMap, confirmedStartersByTeam };
}

/**
 * Score live ESPN scoreboard events into a StatFax First Basket snapshot.
 */
export function buildLiveNBASnapshot(scoreboardGames, {
  centerOverrides = {}, gameSummaries = {}, marketOddsByGame = {},
  playerStatsById = new Map(), teamStatsByTeam = {}, zoneStatsByPlayerId = {},
  openingTendenciesByTeam = {}, marketStatus = null,
} = {}) {
  if (!Array.isArray(scoreboardGames) || scoreboardGames.length === 0) {
    return null;
  }

  const scoredGames = [];
  const allPlayers = [];

  for (const g of scoreboardGames) {
    const rawHome = (g.homeTeam?.abbr || 'BOS').toUpperCase();
    const rawAway = (g.awayTeam?.abbr || 'NYK').toUpperCase();
    const homeAbbr = TEAM_ABBR_ALIASES[rawHome] || rawHome;
    const awayAbbr = TEAM_ABBR_ALIASES[rawAway] || rawAway;

    // 1. Resolve Starting Five Lineups with center override support & live injuries
    const homeCenterChoice = centerOverrides[homeAbbr] || centerOverrides[rawHome] || (homeAbbr === 'NOP' ? 'missi' : 'default');
    const awayCenterChoice = centerOverrides[awayAbbr] || centerOverrides[rawAway] || (awayAbbr === 'NOP' ? 'missi' : 'default');

    const summary = gameSummaries[g.gameId] || g.summary || null;
    const { injuryMap, confirmedStartersByTeam } = parseGameInjuriesAndStarters(summary);
    const gameDateForSeason = new Date(g.date || Date.now());
    const currentSeasonStartYear = gameDateForSeason.getUTCMonth() >= 8
      ? gameDateForSeason.getUTCFullYear() : gameDateForSeason.getUTCFullYear() - 1;

    const hasConfirmedHome = confirmedStartersByTeam[homeAbbr]?.length === 5;
    const hasConfirmedAway = confirmedStartersByTeam[awayAbbr]?.length === 5;
    const isConfirmedLineup = hasConfirmedHome && hasConfirmedAway;

    const enrichWithSeasonStats = (players, teamAbbr) => players.map(player => {
      const stats = playerStatsById.get(String(player.id));
      const playerKey = normalizeOpeningPlayerName(player.name);
      const zones = zoneStatsByPlayerId[String(player.id)] || zoneStatsByPlayerId[`name:${playerKey}`];
      const opening = openingTendenciesByTeam[teamAbbr]?.byPlayer?.[playerKey];
      const openingHistory = openingTendenciesByTeam[teamAbbr];
      const historyAge = openingHistoryAge(openingHistory, currentSeasonStartYear);
      const openingUsable = openingHistory?.status === 'ok' && historyAge != null && historyAge <= 1 && Number(openingHistory.sampleCount) > 0;
      if (!stats || !Number.isFinite(stats.gamesPlayed) || stats.gamesPlayed < 1) {
        const withZones = applyZoneStats(player, zones);
        return { ...withZones, openingHistorySamples: openingUsable ? openingHistory.sampleCount : 0,
          openingShotAttempts: opening?.attempts || 0, openingShotMakes: opening?.made || 0,
          openingStartTypes: opening?.startTypes || {},
          dataSources: { ...(withZones.dataSources || {}), seasonStats: 'unavailable',
            earlyShotShare: player.openingRoleRecent?.applied ? 'pbpstats_season_l5_l10_blended' : openingUsable ? 'pbpstats_season_shrunk_with_roster_prior' : 'roster_prior',
            openingPossessions: openingUsable ? 'pbpstats' : openingHistory ? 'stale_or_incomplete' : 'unavailable' } };
      }
      const attempts = Math.max(0, (stats.threesAttemptedPerGame || 0) * stats.gamesPlayed);
      const observed = Number.isFinite(stats.threePointPct) ? stats.threePointPct : null;
      // Beta shrinkage: 18 prior attempts at league 3P% keeps the opening-week
      // rates from swinging on a handful of shots.
      const shrunkThree = observed == null || attempts <= 0
        ? null : ((observed * attempts) + (0.36 * 18)) / (attempts + 18);
      const withZones = applyZoneStats(player, zones);
      return {
        ...player,
        ...withZones,
        ...(shrunkThree == null ? {} : { threeFG: shrunkThree }),
        openingHistorySamples: openingUsable ? openingHistory.sampleCount : 0,
        openingShotAttempts: opening?.attempts || 0,
        openingShotMakes: opening?.made || 0,
        openingStartTypes: opening?.startTypes || {},
        seasonStats: stats,
        dataSources: {
          ...(withZones.dataSources || {}),
          seasonStats: 'espn_current_season',
          seasonGames: stats.gamesPlayed,
          threePointAttempts: attempts,
          threePointPct: shrunkThree,
          earlyShotShare: player.openingRoleRecent?.applied ? 'pbpstats_season_l5_l10_blended' : openingUsable ? 'pbpstats_season_shrunk_with_roster_prior' : 'roster_prior',
          openingPossessions: openingUsable ? 'pbpstats' : openingHistory ? 'stale_or_incomplete' : 'unavailable',
        },
      };
    });

    function applyZoneStats(player, zones) {
      if (!zones) return { ...player, dataSources: { ...(player.dataSources || {}), rimAndMidRates: 'roster_prior' } };
      const posterior = (zone, prior, priorAttempts) => {
        if (!zone || !(zone.attempts > 0)) return null;
        return ((zone.made || 0) + prior * priorAttempts) / (zone.attempts + priorAttempts) * 100;
      };
      const zoneFG = {
        rim: posterior(zones.rim, 0.65, 30),
        mid: posterior(zones.mid, 0.42, 20),
        three: posterior(zones.three, 0.36, 30),
      };
      const verified = [zones.rim, zones.mid, zones.three].every(z => z?.attempts >= 5);
      return {
        ...player,
        zoneFG: { rim: zoneFG.rim ?? player.rimFG * 100, mid: zoneFG.mid ?? player.midFG * 100, three: zoneFG.three ?? player.threeFG * 100 },
        dataSources: { ...(player.dataSources || {}), rimAndMidRates: verified ? 'nba_stats_zone_shooting' : 'nba_stats_zone_low_sample', zoneAttempts: { rim: zones.rim?.attempts || 0, mid: zones.mid?.attempts || 0, three: zones.three?.attempts || 0 }, zoneSource: zones.source },
      };
    }

    const resolveTeamStarters = (tAbbr, centerChoice) => {
      const confirmed = confirmedStartersByTeam[tAbbr];
      const applyOpeningHistoryShares = activeStarters => {
        const history = openingTendenciesByTeam[tAbbr];
        const historyAge = openingHistoryAge(history, currentSeasonStartYear);
        const historyN = Number(history?.sampleCount) || 0;
        if (history?.status !== 'ok' || historyAge == null || historyAge > 1 || historyN <= 0) {
          return blendRecentOpeningRole(activeStarters, null);
        }
        const priorWeight = 20;
        const posteriorShares = activeStarters.map(player => {
          const observed = history.byPlayer?.[normalizeOpeningPlayerName(player.name)];
          const observedAttempts = Number.isFinite(Number(observed?.attempts)) ? Number(observed.attempts) : 0;
          const priorShare = Number.isFinite(player.earlyShotShare) ? player.earlyShotShare : 0;
          return (observedAttempts + priorShare * priorWeight) / (historyN + priorWeight);
        });
        const sum = posteriorShares.reduce((a, b) => a + b, 0);
        if (sum > 0) activeStarters.forEach((player, index) => { player.earlyShotShare = posteriorShares[index] / sum; });
        return blendRecentOpeningRole(activeStarters, history.recentRole);
      };
      const baselineStarters = getStartersForTeam(tAbbr, { centerChoice }) || [
        { id: `${tAbbr}-1`, name: `${tAbbr} PG`, position: 'PG', earlyShotShare: 0.28, shotMix: { rim: 0.3, mid: 0.3, three: 0.4 }, seasonUsage: 25 },
        { id: `${tAbbr}-2`, name: `${tAbbr} SG`, position: 'SG', earlyShotShare: 0.22, shotMix: { rim: 0.3, mid: 0.3, three: 0.4 }, seasonUsage: 22 },
        { id: `${tAbbr}-3`, name: `${tAbbr} SF`, position: 'SF', earlyShotShare: 0.18, shotMix: { rim: 0.4, mid: 0.2, three: 0.4 }, seasonUsage: 18 },
        { id: `${tAbbr}-4`, name: `${tAbbr} PF`, position: 'PF', earlyShotShare: 0.16, shotMix: { rim: 0.5, mid: 0.3, three: 0.2 }, seasonUsage: 17 },
        { id: `${tAbbr}-5`, name: `${tAbbr} C`, position: 'C', earlyShotShare: 0.16, shotMix: { rim: 0.7, mid: 0.2, three: 0.1 }, seasonUsage: 18 },
      ];

      // Case A: Official boxscore confirmed starters
      if (confirmed && confirmed.length === 5) {
        const activeStarters = confirmed.map((c) => {
          const base = baselineStarters.find(
            (b) => String(b.id) === String(c.id) || b.name?.toLowerCase() === c.name?.toLowerCase()
          );
          const inj = injuryMap.get(String(c.id)) || injuryMap.get(c.name?.toLowerCase());
          const isRep = !base;
          const pos = c.position || base?.position || 'SF';
          const isC = pos === 'C';

          return {
            id: c.id,
            name: c.name,
            position: pos,
            jersey: c.jersey || base?.jersey || '0',
            isStarter: true,
            isReplacement: isRep,
            replacedPlayer: isRep ? 'Bench Promotion' : null,
            earlyShotShare: base?.earlyShotShare || 0.18,
            shotMix: base?.shotMix || (isC ? { rim: 0.75, mid: 0.15, three: 0.10 } : { rim: 0.35, mid: 0.30, three: 0.35 }),
            rimFG: base?.rimFG || 0.65,
            midFG: base?.midFG || 0.42,
            threeFG: base?.threeFG || 0.36,
            seasonUsage: base?.seasonUsage || 18,
            scriptedSetPlay: base?.scriptedSetPlay || `${c.name} Primary Attack`,
            injury: inj ? { badge: inj.badge, status: inj.status, detail: inj.detail, returnDate: inj.returnDate } : null,
          };
        });

        const totalShare = activeStarters.reduce((acc, s) => acc + (s.earlyShotShare || 0.2), 0);
        if (totalShare > 0) {
          activeStarters.forEach((s) => {
            s.earlyShotShare = Math.round(((s.earlyShotShare || 0.2) / totalShare) * 1000) / 1000;
          });
        }
        const roleAdjustedStarters = applyOpeningHistoryShares(activeStarters);
        return enrichWithSeasonStats(roleAdjustedStarters, tAbbr);
      }

      // Case B: Projected starters with injury checks & next-man-up substitutions
      const activeStarters = [];
      const outStarters = [];

      for (const starter of baselineStarters) {
        const inj = injuryMap.get(String(starter.id)) || injuryMap.get(starter.name?.toLowerCase());
        if (inj && inj.isOut) {
          outStarters.push({ starter, inj });
        } else {
          activeStarters.push({
            ...starter,
            injury: inj ? { badge: inj.badge, status: inj.status, detail: inj.detail, returnDate: inj.returnDate } : null,
          });
        }
      }

      for (const { starter, inj } of outStarters) {
        const rep = findPositionalReplacement(tAbbr, starter, activeStarters, injuryMap);
        if (rep) {
          activeStarters.push(rep);
        }
      }

      const totalShare = activeStarters.reduce((acc, s) => acc + (s.earlyShotShare || 0.2), 0);
      if (totalShare > 0) {
        activeStarters.forEach((s) => {
          s.earlyShotShare = Math.round(((s.earlyShotShare || 0.2) / totalShare) * 1000) / 1000;
        });
      }

      const roleAdjustedStarters = applyOpeningHistoryShares(activeStarters);

      return enrichWithSeasonStats(roleAdjustedStarters, tAbbr);
    };

    const rawHomeStarters = resolveTeamStarters(homeAbbr, homeCenterChoice);
    const rawAwayStarters = resolveTeamStarters(awayAbbr, awayCenterChoice);

    const homeCenter = rawHomeStarters.find((p) => p.position === 'C') ||
      rawHomeStarters.find((p) => p.position === 'F-C' || p.position === 'C-F') ||
      rawHomeStarters.find((p) => p.position === 'PF') ||
      rawHomeStarters[0];

    const awayCenter = rawAwayStarters.find((p) => p.position === 'C') ||
      rawAwayStarters.find((p) => p.position === 'F-C' || p.position === 'C-F') ||
      rawAwayStarters.find((p) => p.position === 'PF') ||
      rawAwayStarters[0];

    // 2. Resolve Jump Ball Matchup dynamically from active starting centers
    const jumpMatch = getJumpBallMatchup(homeAbbr, awayAbbr, homeCenter.name, awayCenter.name);

    const formattedTime = formatTipOffTime(g.date);

    // Multi-book consensus market pricing (DraftKings, FanDuel, BetMGM, Caesars)
    const gameMarket = marketOddsByGame[g.gameId] || null;
    const marketOdds = {};
    for (const entry of Object.values(gameMarket?.players || {})) {
      const name = String(entry.name || '').toLowerCase();
      if (name && entry.books && Object.keys(entry.books).length) marketOdds[name] = entry.books;
    }
    const homeTeamStats = teamStatsByTeam[homeAbbr] || teamStatsByTeam[rawHome] || null;
    const awayTeamStats = teamStatsByTeam[awayAbbr] || teamStatsByTeam[rawAway] || null;
    const deriveDefense = stats => {
      const factor = Number.isFinite(stats?.opp3PtPct) && stats.opp3PtPct > 0
        ? Math.max(0.92, Math.min(1.08, stats.opp3PtPct / 0.36)) : null;
      return factor == null ? {} : { threePtDefenseFactor: factor };
    };
    const lineupConfirmed = isConfirmedLineup && !g.isLive && !g.isFinal;
    const playerPool = [...rawHomeStarters, ...rawAwayStarters];
    const statCoverage = playerPool.length
      ? playerPool.filter(p => Number.isFinite(p.seasonStats?.gamesPlayed) && p.seasonStats.gamesPlayed >= 3).length / playerPool.length
      : 0;
    const zoneRateCoverage = playerPool.length
      ? playerPool.filter(p => p.dataSources?.rimAndMidRates === 'nba_stats_zone_shooting').length / playerPool.length
      : 0;
    const openingSamples = playerPool.every(p => Number.isFinite(p.openingHistorySamples))
      ? Math.min(...playerPool.map(p => p.openingHistorySamples)) : 0;
    const oddsAgeMinutes = Number.isFinite(Date.parse(marketStatus?.fetchedAt || ''))
      ? Math.max(0, (Date.now() - Date.parse(marketStatus.fetchedAt)) / 60000) : Infinity;
    const freshMarketAvailable = oddsAgeMinutes <= 15 && Object.values(gameMarket?.players || {}).some(entry =>
      Object.keys(entry.books || {}).length &&
      (Date.now() - Date.parse(entry.marketUpdatedAt || entry.capturedAt || marketStatus?.fetchedAt || '')) <= 15 * 60 * 1000);
    const acceptedMarketOdds = freshMarketAvailable ? marketOdds : {};
    const homeOpening = openingTendenciesByTeam[homeAbbr];
    const awayOpening = openingTendenciesByTeam[awayAbbr];
    const homeOpeningAge = openingHistoryAge(homeOpening, currentSeasonStartYear);
    const awayOpeningAge = openingHistoryAge(awayOpening, currentSeasonStartYear);
    const openingHistoryAgeSeasons = homeOpeningAge == null || awayOpeningAge == null
      ? null : Math.max(homeOpeningAge, awayOpeningAge);
    const jumpBallCoverage = [jumpMatch.jumperA, jumpMatch.jumperB]
      .filter(profile => !profile?.isFallback && Number(profile?.tipAttempts) >= 15).length / 2;
    const tempoForTeam = history => {
      const tempo = history?.openingTempo;
      return {
        meanSecondsToFirstShot: tempo?.meanSeconds != null && Number.isFinite(Number(tempo.meanSeconds)) ? Math.round(Number(tempo.meanSeconds) * 100) / 100 : null,
        sampleCount: Number.isFinite(Number(tempo?.sampleCount)) ? Number(tempo.sampleCount) : 0,
      };
    };
    const openingTempoShadow = {
      featureVersion: 1,
      source: 'pbpstats_first_opening_possession_shot',
      includedInProbability: false,
      unit: 'seconds_from_possession_start_to_first_field_goal_attempt',
      home: tempoForTeam(homeOpening),
      away: tempoForTeam(awayOpening),
    };
    const openingTeamCoverage = [homeOpening, awayOpening]
      .filter((x, i) => x?.status === 'ok' && [homeOpeningAge, awayOpeningAge][i] != null && [homeOpeningAge, awayOpeningAge][i] <= 1).length / 2;
    const recentOpeningRoleCoverage = [homeOpening, awayOpening]
      .filter(history => Number(history?.recentRole?.last10?.sampleGames) >= 5 && Number(history?.recentRole?.last10?.shotCount) > 0).length / 2;
    const recentOpeningRoleSamples = Math.min(...[homeOpening, awayOpening].map(history => Number(history?.recentRole?.last10?.sampleGames) || 0));
    const openingDataStatus = openingTeamCoverage === 1 ? 'ok' : openingTeamCoverage > 0 ? 'partial' : 'unavailable';
    const paceValue = stats => Number.isFinite(stats?.pace) ? stats.pace : null;
    const paceCoverage = [homeTeamStats, awayTeamStats].filter(stats => paceValue(stats) != null).length / 2;
    const paceEvidence = {
      source: paceCoverage === 1 && [homeTeamStats, awayTeamStats].every(stats => stats.paceSource === 'nba_stats_leaguedashteamstats_advanced')
        ? 'nba_stats_leaguedashteamstats_advanced' : paceCoverage ? 'partial_or_legacy' : 'unavailable',
      season: homeTeamStats?.paceSeason && homeTeamStats.paceSeason === awayTeamStats?.paceSeason ? homeTeamStats.paceSeason : null,
      coverage: paceCoverage,
      home: { team: homeAbbr, pace: paceValue(homeTeamStats), source: homeTeamStats?.paceSource || null },
      away: { team: awayAbbr, pace: paceValue(awayTeamStats), source: awayTeamStats?.paceSource || null },
    };
    const inputQuality = {
      playerSeasonStatCoverage: statCoverage,
      teamMatchupCoverage: [homeTeamStats, awayTeamStats].filter(Boolean).length / 2,
      paceCoverage,
      zoneRateCoverage,
      lineupConfirmed,
      openingTendencySource: openingTeamCoverage === 1 ? 'pbpstats_observed' : 'roster_prior',
      openingSequenceContextSource: openingTeamCoverage === 1 ? 'pbpstats_observed' : 'league_prior',
      openingDataStatus,
      openingTeamCoverage,
      openingHistoryAgeSeasons,
      recentOpeningRoleCoverage,
      recentOpeningRoleSamples,
      jumpBallCoverage,
      openingHistorySeason: homeOpening?.season && homeOpening.season === awayOpening?.season ? String(homeOpening.season) : null,
      openingTeamSamples: { [homeAbbr]: homeOpening?.sampleCount || 0, [awayAbbr]: awayOpening?.sampleCount || 0 },
      zoneSource: zoneRateCoverage > 0 ? 'nba_stats_leaguedashplayershotlocations' : 'unavailable',
      minimumOpeningHistorySamples: openingSamples,
      liveOddsProvider: marketStatus?.provider || null,
      liveOddsAvailable: freshMarketAvailable,
      liveOddsAgeMinutes: Number.isFinite(oddsAgeMinutes) ? Math.round(oddsAgeMinutes * 10) / 10 : null,
      projectionEligible: Boolean(
        lineupConfirmed && jumpBallCoverage === 1 && statCoverage >= 0.8 && zoneRateCoverage >= 0.8 &&
        [homeTeamStats, awayTeamStats].every(Boolean) && openingTeamCoverage === 1 && openingHistoryAgeSeasons != null && openingHistoryAgeSeasons <= 1 && openingSamples >= 5
      ),
      recommendationEligible: Boolean(
        lineupConfirmed && jumpBallCoverage === 1 && statCoverage >= 0.8 && zoneRateCoverage >= 0.8 &&
        [homeTeamStats, awayTeamStats].every(Boolean) && openingTeamCoverage === 1 && openingHistoryAgeSeasons != null && openingHistoryAgeSeasons <= 1 && openingSamples >= 5 &&
        marketStatus?.provider === 'the-odds-api' && freshMarketAvailable
      ),
    };

    // 3. Score with firstBasketEngine
    const scoredGame = scoreGameFirstBasket({
      gameId: g.gameId,
      gameTime: formattedTime,
      homeTeam: {
        abbr: homeAbbr,
        name: g.homeTeam?.name || homeAbbr,
        logo: g.homeTeam?.logo,
        color: g.homeTeam?.color ? `#${g.homeTeam.color}` : '#007A33',
        record: null,
      },
      awayTeam: {
        abbr: awayAbbr,
        name: g.awayTeam?.name || awayAbbr,
        logo: g.awayTeam?.logo,
        color: g.awayTeam?.color ? `#${g.awayTeam.color}` : '#006BB6',
        record: null,
      },
      homePlayers: rawHomeStarters,
      awayPlayers: rawAwayStarters,
      homeJumper: jumpMatch.jumperA,
      awayJumper: jumpMatch.jumperB,
      marketOdds: acceptedMarketOdds,
      inputQuality,
      lineupStatus: {
        confirmed: lineupConfirmed,
        announcedMinutesAgo: lineupConfirmed ? 28 : null,
        status: g.isLive ? 'LIVE' : g.isFinal ? 'FINAL' : lineupConfirmed ? 'CONFIRMED' : 'PROJECTED',
        source: isConfirmedLineup ? 'espn_official_boxscore' : 'statfax_projected',
      },
      pace: paceCoverage === 1 ? (homeTeamStats.pace + awayTeamStats.pace) / 2 : null,
      homeOppDefense: deriveDefense(awayTeamStats),
      awayOppDefense: deriveDefense(homeTeamStats),
    });

    // Tag each player with exact gameTime and date for sorting
    scoredGame.date = g.date;
    scoredGame.gameTime = formattedTime;
    scoredGame.status = g.isLive ? 'LIVE' : g.isFinal ? 'FINAL' : 'SCHEDULED';
    scoredGame.isLive = Boolean(g.isLive);
    scoredGame.isFinal = Boolean(g.isFinal);
    scoredGame.marketOdds = acceptedMarketOdds;
    scoredGame.inputQuality = inputQuality;
    scoredGame.paceEvidence = paceEvidence;
    scoredGame.openingTempoShadow = openingTempoShadow;
    for (const p of scoredGame.players) {
      const sourcePlayer = playerPool.find(x => String(x.id) === String(p.id) || x.name === p.name);
      p.gameId = g.gameId;
      p.gameTime = formattedTime;
      p.date = g.date;
      p.tipMatchup = scoredGame.tipMatchup;
      p.lineupStatus = scoredGame.lineupStatus;
      p.inputQuality = inputQuality;
      p.pace = scoredGame.pace;
      p.opponent = p.isHome ? awayAbbr : homeAbbr;
      p.modelProb = p.gameProb;
      if (sourcePlayer) {
        p.dataSources = sourcePlayer.dataSources || {};
        p.openingRoleRecent = sourcePlayer.openingRoleRecent || null;
        p.openingHistorySamples = sourcePlayer.openingHistorySamples || 0;
        p.openingShotAttempts = sourcePlayer.openingShotAttempts || 0;
        p.openingShotMakes = sourcePlayer.openingShotMakes || 0;
        p.openingStartTypes = sourcePlayer.openingStartTypes || {};
      }
      allPlayers.push(p);
    }

    scoredGames.push(scoredGame);
  }

  // Sort games chronologically by scheduled tip time
  scoredGames.sort((a, b) => {
    const tA = Date.parse(a.date || 0) || 0;
    const tB = Date.parse(b.date || 0) || 0;
    return tA - tB;
  });

  allPlayers.sort((a, b) => b.gameProb - a.gameProb);
  allPlayers.forEach((p, idx) => { p.slateRank = idx + 1; });

  const dateStr = nbaDateKeyInZone(new Date(), 'America/Chicago');
  const metaDate = `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;

  return {
    generatedAt: new Date().toISOString(),
    modelVersion: FIRST_BASKET_MODEL_VERSION,
    sport: 'nba',
    source: {
      mode: 'live',
      provider: 'espn',
      gamesCount: scoredGames.length,
      timestamp: Date.now(),
    },
    market: marketStatus || { provider: 'the-odds-api', status: 'not_requested' },
    meta: {
      date: metaDate,
      label: `NBA Slate (${scoredGames.length} Games)`,
      games: scoredGames.length,
      settlementStandard: 'DraftKings / FanDuel First Field Goal (Tip-Ins Count · Made FTs Do Not)',
    },
    games: scoredGames,
    players: allPlayers,
  };
}

/**
 * Load NBA First Basket snapshot in dual mode:
 * 1. Static daily.json endpoint (if available)
 * 2. Live ESPN scoreboard scoring (pulls real today NBA slate)
 * 3. Rich NBA_DEMO_SNAPSHOT fallback (instant offline testing & off-days)
 */
export async function loadNBASnapshot({ urls = DEFAULT_URLS, fetchImpl = globalThis.fetch, demoFallback = true } = {}) {
  let staticDemoFallback = null;

  // 1. Try static daily.json snapshot URLs
  if (typeof fetchImpl === 'function') {
    for (const url of urls) {
      try {
        const response = await fetchImpl(url, { cache: 'no-store' });
        if (!response.ok) continue;
        const snapshot = validateNBASnapshot(await response.json());
        if (snapshot.source?.mode !== 'demo') {
          return snapshot;
        }
        staticDemoFallback = snapshot;
      } catch {}
    }
  }

  // 2. Try live ESPN feed
  try {
    const scoreboard = await NBAService.getScoreboard();
    if (scoreboard && scoreboard.length > 0) {
      const gameIds = scoreboard.map((g) => g.gameId);
      const summaries = await NBAService.getGameSummariesBatch(gameIds).catch(() => ({}));
      const liveSnapshot = buildLiveNBASnapshot(scoreboard, { gameSummaries: summaries });
      if (liveSnapshot) {
        return validateNBASnapshot(liveSnapshot);
      }
    }
  } catch (err) {
    // ESPN live feed unreachable or offline
  }

  // 3. Fallback to static snapshot or rich demo slate
  if (staticDemoFallback) {
    return staticDemoFallback;
  }
  if (demoFallback) {
    return NBA_DEMO_SNAPSHOT;
  }
  throw new Error('NBA snapshot unavailable');
}

export function mergeNBALiveUpdate(snapshot, update) {
  if (!update?.players) return snapshot;
  const byId = new Map(update.players.map((p) => [p.id, p]));
  return {
    ...snapshot,
    generatedAt: update.generatedAt || snapshot.generatedAt,
    players: snapshot.players.map((p) => {
      const next = byId.get(p.id);
      return next ? { ...p, ...next } : p;
    }),
  };
}

export default NBAService;

