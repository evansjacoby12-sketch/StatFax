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

export function americanToDecimal(a) {
  if (!Number.isFinite(a)) return null;
  if (a >= 100) return 1 + a / 100;
  if (a <= -100) return 1 + 100 / -a;
  return null;
}

const median = (values) => {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

function matchEventsToGames(events, games) {
  const gamesByMatch = new Map();
  for (const game of games || []) {
    const key = `${norm(game.homeTeam?.name)}|${norm(game.awayTeam?.name)}`;
    if (!gamesByMatch.has(key)) gamesByMatch.set(key, []);
    gamesByMatch.get(key).push({ game, time: Date.parse(game.gameDate) });
  }

  const eventsByMatch = new Map();
  for (const event of events || []) {
    const key = `${norm(event.home_team)}|${norm(event.away_team)}`;
    if (!eventsByMatch.has(key)) eventsByMatch.set(key, []);
    eventsByMatch.get(key).push({ event, time: Date.parse(event.commence_time) });
  }

  const matched = new Map();
  for (const [key, eventRows] of eventsByMatch) {
    const gameRows = gamesByMatch.get(key) || [];
    const candidates = [];
    for (const eventRow of eventRows) {
      for (const gameRow of gameRows) {
        const distance = Number.isFinite(eventRow.time) && Number.isFinite(gameRow.time)
          ? Math.abs(eventRow.time - gameRow.time)
          : Number.MAX_SAFE_INTEGER;
        candidates.push({ ...eventRow, ...gameRow, distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const usedEvents = new Set();
    const usedGames = new Set();
    for (const candidate of candidates) {
      if (usedEvents.has(candidate.event.id) || usedGames.has(candidate.game.gamePk)) continue;
      usedEvents.add(candidate.event.id);
      usedGames.add(candidate.game.gamePk);
      matched.set(candidate.event.id, candidate.game);
    }
  }
  return matched;
}

function pricedOutcome(outcome) {
  const american = Math.round(Number(outcome?.price));
  const decimal = americanToDecimal(american);
  if (!decimal) return null;
  return { american, decimal, impliedProbability: 1 / decimal };
}

function fairPair(first, second) {
  if (!first || !second) return null;
  const total = first.impliedProbability + second.impliedProbability;
  if (!(total > 0)) return null;
  return {
    first: first.impliedProbability / total,
    second: second.impliedProbability / total,
  };
}

function consensusMoneyline(books) {
  const rows = [];
  for (const book of Object.values(books)) {
    const market = book.moneyline;
    const fair = fairPair(market?.away, market?.home);
    if (fair) rows.push({ ...market, fair });
  }
  if (!rows.length) return null;
  const awayFair = rows.reduce((sum, row) => sum + row.fair.first, 0) / rows.length;
  const homeFair = rows.reduce((sum, row) => sum + row.fair.second, 0) / rows.length;
  return {
    books: rows.length,
    away: {
      american: Math.round(median(rows.map((row) => row.away.american))),
      decimal: median(rows.map((row) => row.away.decimal)),
      impliedProbability: median(rows.map((row) => row.away.impliedProbability)),
      fairProbability: awayFair,
    },
    home: {
      american: Math.round(median(rows.map((row) => row.home.american))),
      decimal: median(rows.map((row) => row.home.decimal)),
      impliedProbability: median(rows.map((row) => row.home.impliedProbability)),
      fairProbability: homeFair,
    },
  };
}

function consensusTotal(books) {
  const complete = Object.values(books)
    .map((book) => book.total)
    .filter((market) => market && fairPair(market.over, market.under));
  if (!complete.length) return null;

  const counts = new Map();
  for (const market of complete) {
    const key = Number(market.line).toFixed(2);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const midpoint = median(complete.map((market) => market.line));
  const line = Number([...counts.entries()].sort((a, b) => (
    b[1] - a[1] || Math.abs(Number(a[0]) - midpoint) - Math.abs(Number(b[0]) - midpoint)
  ))[0][0]);
  const rows = complete
    .filter((market) => Math.abs(market.line - line) < 0.001)
    .map((market) => ({ ...market, fair: fairPair(market.over, market.under) }));
  const overFair = rows.reduce((sum, row) => sum + row.fair.first, 0) / rows.length;
  const underFair = rows.reduce((sum, row) => sum + row.fair.second, 0) / rows.length;
  return {
    line,
    books: rows.length,
    over: {
      american: Math.round(median(rows.map((row) => row.over.american))),
      decimal: median(rows.map((row) => row.over.decimal)),
      impliedProbability: median(rows.map((row) => row.over.impliedProbability)),
      fairProbability: overFair,
    },
    under: {
      american: Math.round(median(rows.map((row) => row.under.american))),
      decimal: median(rows.map((row) => row.under.decimal)),
      impliedProbability: median(rows.map((row) => row.under.impliedProbability)),
      fairProbability: underFair,
    },
  };
}

/**
 * Convert The Odds API's main MLB odds response into gamePk-keyed markets.
 * Event-to-game assignment is one-to-one within a matchup, so doubleheaders
 * cannot collapse onto the same MLB gamePk.
 */
export function parseGameOdds(events, games) {
  const matches = matchEventsToGames(events, games);
  const gameOddsByGamePk = {};
  let matched = 0;
  for (const event of events || []) {
    const game = matches.get(event.id);
    if (!game) continue;
    matched++;
    const books = {};
    for (const bookmaker of event.bookmakers || []) {
      const bookKey = BOOK_KEY[bookmaker.key] || bookmaker.key;
      const book = {
        title: bookmaker.title || bookKey,
        updatedAt: bookmaker.last_update || null,
      };
      const moneyline = (bookmaker.markets || []).find((market) => market.key === 'h2h');
      if (moneyline) {
        const away = pricedOutcome((moneyline.outcomes || []).find((outcome) => norm(outcome.name) === norm(event.away_team)));
        const home = pricedOutcome((moneyline.outcomes || []).find((outcome) => norm(outcome.name) === norm(event.home_team)));
        if (away && home) book.moneyline = { away, home };
      }
      const total = (bookmaker.markets || []).find((market) => market.key === 'totals');
      if (total) {
        const overOutcome = (total.outcomes || []).find((outcome) => String(outcome.name).toLowerCase() === 'over');
        const underOutcome = (total.outcomes || []).find((outcome) => String(outcome.name).toLowerCase() === 'under');
        const over = pricedOutcome(overOutcome);
        const under = pricedOutcome(underOutcome);
        const line = Number(overOutcome?.point ?? underOutcome?.point);
        if (over && under && Number.isFinite(line) && line > 0) book.total = { line, over, under };
      }
      if (book.moneyline || book.total) books[bookKey] = book;
    }
    if (!Object.keys(books).length) continue;
    gameOddsByGamePk[game.gamePk] = {
      eventId: event.id,
      commenceTime: event.commence_time,
      books,
      consensus: {
        moneyline: consensusMoneyline(books),
        total: consensusTotal(books),
      },
    };
  }
  return { gameOddsByGamePk, matched, priced: Object.keys(gameOddsByGamePk).length };
}

/**
 * Fetch MLB moneyline and total markets in one main-endpoint request. The API
 * charges regions × markets, so this costs two credits for the US region.
 */
export async function fetchGameOdds(apiKey, games) {
  const response = await fetch(
    `${BASE}/odds?apiKey=${apiKey}&regions=us&markets=h2h,totals&oddsFormat=american&dateFormat=iso`,
  );
  const remaining = response.headers.get('x-requests-remaining');
  if (!response.ok) throw new Error(`game odds HTTP ${response.status}`);
  const events = await response.json();
  return { ...parseGameOdds(events, games), remaining };
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
