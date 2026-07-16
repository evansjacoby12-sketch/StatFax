import {
  HISTORICAL_FEATURE_VERSION,
  buildHistoricalFeatureCoverage,
  validateHistoricalFeatureRecord,
} from './historicalFeatureArchive.mjs'
import { validateZoneEvidenceArchive } from './zoneEvaluation.mjs'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const GRADE_LABELS = new Set(['PRIME', 'STRONG', 'LEAN', 'SKIP'])
const K_VOLUME_SOURCES = new Set(['recent-pitches-bf', 'recent-ip', 'season-ip'])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isValidDate = (value) => typeof value === 'string' && DATE_RE.test(value)
const isSortedUnique = (values) => values.every((value, index) => (
  (index === 0 || values[index - 1] < value) && values.indexOf(value) === index
))

function result(errors, warnings, metrics) {
  return { ok: errors.length === 0, errors, warnings, metrics }
}

function validateKDistribution(key, dist, errors) {
  const prefix = `kDistByPitcher.${key}`
  if (!/^\d+-\d+$/.test(key)) errors.push(`${prefix}: key must be pitcherId-gamePk`)
  if (!isObject(dist)) {
    errors.push(`${prefix}: distribution must be an object`)
    return
  }
  for (const field of ['k', 'lo', 'hi', 'lambda', 'expIP', 'expBF', 'adjustedKRate', 'calibration']) {
    if (!Number.isFinite(dist[field])) errors.push(`${prefix}.${field}: must be finite`)
  }
  if (Number.isFinite(dist.lo) && Number.isFinite(dist.hi) && dist.lo > dist.hi) {
    errors.push(`${prefix}: lo cannot exceed hi`)
  }
  if (!K_VOLUME_SOURCES.has(dist.volumeSource)) errors.push(`${prefix}.volumeSource: unsupported value`)
  if (!['up', 'down', 'flat'].includes(dist.trend)) errors.push(`${prefix}.trend: unsupported value`)
  if (!['low', 'med', 'high'].includes(dist.conf)) errors.push(`${prefix}.conf: unsupported value`)
  if (!Number.isInteger(dist.modelVersion) || dist.modelVersion < 2) {
    errors.push(`${prefix}.modelVersion: expected version 2 or newer`)
  }
  if (!isObject(dist.probs) || !Object.keys(dist.probs).length) {
    errors.push(`${prefix}.probs: expected at least one strikeout line`)
  } else {
    for (const [line, probability] of Object.entries(dist.probs)) {
      if (!Number.isFinite(Number(line)) || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        errors.push(`${prefix}.probs.${line}: expected probability in [0,1]`)
      }
    }
  }
}

function validateZoneMatchup(prefix, zone, errors) {
  if (!isObject(zone)) {
    errors.push(`${prefix}: expected an object`)
    return
  }
  if (!Number.isInteger(zone.modelVersion) || zone.modelVersion < 2) errors.push(`${prefix}.modelVersion: expected 2+`)
  if (zone.advisoryOnly !== true) errors.push(`${prefix}.advisoryOnly: must be true`)
  for (const field of ['attackZones', 'chaseZones', 'matchedZones', 'cellEvidence']) {
    if (!Array.isArray(zone[field])) errors.push(`${prefix}.${field}: expected an array`)
  }
  if (Array.isArray(zone.cellEvidence) && zone.cellEvidence.length !== 13) errors.push(`${prefix}.cellEvidence: expected 13 cells`)
  if (Array.isArray(zone.attackZones) && Array.isArray(zone.matchedZones) && JSON.stringify(zone.attackZones) !== JSON.stringify(zone.matchedZones)) errors.push(`${prefix}.matchedZones: must equal attackZones`)
  if (zone.zoneRating != null && (!Number.isFinite(zone.zoneRating) || zone.zoneRating < 0 || zone.zoneRating > 10)) errors.push(`${prefix}.zoneRating: expected null or 0..10`)
  if (!['high', 'medium', 'limited'].includes(zone.reliability?.status)) errors.push(`${prefix}.reliability.status: unsupported`)
  if (zone.badge != null && zone.badge !== 'ZONE_MASTER') errors.push(`${prefix}.badge: unsupported`)
}

