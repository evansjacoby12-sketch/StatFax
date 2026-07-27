export const MLB_GAME_PROJECTION_VERSION = 1
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

function lineupOffense(lineup) {
  const batterProfiles = lineup.rows.map((row) => {
    const season = row.season || {}
    const recent = row.recent || {}
    const xStats = row.xStats || {}
    const paWeight = Number.isFinite(row.expectedPAs) ? clamp(row.expectedPAs, 3, 5) : 4
    return {
      weight: paWeight,
      obp: shrunkRate(season.obp, season.ab, 0.315, 100),
      slg: shrunkRate(season.slg, season.ab, 0.400, 100),
      xwoba: Number.isFinite(xStats.xwOBA) ? xStats.xwOBA : null,
      recentSlg: shrunkRate(recent.slg, recent.ab, 0.400, 80),
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
  return {
    factor: clamp(raw, 0.84, 1.18),
    obp,
    slg,
    xwoba,
    recentSlg,
    coverage: lineup.rows.length
      ? lineup.rows.filter((row) => Number.isFinite(row.season?.obp) && Number.isFinite(row.season?.slg)).length / lineup.rows.length
      : 0,
  }
}

function opposingPitcher(lineup, probablePitcherId) {
  return lineup.rows.find((row) => (
    row.pitcher && (!Number.isFinite(probablePitcherId) || Number(row.pitcher.id) === Number(probablePitcherId))
  ))?.pitcher || lineup.rows.find((row) => row.pitcher)?.pitcher || null
}

function starterRunFactor(pitcher) {
  if (!pitcher) return { factor: 1, estimatedEra: null, coverage: 0 }
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
  // The starter is responsible for only part of a full game's run environment.
  return {
    factor: clamp(1 + 0.58 * (quality - 1), 0.84, 1.20),
    estimatedEra,
    coverage: components.length ? clamp(components.reduce((sum, row) => sum + row.weight, 0), 0, 1) : 0,
  }
}

function bullpenPowerFactor(opponentTeamId, bullpenHR9) {
  const hr9 = Number(bullpenHR9?.[opponentTeamId])
  if (!Number.isFinite(hr9) || hr9 <= 0) return { factor: 1, hr9: null }
  return {
    factor: clamp(1 + 0.08 * (hr9 / 1.20 - 1), 0.95, 1.06),
    hr9,
  }
}

function environmentFactor(lineup) {
  const values = lineup.rows
    .map((row) => finite(row.parkWeatherHandFactor, row.gameParkHRFactor))
    .filter(Number.isFinite)
  const hrFactor = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1
  return {
    factor: clamp(1 + 0.32 * (hrFactor - 1), 0.92, 1.08),
    hrFactor,
    coverage: lineup.rows.length ? values.length / lineup.rows.length : 0,
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

function teamProjection({ game, rows, teamId, isHome, opponentTeamId, probablePitcherId, bullpenHR9 }) {
  const lineup = selectTeamLineup(rows, teamId)
  const offense = lineupOffense(lineup)
  const starter = starterRunFactor(opposingPitcher(lineup, probablePitcherId))
  const bullpen = bullpenPowerFactor(opponentTeamId, bullpenHR9)
  const environment = environmentFactor(lineup)
  const homeField = isHome ? 1.02 : 0.98
  const expectedRuns = clamp(
    MLB_GAME_BASE_RUNS_PER_TEAM
      * offense.factor
      * starter.factor
      * bullpen.factor
      * environment.factor
      * homeField,
    2.35,
    7.25,
  )
  const lineupCoverage = clamp(lineup.rows.length / 9, 0, 1)
  const sourceWeight = lineup.source === 'confirmed' ? 1 : lineup.source === 'recent-lineup' ? 0.82 : 0.55
  const coverage = (
    0.40 * lineupCoverage * sourceWeight
    + 0.25 * offense.coverage
    + 0.25 * starter.coverage
    + 0.10 * environment.coverage
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
      environmentFactor: round(environment.factor),
      homeFieldFactor: homeField,
      lineupObp: round(offense.obp),
      lineupSlg: round(offense.slg),
      lineupXwoba: Number.isFinite(offense.xwoba) ? round(offense.xwoba) : null,
      estimatedStarterEra: Number.isFinite(starter.estimatedEra) ? round(starter.estimatedEra, 2) : null,
      bullpenHr9: bullpen.hr9,
      parkWeatherHrFactor: round(environment.hrFactor),
    },
  }
}

export function buildGameProjection({ game, rows = [], bullpenHR9 = {}, gameOdds = null, capturedAt = new Date().toISOString() }) {
  if (!game || game.isLive === true || game.isFinal === true) return null
  const away = teamProjection({
    game,
    rows,
    teamId: game.awayTeam?.id,
    isHome: false,
    opponentTeamId: game.homeTeam?.id,
    probablePitcherId: game.homePitcher?.id,
    bullpenHR9,
  })
  const home = teamProjection({
    game,
    rows,
    teamId: game.homeTeam?.id,
    isHome: true,
    opponentTeamId: game.awayTeam?.id,
    probablePitcherId: game.awayPitcher?.id,
    bullpenHR9,
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
  gameOdds = {},
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
      gameOdds: gameOdds?.[game.gamePk] || null,
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
