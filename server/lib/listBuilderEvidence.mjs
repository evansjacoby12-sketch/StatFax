import { LIST_BUILDER_PRESETS } from '../../ui/src/lib/list-builder-presets.js'
import {
  evaluateListBuilderHistoryRecord,
  mergeListBuilderHistory,
} from '../../ui/src/lib/list-builder-history.js'

export const LIST_BUILDER_EVIDENCE_VERSION = 1
export const LIST_BUILDER_EVIDENCE_WINDOWS = Object.freeze([
  Object.freeze({ id: 'd14', label: '14 days', days: 14 }),
  Object.freeze({ id: 'd30', label: '30 days', days: 30 }),
  Object.freeze({ id: 'season', label: 'Season', days: null }),
])

const round = (value, digits = 6) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
const dateMs = (value) => Date.parse(`${value}T12:00:00Z`)
const dateMinus = (value, days) => new Date(dateMs(value) - days * 86400000).toISOString().slice(0, 10)

export { mergeListBuilderHistory }

export function wilsonInterval(hits, sample, z = 1.96) {
  if (!Number.isInteger(hits) || !Number.isInteger(sample) || sample <= 0 || hits < 0 || hits > sample) return null
  const p = hits / sample
  const z2 = z * z
  const denominator = 1 + z2 / sample
  const center = (p + z2 / (2 * sample)) / denominator
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * sample)) / sample)) / denominator
  return { low: round(Math.max(0, center - margin) * 100, 2), high: round(Math.min(1, center + margin) * 100, 2) }
}

function rowsForDates(history, dates) {
  return dates.flatMap((date) => (history.records[date] || []).map((record) => ({ date, record })))
    .filter(({ record }) => record?.actuallyPlayed !== false && typeof record?.homered === 'boolean')
}

function scoreRows(rows, criteria) {
  let evaluable = 0
  let matches = 0
  let hits = 0
  const missingByGate = {}
  for (const { record } of rows) {
    const evaluation = evaluateListBuilderHistoryRecord(record, criteria)
    if (!evaluation.evaluable) {
      for (const key of evaluation.missing) missingByGate[key] = (missingByGate[key] || 0) + 1
      continue
    }
    evaluable++
    if (!evaluation.matches) continue
    matches++
    if (record.homered) hits++
  }
  return { evaluable, matches, hits, missingByGate }
}

function segment(rows, criteria) {
  const population = rows.length
  const homers = rows.filter(({ record }) => record.homered).length
  const baselineRate = population ? homers / population * 100 : null
  const scored = scoreRows(rows, criteria)
  const hitRate = scored.matches ? scored.hits / scored.matches * 100 : null
  return {
    population,
    homers,
    baselineRate: round(baselineRate, 2),
    matches: scored.matches,
    hits: scored.hits,
    hitRate: round(hitRate, 2),
    lift: Number.isFinite(hitRate) && baselineRate > 0 ? round(hitRate / baselineRate, 3) : null,
  }
}

function stabilityFor(rows, dates, criteria) {
  if (dates.length < 2) return { status: 'collecting', first: null, second: null }
  const midpoint = Math.ceil(dates.length / 2)
  const firstDates = new Set(dates.slice(0, midpoint))
  const first = segment(rows.filter((item) => firstDates.has(item.date)), criteria)
  const second = segment(rows.filter((item) => !firstDates.has(item.date)), criteria)
  let status = 'collecting'
  if (first.matches >= 20 && second.matches >= 20) {
    if (first.lift >= 1.05 && second.lift >= 1.05) status = 'stable-positive'
    else if (first.lift <= 0.95 && second.lift <= 0.95) status = 'stable-negative'
    else status = 'mixed'
  }
  return { status, first, second }
}

function recipeWindow(history, dates, criteria) {
  const rows = rowsForDates(history, dates)
  const population = rows.length
  const homers = rows.filter(({ record }) => record.homered).length
  const baselineRate = population ? homers / population * 100 : null
  const scored = scoreRows(rows, criteria)
  const hitRate = scored.matches ? scored.hits / scored.matches * 100 : null
  const coverage = population ? scored.evaluable / population : null
  const lift = Number.isFinite(hitRate) && baselineRate > 0 ? hitRate / baselineRate : null
  const stability = stabilityFor(rows, dates, criteria)
  let status = 'collecting'
  if (scored.evaluable > 0 && coverage != null && coverage < 0.8) status = 'limited-coverage'
  else if (scored.matches >= 50 && scored.hits >= 5) {
    status = stability.status === 'stable-positive' ? 'stable-positive'
      : lift >= 1.05 ? 'positive'
        : lift <= 0.95 ? 'negative' : 'neutral'
  }
  return {
    population,
    homers,
    baselineRate: round(baselineRate, 2),
    evaluable: scored.evaluable,
    coverage: round(coverage, 4),
    matches: scored.matches,
    hits: scored.hits,
    hitRate: round(hitRate, 2),
    lift: round(lift, 3),
    confidence95: wilsonInterval(scored.hits, scored.matches),
    missingByGate: scored.missingByGate,
    status,
    stability,
  }
}

function windowDates(history, latestDate, definition) {
  const startDate = definition.days == null
    ? `${latestDate.slice(0, 4)}-01-01`
    : dateMinus(latestDate, definition.days - 1)
  return history.dates.filter((date) => date >= startDate && date <= latestDate)
}

