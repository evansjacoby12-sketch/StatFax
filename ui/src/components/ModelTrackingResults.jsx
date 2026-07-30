import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { timeAgo } from '../lib/format.js'
import { buildModelTracking } from '../lib/modelTracking.js'
import { loadBacktestLog } from '../lib/backtestLog.js'
import ModelTrackingLedger from './ModelTrackingLedger.jsx'

const WINDOW_DAYS = 7

function recordLabel(summary) {
  return `${summary?.wins || 0}-${summary?.losses || 0}-${summary?.pushes || 0}`
}

function recordTone(summary) {
  if (!summary?.settled || summary.wins === summary.losses) return 'is-neutral'
  return summary.wins > summary.losses ? 'is-positive' : 'is-negative'
}

function economicsLabel(summary, pricesAvailable) {
  if (!pricesAvailable) return 'Prices unavailable'
  if (!summary?.settled) return 'Awaiting finals'
  if (!Number.isFinite(summary.units) || !Number.isFinite(summary.roi)) {
    return `${summary.pricedSettled}/${summary.settled} priced`
  }
  const units = `${summary.units >= 0 ? '+' : ''}${summary.units.toFixed(2)}u`
  const roi = `${summary.roi >= 0 ? '+' : ''}${(summary.roi * 100).toFixed(1)}% ROI`
  return `${units} · ${roi}`
}

function liveActivity(market, summary) {
  const parts = []
  if (market === 'moneyline') {
    if (summary.leading) parts.push(`${summary.leading} leading`)
    if (summary.trailing) parts.push(`${summary.trailing} trailing`)
    if (summary.tied) parts.push(`${summary.tied} tied`)
    if (summary.openLive) parts.push(`${summary.openLive} live`)
  } else if (market === 'total') {
    if (summary.clinchedWins) parts.push(`${summary.clinchedWins} clinched W`)
    if (summary.clinchedLosses) parts.push(`${summary.clinchedLosses} clinched L`)
    if (summary.openLive) parts.push(`${summary.openLive} live`)
  } else if (summary.live) {
    parts.push(`${summary.live} live 1st`)
  }
  if (summary.pending) parts.push(`${summary.pending} pending`)
  return parts.length ? parts.join(' · ') : 'No active calls'
}

function ModelTrackingCard({
  title,
  icon,
  market,
  tracking,
  actionLabel,
  diagnosticLabel,
  category,
  pricesAvailable = true,
  onOpen,
}) {
  const { primary, diagnostic } = tracking
  return (
    <button
      type="button"
      className={`fi-track-card is-${market} is-directional`}
      onClick={onOpen}
      aria-label={`View game-by-game ${title} results`}
    >
      <header>
        <span><Icon name={icon} size={12} /><b>{title}</b></span>
        <em>{category}<Icon name="ChevronRight" size={9} /></em>
      </header>
      <div className="fi-track-score">
        <span>
          <small>{actionLabel}</small>
          <strong className={`mono ${recordTone(primary)}`}>{recordLabel(primary)}</strong>
        </span>
        <span className="fi-track-economics">{economicsLabel(primary, pricesAvailable)}</span>
      </div>
      <div className="fi-track-activity">
        <Icon name="Radio" size={10} />
        <span>{liveActivity(market, primary)}</span>
      </div>
      <footer>
        <span><small>{diagnosticLabel}</small><b className="mono">{recordLabel(diagnostic)}</b></span>
        <span>{diagnostic.pending ? `${diagnostic.pending} pending` : 'Diagnostic only'}</span>
      </footer>
    </button>
  )
}

export default function ModelTrackingResults({
  games = [],
  gameProjections = {},
  generatedAt = null,
  detailOpen = false,
  onOpenDetails,
  onCloseDetails,
}) {
  const [history, setHistory] = useState(null)
  const [historyFailed, setHistoryFailed] = useState(false)

  useEffect(() => {
    let alive = true
    loadBacktestLog()
      .then((log) => {
        if (!alive) return
        setHistory(log)
        setHistoryFailed(false)
      })
      .catch(() => {
        if (!alive) return
        setHistoryFailed(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const asOfDate = generatedAt?.slice?.(0, 10) || null
  const tracking = useMemo(
    () => buildModelTracking(games, gameProjections, {
      asOfDate,
      windowDays: WINDOW_DAYS,
      resultsByDate: history?.gameForecasts?.resultsByDate || {},
    }),
    [asOfDate, games, gameProjections, history],
  )
  const historyStatus = historyFailed
    ? 'History unavailable · showing today'
    : history == null
      ? 'Loading seven-day history'
      : `${tracking.settledDays} of ${tracking.windowDays} days settled`

  if (detailOpen) {
    return (
      <ModelTrackingLedger
        tracking={tracking}
        historyStatus={historyStatus}
        onBack={onCloseDetails}
      />
    )
  }

  return (
    <section className="fi-model-results results-model-tracking" aria-label="Seven-day model results">
      <header className="fi-model-results-head">
        <button type="button" className="fi-model-results-link" onClick={onOpenDetails}>
          <Icon name="Activity" size={12} />
          <b>Seven-day model tracking</b>
          <Icon name="ChevronRight" size={11} />
        </button>
        <span className={tracking.anyLive ? 'is-live' : ''}>
          {tracking.anyLive && <i />}
          {tracking.anyLive ? 'Live' : 'Pregame'}
          {generatedAt ? ` · updated ${timeAgo(generatedAt)}` : ''}
        </span>
        <small>{historyStatus} · finals form the record · active leads stay live</small>
      </header>
      <div className="fi-model-results-grid">
        <ModelTrackingCard
          title="Moneyline"
          icon="Trophy"
          market="moneyline"
          tracking={tracking.moneyline}
          actionLabel={tracking.moneyline.actionLabel}
          diagnosticLabel={tracking.moneyline.diagnosticLabel}
          category="Side"
          onOpen={onOpenDetails}
        />
        <ModelTrackingCard
          title="Over"
          icon="ArrowUp"
          market="over"
          tracking={tracking.total.over}
          actionLabel={tracking.total.actionLabel}
          diagnosticLabel={tracking.total.diagnosticLabel}
          category="Total"
          onOpen={onOpenDetails}
        />
        <ModelTrackingCard
          title="Under"
          icon="ArrowDown"
          market="under"
          tracking={tracking.total.under}
          actionLabel={tracking.total.actionLabel}
          diagnosticLabel={tracking.total.diagnosticLabel}
          category="Total"
          onOpen={onOpenDetails}
        />
        <ModelTrackingCard
          title="NRFI"
          icon="TimerReset"
          market="nrfi"
          tracking={tracking.firstInning.nrfi}
          actionLabel={tracking.firstInning.actionLabel}
          diagnosticLabel={tracking.firstInning.diagnosticLabel}
          category="Inn 1"
          pricesAvailable={false}
          onOpen={onOpenDetails}
        />
        <ModelTrackingCard
          title="YRFI"
          icon="Zap"
          market="yrfi"
          tracking={tracking.firstInning.yrfi}
          actionLabel={tracking.firstInning.actionLabel}
          diagnosticLabel={tracking.firstInning.diagnosticLabel}
          category="Inn 1"
          pricesAvailable={false}
          onOpen={onOpenDetails}
        />
      </div>
    </section>
  )
}
