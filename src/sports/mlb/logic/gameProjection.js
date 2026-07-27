import { teamScoringMatchupContext } from './teamScoringForm.js'
import { expectedStarterInnings } from './starterIPDistribution.js'

export const MLB_GAME_PROJECTION_VERSION = 5
export const MLB_GAME_BASE_RUNS_PER_TEAM = 4.42
export const MLB_GAME_EVALUATION_MIN_GAMES = 100
export const MLB_GAME_EVALUATION_MIN_DATES = 10

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
const round = (value, digits = 3) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}
const finite = (...values) => values.find(Number.isFinite)

function weightedMean(rows) {
  let total = 0
  let weight = 0
  for (const row of rows) {
    if (!Number.isFinite(row?.value) || !(row?.weight > 0)) continue
    total += row.value * row.weight
    weight += row.weight
  }
  return weight > 0 ? total / weight : null
}

function shrunkRate(value, sample, prior, priorSample) {
  if (!Number.isFinite(value) || !(sample > 0)) return prior
  const weight = sample / (sample + priorSample)
  return value * weight + prior * (1 - weight)
}

function selectTeamLineup(rows, teamId) {
  const candidates = rows
    .filter((row) => Number(row?.teamId) === Number(teamId))
    .filter((row, index, all) => all.findIndex((other) => Number(other?.playerId) === Number(row?.playerId)) === index)
  const confirmedSide = candidates.some((row) => row.lineupConfirmed === true)
  const ordered = candidates
    .filter((row) => !confirmedSide || Number.isFinite(row.battingOrder))
    .map((row) => ({
      row,
      order: finite(row.battingOrder, row.projectedBattingOrder),
    }))
    .sort((a, b) => (
      (a.order ?? 99) - (b.order ?? 99)
      || (b.row.season?.ab ?? 0) - (a.row.season?.ab ?? 0)
      || Number(a.row.playerId) - Number(b.row.playerId)
    ))

  let lineup = ordered
  if (!confirmedSide && ordered.filter((entry) => Number.isFinite(entry.order)).length < 7) {
    lineup = candidates
      .map((row) => ({ row, order: finite(row.battingOrder, row.projectedBattingOrder) }))
      .sort((a, b) => (
        (b.row.season?.ab ?? 0) - (a.row.season?.ab ?? 0)
        || (b.row.season?.ops ?? 0) - (a.row.season?.ops ?? 0)
        || Number(a.row.playerId) - Number(b.row.playerId)
      ))
  }

  const selected = lineup.slice(0, 9).map((entry) => entry.row)
  const orderedCount = selected.filter((row) => Number.isFinite(finite(row.battingOrder, row.projectedBattingOrder))).length
  const source = confirmedSide && orderedCount >= 7
    ? 'confirmed'
    : orderedCount >= 7
      ? 'recent-lineup'
      : 'roster-fallback'
  return { rows: selected, source, orderedCount }
}

function lineupOffense(lineup, pitcher) {
  const pitcherHand = pitcher?.hand === 'L' ? 'L' : pitcher?.hand === 'R' ? 'R' : null
  const splitCode = pitcherHand === 'L' ? 'vl' : pitcherHand === 'R' ? 'vr' : null
  const batterProfiles = lineup.rows.map((row) => {
    const season = row.season || {}
    const recent = row.recent || {}
    const xStats = row.xStats || {}
    const paWeight = Number.isFinite(row.expectedPAs) ? clamp(row.expectedPAs, 3, 5) : 4
    const seasonObp = shrunkRate(season.obp, season.ab, 0.315, 100)
    const seasonSlg = shrunkRate(season.slg, season.ab, 0.400, 100)
    const split = splitCode ? row.platoon?.[splitCode] : null
    const splitSample = finite(split?.pa, split?.ab)
    const splitCovered = Number.isFinite(splitSample) && splitSample >= 20
    return {
      weight: paWeight,
      obp: seasonObp,
      slg: seasonSlg,
      xwoba: Number.isFinite(xStats.xwOBA) ? xStats.xwOBA : null,
      recentSlg: shrunkRate(recent.slg, recent.ab, 0.400, 80),
      splitCovered,
      splitObp: splitCovered && Number.isFinite(split?.obp)
        ? shrunkRate(split.obp, splitSample, seasonObp, 120)
        : null,
      splitSlg: splitCovered && Number.isFinite(split?.slg)
        ? shrunkRate(split.slg, splitSample, seasonSlg, 120)
        : null,
    }
  })
  const obp = weightedMean(batterProfiles.map((row) => ({ value: row.obp, weight: row.weight }))) ?? 0.315
  const slg = weightedMean(batterProfiles.map((row) => ({ value: row.slg, weight: row.weight }))) ?? 0.400
  const xwoba = weightedMean(batterProfiles.map((row) => ({ value: row.xwoba, weight: row.weight })))
  const recentSlg = weightedMean(batterProfiles.map((row) => ({ value: row.recentSlg, weight: row.weight }))) ?? 0.400
  const raw = (
    0.35 * (obp / 0.315)
    + 0.35 * (slg / 0.400)
    + 0.20 * ((xwoba ?? 0.320) / 0.320)
    + 0.10 * (recentSlg / 0.400)
  )
  const splitObp = weightedMean(batterProfiles.map((row) => ({ value: row.splitObp, weight: row.weight })))
  const splitSlg = weightedMean(batterProfiles.map((row) => ({ value: row.splitSlg, weight: row.weight })))
  const platoonCoverage = lineup.rows.length
    ? batterProfiles.filter((row) => row.splitCovered).length / lineup.rows.length
    : 0
  const platoonFactor = Number.isFinite(splitObp) && Number.isFinite(splitSlg)
    ? clamp(0.5 * (splitObp / 0.315) + 0.5 * (splitSlg / 0.400), 0.84, 1.18)
    : 1
  const platoonWeight = 0.20 * platoonCoverage
  const seasonCoverage = lineup.rows.length
    ? lineup.rows.filter((row) => Number.isFinite(row.season?.obp) && Number.isFinite(row.season?.slg)).length / lineup.rows.length
    : 0
  return {
    factor: clamp(raw * (1 - platoonWeight) + platoonFactor * platoonWeight, 0.84, 1.18),
    overallFactor: clamp(raw, 0.84, 1.18),
    platoonFactor,
    platoonCoverage,
    pitcherHand,
    obp,
    slg,
    splitObp,
    splitSlg,
    xwoba,
    recentSlg,
    coverage: 0.8 * seasonCoverage + 0.2 * platoonCoverage,
  }
}

