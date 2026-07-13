import { useLayoutEffect, useRef } from 'react'
import Icon from './Icon.jsx'

/**
 * Shared StatFax navigation control. One measured indicator carries the active
 * state so workspace and mode changes use the same motion language everywhere.
 */
export default function CommandTabs({
  tabs,
  value,
  onChange,
  label,
  className = '',
  variant = 'modes',
  as: Element = 'div',
  ariaPressed = false,
}) {
  const wrapRef = useRef(null)
  const indicatorRef = useRef(null)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const indicator = indicatorRef.current
    if (!wrap || !indicator) return undefined

    const place = () => {
      const button = [...wrap.querySelectorAll('[data-command-tab]')]
        .find((item) => item.dataset.commandTab === String(value))
      if (!button) {
        indicator.style.opacity = '0'
        return
      }
      indicator.style.opacity = '1'
      indicator.style.transform = `translateX(${button.offsetLeft}px)`
      indicator.style.width = `${button.offsetWidth}px`
    }

    place()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null
    observer?.observe(wrap)
    window.addEventListener('resize', place)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', place)
    }
  }, [tabs, value])

  const selectByOffset = (currentIndex, offset) => {
    const enabled = tabs.filter((tab) => !tab.disabled)
    const current = enabled.findIndex((tab) => tab.id === tabs[currentIndex]?.id)
    const next = enabled[(current + offset + enabled.length) % enabled.length]
    if (!next) return
    onChange(next.id)
    requestAnimationFrame(() => {
      wrapRef.current?.querySelector(`[data-command-tab="${next.id}"]`)?.focus()
    })
  }

  const handleKeyDown = (event, index) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      selectByOffset(index, 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      selectByOffset(index, -1)
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const enabled = tabs.filter((tab) => !tab.disabled)
      const next = event.key === 'Home' ? enabled[0] : enabled.at(-1)
      if (next) {
        onChange(next.id)
        requestAnimationFrame(() => {
          wrapRef.current?.querySelector(`[data-command-tab="${next.id}"]`)?.focus()
        })
      }
    }
  }

  return (
    <Element
      className={`command-tabs command-tabs--${variant} ${className}`.trim()}
      ref={wrapRef}
      role="tablist"
      aria-label={label}
    >
      <span className="command-tab-indicator" ref={indicatorRef} aria-hidden="true" />
      {tabs.map((tab, index) => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-pressed={ariaPressed ? active : undefined}
            tabIndex={active ? 0 : -1}
            data-command-tab={tab.id}
            className={`command-tab ${active ? 'on' : ''} ${tab.className || ''}`.trim()}
            disabled={tab.disabled}
            title={tab.title}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {tab.icon && <Icon name={tab.icon} size={tab.iconSize || 13} />}
            <span className="command-tab-label">{tab.label}</span>
            {tab.badge != null && <b className="command-tab-badge mono">{tab.badge}</b>}
          </button>
        )
      })}
    </Element>
  )
}
