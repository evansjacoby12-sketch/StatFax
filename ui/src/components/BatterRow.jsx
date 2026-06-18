import Icon from './Icon.jsx'
import { GradeChip, ProbRing, BadgeRow } from './atoms.jsx'
import { pct, num, signedPct, american, ordinal } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { teamLogo } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'
import { useEliLevel, topReasonForLevel } from '../lib/eliLevel.js'

export default function BatterRow({
  batter: b,
  rank,
  onSelect,
  selected,
  watched,
  inSlip,
  onToggleWatch,
  onToggleSlip,
  onOpenPitcher,
}) {
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn(b)
  }
  const canOpenPitcher = !!onOpenPitcher && b.pitcher?.id != null
  const g = b.grade?.label || 'SKIP'
  const color = gradeColor(g)
  const liveMode = useLiveMode()
  const eliLevel = useEliLevel()
  const live = liveMode && b.game?.isLive
  const isFinal = b.game?.isFinal
  const hrToday = liveMode && b.liveContext?.isHRThisGame
  const topReason = topReasonForLevel(b, eliLevel)
  const edge = b.edge
  // Mobile-only consolidated card bits (hidden on desktop via CSS, which keeps
  // its richer multi-column layout). The matchup lean is the Plate Matchup
  // signal: matchupScore − 50 (50 = neutral).
  const lean = Number.isFinite(b.matchupScore) ? Math.round(b.matchupScore - 50) : null
  const mom = b.hot
    ? { label: 'HOT', cls: 'hot', icon: 'Flame' }
    : b.rising
      ? { label: 'RISING', cls: 'rising', icon: 'TrendingUp' }
      : null

  return (
    <div
      className={`board-row ${selected ? 'selected' : ''} ${isFinal ? 'final' : ''}`}
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
      style={{
        '--row-accent': color,
        '--team-logo': teamLogo(b.teamId) ? `url(${teamLogo(b.teamId)})` : 'none',
        '--i': Math.min(rank, 24),
      }}
    >
      <div className="col-rank mono">{rank}</div>

      <div className="col-batter">
        <div className="batter-line1">
          <span className={`batter-name ${hrToday ? 'hr-glow' : ''}`}>{b.name}</span>
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
          {isFinal && <span className="final-tag">FINAL</span>}
          {hrToday && (
            <span className="hr-tag" title="Already homered in this game">
              <Icon name="Flame" size={10} /> HR
            </span>
          )}
          {mom && (
            <span className={`mom-chip ${mom.cls}`}>
              <Icon name={mom.icon} size={10} /> {mom.label}
            </span>
          )}
        </div>
        <div className="batter-line2">
          <span className="team-tag">{b.team}</span>
          <Icon name="ChevronRight" size={11} className="vs-arrow" />
          <span className="opp-tag">{b.opponent?.abbr || '—'}</span>
          <span className="dot-sep">·</span>
          <span className="matchup-pitch">
            vs{' '}
            {canOpenPitcher ? (
              <button
                className="pitch-link"
                onClick={(e) => {
                  e.stopPropagation()
                  onOpenPitcher(b.pitcher.id, b.gamePk)
                }}
                title={`Open ${b.pitcher.name}'s pitcher card`}
              >
                {b.pitcher.name}
              </button>
            ) : (
              b.pitcher?.name || 'TBD'
            )}{' '}
            {b.pitcher?.hand ? <span className="phand">{b.pitcher.hand}HP</span> : null}
          </span>
        </div>
        {topReason && (
          <div className="batter-reason" title={(b.reasons || []).join(' · ')}>
            <Icon name="Zap" size={11} />
            {topReason}
          </div>
        )}
        <div className="batter-meta mono">
          {Number.isFinite(b.expectedPAs) && <span className="bm-pa">~{num(b.expectedPAs, 1)} PA</span>}
          {b.battingOrder ? <span className="bm-slot">Batting {ordinal(b.battingOrder)}</span> : null}
          {lean != null && (
            <span className={`bm-lean ${lean >= 0 ? 'pos' : 'neg'}`}>
              {lean > 0 ? '+' : ''}
              {lean}
            </span>
          )}
        </div>
      </div>

      <div className="col-right">
        <div className="col-grade">
          <GradeChip grade={b.grade} score={b.score} />
        </div>

        <div className="col-prob">
          <ProbRing value={b.hrProbability} color={color} />
          <span className="prob-num-mobile mono" style={{ color }}>
            {pct(b.hrProbability, 1)}
          </span>
        </div>
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
