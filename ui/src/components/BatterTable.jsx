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
  onOpenPitcher,
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
        style={{
          color: active ? 'var(--accent)' : 'var(--text-faint)',
          fontWeight: active ? '800' : '600',
          position: 'relative'
        }}
      >
        <span style={{ marginRight: '4px' }}>{children}</span>
        {active ? (
          <Icon name={dir === 'asc' ? 'ChevronUp' : 'ChevronDown'} size={12} style={{ color: 'var(--accent)' }} />
        ) : (
          <Icon name="ArrowUpDown" size={10} className="sort-hint" style={{ opacity: 0.5 }} />
        )}
      </button>
    )
  }

  return (
    <div className="board">
      <div className="board-head">
        <div className="th col-rank" title="Rank by current sort" style={{ fontWeight: '800' }}>#</div>
        <HeadCol k="name" className="col-batter" title="Batter, team vs opponent, and starting pitcher">
          Batter
        </HeadCol>
        <HeadCol k="score" className="col-grade" title="Model grade: PRIME / STRONG / LEAN / SKIP">
          Grade
        </HeadCol>
        <HeadCol k="hrProbability" className="col-prob" title="Calibrated chance of >=1 HR today">
          Prob
        </HeadCol>
        <HeadCol k="expectedHRs" className="col-xhr" title="Expected HRs this game">
          xHR
        </HeadCol>
        <HeadCol k="heat" className="col-rating" title="Heat index — current form (0-100)">
          Heat
        </HeadCol>
        <div className="th col-signals" title="Active model signals (hot, due, edges...)">
          Signals
        </div>
        <div className="th col-actions" title="Watchlist & parlay" />
      </div>

      <div className="board-body">
        {batters.length === 0 ? (
          <div className="empty" style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '48px 24px',
            color: 'var(--text-faint)',
            gap: '12px'
          }}>
            <Icon name="Search" size={32} />
            <p style={{ fontSize: '14px', fontWeight: '500' }}>No batters match these filters.</p>
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
              onOpenPitcher={onOpenPitcher}
            />
          ))
        )}
      </div>
    </div>
  )
}
