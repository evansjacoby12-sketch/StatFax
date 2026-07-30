export const MLB_FIRST_INNING_PROJECTION_VERSION = 1
export const MLB_FIRST_INNING_HISTORY_VERSION = 1
export const MLB_FIRST_INNING_FALLBACK_HALF_SCORE_RATE = 0.267
export const MLB_FIRST_INNING_FALLBACK_HALF_RUNS = 0.49
export const MLB_WATCH_NRFI_PROMOTION_POLICY = Object.freeze({
  candidateProbability: 0.54,
  candidateCoverage: 0.72,
  minimumSettled: 20,
  targetSettled: 30,
  minimumDates: 5,
  minimumHitRate: 0.6,
  minimumLowerBound90: 0.5,
})
export const MLB_FIRST_INNING_SIDE_TIER_POLICY = Object.freeze({
  nrfi: Object.freeze({
    limitedCoverage: 0.62,
    leanProbability: 0.56,
    leanCoverage: 0.72,
    strongProbability: 0.62,
    strongCoverage: 0.82,
  }),
  yrfi: Object.freeze({
    limitedCoverage: 0.64,
    leanProbability: 0.58,
    leanCoverage: 0.76,
    strongProbability: 0.64,
    strongCoverage: 0.84,
  }),
})

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const round = (value, digits = 4) => {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
const mean = (values) => (
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
)
const finite = (...values) => values.find(Number.isFinite)
const logit = (probability) => Math.log(clamp(probability, 0.01, 0.99) / (1 - clamp(probability, 0.01, 0.99)))
const logistic = (value) => 1 / (1 + Math.exp(-value))

function validFirstInningGame(game) {
  return (
    Number.isFinite(Number(game?.gamePk))
    && Number.isFinite(Number(game?.awayTeam?.id))
    && Number.isFinite(Number(game?.homeTeam?.id))
    && Number.isInteger(game?.awayFirstInningRuns)
    && game.awayFirstInningRuns >= 0
    && Number.isInteger(game?.homeFirstInningRuns)
    && game.homeFirstInningRuns >= 0
    && typeof game?.officialDate === 'string'
  )
}

function historyGames(history, cutoffDate = null) {
  return (history?.seasons || [])
    .flatMap((season) => season?.games || [])
    .filter(validFirstInningGame)
    .filter((game) => !cutoffDate || game.officialDate < cutoffDate)
    .sort((left, right) => (
      left.officialDate.localeCompare(right.officialDate)
      || String(left.gameDate).localeCompare(String(right.gameDate))
      || Number(left.gamePk) - Number(right.gamePk)
    ))
}

function shrunkRate(value, sample, prior, priorSample) {
  if (!Number.isFinite(value) || !(sample > 0)) return prior
  return ((value * sample) + (prior * priorSample)) / (sample + priorSample)
}

function dateEpoch(date) {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''))
  if (!matched) return null
  return Date.UTC(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
}

function recentLeagueWindow(games, cutoffDate, days = 30) {
  if (!games.length) return []
  const lastGameEpoch = dateEpoch(games.at(-1)?.officialDate)
  const cutoffEpoch = dateEpoch(cutoffDate)
  const endExclusive = Number.isFinite(cutoffEpoch)
    ? cutoffEpoch
    : Number.isFinite(lastGameEpoch)
      ? lastGameEpoch + 86_400_000
      : null
  if (!Number.isFinite(endExclusive)) return []
  const startInclusive = endExclusive - (days * 86_400_000)
  return games.filter((game) => {
    const epoch = dateEpoch(game.officialDate)
    return Number.isFinite(epoch) && epoch >= startInclusive && epoch < endExclusive
  })
}

function teamFirstInningProfile(teamId, rows, leagueScoreRate, leagueRuns) {
  const ordered = [...rows].sort((left, right) => (
    left.officialDate.localeCompare(right.officialDate)
    || String(left.gameDate).localeCompare(String(right.gameDate))
    || Number(left.gamePk) - Number(right.gamePk)
  ))
  const recent30 = ordered.slice(-30)
  const recent60 = ordered.slice(-60)
  const scoreRate = mean(ordered.map((row) => (row.runs > 0 ? 1 : 0)))
  const recent30ScoreRate = mean(recent30.map((row) => (row.runs > 0 ? 1 : 0)))
  const recent60ScoreRate = mean(recent60.map((row) => (row.runs > 0 ? 1 : 0)))
  const runsPerGame = mean(ordered.map((row) => row.runs))
  const recent30RunsPerGame = mean(recent30.map((row) => row.runs))
  const recent60RunsPerGame = mean(recent60.map((row) => row.runs))
  const seasonRate = shrunkRate(scoreRate, ordered.length, leagueScoreRate, 90)
  const recentRate = shrunkRate(recent60ScoreRate, recent60.length, seasonRate, 45)
  const recent30Rate = shrunkRate(recent30ScoreRate, recent30.length, leagueScoreRate, 18)
  const seasonRuns = shrunkRate(runsPerGame, ordered.length, leagueRuns, 90)
  const recentRuns = shrunkRate(recent60RunsPerGame, recent60.length, seasonRuns, 45)
  const recent30Runs = shrunkRate(recent30RunsPerGame, recent30.length, leagueRuns, 18)

  return {
    teamId: Number(teamId),
    games: ordered.length,
    scoreRate: round(scoreRate),
    recent30ScoreRate: round(recent30ScoreRate),
    recent30AdjustedScoreRate: round(recent30Rate),
    recent60ScoreRate: round(recent60ScoreRate),
    adjustedScoreRate: round(0.58 * recentRate + 0.42 * seasonRate),
    runsPerGame: round(runsPerGame),
    recent30RunsPerGame: round(recent30RunsPerGame),
    recent30AdjustedRunsPerGame: round(recent30Runs),
    recent60RunsPerGame: round(recent60RunsPerGame),
    adjustedRunsPerGame: round(0.58 * recentRuns + 0.42 * seasonRuns),
    coverage: round(clamp(ordered.length / 120, 0, 1)),
  }
}

