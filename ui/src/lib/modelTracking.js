const ACTIONABLE_MARKET_TIERS = new Set(['play', 'lean'])
const MARKET_TIERS = new Set(['play', 'lean', 'pass'])
const FIRST_INNING_TIERS = new Set(['strong', 'lean', 'watch'])
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

function gameTeam(team, fallback) {
  return {
    id: team?.id ?? null,
    name: team?.name || fallback,
    abbr: team?.abbr || fallback,
  }
}

function detailIdentity(source, date, key) {
  const away = gameTeam(source?.awayTeam, 'AWAY')
  const home = gameTeam(source?.homeTeam, 'HOME')
  return {
    key,
    gamePk: source?.gamePk ?? null,
    date,
    gameDate: source?.gameDate || (date ? `${date}T12:00:00Z` : null),
    gameNumber: Number.isFinite(source?.gameNumber)
      ? source.gameNumber
      : Number.isFinite(source?.marketTracking?.gameNumber)
        ? source.marketTracking.gameNumber
        : 1,
    doubleHeader: source?.doubleHeader || 'N',
    away,
    home,
    venueName: source?.venueName || null,
  }
}

function detailStatus(game, archived = false) {
  const isFinal = archived || game?.isFinal === true
  const isLive = !isFinal && game?.isLive === true
  return {
    isFinal,
    isLive,
    state: isFinal ? 'settled' : isLive ? 'live' : 'pending',
    label: isFinal ? 'Final' : isLive ? game?.status || 'Live' : game?.status || 'Scheduled',
    currentInning: Number.isFinite(game?.currentInning) ? game.currentInning : null,
    inningHalf: game?.inningHalf || null,
    awayScore: Number.isFinite(game?.awayScore) ? game.awayScore : null,
    homeScore: Number.isFinite(game?.homeScore) ? game.homeScore : null,
  }
}

function detailMarketCall(game, decision, market, tracking = null) {
  const tier = String(decision?.tier || '').toLowerCase()
  const selectedSide = String(decision?.selectedSide || '').toLowerCase()
  const available = MARKET_TIERS.has(tier)
    && (market === 'moneyline'
      ? ['away', 'home'].includes(selectedSide)
      : ['over', 'under'].includes(selectedSide) && finite(decision?.line))
  return {
    available,
    tier: available ? tier : null,
    selectedSide: available ? selectedSide : null,
    selectedTeam: available && market === 'moneyline'
      ? game?.[selectedSide === 'away' ? 'awayTeam' : 'homeTeam'] || decision?.selectedTeam || null
      : null,
    line: market === 'total' && finite(decision?.line) ? decision.line : null,
    american: usableAmerican(decision?.american) ? decision.american : null,
    tracking: available
      ? tracking || rowForMarket(game, decision, market)
      : { outcome: null, american: null, pending: false, liveState: null },
  }
}

function detailFirstInningCall(game, first, tracking = null) {
  const tier = String(first?.tier || '').toLowerCase()
  const lean = String(first?.lean || '').toLowerCase()
  const available = FIRST_INNING_TIERS.has(tier) && ['nrfi', 'yrfi'].includes(lean)
  return {
    available,
    tier: available ? tier : null,
    selectedSide: available ? lean : null,
    tracking: available
      ? tracking || rowForFirstInning(game, first)
      : { outcome: null, american: null, pending: false, liveState: null },
  }
}

function archivedDetail(record, date, key) {
  const identity = detailIdentity(record, date, key)
  const game = {
    ...record,
    awayTeam: identity.away,
    homeTeam: identity.home,
    isFinal: true,
    isLive: false,
    awayScore: record?.actualAwayRuns,
    homeScore: record?.actualHomeRuns,
    awayFirstInningRuns: record?.actualAwayFirstInningRuns,
    homeFirstInningRuns: record?.actualHomeFirstInningRuns,
  }
  const moneyline = record?.marketOutcome?.moneyline || record?.marketDecision?.moneyline
  const total = record?.marketOutcome?.total || record?.marketDecision?.total
  const first = record?.firstInning
  const moneylineOutcome = SETTLED_OUTCOMES.has(record?.marketOutcome?.moneyline?.result)
    ? record.marketOutcome.moneyline.result
    : settledMoneyline(game, moneyline)
  const totalOutcome = SETTLED_OUTCOMES.has(record?.marketOutcome?.total?.result)
    ? record.marketOutcome.total.result
    : settledTotal(game, total)
  const firstOutcome = archivedFirstInningOutcome(record, first)
  return {
    ...identity,
    ...detailStatus(game, true),
    moneyline: detailMarketCall(
      game,
      moneyline,
      'moneyline',
      archivedTracking(moneylineOutcome, moneyline?.american),
    ),
    total: detailMarketCall(
      game,
      total,
      'total',
      archivedTracking(totalOutcome, total?.american),
    ),
    firstInning: detailFirstInningCall(
      game,
      first,
      archivedTracking(firstOutcome),
    ),
  }
}

