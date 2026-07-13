import Icon from './Icon.jsx'
import { GradeChip, ProbRing, BadgeRow } from './atoms.jsx'
import { pct, num, signedPct, american, ordinal } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { teamLogo, playerHeadshot } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'
import { useExplain } from '../lib/explain.js'
import { useState } from 'react'
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
  betaEnabled = false,
  signalLimit = 2,
}) {
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn(b)
  }
  const canOpenPitcher = !!onOpenPitcher && b.pitcher?.id != null
  const g = b.grade?.label || 'SKIP'
  const color = gradeColor(g)
  const liveMode = useLiveMode()
  const live = liveMode && b.game?.isLive
  const isFinal = b.game?.isFinal
  const hrToday = liveMode && b.liveContext?.isHRThisGame
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
  // Air pull — the hand-adjusted park × weather HR multiplier (1.0 = neutral).
  // The number behind the wxEdge badge, surfaced signed so suppression shows too.
  const air = Number.isFinite(b.parkWeatherHandFactor) ? b.parkWeatherHandFactor : null
  const airTone = air == null ? null : air >= 1.05 ? 'good' : air <= 0.95 ? 'bad' : 'mut'

  const mobileSwipe = useSwipeActions({
    onRight: () => onToggleWatch?.(b),
    onLeft: () => onToggleSlip?.(b),
  })

  const strongestSignal = betaEnabled && b.powerReady
    ? { label: 'Power Ready (beta)', tone: 'warn', icon: 'Gauge' }
    : betaEnabled && b.barrelReady
      ? { label: 'Barrel Ready (beta)', tone: 'warn', icon: 'Flame' }
    : pmScore >= 7
      ? { label: `Pitch ${pmScore.toFixed(1)}`, tone: 'good', icon: 'Target' }
    : dueSetup.n >= 4
      ? { label: `Due ${dueSetup.n}/${dueSetup.checks.length}`, tone: 'warn', icon: 'Hourglass' }
      : airTone === 'good'
        ? { label: `Air ${signedPct(air - 1, 0)}`, tone: 'good', icon: 'Wind' }
        : mom
          ? { label: mom.label, tone: mom.cls, icon: mom.icon }
          : null

  return (
    <div className="board-swipe" data-flip-id={b.id}>
      <div className="board-swipe-actions" aria-hidden="true">
        <span ref={mobileSwipe.leftRef} className={`bsa bsa-watch ${watched ? 'on' : ''}`}>
          <Icon name="Star" size={16} />
        </span>
        <span ref={mobileSwipe.rightRef} className={`bsa bsa-slip ${inSlip ? 'on' : ''}`}>
          <Icon name={inSlip ? 'Check' : 'Plus'} size={16} />
        </span>
      </div>
      <div
        ref={mobileSwipe.innerRef}
        className={`mobile-board-row ${selected ? 'selected' : ''} ${isFinal ? 'final' : ''} row-grade-${g.toLowerCase()}`}
        role="button"
        tabIndex={0}
        onPointerDown={mobileSwipe.onPointerDown}
        onClick={() => {
          if (mobileSwipe.swipedRef.current) return
          onSelect(b)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onSelect(b)
          }
        }}
        style={{ '--mobile-row-color': color }}
      >
        <span className={`mobile-board-rank mono${rank <= 3 ? ` rank-medal rank-${rank}` : ''}`}>{rank}</span>
        <span className="mobile-board-avatar-wrap">
          <img className="mobile-board-avatar" src={playerHeadshot(b.playerId, 96)} alt="" loading="lazy" />
          <span className={`mobile-lineup-dot${b.lineupConfirmed ? ' confirmed' : ''}`} title={b.lineupConfirmed ? 'Confirmed lineup' : 'Projected lineup'} />
        </span>
        <span className="mobile-board-main">
          <span className="mobile-board-name-line">
            <strong title={b.name}>{b.name}</strong>
            <small>{b.batSide}</small>
            {b.battingOrder && <small className="mono">#{b.battingOrder}</small>}
            {mom && (
              <span className={`mobile-momentum ${mom.cls}`}>
                {mom.cls === 'hot' ? <span className="mobile-heat-dot" aria-hidden="true" /> : <Icon name={mom.icon} size={9} />}
                {mom.label}
              </span>
            )}
          </span>
          <span className="mobile-board-matchup">
            <b>{b.team}</b><span>{b.opponent?.abbr || '—'}</span><span>vs</span>
            {canOpenPitcher ? (
              <button onClick={(e) => { e.stopPropagation(); onOpenPitcher(b.pitcher.id, b.gamePk) }}>{b.pitcher.name}</button>
            ) : <span>{b.pitcher?.name || 'TBD'}</span>}
          </span>
          <span className="mobile-board-tags">
            <GradeChip grade={b.grade} size="sm" score={b.score} />
            {strongestSignal && (
              <span className={`mobile-board-signal ${strongestSignal.tone}`}>
                {strongestSignal.tone === 'hot' ? <span className="mobile-heat-dot" aria-hidden="true" /> : <Icon name={strongestSignal.icon} size={10} />}
                {strongestSignal.label}
              </span>
            )}
          </span>
        </span>
        <span className="mobile-board-prob"><b className="mono">{pct(b.hrProbability, 1)}</b><small>HR PROB</small></span>
        <button className={`mobile-board-action${watched ? ' on watch' : ''}`} onClick={stop(onToggleWatch)} aria-label={watched ? `Remove ${b.name} from watchlist` : `Watch ${b.name}`}>
          <Icon name="Star" size={17} style={{ fill: watched ? 'currentColor' : 'none' }} />
        </button>
        <button className={`mobile-board-action${inSlip ? ' on slip' : ''}`} onClick={stop(onToggleSlip)} aria-label={inSlip ? `Remove ${b.name} from parlay` : `Add ${b.name} to parlay`}>
          <Icon name={inSlip ? 'Check' : 'Plus'} size={18} />
        </button>
      </div>
      <div
        className={`board-row ${selected ? 'selected' : ''} ${isFinal ? 'final' : ''} ${b.precision ? 'row-precision' : ''} row-grade-${g.toLowerCase()}`}
        role="button"
        tabIndex={0}
        onClick={() => {
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
          borderLeft: selected ? `3px solid var(--accent)` : b.precision ? `3px solid var(--accent)` : `3px solid ${hexA(color, 0.3)}`
        }}
      >
        <div className={`col-rank mono${rank <= 3 ? ` rank-medal rank-${rank}` : ''}`}>{rank}</div>

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
              <span className="live-tag">
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
            {b.pitcherChanged && (
              <span className="hr-tag" title="Starting pitcher changed after the morning lock — this row was re-scored for the new matchup" style={{ background: 'rgba(245,166,35,0.12)', color: 'var(--prime)', fontWeight: '700' }}>
                <Icon name="RefreshCw" size={9} /> NEW ARM
              </span>
            )}
            {mom && (
              <span className={`mom-chip ${mom.cls}`}>
                <Icon name={mom.icon} size={10} /> {mom.label}
              </span>
            )}
            {(b.hrStreak ?? 0) >= 2 && (
              <span className="streak-chip" title={`${b.hrStreak}-game HR streak`}>
                <Icon name="Flame" size={9} /> {b.hrStreak}G
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
          <RowWhy b={b} />
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

          {(pmScore != null || dueSetup.n > 0 || air != null || hrPct != null || bestOdds?.american) && (
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
                <span className={dueSetup.n === dueSetup.checks.length ? 'due-perfect' : ''} style={dueSetup.n === dueSetup.checks.length ? {
                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                  fontSize: '10px', fontWeight: '800', padding: '2px 7px', borderRadius: '6px',
                  background: 'rgba(245,166,35,0.12)',
                  color: 'var(--prime)',
                  border: '1px solid rgba(245,166,35,0.4)',
                } : {
                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                  fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px',
                  background: dueSetup.n >= 5 ? 'rgba(239,68,68,0.14)' : dueSetup.n >= 3 ? 'rgba(250,204,21,0.10)' : 'rgba(255,255,255,0.04)',
                  color: dueSetup.n >= 5 ? 'var(--bad)' : dueSetup.n >= 3 ? '#facc15' : 'var(--text-faint)',
                  border: `1px solid ${dueSetup.n >= 5 ? 'rgba(239,68,68,0.22)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  DUE {dueSetup.n}/{dueSetup.checks.length}
                </span>
              )}
              {air != null && (
                <span title={`Air pull — park × weather × hand HR multiplier: ${air.toFixed(2)}× (1.00 = neutral). ${airTone === 'good' ? 'Tonight’s air helps the ball out.' : airTone === 'bad' ? 'Tonight’s air holds the ball in.' : 'Roughly neutral tonight.'}`} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '3px',
                  fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px',
                  background: airTone === 'good' ? 'rgba(16,185,129,0.14)' : airTone === 'bad' ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.04)',
                  color: airTone === 'good' ? 'var(--strong)' : airTone === 'bad' ? 'var(--bad)' : 'var(--text-faint)',
                  border: `1px solid ${airTone === 'good' ? 'rgba(16,185,129,0.22)' : airTone === 'bad' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)'}`,
                }}>
                  AIR {signedPct(air - 1, 0)}
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
              {Number.isFinite(edge) && edge > 0 && (
                <span className="ev-chip" title={`+${(edge * 100).toFixed(0)}% edge vs market`}>
                  +EV
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
            <span className="prob-num-mobile mono" style={{ color: g === 'SKIP' ? 'var(--text-dim)' : color, fontWeight: '700' }}>
              {pct(b.hrProbability, 1)}
            </span>
          </div>
        </div>

        <div className="col-xhr mono" title="Expected HRs this game">
          <b style={{ color: '#fff' }}>{num(b.expectedHRs, 3)}</b>
          <span className="col-xhr-sub">{num(b.expectedPAs, 1)} PA</span>
        </div>

        <div className={`col-rating${(b.heatIndex ?? 0) >= 90 ? ' heat-max' : ''}`} title={`Heat index ${b.heatIndex}/100${(b.heatIndex ?? 0) >= 90 ? ' — molten' : ''}`}>
          <span className="rating-meter" style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '99px', height: '4px' }}>
            <span className="rating-fill heat-fill" style={{
              width: `${b.heatIndex}%`,
              background: 'linear-gradient(90deg, var(--b-due) 0%, var(--b-hot) 100%)',
              boxShadow: '0 0 6px var(--b-hot)'
            }} />
          </span>
          <span className="rating-num mono">
            {(b.heatIndex ?? 0) >= 90 && <Icon name="Flame" size={10} className="heat-flame" />}
            {b.heatIndex}
          </span>
        </div>

        <div className="col-signals">
          <BadgeRow batter={b} max={signalLimit} includeBeta={betaEnabled} showOverflow />
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

// Compact "Why?" expander on the board row — same Haiku narration as the
// drawer's Explain card, sharing its per-player/day cache (a tap here fills
// the drawer too, and vice-versa). Lazy: no call until tapped. stopPropagation
// keeps taps from opening the drawer. Absent when the worker URL is unset.
function RowWhy({ b }) {
  const { status, text, run, available } = useExplain(b)
  const [open, setOpen] = useState(false)
  if (!available) return null

  const onTap = (e) => {
    e.stopPropagation()
    if (status === 'loading') return
    if (status === 'done') { setOpen((o) => !o); return }
    setOpen(true)
    run()
  }

  const label = status === 'loading' ? 'Thinking…'
    : status === 'error' ? 'Retry'
    : status === 'done' && open ? 'Hide'
    : 'Why?'

  return (
    <div className="row-why" onClick={(e) => e.stopPropagation()} style={{ marginTop: '4px' }}>
      <button
        type="button"
        onClick={onTap}
        disabled={status === 'loading'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '6px',
          background: 'rgba(0,216,246,0.08)', border: '1px solid rgba(0,216,246,0.22)',
          color: 'var(--accent)', cursor: status === 'loading' ? 'default' : 'pointer',
        }}
      >
        <Icon name={status === 'loading' ? 'Loader' : 'Sparkles'} size={10}
          style={status === 'loading' ? { animation: 'spin 1s linear infinite' } : undefined} />
        {label}
      </button>
      {open && status === 'done' && (
        <p style={{ fontSize: '11px', lineHeight: '1.45', color: 'var(--text-dim)', margin: '6px 0 0' }}>{text}</p>
      )}
    </div>
  )
}