export function validateDailySnapshot(snapshot) {
  const errors = []
  const warnings = []
  if (!isObject(snapshot)) return result(['snapshot: expected an object'], [], {})

  if (snapshot.version !== 5) errors.push(`version: expected 5, received ${String(snapshot.version)}`)
  if (!isValidDate(snapshot.date)) errors.push('date: expected YYYY-MM-DD')
  for (const field of ['generatedAt', 'finishedAt']) {
    if (!snapshot[field] || Number.isNaN(Date.parse(snapshot[field]))) errors.push(`${field}: expected an ISO timestamp`)
  }
  if (!Array.isArray(snapshot.games)) errors.push('games: expected an array')
  if (!isObject(snapshot.scoredBatters)) errors.push('scoredBatters: expected an object')

  const games = Array.isArray(snapshot.games) ? snapshot.games : []
  const gamesByPk = new Map()
  for (const [index, game] of games.entries()) {
    const prefix = `games[${index}]`
    if (!isObject(game)) {
      errors.push(`${prefix}: game must be an object`)
      continue
    }
    if (!Number.isFinite(game.gamePk)) errors.push(`${prefix}.gamePk: must be finite`)
    else if (gamesByPk.has(game.gamePk)) errors.push(`${prefix}.gamePk: duplicate ${game.gamePk}`)
    else gamesByPk.set(game.gamePk, game)
    if (Number.isFinite(game.awayTeam?.id) && game.awayTeam.id === game.homeTeam?.id) {
      errors.push(`${prefix}: awayTeam and homeTeam cannot have the same id`)
    }
  }
  const gameIds = new Set(gamesByPk.keys())
  const entries = isObject(snapshot.scoredBatters) ? Object.entries(snapshot.scoredBatters) : []
  const seen = new Set()
  for (const [key, row] of entries) {
    const prefix = `scoredBatters.${key}`
    if (!isObject(row)) {
      errors.push(`${prefix}: row must be an object`)
      continue
    }
    const expectedKey = `${row.playerId}-${row.gamePk}`
    if (key !== expectedKey) errors.push(`${prefix}: expected composite key ${expectedKey}`)
    if (seen.has(expectedKey)) errors.push(`${prefix}: duplicate batter-game row`)
    seen.add(expectedKey)
    if (!Number.isFinite(row.playerId) || !Number.isFinite(row.gamePk)) errors.push(`${prefix}: playerId and gamePk must be finite`)
    if (gameIds.size && !gameIds.has(row.gamePk)) errors.push(`${prefix}.gamePk: game is missing from games[]`)
    const game = gamesByPk.get(row.gamePk)
    if (game) {
      const awayId = game.awayTeam?.id
      const homeId = game.homeTeam?.id
      const matchesAway = Number.isFinite(row.teamId) && Number.isFinite(awayId) && row.teamId === awayId
      const matchesHome = Number.isFinite(row.teamId) && Number.isFinite(homeId) && row.teamId === homeId
      if (Number.isFinite(row.teamId) && Number.isFinite(awayId) && Number.isFinite(homeId) && !matchesAway && !matchesHome) {
        errors.push(`${prefix}.teamId: does not belong to game ${row.gamePk}`)
      }
      if ((matchesAway && row.isHome === true) || (matchesHome && row.isHome === false)) {
        errors.push(`${prefix}.isHome: contradicts teamId`)
      }
      const expectedPitcherId = matchesAway ? game.homePitcher?.id : matchesHome ? game.awayPitcher?.id : null
      if (Number.isFinite(expectedPitcherId) && Number.isFinite(row.pitcher?.id) && row.pitcher.id !== expectedPitcherId) {
        errors.push(`${prefix}.pitcher.id: expected opposing starter ${expectedPitcherId}`)
      }
    }
    if (!Number.isFinite(row.score) || row.score < 0 || row.score > 100) errors.push(`${prefix}.score: expected finite value in [0,100]`)
    if (row.hrProbability != null && (!Number.isFinite(row.hrProbability) || row.hrProbability < 0 || row.hrProbability > 1)) {
      errors.push(`${prefix}.hrProbability: expected null or probability in [0,1]`)
    }
    if (row.zoneBonus != null || row.baseScore != null) errors.push(`${prefix}: retired zone score adjustment fields are forbidden`)
    if (row.zoneMatchup != null) validateZoneMatchup(`${prefix}.zoneMatchup`, row.zoneMatchup, errors)
    const grade = row.grade?.label || row.grade
    if (grade != null && !GRADE_LABELS.has(grade)) errors.push(`${prefix}.grade: unsupported label ${String(grade)}`)
  }

  if (Number.isFinite(snapshot.stats?.scoredBatters) && snapshot.stats.scoredBatters !== entries.length) {
    errors.push(`stats.scoredBatters: expected ${entries.length}, received ${snapshot.stats.scoredBatters}`)
  }
  for (const [key, dist] of Object.entries(snapshot.kDistByPitcher || {})) validateKDistribution(key, dist, errors)

  if (games.length && entries.length === 0) warnings.push('scoredBatters: empty despite scheduled games')
  return result(errors, warnings, {
    games: games.length,
    scoredBatters: entries.length,
    kDistributions: Object.keys(snapshot.kDistByPitcher || {}).length,
  })
}

