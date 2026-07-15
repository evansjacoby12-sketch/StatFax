import {
  evaluateListBuilderBatter,
  isPregameListCandidate,
  sanitizeListBuilderCriteria,
} from './list-builder.js'
import {
  evaluateListBuilderHistoryRecord,
  listBuilderHistoryRows,
  mergeListBuilderHistory,
} from './list-builder-history.js'

export const LIST_BUILDER_TRACKING_VERSION = 1
export const LIST_BUILDER_TRACKING_LIMIT = 5000

const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
const cleanText = (value, max = 80) => String(value || '').trim().slice(0, max)
const numericId = (value) => Number.isFinite(Number(value)) ? Number(value) : null

function orderedCriteria(criteria) {
  const clean = sanitizeListBuilderCriteria(criteria)
  const ordered = {}
  for (const key of Object.keys(clean).sort()) {
    if (key === 'sort') continue // Sort order does not change who the recipe selects.
    ordered[key] = Array.isArray(clean[key]) ? [...clean[key]].sort() : clean[key]
  }
  return ordered
}

export function listBuilderCriteriaSignature(criteria) {
  const text = JSON.stringify(orderedCriteria(criteria))
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `lb-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function validPick(raw) {
  if (!raw || typeof raw !== 'object') return null
  const playerId = numericId(raw.playerId)
  const gamePk = numericId(raw.gamePk)
  if (!cleanText(raw.recipeId, 100) || !validDate(raw.date) || playerId == null || gamePk == null) return null
  const status = ['pending', 'hit', 'miss', 'scratch'].includes(raw.status) ? raw.status : 'pending'
  return {
    id: cleanText(raw.id, 220) || `${raw.recipeId}:${raw.date}:${gamePk}:${playerId}`,
    recipeId: cleanText(raw.recipeId, 100),
    recipeName: cleanText(raw.recipeName, 40),
    recipeVersion: Math.max(1, Math.floor(Number(raw.recipeVersion) || 1)),
    criteriaSignature: cleanText(raw.criteriaSignature, 32),
    date: raw.date,
    playerId,
    gamePk,
    name: cleanText(raw.name, 80),
    team: cleanText(raw.team, 12),
    projection: Number.isFinite(Number(raw.projection)) ? Math.max(0, Math.min(1, Number(raw.projection))) : null,
    market: raw.market && Number.isFinite(Number(raw.market.decimal))
      ? {
          book: cleanText(raw.market.book, 30),
          american: Number.isFinite(Number(raw.market.american)) ? Number(raw.market.american) : null,
          decimal: Number(raw.market.decimal),
        }
      : null,
    capturedAt: Number.isFinite(Date.parse(raw.capturedAt)) ? raw.capturedAt : `${raw.date}T12:00:00.000Z`,
    status,
    settledAt: validDate(raw.settledAt) ? raw.settledAt : null,
  }
}

export function normalizeListBuilderTrackingLedger(raw = {}) {
  const source = Array.isArray(raw) ? { picks: raw } : (raw && typeof raw === 'object' ? raw : {})
  const deduped = new Map()
  for (const item of source.picks || []) {
    const pick = validPick(item)
    if (pick) deduped.set(pick.id, pick)
  }
  const picks = [...deduped.values()]
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id))
    .slice(-LIST_BUILDER_TRACKING_LIMIT)
  return {
    version: LIST_BUILDER_TRACKING_VERSION,
    picks,
    dropped: Math.max(0, Math.floor(Number(source.dropped) || 0)),
  }
}

function pickId(recipe, signature, date, gamePk, playerId) {
  return `${cleanText(recipe.id, 100)}:${signature}:${date}:${gamePk}:${playerId}`
}

export function captureListBuilderRecipePicks({
  ledger = {}, recipes = [], batters = [], slateDate, capturedAt = new Date().toISOString(),
} = {}) {
  const current = normalizeListBuilderTrackingLedger(ledger)
  if (!validDate(slateDate) || !Array.isArray(recipes) || !recipes.length) return current
  const byId = new Map(current.picks.map((pick) => [pick.id, pick]))

  for (const recipe of recipes) {
    if (!recipe?.id || !recipe?.criteria) continue
    const criteria = sanitizeListBuilderCriteria({ ...recipe.criteria, pregameOnly: true })
    const signature = listBuilderCriteriaSignature(criteria)
    for (const batter of batters || []) {
      const playerId = numericId(batter?.playerId)
      const gamePk = numericId(batter?.gamePk ?? batter?.game?.gamePk)
      if (playerId == null || gamePk == null || !isPregameListCandidate(batter)) continue
      if (!evaluateListBuilderBatter(batter, criteria).matches) continue
      const id = pickId(recipe, signature, slateDate, gamePk, playerId)
      if (byId.has(id)) continue // A frozen pick is never rewritten on refresh.
      byId.set(id, {
        id,
        recipeId: cleanText(recipe.id, 100),
        recipeName: cleanText(recipe.name, 40),
        recipeVersion: Math.max(1, Math.floor(Number(recipe.version) || 1)),
        criteriaSignature: signature,
        date: slateDate,
        playerId,
        gamePk,
        name: cleanText(batter.name, 80),
        team: cleanText(batter.team, 12),
        projection: Number.isFinite(batter.hrProbability) ? Math.max(0, Math.min(1, batter.hrProbability)) : null,
        market: Number.isFinite(batter?.odds?.best?.decimal)
          ? {
              book: cleanText(batter.odds.best.book, 30),
              american: Number.isFinite(batter.odds.best.american) ? batter.odds.best.american : null,
              decimal: batter.odds.best.decimal,
            }
          : null,
        capturedAt,
        status: 'pending',
        settledAt: null,
      })
    }
  }

  const all = [...byId.values()]
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id))
  const overflow = Math.max(0, all.length - LIST_BUILDER_TRACKING_LIMIT)
  return {
    version: LIST_BUILDER_TRACKING_VERSION,
    picks: all.slice(-LIST_BUILDER_TRACKING_LIMIT),
    dropped: current.dropped + overflow,
  }
}

function outcomeKey(date, gamePk, playerId) {
  return `${date}:${Number(gamePk)}:${Number(playerId)}`
}

export function settleListBuilderRecipePicks(ledger = {}, backtestLog = {}) {
  const current = normalizeListBuilderTrackingLedger(ledger)
  const history = mergeListBuilderHistory(backtestLog)
  const outcomes = new Map()
  for (const date of history.dates) {
    for (const record of history.records[date] || []) {
      const playerId = numericId(record?.playerId)
      const gamePk = numericId(record?.gamePk)
      if (playerId == null || gamePk == null) continue
      outcomes.set(outcomeKey(date, gamePk, playerId), record)
    }
  }
  return {
    ...current,
    picks: current.picks.map((pick) => {
      const outcome = outcomes.get(outcomeKey(pick.date, pick.gamePk, pick.playerId))
      if (!outcome) return pick
      if (outcome.actuallyPlayed === false) return { ...pick, status: 'scratch', settledAt: pick.date }
      if (typeof outcome.homered !== 'boolean') return pick
      return { ...pick, status: outcome.homered ? 'hit' : 'miss', settledAt: pick.date }
    }),
  }
}

function historyPickKey({ date, record }) {
  return outcomeKey(date, record?.gamePk ?? 'na', record?.playerId ?? 'na')
}

function rate(hits, sample) {
  return sample ? hits / sample * 100 : null
}

function calibration(rows, probabilityOf, outcomeOf) {
  const usable = rows.filter((row) => Number.isFinite(probabilityOf(row)) && typeof outcomeOf(row) === 'boolean')
  if (!usable.length) return { sample: 0, hits: 0, observedRate: null, meanProjection: null, delta: null, brier: null }
  const hits = usable.filter((row) => outcomeOf(row)).length
  const mean = usable.reduce((sum, row) => sum + probabilityOf(row), 0) / usable.length
  const brier = usable.reduce((sum, row) => sum + (probabilityOf(row) - (outcomeOf(row) ? 1 : 0)) ** 2, 0) / usable.length
  const observed = hits / usable.length
  return {
    sample: usable.length,
    hits,
    observedRate: round(observed * 100),
    meanProjection: round(mean * 100),
    delta: round((observed - mean) * 100),
    brier: round(brier, 4),
  }
}

function coldStreak(rows, outcomeOf) {
  let misses = 0
  for (const row of [...rows].reverse()) {
    if (outcomeOf(row)) break
    misses++
  }
  return misses
}

function dailyBaselines(rows) {
  const dates = new Map()
  for (const item of rows) {
    const current = dates.get(item.date) || { sample: 0, hits: 0 }
    current.sample++
    if (item.record.homered) current.hits++
    dates.set(item.date, current)
  }
  return new Map([...dates].map(([date, value]) => [date, { ...value, hitRate: rate(value.hits, value.sample) }]))
}

export function buildHistoricalListBuilderRecipeMetrics(rows = [], criteria = {}) {
  let evaluable = 0
  const missingByGate = {}
  const matched = []
  for (const item of rows) {
    const evaluation = evaluateListBuilderHistoryRecord(item.record, criteria)
    if (!evaluation.evaluable) {
      for (const key of evaluation.missing) missingByGate[key] = (missingByGate[key] || 0) + 1
      continue
    }
    evaluable++
    if (evaluation.matches) matched.push(item)
  }

  const hits = matched.filter((item) => item.record.homered).length
  const populationHits = rows.filter((item) => item.record.homered).length
  const hitRate = rate(hits, matched.length)
  const baselineRate = rate(populationHits, rows.length)
  const baselineByDate = dailyBaselines(rows)
  const dayMap = new Map()
  for (const item of matched) {
    const day = dayMap.get(item.date) || { date: item.date, sample: 0, hits: 0 }
    day.sample++
    if (item.record.homered) day.hits++
    dayMap.set(item.date, day)
  }
  const dates = [...dayMap.values()].map((day) => {
    const dayRate = rate(day.hits, day.sample)
    const baseline = baselineByDate.get(day.date)?.hitRate ?? null
    return {
      ...day,
      hitRate: round(dayRate),
      baselineRate: round(baseline),
      lift: Number.isFinite(dayRate) && baseline > 0 ? round(dayRate / baseline, 3) : null,
      positiveLift: Number.isFinite(dayRate) && Number.isFinite(baseline) && dayRate > baseline,
    }
  })
  const coverage = rows.length ? evaluable / rows.length : null
  let status = 'collecting'
  if (evaluable > 0 && coverage < 0.8) status = 'limited-coverage'
  else if (matched.length >= 20 && hits >= 3) status = 'tracked'

  return {
    population: rows.length,
    populationHits,
    baselineRate: round(baselineRate),
    evaluable,
    coverage: round(coverage, 4),
    sample: matched.length,
    hits,
    hitRate: round(hitRate),
    lift: Number.isFinite(hitRate) && baselineRate > 0 ? round(hitRate / baselineRate, 3) : null,
    calibration: calibration(matched, (item) => item.record.simHRProb, (item) => item.record.homered),
    positiveLiftDates: dates.filter((day) => day.positiveLift).length,
    settledDates: dates.length,
    coldStreak: coldStreak(matched, (item) => item.record.homered),
    missingByGate,
    status,
    dates: dates.slice(-8).reverse(),
    recentPicks: matched.slice(-8).reverse().map(({ date, record }) => ({
      date,
      playerId: record.playerId ?? null,
      gamePk: record.gamePk ?? null,
      name: cleanText(record.name, 80) || `Player ${record.playerId ?? 'unknown'}`,
      projection: Number.isFinite(record.simHRProb) ? record.simHRProb : null,
      status: record.homered ? 'hit' : 'miss',
    })),
    pickKeys: matched.map(historyPickKey),
  }
}

function buildForwardMetrics(ledger, recipe) {
  // Forward tracking is always pregame-only even when a reusable recipe lets
  // the live results view include started games.
  const signature = listBuilderCriteriaSignature({ ...recipe.criteria, pregameOnly: true })
  const picks = ledger.picks
    .filter((pick) => pick.recipeId === recipe.id && pick.criteriaSignature === signature)
    .sort((left, right) => left.date.localeCompare(right.date) || left.gamePk - right.gamePk || left.playerId - right.playerId)
  const settled = picks.filter((pick) => pick.status === 'hit' || pick.status === 'miss')
  const hits = settled.filter((pick) => pick.status === 'hit').length
  return {
    criteriaSignature: signature,
    sample: settled.length,
    hits,
    hitRate: round(rate(hits, settled.length)),
    pending: picks.filter((pick) => pick.status === 'pending').length,
    scratches: picks.filter((pick) => pick.status === 'scratch').length,
    total: picks.length,
    coldStreak: coldStreak(settled, (pick) => pick.status === 'hit'),
    calibration: calibration(settled, (pick) => pick.projection, (pick) => pick.status === 'hit'),
    recentPicks: picks.slice(-8).reverse(),
    pickKeys: picks.filter((pick) => pick.status !== 'scratch').map((pick) => outcomeKey(pick.date, pick.gamePk, pick.playerId)),
  }
}

function overlapByRecipe(recipes, keySets) {
  const results = {}
  for (const recipe of recipes) {
    const own = keySets.get(recipe.id) || new Set()
    let top = null
    for (const other of recipes) {
      if (other.id === recipe.id) continue
      const theirs = keySets.get(other.id) || new Set()
      let shared = 0
      for (const key of own) if (theirs.has(key)) shared++
      const candidate = {
        recipeId: other.id,
        recipeName: other.name,
        shared,
        rate: own.size ? round(shared / own.size * 100) : null,
      }
      if (!top || candidate.shared > top.shared || (candidate.shared === top.shared && (candidate.rate || 0) > (top.rate || 0))) top = candidate
    }
    results[recipe.id] = top || { recipeId: null, recipeName: null, shared: 0, rate: null }
  }
  return results
}

export function buildListBuilderRecipeTracking({ backtestLog = {}, recipes = [], ledger = {} } = {}) {
  const history = mergeListBuilderHistory(backtestLog)
  const rows = listBuilderHistoryRows(history)
  const cleanLedger = normalizeListBuilderTrackingLedger(ledger)
  const normalizedRecipes = (recipes || []).filter((recipe) => recipe?.id && recipe?.criteria)
  const historical = new Map()
  const forward = new Map()
  for (const recipe of normalizedRecipes) {
    historical.set(recipe.id, buildHistoricalListBuilderRecipeMetrics(rows, recipe.criteria))
    forward.set(recipe.id, buildForwardMetrics(cleanLedger, recipe))
  }
  const historicalOverlap = overlapByRecipe(normalizedRecipes, new Map([...historical].map(([id, value]) => [id, new Set(value.pickKeys)])))
  const forwardOverlap = overlapByRecipe(normalizedRecipes, new Map([...forward].map(([id, value]) => [id, new Set(value.pickKeys)])))

  return {
    version: LIST_BUILDER_TRACKING_VERSION,
    source: {
      firstSettledDate: history.dates[0] || null,
      latestSettledDate: history.dates.at(-1) || null,
      settledDates: history.dates.length,
      population: rows.length,
      droppedForwardPicks: cleanLedger.dropped,
    },
    economics: {
      available: false,
      label: 'Profit unavailable',
      reason: 'Saved recipes do not include a sportsbook, stake, or explicit wager ledger. Positive-lift dates are shown instead.',
    },
    recipes: normalizedRecipes.map((recipe) => ({
      id: recipe.id,
      name: recipe.name,
      version: Math.max(1, Math.floor(Number(recipe.version) || 1)),
      historical: { ...historical.get(recipe.id), overlap: historicalOverlap[recipe.id] },
      forward: { ...forward.get(recipe.id), overlap: forwardOverlap[recipe.id] },
    })),
  }
}
