import { useState } from 'react'
import Icon from './Icon.jsx'
import { GRADE_ORDER, gradeColor, BADGES } from '../lib/badges.js'
import { SORTS } from '../lib/constants.js'
import { useLiveMode } from '../lib/liveMode.js'
import { hexA } from './atoms.jsx'

export default function Filters({ value, onChange, gradeCounts, games, badgeCounts, watchCount, view, onView }) {
  const v = value
  const liveMode = useLiveMode()
  const [open, setOpen] = useState(false)
  // Search / grade pills / sort / more-filters apply to the ranked batter list,
  // so they only make sense on Board & Games. Pitchers, Weather, and Results
  // are their own views (Weather has its own sort/filter bar) and show the full
  // slate — keep this row to just the view tabs there.
  const showFilters = view === 'board' || view === 'games'
  const toggleGrade = (g) => {
    const next = new Set(v.grades)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    onChange({ grades: next })
  }
  // Count of active "secondary" filters tucked behind the disclosure.
  const activeMore =
    (v.gamePk ? 1 : 0) + (v.confirmedOnly ? 1 : 0) + (v.watchedOnly ? 1 : 0) + (v.hotOnly ? 1 : 0) + (v.badge ? 1 : 0)
  const badgeDef = BADGES.find((b) => b.key === v.badge)

  return (
    <div className="filters">
      <div className="filters-row">
        <div className="view-toggle" role="group" aria-label="View">
          <button className={`view-btn ${view === 'board' ? 'on' : ''}`} onClick={() => onView('board')} title="Ranked board">
            <Icon name="List" size={15} />
            Board
          </button>
          <button className={`view-btn ${view === 'games' ? 'on' : ''}`} onClick={() => onView('games')} title="Game-by-game">
            <Icon name="LayoutGrid" size={15} />
            Games
          </button>
          <button className={`view-btn ${view === 'pitchers' ? 'on' : ''}`} onClick={() => onView('pitchers')} title="Pitcher plan — vulnerability + HR targets">
            <Icon name="Crosshair" size={15} />
            Pitchers
          </button>
          <button className={`view-btn ${view === 'weather' ? 'on' : ''}`} onClick={() => onView('weather')} title="Weather report — wind, park & air by game">
            <Icon name="Wind" size={15} />
            Weather
          </button>
          <button className={`view-btn ${view === 'results' ? 'on' : ''}`} onClick={() => onView('results')} title="Model track record">
            <Icon name="Activity" size={15} />
            Results
          </button>
        </div>

        {showFilters ? (
        <>
        <label className="search">
          <Icon name="Search" size={15} />
          <input
            type="text"
            placeholder="Search batter, team, or pitcher…"
            value={v.q}
            onChange={(e) => onChange({ q: e.target.value })}
            aria-label="Search"
          />
          {v.q && (
            <button className="search-clear" onClick={() => onChange({ q: '' })} aria-label="Clear search">
              <Icon name="X" size={13} />
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
                style={on ? { color: c, borderColor: hexA(c, 0.5), background: hexA(c, 0.14) } : undefined}
                title={`${g} — ${gradeCounts[g] || 0} batters`}
              >
                <span className="grade-pill-dot" style={{ background: c }} />
                {g}
                <span className="grade-pill-n mono">{gradeCounts[g] || 0}</span>
              </button>
            )
          })}
        </div>

        <div className="filters-spacer" />

        <div className="select-wrap" title="Sort">
          <Icon name="ArrowUpDown" size={14} />
          <select value={v.sort} onChange={(e) => onChange({ sort: e.target.value })} aria-label="Sort by">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        <button
          className={`toggle-btn more-btn chevron-btn ${open ? 'open' : ''} ${activeMore ? 'on' : ''}`}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`Filters${activeMore ? ` (${activeMore} active)` : ''}`}
          title="More filters: game, lineup, watchlist, signals"
        >
          <Icon name="ChevronDown" size={18} />
          {/* Count sits absolutely in the corner so the button stays a fixed
              square — toggling a filter never changes its width or reflows the row. */}
          {activeMore > 0 && <span className="more-count mono">{activeMore}</span>}
        </button>
        </>
        ) : null}
      </div>

      {/* Active secondary filters stay visible as removable chips even when collapsed */}
      {showFilters && !open && activeMore > 0 && (
        <div className="active-chips">
          {v.gamePk && (
            <FilterChip label={gameLabel(games, v.gamePk)} onClear={() => onChange({ gamePk: '' })} />
          )}
          {v.confirmedOnly && <FilterChip label="Confirmed" onClear={() => onChange({ confirmedOnly: false })} />}
          {v.watchedOnly && <FilterChip label="Watchlist" onClear={() => onChange({ watchedOnly: false })} />}
          {v.hotOnly && <FilterChip label="Hot bats" icon="Flame" onClear={() => onChange({ hotOnly: false })} />}
          {badgeDef && <FilterChip label={badgeDef.label} icon={badgeDef.lucide} onClear={() => onChange({ badge: '' })} />}
        </div>
      )}

      {showFilters && open && (
        <div className="filters-panel">
          <div className="filters-row fp-controls">
            <div className="select-wrap" title="Filter by game">
              <Icon name="MapPin" size={14} />
              <select value={v.gamePk} onChange={(e) => onChange({ gamePk: e.target.value })} aria-label="Filter by game">
                <option value="">All games</option>
                {games.map((g) => (
                  <option key={g.gamePk} value={g.gamePk}>
                    {g.awayTeam.abbr} @ {g.homeTeam.abbr}
                    {liveMode && g.isLive ? ' · LIVE' : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              className={`toggle-btn ${v.confirmedOnly ? 'on' : ''}`}
              onClick={() => onChange({ confirmedOnly: !v.confirmedOnly })}
              title="Only batters in confirmed lineups"
            >
              <Icon name={v.confirmedOnly ? 'Check' : 'ListFilter'} size={14} />
              Confirmed
            </button>

            <button
              className={`toggle-btn star-toggle ${v.watchedOnly ? 'on' : ''}`}
              onClick={() => onChange({ watchedOnly: !v.watchedOnly })}
              title="Only batters on your watchlist"
            >
              <Icon name="Star" size={14} />
              Watchlist
              {watchCount > 0 && <span className="badge-toggle-n mono">{watchCount}</span>}
            </button>

            <button
              className={`toggle-btn hot-toggle ${v.hotOnly ? 'on' : ''}`}
              onClick={() => onChange({ hotOnly: !v.hotOnly })}
              title="Only hot bats (Heat index ≥ 58)"
            >
              <Icon name="Flame" size={14} />
              Hot bats
            </button>
          </div>

          <div className="filters-row badges-row">
            <span className="badges-row-label">
              <Icon name="SlidersHorizontal" size={12} /> Signals
            </span>
            <button className={`badge-toggle ${!v.badge ? 'on' : ''}`} onClick={() => onChange({ badge: '' })}>
              Any
            </button>
            {BADGES.map((b) => (
              <button
                key={b.key}
                className={`badge-toggle ${v.badge === b.key ? 'on' : ''}`}
                onClick={() => onChange({ badge: v.badge === b.key ? '' : b.key })}
                style={v.badge === b.key ? { color: b.color, borderColor: 'color-mix(in srgb,' + b.color + ' 45%, transparent)' } : undefined}
                title={b.desc}
              >
                <Icon name={b.lucide} size={12} />
                {b.label}
                <span className="badge-toggle-n mono">{badgeCounts[b.key] || 0}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, icon, onClear }) {
  return (
    <button className="active-chip" onClick={onClear} title="Remove filter">
      {icon && <Icon name={icon} size={11} />}
      {label}
      <Icon name="X" size={11} />
    </button>
  )
}

function gameLabel(games, pk) {
  const g = games.find((x) => String(x.gamePk) === String(pk))
  return g ? `${g.awayTeam.abbr} @ ${g.homeTeam.abbr}` : 'Game'
}