function validateRecordRows(records, dates, prefix, errors, warnings, { compact = false } = {}) {
  let rows = 0
  let missingFeatures = 0
  let legacyGameRows = 0
  for (const date of dates) {
    const dayRows = records?.[date]
    if (!Array.isArray(dayRows)) {
      errors.push(`${prefix}.records.${date}: expected an array`)
      continue
    }
    const seen = new Set()
    rows += dayRows.length
    for (let index = 0; index < dayRows.length; index++) {
      const row = dayRows[index]
      const at = `${prefix}.records.${date}[${index}]`
      if (!isObject(row)) {
        errors.push(`${at}: expected an object`)
        continue
      }
      if (!Number.isFinite(row.playerId)) errors.push(`${at}.playerId: must be finite`)
      if (row.gamePk != null && !Number.isFinite(row.gamePk)) errors.push(`${at}.gamePk: must be finite or null`)
      if (!Number.isFinite(row.score)) errors.push(`${at}.score: must be finite`)
      if (typeof row.homered !== 'boolean') errors.push(`${at}.homered: must be boolean`)
      if (compact && typeof row.actuallyPlayed !== 'boolean') errors.push(`${at}.actuallyPlayed: must be boolean`)
      if (row.feat != null && !isObject(row.feat)) errors.push(`${at}.feat: must be an object or null`)
      if (row.zoneEvidence != null) errors.push(...validateZoneEvidenceArchive(row.zoneEvidence, row.simHRProb, `${at}.zoneEvidence`))
      errors.push(...validateHistoricalFeatureRecord(row, at))
      if (compact && !row.feat) missingFeatures++
      if (row.gamePk == null) {
        legacyGameRows++
      } else {
        const identity = `${row.playerId}-${row.gamePk}`
        if (seen.has(identity)) errors.push(`${at}: duplicate ${identity}`)
        seen.add(identity)
      }
    }
  }
  if (missingFeatures) warnings.push(`${prefix}: ${missingFeatures} row(s) are missing feature vectors`)
  if (legacyGameRows) warnings.push(`${prefix}: ${legacyGameRows} legacy row(s) lack gamePk; doubleheader uniqueness cannot be verified`)
  return rows
}

export function validateBacktestLog(log) {
  const errors = []
  const warnings = []
  if (!isObject(log)) return result(['backtest: expected an object'], [], {})

  const dates = Array.isArray(log.dates) ? log.dates : []
  const records = isObject(log.records) ? log.records : {}
  if (!Array.isArray(log.dates)) errors.push('dates: expected an array')
  if (!isObject(log.records)) errors.push('records: expected an object')
  if (dates.length > 30) errors.push(`dates: operational window exceeds 30 days (${dates.length})`)
  if (!dates.every(isValidDate)) errors.push('dates: every value must use YYYY-MM-DD')
  if (!isSortedUnique(dates)) errors.push('dates: expected sorted unique values')
  for (const key of Object.keys(records)) if (!dates.includes(key)) errors.push(`records.${key}: orphan date not listed in dates[]`)
  const operationalRows = validateRecordRows(records, dates, 'operational', errors, warnings)

  const history = log.modelHistory
  let historyDates = []
  let historyRows = 0
  let historyRecords = {}
  if (history != null) {
    if (!isObject(history)) {
      errors.push('modelHistory: expected an object')
    } else {
      historyDates = Array.isArray(history.dates) ? history.dates : []
      historyRecords = isObject(history.records) ? history.records : {}
      if (history.version !== 1) errors.push(`modelHistory.version: expected 1, received ${String(history.version)}`)
      if (!Array.isArray(history.dates)) errors.push('modelHistory.dates: expected an array')
      if (!isObject(history.records)) errors.push('modelHistory.records: expected an object')
      if (historyDates.length > 180) errors.push(`modelHistory.dates: exceeds 180-day cap (${historyDates.length})`)
      if (!historyDates.every(isValidDate)) errors.push('modelHistory.dates: every value must use YYYY-MM-DD')
      if (!isSortedUnique(historyDates)) errors.push('modelHistory.dates: expected sorted unique values')
      for (const key of Object.keys(historyRecords)) if (!historyDates.includes(key)) errors.push(`modelHistory.records.${key}: orphan date`)
      for (const date of dates) if (!historyDates.includes(date)) errors.push(`modelHistory: missing operational date ${date}`)
      historyRows = validateRecordRows(historyRecords, historyDates, 'modelHistory', errors, warnings, { compact: true })
    }
  } else if (dates.length) {
    errors.push('modelHistory: required when operational records exist')
  }

  const featureArchive = buildHistoricalFeatureCoverage({ dates: historyDates, records: historyRecords })
  if (log.featureArchive == null) {
    if (historyRows) warnings.push(`featureArchive: missing derived schema-v${HISTORICAL_FEATURE_VERSION} coverage summary`)
  } else if (!isObject(log.featureArchive)) {
    errors.push('featureArchive: expected an object')
  } else if (JSON.stringify(log.featureArchive) !== JSON.stringify(featureArchive)) {
    errors.push('featureArchive: inconsistent with modelHistory')
  }

  const kResultDays = Object.keys(log.kProps?.resultsByDate || {}).length
  if (kResultDays > 180) errors.push(`kProps.resultsByDate: exceeds 180-day cap (${kResultDays})`)
  const kEstimateDays = Object.keys(log.kProps?.estByDate || {}).length
  if (kEstimateDays > 14) errors.push(`kProps.estByDate: exceeds 14-day cap (${kEstimateDays})`)

  return result(errors, warnings, {
    operationalDays: dates.length,
    operationalRows,
    modelHistoryDays: historyDates.length,
    modelHistoryRows: historyRows,
    featureArchive,
    kResultDays,
  })
}

export function assertValidMlbData(label, validation) {
  if (validation.ok) return validation
  throw new Error(`${label} failed validation:\n- ${validation.errors.join('\n- ')}`)
}
