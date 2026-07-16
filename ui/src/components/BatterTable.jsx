import { useRef, useLayoutEffect } from 'react'
import BatterRow from './BatterRow.jsx'
import Icon from './Icon.jsx'

// FLIP: when a sort/filter reorders the list, rows glide from their old slot
// to the new one instead of teleporting. We snapshot each row's top before
// paint, invert the delta as a transform, then release it into a transition.
// Rows that enter/leave or jump further than ~1.5 screens just appear — the
// glide only helps when the eye can actually follow it.
function useFlipRows(bodyRef, deps) {
  const prevTops = useRef(new Map())
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const nodes = body.querySelectorAll('.board-swipe[data-flip-id]')
    const next = new Map()
    for (const n of nodes) {
      const id = n.dataset.flipId
      const top = n.getBoundingClientRect().top
      next.set(id, top)
      if (reduce) continue
      const old = prevTops.current.get(id)
      if (old == null) continue
      const dy = old - top
      if (Math.abs(dy) < 4 || Math.abs(dy) > window.innerHeight * 1.5) continue
      n.style.transition = 'none'
      n.style.transform = `translateY(${dy}px)`
      requestAnimationFrame(() => {
        n.style.transition = 'transform 0.38s cubic-bezier(0.22, 1, 0.36, 1)'
        n.style.transform = ''
        setTimeout(() => { n.style.transition = ''; }, 420)
      })
    }
    prevTops.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
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
  betaEnabled = false,
  signalLimit = 2,
  total = 0,
  onClearFilters,
}) {
  const bodyRef = useRef(null)
  useFlipRows(bodyRef, [batters])
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
      <div className="board-head decision-ladder-head">
        <div className="th dl-rank" title="Rank by current sort">Rank</div>
        <HeadCol k="name" className="dl-identity" title="Batter, team vs opponent, and starting pitcher">
          Player identity
        </HeadCol>
        <HeadCol k="score" className="dl-verdict" title="Model grade and calibrated chance of at least one home run">
          Model verdict
        </HeadCol>
        <HeadCol k="expectedHRs" className="dl-proof" title="Expected home runs, heat, and strongest active signal">
          Supporting proof
        </HeadCol>
        <div className="th dl-actions" title="Watchlist & parlay">Actions</div>
      </div>

      <div className="board-body" ref={bodyRef}>
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
            <span className="empty-ball" aria-hidden="true">⚾</span>
            <p style={{ fontSize: '14px', fontWeight: '500' }}>
              {total > 0 ? `0 of ${total} batters match these filters.` : 'No batters match these filters.'}
            </p>
            {onClearFilters && total > 0 && (
              <button className="empty-clear" onClick={onClearFilters} type="button">
                <Icon name="X" size={13} /> Clear filters
              </button>
            )}
          </div>
        ) : batters.map((b, index) => (
            <BatterRow
              key={b.id}
              batter={b}
              rank={index + 1}
              onSelect={onSelect}
              selected={selectedId === b.id}
              watched={watchlist.has(b.id)}
              inSlip={slip.has(b.id)}
              onToggleWatch={onToggleWatch}
              onToggleSlip={onToggleSlip}
              onOpenPitcher={onOpenPitcher}
              betaEnabled={betaEnabled}
              signalLimit={signalLimit}
            />
          ))}
      </div>
    </div>
  )
}
