import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

const BASE_URL = import.meta.env?.BASE_URL ?? '/'
// Commit SHA baked in at build (vite define). 'dev' locally → banner disabled.
const BUILD_SHA = typeof __BUILD_SHA__ !== 'undefined' ? __BUILD_SHA__ : 'dev'

// Fetch the deployed build's commit SHA from version.json. Comparing the SHA
// (not the bundle hash) is immune to non-deterministic builds + CDN edge skew —
// it flips only on an actual new commit. Always cache-busted.
async function latestSha() {
  const res = await fetch(`${BASE_URL}version.json?_v=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return null
  const j = await res.json().catch(() => null)
  return j?.sha || null
}

// Polls the deployed SHA and flips true once it differs from the running build —
// so a home-screen PWA (no pull-to-refresh) gets a one-tap update.
function useUpdateAvailable() {
  const [stale, setStale] = useState(false)
  useEffect(() => {
    if (BUILD_SHA === 'dev' || stale) return // dev build, or already flagged
    let alive = true
    const check = async () => {
      try {
        const sha = await latestSha()
        if (alive && sha && sha !== BUILD_SHA) setStale(true)
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
      <span className="ub-txt">New version available</span>
      <button className="ub-refresh" onClick={() => window.location.reload()}>
        Refresh
      </button>
      <button className="ub-x" onClick={() => setDismissed(true)} aria-label="Dismiss">
        <Icon name="X" size={14} />
      </button>
    </div>
  )
}
