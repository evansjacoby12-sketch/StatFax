import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'
import NFLBetLab from './NFLBetLab.jsx'
import SportMarketRail from './SportMarketRail.jsx'
import SportMultiFilterBar from './SportMultiFilterBar.jsx'
import SportSignalRail from './SportSignalRail.jsx'
import NFL_DEMO_SNAPSHOT from '../../../src/sports/nfl/data/demoSlate.js'
import { NFL_PROP_MARKET_LIST, eligiblePropMarkets, eligibilityReason } from '../../../src/sports/nfl/logic/propEligibility.js'
import { scoreNFLSnapshot, scoreNFLProp } from '../../../src/sports/nfl/logic/ScoringEngine.js'
import { assessNFLSignals } from '../../../src/sports/nfl/logic/signals.js'
import { loadNFLSnapshot } from '../../../src/sports/nfl/api/NFLService.js'
import { nflLegKey, settleNFLTicket } from '../lib/nflTickets.js'
import { useEliLevel } from '../lib/eliLevel.js'
import { nflSignalCaption, nflSignalText } from '../lib/nflExplanations.js'
import { SPORT_UI } from '../lib/sportUi.js'
const MARKET_ICONS = {
  anytime_td: 'Target', first_td: 'Trophy', two_plus_td: 'Flame', passing_yards: 'BarChart3', receptions: 'Radio',
  receiving_yards: 'TrendingUp', rushing_yards: 'Zap', rushing_receiving_yards: 'GitMerge', passing_rushing_yards: 'GitBranch',
}
const NFL_SIGNAL_FILTERS = [
  { id: 'role-up', label: 'Role Up', icon: 'ArrowUp', tone: 'prime', match: (player) => player.model.signals.some((signal) => signal.key === 'role-inheritance') },
  { id: 'goal-line', label: 'Goal-Line', icon: 'Target', tone: 'prime', match: (player) => player.model.signals.some((signal) => ['goal-line', 'goal-line-package'].includes(signal.key)) },
  { id: 'red-zone', label: 'Red Zone', icon: 'Crosshair', tone: 'prime', match: (player) => player.model.signals.some((signal) => ['rz-targets', 'rz-touches'].includes(signal.key)) },
  { id: 'route-share', label: 'Route Share', icon: 'MapPin', tone: 'strong', match: (player) => player.model.signals.some((signal) => signal.key === 'route-participation') },
  { id: 'target-share', label: 'Target Share', icon: 'Radio', tone: 'strong', match: (player) => player.model.signals.some((signal) => signal.key === 'target-share') },
  { id: 'snap-share', label: 'Snap Share', icon: 'Clock', tone: 'strong', match: (player) => player.model.signals.some((signal) => signal.key === 'snap-share') },
  { id: 'hot', label: 'Hot', icon: 'Flame', tone: 'lean', match: (player) => player.model.signals.some((signal) => signal.tone === 'hot') },
  { id: 'rising', label: 'Rising', icon: 'TrendingUp', tone: 'lean', match: (player) => player.model.signals.some((signal) => Number(signal.games) === 2) },
  { id: 'td-streak', label: 'TD Streak', icon: 'Zap', tone: 'lean', match: (player) => player.model.signals.some((signal) => signal.key === 'touchdown') },
  { id: 'volume-streak', label: 'Volume Streak', icon: 'BarChart3', tone: 'strong', match: (player) => player.model.signals.some((signal) => ['receptions', 'passing', 'rushing', 'receiving'].includes(signal.key)) },
  { id: 'matchup-edge', label: 'Matchup Edge', icon: 'Shield', tone: 'accent', match: (player) => Number(player.model.defenseFactor) >= 1.04 },
  { id: 'home-edge', label: 'Home Edge', icon: 'House', tone: 'accent', match: (player) => player.isHome && Number(player.splits?.activeEdge) >= .04 },
  { id: 'road-edge', label: 'Road Edge', icon: 'Plane', tone: 'accent', match: (player) => !player.isHome && Number(player.splits?.activeEdge) >= .04 },
  { id: 'weather-edge', label: 'Weather Edge', icon: 'Wind', tone: 'silver', match: (player) => Number(player.model.weather?.factor) > 1.005 },
  { id: 'lineup-confirmed', label: 'Lineup', icon: 'UserCheck', tone: 'silver', match: (player) => player.model.signals.some((signal) => signal.key === 'lineup-confirmed') },
  { id: 'snap-limit', label: 'Snap Limit', icon: 'TriangleAlert', tone: 'bad', match: (player) => player.model.signals.some((signal) => signal.key === 'snap-limit') },
  { id: 'scoring-role', label: 'Scoring Role', icon: 'Crown', tone: 'prime', match: (player) => player.model.signals.some((signal) => ['end-zone-alpha', 'goal-to-go-dominator', 'drive-participation', 'qb-keeper-threat'].includes(signal.key)) },
  { id: 'opportunity-spike', label: 'Role Spike', icon: 'TrendingUp', tone: 'strong', match: (player) => player.model.signals.some((signal) => signal.key === 'opportunity-spike') },
  { id: 'efficiency-edge', label: 'Efficiency', icon: 'Gauge', tone: 'strong', match: (player) => player.model.signals.some((signal) => ['air-yards-leader', 'yac-creator', 'rushing-over-expected', 'separation-edge'].includes(signal.key)) },
  { id: 'defense-funnel', label: 'Funnel', icon: 'Shield', tone: 'accent', match: (player) => player.model.signals.some((signal) => signal.key === 'defense-funnel') },
  { id: 'committee-risk', label: 'Committee', icon: 'Users', tone: 'bad', match: (player) => player.model.signals.some((signal) => signal.key === 'committee-risk') },
  { id: 'role-risk', label: 'Role Risk', icon: 'TriangleAlert', tone: 'bad', match: (player) => player.model.signals.some((signal) => ['scoring-role-lost', 'protection-mismatch', 'quick-pressure-risk'].includes(signal.key)) },
]
const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)', SKIP: 'var(--skip)' }
const NFL_TEAM_COLORS = {
  ARI: '#97233f', ATL: '#a71930', BAL: '#6a4c93', BUF: '#2f5fa7', CAR: '#0085ca', CHI: '#c83803', CIN: '#fb4f14', CLE: '#ff3c00',
  DAL: '#5b6f8f', DEN: '#fb4f14', DET: '#0076b6', GB: '#203731', HOU: '#03202f', IND: '#315f91', JAX: '#008e97', KC: '#e31837',
  LAC: '#0080c6', LAR: '#315f91', LVR: '#a5acaf', MIA: '#008e97', MIN: '#4f2683', NE: '#315f91', NO: '#d3bc8d', NYG: '#315f91',
  NYJ: '#125740', PHI: '#004c54', PIT: '#ffb612', SEA: '#69be28', SF: '#aa0000', TB: '#d50a0a', TEN: '#4b92db', WAS: '#773141',
}

