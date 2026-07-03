import { useState, useCallback, useEffect, useRef } from 'react'

// Module-level singleton so any file can call toast.show() without prop drilling.
const _listeners = new Set()
export const toast = {
  show(msg, type = 'info', duration = 3000) {
    for (const fn of _listeners) fn({ msg, type, duration, id: _id++ })
  },
  success(msg, duration) { this.show(msg, 'success', duration) },
  warn(msg, duration)    { this.show(msg, 'warn', duration) },
  info(msg, duration)    { this.show(msg, 'info', duration) },
}
let _id = 0

// Single toast pill — slides in, waits, fades out, then calls onDone.
function ToastPill({ item, onDone }) {
  const [phase, setPhase] = useState('in') // in → idle → out
  const timerRef = useRef(null)

  useEffect(() => {
    // After enter animation (300ms), start the hold timer.
    const enterT = setTimeout(() => {
      timerRef.current = setTimeout(() => setPhase('out'), item.duration)
    }, 300)
    return () => { clearTimeout(enterT); clearTimeout(timerRef.current) }
  }, [item.duration])

  const dismiss = () => {
    clearTimeout(timerRef.current)
    setPhase('out')
  }

  return (
    <div
      className={`toast-pill toast-${item.type} toast-${phase}`}
      role="status"
      aria-live="polite"
      onClick={dismiss}
      onAnimationEnd={(e) => {
        if (phase === 'out' && e.animationName === 'toastOut') onDone(item.id)
      }}
    >
      <span className="toast-dot" />
      <span className="toast-msg">{item.msg}</span>
    </div>
  )
}

// Mount once in App — registers as the active listener.
export default function ToastStack() {
  const [items, setItems] = useState([])

  useEffect(() => {
    const fn = (item) => setItems((prev) => [...prev.slice(-4), item])
    _listeners.add(fn)
    return () => _listeners.delete(fn)
  }, [])

  const remove = useCallback((id) => setItems((prev) => prev.filter((t) => t.id !== id)), [])

  if (!items.length) return null
  return (
    <div className="toast-stack" aria-label="Notifications">
      {items.map((t) => <ToastPill key={t.id} item={t} onDone={remove} />)}
    </div>
  )
}