function opposingPitcher(lineup, probablePitcherId) {
  return lineup.rows.find((row) => (
    row.pitcher && (!Number.isFinite(probablePitcherId) || Number(row.pitcher.id) === Number(probablePitcherId))
  ))?.pitcher || lineup.rows.find((row) => row.pitcher)?.pitcher || null
}

function starterRunFactor(pitcher) {
  const workload = expectedStarterInnings(pitcher)
  const workloadCoverage = workload.source === 'recent-starts'
    ? clamp((Number(pitcher?.recentForm?.games) || 0) / 5, 0, 1)
    : workload.source === 'season-starts'
      ? clamp((Number(pitcher?.season?.gs) || 0) / 15, 0, 1)
      : workload.source === 'opener'
        ? 0.75
        : 0.25
  if (!pitcher) {
    return {
      factor: 1,
      estimatedEra: null,
      coverage: 0,
      expectedIP: workload.expectedIP,
      workloadSource: workload.source,
      workloadCoverage,
    }
  }
  const season = pitcher.season || {}
  const recent = pitcher.recentForm || {}
  const xStats = pitcher.xStats || {}
  const components = []
  if (Number.isFinite(season.era) && season.ip >= 10) {
    components.push({ value: shrunkRate(season.era, season.ip, 4.25, 40), weight: 0.5 })
  }
  if (Number.isFinite(xStats.xEra) && xStats.xEra > 0) components.push({ value: xStats.xEra, weight: 0.3 })
  if (Number.isFinite(recent.era) && recent.ip >= 5) {
    components.push({ value: shrunkRate(recent.era, recent.ip, 4.25, 20), weight: 0.2 })
  }
  const estimatedEra = weightedMean(components)
  let quality = estimatedEra == null ? 1 : clamp(estimatedEra / 4.25, 0.72, 1.35)
  if (Number.isFinite(xStats.xwOba)) {
    const contact = clamp(xStats.xwOba / 0.320, 0.8, 1.22)
    quality = 0.8 * quality + 0.2 * contact
  }
  return {
    factor: clamp(quality, 0.72, 1.35),
    estimatedEra,
    coverage: components.length ? clamp(components.reduce((sum, row) => sum + row.weight, 0), 0, 1) : 0,
    expectedIP: workload.expectedIP,
    workloadSource: workload.source,
    workloadCoverage,
  }
}

function bullpenRunFactor(opponentTeamId, bullpenHR9, bullpenRunProfiles, bullpenAvailability) {
  const profile = bullpenRunProfiles?.[opponentTeamId]
  const availability = bullpenAvailability?.[opponentTeamId]
  const hr9 = Number(bullpenHR9?.[opponentTeamId])
  const profileFactor = Number(profile?.qualityFactor)
  const fallbackFactor = Number.isFinite(hr9) && hr9 > 0
    ? clamp(1 + 0.20 * (hr9 / 1.20 - 1), 0.82, 1.18)
    : 1
  const factor = Number.isFinite(profileFactor)
    ? clamp(profileFactor, 0.78, 1.28)
    : fallbackFactor
  const availabilityFactor = Number.isFinite(availability?.factor)
    ? clamp(availability.factor, 1, 1.07)
    : 1
  const profileCoverage = Number.isFinite(profile?.coverage) ? clamp(profile.coverage, 0, 1) : 0
  const availabilityCoverage = Number.isFinite(availability?.coverage) ? clamp(availability.coverage, 0, 1) : 0
  return {
    factor,
    availabilityFactor,
    hr9: Number.isFinite(profile?.hr9) ? profile.hr9 : Number.isFinite(hr9) ? hr9 : null,
    estimatedRunsAllowed9: Number.isFinite(profile?.estimatedRunsAllowed9)
      ? profile.estimatedRunsAllowed9
      : null,
    coverage: profile
      ? 0.65 * profileCoverage + 0.35 * availabilityCoverage
      : 0.25 * Number(Number.isFinite(hr9)) + 0.35 * availabilityCoverage,
    unavailable: Number.isInteger(availability?.unavailable) ? availability.unavailable : 0,
    taxed: Number.isInteger(availability?.taxed) ? availability.taxed : 0,
    unavailableShare: Number.isFinite(availability?.unavailableShare) ? availability.unavailableShare : 0,
    taxedShare: Number.isFinite(availability?.taxedShare) ? availability.taxedShare : 0,
    unavailableNames: Array.isArray(availability?.unavailableNames) ? availability.unavailableNames : [],
  }
}

