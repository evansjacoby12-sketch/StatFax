const DATA_BASE = `${import.meta.env?.BASE_URL ?? '/'}data/`
const HISTORY_URL = `${DATA_BASE}browser-history.json`
const FALLBACK_URL = `${DATA_BASE}backtest-log.json`

let cachedLog = null
let pendingLog = null

// Several MLB workspaces consume the same multi-megabyte history file. Keep one
// parsed copy per app session and share an in-flight request across mounts.
export function loadBacktestLog() {
  if (cachedLog) return Promise.resolve(cachedLog)
  if (pendingLog) return pendingLog

  pendingLog = fetch(HISTORY_URL, { cache: 'no-store' })
    .then((response) => response.ok ? response : fetch(FALLBACK_URL, { cache: 'no-store' }))
    .then((response) => {
      if (!response.ok) throw new Error(`History HTTP ${response.status}`)
      return response.json()
    })
    .then((log) => {
      cachedLog = log
      return log
    })
    .finally(() => {
      pendingLog = null
    })

  return pendingLog
}
