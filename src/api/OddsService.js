/**
 * OddsService — The Odds API integration for live HR prop odds.
 *
 * Endpoints used:
 *   /sports/baseball_mlb/events          → today's games + event IDs
 *   /sports/baseball_mlb/events/{id}/odds → HR prop lines per player per book
 *
 * Market: batter_home_runs  (Over 0.5 HRs = Anytime HR prop)
 * Odds format: American (+450, -120, etc.)
 *
 * Results are cached per calendar day so the parlay tab only burns
 * API credits once per session, not on every render.
 */

const API_KEY = '8c5857f301ddcc8b6ac7540ec5370402';
const BASE    = 'https://api.the-odds-api.com/v4';
const BOOKS   = ['draftkings', 'fanduel', 'betmgm'];

// Day-scoped in-memory cache so we don't hammer the API on every tab switch
let _cache     = null;   // Map<normalizedName, { draftkings?, fanduel?, betmgm? }>
let _cacheDay  = '';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

export const OddsService = {

  /** Fetch today's MLB event list (game IDs, team names, start times). */
  async getEvents() {
    const day  = todayStr();
    const from = `${day}T00:00:00Z`;
    const to   = `${day}T23:59:59Z`;
    const data = await apiFetch(
      `${BASE}/sports/baseball_mlb/events?apiKey=${API_KEY}&dateFormat=iso&commenceTimeFrom=${from}&commenceTimeTo=${to}`
    );
    return Array.isArray(data) ? data : [];
  },

  /** Fetch HR prop odds for one Odds-API event ID. */
  async getEventProps(eventId) {
    return apiFetch(
      `${BASE}/sports/baseball_mlb/events/${eventId}/odds` +
      `?apiKey=${API_KEY}&regions=us&markets=batter_home_runs` +
      `&bookmakers=${BOOKS.join(',')}&oddsFormat=american`
    );
  },

  /**
   * Fetch all HR prop lines for today across every MLB game.
   *
   * Returns Map<normalizedPlayerName, { draftkings?, fanduel?, betmgm? }>
   * where values are American-format integers (+450, -120, etc.)
   *
   * Cached per calendar day — safe to call on every parlay-tab mount.
   */
  async getAllHRProps() {
    const day = todayStr();
    if (_cacheDay === day && _cache) return _cache;

    const events = await this.getEvents();
    if (!events.length) return new Map();

    // Fetch all game props in parallel
    const results = await Promise.all(
      events.map(e => this.getEventProps(e.id).catch(() => null))
    );

    const map = new Map();
    for (const event of results) {
      if (!event?.bookmakers) continue;
      for (const bm of event.bookmakers) {
        const market = (bm.markets || []).find(m => m.key === 'batter_home_runs');
        if (!market) continue;

        // Group outcomes by player so we can disambiguate Over from Under
        // when the book omits the `description` field. Over and Under share
        // the same `point: 0.5` line for anytime HR; previously a null-desc
        // Under was being accepted as the Over and we'd store a short
        // -2000-ish price as the player's HR odds.
        const byName = new Map();
        for (const outcome of market.outcomes || []) {
          if (outcome.price == null) continue;
          const nm = (outcome.name || '').toLowerCase().trim();
          if (!nm) continue;
          if (!byName.has(nm)) byName.set(nm, []);
          byName.get(nm).push(outcome);
        }
        for (const [name, outcomes] of byName) {
          // Prefer the outcome explicitly tagged "Over". If none is tagged,
          // pick the side with the LONGER (more positive) American odds —
          // Under-0.5 on a batter prices much shorter than Over-0.5.
          let over = outcomes.find(o => o.description === 'Over');
          if (!over) {
            const candidates = outcomes.filter(o =>
              o.description == null && o.point != null && o.point <= 0.5
            );
            if (!candidates.length) continue;
            // Highest price = the longer (Over) side. American odds: +450 > -1500.
            over = candidates.reduce((a, b) => (a.price >= b.price ? a : b));
          }
          if (!map.has(name)) map.set(name, {});
          map.get(name)[bm.key] = over.price;
        }
      }
    }

    _cache    = map;
    _cacheDay = day;
    return map;
  },

  /**
   * Look up a player's odds from the map.
   * Tries exact lowercase match first, then last-name fallback for Jr./suffix edge cases.
   */
  findOdds(playerName, oddsMap) {
    if (!oddsMap?.size) return null;
    const key = playerName.toLowerCase().trim();

    if (oddsMap.has(key)) return oddsMap.get(key);

    // Fallback: match on last word (after stripping Jr./Sr./II/III/IV/V).
    // The previous version compared raw last tokens, so "Bobby Witt Jr."
    // (stored) vs "Bobby Witt" (lookup) failed because "jr." !== "witt".
    const stripSuffix = (n) => n.replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '').trim();
    const lookupTokens = stripSuffix(key).split(' ');
    const lookupLast   = lookupTokens[lookupTokens.length - 1];
    const lookupFirst  = lookupTokens[0];

    for (const [k, v] of oddsMap) {
      const candTokens = stripSuffix(k).split(' ');
      const candLast   = candTokens[candTokens.length - 1];
      const candFirst  = candTokens[0];
      if (candLast === lookupLast && candFirst.startsWith(lookupFirst[0])) return v;
    }
    return null;
  },

  /** Format American odds for display: 450 → "+450", -120 → "-120" */
  formatOdds(price) {
    if (price == null) return null;
    return price > 0 ? `+${price}` : String(price);
  },

  /** Best (highest payout) odds across all books for a player */
  bestOdds(playerOdds) {
    if (!playerOdds) return null;
    const entries = Object.entries(playerOdds);
    if (!entries.length) return null;
    return entries.reduce((best, [book, price]) =>
      (best === null || price > best.price) ? { book, price } : best, null
    );
  },
};
