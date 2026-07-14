import { existsSync, readFileSync, statSync } from 'node:fs'

function validDates(values) {
  return Array.isArray(values) ? values.filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort() : []
}

export function backtestCoverage(log) {
  const operationalDates = validDates(log?.dates)
  const archiveDates = validDates(log?.modelHistory?.dates)
  const archiveRecords = log?.modelHistory?.records || {}
  const archiveRows = archiveDates.reduce((sum, date) => sum + (Array.isArray(archiveRecords[date]) ? archiveRecords[date].length : 0), 0)
  const useArchive = archiveDates.length > 0 && archiveRows > 0
  const dates = useArchive ? archiveDates : operationalDates
  const records = useArchive ? archiveRecords : log?.records || {}
  const rows = useArchive
    ? archiveRows
    : dates.reduce((sum, date) => sum + (Array.isArray(records[date]) ? records[date].length : 0), 0)
  return {
    latestDate: dates.at(-1) || '',
    days: dates.length,
    rows,
    source: useArchive ? 'modelHistory' : 'records',
  }
}

export function chooseFreshestBacktest(candidates) {
  const usable = candidates
    .filter((candidate) => candidate?.log && typeof candidate.log === 'object')
    .map((candidate) => ({ ...candidate, coverage: backtestCoverage(candidate.log) }))
    .filter((candidate) => candidate.coverage.days > 0 && candidate.coverage.rows > 0)
  if (!usable.length) return null
  usable.sort((a, b) => (
    b.coverage.latestDate.localeCompare(a.coverage.latestDate)
    || b.coverage.days - a.coverage.days
    || b.coverage.rows - a.coverage.rows
    || (b.mtimeMs || 0) - (a.mtimeMs || 0)
  ))
  return usable[0]
}

export function modelHistoryView(log) {
  const archiveDates = validDates(log?.modelHistory?.dates)
  if (!archiveDates.length || backtestCoverage(log).source !== 'modelHistory') return log
  return {
    ...log,
    operational: { dates: log?.dates || [], records: log?.records || {} },
    dates: archiveDates,
    records: log.modelHistory.records || {},
    historySource: 'modelHistory',
  }
}

export function loadFreshestBacktest(paths, { preferModelHistory = true } = {}) {
  const candidates = []
  const failures = []
  for (const path of paths) {
    if (!path || !existsSync(path)) continue
    try {
      candidates.push({ path, log: JSON.parse(readFileSync(path, 'utf8')), mtimeMs: statSync(path).mtimeMs })
    } catch (error) {
      failures.push(`${path}: ${error.message}`)
    }
  }
  const selected = chooseFreshestBacktest(candidates)
  if (!selected) {
    const detail = failures.length ? ` Invalid candidates: ${failures.join('; ')}` : ''
    throw new Error(`No usable backtest-log.json found.${detail}`)
  }
  return {
    path: selected.path,
    rawLog: selected.log,
    log: preferModelHistory ? modelHistoryView(selected.log) : selected.log,
    coverage: selected.coverage,
  }
}
