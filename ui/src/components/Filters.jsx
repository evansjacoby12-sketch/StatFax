import { useEffect, useState, useRef } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'
import Select from './Select.jsx'
import { GRADE_ORDER, gradeColor, BADGES } from '../lib/badges.js'
import { SORTS } from '../lib/constants.js'
import { useLiveMode } from '../lib/liveMode.js'
import { SPORT_UI } from '../lib/sportUi.js'
import { hexA } from './atoms.jsx'

// Keep the phone panel scan-first. These are the broadest, most actionable
// signal lenses; every other signal remains one tap away behind "Show more".
const MOBILE_PRIMARY_SIGNALS = new Set(['precision', 'hot', 'due', 'pitchEdge', 'pitchMixEdge'])

// Segmented view switcher with a sliding glow indicator. The indicator is one
// absolutely-positioned pill measured off the active button, so it glides
// between tabs instead of the active style teleporting.
function ViewToggle({ view, onView }) {
  const activeId = view === 'combos' ? 'results' : view

  return (
    <CommandTabs
      className="view-toggle"
      variant="workspace"
      label="Primary workspace"
      value={activeId}
      onChange={onView}
      tabs={SPORT_UI.mlb.primaryViews.map((tab, index) => ({
        ...tab,
        iconSize: 14,
        title: `${tab.desc} — press ${index + 1}`,
      }))}
    />
  )
}