function environmentFactor(lineup, gameRunEnvironment) {
  const values = lineup.rows
    .map((row) => finite(row.parkWeatherHandFactor, row.gameParkHRFactor))
    .filter(Number.isFinite)
  const hrFactor = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1
  if (Number.isFinite(gameRunEnvironment?.factor)) {
    return {
      factor: clamp(gameRunEnvironment.factor, 0.86, 1.17),
      hrFactor,
      runFactor: gameRunEnvironment.factor,
      rawParkFactor: Number.isFinite(gameRunEnvironment.rawParkFactor)
        ? gameRunEnvironment.rawParkFactor
        : null,
      weatherFactor: Number.isFinite(gameRunEnvironment.weatherFactor)
        ? gameRunEnvironment.weatherFactor
        : null,
      coverage: Number.isFinite(gameRunEnvironment.coverage)
        ? clamp(gameRunEnvironment.coverage, 0, 1)
        : 0,
      source: 'run-specific',
      context: gameRunEnvironment,
    }
  }
  return {
    factor: clamp(1 + 0.32 * (hrFactor - 1), 0.92, 1.08),
    hrFactor,
    runFactor: null,
    rawParkFactor: null,
    weatherFactor: null,
    coverage: lineup.rows.length ? values.length / lineup.rows.length : 0,
    source: 'legacy-hr-fallback',
    context: null,
  }
}

function teamRunContext({
  gamePk,
  teamId,
  opponentTeamId,
  teamSeasonRunProfiles,
  gameScheduleContexts,
}) {
  const offenseTeam = teamSeasonRunProfiles?.teams?.[teamId] || null
  const defenseTeam = teamSeasonRunProfiles?.teams?.[opponentTeamId] || null
  const schedule = gameScheduleContexts?.byGame?.[gamePk]?.[teamId] || null
  const defenseFactor = Number.isFinite(defenseTeam?.defenseFactor)
    ? clamp(defenseTeam.defenseFactor, 0.96, 1.04)
    : 1
  const baserunningFactor = Number.isFinite(offenseTeam?.baserunningFactor)
    ? clamp(offenseTeam.baserunningFactor, 0.973, 1.027)
    : 1
  const scheduleFactor = Number.isFinite(schedule?.factor)
    ? clamp(schedule.factor, 0.96, 1.01)
    : 1
  const factor = clamp(defenseFactor * baserunningFactor * scheduleFactor, 0.92, 1.08)
  const defenseCoverage = Number.isFinite(defenseTeam?.coverage) ? defenseTeam.coverage : 0
  const baserunningCoverage = Number.isFinite(offenseTeam?.coverage) ? offenseTeam.coverage : 0
  const scheduleCoverage = Number.isFinite(schedule?.coverage) ? schedule.coverage : 0
  return {
    factor,
    defenseFactor,
    baserunningFactor,
    scheduleFactor,
    coverage: (
      0.45 * defenseCoverage
      + 0.30 * baserunningCoverage
      + 0.25 * scheduleCoverage
    ),
    defense: defenseTeam ? {
      teamId: opponentTeamId,
      teamName: defenseTeam.teamName,
      games: defenseTeam.games,
      defenseRunsAdjustment: defenseTeam.defenseRunsAdjustment,
      errorsPerGame: defenseTeam.errorsPerGame,
      doublePlaysPerGame: defenseTeam.doublePlaysPerGame,
      caughtStealingDefensePerGame: defenseTeam.caughtStealingDefensePerGame,
      factor: defenseFactor,
      coverage: defenseCoverage,
    } : null,
    baserunning: offenseTeam ? {
      teamId,
      teamName: offenseTeam.teamName,
      games: offenseTeam.games,
      stolenBases: offenseTeam.stolenBases,
      caughtStealing: offenseTeam.caughtStealing,
      baserunningRunsPerGame: offenseTeam.baserunningRunsPerGame,
      baserunningRunsAdjustment: offenseTeam.baserunningRunsAdjustment,
      factor: baserunningFactor,
      coverage: baserunningCoverage,
    } : null,
    schedule: schedule ? {
      ...schedule,
      factor: scheduleFactor,
      coverage: scheduleCoverage,
    } : null,
  }
}

function poissonDistribution(lambda, max = 20) {
  const probabilities = [Math.exp(-lambda)]
  for (let runs = 1; runs <= max; runs++) {
    probabilities[runs] = probabilities[runs - 1] * lambda / runs
  }
  const sum = probabilities.reduce((total, probability) => total + probability, 0)
  return probabilities.map((probability) => probability / sum)
}

