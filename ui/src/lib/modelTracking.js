const ACTIONABLE_MARKET_TIERS = new Set(['play', 'lean'])
const SETTLED_OUTCOMES = new Set(['win', 'loss', 'push'])

const finite = (value) => Number.isFinite(value)

function dateKey(value) {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || null
}

function rollingDates(asOfDate, windowDays) {
  if (!dateKey(asOfDate)) return []
  const end = new Date(`${asOfDate}T12:00:00Z`)
  return Array.from({ length: windowDays }, (_, index) => {
    const day = new Date(end)
    day.setUTCDate(end.getUTCDate() - (windowDays - index - 1))
    return day.toISOString().slice(0, 10)
  })
}

function projectionForGame(projections, gamePk) {
  return projections?.[gamePk] || projections?.[String(gamePk)] || null
}

function settledMoneyline(game, decision) {
  if (game?.isFinal !== true) return null
  if (!finite(game.awayScore) || !finite(game.homeScore)) return null
  if (!['away', 'home'].includes(decision?.selectedSide)) return null
  if (game.awayScore === game.homeScore) return 'push'
  const winner = game.awayScore > game.homeScore ? 'away' : 'home'
  return decision.selectedSide === winner ? 'win' : 'loss'
}

function settledTotal(game, decision) {
  if (game?.isFinal !== true) return null
  if (!finite(game.awayScore) || !finite(game.homeScore) || !finite(decision?.line)) return null
  if (!['over', 'under'].includes(decision?.selectedSide)) return null
  const total = game.awayScore + game.homeScore
  if (total === decision.line) return 'push'
  return decision.selectedSide === 'over'
    ? total > decision.line ? 'win' : 'loss'
    : total < decision.line ? 'win' : 'loss'
}

function firstInningComplete(game) {
  return game?.isFinal === true || (
    game?.isLive === true
    && finite(game?.currentInning)
    && game.currentInning > 1
  )
}

function settledFirstInning(game, first) {
  if (!firstInningComplete(game)) return null
  if (!finite(game?.awayFirstInningRuns) || !finite(game?.homeFirstInningRuns)) return null
  if (!['nrfi', 'yrfi'].includes(first?.lean)) return null
  const actual = game.awayFirstInningRuns + game.homeFirstInningRuns > 0 ? 'yrfi' : 'nrfi'
  return first.lean === actual ? 'win' : 'loss'
}

function usableAmerican(value) {
  return finite(value) && Math.abs(value) >= 100
}

function unitProfit(result, american) {
  if (result === 'loss') return -1
  if (result === 'push') return 0
  if (result !== 'win' || !usableAmerican(american)) return null
  return american > 0 ? american / 100 : 100 / Math.abs(american)
}

function marketLiveState(game, decision, market) {
  if (game?.isLive !== true || game?.isFinal === true) return null
  if (!finite(game.awayScore) || !finite(game.homeScore)) return { kind: 'live' }
  if (market === 'moneyline') {
    if (!['away', 'home'].includes(decision?.selectedSide)) return { kind: 'live' }
    const selected = decision.selectedSide === 'away' ? game.awayScore : game.homeScore
    const opponent = decision.selectedSide === 'away' ? game.homeScore : game.awayScore
    return { kind: selected > opponent ? 'leading' : selected < opponent ? 'trailing' : 'tied' }
  }
  if (
    market === 'total'
    && ['over', 'under'].includes(decision?.selectedSide)
    && finite(decision?.line)
  ) {
    const total = game.awayScore + game.homeScore
    if (total > decision.line) {
      return { kind: decision.selectedSide === 'over' ? 'clinched-win' : 'clinched-loss' }
    }
  }
  return { kind: 'live' }
}

function rowForMarket(game, decision, market) {
  const outcome = market === 'moneyline'
    ? settledMoneyline(game, decision)
    : settledTotal(game, decision)
  return {
    outcome,
    american: decision?.american,
    pending: game?.isLive !== true && game?.isFinal !== true,
    liveState: outcome ? null : marketLiveState(game, decision, market),
  }
}

function rowForFirstInning(game, first) {
  const outcome = settledFirstInning(game, first)
  return {
    outcome,
    american: null,
    pending: game?.isLive !== true && game?.isFinal !== true,
    liveState: outcome || game?.isLive !== true || game?.isFinal === true
      ? null
      : { kind: 'live' },
  }
}

function archivedTracking(outcome, american = null) {
  return {
    outcome: SETTLED_OUTCOMES.has(outcome) ? outcome : null,
    american,
    pending: false,
    liveState: null,
  }
}

function archivedFirstInningOutcome(record, first) {
  if (typeof record?.firstInningCorrect === 'boolean') {
    return record.firstInningCorrect ? 'win' : 'loss'
  }
  if (typeof record?.actualYrfi !== 'boolean' || !['nrfi', 'yrfi'].includes(first?.lean)) {
    return null
  }
  return (first.lean === 'yrfi') === record.actualYrfi ? 'win' : 'loss'
}

