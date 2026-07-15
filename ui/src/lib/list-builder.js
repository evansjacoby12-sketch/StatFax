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

export const LIST_BUILDER_LIMITS = Object.freeze({
  minOppHr9: [0, 4], minPitchMix: [0, 10], minParkFactor: [0.5, 1.6],
  minRecentPitcherHr9: [0, 6], maxPitcherK9: [0, 20], minContactCollision: [-10, 10],
  maxBattingOrder: [1, 9], minISO: [0, 0.6],
  minExitVelo: [70, 105], minBarrel: [0, 35], minHardHit: [0, 80], minBlast: [0, 60],
  minLaunchAngle: [-10, 45], maxLaunchAngle: [0, 55], minPullPct: [0, 100],
  minScore: [0, 100], minHeat: [0, 100], minHrProb: [0, 50], minRecBarrel: [0, 45],
  minHrDue: [0, 6], minPositives: [0, 15], maxNegatives: [0, 10],
})

export function createListBuilderCriteria(overrides = {}) {
  return {
    minOppHr9: '', minPitchMix: '', minParkFactor: '',
    minRecentPitcherHr9: '', maxPitcherK9: '', minContactCollision: '', maxBattingOrder: '', minISO: '',
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
const clamp01 = (value) => Math.max(0, Math.min(1, value))
const relaxationPrecision = Object.freeze({
  minOppHr9: 2, minPitchMix: 1, minParkFactor: 2,
  minRecentPitcherHr9: 2, maxPitcherK9: 1, minContactCollision: 1, maxBattingOrder: 0, minISO: 3,
  minExitVelo: 1, minBarrel: 1, minHardHit: 1, minBlast: 1,
  minLaunchAngle: 1, maxLaunchAngle: 1, minPullPct: 1,
  minScore: 0, minHeat: 0, minHrProb: 1, minRecBarrel: 1,
  minHrDue: 0, minPositives: 0, maxNegatives: 0,
})

function safeRelaxationValue(definition, value) {
  const scale = 10 ** (relaxationPrecision[definition.field] ?? 2)
  return (definition.mode === 'max' ? Math.ceil((value * scale) - 1e-9) : Math.floor((value * scale) + 1e-9)) / scale
}

// Trust boundary for saved/browser/AI criteria. Internal form state may contain
// strings while a person is typing; external criteria are reduced to the known
// contract and bounded before the deterministic engine receives them.
export function sanitizeListBuilderCriteria(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const clean = createListBuilderCriteria()
  for (const [key, [min, max]] of Object.entries(LIST_BUILDER_LIMITS)) {
    if (!finite(source[key])) continue
    clean[key] = Math.min(max, Math.max(min, Number(source[key])))
  }
  clean.signals = [...new Set(Array.isArray(source.signals) ? source.signals : [])]
    .filter((key) => LIST_BUILDER_SIGNALS.some((signal) => signal.key === key))
  clean.signalMode = source.signalMode === 'any' ? 'any' : 'all'
  clean.pregameOnly = source.pregameOnly !== false
  clean.confirmedOnly = source.confirmedOnly === true
  clean.trustedOnly = source.trustedOnly === true
  clean.sort = LIST_BUILDER_SORTS.some((sort) => sort.key === source.sort) ? source.sort : 'hrProbability'
  return clean
}

export const effectiveOppHr9 = (batter) => Number.isFinite(batter?.effectiveHR9)
  ? batter.effectiveHR9
  : Number.isFinite(batter?.pitcher?.season?.hrPer9) ? batter.pitcher.season.hrPer9 : null

export const seasonIso = (batter) => Number.isFinite(batter?.season?.iso) ? batter.season.iso : null
export const recentPitcherHr9 = (batter) => Number.isFinite(batter?.pitcher?.recentForm?.hrPer9) ? batter.pitcher.recentForm.hrPer9 : null
export const pitcherK9 = (batter) => {
  const season = batter?.pitcher?.season
  return Number.isFinite(season?.kPer9) ? season.kPer9 : Number.isFinite(season?.k9) ? season.k9 : null
}
export const contactCollision = (batter) => Number.isFinite(batter?.matchupSignals?.contactFactor)
  ? batter.matchupSignals.contactFactor
  : null

export function isPregameListCandidate(batter) {
  const game = batter?.game
  if (!game || game.isLive === true || game.isFinal === true) return false
  return !/postponed|cancelled|canceled|suspended|final|in progress/i.test(String(game.status || ''))
}

const metricDefinitions = Object.freeze([
  { field: 'minOppHr9', label: 'Exposure HR/9', mode: 'min', get: effectiveOppHr9, fmt: (v) => fmt(v, 2) },
  { field: 'minPitchMix', label: 'Pitch mix', mode: 'min', get: pitchMixScore, fmt: (v) => fmt(v, 1) },
  { field: 'minParkFactor', label: 'Park factor', mode: 'min', get: (b) => b.gameParkHRFactor, fmt: (v) => fmt(v, 2) },
  { field: 'minRecentPitcherHr9', label: 'Recent pitcher HR/9', mode: 'min', get: recentPitcherHr9, fmt: (v) => fmt(v, 2) },
  { field: 'maxPitcherK9', label: 'Pitcher K/9', mode: 'max', get: pitcherK9, fmt: (v) => fmt(v, 1) },
  { field: 'minContactCollision', label: 'Contact collision', mode: 'min', get: contactCollision, fmt: (v) => fmt(v, 1) },
  { field: 'maxBattingOrder', label: 'Batting-order spot', mode: 'max', get: (b) => b.battingOrder, fmt: (v) => fmt(v, 0) },
  { field: 'minISO', label: 'Season ISO', mode: 'min', get: seasonIso, fmt: (v) => fmt(v, 3) },
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
  const gateScores = []

  const stateChecks = [
    {
      active: criteria.pregameOnly,
      key: 'pregameOnly',
      label: 'Pregame only',
      passes: isPregameListCandidate(batter),
      detail: 'Game is not actionable pregame',
      actual: batter?.game?.status || (batter?.game?.isLive ? 'In progress' : batter?.game?.isFinal ? 'Final' : 'Unavailable'),
      relaxable: false,
    },
    {
      active: criteria.confirmedOnly,
      key: 'confirmedOnly',
      label: 'Confirmed lineup',
      passes: batter?.lineupConfirmed === true && !isBenched(batter),
      detail: 'Not in a confirmed lineup',
      actual: isBenched(batter) ? 'Benched' : 'Unconfirmed',
    },
    {
      active: criteria.trustedOnly,
      key: 'trustedOnly',
      label: 'No data warnings',
      passes: !batter?.dataTrust?.status,
      detail: 'Data health review required',
      actual: batter?.dataTrust?.status || 'Review required',
    },
  ]
  for (const check of stateChecks.filter((item) => item.active)) {
    gateScores.push(check.passes ? 1 : 0)
    if (!check.passes) {
      failed.push({
        type: 'state', key: check.key, label: check.label, detail: check.detail,
        actual: String(check.actual), thresholdText: 'Required',
        ...(check.relaxable === false ? {} : {
          relaxation: { type: 'state', key: check.key, label: `Turn off ${check.label.toLowerCase()}`, description: `${check.label}: required → off` },
        }),
      })
    }
  }

  for (const definition of metricDefinitions) {
    const threshold = number(criteria[definition.field])
    if (threshold === null) continue
    const value = definition.get(batter)
    if (!Number.isFinite(value)) {
      missing.push({ key: definition.field, label: definition.label })
      failed.push({ type: 'metric', key: definition.field, label: definition.label, detail: `${definition.label} unavailable`, missing: true })
      gateScores.push(0)
      continue
    }
    const qualifies = definition.mode === 'max' ? value <= threshold : value >= threshold
    const delta = qualifies ? 0 : definition.mode === 'max' ? value - threshold : threshold - value
    const relaxedValue = safeRelaxationValue(definition, value)
    const [, allowedMax] = LIST_BUILDER_LIMITS[definition.field]
    const canRelax = definition.mode === 'max' ? relaxedValue <= allowedMax : relaxedValue >= LIST_BUILDER_LIMITS[definition.field][0]
    const denominator = Math.max(Math.abs(threshold), 1)
    gateScores.push(qualifies ? 1 : clamp01(1 - (delta / denominator)))
    const detail = `${definition.label} ${definition.fmt(value)} ${qualifies ? 'clears' : 'misses'} ${definition.mode === 'max' ? '≤' : '≥'} ${definition.fmt(threshold)}`
    const gate = {
      type: 'metric', key: definition.field, label: definition.label, detail,
      mode: definition.mode, value, threshold, delta,
      valueText: definition.fmt(value), thresholdText: definition.fmt(threshold), deltaText: definition.fmt(delta),
    }
    if (!qualifies && canRelax) {
      const symbol = definition.mode === 'max' ? '≤' : '≥'
      gate.relaxation = {
        type: 'metric', key: definition.field, value: relaxedValue,
        label: `Relax to ${symbol} ${definition.fmt(relaxedValue)}`,
        description: `${definition.label} ${symbol} ${definition.fmt(threshold)} → ${symbol} ${definition.fmt(relaxedValue)}`,
      }
    }
    ;(qualifies ? passed : failed).push(gate)
  }

  const signalChecks = criteria.signals.map((key) => ({ key, label: LIST_BUILDER_SIGNALS.find((item) => item.key === key)?.label || key, value: batter?.[key] === true }))
  if (signalChecks.length) {
    const matchedSignals = signalChecks.filter((item) => item.value)
    if (criteria.signalMode === 'all') {
      for (const signal of signalChecks) {
        gateScores.push(signal.value ? 1 : 0)
        if (!signal.value) {
          const retainedSignals = criteria.signals.filter((key) => key !== signal.key)
          failed.push({
            type: 'signal', key: `signal:${signal.key}`, label: signal.label,
            detail: `${signal.label} signal not present`, actual: 'Not present', thresholdText: 'Required',
            relaxation: {
              type: 'signals', signals: retainedSignals,
              label: `Remove ${signal.label}`,
              description: `${signal.label}: required → off`,
            },
          })
        }
      }
    } else {
      const signalsPass = matchedSignals.length > 0
      gateScores.push(signalsPass ? 1 : 0)
      if (!signalsPass) {
        failed.push({
          type: 'signals', key: 'signals', label: 'Selected signals',
          detail: 'No selected signal matched', actual: `0/${signalChecks.length} matched`, thresholdText: 'At least 1 selected',
          relaxation: {
            type: 'signals', signals: [], label: 'Remove signal gate',
            description: `Signals: ${signalChecks.length} selected → off`,
          },
        })
      }
    }
    for (const signal of matchedSignals) passed.push({ key: `signal:${signal.key}`, label: signal.label })
  }

  const matches = failed.length === 0
  const fitScore = matches ? 100 : Math.round((gateScores.reduce((sum, value) => sum + value, 0) / Math.max(gateScores.length, 1)) * 100)
  return {
    matches, fitScore, passed, failed, missing,
    gateCount: gateScores.length,
    passedGateCount: gateScores.filter((value) => value === 1).length,
  }
}

function sortValue(batter, sort) {
  if (sort === 'barrel') return Number.isFinite(batter?.barrelPctBBE) ? batter.barrelPctBBE : batter?.barrelPct
  if (sort === 'matchup') return effectiveOppHr9(batter)
  if (sort === 'heat') return batter?.heatIndex
  return batter?.[sort]
}

function compareListBuilderItems(left, right, sort) {
  const a = sortValue(left.batter, sort)
  const b = sortValue(right.batter, sort)
  if (Number.isFinite(a) !== Number.isFinite(b)) return Number.isFinite(a) ? -1 : 1
  return (Number(b) || 0) - (Number(a) || 0)
    || (right.batter.score ?? 0) - (left.batter.score ?? 0)
    || String(left.batter.name || '').localeCompare(String(right.batter.name || ''))
}

export function relaxListBuilderGate(rawCriteria = {}, failure) {
  const criteria = createListBuilderCriteria(rawCriteria)
  const relaxation = failure?.relaxation
  if (!relaxation) return criteria
  if (relaxation.type === 'metric') {
    const definition = metricDefinitions.find((item) => item.field === relaxation.key)
    const limits = LIST_BUILDER_LIMITS[relaxation.key]
    if (!definition || !limits || !Number.isFinite(relaxation.value)) return criteria
    const value = Math.min(limits[1], Math.max(limits[0], relaxation.value))
    return createListBuilderCriteria({ ...criteria, [relaxation.key]: value })
  }
  if (relaxation.type === 'state' && ['pregameOnly', 'confirmedOnly', 'trustedOnly'].includes(relaxation.key)) {
    return createListBuilderCriteria({ ...criteria, [relaxation.key]: false })
  }
  if (relaxation.type === 'signals') {
    const signals = (relaxation.signals || []).filter((key) => LIST_BUILDER_SIGNALS.some((signal) => signal.key === key))
    return createListBuilderCriteria({ ...criteria, signals })
  }
  return criteria
}

export function buildListBuilderResults(batters = [], rawCriteria = {}) {
  const criteria = createListBuilderCriteria(rawCriteria)
  const evaluated = (batters || []).map((batter) => ({ batter, evaluation: evaluateListBuilderBatter(batter, criteria) }))
  const results = evaluated
    .filter((item) => item.evaluation.matches)
    .sort((left, right) => compareListBuilderItems(left, right, criteria.sort))
  const nearMisses = evaluated
    .filter((item) => item.evaluation.failed.length === 1 && item.evaluation.missing.length === 0 && item.evaluation.failed[0].relaxation)
    .sort((left, right) => right.evaluation.fitScore - left.evaluation.fitScore || compareListBuilderItems(left, right, criteria.sort))
  const active = activeListBuilderCriteria(criteria)
  const coverage = Object.fromEntries(active.filter((item) => item.type === 'metric').map((item) => {
    const definition = metricDefinitions.find((candidate) => candidate.field === item.key)
    const available = definition ? (batters || []).filter((batter) => Number.isFinite(definition.get(batter))).length : 0
    return [item.key, { available, total: batters.length }]
  }))
  return { criteria, active, results, nearMisses, evaluated, coverage }
}
