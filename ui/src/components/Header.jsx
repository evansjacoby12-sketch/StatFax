import { useState, useRef, useEffect } from 'react'
import Icon from './Icon.jsx'
import { timeAgo, pct } from '../lib/format.js'
import { GRADE_ORDER, gradeColor } from '../lib/badges.js'

// Help dropdown anchored to the header info button: Groups, Guide, How to Pick, Legend.
function HelpMenu({ onOpenGroups, onOpenGuide, onOpenHowTo, onOpenLegend }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const items = [
    { label: 'HR Groups', desc: 'Auto-built cross-game parlays', icon: 'Layers', fn: onOpenGroups },
    { label: 'How to Pick', desc: 'HR-selection playbook', icon: 'Target', fn: onOpenHowTo },
    { label: 'Guide', desc: 'How the board works', icon: 'Info', fn: onOpenGuide },
    { label: 'Legend', desc: 'Grades, signals & stats', icon: 'Trophy', fn: onOpenLegend },
  ]
  return (
    <div className="help-menu" ref={ref}>
      <button
        className={`icon-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Help — Guide, How to Pick, Legend"
        aria-label="Help"
      >
        <Icon name="Info" size={16} />
      </button>
      {open && (
        <div className="view-menu-pop" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              className="vm-item"
              onClick={() => {
                it.fn()
                setOpen(false)
              }}
            >
              <Icon name={it.icon} size={16} />
              <span className="vm-txt">
                <b>{it.label}</b>
                <span className="dim">{it.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Header({
  meta,
  counts,
  onRefresh,
  onOpenModel,
  onOpenLegend,
  autoRefresh,
  onToggleAuto,
  liveScores = true,
  onToggleLive,
  refreshing,
  gradeCounts = {},
  total = 0,
  onOpenGuide,
  onOpenHowTo,
  onOpenGroups,
}) {
  const m = meta.modelMetrics
  const brierEdge = m ? (m.baselineBrier - m.brier) / m.baselineBrier : null
  return (
    <header className="header">
      <div className="header-left">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="Trophy" size={18} />
          </span>
          <div className="brand-txt">
            <span className="brand-name">
              Stat<span className="brand-accent">Fax</span>
            </span>
            <span className="brand-sub">Model Board</span>
          </div>
        </div>
        <div className="slate-block">
          <div className="slate-meta">
            <span className="slate-date">{meta.date}</span>
            <span className="dot-sep">·</span>
            <span>{counts.games} games</span>
            <span className="dot-sep slate-batters">·</span>
            <span className="slate-batters">
              <b className="mono">{counts.shown}</b> / {counts.total} batters
            </span>
          </div>
          {total > 0 && (
            <div className="grade-bar" title="Grade distribution">
              {GRADE_ORDER.map((g) => {
                const n = gradeCounts[g] || 0
                if (!n) return null
                return (
                  <span
                    key={g}
                    className="grade-bar-seg"
                    style={{ flexGrow: n, background: gradeColor(g) }}
                    title={`${g}: ${n}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        <button className="metric-pill" onClick={onOpenModel} title="Model track record, accuracy & calibration">
          <Icon name="Gauge" size={14} />
          <span className="metric-pill-stack">
            <span className="metric-pill-k">Brier</span>
            <span className="metric-pill-v mono">{m ? m.brier.toFixed(4) : '—'}</span>
          </span>
          {brierEdge != null && (
            <span className={`metric-delta ${brierEdge >= 0 ? 'up' : 'down'} mono`}>
              {brierEdge >= 0 ? '▲' : '▼'} {pct(Math.abs(brierEdge), 0)} vs base
            </span>
          )}
        </button>

        <div className="gen-meta" title={`Generated ${meta.generatedAt}`}>
          <Icon name="Clock" size={13} />
          <span>{timeAgo(meta.generatedAt)}</span>
        </div>

        <button
          className={`toggle-btn live-btn ${liveScores ? 'on' : ''}`}
          onClick={onToggleLive}
          title={
            liveScores
              ? 'Live scores & innings shown — tap for a clean pregame look'
              : 'Pregame look (scores hidden) — tap to show live scores'
          }
          aria-pressed={liveScores}
        >
          <Icon name={liveScores ? 'Activity' : 'Clock'} size={14} className={liveScores ? 'spin-pulse' : ''} />
          {liveScores ? 'Live' : 'Pregame'}
        </button>

        <button
          className={`toggle-btn auto-btn ${autoRefresh ? 'on' : ''}`}
          onClick={onToggleAuto}
          title="Auto-refresh the slate every 60s (for live games)"
          aria-pressed={autoRefresh}
        >
          <Icon name="Radio" size={14} className={autoRefresh ? 'spin-pulse' : ''} />
          Auto
        </button>

        <HelpMenu onOpenGroups={onOpenGroups} onOpenGuide={onOpenGuide} onOpenHowTo={onOpenHowTo} onOpenLegend={onOpenLegend} />

        <button
          className={`icon-btn ${refreshing ? 'refreshing' : ''}`}
          onClick={onRefresh}
          title="Reload slate now"
          aria-label="Reload slate"
        >
          <Icon name="RefreshCw" size={15} />
        </button>
      </div>
    </header>
  )
}
