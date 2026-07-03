import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { buzz } from '../lib/haptics.js'

const THRESHOLD = 72 // px of pull needed to fire
const MAX = 96 // px the indicator travels at most

// Custom pull-to-refresh for the home-screen PWA (standalone mode has no native
// pull-to-refresh). Pulls down from the very top → spins → runs onRefresh.
export default function PullToRefresh({ onRefresh }) {
  const [pull, setPull] = useState(0)
  const [busy, setBusy] = useState(false)
  const g = useRef({ startY: null, active: false, pull: 0, busy: false })

  useEffect(() => {
    // .app is the scroll container (not the document) — read its scrollTop.
    const scrollTop = () => document.querySelector('.app')?.scrollTop || 0
    // Don't hijack scroll inside an open sheet/dialog (drawer, zone page, modal).
    const blocked = () => !!document.querySelector('[role="dialog"]')
    const setP = (v) => {
      g.current.pull = v
      setPull(v)
    }

    const onStart = (e) => {
      if (g.current.busy || e.touches.length !== 1 || scrollTop() > 4 || blocked()) {
        g.current.startY = null
        return
      }
      g.current.startY = e.touches[0].clientY
      g.current.active = false
    }
    const onMove = (e) => {
      if (g.current.startY == null || g.current.busy) return
      const dy = e.touches[0].clientY - g.current.startY
      if (dy > 0 && scrollTop() <= 0) {
        g.current.active = true
        if (e.cancelable) e.preventDefault() // suppress the rubber-band so the pull feels owned
        setP(Math.min(MAX, dy * 0.5))
      } else if (g.current.active && dy <= 0) {
        g.current.active = false
        setP(0)
      }
    }
    const onEnd = async () => {
      const fire = g.current.active && g.current.pull >= THRESHOLD
      g.current.startY = null
      g.current.active = false
      if (!fire) {
        setP(0)
        return
      }
      g.current.busy = true
      setBusy(true)
      buzz(15)
      setP(THRESHOLD)
      try {
        await onRefresh?.()
      } catch {
        /* swallow — keep the gesture forgiving */
      }
      g.current.busy = false
      setBusy(false)
      setP(0)
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: false })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onEnd)
    }
  }, [onRefresh])

  if (pull <= 0 && !busy) return null
  const ready = pull >= THRESHOLD
  const offset = busy ? THRESHOLD : pull
  return (
    <div className="ptr" style={{ transform: `translate(-50%, ${offset}px)` }} aria-hidden="true">
      <div
        className={`ptr-circle ${busy ? 'spin' : ready ? 'ready' : ''}`}
        style={!busy ? { transform: `rotate(${pull * 2.6}deg)` } : undefined}
      >
        <Icon name="RefreshCw" size={18} />
      </div>
    </div>
  )
}
