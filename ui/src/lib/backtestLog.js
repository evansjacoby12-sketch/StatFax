const BACKTEST_LOG_URL = `${import.meta.env?.BASE_URL ?? '/'}data/backtest-log.json`

let cachedLog = null
let pendingLog = null

// Several MLB workspaces consume the same multi-megabyte history file. Keep one
// parsed copy per app session and share an in-flight request across mounts.
export function loadBacktestLog() {
  if (cachedLog) return Promise.resolve(cachedLog)
  if (pendingLog) return pendingLog

  pendingLog = fetch(BACKTEST_LOG_URL, { cache: 'no-store' })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
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