function currentDetail(game, projection, date, key) {
  const identity = detailIdentity(game, date, key)
  return {
    ...identity,
    ...detailStatus(game),
    moneyline: detailMarketCall(game, projection?.marketDecision?.moneyline, 'moneyline'),
    total: detailMarketCall(game, projection?.marketDecision?.total, 'total'),
    firstInning: detailFirstInningCall(game, projection?.firstInning),
  }
}

function detailSort(a, b) {
  if (a.date !== b.date) return String(b.date || '').localeCompare(String(a.date || ''))
  const time = String(a.gameDate || '').localeCompare(String(b.gameDate || ''))
  if (time) return time
  return Number(a.gamePk || 0) - Number(b.gamePk || 0)
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

function directionalSplit(rows, side, primary, diagnostic) {
  return splitRows(
    rows.filter((row) => row.selectedSide === side),
    primary,
    diagnostic,
  )
}

export function buildModelTracking(games = [], projections = {}, options = {}) {
  const windowDays = Math.max(1, Math.min(7, Math.trunc(options.windowDays) || 1))
  const asOfDate = dateKey(options.asOfDate)
  const dates = rollingDates(asOfDate, windowDays)
  const includedDates = new Set(dates)
  const moneylineRows = new Map()
  const totalRows = new Map()
  const firstInningRows = new Map()
  const detailRows = new Map()

  for (const date of dates) {
    const records = options.resultsByDate?.[date] || []
    for (const [index, record] of records.entries()) {
      const key = String(record?.gamePk ?? `${date}-${index}`)
      detailRows.set(key, archivedDetail(record, date, key))
      const moneyline = record?.marketOutcome?.moneyline
      const total = record?.marketOutcome?.total
      const first = record?.firstInning
      if (moneyline?.tier) {
        moneylineRows.set(key, {
          date,
          tier: moneyline.tier,
          selectedSide: moneyline.selectedSide,
          tracking: archivedTracking(moneyline.result, moneyline.american),
        })
      }
      if (total?.tier) {
        totalRows.set(key, {
          date,
          tier: total.tier,
          selectedSide: total.selectedSide,
          tracking: archivedTracking(total.result, total.american),
        })
      }
      if (first?.tier && ['nrfi', 'yrfi'].includes(first.lean)) {
        firstInningRows.set(key, {
          date,
          tier: first.tier,
          selectedSide: first.lean,
          qualified: first.qualified === true,
          tracking: archivedTracking(archivedFirstInningOutcome(record, first)),
        })
      }
    }
  }

  for (const game of games || []) {
    const projection = projectionForGame(projections, game?.gamePk)
    const key = String(game?.gamePk ?? `current-${detailRows.size}`)
    const currentDate = dateKey(game?.gameDate) || asOfDate
    if (includedDates.size && currentDate && !includedDates.has(currentDate)) continue
    detailRows.set(key, currentDetail(game, projection, currentDate, key))
    const moneyline = projection?.marketDecision?.moneyline
    const total = projection?.marketDecision?.total
    const first = projection?.firstInning
    if (moneyline?.tier) {
      moneylineRows.set(key, {
        date: currentDate,
        tier: moneyline.tier,
        selectedSide: moneyline.selectedSide,
        tracking: rowForMarket(game, moneyline, 'moneyline'),
      })
    }
    if (total?.tier) {
      totalRows.set(key, {
        date: currentDate,
        tier: total.tier,
        selectedSide: total.selectedSide,
        tracking: rowForMarket(game, total, 'total'),
      })
    }
    if (first?.tier && ['nrfi', 'yrfi'].includes(first.lean)) {
      firstInningRows.set(key, {
        date: currentDate,
        tier: first.tier,
        selectedSide: first.lean,
        qualified: first.qualified === true,
        tracking: rowForFirstInning(game, first),
      })
    }
  }

  const moneylineValues = [...moneylineRows.values()]
  const totalValues = [...totalRows.values()]
  const firstInningValues = [...firstInningRows.values()]
  const details = [...detailRows.values()].sort(detailSort)
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
    details,
    detailGames: details.length,
    detailCalls: details.reduce(
      (sum, row) => sum
        + Number(row.moneyline.available)
        + Number(row.total.available)
        + Number(row.firstInning.available),
      0,
    ),
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
      over: directionalSplit(
        totalValues,
        'over',
        (row) => ACTIONABLE_MARKET_TIERS.has(row.tier),
        (row) => row.tier === 'pass',
      ),
      under: directionalSplit(
        totalValues,
        'under',
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
      nrfi: directionalSplit(
        firstInningValues,
        'nrfi',
        (row) => row.qualified,
        (row) => row.tier === 'watch',
      ),
      yrfi: directionalSplit(
        firstInningValues,
        'yrfi',
        (row) => row.qualified,
        (row) => row.tier === 'watch',
      ),
      actionLabel: 'STRONG + LEAN',
      diagnosticLabel: 'WATCH',
    },
  }
}
