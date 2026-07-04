/**
 * theOddsApi.mjs — MLB "to hit a home run" props via The Odds API
 * (the-odds-api.com, market: batter_home_runs).
 *
 * Credit economics: the /events list is free; each per-event odds call costs
 * regions × markets = 1 credit. A 15-game slate ≈ 15 credits per refresh, so
 * the caller (fetch-slate) caches the snapshot and refreshes on a timer
 * instead of every cron run.
 *
 * Output matches the shape the UI's data.js buildOddsIndex() already expects:
 *   { [gamePk]: { books: { fanduel: { 'Aaron Judge': { american, decimal } } } } }
 */

const BASE = 'https://api.the-odds-api.com/v4/sports/baseball_mlb';
// Take EVERY us-region book — restricting bookmakers saves no credits (cost
// is per market × region), and on 2026-07-04 the big four's prop feeds came
// back empty while books' own apps had prices. More books = better best-price
// coverage too. williamhill_us is Caesars' API key; unknown keys pass through
// (the UI's bookLabel falls back to the raw key).
const BOOK_KEY = { williamhill_us: 'caesars' };

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

function americanToDecimal(a) {
  if (!Number.isFinite(a)) return null;
  if (a >= 100) return 1 + a / 100;
  if (a <= -100) return 1 + 100 / -a;
  return null;
}

/**
 * Fetch HR props for today's games. Returns { oddsByGamePk, remaining, priced }.
 * Skips events that already started (books pull HR props at first pitch, and
 * the credit is better saved). Doubleheaders resolve by closest start time.
 */
export async function fetchHROdds(apiKey, games) {
  const evRes = await fetch(`${BASE}/events?apiKey=${apiKey}&dateFormat=iso`);
  if (!evRes.ok) throw new Error(`events HTTP ${evRes.status}`);
  const events = await evRes.json();

  // Map matchup → candidate gamePks (array: doubleheaders share team pairs).
  const byMatch = new Map();
  for (const g of games || []) {
    const k = `${norm(g.homeTeam?.name)}|${norm(g.awayTeam?.name)}`;
    if (!byMatch.has(k)) byMatch.set(k, []);
    byMatch.get(k).push({ gamePk: g.gamePk, t: Date.parse(g.gameDate) });
  }

  const oddsByGamePk = {};
  let remaining = null;
  let priced = 0;
  let matched = 0;
  let debugSample = null; // raw response snippet when nothing prices — diagnosis aid
  for (const ev of events || []) {
    const cands = byMatch.get(`${norm(ev.home_team)}|${norm(ev.away_team)}`);
    if (!cands?.length) continue;
    const evT = Date.parse(ev.commence_time);
    if (Number.isFinite(evT) && evT < Date.now() - 5 * 60_000) continue; // started — props offboard
    const pick = cands.slice().sort((a, b) => Math.abs(a.t - evT) - Math.abs(b.t - evT))[0];

    const r = await fetch(
      `${BASE}/events/${ev.id}/odds?apiKey=${apiKey}&regions=us&markets=batter_home_runs&oddsFormat=american`,
    );
    remaining = r.headers.get('x-requests-remaining') ?? remaining;
    if (!r.ok) {
      if (!debugSample) debugSample = `HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`;
      continue;
    }
    matched++;
    const data = await r.json();
    if (!debugSample) debugSample = JSON.stringify(data).slice(0, 600);

    const books = {};
    for (const bm of data.bookmakers || []) {
      const bookKey = BOOK_KEY[bm.key] || bm.key;
      const market = (bm.markets || []).find((m) => m.key === 'batter_home_runs');
      if (!market) continue;
      const players = {};
      for (const o of market.outcomes || []) {
        if (o.name !== 'Over') continue;                 // "to hit a HR" = Over 0.5
        if (o.point != null && o.point > 0.5) continue;  // skip 1.5+ alt lines
        const american = Math.round(o.price);
        const decimal = americanToDecimal(american);
        if (!decimal || !o.description) continue;
        players[o.description] = { american, decimal };
      }
      if (Object.keys(players).length) books[bookKey] = players;
    }
    if (Object.keys(books).length) {
      oddsByGamePk[pick.gamePk] = { books };
      priced++;
    }
  }
  return { oddsByGamePk, remaining, priced, matched, debugSample };
}