export default function Filters({ value, onChange, gradeCounts, games, badgeCounts, watchCount, view, onView, betaEnabled = false }) {
  const v = value
  const liveMode = useLiveMode()
  const [open, setOpen] = useState(false)
  const [showAllSignals, setShowAllSignals] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef(null)
  const showFilters = view === 'board' || view === 'games'

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen])
  
  const toggleGrade = (g) => {
    const next = new Set(v.grades)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    onChange({ grades: next })
  }
  
  const toggleBadge = (key) => {
    const next = new Set(v.badges)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange({ badges: next })
  }

  const activeMore =
    v.gamePks.size + (v.confirmedOnly ? 1 : 0) + (v.watchedOnly ? 1 : 0) + (v.hotOnly ? 1 : 0) + (v.precisionOnly ? 1 : 0) + (v.sleepersOnly ? 1 : 0) + v.badges.size
  const visibleBadges = BADGES.filter((b) => betaEnabled || (b.key !== 'powerReady' && b.key !== 'barrelReady'))
  const badgeDefs = visibleBadges.filter((b) => v.badges.has(b.key))
  const hiddenSignalCount = visibleBadges.filter((b) => !MOBILE_PRIMARY_SIGNALS.has(b.key) && !v.badges.has(b.key)).length

  const clearAdvancedFilters = () => onChange({
    gamePks: new Set(),
    confirmedOnly: false,
    watchedOnly: false,
    hotOnly: false,
    precisionOnly: false,
    sleepersOnly: false,
    badges: new Set(),
  })

  return (
    <div className="filters">
      <div className="filters-row">
        <ViewToggle view={view} onView={onView} />

        {showFilters ? (
          <>
            <button
              type="button"
              className={`mobile-search-trigger ${v.q ? 'on' : ''}`}
              onClick={() => setSearchOpen(true)}
              aria-expanded={searchOpen}
              aria-controls="mobile-board-search"
              aria-label={v.q ? `Search active: ${v.q}` : 'Search board'}
            >
              <Icon name="Search" size={17} />
              {v.q && <span aria-hidden="true" />}
            </button>
            <label id="mobile-board-search" className={`search ${searchOpen ? 'mobile-search-open' : ''}`} style={{ border: v.q ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
              <Icon name="Search" size={14} style={{ color: v.q ? 'var(--accent)' : 'var(--text-faint)' }} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search…"
                value={v.q}
                onChange={(e) => onChange({ q: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setSearchOpen(false)
                }}
                aria-label="Search"
              />
              {(v.q || searchOpen) && (
                <button
                  type="button"
                  className="search-clear"
                  onClick={() => (v.q ? onChange({ q: '' }) : setSearchOpen(false))}
                  aria-label={v.q ? 'Clear search' : 'Close search'}
                >
                  <Icon name="X" size={12} />
                </button>
              )}
            </label>

            <div className="grade-spectrum-rail" role="group" aria-label="Filter by grade">
              <span className="grade-spectrum-label" aria-hidden="true">Grades</span>
              {GRADE_ORDER.map((g) => {
                const on = v.grades.has(g)
                const c = gradeColor(g)
                return (
                  <button
                    key={g}
                    type="button"
                    className={`grade-segment ${on ? 'on' : ''}`}
                    onClick={() => toggleGrade(g)}
                    aria-pressed={on}
                    style={{ '--grade-color': c }}
                    title={`${g} — ${gradeCounts[g] || 0} batters`}
                  >
                    <span className="grade-segment-indicator" aria-hidden="true" />
                    <Icon className="grade-segment-state" name={on ? 'CircleCheck' : 'Circle'} size={14} aria-hidden="true" />
                    <span className="grade-segment-name">{g}</span>
                    <span className="grade-segment-count mono">{gradeCounts[g] || 0}</span>
                  </button>
                )
              })}
            </div>

            <div className="filters-spacer" />

            <Select
              icon="ArrowUpDown"
              title="Sort"
              ariaLabel="Sort by"
              value={v.sort}
              onChange={(val) => onChange({ sort: val })}
              options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
            />

            <button
              className={`toggle-btn more-btn chevron-btn ${open ? 'open' : ''} ${activeMore ? 'on' : ''}`}
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={`Filters${activeMore ? ` (${activeMore} active)` : ''}`}
              title="More filters"
              style={{
                borderColor: open ? 'var(--accent)' : activeMore ? 'var(--accent)' : 'var(--border)',
                background: open ? 'var(--hover)' : activeMore ? 'rgba(151, 149, 203, 0.08)' : 'var(--card)',
                color: open || activeMore ? '#fff' : 'var(--text-dim)'
              }}
            >
              <Icon name="ChevronDown" size={18} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              {activeMore > 0 && <span className="more-count mono" style={{ background: 'var(--accent)' }}>{activeMore}</span>}
            </button>
          </>
        ) : null}
      </div>

      {showFilters && !open && activeMore > 0 && (
        <div className="active-chips" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
          {[...v.gamePks].map((pk) => (
            <FilterChip
              key={pk}
              label={gameLabel(games, pk)}
              onClear={() => {
                const next = new Set(v.gamePks)
                next.delete(pk)
                onChange({ gamePks: next })
              }}
            />
          ))}
          {v.confirmedOnly && <FilterChip label="Action ready" onClear={() => onChange({ confirmedOnly: false })} />}
          {v.watchedOnly && <FilterChip label="Watchlist" onClear={() => onChange({ watchedOnly: false })} />}
          {v.hotOnly && <FilterChip label="Heating up" icon="Flame" onClear={() => onChange({ hotOnly: false })} />}
          {v.precisionOnly && <FilterChip label="Precision" icon="Focus" onClear={() => onChange({ precisionOnly: false })} />}
          {v.sleepersOnly && <FilterChip label="Sleepers" icon="MoonStar" onClear={() => onChange({ sleepersOnly: false })} />}
          {badgeDefs.map((bd) => (
            <FilterChip
              key={bd.key}
              label={bd.label}
              icon={bd.lucide}
              onClear={() => {
                const next = new Set(v.badges)
                next.delete(bd.key)
                onChange({ badges: next })
              }}
            />
          ))}
        </div>
      )}

      {showFilters && open && (
        <div className="filters-panel" style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          padding: '16px',
          marginTop: '12px'
        }}>
          <div className="mobile-filter-panel-head">
            <span>
              <Icon name="SlidersHorizontal" size={14} /> Filter board
              {activeMore > 0 && <b className="mono">{activeMore}</b>}
            </span>
            {activeMore > 0 && <button type="button" onClick={clearAdvancedFilters}>Clear all</button>}
          </div>
          <div className="filters-row fp-controls">
            <div className="mobile-advanced-sort mobile-filter-field">
              <span className="mobile-filter-field-label">Sort by</span>
              <Select
                icon="ArrowUpDown"
                title="Sort"
                ariaLabel="Sort board by"
                value={v.sort}
                onChange={(val) => onChange({ sort: val })}
                options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
              />
            </div>
            <div className="mobile-game-filter mobile-filter-field">
              <span className="mobile-filter-field-label">Game</span>
              <Select
              multi
              icon="MapPin"
              title="Filter by game"
              ariaLabel="Filter by game"
              value={v.gamePks}
              onChange={(val) => onChange({ gamePks: val })}
              options={[
                { value: '', label: 'All games' },
                ...games.map((g) => ({
                  value: g.gamePk,
                  label: `${g.awayTeam.abbr} @ ${g.homeTeam.abbr}${liveMode && g.isLive ? ' · LIVE' : ''}`,
                })),
              ]}
              />
            </div>

            <div className="mobile-quick-block">
              <span className="mobile-filter-section-label">Quick filters</span>
              <div className="mobile-quick-scroll" role="group" aria-label="Quick filters">
            <button
              className={`toggle-btn ${v.confirmedOnly ? 'on' : ''}`}
              onClick={() => onChange({ confirmedOnly: !v.confirmedOnly })}
              aria-pressed={v.confirmedOnly}
              title="Only hitters in posted starting lineups"
              style={v.confirmedOnly ? {
                background: 'rgba(105, 185, 158, 0.1)',
                borderColor: 'var(--strong)',
                color: 'var(--strong)'
              } : {}}
            >
              <Icon name={v.confirmedOnly ? 'Check' : 'ListFilter'} size={14} />
              Action ready
            </button>

            <button
              className={`toggle-btn star-toggle ${v.watchedOnly ? 'on' : ''}`}
              onClick={() => onChange({ watchedOnly: !v.watchedOnly })}
              aria-pressed={v.watchedOnly}
              title="Only batters on your watchlist"
              style={v.watchedOnly ? {
                background: 'rgba(214, 181, 111, 0.1)',
                borderColor: 'var(--prime)',
                color: 'var(--prime)'
              } : {}}
            >
              <Icon name="Star" size={14} />
              Watchlist
              {watchCount > 0 && <span className="badge-toggle-n mono" style={{ background: 'var(--prime)', color: '#000' }}>{watchCount}</span>}
            </button>

            <button
              className={`toggle-btn hot-toggle ${v.hotOnly ? 'on' : ''}`}
              onClick={() => onChange({ hotOnly: !v.hotOnly })}
              aria-pressed={v.hotOnly}
              title="Only bats with Heat index >= 58"
              style={v.hotOnly ? {
                background: 'rgba(249, 115, 22, 0.1)',
                borderColor: 'var(--b-hot)',
                color: 'var(--b-hot)'
              } : {}}
            >
              <Icon name="Flame" size={14} />
              Heating up
            </button>

            <button
              className={`toggle-btn ${v.precisionOnly ? 'on' : ''}`}
              onClick={() => onChange({ precisionOnly: !v.precisionOnly })}
              aria-pressed={v.precisionOnly}
              title="Only batters meeting all precision gates (pitch mix ≥7, heat ≥48, HR due 5/6+, 8+ positive trends, ≤3 negatives)"
              style={v.precisionOnly ? {
                background: 'rgba(151, 149, 203, 0.1)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)'
              } : {}}
            >
              <Icon name="Focus" size={14} />
              Precision
            </button>

            <button
              className={`toggle-btn ${v.sleepersOnly ? 'on' : ''}`}
              onClick={() => onChange({ sleepersOnly: !v.sleepersOnly })}
              aria-pressed={v.sleepersOnly}
              title="Under-the-radar value: STRONG/LEAN bats with PRIME-adjacent form (heat ≥48, setup 3/6+, hot or rising) — hit 21% over the validation window"
              style={v.sleepersOnly ? {
                background: 'rgba(139, 92, 246, 0.12)',
                borderColor: '#9085bd',
                color: '#a78bfa'
              } : {}}
            >
              <Icon name="MoonStar" size={14} />
              Sleepers
            </button>
              </div>
            </div>
          </div>

          <div className={`filters-row badges-row ${showAllSignals ? 'signals-expanded' : ''}`} style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '14px' }}>
            <span className="badges-row-label">
              <span><Icon name="SlidersHorizontal" size={12} style={{ color: 'var(--accent)' }} /> Signals</span>
              <small>{v.badges.size ? `${v.badges.size} selected, match all` : 'Choose a signal lens'}</small>
            </span>
            <button 
              className={`badge-toggle ${!v.badges.size ? 'on' : ''}`} 
              onClick={() => onChange({ badges: new Set() })}
              aria-pressed={!v.badges.size}
              style={{
                borderColor: !v.badges.size ? 'var(--accent)' : 'var(--border-soft)',
                background: !v.badges.size ? 'var(--hover)' : 'transparent',
                color: !v.badges.size ? '#fff' : 'var(--text-faint)'
              }}
            >
              Any
            </button>
            {visibleBadges.map((b) => {
              const has = v.badges.has(b.key)
              const primary = MOBILE_PRIMARY_SIGNALS.has(b.key) || has
              return (
                <button
                  key={b.key}
                  className={`badge-toggle ${has ? 'on' : ''} ${primary ? 'signal-primary' : 'signal-secondary'}`}
                  onClick={() => toggleBadge(b.key)}
                  aria-pressed={has}
                  style={{
                    color: has ? b.color : 'var(--text-faint)',
                    borderColor: has ? hexA(b.color, 0.4) : 'var(--border-soft)',
                    background: has ? hexA(b.color, 0.08) : 'transparent'
                  }}
                  title={b.desc}
                >
                  <Icon name={b.lucide} size={12} />
                  {b.label}
                  <span className="badge-toggle-n mono" style={{ opacity: has ? 1 : 0.6 }}>{badgeCounts[b.key] || 0}</span>
                </button>
              )
            })}
            {(hiddenSignalCount > 0 || showAllSignals) && (
              <button
                type="button"
                className="mobile-signals-more"
                onClick={() => setShowAllSignals((shown) => !shown)}
                aria-expanded={showAllSignals}
              >
                <Icon name={showAllSignals ? 'ChevronUp' : 'ChevronDown'} size={14} />
                {showAllSignals ? 'Show fewer' : `Show ${hiddenSignalCount} more`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, icon, onClear }) {
  return (
    <button 
      className="active-chip" 
      onClick={onClear} 
      title="Remove filter"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: 'rgba(151, 149, 203, 0.1)',
        border: '1px solid rgba(151, 149, 203, 0.25)',
        borderRadius: '8px',
        padding: '4px 10px',
        fontSize: '12px',
        color: '#e2e8f0',
        cursor: 'pointer'
      }}
    >
      {icon && <Icon name={icon} size={11} style={{ color: 'var(--accent)' }} />}
      <span>{label}</span>
      <Icon name="X" size={11} style={{ opacity: 0.6 }} />
    </button>
  )
}

function gameLabel(games, pk) {
  const g = games.find((x) => String(x.gamePk) === String(pk))
  return g ? `${g.awayTeam.abbr} @ ${g.homeTeam.abbr}` : 'Game'
}
