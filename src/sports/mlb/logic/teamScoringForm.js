export const MLB_GAME_RESULTS_VERSION = 1
export const MLB_TEAM_SCORING_FORM_VERSION = 1

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
const round = (value, digits = 3) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function validDate(value) {
  return typeof value === 'string' && DATE_RE.test(value)
}

function finiteTeam(team) {
  const id = Number(team?.id)
  if (!Number.isFinite(id)) return null
  return {
    id,
    name: String(team?.name || ''),
  }
}

function normalizeFinalGame(game, officialDate) {
  if (
    game?.gameType !== 'R'
    || game?.status?.abstractGameState !== 'Final'
    || !Number.isFinite(game?.teams?.away?.score)
    || !Number.isFinite(game?.teams?.home?.score)
  ) return null

  const awayTeam = finiteTeam(game.teams.away.team)
  const homeTeam = finiteTeam(game.teams.home.team)
  const gamePk = Number(game.gamePk)
  const gameDate = game.gameDate
  if (
    !awayTeam
    || !homeTeam
    || awayTeam.id === homeTeam.id
    || !Number.isFinite(gamePk)
    || !validDate(officialDate)
    || Number.isNaN(Date.parse(gameDate))
  ) return null

  return {
    gamePk,
    officialDate,
    gameDate,
    gameType: 'R',
    gameNumber: Number.isFinite(game.gameNumber) ? Number(game.gameNumber) : 1,
    doubleHeader: String(game.doubleHeader || 'N'),
    awayTeam,
    homeTeam,
    awayRuns: Number(game.teams.away.score),
    homeRuns: Number(game.teams.home.score),
  }
}

function sortGames(games) {
  return [...games].sort((a, b) => (
    String(a.officialDate).localeCompare(String(b.officialDate))
    || String(a.gameDate).localeCompare(String(b.gameDate))
    || Number(a.gamePk) - Number(b.gamePk)
  ))
}

export function parseMlbSeasonResults(schedule, {
  season,
  throughDate,
  fetchedAt = new Date().toISOString(),
} = {}) {
  const games = []
  for (const day of schedule?.dates || []) {
    const officialDate = validDate(day?.date) ? day.date : null
    for (const game of day?.games || []) {
      const normalized = normalizeFinalGame(game, officialDate || game?.officialDate)
      if (
        normalized
        && (!Number.isInteger(season) || Number(normalized.officialDate.slice(0, 4)) === season)
        && (!validDate(throughDate) || normalized.officialDate <= throughDate)
      ) games.push(normalized)
    }
  }

  const deduped = new Map()
  for (const game of games) deduped.set(game.gamePk, game)
  const sorted = sortGames(deduped.values())
  return {
    version: MLB_GAME_RESULTS_VERSION,
    season: Number(season),
    source: 'MLB Stats API schedule',
    fetchedAt,
    throughDate,
    fromDate: sorted[0]?.officialDate || null,
    games: sorted,
  }
}

export function mergeMlbSeasonResults(prior, incoming) {
  if (
    !prior
    || prior.version !== MLB_GAME_RESULTS_VERSION
    || Number(prior.season) !== Number(incoming?.season)
  ) return incoming

  const merged = new Map()
  for (const game of prior.games || []) merged.set(Number(game.gamePk), game)
  for (const game of incoming?.games || []) merged.set(Number(game.gamePk), game)
  const games = sortGames(merged.values())
  return {
    ...incoming,
    fromDate: games[0]?.officialDate || null,
    games,
  }
}

