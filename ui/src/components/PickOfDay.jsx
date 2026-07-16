import Icon from './Icon.jsx'
import { GradeChip, ProbRing } from './atoms.jsx'
import { hrSetup } from '../lib/scout.js'
import { gradeColor } from '../lib/badges.js'
import { playerHeadshot, teamLogo } from '../lib/teams.js'
import { pct } from '../lib/format.js'
import { sharePickCard } from '../lib/shareCard.js'
import { toast } from './Toast.jsx'
import { useLiveMode } from '../lib/liveMode.js'

const EVIDENCE_ICONS = {
  barrel: 'CircleDotDashed',
  elite: 'Crown',
  hot: 'Flame',
  la: 'TrendingUp',
  pitcher: 'Radar',
  park: 'CloudSun',
}

function heatTag(h) {
  if (h == null) return null
  if (h >= 70) return 'On fire'
  if (h >= 58) return 'Hot'
  if (h >= 45) return 'Warm'
  return 'Cool'
}

export default function PickOfDay({ batter: b, onSelect, watched, inSlip, onToggleWatch, onToggleSlip, onOpenPitcher, onDismiss }) {
  const liveMode = useLiveMode()
  if (!b) return null

  const grade = b.grade?.label || 'SKIP'
  const color = gradeColor(grade)
  const { checks, n } = hrSetup(b)
  const heat = b.heatIndex
  const live = liveMode && b.game?.isLive
  const hrToday = liveMode && b.liveContext?.isHRThisGame
  const canOpenPitcher = !!onOpenPitcher && b.pitcher?.id != null
  const passedChecks = checks.filter((check) => check.pass)
  const featuredChecks = passedChecks.slice(0, 3)
  const moreEvidence = Math.max(0, passedChecks.length - featuredChecks.length)

  const stop = (fn) => (event) => {
    event.stopPropagation()
    fn?.(b)
  }

  const openPick = () => onSelect?.(b)
  const openPickFromKeyboard = (event) => {
    if (event.target !== event.currentTarget) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openPick()
    }
  }

  const sharePick = (event) => {
    event.stopPropagation()
    toast.info('Rendering card…', 1500)
    sharePickCard(b)
      .then((how) => { if (how !== 'cancelled') toast.success(how === 'shared' ? 'Card shared' : 'Card downloaded') })
      .catch(() => toast.warn("Couldn't render the card"))
  }

  const matchup = (
    <>
      <b>{b.team}</b>
      <Icon name="ChevronRight" size={10} aria-hidden="true" />
      <span>{b.opponent?.abbr || '—'}</span>
      <i>·</i>
      <span>vs</span>
    </>
  )

  return (
    <>
      <section
        className={`mobile-potd-card${hrToday ? ' potd-cashed' : ''}`}
        style={{ '--mobile-potd-color': color, '--team-logo': teamLogo(b.teamId) ? `url(${teamLogo(b.teamId)})` : 'none' }}
        aria-label={`Pick of the Day: ${b.name}`}
      >
        <button type="button" className="mobile-potd-open" onClick={openPick}>
          <span className="mobile-potd-silo">
            <img src={playerHeadshot(b.playerId, 96)} alt="" loading="lazy" />
            <small className="mono">{b.batSide}</small>
          </span>
          <span className="mobile-potd-copy">
            <span className="mobile-potd-name-line">
              <strong>{b.name}</strong>
              <GradeChip grade={b.grade} size="sm" />
              {hrToday ? <em className="mobile-potd-live">HR</em> : live ? <em className="mobile-potd-live">LIVE</em> : null}
            </span>
            <span className="mobile-potd-matchup">
              {matchup}
              <span>{b.pitcher?.name || 'TBD'}{b.pitcher?.hand ? ` (${b.pitcher.hand}HP)` : ''}</span>
            </span>
            <span className="mobile-potd-verdict">
              <b>{n === 6 ? 'PERFECT SETUP' : 'SETUP MATCH'} {n}/6</b>
              <i>·</i>
              <span><Icon name="Flame" size={10} /> {heat ?? '—'}</span>
            </span>
          </span>
          <span className="mobile-potd-prob">
            <b className="mono">{pct(b.hrProbability, 1)}</b>
            <small>HR PROB</small>
          </span>
        </button>
        <div className="mobile-potd-actions">
          <button type="button" className={watched ? 'on' : ''} onClick={stop(onToggleWatch)} aria-label={watched ? `Remove ${b.name} from watchlist` : `Watch ${b.name}`}>
            <Icon name="Star" size={15} style={{ fill: watched ? 'currentColor' : 'none' }} />
            <span>{watched ? 'Watching' : 'Watch'}</span>
          </button>
          <button type="button" className={`primary ${inSlip ? 'on' : ''}`} onClick={stop(onToggleSlip)} aria-label={inSlip ? `Remove ${b.name} from slip` : `Add ${b.name} to slip`}>
            <Icon name={inSlip ? 'Check' : 'Plus'} size={15} />
            <span>{inSlip ? 'In slip' : 'Add to slip'}</span>
          </button>
        </div>
      </section>

      <section
        className={`potd potd-decision-stack${hrToday ? ' potd-cashed' : ''}`}
        style={{ '--row-accent': color, '--team-logo': teamLogo(b.teamId) ? `url(${teamLogo(b.teamId)})` : 'none' }}
        role="button"
        tabIndex={0}
        onClick={openPick}
        onKeyDown={openPickFromKeyboard}
        aria-label={`Open research for Pick of the Day ${b.name}`}
      >
        <header className="potd-stack-head">
          <span className="potd-kicker"><Icon name="Trophy" size={13} /> Pick of the Day</span>
          <span className="potd-stack-state">
            {hrToday ? <span className="potd-hr-chip"><Icon name="Flame" size={11} /> HOMERED</span> : live ? <span className="live-tag"><Icon name="RadioTower" size={10} /> LIVE</span> : null}
            <span className={`potd-lineup ${b.lineupConfirmed ? 'on' : 'pending'}`}>
              <Icon name={b.lineupConfirmed ? 'UserRoundCheck' : 'Clock3'} size={11} />
              {b.lineupConfirmed ? 'Confirmed' : 'Projected'}{b.battingOrder ? ` · #${b.battingOrder}` : ''}
            </span>
            {onDismiss && (
              <button type="button" className="potd-dismiss" onClick={stop(onDismiss)} aria-label="Dismiss Pick of the Day" title="Dismiss">
                <Icon name="X" size={13} />
              </button>
            )}
          </span>
        </header>

        <div className="potd-stack-content">
          <div className="potd-stack-hero">
            <span className="potd-stack-silo">
              <img src={playerHeadshot(b.playerId, 120)} alt="" loading="lazy" />
              <small className="mono">{b.batSide}</small>
            </span>
            <span className="potd-stack-identity">
              <span className="potd-name-line">
                <strong className="potd-name">{b.name}</strong>
                <GradeChip grade={b.grade} score={b.score} />
              </span>
              <span className="potd-matchup">
                {matchup}
                {canOpenPitcher ? (
                  <button type="button" className="pitch-link" onClick={(event) => { event.stopPropagation(); onOpenPitcher(b.pitcher.id, b.gamePk) }} title={`Open ${b.pitcher.name}'s pitcher card`}>
                    {b.pitcher.name}{b.pitcher?.hand ? ` (${b.pitcher.hand}HP)` : ''}
                  </button>
                ) : <span>{b.pitcher?.name || 'TBD'}{b.pitcher?.hand ? ` (${b.pitcher.hand}HP)` : ''}</span>}
              </span>
            </span>
            <span className="potd-stack-prob">
              <ProbRing value={b.hrProbability} color={color} size={54} />
              <small>HR PROB</small>
            </span>
          </div>

          <div className="potd-stack-verdict">
            <span>
              <b className={n === 6 ? 'perfect-setup' : ''}>{n === 6 ? 'PERFECT SETUP' : 'SETUP MATCH'} {n}/6</b>
              <small><Icon name="Flame" size={10} /> Heat {heat ?? '—'} · {heatTag(heat)}</small>
            </span>
            <span className="potd-stack-evidence">
              {featuredChecks.map((check) => (
                <span key={check.key} title={check.detail}>
                  <Icon name={EVIDENCE_ICONS[check.key] || 'Check'} size={11} />
                  {check.label}
                </span>
              ))}
              {moreEvidence > 0 && <button type="button" onClick={(event) => { event.stopPropagation(); openPick() }}>+{moreEvidence} evidence</button>}
            </span>
          </div>
        </div>

        <footer className="potd-stack-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" className={watched ? 'on watch' : ''} onClick={stop(onToggleWatch)}>
            <Icon name="Star" size={14} style={{ fill: watched ? 'currentColor' : 'none' }} />
            <span>{watched ? 'Watching' : 'Watch'}</span>
          </button>
          <button type="button" className={`primary ${inSlip ? 'on' : ''}`} onClick={stop(onToggleSlip)}>
            <Icon name={inSlip ? 'Check' : 'Plus'} size={14} />
            <span>{inSlip ? 'In slip' : 'Add to slip'}</span>
          </button>
          <button type="button" onClick={sharePick}>
            <Icon name="Share2" size={14} />
            <span>Share</span>
          </button>
        </footer>
      </section>
    </>
  )
}