export function winProbabilities(awayExpectedRuns, homeExpectedRuns) {
  const away = poissonDistribution(awayExpectedRuns)
  const home = poissonDistribution(homeExpectedRuns)
  let homeWin = 0
  let awayWin = 0
  let tie = 0
  for (let awayRuns = 0; awayRuns < away.length; awayRuns++) {
    for (let homeRuns = 0; homeRuns < home.length; homeRuns++) {
      const probability = away[awayRuns] * home[homeRuns]
      if (homeRuns > awayRuns) homeWin += probability
      else if (awayRuns > homeRuns) awayWin += probability
      else tie += probability
    }
  }
  // A tied nine-inning state slightly favors the home club in extras.
  homeWin += tie * 0.54
  awayWin += tie * 0.46
  const total = homeWin + awayWin
  return { away: awayWin / total, home: homeWin / total, tieAfterNine: tie }
}

export function gameTotalProbabilities(projectedTotal, line) {
  if (!Number.isFinite(line) || line <= 0) return null
  const distribution = poissonDistribution(projectedTotal, 24)
  let over = 0
  let under = 0
  let push = 0
  for (let runs = 0; runs < distribution.length; runs++) {
    if (runs > line) over += distribution[runs]
    else if (runs < line) under += distribution[runs]
    else push += distribution[runs]
  }
  const total = over + under + push
  return { over: over / total, under: under / total, push: push / total }
}

function marketComparison(gameOdds, win, projectedTotal) {
  const consensus = gameOdds?.consensus
  if (!consensus?.moneyline && !consensus?.total) return null
  const comparison = {}
  if (consensus.moneyline) {
    const homeMarket = consensus.moneyline.home?.fairProbability
    const awayMarket = consensus.moneyline.away?.fairProbability
    comparison.moneyline = {
      books: consensus.moneyline.books,
      homeMarketProbability: homeMarket,
      awayMarketProbability: awayMarket,
      homeAmerican: consensus.moneyline.home?.american ?? null,
      awayAmerican: consensus.moneyline.away?.american ?? null,
      homeModelEdge: Number.isFinite(homeMarket) ? round(win.home - homeMarket, 4) : null,
      awayModelEdge: Number.isFinite(awayMarket) ? round(win.away - awayMarket, 4) : null,
    }
  }
  if (consensus.total) {
    const distribution = gameTotalProbabilities(projectedTotal, consensus.total.line)
    const overMarket = consensus.total.over?.fairProbability
    const underMarket = consensus.total.under?.fairProbability
    comparison.total = {
      line: consensus.total.line,
      books: consensus.total.books,
      modelOverProbability: distribution ? round(distribution.over, 4) : null,
      modelUnderProbability: distribution ? round(distribution.under, 4) : null,
      modelPushProbability: distribution ? round(distribution.push, 4) : null,
      marketOverProbability: overMarket,
      marketUnderProbability: underMarket,
      overAmerican: consensus.total.over?.american ?? null,
      underAmerican: consensus.total.under?.american ?? null,
      overModelEdge: distribution && Number.isFinite(overMarket) ? round(distribution.over - overMarket, 4) : null,
      underModelEdge: distribution && Number.isFinite(underMarket) ? round(distribution.under - underMarket, 4) : null,
    }
  }
  return comparison
}

function estimatedScore(awayExpectedRuns, homeExpectedRuns, projectedWinner) {
  let away = Math.round(awayExpectedRuns)
  let home = Math.round(homeExpectedRuns)
  if (away !== home) return { away, home }
  if (projectedWinner === 'home') {
    const bumpCost = Math.abs(home + 1 - homeExpectedRuns)
    const lowerCost = home > 0 ? Math.abs(away - 1 - awayExpectedRuns) : Number.POSITIVE_INFINITY
    if (lowerCost < bumpCost) away -= 1
    else home += 1
  } else {
    const bumpCost = Math.abs(away + 1 - awayExpectedRuns)
    const lowerCost = away > 0 ? Math.abs(home - 1 - homeExpectedRuns) : Number.POSITIVE_INFINITY
    if (lowerCost < bumpCost) home -= 1
    else away += 1
  }
  return { away, home }
}

