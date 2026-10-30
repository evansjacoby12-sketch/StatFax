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
      console.log(`[fetch-nba-slate] Scoring First Basket model with confirmed lineups and injury adjustments...`);
      const liveSnap = buildLiveNBASnapshot(scoreboard, { gameSummaries: summaries });
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

    console.log(`\n🏀 ${game.awayTeam.abbr} @ ${game.homeTeam.abbr} (${game.gameTime || 'TBD'}) -- Tip: ${tipText}`);
    top5.forEach((p, idx) => {
      const prob = p.gameProb ?? p.modelProb ?? 0;
      const fair = p.fairOdds ? (String(p.fairOdds).startsWith('+') ? String(p.fairOdds) : (Number(p.fairOdds) > 0 ? `+${p.fairOdds}` : `${p.fairOdds}`)) : 'N/A';
      const odds = p.sportsbookOdds ? (p.sportsbookOdds > 0 ? `+${p.sportsbookOdds}` : `${p.sportsbookOdds}`) : 'N/A';
      const ciText = p.ci90 ? ` [CI: ${p.ci90.lower}%-${p.ci90.upper}%]` : '';
      console.log(`   ${idx + 1}. [${p.team || 'NBA'}] ${p.name.padEnd(24)} GameProb: ${(prob * 100).toFixed(1)}%${ciText.padEnd(16)} | Fair: ${fair} | Early Look: ${Math.round((p.earlyShotShare || 0.25) * 100)}% | USG: ${p.seasonUsage || 20}%`);
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
