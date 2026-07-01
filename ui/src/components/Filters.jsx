import { useState } from 'react'
import Icon from './Icon.jsx'
import Select from './Select.jsx'
import { GRADE_ORDER, gradeColor, BADGES } from '../lib/badges.js'
import { SORTS } from '../lib/constants.js'
import { useLiveMode } from '../lib/liveMode.js'
import { hexA } from './atoms.jsx'

export default function Filters({ value, onChange, gradeCounts, games, badgeCounts, watchCount, view, onView }) {
  const v = value
  const liveMode = useLiveMode()
  const [open, setOpen] = useState(false)
  const showFilters = view === 'board' || view === 'games'
  
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
    v.gamePks.size + (v.confirmedOnly ? 1 : 0) + (v.watchedOnly ? 1 : 0) + (v.hotOnly ? 1 : 0) + (v.precisionOnly ? 1 : 0) + v.badges.size
  const badgeDefs = BADGES.filter((b) => v.badges.has(b.key))

  return (
    <div className="filters">
      <div className="filters-row">
        <div className="view-toggle" role="group" aria-label="View">
          {[
            { id: 'board', label: 'Board', icon: 'List', desc: 'Ranked board' },
            { id: 'games', label: 'Games', icon: 'LayoutGrid', desc: 'Game-by-game' },
            { id: 'pitchers', label: 'Pitchers', icon: 'Crosshair', desc: 'Pitcher vulnerability' },
            { id: 'weather', label: 'Weather', icon: 'Wind', desc: 'Weather report' },
            { id: 'results', label: 'Results', icon: 'Activity', desc: 'Model track record + combos' }
          ].map((tab) => (
            <button 
              key={tab.id}
              className={`view-btn ${view === tab.id || (tab.id === 'results' && view === 'combos') ? 'on' : ''}`}
              onClick={() => onView(tab.id)} 
              title={tab.desc}
              style={view === tab.id ? {
                background: 'var(--hover)',
                borderColor: 'var(--accent)',
                color: '#fff',
                boxShadow: '0 0 12px var(--accent-glow)'
              } : {}}
            >
              <Icon name={tab.icon} size={14} style={{ color: view === tab.id ? 'var(--accent)' : 'inherit' }} />
              {tab.label}
            </button>
          ))}
        </div>

        {showFilters ? (
          <>
            <label className="search" style={{ border: v.q ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
              <Icon name="Search" size={14} style={{ color: v.q ? 'var(--accent)' : 'var(--text-faint)' }} />
              <input
                type="text"
                placeholder="Search batter, team, pitcher..."
                value={v.q}
                onChange={(e) => onChange({ q: e.target.value })}
                aria-label="Search"
              />
              {v.q && (
                <button className="search-clear" onClick={() => onChange({ q: '' })} aria-label="Clear search">
                  <Icon name="X" size={12} />
                </button>
              )}
            </label>

            <div className="grade-pills" role="group" aria-label="Filter by grade">
              {GRADE_ORDER.map((g) => {
                const on = v.grades.has(g)
                const c = gradeColor(g)
                return (
                  <button
                    key={g}
                    className={`grade-pill ${on ? 'on' : ''}`}
                    onClick={() => toggleGrade(g)}
                    style={{
                      color: on ? c : 'var(--text-faint)',
                      borderColor: on ? hexA(c, 0.45) : 'var(--border)',
                      background: on ? `linear-gradient(135deg, ${hexA(c, 0.12)} 0%, ${hexA(c, 0.04)} 100%)` : 'var(--card)',
                      boxShadow: on ? `0 0 10px ${hexA(c, 0.1)}` : 'none'
                    }}
                    title={`${g} — ${gradeCounts[g] || 0} batters`}
                  >
                    <span className="grade-pill-dot" style={{ background: c, boxShadow: on ? `0 0 8px ${c}` : 'none' }} />
                    {g}
                    <span className="grade-pill-n mono">{gradeCounts[g] || 0}</span>
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
                background: open ? 'var(--hover)' : activeMore ? 'rgba(0, 216, 246, 0.08)' : 'var(--card)',
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
          {v.confirmedOnly && <FilterChip label="Confirmed" onClear={() => onChange({ confirmedOnly: false })} />}
          {v.watchedOnly && <FilterChip label="Watchlist" onClear={() => onChange({ watchedOnly: false })} />}
          {v.hotOnly && <FilterChip label="Heating up" icon="Flame" onClear={() => onChange({ hotOnly: false })} />}
          {v.precisionOnly && <FilterChip label="Precision" icon="Sparkles" onClear={() => onChange({ precisionOnly: false })} />}
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
          <div className="filters-row fp-controls">
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

            <button
              className={`toggle-btn ${v.confirmedOnly ? 'on' : ''}`}
              onClick={() => onChange({ confirmedOnly: !v.confirmedOnly })}
              title="Only batters in confirmed lineups"
              style={v.confirmedOnly ? {
                background: 'rgba(16, 185, 129, 0.1)',
                borderColor: 'var(--strong)',
                color: 'var(--strong)'
              } : {}}
            >
              <Icon name={v.confirmedOnly ? 'Check' : 'ListFilter'} size={14} />
              Confirmed
            </button>

            <button
              className={`toggle-btn star-toggle ${v.watchedOnly ? 'on' : ''}`}
              onClick={() => onChange({ watchedOnly: !v.watchedOnly })}
              title="Only batters on your watchlist"
              style={v.watchedOnly ? {
                background: 'rgba(245, 166, 35, 0.1)',
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
              title="Only batters meeting all precision gates (pitch mix ≥7, heat ≥48, HR due 4/6+, 9+ positive trends, ≤3 negatives)"
              style={v.precisionOnly ? {
                background: 'rgba(0, 216, 246, 0.1)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)'
              } : {}}
            >
              <Icon name="Sparkles" size={14} />
              Precision
            </button>
          </div>

          <div className="filters-row badges-row" style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '14px' }}>
            <span className="badges-row-label">
              <Icon name="SlidersHorizontal" size={12} style={{ color: 'var(--accent)' }} /> Signals
            </span>
            <button 
              className={`badge-toggle ${!v.badges.size ? 'on' : ''}`} 
              onClick={() => onChange({ badges: new Set() })}
              style={{
                borderColor: !v.badges.size ? 'var(--accent)' : 'var(--border-soft)',
                background: !v.badges.size ? 'var(--hover)' : 'transparent',
                color: !v.badges.size ? '#fff' : 'var(--text-faint)'
              }}
            >
              Any
            </button>
            {BADGES.map((b) => {
              const has = v.badges.has(b.key)
              return (
                <button
                  key={b.key}
                  className={`badge-toggle ${has ? 'on' : ''}`}
                  onClick={() => toggleBadge(b.key)}
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
        background: 'rgba(0, 216, 246, 0.1)',
        border: '1px solid rgba(0, 216, 246, 0.25)',
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