function teamProjection({
  game,
  rows,
  teamId,
  isHome,
  opponentTeamId,
  probablePitcherId,
  bullpenHR9,
  bullpenRunProfiles,
  bullpenAvailability,
  gameRunEnvironment,
  teamSeasonRunProfiles,
  gameScheduleContexts,
  teamScoringProfiles,
}) {
  const lineup = selectTeamLineup(rows, teamId)
  const pitcher = opposingPitcher(lineup, probablePitcherId)
  const offense = lineupOffense(lineup, pitcher)
  const starter = starterRunFactor(pitcher)
  const bullpen = bullpenRunFactor(
    opponentTeamId,
    bullpenHR9,
    bullpenRunProfiles,
    bullpenAvailability,
  )
  const starterShare = clamp(starter.expectedIP / 9, 0.12, 0.89)
  const bullpenShare = 1 - starterShare
  const pitchingFactor = clamp(
    starterShare * starter.factor
      + bullpenShare * bullpen.factor * bullpen.availabilityFactor,
    0.82,
    1.24,
  )
  const environment = environmentFactor(lineup, gameRunEnvironment)
  const situational = teamRunContext({
    gamePk: game.gamePk,
    teamId,
    opponentTeamId,
    teamSeasonRunProfiles,
    gameScheduleContexts,
  })
  const teamScoring = teamScoringMatchupContext(teamScoringProfiles, teamId, opponentTeamId)
  const baseRunsPerTeam = Number.isFinite(teamScoring.leagueRunsPerTeam)
    ? clamp(teamScoring.leagueRunsPerTeam, 3.80, 5.00)
    : MLB_GAME_BASE_RUNS_PER_TEAM
  const homeField = isHome ? 1.02 : 0.98
  const expectedRuns = clamp(
    baseRunsPerTeam
      * offense.factor
      * pitchingFactor
      * environment.factor
      * teamScoring.factor
      * situational.factor
      * homeField,
    2.35,
    7.25,
  )
  const lineupCoverage = clamp(lineup.rows.length / 9, 0, 1)
  const sourceWeight = lineup.source === 'confirmed' ? 1 : lineup.source === 'recent-lineup' ? 0.82 : 0.55
  const pitchingCoverage = (
    starterShare * Math.min(starter.coverage, starter.workloadCoverage)
    + bullpenShare * bullpen.coverage
  )
  const coverage = (
    0.31 * lineupCoverage * sourceWeight
    + 0.18 * offense.coverage
    + 0.18 * pitchingCoverage
    + 0.08 * environment.coverage
    + 0.15 * teamScoring.coverage
    + 0.10 * situational.coverage
  )
  return {
    expectedRuns,
    coverage,
    inputs: {
      lineupSource: lineup.source,
      lineupSize: lineup.rows.length,
      lineupOrdered: lineup.orderedCount,
      offenseFactor: round(offense.factor),
      starterFactor: round(starter.factor),
      bullpenFactor: round(bullpen.factor),
      bullpenAvailabilityFactor: round(bullpen.availabilityFactor, 4),
      pitchingFactor: round(pitchingFactor, 4),
      expectedStarterIP: round(starter.expectedIP, 2),
      starterWorkloadSource: starter.workloadSource,
      starterWorkloadCoverage: round(starter.workloadCoverage, 4),
      starterShare: round(starterShare, 4),
      bullpenShare: round(bullpenShare, 4),
      environmentFactor: round(environment.factor),
      teamScoringFactor: round(teamScoring.factor),
      homeFieldFactor: homeField,
      baseRunsPerTeam: round(baseRunsPerTeam, 4),
      lineupObp: round(offense.obp),
      lineupSlg: round(offense.slg),
      opposingPitcherHand: offense.pitcherHand,
      overallOffenseFactor: round(offense.overallFactor, 4),
      platoonFactor: round(offense.platoonFactor, 4),
      platoonCoverage: round(offense.platoonCoverage, 4),
      lineupVsHandObp: Number.isFinite(offense.splitObp) ? round(offense.splitObp) : null,
      lineupVsHandSlg: Number.isFinite(offense.splitSlg) ? round(offense.splitSlg) : null,
      lineupXwoba: Number.isFinite(offense.xwoba) ? round(offense.xwoba) : null,
      estimatedStarterEra: Number.isFinite(starter.estimatedEra) ? round(starter.estimatedEra, 2) : null,
      bullpenHr9: bullpen.hr9,
      bullpenEstimatedRunsAllowed9: bullpen.estimatedRunsAllowed9,
      bullpenUnavailable: bullpen.unavailable,
      bullpenTaxed: bullpen.taxed,
      bullpenContext: {
        qualityFactor: round(bullpen.factor, 4),
        availabilityFactor: round(bullpen.availabilityFactor, 4),
        unavailableShare: round(bullpen.unavailableShare, 4),
        taxedShare: round(bullpen.taxedShare, 4),
        unavailableNames: bullpen.unavailableNames,
        coverage: round(bullpen.coverage, 4),
      },
      parkWeatherHrFactor: round(environment.hrFactor),
      runEnvironmentFactor: round(environment.factor, 4),
      parkRunFactor: Number.isFinite(environment.rawParkFactor) ? round(environment.rawParkFactor, 4) : null,
      weatherRunFactor: Number.isFinite(environment.weatherFactor) ? round(environment.weatherFactor, 4) : null,
      runEnvironmentCoverage: round(environment.coverage, 4),
      environmentSource: environment.source,
      runEnvironment: environment.context ? {
        ...environment.context,
        factor: round(environment.factor, 4),
        coverage: round(environment.coverage, 4),
      } : null,
      teamContextFactor: round(situational.factor, 4),
      opponentDefenseFactor: round(situational.defenseFactor, 4),
      baserunningFactor: round(situational.baserunningFactor, 4),
      scheduleFactor: round(situational.scheduleFactor, 4),
      teamRunContextCoverage: round(situational.coverage, 4),
      teamRunContext: {
        factor: round(situational.factor, 4),
        coverage: round(situational.coverage, 4),
        defense: situational.defense,
        baserunning: situational.baserunning,
        schedule: situational.schedule,
      },
      teamScoring: {
        ...teamScoring,
        factor: round(teamScoring.factor, 4),
        coverage: round(teamScoring.coverage, 4),
      },
    },
  }
}

