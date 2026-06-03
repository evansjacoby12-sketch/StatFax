/**
 * compute_roof_rates.mjs — empirical retractable-roof open-rate computor.
 *
 * For each of the 7 MLB retractable-roof parks, pulls recent home games and
 * reads the roof state from the live feed (gameData.weather.condition — the
 * same field fetchRoofState() uses), then prints the fraction played roof-open.
 *
 * The output feeds `roofOpenRate` in src/sports/mlb/data/stadiums.json, which
 * the env model uses as the PRE-GAME default when the live feed hasn't yet
 * reported the roof (roofClosed == null): parks that are usually open default
 * to outdoor weather, the rest stay indoor.
 *
 * These rates are SEASONAL — hot-climate parks (HOU/MIA/TEX) close for A/C in
 * summer, temperate parks (SEA/TOR/MIL) open more in warm weather. Re-run
 * monthly-ish and update stadiums.json. Run: `node server/tools/compute_roof_rates.mjs`
 */

const V1  = 'https://statsapi.mlb.com/api/v1';
const V11 = 'https://statsapi.mlb.com/api/v1.1';

// Retractable-roof parks → MLB team id.
const TEAMS = { ARI: 109, HOU: 117, MIA: 146, MIL: 158, SEA: 136, TEX: 140, TOR: 141 };

// Window: the trailing ~6 weeks of the current season.
const START = process.argv[2] || '2026-04-15';
const END   = process.argv[3] || '2026-06-01';

async function getJson(url) {
  try { const r = await fetch(url); if (!r.ok) return null; return await r.json(); }
  catch { return null; }
}

const out = {};
for (const [abbr, id] of Object.entries(TEAMS)) {
  const sched = await getJson(`${V1}/schedule?sportId=1&teamId=${id}&startDate=${START}&endDate=${END}&gameType=R`);
  const games = (sched?.dates || [])
    .flatMap(d => d.games || [])
    .filter(g => g.teams?.home?.team?.id === id && g.status?.abstractGameState === 'Final');
  let open = 0, closed = 0;
  for (const g of games) {
    const feed = await getJson(`${V11}/game/${g.gamePk}/feed/live`);
    const cond = (feed?.gameData?.weather?.condition || '').toLowerCase();
    if (!cond) continue;
    if (cond.includes('roof closed') || cond === 'dome') closed++; else open++;
  }
  const tot = open + closed;
  const rate = tot ? +(open / tot).toFixed(2) : null;
  out[abbr] = rate;
  console.log(`${abbr} (${id}): ${tot} home games · open=${open} closed=${closed} · roofOpenRate=${rate}`);
}
console.log('\nstadiums.json roofOpenRate values:', JSON.stringify(out));
