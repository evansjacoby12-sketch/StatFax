import {
  activeListBuilderCriteria,
  buildListBuilderResults,
  createListBuilderCriteria,
  relaxListBuilderGate,
} from './list-builder.js'

export const LIST_BUILDER_ANALYST_VERSION = 1

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const round = (value, digits = 2) => finite(value) ? Number(Number(value).toFixed(digits)) : null
const clampCount = (value) => Math.max(0, Math.min(100000, Math.floor(Number(value) || 0)))
const cleanText = (value, max = 160) => String(value || '')
  .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max)

function criterionLabel(criterion) {
  if (criterion?.type !== 'metric') return cleanText(criterion?.label, 80)
  return `${cleanText(criterion.label, 60)} ${criterion.mode === 'max' ? '≤' : '≥'} ${criterion.threshold}`
}

function relaxationId(relaxation) {
  if (!relaxation) return null
  if (relaxation.type === 'metric') return `metric:${relaxation.key}:${Number(relaxation.value)}`
  if (relaxation.type === 'signals') return `signals:${[...(relaxation.signals || [])].sort().join(',') || 'off'}`
  return null
}

function relaxationDistance(failure) {
  if (failure?.type !== 'metric' || !finite(failure.threshold) || !finite(failure.delta)) return 1
  return Math.abs(Number(failure.delta)) / Math.max(Math.abs(Number(failure.threshold)), 1)
}

function safeRelaxations(batters, built, criteria) {
  if (built.results.length > 0) return []
  const grouped = new Map()
  for (const item of built.nearMisses) {
    const failure = item?.evaluation?.failed?.[0]
    const relaxation = failure?.relaxation
    // Actionability and data-trust gates are intentionally never relaxed by AI.
    if (!relaxation || !['metric', 'signals'].includes(relaxation.type)) continue
    const id = relaxationId(relaxation)
    if (!id) continue
    const existing = grouped.get(id)
    if (existing) {
      existing.nearMissCount += 1
      existing.distance = Math.min(existing.distance, relaxationDistance(failure))
      continue
    }
    const relaxedCriteria = relaxListBuilderGate(criteria, failure)
    const relaxed = buildListBuilderResults(batters, relaxedCriteria)
    grouped.set(id, {
      id,
      type: relaxation.type,
      gate: cleanText(failure.label, 80),
      label: cleanText(relaxation.label, 100),
      description: cleanText(relaxation.description, 160),
      newExactCount: relaxed.results.length,
      nearMissCount: 1,
      distance: relaxationDistance(failure),
      criteria: createListBuilderCriteria(relaxedCriteria),
    })
  }
  return [...grouped.values()]
    .filter((candidate) => candidate.newExactCount > 0)
    .sort((left, right) => right.newExactCount - left.newExactCount
      || right.nearMissCount - left.nearMissCount
      || left.distance - right.distance
      || left.id.localeCompare(right.id))
    .slice(0, 6)
}

function blockedGates(built) {
  const grouped = new Map()
  for (const item of built.evaluated) {
    for (const failure of item.evaluation.failed || []) {
      const key = cleanText(failure.key || failure.label, 80)
      const current = grouped.get(key) || {
        key,
        label: cleanText(failure.label, 80),
        type: cleanText(failure.type, 20),
        failures: 0,
        missing: 0,
        relaxable: false,
      }
      current.failures += 1
      if (failure.missing) current.missing += 1
      if (failure.relaxation && ['metric', 'signals'].includes(failure.relaxation.type)) current.relaxable = true
      grouped.set(key, current)
    }
  }
  return [...grouped.values()]
    .sort((left, right) => right.failures - left.failures || right.missing - left.missing || left.label.localeCompare(right.label))
    .slice(0, 8)
}

function strongestSignals(built) {
  const grouped = new Map()
  const candidates = [...built.results, ...built.nearMisses]
  for (const item of candidates) {
    for (const passed of item.evaluation.passed || []) {
      const label = cleanText(passed.label, 80)
      if (!label) continue
      const current = grouped.get(label) || { label, support: 0 }
      current.support += 1
      grouped.set(label, current)
    }
  }
  return [...grouped.values()]
    .sort((left, right) => right.support - left.support || left.label.localeCompare(right.label))
    .slice(0, 6)
}

function coverageSummary(built) {
  const labels = new Map(built.active.map((criterion) => [criterion.key, criterion.label]))
  return Object.entries(built.coverage || {}).map(([key, value]) => ({
    key: cleanText(key, 60),
    label: cleanText(labels.get(key) || key, 80),
    available: clampCount(value?.available),
    total: clampCount(value?.total),
    rate: value?.total ? round(value.available / value.total * 100, 1) : null,
  })).sort((left, right) => (left.rate ?? -1) - (right.rate ?? -1) || left.label.localeCompare(right.label))
}

