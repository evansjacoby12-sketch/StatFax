const MIN_COVERAGE = 0.72
const VALID_OUTCOMES = new Set(['win', 'loss', 'push'])

export const GAME_COMBO_RECIPES = [
  {
    id: 'steady-pair',
    label: 'Steady Pair',
    description: 'One PLAY/LEAN moneyline plus one WATCH NRFI.',
    markets: ['moneyline', 'nrfi'],
  },
  {
    id: 'under-pair',
    label: 'Under Pair',
    description: 'One PASS Under plus one WATCH NRFI.',
    markets: ['under', 'nrfi'],
  },
  {
    id: 'trend-trio',
    label: 'Trend Trio',
    description: 'One moneyline, one PASS Under, and one WATCH NRFI.',
    markets: ['moneyline', 'under', 'nrfi'],
  },
]

const finite = (value) => Number.isFinite(value)
const clean = (value) => String(value || '').trim().toLowerCase()

function dateKey(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || null
}

function team(team, fallback) {
  return {
    id: team?.id ?? null,
    name: team?.name || fallback,
    abbr: team?.abbr || fallback,
  }
}

function projectionForGame(projections, gamePk) {
  return projections?.[gamePk] || projections?.[String(gamePk)] || null
}

function hasStarter(value) {
  const name = String(value?.name || '').trim()
  return Boolean(name && !/^(tbd|unknown|away sp|home sp)/i.test(name))
}

function identity(source, fallbackDate = null) {
  const gamePk = Number(source?.gamePk)
  return {
    gamePk: finite(gamePk) ? gamePk : null,
    date: dateKey(source?.gameDate) || dateKey(fallbackDate),
    gameDate: source?.gameDate || null,
    gameNumber: finite(source?.gameNumber)
      ? source.gameNumber
      : finite(source?.marketTracking?.gameNumber)
        ? source.marketTracking.gameNumber
        : 1,
    away: team(source?.awayTeam, 'AWAY'),
    home: team(source?.homeTeam, 'HOME'),
  }
}

function starterPair(source, projection) {
  const probable = projection?.probablePitchers || source?.probablePitchers || {}
  return {
    away: probable.away || (source?.awayPitcher ? { name: source.awayPitcher } : null),
    home: probable.home || (source?.homePitcher ? { name: source.homePitcher } : null),
  }
}

function selectedTeam(identityRow, decision) {
  if (decision?.selectedTeam?.abbr) return team(decision.selectedTeam, 'TEAM')
  return clean(decision?.selectedSide) === 'away' ? identityRow.away : identityRow.home
}

function marketProbability(decision, market) {
  if (market === 'moneyline') return finite(decision?.modelProbability)
    ? decision.modelProbability
    : null
  return finite(decision?.conditionalModelProbability)
    ? decision.conditionalModelProbability
    : finite(decision?.modelWinProbability)
      ? decision.modelWinProbability
      : null
}

function legScore(leg) {
  const tierLift = leg.tier === 'play' ? 0.035 : leg.market === 'nrfi' ? 0.015 : 0
  return (leg.probability ?? 0.5) + tierLift + ((leg.coverage ?? MIN_COVERAGE) - MIN_COVERAGE) * 0.025
}

function makeLeg(identityRow, market, fields) {
  const leg = {
    id: `${identityRow.gamePk}:${market}`,
    gamePk: identityRow.gamePk,
    date: identityRow.date,
    gameDate: identityRow.gameDate,
    gameNumber: identityRow.gameNumber,
    away: identityRow.away,
    home: identityRow.home,
    matchup: `${identityRow.away.abbr} @ ${identityRow.home.abbr}`,
    market,
    ...fields,
  }
  return { ...leg, score: legScore(leg) }
}

function normalizeOutcome(value) {
  const outcome = clean(value)
  return VALID_OUTCOMES.has(outcome) ? outcome : null
}

function moneylineLeg(identityRow, decision, outcome = null) {
  const tier = clean(decision?.tier)
  const side = clean(decision?.selectedSide)
  const probability = marketProbability(decision, 'moneyline')
  if (!['play', 'lean'].includes(tier) || !['away', 'home'].includes(side) || !finite(probability)) return null
  const selected = selectedTeam(identityRow, decision)
  return makeLeg(identityRow, 'moneyline', {
    tier,
    selection: `${selected.abbr} ML`,
    selectedSide: side,
    probability,
    coverage: finite(decision?.coverage) ? decision.coverage : null,
    american: finite(decision?.american) ? decision.american : null,
    outcome: normalizeOutcome(outcome),
  })
}

function underLeg(identityRow, decision, outcome = null) {
  const tier = clean(decision?.tier)
  const side = clean(decision?.selectedSide)
  const probability = marketProbability(decision, 'total')
  if (tier !== 'pass' || side !== 'under' || !finite(decision?.line) || !finite(probability)) return null
  if (clean(decision?.blowUpRisk?.level) === 'high') return null
  return makeLeg(identityRow, 'under', {
    tier,
    selection: `Under ${decision.line}`,
    selectedSide: side,
    line: decision.line,
    probability,
    coverage: finite(decision?.coverage) ? decision.coverage : null,
    american: finite(decision?.american) ? decision.american : null,
    outcome: normalizeOutcome(outcome),
  })
}

function nrfiLeg(identityRow, first, outcome = null) {
  const tier = clean(first?.tier)
  const side = clean(first?.lean)
  const probability = finite(first?.nrfiProbability)
    ? first.nrfiProbability
    : side === 'nrfi' && finite(first?.selectedProbability)
      ? first.selectedProbability
      : null
  if (tier !== 'watch' || side !== 'nrfi' || !finite(probability)) return null
  return makeLeg(identityRow, 'nrfi', {
    tier,
    selection: 'NRFI',
    selectedSide: side,
    probability,
    coverage: finite(first?.coverage) ? first.coverage : null,
    american: null,
    outcome: normalizeOutcome(outcome),
  })
}

