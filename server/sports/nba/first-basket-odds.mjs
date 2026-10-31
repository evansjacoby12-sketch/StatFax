const API_BASE = 'https://api.the-odds-api.com/v4/sports/basketball_nba';

export function normalizeMarketName(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '');
}

const americanPrice = value => {
  const n = Number(value);
  return Number.isInteger(n) && n !== 0 ? (n > 0 ? `+${n}` : String(n)) : null;
};

export function mapFirstBasketMarket(response) {
  const players = {};
  for (const book of response?.bookmakers ?? []) {
    const bookKey = String(book.key ?? '').toLowerCase();
    if (!bookKey) continue;
    for (const market of book.markets ?? []) {
      if (market.key !== 'player_first_basket') continue;
      for (const outcome of market.outcomes ?? []) {
        const playerName = outcome.description || (outcome.name !== 'Yes' && outcome.name !== 'No' ? outcome.name : null);
        const price = americanPrice(outcome.price);
        const key = normalizeMarketName(playerName);
        if (!key || !price || outcome.name === 'No') continue;
        (players[key] ??= { name: playerName, books: {} });
        players[key].books[bookKey] = price;
        players[key].marketUpdatedAt = market.last_update || book.last_update || null;
      }
    }
  }
  return players;
}

const normalizeTeamName = value => normalizeMarketName(value).replace(/\b(the)\b/g, '').replace(/\s+/g, ' ').trim();

/**
 * Fetch fresh first-basket scorer quotes for today's ESPN games.
 * No key, unsupported subscription, stale quotes, or provider errors result
 * in no market prices; synthetic prices are never substituted.
 */
export async function fetchFirstBasketOddsForGames(games, {
  apiKey = process.env.ODDS_API_KEY,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  maxAgeMs = 15 * 60 * 1000,
  cached = null,
  refreshMinutes = Number(process.env.ODDS_REFRESH_MINUTES || 1440),
} = {}) {
  if (!apiKey) return { status: 'no_key', provider: 'the-odds-api', fetchedAt: new Date(now).toISOString(), games: {} };
  const cachedAt = Date.parse(cached?.fetchedAt || '');
  if (cached && cached.provider === 'the-odds-api' && Number.isFinite(cachedAt) &&
      now - cachedAt < Math.max(1, refreshMinutes) * 60 * 1000) {
    return { ...cached, status: 'cached', cacheAgeMinutes: Math.round((now - cachedAt) / 60000) };
  }

  const request = async url => {
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`odds provider HTTP ${res.status}`);
    return res.json();
  };

  try {
    const eventUrl = new URL(`${API_BASE}/events`);
    eventUrl.searchParams.set('apiKey', apiKey);
    const events = await request(eventUrl);
    const result = {};
    const pending = [];
    for (const game of games ?? []) {
      const home = normalizeTeamName(game.homeTeam?.name || game.homeTeam?.abbr);
      const away = normalizeTeamName(game.awayTeam?.name || game.awayTeam?.abbr);
      const event = (Array.isArray(events) ? events : []).find(e =>
        normalizeTeamName(e.home_team) === home && normalizeTeamName(e.away_team) === away);
      if (!event?.id) continue;
      const oddsUrl = new URL(`${API_BASE}/events/${encodeURIComponent(event.id)}/odds`);
      oddsUrl.searchParams.set('apiKey', apiKey);
      oddsUrl.searchParams.set('regions', 'us');
      oddsUrl.searchParams.set('markets', 'player_first_basket');
      oddsUrl.searchParams.set('oddsFormat', 'american');
      pending.push(request(oddsUrl).then(data => {
        const quotes = mapFirstBasketMarket(data);
        const capturedAt = new Date(now).toISOString();
        for (const book of data.bookmakers ?? []) {
          for (const market of book.markets ?? []) {
            if (market.key !== 'player_first_basket') continue;
            const updated = Date.parse(market.last_update || book.last_update || '');
            if (Number.isFinite(updated) && now - updated > maxAgeMs) {
              for (const q of Object.values(quotes)) delete q.books[String(book.key).toLowerCase()];
            }
          }
        }
        for (const q of Object.values(quotes)) {
          q.books = Object.fromEntries(Object.entries(q.books).filter(([, price]) => price != null));
          q.capturedAt = capturedAt;
          q.source = 'the-odds-api';
        }
        result[game.gameId] = {
          eventId: event.id,
          players: Object.fromEntries(Object.entries(quotes).filter(([, q]) => Object.keys(q.books).length)),
        };
      }));
    }
    const settled = await Promise.allSettled(pending);
    const failures = settled.filter(x => x.status === 'rejected').length;
    const covered = Object.values(result).filter(g => Object.keys(g.players).length).length;
    return {
      status: covered ? (failures ? 'partial' : 'ok') : (failures ? 'provider_error' : 'no_market'),
      provider: 'the-odds-api', fetchedAt: new Date(now).toISOString(),
      requestedGames: pending.length, coveredGames: covered, failures,
      games: result,
    };
  } catch (error) {
    return {
      status: 'provider_error', provider: 'the-odds-api', fetchedAt: new Date(now).toISOString(),
      error: error.message, games: {},
    };
  }
}
