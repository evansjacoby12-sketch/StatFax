const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl'
const ESPN_WEB = 'https://www.espn.com/nfl/team/depth/_/name'
const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE'])

const n = (value, fallback = 0) => {
  if (value == null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function normalizeNFLPosition(position) {
  const abbr = String(position?.abbreviation || position || '').toUpperCase()
  if (abbr === 'FB' || abbr === 'HB') return 'RB'
  return POSITIONS.has(abbr) ? abbr : null
}

export function parseESPNScoreboard(payload) {
  return (payload?.events || []).map((event) => {
    const competition = event.competitions?.[0] || {}
    const competitors = competition.competitors || []
    const home = competitors.find((team) => team.homeAway === 'home')
    const away = competitors.find((team) => team.homeAway === 'away')
    const status = event.status || competition.status || {}
    return {
      id: String(event.id),
      date: event.date,
      season: n(event.season?.year, null),
      seasonType: event.season?.slug || null,
      week: n(event.week?.number, null),
      status: {
        state: status.type?.state || 'pre',
        name: status.type?.name || null,
        detail: status.type?.shortDetail || status.type?.detail || null,
        period: n(status.period, 0),
        clock: status.displayClock || null,
      },
      home: { id: home?.team?.id || null, abbr: home?.team?.abbreviation || null, name: home?.team?.displayName || null, score: n(home?.score, 0) },
      away: { id: away?.team?.id || null, abbr: away?.team?.abbreviation || null, name: away?.team?.displayName || null, score: n(away?.score, 0) },
      venue: {
        id: competition.venue?.id || null,
        name: competition.venue?.fullName || null,
        city: competition.venue?.address?.city || null,
        state: competition.venue?.address?.state || null,
        indoor: Boolean(competition.venue?.indoor),
      },
    }
  }).filter((game) => game.home.abbr && game.away.abbr && game.date)
}

export function selectCurrentNFLSlate(events, now = new Date()) {
  if (!events.length) return []
  const nowMs = +new Date(now)
  const live = events.filter((game) => game.status.state === 'in')
  const recent = events.filter((game) => game.status.state === 'post' && nowMs - +new Date(game.date) <= 18 * 60 * 60 * 1000)
  const upcoming = events.filter((game) => game.status.state === 'pre' && +new Date(game.date) >= nowMs - 60 * 60 * 1000)
  const anchor = live[0] || recent.sort((a, b) => +new Date(b.date) - +new Date(a.date))[0] || upcoming.sort((a, b) => +new Date(a.date) - +new Date(b.date))[0]
  if (!anchor) return events.slice().sort((a, b) => +new Date(b.date) - +new Date(a.date)).slice(0, 16)
  return events
    .filter((game) => game.season === anchor.season && game.seasonType === anchor.seasonType && game.week === anchor.week)
    .sort((a, b) => +new Date(a.date) - +new Date(b.date))
}

export function parseESPNRoster(payload, teamAbbr) {
  const offense = (payload?.athletes || []).find((group) => group.position === 'offense')?.items || []
  return offense.map((athlete) => {
    const position = normalizeNFLPosition(athlete.position)
    if (!position) return null
    const injury = athlete.injuries?.[0] || null
    return {
      id: `espn-${athlete.id}`,
      espnId: String(athlete.id),
      name: athlete.displayName || athlete.fullName,
      position,
      team: teamAbbr,
      headshotUrl: athlete.headshot?.href || null,
      rosterStatus: athlete.status?.name || 'Active',
      injury: injury ? {
        status: injury.status || injury.type?.description || 'Injury report',
        detail: injury.details?.detail || injury.details?.type || null,
        practiceParticipation: injury.practiceStatus || injury.practiceParticipation || injury.details?.practiceStatus || injury.details?.fantasyStatus?.displayDescription || null,
        date: injury.date || null,
      } : null,
    }
  }).filter(Boolean)
}

const decodeHTML = (value = '') => String(value)
  .replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim()

const INJURY_LABELS = { Q: 'Questionable', D: 'Doubtful', O: 'Out', IR: 'Injured Reserve', PUP: 'PUP', SUS: 'Suspended' }

export function parseESPNDepthChartHTML(html, teamAbbr) {
  const rows = new Map()
  const rowPattern = /<tr[^>]*data-idx="(\d+)"[^>]*>([\s\S]*?)<\/tr>/gi
  for (const match of String(html || '').matchAll(rowPattern)) {
    const index = Number(match[1])
    const body = match[2]
    const positionMatch = body.match(/data-testid="statCell"[^>]*>\s*(QB|RB|WR|TE)(?:<!-- -->)?/i)
    if (positionMatch && !rows.has(index)) rows.set(index, { position: positionMatch[1].toUpperCase(), players: [] })
  }
  for (const match of String(html || '').matchAll(rowPattern)) {
    const index = Number(match[1])
    const row = rows.get(index)
    if (!row || row.players.length) continue
    const playerPattern = /data-player-uid="[^"]*a:(\d+)"[^>]*href="[^"]*\/player\/_\/id\/\d+\/[^"]*"[^>]*>([\s\S]*?)<\/a>\s*<span[^>]*DepthChart__injuryMeta[^>]*>([\s\S]*?)<\/span>/gi
    for (const playerMatch of match[2].matchAll(playerPattern)) {
      const injuryCode = decodeHTML(playerMatch[3]).toUpperCase()
      row.players.push({
        espnId: playerMatch[1], name: decodeHTML(playerMatch[2]), team: teamAbbr,
        position: row.position, depthRank: row.players.length + 1,
        role: row.players.length ? `${row.players.length + 1}${row.players.length === 1 ? 'nd' : row.players.length === 2 ? 'rd' : 'th'} string` : 'Starter',
        status: INJURY_LABELS[injuryCode] || (injuryCode || 'Active'),
        active: !['O', 'IR', 'PUP', 'SUS'].includes(injuryCode), source: 'espn-depth-chart',
      })
    }
  }
  return [...rows.values()].flatMap((row) => row.players)
}

function parseClockSeconds(clock) {
  const [minutes, seconds] = String(clock || '15:00').split(':').map(Number)
  return Number.isFinite(minutes) && Number.isFinite(seconds) ? minutes * 60 + seconds : 900
}

export function gameProgress(status = {}) {
  if (status.state === 'post') return 1
  if (status.state !== 'in') return 0
  const period = Math.max(1, Math.min(5, n(status.period, 1)))
  if (period > 4) return .98
  const elapsedInQuarter = 1 - parseClockSeconds(status.clock) / 900
  return Math.max(0, Math.min(.98, ((period - 1) + elapsedInQuarter) / 4))
}

function categoryRows(teamBlock, categoryName) {
  const category = teamBlock?.statistics?.find((item) => item.name === categoryName)
  if (!category) return []
  return (category.athletes || []).map((row) => ({ athlete: row.athlete, values: Object.fromEntries((category.keys || []).map((key, index) => [key, row.stats?.[index]])) }))
}

export function parseESPNSummary(payload, game) {
  const byPlayer = new Map()
  const ensure = (athlete) => {
    const id = String(athlete?.id || '')
    if (!id) return null
    if (!byPlayer.has(id)) byPlayer.set(id, { espnId: id, name: athlete.displayName, headshotUrl: athlete.headshot?.href || null })
    return byPlayer.get(id)
  }
  for (const teamBlock of payload?.boxscore?.players || []) {
    for (const row of categoryRows(teamBlock, 'passing')) {
      const target = ensure(row.athlete); if (!target) continue
      const [completions, attempts] = String(row.values['completions/passingAttempts'] || '0/0').split('/').map(Number)
      Object.assign(target, { completions: n(completions), attempts: n(attempts), passingYards: n(row.values.passingYards), passingTds: n(row.values.passingTouchdowns) })
    }
    for (const row of categoryRows(teamBlock, 'rushing')) {
      const target = ensure(row.athlete); if (!target) continue
      Object.assign(target, { carries: n(row.values.rushingAttempts), rushingYards: n(row.values.rushingYards), rushingTds: n(row.values.rushingTouchdowns) })
    }
    for (const row of categoryRows(teamBlock, 'receiving')) {
      const target = ensure(row.athlete); if (!target) continue
      Object.assign(target, { receptions: n(row.values.receptions), receivingYards: n(row.values.receivingYards), receivingTds: n(row.values.receivingTouchdowns), targets: n(row.values.receivingTargets) })
    }
  }
  for (const value of byPlayer.values()) value.totalTds = n(value.rushingTds) + n(value.receivingTds)
  const headerCompetition = payload?.header?.competitions?.[0] || {}
  const weather = headerCompetition.weather || payload?.gameInfo?.weather || {}
  const situation = payload?.situation || headerCompetition.situation || {}
  const possession = String(situation.possession || situation.possessionText || '')
  const firstTouchdownPlay = (payload?.scoringPlays || []).find((play) => /touchdown/i.test(`${play.type?.text || ''} ${play.text || ''}`))
  const firstTouchdownAthlete = firstTouchdownPlay?.participants?.[0]?.athlete || firstTouchdownPlay?.athletes?.[0] || null
  return {
    players: [...byPlayer.values()],
    injuries: (payload?.injuries || []).flatMap((team) => (team.injuries || []).map((injury) => ({
      espnId: String(injury.athlete?.id || ''), status: injury.status || injury.type?.description || null, detail: injury.details?.detail || injury.details?.type || null,
    }))),
    weather: {
      roof: game.venue.indoor ? 'dome' : 'outdoor',
      tempF: n(weather.temperature, null),
      windMph: n(weather.wind?.speed ?? weather.windSpeed, null),
      precipProbability: n(weather.precipitationProbability ?? weather.precipProbability, null),
      description: weather.displayValue || weather.conditionId || null,
      updatedAt: new Date().toISOString(),
    },
    progress: gameProgress(game.status),
    situation: {
      possession,
      downDistance: situation.downDistanceText || situation.shortDownDistanceText || null,
      lastPlay: situation.lastPlay?.text || payload?.drives?.current?.plays?.at?.(-1)?.text || null,
    },
    firstTouchdown: firstTouchdownPlay ? {
      known: true,
      espnId: firstTouchdownAthlete?.id ? String(firstTouchdownAthlete.id) : null,
      name: firstTouchdownAthlete?.displayName || firstTouchdownAthlete?.fullName || null,
      text: firstTouchdownPlay.text || null,
    } : { known: false, espnId: null, name: null, text: null },
  }
}

async function getJSON(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'StatFax-NFL/1.0' } })
  if (!response.ok) throw new Error(`ESPN HTTP ${response.status}: ${url}`)
  return response.json()
}

