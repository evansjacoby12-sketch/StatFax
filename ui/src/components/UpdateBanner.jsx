import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

const BASE_URL = import.meta.env?.BASE_URL ?? '/'
// Commit SHA + build timestamp baked in at build time (vite define).
// SHA is 'dev' for local/non-CI builds; timestamp is always a real ISO string.
const BUILD_SHA  = typeof __BUILD_SHA__  !== 'undefined' ? __BUILD_SHA__  : 'dev'
const BUILD_TIME = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null

// Fetch the deployed version.json (always cache-busted).
async function latestVersion() {
  const res = await fetch(`${BASE_URL}version.json?_v=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json().catch(() => null)
}

// Polls the deployed version and flips true once a newer build is detected.
// Primary: SHA mismatch (CI builds only). Fallback: builtAt timestamp is
// newer than the running build — works even when GITHUB_SHA wasn't set.
function useUpdateAvailable() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    if (stale) return
    let alive = true
    const check = async () => {
      try {
        const v = await latestVersion()
        if (!alive || !v) return
        // SHA path (CI builds): both sides have a real non-dev SHA — most reliable.
        // Early-return here so same-build can never accidentally trigger via timestamp.
        if (BUILD_SHA !== 'dev' && v.sha && v.sha !== 'dev') {
          if (v.sha !== BUILD_SHA) setStale(true)
          return
        }
        // Timestamp fallback for dev/non-CI builds. BUILD_TIME is injected at
        // vite-config-load time, version.json.builtAt is written after the bundle
        // closes — same build has a delta of ~30-120s. Use a 5-min grace so a
        // same-build check never triggers; a newer deploy (different day / CI run)
        // will have a delta well above 5 min.
        if (BUILD_TIME && v.builtAt) {
          const gracePeriod = 5 * 60 * 1000
          if (new Date(v.builtAt).getTime() > new Date(BUILD_TIME).getTime() + gracePeriod) {
            setStale(true)
          }
        }
      } catch {
        /* offline / transient — retry next tick */
      }
    }
    check()
    const id = setInterval(check, 90_000)
    const onVisible = () => document.visibilityState === 'visible' && check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
    }
  }, [stale])
  return stale
}

export default function UpdateBanner() {
  const stale = useUpdateAvailable()
  const [dismissed, setDismissed] = useState(false)
  if (!stale || dismissed) return null
  return (
    <div className="update-banner" role="status" aria-live="polite">
      <Icon name="RefreshCw" size={15} className="ub-spark" />
      <span className="ub-copy">
        <strong>Update ready</strong>
        <small>Latest version available</small>
      </span>
      <button type="button" className="ub-refresh" onClick={() => window.location.reload()}>
        Reload
      </button>
      <button type="button" className="ub-x" onClick={() => setDismissed(true)} aria-label="Dismiss update">
        <Icon name="X" size={14} />
      </button>
    </div>
  )
}