export function validateMlbSeasonResults(artifact) {
  const errors = []
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return { ok: false, errors: ['artifact: expected an object'], metrics: {} }
  }
  if (artifact.version !== MLB_GAME_RESULTS_VERSION) errors.push(`version: expected ${MLB_GAME_RESULTS_VERSION}`)
  if (!Number.isInteger(artifact.season)) errors.push('season: expected an integer')
  if (artifact.source !== 'MLB Stats API schedule') errors.push('source: unsupported')
  if (Number.isNaN(Date.parse(artifact.fetchedAt))) errors.push('fetchedAt: expected an ISO timestamp')
  if (!validDate(artifact.throughDate)) errors.push('throughDate: expected YYYY-MM-DD')
  if (artifact.fromDate != null && !validDate(artifact.fromDate)) errors.push('fromDate: expected null or YYYY-MM-DD')
  if (!Array.isArray(artifact.games)) {
    errors.push('games: expected an array')
    return { ok: false, errors, metrics: {} }
  }

  const seen = new Set()
  let priorSortKey = ''
  for (const [index, game] of artifact.games.entries()) {
    const at = `games[${index}]`
    if (!Number.isFinite(game?.gamePk)) errors.push(`${at}.gamePk: expected a finite number`)
    if (seen.has(game?.gamePk)) errors.push(`${at}.gamePk: duplicate ${String(game?.gamePk)}`)
    seen.add(game?.gamePk)
    if (!validDate(game?.officialDate)) errors.push(`${at}.officialDate: expected YYYY-MM-DD`)
    if (Number.isNaN(Date.parse(game?.gameDate))) errors.push(`${at}.gameDate: expected an ISO timestamp`)
    if (game?.gameType !== 'R') errors.push(`${at}.gameType: expected R`)
    if (!Number.isFinite(game?.awayTeam?.id) || !Number.isFinite(game?.homeTeam?.id)) {
      errors.push(`${at}: team IDs must be finite`)
    } else if (game.awayTeam.id === game.homeTeam.id) {
      errors.push(`${at}: away and home team IDs must differ`)
    }
    for (const field of ['awayRuns', 'homeRuns']) {
      if (!Number.isInteger(game?.[field]) || game[field] < 0) errors.push(`${at}.${field}: expected a non-negative integer`)
    }
    const sortKey = `${game?.officialDate || ''}|${game?.gameDate || ''}|${String(game?.gamePk || '').padStart(10, '0')}`
    if (priorSortKey && sortKey < priorSortKey) errors.push(`${at}: games must be sorted by date and gamePk`)
    priorSortKey = sortKey
    if (validDate(artifact.throughDate) && validDate(game?.officialDate) && game.officialDate > artifact.throughDate) {
      errors.push(`${at}.officialDate: cannot exceed throughDate`)
    }
  }
  if (artifact.games.length && artifact.fromDate !== artifact.games[0]?.officialDate) {
    errors.push('fromDate: must match the earliest game')
  }

  return {
    ok: errors.length === 0,
    errors,
    metrics: {
      games: artifact.games.length,
      teams: new Set(artifact.games.flatMap((game) => [game.awayTeam?.id, game.homeTeam?.id])).size,
      fromDate: artifact.fromDate,
      throughDate: artifact.throughDate,
    },
  }
}

function mean(rows, field) {
  if (!rows.length) return null
  return rows.reduce((sum, row) => sum + row[field], 0) / rows.length
}

function shrunkRate(rate, sample, prior, priorGames) {
  if (!Number.isFinite(rate) || !(sample > 0)) return prior
  return (rate * sample + prior * priorGames) / (sample + priorGames)
}

function teamProfile(teamId, rows, leagueRunsPerTeam) {
  const ordered = [...rows].sort((a, b) => (
    a.officialDate.localeCompare(b.officialDate)
    || String(a.gameDate).localeCompare(String(b.gameDate))
    || a.gamePk - b.gamePk
  ))
  const recent = (count) => ordered.slice(-count)
  const recent7 = recent(7)
  const recent14 = recent(14)
  const recent30 = recent(30)
  const seasonRuns = mean(ordered, 'runsFor')
  const seasonAllowed = mean(ordered, 'runsAllowed')
  const seasonRunsAdjusted = shrunkRate(seasonRuns, ordered.length, leagueRunsPerTeam, 24)
  const seasonAllowedAdjusted = shrunkRate(seasonAllowed, ordered.length, leagueRunsPerTeam, 24)
  const recentRunsAdjusted = shrunkRate(mean(recent14, 'runsFor'), recent14.length, seasonRunsAdjusted, 14)
  const recentAllowedAdjusted = shrunkRate(mean(recent14, 'runsAllowed'), recent14.length, seasonAllowedAdjusted, 14)
  const blendedRuns = 0.68 * seasonRunsAdjusted + 0.32 * recentRunsAdjusted
  const blendedAllowed = 0.68 * seasonAllowedAdjusted + 0.32 * recentAllowedAdjusted

  return {
    teamId: Number(teamId),
    games: ordered.length,
    runsPerGame: round(seasonRuns),
    runsAllowedPerGame: round(seasonAllowed),
    recent7: {
      games: recent7.length,
      runsPerGame: round(mean(recent7, 'runsFor')),
      runsAllowedPerGame: round(mean(recent7, 'runsAllowed')),
    },
    recent14: {
      games: recent14.length,
      runsPerGame: round(mean(recent14, 'runsFor')),
      runsAllowedPerGame: round(mean(recent14, 'runsAllowed')),
    },
    recent30: {
      games: recent30.length,
      runsPerGame: round(mean(recent30, 'runsFor')),
      runsAllowedPerGame: round(mean(recent30, 'runsAllowed')),
    },
    scoringIndex: round(blendedRuns / leagueRunsPerTeam, 4),
    allowanceIndex: round(blendedAllowed / leagueRunsPerTeam, 4),
    coverage: round(
      0.75 * clamp(ordered.length / 30, 0, 1)
      + 0.25 * clamp(recent14.length / 14, 0, 1),
      4,
    ),
  }
}

