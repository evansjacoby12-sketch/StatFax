import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'
import NFL_DEMO_SNAPSHOT from '../../../src/sports/nfl/data/demoSlate.js'
import { NFL_PROP_MARKET_LIST, eligiblePropMarkets, eligibilityReason } from '../../../src/sports/nfl/logic/propEligibility.js'
import { scoreNFLSnapshot, scoreNFLProp } from '../../../src/sports/nfl/logic/ScoringEngine.js'
import { loadNFLSnapshot } from '../../../src/sports/nfl/api/NFLService.js'
import { nflLegKey, settleNFLTicket, ticketExportText } from '../lib/nflTickets.js'

const VIEW_TABS = [
  { id: 'cards', label: 'Cards', icon: 'LayoutGrid' },
  { id: 'board', label: 'Board', icon: 'List' },
  { id: 'performance', label: 'Performance', icon: 'Gauge' },
  { id: 'tickets', label: 'Tickets', icon: 'ClipboardList' },
]
const MARKET_ICONS = {
  anytime_td: 'Target', first_td: 'Trophy', two_plus_td: 'Flame', passing_yards: 'BarChart3', receptions: 'Radio',
  receiving_yards: 'TrendingUp', rushing_yards: 'Zap', rushing_receiving_yards: 'GitMerge', passing_rushing_yards: 'GitBranch',
}
const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)', SKIP: 'var(--skip)' }

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
  if (signal.key === 'touchdown') return 'Flame'
  if (signal.key === 'split') return 'Home'
  if (signal.key.includes('rz') || signal.key === 'goal-line') return 'Target'
  return 'TrendingUp'
}

function NFLPerformance({ snapshot }) {
  const performance = snapshot.modelPerformance
  const markets = Object.entries(performance?.markets || {})
  const quality = snapshot.dataQuality || {}
  const coverage = [
    ['Play-by-play', quality.playByPlay], ['Red zone', quality.redZone], ['Defense splits', quality.defenseByPosition],
    ['First TD labels', quality.firstTouchdown], ['Depth chart', quality.depthChart], ['Official availability', quality.officialAvailability], ['Weather', quality.weatherFresh && Number(quality.weatherCoverage) >= .8],
  ]
  return <section className="nfl-performance" aria-labelledby="nfl-performance-title">
    <header><div><span className="nfl-eyebrow"><Icon name="Gauge" size={13} /> Model validation</span><h2 id="nfl-performance-title">NFL Model Performance</h2><p>Walk-forward results use only information available before each game.</p></div><span className="nfl-performance-updated">{performance?.generatedAt ? `Updated ${new Date(performance.generatedAt).toLocaleDateString()}` : 'Awaiting backtest'}</span></header>
    <div className="nfl-coverage-grid" aria-label="NFL data coverage">{coverage.map(([label, ready]) => <div key={label} className={ready ? 'is-ready' : 'is-limited'}><Icon name={ready ? 'CircleCheck' : 'TriangleAlert'} size={15} /><span><b>{label}</b><small>{ready ? 'Connected' : 'Limited'}</small></span></div>)}</div>
    {markets.length ? <div className="nfl-performance-grid">{markets.map(([id, metric]) => {
      const market = NFL_PROP_MARKET_LIST.find((item) => item.id === id)
      const primary = metric.type === 'probability' ? (metric.brier == null ? '—' : metric.brier.toFixed(3)) : (metric.mae == null ? '—' : metric.mae.toFixed(1))
      const secondary = metric.type === 'probability' ? 'Brier score' : 'Mean absolute error'
      return <article key={id}><header><Icon name={MARKET_ICONS[id] || 'Activity'} size={15} /><b>{market?.label || id.replaceAll('_', ' ')}</b></header><strong className="mono">{primary}</strong><span>{secondary}</span><footer><small>{Number(metric.samples || 0).toLocaleString()} forecasts</small>{metric.type === 'projection' && metric.correction != null && <em className="mono">Correction {metric.correction >= 0 ? '+' : ''}{metric.correction.toFixed(1)}</em>}</footer></article>
    })}</div> : <div className="nfl-performance-empty"><Icon name="Database" size={22} /><b>No NFL backtest loaded</b><span>The slate remains available, but performance grading will appear after the history evaluation runs.</span></div>}
  </section>
}

