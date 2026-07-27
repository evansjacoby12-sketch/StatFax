import Icon from './Icon.jsx'
import { GAME_STATE_FILTERS, GAME_TIME_FILTERS } from '../lib/gameFilters.js'

function FilterChips({ label, options, value, onChange }) {
  return (
    <div className="game-filter-group" role="group" aria-label={label}>
      {options.map((option) => {
        const active = value === option.id
        return (
          <button
            key={option.id}
            type="button"
            className={`game-filter-chip${active ? ' active' : ''}${option.id === 'live' ? ' live' : ''}`}
            aria-pressed={active}
            onClick={() => onChange(option.id)}
          >
            {option.id === 'live' && <span className="game-filter-live-dot" aria-hidden="true" />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export default function GameFilterBar({
  query,
  onQueryChange,
  state,
  onStateChange,
  timeWindow,
  onTimeWindowChange,
  sortDirection,
  onSortDirectionChange,
  shownCount,
  totalCount,
  filtersActive,
  onClear,
}) {
  const earliestFirst = sortDirection !== 'desc'

  return (
    <section className="game-filter-bar" aria-label="Filter and sort games">
      <label className="game-filter-search">
        <Icon name="Search" size={15} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search team"
          aria-label="Search games by team"
        />
        {query && (
          <button type="button" onClick={() => onQueryChange('')} aria-label="Clear team search">
            <Icon name="X" size={14} />
          </button>
        )}
      </label>

      <div className="game-filter-rail">
        <FilterChips label="Game state" options={GAME_STATE_FILTERS} value={state} onChange={onStateChange} />
        <FilterChips label="Start time" options={GAME_TIME_FILTERS} value={timeWindow} onChange={onTimeWindowChange} />
      </div>

      <div className="game-filter-meta">
        <button
          type="button"
          className="game-filter-sort"
          onClick={() => onSortDirectionChange(earliestFirst ? 'desc' : 'asc')}
          aria-label={`Sort ${earliestFirst ? 'latest' : 'earliest'} games first`}
          title={`Currently ${earliestFirst ? 'earliest' : 'latest'} first`}
        >
          <Icon name="ArrowUpDown" size={14} />
          <span>{earliestFirst ? 'Earliest' : 'Latest'}</span>
        </button>
        <span className="game-filter-count mono" aria-live="polite">
          <strong>{shownCount}</strong> of {totalCount}
        </span>
        {filtersActive && (
          <button type="button" className="game-filter-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
    </section>
  )
}
