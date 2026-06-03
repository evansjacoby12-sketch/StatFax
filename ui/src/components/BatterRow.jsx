import Icon from './Icon.jsx'
import { GradeChip, ProbBar, BadgeRow } from './atoms.jsx'
import { pct, num, signedPct, american } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { useLiveMode } from '../lib/liveMode.js'

export default function BatterRow({
  batter: b,
  rank,
  onSelect,
  selected,
  watched,
  inSlip,
  onToggleWatch,
  onToggleSlip,
}) {
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn(b)
  }
  const g = b.grade?.label || 'SKIP'
  const color = b.grade?.color || gradeColor(g)
  const liveMode = useLiveMode()
  const live = liveMode && b.game?.isLive
  const hrToday = liveMode && b.liveContext?.isHRThisGame
  const topReason = b.reasons?.[0]
  const edge = b.edge

  return (
    <div
      className={`board-row ${selected ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(b)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(b)
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          e.currentTarget.nextElementSibling?.focus()
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          e.currentTarget.previousElementSibling?.focus()
        } else if (e.key === 'Home') {
          e.preventDefault()
          e.currentTarget.parentElement?.firstElementChild?.focus()
        } else if (e.key === 'End') {
          e.preventDefault()
          e.currentTarget.parentElement?.lastElementChild?.focus()
        }
      }}
      style={{ '--row-accent': color, '--i': Math.min(rank, 24) }}
    >
      <div className="col-rank mono">{rank}</div>

      <div className="col-batter">
        <div className="batter-line1">
          <span className="batter-name">{b.name}</span>
          <span className="bathand">{b.batSide}</span>
          {b.battingOrder ? <span className="order-pill mono">#{b.battingOrder}</span> : null}
          {b.lineupConfirmed ? (
            <span className="confirm-dot" title="Confirmed in lineup" />
          ) : (
            <span className="confirm-dot pending" title="Projected lineup" />
          )}
          {live && (
            <span className="live-tag">
              <span className="live-dot" /> LIVE
            </span>
          )}
          {hrToday && (
            <span className="hr-tag" title="Already homered in this game">
              <Icon name="Flame" size={10} /> HR
            </span>
          )}
        </div>
        <div className="batter-line2">
          <span className="team-tag">{b.team}</span>
          <Icon name="ChevronRight" size={11} className="vs-arrow" />
          <span className="opp-tag">{b.opponent?.abbr || '—'}</span>
          <span className="dot-sep">·</span>
          <span className="matchup-pitch">
            vs {b.pitcher?.name || 'TBD'}{' '}
            {b.pitcher?.hand ? <span className="phand">{b.pitcher.hand}HP</span> : null}
          </span>
        </div>
        {topReason && (
          <div className="batter-reason" title={b.reasons.join(' · ')}>
            <Icon name="Zap" size={11} />
            {topReason}
          </div>
        )}
      </div>

      <div className="col-grade">
        <GradeChip grade={b.grade} score={b.score} />
      </div>

      <div className="col-prob">
        <ProbBar value={b.hrProbability} color={color} />
      </div>

      <div className="col-xhr mono" title="Expected HRs this game">
        {num(b.expectedHRs, 3)}
        <span className="col-xhr-sub">{num(b.expectedPAs, 1)} PA</span>
      </div>

      <div className="col-rating" title={`Heat index ${b.heatIndex}/100`}>
        <span className="rating-meter">
          <span className="rating-fill heat-fill" style={{ width: `${b.heatIndex}%` }} />
        </span>
        <span className="rating-num mono">{b.heatIndex}</span>
      </div>

      <div className="col-signals">
        <BadgeRow batter={b} max={4} />
      </div>

      <div className="col-edge">
        {edge != null ? (
          <div className={`edge-cell ${edge >= 0 ? 'pos' : 'neg'}`}>
            <span className="edge-val mono">{signedPct(edge, 0)}</span>
            <span className="edge-price mono">{american(b.odds?.best?.american)}</span>
          </div>
        ) : (
          <span className="edge-none">—</span>
        )}
      </div>

      <div className="col-actions">
        <button
          className={`act-btn star ${watched ? 'on' : ''}`}
          onClick={stop(onToggleWatch)}
          title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
          aria-label="Toggle watchlist"
        >
          <Icon name="Star" size={15} />
        </button>
        <button
          className={`act-btn add ${inSlip ? 'on' : ''}`}
          onClick={stop(onToggleSlip)}
          title={inSlip ? 'Remove from parlay' : 'Add to parlay'}
          aria-label="Toggle parlay leg"
        >
          <Icon name={inSlip ? 'Check' : 'Plus'} size={15} />
        </button>
        <Icon name="ChevronRight" size={16} className="row-chev" />
      </div>
    </div>
  )
}
