import Icon from './Icon.jsx'
import { GradeChip, ProbRing, BadgeRow } from './atoms.jsx'
import { pct, num, signedPct, american, ordinal } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { teamLogo } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'
import { useEliLevel, topReasonForLevel } from '../lib/eliLevel.js'
import { risingForm } from '../lib/groups.js'
import { useSwipeActions } from '../lib/useSwipeActions.js'
import { hexA } from './atoms.jsx'
import { hrSetup, pitchMixScore } from '../lib/scout.js'

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
  const lean = Number.isFinite(b.matchupScore) ? Math.round(b.matchupScore - 50) : null

  const mom = b.hot
    ? { label: 'HOT', cls: 'hot', icon: 'Flame' }
    : risingForm(b)
      ? { label: 'RISING', cls: 'rising', icon: 'TrendingUp' }
      : null

  const pmScore = pitchMixScore(b)
  const dueSetup = hrSetup(b)
  const bestOdds = b.odds?.best
  const hrPct = b.hrProbability != null ? Math.round(b.hrProbability * 100) : null

  const { innerRef, leftRef, rightRef, swipedRef, onPointerDown } = useSwipeActions({
    onRight: () => onToggleWatch?.(b),
    onLeft: () => onToggleSlip?.(b),
  })

  return (
    <div className="board-swipe">
      <div className="board-swipe-actions" aria-hidden="true">
        <span ref={leftRef} className={`bsa bsa-watch ${watched ? 'on' : ''}`}>
          <Icon name="Star" size={16} />
        </span>
        <span ref={rightRef} className={`bsa bsa-slip ${inSlip ? 'on' : ''}`}>
          <Icon name={inSlip ? 'Check' : 'Plus'} size={16} />
        </span>
      </div>
      <div
        ref={innerRef}
        className={`board-row ${selected ? 'selected' : ''} ${isFinal ? 'final' : ''} row-grade-${g.toLowerCase()}`}
        role="button"
        tabIndex={0}
        onPointerDown={onPointerDown}
        onClick={() => {
          if (swipedRef.current) return
          onSelect(b)
        }}
        onKeyDown={(e) => {
          const rowAt = (wrap) => wrap?.querySelector('.board-row')
          const wrap = e.currentTarget.closest('.board-swipe')
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(b)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            rowAt(wrap?.nextElementSibling)?.focus()
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            rowAt(wrap?.previousElementSibling)?.focus()
          } else if (e.key === 'Home') {
            e.preventDefault()
            rowAt(wrap?.parentElement?.firstElementChild)?.focus()
          } else if (e.key === 'End') {
            e.preventDefault()
            rowAt(wrap?.parentElement?.lastElementChild)?.focus()
          }
        }}
        style={{
          '--row-accent': color,
          '--team-logo': teamLogo(b.teamId) ? `url(${teamLogo(b.teamId)})` : 'none',
          '--i': Math.min(rank, 24),
          borderLeft: selected ? `3px solid var(--accent)` : `3px solid ${hexA(color, 0.3)}`
        }}
      >
        <div className="col-rank mono">{rank}</div>

        <div className="col-batter">
          <div className="batter-line1">
            <span className={`batter-name ${hrToday ? 'hr-glow' : ''}`} style={{ fontWeight: '700' }}>{b.name}</span>
            <span className="bathand">{b.batSide}</span>
            {b.battingOrder ? <span className="order-pill mono">#{b.battingOrder}</span> : null}
            {b.lineupConfirmed ? (
              <span className="confirm-dot" title="Confirmed in lineup" style={{ background: 'var(--strong)', boxShadow: '0 0 6px var(--strong)' }} />
            ) : (
              <span className="confirm-dot pending" title="Projected lineup" style={{ background: 'var(--text-faint)' }} />
            )}
            {live && (
              <span className="live-tag" style={{ background: 'rgba(239, 68, 68, 0.12)', color: 'var(--bad)', fontSize: '9px' }}>
                <span className="live-dot" /> LIVE
              </span>
            )}
            {isFinal && <span className="final-tag">FINAL</span>}
            {hrToday && (
              <span className="hr-tag" title="Already homered in this game" style={{
                background: 'rgba(249, 115, 22, 0.15)',
                color: 'var(--b-hot)',
                fontWeight: '700'
              }}>
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
            <span className="team-tag" style={{ color: '#fff', fontWeight: '600' }}>{b.team}</span>
            <Icon name="ChevronRight" size={10} className="vs-arrow" style={{ opacity: 0.5 }} />
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
                  style={{
                    color: 'var(--accent)',
                    borderBottom: '1px dashed rgba(0, 216, 246, 0.4)'
                  }}
                >
                  {b.pitcher.name}
                </button>
              ) : (
                b.pitcher?.name || 'TBD'
              )}{' '}
              {b.pitcher?.hand ? <span className="phand">({b.pitcher.hand}HP)</span> : null}
            </span>
          </div>
          {topReason && (
            <div className="batter-reason" title={(b.reasons || []).join(' · ')}>
              <Icon name="Zap" size={10} style={{ color: 'var(--accent)' }} />
              <span>{topReason}</span>
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

          {(pmScore != null || dueSetup.n > 0 || hrPct != null || bestOdds?.american) && (
            <div className="batter-quickstats" style={{ display: 'flex', gap: '5px', marginTop: '4px', alignItems: 'center', flexWrap: 'wrap' }}>
              {pmScore != null && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                  fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px',
                  background: pmScore >= 7 ? 'rgba(16,185,129,0.14)' : pmScore >= 5 ? 'rgba(250,204,21,0.12)' : 'rgba(239,68,68,0.12)',
                  color: pmScore >= 7 ? 'var(--strong)' : pmScore >= 5 ? '#facc15' : 'var(--bad)',
                  border: `1px solid ${pmScore >= 7 ? 'rgba(16,185,129,0.22)' : pmScore >= 5 ? 'rgba(250,204,21,0.18)' : 'rgba(239,68,68,0.2)'}`,
                }}>
                  PITCH {pmScore.toFixed(1)}
                </span>
              )}
              {dueSetup.n > 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                  fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px',
                  background: dueSetup.n >= 5 ? 'rgba(239,68,68,0.14)' : dueSetup.n >= 3 ? 'rgba(250,204,21,0.10)' : 'rgba(255,255,255,0.04)',
                  color: dueSetup.n >= 5 ? 'var(--bad)' : dueSetup.n >= 3 ? '#facc15' : 'var(--text-faint)',
                  border: `1px solid ${dueSetup.n >= 5 ? 'rgba(239,68,68,0.22)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  DUE {dueSetup.n}/{dueSetup.checks.length}
                </span>
              )}
              {hrPct != null && (
                <span style={{ fontSize: '10px', fontWeight: '800', color: 'var(--accent)', fontFamily: 'var(--mono)' }}>
                  {hrPct}%
                </span>
              )}
              {bestOdds?.american && (
                <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
                  {american(bestOdds.american)}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="col-right">
          <div className="col-grade">
            <GradeChip grade={b.grade} score={b.score} />
          </div>

          <div className="col-prob">
            <ProbRing value={b.hrProbability} color={color} />
            <span className="prob-num-mobile mono" style={{ color, fontWeight: '700' }}>
              {pct(b.hrProbability, 1)}
            </span>
          </div>
        </div>

        <div className="col-xhr mono" title="Expected HRs this game">
          <b style={{ color: '#fff' }}>{num(b.expectedHRs, 3)}</b>
          <span className="col-xhr-sub">{num(b.expectedPAs, 1)} PA</span>
        </div>

        <div className="col-rating" title={`Heat index ${b.heatIndex}/100`}>
          <span className="rating-meter" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '99px', height: '4px' }}>
            <span className="rating-fill heat-fill" style={{ 
              width: `${b.heatIndex}%`, 
              background: 'linear-gradient(90deg, var(--b-due) 0%, var(--b-hot) 100%)',
              boxShadow: '0 0 6px var(--b-hot)'
            }} />
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
            style={{
              borderColor: watched ? 'var(--prime)' : 'var(--border)',
              background: watched ? 'rgba(245,166,35,0.1)' : 'var(--card)',
              color: watched ? 'var(--prime)' : 'var(--text-faint)'
            }}
          >
            <Icon name="Star" size={14} style={{ fill: watched ? 'currentColor' : 'none' }} />
          </button>
          <button
            className={`act-btn add ${inSlip ? 'on' : ''}`}
            onClick={stop(onToggleSlip)}
            title={inSlip ? 'Remove from parlay' : 'Add to parlay'}
            aria-label="Toggle parlay leg"
            style={{
              borderColor: inSlip ? 'var(--strong)' : 'var(--border)',
              background: inSlip ? 'rgba(16,185,129,0.1)' : 'var(--card)',
              color: inSlip ? 'var(--strong)' : 'var(--text-faint)'
            }}
          >
            <Icon name={inSlip ? 'Check' : 'Plus'} size={14} />
          </button>
          <Icon name="ChevronRight" size={16} className="row-chev" style={{ opacity: 0.5 }} />
        </div>
      </div>
    </div>
  )
}
