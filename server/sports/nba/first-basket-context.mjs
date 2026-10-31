const NBA_STATS_URL = 'https://stats.nba.com/stats/leaguedashplayershotlocations';
const PBP_STATS_URL = 'https://api.pbpstats.com/get-shots/nba';
const NBA_TEAM_IDS = { ATL:1610612737, BOS:1610612738, BKN:1610612751, CHA:1610612766, CHI:1610612741, CLE:1610612739, DAL:1610612742, DEN:1610612743, DET:1610612765, GSW:1610612744, HOU:1610612745, IND:1610612754, LAC:1610612746, LAL:1610612747, MEM:1610612763, MIA:1610612748, MIL:1610612749, MIN:1610612750, NOP:1610612740, NYK:1610612752, OKC:1610612760, ORL:1610612753, PHI:1610612755, PHX:1610612756, POR:1610612757, SAC:1610612758, SAS:1610612759, TOR:1610612761, UTA:1610612762, WAS:1610612764 };

const ZONES = ['Restricted Area', 'In The Paint (Non-RA)', 'Mid-Range', 'Left Corner 3', 'Right Corner 3', 'Above the Break 3', 'Backcourt'];
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/, '');
const n = value => Number.isFinite(Number(value)) ? Number(value) : null;

function resultSet(payload, wanted) {
  const sets = payload?.resultSets || payload?.resultSet || [];
  return (Array.isArray(sets) ? sets : [sets]).find(set => set.name === wanted) || sets[0] || null;
}

/** Parse NBA Stats LeagueDashPlayerShotLocations flat rows into count-backed rates. */
export function parseNbaZoneStats(payload) {
  const set = resultSet(payload, 'ShotLocations');
  const headers = set?.headers || [];
  const rows = set?.rowSet || [];
  const zoneGroups = ZONES.map((zone, z) => {
    const h = headers.map(x => String(x).toLowerCase());
    const matching = h.findIndex(x => x.includes(zone.toLowerCase()) && x.endsWith('fgm'));
    if (matching >= 0) return { fgm: matching, fga: matching + 1 };
    // The endpoint also emits grouped metadata plus repeated FGM/FGA/FG_PCT columns.
    const base = headers.findIndex(x => String(x).toUpperCase() === 'FGM' && headers.slice(0, headers.indexOf(x)).filter(y => String(y).toUpperCase() === 'FGM').length === 0);
    return { fgm: (base >= 0 ? base : 5) + z * 3, fga: (base >= 0 ? base : 5) + z * 3 + 1 };
  });
  const out = {};
  for (const row of rows) {
    const id = String(row[headers.findIndex(h => String(h).toUpperCase() === 'PLAYER_ID')] ?? row[0] ?? '');
    if (!/^\d+$/.test(id)) continue;
    const zone = zoneGroups.map(({ fgm, fga }) => ({ made: n(row[fgm]), attempts: n(row[fga]) }));
    const combine = indices => {
      const made = indices.reduce((sum, i) => sum + (zone[i]?.made || 0), 0);
      const attempts = indices.reduce((sum, i) => sum + (zone[i]?.attempts || 0), 0);
      return { made, attempts, pct: attempts > 0 ? made / attempts : null };
    };
    const rim = combine([0, 1]);
    const mid = combine([2]);
    const three = combine([3, 4, 5]);
    const playerName = String(row[headers.findIndex(h => String(h).toUpperCase() === 'PLAYER_NAME')] ?? row[1] ?? '');
    out[id] = {
      rim, mid, three,
      playerName,
      source: 'nba_stats_leaguedashplayershotlocations',
      season: payload.season || null,
    };
    if (norm(playerName)) out[`name:${norm(playerName)}`] = out[id];
  }
  return out;
}

/** Aggregate a team's first Q1 shot from the game's first two alternating possessions. */
export function parsePbpOpeningShots(payload, { maxShots = 500 } = {}) {
  const shots = payload?.results;
  if (!Array.isArray(shots)) return { status: 'invalid', byPlayer: {}, sampleCount: 0 };
  if (shots.length >= maxShots) return { status: 'truncated', byPlayer: {}, sampleCount: shots.length };
  const firstByTeamPossession = new Map();
  for (const shot of shots) {
    const possessionNo = Number(shot.poss_num);
    if (Number(shot.period) !== 1 || ![1, 2].includes(possessionNo)) continue;
    const gameId = String(shot.gid || '');
    const name = String(shot.player || '').trim();
    if (!gameId || !name || !Number.isFinite(Number(shot.player_id))) continue;
    const key = `${gameId}:${possessionNo}`;
    const prior = firstByTeamPossession.get(key);
    const shotTime = Number(shot.shot_time);
    if (!prior || (Number.isFinite(shotTime) && shotTime > prior.shotTime)) {
      firstByTeamPossession.set(key, { shot, shotTime: Number.isFinite(shotTime) ? shotTime : -1 });
    }
  }
  const byPlayer = {};
  const sampleGames = new Set();
  for (const { shot } of firstByTeamPossession.values()) {
    const key = norm(shot.player);
    if (!key) continue;
    sampleGames.add(String(shot.gid));
    const item = byPlayer[key] ||= { name: shot.player, playerId: String(shot.player_id), attempts: 0, made: 0, misses: 0, startTypes: {} };
    item.attempts++;
    if (shot.made) item.made++; else item.misses++;
    const startType = String(shot.start_type || 'unknown');
    item.startTypes[startType] = (item.startTypes[startType] || 0) + 1;
  }
  return { status: sampleGames.size ? 'ok' : 'empty', byPlayer, sampleCount: sampleGames.size };
}