async function getText(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': 'StatFax-NFL/1.0',
  } })
  if (!response.ok) throw new Error(`ESPN HTTP ${response.status}: ${url}`)
  return response.text()
}

export async function fetchESPNSeason(year, fetchImpl = fetch) {
  return parseESPNScoreboard(await getJSON(`${ESPN_BASE}/scoreboard?limit=1000&dates=${year}`, fetchImpl))
}

export async function fetchESPNRoster(teamAbbr, fetchImpl = fetch, teamId = null) {
  try {
    return parseESPNRoster(await getJSON(`${ESPN_BASE}/teams/${teamAbbr.toLowerCase()}/roster`, fetchImpl), teamAbbr)
  } catch (error) {
    if (!teamId) throw error
    return parseESPNRoster(await getJSON(`${ESPN_BASE}/teams/${teamId}/roster`, fetchImpl), teamAbbr)
  }
}

export async function fetchESPNDepthChart(teamAbbr, fetchImpl = fetch) {
  const base = `${ESPN_WEB}/${teamAbbr.toLowerCase()}`
  const urls = [`${base}?device=featurephone`, `${base}?platform=amp`, `${base}?xhr=1`, base]
  let lastError = null
  for (const url of urls) {
    try {
      const players = parseESPNDepthChartHTML(await getText(url, fetchImpl), teamAbbr)
      if (players.length) return players
      lastError = new Error(`ESPN depth chart contained no QB/RB/WR/TE rows for ${teamAbbr}`)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError || new Error(`ESPN depth chart unavailable for ${teamAbbr}`)
}

export async function fetchESPNSummary(game, fetchImpl = fetch) {
  return parseESPNSummary(await getJSON(`${ESPN_BASE}/summary?event=${game.id}`, fetchImpl), game)
}