function NFLTicketCenter({ slipLegs, tickets, onSave, onClear, onExport }) {
  return <section className="nfl-ticket-center" aria-labelledby="nfl-tickets-title">
    <header><div><span className="nfl-eyebrow"><Icon name="ClipboardList" size={13} /> Saved analysis</span><h2 id="nfl-tickets-title">NFL Prop Tickets</h2><p>Watchlists, open slips and settled results are saved on this device.</p></div><span className="nfl-ticket-count mono">{tickets.length} saved</span></header>
    <div className="nfl-ticket-layout">
      <section className="nfl-current-slip"><header><b>Current slip</b><span>{slipLegs.length} leg{slipLegs.length === 1 ? '' : 's'}</span></header>{slipLegs.length ? <div className="nfl-ticket-legs">{slipLegs.map((leg) => <div key={leg.key}><Icon name="CircleDot" size={12} /><span><b>{leg.name}</b><small>{leg.marketLabel}{leg.line != null && !leg.marketId.includes('td') ? ` · over ${leg.line}` : ''}</small></span><em className="mono">{pct(leg.probability)}</em></div>)}</div> : <div className="nfl-ticket-empty"><Icon name="Plus" size={18} /><span>Add player props from Cards or Board.</span></div>}<footer><button type="button" onClick={onClear} disabled={!slipLegs.length}>Clear</button><button type="button" className="primary" onClick={onSave} disabled={!slipLegs.length}><Icon name="Save" size={14} />Save ticket</button></footer></section>
      <section className="nfl-ticket-history"><header><b>Ticket history</b><span>Automatic settlement</span></header>{tickets.length ? <div>{tickets.map((ticket) => <article key={ticket.id} className={`is-${ticket.status}`}><header><span><b>{ticket.legs.length}-leg ticket</b><small>{new Date(ticket.createdAt).toLocaleString()}</small></span><em>{ticket.status}</em></header><ul>{ticket.legs.map((leg) => <li key={leg.key}><span>{leg.name} · {leg.marketLabel}</span><b>{leg.status}</b></li>)}</ul><button type="button" onClick={() => onExport(ticket)}><Icon name="Share2" size={13} />Copy ticket</button></article>)}</div> : <div className="nfl-ticket-empty"><Icon name="Clock" size={18} /><span>Saved tickets and results will appear here.</span></div>}</section>
    </div>
  </section>
}

