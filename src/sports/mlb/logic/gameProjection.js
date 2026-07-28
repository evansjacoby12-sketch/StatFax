import { teamScoringMatchupContext } from './teamScoringForm.js'
import { expectedStarterInnings } from './starterIPDistribution.js'
import {
  buildGameMarketDecision,
  gameMarketDecisionPolicy,
} from './gameMarketDecision.js'

export const MLB_GAME_PROJECTION_VERSION = 8
export const MLB_GAME_BASE_RUNS_PER_TEAM = 4.42
export const MLB_GAME_EVALUATION_MIN_GAMES = 100
export const MLB_GAME_EVALUATION_MIN_DATES = 10
// Calibrated on a chronological 70/30 split of 1,586 completed 2026 games
// through 2026-07-27. Held-out team-run log loss improved 9.4% vs Poisson.
export const MLB_GAME_SCORE_DISPERSION = 3.5
export const MLB_GAME_SCORE_INTERVAL_LEVEL = 0.8
export const MLB_GAME_MARKET_SIDE_MIN_ADVANTAGE = 0.005
export const MLB_GAME_MARKET_TOTAL_MIN_ADVANTAGE = 0.15
export const MLB_GAME_MARKET_MAX_WEIGHT = 0.2

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

export function negativeBinomialDistribution(
  mean,
  dispersion = MLB_GAME_SCORE_DISPERSION,
  max = 30,
) {
  if (!Number.isFinite(mean) || mean < 0) throw new TypeError('mean must be a non-negative finite number')
  if (!Number.isFinite(dispersion) || dispersion <= 0) throw new TypeError('dispersion must be a positive finite number')
  if (!Number.isInteger(max) || max < 1) throw new TypeError('max must be a positive integer')
  if (mean === 0) return [1, ...Array.from({ length: max }, () => 0)]

  const success = dispersion / (dispersion + mean)
  const probabilities = [success ** dispersion]
  for (let runs = 1; runs <= max; runs++) {
    probabilities[runs] = (
      probabilities[runs - 1]
      * ((runs - 1 + dispersion) / runs)
      * (1 - success)
    )
  }
  const sum = probabilities.reduce((total, probability) => total + probability, 0)
  return probabilities.map((probability) => probability / sum)
}

function convolveDistributions(left, right) {
  const distribution = Array.from({ length: left.length + right.length - 1 }, () => 0)
  for (let leftRuns = 0; leftRuns < left.length; leftRuns++) {
    for (let rightRuns = 0; rightRuns < right.length; rightRuns++) {
      distribution[leftRuns + rightRuns] += left[leftRuns] * right[rightRuns]
    }
  }
  const sum = distribution.reduce((total, probability) => total + probability, 0)
  return distribution.map((probability) => probability / sum)
}

function discreteQuantile(distribution, quantile) {
  let cumulative = 0
  for (let runs = 0; runs < distribution.length; runs++) {
    cumulative += distribution[runs]
    if (cumulative >= quantile) return runs
  }
  return distribution.length - 1
}

function summarizeRunDistribution(distribution, mean, variance, intervalLevel) {
  const tail = (1 - intervalLevel) / 2
  const low = discreteQuantile(distribution, tail)
  const high = discreteQuantile(distribution, 1 - tail)
  let mode = 0
  let modeProbability = distribution[0]
  for (let runs = 1; runs < distribution.length; runs++) {
    if (distribution[runs] > modeProbability) {
      mode = runs
      modeProbability = distribution[runs]
    }
  }
  const coverage = distribution
    .slice(low, high + 1)
    .reduce((total, probability) => total + probability, 0)
  return {
    mean: round(mean, 2),
    variance: round(variance, 3),
    low,
    high,
    mode,
    coverage: round(coverage, 4),
  }
}

export function scoreDistributionSummary(
  awayExpectedRuns,
  homeExpectedRuns,
  {
    dispersion = MLB_GAME_SCORE_DISPERSION,
    intervalLevel = MLB_GAME_SCORE_INTERVAL_LEVEL,
  } = {},
) {
  const awayDistribution = negativeBinomialDistribution(awayExpectedRuns, dispersion)
  const homeDistribution = negativeBinomialDistribution(homeExpectedRuns, dispersion)
  const totalDistribution = convolveDistributions(awayDistribution, homeDistribution)
  const awayVariance = awayExpectedRuns + (awayExpectedRuns ** 2 / dispersion)
  const homeVariance = homeExpectedRuns + (homeExpectedRuns ** 2 / dispersion)
  const away = summarizeRunDistribution(
    awayDistribution,
    awayExpectedRuns,
    awayVariance,
    intervalLevel,
  )
  const home = summarizeRunDistribution(
    homeDistribution,
    homeExpectedRuns,
    homeVariance,
    intervalLevel,
  )
  const total = summarizeRunDistribution(
    totalDistribution,
    awayExpectedRuns + homeExpectedRuns,
    awayVariance + homeVariance,
    intervalLevel,
  )
  return {
    family: 'negative-binomial',
    parameterization: 'NB2',
    dispersion,
    intervalLevel,
    away,
    home,
    total,
    mostLikelyScore: {
      away: away.mode,
      home: home.mode,
      probability: round(awayDistribution[away.mode] * homeDistribution[home.mode], 4),
    },
  }
}