function summarize(rows) {
  const settled = rows.filter((row) => row.outcome)
  const priced = settled
    .map((row) => unitProfit(row.outcome, row.american))
    .filter(finite)
  const units = settled.length && priced.length === settled.length
    ? priced.reduce((sum, value) => sum + value, 0)
    : null
  const countLive = (kind) => rows.filter((row) => row.liveState?.kind === kind).length
  return {
    picks: rows.length,
    settled: settled.length,
    wins: settled.filter((row) => row.outcome === 'win').length,
    losses: settled.filter((row) => row.outcome === 'loss').length,
    pushes: settled.filter((row) => row.outcome === 'push').length,
    pending: rows.filter((row) => row.pending).length,
    live: rows.filter((row) => row.liveState).length,
    openLive: countLive('live'),
    leading: countLive('leading'),
    trailing: countLive('trailing'),
    tied: countLive('tied'),
    clinchedWins: countLive('clinched-win'),
    clinchedLosses: countLive('clinched-loss'),
    pricedSettled: priced.length,
    units,
    roi: finite(units) && settled.length ? units / settled.length : null,
  }
}

function splitRows(rows, primary, diagnostic) {
  return {
    primary: summarize(rows.filter(primary).map((row) => row.tracking)),
    diagnostic: summarize(rows.filter(diagnostic).map((row) => row.tracking)),
  }
}

export function buildModelTracking(games = [], projections = {}, options = {}) {
  const windowDays = Math.max(1, Math.min(7, Math.trunc(options.windowDays) || 1))
  const asOfDate = dateKey(options.asOfDate)
  const dates = rollingDates(asOfDate, windowDays)
  const includedDates = new Set(dates)
  const moneylineRows = new Map()
  const totalRows = new Map()
  const firstInningRows = new Map()

  for (const date of dates) {
    const records = options.resultsByDate?.[date] || []
    for (const record of records) {
      const key = String(record?.gamePk ?? `${date}-${moneylineRows.size}`)
      const moneyline = record?.marketOutcome?.moneyline
      const total = record?.marketOutcome?.total
      const first = record?.firstInning
      if (moneyline?.tier) {
        moneylineRows.set(key, {
          date,
          tier: moneyline.tier,
          tracking: archivedTracking(moneyline.result, moneyline.american),
        })
      }
      if (total?.tier) {
        totalRows.set(key, {
          date,
          tier: total.tier,
          tracking: archivedTracking(total.result, total.american),
        })
      }
      if (first?.tier && ['nrfi', 'yrfi'].includes(first.lean)) {
        firstInningRows.set(key, {
          date,
          tier: first.tier,
          qualified: first.qualified === true,
          tracking: archivedTracking(archivedFirstInningOutcome(record, first)),
        })
      }
    }
  }

  for (const game of games || []) {
    const projection = projectionForGame(projections, game?.gamePk)
    const key = String(game?.gamePk ?? `current-${moneylineRows.size}`)
    const currentDate = asOfDate || dateKey(game?.gameDate)
    if (includedDates.size && currentDate && !includedDates.has(currentDate)) continue
    const moneyline = projection?.marketDecision?.moneyline
    const total = projection?.marketDecision?.total
    const first = projection?.firstInning
    if (moneyline?.tier) {
      moneylineRows.set(key, {
        date: currentDate,
        tier: moneyline.tier,
        tracking: rowForMarket(game, moneyline, 'moneyline'),
      })
    }
    if (total?.tier) {
      totalRows.set(key, {
        date: currentDate,
        tier: total.tier,
        tracking: rowForMarket(game, total, 'total'),
      })
    }
    if (first?.tier && ['nrfi', 'yrfi'].includes(first.lean)) {
      firstInningRows.set(key, {
        date: currentDate,
        tier: first.tier,
        qualified: first.qualified === true,
        tracking: rowForFirstInning(game, first),
      })
    }
  }

  const moneylineValues = [...moneylineRows.values()]
  const totalValues = [...totalRows.values()]
  const firstInningValues = [...firstInningRows.values()]
  const settledDates = new Set(
    [...moneylineValues, ...totalValues, ...firstInningValues]
      .filter((row) => row.date && row.tracking.outcome)
      .map((row) => row.date),
  )

  return {
    anyLive: (games || []).some((game) => game?.isLive === true && game?.isFinal !== true),
    windowDays,
    windowStart: dates[0] || asOfDate,
    windowEnd: dates.at(-1) || asOfDate,
    settledDays: settledDates.size,
    moneyline: {
      ...splitRows(
        moneylineValues,
        (row) => ACTIONABLE_MARKET_TIERS.has(row.tier),
        (row) => row.tier === 'pass',
      ),
      actionLabel: 'PLAY + LEAN',
      diagnosticLabel: 'PASS',
    },
    total: {
      ...splitRows(
        totalValues,
        (row) => ACTIONABLE_MARKET_TIERS.has(row.tier),
        (row) => row.tier === 'pass',
      ),
      actionLabel: 'PLAY + LEAN',
      diagnosticLabel: 'PASS',
    },
    firstInning: {
      ...splitRows(
        firstInningValues,
        (row) => row.qualified,
        (row) => row.tier === 'watch',
      ),
      actionLabel: 'STRONG + LEAN',
      diagnosticLabel: 'WATCH',
    },
  }
}
