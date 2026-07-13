/** Build dist/nfl/daily.json from current ESPN state + nflverse history. */
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchESPNRoster, fetchESPNSeason, fetchESPNSummary, selectCurrentNFLSlate } from './providers/espn.mjs'
import { fetchNFLOdds, normalizePlayerName } from './providers/odds.mjs'
import { indexNFLHistory, matchHistoryPlayer, playerRoleScore, projectNFLPlayer } from './projections.mjs'
import { assessPlayerAvailability, externalAvailabilityFor, indexAvailability } from './availability.mjs'
import { calibrateNFLProbability } from '../../../src/sports/nfl/logic/calibration.js'
import { depthFor, indexDepthChart, indexWeather, overlayFreshness, readOptionalJSON, weatherFor } from './context-overlays.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..', '..')
const DEFAULT_HISTORY = path.join(ROOT, 'dist', 'nfl', 'history.json')
const DEFAULT_OUTPUT = path.join(ROOT, 'dist', 'nfl', 'daily.json')
const DEFAULT_AVAILABILITY = process.env.NFL_AVAILABILITY_PATH || path.join(ROOT, 'dist', 'nfl', 'availability.json')
const DEFAULT_BACKTEST = path.join(ROOT, 'dist', 'nfl', 'backtest.json')
const DEFAULT_DEPTH_CHART = process.env.NFL_DEPTH_CHART_PATH || path.join(ROOT, 'dist', 'nfl', 'depth-chart.json')
const DEFAULT_WEATHER = process.env.NFL_WEATHER_PATH || path.join(ROOT, 'dist', 'nfl', 'weather.json')
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
  const seasonal = history?.defenseAllowedBySeason || {}
  const recentSeasons = Object.keys(seasonal).sort((a, b) => Number(b) - Number(a)).slice(0, 2)
  const table = recentSeasons.length ? Object.fromEntries(Object.keys(history?.defenseAllowedByPosition || {}).map((abbr) => [abbr, Object.fromEntries(['QB', 'RB', 'WR', 'TE'].map((pos) => {
    const rows = recentSeasons.map((season, index) => ({ entry: seasonal[season]?.[abbr]?.[pos], weight: index === 0 ? .7 : .3 })).filter((row) => row.entry)
    if (!rows.length) return [pos, null]
    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0)
    const fields = ['touchdowns', 'redZoneTargets', 'redZoneCarries', 'passingYards', 'rushingYards', 'receivingYards', 'games']
    return [pos, Object.fromEntries(fields.map((field) => [field, rows.reduce((sum, row) => sum + n(row.entry[field]) * row.weight, 0) / totalWeight]))]
  }).filter(([, value]) => value))])) : (history?.defenseAllowedByPosition || {})
  const entry = table?.[team]?.[position]
  if (!entry) return { rank: null, percentile: .5, label: `Neutral baseline vs ${position}`, allowedPerGame: null, factors: {} }
  const field = position === 'QB' ? 'passingYards' : position === 'RB' ? 'rushingYards' : 'receivingYards'
  const values = Object.entries(table).map(([abbr, positions]) => ({ team: abbr, value: n(positions?.[position]?.[field], null) })).filter((row) => row.value != null).sort((a, b) => a.value - b.value)
  const index = values.findIndex((row) => row.team === team)
  const rank = index >= 0 ? index + 1 : null
  const percentile = rank && values.length > 1 ? (rank - 1) / (values.length - 1) : .5
  const vulnerabilityRank = rank ? values.length - rank + 1 : null
  const tdRate = n(entry.touchdowns, null)
  const rzRate = n(entry.redZoneTargets) + n(entry.redZoneCarries)
  const factor = Math.max(.88, Math.min(1.12, .92 + percentile * .16 + Math.max(-.02, Math.min(.02, (tdRate - .5) * .02))))
  return {
    rank,
    percentile,
    label: vulnerabilityRank ? `${ordinal(vulnerabilityRank)} most ${position} yards allowed` : `Historical split vs ${position}`,
    allowedPerGame: tdRate,
    touchdownsAllowedPerGame: tdRate,
    redZoneOpportunitiesAllowedPerGame: rzRate || null,
    sampleGames: n(entry.games, null),
    factors: { anytime_td: factor, first_td: factor, two_plus_td: factor, passing_yards: factor, receptions: factor, receiving_yards: factor, rushing_yards: factor, rushing_receiving_yards: factor, passing_rushing_yards: factor },
  }
}