function teamYrfiProfile(teamId, rows, leagueYrfiRate) {
  const ordered = [...rows].sort((left, right) => (
    left.officialDate.localeCompare(right.officialDate)
    || String(left.gameDate).localeCompare(String(right.gameDate))
    || Number(left.gamePk) - Number(right.gamePk)
  ))
  const recent = ordered.slice(-30)
  const recentRate = mean(recent.map((row) => (row.yrfi ? 1 : 0)))
  return {
    teamId: Number(teamId),
    games: ordered.length,
    recent30Games: recent.length,
    recent30YrfiRate: round(recentRate),
    adjustedYrfiRate: round(shrunkRate(recentRate, recent.length, leagueYrfiRate, 18)),
    coverage: round(clamp(recent.length / 30, 0, 1)),
  }
}

export function buildFirstInningProfiles(history, {
  cutoffDate = null,
} = {}) {
  const games = historyGames(history, cutoffDate)
  const halfRuns = games.flatMap((game) => [
    game.awayFirstInningRuns,
    game.homeFirstInningRuns,
  ])
  const leagueHalfScoreRate = mean(halfRuns.map((runs) => (runs > 0 ? 1 : 0)))
    ?? MLB_FIRST_INNING_FALLBACK_HALF_SCORE_RATE
  const leagueHalfRuns = mean(halfRuns) ?? MLB_FIRST_INNING_FALLBACK_HALF_RUNS
  const leagueYrfiRate = 1 - ((1 - leagueHalfScoreRate) ** 2)
  const recentLeagueGames = recentLeagueWindow(games, cutoffDate)
  const recentLeagueYrfiRate = mean(recentLeagueGames.map((game) => (
    game.awayFirstInningRuns + game.homeFirstInningRuns > 0 ? 1 : 0
  )))
  const recentLeagueAdjustedYrfiRate = shrunkRate(
    recentLeagueYrfiRate,
    recentLeagueGames.length,
    leagueYrfiRate,
    120,
  )
  const offenseRows = new Map()
  const defenseRows = new Map()
  const gameRows = new Map()
  const push = (map, teamId, row) => {
    const key = Number(teamId)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(row)
  }

  for (const game of games) {
    const shared = {
      gamePk: Number(game.gamePk),
      officialDate: game.officialDate,
      gameDate: game.gameDate,
    }
    push(offenseRows, game.awayTeam.id, { ...shared, runs: game.awayFirstInningRuns })
    push(offenseRows, game.homeTeam.id, { ...shared, runs: game.homeFirstInningRuns })
    push(defenseRows, game.homeTeam.id, { ...shared, runs: game.awayFirstInningRuns })
    push(defenseRows, game.awayTeam.id, { ...shared, runs: game.homeFirstInningRuns })
    const yrfi = game.awayFirstInningRuns + game.homeFirstInningRuns > 0
    push(gameRows, game.awayTeam.id, { ...shared, yrfi })
    push(gameRows, game.homeTeam.id, { ...shared, yrfi })
  }

  const teamIds = new Set([...offenseRows.keys(), ...defenseRows.keys(), ...gameRows.keys()])
  const teams = {}
  for (const teamId of teamIds) {
    teams[teamId] = {
      offense: teamFirstInningProfile(
        teamId,
        offenseRows.get(teamId) || [],
        leagueHalfScoreRate,
        leagueHalfRuns,
      ),
      defense: teamFirstInningProfile(
        teamId,
        defenseRows.get(teamId) || [],
        leagueHalfScoreRate,
        leagueHalfRuns,
      ),
      game: teamYrfiProfile(
        teamId,
        gameRows.get(teamId) || [],
        leagueYrfiRate,
      ),
    }
  }

  return {
    version: MLB_FIRST_INNING_HISTORY_VERSION,
    source: 'MLB Stats API first-inning linescores',
    cutoffDate,
    games: games.length,
    halfInnings: halfRuns.length,
    seasons: [...new Set(games.map((game) => Number(game.officialDate.slice(0, 4))))],
    leagueHalfScoreRate: round(leagueHalfScoreRate),
    leagueHalfRuns: round(leagueHalfRuns),
    leagueYrfiRate: round(leagueYrfiRate),
    recentLeague: {
      windowDays: 30,
      games: recentLeagueGames.length,
      yrfiRate: round(recentLeagueYrfiRate),
      nrfiRate: Number.isFinite(recentLeagueYrfiRate) ? round(1 - recentLeagueYrfiRate) : null,
      adjustedYrfiRate: round(recentLeagueAdjustedYrfiRate),
      adjustedNrfiRate: Number.isFinite(recentLeagueAdjustedYrfiRate)
        ? round(1 - recentLeagueAdjustedYrfiRate)
        : null,
    },
    teams,
  }
}