export function winProbabilities(
  awayExpectedRuns,
  homeExpectedRuns,
  { dispersion = MLB_GAME_SCORE_DISPERSION } = {},
) {
  const away = negativeBinomialDistribution(awayExpectedRuns, dispersion)
  const home = negativeBinomialDistribution(homeExpectedRuns, dispersion)
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

export function gameTotalProbabilities(
  projectedTotal,
  line,
  {
    awayExpectedRuns = null,
    homeExpectedRuns = null,
    dispersion = MLB_GAME_SCORE_DISPERSION,
  } = {},
) {
  if (!Number.isFinite(line) || line <= 0) return null
  const distribution = Number.isFinite(awayExpectedRuns) && Number.isFinite(homeExpectedRuns)
    ? convolveDistributions(
      negativeBinomialDistribution(awayExpectedRuns, dispersion),
      negativeBinomialDistribution(homeExpectedRuns, dispersion),
    )
    : negativeBinomialDistribution(projectedTotal, dispersion * 2, 50)
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

function marketComparison(gameOdds, win, projectedTotal, awayExpectedRuns, homeExpectedRuns) {
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
    const distribution = gameTotalProbabilities(projectedTotal, consensus.total.line, {
      awayExpectedRuns,
      homeExpectedRuns,
    })
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

function marketBlendReason({
  sample,
  dates,
  minimumGames,
  minimumDates,
  advantage,
  minimumAdvantage,
  unit,
}) {
  if (sample < minimumGames || dates < minimumDates) {
    return `Collecting ${sample}/${minimumGames} paired games across ${dates}/${minimumDates} dates.`
  }
  if (!Number.isFinite(advantage)) return 'No paired model-versus-market evidence is available.'
  if (advantage < minimumAdvantage) {
    return `Market advantage ${round(advantage, unit === 'Brier' ? 4 : 3)} ${unit} is below the ${minimumAdvantage} gate.`
  }
  return `Market beat the unblended model by ${round(advantage, unit === 'Brier' ? 4 : 3)} ${unit}.`
}

export function gameMarketBlendPolicy(evaluation = null) {
  const minimumGames = evaluation?.minimumSample?.games || MLB_GAME_EVALUATION_MIN_GAMES
  const minimumDates = evaluation?.minimumSample?.dates || MLB_GAME_EVALUATION_MIN_DATES
  const sideSample = evaluation?.winner?.marketSample || 0
  const totalSample = evaluation?.total?.marketSample || 0
  const sideDates = evaluation?.winner?.marketDates || 0
  const totalDates = evaluation?.total?.marketDates || 0
  const sideAdvantage = Number.isFinite(evaluation?.winner?.baseImprovementVsMarket)
    ? -evaluation.winner.baseImprovementVsMarket
    : null
  const totalAdvantage = Number.isFinite(evaluation?.total?.baseImprovementVsMarket)
    ? -evaluation.total.baseImprovementVsMarket
    : null
  const sideActive = (
    sideSample >= minimumGames
    && sideDates >= minimumDates
    && Number.isFinite(sideAdvantage)
    && sideAdvantage >= MLB_GAME_MARKET_SIDE_MIN_ADVANTAGE
  )
  const totalActive = (
    totalSample >= minimumGames
    && totalDates >= minimumDates
    && Number.isFinite(totalAdvantage)
    && totalAdvantage >= MLB_GAME_MARKET_TOTAL_MIN_ADVANTAGE
  )
  const sideWeight = sideActive
    ? round(clamp(0.1 + sideAdvantage * 4, 0.1, MLB_GAME_MARKET_MAX_WEIGHT), 3)
    : 0
  const totalWeight = totalActive
    ? round(clamp(0.1 + totalAdvantage * 0.1, 0.1, MLB_GAME_MARKET_MAX_WEIGHT), 3)
    : 0
  return {
    version: 1,
    evidenceGated: true,
    status: sideActive || totalActive
      ? 'active'
      : sideSample < minimumGames || totalSample < minimumGames || sideDates < minimumDates || totalDates < minimumDates
        ? 'collecting'
        : 'inactive',
    minimumGames,
    minimumDates,
    side: {
      active: sideActive,
      sample: sideSample,
      dates: sideDates,
      marketAdvantageBrier: Number.isFinite(sideAdvantage) ? round(sideAdvantage, 4) : null,
      minimumAdvantageBrier: MLB_GAME_MARKET_SIDE_MIN_ADVANTAGE,
      weight: sideWeight,
      reason: marketBlendReason({
        sample: sideSample,
        dates: sideDates,
        minimumGames,
        minimumDates,
        advantage: sideAdvantage,
        minimumAdvantage: MLB_GAME_MARKET_SIDE_MIN_ADVANTAGE,
        unit: 'Brier',
      }),
    },
    total: {
      active: totalActive,
      sample: totalSample,
      dates: totalDates,
      marketAdvantageMae: Number.isFinite(totalAdvantage) ? round(totalAdvantage, 3) : null,
      minimumAdvantageMae: MLB_GAME_MARKET_TOTAL_MIN_ADVANTAGE,
      weight: totalWeight,
      reason: marketBlendReason({
        sample: totalSample,
        dates: totalDates,
        minimumGames,
        minimumDates,
        advantage: totalAdvantage,
        minimumAdvantage: MLB_GAME_MARKET_TOTAL_MIN_ADVANTAGE,
        unit: 'runs MAE',
      }),
    },
  }
}

function applyMarketBlend(
  baseAwayExpectedRuns,
  baseHomeExpectedRuns,
  gameOdds,
  policy = gameMarketBlendPolicy(),
) {
  const consensus = gameOdds?.consensus
  const marketTotal = consensus?.total?.line
  const marketHome = consensus?.moneyline?.home?.fairProbability
  const marketAway = consensus?.moneyline?.away?.fairProbability
  const baseProjectedTotal = baseAwayExpectedRuns + baseHomeExpectedRuns
  const totalApplied = policy.total.active && Number.isFinite(marketTotal)
  const projectedTotal = totalApplied
    ? baseProjectedTotal * (1 - policy.total.weight) + marketTotal * policy.total.weight
    : baseProjectedTotal
  const totalScale = baseProjectedTotal > 0 ? projectedTotal / baseProjectedTotal : 1
  const awayExpectedRuns = baseAwayExpectedRuns * totalScale
  const homeExpectedRuns = baseHomeExpectedRuns * totalScale
  const runModelWin = winProbabilities(awayExpectedRuns, homeExpectedRuns)
  const sideApplied = (
    policy.side.active
    && Number.isFinite(marketHome)
    && Number.isFinite(marketAway)
  )
  const homeWinProbability = sideApplied
    ? runModelWin.home * (1 - policy.side.weight) + marketHome * policy.side.weight
    : runModelWin.home
  const awayWinProbability = 1 - homeWinProbability

  return {
    awayExpectedRuns,
    homeExpectedRuns,
    projectedTotal,
    win: {
      away: awayWinProbability,
      home: homeWinProbability,
      tieAfterNine: runModelWin.tieAfterNine,
    },
    disclosure: {
      version: 1,
      evidenceGated: true,
      policyStatus: policy.status,
      applied: sideApplied || totalApplied,
      side: {
        eligible: policy.side.active,
        applied: sideApplied,
        weight: policy.side.weight,
        sample: policy.side.sample,
        dates: policy.side.dates,
        minimumGames: policy.minimumGames,
        minimumDates: policy.minimumDates,
        marketAdvantageBrier: policy.side.marketAdvantageBrier,
        minimumAdvantageBrier: policy.side.minimumAdvantageBrier,
        baseHomeWinProbability: round(winProbabilities(
          baseAwayExpectedRuns,
          baseHomeExpectedRuns,
        ).home, 4),
        preBlendHomeWinProbability: round(runModelWin.home, 4),
        marketHomeWinProbability: Number.isFinite(marketHome) ? round(marketHome, 4) : null,
        finalHomeWinProbability: round(homeWinProbability, 4),
        reason: policy.side.active && !sideApplied
          ? 'Evidence gate passed, but this game has no consensus moneyline.'
          : policy.side.reason,
      },
      total: {
        eligible: policy.total.active,
        applied: totalApplied,
        weight: policy.total.weight,
        sample: policy.total.sample,
        dates: policy.total.dates,
        minimumGames: policy.minimumGames,
        minimumDates: policy.minimumDates,
        marketAdvantageMae: policy.total.marketAdvantageMae,
        minimumAdvantageMae: policy.total.minimumAdvantageMae,
        baseAwayExpectedRuns: round(baseAwayExpectedRuns, 2),
        baseHomeExpectedRuns: round(baseHomeExpectedRuns, 2),
        baseProjectedTotal: round(baseProjectedTotal, 2),
        marketTotal: Number.isFinite(marketTotal) ? round(marketTotal, 2) : null,
        finalAwayExpectedRuns: round(awayExpectedRuns, 2),
        finalHomeExpectedRuns: round(homeExpectedRuns, 2),
        finalProjectedTotal: round(projectedTotal, 2),
        reason: policy.total.active && !totalApplied
          ? 'Evidence gate passed, but this game has no consensus total.'
          : policy.total.reason,
      },
    },
  }
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
      lineupPlayerIds: lineup.rows.map((row) => Number(row.playerId)).filter(Number.isFinite),
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
  gameMarketTracking = null,
  marketBlendPolicy = gameMarketBlendPolicy(),
  marketDecisionPolicy = gameMarketDecisionPolicy(),
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
  const blended = applyMarketBlend(
    away.expectedRuns,
    home.expectedRuns,
    gameOdds,
    marketBlendPolicy,
  )
  const projectedTotal = blended.projectedTotal
  const scoreDistribution = scoreDistributionSummary(
    blended.awayExpectedRuns,
    blended.homeExpectedRuns,
  )
  const win = blended.win
  const projectedWinner = win.home >= win.away ? 'home' : 'away'
  const coverage = (away.coverage + home.coverage) / 2
  const awayTeam = { id: game.awayTeam?.id, name: game.awayTeam?.name, abbr: game.awayTeam?.abbr }
  const homeTeam = { id: game.homeTeam?.id, name: game.homeTeam?.name, abbr: game.homeTeam?.abbr }
  const confidence = {
    status: coverage >= 0.82 ? 'medium' : 'limited',
    coverage: round(coverage),
    note: coverage >= 0.82
      ? 'Core lineup and pitcher inputs are available; validation is still collecting.'
      : 'Some lineup or pitcher inputs are projected or incomplete.',
  }
  const comparison = marketComparison(
    gameOdds,
    win,
    projectedTotal,
    blended.awayExpectedRuns,
    blended.homeExpectedRuns,
  )
  return {
    modelVersion: MLB_GAME_PROJECTION_VERSION,
    advisoryOnly: true,
    captureState: 'pregame',
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    capturedAt,
    awayTeam,
    homeTeam,
    probablePitchers: {
      away: game.awayPitcher
        ? { id: game.awayPitcher.id ?? null, name: game.awayPitcher.name || null }
        : null,
      home: game.homePitcher
        ? { id: game.homePitcher.id ?? null, name: game.homePitcher.name || null }
        : null,
    },
    awayExpectedRuns: round(blended.awayExpectedRuns, 2),
    homeExpectedRuns: round(blended.homeExpectedRuns, 2),
    projectedTotal: round(projectedTotal, 2),
    // Kept for older clients. Unlike the retired point estimate, this is the
    // literal joint mode and may honestly be tied after nine innings.
    estimatedScore: {
      away: scoreDistribution.mostLikelyScore.away,
      home: scoreDistribution.mostLikelyScore.home,
    },
    scoreDistribution,
    awayWinProbability: round(win.away, 4),
    homeWinProbability: round(win.home, 4),
    tieAfterNineProbability: round(win.tieAfterNine, 4),
    projectedWinner,
    projectedWinnerProbability: round(Math.max(win.away, win.home), 4),
    confidence,
    inputs: { away: away.inputs, home: home.inputs },
    marketBlend: blended.disclosure,
    marketComparison: comparison,
    marketTracking: gameMarketTracking,
    marketDecision: buildGameMarketDecision({
      awayTeam,
      homeTeam,
      awayWinProbability: win.away,
      homeWinProbability: win.home,
      projectedTotal,
      confidence,
      marketComparison: comparison,
      policy: marketDecisionPolicy,
    }),
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
  gameMarketTracking = {},
  marketBlendPolicy = gameMarketBlendPolicy(),
  marketDecisionPolicy = gameMarketDecisionPolicy(),
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
      gameMarketTracking: gameMarketTracking?.[game.gamePk] || null,
      marketBlendPolicy,
      marketDecisionPolicy,
      teamScoringProfiles,
      capturedAt,
    }))
    .filter(Boolean)
}

const sameNumbers = (left = [], right = []) => (
  left.length === right.length
  && left.every((value, index) => Number(value) === Number(right[index]))
)

const changedBy = (left, right, threshold) => (
  Number.isFinite(left)
  && Number.isFinite(right)
  && Math.abs(left - right) >= threshold
)

const changedNames = (left = [], right = []) => (
  [...left].sort().join('|') !== [...right].sort().join('|')
)

export function detectGameProjectionChanges(previous, current) {
  if (!previous || !current) return []
  const changes = []
  for (const side of ['away', 'home']) {
    if (
      Number(previous.probablePitchers?.[side]?.id || 0)
      !== Number(current.probablePitchers?.[side]?.id || 0)
    ) changes.push(`${side}-starter`)
    if (
      previous.inputs?.[side]?.lineupSource !== current.inputs?.[side]?.lineupSource
      || !sameNumbers(
        previous.inputs?.[side]?.lineupPlayerIds || [],
        current.inputs?.[side]?.lineupPlayerIds || [],
      )
    ) changes.push(`${side}-lineup`)
    if (
      changedBy(
        previous.inputs?.[side]?.bullpenAvailabilityFactor,
        current.inputs?.[side]?.bullpenAvailabilityFactor,
        0.01,
      )
      || changedNames(
        previous.inputs?.[side]?.bullpenContext?.unavailableNames || [],
        current.inputs?.[side]?.bullpenContext?.unavailableNames || [],
      )
    ) changes.push(`${side}-bullpen`)
  }

  const previousEnvironment = previous.inputs?.away?.runEnvironment
  const currentEnvironment = current.inputs?.away?.runEnvironment
  if (
    previousEnvironment?.roofClosed !== currentEnvironment?.roofClosed
    || previousEnvironment?.roofPending !== currentEnvironment?.roofPending
  ) changes.push('roof')
  if (
    changedBy(
      previous.inputs?.away?.runEnvironmentFactor,
      current.inputs?.away?.runEnvironmentFactor,
      0.015,
    )
  ) changes.push('weather')

  if (
    changedBy(previous.homeWinProbability, current.homeWinProbability, 0.02)
  ) changes.push('side-projection')
  if (
    changedBy(previous.projectedTotal, current.projectedTotal, 0.25)
  ) changes.push('total-projection')

  const previousMoneyline = previous.marketTracking?.current?.moneyline
  const currentMoneyline = current.marketTracking?.current?.moneyline
  if (
    changedBy(
      previousMoneyline?.homeFairProbability,
      currentMoneyline?.homeFairProbability,
      0.02,
    )
    || changedBy(previousMoneyline?.homeAmerican, currentMoneyline?.homeAmerican, 15)
  ) changes.push('moneyline-market')
  const previousTotal = previous.marketTracking?.current?.total
  const currentTotal = current.marketTracking?.current?.total
  if (
    changedBy(previousTotal?.line, currentTotal?.line, 0.5)
    || changedBy(previousTotal?.overAmerican, currentTotal?.overAmerican, 15)
  ) changes.push('total-market')
  return [...new Set(changes)]
}

export function buildGameProjectionRevision(
  previous,
  current,
  { observedAt = current?.capturedAt || new Date().toISOString() } = {},
) {
  if (!previous) {
    return {
      number: 1,
      firstCapturedAt: current?.capturedAt || observedAt,
      lastChangedAt: current?.capturedAt || observedAt,
      previousCapturedAt: null,
      observedAt,
      material: false,
      reasons: ['initial-capture'],
    }
  }
  const reasons = detectGameProjectionChanges(previous, current)
  const priorRevision = previous.revision || {}
  return {
    number: (Number.isInteger(priorRevision.number) ? priorRevision.number : 1)
      + (reasons.length ? 1 : 0),
    firstCapturedAt: priorRevision.firstCapturedAt || previous.capturedAt,
    lastChangedAt: reasons.length
      ? observedAt
      : priorRevision.lastChangedAt || previous.capturedAt,
    previousCapturedAt: reasons.length ? previous.capturedAt : priorRevision.previousCapturedAt || null,
    observedAt,
    material: reasons.length > 0,
    reasons,
  }
}

const cloneJson = (value) => (
  value == null ? null : JSON.parse(JSON.stringify(value))
)

export function gameMarketCallSnapshot(
  projection,
  capturedAt = projection?.capturedAt || new Date().toISOString(),
) {
  if (!projection || !Number.isFinite(projection.gamePk)) return null
  return {
    capturedAt,
    modelVersion: projection.modelVersion,
    projectionRevision: projection.revision?.number || 1,
    estimatedScore: cloneJson(projection.estimatedScore),
    awayExpectedRuns: projection.awayExpectedRuns,
    homeExpectedRuns: projection.homeExpectedRuns,
    projectedTotal: projection.projectedTotal,
    awayWinProbability: projection.awayWinProbability,
    homeWinProbability: projection.homeWinProbability,
    projectedWinner: projection.projectedWinner,
    projectedWinnerProbability: projection.projectedWinnerProbability,
    marketDecision: cloneJson(projection.marketDecision),
    market: cloneJson(projection.marketTracking?.current),
  }
}

function gameMarketCallFingerprint(call) {
  if (!call) return null
  return JSON.stringify({
    modelVersion: call.modelVersion,
    estimatedScore: call.estimatedScore,
    awayExpectedRuns: call.awayExpectedRuns,
    homeExpectedRuns: call.homeExpectedRuns,
    projectedTotal: call.projectedTotal,
    awayWinProbability: call.awayWinProbability,
    homeWinProbability: call.homeWinProbability,
    projectedWinner: call.projectedWinner,
    projectedWinnerProbability: call.projectedWinnerProbability,
    marketDecision: call.marketDecision,
    market: call.market,
  })
}

function compactCallRevisions(revisions) {
  if (revisions.length <= 48) return revisions
  return [revisions[0], ...revisions.slice(-47)]
}

function updateGameMarketCallEntry(
  prior,
  projection,
  {
    capturedAt = projection?.capturedAt || new Date().toISOString(),
    frozen = false,
  } = {},
) {
  const call = gameMarketCallSnapshot(projection, capturedAt)
  if (!call) return prior || null
  if (prior?.status === 'frozen') return prior
  if (!prior) {
    return {
      gamePk: projection.gamePk,
      gameDate: projection.gameDate,
      awayTeam: cloneJson(projection.awayTeam),
      homeTeam: cloneJson(projection.homeTeam),
      status: frozen ? 'frozen' : 'pregame',
      opening: call,
      current: call,
      closing: frozen ? call : null,
      firstCapturedAt: capturedAt,
      lastObservedAt: capturedAt,
      lastChangedAt: capturedAt,
      closedAt: frozen ? capturedAt : null,
      observationCount: 1,
      revisionCount: 1,
      revisions: [call],
      settlement: null,
    }
  }
  const changed = (
    gameMarketCallFingerprint(prior.current)
    !== gameMarketCallFingerprint(call)
  )
  const current = frozen ? prior.current : call
  const revisions = changed && !frozen
    ? compactCallRevisions([...(prior.revisions || [prior.opening]), call])
    : prior.revisions || [prior.opening]
  return {
    ...prior,
    gamePk: projection.gamePk,
    gameDate: projection.gameDate,
    awayTeam: cloneJson(projection.awayTeam),
    homeTeam: cloneJson(projection.homeTeam),
    status: frozen ? 'frozen' : 'pregame',
    current,
    closing: frozen ? (prior.closing || prior.current) : null,
    lastObservedAt: capturedAt,
    lastChangedAt: changed && !frozen ? capturedAt : prior.lastChangedAt,
    closedAt: frozen ? (prior.closedAt || capturedAt) : null,
    observationCount: (prior.observationCount || 0) + 1,
    revisionCount: (prior.revisionCount || 1) + (changed && !frozen ? 1 : 0),
    revisions,
  }
}

function updateGameMarketCalls(callsByDate, date, projections, games, capturedAt) {
  const byDate = { ...(callsByDate || {}) }
  const priorDay = byDate[date] && typeof byDate[date] === 'object'
    ? byDate[date]
    : {}
  const nextDay = { ...priorDay }
  const projectionsByGame = new Map(
    projections.map((projection) => [Number(projection.gamePk), projection]),
  )
  for (const game of games || []) {
    const gamePk = Number(game?.gamePk)
    const projection = projectionsByGame.get(gamePk)
    if (!projection) continue
    const key = String(gamePk)
    const entry = updateGameMarketCallEntry(priorDay[key], projection, {
      capturedAt,
      frozen: game.isLive === true || game.isFinal === true,
    })
    if (entry) nextDay[key] = entry
  }
  byDate[date] = nextDay
  for (const key of Object.keys(byDate).sort().slice(0, -180)) delete byDate[key]
  return byDate
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
      callsByDate: { ...(priorForecasts.callsByDate || {}) },
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
      const freshProjection = fresh.get(gamePk)
      merged.push({
        ...freshProjection,
        revision: buildGameProjectionRevision(prior.get(gamePk), freshProjection, {
          observedAt: capturedAt,
        }),
        freezeState: 'refreshing-pregame',
        frozenAt: null,
      })
    }
  }
  next.gameForecasts.predictionsByDate[date] = merged
  next.gameForecasts.callsByDate = updateGameMarketCalls(
    next.gameForecasts.callsByDate,
    date,
    merged,
    games,
    capturedAt,
  )
  for (const key of Object.keys(next.gameForecasts.predictionsByDate).sort().slice(0, -180)) {
    delete next.gameForecasts.predictionsByDate[key]
  }
  for (const key of Object.keys(next.gameForecasts.resultsByDate).sort().slice(0, -180)) {
    delete next.gameForecasts.resultsByDate[key]
  }
  for (const key of Object.keys(next.gameForecasts.callsByDate).sort().slice(0, -180)) {
    delete next.gameForecasts.callsByDate[key]
  }
  return { log: next, projections: merged }
}