function recipeSummary(recipe, tracked) {
  const historical = tracked?.historical || {}
  const forward = tracked?.forward || {}
  return {
    id: cleanText(recipe.id, 80),
    name: cleanText(recipe.name, 40),
    version: Math.max(1, Math.floor(Number(recipe.version) || 1)),
    gates: activeListBuilderCriteria(recipe.criteria).length,
    historical: {
      sample: clampCount(historical.sample),
      hits: clampCount(historical.hits),
      hitRate: round(historical.hitRate, 1),
      lift: round(historical.lift, 2),
      coverage: round((historical.coverage ?? 0) * 100, 1),
      positiveLiftDates: clampCount(historical.positiveLiftDates),
      coldStreak: clampCount(historical.coldStreak),
    },
    forward: {
      sample: clampCount(forward.sample),
      hits: clampCount(forward.hits),
      hitRate: round(forward.hitRate, 1),
      pending: clampCount(forward.pending),
    },
  }
}

function activeRecipeSummary(preset, evidence, window) {
  if (!preset) return null
  return {
    id: cleanText(preset.id, 80),
    name: cleanText(preset.title, 80),
    window: cleanText(window, 20),
    status: cleanText(evidence?.status || evidence?.readiness || 'unknown', 40),
    sample: clampCount(evidence?.matches ?? evidence?.sample),
    hitRate: round(evidence?.hitRate, 1),
    lift: round(evidence?.lift, 2),
    coverage: round((evidence?.coverage ?? 0) * 100, 1),
  }
}

function signatureOf(value) {
  const input = JSON.stringify(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `lba-${(hash >>> 0).toString(16)}`
}

export function toListBuilderAnalystRequest(context) {
  const safe = context && typeof context === 'object' ? context : {}
  return {
    version: LIST_BUILDER_ANALYST_VERSION,
    mode: safe.mode === 'empty' ? 'empty' : 'active',
    current: safe.current || {},
    activeRecipe: safe.activeRecipe || null,
    safeRelaxations: (safe.relaxations || []).map(({ criteria: _criteria, distance: _distance, ...candidate }) => candidate),
    selectedRecipes: safe.selectedRecipes || [],
    guardrails: { advisoryOnly: true, projectionsMutable: false },
  }
}

export function buildListBuilderAnalystContext({
  batters = [],
  built: suppliedBuilt = null,
  criteria = {},
  activePreset = null,
  activeEvidence = null,
  evidenceWindow = 'd14',
  savedRecipes = [],
  trackingReport = null,
  compareRecipeIds = [],
} = {}) {
  const built = suppliedBuilt || buildListBuilderResults(batters, criteria)
  const cleanCriteria = createListBuilderCriteria(criteria)
  const trackedById = new Map((trackingReport?.recipes || []).map((recipe) => [String(recipe.id), recipe]))
  const recipeById = new Map((savedRecipes || []).map((recipe) => [String(recipe.id), recipe]))
  const selectedRecipes = [...new Set(compareRecipeIds.map(String))]
    .map((id) => recipeById.get(id))
    .filter(Boolean)
    .slice(0, 2)
    .map((recipe) => recipeSummary(recipe, trackedById.get(String(recipe.id))))

  const context = {
    version: LIST_BUILDER_ANALYST_VERSION,
    mode: built.results.length ? 'active' : 'empty',
    current: {
      slateCount: clampCount(batters.length),
      exactCount: clampCount(built.results.length),
      nearCount: clampCount(built.nearMisses.length),
      activeGateCount: clampCount(built.active.length),
      criteria: built.active.map((criterion) => ({
        key: cleanText(criterion.key, 60),
        type: cleanText(criterion.type, 20),
        label: criterionLabel(criterion),
      })).slice(0, 30),
      coverage: coverageSummary(built),
      blockedGates: blockedGates(built),
      strongestSignals: strongestSignals(built),
    },
    activeRecipe: activeRecipeSummary(activePreset, activeEvidence, evidenceWindow),
    relaxations: safeRelaxations(batters, built, cleanCriteria),
    selectedRecipes,
  }
  const request = toListBuilderAnalystRequest(context)
  return { ...context, signature: signatureOf(request) }
}

export function findListBuilderAnalystRelaxation(context, id) {
  if (!id) return null
  return (context?.relaxations || []).find((candidate) => candidate.id === id) || null
}