export function firstInningMatchupContext(profiles, offenseTeamId, defenseTeamId) {
  const leagueScoreRate = finite(
    profiles?.leagueHalfScoreRate,
    MLB_FIRST_INNING_FALLBACK_HALF_SCORE_RATE,
  )
  const leagueRuns = finite(
    profiles?.leagueHalfRuns,
    MLB_FIRST_INNING_FALLBACK_HALF_RUNS,
  )
  const offense = profiles?.teams?.[offenseTeamId]?.offense
  const defense = profiles?.teams?.[defenseTeamId]?.defense
  const offenseGame = profiles?.teams?.[offenseTeamId]?.game
  const defenseGame = profiles?.teams?.[defenseTeamId]?.game
  const offenseRate = finite(offense?.adjustedScoreRate, leagueScoreRate)
  const allowanceRate = finite(defense?.adjustedScoreRate, leagueScoreRate)
  const scoringProbability = logistic(0.5 * (logit(offenseRate) + logit(allowanceRate)))
  const offenseRecent30Rate = finite(offense?.recent30AdjustedScoreRate, leagueScoreRate)
  const allowanceRecent30Rate = finite(defense?.recent30AdjustedScoreRate, leagueScoreRate)
  const recent30ScoringProbability = logistic(
    0.7 * logit(offenseRecent30Rate) + 0.3 * logit(allowanceRecent30Rate),
  )
  const offenseRuns = finite(offense?.adjustedRunsPerGame, leagueRuns)
  const allowanceRuns = finite(defense?.adjustedRunsPerGame, leagueRuns)
  const expectedRuns = Math.sqrt(Math.max(0.01, offenseRuns) * Math.max(0.01, allowanceRuns))
  const coverage = offense && defense
    ? (finite(offense.coverage, 0) + finite(defense.coverage, 0)) / 2
    : 0
  const leagueYrfiRate = finite(
    profiles?.leagueYrfiRate,
    1 - ((1 - leagueScoreRate) ** 2),
  )
  const matchupYrfiRate = mean([
    offenseGame?.adjustedYrfiRate,
    defenseGame?.adjustedYrfiRate,
  ].filter(Number.isFinite)) ?? leagueYrfiRate
  const matchupYrfiCoverage = mean([
    offenseGame?.coverage,
    defenseGame?.coverage,
  ].filter(Number.isFinite)) ?? 0

  return {
    scoringProbability: round(clamp(scoringProbability, 0.12, 0.5)),
    recent30ScoringProbability: round(clamp(recent30ScoringProbability, 0.12, 0.5)),
    expectedRuns: round(clamp(expectedRuns, 0.15, 1.2)),
    coverage: round(coverage),
    offenseGames: offense?.games || 0,
    defenseGames: defense?.games || 0,
    offenseScoreRate: Number.isFinite(offense?.adjustedScoreRate)
      ? offense.adjustedScoreRate
      : null,
    offenseRecent30ScoreRate: Number.isFinite(offense?.recent30ScoreRate)
      ? offense.recent30ScoreRate
      : null,
    defenseAllowanceRate: Number.isFinite(defense?.adjustedScoreRate)
      ? defense.adjustedScoreRate
      : null,
    teamRecent30YrfiRate: Number.isFinite(offenseGame?.recent30YrfiRate)
      ? offenseGame.recent30YrfiRate
      : null,
    matchupYrfiRate: round(matchupYrfiRate),
    matchupYrfiCoverage: round(matchupYrfiCoverage),
    leagueYrfiRate: round(leagueYrfiRate),
    leagueScoreRate: round(leagueScoreRate),
  }
}

function applyMatchupYrfiContext(probability, awayHistorical, homeHistorical) {
  const contextRate = mean([
    awayHistorical?.matchupYrfiRate,
    homeHistorical?.matchupYrfiRate,
  ].filter(Number.isFinite))
  const contextCoverage = mean([
    awayHistorical?.matchupYrfiCoverage,
    homeHistorical?.matchupYrfiCoverage,
  ].filter(Number.isFinite)) ?? 0
  const leagueRate = finite(
    awayHistorical?.leagueYrfiRate,
    homeHistorical?.leagueYrfiRate,
  )
  if (!Number.isFinite(contextRate) || !Number.isFinite(leagueRate)) return probability
  const shift = 0.28 * contextCoverage * (logit(contextRate) - logit(leagueRate))
  return clamp(logistic(logit(probability) + shift), 0.25, 0.75)
}

function applyRecentLeagueRegime(probability, profiles) {
  const stableRate = finite(profiles?.leagueYrfiRate)
  const recentRate = finite(profiles?.recentLeague?.adjustedYrfiRate)
  const recentGames = finite(profiles?.recentLeague?.games, 0)
  if (!Number.isFinite(stableRate) || !Number.isFinite(recentRate) || !(recentGames > 0)) {
    return probability
  }
  const coverage = clamp(recentGames / 300, 0, 1)
  const shift = 0.35 * coverage * (logit(recentRate) - logit(stableRate))
  return clamp(logistic(logit(probability) + shift), 0.25, 0.75)
}

function selectTopOrder(rows, teamId) {
  const candidates = rows
    .filter((row) => Number(row?.teamId) === Number(teamId))
    .filter((row, index, all) => (
      all.findIndex((other) => Number(other?.playerId) === Number(row?.playerId)) === index
    ))
  const confirmed = candidates.some((row) => row?.lineupConfirmed === true)
  return candidates
    .map((row) => ({
      row,
      order: finite(row?.battingOrder, row?.projectedBattingOrder),
    }))
    .filter((entry) => !confirmed || Number.isFinite(entry.order))
    .sort((left, right) => (
      (left.order ?? 99) - (right.order ?? 99)
      || (right.row?.season?.ab ?? 0) - (left.row?.season?.ab ?? 0)
      || Number(left.row?.playerId) - Number(right.row?.playerId)
    ))
    .slice(0, 3)
}