function rosterStatus(player, availability) {
  return { status: availability?.label || player.rosterStatus || 'Active', statusTone: availability?.tone === 'good' ? 'good' : 'warn' }
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
  return [...groups.entries()].flatMap(([position, rows]) => rows
    .sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name))
    .slice(0, LIMITS[position] || 0)
    .map((row, index) => ({ ...row, player: { ...row.player, roleRank: index + 1 } })))
}

export function normalizeFirstTouchdownProbabilities(players, calibration = {}) {
  const byGame = new Map()
  for (const player of players) {
    if (!byGame.has(player.gameId)) byGame.set(player.gameId, [])
    byGame.get(player.gameId).push(player)
  }
  for (const group of byGame.values()) {
    const weights = group.map((player) => {
      const anytime = n(player.projections?.anytimeTdProbability, .1)
      const redZone = n(player.usage?.redZoneOpportunityShare, .1)
      const role = player.usage?.roleRank === 1 ? 1.12 : player.usage?.roleRank === 2 ? 1 : .88
      return Math.max(.002, calibrateNFLProbability(anytime * .22, calibration.first_td) * (1 + redZone * .2) * role)
    })
    const total = weights.reduce((sum, value) => sum + value, 0) || 1
    group.forEach((player, index) => {
      const probability = Math.round((weights[index] / total * .86) * 10000) / 10000
      player.projections.firstTdProbability = probability
      player.markets.first_td = { ...player.markets.first_td, probability, source: 'game_normalized_model' }
    })
  }
  return players
}

