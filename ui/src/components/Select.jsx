import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

// Themed dropdown that replaces the native <select> (whose popup is OS-rendered
// and can't be styled). Keeps the .select-wrap pill as the trigger so existing
// layout/mobile rules still apply, and renders a dark, amber-accented menu.
export default function Select({ value, onChange, options, icon, ariaLabel, title }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const eq = (a, b) => String(a) === String(b)
  const current = options.find((o) => eq(o.value, value))

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`select-wrap sel ${open ? 'open' : ''}`} ref={ref} title={title}>
      {icon && <Icon name={icon} size={14} />}
      <button
        type="button"
        className="sel-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        <span className="sel-label">{current?.label ?? '—'}</span>
        <Icon name="ChevronDown" size={14} className="sel-chev" />
      </button>
      {open && (
        <ul className="sel-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <li key={String(o.value)} role="option" aria-selected={eq(o.value, value)}>
              <button
                type="button"
                className={`sel-opt ${eq(o.value, value) ? 'on' : ''}`}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                <span>{o.label}</span>
                {eq(o.value, value) && <Icon name="Check" size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
