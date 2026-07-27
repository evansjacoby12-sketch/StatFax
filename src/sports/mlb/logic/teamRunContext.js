const MLB_RUNS_PER_TEAM = 4.42
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
const round = (value, digits = 4) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function number(value) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function mean(values) {
  const usable = values.filter(Number.isFinite)
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null
}

function splitByTeam(group) {
  return new Map((group?.splits || [])
    .filter((split) => Number.isFinite(Number(split?.team?.id)))
    .map((split) => [Number(split.team.id), split]))
}

/**
 * Convert official team season totals into small run-scale adjustments.
 * Defense uses errors, double plays, and caught stealings. Baserunning uses
 * conservative linear weights for steals and caught stealings. Both are
 * centered on the current league so they cannot move the overall run level.
 */
export function buildTeamSeasonRunProfiles(payload = {}) {
  const hittingGroup = (payload.stats || []).find((group) => group?.group?.displayName === 'hitting')
  const fieldingGroup = (payload.stats || []).find((group) => group?.group?.displayName === 'fielding')
  const hitting = splitByTeam(hittingGroup)
  const fielding = splitByTeam(fieldingGroup)
  const teamIds = [...new Set([...hitting.keys(), ...fielding.keys()])]
  const raw = teamIds.map((teamId) => {
    const hit = hitting.get(teamId)
    const field = fielding.get(teamId)
    const hittingGames = number(hit?.stat?.gamesPlayed) || 0
    const fieldingGames = number(field?.stat?.gamesPlayed) || 0
    const games = Math.min(hittingGames, fieldingGames)
    const stolenBases = number(hit?.stat?.stolenBases) || 0
    const caughtStealing = number(hit?.stat?.caughtStealing) || 0
    return {
      teamId,
      teamName: hit?.team?.name || field?.team?.name || '',
      games,
      errorsPerGame: fieldingGames > 0 ? (number(field?.stat?.errors) || 0) / fieldingGames : null,
      doublePlaysPerGame: fieldingGames > 0 ? (number(field?.stat?.doublePlays) || 0) / fieldingGames : null,
      caughtStealingDefensePerGame: fieldingGames > 0
        ? (number(field?.stat?.caughtStealing) || 0) / fieldingGames
        : null,
      stolenBases,
      caughtStealing,
      baserunningRunsPerGame: hittingGames > 0
        ? (0.20 * stolenBases - 0.45 * caughtStealing) / hittingGames
        : null,
    }
  }).filter((row) => (
    row.games >= 20
    && Number.isFinite(row.errorsPerGame)
    && Number.isFinite(row.doublePlaysPerGame)
    && Number.isFinite(row.caughtStealingDefensePerGame)
    && Number.isFinite(row.baserunningRunsPerGame)
  ))

  const league = {
    errorsPerGame: mean(raw.map((row) => row.errorsPerGame)),
    doublePlaysPerGame: mean(raw.map((row) => row.doublePlaysPerGame)),
    caughtStealingDefensePerGame: mean(raw.map((row) => row.caughtStealingDefensePerGame)),
    baserunningRunsPerGame: mean(raw.map((row) => row.baserunningRunsPerGame)),
  }
  const teams = {}
  for (const row of raw) {
    const defenseRunsAdjustment = clamp(
      0.55 * (row.errorsPerGame - (league.errorsPerGame ?? row.errorsPerGame))
        - 0.25 * (row.doublePlaysPerGame - (league.doublePlaysPerGame ?? row.doublePlaysPerGame))
        - 0.20 * (
          row.caughtStealingDefensePerGame
          - (league.caughtStealingDefensePerGame ?? row.caughtStealingDefensePerGame)
        ),
      -0.18,
      0.18,
    )
    const baserunningRunsAdjustment = clamp(
      row.baserunningRunsPerGame - (league.baserunningRunsPerGame ?? row.baserunningRunsPerGame),
      -0.12,
      0.12,
    )
    teams[row.teamId] = {
      teamId: row.teamId,
      teamName: row.teamName,
      games: row.games,
      errorsPerGame: round(row.errorsPerGame),
      doublePlaysPerGame: round(row.doublePlaysPerGame),
      caughtStealingDefensePerGame: round(row.caughtStealingDefensePerGame),
      stolenBases: row.stolenBases,
      caughtStealing: row.caughtStealing,
      baserunningRunsPerGame: round(row.baserunningRunsPerGame),
      defenseRunsAdjustment: round(defenseRunsAdjustment),
      baserunningRunsAdjustment: round(baserunningRunsAdjustment),
      defenseFactor: round(clamp(1 + defenseRunsAdjustment / MLB_RUNS_PER_TEAM, 0.96, 1.04)),
      baserunningFactor: round(clamp(1 + baserunningRunsAdjustment / MLB_RUNS_PER_TEAM, 0.973, 1.027)),
      coverage: round(clamp(row.games / 40, 0, 1)),
    }
  }

  return {
    version: 1,
    source: 'MLB Stats API team season hitting and fielding',
    season: Number(hittingGroup?.splits?.[0]?.season || fieldingGroup?.splits?.[0]?.season) || null,
    league: Object.fromEntries(Object.entries(league).map(([key, value]) => [key, round(value)])),
    teams,
  }
}

