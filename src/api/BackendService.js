/**
 * BackendService — shared slate snapshot fetcher
 *
 * Reads the daily slate JSON published by the GitHub Actions cron in
 * server/fetch-slate.mjs. The whole point is cross-device consistency: every
 * user device reads the SAME bundled snapshot (lineups, batter stats,
 * pitcher stats, bullpen HR/9, weather, Statcast for top batters) so the
 * model produces identical scores everywhere.
 *
 * Falls back gracefully — if the backend is unreachable, returns null and
 * the app continues to fetch directly from MLB / Savant per-device (the
 * pre-backend behavior). That's the failsafe: the app still works if the
 * cron is down, the user just loses cross-device sync until it comes back.
 */
// Public Cloudflare R2 bucket URL — the GitHub Actions cron uploads
// `daily.json` here every 10 minutes. R2 is S3-compatible and Cloudflare
// fronts it with their CDN, so reads are fast worldwide. The bucket is
// public-read (only this one JSON file is exposed, no other contents).
const BACKEND_BASE = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev';

// In-memory cache so we don't refetch on every render. The backend regens
// every 10 min, so caching for 2 min on-device avoids redundant work while
// still picking up new snapshots quickly.
let _cached = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 2 * 60 * 1000;

/**
 * Fetch the latest published slate snapshot.
 * Returns the parsed JSON payload, or null on any failure.
 *
 * Pass `{ force: true }` to bypass the in-memory TTL cache. Pass
 * `{ sport: 'mlb' | 'nba' | 'nfl' }` to fetch a specific sport's
 * snapshot — defaults to MLB. The cache key is sport-scoped so
 * switching sports doesn't serve stale cross-sport data.
 *
 * URL convention:
 *   - New paths: `{sport}/daily.json`  (e.g. mlb/daily.json)
 *   - Legacy fallback: `daily.json` at root (MLB only; kept for
 *     back-compat with old clients during the multi-sport rollout)
 *
 * The legacy fallback can be removed once the next-minor-version OTA
 * has propagated to all users.
 *
 * ── Conditional fetch (HTTP ETag) ─────────────────────────────────────
 *
 * We track the ETag returned by R2 on the last successful fetch (R2 uses
 * the object's MD5 as its ETag, so a new ETag means new bytes). On
 * subsequent fetches we send `If-None-Match: <last-etag>`. R2 returns
 * 304 Not Modified when the snapshot bytes haven't changed since the
 * cron's last write — we skip the 4.7MB JSON parse + the ~1-2s download
 * and reuse the previously-parsed payload directly.
 *
 * Why this matters: the cron only regenerates daily.json every 10 min,
 * but devices poll on every pull-refresh + every 10-min live-rankings
 * tick (when enabled). Without conditional fetch, EVERY poll downloads
 * the full payload + reparses. With it: only the first poll after a
 * cron run does real work; subsequent polls return 304 instantly.
 *
 * Cellular bandwidth savings ~80% in steady-state. JSON parse cost
 * (~50ms on a phone) drops to zero on no-change polls.
 *
 * The legacy `?t=...` cache-buster was removed in favor of relying on
 * the R2 upload's `Cache-Control: max-age=60` header for CDN freshness
 * plus our ETag for granularity beyond that.
 */
const _cachedBySport = new Map();   // sport → { data, ts }
const _etagBySport   = new Map();   // sport → last-seen ETag string

export async function fetchSnapshot({ force = false, sport = 'mlb' } = {}) {
  const cached = _cachedBySport.get(sport);
  if (!force && cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    return cached.data;
  }
  // Try the sport-namespaced path first, then fall back to the legacy
  // root path (MLB only, during transition).
  const candidates = [
    `${BACKEND_BASE}/${sport}/daily.json`,
    sport === 'mlb' ? `${BACKEND_BASE}/daily.json` : null,
  ].filter(Boolean);
  for (const url of candidates) {
    try {
      const lastEtag = _etagBySport.get(sport);
      const headers  = lastEtag ? { 'If-None-Match': lastEtag } : undefined;
      const res = await fetch(url, headers ? { headers } : undefined);

      // 304 Not Modified — server confirms our cached bytes are still
      // current. Refresh the cache timestamp and return the previously
      // parsed payload without re-parsing.
      if (res.status === 304 && cached?.data) {
        _cachedBySport.set(sport, { data: cached.data, ts: Date.now() });
        _cached = cached.data; _cachedAt = Date.now();
        return cached.data;
      }

      if (!res.ok) continue;
      const data = await res.json();
      if (!data || typeof data !== 'object' || !data.date) continue;

      // Capture the new ETag so the next fetch can short-circuit.
      // R2 always returns one; the optional-chain guards against
      // future provider changes.
      const newEtag = res.headers.get?.('etag') || res.headers.get?.('ETag');
      if (newEtag) _etagBySport.set(sport, newEtag);

      _cachedBySport.set(sport, { data, ts: Date.now() });
      // Mirror to the legacy single-cache slot for any caller that
      // still reads _cached / _cachedAt directly.
      _cached = data; _cachedAt = Date.now();
      return data;
    } catch {}
  }
  return null;
}

