/**
 * fetch-nba-odds.mjs — NBA player prop odds via SportsGameOdds API
 *
 * Standalone server script invoked by .github/workflows/slate-cron.yml
 * alongside fetch-slate.mjs (MLB). Writes `dist/nba-odds.json` which the
 * R2 upload step pushes to `nba/odds.json` on the public bucket.
 *
 * Markets pulled (mirror our 4 NBA prop types):
 *   - points          → 20+ Pts and 30+ Pts props
 *   - threePointersMade  → 3+ Made Threes prop
 *   (First Basket isn't broadly priced; skipped intentionally — the engine
 *    edge on FB is structurally low anyway since books juice these heavily.)
 *
 * Output shape (nba-odds.json):
 *   {
 *     date:        'YYYY-MM-DD',
 *     generatedAt: ISO timestamp,
 *     status:      'ok' | 'no_key' | 'sgo_http_XXX' | 'empty',
 *     games: [
 *       {
 *         eventId:  'sgo-event-id',
 *         awayAbbr: 'CLE',  homeAbbr: 'NYK',
 *         playerProps: {
 *           [normalizedName]: {
 *             name: 'Jalen Brunson',
 *             points: {
 *               line: 28.5,
 *               overAmerican: -110, underAmerican: -110,
 *               books: { draftkings: {...}, fanduel: {...}, ... }
 *             },
 *             threes: { line: 3.5, ... }
 *           }
 *         }
 *       }
 *     ]
 *   }
 *
 * Client-side matching:
 *   NBAHomeScreen normalizes its ESPN-rendered player name the same way
 *   (lowercase, strip Jr./Sr./II/III, collapse whitespace) so the key
 *   lookup is exact. Failed matches just mean no Vegas line shown — score
 *   still renders, edge display hidden.
 *
 * Required env:
 *   SPORTSGAMEODDS_API_KEY  — same key already used for MLB
 *
 * Exit codes:
 *   0 — wrote nba-odds.json (with or without data)
 *   1 — script errored (network, parse, etc); R2 upload step skips on this
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const SGO_BASE = 'https://api.sportsgameodds.com/v2';
const SGO_API_KEY = process.env.SPORTSGAMEODDS_API_KEY;

// Books we surface client-side. Match the MLB list so the modal can
// reuse the same per-book rendering pattern if we ever build it.
const SGO_BOOKS = ['draftkings', 'fanduel', 'betmgm', 'caesars', 'betrivers'];

// Player name normalizer — collapses whitespace, strips suffixes, lowercases.
// Used as the key in playerProps so a client-side lookup by ESPN-fetched
// name resolves cleanly even when SGO has slight name variants.
function normalizeName(raw) {
  if (!raw) return '';
  return String(raw).toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '');
}

// "Today" in America/Chicago — same convention StatFax uses everywhere
// else. NBA odds are per-day so getting the right date matters.
function todayCT() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

async function fetchNBAOdds() {
  if (!SGO_API_KEY) {
    console.warn('[nba-odds] SPORTSGAMEODDS_API_KEY not set — skipping');
    return { status: 'no_key', games: [] };
  }

  let data;
  try {
    // limit=50 covers a full NBA night (max 15 games × 24 players each
    // would exceed 50 EVENTS but we only need 1 event per game, and each
    // event has nested player props). NBA never has more than 15 games
    // in a single window; 50-event cap is comfortable.
    const url = `${SGO_BASE}/events?leagueID=NBA&oddsAvailable=true&limit=50`;
    const res = await fetch(url, {
      headers: { 'X-Api-Key': SGO_API_KEY, 'Accept': 'application/json' },
    });
    if (!res.ok) {
      console.warn(`[nba-odds] HTTP ${res.status}`);
      return { status: `sgo_http_${res.status}`, games: [] };
    }
    data = await res.json();
  } catch (e) {
    console.warn(`[nba-odds] fetch threw: ${e?.message || e}`);
    return { status: 'sgo_threw', games: [] };
  }

  const events = Array.isArray(data?.data) ? data.data : [];
  console.log(`[nba-odds] received ${events.length} events`);

  const games = [];
  let totalProps = 0;

  for (const e of events) {
    const homeAbbr = e.teams?.home?.names?.abbreviation || e.teams?.home?.names?.short || null;
    const awayAbbr = e.teams?.away?.names?.abbreviation || e.teams?.away?.names?.short || null;

    // playerProps keyed by normalized name — client looks up by the same
    // normalization applied to the ESPN-fetched player name.
    const playerProps = {};

    for (const [oddID, market] of Object.entries(e.odds || {})) {
      // We only care about points over/under and 3PM over/under markets.
      // Skip everything else (rebounds, assists, etc) for v1 — we don't
      // model those, no need to ship the bytes.
      //
      // oddID patterns (verified from SGO docs):
      //   points-{PLAYER_ID}-game-ou-over           → points over
      //   points-{PLAYER_ID}-game-ou-under          → points under
      //   threePointersMade-{PLAYER_ID}-game-ou-over → 3PM over
      const isPointsOver  = oddID.startsWith('points-')           && oddID.endsWith('-game-ou-over');
      const isThreesOver  = oddID.startsWith('threePointersMade-') && oddID.endsWith('-game-ou-over');
      if (!isPointsOver && !isThreesOver) continue;

      const playerID = market.playerID || market.statEntityID;
      const player   = e.players?.[playerID];
      const name     = player?.name;
      if (!name) continue;
      const key = normalizeName(name);
      if (!key) continue;

      // Pull the line value — SGO stores this on the market or per-bookmaker.
      // Different books occasionally have different lines for the same player
      // (line shopping arbitrage opportunities), but we just need a
      // representative value for the matchedAt comparison.
      // `pointsScored.handicap` is where SGO puts the over-line.
      const line = Number.isFinite(market.bookOdds?.[0]?.spread)
        ? market.bookOdds[0].spread
        : (Number.isFinite(market.spread) ? market.spread : null);

      // Find the matching under market so we can de-juice. Look up the
      // sibling under-oddID with the same player+stat.
      const underOddID = oddID.replace('-over', '-under');
      const underMarket = e.odds?.[underOddID];

      // Average odds across books we care about — gives a reasonable
      // central value for edge computation. We also keep per-book for
      // future "best line shopping" UI if ever added.
      const books = {};
      let overAmericanSum = 0, overCount = 0;
      for (const [bookKey, info] of Object.entries(market.byBookmaker || {})) {
        if (!SGO_BOOKS.includes(bookKey)) continue;
        if (info.available === false) continue;
        const american = parseInt(String(info.odds).replace(/[^\d+-]/g, ''), 10);
        if (!Number.isFinite(american)) continue;
        const bookLine = Number.isFinite(info.spread) ? info.spread : line;
        books[bookKey] = {
          american,
          line:     bookLine,
          deeplink: info.deeplink || null,
        };
        overAmericanSum += american;
        overCount++;
      }
      const overAmerican = overCount ? Math.round(overAmericanSum / overCount) : null;

      // Same for under side (for de-juicing).
      let underAmericanSum = 0, underCount = 0;
      for (const [bookKey, info] of Object.entries(underMarket?.byBookmaker || {})) {
        if (!SGO_BOOKS.includes(bookKey)) continue;
        if (info.available === false) continue;
        const american = parseInt(String(info.odds).replace(/[^\d+-]/g, ''), 10);
        if (!Number.isFinite(american)) continue;
        underAmericanSum += american;
        underCount++;
      }
      const underAmerican = underCount ? Math.round(underAmericanSum / underCount) : null;

      const propType = isPointsOver ? 'points' : 'threes';

      if (!playerProps[key]) {
        playerProps[key] = { name };
      }
      playerProps[key][propType] = {
        line,
        overAmerican,
        underAmerican,
        books,
      };
      totalProps++;
    }

    if (Object.keys(playerProps).length === 0) continue;
    games.push({
      eventId: e.eventID,
      homeAbbr,
      awayAbbr,
      playerProps,
    });
  }

  console.log(`[nba-odds] matched ${games.length} games / ${totalProps} props`);
  return {
    status: games.length ? `ok_${games.length}` : 'empty',
    games,
  };
}

async function main() {
  const date = todayCT();
  const result = await fetchNBAOdds();
  const payload = {
    date,
    generatedAt: new Date().toISOString(),
    status:      result.status,
    games:       result.games,
  };

  const outDir  = path.resolve(process.cwd(), 'dist');
  const outPath = path.join(outDir, 'nba-odds.json');
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');

  const sizeKb = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(`[nba-odds] wrote ${outPath} (${sizeKb} KB, ${result.games.length} games, status=${result.status})`);
}

main().catch(e => {
  console.error('[nba-odds] fatal:', e);
  process.exit(1);
});
