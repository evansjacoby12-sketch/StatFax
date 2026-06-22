import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

export default function BackToTop() {
  const [show, setShow] = useState(false)
  // .app is the scroll container (not the window) — listen + scroll there.
  useEffect(() => {
    const el = document.querySelector('.app')
    if (!el) return
    const onScroll = () => setShow(el.scrollTop > 700)
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])
  if (!show) return null
  return (
    <button
      className="back-to-top"
      onClick={() => document.querySelector('.app')?.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      title="Back to top"
    >
      <Icon name="ChevronUp" size={18} />
    </button>
  )
}
