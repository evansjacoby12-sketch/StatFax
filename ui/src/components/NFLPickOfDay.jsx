import { useState } from 'react'
import Icon from './Icon.jsx'
import { ProbRing } from './atoms.jsx'
import { useEliLevel } from '../lib/eliLevel.js'
import { nflSignalText } from '../lib/nflExplanations.js'
import { assessNFLSignals } from '../../../src/sports/nfl/logic/signals.js'
import { NFL_PROP_MARKET_LIST } from '../../../src/sports/nfl/logic/propEligibility.js'
import { americanOdds } from '../lib/nflCombos.js'
import { getNFLPropSettlement, isNFLTDMarket } from '../lib/nflTickets.js'

const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)', SKIP: 'var(--skip)' }

const NFL_TEAM_COLORS = {
  ARI: '#97233f', ATL: '#a71930', BAL: '#6a4c93', BUF: '#2f5fa7', CAR: '#0085ca', CHI: '#c83803', CIN: '#fb4f14', CLE: '#ff3c00',
  DAL: '#5b6f8f', DEN: '#fb4f14', DET: '#0076b6', GB: '#203731', HOU: '#03202f', IND: '#315f91', JAX: '#008e97', KC: '#e31837',
  LAC: '#0080c6', LAR: '#315f91', LVR: '#a5acaf', MIA: '#008e97', MIN: '#4f2683', NE: '#315f91', NO: '#d3bc8d', NYG: '#315f91',
  NYJ: '#125740', PHI: '#004c54', PIT: '#ffb612', SEA: '#69be28', SF: '#aa0000', TB: '#d50a0a', TEN: '#4b92db', WAS: '#773141',
}

