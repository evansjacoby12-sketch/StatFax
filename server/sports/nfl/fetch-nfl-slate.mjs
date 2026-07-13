/** Build dist/nfl/daily.json from current ESPN state + nflverse history. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchESPNRoster, fetchESPNSeason, fetchESPNSummary, selectCurrentNFLSlate } from './providers/espn.mjs'
import { fetchNFLOdds, normalizePlayerName } from './providers/odds.mjs'
import { indexNFLHistory, matchHistoryPlayer, playerRoleScore, projectNFLPlayer } from './projections.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..')
const DEFAULT_HISTORY = path.join(ROOT, 'dist', 'nfl', 'history.json')
const DEFAULT_OUTPUT = path.join(ROOT, 'dist', 'nfl', 'daily.json')
const LIMITS = { QB: 2, RB: 4, WR: 6, TE: 4 }

const n = (value, fallback = 0) => value == null || value === '' ? fallback : Number.isFinite(Number(value)) ? Number(value) : fallback

async function readJSON(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return null }
}

function kickoffLabel(date) {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(date))
}

function ordinal(value) {
  const mod100 = value % 100
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`
  return `${value}${value % 10 === 1 ? 'st' : value % 10 === 2 ? 'nd' : value % 10 === 3 ? 'rd' : 'th'}`
}

export function defenseProfile(history, team, position) {
  const table = history?.defenseAllowedByPosition || {}
  const entry = table?.[team]?.[position]
  if (!entry) return { rank: null, percentile: .5, label: `Neutral baseline vs ${position}`, allowedPerGame: null, factors: {} }
  const field = position === 'QB' ? 'passingYards' : position === 'RB' ? 'rushingYards' : 'receivingYards'
  const values = Object.entries(table).map(([abbr, positions]) => ({ team: abbr, value: n(positions?.[position]?.[field], null) })).filter((row) => row.value != null).sort((a, b) => a.value - b.value)
  const index = values.findIndex((row) => row.team === team)
  const rank = index >= 0 ? index + 1 : null
  const percentile = rank && values.length > 1 ? (rank - 1) / (values.length - 1) : .5
  const vulnerabilityRank = rank ? values.length - rank + 1 : null
  const tdRate = n(entry.touchdowns, null)
  const factor = Math.max(.88, Math.min(1.12, .92 + percentile * .16))
  return {
    rank,
    percentile,
    label: vulnerabilityRank ? `${ordinal(vulnerabilityRank)} most ${position} yards allowed` : `Historical split vs ${position}`,
    allowedPerGame: tdRate,
    factors: { anytime_td: factor, first_td: factor, two_plus_td: factor, passing_yards: factor, receptions: factor, receiving_yards: factor, rushing_yards: factor, rushing_receiving_yards: factor, passing_rushing_yards: factor },
  }
}

function rosterStatus(player) {
  const status = player.injury?.status || player.rosterStatus || 'Active'
  const warn = /out|doubt|question|injur|reserve|pup/i.test(status)
  return { status: player.injury?.detail ? `${status} · ${player.injury.detail}` : status, statusTone: warn ? 'warn' : 'good' }
}

function liveLabel(game) {
  if (game.status.state === 'in') return `LIVE ${game.status.detail || game.status.clock || ''}`.trim()
  if (game.status.state === 'post') return 'FINAL'
  return 'Pregame'
}

function limitRoster(players, historyIndex) {
  const groups = new Map()
  for (const player of players) {
    if (!groups.has(player.position)) groups.set(player.position, [])
    const history = matchHistoryPlayer(player, historyIndex)
    groups.get(player.position).push({ player, history, score: playerRoleScore(player, history) })
  }
  return [...groups.entries()].flatMap(([position, rows]) => rows.sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name)).slice(0, LIMITS[position] || 0))
}

export async function buildNFLSnapshot({ now = new Date(), fetchImpl = fetch, historyPath = DEFAULT_HISTORY, oddsApiKey = process.env.SPORTSGAMEODDS_API_KEY } = {}) {
  const year = new Date(now).getUTCFullYear()
  const schedule = await fetchESPNSeason(year, fetchImpl)
  const games = selectCurrentNFLSlate(schedule, now)
  const history = await readJSON(historyPath)
  const historyIndex = indexNFLHistory(history)
  const oddsResult = await fetchNFLOdds(oddsApiKey, fetchImpl)
  const teams = [...new Set(games.flatMap((game) => [game.home.abbr, game.away.abbr]))]
  const rosterResults = await Promise.all(teams.map(async (team) => {
    try { return [team, await fetchESPNRoster(team, fetchImpl)] } catch (error) { console.warn(`[nfl] roster ${team}: ${error.message}`); return [team, []] }
  }))
  const rosters = new Map(rosterResults)
  const summaryResults = await Promise.all(games.map(async (game) => {
    try { return [game.id, await fetchESPNSummary(game, fetchImpl)] } catch (error) { console.warn(`[nfl] summary ${game.id}: ${error.message}`); return [game.id, null] }
  }))
  const summaries = new Map(summaryResults)
  const players = []

  for (const game of games) {
    const summary = summaries.get(game.id)
    const liveById = new Map((summary?.players || []).map((player) => [player.espnId, player]))
    for (const side of ['home', 'away']) {
      const team = game[side].abbr
      const opponent = game[side === 'home' ? 'away' : 'home'].abbr
      for (const { player, history: playerHistory } of limitRoster(rosters.get(team) || [], historyIndex)) {
        const quote = oddsResult.players.get(normalizePlayerName(player.name)) || null
        const model = projectNFLPlayer(player, playerHistory, { isHome: side === 'home', odds: quote })
        const liveStats = liveById.get(player.espnId) || {}
        const report = rosterStatus(player)
        players.push({
          id: player.id,
          espnId: player.espnId,
          name: player.name,
          position: player.position,
          team,
          opponent,
          isHome: side === 'home',
          kickoff: kickoffLabel(game.date),
          kickoffAt: game.date,
          gameId: game.id,
          teamTotal: null,
          headshotUrl: player.headshotUrl || liveStats.headshotUrl || null,
          ...report,
          ...model,
          defenseVsPosition: defenseProfile(history, opponent, player.position),
          weather: summary?.weather || { roof: game.venue.indoor ? 'dome' : 'outdoor', tempF: null, windMph: null },
          live: {
            isLive: game.status.state === 'in',
            isFinal: game.status.state === 'post',
            label: liveLabel(game),
            gameProgress: summary?.progress ?? 0,
            stats: { completions: n(liveStats.completions), attempts: n(liveStats.attempts), passingYards: n(liveStats.passingYards), carries: n(liveStats.carries), rushingYards: n(liveStats.rushingYards), receptions: n(liveStats.receptions), receivingYards: n(liveStats.receivingYards), targets: n(liveStats.targets), totalTds: n(liveStats.totalTds) },
          },
        })
      }
    }
  }

  const anchor = games[0]
  return {
    version: 2,
    sport: 'nfl',
    generatedAt: new Date().toISOString(),
    source: {
      mode: 'live',
      historicalFrom: history?.seasons?.[0] ?? 2020,
      historicalThrough: history?.seasons?.at?.(-1) ?? null,
      providers: { schedule: 'espn', rosters: 'espn', injuries: 'espn', live: 'espn', history: history ? 'nflverse' : 'position-priors', odds: oddsResult.status === 'ok' ? 'sportsgameodds' : oddsResult.status },
      notes: ['ESPN endpoints are keyless and undocumented; failures retain the last published snapshot.', 'Model-reference lines are used when no sportsbook quote is available.'],
    },
    meta: { week: anchor ? `${anchor.seasonType === 'preseason' ? 'Preseason ' : 'Week '}${anchor.week}` : 'No active slate', season: anchor?.season ?? year, seasonType: anchor?.seasonType ?? null, games: games.length, weatherUpdatedAt: new Date().toISOString() },
    games,
    players,
  }
}

export async function writeNFLSnapshot(options = {}) {
  const outputPath = options.outputPath || DEFAULT_OUTPUT
  const snapshot = await buildNFLSnapshot(options)
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  const temporary = `${outputPath}.tmp`
  await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2), 'utf8')
  await fs.rename(temporary, outputPath)
  console.log(`[nfl] wrote ${outputPath} · ${snapshot.meta.games} games · ${snapshot.players.length} players · odds=${snapshot.source.providers.odds}`)
  return snapshot
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeNFLSnapshot().catch((error) => { console.error('[nfl] fatal:', error); process.exitCode = 1 })
}