export function buildListBuilderEvidence({ backtestLog = {}, generatedAt = new Date().toISOString() } = {}) {
  const history = mergeListBuilderHistory(backtestLog)
  const latestDate = history.dates.at(-1) || null
  const windows = {}
  const recipes = Object.fromEntries(LIST_BUILDER_PRESETS.map((item) => [item.id, {
    id: item.id,
    title: item.title,
    windows: {},
  }]))

  for (const definition of LIST_BUILDER_EVIDENCE_WINDOWS) {
    const dates = latestDate ? windowDates(history, latestDate, definition) : []
    const rows = rowsForDates(history, dates)
    const homers = rows.filter(({ record }) => record.homered).length
    windows[definition.id] = {
      id: definition.id,
      label: definition.label,
      startDate: dates[0] || null,
      endDate: dates.at(-1) || null,
      settledSlates: dates.length,
      population: rows.length,
      homers,
      baselineRate: rows.length ? round(homers / rows.length * 100, 2) : null,
    }
    for (const preset of LIST_BUILDER_PRESETS) {
      recipes[preset.id].windows[definition.id] = recipeWindow(history, dates, preset.criteria)
    }
  }

  return {
    version: LIST_BUILDER_EVIDENCE_VERSION,
    generatedAt,
    source: {
      name: 'backtest-log.json',
      firstSettledDate: history.dates[0] || null,
      latestSettledDate: latestDate,
      historyDates: history.dates.length,
      excludesScratches: true,
      probabilityField: 'simHRProb',
    },
    windows,
    recipes,
  }
}

function sameNumber(actual, expected, tolerance = 1e-6) {
  return actual == null && expected == null
    ? true
    : Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance
}

export function validateListBuilderEvidence(artifact) {
  const errors = []
  const warnings = []
  if (!artifact || typeof artifact !== 'object') return { ok: false, errors: ['artifact: expected object'], warnings, metrics: {} }
  if (artifact.version !== LIST_BUILDER_EVIDENCE_VERSION) errors.push(`version: expected ${LIST_BUILDER_EVIDENCE_VERSION}`)
  if (!Number.isFinite(Date.parse(artifact.generatedAt))) errors.push('generatedAt: expected ISO timestamp')
  const expectedRecipeIds = LIST_BUILDER_PRESETS.map((item) => item.id).sort()
  const actualRecipeIds = Object.keys(artifact.recipes || {}).sort()
  if (JSON.stringify(actualRecipeIds) !== JSON.stringify(expectedRecipeIds)) errors.push('recipes: IDs do not match the built-in recipe contract')

  for (const definition of LIST_BUILDER_EVIDENCE_WINDOWS) {
    const window = artifact.windows?.[definition.id]
    if (!window) {
      errors.push(`windows.${definition.id}: missing`)
      continue
    }
    if (!Number.isInteger(window.population) || window.population < 0) errors.push(`windows.${definition.id}.population: invalid`)
    if (!Number.isInteger(window.homers) || window.homers < 0 || window.homers > window.population) errors.push(`windows.${definition.id}.homers: invalid`)
    const expectedBaseline = window.population ? round(window.homers / window.population * 100, 2) : null
    if (!sameNumber(window.baselineRate, expectedBaseline)) errors.push(`windows.${definition.id}.baselineRate: does not reconcile`)

    for (const preset of LIST_BUILDER_PRESETS) {
      const at = `recipes.${preset.id}.windows.${definition.id}`
      const metric = artifact.recipes?.[preset.id]?.windows?.[definition.id]
      if (!metric) {
        errors.push(`${at}: missing`)
        continue
      }
      for (const key of ['population', 'homers', 'evaluable', 'matches', 'hits']) {
        if (!Number.isInteger(metric[key]) || metric[key] < 0) errors.push(`${at}.${key}: invalid`)
      }
      if (metric.population !== window.population || metric.homers !== window.homers) errors.push(`${at}: population does not match window`)
      if (metric.evaluable > metric.population || metric.matches > metric.evaluable || metric.hits > metric.matches) errors.push(`${at}: counts are inconsistent`)
      const expectedCoverage = metric.population ? round(metric.evaluable / metric.population, 4) : null
      const expectedHitRate = metric.matches ? round(metric.hits / metric.matches * 100, 2) : null
      const expectedLift = metric.matches && window.homers > 0
        ? round((metric.hits / metric.matches) / (window.homers / window.population), 3)
        : null
      if (!sameNumber(metric.coverage, expectedCoverage)) errors.push(`${at}.coverage: does not reconcile`)
      if (!sameNumber(metric.hitRate, expectedHitRate)) errors.push(`${at}.hitRate: does not reconcile`)
      if (!sameNumber(metric.lift, expectedLift, 0.001)) errors.push(`${at}.lift: does not reconcile`)
      const expectedInterval = wilsonInterval(metric.hits, metric.matches)
      if (JSON.stringify(metric.confidence95) !== JSON.stringify(expectedInterval)) errors.push(`${at}.confidence95: does not reconcile`)
    }
  }

  const latest = artifact.source?.latestSettledDate
  if (latest && !isDate(latest)) errors.push('source.latestSettledDate: invalid')
  if (!latest) warnings.push('source: no settled history available')
  const metrics = {
    recipes: actualRecipeIds.length,
    historyDates: artifact.source?.historyDates || 0,
    latestSettledDate: latest || null,
    d14Population: artifact.windows?.d14?.population || 0,
  }
  return { ok: errors.length === 0, errors, warnings, metrics }
}
