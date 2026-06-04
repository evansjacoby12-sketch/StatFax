import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

// Themed dropdown that replaces the native <select> (whose popup is OS-rendered
// and can't be styled). Keeps the .select-wrap pill as the trigger so existing
// layout/mobile rules still apply, and renders a dark, amber-accented menu.
//
// Single mode: `value` is the chosen value, picking one closes the menu.
// Multi mode (`multi`): `value` is a Set of chosen values; picking toggles and
// keeps the menu open. An option with an empty value ('') acts as "select all"
// → clears the Set.
export default function Select({ value, onChange, options, icon, ariaLabel, title, multi = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const eq = (a, b) => String(a) === String(b)
  const isAll = (v) => v === '' || v == null

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

  const isSelected = (v) => {
    if (!multi) return eq(v, value)
    if (isAll(v)) return value.size === 0
    return value.has(String(v))
  }

  const pick = (v) => {
    if (!multi) {
      onChange(v)
      setOpen(false)
      return
    }
    if (isAll(v)) {
      onChange(new Set())
      return
    }
    const next = new Set(value)
    const k = String(v)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    onChange(next)
  }

  let label
  if (!multi) {
    label = options.find((o) => eq(o.value, value))?.label ?? '—'
  } else if (value.size === 0) {
    label = options.find((o) => isAll(o.value))?.label ?? 'All'
  } else if (value.size === 1) {
    label = options.find((o) => value.has(String(o.value)))?.label ?? '1 selected'
  } else {
    label = `${value.size} selected`
  }

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
        <span className="sel-label">{label}</span>
        <Icon name="ChevronDown" size={14} className="sel-chev" />
      </button>
      {open && (
        <ul className="sel-menu" role="listbox" aria-multiselectable={multi || undefined} aria-label={ariaLabel}>
          {options.map((o) => (
            <li key={String(o.value)} role="option" aria-selected={isSelected(o.value)}>
              <button type="button" className={`sel-opt ${isSelected(o.value) ? 'on' : ''}`} onClick={() => pick(o.value)}>
                <span>{o.label}</span>
                {isSelected(o.value) && <Icon name="Check" size={14} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