const americanUnitProfit = (american) => {
  if (!Number.isFinite(american)) return null
  if (american >= 100) return american / 100
  if (american <= -100) return 100 / Math.abs(american)
  return null
}

function settledSelection(decision, result, { line = null } = {}) {
  const tier = decision?.tier || 'unavailable'
  const selectedSide = decision?.selectedSide || null
  const american = Number.isFinite(decision?.american) ? decision.american : null
  const graded = ['win', 'loss', 'push'].includes(result)
  const unitProfit = !graded
    ? null
    : result === 'win'
      ? americanUnitProfit(american)
      : result === 'loss'
        ? -1
        : 0
  return {
    selectedSide,
    tier,
    rawTier: decision?.rawTier || tier,
    provisional: decision?.provisional === true,
    american,
    line: Number.isFinite(line) ? line : null,
    result: graded ? result : 'ungraded',
    unitProfit: Number.isFinite(unitProfit) ? round(unitProfit, 4) : null,
    includedInPerformance: graded && ['play', 'lean'].includes(tier),
  }
}

export function gradeGameMarketDecision(decision, {
  awayRuns,
  homeRuns,
} = {}) {
  const actualTotal = Number.isFinite(awayRuns) && Number.isFinite(homeRuns)
    ? awayRuns + homeRuns
    : null
  const actualWinner = Number.isFinite(awayRuns) && Number.isFinite(homeRuns)
    ? homeRuns > awayRuns
      ? 'home'
      : awayRuns > homeRuns
        ? 'away'
        : 'tie'
    : null
  const moneylineSide = decision?.moneyline?.selectedSide
  const moneylineResult = !['away', 'home'].includes(moneylineSide) || actualWinner == null
    ? 'ungraded'
    : actualWinner === 'tie'
      ? 'push'
      : moneylineSide === actualWinner
        ? 'win'
        : 'loss'
  const totalSide = decision?.total?.selectedSide
  const totalLine = decision?.total?.line
  let totalResult = 'ungraded'
  if (
    ['over', 'under'].includes(totalSide)
    && Number.isFinite(actualTotal)
    && Number.isFinite(totalLine)
  ) {
    if (actualTotal === totalLine) totalResult = 'push'
    else if (totalSide === 'over') totalResult = actualTotal > totalLine ? 'win' : 'loss'
    else totalResult = actualTotal < totalLine ? 'win' : 'loss'
  }
  return {
    version: 1,
    advisoryOnly: true,
    moneyline: settledSelection(decision?.moneyline, moneylineResult),
    total: settledSelection(decision?.total, totalResult, { line: totalLine }),
  }
}

