export const MLB_GAME_MARKET_TRACKING_VERSION = 1
export const MLB_GAME_MARKET_TRACKING_DAYS = 180

const round = (value, digits = 4) => {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

const validIso = (value) => (
  typeof value === 'string' && !Number.isNaN(Date.parse(value))
)

function latestIso(values) {
  return values
    .filter(validIso)
    .sort()
    .at(-1) || null
}

export function gameMarketSnapshot(market, capturedAt = new Date().toISOString()) {
  const consensus = market?.consensus
  const moneyline = consensus?.moneyline
    ? {
        books: Number.isInteger(consensus.moneyline.books) ? consensus.moneyline.books : 0,
        awayAmerican: Number.isFinite(consensus.moneyline.away?.american)
          ? consensus.moneyline.away.american
          : null,
        homeAmerican: Number.isFinite(consensus.moneyline.home?.american)
          ? consensus.moneyline.home.american
          : null,
        awayFairProbability: round(consensus.moneyline.away?.fairProbability),
        homeFairProbability: round(consensus.moneyline.home?.fairProbability),
      }
    : null
  const total = consensus?.total
    ? {
        books: Number.isInteger(consensus.total.books) ? consensus.total.books : 0,
        line: round(consensus.total.line, 2),
        overAmerican: Number.isFinite(consensus.total.over?.american)
          ? consensus.total.over.american
          : null,
        underAmerican: Number.isFinite(consensus.total.under?.american)
          ? consensus.total.under.american
          : null,
        overFairProbability: round(consensus.total.over?.fairProbability),
        underFairProbability: round(consensus.total.under?.fairProbability),
      }
    : null
  if (!moneyline && !total) return null
  return {
    capturedAt,
    sourceUpdatedAt: latestIso(
      Object.values(market?.books || {}).map((book) => book?.updatedAt),
    ),
    moneyline,
    total,
  }
}

function snapshotFingerprint(snapshot) {
  if (!snapshot) return null
  return JSON.stringify({
    moneyline: snapshot.moneyline,
    total: snapshot.total,
  })
}

function openingWithFirstAvailable(opening, snapshot) {
  if (!opening) return snapshot
  return {
    ...opening,
    moneyline: opening.moneyline || snapshot?.moneyline || null,
    total: opening.total || snapshot?.total || null,
  }
}

export function gameMarketMovement(opening, current) {
  const moneylineHomeProbability = (
    Number.isFinite(opening?.moneyline?.homeFairProbability)
    && Number.isFinite(current?.moneyline?.homeFairProbability)
  )
    ? round(
        current.moneyline.homeFairProbability - opening.moneyline.homeFairProbability,
        4,
      )
    : null
  const moneylineHomePrice = (
    Number.isFinite(opening?.moneyline?.homeAmerican)
    && Number.isFinite(current?.moneyline?.homeAmerican)
  )
    ? current.moneyline.homeAmerican - opening.moneyline.homeAmerican
    : null
  const totalLine = (
    Number.isFinite(opening?.total?.line)
    && Number.isFinite(current?.total?.line)
  )
    ? round(current.total.line - opening.total.line, 2)
    : null
  const overPrice = (
    Number.isFinite(opening?.total?.overAmerican)
    && Number.isFinite(current?.total?.overAmerican)
  )
    ? current.total.overAmerican - opening.total.overAmerican
    : null
  const changed = []
  if (Math.abs(moneylineHomeProbability || 0) >= 0.025) changed.push('moneyline-probability')
  if (Math.abs(moneylineHomePrice || 0) >= 15) changed.push('moneyline-price')
  if (Math.abs(totalLine || 0) >= 0.5) changed.push('total-line')
  if (Math.abs(overPrice || 0) >= 15) changed.push('total-price')
  return {
    moneylineHomeProbability,
    moneylineHomePrice,
    totalLine,
    overPrice,
    material: changed.length > 0,
    changed,
  }
}

function marketIdentity(game) {
  return {
    gamePk: game.gamePk,
    gameDate: game.gameDate,
    awayTeamId: game.awayTeam?.id ?? null,
    homeTeamId: game.homeTeam?.id ?? null,
    gameNumber: game.gameNumber ?? 1,
  }
}

export function updateGameMarketHistory(
  log = {},
  date,
  markets = {},
  games = [],
  { capturedAt = new Date().toISOString() } = {},
) {
  const priorHistory = log?.gameMarketHistory || {}
  const byDate = { ...(priorHistory.byDate || {}) }
  const priorDay = byDate[date] && typeof byDate[date] === 'object'
    ? byDate[date]
    : {}
  const nextDay = { ...priorDay }
  const currentByGame = {}

  for (const game of games || []) {
    const gamePk = Number(game?.gamePk)
    if (!Number.isFinite(gamePk)) continue
    const key = String(gamePk)
    const prior = priorDay[key]
    const snapshot = gameMarketSnapshot(markets?.[gamePk] || markets?.[key], capturedAt)
    const started = game.isLive === true || game.isFinal === true

    if (!prior && !snapshot) continue
    if (!prior) {
      const created = {
        ...marketIdentity(game),
        status: started ? 'frozen' : 'pregame',
        opening: snapshot,
        current: snapshot,
        closing: started ? snapshot : null,
        firstCapturedAt: capturedAt,
        lastObservedAt: capturedAt,
        lastChangedAt: capturedAt,
        closedAt: started ? capturedAt : null,
        observationCount: 1,
        revisionCount: 1,
        movement: gameMarketMovement(snapshot, snapshot),
      }
      nextDay[key] = created
      currentByGame[gamePk] = created
      continue
    }

    const observed = snapshot || prior.current
    const changed = (
      snapshot
      && snapshotFingerprint(snapshot) !== snapshotFingerprint(prior.current)
    )
    const opening = snapshot
      ? openingWithFirstAvailable(prior.opening, snapshot)
      : prior.opening
    const current = started ? prior.current : observed
    const closing = started ? (prior.closing || prior.current) : null
    const updated = {
      ...prior,
      ...marketIdentity(game),
      status: started ? 'frozen' : 'pregame',
      opening,
      current,
      closing,
      lastObservedAt: capturedAt,
      lastChangedAt: !started && changed ? capturedAt : prior.lastChangedAt,
      closedAt: started ? (prior.closedAt || capturedAt) : null,
      observationCount: (prior.observationCount || 0) + 1,
      revisionCount: (prior.revisionCount || 1) + (!started && changed ? 1 : 0),
      movement: gameMarketMovement(opening, current),
    }
    nextDay[key] = updated
    currentByGame[gamePk] = updated
  }

  byDate[date] = nextDay
  for (const key of Object.keys(byDate).sort().slice(0, -MLB_GAME_MARKET_TRACKING_DAYS)) {
    delete byDate[key]
  }
  return {
    log: {
      ...(log || {}),
      gameMarketHistory: {
        version: MLB_GAME_MARKET_TRACKING_VERSION,
        byDate,
      },
    },
    currentByGame,
  }
}