export function buildTeamScoringProfiles(artifact, cutoffDate) {
  const eligible = (artifact?.games || []).filter((game) => (
    validDate(game?.officialDate)
    && validDate(cutoffDate)
    && game.officialDate < cutoffDate
    && Number.isFinite(game.awayRuns)
    && Number.isFinite(game.homeRuns)
  ))
  const totalRuns = eligible.reduce((sum, game) => sum + game.awayRuns + game.homeRuns, 0)
  const leagueRunsPerTeam = eligible.length ? totalRuns / (eligible.length * 2) : null
  const rowsByTeam = new Map()
  const add = (teamId, row) => {
    if (!rowsByTeam.has(teamId)) rowsByTeam.set(teamId, [])
    rowsByTeam.get(teamId).push(row)
  }
  for (const game of eligible) {
    add(Number(game.awayTeam.id), {
      gamePk: game.gamePk,
      officialDate: game.officialDate,
      gameDate: game.gameDate,
      runsFor: game.awayRuns,
      runsAllowed: game.homeRuns,
    })
    add(Number(game.homeTeam.id), {
      gamePk: game.gamePk,
      officialDate: game.officialDate,
      gameDate: game.gameDate,
      runsFor: game.homeRuns,
      runsAllowed: game.awayRuns,
    })
  }

  const teams = {}
  if (Number.isFinite(leagueRunsPerTeam) && leagueRunsPerTeam > 0) {
    for (const [teamId, rows] of rowsByTeam) {
      teams[teamId] = teamProfile(teamId, rows, leagueRunsPerTeam)
    }
  }
  return {
    version: MLB_TEAM_SCORING_FORM_VERSION,
    source: 'MLB season final scores',
    season: artifact?.season ?? null,
    cutoffDate,
    games: eligible.length,
    leagueRunsPerTeam: Number.isFinite(leagueRunsPerTeam) ? round(leagueRunsPerTeam, 4) : null,
    teams,
  }
}

export function teamScoringMatchupContext(profiles, teamId, opponentTeamId) {
  const team = profiles?.teams?.[teamId]
  const opponent = profiles?.teams?.[opponentTeamId]
  const leagueRunsPerTeam = profiles?.leagueRunsPerTeam
  if (!team || !opponent || !Number.isFinite(leagueRunsPerTeam)) {
    return {
      factor: 1,
      coverage: 0,
      cutoffDate: profiles?.cutoffDate || null,
      leagueRunsPerTeam: Number.isFinite(leagueRunsPerTeam) ? leagueRunsPerTeam : null,
      teamGames: team?.games || 0,
      teamRunsPerGame: team?.runsPerGame ?? null,
      teamRecent14RunsPerGame: team?.recent14?.runsPerGame ?? null,
      opponentGames: opponent?.games || 0,
      opponentRunsAllowedPerGame: opponent?.runsAllowedPerGame ?? null,
      opponentRecent14RunsAllowedPerGame: opponent?.recent14?.runsAllowedPerGame ?? null,
    }
  }

  const coverage = (team.coverage + opponent.coverage) / 2
  const matchupIndex = Math.sqrt(team.scoringIndex * opponent.allowanceIndex)
  // Team score history overlaps with lineup quality, so retain only a
  // conservative residual and cap its impact until forward validation grows.
  const factor = clamp(1 + 0.45 * coverage * (matchupIndex - 1), 0.92, 1.08)
  return {
    factor: round(factor, 4),
    coverage: round(coverage, 4),
    cutoffDate: profiles.cutoffDate,
    leagueRunsPerTeam,
    teamGames: team.games,
    teamRunsPerGame: team.runsPerGame,
    teamRecent14RunsPerGame: team.recent14.runsPerGame,
    opponentGames: opponent.games,
    opponentRunsAllowedPerGame: opponent.runsAllowedPerGame,
    opponentRecent14RunsAllowedPerGame: opponent.recent14.runsAllowedPerGame,
  }
}

