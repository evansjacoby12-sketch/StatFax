// Shared evaluator for frozen pregame rows in backtest-log.json. The browser
// uses it for saved-recipe replay and the server uses the same contract when it
// publishes built-in recipe evidence, preventing the two surfaces from drifting.

export const LIST_BUILDER_HISTORY_GATES = Object.freeze({
  minOppHr9: ['phr9', 'min'],
  minPitchMix: ['pm', 'min'],
  minParkFactor: ['park', 'min'],
  minRecentPitcherHr9: ['prhr9', 'min'],
  maxPitcherK9: ['pk9', 'max'],
  minContactCollision: ['mcf', 'min'],
  minZoneAttacks: ['$zoneAttacks', 'min'],
  maxBattingOrder: ['ord', 'max'],
  minISO: ['iso', 'min'],
  minExitVelo: ['ev', 'min'],
  minBarrel: ['brl', 'min'],
  minHardHit: ['hh', 'min'],
  minBlast: ['blast', 'min'],
  minLaunchAngle: ['la', 'min'],
  maxLaunchAngle: ['la', 'max'],
  minPullPct: ['pull', 'min'],
  minScore: ['$score', 'min'],
  minHeat: ['heat', 'min'],
  minHrProb: ['$simHrPct', 'min'],
  minRecBarrel: ['rbrl', 'min'],
  minHrDue: ['setup', 'min'],
  minPositives: ['pos', 'min'],
  maxNegatives: ['neg', 'max'],
})

const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))

export function listBuilderHistoricalFeature(record, key) {
  if (key === '$score') return Number.isFinite(record?.score) ? record.score : null
  if (key === '$simHrPct') return Number.isFinite(record?.simHRProb) ? record.simHRProb * 100 : null
  if (key === '$zoneAttacks') {
    const evidence = record?.zoneEvidence
    if (
      (evidence?.modelVersion ?? 0) < 2 ||
      evidence?.advisoryOnly !== true ||
      !['high', 'medium'].includes(evidence?.reliability) ||
      !Number.isInteger(evidence?.attackCount)
    ) return null
    return Math.max(0, Math.min(3, evidence.attackCount))
  }
  const value = record?.feat?.[key]
  return Number.isFinite(value) ? value : null
}

function signalValue(record, key) {
  if (key === 'hot') return Number.isFinite(record?.feat?.hot) ? record.feat.hot === 1 : null
  if (key === 'barrelKing') return Array.isArray(record?.badges) ? record.badges.includes('barrelKing') : null
  return null
}

function stateValue(record, key) {
  if (key === 'pregameOnly') return true // Every history row is a frozen pregame prediction.
  if (key === 'confirmedOnly') return typeof record?.lineupConfirmed === 'boolean' ? record.lineupConfirmed : null
  if (key === 'trustedOnly') return typeof record?.dataTrusted === 'boolean' ? record.dataTrusted : null
  return null
}

export function evaluateListBuilderHistoryRecord(record, criteria = {}) {
  const missing = []
  let matches = true

  for (const [key, [featureKey, mode]] of Object.entries(LIST_BUILDER_HISTORY_GATES)) {
    if (!Number.isFinite(Number(criteria[key])) || criteria[key] === '') continue
    const value = listBuilderHistoricalFeature(record, featureKey)
    if (!Number.isFinite(value)) {
      missing.push(key)
      continue
    }
    const threshold = Number(criteria[key])
    if (mode === 'max' ? value > threshold : value < threshold) matches = false
  }

  for (const key of ['pregameOnly', 'confirmedOnly', 'trustedOnly']) {
    if (criteria[key] !== true) continue
    const value = stateValue(record, key)
    if (value == null) missing.push(key)
    else if (!value) matches = false
  }

  const signals = Array.isArray(criteria.signals) ? criteria.signals : []
  if (signals.length) {
    const values = signals.map((key) => ({ key, value: signalValue(record, key) }))
    for (const item of values) if (item.value == null) missing.push(`signal:${item.key}`)
    if (!values.some((item) => item.value == null)) {
      const signalsMatch = criteria.signalMode === 'any'
        ? values.some((item) => item.value)
        : values.every((item) => item.value)
      if (!signalsMatch) matches = false
    }
  }

  return { evaluable: missing.length === 0, matches: missing.length === 0 && matches, missing }
}

export function mergeListBuilderHistory(backtestLog = {}) {
  const records = {}
  const archive = backtestLog?.modelHistory
  for (const date of [...(archive?.dates || []), ...Object.keys(archive?.records || {})]) {
    if (isDate(date) && Array.isArray(archive?.records?.[date])) records[date] = archive.records[date]
  }
  // Operational rows are richer (names, lineup/data-health fields) and win for
  // overlapping dates. The compact archive remains the long-horizon fallback.
  for (const date of [...(backtestLog?.dates || []), ...Object.keys(backtestLog?.records || {})]) {
    if (isDate(date) && Array.isArray(backtestLog?.records?.[date])) records[date] = backtestLog.records[date]
  }
  return { dates: Object.keys(records).sort(), records }
}

export function listBuilderHistoryRows(historyOrLog = {}, { settledOnly = true } = {}) {
  const history = historyOrLog?.dates && historyOrLog?.records && !historyOrLog?.modelHistory
    ? historyOrLog
    : mergeListBuilderHistory(historyOrLog)
  return history.dates.flatMap((date) => (history.records[date] || []).map((record) => ({ date, record })))
    .filter(({ record }) => !settledOnly || (record?.actuallyPlayed !== false && typeof record?.homered === 'boolean'))
}