function topOrderProfile(rows, teamId, probablePitcherId) {
  const top = selectTopOrder(rows, teamId)
  const teamRows = rows.filter((row) => Number(row?.teamId) === Number(teamId))
  const pitcher = teamRows.find((row) => (
    row?.pitcher
    && (
      !Number.isFinite(Number(probablePitcherId))
      || Number(row.pitcher.id) === Number(probablePitcherId)
    )
  ))?.pitcher || teamRows.find((row) => row?.pitcher)?.pitcher || null
  const pitcherHand = pitcher?.hand === 'L' ? 'L' : pitcher?.hand === 'R' ? 'R' : null
  const splitCode = pitcherHand === 'L' ? 'vl' : pitcherHand === 'R' ? 'vr' : null
  const metrics = top.map(({ row, order }) => {
    const season = row?.season || {}
    const split = splitCode ? row?.platoon?.[splitCode] : null
    const splitSample = finite(split?.pa, split?.ab)
    const splitReady = Number.isFinite(splitSample) && splitSample >= 20
    return {
      id: Number(row?.playerId),
      name: row?.name || 'Unknown hitter',
      order: Number.isFinite(order) ? order : null,
      obp: splitReady && Number.isFinite(split?.obp) ? split.obp : season?.obp,
      slg: splitReady && Number.isFinite(split?.slg) ? split.slg : season?.slg,
      xwoba: Number.isFinite(row?.xStats?.xwOBA) ? row.xStats.xwOBA : null,
      splitReady,
    }
  })
  const obp = mean(metrics.map((row) => row.obp).filter(Number.isFinite))
  const slg = mean(metrics.map((row) => row.slg).filter(Number.isFinite))
  const xwoba = mean(metrics.map((row) => row.xwoba).filter(Number.isFinite))
  const components = [
    Number.isFinite(obp) ? { value: obp / 0.315, weight: 0.42 } : null,
    Number.isFinite(slg) ? { value: slg / 0.400, weight: 0.38 } : null,
    Number.isFinite(xwoba) ? { value: xwoba / 0.320, weight: 0.20 } : null,
  ].filter(Boolean)
  const weight = components.reduce((sum, row) => sum + row.weight, 0)
  const rawFactor = weight
    ? components.reduce((sum, row) => sum + row.value * row.weight, 0) / weight
    : 1
  const metricCoverage = metrics.length
    ? metrics.filter((row) => Number.isFinite(row.obp) && Number.isFinite(row.slg)).length / 3
    : 0
  const splitCoverage = metrics.length
    ? metrics.filter((row) => row.splitReady).length / 3
    : 0

  return {
    hitters: metrics.map((row) => ({
      id: row.id,
      name: row.name,
      order: row.order,
    })),
    factor: round(clamp(rawFactor, 0.78, 1.25)),
    obp: round(obp),
    slg: round(slg),
    xwoba: round(xwoba),
    coverage: round(clamp(metricCoverage, 0, 1)),
    splitCoverage: round(clamp(splitCoverage, 0, 1)),
    lineupSize: top.length,
    pitcherHand,
    pitcherFirstInning: pitcher?.recentForm?.firstInning || null,
  }
}

function pitcherFirstInningFactor(profile) {
  const coverage = finite(profile?.coverage, 0)
  if (!(coverage > 0)) {
    return {
      factor: 1,
      coverage: 0,
      preventionScore: null,
      firstInningFip: null,
      firstInningK9: null,
      firstInningBb9: null,
      ttoK9: null,
      ttoBb9: null,
      sampleMode: null,
      currentWindowStarts: 0,
      previousSeasonStartsUsed: 0,
    }
  }
  const components = [
    Number.isFinite(profile.firstInningFip)
      ? { factor: clamp(profile.firstInningFip / 4.15, 0.72, 1.35), weight: 0.42 }
      : null,
    Number.isFinite(profile.ttoK9)
      ? { factor: clamp(8.6 / Math.max(3, profile.ttoK9), 0.78, 1.25), weight: 0.33 }
      : null,
    Number.isFinite(profile.ttoBb9)
      ? { factor: clamp(profile.ttoBb9 / 3.2, 0.75, 1.3), weight: 0.25 }
      : null,
  ].filter(Boolean)
  const totalWeight = components.reduce((sum, row) => sum + row.weight, 0)
  const rawFactor = totalWeight
    ? Math.exp(components.reduce((sum, row) => sum + row.weight * Math.log(row.factor), 0) / totalWeight)
    : 1
  const factor = clamp(Math.exp(coverage * Math.log(rawFactor)), 0.8, 1.22)
  const preventionScore = clamp(50 - ((factor - 1) * 250), 0, 100)
  return {
    factor: round(factor),
    coverage: round(coverage),
    preventionScore: round(preventionScore, 1),
    firstInningFip: finite(profile.firstInningFip),
    firstInningK9: finite(profile.firstInningK9),
    firstInningBb9: finite(profile.firstInningBb9),
    ttoK9: finite(profile.ttoK9),
    ttoBb9: finite(profile.ttoBb9),
    sampleMode: profile.sampleMode || null,
    currentWindowStarts: Number(profile.currentWindowStarts) || 0,
    previousSeasonStartsUsed: Number(profile.previousSeasonStartsUsed) || 0,
  }
}

function pitcherTopOrderCollision(topOrder, pitcherMicro) {
  if (
    !Number.isFinite(topOrder?.obp)
    || !(pitcherMicro?.coverage > 0)
    || !Number.isFinite(pitcherMicro?.factor)
  ) return { factor: 1, edge: 0, coverage: 0 }
  const hitterThreat = clamp((topOrder.obp - 0.300) / 0.055, -1, 1)
  const pitcherVulnerability = clamp((pitcherMicro.factor - 1) / 0.16, -1, 1)
  const edge = clamp((hitterThreat + pitcherVulnerability) / 2, -1, 1)
  const coverage = clamp(
    Math.sqrt(finite(topOrder.splitCoverage, 0) * pitcherMicro.coverage),
    0,
    1,
  )
  return {
    factor: round(Math.exp(0.1 * edge * coverage)),
    edge: round(edge),
    coverage: round(coverage),
  }
}