const gameKeyFor = (player) => player.gameId || [player.team, player.opponent].filter(Boolean).sort().join('-')

function PlayerHeadshotSilo({ player, variant = 'compact' }) {
  const teamColor = NFL_TEAM_COLORS[player.team] || '#9795cb'
  const [failedUrl, setFailedUrl] = useState(null)
  const hasHeadshot = Boolean(player.headshotUrl && failedUrl !== player.headshotUrl)
  return <span className={`nfl-headshot-silo is-${variant}`} style={{ '--team-color': teamColor }} aria-hidden="true">{!hasHeadshot && <span className="nfl-headshot-fallback"><Icon name="Users" size={variant === 'workspace' ? 28 : 18} /></span>}{hasHeadshot && <img src={player.headshotUrl} alt="" loading="lazy" onError={() => setFailedUrl(player.headshotUrl)} />}</span>
}

const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`
const odds = (value) => value == null ? '—' : value > 0 ? `+${value}` : String(value)
const number = (value, digits = 0) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits)
const readStorage = (key, fallback) => {
  if (typeof window === 'undefined') return fallback
  try { const value = JSON.parse(window.localStorage.getItem(key)); return value ?? fallback } catch { return fallback }
}

function marketValue(player, model, marketId) {
  if (['anytime_td', 'first_td', 'two_plus_td'].includes(marketId)) return odds(model.odds)
  return model.line == null ? '—' : `${number(model.line, marketId === 'receptions' ? 1 : 1)} line`
}

function liveLabel(player) {
  return player.live?.isLive ? player.live.label || 'LIVE' : player.live?.isFinal ? 'FINAL' : 'Pregame'
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

const ASSESSMENT_META = {
  avoid: { icon: 'TriangleAlert', groupLabel: 'Be wary / avoid', detail: 'Read these before considering the bet' },
  caution: { icon: 'Info', groupLabel: 'Caution', detail: 'Mixed evidence or conditions to monitor' },
  good: { icon: 'CircleCheck', groupLabel: 'Positive', detail: 'Evidence supporting the player' },
}

function AssessmentBadge({ signals, compact = false }) {
  const assessment = assessNFLSignals(signals)
  const meta = ASSESSMENT_META[assessment.level]
  return <span className={`nfl-assessment-badge is-${assessment.level} ${compact ? 'is-compact' : ''}`} aria-label={`Bet assessment: ${assessment.label}`}><Icon name={meta.icon} size={compact ? 10 : 13} /><b>{assessment.label}</b>{!compact && <small>{assessment.headline}</small>}</span>
}

function SignalAssessmentPanel({ signals = [], eliLevel }) {
  const assessment = assessNFLSignals(signals)
  const levels = ['avoid', 'caution', 'good']
  return <div className={`nfl-assessment-panel is-${assessment.level}`}>
    <div className="nfl-assessment-summary"><AssessmentBadge signals={signals} /><span>{signals.length} active signal{signals.length === 1 ? '' : 's'} · red flags always appear first</span></div>
    {levels.map((level) => {
      const group = assessment.groups[level]
      if (!group.length) return null
      const meta = ASSESSMENT_META[level]
      return <section key={level} className={`nfl-assessment-group is-${level}`} aria-label={`${meta.groupLabel} signals`}><header><span><Icon name={meta.icon} size={14} /><b>{meta.groupLabel}</b><em>{group.length}</em></span><small>{meta.detail}</small></header><div className="nfl-research-signals">{group.map((signal) => <article key={signal.key} className={`tone-${signal.tone}`}><Icon name={signalIcon(signal)} size={15} /><div><b>{nflSignalText(signal, eliLevel)}</b><small>{nflSignalCaption(eliLevel)}</small></div></article>)}</div></section>
    })}
    {!signals.length && <div className="nfl-research-empty"><Icon name="Info" size={15} />{eliLevel === 'eli5' ? 'There is not enough clear evidence to call this good or bad yet.' : 'No active role, matchup, or streak signal for this market.'}</div>}
  </div>
}

function NFLPerformance({ snapshot }) {
  const performance = snapshot.modelPerformance
  const markets = Object.entries(performance?.markets || {})
  const quality = snapshot.dataQuality || {}
  const coverage = [
    ['Play-by-play', quality.playByPlay], ['Red zone', quality.redZone], ['Defense splits', quality.defenseByPosition],
    ['First TD labels', quality.firstTouchdown], ['Depth chart', quality.depthChart], ['Lineup roles', quality.lineups], ['Package usage', quality.packageUsage],
    ['Offensive line', Number(quality.offensiveLine) > 0], ['Defensive lineup', Number(quality.defensiveLineup) > 0], ['Official availability', quality.officialAvailability], ['Weather', quality.weatherFresh && Number(quality.weatherCoverage) >= .8],
  ]
  const health = snapshot.dataHealth
  const tracking = snapshot.modelTracking
  const trackingMarkets = Object.entries(tracking?.markets || {})
  const snapshotStale = snapshot.generatedAt && Date.now() - Date.parse(snapshot.generatedAt) > 45 * 60 * 1000
  const healthIssues = [...(health?.issues || []), ...(snapshotStale ? [{ id: 'pipeline', label: 'Pipeline', message: 'Published slate is more than 45 minutes old' }] : [])]
  return <section className="nfl-performance" aria-labelledby="nfl-performance-title">
    <header><div><span className="nfl-eyebrow"><Icon name="Gauge" size={13} /> Model validation</span><h2 id="nfl-performance-title">NFL Model Performance</h2><p>Walk-forward results use only information available before each game.</p></div><span className="nfl-performance-updated">{performance?.generatedAt ? `Updated ${new Date(performance.generatedAt).toLocaleDateString()}` : 'Awaiting backtest'}</span></header>
    <div className="nfl-coverage-grid" aria-label="NFL data coverage">{coverage.map(([label, ready]) => <div key={label} className={ready ? 'is-ready' : 'is-limited'}><Icon name={ready ? 'CircleCheck' : 'TriangleAlert'} size={15} /><span><b>{label}</b><small>{ready ? 'Connected' : 'Limited'}</small></span></div>)}</div>
    {healthIssues.length > 0 && <div className="nfl-health-alert" role="status" aria-live="polite"><Icon name="TriangleAlert" size={16} /><span><b>{healthIssues.length} feed{healthIssues.length === 1 ? '' : 's'} need attention</b><small>{healthIssues.map((issue) => `${issue.label}: ${issue.message}`).join(' · ')}</small></span></div>}
    <section className="nfl-tracking-summary" aria-label="Season tracking"><header><span><Icon name="LineChart" size={14} /> Season tracking</span><small>{tracking?.updatedAt ? `Updated ${new Date(tracking.updatedAt).toLocaleString()}` : 'Starts with the next slate'}</small></header><div><span><b className="mono">{Number(tracking?.open || 0).toLocaleString()}</b><small>Open forecasts</small></span><span><b className="mono">{Number(tracking?.settled || 0).toLocaleString()}</b><small>Settled forecasts</small></span><span><b className="mono">{Object.values(tracking?.markets || {}).reduce((sum, market) => sum + Number(market.roiSamples || 0), 0).toLocaleString()}</b><small>Priced ROI samples</small></span></div></section>
    {trackingMarkets.length > 0 && <div className="nfl-season-market-grid" aria-label="Season results by market">{trackingMarkets.map(([id, metric]) => <article key={id}><b>{NFL_PROP_MARKET_LIST.find((market) => market.id === id)?.shortLabel || id}</b><span><strong className="mono">{metric.brier != null ? metric.brier.toFixed(3) : metric.mae != null ? metric.mae.toFixed(1) : '—'}</strong><small>{metric.brier != null ? 'Brier' : 'MAE'}</small></span><span><strong className="mono">{pct(metric.roi)}</strong><small>ROI · {metric.roiSamples || 0}</small></span></article>)}</div>}
    {markets.length ? <div className="nfl-performance-grid">{markets.map(([id, metric]) => {
      const market = NFL_PROP_MARKET_LIST.find((item) => item.id === id)
      const primary = metric.type === 'probability' ? (metric.brier == null ? '—' : metric.brier.toFixed(3)) : (metric.mae == null ? '—' : metric.mae.toFixed(1))
      const secondary = metric.type === 'probability' ? 'Brier score' : 'Mean absolute error'
      return <article key={id}><header><Icon name={MARKET_ICONS[id] || 'Activity'} size={15} /><b>{market?.label || id.replaceAll('_', ' ')}</b></header><strong className="mono">{primary}</strong><span>{secondary}</span><footer><small>{Number(metric.samples || 0).toLocaleString()} forecasts</small>{metric.type === 'projection' && metric.correction != null && <em className="mono">Correction {metric.correction >= 0 ? '+' : ''}{metric.correction.toFixed(1)}</em>}</footer></article>
    })}</div> : <div className="nfl-performance-empty"><Icon name="Database" size={22} /><b>No NFL backtest loaded</b><span>The slate remains available, but performance grading will appear after the history evaluation runs.</span></div>}
  </section>
}

function PlayerCard({ player, marketId, watched, inSlip, onSelect, onToggleWatch, onToggleSlip }) {
  const eliLevel = useEliLevel()
  const { model } = player
  const color = GRADE_COLORS[model.grade]
  const weather = model.weather
  const isQB = player.position === 'QB'
  return (
    <article className="nfl-prop-card" style={{ '--nfl-grade': color }}>
      <button className="nfl-card-open" onClick={() => onSelect(player)} aria-label={`Open ${player.name} prop research`}>
        <div className="nfl-card-hero"><PlayerHeadshotSilo player={player} /><div className="nfl-card-hero-copy"><header><div><span className="nfl-card-name">{player.name}</span><span className="nfl-position">{player.position}</span><span className="nfl-grade" style={{ color }}>{model.grade}</span><AssessmentBadge signals={model.signals} compact /></div><small className={`nfl-live-state ${player.live?.isLive ? 'is-live' : ''}`}><Icon name={player.live?.isLive ? 'Activity' : 'Clock'} size={11} />{liveLabel(player)}</small></header><div className="nfl-card-matchup"><b>{player.team}</b><Icon name="ChevronRight" size={10} /><span>{player.opponent}</span><i>·</i><span>{player.kickoff}</span><i>·</i><span>{player.isHome ? 'Home' : 'Away'}</span></div></div></div>
        <div className="nfl-card-price">
          <div><small>Model probability</small><strong className="mono" style={{ color }}>{pct(model.probability)}</strong></div>
          <div><small>{['anytime_td', 'first_td', 'two_plus_td'].includes(marketId) ? 'Odds / edge' : 'Line / edge'}</small><span><b className="mono">{marketValue(player, model, marketId)}</b><em className={`mono ${model.edge == null ? '' : model.edge >= 0 ? 'positive' : 'negative'}`}>{model.edge == null ? 'No price' : `${model.edge >= 0 ? '+' : ''}${pct(model.edge)}`}</em></span></div>
        </div>
        <div className="nfl-card-context">
          {isQB && <div className="is-volume"><span><Icon name="Radio" size={12} />Comp / Att</span><b className="mono">{number(player.projections?.completions, 1)} / {number(player.projections?.attempts, 1)}</b></div>}
          <div className="is-red-zone"><span><Icon name="Target" size={12} />{eliLevel === 'eli5' ? 'Near end zone' : 'Red zone'}</span><b className="mono">{player.position === 'WR' || player.position === 'TE' ? `${number(player.usage?.redZoneTargetsL3)} targets` : `${number(player.usage?.redZoneTouchesL3)} touches`}</b></div>
          <div className="is-matchup"><span><Icon name="Shield" size={12} />{eliLevel === 'eli5' ? 'Matchup' : `Defense vs ${player.position}`}</span><b>{player.defenseVsPosition?.label || 'No split'}</b></div>
          <div className={`is-weather tone-${weather.tone}`}><span><Icon name="Wind" size={12} />Weather</span><b>{weather.label}</b></div>
        </div>
        <div className="nfl-card-signals">
          {model.signals.slice(0, 4).map((signal) => <span key={signal.key} className={`tone-${signal.tone}`}><Icon name={signalIcon(signal)} size={10} />{nflSignalText(signal, eliLevel)}</span>)}
          {!model.signals.length && <span><Icon name="Info" size={10} />{eliLevel === 'eli5' ? 'No strong recent trend yet' : 'No active streak signal'}</span>}
        </div>
      </button>
      <footer>
        <button className={watched ? 'active' : ''} onClick={() => onToggleWatch(player)} aria-label={`${watched ? 'Stop watching' : 'Watch'} ${player.name}`}><Icon name="Star" size={15} /></button>
        <button className={`nfl-card-slip ${inSlip ? 'active' : ''}`} onClick={() => onToggleSlip(player)}><Icon name={inSlip ? 'Check' : 'Plus'} size={14} />{inSlip ? 'Added' : 'Add to slip'}</button>
      </footer>
    </article>
  )
}

function BoardRow({ player, rank, marketId, watched, inSlip, onSelect, onToggleWatch, onToggleSlip }) {
  const eliLevel = useEliLevel()
  const { model } = player
  const color = GRADE_COLORS[model.grade]
  return (
    <article className="nfl-player-row nfl-prop-row" style={{ '--nfl-grade': color }} role="button" tabIndex={0} onClick={() => onSelect(player)} onKeyDown={(event) => { if (event.key === 'Enter') onSelect(player) }}>
      <div className="nfl-rank mono">{rank}</div>
      <div className="nfl-player-main"><div className="nfl-player-name-line"><b>{player.name}</b><span className="nfl-position">{player.position}</span><span className="nfl-grade" style={{ color }}>{model.grade}</span><AssessmentBadge signals={model.signals} compact /></div><div className="nfl-matchup"><b>{player.team}</b><Icon name="ChevronRight" size={10} /><span>{player.opponent}</span><i>·</i><span>{liveLabel(player)}</span></div><div className={`nfl-status nfl-status--${player.statusTone}`}><Icon name={player.statusTone === 'warn' ? 'TriangleAlert' : 'CircleCheck'} size={11} />{player.status}</div></div>
      <div className="nfl-number nfl-model-prob"><strong className="mono" style={{ color }}>{pct(model.probability)}</strong><small>Model</small></div>
      <div className="nfl-number"><strong className="mono">{marketValue(player, model, marketId)}</strong><small>Market</small></div>
      <div className="nfl-number"><strong className={`mono nfl-edge ${model.edge == null ? '' : model.edge >= 0 ? 'positive' : 'negative'}`}>{model.edge == null ? '—' : `${model.edge >= 0 ? '+' : ''}${pct(model.edge)}`}</strong><small>Edge</small></div>
      <div className="nfl-signals">{model.signals.slice(0, 2).map((signal) => <span key={signal.key} className={`tone-${signal.tone}`}><Icon name={signalIcon(signal)} size={10} />{nflSignalText(signal, eliLevel)}</span>)}</div>
      <div className="nfl-row-actions" onClick={(event) => event.stopPropagation()}><button className={watched ? 'active' : ''} onClick={() => onToggleWatch(player)} aria-label={`Watch ${player.name}`}><Icon name="Star" size={15} /></button><button className={inSlip ? 'active' : ''} onClick={() => onToggleSlip(player)} aria-label={`Add ${player.name} to slip`}><Icon name={inSlip ? 'Check' : 'Plus'} size={15} /></button></div>
    </article>
  )
}

function PlayerResearch({ player, marketId, onClose, inSlip, onToggleSlip }) {
  const eliLevel = useEliLevel()
  const [tab, setTab] = useState('overview')
  useEffect(() => { setTab('overview') }, [player?.id])
  if (!player) return null
  const scoredMarkets = eligiblePropMarkets(player).map((market) => ({ market, model: scoreNFLProp(player, market.id) }))
  const current = scoreNFLProp(player, marketId)
  const lineup = player.lineup || {}
  const marketLabel = NFL_PROP_MARKET_LIST.find((market) => market.id === marketId)?.label
  const researchTabs = [
    { id: 'overview', label: 'Overview', icon: 'Sparkles' },
    { id: 'role', label: 'Role', icon: 'Users' },
    { id: 'matchup', label: 'Matchup', icon: 'Shield' },
    { id: 'gamelog', label: 'Game log', icon: 'Activity' },
  ]
  return <>
    <button className="nfl-drawer-scrim" onClick={onClose} aria-label="Close player research" />
    <aside className="nfl-drawer nfl-prop-drawer" role="dialog" aria-modal="true" aria-labelledby="nfl-drawer-title">
      <header className="nfl-research-header">
        <button className="nfl-drawer-close" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        <span className="nfl-drawer-eyebrow">NFL player research · model confidence</span>
        <div className="nfl-research-identity"><PlayerHeadshotSilo player={player} variant="workspace" /><div className="nfl-research-identity-copy"><div><h2 id="nfl-drawer-title">{player.name}</h2><span className="nfl-position">{player.position}</span><span className={`nfl-live-state ${player.live?.isLive ? 'is-live' : ''}`}><Icon name={player.live?.isLive ? 'Activity' : 'Clock'} size={11} />{liveLabel(player)}</span></div><p><b>{player.team}</b> vs {player.opponent} · {player.kickoff} · {player.isHome ? 'Home' : 'Away'}</p><AssessmentBadge signals={current.signals} /></div></div>
        <div className="nfl-research-decision">
          <div className="nfl-research-market"><small>Selected market</small><b>{marketLabel}</b></div>
          <div className="nfl-research-score"><span><small>Model</small><strong className="mono">{pct(current.probability)}</strong></span><span><small>Line / odds</small><strong className="mono">{marketValue(player, current, marketId)}</strong></span><span><small>Edge</small><strong className={`mono ${current.edge == null ? '' : current.edge >= 0 ? 'positive' : 'negative'}`}>{current.edge == null ? 'No price' : `${current.edge >= 0 ? '+' : ''}${pct(current.edge)}`}</strong></span></div>
          <button className={`nfl-drawer-cta ${inSlip ? 'is-added' : ''}`} onClick={() => onToggleSlip(player)}><Icon name={inSlip ? 'Check' : 'Plus'} size={16} />{inSlip ? 'Added to slip' : 'Add to slip'}</button>
        </div>
      </header>
      <nav className="nfl-research-tabs" aria-label="Player research sections">{researchTabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><Icon name={item.icon} size={13} />{item.label}</button>)}</nav>
      <div className="nfl-research-body">
        {tab === 'overview' && <div className="nfl-research-view">
          <section className="nfl-research-panel"><header><span><Icon name="ShieldAlert" size={14} /> Betting signal assessment</span><small>Risk first</small></header><SignalAssessmentPanel signals={current.signals} eliLevel={eliLevel} /></section>
          <section className="nfl-research-panel"><header><span><Icon name="LayoutGrid" size={14} /> Eligible markets</span><small>{scoredMarkets.length} available</small></header><div className="nfl-eligible-grid">{scoredMarkets.map(({ market, model }) => <span key={market.id} className={market.id === marketId ? 'active' : ''} title={eligibilityReason(player, market.id)}><b>{market.shortLabel}</b><em className="mono">{pct(model.probability)}</em><small className="mono">{marketValue(player, model, market.id)}</small></span>)}</div></section>
          <section className="nfl-research-disclosure"><Icon name="Info" size={14} /><p>Model features reflect the history, role, injury, weather and live-game coverage available for this slate. Missing feeds are shown as limited rather than replaced with invented values.</p></section>
        </div>}
        {tab === 'role' && <div className="nfl-research-view">
          <section className="nfl-research-panel"><header><span><Icon name="Users" size={14} /> Role and availability</span></header><div className="nfl-research-grid"><span>Role <b>{player.usage?.roleLabel || 'Unconfirmed'}</b></span><span>Projected snaps <b>{pct(player.usage?.snapShare, 0)}</b></span><span>Availability <b>{player.availability?.label || player.status}</b></span><span>Opportunity multiplier <b>{pct(player.availability?.multiplier, 0)}</b></span></div></section>
          <section className="nfl-research-panel"><header><span><Icon name="Target" size={14} /> Red-zone profile · last 3</span></header><div className="nfl-research-grid"><span>RZ targets <b>{number(player.usage?.redZoneTargetsL3)}</b></span><span>End-zone targets <b>{number(player.usage?.endZoneTargetsL3)}</b></span><span>RZ touches <b>{number(player.usage?.redZoneTouchesL3)}</b></span><span>Goal-line touches <b>{number(player.usage?.goalLineTouchesL3)}</b></span></div></section>
          <section className="nfl-research-panel nfl-lineup-intelligence"><header><span><Icon name="GitBranch" size={14} /> Lineup intelligence</span><small className={lineup.confirmed ? 'tone-good' : ''}>{lineup.confirmed ? 'Confirmed' : 'Projected'} · {lineup.source || 'limited feed'}</small></header><div className="nfl-lineup-grid">
            <span>Depth order <b>{lineup.depthOrder ? `${player.position}${lineup.depthOrder}` : '—'}</b></span><span>Role confidence <b>{pct(lineup.roleConfidence, 0)}</b></span><span>Expected snaps <b>{pct(lineup.expectedSnapShare, 0)}</b></span><span>Routes / dropback <b>{pct(lineup.routesPerDropback, 0)}</b></span>
            <span>Target / route <b>{pct(lineup.targetPerRoute, 0)}</b></span><span>Carry share <b>{pct(lineup.carryShare, 0)}</b></span><span>Pass-block share <b>{pct(lineup.passBlockShare, 0)}</b></span><span>Snap restriction <b>{lineup.restrictions?.snapLimit == null ? 'None' : pct(lineup.restrictions.snapLimit, 0)}</b></span>
            <span>Alignment <b>{`Slot ${pct(lineup.alignments?.slot, 0)} · Wide ${pct(lineup.alignments?.wide, 0)}`}</b></span><span>Backfield / motion <b>{`${pct(lineup.alignments?.backfield, 0)} · ${pct(lineup.alignments?.motion, 0)}`}</b></span><span>Personnel exposure <b>{`11 ${pct(lineup.personnel?.eleven, 0)} · 12 ${pct(lineup.personnel?.twelve, 0)}`}</b></span><span>Heavy package <b>{pct(lineup.personnel?.heavy, 0)}</b></span>
            <span>RZ snap share <b>{pct(lineup.redZone?.snapShare, 0)}</b></span><span>Inside-10 share <b>{pct(lineup.redZone?.insideTenShare, 0)}</b></span><span>Inside-5 share <b>{pct(lineup.redZone?.insideFiveShare, 0)}</b></span><span>Goal-line package <b className={lineup.redZone?.goalLinePackage ? 'tone-good' : ''}>{lineup.redZone?.goalLinePackage ? 'Active' : 'No signal'}</b></span>
            <span>Inherited role <b className={lineup.replacement?.inherited ? 'tone-good' : ''}>{lineup.replacement?.inherited ? lineup.replacement.replaces?.join(', ') || 'Vacated work' : 'No'}</b></span><span>Vacated opportunity <b>{pct(lineup.replacement?.vacatedOpportunityShare, 0)}</b></span><span>O-line continuity <b>{lineup.offensiveLine?.available ? `${pct(lineup.offensiveLine.continuity, 0)} · ${number(lineup.offensiveLine.startersAvailable)}/5` : 'Neutral projection'}</b></span><span>Opponent personnel <b>{lineup.opponentDefense?.available ? `Nickel ${pct(lineup.opponentDefense.nickelRate, 0)} · Dime ${pct(lineup.opponentDefense.dimeRate, 0)}` : 'Neutral projection'}</b></span>
          </div></section>
        </div>}
        {tab === 'matchup' && <div className="nfl-research-view">
          <section className="nfl-research-panel"><header><span><Icon name="Shield" size={14} /> Defense analysis</span></header><div className="nfl-research-grid"><span>Defense vs {player.position} <b>{player.defenseVsPosition?.label || 'No split'}</b></span><span>TDs allowed / game <b>{number(player.defenseVsPosition?.touchdownsAllowedPerGame, 2)}</b></span><span>RZ chances allowed / game <b>{number(player.defenseVsPosition?.redZoneOpportunitiesAllowedPerGame, 1)}</b></span><span>Defense rank <b>{player.defenseVsPosition?.rank ? `#${player.defenseVsPosition.rank}` : '—'}</b></span></div></section>
          <section className="nfl-research-panel"><header><span><Icon name="Wind" size={14} /> Environment and split</span></header><div className="nfl-research-grid"><span>Weather <b className={`tone-${current.weather.tone}`}>{current.weather.label}</b></span><span>Temperature <b>{player.weather?.tempF == null ? '—' : `${number(player.weather.tempF)}°F`}</b></span><span>Wind <b>{player.weather?.windMph == null ? '—' : `${number(player.weather.windMph)} mph`}</b></span><span>{player.isHome ? 'Home' : 'Away'} split <b>{player.splits?.activeEdge == null ? 'Neutral' : `${player.splits.activeEdge >= 0 ? '+' : ''}${pct(player.splits.activeEdge)}`}</b></span></div></section>
        </div>}
        {tab === 'gamelog' && <div className="nfl-research-view">
          {player.live?.isLive && <section className="nfl-research-panel nfl-live-analysis"><header><span><Icon name="Activity" size={14} /> Live game analysis</span><small>{liveLabel(player)}</small></header><p>{player.live.teamScore}–{player.live.opponentScore} · {player.live.gameScript}. Approximately {player.live.estimatedPossessionsRemaining} possessions remain. Current production, clock, score, game script{Number(player.live.observedSnaps) >= 5 ? `, ${pct(player.live.observedSnapShare, 0)} observed snaps and ${pct(player.live.observedRoutesPerDropback, 0)} routes/dropback` : ''} are blended with the pregame expectation.</p>{player.live.downDistance && <small>{player.live.downDistance}{player.live.lastPlay ? ` · ${player.live.lastPlay}` : ''}</small>}</section>}
          <section className="nfl-research-panel"><header><span><Icon name="List" size={14} /> Recent performance</span><small>Last 5 games</small></header><div className="nfl-game-log"><header><span>Week</span><span>Pass</span><span>Rush</span><span>Rec</span><span>TD</span></header>{player.recentGames.slice(0, 5).map((game) => <div key={`${game.season}-${game.week}`}><span>W{game.week}</span><span>{number(game.passingYards)}</span><span>{number(game.rushingYards)}</span><span>{number(game.receivingYards)}</span><span>{number(game.totalTds)}</span></div>)}</div></section>
        </div>}
      </div>
    </aside>
  </>
}

