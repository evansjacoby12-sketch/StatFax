import { useState, useRef, useEffect } from 'react'
import Icon from './Icon.jsx'
import { timeAgo, pct } from '../lib/format.js'
import { GRADE_ORDER, gradeColor } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

// Help dropdown anchored to the header info button
function HelpMenu({ onOpenBuilder, onOpenGroups, onOpenSGP, onOpenSplits, onOpenBacktest, onOpenGuide, onOpenHowTo, onOpenLegend, onOpenSettings }) {
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
    { label: 'Parlay Builder', desc: 'Build your own slip — live odds, EV & correlation', icon: 'Sparkles', fn: onOpenBuilder },
    { label: 'Parlay Combos', desc: 'Auto-built chalk, value, lottery combos', icon: 'Layers', fn: onOpenGroups },
    { label: 'Same-Game Parlays', desc: 'Best correlated 2–4 leg SGPs', icon: 'Zap', fn: onOpenSGP },
    { label: 'Cheat Sheet', desc: 'HR plays, barrels, weak arms & parks', icon: 'LayoutGrid', fn: onOpenSplits },
    { label: 'Signal Backtest', desc: 'Hit rates by grade and signals', icon: 'Activity', fn: onOpenBacktest },
    { label: 'How to Pick', desc: 'HR-selection playbook strategies', icon: 'Target', fn: onOpenHowTo },
    { label: 'Guide', desc: 'Learn how the board is structured', icon: 'Info', fn: onOpenGuide },
    { label: 'Legend', desc: 'Definitions of grades, signals & stats', icon: 'Trophy', fn: onOpenLegend },
    { label: 'Settings', desc: 'Live updates, refresh rate, combo window', icon: 'SlidersHorizontal', fn: onOpenSettings },
  ]

  return (
    <div className="help-menu" ref={ref} style={{ position: 'relative' }}>
      <button
        className={`icon-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Help & Tools Menu"
        aria-label="Help"
        style={{
          background: open ? 'var(--hover)' : 'var(--card)',
          borderColor: open ? 'var(--accent)' : 'var(--border)'
        }}
      >
        <Icon name="ChevronDown" size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
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
              <div className="vm-icon-box">
                <Icon name={it.icon} size={15} />
              </div>
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
  eliLevel = 'eli5',
  onCycleEli,
  refreshing,
  gradeCounts = {},
  total = 0,
  onOpenGuide,
  onOpenHowTo,
  onOpenBuilder,
  onOpenGroups,
  onOpenSGP,
  onOpenSplits,
  onOpenBacktest,
  onOpenSettings,
}) {
  const m = meta.modelMetrics
  const brierEdge = m ? (m.baselineBrier - m.brier) / m.baselineBrier : null
  const genMs = meta.generatedAt ? Date.parse(meta.generatedAt) : NaN
  const slateStale = Number.isFinite(genMs) && Date.now() - genMs > 14 * 60_000

  return (
    <header className="header">
      <div className="header-left">
        <div className="brand">
          <span className="brand-mark" style={{
            background: 'linear-gradient(135deg, var(--accent) 0%, #0052d4 100%)',
            boxShadow: '0 0 16px rgba(0, 216, 246, 0.4)',
            borderRadius: '10px',
            width: '34px',
            height: '34px',
            display: 'grid',
            placeItems: 'center',
            color: '#fff'
          }}>
            <Icon name="Trophy" size={16} />
          </span>
          <div className="brand-txt">
            <span className="brand-name">
              Stat<span style={{ color: 'var(--accent)', textShadow: '0 0 8px var(--accent-glow)' }}>Fax</span>
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
              <b className="mono" style={{ color: 'var(--accent)' }}>{counts.shown}</b> / {counts.total} batters
            </span>
          </div>
          {total > 0 && (
            <div className="grade-bar" title="Grade distribution" style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', marginTop: '6px' }}>
              {GRADE_ORDER.map((g) => {
                const n = gradeCounts[g] || 0
                if (!n) return null
                return (
                  <span
                    key={g}
                    className="grade-bar-seg"
                    style={{ flexGrow: n, background: gradeColor(g), height: '100%', display: 'inline-block' }}
                    title={`${g}: ${n}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        <button className="metric-pill" onClick={onOpenModel} title="Model accuracy & calibration tracker">
          <Icon name="Gauge" size={14} style={{ color: 'var(--accent)' }} />
          <span className="metric-pill-stack">
            <span className="metric-pill-k">Brier</span>
            <span className="metric-pill-v mono" style={{ color: 'var(--accent)' }}>{m ? m.brier.toFixed(4) : '—'}</span>
          </span>
          {brierEdge != null && (
            <span className={`metric-delta ${brierEdge >= 0 ? 'up' : 'down'} mono`}>
              {brierEdge >= 0 ? '▲' : '▼'} {pct(Math.abs(brierEdge), 0)}
            </span>
          )}
        </button>

        <div
          className={`gen-meta ${slateStale ? 'stale' : ''}`}
          title={
            slateStale
              ? `Slate generated ${meta.generatedAt} — scores/innings are from then, not live-now.`
              : `Generated ${meta.generatedAt}`
          }
        >
          <Icon name={slateStale ? 'TriangleAlert' : 'Clock'} size={13} style={{ color: slateStale ? 'var(--warn)' : 'var(--text-faint)' }} />
          <span style={{ color: slateStale ? 'var(--warn)' : 'var(--text-dim)' }}>{timeAgo(meta.generatedAt)}</span>
        </div>

        <button
          className={`toggle-btn live-btn ${liveScores ? 'on' : ''}`}
          onClick={onToggleLive}
          title={
            liveScores
              ? 'Live scores & innings auto-updating — tap to view pregame only'
              : 'Pregame only — tap to enable live updates'
          }
          aria-pressed={liveScores}
          aria-label={liveScores ? 'Live scores on' : 'Pregame look'}
          style={{
            background: liveScores ? 'rgba(16, 185, 129, 0.1)' : 'var(--card)',
            borderColor: liveScores ? 'var(--strong)' : 'var(--border)',
            color: liveScores ? 'var(--strong)' : 'var(--text-dim)'
          }}
        >
          <Icon name={liveScores ? 'Activity' : 'Clock'} size={14} className={liveScores ? 'spin-pulse' : ''} />
        </button>

        <button
          className="toggle-btn eli-btn"
          onClick={onCycleEli}
          title={
            eliLevel === 'eli5'
              ? 'Explanations: Plain English (ELI5). Tap for stats depth (ELI15).'
              : 'Explanations: Stats depth (ELI15). Tap for plain English (ELI5).'
          }
          aria-label={`Explanation depth: ${eliLevel}`}
        >
          <Icon name={eliLevel === 'eli5' ? 'Sparkles' : 'BarChart3'} size={14} style={{ color: 'var(--accent)' }} />
        </button>

        <HelpMenu onOpenBuilder={onOpenBuilder} onOpenGroups={onOpenGroups} onOpenSGP={onOpenSGP} onOpenSplits={onOpenSplits} onOpenBacktest={onOpenBacktest} onOpenGuide={onOpenGuide} onOpenHowTo={onOpenHowTo} onOpenLegend={onOpenLegend} onOpenSettings={onOpenSettings} />

        <button
          className={`icon-btn ${refreshing ? 'refreshing' : ''}`}
          onClick={onRefresh}
          title="Reload slate now"
          aria-label="Reload slate"
          style={{
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          <Icon name="RefreshCw" size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
    </header>
  )
}
