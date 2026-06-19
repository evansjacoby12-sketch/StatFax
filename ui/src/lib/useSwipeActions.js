import { useRef } from 'react'

// Imperative swipe-to-action for list rows. Axis-locked: a vertical drag lets the
// list scroll (touch-action: pan-y on the row), a horizontal drag swipes the row
// and reveals an edge action — RIGHT-swipe fires onRight (left pill), LEFT-swipe
// fires onLeft (right pill). Commits on threshold OR a fast flick. Everything is
// done imperatively (no React state per move) so a 150-row board stays cheap.
//
// Returns refs to wire: innerRef (the translating row), leftRef/rightRef (the
// edge action pills), onPointerDown (put on the row), and swipedRef — read it in
// the row's onClick to suppress the tap that would otherwise fire after a swipe.

const THRESHOLD = 88 // px to commit
const FLICK_V = 0.5 // px/ms — a fast flick commits under the distance threshold
const FLICK_MIN = 34 // min distance for a flick to count
const MAX = 132 // clamp the translate so the row can't slide off

const vibrate = (p) => {
  try {
    navigator.vibrate?.(p)
  } catch {
    /* unsupported */
  }
}

export function useSwipeActions({ onRight, onLeft } = {}) {
  const innerRef = useRef(null)
  const leftRef = useRef(null)
  const rightRef = useRef(null)
  const swipedRef = useRef(false)
  const s = useRef({ x: 0, y: 0, lx: 0, lt: 0, dx: 0, axis: null, drag: false, vel: 0, committed: false })

  const setReveal = (dx) => {
    if (leftRef.current) leftRef.current.style.opacity = dx > 0 ? Math.min(dx / 64, 1) : 0
    if (rightRef.current) rightRef.current.style.opacity = dx < 0 ? Math.min(-dx / 64, 1) : 0
    const committed = Math.abs(dx) > THRESHOLD
    if (committed !== s.current.committed) {
      s.current.committed = committed
      const el = dx > 0 ? leftRef.current : rightRef.current
      el?.classList.toggle('committed', committed)
      if (committed) vibrate(8)
    }
  }

  const spring = () => {
    const el = innerRef.current
    if (el) {
      el.style.transition = ''
      el.style.transform = 'translateX(0)'
    }
    if (leftRef.current) leftRef.current.style.opacity = 0
    if (rightRef.current) rightRef.current.style.opacity = 0
    if (leftRef.current) leftRef.current.classList.remove('committed')
    if (rightRef.current) rightRef.current.classList.remove('committed')
    s.current.committed = false
    // Clear the inline transform once the spring settles so the row's CSS :hover
    // lift / entrance transforms work again (inline style would otherwise win).
    setTimeout(() => {
      const e2 = innerRef.current
      if (e2 && !s.current.drag) {
        e2.style.transform = ''
        e2.style.transition = ''
      }
    }, 360)
  }

  const onMove = (e) => {
    const st = s.current
    if (!st.drag) return
    const tdx = e.clientX - st.x
    const tdy = e.clientY - st.y
    if (st.axis === null) {
      if (Math.abs(tdx) < 8 && Math.abs(tdy) < 8) return
      st.axis = Math.abs(tdx) > Math.abs(tdy) ? 'x' : 'y'
      if (st.axis === 'x') {
        try {
          innerRef.current.setPointerCapture(e.pointerId)
        } catch {
          /* noop */
        }
        innerRef.current.style.transition = 'none'
      } else {
        end(e) // vertical → bail, let the list scroll
        return
      }
    }
    st.vel = (e.clientX - st.lx) / Math.max(1, e.timeStamp - st.lt)
    st.lx = e.clientX
    st.lt = e.timeStamp
    st.dx = tdx
    const clamped = Math.sign(tdx) * Math.min(Math.abs(tdx), MAX)
    const resist = Math.sign(clamped) * Math.pow(Math.abs(clamped), 0.92)
    innerRef.current.style.transform = `translateX(${resist}px)`
    setReveal(tdx)
  }

  const end = (e) => {
    const st = s.current
    if (!st.drag) return
    st.drag = false
    const el = innerRef.current
    el?.removeEventListener('pointermove', onMove)
    el?.removeEventListener('pointerup', end)
    el?.removeEventListener('pointercancel', end)
    try {
      el?.releasePointerCapture(e.pointerId)
    } catch {
      /* noop */
    }
    if (st.axis === 'x') {
      const flick = Math.abs(st.vel) > FLICK_V && Math.abs(st.dx) > FLICK_MIN
      const go = Math.abs(st.dx) > THRESHOLD || flick
      swipedRef.current = Math.abs(st.dx) > 6 // suppress the click that follows a swipe
      if (go && st.dx > 0) {
        vibrate([10, 25, 10])
        onRight?.()
      } else if (go && st.dx < 0) {
        vibrate([10, 25, 10])
        onLeft?.()
      }
      spring() // toggle actions don't remove the row — always spring back
      setTimeout(() => {
        swipedRef.current = false
      }, 60)
    }
    st.axis = null
    st.dx = 0
    st.vel = 0
  }

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const st = s.current
    st.drag = true
    st.axis = null
    st.dx = 0
    st.committed = false
    st.x = st.lx = e.clientX
    st.y = e.clientY
    st.lt = e.timeStamp
    const el = innerRef.current
    if (!el) return
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  }

  return { innerRef, leftRef, rightRef, swipedRef, onPointerDown }
}
