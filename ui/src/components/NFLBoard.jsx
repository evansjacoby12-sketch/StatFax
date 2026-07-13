import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'
import NFL_DEMO_SNAPSHOT from '../../../src/sports/nfl/data/demoSlate.js'
import { NFL_PROP_MARKET_LIST, eligiblePropMarkets, eligibilityReason } from '../../../src/sports/nfl/logic/propEligibility.js'
import { scoreNFLSnapshot, scoreNFLProp } from '../../../src/sports/nfl/logic/ScoringEngine.js'
import { loadNFLSnapshot } from '../../../src/sports/nfl/api/NFLService.js'

const VIEW_TABS = [
  { id: 'cards', label: 'Cards', icon: 'LayoutGrid' },
  { id: 'board', label: 'Board', icon: 'List' },
]
const MARKET_ICONS = {
  anytime_td: 'Target', first_td: 'Trophy', two_plus_td: 'Flame', passing_yards: 'BarChart3', receptions: 'Radio',
  receiving_yards: 'TrendingUp', rushing_yards: 'Zap', rushing_receiving_yards: 'GitMerge', passing_rushing_yards: 'GitBranch',
}
const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)', SKIP: 'var(--skip)' }

const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`
const odds = (value) => value == null ? '—' : value > 0 ? `+${value}` : String(value)
const number = (value, digits = 0) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits)

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
      <span className="nfl-drawer-eyebrow">NFL prop research · 2020+ context</span>
      <h2 id="nfl-drawer-title">{player.name}</h2><p>{player.position} · {player.team} vs {player.opponent} · {liveLabel(player)}</p>
      <div className="nfl-drawer-market">{NFL_PROP_MARKET_LIST.find((market) => market.id === marketId)?.label}</div>
      <div className="nfl-drawer-scorecard"><div><small>Model</small><strong className="mono">{pct(current.probability)}</strong></div><div><small>Line / odds</small><strong className="mono">{marketValue(player, current, marketId)}</strong></div><div><small>Edge</small><strong className={`mono ${current.edge == null ? '' : current.edge >= 0 ? 'positive' : 'negative'}`}>{current.edge == null ? '—' : `${current.edge >= 0 ? '+' : ''}${pct(current.edge)}`}</strong></div></div>
      <section className="nfl-drawer-section"><h3><Icon name="ListFilter" size={14} /> Eligible props</h3><div className="nfl-eligible-grid">{scoredMarkets.map(({ market, model }) => <span key={market.id} title={eligibilityReason(player, market.id)}><b>{market.shortLabel}</b><em className="mono">{pct(model.probability)}</em></span>)}</div></section>
      <section className="nfl-drawer-section"><h3><Icon name="Target" size={14} /> Red-zone role</h3><div className="nfl-research-grid"><span>RZ targets L3 <b>{number(player.usage?.redZoneTargetsL3)}</b></span><span>RZ touches L3 <b>{number(player.usage?.redZoneTouchesL3)}</b></span><span>Goal-line touches <b>{number(player.usage?.goalLineTouchesL3)}</b></span><span>Opportunity share <b>{pct(player.usage?.redZoneOpportunityShare, 0)}</b></span></div></section>
      <section className="nfl-drawer-section"><h3><Icon name="Shield" size={14} /> Defense and environment</h3><div className="nfl-research-grid"><span>Defense vs {player.position} <b>{player.defenseVsPosition?.label}</b></span><span>Position rank <b>#{player.defenseVsPosition?.rank || '—'}</b></span><span>{player.isHome ? 'Home' : 'Away'} edge <b>{`${player.splits?.activeEdge >= 0 ? '+' : ''}${pct(player.splits?.activeEdge, 0)}`}</b></span><span>Weather <b>{current.weather.label}</b></span></div></section>
      <section className="nfl-drawer-section"><h3><Icon name="Activity" size={14} /> Recent games</h3><div className="nfl-game-log"><header><span>Week</span><span>Pass</span><span>Rush</span><span>Rec</span><span>TD</span></header>{player.recentGames.slice(0, 5).map((game) => <div key={`${game.season}-${game.week}`}><span>W{game.week}</span><span>{number(game.passingYards)}</span><span>{number(game.rushingYards)}</span><span>{number(game.receivingYards)}</span><span>{number(game.totalTds)}</span></div>)}</div></section>
      {player.live?.isLive && <section className="nfl-drawer-section nfl-live-analysis"><h3><Icon name="Activity" size={14} /> Live analysis</h3><p>{liveLabel(player)} · {Math.round((player.live.gameProgress || 0) * 100)}% game progress. Current stats are blended with remaining pregame expectation before re-scoring the selected prop.</p></section>}
      <section className="nfl-drawer-section nfl-truth-note"><h3><Icon name="Info" size={14} /> Data disclosure</h3><p>Historical features are designed for nflverse data from 2020 onward. Demo odds and player inputs remain placeholders until a live stats, injuries, and sportsbook provider is configured.</p></section>
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
  const [watched, setWatched] = useState(() => new Set())
  const [slip, setSlip] = useState(() => new Set())

  useEffect(() => {
    if (suppliedSnapshot) { setSnapshot(suppliedSnapshot); return undefined }
    let active = true
    const refresh = () => loadNFLSnapshot({ demoFallback: true }).then((next) => { if (active) setSnapshot(next) }).catch(() => {})
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => { active = false; clearInterval(timer) }
  }, [suppliedSnapshot])

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

  return <div className="nfl-workspace nfl-prop-workspace">
    <div className="nfl-workspace-head"><div><span className="nfl-eyebrow"><Icon name="Shield" size={13} /> NFL prop engine</span><h1>NFL Prop Board</h1><p>QB, RB, WR and TE markets powered by role, opponent, form, splits, weather and live pace.</p></div><CommandTabs tabs={VIEW_TABS} value={view} onChange={setView} label="NFL view" className="nfl-view-tabs" variant="workspace" /></div>
    <div className="nfl-market-rail" role="tablist" aria-label="NFL prop market">{NFL_PROP_MARKET_LIST.map((market) => <button key={market.id} role="tab" aria-selected={marketId === market.id} className={marketId === market.id ? 'active' : ''} onClick={() => setMarketId(market.id)}><Icon name={MARKET_ICONS[market.id]} size={13} />{market.shortLabel}</button>)}</div>
    <div className="nfl-demo-banner" role="note"><Icon name="Beaker" size={15} /><span><b>{snapshot.source?.mode === 'demo' ? 'Demo slate' : 'NFL data connected'}</b> Historical contract starts in 2020. Live stats, injuries and sportsbook odds remain provider-dependent.</span></div>
    {marketId === 'first_td' && <div className="nfl-variance-note"><Icon name="TriangleAlert" size={14} /><span><b>First TD is high variance.</b> Long odds are not value by themselves—compare price with model probability.</span></div>}
    {marketId === 'two_plus_td' && <div className="nfl-variance-note"><Icon name="Flame" size={14} /><span><b>2+ TD uses explicit multi-score math.</b> It is not a copy of Anytime TD probability.</span></div>}
    <div className="nfl-layout"><section className="nfl-board-panel" aria-label="Ranked NFL props">
      <div className="nfl-filters nfl-prop-filters"><label className="nfl-search"><Icon name="Search" size={15} /><span className="sr-only">Search players</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players, teams, matchups" /></label><select value={position} onChange={(event) => setPosition(event.target.value)} aria-label="Position"><option value="all">All positions</option>{['QB', 'RB', 'WR', 'TE'].map((item) => <option key={item}>{item}</option>)}</select><select value={team} onChange={(event) => setTeam(event.target.value)} aria-label="Team"><option value="all">All teams</option>{teams.map((item) => <option key={item}>{item}</option>)}</select><button className={`nfl-two-filter ${twoPlusOnly ? 'active' : ''}`} aria-pressed={twoPlusOnly} onClick={() => setTwoPlusOnly((value) => !value)}><Icon name="Flame" size={13} />2+ TD filter</button></div>
      {view === 'cards' ? <div className="nfl-card-grid">{players.map((player) => <PlayerCard key={player.id} player={player} marketId={marketId} watched={watched.has(player.id)} inSlip={slip.has(`${player.id}:${marketId}`)} onSelect={setSelected} onToggleWatch={(item) => toggleSet(setWatched, item.id)} onToggleSlip={(item) => toggleSet(setSlip, `${item.id}:${marketId}`)} />)}</div> : <><div className="nfl-board-head nfl-prop-board-head" aria-hidden="true"><span>#</span><span>Player</span><span>Model %</span><span>Market</span><span>Edge</span><span>Signals</span><span /></div><div className="nfl-player-list">{players.map((player, index) => <BoardRow key={player.id} player={player} rank={index + 1} marketId={marketId} watched={watched.has(player.id)} inSlip={slip.has(`${player.id}:${marketId}`)} onSelect={setSelected} onToggleWatch={(item) => toggleSet(setWatched, item.id)} onToggleSlip={(item) => toggleSet(setSlip, `${item.id}:${marketId}`)} />)}</div></>}
      {!players.length && <div className="nfl-empty"><Icon name="Search" size={22} /><b>No eligible players match</b><button onClick={() => { setQuery(''); setPosition('all'); setTeam('all'); setTwoPlusOnly(false) }}>Clear filters</button></div>}
    </section><aside className="nfl-decision-rail" aria-label="NFL slate summary"><section className="nfl-slate-card"><div><span>Prop engine</span><strong>2020+ context ready</strong></div><b className="nfl-rating mono">{players.length}</b><ul><li><Icon name="Check" size={12} /> {NFL_PROP_MARKET_LIST.length} position-aware markets</li><li><Icon name="Activity" size={12} /> {liveCount} live player{liveCount === 1 ? '' : 's'} in this view</li><li><Icon name="Shield" size={12} /> Defense allowed by position</li></ul></section>{featured && <section className="nfl-featured-card"><span>Top {NFL_PROP_MARKET_LIST.find((market) => market.id === marketId)?.shortLabel}</span><h2>{featured.name}</h2><p>{featured.team} vs {featured.opponent} · {liveLabel(featured)}</p><div><b className="mono">{pct(featured.model.probability)}</b><em>at</em><b className="mono">{marketValue(featured, featured.model, marketId)}</b></div><button onClick={() => toggleSet(setSlip, `${featured.id}:${marketId}`)}><Icon name={slip.has(`${featured.id}:${marketId}`) ? 'Check' : 'Plus'} size={15} />{slip.has(`${featured.id}:${marketId}`) ? 'Added to slip' : 'Add selected prop'}</button></section>}<section className="nfl-builder-card"><header>Active workspace</header><div><span><small>Watchlist</small><b>{watched.size} players</b></span><span><small>Prop slip</small><b>{slip.size} legs</b></span></div></section></aside></div>
    <PlayerResearch player={selected} marketId={marketId} onClose={() => setSelected(null)} inSlip={selected ? slip.has(`${selected.id}:${marketId}`) : false} onToggleSlip={(item) => toggleSet(setSlip, `${item.id}:${marketId}`)} />
  </div>
}