function dateMs(value) {
  return Date.parse(`${value}T12:00:00.000Z`)
}

function dateMinusDays(value, days) {
  const ms = dateMs(value)
  return Number.isFinite(ms) ? new Date(ms - days * 86_400_000).toISOString().slice(0, 10) : null
}

function opponentId(row, teamId) {
  if (Number(row?.awayTeam?.id) === Number(teamId)) return Number(row?.homeTeam?.id)
  if (Number(row?.homeTeam?.id) === Number(teamId)) return Number(row?.awayTeam?.id)
  return null
}

/**
 * Build no-leakage schedule fatigue context from games strictly before the
 * target date. Same-day results are never read; scheduled Game 2 status is
 * enough to apply the disclosed doubleheader adjustment.
 */
export function buildGameScheduleContexts(games = [], seasonResults = {}, targetDate) {
  const priorGames = (seasonResults?.games || []).filter((row) => (
    row?.officialDate && row.officialDate < targetDate
  ))
  const byGame = {}
  for (const game of games || []) {
    const teams = [
      [Number(game?.awayTeam?.id), Number(game?.homeTeam?.id)],
      [Number(game?.homeTeam?.id), Number(game?.awayTeam?.id)],
    ]
    byGame[game.gamePk] = {}
    for (const [teamId, currentOpponentId] of teams) {
      const history = priorGames
        .filter((row) => (
          Number(row?.awayTeam?.id) === teamId || Number(row?.homeTeam?.id) === teamId
        ))
        .sort((a, b) => (
          String(b.officialDate).localeCompare(String(a.officialDate))
          || String(b.gameDate || '').localeCompare(String(a.gameDate || ''))
        ))
      const last = history[0] || null
      const lastDate = last?.officialDate || null
      const daysSinceLast = lastDate
        ? Math.round((dateMs(targetDate) - dateMs(lastDate)) / 86_400_000)
        : null
      const daysRest = Number.isInteger(daysSinceLast) ? Math.max(0, daysSinceLast - 1) : null
      const previousDate = dateMinusDays(targetDate, 1)
      const previousDayGames = history.filter((row) => row.officialDate === previousDate).length
      const playedDates = new Set(history.map((row) => row.officialDate))
      let consecutiveDays = 0
      for (let offset = 1; offset <= 20; offset++) {
        if (!playedDates.has(dateMinusDays(targetDate, offset))) break
        consecutiveDays += 1
      }
      const lastOpponentId = last ? opponentId(last, teamId) : null
      const sameSeries = Number.isFinite(lastOpponentId) && lastOpponentId === currentOpponentId
      const travelSpot = daysRest === 0 && Number.isFinite(lastOpponentId) && !sameSeries
      const secondDoubleheaderGame = Number(game?.gameNumber) >= 2

      let factor = 1
      if (previousDayGames >= 2) factor -= 0.015
      if (consecutiveDays >= 7) factor -= 0.010
      if (travelSpot) factor -= 0.005
      if (secondDoubleheaderGame) factor -= 0.015
      factor = clamp(factor, 0.96, 1.01)

      byGame[game.gamePk][teamId] = {
        factor: round(factor),
        targetDate,
        lastGameDate: lastDate,
        daysRest,
        previousDayGames,
        consecutiveDays,
        sameSeries,
        travelSpot,
        secondDoubleheaderGame,
        historyGames: history.length,
        coverage: round(clamp(history.length / 10, 0, 1)),
      }
    }
  }
  return {
    version: 1,
    source: 'MLB season schedule before target date',
    targetDate,
    byGame,
  }
}