function adjustedHalfProjection({
  historical,
  topOrder,
  forecastInput,
  expectedRuns,
  opposingStarter,
}) {
  const starterFactor = finite(forecastInput?.starterFactor, 1)
  const pitcherMicro = pitcherFirstInningFactor(topOrder?.pitcherFirstInning)
  const collision = pitcherTopOrderCollision(topOrder, pitcherMicro)
  const environmentFactor = finite(forecastInput?.runEnvironmentFactor, 1)
  const baseRunsPerTeam = finite(forecastInput?.baseRunsPerTeam, 4.42)
  const forecastFactor = Number.isFinite(expectedRuns)
    ? clamp(expectedRuns / baseRunsPerTeam, 0.7, 1.4)
    : 1
  const probabilityShift = (
    0.80 * Math.log(finite(topOrder?.factor, 1))
    + 0.35 * Math.log(starterFactor)
    + 0.75 * Math.log(pitcherMicro.factor)
    + 0.35 * Math.log(collision.factor)
    + 0.30 * Math.log(environmentFactor)
    + 0.25 * Math.log(forecastFactor)
  )
  const scoringProbability = clamp(
    logistic(logit(finite(historical?.scoringProbability, MLB_FIRST_INNING_FALLBACK_HALF_SCORE_RATE)) + probabilityShift),
    0.12,
    0.5,
  )
  const projectedRuns = clamp(
    finite(historical?.expectedRuns, MLB_FIRST_INNING_FALLBACK_HALF_RUNS)
      * (finite(topOrder?.factor, 1) ** 0.55)
      * (starterFactor ** 0.3)
      * (pitcherMicro.factor ** 0.55)
      * (collision.factor ** 0.3)
      * (environmentFactor ** 0.3)
      * (forecastFactor ** 0.2),
    0.15,
    1.25,
  )
  const starterCoverage = opposingStarter ? 1 : 0
  const environmentCoverage = finite(forecastInput?.runEnvironmentCoverage, 0)
  const coverage = (
    0.32 * finite(historical?.coverage, 0)
    + 0.25 * finite(topOrder?.coverage, 0)
    + 0.12 * starterCoverage
    + 0.23 * pitcherMicro.coverage
    + 0.08 * environmentCoverage
  )

  return {
    scoringProbability: round(scoringProbability),
    expectedRuns: round(projectedRuns, 3),
    coverage: round(clamp(coverage, 0, 1)),
    factors: {
      historical: round(finite(historical?.scoringProbability, MLB_FIRST_INNING_FALLBACK_HALF_SCORE_RATE)),
      topOrder: round(finite(topOrder?.factor, 1)),
      starter: round(starterFactor),
      pitcherFirstInning: round(pitcherMicro.factor),
      pitcherTopOrderCollision: round(collision.factor),
      environment: round(environmentFactor),
      forecastV9: round(forecastFactor),
    },
    pitcherFirstInning: pitcherMicro,
    topOrderObp: topOrder?.obp ?? null,
    topOrderSplitCoverage: topOrder?.splitCoverage ?? 0,
    collision,
  }
}

export function firstInningStrengthTier(side, probability, coverage) {
  const policy = MLB_FIRST_INNING_SIDE_TIER_POLICY[side]
  if (!policy) return 'limited'
  if (!(coverage >= policy.limitedCoverage)) return 'limited'
  if (probability >= policy.strongProbability && coverage >= policy.strongCoverage) return 'strong'
  if (probability >= policy.leanProbability && coverage >= policy.leanCoverage) return 'lean'
  return 'watch'
}

export function applyFirstInningQualificationGate({
  side,
  tier,
  sideCalibrationStatus = 'collecting',
} = {}) {
  const actionable = ['strong', 'lean'].includes(tier)
  const applied = side === 'yrfi' && actionable && sideCalibrationStatus !== 'eligible'
  return {
    tier: applied ? 'watch' : tier,
    qualified: actionable && !applied,
    gate: {
      applied,
      side,
      rawTier: tier,
      requiredStatus: side === 'yrfi' ? 'eligible' : null,
      observedStatus: sideCalibrationStatus,
      reason: applied
        ? `YRFI ${tier.toUpperCase()} is held at WATCH because YRFI calibration is ${String(sideCalibrationStatus).toUpperCase()}.`
        : side === 'yrfi'
          ? 'YRFI qualification is allowed only after its side-specific calibration is eligible.'
          : 'NRFI is not subject to the YRFI calibration hold.',
    },
  }
}

export function applyWatchNrfiPromotion({
  side,
  tier,
  probability,
  coverage,
  evidence = null,
} = {}) {
  const policy = MLB_WATCH_NRFI_PROMOTION_POLICY
  const candidate = (
    side === 'nrfi'
    && tier === 'watch'
    && probability >= policy.candidateProbability
    && coverage >= policy.candidateCoverage
  )
  const status = evidence?.status || 'collecting'
  const sample = Number.isInteger(evidence?.sample) ? evidence.sample : 0
  const wins = Number.isInteger(evidence?.wins) ? evidence.wins : 0
  const losses = Number.isInteger(evidence?.losses) ? evidence.losses : 0
  const promoted = candidate && status === 'eligible'
  const progress = Math.min(sample, policy.minimumSettled)

  return {
    tier: promoted ? 'lean' : tier,
    qualified: promoted,
    promotion: {
      candidate,
      promoted,
      status,
      sample,
      wins,
      losses,
      dates: Number.isInteger(evidence?.dates) ? evidence.dates : 0,
      hitRate: Number.isFinite(evidence?.hitRate) ? evidence.hitRate : null,
      lowerBound90: Number.isFinite(evidence?.lowerBound90) ? evidence.lowerBound90 : null,
      minimumSettled: policy.minimumSettled,
      targetSettled: policy.targetSettled,
      progress,
      reason: promoted
        ? `Promoted from WATCH after ${sample} settled WATCH NRFIs cleared every evidence gate.`
        : candidate
          ? `WATCH NRFI promotion is ${status.toUpperCase()}: ${progress}/${policy.minimumSettled} minimum settled (${wins}-${losses}).`
          : 'This matchup does not meet the borderline WATCH NRFI promotion profile.',
    },
  }
}

