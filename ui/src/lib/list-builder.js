import { pitchMixScore, hrSetup } from './scout.js'
import {
  blastRate,
  positiveReasonCount,
  negativeReasonCount,
  recentBarrelOf,
  isBenched,
} from './combo-engine.js'

export const LIST_BUILDER_SIGNALS = Object.freeze([
  { key: 'precision', label: 'Precision' },
  { key: 'sleeper', label: 'Sleeper' },
  { key: 'hot', label: 'Hot Bat' },
  { key: 'barrelKing', label: 'Barrel King' },
  { key: 'blast', label: 'Blast' },
  { key: 'pitchEdge', label: 'Pitch Edge' },
  { key: 'pitchMixEdge', label: 'Pitch Mix Edge' },
  { key: 'zoneEdge', label: 'Zone Match' },
  { key: 'hrPlatoonEdge', label: 'Platoon Edge' },
  { key: 'wxEdge', label: 'Weather Boost' },
  { key: 'homeEdge', label: 'Home Edge' },
  { key: 'awayEdge', label: 'Away Edge' },
])

export const LIST_BUILDER_SORTS = Object.freeze([
  { key: 'hrProbability', label: 'HR probability' },
  { key: 'score', label: 'Model score' },
  { key: 'barrel', label: 'Barrel rate' },
  { key: 'matchup', label: 'Matchup HR/9' },
  { key: 'heat', label: 'Heat' },
])

export function createListBuilderCriteria(overrides = {}) {
  return {
    minOppHr9: '', minPitchMix: '', minParkFactor: '',
    minExitVelo: '', minBarrel: '', minHardHit: '', minBlast: '',
    minLaunchAngle: '', maxLaunchAngle: '', minPullPct: '',
    minScore: '', minHeat: '', minHrProb: '', minRecBarrel: '',
    minHrDue: '', minPositives: '', maxNegatives: '',
    signals: [], signalMode: 'all',
    pregameOnly: true, confirmedOnly: false, trustedOnly: false,
    sort: 'hrProbability',
    ...overrides,
    signals: [...new Set(overrides.signals instanceof Set ? [...overrides.signals] : (overrides.signals || []))],
  }
}

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const number = (value) => finite(value) ? Number(value) : null
const fmt = (value, digits = 1) => Number(value).toFixed(digits).replace(/\.0$/, '')

export const effectiveOppHr9 = (batter) => Number.isFinite(batter?.effectiveHR9)
  ? batter.effectiveHR9
  : Number.isFinite(batter?.pitcher?.season?.hrPer9) ? batter.pitcher.season.hrPer9 : null

export function isPregameListCandidate(batter) {
  const game = batter?.game
  if (!game || game.isLive === true || game.isFinal === true) return false
  return !/postponed|cancelled|canceled|suspended|final|in progress/i.test(String(game.status || ''))
}

const metricDefinitions = Object.freeze([
  { field: 'minOppHr9', label: 'Exposure HR/9', mode: 'min', get: effectiveOppHr9, fmt: (v) => fmt(v, 2) },
  { field: 'minPitchMix', label: 'Pitch mix', mode: 'min', get: pitchMixScore, fmt: (v) => fmt(v, 1) },
  { field: 'minParkFactor', label: 'Park factor', mode: 'min', get: (b) => b.gameParkHRFactor, fmt: (v) => fmt(v, 2) },
  { field: 'minExitVelo', label: 'Exit velocity', mode: 'min', get: (b) => b.exitVelo, fmt: (v) => `${fmt(v, 1)} mph` },
  { field: 'minBarrel', label: 'Barrel rate', mode: 'min', get: (b) => Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct, fmt: (v) => `${fmt(v, 1)}%` },
  { field: 'minHardHit', label: 'Hard-hit rate', mode: 'min', get: (b) => b.hardHitPct, fmt: (v) => `${fmt(v, 1)}%` },
  { field: 'minBlast', label: 'Blast rate', mode: 'min', get: blastRate, fmt: (v) => `${fmt(v, 1)}%` },
  { field: 'minLaunchAngle', label: 'Launch angle floor', mode: 'min', get: (b) => b.launchAngle, fmt: (v) => `${fmt(v, 1)}°` },
  { field: 'maxLaunchAngle', label: 'Launch angle ceiling', mode: 'max', get: (b) => b.launchAngle, fmt: (v) => `${fmt(v, 1)}°` },
  { field: 'minPullPct', label: 'Pull rate', mode: 'min', get: (b) => b.pullPct, fmt: (v) => `${fmt(v, 1)}%` },
  { field: 'minScore', label: 'Model score', mode: 'min', get: (b) => b.score, fmt: (v) => fmt(v, 0) },
  { field: 'minHeat', label: 'Heat index', mode: 'min', get: (b) => b.heatIndex, fmt: (v) => fmt(v, 0) },
  { field: 'minHrProb', label: 'HR probability', mode: 'min', get: (b) => Number.isFinite(b.hrProbability) ? b.hrProbability * 100 : null, fmt: (v) => `${fmt(v, 1)}%` },
  { field: 'minRecBarrel', label: 'Recent barrel rate', mode: 'min', get: recentBarrelOf, fmt: (v) => `${fmt(v, 1)}%` },
  { field: 'minHrDue', label: 'HR setup', mode: 'min', get: (b) => hrSetup(b).n, fmt: (v) => `${fmt(v, 0)}/6` },
  { field: 'minPositives', label: 'Positive trends', mode: 'min', get: positiveReasonCount, fmt: (v) => fmt(v, 0) },
  { field: 'maxNegatives', label: 'Negative trends', mode: 'max', get: negativeReasonCount, fmt: (v) => fmt(v, 0) },
])

