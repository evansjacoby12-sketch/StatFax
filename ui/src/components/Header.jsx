import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { timeAgo, pct } from '../lib/format.js'
import { GRADE_ORDER, gradeColor } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

// "First pitch in 38m" — live countdown to the next scheduled game. Hidden
// once something is live (the board carries the LIVE story from there) or
// when the whole slate is done. Ticks every 30s.
function FirstPitchCountdown({ games = [] }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  if (games.some((g) => g.isLive)) return null
  const next = games
    .filter((g) => !g.isFinal && !g.isLive && Number.isFinite(Date.parse(g.gameDate)))
    .map((g) => Date.parse(g.gameDate))
    .filter((t) => t > now)
    .sort((a, b) => a - b)[0]
  if (!next) return null
  const mins = Math.max(1, Math.round((next - now) / 60_000))
  const label = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
  return (
    <>
      <span className="dot-sep">·</span>
      <span className="first-pitch" title="Time until the next scheduled first pitch">
        <Icon name="Clock" size={11} style={{ color: 'var(--accent)' }} /> first pitch {label}
      </span>
    </>
  )
}

function SportSwitcher() {
  return (
    <div className="sport-switcher" role="group" aria-label="Sport">
      <button
        type="button"
        className="sport-option active"
        aria-pressed="true"
        title="MLB model board"
      >
        <Icon name="CircleDot" size={13} />
        <span>MLB</span>
      </button>
      <button
        type="button"
        className="sport-option upcoming"
        disabled
        title="NFL models are coming soon"
      >
        <Icon name="Shield" size={13} />
        <span>NFL</span>
        <small>Soon</small>
      </button>
    </div>
  )
}

