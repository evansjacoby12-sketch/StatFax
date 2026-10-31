/**
 * server/sports/nba/fetch-nba-slate.mjs
 *
 * Fetches tonight's live NBA slate from ESPN, builds the First Basket probability model,
 * groups games chronologically, ranks each team's starters, and writes dist/nba/daily.json.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import NBAService, { buildLiveNBASnapshot, validateNBASnapshot } from '../../../src/sports/nba/api/NBAService.js';
import NBA_DEMO_SNAPSHOT from '../../../src/sports/nba/data/demoSlate.js';
import { fetchFirstBasketOddsForGames } from './first-basket-odds.mjs';
import { fetchFirstBasketContext } from './first-basket-context.mjs';
import { appendPregamePredictions } from '../../../tools/firstBasketLog.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const OUTPUT_PATH = path.join(ROOT, 'dist', 'nba', 'daily.json');

export async function fetchNBASlate({ outPath = OUTPUT_PATH } = {}) {
  console.log('[fetch-nba-slate] Fetching live NBA scoreboard from ESPN...');
  let snapshot = null;

  try {
    const scoreboard = await NBAService.getScoreboard();
    if (scoreboard && scoreboard.length > 0) {
      console.log(`[fetch-nba-slate] Retrieved ${scoreboard.length} live games from ESPN. Fetching game summaries & injury reports...`);
      const gameIds = scoreboard.map((g) => g.gameId);
      const summaries = await NBAService.getGameSummariesBatch(gameIds).catch(() => ({}));
      const marketCachePath = path.join(ROOT, 'dist', 'nba', 'first-basket-odds.json');
      let oddsCache = null;
      try { oddsCache = JSON.parse(await fs.readFile(marketCachePath, 'utf8')); } catch {}
      const market = await fetchFirstBasketOddsForGames(scoreboard, { cached: oddsCache });
      if (['ok', 'partial', 'cached'].includes(market.status)) {
        await fs.mkdir(path.dirname(marketCachePath), { recursive: true });
        await fs.writeFile(marketCachePath, JSON.stringify(market, null, 2), 'utf8');
      }
      console.log(`[fetch-nba-slate] First-basket odds: ${market.status} (${market.coveredGames || 0} games covered)`);

      // Resolve today's active candidates, then pull live season stats for
      // those exact ESPN athlete IDs before producing the published scores.
      const candidates = buildLiveNBASnapshot(scoreboard, {
        gameSummaries: summaries,
        marketOddsByGame: market.games,
        marketStatus: market,
      });
      const playerIds = [...new Set((candidates?.players || []).map(p => String(p.id)).filter(id => /^\d+$/.test(id)))];
      const featureCachePath = path.join(ROOT, 'dist', 'nba', 'feature-cache.json');
      let featureCache = { playerStats: {}, teamStats: {}, zoneStats: {}, opening: {} };
      try { featureCache = JSON.parse(await fs.readFile(featureCachePath, 'utf8')); } catch {}
      const cacheAge = Date.now() - Date.parse(featureCache.fetchedAt || '');
      const cacheFresh = Number.isFinite(cacheAge) && cacheAge >= 0 && cacheAge < 6 * 60 * 60 * 1000;
      const cachedPlayers = cacheFresh ? (featureCache.playerStats || {}) : {};
      const cachedTeams = cacheFresh ? (featureCache.teamStats || {}) : {};
      const missingPlayerIds = playerIds.filter(id => !Object.hasOwn(cachedPlayers, id));
      const fetchedPlayerStats = await NBAService.getPlayerStatsBatch(missingPlayerIds).catch(() => new Map());
      for (const [id, stats] of fetchedPlayerStats) cachedPlayers[String(id)] = stats;
      const playerStatsById = new Map(Object.entries(cachedPlayers));
      const nbaContext = await fetchFirstBasketContext(scoreboard, {
        zoneCached: cacheFresh ? (featureCache.zoneStats || {}) : {},
        openingCached: featureCache.opening || {},
      });
      console.log(`[fetch-nba-slate] Shot zones: ${nbaContext.zoneStatus}; opening-possession history: ${nbaContext.openingStatus}`);
      const teamEntries = [...new Map(scoreboard.flatMap(g => [
        [g.homeTeam?.abbr, g.homeTeam?.id], [g.awayTeam?.abbr, g.awayTeam?.id],
      ]).filter(([abbr, id]) => abbr && id)).entries()];
      const teamStatsByTeam = { ...cachedTeams };
      const missingTeams = teamEntries.filter(([abbr]) => !Object.hasOwn(teamStatsByTeam, abbr));
      for (let i = 0; i < missingTeams.length; i += 4) {
        const batch = await Promise.all(missingTeams.slice(i, i + 4).map(async ([abbr, id]) =>
          [abbr, await NBAService.getTeamSeasonStats(id)]));
        for (const [abbr, stats] of batch) teamStatsByTeam[abbr] = stats;
      }
      await fs.mkdir(path.dirname(featureCachePath), { recursive: true });
      await fs.writeFile(featureCachePath, JSON.stringify({
        fetchedAt: cacheFresh ? featureCache.fetchedAt : new Date().toISOString(),
        playerStats: cachedPlayers,
        teamStats: teamStatsByTeam,
        zoneStats: nbaContext.zoneStatsByPlayerId,
        opening: {
          schemaVersion: 3,
          byPlayer: nbaContext.openingByPlayer,
          byTeam: nbaContext.openingByTeam,
          sampleCount: nbaContext.openingSamples,
          status: nbaContext.openingStatus,
          season: nbaContext.openingSeason,
          dataSeason: nbaContext.openingHistorySeason,
          fetchedAt: nbaContext.openingFetchedAt,
        },
      }, null, 2), 'utf8');
      console.log(`[fetch-nba-slate] Current player stats: ${[...playerStatsById.values()].filter(Boolean).length}/${playerIds.length}; team context: ${Object.keys(teamStatsByTeam).length}/${teamEntries.length}`);
      console.log(`[fetch-nba-slate] Scoring first-basket projections with official lineups where available...`);
      const liveSnap = buildLiveNBASnapshot(scoreboard, {
        gameSummaries,
        marketOddsByGame: market.games,
        marketStatus: market,
        playerStatsById,
        teamStatsByTeam,
        zoneStatsByPlayerId: nbaContext.zoneStatsByPlayerId,
        openingTendenciesByTeam: nbaContext.openingByTeam,
      });
      if (liveSnap && liveSnap.games && liveSnap.games.length > 0) {
        snapshot = validateNBASnapshot(liveSnap);
      }
    }
  } catch (err) {
    console.warn('[fetch-nba-slate] ESPN live feed error:', err.message);
  }

  if (!snapshot) {
    console.log('[fetch-nba-slate] Using benchmark NBA First Basket slate fallback.');
    snapshot = validateNBASnapshot(NBA_DEMO_SNAPSHOT);
  }

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(snapshot, null, 2), 'utf8');
  const evaluationLog = appendPregamePredictions(snapshot);
  if (evaluationLog.written) {
    console.log(`[fetch-nba-slate] Logged ${evaluationLog.written} changed pregame snapshot(s) for evaluation.`);
  }

  console.log(`\n==========================================================================================`);
  console.log(` STATFAX NBA FIRST BASKET SLATE -- SAVED TO ${outPath}`);
  console.log(` Games: ${snapshot.games.length} | Starters: ${snapshot.players.length} | Mode: ${snapshot.source?.mode || 'live'}`);
  console.log(`==========================================================================================`);

  // Display auto-locked top 5 picks per game sorted chronologically
  for (const game of snapshot.games) {
    const gamePlayers = snapshot.players
      .filter((p) => p.gameId === game.gameId)
      .sort((a, b) => (b.gameProb || b.modelProb || 0) - (a.gameProb || a.modelProb || 0));
    const top5 = gamePlayers.slice(0, 5);
    const tip = game.tipMatchup;
    const tipProbA = Math.round((tip?.tipProbA ?? tip?.winProbA ?? 0.5) * 100);
    const tipProbB = Math.round((tip?.tipProbB ?? tip?.winProbB ?? 0.5) * 100);
    const tipNameA = tip?.jumperA?.jumper || tip?.jumperA?.name || 'Center A';
    const tipNameB = tip?.jumperB?.jumper || tip?.jumperB?.name || 'Center B';
    const tipText = `${tipNameA} (${tipProbA}%) vs ${tipNameB} (${tipProbB}%)`;

    const simSummary = game.simTelemetry ? ` | ${game.simTelemetry.iterations}-trial simulation: ${game.homeTeam.abbr} ${game.simTelemetry.homePct} - ${game.awayTeam.abbr} ${game.simTelemetry.awayPct}` : '';
    console.log(`\n🏀 ${game.awayTeam.abbr} @ ${game.homeTeam.abbr} (${game.gameTime || 'TBD'}) -- Tip: ${tipText}${simSummary}`);
    top5.forEach((p, idx) => {
      const prob = p.gameProb ?? p.modelProb ?? 0;
      const fair = p.fairOdds ? (String(p.fairOdds).startsWith('+') ? String(p.fairOdds) : (Number(p.fairOdds) > 0 ? `+${p.fairOdds}` : `${p.fairOdds}`)) : 'N/A';
      const odds = p.sportsbookOdds ? (p.sportsbookOdds > 0 ? `+${p.sportsbookOdds}` : `${p.sportsbookOdds}`) : 'N/A';
      const ciText = p.ci90 ? ` [MC90 sampling range: ${p.ci90.lower}%-${p.ci90.upper}%]` : '';
      const simText = p.simWins != null ? ` | Sim: ${p.simWins}/${p.simTotal} (${p.simPct})` : '';
      console.log(`   ${idx + 1}. [${p.team || 'NBA'}] ${p.name.padEnd(24)} GameProb: ${(prob * 100).toFixed(1)}%${ciText.padEnd(16)}${simText} | Fair: ${fair} | Early Look: ${Math.round((p.earlyShotShare || 0.25) * 100)}% | USG: ${p.seasonUsage || 20}%`);
    });
  }

  console.log(`\n==========================================================================================\n`);
  return snapshot;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  fetchNBASlate().catch((err) => {
    console.error('[fetch-nba-slate] Failed:', err);
    process.exit(1);
  });
}