function settledGameProjection(projection, game, {
  settledAt,
  settlementSource,
} = {}) {
  const actualAwayRuns = Number(game?.awayRuns)
  const actualHomeRuns = Number(game?.homeRuns)
  if (!Number.isFinite(actualAwayRuns) || !Number.isFinite(actualHomeRuns)) return null
  const actualTotal = actualAwayRuns + actualHomeRuns
  const homeWon = actualHomeRuns > actualAwayRuns
  const awayWon = actualAwayRuns > actualHomeRuns
  return {
    ...projection,
    freezeState: 'final-pregame',
    frozenAt: projection.frozenAt || game.gameDate || settledAt,
    actualAwayRuns,
    actualHomeRuns,
    actualTotal,
    actualWinner: homeWon ? 'home' : awayWon ? 'away' : 'tie',
    totalError: round(projection.projectedTotal - actualTotal, 2),
    absoluteTotalError: round(Math.abs(projection.projectedTotal - actualTotal), 2),
    winnerCorrect: homeWon || awayWon
      ? projection.projectedWinner === (homeWon ? 'home' : 'away')
      : null,
    winnerBrier: homeWon || awayWon
      ? round((projection.homeWinProbability - (homeWon ? 1 : 0)) ** 2, 6)
      : null,
    marketOutcome: gradeGameMarketDecision(projection.marketDecision, {
      awayRuns: actualAwayRuns,
      homeRuns: actualHomeRuns,
    }),
    settlementSource,
    settledAt,
  }
}

