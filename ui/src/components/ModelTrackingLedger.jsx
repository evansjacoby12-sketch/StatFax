import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'settled', label: 'Settled' },
  { id: 'live', label: 'Live' },
  { id: 'pending', label: 'Pending' },
]

const OUTCOME_META = {
  win: { icon: 'CheckCircle2', label: 'Win' },
  loss: { icon: 'X', label: 'Loss' },
  push: { icon: 'Minus', label: 'Push' },
  live: { icon: 'Radio', label: 'Live' },
  pending: { icon: 'Clock3', label: 'Pending' },
  'no-call': { icon: 'Minus', label: 'No call' },
}

function dateLabel(date, windowEnd) {
  if (!date) return 'Date unavailable'
  const value = new Date(`${date}T12:00:00`)
  const formatted = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  }).format(value)
  if (date === windowEnd) return `Today · ${formatted}`
  const previous = new Date(`${windowEnd}T12:00:00`)
  previous.setDate(previous.getDate() - 1)
  if (date === previous.toISOString().slice(0, 10)) return `Yesterday · ${formatted}`
  return formatted
}

function timeLabel(value) {
  if (!value) return 'Time unavailable'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Time unavailable'
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed)
}

function inningLabel(row) {
  if (!row.currentInning) return 'Live'
  const half = String(row.inningHalf || '').toLowerCase()
  const prefix = half.includes('top') ? 'Top' : half.includes('bottom') ? 'Bot' : ''
  return `${prefix} ${row.currentInning}`.trim()
}

function priceLabel(value) {
  if (!Number.isFinite(value)) return null
  return value > 0 ? `+${value}` : String(value)
}

function callOutcome(call) {
  if (!call?.available) return 'no-call'
  if (call.tracking?.outcome) return call.tracking.outcome
  if (call.tracking?.liveState) return 'live'
  return 'pending'
}

function selectionLabel(call, market) {
  if (!call?.available) return 'No recommendation'
  if (market === 'moneyline') return call.selectedTeam?.abbr || call.selectedSide?.toUpperCase()
  if (market === 'total') return `${call.selectedSide?.toUpperCase()} ${Number(call.line).toFixed(1)}`
  return call.selectedSide?.toUpperCase()
}

function ModelCall({ title, market, call }) {
  const outcome = callOutcome(call)
  const meta = OUTCOME_META[outcome]
  const price = market === 'firstInning' ? null : priceLabel(call?.american)
  return (
    <div className={`model-ledger-call is-${outcome}`}>
      <small>{title}</small>
      <div>
        <b>{selectionLabel(call, market)}</b>
        <span className="model-ledger-outcome">
          <Icon name={meta.icon} size={12} />
          {meta.label}
        </span>
      </div>
      <em>
        {call?.available ? call.tier?.toUpperCase() : 'NO CALL'}
        {price ? ` · ${price}` : ''}
      </em>
    </div>
  )
}

function GameSummary({ row }) {
  const hasScore = Number.isFinite(row.awayScore) && Number.isFinite(row.homeScore)
  const doubleheader = row.doubleHeader && row.doubleHeader !== 'N'
  return (
    <div className="model-ledger-game">
      <div>
        <b>{row.away.abbr} @ {row.home.abbr}</b>
        {doubleheader && <em>Game {row.gameNumber}</em>}
      </div>
      {row.isFinal ? (
        <span className="model-ledger-game-state is-settled">Final</span>
      ) : row.isLive ? (
        <span className="model-ledger-game-state is-live"><Icon name="Radio" size={10} />{inningLabel(row)}</span>
      ) : (
        <span className="model-ledger-game-state"><Icon name="Clock3" size={10} />{timeLabel(row.gameDate)}</span>
      )}
      <small>
        {hasScore
          ? `${row.away.abbr} ${row.awayScore} · ${row.home.abbr} ${row.homeScore}`
          : row.venueName || `${row.away.name} at ${row.home.name}`}
      </small>
    </div>
  )
}

export default function ModelTrackingLedger({
  tracking,
  historyStatus,
  onBack,
}) {
  const [filter, setFilter] = useState('all')
  const rows = useMemo(
    () => tracking.details.filter((row) => filter === 'all' || row.state === filter),
    [filter, tracking.details],
  )
  const groups = useMemo(() => {
    const byDate = new Map()
    for (const row of rows) {
      const date = row.date || 'unknown'
      if (!byDate.has(date)) byDate.set(date, [])
      byDate.get(date).push(row)
    }
    return [...byDate.entries()]
  }, [rows])

  return (
    <section className="model-ledger" aria-label="Seven-day game results">
      <header className="model-ledger-head">
        <div>
          <button type="button" onClick={onBack}>
            <Icon name="ChevronLeft" size={13} />
            Back to model results
          </button>
          <h2>Seven-day game results</h2>
          <p>
            {tracking.detailGames} games · {tracking.detailCalls} recorded calls · {historyStatus}
          </p>
        </div>
        <div className="model-ledger-window">
          <small>Rolling sample</small>
          <b className="mono">{tracking.windowStart} — {tracking.windowEnd}</b>
        </div>
      </header>

      <div className="model-ledger-toolbar">
        <div className="model-ledger-filters" aria-label="Filter tracked games">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={filter === item.id ? 'on' : ''}
              aria-pressed={filter === item.id}
              onClick={() => setFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="model-ledger-key" aria-label="Outcome key">
          <span className="is-win"><Icon name="CheckCircle2" size={11} />Win</span>
          <span className="is-loss"><Icon name="X" size={11} />Loss</span>
          <span><Icon name="Minus" size={11} />Push</span>
          <span className="is-live"><Icon name="Radio" size={11} />Live</span>
        </div>
      </div>

      {groups.length ? (
        <div className="model-ledger-groups">
          {groups.map(([date, games]) => (
            <section className="model-ledger-day" key={date}>
              <header>
                <i />
                <b>{dateLabel(date, tracking.windowEnd)}</b>
                <i />
              </header>
              <div className="model-ledger-rows">
                {games.map((row) => (
                  <article className={`model-ledger-row is-${row.state}`} key={row.key}>
                    <GameSummary row={row} />
                    <ModelCall title="Moneyline" market="moneyline" call={row.moneyline} />
                    <ModelCall title="O/U total" market="total" call={row.total} />
                    <ModelCall title="NRFI / YRFI" market="firstInning" call={row.firstInning} />
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="model-ledger-empty">
          <Icon name="ListFilter" size={18} />
          <b>No {filter} games in this seven-day window</b>
          <span>Choose another status to see the recorded slate.</span>
        </div>
      )}

      <footer className="model-ledger-foot">
        <span><Icon name="CheckCircle2" size={11} />Checks and Xs appear only after that market settles.</span>
        <span>PASS and WATCH remain visible for diagnostic grading.</span>
      </footer>
    </section>
  )
}