export default function NFLBoard({ snapshot: suppliedSnapshot = null, view: controlledView = null, onViewChange = null }) {
  const [snapshot, setSnapshot] = useState(() => suppliedSnapshot || NFL_DEMO_SNAPSHOT)
  const [marketId, setMarketId] = useState('anytime_td')
  const [localView, setLocalView] = useState('signals')
  const view = controlledView ?? localView
  const setView = onViewChange || setLocalView
  const [query, setQuery] = useState('')
  const [positionFilters, setPositionFilters] = useState(() => new Set())
  const [teamFilters, setTeamFilters] = useState(() => new Set())
  const [gameFilters, setGameFilters] = useState(() => new Set())
  const [twoPlusOnly, setTwoPlusOnly] = useState(false)
  const [signalFilters, setSignalFilters] = useState(() => new Set())
  const [signalsOpen, setSignalsOpen] = useState(true)
  const [betLabView, setBetLabView] = useState('explore')
  const [selected, setSelected] = useState(null)
  const [watched, setWatched] = useState(() => new Set(readStorage('statfax:nfl:watchlist', [])))
  const [slip, setSlip] = useState(() => new Set(readStorage('statfax:nfl:slip', [])))
  const [tickets, setTickets] = useState(() => readStorage('statfax:nfl:tickets', []))
  const snapshotStale = snapshot.generatedAt && Date.now() - Date.parse(snapshot.generatedAt) > 45 * 60 * 1000

  useEffect(() => {
    if (suppliedSnapshot) { setSnapshot(suppliedSnapshot); return undefined }
    let active = true
    const refresh = () => loadNFLSnapshot({ demoFallback: true }).then((next) => { if (active) setSnapshot(next) }).catch(() => {})
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => { active = false; clearInterval(timer) }
  }, [suppliedSnapshot])

  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('statfax:nfl:watchlist', JSON.stringify([...watched])) }, [watched])
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('statfax:nfl:slip', JSON.stringify([...slip])) }, [slip])
  useEffect(() => { if (typeof window !== 'undefined') window.localStorage.setItem('statfax:nfl:tickets', JSON.stringify(tickets)) }, [tickets])
  useEffect(() => { setTickets((current) => current.map((ticket) => settleNFLTicket(ticket, snapshot))) }, [snapshot])

  const teams = useMemo(() => [...new Set(snapshot.players.map((player) => player.team))].sort(), [snapshot])
  const games = useMemo(() => {
    const matchups = new Map()
    for (const player of snapshot.players) {
      const key = gameKeyFor(player)
      if (!key || matchups.has(key)) continue
      const label = player.isHome ? `${player.opponent} @ ${player.team}` : `${player.team} @ ${player.opponent}`
      matchups.set(key, label)
    }
    return [...matchups].map(([id, label]) => ({ id, label }))
  }, [snapshot])
  useEffect(() => {
    const valid = new Set(games.map((item) => String(item.id)))
    setGameFilters((current) => {
      const next = new Set([...current].filter((id) => valid.has(id)))
      return next.size === current.size ? current : next
    })
  }, [games])
  const filteredPool = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return scoreNFLSnapshot(snapshot, marketId)
      .filter((player) => positionFilters.size === 0 || positionFilters.has(player.position))
      .filter((player) => teamFilters.size === 0 || teamFilters.has(player.team))
      .filter((player) => gameFilters.size === 0 || gameFilters.has(String(gameKeyFor(player))))
      .filter((player) => !normalized || `${player.name} ${player.team} ${player.opponent} ${player.position}`.toLowerCase().includes(normalized))
      .filter((player) => !twoPlusOnly || scoreNFLProp(player, 'two_plus_td').probability >= .08)
  }, [gameFilters, marketId, positionFilters, query, snapshot, teamFilters, twoPlusOnly])
  const signalCounts = useMemo(() => Object.fromEntries(NFL_SIGNAL_FILTERS.map((filter) => [filter.id, filteredPool.filter(filter.match).length])), [filteredPool])
  const players = useMemo(() => {
    if (signalFilters.size === 0) return filteredPool
    const activeFilters = NFL_SIGNAL_FILTERS.filter((filter) => signalFilters.has(filter.id))
    return filteredPool.filter((player) => activeFilters.every((filter) => filter.match(player)))
  }, [filteredPool, signalFilters])
  const toggleSignalFilter = (id) => setSignalFilters((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const featured = players[0] || null
  const liveCount = players.filter((player) => player.live?.isLive).length
  const toggleSet = (setter, id) => setter((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const slipLegs = useMemo(() => [...slip].map((key) => {
    const separator = key.lastIndexOf(':')
    const playerId = key.slice(0, separator)
    const legMarketId = key.slice(separator + 1)
    const player = snapshot.players.find((item) => item.id === playerId)
    if (!player) return null
    const model = scoreNFLProp(player, legMarketId)
    return { key, playerId, gameId: player.gameId, name: player.name, marketId: legMarketId, marketLabel: NFL_PROP_MARKET_LIST.find((item) => item.id === legMarketId)?.label || legMarketId, line: model.line, odds: model.odds, probability: model.probability, status: 'pending' }
  }).filter(Boolean), [slip, snapshot])
  const saveTicket = () => {
    if (!slipLegs.length) return
    const ticket = settleNFLTicket({ id: `nfl-${Date.now()}`, createdAt: new Date().toISOString(), status: 'pending', legs: slipLegs }, snapshot)
    setTickets((current) => [ticket, ...current].slice(0, 50))
    setSlip(new Set())
  }
  const addComboToSlip = (combo) => {
    setSlip((current) => {
      const next = new Set(current)
      for (const leg of combo.legs) next.add(leg.key)
      return next
    })
  }
  const openBetLabBuilder = () => {
    setBetLabView('builder')
    setView('bet-lab')
  }
  const propFilters = [
    { id: 'positions', label: 'Positions', value: positionFilters, onChange: setPositionFilters, options: [{ value: '', label: 'All positions' }, ...['QB', 'RB', 'WR', 'TE'].map((item) => ({ value: item, label: item }))] },
    { id: 'teams', label: 'Teams', value: teamFilters, onChange: setTeamFilters, options: [{ value: '', label: 'All teams' }, ...teams.map((item) => ({ value: item, label: item }))] },
    { id: 'games', label: 'Games', value: gameFilters, onChange: setGameFilters, options: [{ value: '', label: 'All games' }, ...games.map((item) => ({ value: String(item.id), label: item.label }))] },
  ]

  return <div className="nfl-workspace nfl-prop-workspace">
    <div className="nfl-workspace-head"><div><span className="nfl-eyebrow"><Icon name="Shield" size={13} /> NFL prop engine</span><h1>NFL Signals</h1><p>Slate-ranked QB, RB, WR and TE signals powered by role, matchup, form, lineup, weather, price and live pace.</p></div><CommandTabs tabs={SPORT_UI.nfl.primaryViews} value={view} onChange={setView} label="NFL view" className="nfl-view-tabs" variant="workspace" /></div>
    <div className={`nfl-demo-banner is-${snapshotStale ? 'critical' : snapshot.dataHealth?.status || 'ready'}`} role="status" aria-live="polite"><Icon name={snapshotStale || snapshot.dataHealth?.status === 'critical' || !snapshot.dataQuality?.playByPlay ? 'TriangleAlert' : 'CircleCheck'} size={15} /><span><b>{snapshotStale ? 'NFL pipeline update delayed' : snapshot.source?.mode === 'demo' ? 'Demo slate' : snapshot.dataHealth?.status === 'ready' ? 'All NFL feeds healthy' : snapshot.dataQuality?.playByPlay ? 'NFL core data connected' : 'NFL data connected · limited context'}</b> {snapshotStale ? 'The published slate is more than 45 minutes old. Open Performance for feed details.' : snapshot.dataHealth?.issues?.length ? `${snapshot.dataHealth.issues.length} supporting feed${snapshot.dataHealth.issues.length === 1 ? '' : 's'} limited. Open Performance for details.` : 'Red-zone, depth, availability, weather, defense and tracking coverage are active.'}</span></div>
    {view === 'performance' ? <NFLPerformance snapshot={snapshot} /> : view === 'bet-lab' ? <div className="nfl-bet-lab-workspace"><NFLBetLab snapshot={snapshot} slip={slip} slipLegs={slipLegs} tab={betLabView} onTabChange={setBetLabView} onAddCombo={addComboToSlip} onToggleLeg={(key) => toggleSet(setSlip, key)} onClearSlip={() => setSlip(new Set())} onSaveTicket={saveTicket} /></div> : <>
      <SportMarketRail sport="nfl" markets={NFL_PROP_MARKET_LIST} value={marketId} onChange={setMarketId} icons={MARKET_ICONS} ariaLabel="NFL prop market" />
      {marketId === 'first_td' && <div className="nfl-variance-note"><Icon name="TriangleAlert" size={14} /><span><b>First TD is high variance.</b> Listed offense receives {pct(snapshot.firstTdReserve?.listedOffense ?? .86, 0)}; other offense {pct(snapshot.firstTdReserve?.otherOffense ?? .06, 0)}, defense/special teams {pct(snapshot.firstTdReserve?.defenseSpecialTeams ?? .06, 0)}, and no touchdown {pct(snapshot.firstTdReserve?.noTouchdown ?? .02, 0)} are modeled separately.</span></div>}
      {marketId === 'two_plus_td' && <div className="nfl-variance-note"><Icon name="Flame" size={14} /><span><b>2+ TD is calibrated separately.</b> Multi-score probability is evaluated independently from Anytime TD.</span></div>}
      <SportSignalRail sport="nfl" filters={NFL_SIGNAL_FILTERS} values={signalFilters} counts={signalCounts} total={filteredPool.length} onToggleFilter={toggleSignalFilter} onClear={() => setSignalFilters(new Set())} open={signalsOpen} onToggleOpen={() => setSignalsOpen((open) => !open)} />
      <div className="nfl-layout"><section className="nfl-board-panel" aria-label="Ranked NFL props">
      <SportMultiFilterBar sport="nfl" className="nfl-prop-filters" searchValue={query} onSearch={setQuery} searchPlaceholder="Search players, teams, matchups" filters={propFilters}><button className={`nfl-two-filter ${twoPlusOnly ? 'active' : ''}`} aria-pressed={twoPlusOnly} onClick={() => setTwoPlusOnly((value) => !value)}><Icon name="Flame" size={13} />2+ TD filter</button></SportMultiFilterBar>
      <div className="nfl-card-grid">{players.map((player) => <PlayerCard key={player.id} player={player} marketId={marketId} watched={watched.has(player.id)} inSlip={slip.has(`${player.id}:${marketId}`)} onSelect={setSelected} onToggleWatch={(item) => toggleSet(setWatched, item.id)} onToggleSlip={(item) => toggleSet(setSlip, `${item.id}:${marketId}`)} />)}</div>
      {!players.length && <div className="nfl-empty"><Icon name="Search" size={22} /><b>No eligible players match</b><button onClick={() => { setQuery(''); setPositionFilters(new Set()); setTeamFilters(new Set()); setGameFilters(new Set()); setTwoPlusOnly(false); setSignalFilters(new Set()) }}>Clear filters</button></div>}
    </section><aside className="nfl-decision-rail" aria-label="NFL slate summary"><section className="nfl-slate-card"><div><span>Prop engine</span><strong>{snapshot.dataQuality?.playByPlay ? 'Full context ready' : 'Core model ready'}</strong></div><b className="nfl-rating mono">{players.length}</b><ul><li><Icon name="Check" size={12} /> {NFL_PROP_MARKET_LIST.length} position-aware markets</li><li><Icon name="Activity" size={12} /> {liveCount} live player{liveCount === 1 ? '' : 's'} in this view</li><li><Icon name="Shield" size={12} /> {snapshot.dataQuality?.defenseByPosition ? 'Defense splits connected' : 'Defense splits limited'}</li></ul></section>{featured && <section className="nfl-featured-card"><span>Top {NFL_PROP_MARKET_LIST.find((market) => market.id === marketId)?.shortLabel}</span><h2>{featured.name}</h2><p>{featured.team} vs {featured.opponent} · {liveLabel(featured)}</p><div><b className="mono">{pct(featured.model.probability)}</b><em>at</em><b className="mono">{marketValue(featured, featured.model, marketId)}</b></div><button onClick={() => toggleSet(setSlip, nflLegKey(featured.id, marketId))}><Icon name={slip.has(nflLegKey(featured.id, marketId)) ? 'Check' : 'Plus'} size={15} />{slip.has(nflLegKey(featured.id, marketId)) ? 'Added to slip' : 'Add selected prop'}</button></section>}<section className="nfl-builder-card"><header>Active workspace</header><div><span><small>Watchlist</small><b>{watched.size} players</b></span><button type="button" onClick={openBetLabBuilder}><small>Prop slip</small><b>{slip.size} legs · {tickets.length} tracked</b></button></div></section></aside></div>
    </>}
    <PlayerResearch player={selected} marketId={marketId} onClose={() => setSelected(null)} inSlip={selected ? slip.has(`${selected.id}:${marketId}`) : false} onToggleSlip={(item) => toggleSet(setSlip, `${item.id}:${marketId}`)} />
  </div>
}