function buildDecisionNotes({ lean, away, home, nrfiProbability, yrfiProbability }) {
  const strongerHalf = away.scoringProbability >= home.scoringProbability ? away : home
  const weakerHalf = strongerHalf === away ? home : away
  const collisionEdge = strongerHalf?.collision?.edge
  const caseText = lean === 'yrfi' && Number.isFinite(collisionEdge) && collisionEdge >= 0.15
    ? `${strongerHalf.team.abbr}'s top-three OBP (${strongerHalf.topOrderObp.toFixed(3)}) wins the pitcher collision at ${collisionEdge >= 0 ? '+' : ''}${collisionEdge.toFixed(2)}, producing a ${(strongerHalf.scoringProbability * 100).toFixed(1)}% scoring half.`
    : lean === 'yrfi'
      ? `${strongerHalf.team.abbr} supplies the larger first-inning threat at ${(strongerHalf.scoringProbability * 100).toFixed(1)}%.`
      : `Both scoring halves stay contained at ${(away.scoringProbability * 100).toFixed(1)}% and ${(home.scoringProbability * 100).toFixed(1)}%.`
  const cautionText = Math.abs(nrfiProbability - yrfiProbability) < 0.08
    ? 'The decision is close to a coin flip; treat the lean as directional.'
    : finite(away?.pitcherFirstInning?.coverage, 0) < 0.5
      || finite(home?.pitcherFirstInning?.coverage, 0) < 0.5
      ? 'At least one pitcher micro split has limited 60-day coverage.'
    : weakerHalf.lineupSource !== 'confirmed' || strongerHalf.lineupSource !== 'confirmed'
      ? 'At least one top of the order is projected and can move after lineups post.'
      : weakerHalf.opposingStarter == null || strongerHalf.opposingStarter == null
        ? 'A probable starter is missing, which limits first-inning confidence.'
        : 'First-inning outcomes remain high variance even when the inputs agree.'
  return { caseText, cautionText }
}

export function buildFirstInningProjection({
  game,
  rows = [],
  gameProjection,
  profiles = null,
  historicalValidation = null,
  operationalEvidence = null,
} = {}) {
  if (!game || !gameProjection) return null
  const awayHistorical = firstInningMatchupContext(
    profiles,
    game.awayTeam?.id,
    game.homeTeam?.id,
  )
  const homeHistorical = firstInningMatchupContext(
    profiles,
    game.homeTeam?.id,
    game.awayTeam?.id,
  )
  const awayTopOrder = topOrderProfile(rows, game.awayTeam?.id, game.homePitcher?.id)
  const homeTopOrder = topOrderProfile(rows, game.homeTeam?.id, game.awayPitcher?.id)
  const awayHalf = adjustedHalfProjection({
    historical: awayHistorical,
    topOrder: awayTopOrder,
    forecastInput: gameProjection.inputs?.away,
    expectedRuns: gameProjection.awayExpectedRuns,
    opposingStarter: game.homePitcher,
  })
  const homeHalf = adjustedHalfProjection({
    historical: homeHistorical,
    topOrder: homeTopOrder,
    forecastInput: gameProjection.inputs?.home,
    expectedRuns: gameProjection.homeExpectedRuns,
    opposingStarter: game.awayPitcher,
  })
  const yrfiProbability = clamp(
    1 - ((1 - awayHalf.scoringProbability) * (1 - homeHalf.scoringProbability)),
    0,
    1,
  )
  const recent30RawProbability = 1 - (
    (1 - finite(awayHistorical?.recent30ScoringProbability, awayHalf.scoringProbability))
    * (1 - finite(homeHistorical?.recent30ScoringProbability, homeHalf.scoringProbability))
  )
  const recent30ShadowProbability = applyMatchupYrfiContext(
    recent30RawProbability,
    awayHistorical,
    homeHistorical,
  )
  const recentLeagueShadowProbability = applyRecentLeagueRegime(
    yrfiProbability,
    profiles,
  )
  const nrfiProbability = 1 - yrfiProbability
  const lean = nrfiProbability >= yrfiProbability ? 'nrfi' : 'yrfi'
  const selectedProbability = Math.max(nrfiProbability, yrfiProbability)
  const coverage = (awayHalf.coverage + homeHalf.coverage) / 2
  const rawTier = firstInningStrengthTier(lean, selectedProbability, coverage)
  const tierPolicy = MLB_FIRST_INNING_SIDE_TIER_POLICY[lean]
  const sideCalibrationStatus = historicalValidation?.sides?.[lean]?.status || 'collecting'
  const qualification = applyFirstInningQualificationGate({
    side: lean,
    tier: rawTier,
    sideCalibrationStatus,
  })
  const watchNrfiPromotion = applyWatchNrfiPromotion({
    side: lean,
    tier: qualification.tier,
    probability: selectedProbability,
    coverage,
    evidence: operationalEvidence?.watchNrfiPromotion,
  })
  const finalTier = watchNrfiPromotion.tier
  const qualified = qualification.qualified || watchNrfiPromotion.qualified

  const away = {
    team: gameProjection.awayTeam,
    opposingStarter: gameProjection.probablePitchers?.home || null,
    lineupSource: gameProjection.inputs?.away?.lineupSource || 'roster-fallback',
    topOrder: awayTopOrder.hitters,
    topOrderFactor: awayTopOrder.factor,
    historical: awayHistorical,
    ...awayHalf,
  }
  const home = {
    team: gameProjection.homeTeam,
    opposingStarter: gameProjection.probablePitchers?.away || null,
    lineupSource: gameProjection.inputs?.home?.lineupSource || 'roster-fallback',
    topOrder: homeTopOrder.hitters,
    topOrderFactor: homeTopOrder.factor,
    historical: homeHistorical,
    ...homeHalf,
  }
  const notes = buildDecisionNotes({
    lean,
    away,
    home,
    nrfiProbability,
    yrfiProbability,
  })

  return {
    version: MLB_FIRST_INNING_PROJECTION_VERSION,
    advisoryOnly: true,
    model: 'Forecast V10 + 1st Inning Layer',
    status: coverage >= 0.62 ? 'ready' : 'limited',
    lean,
    tier: finalTier,
    qualified,
    qualificationGate: qualification.gate,
    watchNrfiPromotion: watchNrfiPromotion.promotion,
    tierPolicy: {
      side: lean,
      leanProbability: tierPolicy.leanProbability,
      leanCoverage: tierPolicy.leanCoverage,
      strongProbability: tierPolicy.strongProbability,
      strongCoverage: tierPolicy.strongCoverage,
    },
    selectedProbability: round(selectedProbability),
    nrfiProbability: round(nrfiProbability),
    yrfiProbability: round(yrfiProbability),
    projectedRuns: round(awayHalf.expectedRuns + homeHalf.expectedRuns, 2),
    coverage: round(coverage),
    independenceAssumption: true,
    pricesAvailable: false,
    shadow: {
      recent30Applied: false,
      recent30YrfiProbability: round(recent30ShadowProbability),
      recentLeagueApplied: false,
      recentLeagueYrfiProbability: round(recentLeagueShadowProbability),
      recentLeagueNrfiProbability: round(1 - recentLeagueShadowProbability),
      recentLeagueGames: profiles?.recentLeague?.games || 0,
      recentLeagueYrfiRate: profiles?.recentLeague?.yrfiRate ?? null,
      recentLeagueNrfiRate: profiles?.recentLeague?.nrfiRate ?? null,
      reason: 'The strict last-30 team challenger remains shadow-only until it beats the stable history backbone.',
      recentLeagueReason: 'The rolling 30-day league NRFI/YRFI regime is tracked as a shadow challenger and cannot change calls.',
    },
    halves: { away, home },
    evidence: {
      case: notes.caseText,
      caution: qualification.gate.applied
        ? qualification.gate.reason
        : watchNrfiPromotion.promotion.candidate
          ? watchNrfiPromotion.promotion.reason
          : notes.cautionText,
    },
    validation: {
      status: historicalValidation?.status || 'collecting',
      historicalGames: historicalValidation?.sample?.games || profiles?.games || 0,
      historicalSeasons: historicalValidation?.sample?.seasons || profiles?.seasons?.length || 0,
      historicalBrier: historicalValidation?.model?.brier ?? null,
      baselineBrier: historicalValidation?.baseline?.brier ?? null,
      sideCalibration: historicalValidation?.sides?.[lean] || null,
      forwardStatus: operationalEvidence?.watchNrfiPromotion?.status || 'collecting',
    },
  }
}