function settleGameMarketCallEntry(prior, projection, game, settledProjection, {
  settledAt,
  settlementSource,
}) {
  const frozen = updateGameMarketCallEntry(prior, projection, {
    capturedAt: game.gameDate || settledAt,
    frozen: true,
  })
  if (!frozen) return prior || null
  return {
    ...frozen,
    settlement: {
      actualAwayRuns: settledProjection.actualAwayRuns,
      actualHomeRuns: settledProjection.actualHomeRuns,
      actualTotal: settledProjection.actualTotal,
      actualWinner: settledProjection.actualWinner,
      marketOutcome: cloneJson(settledProjection.marketOutcome),
      settlementSource,
      settledAt,
    },
  }
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
      callsByDate: { ...(priorForecasts.callsByDate || {}) },
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
    const settledAt = snapshot.finishedAt || snapshot.generatedAt || new Date().toISOString()
    const normalizedGame = {
      ...game,
      awayRuns: game.awayScore,
      homeRuns: game.homeScore,
    }
    const settled = settledGameProjection(projection, normalizedGame, {
      settledAt,
      settlementSource: 'daily-snapshot',
    })
    if (!settled) continue
    existing.set(Number(game.gamePk), settled)
    const callDay = next.gameForecasts.callsByDate[date] || {}
    next.gameForecasts.callsByDate[date] = {
      ...callDay,
      [game.gamePk]: settleGameMarketCallEntry(
        callDay[game.gamePk],
        projection,
        normalizedGame,
        settled,
        { settledAt, settlementSource: 'daily-snapshot' },
      ),
    }
  }
  if (existing.size) next.gameForecasts.resultsByDate[date] = [...existing.values()]
  for (const key of Object.keys(next.gameForecasts.resultsByDate).sort().slice(0, -180)) {
    delete next.gameForecasts.resultsByDate[key]
  }
  return next
}

