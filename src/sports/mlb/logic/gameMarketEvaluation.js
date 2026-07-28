export const MLB_GAME_MARKET_EVALUATION_VERSION = 1
export const MLB_GAME_MARKET_EVALUATION_MIN_GAMES = 100
export const MLB_GAME_MARKET_EVALUATION_MIN_DATES = 10
export const MLB_GAME_MARKET_PORTFOLIO_VERSION = 1

const round = (value, digits = 4) => {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const mean = (values) => (
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
)

function standardDeviation(values) {
  if (values.length < 2) return null
  const average = mean(values)
  return Math.sqrt(
    values.reduce((sum, value) => sum + ((value - average) ** 2), 0)
    / (values.length - 1),
  )
}

function probabilityForDecision(decision, market) {
  return market === 'moneyline'
    ? decision?.modelProbability
    : decision?.conditionalModelProbability
}

function openingMarketValue(call, market, selectedSide) {
  if (market === 'moneyline') {
    return call?.market?.moneyline?.[`${selectedSide}FairProbability`]
  }
  return call?.market?.total?.line
}

function closingMarketValue(decision, market) {
  return market === 'moneyline' ? decision?.marketFairProbability : decision?.line
}

function favorableMarketMove(opening, closing, market, selectedSide) {
  if (!Number.isFinite(opening) || !Number.isFinite(closing)) return null
  if (market === 'moneyline') return closing - opening
  const raw = closing - opening
  return selectedSide === 'under' ? -raw : raw
}

export function gameMarketResultRows(log = {}) {
  const resultsByDate = log?.gameForecasts?.resultsByDate
  if (!resultsByDate || typeof resultsByDate !== 'object' || Array.isArray(resultsByDate)) return []
  const callsByDate = log?.gameForecasts?.callsByDate || {}
  const rows = []
  const seen = new Set()
  for (const date of Object.keys(resultsByDate).sort()) {
    if (!Array.isArray(resultsByDate[date])) continue
    for (const result of resultsByDate[date]) {
      const gamePk = Number(result?.gamePk)
      if (!Number.isFinite(gamePk)) continue
      const callEntry = callsByDate?.[date]?.[gamePk] || callsByDate?.[date]?.[String(gamePk)]
      const closingCall = callEntry?.closing || callEntry?.current || null
      const openingCall = callEntry?.opening || null
      const marketDecision = closingCall?.marketDecision || result?.marketDecision
      const marketOutcome = result?.marketOutcome || callEntry?.settlement?.marketOutcome
      for (const market of ['moneyline', 'total']) {
        const decision = marketDecision?.[market]
        const outcome = marketOutcome?.[market]
        const key = `${date}|${gamePk}|${market}`
        if (
          seen.has(key)
          || !decision
          || !outcome
          || !['win', 'loss', 'push'].includes(outcome.result)
        ) continue
        seen.add(key)
        const selectedSide = outcome.selectedSide || decision.selectedSide
        const openingDecision = openingCall?.marketDecision?.[market]
        const sameOpeningSide = openingDecision?.selectedSide === selectedSide
        const openingValue = sameOpeningSide
          ? openingMarketValue(openingCall, market, selectedSide)
          : null
        const closingValue = closingMarketValue(decision, market)
        rows.push({
          date,
          gamePk,
          market,
          selectedSide,
          tier: outcome.tier,
          rawTier: outcome.rawTier,
          provisional: outcome.provisional === true,
          result: outcome.result,
          win: outcome.result === 'win' ? 1 : outcome.result === 'loss' ? 0 : null,
          unitProfit: outcome.unitProfit,
          includedInPerformance: outcome.includedInPerformance === true,
          american: outcome.american,
          line: outcome.line,
          modelProbability: probabilityForDecision(decision, market),
          marketProbability: decision.marketFairProbability,
          modelEdge: decision.modelEdge,
          expectedRoi: decision.expectedRoi,
          coverage: decision.coverage,
          books: decision.books,
          openingMarketValue: openingValue,
          closingMarketValue: closingValue,
          favorableMarketMove: round(favorableMarketMove(
            openingValue,
            closingValue,
            market,
            selectedSide,
          )),
          capturedAt: closingCall?.capturedAt || result?.capturedAt || null,
        })
      }
    }
  }
  return rows
}

function summarize(rows) {
  const decisions = rows.filter((row) => ['win', 'loss', 'push'].includes(row.result))
  const resolved = decisions.filter((row) => Number.isFinite(row.win))
  const profits = decisions.map((row) => row.unitProfit).filter(Number.isFinite)
  const profitMean = mean(profits)
  const profitStdDev = standardDeviation(profits)
  const roiStandardError = Number.isFinite(profitStdDev) && profits.length
    ? profitStdDev / Math.sqrt(profits.length)
    : null
  const modelBrierRows = resolved.filter((row) => Number.isFinite(row.modelProbability))
  const marketBrierRows = resolved.filter((row) => Number.isFinite(row.marketProbability))
  const modelBrier = mean(
    modelBrierRows.map((row) => (row.modelProbability - row.win) ** 2),
  )
  const marketBrier = mean(
    marketBrierRows.map((row) => (row.marketProbability - row.win) ** 2),
  )
  return {
    decisions: decisions.length,
    dates: new Set(decisions.map((row) => row.date)).size,
    wins: decisions.filter((row) => row.result === 'win').length,
    losses: decisions.filter((row) => row.result === 'loss').length,
    pushes: decisions.filter((row) => row.result === 'push').length,
    hitRate: round(mean(resolved.map((row) => row.win))),
    unitProfit: round(profits.reduce((sum, value) => sum + value, 0), 3),
    roi: round(profitMean),
    roiLower95: Number.isFinite(profitMean) && Number.isFinite(roiStandardError)
      ? round(profitMean - 1.96 * roiStandardError)
      : null,
    roiUpper95: Number.isFinite(profitMean) && Number.isFinite(roiStandardError)
      ? round(profitMean + 1.96 * roiStandardError)
      : null,
    modelBrier: round(modelBrier),
    marketBrier: round(marketBrier),
    brierAdvantageVsMarket: Number.isFinite(modelBrier) && Number.isFinite(marketBrier)
      ? round(marketBrier - modelBrier)
      : null,
    meanModelProbability: round(mean(
      decisions.map((row) => row.modelProbability).filter(Number.isFinite),
    )),
    meanMarketProbability: round(mean(
      decisions.map((row) => row.marketProbability).filter(Number.isFinite),
    )),
    meanModelEdge: round(mean(
      decisions.map((row) => row.modelEdge).filter(Number.isFinite),
    )),
    meanExpectedRoi: round(mean(
      decisions.map((row) => row.expectedRoi).filter(Number.isFinite),
    )),
    meanFavorableMarketMove: round(mean(
      decisions.map((row) => row.favorableMarketMove).filter(Number.isFinite),
    )),
  }
}

function segment(rows, keyOf) {
  const groups = new Map()
  for (const row of rows) {
    const key = keyOf(row)
    if (key == null) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return Object.fromEntries(
    [...groups.entries()]
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .map(([key, group]) => [key, summarize(group)]),
  )
}

function edgeBand(row) {
  if (!Number.isFinite(row.modelEdge)) return 'unavailable'
  if (row.modelEdge < 0.02) return 'under-2pct'
  if (row.modelEdge < 0.04) return '2-to-4pct'
  if (row.modelEdge < 0.06) return '4-to-6pct'
  return '6pct-plus'
}

function walkForwardCalibration(rows) {
  const ordered = rows
    .filter((row) => Number.isFinite(row.win) && Number.isFinite(row.modelProbability))
    .sort((left, right) => (
      left.date.localeCompare(right.date)
      || left.gamePk - right.gamePk
    ))
  const predictions = []
  for (const target of ordered) {
    const prior = ordered.filter((row) => row.date < target.date)
    const priorDates = new Set(prior.map((row) => row.date))
    if (prior.length < 30 || priorDates.size < 5) continue
    let local = prior.filter((row) => Math.abs(row.modelProbability - target.modelProbability) <= 0.075)
    if (local.length < 12) local = prior
    const priorWins = local.reduce((sum, row) => sum + row.win, 0)
    const calibrated = (priorWins + 20 * target.modelProbability) / (local.length + 20)
    predictions.push({
      ...target,
      calibratedProbability: calibrated,
      priorSample: local.length,
      priorDates: priorDates.size,
    })
  }
  const rawBrier = mean(
    predictions.map((row) => (row.modelProbability - row.win) ** 2),
  )
  const calibratedBrier = mean(
    predictions.map((row) => (row.calibratedProbability - row.win) ** 2),
  )
  return {
    methodology: 'strict-prior-date-empirical-shrinkage',
    advisoryOnly: true,
    sample: predictions.length,
    dates: new Set(predictions.map((row) => row.date)).size,
    rawBrier: round(rawBrier),
    calibratedBrier: round(calibratedBrier),
    improvement: Number.isFinite(rawBrier) && Number.isFinite(calibratedBrier)
      ? round(rawBrier - calibratedBrier)
      : null,
    ready: predictions.length >= 50
      && new Set(predictions.map((row) => row.date)).size >= 5,
  }
}

function promotion(summary) {
  const checks = {
    sample: summary.decisions >= MLB_GAME_MARKET_EVALUATION_MIN_GAMES,
    dates: summary.dates >= MLB_GAME_MARKET_EVALUATION_MIN_DATES,
    positiveRoi: Number.isFinite(summary.roi) && summary.roi > 0,
    conservativeRoi: Number.isFinite(summary.roiLower95) && summary.roiLower95 > 0,
    calibration: (
      Number.isFinite(summary.brierAdvantageVsMarket)
      && summary.brierAdvantageVsMarket >= 0
    ),
  }
  const sampleReady = checks.sample && checks.dates
  const eligible = Object.values(checks).every(Boolean)
  return {
    status: eligible ? 'eligible' : sampleReady ? 'hold' : 'collecting',
    eligible,
    minimumGames: MLB_GAME_MARKET_EVALUATION_MIN_GAMES,
    minimumDates: MLB_GAME_MARKET_EVALUATION_MIN_DATES,
    checks,
  }
}

function drift(rows) {
  const actionable = rows.filter((row) => row.includedInPerformance)
  const dates = [...new Set(actionable.map((row) => row.date))].sort()
  const recentDates = new Set(dates.slice(-14))
  const priorDates = new Set(dates.slice(-44, -14))
  const recent = summarize(actionable.filter((row) => recentDates.has(row.date)))
  const prior = summarize(actionable.filter((row) => priorDates.has(row.date)))
  const roiDrop = Number.isFinite(recent.roi) && Number.isFinite(prior.roi)
    ? prior.roi - recent.roi
    : null
  const brierWorsening = Number.isFinite(recent.modelBrier) && Number.isFinite(prior.modelBrier)
    ? recent.modelBrier - prior.modelBrier
    : null
  const ready = recent.decisions >= 20 && prior.decisions >= 40
  const flagged = ready && (
    roiDrop >= 0.15
    || brierWorsening >= 0.03
  )
  const watching = ready && !flagged && (
    roiDrop >= 0.08
    || brierWorsening >= 0.015
  )
  return {
    status: !ready ? 'collecting' : flagged ? 'drift' : watching ? 'watch' : 'stable',
    ready,
    recent,
    prior,
    roiDrop: round(roiDrop),
    brierWorsening: round(brierWorsening),
  }
}

function marketEvaluation(rows, market) {
  const marketRows = rows.filter((row) => row.market === market)
  const actionable = marketRows.filter((row) => row.includedInPerformance)
  const actionableSummary = summarize(actionable)
  return {
    allCalls: summarize(marketRows),
    actionable: actionableSummary,
    promotion: promotion(actionableSummary),
    calibration: walkForwardCalibration(actionable),
    drift: drift(marketRows),
    segments: {
      tier: segment(marketRows, (row) => row.tier),
      side: segment(marketRows, (row) => row.selectedSide),
      edge: segment(marketRows, edgeBand),
    },
  }
}

export function evaluateGameMarketPerformance(log = {}) {
  const rows = gameMarketResultRows(log)
  const moneyline = marketEvaluation(rows, 'moneyline')
  const total = marketEvaluation(rows, 'total')
  const actionable = rows.filter((row) => row.includedInPerformance)
  const dates = new Set(rows.map((row) => row.date))
  const status = moneyline.promotion.eligible && total.promotion.eligible
    ? 'eligible'
    : moneyline.promotion.status === 'hold' || total.promotion.status === 'hold'
      ? 'hold'
      : 'collecting'
  return {
    version: MLB_GAME_MARKET_EVALUATION_VERSION,
    advisoryOnly: true,
    methodology: 'frozen-closing-calls-with-strict-prior-date-calibration',
    status,
    updatedAt: dates.size ? new Date().toISOString() : null,
    minimumSample: {
      games: MLB_GAME_MARKET_EVALUATION_MIN_GAMES,
      dates: MLB_GAME_MARKET_EVALUATION_MIN_DATES,
    },
    sample: {
      calls: rows.length,
      actionable: actionable.length,
      dates: dates.size,
      fromDate: [...dates].sort()[0] || null,
      throughDate: [...dates].sort().at(-1) || null,
    },
    markets: { moneyline, total },
    note: 'Performance includes frozen PLAY and LEAN calls only. PASS remains descriptive, and calibration never trains on its target date.',
  }
}

function portfolioConflict(projection, market, decision) {
  const conflicts = []
  if (
    market === 'moneyline'
    && decision.selectedSide
    && decision.forecastSide
    && decision.selectedSide !== decision.forecastSide
  ) conflicts.push('value-side-opposes-forecast-favorite')
  const movement = projection?.marketTracking?.movement
  if (movement?.material) {
    if (
      market === 'moneyline'
      && Number.isFinite(movement.moneylineHomeProbability)
      && (
        (decision.selectedSide === 'home' && movement.moneylineHomeProbability < 0)
        || (decision.selectedSide === 'away' && movement.moneylineHomeProbability > 0)
      )
    ) conflicts.push('market-moved-against-side')
    if (
      market === 'total'
      && Number.isFinite(movement.totalLine)
      && (
        (decision.selectedSide === 'over' && movement.totalLine < 0)
        || (decision.selectedSide === 'under' && movement.totalLine > 0)
      )
    ) conflicts.push('market-moved-against-total')
  }
  return conflicts
}

function portfolioCandidate(projection, market) {
  const decision = projection?.marketDecision?.[market]
  if (
    !decision
    || !['play', 'lean'].includes(decision.tier)
    || !decision.selectedSide
    || !Number.isFinite(decision.expectedRoi)
    || !Number.isFinite(decision.modelEdge)
    || !Number.isFinite(decision.american)
  ) return null
  return {
    gamePk: projection.gamePk,
    gameDate: projection.gameDate,
    market,
    tier: decision.tier,
    rawTier: decision.rawTier,
    provisional: decision.provisional === true,
    selectedSide: decision.selectedSide,
    selectedTeam: decision.selectedTeam || null,
    forecastSide: decision.forecastSide || null,
    line: Number.isFinite(decision.line) ? decision.line : null,
    american: decision.american,
    modelProbability: probabilityForDecision(decision, market),
    marketProbability: decision.marketFairProbability,
    modelEdge: decision.modelEdge,
    expectedRoi: decision.expectedRoi,
    coverage: decision.coverage,
    books: decision.books,
    conflicts: portfolioConflict(projection, market, decision),
  }
}

const tierRank = (tier) => (tier === 'play' ? 2 : tier === 'lean' ? 1 : 0)

export function buildGameMarketPortfolio(
  projections = [],
  evaluation = null,
  {
    maximumSelections = 6,
    maximumPerMarket = 4,
    maximumPerGame = 1,
  } = {},
) {
  const candidates = projections
    .flatMap((projection) => (
      ['moneyline', 'total']
        .map((market) => portfolioCandidate(projection, market))
        .filter(Boolean)
    ))
    .sort((left, right) => (
      tierRank(right.tier) - tierRank(left.tier)
      || right.expectedRoi - left.expectedRoi
      || right.modelEdge - left.modelEdge
      || right.coverage - left.coverage
      || left.gamePk - right.gamePk
      || left.market.localeCompare(right.market)
    ))
  const selections = []
  const excluded = []
  const perMarket = new Map()
  const perGame = new Map()
  for (const candidate of candidates) {
    let reason = null
    if (selections.length >= maximumSelections) reason = 'slate-exposure'
    else if ((perMarket.get(candidate.market) || 0) >= maximumPerMarket) reason = 'market-exposure'
    else if ((perGame.get(candidate.gamePk) || 0) >= maximumPerGame) reason = 'game-exposure'
    if (reason) {
      excluded.push({ ...candidate, exclusionReason: reason })
      continue
    }
    selections.push({
      ...candidate,
      validated: candidate.tier === 'play' && candidate.provisional === false,
    })
    perMarket.set(candidate.market, (perMarket.get(candidate.market) || 0) + 1)
    perGame.set(candidate.gamePk, (perGame.get(candidate.gamePk) || 0) + 1)
  }
  const decisionStatuses = projections
    .map((projection) => projection?.marketDecision?.status)
    .filter(Boolean)
  const status = decisionStatuses.includes('ready')
    ? 'eligible'
    : decisionStatuses.some((value) => ['hold', 'drift-hold'].includes(value))
      ? 'hold'
      : evaluation?.status || 'collecting'
  return {
    version: MLB_GAME_MARKET_PORTFOLIO_VERSION,
    advisoryOnly: true,
    status,
    constraints: {
      maximumSelections,
      maximumPerMarket,
      maximumPerGame,
    },
    candidates: candidates.length,
    selections,
    excluded,
    note: 'Diversification limits ranking exposure only; they never change a game projection, decision tier, or PASS.',
  }
}