function PlayerCard({ player, marketId, watched, inSlip, onSelect, onToggleWatch, onToggleSlip }) {
  const { model } = player
  const color = GRADE_COLORS[model.grade]
  const weather = model.weather
  const isQB = player.position === 'QB'
  return (
    <article className="nfl-prop-card" style={{ '--nfl-grade': color }}>
      <button className="nfl-card-open" onClick={() => onSelect(player)} aria-label={`Open ${player.name} prop research`}>
        <header>
          <div>
            <span className="nfl-card-name">{player.name}</span>
            <span className="nfl-position">{player.position}</span>
            <span className="nfl-grade" style={{ color }}>{model.grade}</span>
          </div>
          <small className={`nfl-live-state ${player.live?.isLive ? 'is-live' : ''}`}><Icon name={player.live?.isLive ? 'Activity' : 'Clock'} size={11} />{liveLabel(player)}</small>
        </header>
        <div className="nfl-card-matchup"><b>{player.team}</b><Icon name="ChevronRight" size={10} /><span>{player.opponent}</span><i>·</i><span>{player.kickoff}</span><i>·</i><span>{player.isHome ? 'Home' : 'Away'}</span></div>
        <div className="nfl-card-price">
          <div><small>Model probability</small><strong className="mono" style={{ color }}>{pct(model.probability)}</strong></div>
          <div><small>{['anytime_td', 'first_td', 'two_plus_td'].includes(marketId) ? 'Odds / edge' : 'Line / edge'}</small><span><b className="mono">{marketValue(player, model, marketId)}</b><em className={`mono ${model.edge == null ? '' : model.edge >= 0 ? 'positive' : 'negative'}`}>{model.edge == null ? 'No price' : `${model.edge >= 0 ? '+' : ''}${pct(model.edge)}`}</em></span></div>
        </div>
        <div className="nfl-card-context">
          {isQB && <div><span><Icon name="Radio" size={12} />Comp / Att</span><b className="mono">{number(player.projections?.completions, 1)} / {number(player.projections?.attempts, 1)}</b></div>}
          <div><span><Icon name="Target" size={12} />Red zone</span><b className="mono">{player.position === 'WR' || player.position === 'TE' ? `${number(player.usage?.redZoneTargetsL3)} targets` : `${number(player.usage?.redZoneTouchesL3)} touches`}</b></div>
          <div><span><Icon name="Shield" size={12} />Defense vs {player.position}</span><b>{player.defenseVsPosition?.label || 'No split'}</b></div>
          <div><span><Icon name="Wind" size={12} />Weather</span><b className={`tone-${weather.tone}`}>{weather.label}</b></div>
        </div>
        <div className="nfl-card-signals">
          {model.signals.slice(0, 4).map((signal) => <span key={signal.key} className={`tone-${signal.tone}`}><Icon name={signalIcon(signal)} size={10} />{signal.text}</span>)}
          {!model.signals.length && <span><Icon name="Info" size={10} />No active streak signal</span>}
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
  const { model } = player
  const color = GRADE_COLORS[model.grade]
  return (
    <article className="nfl-player-row nfl-prop-row" style={{ '--nfl-grade': color }} role="button" tabIndex={0} onClick={() => onSelect(player)} onKeyDown={(event) => { if (event.key === 'Enter') onSelect(player) }}>
      <div className="nfl-rank mono">{rank}</div>
      <div className="nfl-player-main"><div className="nfl-player-name-line"><b>{player.name}</b><span className="nfl-position">{player.position}</span><span className="nfl-grade" style={{ color }}>{model.grade}</span></div><div className="nfl-matchup"><b>{player.team}</b><Icon name="ChevronRight" size={10} /><span>{player.opponent}</span><i>·</i><span>{liveLabel(player)}</span></div><div className={`nfl-status nfl-status--${player.statusTone}`}><Icon name={player.statusTone === 'warn' ? 'TriangleAlert' : 'CircleCheck'} size={11} />{player.status}</div></div>
      <div className="nfl-number nfl-model-prob"><strong className="mono" style={{ color }}>{pct(model.probability)}</strong><small>Model</small></div>
      <div className="nfl-number"><strong className="mono">{marketValue(player, model, marketId)}</strong><small>Market</small></div>
      <div className="nfl-number"><strong className={`mono nfl-edge ${model.edge == null ? '' : model.edge >= 0 ? 'positive' : 'negative'}`}>{model.edge == null ? '—' : `${model.edge >= 0 ? '+' : ''}${pct(model.edge)}`}</strong><small>Edge</small></div>
      <div className="nfl-signals">{model.signals.slice(0, 2).map((signal) => <span key={signal.key}><Icon name={signalIcon(signal)} size={10} />{signal.text}</span>)}</div>
      <div className="nfl-row-actions" onClick={(event) => event.stopPropagation()}><button className={watched ? 'active' : ''} onClick={() => onToggleWatch(player)} aria-label={`Watch ${player.name}`}><Icon name="Star" size={15} /></button><button className={inSlip ? 'active' : ''} onClick={() => onToggleSlip(player)} aria-label={`Add ${player.name} to slip`}><Icon name={inSlip ? 'Check' : 'Plus'} size={15} /></button></div>
    </article>
  )
}

function PlayerResearch({ player, marketId, onClose, inSlip, onToggleSlip }) {
  if (!player) return null
  const scoredMarkets = eligiblePropMarkets(player).map((market) => ({ market, model: scoreNFLProp(player, market.id) }))
  const current = scoreNFLProp(player, marketId)
  return <>
    <button className="nfl-drawer-scrim" onClick={onClose} aria-label="Close player research" />
    <aside className="nfl-drawer nfl-prop-drawer" role="dialog" aria-modal="true" aria-labelledby="nfl-drawer-title">
      <button className="nfl-drawer-close" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
      <span className="nfl-drawer-eyebrow">NFL prop research · current model context</span>
      <h2 id="nfl-drawer-title">{player.name}</h2><p>{player.position} · {player.team} vs {player.opponent} · {liveLabel(player)}</p>
      <div className="nfl-drawer-market">{NFL_PROP_MARKET_LIST.find((market) => market.id === marketId)?.label}</div>
      <div className="nfl-drawer-scorecard"><div><small>Model</small><strong className="mono">{pct(current.probability)}</strong></div><div><small>Line / odds</small><strong className="mono">{marketValue(player, current, marketId)}</strong></div><div><small>Edge</small><strong className={`mono ${current.edge == null ? '' : current.edge >= 0 ? 'positive' : 'negative'}`}>{current.edge == null ? '—' : `${current.edge >= 0 ? '+' : ''}${pct(current.edge)}`}</strong></div></div>
      <section className="nfl-drawer-section"><h3><Icon name="ListFilter" size={14} /> Eligible props</h3><div className="nfl-eligible-grid">{scoredMarkets.map(({ market, model }) => <span key={market.id} title={eligibilityReason(player, market.id)}><b>{market.shortLabel}</b><em className="mono">{pct(model.probability)}</em></span>)}</div></section>
      <section className="nfl-drawer-section"><h3><Icon name="Target" size={14} /> Red-zone role</h3><div className="nfl-research-grid"><span>RZ targets L3 <b>{number(player.usage?.redZoneTargetsL3)}</b></span><span>End-zone targets L3 <b>{number(player.usage?.endZoneTargetsL3)}</b></span><span>RZ touches L3 <b>{number(player.usage?.redZoneTouchesL3)}</b></span><span>Goal-line touches L3 <b>{number(player.usage?.goalLineTouchesL3)}</b></span></div></section>
      <section className="nfl-drawer-section"><h3><Icon name="Shield" size={14} /> Defense and environment</h3><div className="nfl-research-grid"><span>Defense vs {player.position} <b>{player.defenseVsPosition?.label}</b></span><span>TDs allowed / game <b>{number(player.defenseVsPosition?.touchdownsAllowedPerGame, 2)}</b></span><span>RZ chances allowed / game <b>{number(player.defenseVsPosition?.redZoneOpportunitiesAllowedPerGame, 1)}</b></span><span>Weather <b>{current.weather.label}</b></span></div></section>
      <section className="nfl-drawer-section"><h3><Icon name="Users" size={14} /> Role and availability</h3><div className="nfl-research-grid"><span>Role <b>{player.usage?.roleLabel || 'Unconfirmed'}</b></span><span>Projected snaps <b>{pct(player.usage?.snapShare, 0)}</b></span><span>Availability <b>{player.availability?.label || player.status}</b></span><span>Opportunity multiplier <b>{pct(player.availability?.multiplier, 0)}</b></span></div></section>
      <section className="nfl-drawer-section"><h3><Icon name="Activity" size={14} /> Recent games</h3><div className="nfl-game-log"><header><span>Week</span><span>Pass</span><span>Rush</span><span>Rec</span><span>TD</span></header>{player.recentGames.slice(0, 5).map((game) => <div key={`${game.season}-${game.week}`}><span>W{game.week}</span><span>{number(game.passingYards)}</span><span>{number(game.rushingYards)}</span><span>{number(game.receivingYards)}</span><span>{number(game.totalTds)}</span></div>)}</div></section>
      {player.live?.isLive && <section className="nfl-drawer-section nfl-live-analysis"><h3><Icon name="Activity" size={14} /> Live analysis</h3><p>{liveLabel(player)} · {player.live.teamScore}–{player.live.opponentScore} · {player.live.gameScript}. Approximately {player.live.estimatedPossessionsRemaining} possessions remain. Current production, clock, score and game script are blended with the pregame expectation.</p>{player.live.downDistance && <small>{player.live.downDistance}{player.live.lastPlay ? ` · ${player.live.lastPlay}` : ''}</small>}</section>}
      <section className="nfl-drawer-section nfl-truth-note"><h3><Icon name="Info" size={14} /> Data disclosure</h3><p>Model features reflect the history, role, injury, weather and live-game coverage available for this slate. Missing feeds are shown as limited rather than replaced with invented values.</p></section>
      <button className={`nfl-drawer-cta ${inSlip ? 'is-added' : ''}`} onClick={() => onToggleSlip(player)}><Icon name={inSlip ? 'Check' : 'Plus'} size={16} />{inSlip ? 'Added to prop slip' : 'Add selected prop to slip'}</button>
    </aside>
  </>
}

export default function NFLBoard({ snapshot: suppliedSnapshot = null }) {
  const [snapshot, setSnapshot] = useState(() => suppliedSnapshot || NFL_DEMO_SNAPSHOT)
  const [marketId, setMarketId] = useState('anytime_td')
  const [view, setView] = useState('cards')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState('all')
  const [team, setTeam] = useState('all')
  const [twoPlusOnly, setTwoPlusOnly] = useState(false)
  const [selected, setSelected] = useState(null)
  const [watched, setWatched] = useState(() => new Set(readStorage('statfax:nfl:watchlist', [])))
  const [slip, setSlip] = useState(() => new Set(readStorage('statfax:nfl:slip', [])))
  const [tickets, setTickets] = useState(() => readStorage('statfax:nfl:tickets', []))

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
  const players = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return scoreNFLSnapshot(snapshot, marketId)
      .filter((player) => position === 'all' || player.position === position)
      .filter((player) => team === 'all' || player.team === team)
      .filter((player) => !normalized || `${player.name} ${player.team} ${player.opponent} ${player.position}`.toLowerCase().includes(normalized))
      .filter((player) => !twoPlusOnly || scoreNFLProp(player, 'two_plus_td').probability >= .08)
  }, [marketId, position, query, snapshot, team, twoPlusOnly])
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
  const exportTicket = async (ticket) => {
    const text = ticketExportText(ticket)
    if (navigator.share) { try { await navigator.share({ title: 'StatFax NFL ticket', text }); return } catch {} }
    await navigator.clipboard?.writeText(text)
  }

  return <div className="nfl-workspace nfl-prop-workspace">
    <div className="nfl-workspace-head"><div><span className="nfl-eyebrow"><Icon name="Shield" size={13} /> NFL prop engine</span><h1>NFL Prop Board</h1><p>QB, RB, WR and TE markets powered by role, opponent, form, splits, weather and live pace.</p></div><CommandTabs tabs={VIEW_TABS} value={view} onChange={setView} label="NFL view" className="nfl-view-tabs" variant="workspace" /></div>
    <div className="nfl-demo-banner" role="status" aria-live="polite"><Icon name={snapshot.dataQuality?.playByPlay ? 'CircleCheck' : 'TriangleAlert'} size={15} /><span><b>{snapshot.source?.mode === 'demo' ? 'Demo slate' : snapshot.dataQuality?.playByPlay ? 'Full NFL data connected' : 'NFL data connected · limited context'}</b> {snapshot.dataQuality?.playByPlay ? 'Red-zone, defense and model calibration coverage are active. Open Performance for live-feed coverage.' : 'Open Performance to see which supporting feeds are limited.'}</span></div>
    {view === 'performance' ? <NFLPerformance snapshot={snapshot} /> : view === 'tickets' ? <NFLTicketCenter slipLegs={slipLegs} tickets={tickets} onSave={saveTicket} onClear={() => setSlip(new Set())} onExport={exportTicket} /> : <>
      <div className="nfl-market-rail" role="tablist" aria-label="NFL prop market">{NFL_PROP_MARKET_LIST.map((market) => <button key={market.id} role="tab" aria-selected={marketId === market.id} className={marketId === market.id ? 'active' : ''} onClick={() => setMarketId(market.id)}><Icon name={MARKET_ICONS[market.id]} size={13} />{market.shortLabel}</button>)}</div>
      {marketId === 'first_td' && <div className="nfl-variance-note"><Icon name="TriangleAlert" size={14} /><span><b>First TD is high variance.</b> Listed offense receives {pct(snapshot.firstTdReserve?.listedOffense ?? .86, 0)}; other offense {pct(snapshot.firstTdReserve?.otherOffense ?? .06, 0)}, defense/special teams {pct(snapshot.firstTdReserve?.defenseSpecialTeams ?? .06, 0)}, and no touchdown {pct(snapshot.firstTdReserve?.noTouchdown ?? .02, 0)} are modeled separately.</span></div>}
      {marketId === 'two_plus_td' && <div className="nfl-variance-note"><Icon name="Flame" size={14} /><span><b>2+ TD is calibrated separately.</b> Multi-score probability is evaluated independently from Anytime TD.</span></div>}
      <div className="nfl-layout"><section className="nfl-board-panel" aria-label="Ranked NFL props">
      <div className="nfl-filters nfl-prop-filters"><label className="nfl-search"><Icon name="Search" size={15} /><span className="sr-only">Search players</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players, teams, matchups" /></label><select value={position} onChange={(event) => setPosition(event.target.value)} aria-label="Position"><option value="all">All positions</option>{['QB', 'RB', 'WR', 'TE'].map((item) => <option key={item}>{item}</option>)}</select><select value={team} onChange={(event) => setTeam(event.target.value)} aria-label="Team"><option value="all">All teams</option>{teams.map((item) => <option key={item}>{item}</option>)}</select><button className={`nfl-two-filter ${twoPlusOnly ? 'active' : ''}`} aria-pressed={twoPlusOnly} onClick={() => setTwoPlusOnly((value) => !value)}><Icon name="Flame" size={13} />2+ TD filter</button></div>
      {view === 'cards' ? <div className="nfl-card-grid">{players.map((player) => <PlayerCard key={player.id} player={player} marketId={marketId} watched={watched.has(player.id)} inSlip={slip.has(`${player.id}:${marketId}`)} onSelect={setSelected} onToggleWatch={(item) => toggleSet(setWatched, item.id)} onToggleSlip={(item) => toggleSet(setSlip, `${item.id}:${marketId}`)} />)}</div> : <><div className="nfl-board-head nfl-prop-board-head" aria-hidden="true"><span>#</span><span>Player</span><span>Model %</span><span>Market</span><span>Edge</span><span>Signals</span><span /></div><div className="nfl-player-list">{players.map((player, index) => <BoardRow key={player.id} player={player} rank={index + 1} marketId={marketId} watched={watched.has(player.id)} inSlip={slip.has(`${player.id}:${marketId}`)} onSelect={setSelected} onToggleWatch={(item) => toggleSet(setWatched, item.id)} onToggleSlip={(item) => toggleSet(setSlip, `${item.id}:${marketId}`)} />)}</div></>}
      {!players.length && <div className="nfl-empty"><Icon name="Search" size={22} /><b>No eligible players match</b><button onClick={() => { setQuery(''); setPosition('all'); setTeam('all'); setTwoPlusOnly(false) }}>Clear filters</button></div>}
    </section><aside className="nfl-decision-rail" aria-label="NFL slate summary"><section className="nfl-slate-card"><div><span>Prop engine</span><strong>{snapshot.dataQuality?.playByPlay ? 'Full context ready' : 'Core model ready'}</strong></div><b className="nfl-rating mono">{players.length}</b><ul><li><Icon name="Check" size={12} /> {NFL_PROP_MARKET_LIST.length} position-aware markets</li><li><Icon name="Activity" size={12} /> {liveCount} live player{liveCount === 1 ? '' : 's'} in this view</li><li><Icon name="Shield" size={12} /> {snapshot.dataQuality?.defenseByPosition ? 'Defense splits connected' : 'Defense splits limited'}</li></ul></section>{featured && <section className="nfl-featured-card"><span>Top {NFL_PROP_MARKET_LIST.find((market) => market.id === marketId)?.shortLabel}</span><h2>{featured.name}</h2><p>{featured.team} vs {featured.opponent} · {liveLabel(featured)}</p><div><b className="mono">{pct(featured.model.probability)}</b><em>at</em><b className="mono">{marketValue(featured, featured.model, marketId)}</b></div><button onClick={() => toggleSet(setSlip, nflLegKey(featured.id, marketId))}><Icon name={slip.has(nflLegKey(featured.id, marketId)) ? 'Check' : 'Plus'} size={15} />{slip.has(nflLegKey(featured.id, marketId)) ? 'Added to slip' : 'Add selected prop'}</button></section>}<section className="nfl-builder-card"><header>Active workspace</header><div><span><small>Watchlist</small><b>{watched.size} players</b></span><button type="button" onClick={() => setView('tickets')}><small>Prop slip</small><b>{slip.size} legs · {tickets.length} saved</b></button></div></section></aside></div>
    </>}
    <PlayerResearch player={selected} marketId={marketId} onClose={() => setSelected(null)} inSlip={selected ? slip.has(`${selected.id}:${marketId}`) : false} onToggleSlip={(item) => toggleSet(setSlip, `${item.id}:${marketId}`)} />
  </div>
}
