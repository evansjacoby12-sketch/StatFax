import BatterRow from './BatterRow.jsx'
import Icon from './Icon.jsx'

export default function BatterTable({
  batters,
  onSelect,
  selectedId,
  sort,
  dir,
  onSort,
  watchlist,
  slip,
  onToggleWatch,
  onToggleSlip,
}) {
  const HeadCol = ({ k, children, className, title }) => {
    const active = sort === k
    return (
      <button
        className={`th sortable ${className || ''} ${active ? 'active' : ''}`}
        onClick={() => onSort(k)}
        type="button"
        title={title ? `${title} — click to sort` : 'Click to sort'}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {children}
        {active ? (
          <Icon name={dir === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={12} />
        ) : (
          <Icon name="ArrowUpDown" size={11} className="sort-hint" />
        )}
      </button>
    )
  }

  return (
    <div className="board">
      <div className="board-head">
        <div className="th col-rank" title="Rank by current sort">#</div>
        <HeadCol k="name" className="col-batter" title="Batter, team vs opponent, and starting pitcher">
          Batter
        </HeadCol>
        <HeadCol k="score" className="col-grade" title="Model grade: PRIME / STRONG / LEAN / SKIP">
          Grade
        </HeadCol>
        <HeadCol k="hrProbability" className="col-prob" title="Calibrated chance of ≥1 HR today">
          HR Probability
        </HeadCol>
        <HeadCol k="expectedHRs" className="col-xhr" title="Expected HRs this game (sum of per-PA odds)">
          xHR
        </HeadCol>
        <HeadCol k="heat" className="col-rating" title="Heat index — current form (0–100); tap a batter for the why">
          Heat
        </HeadCol>
        <div className="th col-signals" title="Active model signals (hot, due, edges…)">
          Signals
        </div>
        <div className="th col-actions" title="Watchlist & parlay" />
      </div>

      <div className="board-body">
        {batters.length === 0 ? (
          <div className="empty">
            <Icon name="Search" size={28} />
            <p>No batters match these filters.</p>
          </div>
        ) : (
          batters.map((b, i) => (
            <BatterRow
              key={b.id}
              batter={b}
              rank={i + 1}
              onSelect={onSelect}
              selected={selectedId === b.id}
              watched={watchlist.has(b.id)}
              inSlip={slip.has(b.id)}
              onToggleWatch={onToggleWatch}
              onToggleSlip={onToggleSlip}
            />
          ))
        )}
      </div>
    </div>
  )
}