export function activeListBuilderCriteria(rawCriteria) {
  const criteria = createListBuilderCriteria(rawCriteria)
  const active = metricDefinitions
    .filter((definition) => number(criteria[definition.field]) !== null)
    .map((definition) => ({ type: 'metric', key: definition.field, label: definition.label, mode: definition.mode, threshold: number(criteria[definition.field]) }))
  for (const key of criteria.signals) {
    const signal = LIST_BUILDER_SIGNALS.find((item) => item.key === key)
    if (signal) active.push({ type: 'signal', key, label: signal.label })
  }
  if (criteria.pregameOnly) active.push({ type: 'state', key: 'pregameOnly', label: 'Pregame only' })
  if (criteria.confirmedOnly) active.push({ type: 'state', key: 'confirmedOnly', label: 'Confirmed lineup' })
  if (criteria.trustedOnly) active.push({ type: 'state', key: 'trustedOnly', label: 'No data warnings' })
  return active
}

export function evaluateListBuilderBatter(batter, rawCriteria = {}) {
  const criteria = createListBuilderCriteria(rawCriteria)
  const passed = []
  const failed = []
  const missing = []

  if (criteria.pregameOnly && !isPregameListCandidate(batter)) failed.push({ key: 'pregameOnly', label: 'Game is not actionable pregame' })
  if (criteria.confirmedOnly && (batter?.lineupConfirmed !== true || isBenched(batter))) failed.push({ key: 'confirmedOnly', label: 'Not in a confirmed lineup' })
  if (criteria.trustedOnly && batter?.dataTrust?.status) failed.push({ key: 'trustedOnly', label: 'Data health review required' })

  for (const definition of metricDefinitions) {
    const threshold = number(criteria[definition.field])
    if (threshold === null) continue
    const value = definition.get(batter)
    if (!Number.isFinite(value)) {
      missing.push({ key: definition.field, label: definition.label })
      failed.push({ key: definition.field, label: `${definition.label} unavailable`, missing: true })
      continue
    }
    const qualifies = definition.mode === 'max' ? value <= threshold : value >= threshold
    const detail = `${definition.label} ${definition.fmt(value)} ${qualifies ? 'clears' : 'misses'} ${definition.mode === 'max' ? '≤' : '≥'} ${definition.fmt(threshold)}`
    ;(qualifies ? passed : failed).push({ key: definition.field, label: definition.label, detail, value, threshold })
  }

  const signalChecks = criteria.signals.map((key) => ({ key, label: LIST_BUILDER_SIGNALS.find((item) => item.key === key)?.label || key, value: batter?.[key] === true }))
  if (signalChecks.length) {
    const signalsPass = criteria.signalMode === 'any' ? signalChecks.some((item) => item.value) : signalChecks.every((item) => item.value)
    if (!signalsPass) failed.push({ key: 'signals', label: criteria.signalMode === 'any' ? 'No selected signal matched' : 'Not every selected signal matched' })
    for (const signal of signalChecks.filter((item) => item.value)) passed.push({ key: `signal:${signal.key}`, label: signal.label })
  }

  return { matches: failed.length === 0, passed, failed, missing }
}

function sortValue(batter, sort) {
  if (sort === 'barrel') return Number.isFinite(batter?.barrelPctBBE) ? batter.barrelPctBBE : batter?.barrelPct
  if (sort === 'matchup') return effectiveOppHr9(batter)
  if (sort === 'heat') return batter?.heatIndex
  return batter?.[sort]
}

export function buildListBuilderResults(batters = [], rawCriteria = {}) {
  const criteria = createListBuilderCriteria(rawCriteria)
  const evaluated = (batters || []).map((batter) => ({ batter, evaluation: evaluateListBuilderBatter(batter, criteria) }))
  const results = evaluated.filter((item) => item.evaluation.matches).sort((left, right) => {
    const a = sortValue(left.batter, criteria.sort)
    const b = sortValue(right.batter, criteria.sort)
    if (Number.isFinite(a) !== Number.isFinite(b)) return Number.isFinite(a) ? -1 : 1
    return (Number(b) || 0) - (Number(a) || 0) || (right.batter.score ?? 0) - (left.batter.score ?? 0) || String(left.batter.name || '').localeCompare(String(right.batter.name || ''))
  })
  const active = activeListBuilderCriteria(criteria)
  const coverage = Object.fromEntries(active.filter((item) => item.type === 'metric').map((item) => {
    const definition = metricDefinitions.find((candidate) => candidate.field === item.key)
    const available = definition ? (batters || []).filter((batter) => Number.isFinite(definition.get(batter))).length : 0
    return [item.key, { available, total: batters.length }]
  }))
  return { criteria, active, results, evaluated, coverage }
}
