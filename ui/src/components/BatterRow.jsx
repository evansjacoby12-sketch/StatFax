import Icon from './Icon.jsx'
import { ProbRing, hexA } from './atoms.jsx'
import { pct, num, signedPct } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { useLiveMode } from '../lib/liveMode.js'
import { risingForm } from '../lib/groups.js'
import { useSwipeActions } from '../lib/useSwipeActions.js'
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
}) {
  const stop = (fn) => (event) => {
    event.stopPropagation()
    fn?.(b)
  }

  const grade = b.grade?.label || 'SKIP'
  const gradeScore = Math.round(b.score ?? 0)
  const color = gradeColor(grade)
  const canOpenPitcher = !!onOpenPitcher && b.pitcher?.id != null
  const liveMode = useLiveMode()
  const live = liveMode && b.game?.isLive
  const isFinal = b.game?.isFinal
  const pmScore = pitchMixScore(b)
  const dueSetup = hrSetup(b)
  const air = Number.isFinite(b.parkWeatherHandFactor) ? b.parkWeatherHandFactor : null
  const airTone = air == null ? '' : air >= 1.05 ? 'good' : air <= 0.95 ? 'bad' : ''
  const momentum = b.hot
    ? { label: 'HOT', cls: 'hot', icon: 'Flame' }
    : risingForm(b)
      ? { label: 'RISING', cls: 'rising', icon: 'TrendingUp' }
      : null

  const strongestSignal = betaEnabled && b.powerReady
    ? { label: 'Power Ready', tone: 'warn', icon: 'Gauge', beta: true }
    : betaEnabled && b.barrelReady
      ? { label: 'Barrel Ready', tone: 'warn', icon: 'Flame', beta: true }
      : pmScore >= 7
        ? { label: `Pitch ${pmScore.toFixed(1)}`, tone: 'good', icon: 'Target' }
        : dueSetup.n >= 4
          ? { label: `Due ${dueSetup.n}/${dueSetup.checks.length}`, tone: 'warn', icon: 'Hourglass' }
          : airTone === 'good'
            ? { label: `Air ${signedPct(air - 1, 0)}`, tone: 'good', icon: 'Wind' }
            : momentum
              ? { label: momentum.label, tone: momentum.cls, icon: momentum.icon }
              : null

  const mobileSwipe = useSwipeActions({
    onRight: () => onToggleWatch?.(b),
    onLeft: () => onToggleSlip?.(b),
  })

  const openPitcher = (event) => {
    event.stopPropagation()
    if (canOpenPitcher) onOpenPitcher(b.pitcher.id, b.gamePk)
  }

  const openRow = () => {
    if (!mobileSwipe.swipedRef.current) onSelect(b)
  }

  const onRowKeyDown = (event) => {
    const rowAt = (wrap) => wrap?.querySelector('.decision-ladder-row')
    const wrap = event.currentTarget.closest('.board-swipe')
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onSelect(b)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      rowAt(wrap?.nextElementSibling)?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      rowAt(wrap?.previousElementSibling)?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      rowAt(wrap?.parentElement?.firstElementChild)?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      rowAt(wrap?.parentElement?.lastElementChild)?.focus()
    }
  }

  const matchup = (
    <>
      <b>{b.team}</b>
      <Icon name="ChevronRight" size={10} aria-hidden="true" />
      <span>{b.opponent?.abbr || '—'}</span>
      <span className="dl-separator">·</span>
      {canOpenPitcher ? (
        <button className="dl-pitcher" onClick={openPitcher} title={`Open ${b.pitcher.name}'s pitcher card`}>
          {b.pitcher.name}
        </button>
      ) : (
        <span>{b.pitcher?.name || 'TBD'}</span>
      )}
      {b.pitcher?.hand && <small className="mono">({b.pitcher.hand}HP)</small>}
    </>
  )

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
        className={`mobile-decision-card ${selected ? 'selected' : ''} ${isFinal ? 'final' : ''}`}
        role="button"
        tabIndex={0}
        onPointerDown={mobileSwipe.onPointerDown}
        onClick={openRow}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelect(b)
          }
        }}
        style={{ '--dl-color': color }}
      >
        <div className="mobile-dl-main">
          <div className="mobile-dl-name">
            <span className="mobile-dl-rank mono">{String(rank).padStart(2, '0')}</span>
            <strong>{b.name}</strong>
            <small className="mono">{b.batSide}</small>
            {b.battingOrder && <small className="mono">#{b.battingOrder}</small>}
            <span className={`mobile-dl-lineup ${b.lineupConfirmed ? 'confirmed' : ''}`} title={b.lineupConfirmed ? 'Confirmed lineup' : 'Projected lineup'} />
            {momentum && (
              <span className={`mobile-dl-momentum ${momentum.cls}`}>
                <Icon name={momentum.icon} size={9} /> {momentum.label}
              </span>
            )}
            {live && <span className="live-tag"><span className="live-dot" /> LIVE</span>}
            {isFinal && <span className="final-tag">FINAL</span>}
          </div>
          <div className="mobile-dl-matchup">{matchup}</div>
          {strongestSignal && (
            <span className={`mobile-dl-signal ${strongestSignal.tone}`}>
              <Icon name={strongestSignal.icon} size={10} />
              {strongestSignal.label}{strongestSignal.beta ? ' · BETA' : ''}
            </span>
          )}
        </div>

        <div className="mobile-dl-verdict">
          <b className="mono" style={{ color }}>{pct(b.hrProbability, 1)}</b>
          <span style={{ color }}>{grade} {gradeScore}</span>
        </div>

        <div className="mobile-dl-evidence">
          <span className="mono">xHR {num(b.expectedHRs, 3)}</span>
          <span className="mono">HEAT {b.heatIndex ?? '—'}</span>
          <Icon name="ChevronDown" size={14} />
        </div>

        <div className="mobile-dl-actions">
          <button className={watched ? 'on watch' : ''} onClick={stop(onToggleWatch)} aria-label={watched ? `Remove ${b.name} from watchlist` : `Watch ${b.name}`}>
            <Icon name="Star" size={16} style={{ fill: watched ? 'currentColor' : 'none' }} />
            {watched ? 'Watching' : 'Watch'}
          </button>
          <button className={inSlip ? 'on slip' : ''} onClick={stop(onToggleSlip)} aria-label={inSlip ? `Remove ${b.name} from parlay` : `Add ${b.name} to parlay`}>
            <Icon name={inSlip ? 'Check' : 'Plus'} size={17} />
            {inSlip ? 'Added' : 'Add'}
          </button>
        </div>
      </div>

      <div
        className={`decision-ladder-row ${selected ? 'selected' : ''} ${isFinal ? 'final' : ''} ${b.precision ? 'precision' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => onSelect(b)}
        onKeyDown={onRowKeyDown}
        style={{
          '--dl-color': color,
          '--dl-accent': selected || b.precision ? 'var(--accent)' : hexA(color, 0.42),
        }}
      >
        <div className="dl-rank mono">{String(rank).padStart(2, '0')}</div>

        <div className="dl-identity">
          <div className="dl-name-line">
            <strong>{b.name}</strong>
            <span className="bathand mono">{b.batSide}</span>
            {b.battingOrder && <span className="order-pill mono">#{b.battingOrder}</span>}
            <span className={`confirm-dot ${b.lineupConfirmed ? '' : 'pending'}`} title={b.lineupConfirmed ? 'Confirmed lineup' : 'Projected lineup'} />
            {momentum && <span className={`dl-momentum ${momentum.cls}`}><Icon name={momentum.icon} size={10} /> {momentum.label}</span>}
            {live && <span className="live-tag"><span className="live-dot" /> LIVE</span>}
            {isFinal && <span className="final-tag">FINAL</span>}
          </div>
          <div className="dl-matchup">{matchup}</div>
        </div>

        <div className="dl-verdict">
          <div className="dl-grade" style={{ color }}>
            <span>{grade}</span>
            <b>{gradeScore}</b>
          </div>
          <div className="dl-probability">
            <ProbRing value={b.hrProbability} color={color} size={64} />
            <small>HR PROB</small>
          </div>
        </div>

        <div className="dl-proof">
          <div className="dl-evidence-strip">
            {pmScore != null && <span className={pmScore >= 7 ? 'good' : ''}>PITCH {pmScore.toFixed(1)}</span>}
            {dueSetup.n > 0 && <span className="warn">DUE {dueSetup.n}/{dueSetup.checks.length}</span>}
            {air != null && <span className={airTone}>AIR {signedPct(air - 1, 0)}</span>}
          </div>
          <div className="dl-proof-metrics">
            <span><b className="mono">{num(b.expectedHRs, 3)}</b><small>xHR</small></span>
            <i />
            <span><b className="mono">{b.heatIndex ?? '—'}</b><small>HEAT</small></span>
            {strongestSignal && (
              <>
                <i />
                <span className={`dl-proof-signal ${strongestSignal.tone}`}>
                  <Icon name={strongestSignal.icon} size={11} />
                  <b>{strongestSignal.beta ? 'BETA' : strongestSignal.label}</b>
                </span>
              </>
            )}
          </div>
        </div>

        <div className="dl-actions">
          <button className={watched ? 'on watch' : ''} onClick={stop(onToggleWatch)} title={watched ? 'Remove from watchlist' : 'Add to watchlist'} aria-label="Toggle watchlist">
            <Icon name="Star" size={17} style={{ fill: watched ? 'currentColor' : 'none' }} />
          </button>
          <button className={inSlip ? 'on slip' : ''} onClick={stop(onToggleSlip)} title={inSlip ? 'Remove from parlay' : 'Add to parlay'} aria-label="Toggle parlay leg">
            <Icon name={inSlip ? 'Check' : 'Plus'} size={18} />
          </button>
        </div>
      </div>
    </div>
  )
}
