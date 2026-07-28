import {
  buildMlbGameHistory,
  validateMlbGameHistory,
} from '../../src/sports/mlb/logic/gameHistoricalValidation.js'
import { validateMlbSeasonResults } from '../../src/sports/mlb/logic/teamScoringForm.js'
import { refreshMlbSeasonResults } from './mlbGameResults.mjs'

function validSeasonArtifact(artifact, season) {
  return Number(artifact?.season) === Number(season)
    && validateMlbSeasonResults(artifact).ok
}

export async function refreshMlbGameHistory({
  seasons = [],
  currentSeason,
  currentSeasonArtifact = null,
  prior = null,
  throughDate,
  fetchImpl = fetch,
  fetchedAt = new Date().toISOString(),
  minimumCompletedSeasonGames = 2000,
} = {}) {
  const priorSeasons = validateMlbGameHistory(prior).ok
    ? prior.seasons
    : []
  const bySeason = new Map(
    priorSeasons.map((artifact) => [Number(artifact.season), artifact]),
  )
  const refreshed = []
  const reused = []
  const failed = []

  for (const season of [...new Set(seasons.map(Number).filter(Number.isInteger))].sort()) {
    const targetThroughDate = season === Number(currentSeason)
      ? throughDate
      : `${season}-12-01`
    const current = season === Number(currentSeason)
      && validSeasonArtifact(currentSeasonArtifact, season)
      ? currentSeasonArtifact
      : null
    const cached = validSeasonArtifact(bySeason.get(season), season)
      ? bySeason.get(season)
      : null

    if (current) {
      bySeason.set(season, current)
      reused.push(season)
      continue
    }
    if (
      cached?.throughDate >= targetThroughDate
      && cached.games.length >= minimumCompletedSeasonGames
    ) {
      reused.push(season)
      continue
    }

    try {
      const result = await refreshMlbSeasonResults({
        season,
        throughDate: targetThroughDate,
        prior: cached,
        fetchImpl,
        fetchedAt,
      })
      bySeason.set(season, result.artifact)
      refreshed.push(season)
    } catch (error) {
      failed.push({ season, message: error?.message || String(error) })
    }
  }

  const requested = new Set(seasons.map(Number))
  const history = buildMlbGameHistory(
    [...bySeason.values()].filter((artifact) => requested.has(Number(artifact.season))),
    { fetchedAt },
  )
  const validation = validateMlbGameHistory(history)
  if (!validation.ok) throw new Error(validation.errors.join('; '))
  return {
    artifact: history,
    metrics: {
      ...validation.metrics,
      requestedSeasons: [...requested].sort(),
      refreshed,
      reused,
      failed,
    },
  }
}