export function buildGameProjection({
  game,
  rows = [],
  bullpenHR9 = {},
  bullpenRunProfiles = {},
  bullpenAvailability = {},
  gameRunEnvironments = {},
  teamSeasonRunProfiles = null,
  gameScheduleContexts = null,
  gameOdds = null,
  teamScoringProfiles = null,
  capturedAt = new Date().toISOString(),
}) {
  if (!game || game.isLive === true || game.isFinal === true) return null
  const away = teamProjection({
    game,
    rows,
    teamId: game.awayTeam?.id,
    isHome: false,
    opponentTeamId: game.homeTeam?.id,
    probablePitcherId: game.homePitcher?.id,
    bullpenHR9,
    bullpenRunProfiles,
    bullpenAvailability,
    gameRunEnvironment: gameRunEnvironments?.[game.gamePk] || null,
    teamSeasonRunProfiles,
    gameScheduleContexts,
    teamScoringProfiles,
  })
  const home = teamProjection({
    game,
    rows,
    teamId: game.homeTeam?.id,
    isHome: true,
    opponentTeamId: game.awayTeam?.id,
    probablePitcherId: game.awayPitcher?.id,
    bullpenHR9,
    bullpenRunProfiles,
    bullpenAvailability,
    gameRunEnvironment: gameRunEnvironments?.[game.gamePk] || null,
    teamSeasonRunProfiles,
    gameScheduleContexts,
    teamScoringProfiles,
  })
  const projectedTotal = away.expectedRuns + home.expectedRuns
  const win = winProbabilities(away.expectedRuns, home.expectedRuns)
  const projectedWinner = win.home >= win.away ? 'home' : 'away'
  const coverage = (away.coverage + home.coverage) / 2
  return {
    modelVersion: MLB_GAME_PROJECTION_VERSION,
    advisoryOnly: true,
    captureState: 'pregame',
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    capturedAt,
    awayTeam: { id: game.awayTeam?.id, name: game.awayTeam?.name, abbr: game.awayTeam?.abbr },
    homeTeam: { id: game.homeTeam?.id, name: game.homeTeam?.name, abbr: game.homeTeam?.abbr },
    awayExpectedRuns: round(away.expectedRuns, 2),
    homeExpectedRuns: round(home.expectedRuns, 2),
    projectedTotal: round(projectedTotal, 2),
    estimatedScore: estimatedScore(away.expectedRuns, home.expectedRuns, projectedWinner),
    awayWinProbability: round(win.away, 4),
    homeWinProbability: round(win.home, 4),
    tieAfterNineProbability: round(win.tieAfterNine, 4),
    projectedWinner,
    projectedWinnerProbability: round(Math.max(win.away, win.home), 4),
    confidence: {
      status: coverage >= 0.82 ? 'medium' : 'limited',
      coverage: round(coverage),
      note: coverage >= 0.82
        ? 'Core lineup and pitcher inputs are available; validation is still collecting.'
        : 'Some lineup or pitcher inputs are projected or incomplete.',
    },
    inputs: { away: away.inputs, home: home.inputs },
    marketComparison: marketComparison(gameOdds, win, projectedTotal),
  }
}

export function buildSlateGameProjections({
  games = [],
  scoredBatters = {},
  bullpenHR9 = {},
  bullpenRunProfiles = {},
  bullpenAvailability = {},
  gameRunEnvironments = {},
  teamSeasonRunProfiles = null,
  gameScheduleContexts = null,
  gameOdds = {},
  teamScoringProfiles = null,
  capturedAt = new Date().toISOString(),
} = {}) {
  const rows = Object.values(scoredBatters).filter((row, index, all) => (
    row?.playerId != null
    && row?.gamePk != null
    && all.findIndex((other) => (
      Number(other?.playerId) === Number(row.playerId) && Number(other?.gamePk) === Number(row.gamePk)
    )) === index
  ))
  return games
    .map((game) => buildGameProjection({
      game,
      rows: rows.filter((row) => Number(row.gamePk) === Number(game.gamePk)),
      bullpenHR9,
      bullpenRunProfiles,
      bullpenAvailability,
      gameRunEnvironments,
      teamSeasonRunProfiles,
      gameScheduleContexts,
      gameOdds: gameOdds?.[game.gamePk] || null,
      teamScoringProfiles,
      capturedAt,
    }))
    .filter(Boolean)
}

export function updateGameForecastLog(log = {}, date, current = [], games = [], { capturedAt = new Date().toISOString() } = {}) {
  const priorForecasts = log?.gameForecasts || {}
  const next = {
    ...(log || {}),
    gameForecasts: {
      ...priorForecasts,
      version: 1,
      predictionsByDate: { ...(priorForecasts.predictionsByDate || {}) },
      resultsByDate: { ...(priorForecasts.resultsByDate || {}) },
    },
  }

  const prior = new Map((next.gameForecasts.predictionsByDate[date] || []).map((row) => [Number(row.gamePk), row]))
  const fresh = new Map(current.map((row) => [Number(row.gamePk), row]))
  const merged = []
  for (const game of games) {
    const gamePk = Number(game.gamePk)
    if (game.isLive === true || game.isFinal === true) {
      const frozen = prior.get(gamePk)
      if (frozen) {
        merged.push({
          ...frozen,
          freezeState: 'final-pregame',
          frozenAt: frozen.frozenAt || capturedAt,
        })
      }
    } else if (fresh.has(gamePk)) {
      merged.push({
        ...fresh.get(gamePk),
        freezeState: 'refreshing-pregame',
        frozenAt: null,
      })
    }
  }
  next.gameForecasts.predictionsByDate[date] = merged
  for (const key of Object.keys(next.gameForecasts.predictionsByDate).sort().slice(0, -180)) {
    delete next.gameForecasts.predictionsByDate[key]
  }
  for (const key of Object.keys(next.gameForecasts.resultsByDate).sort().slice(0, -180)) {
    delete next.gameForecasts.resultsByDate[key]
  }
  return { log: next, projections: merged }
}