export function settleGameForecastsFromResults(
  log = {},
  artifact,
  { settledAt = artifact?.fetchedAt || new Date().toISOString() } = {},
) {
  if (!Array.isArray(artifact?.games)) return log
  const priorForecasts = log?.gameForecasts || {}
  const next = {
    ...(log || {}),
    gameForecasts: {
      ...priorForecasts,
      version: 1,
      predictionsByDate: { ...(priorForecasts.predictionsByDate || {}) },
      resultsByDate: { ...(priorForecasts.resultsByDate || {}) },
      callsByDate: { ...(priorForecasts.callsByDate || {}) },
    },
  }
  const finals = new Map(
    artifact.games
      .filter((game) => Number.isFinite(Number(game?.gamePk)))
      .map((game) => [Number(game.gamePk), game]),
  )
  for (const [date, predictions] of Object.entries(next.gameForecasts.predictionsByDate)) {
    if (!Array.isArray(predictions)) continue
    const existing = new Map(
      (next.gameForecasts.resultsByDate[date] || [])
        .map((row) => [Number(row.gamePk), row]),
    )
    const updatedPredictions = []
    const callDay = { ...(next.gameForecasts.callsByDate[date] || {}) }
    for (const projection of predictions) {
      const game = finals.get(Number(projection?.gamePk))
      const captureTime = Date.parse(projection?.capturedAt)
      const firstPitch = Date.parse(game?.gameDate)
      const teamMatch = (
        Number(projection?.awayTeam?.id) === Number(game?.awayTeam?.id)
        && Number(projection?.homeTeam?.id) === Number(game?.homeTeam?.id)
      )
      const eligible = (
        game?.officialDate === date
        && projection?.captureState === 'pregame'
        && ['refreshing-pregame', 'final-pregame'].includes(projection?.freezeState)
        && !Number.isNaN(captureTime)
        && !Number.isNaN(firstPitch)
        && captureTime < firstPitch
        && teamMatch
      )
      if (!eligible) {
        updatedPredictions.push(projection)
        continue
      }
      const priorSettled = existing.get(Number(game.gamePk))
      const alreadySettled = (
        priorSettled?.settlementSource === 'official-season-results'
        && Number(priorSettled.actualAwayRuns) === Number(game.awayRuns)
        && Number(priorSettled.actualHomeRuns) === Number(game.homeRuns)
      )
      const settled = alreadySettled
        ? priorSettled
        : settledGameProjection(projection, game, {
            settledAt,
            settlementSource: 'official-season-results',
          })
      if (!settled) {
        updatedPredictions.push(projection)
        continue
      }
      updatedPredictions.push({
        ...projection,
        freezeState: 'final-pregame',
        frozenAt: projection.frozenAt || game.gameDate,
      })
      existing.set(Number(game.gamePk), settled)
      if (!alreadySettled || !callDay[game.gamePk]?.settlement) {
        callDay[game.gamePk] = settleGameMarketCallEntry(
          callDay[game.gamePk],
          projection,
          game,
          settled,
          { settledAt, settlementSource: 'official-season-results' },
        )
      }
    }
    next.gameForecasts.predictionsByDate[date] = updatedPredictions
    if (existing.size) next.gameForecasts.resultsByDate[date] = [...existing.values()]
    if (Object.keys(callDay).length) next.gameForecasts.callsByDate[date] = callDay
  }
  for (const section of ['predictionsByDate', 'resultsByDate', 'callsByDate']) {
    for (const key of Object.keys(next.gameForecasts[section]).sort().slice(0, -180)) {
      delete next.gameForecasts[section][key]
    }
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

// Evaluation summarizes frozen, settled pregame forecasts. Only its aggregate
// paired base-vs-market metrics can unlock the capped game-market blend; no
// individual result or market input ever feeds the HR engine.
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
  const marketWinnerDates = new Set(marketWinnerRows.map((row) => row.resultDate))
  const marketTotalDates = new Set(marketTotalRows.map((row) => row.resultDate))

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
  const pairedBaseWinnerBriers = marketWinnerRows.map((row) => {
    const homeWon = row.actualWinner === 'home' ? 1 : 0
    const baseHomeProbability = Number.isFinite(row.marketBlend?.side?.baseHomeWinProbability)
      ? row.marketBlend.side.baseHomeWinProbability
      : row.homeWinProbability
    return (baseHomeProbability - homeWon) ** 2
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
  const pairedBaseTotalErrors = marketTotalRows.map((row) => {
    const baseProjectedTotal = Number.isFinite(row.marketBlend?.total?.baseProjectedTotal)
      ? row.marketBlend.total.baseProjectedTotal
      : row.projectedTotal
    return Math.abs(baseProjectedTotal - row.actualTotal)
  })

  const winnerBrier = mean(winnerBriers)
  const marketWinnerBrier = mean(marketWinnerBriers)
  const pairedModelWinnerBrier = mean(pairedModelWinnerBriers)
  const pairedBaseWinnerBrier = mean(pairedBaseWinnerBriers)
  const totalMae = mean(totalErrors.map(Math.abs))
  const marketTotalMae = mean(marketTotalErrors)
  const pairedModelTotalMae = mean(pairedModelTotalErrors)
  const pairedBaseTotalMae = mean(pairedBaseTotalErrors)
  const status = rows.length >= MLB_GAME_EVALUATION_MIN_GAMES && dates.size >= MLB_GAME_EVALUATION_MIN_DATES
    ? 'review-ready'
    : 'collecting'
  const updatedAt = rows
    .map((row) => row.settledAt)
    .filter((value) => value && !Number.isNaN(Date.parse(value)))
    .sort()
    .at(-1) || null

  return {
    version: 2,
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
      marketDates: marketWinnerDates.size,
      marketBrier: roundedMetric(marketWinnerBrier),
      pairedModelBrier: roundedMetric(pairedModelWinnerBrier),
      pairedBaseBrier: roundedMetric(pairedBaseWinnerBrier),
      improvementVsMarket: Number.isFinite(pairedModelWinnerBrier) && Number.isFinite(marketWinnerBrier)
        ? roundedMetric(marketWinnerBrier - pairedModelWinnerBrier)
        : null,
      baseImprovementVsMarket: Number.isFinite(pairedBaseWinnerBrier) && Number.isFinite(marketWinnerBrier)
        ? roundedMetric(marketWinnerBrier - pairedBaseWinnerBrier)
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
      marketDates: marketTotalDates.size,
      marketLineMae: roundedMetric(marketTotalMae, 3),
      pairedModelMae: roundedMetric(pairedModelTotalMae, 3),
      pairedBaseMae: roundedMetric(pairedBaseTotalMae, 3),
      improvementVsMarket: Number.isFinite(pairedModelTotalMae) && Number.isFinite(marketTotalMae)
        ? roundedMetric(marketTotalMae - pairedModelTotalMae, 3)
        : null,
      baseImprovementVsMarket: Number.isFinite(pairedBaseTotalMae) && Number.isFinite(marketTotalMae)
        ? roundedMetric(marketTotalMae - pairedBaseTotalMae, 3)
        : null,
    },
    note: status === 'collecting'
      ? 'Forward results are still collecting; the market blend remains evidence-gated.'
      : 'The market blend reads only paired, unblended model evidence from prior settled games.',
  }
}
