export const HISTORICAL_FEATURE_VERSION = 2
export const HISTORICAL_FEATURE_SUMMARY_VERSION = 1

// Frozen, pregame-only inputs. These short keys keep the 180-day archive
// practical to restore on every stateless slate run. Version 2 adds the raw
// ingredients needed by the next List Builder recipe backtests; it does not
// opt any of them into production scoring.
export const HISTORICAL_FEATURE_KEYS = Object.freeze([
  'bs', 'ms', 'es',
  'iso', 'xiso', 'xslg', 'brl', 'rbrl', 'ev', 'hh', 'la', 'pull',
  'mxev', 'evhi', 'ss', 'rev', 'hrd', 'bbe', 'rbbe', 'ceil', 'form',
  'bspd', 'blast', 'blsp', 'blpc', 'rblsp', 'rblpc', 'rsw', 'sq', 'hsw',
  'vhs', 'vhss', 'vmx', 'vmc',
  'phr9', 'pera', 'pk9', 'prg', 'prip', 'prera', 'prhr9', 'prk9', 'prp3',
  'vdel', 'csw',
  'arse', 'stuff', 'zone', 'mixf', 'piso', 'mrf', 'mcf',
  'park', 'vig', 'ord', 'hot', 'due', 'he',
  'heat', 'setup', 'pm', 'pos', 'neg',
])

export const HISTORICAL_FEATURE_GROUPS = Object.freeze({
  batTracking: Object.freeze({ keys: Object.freeze(['bspd', 'blast', 'sq']) }),
  battedBall: Object.freeze({ keys: Object.freeze(['mxev', 'ss', 'xiso', 'xslg', 'rev']) }),
  pitcherRecent: Object.freeze({ keys: Object.freeze(['prera', 'prhr9', 'prk9']) }),
  matchupSignals: Object.freeze({ keys: Object.freeze(['pm', 'arse', 'stuff', 'zone', 'mixf', 'piso']) }),
  pitchTypes: Object.freeze({ keys: Object.freeze([]), pitchTypes: true }),
})

const round = (value, digits = 3) => Number.isFinite(value) ? Number(Number(value).toFixed(digits)) : null
const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key)
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))

export function normalizeHistoricalFeatureVector(source = {}) {
  return Object.fromEntries(HISTORICAL_FEATURE_KEYS.map((key) => [key, round(source?.[key])]))
}

// Raw pitch rows are kept as compact tuples: [pitch key, usage%, batter SLG,
// whiff%]. The pitch key is essential for Phase 4 recipe definitions, while
// display names can be reconstructed from the existing pitch dictionary.
export function compactHistoricalPitchTypes(splits = []) {
  if (!Array.isArray(splits)) return []
  const seen = new Set()
  return splits
    .map((split) => {
      const source = Array.isArray(split)
        ? { key: split[0], usage: split[1], slg: split[2], whiff: split[3] }
        : split
      const key = String(source?.key || '').trim().toLowerCase()
      if (!/^[a-z0-9]{1,8}$/.test(key) || !Number.isFinite(source?.usage)) return null
      const usage = round(Math.max(0, Math.min(100, Number(source.usage))))
      const slg = Number.isFinite(source?.slg) ? round(Math.max(0, Math.min(5, Number(source.slg)))) : null
      const whiff = Number.isFinite(source?.whiff) ? round(Math.max(0, Math.min(100, Number(source.whiff)))) : null
      return [key, usage, slg, whiff]
    })
    .filter(Boolean)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .filter((tuple) => {
      if (seen.has(tuple[0])) return false
      seen.add(tuple[0])
      return true
    })
    .slice(0, 6)
}

export function historicalFeatureVersionOf(record) {
  if (Number.isInteger(record?.featureVersion)) return record.featureVersion
  return record?.feat && typeof record.feat === 'object' && !Array.isArray(record.feat) ? 1 : 0
}

