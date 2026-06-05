import Icon from './Icon.jsx'
import { GradeChip, ProbRing } from './atoms.jsx'
import { hrSetup } from '../lib/scout.js'
import { gradeColor } from '../lib/badges.js'
import { teamLogo } from '../lib/teams.js'
import { pct, signedPct, american } from '../lib/format.js'

function heatTag(h) {
  if (h == null) return null
  if (h >= 70) return 'On fire 🔥'
  if (h >= 58) return 'Hot'
  if (h >= 45) return 'Warm'
  return 'Cool'
}

// The single best play of the slate, with every signal laid out. The pick is
// chosen in App (top HR probability among confirmed-lineup bats); this just
// renders the "everything lined up" hero card. Click opens the full drawer.
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
      style={{ '--row-accent': color, '--team-logo': teamLogo(b.teamId) ? `url(${teamLogo(b.teamId)})` : 'none' }}
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
      {onDismiss && (
        <button
          className="potd-dismiss icon-btn"
          onClick={(e) => {
            e.stopPropagation()
            onDismiss(b)
          }}
          aria-label="Dismiss Pick of the Day"
          title="Dismiss"
        >
          <Icon name="X" size={15} />
        </button>
      )}
      <div className="potd-head">
        <span className="potd-kicker">
          <Icon name="Trophy" size={13} /> Pick of the Day
        </span>
        <span className={`potd-lineup ${b.lineupConfirmed ? 'on' : 'pending'}`}>
          <span className="confirm-dot" />
          {b.lineupConfirmed ? 'Confirmed' : 'Projected'}
          {b.battingOrder ? ` · #${b.battingOrder}` : ''}
        </span>
      </div>

      <div className="potd-body">
        <div className="potd-main">
          <div className="potd-name-line">
            <span className="potd-name">{b.name}</span>
            <span className="bathand">{b.batSide}</span>
            <GradeChip grade={b.grade} score={b.score} />
          </div>
          <div className="potd-matchup">
            <span className="team-tag">{b.team}</span>
            <Icon name="ChevronRight" size={11} className="vs-arrow" />
            <span className="opp-tag">{b.opponent?.abbr || '—'}</span>
            <span className="dot-sep">·</span>
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
          </div>
          <div className="potd-meta">
            <span className="potd-heat">
              <Icon name="Flame" size={12} /> Heat {heat ?? '—'} · {heatTag(heat)}
            </span>
            <span className="potd-setup">setup {n}/6</span>
            {best && (
              <span className="potd-odds mono">
                {american(best.american)}
                {best.edge != null && <em className={best.edge >= 0 ? 'pos' : 'neg'}> {signedPct(best.edge, 0)} edge</em>}
              </span>
            )}
          </div>
        </div>
        <div className="potd-prob">
          <ProbRing value={b.hrProbability} color={color} size={66} />
          <span className="potd-prob-cap dim">{pct(b.hrProbability, 1)} HR</span>
        </div>
      </div>

      <ul className="potd-checks">
        {checks.map((c) => (
          <li key={c.key} className={c.pass ? 'on' : 'off'} title={c.detail}>
            <Icon name={c.pass ? 'Check' : 'X'} size={12} />
            {c.label}
          </li>
        ))}
      </ul>

      <div className="potd-actions" onClick={(e) => e.stopPropagation()}>
        <button className={`act-btn star ${watched ? 'on' : ''}`} onClick={stop(onToggleWatch)} aria-label="Toggle watchlist">
          <Icon name="Star" size={15} />
        </button>
        <button className={`act-btn add ${inSlip ? 'on' : ''}`} onClick={stop(onToggleSlip)} aria-label="Toggle parlay leg">
          <Icon name={inSlip ? 'Check' : 'Plus'} size={15} />
        </button>
      </div>
    </section>
  )
}