/**
 * Returns true if the in-memory snapshot is fresh enough for the current
 * calendar day. Used by the slate fetch pipeline to decide whether to read
 * from the backend or fall back to direct MLB calls.
 *
 * Strict date match: we deliberately do NOT accept yesterday's snapshot
 * here because the games array (gamePks, matchups, lineups) would all be
 * stale, which is far worse UX than falling back to a fresh per-device
 * fetch. The downside is users lose snapshot WEATHER until today's
 * snapshot regenerates — handled separately by `getSnapshotWeatherByPark`
 * which exposes a stadium-keyed fallback we CAN safely reuse across days.
 */
export function isSnapshotUsable(snap) {
  if (!snap || !snap.date) return false;
  const today = todayInCT();
  return snap.date === today;
}

/**
 * Stadium-keyed weather lookup that works EVEN when the snapshot is from
 * yesterday. Useful as a fallback for the "midnight gap" where today's
 * cron hasn't run yet — weather doesn't change much overnight, and a
 * 6-hour-old reading is far better than nothing.
 *
 * Returns a Map<venueName, weather>. The caller resolves the per-game
 * venue and reads from the map directly. Returns an empty Map when the
 * snapshot is missing or has no weather.
 */
export function getSnapshotWeatherByVenue(snap) {
  const out = new Map();
  if (!snap?.weatherByGame || !snap?.games) return out;
  for (const g of snap.games) {
    const w = snap.weatherByGame[g.gamePk];
    if (w && g.venueName) out.set(g.venueName, w);
  }
  return out;
}

function todayInCT() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

// Backtest log is keyed by date and contains the same slim prediction records
// (playerId, name, score, grade, badges, homered) that the calibration loop
// writes. We cache for 30 min — it only updates once per day at the first
// post-midnight CT cron run.
let _btCached = null;
let _btCachedAt = 0;
const BT_CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Fetch the rolling 30-day backtest log from R2. Returns the parsed JSON
 * `{ dates: string[], records: { [date]: PredictionRecord[] } }` or null
 * on failure. PredictionRecord shape: { playerId, name, score, grade, badges, homered }.
 *
 * Used by cross-day surfaces like the Weekly view to aggregate a player's
 * recent score history without each client redoing the model run.
 */
export async function fetchBacktestLog({ force = false } = {}) {
  if (!force && _btCached && (Date.now() - _btCachedAt) < BT_CACHE_TTL_MS) {
    return _btCached;
  }
  try {
    const url = `${BACKEND_BASE}/backtest-log.json?t=${Math.floor(Date.now() / (10 * 60 * 1000))}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !Array.isArray(data.dates)) return null;
    _btCached = data;
    _btCachedAt = Date.now();
    return data;
  } catch {
    return null;
  }
}

/**
 * Fetch NBA player-prop odds from R2 (published by the server-side
 * fetch-nba-odds.mjs). Returns parsed payload or null on failure.
 *
 * Payload shape (matches server/sports/nba/fetch-nba-odds.mjs output):
 *   {
 *     date:        'YYYY-MM-DD',
 *     generatedAt: ISO,
 *     status:      'ok_N' | 'no_key' | 'empty' | 'sgo_http_XXX',
 *     games: [{
 *       eventId, homeAbbr, awayAbbr,
 *       playerProps: { [normalizedName]: { name, points: {...}, threes: {...} } }
 *     }]
 *   }
 *
 * Same 2-min in-memory cache as fetchSnapshot — odds change every cron
 * tick (~10 min) so refetching faster wastes work. ETag-aware: returns
 * 304 instantly when nothing's changed since last fetch.
 */
let _oddsCached = null;
let _oddsCachedAt = 0;
let _oddsEtag = null;

export async function fetchNBAOdds({ force = false } = {}) {
  if (!force && _oddsCached && (Date.now() - _oddsCachedAt) < CACHE_TTL_MS) {
    return _oddsCached;
  }
  try {
    const url     = `${BACKEND_BASE}/nba/odds.json`;
    const headers = _oddsEtag ? { 'If-None-Match': _oddsEtag } : undefined;
    const res     = await fetch(url, headers ? { headers } : undefined);
    if (res.status === 304 && _oddsCached) {
      _oddsCachedAt = Date.now();
      return _oddsCached;
    }
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;

    const newEtag = res.headers.get?.('etag') || res.headers.get?.('ETag');
    if (newEtag) _oddsEtag = newEtag;
    _oddsCached   = data;
    _oddsCachedAt = Date.now();
    return data;
  } catch {
    return null;
  }
}

export const BackendService = {
  fetchSnapshot,
  fetchBacktestLog,
  fetchNBAOdds,
  isSnapshotUsable,
};