export function validateHistoricalFeatureRecord(record, at = 'record') {
  const errors = []
  const version = historicalFeatureVersionOf(record)
  if (record?.featureVersion != null && (!Number.isInteger(record.featureVersion) || record.featureVersion < 1 || record.featureVersion > HISTORICAL_FEATURE_VERSION)) {
    errors.push(`${at}.featureVersion: expected an integer from 1 to ${HISTORICAL_FEATURE_VERSION}`)
  }

  if (version >= HISTORICAL_FEATURE_VERSION) {
    if (!record?.feat || typeof record.feat !== 'object' || Array.isArray(record.feat)) {
      errors.push(`${at}.feat: schema-v${HISTORICAL_FEATURE_VERSION} requires an object`)
    } else {
      for (const key of HISTORICAL_FEATURE_KEYS) {
        if (!hasOwn(record.feat, key)) errors.push(`${at}.feat.${key}: missing schema-v${HISTORICAL_FEATURE_VERSION} key`)
        else if (record.feat[key] != null && !Number.isFinite(record.feat[key])) errors.push(`${at}.feat.${key}: must be finite or null`)
      }
    }
    if (!Array.isArray(record?.pitchTypes)) errors.push(`${at}.pitchTypes: schema-v${HISTORICAL_FEATURE_VERSION} requires an array`)
  }

  if (record?.pitchTypes != null) {
    if (!Array.isArray(record.pitchTypes)) {
      errors.push(`${at}.pitchTypes: must be an array or null`)
    } else {
      if (record.pitchTypes.length > 6) errors.push(`${at}.pitchTypes: cannot exceed 6 rows`)
      const seen = new Set()
      let previousUsage = Infinity
      for (let index = 0; index < record.pitchTypes.length; index++) {
        const tuple = record.pitchTypes[index]
        const prefix = `${at}.pitchTypes[${index}]`
        if (!Array.isArray(tuple) || tuple.length !== 4) {
          errors.push(`${prefix}: expected [key, usage, slg, whiff]`)
          continue
        }
        const [key, usage, slg, whiff] = tuple
        if (typeof key !== 'string' || !/^[a-z0-9]{1,8}$/.test(key)) errors.push(`${prefix}[0]: invalid pitch key`)
        if (seen.has(key)) errors.push(`${prefix}[0]: duplicate pitch key ${key}`)
        seen.add(key)
        if (!Number.isFinite(usage) || usage < 0 || usage > 100) errors.push(`${prefix}[1]: usage must be in [0,100]`)
        if (Number.isFinite(usage) && usage > previousUsage) errors.push(`${prefix}[1]: pitch rows must be sorted by usage descending`)
        if (Number.isFinite(usage)) previousUsage = usage
        if (slg != null && (!Number.isFinite(slg) || slg < 0 || slg > 5)) errors.push(`${prefix}[2]: SLG must be in [0,5] or null`)
        if (whiff != null && (!Number.isFinite(whiff) || whiff < 0 || whiff > 100)) errors.push(`${prefix}[3]: whiff must be in [0,100] or null`)
      }
    }
  }
  return errors
}

export function buildHistoricalFeatureCoverage(history = {}) {
  const records = history?.records && typeof history.records === 'object' ? history.records : {}
  const dates = [...new Set([...(history?.dates || []), ...Object.keys(records)])].filter(validDate).sort()
  const groupCounts = Object.fromEntries(Object.keys(HISTORICAL_FEATURE_GROUPS).map((key) => [key, 0]))
  const fieldCounts = Object.fromEntries([...HISTORICAL_FEATURE_KEYS, 'pitchTypes'].map((key) => [key, 0]))
  let population = 0
  let schemaV2Rows = 0
  let legacyRows = 0
  let missingFeatureRows = 0
  let firstSchemaV2Date = null
  let lastSchemaV2Date = null

  for (const date of dates) {
    for (const record of records[date] || []) {
      if (record?.actuallyPlayed === false) continue
      population++
      const version = historicalFeatureVersionOf(record)
      if (version >= HISTORICAL_FEATURE_VERSION) {
        schemaV2Rows++
        firstSchemaV2Date ||= date
        lastSchemaV2Date = date
      } else if (version === 1) {
        legacyRows++
      } else {
        missingFeatureRows++
      }
      for (const key of HISTORICAL_FEATURE_KEYS) if (Number.isFinite(record?.feat?.[key])) fieldCounts[key]++
      if (Array.isArray(record?.pitchTypes) && record.pitchTypes.length > 0) fieldCounts.pitchTypes++
      for (const [group, definition] of Object.entries(HISTORICAL_FEATURE_GROUPS)) {
        const numericReady = definition.keys.every((key) => Number.isFinite(record?.feat?.[key]))
        const pitchReady = !definition.pitchTypes || (Array.isArray(record?.pitchTypes) && record.pitchTypes.length > 0)
        if (numericReady && pitchReady) groupCounts[group]++
      }
    }
  }

  const groups = Object.fromEntries(Object.entries(groupCounts).map(([group, available]) => [group, {
    available,
    coverage: population ? round(available / population, 4) : null,
  }]))
  const fields = Object.fromEntries(Object.entries(fieldCounts).map(([field, available]) => [field, {
    available,
    coverage: population ? round(available / population, 4) : null,
  }]))
  return {
    version: HISTORICAL_FEATURE_SUMMARY_VERSION,
    schemaVersion: HISTORICAL_FEATURE_VERSION,
    population,
    schemaV2Rows,
    legacyRows,
    missingFeatureRows,
    firstSchemaV2Date,
    lastSchemaV2Date,
    groups,
    fields,
  }
}