function calibration(rows) {
  const bins = [
    [0.30, 0.40],
    [0.40, 0.45],
    [0.45, 0.50],
    [0.50, 0.55],
    [0.55, 0.60],
    [0.60, 0.70],
  ]
  return bins.map(([minProbability, maxProbability]) => {
    const matched = rows.filter((row) => (
      row.probability >= minProbability && row.probability < maxProbability
    ))
    return {
      minProbability,
      maxProbability,
      sample: matched.length,
      meanProbability: round(mean(matched.map((row) => row.probability))),
      observedRate: round(mean(matched.map((row) => row.outcome))),
    }
  }).filter((row) => row.sample > 0)
}

function sideCalibration(rows, side, {
  minimumGames,
  minimumDates,
} = {}) {
  const threshold = MLB_FIRST_INNING_SIDE_TIER_POLICY[side].leanProbability
  const selected = rows
    .map((row) => {
      const predictedSide = row.probability >= 0.5 ? 'yrfi' : 'nrfi'
      const selectedProbability = predictedSide === 'yrfi'
        ? row.probability
        : 1 - row.probability
      return {
        ...row,
        predictedSide,
        selectedProbability,
        correct: predictedSide === 'yrfi' ? row.outcome : 1 - row.outcome,
      }
    })
    .filter((row) => row.predictedSide === side && row.selectedProbability >= threshold)
  const briers = selected.map((row) => (row.selectedProbability - row.correct) ** 2)
  const brier = mean(briers)
  const improvements = briers.map((value) => 0.25 - value)
  const improvement = mean(improvements)
  const variance = improvements.length > 1 && Number.isFinite(improvement)
    ? improvements.reduce((sum, value) => sum + ((value - improvement) ** 2), 0)
      / (improvements.length - 1)
    : null
  const standardError = Number.isFinite(variance)
    ? Math.sqrt(variance / improvements.length)
    : null
  const lowerBound = Number.isFinite(improvement) && Number.isFinite(standardError)
    ? improvement - (1.645 * standardError)
    : null
  const dates = new Set(selected.map((row) => row.date))
  const sampleReady = selected.length >= minimumGames && dates.size >= minimumDates
  const status = !sampleReady
    ? 'collecting'
    : Number.isFinite(lowerBound) && lowerBound > 0
      ? 'eligible'
      : 'hold'

  return {
    status,
    actionThreshold: threshold,
    sample: selected.length,
    dates: dates.size,
    brier: round(brier),
    coinFlipBrier: selected.length ? 0.25 : null,
    accuracy: round(mean(selected.map((row) => row.correct))),
    improvementVsCoinFlip: round(improvement),
    improvementLowerBound90: round(lowerBound, 6),
    calibration: calibration(selected.map((row) => ({
      probability: row.selectedProbability,
      outcome: row.correct,
    }))),
  }
}

