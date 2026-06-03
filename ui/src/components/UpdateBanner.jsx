import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

const BASE_URL = import.meta.env?.BASE_URL ?? '/'

// The hashed main bundle this running app loaded (e.g. "index-CHt53zHU.js").
// Null in dev (the module script is /src/main.jsx, not a built asset).
function currentAsset() {
  if (typeof document === 'undefined') return null
  const tags = [...document.querySelectorAll('script[src*="/assets/index-"]')]
  const src = tags.map((t) => t.src).find(Boolean)
  return src ? src.split('/assets/')[1] : null
}

// Fetch the deployed index.html (no cache) and read its hashed main bundle.
async function latestAsset() {
  const res = await fetch(`${BASE_URL}?_v=${Date.now()}`, { cache: 'no-store' })
  if (!res.ok) return null
  const html = await res.text()
  const m = html.match(/\/assets\/(index-[\w-]+\.js)/)
  return m ? m[1] : null
}

// Polls the deployed build and flips true once it differs from what's running —
// so a home-screen PWA (no pull-to-refresh) can surface a one-tap update.
function useUpdateAvailable() {
  const [stale, setStale] = useState(false)
  const current = useRef(currentAsset())
  useEffect(() => {
    if (!current.current || stale) return // dev build, or already flagged
    let alive = true
    const check = async () => {
      try {
        const latest = await latestAsset()
        if (alive && latest && latest !== current.current) setStale(true)
      } catch {
        /* offline / transient — try again next tick */
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