export function nbaSeasonForDate(date = new Date()) {
  const d = new Date(date);
  const start = d.getUTCMonth() >= 8 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

export async function fetchFirstBasketContext(games, {
  fetchImpl = globalThis.fetch,
  season = nbaSeasonForDate(),
  previousSeason = `${Number(season.slice(0, 4)) - 1}-${String(Number(season.slice(0, 4))).slice(-2)}`,
  zoneCached = {}, openingCached = {}, timeoutMs = 60000,
} = {}) {
  const requestJson = async (url, init = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: controller.signal });
      if (!res.ok) throw new Error(`provider HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(timeout); }
  };
    let zoneStatsByPlayerId = zoneCached;
    let zoneStatus = Object.keys(zoneCached).length ? 'cached' : 'unavailable';
    if (!Object.keys(zoneCached).length) {
      const url = new URL(NBA_STATS_URL);
      const params = {
        College: '', Conference: '', Country: '', DateFrom: '', DateTo: '', DistanceRange: 'By Zone', Division: '', DraftPick: '', DraftYear: '', GameScope: '', GameSegment: '', Height: '', LastNGames: '0', LeagueID: '00', Location: '', MeasureType: 'Base', Month: '0', OpponentTeamID: '0', Outcome: '', PORound: '', PaceAdjust: 'N', PerMode: 'Totals', Period: '0', PlayerExperience: '', PlayerPosition: '', PlusMinus: 'N', Rank: 'N', Season: season, SeasonSegment: '', SeasonType: 'Regular Season', ShotClockRange: '', StarterBench: '', TeamID: '0', VsConference: '', VsDivision: '', Weight: '',
      };
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      try {
        zoneStatsByPlayerId = parseNbaZoneStats({ ...(await requestJson(url, { headers: {
          Accept: 'application/json', Referer: 'https://www.nba.com/', Origin: 'https://www.nba.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
          'x-nba-stats-origin': 'stats', 'x-nba-stats-token': 'true',
        } })), season });
        zoneStatus = Object.keys(zoneStatsByPlayerId).length ? 'ok' : 'empty';
      } catch { zoneStatsByPlayerId = zoneCached; zoneStatus = 'unavailable'; }
    }

    let openingByPlayer = { ...openingCached.byPlayer };
    let openingSamples = Number(openingCached.sampleCount) || 0;
    let openingStatus = openingCached.status || 'unavailable';
    const cacheAge = Date.now() - Date.parse(openingCached.fetchedAt || '');
    const openingFresh = openingCached.season === season && Number.isFinite(cacheAge) && cacheAge >= 0 && cacheAge < 24 * 60 * 60 * 1000;
    let openingByTeam = openingCached.byTeam || {};
    let openingHistorySeason = openingCached.dataSeason || null;
    const teams = [...new Map((games || []).flatMap(g => [g.homeTeam, g.awayTeam])
      .filter(t => t?.abbr && NBA_TEAM_IDS[t.abbr]).map(t => [t.abbr, { ...t, id: NBA_TEAM_IDS[t.abbr] }])).values()];
    const cachedTeams = openingFresh ? openingByTeam : {};
    const teamsToFetch = teams.filter(t => !cachedTeams[t.abbr]);
    if (openingFresh) {
      Object.assign(openingByPlayer, openingCached.byPlayer || {});
      openingSamples = Number(openingCached.sampleCount) || 0;
      openingStatus = openingCached.status || 'cached';
    } else {
      openingByPlayer = {};
      openingByTeam = {};
      openingSamples = 0;
    }
    if (teamsToFetch.length) {
      const candidateSeasons = openingFresh && openingHistorySeason
        ? openingHistorySeason.split(',')
        : [season, previousSeason, `${Number(previousSeason.slice(0, 4)) - 1}-${String(Number(previousSeason.slice(0, 4))).slice(-2)}`];
      const supportedSeasons = [];
      const makePbpUrl = (team, dataSeason) => new URL(`${PBP_STATS_URL}?${new URLSearchParams({
        Season: dataSeason, SeasonType: 'Regular Season', EntityType: 'Team', EntityId: String(team.id),
        PeriodEquals: '1', FromTime: '720', ToTime: '600',
      })}`);
      const probeTeam = teamsToFetch[0];
      const probeResults = [];
      for (const candidateSeason of candidateSeasons) {
        try {
          const url = makePbpUrl(probeTeam, candidateSeason);
          const parsed = parsePbpOpeningShots(await requestJson(url, { headers: { Accept: 'application/json' } }));
          if (parsed.status !== 'invalid' && parsed.status !== 'truncated') {
            supportedSeasons.push(candidateSeason);
            probeResults.push(parsed);
            if (supportedSeasons.length === 2) break;
          }
        } catch { /* Try the most recent older season the provider serves. */ }
      }
      openingHistorySeason = supportedSeasons.join(',') || null;
      const mergeResults = results => {
        const combined = { status: 'ok', byPlayer: {}, sampleCount: 0 };
        for (const result of results) {
          if (result.status === 'truncated') return { status: 'truncated', byPlayer: {}, sampleCount: result.sampleCount };
          if (result.status === 'invalid') continue;
          combined.sampleCount += result.sampleCount;
          for (const [key, stats] of Object.entries(result.byPlayer)) {
            const prior = combined.byPlayer[key] ||= { ...stats, attempts: 0, made: 0, misses: 0, startTypes: {} };
            prior.attempts += stats.attempts; prior.made += stats.made; prior.misses += stats.misses;
            for (const [type, count] of Object.entries(stats.startTypes || {})) prior.startTypes[type] = (prior.startTypes[type] || 0) + count;
          }
        }
        if (!combined.sampleCount) combined.status = 'empty';
        return combined;
      };
      const probeResult = supportedSeasons.length ? { status: 'fulfilled', value: mergeResults(probeResults) } : null;
      const queue = teamsToFetch.slice(1).map((team, index) => ({ team, index: index + 1 }));
      const teamResults = new Array(teamsToFetch.length);
      if (probeResult) teamResults[0] = probeResult;
      else teamResults[0] = { status: 'rejected' };
      const worker = async () => {
        while (queue.length) {
          const { team, index } = queue.shift();
          try {
            const seasonResults = [];
            for (const dataSeason of supportedSeasons) {
              seasonResults.push(parsePbpOpeningShots(await requestJson(makePbpUrl(team, dataSeason), { headers: { Accept: 'application/json' } })));
            }
            teamResults[index] = { status: 'fulfilled', value: mergeResults(seasonResults) };
          } catch (reason) { teamResults[index] = { status: 'rejected', reason }; }
        }
      };
      await Promise.all(Array.from({ length: Math.min(5, teamsToFetch.length) }, worker));
      let okTeams = 0;
      let truncated = false;
      for (let i = 0; i < teamResults.length; i++) {
        const item = teamResults[i];
        if (item.status !== 'fulfilled') continue;
        if (item.value.status === 'truncated') { truncated = true; continue; }
        okTeams++;
        openingSamples += item.value.sampleCount;
        for (const [key, stats] of Object.entries(item.value.byPlayer)) {
          const prior = openingByPlayer[key] ||= { name: stats.name, attempts: 0, made: 0, misses: 0, startTypes: {} };
          prior.attempts += stats.attempts; prior.made += stats.made; prior.misses += stats.misses;
          for (const [type, count] of Object.entries(stats.startTypes || {})) prior.startTypes[type] = (prior.startTypes[type] || 0) + count;
        }
        if (item.value.sampleCount > 0) openingByTeam[teamsToFetch[i].abbr] = { ...item.value, season: openingHistorySeason };
      }
      openingStatus = truncated ? 'truncated' : okTeams === teamsToFetch.length ? 'ok' : okTeams ? 'partial' : 'unavailable';
    }
    if (openingStatus !== 'truncated' && teams.length) {
      const covered = teams.filter(t => openingByTeam[t.abbr]?.status === 'ok').length;
      if (covered === teams.length) openingStatus = openingFresh && teamsToFetch.length === 0 ? 'cached' : 'ok';
      else if (covered > 0) openingStatus = 'partial';
    }
    return {
      zoneStatsByPlayerId, zoneStatus, zoneSeason: season,
      openingByPlayer: openingStatus === 'truncated' ? {} : openingByPlayer,
      openingStatus, openingSamples: openingStatus === 'truncated' ? 0 : openingSamples,
      openingByTeam: openingStatus === 'truncated' ? {} : openingByTeam,
      openingSeason: season, openingHistorySeason, openingFetchedAt: new Date().toISOString(),
    };
}