export function evaluateFirstInningHistory(history, {
  minimumPriorGames = 300,
  minimumSeasons = 3,
  minimumGames = 3000,
  minimumDates = 250,
  minimumSideGames = 100,
  minimumSideDates = 30,
} = {}) {
  const games = historyGames(history)
  const byDate = new Map()
  for (const game of games) {
    if (!byDate.has(game.officialDate)) byDate.set(game.officialDate, [])
    byDate.get(game.officialDate).push(game)
  }
  const rows = []
  for (const [date, dateGames] of [...byDate].sort(([left], [right]) => left.localeCompare(right))) {
    const profiles = buildFirstInningProfiles(history, { cutoffDate: date })
    if (profiles.games < minimumPriorGames) continue
    const leagueHalf = finite(
      profiles.leagueHalfScoreRate,
      MLB_FIRST_INNING_FALLBACK_HALF_SCORE_RATE,
    )
    const baselineProbability = 1 - ((1 - leagueHalf) ** 2)
    for (const game of dateGames) {
      const away = firstInningMatchupContext(profiles, game.awayTeam.id, game.homeTeam.id)
      const home = firstInningMatchupContext(profiles, game.homeTeam.id, game.awayTeam.id)
      const probability = 1 - (
        (1 - away.scoringProbability)
        * (1 - home.scoringProbability)
      )
      const recent30RawProbability = 1 - (
        (1 - away.recent30ScoringProbability)
        * (1 - home.recent30ScoringProbability)
      )
      const recent30Probability = applyMatchupYrfiContext(
        recent30RawProbability,
        away,
        home,
      )
      const recentLeagueProbability = applyRecentLeagueRegime(
        probability,
        profiles,
      )
      const outcome = game.awayFirstInningRuns + game.homeFirstInningRuns > 0 ? 1 : 0
      rows.push({
        date,
        season: Number(date.slice(0, 4)),
        probability,
        recent30Probability,
        recentLeagueProbability,
        baselineProbability,
        outcome,
      })
    }
  }
  const modelBrier = mean(rows.map((row) => (row.probability - row.outcome) ** 2))
  const recent30Brier = mean(rows.map((row) => (row.recent30Probability - row.outcome) ** 2))
  const recentLeagueBrier = mean(rows.map((row) => (
    (row.recentLeagueProbability - row.outcome) ** 2
  )))
  const baselineBrier = mean(rows.map((row) => (row.baselineProbability - row.outcome) ** 2))
  const accuracy = mean(rows.map((row) => ((row.probability >= 0.5) === Boolean(row.outcome) ? 1 : 0)))
  const seasons = new Set(rows.map((row) => row.season))
  const dates = new Set(rows.map((row) => row.date))
  const improvement = Number.isFinite(modelBrier) && Number.isFinite(baselineBrier)
    ? baselineBrier - modelBrier
    : null
  const pairedAdvantages = rows.map((row) => (
    ((row.baselineProbability - row.outcome) ** 2)
    - ((row.probability - row.outcome) ** 2)
  ))
  const pairedVariance = pairedAdvantages.length > 1 && Number.isFinite(improvement)
    ? pairedAdvantages.reduce((sum, value) => sum + ((value - improvement) ** 2), 0)
      / (pairedAdvantages.length - 1)
    : null
  const pairedStandardError = Number.isFinite(pairedVariance)
    ? Math.sqrt(pairedVariance / pairedAdvantages.length)
    : null
  // Require the one-sided 90% lower bound to clear zero. A tiny positive
  // point estimate alone is not enough to call the backbone validated.
  const improvementLowerBound = Number.isFinite(improvement) && Number.isFinite(pairedStandardError)
    ? improvement - (1.645 * pairedStandardError)
    : null
  const sampleReady = (
    seasons.size >= minimumSeasons
    && rows.length >= minimumGames
    && dates.size >= minimumDates
  )
  const status = !sampleReady
    ? 'collecting'
    : Number.isFinite(improvementLowerBound) && improvementLowerBound > 0
      ? 'eligible'
      : 'hold'

  return {
    version: MLB_FIRST_INNING_HISTORY_VERSION,
    advisoryOnly: true,
    methodology: 'expanding-date walk-forward first-inning backbone',
    scope: 'stable team first-inning scoring and allowance backbone; strict last-30 team form is shadow-tested, while live lineups, pitcher micro splits, and weather apply only to current-slate projections',
    status,
    minimumSample: {
      seasons: minimumSeasons,
      games: minimumGames,
      dates: minimumDates,
      priorGames: minimumPriorGames,
      sideGames: minimumSideGames,
      sideDates: minimumSideDates,
    },
    sample: {
      seasons: seasons.size,
      games: rows.length,
      dates: dates.size,
      fromDate: [...dates].sort()[0] || null,
      throughDate: [...dates].sort().at(-1) || null,
    },
    baseline: {
      brier: round(baselineBrier),
    },
    model: {
      brier: round(modelBrier),
      accuracy: round(accuracy),
      improvementVsBaseline: round(improvement),
      pairedStandardError: round(pairedStandardError, 6),
      improvementLowerBound90: round(improvementLowerBound, 6),
      calibration: calibration(rows),
    },
    sides: {
      nrfi: sideCalibration(rows, 'nrfi', {
        minimumGames: minimumSideGames,
        minimumDates: minimumSideDates,
      }),
      yrfi: sideCalibration(rows, 'yrfi', {
        minimumGames: minimumSideGames,
        minimumDates: minimumSideDates,
      }),
    },
    challengers: {
      recent30Team: {
        applied: false,
        brier: round(recent30Brier),
        improvementVsBackbone: Number.isFinite(recent30Brier) && Number.isFinite(modelBrier)
          ? round(modelBrier - recent30Brier)
          : null,
        note: 'Strict last-30 offense and team YRFI form remains shadow-only unless it beats the stable backbone.',
      },
      recentLeague: {
        applied: false,
        windowDays: 30,
        brier: round(recentLeagueBrier),
        improvementVsBackbone: Number.isFinite(recentLeagueBrier) && Number.isFinite(modelBrier)
          ? round(modelBrier - recentLeagueBrier)
          : null,
        note: 'The league-wide rolling 30-day NRFI/YRFI regime remains shadow-only until it proves a stable Brier improvement.',
      },
    },
    note: status === 'eligible'
      ? 'The leakage-safe first-inning history backbone clears its sample and Brier gates.'
      : status === 'hold'
        ? 'The historical sample is sufficient, but the first-inning backbone has not separated from the league-rate baseline with enough confidence.'
        : 'First-inning validation is still collecting the required seasons, games, and dates.',
  }
}
