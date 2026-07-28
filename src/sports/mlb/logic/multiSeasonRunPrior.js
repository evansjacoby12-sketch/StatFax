import {
  buildTeamScoringProfiles,
  teamScoringMatchupContext,
  validateMlbSeasonResults,
} from './teamScoringForm.js'
import { validateMlbGameHistory } from './gameHistoricalValidation.js'

export const MLB_MULTI_SEASON_RUN_PRIOR_VERSION = 1
export const MLB_MULTI_SEASON_RUN_EVALUATION_VERSION = 1

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
const round = (value, digits = 4) => {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
const mean = (values) => (
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
)

function eligibleGames(artifact, cutoffDate = null) {
  return (artifact?.games || []).filter((game) => (
    (!cutoffDate || game.officialDate < cutoffDate)
    && Number.isFinite(game.awayRuns)
    && Number.isFinite(game.homeRuns)
  ))
}

function seasonSummary(artifact, cutoffDate = null) {
  const games = eligibleGames(artifact, cutoffDate)
  const leagueRunsPerTeam = games.length
    ? games.reduce((sum, game) => sum + game.awayRuns + game.homeRuns, 0) / (games.length * 2)
    : null
  const teams = new Map()
  const add = (teamId, runsFor, runsAllowed) => {
    if (!teams.has(teamId)) teams.set(teamId, { games: 0, runsFor: 0, runsAllowed: 0 })
    const row = teams.get(teamId)
    row.games++
    row.runsFor += runsFor
    row.runsAllowed += runsAllowed
  }
  for (const game of games) {
    add(Number(game.awayTeam.id), game.awayRuns, game.homeRuns)
    add(Number(game.homeTeam.id), game.homeRuns, game.awayRuns)
  }
  const normalizedTeams = {}
  if (Number.isFinite(leagueRunsPerTeam) && leagueRunsPerTeam > 0) {
    for (const [teamId, row] of teams) {
      const scoringRate = row.runsFor / row.games
      const allowanceRate = row.runsAllowed / row.games
      // Roster churn makes raw year-over-year team rates too sticky. Shrink
      // every season toward its own league environment before applying decay.
      const scoringAdjusted = (
        scoringRate * row.games + leagueRunsPerTeam * 32
      ) / (row.games + 32)
      const allowanceAdjusted = (
        allowanceRate * row.games + leagueRunsPerTeam * 32
      ) / (row.games + 32)
      normalizedTeams[teamId] = {
        games: row.games,
        runsPerGame: round(scoringRate),
        runsAllowedPerGame: round(allowanceRate),
        scoringIndex: round(scoringAdjusted / leagueRunsPerTeam),
        allowanceIndex: round(allowanceAdjusted / leagueRunsPerTeam),
      }
    }
  }
  return {
    season: artifact?.season ?? null,
    games: games.length,
    leagueRunsPerTeam: round(leagueRunsPerTeam),
    teams: normalizedTeams,
  }
}

function weighted(values, field) {
  const usable = values.filter((row) => Number.isFinite(row?.[field]) && row.weight > 0)
  const weight = usable.reduce((sum, row) => sum + row.weight, 0)
  return weight
    ? usable.reduce((sum, row) => sum + row[field] * row.weight, 0) / weight
    : null
}

export function buildMultiSeasonRunProfiles(history, {
  season,
  cutoffDate,
  seasonsBack = 2,
  enabled = false,
} = {}) {
  const artifacts = validateMlbGameHistory(history).ok
    ? history.seasons.filter((artifact) => (
        Number(artifact.season) < Number(season)
        && Number(artifact.season) >= Number(season) - seasonsBack
        && validateMlbSeasonResults(artifact).ok
      ))
    : []
  const summaries = artifacts
    .map((artifact) => seasonSummary(artifact))
    .filter((summary) => summary.games > 0)
  const rows = summaries.map((summary) => ({
    ...summary,
    // Most recent prior season receives full weight; the second receives 55%.
    weight: 0.55 ** Math.max(0, Number(season) - Number(summary.season) - 1),
  }))
  const leagueRunsPerTeam = weighted(rows, 'leagueRunsPerTeam')
  const teamIds = new Set(rows.flatMap((row) => Object.keys(row.teams)))
  const teams = {}
  for (const teamId of teamIds) {
    const seasons = rows
      .map((row) => {
        const team = row.teams[teamId]
        return team ? { ...team, season: row.season, weight: row.weight } : null
      })
      .filter(Boolean)
    const scoringIndex = weighted(seasons, 'scoringIndex')
    const allowanceIndex = weighted(seasons, 'allowanceIndex')
    if (!Number.isFinite(scoringIndex) || !Number.isFinite(allowanceIndex)) continue
    teams[teamId] = {
      seasons: seasons.length,
      games: seasons.reduce((sum, row) => sum + row.games, 0),
      scoringIndex: round(scoringIndex),
      allowanceIndex: round(allowanceIndex),
      runsPerGame: round(weighted(seasons, 'runsPerGame')),
      runsAllowedPerGame: round(weighted(seasons, 'runsAllowedPerGame')),
      seasonWeights: Object.fromEntries(seasons.map((row) => [row.season, round(row.weight)])),
      coverage: round(clamp(seasons.length / seasonsBack, 0, 1)),
    }
  }
  return {
    version: MLB_MULTI_SEASON_RUN_PRIOR_VERSION,
    source: 'prior-season regular-season final scores',
    season: Number(season),
    cutoffDate,
    enabled: enabled === true,
    seasons: rows.map((row) => row.season),
    games: rows.reduce((sum, row) => sum + row.games, 0),
    leagueRunsPerTeam: round(leagueRunsPerTeam),
    teams,
  }
}

export function multiSeasonRunMatchupContext(
  currentProfiles,
  historicalProfiles,
  teamId,
  opponentTeamId,
) {
  const current = teamScoringMatchupContext(currentProfiles, teamId, opponentTeamId)
  const team = historicalProfiles?.teams?.[teamId]
  const opponent = historicalProfiles?.teams?.[opponentTeamId]
  const priorReady = (
    historicalProfiles?.enabled === true
    && team
    && opponent
    && Number.isFinite(historicalProfiles.leagueRunsPerTeam)
  )
  if (!priorReady) {
    return {
      ...current,
      source: 'current-season-only',
      currentSeasonFactor: current.factor,
      historicalFactor: null,
      historicalWeight: 0,
      leagueHistoricalWeight: 0,
      historicalSeasons: historicalProfiles?.seasons || [],
      historicalGames: historicalProfiles?.games || 0,
      historicalEnabled: false,
    }
  }

  const historicalFactor = clamp(
    Math.sqrt(team.scoringIndex * opponent.allowanceIndex),
    0.90,
    1.10,
  )
  const currentTeamGames = Math.min(current.teamGames || 0, current.opponentGames || 0)
  const historicalWeight = clamp(0.48 * Math.exp(-currentTeamGames / 42), 0.05, 0.48)
  const currentLeagueGames = currentProfiles?.games || 0
  const leagueHistoricalWeight = clamp(
    0.45 * Math.exp(-currentLeagueGames / 425),
    0.03,
    0.45,
  )
  const currentFactor = Number.isFinite(current.factor) ? current.factor : 1
  const factor = clamp(
    Math.exp(
      (1 - historicalWeight) * Math.log(currentFactor)
      + historicalWeight * Math.log(historicalFactor),
    ),
    0.92,
    1.08,
  )
  const currentLeague = current.leagueRunsPerTeam
  const leagueRunsPerTeam = Number.isFinite(currentLeague)
    ? (
        (1 - leagueHistoricalWeight) * currentLeague
        + leagueHistoricalWeight * historicalProfiles.leagueRunsPerTeam
      )
    : historicalProfiles.leagueRunsPerTeam
  return {
    ...current,
    factor: round(factor),
    coverage: round(clamp(
      (1 - historicalWeight) * current.coverage
      + historicalWeight * Math.min(team.coverage, opponent.coverage),
      0,
      1,
    )),
    leagueRunsPerTeam: round(leagueRunsPerTeam),
    source: 'current-season-plus-prior-seasons',
    currentSeasonFactor: round(currentFactor),
    historicalFactor: round(historicalFactor),
    historicalWeight: round(historicalWeight),
    leagueHistoricalWeight: round(leagueHistoricalWeight),
    historicalSeasons: historicalProfiles.seasons,
    historicalGames: historicalProfiles.games,
    historicalTeamGames: team.games,
    historicalOpponentGames: opponent.games,
    historicalEnabled: true,
  }
}

function metrics(teamErrors, totalErrors) {
  return {
    teamRunMae: round(mean(teamErrors.map(Math.abs))),
    teamRunRmse: round(Math.sqrt(mean(teamErrors.map((error) => error ** 2)))),
    totalMae: round(mean(totalErrors.map(Math.abs))),
    totalRmse: round(Math.sqrt(mean(totalErrors.map((error) => error ** 2)))),
  }
}

function improvement(currentSeason, multiSeason) {
  const delta = (field) => (
    Number.isFinite(currentSeason[field]) && Number.isFinite(multiSeason[field])
      ? round(currentSeason[field] - multiSeason[field])
      : null
  )
  return {
    teamRunMae: delta('teamRunMae'),
    teamRunRmse: delta('teamRunRmse'),
    totalMae: delta('totalMae'),
    totalRmse: delta('totalRmse'),
  }
}

function evaluateTargetSeason(history, artifact, {
  minimumPriorGames,
  minimumCoverage,
} = {}) {
  const byDate = new Map()
  for (const game of artifact.games || []) {
    if (!byDate.has(game.officialDate)) byDate.set(game.officialDate, [])
    byDate.get(game.officialDate).push(game)
  }
  const errors = {
    currentTeam: [],
    historicalTeam: [],
    currentTotal: [],
    historicalTotal: [],
  }
  const evaluatedDates = []
  for (const [date, games] of [...byDate].sort(([left], [right]) => left.localeCompare(right))) {
    const currentProfiles = buildTeamScoringProfiles(artifact, date)
    if (currentProfiles.games < minimumPriorGames) continue
    const historicalProfiles = buildMultiSeasonRunProfiles(history, {
      season: artifact.season,
      cutoffDate: date,
      enabled: true,
    })
    let dateGames = 0
    for (const game of games) {
      const currentAway = teamScoringMatchupContext(
        currentProfiles,
        game.awayTeam.id,
        game.homeTeam.id,
      )
      const currentHome = teamScoringMatchupContext(
        currentProfiles,
        game.homeTeam.id,
        game.awayTeam.id,
      )
      if (
        currentAway.coverage < minimumCoverage
        || currentHome.coverage < minimumCoverage
      ) continue
      const historicalAway = multiSeasonRunMatchupContext(
        currentProfiles,
        historicalProfiles,
        game.awayTeam.id,
        game.homeTeam.id,
      )
      const historicalHome = multiSeasonRunMatchupContext(
        currentProfiles,
        historicalProfiles,
        game.homeTeam.id,
        game.awayTeam.id,
      )
      if (!historicalAway.historicalEnabled || !historicalHome.historicalEnabled) continue
      const currentBase = currentProfiles.leagueRunsPerTeam
      const currentExpectedAway = currentBase * 0.98 * currentAway.factor
      const currentExpectedHome = currentBase * 1.02 * currentHome.factor
      const historicalExpectedAway = historicalAway.leagueRunsPerTeam * 0.98 * historicalAway.factor
      const historicalExpectedHome = historicalHome.leagueRunsPerTeam * 1.02 * historicalHome.factor
      errors.currentTeam.push(
        currentExpectedAway - game.awayRuns,
        currentExpectedHome - game.homeRuns,
      )
      errors.historicalTeam.push(
        historicalExpectedAway - game.awayRuns,
        historicalExpectedHome - game.homeRuns,
      )
      errors.currentTotal.push(
        currentExpectedAway + currentExpectedHome - game.awayRuns - game.homeRuns,
      )
      errors.historicalTotal.push(
        historicalExpectedAway + historicalExpectedHome - game.awayRuns - game.homeRuns,
      )
      dateGames++
    }
    if (dateGames) evaluatedDates.push(date)
  }
  const currentSeason = metrics(errors.currentTeam, errors.currentTotal)
  const multiSeason = metrics(errors.historicalTeam, errors.historicalTotal)
  return {
    season: artifact.season,
    sample: {
      games: errors.currentTotal.length,
      teamRuns: errors.currentTeam.length,
      dates: evaluatedDates.length,
      fromDate: evaluatedDates[0] || null,
      throughDate: evaluatedDates.at(-1) || null,
    },
    currentSeason,
    multiSeason,
    improvement: improvement(currentSeason, multiSeason),
  }
}

function weightedMetric(rows, section, field, weightField = 'games') {
  const usable = rows.filter((row) => (
    Number.isFinite(row?.[section]?.[field])
    && Number.isFinite(row?.sample?.[weightField])
    && row.sample[weightField] > 0
  ))
  const weight = usable.reduce((sum, row) => sum + row.sample[weightField], 0)
  return weight
    ? round(usable.reduce((sum, row) => (
        sum + row[section][field] * row.sample[weightField]
      ), 0) / weight)
    : null
}

export function evaluateMultiSeasonRunPrior(history, {
  minimumPriorGames = 100,
  minimumCoverage = 0.5,
  minimumSeasons = 2,
  minimumGames = 2500,
  minimumDates = 200,
} = {}) {
  const artifacts = validateMlbGameHistory(history).ok ? history.seasons : []
  const available = new Set(artifacts.map((artifact) => Number(artifact.season)))
  const seasons = artifacts
    .filter((artifact) => (
      available.has(Number(artifact.season) - 1)
      && validateMlbSeasonResults(artifact).ok
    ))
    .map((artifact) => evaluateTargetSeason(history, artifact, {
      minimumPriorGames,
      minimumCoverage,
    }))
    .filter((row) => row.sample.games > 0)
  const aggregate = (section) => ({
    teamRunMae: weightedMetric(seasons, section, 'teamRunMae', 'teamRuns'),
    teamRunRmse: weightedMetric(seasons, section, 'teamRunRmse', 'teamRuns'),
    totalMae: weightedMetric(seasons, section, 'totalMae'),
    totalRmse: weightedMetric(seasons, section, 'totalRmse'),
  })
  const currentSeason = aggregate('currentSeason')
  const multiSeason = aggregate('multiSeason')
  const aggregateImprovement = improvement(currentSeason, multiSeason)
  const sample = {
    seasons: seasons.length,
    games: seasons.reduce((sum, row) => sum + row.sample.games, 0),
    teamRuns: seasons.reduce((sum, row) => sum + row.sample.teamRuns, 0),
    dates: seasons.reduce((sum, row) => sum + row.sample.dates, 0),
    fromDate: seasons.map((row) => row.sample.fromDate).filter(Boolean).sort()[0] || null,
    throughDate: seasons.map((row) => row.sample.throughDate).filter(Boolean).sort().at(-1) || null,
  }
  const checks = {
    seasons: sample.seasons >= minimumSeasons,
    games: sample.games >= minimumGames,
    dates: sample.dates >= minimumDates,
    teamRunMae: Number.isFinite(aggregateImprovement.teamRunMae)
      && aggregateImprovement.teamRunMae > 0,
    totalMae: Number.isFinite(aggregateImprovement.totalMae)
      && aggregateImprovement.totalMae > 0,
    seasonStability: seasons.every((row) => (
      row.improvement.teamRunMae >= -0.01
      && row.improvement.totalMae >= -0.03
    )),
  }
  const sampleReady = checks.seasons && checks.games && checks.dates
  const eligible = Object.values(checks).every(Boolean)
  return {
    version: MLB_MULTI_SEASON_RUN_EVALUATION_VERSION,
    advisoryOnly: true,
    methodology: 'season-isolated-expanding-date-champion-challenger',
    status: eligible ? 'eligible' : sampleReady ? 'hold' : 'collecting',
    eligible,
    minimumSample: {
      seasons: minimumSeasons,
      games: minimumGames,
      dates: minimumDates,
    },
    sample,
    currentSeason,
    multiSeason,
    improvement: aggregateImprovement,
    checks,
    seasons,
    note: 'The challenger uses only completed prior seasons plus target-season games strictly before each forecast date. It changes run scoring only when it beats the current-season backbone.',
  }
}
