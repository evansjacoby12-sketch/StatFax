import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import CallKey from './CallKey.jsx'
import { loadBacktestLog } from '../lib/backtestLog.js'
import {
  buildGameCombos,
  buildHistoricalGameComboTracking,
  comboRequirements,
  currentGameComboLegs,
} from '../lib/gameComboEngine.js'
import { pct } from '../lib/format.js'

function dateKey(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return match?.[1] || null
}

function gameTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return 'TBD'
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function tierLabel(leg) {
  return `${leg.tier.toUpperCase()} ${leg.market === 'moneyline' ? 'ML' : leg.market === 'under' ? 'UNDER' : 'NRFI'}`
}

function Record({ value }) {
  const settled = value.wins + value.losses + value.pushes
  return <span>{settled ? `${value.wins}-${value.losses}-${value.pushes}` : '0 settled'}</span>
}

function ComboCard({ combo, tracking }) {
  return (
    <article className={`game-combo-card is-${combo.size}`}>
      <header className="game-combo-card-head">
        <div>
          <span className="game-combo-kicker">{combo.size}-leg recipe</span>
          <h3>{combo.label}</h3>
          <p>{combo.description}</p>
        </div>
        <div className="game-combo-chance">
          <strong>{pct(combo.probability)}</strong>
          <span>all-hit chance</span>
        </div>
      </header>

      <div className="game-combo-legs">
        {combo.legs.map((leg, index) => (
          <div className="game-combo-leg" key={leg.id}>
            <span className="game-combo-leg-number">{index + 1}</span>
            <div className="game-combo-leg-copy">
              <b>{leg.selection}</b>
              <span>{leg.matchup}{leg.gameNumber > 1 ? ` · G${leg.gameNumber}` : ''} · {gameTime(leg.gameDate)}</span>
            </div>
            <div className="game-combo-leg-signal">
              <span className={`game-combo-tier is-${leg.tier}`}>{tierLabel(leg)}</span>
              <small>{pct(leg.probability)}</small>
            </div>
          </div>
        ))}
      </div>

      <footer className="game-combo-card-foot">
        <span><Icon name="CircleCheck" size={12} /> Different gamePks</span>
        <span><Icon name="CircleDollarSign" size={12} /> EV unavailable · NRFI price missing</span>
        <span className="game-combo-record"><b>7-day</b> <Record value={tracking} /></span>
      </footer>
    </article>
  )
}

function EmptyState({ requirements }) {
  return (
    <div className="game-combo-empty">
      <Icon name="Layers" size={28} />
      <div>
        <h3>No valid cross-market recipe yet</h3>
        <p>The lab needs different games with both starters attached and at least 72% input coverage.</p>
      </div>
      <div className="game-combo-supply" aria-label="Eligible leg supply">
        <span><b>{requirements.moneyline}</b> ML</span>
        <span><b>{requirements.under}</b> Under</span>
        <span><b>{requirements.nrfi}</b> NRFI</span>
      </div>
    </div>
  )
}

export default function GameCombosView({ games = [], gameProjections = {}, generatedAt = null }) {
  const [history, setHistory] = useState(null)
  const [historyError, setHistoryError] = useState(false)
  const legs = useMemo(
    () => currentGameComboLegs(games, gameProjections),
    [games, gameProjections],
  )
  const combos = useMemo(() => buildGameCombos(legs), [legs])
  const requirements = useMemo(() => comboRequirements(legs), [legs])
  const asOfDate = useMemo(() => (
    games.map((game) => dateKey(game?.gameDate)).filter(Boolean).sort().at(-1)
      || dateKey(generatedAt)
      || new Date().toISOString().slice(0, 10)
  ), [games, generatedAt])
  const tracking = useMemo(() => buildHistoricalGameComboTracking(
    history?.gameForecasts?.resultsByDate || {},
    asOfDate,
    7,
  ), [history, asOfDate])

  useEffect(() => {
    let active = true
    loadBacktestLog()
      .then((value) => {
        if (active) setHistory(value)
      })
      .catch(() => {
        if (active) setHistoryError(true)
      })
    return () => { active = false }
  }, [])

  return (
    <section className="game-combos-view" aria-label="Game Combo Lab">
      <div className="game-combo-overview">
        <div>
          <span className="game-combo-eyebrow"><Icon name="Layers" size={13} /> Game Combo Lab v1</span>
          <h2>Three recipes. No shuffle.</h2>
          <p>Combines the current game-model calls only. It never changes a leg, repeats a game inside a combo, or invents a price.</p>
        </div>
        <div className="game-combo-track-grid" aria-label="Seven-day combo tracking">
          <div><span>2-leg</span><strong><Record value={tracking.twoLeg} /></strong></div>
          <div><span>3-leg</span><strong><Record value={tracking.threeLeg} /></strong></div>
          <small>{historyError ? 'History unavailable' : history ? 'Frozen pregame calls' : 'Loading record…'}</small>
        </div>
      </div>

      <CallKey className="game-combo-call-key" />

      {combos.length ? (
        <div className="game-combo-grid">
          {combos.map((combo) => (
            <ComboCard
              combo={combo}
              key={combo.id}
              tracking={tracking.byRecipe[combo.id] || { wins: 0, losses: 0, pushes: 0, pending: 0 }}
            />
          ))}
        </div>
      ) : <EmptyState requirements={requirements} />}

      <div className="game-combo-notes">
        <span><Icon name="Shield" size={12} /> PLAY/LEAN ML is actionable; PASS Under and WATCH NRFI remain diagnostic signals.</span>
        <span><Icon name="GitBranch" size={12} /> YRFI, Over, same-game legs, missing starters, and high blow-up-risk Unders are excluded.</span>
        <span><Icon name="Database" size={12} /> Seven-day records are rebuilt from frozen pregame calls; outcomes never choose the legs.</span>
      </div>
    </section>
  )
}
