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

function SportSwitcher({ sport = 'mlb', onChange }) {
  return (
    <div className="sport-switcher" role="group" aria-label="Sport">
      <button
        type="button"
        className={`sport-option ${sport === 'mlb' ? 'active' : ''}`}
        aria-pressed={sport === 'mlb'}
        onClick={() => onChange?.('mlb')}
        title="MLB model board"
      >
        <Icon name="CircleDot" size={13} />
        <span>MLB</span>
      </button>
      <button
        type="button"
        className={`sport-option ${sport === 'nfl' ? 'active' : ''}`}
        aria-pressed={sport === 'nfl'}
        onClick={() => onChange?.('nfl')}
        title="NFL touchdown scorer board"
      >
        <Icon name="Shield" size={13} />
        <span>NFL</span>
      </button>
    </div>
  )
}

// Help dropdown anchored to the header info button
function HelpMenu({ sport, onOpenWeather, onOpenGroups, onOpenSplits, onOpenBacktest, onOpenHowTo, onOpenSettings, onOpenModel, liveScores, onToggleLive, eliLevel, onCycleEli, refreshing, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [toolQuery, setToolQuery] = useState('')
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const mobileSheetRef = useRef(null)

  const closeMobileMenu = () => {
    setOpen(false)
    setToolQuery('')
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
      const focusable = [...(mobileSheetRef.current?.querySelectorAll('input:not(:disabled), button:not(:disabled)') || [])]
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

  const isNFL = sport === 'nfl'

  // Keep each sport's tools scoped to its own workspace. NFL learning and
  // discovery destinations use football-only content and model fields.
  const sections = isNFL ? [
    {
      title: 'NFL Board',
      items: [
        { label: refreshing ? 'Refreshing NFL Feed…' : 'Refresh NFL Feed', desc: 'Reload games, players, injuries, odds and live stats', icon: refreshing ? 'Loader' : 'RefreshCw', fn: onRefresh },
        { label: liveScores ? 'Live Updates Active' : 'Pregame Status', desc: liveScores ? 'NFL live data refreshes every 30 seconds' : 'No NFL game is live right now', icon: liveScores ? 'Activity' : 'Clock', fn: onToggleLive },
        { label: eliLevel === 'eli5' ? 'Plain Explanations' : 'Stats Explanations', desc: 'Switch the detail shown on NFL player cards', icon: eliLevel === 'eli5' ? 'Sparkles' : 'BarChart3', fn: onCycleEli },
      ],
    },
    {
      title: 'NFL Tools',
      items: [
        { label: 'NFL Cheat Sheet', desc: 'Ranked touchdown, receiving, rushing and passing props', icon: 'LayoutGrid', fn: onOpenSplits },
        { label: 'NFL Learn Center', desc: 'Football playbook, guide and searchable glossary', icon: 'GraduationCap', fn: onOpenHowTo },
      ],
    },
  ] : [
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

  const featuredTool = isNFL ? {
    label: refreshing ? 'Refreshing NFL Feed' : 'Refresh NFL Feed',
    desc: 'Reload games, players, injuries, odds and live stats',
    icon: refreshing ? 'Loader' : 'RefreshCw',
    fn: onRefresh,
    keywords: 'nfl football reload games players injuries odds live stats',
  } : {
    label: 'Bet Lab',
    desc: 'Analyze model edge and parlay combos',
    icon: 'Beaker',
    fn: onOpenGroups,
    keywords: 'build slips same game saved tickets',
  }
  const quickTools = isNFL ? [
    { label: 'Cheat Sheet', meta: 'NFL leaders', icon: 'LayoutGrid', fn: onOpenSplits, keywords: 'nfl football ranked props touchdown receiving rushing passing' },
    { label: 'Learn', meta: 'NFL guide', icon: 'GraduationCap', fn: onOpenHowTo, keywords: 'nfl football learn center playbook glossary guide' },
  ] : [
    { label: 'Find Plays', meta: 'Discovery', icon: 'ScanSearch', fn: onOpenWeather, keywords: 'weather cheat sheets filtered lists' },
    { label: 'Proof', meta: 'Backtests', icon: 'Activity', fn: onOpenBacktest, keywords: 'validate grades signals historical outcomes' },
    { label: 'Learn', meta: 'Guide', icon: 'GraduationCap', fn: onOpenHowTo, keywords: 'learn center playbook glossary help' },
  ]
  const utilityTools = isNFL ? [
    {
      label: 'Status',
      meta: liveScores ? 'Live updates' : 'Pregame',
      icon: liveScores ? 'Activity' : 'Clock',
      fn: onToggleLive,
      active: liveScores,
      keywords: 'nfl live status updates pregame',
    },
    {
      label: 'Detail',
      meta: eliLevel === 'eli5' ? 'Plain text' : 'Stats view',
      icon: eliLevel === 'eli5' ? 'Sparkles' : 'BarChart3',
      fn: onCycleEli,
      keywords: 'nfl explanations detail eli5 stats plain',
    },
  ] : [
    { label: 'Model', meta: 'Metrics', icon: 'Gauge', fn: onOpenModel, keywords: 'performance accuracy calibration results' },
    {
      label: 'Scores',
      meta: liveScores ? 'Live on' : 'Pregame',
      icon: liveScores ? 'Activity' : 'Clock',
      fn: onToggleLive,
      active: liveScores,
      keywords: 'live scores innings pause enable',
    },
    {
      label: 'Detail',
      meta: eliLevel === 'eli5' ? 'Plain text' : 'Stats view',
      icon: eliLevel === 'eli5' ? 'Sparkles' : 'BarChart3',
      fn: onCycleEli,
      keywords: 'explanations depth eli5 stats plain',
    },
    {
      label: refreshing ? 'Refreshing' : 'Reload',
      meta: refreshing ? 'Working' : 'Manual',
      icon: refreshing ? 'Loader' : 'RefreshCw',
      fn: onRefresh,
      disabled: refreshing,
      keywords: 'refresh slate latest model board',
    },
  ]
  const settingsTool = isNFL ? null : {
    label: 'System settings',
    icon: 'SlidersHorizontal',
    fn: onOpenSettings,
    keywords: 'display updates parlays experimental controls settings',
  }
  const normalizedQuery = toolQuery.trim().toLowerCase()
  const toolMatches = (tool) => !normalizedQuery || `${tool.label} ${tool.meta || ''} ${tool.desc || ''} ${tool.keywords || ''}`.toLowerCase().includes(normalizedQuery)
  const visibleFeatured = toolMatches(featuredTool)
  const visibleQuickTools = quickTools.filter(toolMatches)
  const visibleUtilityTools = utilityTools.filter(toolMatches)
  const visibleSettings = !!settingsTool && toolMatches(settingsTool)
  const hasMobileResults = visibleFeatured || visibleQuickTools.length > 0 || visibleUtilityTools.length > 0 || visibleSettings
  const runMobileTool = (tool) => {
    tool.fn?.()
    closeMobileMenu()
  }

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
                  <b id="mobile-tools-title">{isNFL ? 'NFL tools' : 'Tools & settings'}</b>
                  <small>{isNFL ? 'NFL Board controls' : 'StatFax navigation'}</small>
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
              <label className="mobile-tools-search">
                <Icon name="Search" size={17} aria-hidden="true" />
                <span className="sr-only">Find a tool</span>
                <input
                  type="search"
                  value={toolQuery}
                  onChange={(event) => setToolQuery(event.target.value)}
                  placeholder={isNFL ? 'Find an NFL tool' : 'Find a tool'}
                  autoComplete="off"
                />
                {toolQuery && (
                  <button type="button" onClick={() => setToolQuery('')} aria-label="Clear tool search">
                    <Icon name="X" size={15} />
                  </button>
                )}
              </label>

              {visibleFeatured && (
                <button
                  type="button"
                  className="mobile-tools-featured"
                  onClick={() => runMobileTool(featuredTool)}
                >
                  <span className="mobile-tools-featured-icon" aria-hidden="true">
                    <Icon name={featuredTool.icon} size={22} />
                  </span>
                  <span className="mobile-tools-featured-copy">
                    <span>
                      <b>{featuredTool.label}</b>
                      <small>Featured</small>
                    </span>
                    <em>{featuredTool.desc}</em>
                  </span>
                  <Icon name="ChevronRight" size={17} aria-hidden="true" />
                </button>
              )}

              {visibleQuickTools.length > 0 && (
                <div
                  className="mobile-tools-quick"
                  role="group"
                  aria-label="Quick launch"
                  style={{ '--mobile-tool-count': visibleQuickTools.length }}
                >
                  {visibleQuickTools.map((tool) => (
                    <button key={tool.label} type="button" onClick={() => runMobileTool(tool)}>
                      <Icon name={tool.icon} size={21} aria-hidden="true" />
                      <b>{tool.label}</b>
                      <small>{tool.meta}</small>
                    </button>
                  ))}
                </div>
              )}

              {(visibleUtilityTools.length > 0 || visibleSettings) && (
                <div className="mobile-tools-utilities" role="group" aria-label="Utilities">
                  <div className="mobile-tools-section-label">Utilities</div>
                  {visibleUtilityTools.length > 0 && (
                    <div className="mobile-tools-utility-grid">
                      {visibleUtilityTools.map((tool) => (
                        <button
                          key={tool.label}
                          type="button"
                          className={tool.active ? 'is-active' : ''}
                          onClick={() => runMobileTool(tool)}
                          disabled={tool.disabled}
                          aria-label={`${tool.label}: ${tool.meta}`}
                        >
                          <Icon name={tool.icon} size={19} className={tool.disabled ? 'animate-spin' : ''} aria-hidden="true" />
                          <span>
                            <b>{tool.label}</b>
                            <small>{tool.meta}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {visibleSettings && (
                    <button
                      type="button"
                      className="mobile-tools-settings"
                      onClick={() => runMobileTool(settingsTool)}
                    >
                      <span>
                        <Icon name={settingsTool.icon} size={19} aria-hidden="true" />
                        <b>{settingsTool.label}</b>
                      </span>
                      <Icon name="ChevronRight" size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}

              {!hasMobileResults && (
                <div className="mobile-tools-empty" role="status">
                  <Icon name="Search" size={20} aria-hidden="true" />
                  <b>No tools found</b>
                  <span>Try a different name or category.</span>
                </div>
              )}
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
  sport = 'mlb',
  onSportChange,
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
              background: 'linear-gradient(135deg, var(--accent) 0%, #68668f 100%)',
              boxShadow: '0 0 16px rgba(151, 149, 203, 0.4)',
              borderRadius: '10px',
              width: '34px',
              height: '34px',
              display: 'grid',
              placeItems: 'center',
              color: '#fff'
            }}>
              <img className="brand-mark-img" src={`${import.meta.env?.BASE_URL ?? '/'}icons/icon-192.png`} alt="" aria-hidden="true" />
            </span>
            <div className="brand-txt">
              <span className="brand-name">
                Stat<span style={{ color: 'var(--accent)', textShadow: '0 0 8px var(--accent-glow)' }}>Fax</span>
              </span>
              <span className="brand-sub">{sport === 'nfl' ? 'NFL Board' : 'Model Board'}</span>
            </div>
          </div>
          <SportSwitcher sport={sport} onChange={onSportChange} />
        </div>
        <div className="slate-block">
          <div className="slate-meta">
            <span className="slate-date">{sport === 'nfl' ? (meta.week || 'NFL Demo') : meta.date}</span>
            <span className="dot-sep">·</span>
            <span>{counts.games} games</span>
            <span className="dot-sep slate-batters">·</span>
            <span className="slate-batters slate-batter-count">
              <span className="mono slate-batter-values">
                <b style={{ color: 'var(--accent)' }}>{counts.shown}</b>
                <span>/</span>
                <span>{counts.total}</span>
              </span>
              <span>{sport === 'nfl' ? 'players' : 'batters'}</span>
            </span>
            {sport === 'mlb' && <FirstPitchCountdown games={games} />}
            {sport === 'nfl' && <span className="nfl-header-demo"><Icon name={meta.sourceMode === 'demo' ? 'Beaker' : 'Activity'} size={10} /> {meta.sourceMode === 'demo' ? 'demo slate' : 'live feed'}</span>}
            {sport === 'mlb' && meta.morningLockAt && (
              <>
                <span className="dot-sep">·</span>
                <span className="first-pitch" title={`Scores locked for the day at ${new Date(meta.morningLockAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — only lineups, scratches, odds and live state update from here. A changed starting pitcher re-scores that game.`}>
                  <Icon name="Lock" size={10} style={{ color: 'var(--prime)' }} /> locked {new Date(meta.morningLockAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              </>
            )}
          </div>
          {sport === 'mlb' && total > 0 && (
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
        {sport === 'nfl' && (
          <div className="metric-pill model-health nfl-feed-health" title={meta.sourceMode === 'demo' ? 'NFL demo fallback' : `NFL feed connected · odds ${meta.oddsStatus || 'unknown'}`}>
            <span className="model-health-gauge" aria-hidden="true"><Icon name={meta.sourceMode === 'demo' ? 'Beaker' : 'Activity'} size={15} /></span>
            <span className="model-health-copy">
              <span className="model-health-main"><strong>{meta.sourceMode === 'demo' ? 'Demo' : 'Live'}</strong><small>NFL feed</small></span>
              <span className="model-health-meta"><span>{meta.sourceMode === 'demo' ? 'Fallback' : meta.oddsStatus === 'ok' ? 'Odds on' : 'Stats on'}</span></span>
            </span>
          </div>
        )}
        <button
          className="metric-pill model-health"
          style={sport === 'nfl' ? { display: 'none' } : undefined}
          onClick={onOpenModel}
          title={
            slateStale
              ? `Model accuracy & calibration. Slate generated ${meta.generatedAt} — scores/innings are from then, not live-now.`
              : `Model accuracy & calibration. Generated ${meta.generatedAt}`
          }
          aria-label={`Model health. Brier ${m ? m.brier.toFixed(4) : 'unavailable'}${brierEdge != null ? `, ${pct(Math.abs(brierEdge), 0)} ${brierEdge >= 0 ? 'better' : 'worse'} than baseline` : ''}. ${slateStale ? 'Stale' : 'Updated'} ${timeAgo(meta.generatedAt)}.`}
        >
          <span className="model-health-gauge" aria-hidden="true">
            <Icon name="Gauge" size={15} />
          </span>
          <span className="model-health-copy">
            <span className="model-health-main">
              <strong className="mono">{m ? m.brier.toFixed(4) : '—'}</strong>
              <small>Brier</small>
            </span>
            <span className={`model-health-meta ${slateStale ? 'stale' : ''}`}>
              {brierEdge != null && (
                <span className={`metric-delta ${brierEdge >= 0 ? 'up' : 'down'} mono`}>
                  {brierEdge >= 0 ? '▲' : '▼'} {pct(Math.abs(brierEdge), 0)}
                </span>
              )}
              <span className="model-health-dot" aria-hidden="true" />
              <span>{slateStale ? 'Stale' : 'Updated'} {timeAgo(meta.generatedAt)}</span>
            </span>
          </span>
        </button>

        <span className="header-health-divider" aria-hidden="true" style={sport === 'nfl' ? { display: 'none' } : undefined} />

        <div className="header-actions" role="group" aria-label="App controls">
          <button
            className={`header-action-btn live-btn ${liveScores ? 'on' : ''}`}
            style={sport === 'nfl' ? { display: 'none' } : undefined}
            onClick={onToggleLive}
            title={
              liveScores
                ? 'Live scores & innings auto-updating — tap to view pregame only'
                : 'Pregame only — tap to enable live updates'
            }
            aria-pressed={liveScores}
            aria-label={liveScores ? 'Live scores on' : 'Pregame look'}
          >
            <Icon name={liveScores ? 'Activity' : 'Clock'} size={17} className={liveScores ? 'spin-pulse' : ''} />
          </button>

          <button
            className="header-action-btn eli-btn"
            onClick={onCycleEli}
            title={
              eliLevel === 'eli5'
                ? 'Explanations: Plain English (ELI5). Tap for stats depth (ELI15).'
                : 'Explanations: Stats depth (ELI15). Tap for plain English (ELI5).'
            }
            aria-label={`Explanation depth: ${eliLevel}`}
          >
            <Icon name={eliLevel === 'eli5' ? 'Sparkles' : 'BarChart3'} size={17} />
          </button>

          <HelpMenu
            sport={sport}
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

          <span className="header-health-divider header-refresh-divider" aria-hidden="true" />

          <button
            className={`icon-btn header-refresh-btn ${refreshing ? 'refreshing' : ''} ${holding ? 'holding' : ''}`}
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
            <Icon name={slateBuilding ? 'Loader' : 'RefreshCw'} size={17} className={refreshing ? 'animate-spin' : ''} style={{ position: 'relative' }} />
          </button>
        </div>
      </div>
    </header>
  )
}