// Help dropdown anchored to the header info button
function HelpMenu({ onOpenWeather, onOpenGroups, onOpenBacktest, onOpenHowTo, onOpenSettings, onOpenModel, liveScores, onToggleLive, eliLevel, onCycleEli, refreshing, onRefresh }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const mobileSheetRef = useRef(null)

  const closeMobileMenu = () => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }
  
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current?.contains(e.target) || mobileSheetRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const mobile = window.matchMedia('(max-width: 560px)').matches
    const app = mobile ? document.querySelector('.app') : null
    const previousOverflow = app?.style.overflowY || ''
    if (app) app.style.overflowY = 'hidden'

    const onKey = (e) => {
      if (e.key === 'Escape') {
        closeMobileMenu()
        return
      }
      if (!mobile || e.key !== 'Tab') return
      const focusable = [...(mobileSheetRef.current?.querySelectorAll('button:not(:disabled)') || [])]
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    if (mobile) requestAnimationFrame(() => mobileSheetRef.current?.querySelector('.mobile-tools-close')?.focus())
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      if (app) app.style.overflowY = previousOverflow
    }
  }, [open])

  // Each destination opens one workspace; its internal tabs handle the tools.
  const sections = [
    {
      title: 'Build',
      items: [
        { label: 'Bet Lab', desc: 'Explore combos, build slips, same-game plays and saved tickets', icon: 'Beaker', fn: onOpenGroups },
      ],
    },
    {
      title: 'Discover',
      items: [
        { label: 'Find Plays', desc: 'Weather, cheat sheets and your own filtered lists', icon: 'ScanSearch', fn: onOpenWeather },
      ],
    },
    {
      title: 'Validate',
      items: [
        { label: 'Proof', desc: 'Test grades and signals against historical outcomes', icon: 'Activity', fn: onOpenBacktest },
      ],
    },
    {
      title: 'Learn',
      items: [
        { label: 'Learn Center', desc: 'Playbook, product guide and searchable glossary', icon: 'GraduationCap', fn: onOpenHowTo },
      ],
    },
    {
      title: 'App',
      items: [
        { label: 'Model Performance', desc: 'Accuracy, calibration and recent results', icon: 'Gauge', fn: onOpenModel, mobileOnly: true },
        { label: liveScores ? 'Live Scores On' : 'Pregame View', desc: liveScores ? 'Tap to pause live scores and innings' : 'Tap to enable live scores and innings', icon: liveScores ? 'Activity' : 'Clock', fn: onToggleLive, mobileOnly: true },
        { label: eliLevel === 'eli5' ? 'Plain Explanations' : 'Stats Explanations', desc: 'Switch explanation depth', icon: eliLevel === 'eli5' ? 'Sparkles' : 'BarChart3', fn: onCycleEli, mobileOnly: true },
        { label: refreshing ? 'Refreshing Slate…' : 'Refresh Slate', desc: 'Reload the latest model board', icon: refreshing ? 'Loader' : 'RefreshCw', fn: onRefresh, mobileOnly: true },
        { label: 'Settings', desc: 'Display, updates, parlays and experimental controls', icon: 'SlidersHorizontal', fn: onOpenSettings },
      ],
    },
  ]

  return (
    <div className="help-menu" ref={ref} style={{ position: 'relative' }}>
      <button
        ref={triggerRef}
        className={`icon-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Menu"
        aria-label="Menu"
        style={{
          background: open ? 'var(--hover)' : 'var(--card)',
          borderColor: open ? 'var(--accent)' : 'var(--border)'
        }}
      >
        <Icon name="ChevronDown" size={16} className="help-chevron" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        <Icon name="Ellipsis" size={18} className="help-ellipsis" />
      </button>
      {open && (
        <div className="view-menu-pop desktop-tools-menu" role="menu">
          {sections.map((sec, si) => (
            <div key={sec.title} role="group" aria-label={sec.title}>
              <div
                className="vm-section"
                style={{
                  fontSize: '9px',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: 'var(--text-faint)',
                  padding: si === 0 ? '6px 12px 4px' : '10px 12px 4px',
                  marginTop: si > 0 ? '2px' : '0',
                  borderTop: si > 0 ? '1px solid var(--border-soft)' : 'none',
                }}
              >
                {sec.title}
              </div>
              {sec.items.map((it) => (
                <button
                  key={it.label}
                  role="menuitem"
                  className={`vm-item${it.mobileOnly ? ' mobile-menu-only' : ''}`}
                  onClick={() => {
                    it.fn?.()
                    setOpen(false)
                  }}
                  disabled={it.mobileOnly && it.label.startsWith('Refreshing')}
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
          ))}
        </div>
      )}
      {open && typeof document !== 'undefined' && createPortal(
        <>
          <button
            type="button"
            className="mobile-tools-scrim"
            aria-label="Close tools menu"
            tabIndex={-1}
            onMouseDown={(event) => {
              event.stopPropagation()
              closeMobileMenu()
            }}
          />
          <section
            ref={mobileSheetRef}
            className="mobile-tools-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-tools-title"
          >
            <header className="mobile-tools-head">
              <div className="mobile-tools-title">
                <span className="mobile-tools-mark" aria-hidden="true">
                  <Icon name="Ellipsis" size={18} />
                </span>
                <span>
                  <b id="mobile-tools-title">Tools &amp; settings</b>
                  <small>StatFax navigation</small>
                </span>
              </div>
              <button
                type="button"
                className="mobile-tools-close"
                onClick={closeMobileMenu}
                aria-label="Close tools menu"
              >
                <Icon name="X" size={18} />
              </button>
            </header>

            <div className="mobile-tools-body">
              {sections.map((sec) => (
                <div className="vm-group" key={sec.title} role="group" aria-label={sec.title}>
                  <div className="vm-section">{sec.title}</div>
                  {sec.items.map((it) => (
                    <button
                      key={it.label}
                      type="button"
                      className={`vm-item${it.mobileOnly ? ' mobile-menu-only' : ''}`}
                      onClick={() => {
                        it.fn?.()
                        setOpen(false)
                      }}
                      disabled={it.mobileOnly && it.label.startsWith('Refreshing')}
                    >
                      <span className="vm-icon-box" aria-hidden="true">
                        <Icon name={it.icon} size={16} />
                      </span>
                      <span className="vm-txt">
                        <b>{it.label}</b>
                        <span className="dim">{it.desc}</span>
                      </span>
                      <Icon name="ChevronRight" size={15} className="mobile-tools-chevron" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </>,
        document.body,
      )}
    </div>
  )
}

export default function Header({
  meta,
  counts,
  onRefresh,
  onHoldBuild,
  onOpenModel,
  onOpenLegend,
  autoRefresh,
  onToggleAuto,
  liveScores = true,
  onToggleLive,
  eliLevel = 'eli5',
  onCycleEli,
  refreshing,
  slateBuilding = false,
  gradeCounts = {},
  total = 0,
  games = [],
  onOpenGuide,
  onOpenHowTo,
  onOpenWeather,
  onOpenBuilder,
  onOpenGroups,
  onOpenSGP,
  onOpenSplits,
  onOpenBacktest,
  onOpenListBuilder,
  onOpenSettings,
}) {
  const m = meta.modelMetrics
  const brierEdge = m ? (m.baselineBrier - m.brier) / m.baselineBrier : null
  const genMs = meta.generatedAt ? Date.parse(meta.generatedAt) : NaN
  const slateStale = Number.isFinite(genMs) && Date.now() - genMs > 14 * 60_000

  // Press-and-hold the refresh button for HOLD_MS → trigger a full slate
  // rebuild (onHoldBuild). A short tap still fires onRefresh (the cheap reload).
  // `holding` drives a progress fill that charges over the hold; when it
  // completes we mark suppressClick so the release's synthetic click doesn't
  // ALSO fire a reload. Keyboard activation (Enter/Space → click) keeps the tap.
  const HOLD_MS = 10_000
  const [holding, setHolding] = useState(false)
  const holdTimer = useRef(null)
  const suppressClick = useRef(false)
  const canBuild = !!onHoldBuild && !slateBuilding

  const clearHold = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
    setHolding(false)
  }
  const startHold = (e) => {
    // Primary button / touch / pen only; ignore right-click etc.
    if (e.button != null && e.button !== 0) return
    if (!canBuild || refreshing) return
    suppressClick.current = false
    setHolding(true)
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      suppressClick.current = true   // swallow the release-click that follows
      setHolding(false)
      onHoldBuild?.()
    }, HOLD_MS)
  }
  const handleRefreshClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return }
    onRefresh?.()
  }
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current) }, [])

  return (
    <header className="header">
      <div className="header-left">
        <div className="brand-sport">
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
          <SportSwitcher />
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
            <FirstPitchCountdown games={games} />
            {meta.morningLockAt && (
              <>
                <span className="dot-sep">·</span>
                <span className="first-pitch" title={`Scores locked for the day at ${new Date(meta.morningLockAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — only lineups, scratches, odds and live state update from here. A changed starting pitcher re-scores that game.`}>
                  <Icon name="Lock" size={10} style={{ color: 'var(--prime)' }} /> locked {new Date(meta.morningLockAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              </>
            )}
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

        <HelpMenu
          onOpenWeather={onOpenWeather}
          onOpenBuilder={onOpenBuilder}
          onOpenGroups={onOpenGroups}
          onOpenSGP={onOpenSGP}
          onOpenSplits={onOpenSplits}
          onOpenBacktest={onOpenBacktest}
          onOpenListBuilder={onOpenListBuilder}
          onOpenGuide={onOpenGuide}
          onOpenHowTo={onOpenHowTo}
          onOpenLegend={onOpenLegend}
          onOpenSettings={onOpenSettings}
          onOpenModel={onOpenModel}
          liveScores={liveScores}
          onToggleLive={onToggleLive}
          eliLevel={eliLevel}
          onCycleEli={onCycleEli}
          refreshing={refreshing}
          onRefresh={handleRefreshClick}
        />

        <button
          className={`icon-btn ${refreshing ? 'refreshing' : ''} ${holding ? 'holding' : ''}`}
          onClick={handleRefreshClick}
          onPointerDown={startHold}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
          onContextMenu={(e) => { if (holding) e.preventDefault() }}
          title={slateBuilding ? 'Building fresh slate from MLB APIs…' : canBuild ? 'Tap to reload · hold 10s to rebuild the slate' : 'Reload slate'}
          aria-label={slateBuilding ? 'Building slate' : 'Reload slate — hold to rebuild'}
          style={{
            position: 'relative',
            overflow: 'hidden',
            touchAction: 'none'   // let the hold gesture own the press (no scroll steal)
          }}
        >
          {/* Hold-progress fill — charges bottom-up over HOLD_MS while pressed,
              snaps back on release. Behind the icon, pointer-transparent. */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              height: holding ? '100%' : '0%',
              background: 'var(--accent)', opacity: 0.28, pointerEvents: 'none',
              transition: holding ? `height ${HOLD_MS}ms linear` : 'height 180ms ease',
            }}
          />
          <Icon name={slateBuilding ? 'Loader' : 'RefreshCw'} size={14} className={refreshing ? 'animate-spin' : ''} style={{ position: 'relative' }} />
        </button>
      </div>
    </header>
  )
}