function legPool(source, projection, outcomes = {}) {
  const row = identity(source)
  const starters = starterPair(source, projection)
  if (!row.gamePk || !hasStarter(starters.away) || !hasStarter(starters.home)) return []

  const moneyline = projection?.marketDecision?.moneyline
  const total = projection?.marketDecision?.total
  const first = projection?.firstInning
  const legs = [
    moneylineLeg(row, moneyline, outcomes.moneyline),
    underLeg(row, total, outcomes.total),
    nrfiLeg(row, first, outcomes.firstInning),
  ]
  return legs.filter((leg) => leg && (leg.coverage === null || leg.coverage >= MIN_COVERAGE))
}

export function currentGameComboLegs(games = [], projections = {}) {
  return games.flatMap((game) => {
    if (game?.isLive === true || game?.isFinal === true) return []
    const projection = projectionForGame(projections, game?.gamePk)
    return projection ? legPool(game, projection) : []
  })
}

export function archivedGameComboLegs(records = [], fallbackDate = null) {
  return records.flatMap((record) => {
    const projection = {
      probablePitchers: record?.probablePitchers,
      marketDecision: {
        moneyline: record?.marketDecision?.moneyline,
        total: record?.marketDecision?.total,
      },
      firstInning: record?.firstInning,
    }
    const row = { ...record, gameDate: record?.gameDate || fallbackDate }
    const outcomes = {
      moneyline: record?.marketOutcome?.moneyline?.result,
      total: record?.marketOutcome?.total?.result,
      firstInning: typeof record?.firstInningCorrect === 'boolean'
        ? record.firstInningCorrect ? 'win' : 'loss'
        : null,
    }
    return legPool(row, projection, outcomes)
  })
}

function compareLegs(a, b) {
  if (a.score !== b.score) return b.score - a.score
  if (a.probability !== b.probability) return b.probability - a.probability
  return a.id.localeCompare(b.id)
}

function cartesian(groups, index = 0, selected = [], output = []) {
  if (index >= groups.length) {
    output.push(selected)
    return output
  }
  groups[index].forEach((leg) => {
    if (selected.some((existing) => existing.gamePk === leg.gamePk)) return
    cartesian(groups, index + 1, [...selected, leg], output)
  })
  return output
}

function comboOutcome(legs) {
  if (legs.some((leg) => leg.outcome === 'loss')) return 'loss'
  if (legs.every((leg) => leg.outcome === 'win')) return 'win'
  if (legs.every((leg) => leg.outcome) && legs.some((leg) => leg.outcome === 'push')) return 'push'
  return null
}

function buildRecipe(recipe, legs) {
  const groups = recipe.markets.map((market) => legs.filter((leg) => leg.market === market).sort(compareLegs))
  if (groups.some((group) => group.length === 0)) return null
  const candidates = cartesian(groups)
    .map((candidate) => ({
      legs: candidate,
      score: candidate.reduce((sum, leg) => sum + leg.score, 0),
      probability: candidate.reduce((product, leg) => product * leg.probability, 1),
    }))
    .sort((a, b) => b.score - a.score || a.legs.map((leg) => leg.id).join('|').localeCompare(b.legs.map((leg) => leg.id).join('|')))
  const best = candidates[0]
  if (!best) return null
  return {
    ...recipe,
    size: best.legs.length,
    legs: best.legs,
    probability: best.probability,
    priced: false,
    outcome: comboOutcome(best.legs),
    signature: `${recipe.id}:${best.legs.map((leg) => leg.id).join('|')}`,
  }
}

export function buildGameCombos(legs = []) {
  return GAME_COMBO_RECIPES
    .map((recipe) => buildRecipe(recipe, legs))
    .filter(Boolean)
    .slice(0, 3)
}

export function buildHistoricalGameComboTracking(resultsByDate = {}, asOfDate, windowDays = 7) {
  const end = dateKey(asOfDate)
  if (!end) return { twoLeg: summarize([]), threeLeg: summarize([]), byRecipe: {}, rows: [] }
  const startDate = new Date(`${end}T12:00:00Z`)
  startDate.setUTCDate(startDate.getUTCDate() - (windowDays - 1))
  const start = startDate.toISOString().slice(0, 10)
  const rows = Object.entries(resultsByDate || {})
    .filter(([date]) => date >= start && date <= end)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([date, records]) => buildGameCombos(archivedGameComboLegs(records, date)).map((combo) => ({ ...combo, date })))
  const byRecipe = Object.fromEntries(GAME_COMBO_RECIPES.map((recipe) => [
    recipe.id,
    summarize(rows.filter((row) => row.id === recipe.id)),
  ]))
  return {
    twoLeg: summarize(rows.filter((row) => row.size === 2)),
    threeLeg: summarize(rows.filter((row) => row.size === 3)),
    byRecipe,
    rows,
  }
}

function summarize(rows) {
  return rows.reduce((summary, row) => {
    if (row.outcome === 'win') summary.wins += 1
    else if (row.outcome === 'loss') summary.losses += 1
    else if (row.outcome === 'push') summary.pushes += 1
    else summary.pending += 1
    return summary
  }, { wins: 0, losses: 0, pushes: 0, pending: 0 })
}

export function comboRequirements(legs = []) {
  const count = (market) => legs.filter((leg) => leg.market === market).length
  return {
    moneyline: count('moneyline'),
    under: count('under'),
    nrfi: count('nrfi'),
  }
}

export { MIN_COVERAGE }