export function settleGameForecasts(log = {}, date, snapshot) {
  if (!snapshot || snapshot.date !== date || !snapshot.gameProjections) return log
  const priorForecasts = log?.gameForecasts || {}
  const next = {
    ...(log || {}),
    gameForecasts: {
      ...priorForecasts,
      version: 1,
      predictionsByDate: { ...(priorForecasts.predictionsByDate || {}) },
      resultsByDate: { ...(priorForecasts.resultsByDate || {}) },
    },
  }
  const existing = new Map((next.gameForecasts.resultsByDate[date] || []).map((row) => [Number(row.gamePk), row]))
  const games = new Map((snapshot.games || []).map((game) => [Number(game.gamePk), game]))
  for (const projection of Object.values(snapshot.gameProjections || {})) {
    const game = games.get(Number(projection?.gamePk))
    if (!game?.isFinal || !Number.isFinite(game.awayScore) || !Number.isFinite(game.homeScore)) continue
    if (
      projection.captureState !== 'pregame'
      || projection.freezeState !== 'final-pregame'
      || Number.isNaN(Date.parse(projection.capturedAt))
    ) continue
    const actualTotal = game.awayScore + game.homeScore
    const homeWon = game.homeScore > game.awayScore
    const awayWon = game.awayScore > game.homeScore
    existing.set(Number(game.gamePk), {
      ...projection,
      freezeState: 'final-pregame',
      actualAwayRuns: game.awayScore,
      actualHomeRuns: game.homeScore,
      actualTotal,
      actualWinner: homeWon ? 'home' : awayWon ? 'away' : 'tie',
      totalError: round(projection.projectedTotal - actualTotal, 2),
      absoluteTotalError: round(Math.abs(projection.projectedTotal - actualTotal), 2),
      winnerCorrect: homeWon || awayWon ? projection.projectedWinner === (homeWon ? 'home' : 'away') : null,
      winnerBrier: homeWon || awayWon
        ? round((projection.homeWinProbability - (homeWon ? 1 : 0)) ** 2, 6)
        : null,
      settledAt: snapshot.finishedAt || snapshot.generatedAt || new Date().toISOString(),
    })
  }
  if (existing.size) next.gameForecasts.resultsByDate[date] = [...existing.values()]
  for (const key of Object.keys(next.gameForecasts.resultsByDate).sort().slice(0, -180)) {
    delete next.gameForecasts.resultsByDate[key]
  }
  return next
}

const mean = (values) => (
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
)

function roundedMetric(value, digits = 4) {
  return Number.isFinite(value) ? round(value, digits) : null
}

function gameForecastResultRows(log = {}) {
  const results = log?.gameForecasts?.resultsByDate
  if (!results || typeof results !== 'object' || Array.isArray(results)) return []
  const seen = new Set()
  const rows = []
  for (const date of Object.keys(results).sort()) {
    if (!Array.isArray(results[date])) continue
    for (const row of results[date]) {
      const key = `${date}|${row?.gamePk}`
      if (
        seen.has(key)
        || row?.captureState !== 'pregame'
        || row?.freezeState !== 'final-pregame'
        || !['away', 'home'].includes(row?.actualWinner)
      ) continue
      seen.add(key)
      rows.push({ ...row, resultDate: date })
    }
  }
  return rows
}

function winnerCalibration(rows) {
  const bins = [
    [0.50, 0.55],
    [0.55, 0.60],
    [0.60, 0.65],
    [0.65, 0.70],
    [0.70, 1.001],
  ]
  return bins.map(([lo, hi]) => {
    const matched = rows.filter((row) => (
      Number.isFinite(row.projectedWinnerProbability)
      && row.projectedWinnerProbability >= lo
      && row.projectedWinnerProbability < hi
      && typeof row.winnerCorrect === 'boolean'
    ))
    return {
      minProbability: lo,
      maxProbability: hi > 1 ? 1 : hi,
      sample: matched.length,
      meanProbability: roundedMetric(mean(matched.map((row) => row.projectedWinnerProbability))),
      observedWinRate: roundedMetric(mean(matched.map((row) => (row.winnerCorrect ? 1 : 0)))),
    }
  }).filter((bin) => bin.sample > 0)
}

