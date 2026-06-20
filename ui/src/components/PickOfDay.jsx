import Icon from './Icon.jsx'
import { GradeChip, ProbRing } from './atoms.jsx'
import { hrSetup } from '../lib/scout.js'
import { gradeColor } from '../lib/badges.js'
import { teamLogo } from '../lib/teams.js'
import { pct, signedPct, american } from '../lib/format.js'
import { hexA } from './atoms.jsx'

function heatTag(h) {
  if (h == null) return null
  if (h >= 70) return 'On fire 🔥'
  if (h >= 58) return 'Hot'
  if (h >= 45) return 'Warm'
  return 'Cool'
}

export default function PickOfDay({ batter: b, onSelect, watched, inSlip, onToggleWatch, onToggleSlip, onOpenPitcher, onDismiss }) {
  if (!b) return null
  const g = b.grade?.label || 'SKIP'
  const color = gradeColor(g)
  const { checks, n } = hrSetup(b)
  const heat = b.heatIndex
  const best = b.odds?.best
  const canOpenPitcher = !!onOpenPitcher && b.pitcher?.id != null
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn(b)
  }

  return (
    <section
      className="potd"
      style={{ 
        '--row-accent': color, 
        '--team-logo': teamLogo(b.teamId) ? `url(${teamLogo(b.teamId)})` : 'none',
        background: `linear-gradient(135deg, rgba(8, 12, 28, 0.85) 0%, rgba(20, 24, 48, 0.6) 100%)`,
        border: `1px solid ${hexA(color, 0.25)}`,
        boxShadow: `0 8px 32px rgba(0, 0, 0, 0.4), 0 0 16px ${hexA(color, 0.08)}, inset 0 1px 0 rgba(255, 255, 255, 0.05)`,
        borderRadius: '16px',
        padding: '20px',
        position: 'relative',
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        marginBottom: '20px',
        overflow: 'hidden'
      }}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(b)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(b)
        }
      }}
    >
      {/* Decorative colored glow ball */}
      <div style={{
        position: 'absolute',
        top: '-40px',
        right: '-40px',
        width: '120px',
        height: '120px',
        background: color,
        filter: 'blur(50px)',
        opacity: 0.15,
        pointerEvents: 'none'
      }} />

      {onDismiss && (
        <button
          className="potd-dismiss icon-btn"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(b)
          }}
          aria-label="Dismiss Pick of the Day"
          title="Dismiss"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            zIndex: 2
          }}
        >
          <Icon name="X" size={13} />
        </button>
      )}

      <div className="potd-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <span className="potd-kicker" style={{
          fontSize: '11px',
          fontWeight: '800',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: color,
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <Icon name="Trophy" size={13} style={{ filter: `drop-shadow(0 0 4px ${color})` }} /> Pick of the Day
        </span>
        <span className={`potd-lineup ${b.lineupConfirmed ? 'on' : 'pending'}`} style={{
          fontSize: '11px',
          fontWeight: '600',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          background: b.lineupConfirmed ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.03)',
          padding: '2px 8px',
          borderRadius: '6px',
          color: b.lineupConfirmed ? 'var(--strong)' : 'var(--text-faint)',
          border: b.lineupConfirmed ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(255,255,255,0.05)'
        }}>
          <span className="confirm-dot" style={{
            background: b.lineupConfirmed ? 'var(--strong)' : 'var(--text-faint)',
            boxShadow: b.lineupConfirmed ? '0 0 6px var(--strong)' : 'none'
          }} />
          {b.lineupConfirmed ? 'Confirmed' : 'Projected'}
          {b.battingOrder ? ` · #${b.battingOrder}` : ''}
        </span>
      </div>

      <div className="potd-body" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div className="potd-main" style={{ flex: '1', minWidth: '0' }}>
          <div className="potd-name-line" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
            <span className="potd-name" style={{
              fontFamily: 'var(--display)',
              fontSize: '24px',
              fontWeight: '800',
              color: '#ffffff',
              letterSpacing: '-0.02em'
            }}>{b.name}</span>
            <span className="bathand" style={{
              fontSize: '10px',
              fontFamily: 'var(--mono)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '4px',
              padding: '1px 5px',
              color: 'var(--text-dim)',
              background: 'rgba(255,255,255,0.02)'
            }}>{b.batSide}</span>
            <GradeChip grade={b.grade} score={b.score} />
          </div>

          <div className="potd-matchup" style={{ fontSize: '13px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <span className="team-tag" style={{ color: '#fff', fontWeight: '700' }}>{b.team}</span>
            <Icon name="ChevronRight" size={10} className="vs-arrow" style={{ opacity: 0.6 }} />
            <span className="opp-tag" style={{ color: 'var(--text-dim)' }}>{b.opponent?.abbr || '—'}</span>
            <span className="dot-sep">·</span>
            <span>vs</span>
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
                  fontWeight: '600',
                  textDecoration: 'none',
                  borderBottom: '1px dashed var(--accent)'
                }}
              >
                {b.pitcher.name}
              </button>
            ) : (
              <span style={{ color: '#fff', fontWeight: '600' }}>{b.pitcher?.name || 'TBD'}</span>
            )}
            {b.pitcher?.hand ? <span className="phand" style={{ fontSize: '11px', opacity: 0.7 }}>({b.pitcher.hand}HP)</span> : null}
          </div>

          <div className="potd-meta" style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '12px', color: 'var(--text-faint)', flexWrap: 'wrap' }}>
            <span className="potd-heat" style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--b-hot)',
              fontWeight: '500'
            }}>
              <Icon name="Flame" size={12} /> Heat {heat ?? '—'} · {heatTag(heat)}
            </span>
            <span className="dot-sep" style={{ opacity: 0.3 }}>·</span>
            <span className="potd-setup" style={{ color: 'var(--text-dim)' }}>Setup Match {n}/6</span>
            {best && (
              <>
                <span className="dot-sep" style={{ opacity: 0.3 }}>·</span>
                <span className="potd-odds mono" style={{ color: 'var(--text-dim)' }}>
                  <b style={{ color: '#fff' }}>{american(best.american)}</b>
                  {best.edge != null && (
                    <span className={best.edge >= 0 ? 'pos' : 'neg'} style={{ marginLeft: '6px', fontWeight: '700' }}>
                      {signedPct(best.edge, 0)} EV
                    </span>
                  )}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="potd-prob" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingLeft: '16px' }}>
          <ProbRing value={b.hrProbability} color={color} size={66} />
          <span className="potd-prob-cap dim" style={{ fontSize: '11px', marginTop: '4px', fontWeight: '600' }}>HR PROB</span>
        </div>
      </div>

      <ul className="potd-checks" style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px',
        paddingTop: '12px',
        borderTop: '1px solid rgba(255, 255, 255, 0.05)',
        listStyle: 'none',
        marginBottom: '4px'
      }}>
        {checks.map((c) => (
          <li 
            key={c.key} 
            className={c.pass ? 'on' : 'off'} 
            title={c.detail}
            style={{
              fontSize: '11px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              borderRadius: '6px',
              padding: '3px 8px',
              background: c.pass ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255,255,255,0.01)',
              color: c.pass ? 'var(--strong)' : 'var(--text-faint)',
              border: c.pass ? '1px solid rgba(16, 185, 129, 0.15)' : '1px solid rgba(255,255,255,0.03)'
            }}
          >
            <Icon name={c.pass ? 'Check' : 'X'} size={10} />
            <span>{c.label}</span>
          </li>
        ))}
      </ul>

      <div className="potd-actions" onClick={(e) => e.stopPropagation()} style={{
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        display: 'flex',
        gap: '8px',
        zIndex: 2
      }}>
        <button 
          className={`act-btn star ${watched ? 'on' : ''}`} 
          onClick={stop(onToggleWatch)} 
          aria-label="Toggle watchlist"
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: watched ? 'rgba(245,166,35,0.1)' : 'var(--card)',
            color: watched ? 'var(--prime)' : 'var(--text-faint)',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          <Icon name="Star" size={14} style={{ fill: watched ? 'currentColor' : 'none' }} />
        </button>
        <button 
          className={`act-btn add ${inSlip ? 'on' : ''}`} 
          onClick={stop(onToggleSlip)} 
          aria-label="Toggle parlay leg"
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            border: '1px solid var(--border)',
            background: inSlip ? 'rgba(16,185,129,0.1)' : 'var(--card)',
            color: inSlip ? 'var(--strong)' : 'var(--text-faint)',
            display: 'grid',
            placeItems: 'center'
          }}
        >
          <Icon name={inSlip ? 'Check' : 'Plus'} size={14} />
        </button>
      </div>
    </section>
  )
}
