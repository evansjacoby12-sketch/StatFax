export const MLB_GAME_MARKET_DECISION_VERSION = 1
export const MLB_GAME_MARKET_MIN_GAMES = 100
export const MLB_GAME_MARKET_MIN_DATES = 10

export const MLB_GAME_MARKET_GATES = Object.freeze({
  moneyline: Object.freeze({
    leanEdge: 0.02,
    playEdge: 0.04,
    leanRoi: 0.02,
    playRoi: 0.05,
    leanCoverage: 0.72,
    playCoverage: 0.80,
    minimumBooks: 2,
  }),
  total: Object.freeze({
    leanEdge: 0.02,
    playEdge: 0.04,
    leanRoi: 0.02,
    playRoi: 0.05,
    leanCoverage: 0.72,
    playCoverage: 0.80,
    leanRunSeparation: 0.25,
    playRunSeparation: 0.50,
    minimumBooks: 2,
  }),
})

const round = (value, digits = 4) => {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const americanToDecimal = (american) => {
  if (!Number.isFinite(american)) return null
  if (american >= 100) return 1 + american / 100
  if (american <= -100) return 1 + 100 / Math.abs(american)
  return null
}

const sidePolicy = (sample, dates, minimumGames, minimumDates) => ({
  sample,
  dates,
  minimumGames,
  minimumDates,
  ready: sample >= minimumGames && dates >= minimumDates,
})

export function gameMarketDecisionPolicy(evaluation = null) {
  const minimumGames = evaluation?.minimumSample?.games || MLB_GAME_MARKET_MIN_GAMES
  const minimumDates = evaluation?.minimumSample?.dates || MLB_GAME_MARKET_MIN_DATES
  const moneyline = sidePolicy(
    evaluation?.winner?.marketSample || 0,
    evaluation?.winner?.marketDates || 0,
    minimumGames,
    minimumDates,
  )
  const total = sidePolicy(
    evaluation?.total?.marketSample || 0,
    evaluation?.total?.marketDates || 0,
    minimumGames,
    minimumDates,
  )
  return {
    version: 1,
    status: moneyline.ready && total.ready ? 'ready' : 'collecting',
    moneyline,
    total,
  }
}

function expectedRoi(probability, american, loseProbability = 1 - probability) {
  const decimal = americanToDecimal(american)
  if (
    !Number.isFinite(probability)
    || !Number.isFinite(loseProbability)
    || !Number.isFinite(decimal)
  ) return null
  return probability * (decimal - 1) - loseProbability
}

function capUnvalidatedPlay(rawTier, policy) {
  if (rawTier === 'play' && !policy.ready) return 'lean'
  return rawTier
}

function tierReason({
  tier,
  rawTier,
  policy,
  market,
  side,
  missing = null,
}) {
  if (missing) return missing
  if (rawTier === 'play' && tier === 'lean') {
    return `PLAY thresholds cleared, but forward validation is ${policy.sample}/${policy.minimumGames} games across ${policy.dates}/${policy.minimumDates} dates.`
  }
  if (tier === 'play') return `${side} clears the validated ${market} edge, ROI, coverage, and market-quality gates.`
  if (tier === 'lean') return `${side} clears the provisional ${market} edge, ROI, coverage, and market-quality gates.`
  return `${side} does not clear every ${market} decision gate.`
}

function rankTier({
  edge,
  roi,
  coverage,
  books,
  gates,
  separation = null,
}) {
  const marketReady = Number.isInteger(books) && books >= gates.minimumBooks
  const play = (
    edge >= gates.playEdge
    && roi >= gates.playRoi
    && coverage >= gates.playCoverage
    && marketReady
    && (separation == null || separation >= gates.playRunSeparation)
  )
  if (play) return 'play'
  const lean = (
    edge >= gates.leanEdge
    && roi >= gates.leanRoi
    && coverage >= gates.leanCoverage
    && marketReady
    && (separation == null || separation >= gates.leanRunSeparation)
  )
  return lean ? 'lean' : 'pass'
}

function moneylineDecision({
  awayTeam,
  homeTeam,
  awayWinProbability,
  homeWinProbability,
  confidence,
  comparison,
  policy,
}) {
  const forecastSide = homeWinProbability >= awayWinProbability ? 'home' : 'away'
  const forecastTeam = forecastSide === 'home' ? homeTeam : awayTeam
  const forecastProbability = forecastSide === 'home' ? homeWinProbability : awayWinProbability
  const books = comparison?.books
  const candidates = ['away', 'home'].map((side) => {
    const modelProbability = side === 'home' ? homeWinProbability : awayWinProbability
    const marketProbability = comparison?.[`${side}MarketProbability`]
    const american = comparison?.[`${side}American`]
    return {
      side,
      team: side === 'home' ? homeTeam : awayTeam,
      modelProbability,
      marketProbability,
      modelEdge: Number.isFinite(modelProbability) && Number.isFinite(marketProbability)
        ? modelProbability - marketProbability
        : null,
      american,
      expectedRoi: expectedRoi(modelProbability, american),
    }
  }).filter((row) => (
    Number.isFinite(row.modelProbability)
    && Number.isFinite(row.marketProbability)
    && Number.isFinite(row.expectedRoi)
  ))
  const selected = candidates.sort((left, right) => (
    right.expectedRoi - left.expectedRoi
    || right.modelEdge - left.modelEdge
  ))[0] || null
  const coverage = Number.isFinite(confidence?.coverage) ? confidence.coverage : 0
  const rawTier = selected
    ? rankTier({
        edge: selected.modelEdge,
        roi: selected.expectedRoi,
        coverage,
        books,
        gates: MLB_GAME_MARKET_GATES.moneyline,
      })
    : 'unavailable'
  const tier = capUnvalidatedPlay(rawTier, policy)
  return {
    market: 'moneyline',
    forecastSide,
    forecastTeam: forecastTeam
      ? { id: forecastTeam.id, name: forecastTeam.name, abbr: forecastTeam.abbr }
      : null,
    forecastProbability: round(forecastProbability),
    selectedSide: selected?.side || null,
    selectedTeam: selected?.team
      ? { id: selected.team.id, name: selected.team.name, abbr: selected.team.abbr }
      : null,
    modelProbability: round(selected?.modelProbability),
    marketFairProbability: round(selected?.marketProbability),
    modelEdge: round(selected?.modelEdge),
    american: Number.isFinite(selected?.american) ? selected.american : null,
    expectedRoi: round(selected?.expectedRoi),
    books: Number.isInteger(books) ? books : 0,
    coverage: round(coverage),
    rawTier,
    tier,
    provisional: !policy.ready,
    reason: tierReason({
      tier,
      rawTier,
      policy,
      market: 'moneyline',
      side: selected?.team?.abbr || 'The best available side',
      missing: selected ? null : 'No complete consensus moneyline is available.',
    }),
    gates: {
      edge: Number.isFinite(selected?.modelEdge)
        ? selected.modelEdge >= MLB_GAME_MARKET_GATES.moneyline.leanEdge
        : false,
      roi: Number.isFinite(selected?.expectedRoi)
        ? selected.expectedRoi >= MLB_GAME_MARKET_GATES.moneyline.leanRoi
        : false,
      coverage: coverage >= MLB_GAME_MARKET_GATES.moneyline.leanCoverage,
      marketQuality: Number.isInteger(books)
        && books >= MLB_GAME_MARKET_GATES.moneyline.minimumBooks,
    },
  }
}

function totalDecision({
  projectedTotal,
  confidence,
  comparison,
  policy,
}) {
  const line = comparison?.line
  const pushProbability = comparison?.modelPushProbability
  const nonPushProbability = Number.isFinite(pushProbability) ? 1 - pushProbability : null
  const books = comparison?.books
  const candidates = ['over', 'under'].map((side) => {
    const modelWinProbability = comparison?.[`model${side === 'over' ? 'Over' : 'Under'}Probability`]
    const marketProbability = comparison?.[`market${side === 'over' ? 'Over' : 'Under'}Probability`]
    const american = comparison?.[`${side}American`]
    const modelLoseProbability = side === 'over'
      ? comparison?.modelUnderProbability
      : comparison?.modelOverProbability
    const conditionalModelProbability = (
      Number.isFinite(modelWinProbability)
      && Number.isFinite(nonPushProbability)
      && nonPushProbability > 0
    ) ? modelWinProbability / nonPushProbability : null
    const projectionSeparation = Number.isFinite(projectedTotal) && Number.isFinite(line)
      ? side === 'over'
        ? projectedTotal - line
        : line - projectedTotal
      : null
    return {
      side,
      modelWinProbability,
      modelLoseProbability,
      pushProbability,
      conditionalModelProbability,
      marketProbability,
      modelEdge: Number.isFinite(conditionalModelProbability) && Number.isFinite(marketProbability)
        ? conditionalModelProbability - marketProbability
        : null,
      american,
      expectedRoi: expectedRoi(modelWinProbability, american, modelLoseProbability),
      projectionSeparation,
    }
  }).filter((row) => (
    Number.isFinite(row.modelWinProbability)
    && Number.isFinite(row.modelLoseProbability)
    && Number.isFinite(row.marketProbability)
    && Number.isFinite(row.expectedRoi)
    && Number.isFinite(row.projectionSeparation)
  ))
  const selected = candidates.sort((left, right) => (
    right.expectedRoi - left.expectedRoi
    || right.modelEdge - left.modelEdge
  ))[0] || null
  const coverage = Number.isFinite(confidence?.coverage) ? confidence.coverage : 0
  const rawTier = selected
    ? rankTier({
        edge: selected.modelEdge,
        roi: selected.expectedRoi,
        coverage,
        books,
        gates: MLB_GAME_MARKET_GATES.total,
        separation: selected.projectionSeparation,
      })
    : 'unavailable'
  const tier = capUnvalidatedPlay(rawTier, policy)
  return {
    market: 'total',
    line: Number.isFinite(line) ? line : null,
    projectedTotal: round(projectedTotal, 2),
    projectionDelta: Number.isFinite(projectedTotal) && Number.isFinite(line)
      ? round(projectedTotal - line, 2)
      : null,
    selectedSide: selected?.side || null,
    modelWinProbability: round(selected?.modelWinProbability),
    modelLoseProbability: round(selected?.modelLoseProbability),
    modelPushProbability: round(selected?.pushProbability),
    conditionalModelProbability: round(selected?.conditionalModelProbability),
    marketFairProbability: round(selected?.marketProbability),
    modelEdge: round(selected?.modelEdge),
    american: Number.isFinite(selected?.american) ? selected.american : null,
    expectedRoi: round(selected?.expectedRoi),
    runSeparation: round(selected?.projectionSeparation, 2),
    books: Number.isInteger(books) ? books : 0,
    coverage: round(coverage),
    rawTier,
    tier,
    provisional: !policy.ready,
    reason: tierReason({
      tier,
      rawTier,
      policy,
      market: 'total',
      side: selected?.side?.toUpperCase() || 'The best available total',
      missing: selected ? null : 'No complete consensus total is available.',
    }),
    gates: {
      edge: Number.isFinite(selected?.modelEdge)
        ? selected.modelEdge >= MLB_GAME_MARKET_GATES.total.leanEdge
        : false,
      roi: Number.isFinite(selected?.expectedRoi)
        ? selected.expectedRoi >= MLB_GAME_MARKET_GATES.total.leanRoi
        : false,
      coverage: coverage >= MLB_GAME_MARKET_GATES.total.leanCoverage,
      marketQuality: Number.isInteger(books)
        && books >= MLB_GAME_MARKET_GATES.total.minimumBooks,
      separation: Number.isFinite(selected?.projectionSeparation)
        ? selected.projectionSeparation >= MLB_GAME_MARKET_GATES.total.leanRunSeparation
        : false,
    },
  }
}

export function buildGameMarketDecision({
  awayTeam = null,
  homeTeam = null,
  awayWinProbability = null,
  homeWinProbability = null,
  projectedTotal = null,
  confidence = null,
  marketComparison = null,
  policy = gameMarketDecisionPolicy(),
} = {}) {
  const resolvedPolicy = policy || gameMarketDecisionPolicy()
  return {
    version: MLB_GAME_MARKET_DECISION_VERSION,
    advisoryOnly: true,
    status: resolvedPolicy.status,
    policy: resolvedPolicy,
    moneyline: moneylineDecision({
      awayTeam,
      homeTeam,
      awayWinProbability,
      homeWinProbability,
      confidence,
      comparison: marketComparison?.moneyline,
      policy: resolvedPolicy.moneyline,
    }),
    total: totalDecision({
      projectedTotal,
      confidence,
      comparison: marketComparison?.total,
      policy: resolvedPolicy.total,
    }),
  }
}
