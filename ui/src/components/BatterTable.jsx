import { useState } from 'react'
import BatterRow from './BatterRow.jsx'
import Icon from './Icon.jsx'

// Divider between the confirmed-lineup plays and the projected (roster-fallback)
// bats. Collapsible because pre-lineup the projected group is the whole roster.
function ProjectedDivider({ count, open, onToggle }) {
  return (
    <button className="board-proj-divider" onClick={onToggle} aria-expanded={open} type="button">
      <Icon name="Clock" size={13} />
      <span>Projected · lineups not posted</span>
      <span className="proj-count">{count}</span>
      <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={15} style={{ marginLeft: 'auto' }} />
    </button>
  )
}

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
  splitProjected = false,
}) {
  const [projOpen, setProjOpen] = useState(true)
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
        ) : (() => {
          // batters arrive confirmed-first (App.jsx sort), so all confirmed bats
          // are one contiguous block at the top; the rest are projected. When the
          // split is toggled off, firstProj = -1 → one flat, undivided list.
          const firstProj = splitProjected ? batters.findIndex((b) => !b.lineupConfirmed) : -1
          const renderRow = (b, rank) => (
            <BatterRow
              key={b.id}
              batter={b}
              rank={rank}
              onSelect={onSelect}
              selected={selectedId === b.id}
              watched={watchlist.has(b.id)}
              inSlip={slip.has(b.id)}
              onToggleWatch={onToggleWatch}
              onToggleSlip={onToggleSlip}
              onOpenPitcher={onOpenPitcher}
            />
          )
          if (firstProj === -1) return batters.map((b, i) => renderRow(b, i + 1))
          return (
            <>
              {batters.slice(0, firstProj).map((b, i) => renderRow(b, i + 1))}
              <ProjectedDivider count={batters.length - firstProj} open={projOpen} onToggle={() => setProjOpen((o) => !o)} />
              {projOpen && batters.slice(firstProj).map((b, i) => renderRow(b, firstProj + i + 1))}
            </>
          )
        })()}
      </div>
    </div>
  )
}