export function evaluateTeamScoringForm(artifact, {
  minimumPriorGames = 100,
  minimumCoverage = 0.5,
} = {}) {
  const byDate = new Map()
  for (const game of artifact?.games || []) {
    if (!validDate(game?.officialDate)) continue
    if (!byDate.has(game.officialDate)) byDate.set(game.officialDate, [])
    byDate.get(game.officialDate).push(game)
  }
  const teamRunErrors = { baseline: [], form: [] }
  const winnerCorrect = { baseline: [], form: [] }
  const evaluatedDates = []
  let gameSample = 0

  for (const [date, games] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const profiles = buildTeamScoringProfiles(artifact, date)
    if (profiles.games < minimumPriorGames || !Number.isFinite(profiles.leagueRunsPerTeam)) continue
    let dateSample = 0
    for (const game of games) {
      const away = teamScoringMatchupContext(profiles, game.awayTeam.id, game.homeTeam.id)
      const home = teamScoringMatchupContext(profiles, game.homeTeam.id, game.awayTeam.id)
      if (away.coverage < minimumCoverage || home.coverage < minimumCoverage) continue
      const baselineAway = profiles.leagueRunsPerTeam * 0.98
      const baselineHome = profiles.leagueRunsPerTeam * 1.02
      const formAway = baselineAway * away.factor
      const formHome = baselineHome * home.factor
      teamRunErrors.baseline.push(baselineAway - game.awayRuns, baselineHome - game.homeRuns)
      teamRunErrors.form.push(formAway - game.awayRuns, formHome - game.homeRuns)
      if (game.awayRuns !== game.homeRuns) {
        const homeWon = game.homeRuns > game.awayRuns
        winnerCorrect.baseline.push((baselineHome > baselineAway) === homeWon ? 1 : 0)
        winnerCorrect.form.push((formHome > formAway) === homeWon ? 1 : 0)
      }
      gameSample++
      dateSample++
    }
    if (dateSample) evaluatedDates.push(date)
  }

  const average = (values) => (
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  )
  const metrics = (errors, winners) => {
    const mae = average(errors.map(Math.abs))
    const mse = average(errors.map((error) => error ** 2))
    return {
      teamRunMae: Number.isFinite(mae) ? round(mae, 4) : null,
      teamRunRmse: Number.isFinite(mse) ? round(Math.sqrt(mse), 4) : null,
      winnerAccuracy: Number.isFinite(average(winners)) ? round(average(winners), 4) : null,
    }
  }
  const baseline = metrics(teamRunErrors.baseline, winnerCorrect.baseline)
  const form = metrics(teamRunErrors.form, winnerCorrect.form)
  const improvement = (baselineValue, formValue, higherIsBetter = false) => (
    Number.isFinite(baselineValue) && Number.isFinite(formValue)
      ? round(higherIsBetter ? formValue - baselineValue : baselineValue - formValue, 4)
      : null
  )

  return {
    version: MLB_TEAM_SCORING_FORM_VERSION,
    advisoryOnly: true,
    methodology: 'expanding-date walk-forward',
    minimumPriorGames,
    minimumCoverage,
    sample: {
      games: gameSample,
      teamRuns: teamRunErrors.form.length,
      dates: evaluatedDates.length,
      fromDate: evaluatedDates[0] || null,
      throughDate: evaluatedDates.at(-1) || null,
    },
    baseline,
    seasonForm: form,
    improvement: {
      teamRunMae: improvement(baseline.teamRunMae, form.teamRunMae),
      teamRunRmse: improvement(baseline.teamRunRmse, form.teamRunRmse),
      winnerAccuracy: improvement(baseline.winnerAccuracy, form.winnerAccuracy, true),
    },
  }
}
