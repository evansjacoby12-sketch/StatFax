import {
  mergeMlbSeasonResults,
  parseMlbSeasonResults,
  validateMlbSeasonResults,
} from '../../src/sports/mlb/logic/teamScoringForm.js'

const MLB_BASE = 'https://statsapi.mlb.com/api/v1'

function minusDays(date, days) {
  const parsed = new Date(`${date}T12:00:00.000Z`)
  parsed.setUTCDate(parsed.getUTCDate() - days)
  return parsed.toISOString().slice(0, 10)
}

export async function refreshMlbSeasonResults({
  season,
  throughDate,
  prior = null,
  fetchImpl = fetch,
  fetchedAt = new Date().toISOString(),
} = {}) {
  const usablePrior = prior?.version === 1
    && Number(prior.season) === Number(season)
    && validateMlbSeasonResults(prior).ok
      ? prior
      : null
  // A 14-day overlap repairs late finals, suspended games, and corrections
  // without re-downloading the full season every ten-minute refresh.
  const startDate = usablePrior?.games?.length
    ? minusDays(throughDate, 14)
    : `${season}-03-01`
  const url = `${MLB_BASE}/schedule?sportId=1&startDate=${startDate}&endDate=${throughDate}&gameType=R&hydrate=team`
  const response = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`MLB season scores returned HTTP ${response.status}`)
  const schedule = await response.json()
  const incoming = parseMlbSeasonResults(schedule, { season, throughDate, fetchedAt })
  const merged = mergeMlbSeasonResults(usablePrior, incoming)
  const validation = validateMlbSeasonResults(merged)
  if (!validation.ok) throw new Error(validation.errors.join('; '))
  return {
    artifact: merged,
    metrics: {
      ...validation.metrics,
      refreshStartDate: startDate,
      incremental: Boolean(usablePrior?.games?.length),
    },
  }
}