const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`
const odds = (value) => value == null ? '—' : value > 0 ? `+${value}` : String(value)
const number = (value, digits = 0) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits)

function marketValue(player, model, marketId, side = 'over') {
  if (!model) return '—'
  const isTD = isNFLTDMarket(marketId)
  if (isTD) {
    if (model.odds != null) return odds(model.odds)
    if (model.probability != null && model.probability > 0) {
      const fair = americanOdds(1 / model.probability)
      return fair ? `Fair ${odds(fair)}` : '—'
    }
    return '—'
  }
  const effectiveSide = side === 'under' || model.side === 'under' ? 'under' : 'over'
  const sidePrefix = effectiveSide === 'under' ? 'U' : 'O'
  const activeOdds = effectiveSide === 'under' ? (model.underOdds ?? model.odds) : (model.overOdds ?? model.odds)
  const lineStr = model.line != null ? `${sidePrefix} ${number(model.line, marketId === 'receptions' ? 1 : 1)}` : null
  const oddsStr = activeOdds != null ? `(${odds(activeOdds)})` : null
  if (lineStr && oddsStr) return `${lineStr} ${oddsStr}`
  if (lineStr) return lineStr
  if (oddsStr) return oddsStr
  if (model.probability != null && model.probability > 0) {
    const fair = americanOdds(1 / model.probability)
    return fair ? `Fair ${odds(fair)}` : '—'
  }
  return '—'
}

function signalIcon(signal) {
  if (['end-zone-alpha', 'goal-to-go-dominator'].includes(signal.key)) return 'Crown'
  if (['opportunity-spike', 'air-yards-leader', 'rushing-over-expected'].includes(signal.key)) return 'TrendingUp'
  if (signal.key === 'drive-participation') return 'Activity'
  if (signal.key === 'qb-keeper-threat') return 'Zap'
  if (signal.key === 'defense-funnel') return 'Shield'
  if (signal.key === 'yac-creator') return 'Sparkles'
  if (signal.key === 'separation-edge') return 'GitMerge'
  if (['committee-risk', 'scoring-role-lost', 'protection-mismatch', 'quick-pressure-risk', 'snap-limit'].includes(signal.key)) return 'TriangleAlert'
  if (signal.key === 'touchdown') return 'Flame'
  if (signal.key === 'split') return 'Home'
  if (signal.key.includes('rz') || signal.key === 'goal-line') return 'Target'
  return 'TrendingUp'
}

function compactSignalValue(signal) {
  if (!signal) return 'Limited'
  const percent = signal.text?.match(/\d+%/)?.[0]
  if (signal.key === 'end-zone-alpha') return percent ? `${percent} EZ` : 'EZ alpha'
  if (signal.key === 'goal-to-go-dominator') return percent ? `${percent} G2G` : 'Goal role'
  if (signal.key === 'opportunity-spike') return percent ? `Role +${percent}` : 'Role up'
  if (signal.key === 'scoring-role-lost') return percent ? `Role -${percent}` : 'Role down'
  if (signal.key === 'drive-participation') return percent ? `${percent} drives` : 'Drive role'
  if (signal.key === 'committee-risk') return percent ? `${percent} carries` : 'Committee'
  if (signal.key === 'defense-funnel') return 'Funnel'
  if (signal.key === 'qb-keeper-threat') return 'QB rush'
  if (signal.key === 'air-yards-leader') return percent ? `${percent} air` : 'Air share'
  if (signal.key === 'yac-creator') return 'YAC +'
  if (signal.key === 'rushing-over-expected') return 'RYOE +'
  if (signal.key === 'separation-edge') return 'Separation'
  if (['protection-mismatch', 'quick-pressure-risk'].includes(signal.key)) return 'Pressure'
  if (signal.key === 'snap-limit') return percent ? `${percent} snaps` : 'Snap limit'
  if (signal.key === 'rz-targets') return `${signal.text?.match(/^\d+/)?.[0] || ''} RZ tgt`.trim()
  if (signal.key === 'rz-touches') return `${signal.text?.match(/^\d+/)?.[0] || ''} RZ touch`.trim()
  if (signal.key === 'goal-line') return 'Goal line'
  if (signal.key === 'goal-line-package') return 'GL package'
  if (signal.key === 'target-share') return percent ? `${percent} tgt` : 'Target share'
  if (signal.key === 'snap-share') return percent ? `${percent} snaps` : 'Snap share'
  if (signal.key === 'route-participation') return percent ? `${percent} routes` : 'Route share'
  if (signal.key === 'lineup-confirmed') return 'Confirmed'
  if (signal.key === 'role-inheritance') return 'Role up'
  if (signal.games) return `${signal.games}G ${signal.label || signal.key}`
  if (signal.key === 'split') return signal.text?.replace(' edge', '') || 'Split'
  return signal.text?.split(' ').slice(0, 2).join(' ') || 'Evidence'
}

export default function NFLPickOfDay({
  player,
  marketId = 'anytime_td',
  side = 'over',
  onSetSide,
  watched = false,
  inSlip = false,
  onSelect,
  onToggleWatch,
  onToggleSlip,
  onDismiss,
}) {
  const eliLevel = useEliLevel()
  const [failedHeadshot, setFailedHeadshot] = useState(false)

  if (!player) return null

  const { model } = player
  const isTD = isNFLTDMarket(marketId)
  const gradeColor = GRADE_COLORS[model.grade] || 'var(--prime)'
  const teamColor = NFL_TEAM_COLORS[player.team] || '#9795cb'
  const assessment = assessNFLSignals(model.signals)
  const marketInfo = NFL_PROP_MARKET_LIST.find((item) => item.id === marketId)
  const score = Math.round(Number(model.score || 0))
  const proofSignals = model.signals.slice(0, 4)
  const hasHeadshot = Boolean(player.headshotUrl && !failedHeadshot)
  const settlement = getNFLPropSettlement(player, marketId, model.line, side)

  return (
    <section
      className="nfl-potd-card"
      style={{
        '--potd-grade-color': gradeColor,
        '--potd-team-color': teamColor,
      }}
      aria-labelledby="nfl-potd-title"
    >
      <header className="nfl-potd-header">
        <div className="nfl-potd-kicker">
          <span className="nfl-potd-crown" aria-hidden="true">
            <Icon name="Crown" size={14} />
          </span>
          <strong id="nfl-potd-title">Model Top Pick</strong>
          <span className="dot-sep">·</span>
          <span className="nfl-potd-market-pill">{marketInfo?.label || marketId}</span>
          {!isTD && onSetSide && (
            <div className="nfl-side-toggle is-compact" role="group" aria-label="Top pick side selector">
              <button
                type="button"
                className={`side-btn ${side === 'over' ? 'active' : ''}`}
                onClick={() => onSetSide('over')}
              >
                OVER
              </button>
              <button
                type="button"
                className={`side-btn ${side === 'under' ? 'active' : ''}`}
                onClick={() => onSetSide('under')}
              >
                UNDER
              </button>
            </div>
          )}
          {settlement.status !== 'pending' && (
            <span className={`nfl-settlement-badge is-${settlement.status}`}>
              <Icon name={settlement.status === 'won' ? 'CheckCircle2' : settlement.status === 'lost' ? 'XCircle' : 'Activity'} size={12} />
              <b>{settlement.status.toUpperCase()}</b>
              {settlement.label && <small>{settlement.label}</small>}
            </span>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            className="nfl-potd-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss Top Pick hero banner"
            title="Dismiss top pick banner"
          >
            <Icon name="X" size={14} />
          </button>
        )}
      </header>

      <div className="nfl-potd-body">
        <div className="nfl-potd-identity">
          <span
            className="nfl-headshot-silo is-workspace nfl-potd-headshot"
            style={{ '--team-color': teamColor }}
            aria-hidden="true"
          >
            {!hasHeadshot && (
              <span className="nfl-headshot-fallback">
                <Icon name="Users" size={26} />
              </span>
            )}
            {hasHeadshot && (
              <img
                src={player.headshotUrl}
                alt=""
                loading="lazy"
                onError={() => setFailedHeadshot(true)}
              />
            )}
          </span>

          <div className="nfl-potd-identity-info">
            <div className="nfl-potd-name-row">
              <h2 className="nfl-potd-player-name">{player.name}</h2>
              <span className="nfl-position">{player.position}</span>
              <span className={`nfl-potd-assessment is-${assessment.level}`}>
                <Icon name={assessment.level === 'good' ? 'CircleCheck' : assessment.level === 'caution' ? 'Info' : 'TriangleAlert'} size={11} />
                {assessment.label}
              </span>
            </div>

            <div className="nfl-potd-matchup-row">
              <b>{player.team}</b>
              <Icon name="ChevronRight" size={11} aria-hidden="true" />
              <span>{player.opponent}</span>
              <span className="dot-sep">·</span>
              <span>{player.kickoff || 'Upcoming'}</span>
              <span className="dot-sep">·</span>
              <span>{player.isHome ? 'Home' : 'Away'}</span>
              {player.live?.isLive && (
                <>
                  <span className="dot-sep">·</span>
                  <span className="live-tag">
                    <span className="live-dot" /> LIVE
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="nfl-potd-numbers">
          <div className="nfl-potd-stat-box is-prob">
            <div className="nfl-potd-gauge">
              <ProbRing value={model.probability} color={gradeColor} size={60} />
            </div>
            <div className="nfl-potd-gauge-copy">
              <small>PROBABILITY</small>
              <strong className="mono" style={{ color: gradeColor }}>{pct(model.probability)}</strong>
            </div>
          </div>

          <div className="nfl-potd-stat-box is-verdict">
            <small>MODEL GRADE</small>
            <div className="nfl-potd-grade-val" style={{ color: gradeColor }}>
              <span>{model.grade}</span>
              <b className="mono">{score}</b>
            </div>
          </div>

          <div className="nfl-potd-stat-box is-market">
            <small>MARKET & EDGE</small>
            <div className="nfl-potd-edge-val">
              <strong className="mono">{marketValue(player, model, marketId, side)}</strong>
              <em className={`mono ${model.edge == null ? '' : model.edge >= 0 ? 'positive' : 'negative'}`}>
                {model.edge == null ? (model.probability > 0 ? 'Fair baseline' : 'No line') : `${model.edge >= 0 ? '+' : ''}${pct(model.edge)}${model.suggestedUnits != null ? ` (${model.suggestedUnits}u)` : ''}`}
              </em>
            </div>
          </div>
        </div>
      </div>

      <div className="nfl-potd-footer">
        <div className="nfl-potd-signals" aria-label="Key signals for top pick">
          {proofSignals.map((signal) => {
            const tone = signal.assessment === 'avoid' ? 'bad' : signal.assessment === 'caution' ? 'warn' : 'good'
            return (
              <span
                key={signal.key}
                className={`nfl-potd-signal-chip is-${tone}`}
                title={nflSignalText(signal, eliLevel)}
              >
                <Icon name={signalIcon(signal)} size={11} />
                <b>{compactSignalValue(signal)}</b>
              </span>
            )
          })}
        </div>

        <div className="nfl-potd-actions">
          <button
            type="button"
            className="nfl-potd-btn is-research"
            onClick={() => onSelect?.(player)}
          >
            <Icon name="ScanSearch" size={14} />
            <span>Research</span>
          </button>
          <button
            type="button"
            className={`nfl-potd-btn is-slip ${inSlip ? 'is-added' : ''}`}
            onClick={() => onToggleSlip?.(player, side)}
          >
            <Icon name={inSlip ? 'Check' : 'Plus'} size={14} />
            <span>{inSlip ? 'In Slip' : isTD ? 'Take TD' : `Take ${side === 'under' ? 'Under' : 'Over'}`}</span>
          </button>
          <button
            type="button"
            className={`nfl-potd-btn is-watch ${watched ? 'is-watched' : ''}`}
            onClick={() => onToggleWatch?.(player)}
            aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
            title={watched ? 'Watching' : 'Watch player'}
          >
            <Icon name="Star" size={15} />
          </button>
        </div>
      </div>
    </section>
  )
}