// Evaluation is presentation-only. It summarizes frozen, settled pregame
// forecasts and never feeds the HR engine or the next game projection.
export function evaluateGameForecasts(log = {}) {
  const rows = gameForecastResultRows(log)
  const dates = new Set(rows.map((row) => row.resultDate))
  const winnerRows = rows.filter((row) => (
    Number.isFinite(row.homeWinProbability)
    && typeof row.winnerCorrect === 'boolean'
  ))
  const totalRows = rows.filter((row) => (
    Number.isFinite(row.projectedTotal)
    && Number.isFinite(row.actualTotal)
  ))
  const marketWinnerRows = winnerRows.filter((row) => (
    Number.isFinite(row.marketComparison?.moneyline?.homeMarketProbability)
  ))
  const marketTotalRows = totalRows.filter((row) => (
    Number.isFinite(row.marketComparison?.total?.line)
  ))

  const winnerBriers = winnerRows.map((row) => {
    const homeWon = row.actualWinner === 'home' ? 1 : 0
    return (row.homeWinProbability - homeWon) ** 2
  })
  const marketWinnerBriers = marketWinnerRows.map((row) => {
    const homeWon = row.actualWinner === 'home' ? 1 : 0
    return (row.marketComparison.moneyline.homeMarketProbability - homeWon) ** 2
  })
  const pairedModelWinnerBriers = marketWinnerRows.map((row) => {
    const homeWon = row.actualWinner === 'home' ? 1 : 0
    return (row.homeWinProbability - homeWon) ** 2
  })
  const totalErrors = totalRows.map((row) => row.projectedTotal - row.actualTotal)
  const totalMse = mean(totalErrors.map((value) => value ** 2))
  const teamRunErrors = totalRows.flatMap((row) => (
    Number.isFinite(row.awayExpectedRuns)
    && Number.isFinite(row.homeExpectedRuns)
    && Number.isFinite(row.actualAwayRuns)
    && Number.isFinite(row.actualHomeRuns)
      ? [
          Math.abs(row.awayExpectedRuns - row.actualAwayRuns),
          Math.abs(row.homeExpectedRuns - row.actualHomeRuns),
        ]
      : []
  ))
  const marketTotalErrors = marketTotalRows.map((row) => (
    Math.abs(row.marketComparison.total.line - row.actualTotal)
  ))
  const pairedModelTotalErrors = marketTotalRows.map((row) => (
    Math.abs(row.projectedTotal - row.actualTotal)
  ))

  const winnerBrier = mean(winnerBriers)
  const marketWinnerBrier = mean(marketWinnerBriers)
  const pairedModelWinnerBrier = mean(pairedModelWinnerBriers)
  const totalMae = mean(totalErrors.map(Math.abs))
  const marketTotalMae = mean(marketTotalErrors)
  const pairedModelTotalMae = mean(pairedModelTotalErrors)
  const status = rows.length >= MLB_GAME_EVALUATION_MIN_GAMES && dates.size >= MLB_GAME_EVALUATION_MIN_DATES
    ? 'review-ready'
    : 'collecting'
  const updatedAt = rows
    .map((row) => row.settledAt)
    .filter((value) => value && !Number.isNaN(Date.parse(value)))
    .sort()
    .at(-1) || null

  return {
    version: 1,
    advisoryOnly: true,
    status,
    updatedAt,
    minimumSample: {
      games: MLB_GAME_EVALUATION_MIN_GAMES,
      dates: MLB_GAME_EVALUATION_MIN_DATES,
    },
    sample: {
      games: rows.length,
      dates: dates.size,
      winnerGames: winnerRows.length,
      totalGames: totalRows.length,
      marketMoneylineGames: marketWinnerRows.length,
      marketTotalGames: marketTotalRows.length,
      progress: round(Math.min(
        rows.length / MLB_GAME_EVALUATION_MIN_GAMES,
        dates.size / MLB_GAME_EVALUATION_MIN_DATES,
        1,
      ), 3),
    },
    winner: {
      sample: winnerRows.length,
      accuracy: roundedMetric(mean(winnerRows.map((row) => (row.winnerCorrect ? 1 : 0)))),
      brier: roundedMetric(winnerBrier),
      coinFlipBrier: winnerRows.length ? 0.25 : null,
      improvementVsCoinFlip: winnerRows.length ? roundedMetric(0.25 - winnerBrier) : null,
      marketSample: marketWinnerRows.length,
      marketBrier: roundedMetric(marketWinnerBrier),
      improvementVsMarket: Number.isFinite(pairedModelWinnerBrier) && Number.isFinite(marketWinnerBrier)
        ? roundedMetric(marketWinnerBrier - pairedModelWinnerBrier)
        : null,
      calibration: winnerCalibration(winnerRows),
    },
    total: {
      sample: totalRows.length,
      mae: roundedMetric(totalMae, 3),
      rmse: Number.isFinite(totalMse) ? roundedMetric(Math.sqrt(totalMse), 3) : null,
      bias: roundedMetric(mean(totalErrors), 3),
      teamRunMae: roundedMetric(mean(teamRunErrors), 3),
      marketSample: marketTotalRows.length,
      marketLineMae: roundedMetric(marketTotalMae, 3),
      improvementVsMarket: Number.isFinite(pairedModelTotalMae) && Number.isFinite(marketTotalMae)
        ? roundedMetric(marketTotalMae - pairedModelTotalMae, 3)
        : null,
    },
    note: status === 'collecting'
      ? 'Forward results are still collecting; this report does not change production scoring.'
      : 'Minimum review sample reached; promotion still requires a separate model review.',
  }
}
