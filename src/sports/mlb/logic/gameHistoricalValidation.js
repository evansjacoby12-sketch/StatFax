import {
  evaluateTeamScoringForm,
  validateMlbSeasonResults,
} from './teamScoringForm.js'

export const MLB_GAME_HISTORY_VERSION = 1
export const MLB_GAME_HISTORICAL_VALIDATION_VERSION = 1
export const MLB_GAME_HISTORICAL_MIN_SEASONS = 3
export const MLB_GAME_HISTORICAL_MIN_GAMES = 3000
export const MLB_GAME_HISTORICAL_MIN_DATES = 250

const HISTORY_SOURCE = 'MLB Stats API regular-season final scores'

const round = (value, digits = 4) => {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const validIso = (value) => !Number.isNaN(Date.parse(value))

function sortedSeasonArtifacts(seasons) {
  return [...(seasons || [])]
    .filter((artifact) => validateMlbSeasonResults(artifact).ok)
    .sort((left, right) => Number(left.season) - Number(right.season))
}

export function buildMlbGameHistory(seasons, {
  fetchedAt = new Date().toISOString(),
} = {}) {
  return {
    version: MLB_GAME_HISTORY_VERSION,
    source: HISTORY_SOURCE,
    fetchedAt,
    seasons: sortedSeasonArtifacts(seasons),
  }
}

export function validateMlbGameHistory(history) {
  const errors = []
  if (!history || typeof history !== 'object' || Array.isArray(history)) {
    return { ok: false, errors: ['artifact: expected an object'], metrics: {} }
  }
  if (history.version !== MLB_GAME_HISTORY_VERSION) {
    errors.push(`version: expected ${MLB_GAME_HISTORY_VERSION}`)
  }
  if (history.source !== HISTORY_SOURCE) errors.push('source: unsupported')
  if (!validIso(history.fetchedAt)) errors.push('fetchedAt: expected an ISO timestamp')
  if (!Array.isArray(history.seasons)) {
    errors.push('seasons: expected an array')
    return { ok: false, errors, metrics: {} }
  }

  const seen = new Set()
  let previousSeason = -Infinity
  let games = 0
  for (const [index, artifact] of history.seasons.entries()) {
    const season = Number(artifact?.season)
    if (!Number.isInteger(season)) errors.push(`seasons[${index}].season: expected an integer`)
    if (seen.has(season)) errors.push(`seasons[${index}].season: duplicate ${season}`)
    if (season < previousSeason) errors.push(`seasons[${index}]: seasons must be sorted`)
    seen.add(season)
    previousSeason = season
    const validation = validateMlbSeasonResults(artifact)
    for (const error of validation.errors) errors.push(`seasons[${index}].${error}`)
    games += validation.metrics?.games || 0
  }

  return {
    ok: errors.length === 0,
    errors,
    metrics: {
      seasons: history.seasons.length,
      seasonNumbers: history.seasons.map((artifact) => artifact.season),
      games,
    },
  }
}

function weightedMean(evaluations, section, field, weightField = 'games') {
  let weighted = 0
  let weight = 0
  for (const evaluation of evaluations) {
    const value = evaluation?.[section]?.[field]
    const rowWeight = evaluation?.sample?.[weightField]
    if (!Number.isFinite(value) || !Number.isFinite(rowWeight) || rowWeight <= 0) continue
    weighted += value * rowWeight
    weight += rowWeight
  }
  return weight ? round(weighted / weight) : null
}

function aggregateMetrics(evaluations, section) {
  return {
    teamRunMae: weightedMean(evaluations, section, 'teamRunMae', 'teamRuns'),
    teamRunRmse: weightedMean(evaluations, section, 'teamRunRmse', 'teamRuns'),
    totalMae: weightedMean(evaluations, section, 'totalMae'),
    totalRmse: weightedMean(evaluations, section, 'totalRmse'),
    winnerAccuracy: weightedMean(evaluations, section, 'winnerAccuracy'),
    winnerBrier: weightedMean(evaluations, section, 'winnerBrier'),
  }
}

function improvement(baseline, forecastBackbone) {
  const lowerIsBetter = (field) => (
    Number.isFinite(baseline[field]) && Number.isFinite(forecastBackbone[field])
      ? round(baseline[field] - forecastBackbone[field])
      : null
  )
  return {
    teamRunMae: lowerIsBetter('teamRunMae'),
    teamRunRmse: lowerIsBetter('teamRunRmse'),
    totalMae: lowerIsBetter('totalMae'),
    totalRmse: lowerIsBetter('totalRmse'),
    winnerAccuracy: (
      Number.isFinite(baseline.winnerAccuracy)
      && Number.isFinite(forecastBackbone.winnerAccuracy)
    ) ? round(forecastBackbone.winnerAccuracy - baseline.winnerAccuracy) : null,
    winnerBrier: lowerIsBetter('winnerBrier'),
  }
}

function gateStatus(checks) {
  const sampleReady = checks.seasons && checks.sample && checks.dates
  if (Object.values(checks).every(Boolean)) return 'eligible'
  return sampleReady ? 'hold' : 'collecting'
}

export function evaluateGameHistoricalValidation(history, {
  minimumSeasons = MLB_GAME_HISTORICAL_MIN_SEASONS,
  minimumGames = MLB_GAME_HISTORICAL_MIN_GAMES,
  minimumDates = MLB_GAME_HISTORICAL_MIN_DATES,
  minimumPriorGames = 100,
  minimumCoverage = 0.5,
} = {}) {
  const artifacts = validateMlbGameHistory(history).ok
    ? history.seasons
    : []
  const seasonRows = artifacts.map((artifact) => {
    const evaluation = evaluateTeamScoringForm(artifact, {
      minimumPriorGames,
      minimumCoverage,
    })
    return {
      season: artifact.season,
      archivedGames: artifact.games.length,
      throughDate: artifact.throughDate,
      ...evaluation,
    }
  }).filter((row) => row.sample.games > 0)

  const baseline = aggregateMetrics(seasonRows, 'baseline')
  const forecastBackbone = aggregateMetrics(seasonRows, 'seasonForm')
  const aggregateImprovement = improvement(baseline, forecastBackbone)
  const sample = {
    seasons: seasonRows.length,
    games: seasonRows.reduce((sum, row) => sum + row.sample.games, 0),
    teamRuns: seasonRows.reduce((sum, row) => sum + row.sample.teamRuns, 0),
    dates: seasonRows.reduce((sum, row) => sum + row.sample.dates, 0),
    fromDate: seasonRows.map((row) => row.sample.fromDate).filter(Boolean).sort()[0] || null,
    throughDate: seasonRows.map((row) => row.sample.throughDate).filter(Boolean).sort().at(-1) || null,
  }
  const commonChecks = {
    seasons: sample.seasons >= minimumSeasons,
    sample: sample.games >= minimumGames,
    dates: sample.dates >= minimumDates,
  }
  const moneylineChecks = {
    ...commonChecks,
    brier: Number.isFinite(aggregateImprovement.winnerBrier)
      && aggregateImprovement.winnerBrier >= 0,
    accuracy: Number.isFinite(forecastBackbone.winnerAccuracy)
      && forecastBackbone.winnerAccuracy >= 0.5,
    seasonStability: seasonRows.every((row) => (
      Number.isFinite(row.improvement.winnerBrier)
      && row.improvement.winnerBrier >= -0.0025
    )),
  }
  const totalChecks = {
    ...commonChecks,
    totalError: Number.isFinite(aggregateImprovement.totalMae)
      && aggregateImprovement.totalMae >= 0,
    seasonStability: seasonRows.every((row) => (
      Number.isFinite(row.improvement.totalMae)
      && row.improvement.totalMae >= -0.05
    )),
  }
  const moneylineStatus = gateStatus(moneylineChecks)
  const totalStatus = gateStatus(totalChecks)
  const status = moneylineStatus === 'eligible' && totalStatus === 'eligible'
    ? 'eligible'
    : moneylineStatus === 'collecting' || totalStatus === 'collecting'
      ? 'collecting'
      : 'hold'

  return {
    version: MLB_GAME_HISTORICAL_VALIDATION_VERSION,
    advisoryOnly: true,
    methodology: 'season-isolated-expanding-date-walk-forward',
    scope: 'team-scoring forecast backbone; excludes historical prices, lineups, starters, bullpens, and weather',
    status,
    updatedAt: validIso(history?.fetchedAt) ? history.fetchedAt : null,
    minimumSample: {
      seasons: minimumSeasons,
      games: minimumGames,
      dates: minimumDates,
    },
    sample,
    baseline,
    forecastBackbone,
    improvement: aggregateImprovement,
    markets: {
      moneyline: {
        status: moneylineStatus,
        eligible: moneylineStatus === 'eligible',
        checks: moneylineChecks,
        sample: { seasons: sample.seasons, games: sample.games, dates: sample.dates },
        baselineBrier: baseline.winnerBrier,
        forecastBrier: forecastBackbone.winnerBrier,
        brierImprovement: aggregateImprovement.winnerBrier,
        forecastAccuracy: forecastBackbone.winnerAccuracy,
      },
      total: {
        status: totalStatus,
        eligible: totalStatus === 'eligible',
        checks: totalChecks,
        sample: { seasons: sample.seasons, games: sample.games, dates: sample.dates },
        baselineMae: baseline.totalMae,
        forecastMae: forecastBackbone.totalMae,
        maeImprovement: aggregateImprovement.totalMae,
      },
    },
    seasons: seasonRows,
    note: 'Historical final scores validate the leakage-safe scoring backbone. Current consensus prices still determine each call; settled calls remain the forward drift monitor and do not train this gate.',
  }
}