export async function buildNFLSnapshot({ now = new Date(), fetchImpl = fetch, historyPath = DEFAULT_HISTORY, availabilityPath = DEFAULT_AVAILABILITY, backtestPath = DEFAULT_BACKTEST, depthChartPath = DEFAULT_DEPTH_CHART, weatherPath = DEFAULT_WEATHER, oddsApiKey = process.env.SPORTSGAMEODDS_API_KEY } = {}) {
  const year = new Date(now).getUTCFullYear()
  const schedule = await fetchESPNSeason(year, fetchImpl)
  const games = selectCurrentNFLSlate(schedule, now)
  const history = await readJSON(historyPath)
  const historyIndex = indexNFLHistory(history)
  const modelPerformance = await readJSON(backtestPath)
  const calibration = modelPerformance?.markets || {}
  const availabilityPayload = await readJSON(availabilityPath)
  const availabilityIndex = indexAvailability(availabilityPayload)
  const depthPayload = await readOptionalJSON(depthChartPath)
  const depthIndex = indexDepthChart(depthPayload)
  const weatherPayload = await readOptionalJSON(weatherPath)
  const weatherIndex = indexWeather(weatherPayload)
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
        const summaryInjury = (summary?.injuries || []).find((injury) => injury.espnId === player.espnId)
        const depth = depthFor(player, depthIndex)
        const currentPlayer = {
          ...player,
          ...(depth ? { roleRank: depth.depthRank ?? player.roleRank, depthChart: depth } : {}),
          ...(summaryInjury ? { injury: { ...player.injury, ...summaryInjury } } : {}),
        }
        const externalAvailability = externalAvailabilityFor(currentPlayer, availabilityIndex)
        const availability = assessPlayerAvailability(currentPlayer, externalAvailability)
        if (!availability.eligible) continue
        const model = projectNFLPlayer(currentPlayer, playerHistory, { isHome: side === 'home', odds: quote, availability, calibration })
        const liveStats = liveById.get(player.espnId) || {}
        const report = rosterStatus(player, availability)
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
          weather: { ...(summary?.weather || { roof: game.venue.indoor ? 'dome' : 'outdoor', tempF: null, windMph: null }), ...(weatherFor(game, weatherIndex) || {}) },
          live: {
            isLive: game.status.state === 'in',
            isFinal: game.status.state === 'post',
            label: liveLabel(game),
            gameProgress: summary?.progress ?? 0,
            period: game.status.period,
            clock: game.status.clock,
            teamScore: game[side].score,
            opponentScore: game[side === 'home' ? 'away' : 'home'].score,
            gameScript: game[side].score > game[side === 'home' ? 'away' : 'home'].score ? 'leading' : game[side].score < game[side === 'home' ? 'away' : 'home'].score ? 'trailing' : 'tied',
            possession: summary?.situation?.possession || null,
            downDistance: summary?.situation?.downDistance || null,
            lastPlay: summary?.situation?.lastPlay || null,
            firstTdKnown: Boolean(summary?.firstTouchdown?.known),
            isFirstTdScorer: Boolean(summary?.firstTouchdown?.espnId && summary.firstTouchdown.espnId === player.espnId),
            estimatedPossessionsRemaining: Math.max(0, Math.round(12 * (1 - (summary?.progress ?? 0)))),
            stats: { completions: n(liveStats.completions), attempts: n(liveStats.attempts), passingYards: n(liveStats.passingYards), carries: n(liveStats.carries), rushingYards: n(liveStats.rushingYards), receptions: n(liveStats.receptions), receivingYards: n(liveStats.receivingYards), targets: n(liveStats.targets), totalTds: n(liveStats.totalTds) },
          },
        })
      }
    }
  }

  normalizeFirstTouchdownProbabilities(players, calibration)

  const anchor = games[0]
  const weatherCoverage = games.length ? games.filter((game) => summaries.get(game.id)?.weather?.tempF != null || game.venue.indoor).length / games.length : 0
  const defenseProfiles = Object.keys(history?.defenseAllowedByPosition || {}).length
  const depthFreshness = overlayFreshness(depthIndex.generatedAt, now, 168)
  const availabilityFreshness = overlayFreshness(availabilityIndex.generatedAt, now, 72)
  const weatherFreshness = overlayFreshness(weatherIndex.generatedAt, now, 24)
  const overlayWeatherCoverage = games.length ? games.filter((game) => weatherFor(game, weatherIndex) || game.venue.indoor).length / games.length : 0
  return {
    version: 2,
    sport: 'nfl',
    generatedAt: new Date().toISOString(),
    source: {
      mode: 'live',
      historicalFrom: history?.seasons?.[0] ?? 2020,
      historicalThrough: history?.seasons?.at?.(-1) ?? null,
      providers: { schedule: 'espn', rosters: 'espn', injuries: 'espn', practice: availabilityPayload ? 'availability-snapshot' : 'espn-when-reported', live: 'espn', history: history ? 'nflverse' : 'position-priors', odds: oddsResult.status === 'ok' ? 'sportsgameodds' : oddsResult.status },
      availabilityGeneratedAt: availabilityIndex.generatedAt,
      notes: ['ESPN endpoints are keyless and undocumented; failures retain the last published snapshot.', 'Model-reference lines are used when no sportsbook quote is available.'],
    },
    dataQuality: {
      playByPlay: Boolean(history?.coverage?.playByPlay),
      redZone: Boolean(history?.coverage?.redZone),
      defenseByPosition: Boolean(history?.coverage?.defenseByPosition || defenseProfiles),
      firstTouchdown: Boolean(history?.coverage?.firstTouchdown),
      depthChart: depthFreshness.fresh,
      officialAvailability: availabilityFreshness.fresh,
      weatherCoverage: Math.max(weatherCoverage, overlayWeatherCoverage),
      weatherFresh: weatherFreshness.fresh || weatherCoverage > 0,
      calibratedMarkets: Object.values(calibration).filter((market) => market?.samples > 0).length,
    },
    overlays: {
      depthChart: depthFreshness,
      availability: availabilityFreshness,
      weather: weatherFreshness,
    },
    modelPerformance,
    firstTdReserve: { listedOffense: .86, otherOffense: .06, defenseSpecialTeams: .06, noTouchdown: .02 },
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
