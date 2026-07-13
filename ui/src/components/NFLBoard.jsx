import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'

const MARKETS = [
  { id: 'anytime', label: 'Anytime TD', icon: 'Target' },
  { id: 'first', label: 'First TD Scorer', icon: 'Trophy' },
]

const DEMO_PLAYERS = [
  {
    id: 'demo-bal-rb-1', name: 'Derrick Henry', position: 'RB', team: 'BAL', opponent: 'LVR', kickoff: 'Sun · 1:00 PM', teamTotal: 27.5,
    grade: 'PRIME', status: 'Goal-line lead', statusTone: 'good', anytime: { probability: 0.642, odds: -140 }, first: { probability: 0.184, odds: 450 },
    signals: ['22 red-zone touches', 'Goal-line role'], details: ['Projected lead back', 'Opponent allowed elevated rushing TD rate', 'High team scoring expectation'],
  },
  {
    id: 'demo-phi-rb-1', name: 'Saquon Barkley', position: 'RB', team: 'PHI', opponent: 'ATL', kickoff: 'Mon · 8:15 PM', teamTotal: 28,
    grade: 'PRIME', status: 'Workhorse role', statusTone: 'good', anytime: { probability: 0.588, odds: -120 }, first: { probability: 0.161, odds: 525 },
    signals: ['90% snap share', 'Primary goal-line back'], details: ['Three-down workload projection', 'Strong offensive-line matchup', 'Multiple-touchdown ceiling'],
  },
  {
    id: 'demo-mia-wr-1', name: 'Tyreek Hill', position: 'WR', team: 'MIA', opponent: 'BUF', kickoff: 'Thu · 8:15 PM', teamTotal: 24.5,
    grade: 'STRONG', status: 'Route leader', statusTone: 'good', anytime: { probability: 0.485, odds: 120 }, first: { probability: 0.122, odds: 700 },
    signals: ['94% route share', 'Red-zone target lead'], details: ['Explosive-play touchdown path', 'Designed red-zone usage', 'Full route participation projected'],
  },
  {
    id: 'demo-buf-qb-1', name: 'Josh Allen', position: 'QB', team: 'BUF', opponent: 'MIA', kickoff: 'Thu · 8:15 PM', teamTotal: 26.5,
    grade: 'STRONG', status: 'Workload watch', statusTone: 'warn', anytime: { probability: 0.421, odds: 155 }, first: { probability: 0.101, odds: 850 },
    signals: ['8 designed goal-line runs', 'QB sneak role'], details: ['Rushing usage drives the projection', 'Monitor practice and injury news', 'High team touchdown expectation'],
  },
  {
    id: 'demo-det-te-1', name: 'Sam LaPorta', position: 'TE', team: 'DET', opponent: 'TB', kickoff: 'Sun · 4:25 PM', teamTotal: 27,
    grade: 'STRONG', status: 'Full workload', statusTone: 'good', anytime: { probability: 0.398, odds: 175 }, first: { probability: 0.094, odds: 950 },
    signals: ['End-zone target role', '82% route share'], details: ['Strong middle-of-field matchup', 'Stable red-zone involvement', 'High-total game environment'],
  },
  {
    id: 'demo-sf-rb-1', name: 'Christian McCaffrey', position: 'RB', team: 'SF', opponent: 'MIN', kickoff: 'Sun · 8:20 PM', teamTotal: 25.5,
    grade: 'LEAN', status: 'Questionable', statusTone: 'warn', anytime: { probability: 0.384, odds: 145 }, first: { probability: 0.088, odds: 850 },
    signals: ['Elite TD share', 'Injury uncertainty'], details: ['Projection assumes an active designation', 'Role could be capped', 'Recheck inactives before betting'],
  },
  {
    id: 'demo-cin-wr-1', name: 'Ja\'Marr Chase', position: 'WR', team: 'CIN', opponent: 'KC', kickoff: 'Sun · 4:25 PM', teamTotal: 23.5,
    grade: 'LEAN', status: 'Full workload', statusTone: 'neutral', anytime: { probability: 0.352, odds: 200 }, first: { probability: 0.079, odds: 1050 },
    signals: ['31% target share', 'End-zone usage'], details: ['Primary receiving touchdown option', 'Difficult coverage matchup', 'Volume keeps the ceiling intact'],
  },
  {
    id: 'demo-kc-te-1', name: 'Travis Kelce', position: 'TE', team: 'KC', opponent: 'CIN', kickoff: 'Sun · 4:25 PM', teamTotal: 26,
    grade: 'LEAN', status: 'Role stable', statusTone: 'neutral', anytime: { probability: 0.337, odds: 210 }, first: { probability: 0.076, odds: 1100 },
    signals: ['Red-zone route lead', 'High team total'], details: ['Quarterback trust near the goal line', 'Stable passing-down role', 'Price matters at this probability'],
  },
]

const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)' }

function impliedProbability(odds) {
  return odds < 0 ? Math.abs(odds) / (Math.abs(odds) + 100) : 100 / (odds + 100)
}

function formatPercent(value, digits = 1) {
  return `${(value * 100).toFixed(digits)}%`
}

function formatOdds(value) {
  return value > 0 ? `+${value}` : String(value)
}

function PlayerRow({ player, market, rank, watched, inSlip, onSelect, onToggleWatch, onToggleSlip }) {
  const quote = player[market]
  const implied = impliedProbability(quote.odds)
  const edge = quote.probability - implied
  const gradeColor = GRADE_COLORS[player.grade]

  return (
    <article
      className="nfl-player-row"
      style={{ '--nfl-grade': gradeColor }}
      role="button"
      tabIndex={0}
      aria-label={`Open touchdown research for ${player.name}`}
      onClick={() => onSelect(player)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(player)
        }
      }}
    >
      <div className="nfl-rank mono">{rank}</div>
      <div className="nfl-player-main">
        <div className="nfl-player-name-line">
          <b>{player.name}</b>
          <span className="nfl-position">{player.position}</span>
          <span className="nfl-grade" style={{ color: gradeColor }}>{player.grade}</span>
        </div>
        <div className="nfl-matchup">
          <b>{player.team}</b><Icon name="ChevronRight" size={10} /><span>{player.opponent}</span><i>·</i><span>{player.kickoff}</span><i>·</i><span>Team <b>{player.teamTotal.toFixed(1)}</b></span>
        </div>
        <div className={`nfl-status nfl-status--${player.statusTone}`}><Icon name={player.statusTone === 'warn' ? 'TriangleAlert' : 'CircleCheck'} size={11} />{player.status}</div>
      </div>
      <div className="nfl-number nfl-model-prob"><strong className="mono" style={{ color: gradeColor }}>{formatPercent(quote.probability)}</strong><small>Model</small></div>
      <div className="nfl-number"><strong className="mono">{formatOdds(quote.odds)}</strong><small>Odds</small></div>
      <div className="nfl-number"><strong className="mono dim">{formatPercent(implied)}</strong><small>Implied</small></div>
      <div className="nfl-number"><strong className={`mono nfl-edge ${edge >= 0 ? 'positive' : 'negative'}`}>{edge >= 0 ? '+' : ''}{formatPercent(edge)}</strong><small>Edge</small></div>
      <div className="nfl-signals">
        {player.signals.slice(0, 2).map((signal, index) => <span key={signal}><Icon name={index ? 'Activity' : 'Target'} size={10} />{signal}</span>)}
      </div>
      <div className="nfl-row-actions" onClick={(event) => event.stopPropagation()}>
        <button className={watched ? 'active' : ''} onClick={() => onToggleWatch(player)} aria-label={`${watched ? 'Stop watching' : 'Watch'} ${player.name}`}><Icon name="Star" size={15} /></button>
        <button className={inSlip ? 'active' : ''} onClick={() => onToggleSlip(player)} aria-label={`${inSlip ? 'Remove' : 'Add'} ${player.name} ${inSlip ? 'from' : 'to'} touchdown slip`}><Icon name={inSlip ? 'Check' : 'Plus'} size={15} /></button>
      </div>
    </article>
  )
}

function PlayerResearch({ player, market, onClose, inSlip, onToggleSlip }) {
  if (!player) return null
  const quote = player[market]
  const implied = impliedProbability(quote.odds)
  const edge = quote.probability - implied
  return (
    <>
      <button className="nfl-drawer-scrim" onClick={onClose} aria-label="Close player research" />
      <aside className="nfl-drawer" role="dialog" aria-modal="true" aria-labelledby="nfl-drawer-title">
        <button className="nfl-drawer-close" onClick={onClose} aria-label="Close"><Icon name="X" size={18} /></button>
        <span className="nfl-drawer-eyebrow">Touchdown research · Demo model</span>
        <h2 id="nfl-drawer-title">{player.name}</h2>
        <p>{player.position} · {player.team} vs {player.opponent} · {player.kickoff}</p>
        <div className="nfl-drawer-market">{market === 'anytime' ? 'Anytime touchdown' : 'First touchdown scorer'}</div>
        <div className="nfl-drawer-scorecard">
          <div><small>Model</small><strong className="mono">{formatPercent(quote.probability)}</strong></div>
          <div><small>Odds</small><strong className="mono">{formatOdds(quote.odds)}</strong></div>
          <div><small>Edge</small><strong className={`mono ${edge >= 0 ? 'positive' : 'negative'}`}>{edge >= 0 ? '+' : ''}{formatPercent(edge)}</strong></div>
        </div>
        <section className="nfl-drawer-section">
          <h3>Why the model is here</h3>
          {player.details.map((detail) => <div key={detail}><Icon name="Check" size={13} /><span>{detail}</span></div>)}
        </section>
        <section className="nfl-drawer-section nfl-truth-note">
          <h3><Icon name="Info" size={14} /> Data disclosure</h3>
          <p>This is interface demonstration data, not a live projection or betting recommendation. Live odds, injuries, depth charts, and model output still need an NFL feed.</p>
        </section>
        <button className={`nfl-drawer-cta ${inSlip ? 'is-added' : ''}`} onClick={() => onToggleSlip(player)}><Icon name={inSlip ? 'Check' : 'Plus'} size={16} />{inSlip ? 'Added to touchdown slip' : 'Add to touchdown slip'}</button>
      </aside>
    </>
  )
}

export default function NFLBoard() {
  const [market, setMarket] = useState('anytime')
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState('all')
  const [team, setTeam] = useState('all')
  const [sort, setSort] = useState('probability')
  const [selected, setSelected] = useState(null)
  const [watched, setWatched] = useState(() => new Set())
  const [slip, setSlip] = useState(() => new Set())

  const teams = useMemo(() => [...new Set(DEMO_PLAYERS.map((player) => player.team))].sort(), [])
  const players = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return DEMO_PLAYERS
      .filter((player) => position === 'all' || player.position === position)
      .filter((player) => team === 'all' || player.team === team)
      .filter((player) => !normalized || `${player.name} ${player.team} ${player.opponent} ${player.position}`.toLowerCase().includes(normalized))
      .sort((a, b) => {
        const qa = a[market]
        const qb = b[market]
        if (sort === 'odds') return qa.odds - qb.odds
        if (sort === 'edge') return (qb.probability - impliedProbability(qb.odds)) - (qa.probability - impliedProbability(qa.odds))
        return qb.probability - qa.probability
      })
  }, [market, position, query, sort, team])

  const featured = players[0] || DEMO_PLAYERS[0]
  const toggleSet = (setter, id) => setter((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="nfl-workspace">
      <div className="nfl-workspace-head">
        <div>
          <span className="nfl-eyebrow"><Icon name="Shield" size={13} /> NFL touchdown model</span>
          <h1>Touchdown Board</h1>
          <p>One board, two scorer markets. Ranked by model probability with price and role context.</p>
        </div>
        <CommandTabs tabs={MARKETS} value={market} onChange={setMarket} label="Touchdown market" className="nfl-market-tabs" variant="workspace" />
      </div>

      <div className="nfl-demo-banner" role="note">
        <Icon name="Beaker" size={15} />
        <span><b>Demo slate</b> Interface and calculations are wired; player inputs and odds below are placeholders until the NFL data pipeline ships.</span>
      </div>

      {market === 'first' && <div className="nfl-variance-note"><Icon name="TriangleAlert" size={14} /><span><b>First TD is high variance.</b> Long odds are not value by themselves—compare model probability with the implied price.</span></div>}

      <div className="nfl-layout">
        <section className="nfl-board-panel" aria-label="Ranked NFL touchdown scorers">
          <div className="nfl-filters">
            <label className="nfl-search"><Icon name="Search" size={15} /><span className="sr-only">Search players</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search players, teams, matchups" /></label>
            <select value={position} onChange={(event) => setPosition(event.target.value)} aria-label="Position"><option value="all">All positions</option>{['RB', 'WR', 'TE', 'QB'].map((item) => <option key={item}>{item}</option>)}</select>
            <select value={team} onChange={(event) => setTeam(event.target.value)} aria-label="Team"><option value="all">All teams</option>{teams.map((item) => <option key={item}>{item}</option>)}</select>
          </div>
          <div className="nfl-board-head" aria-hidden="true">
            <span>#</span><span>Player</span><button className={sort === 'probability' ? 'active' : ''} onClick={() => setSort('probability')}>Model %</button><button className={sort === 'odds' ? 'active' : ''} onClick={() => setSort('odds')}>Odds</button><span>Implied</span><button className={sort === 'edge' ? 'active' : ''} onClick={() => setSort('edge')}>Edge</button><span>Key signals</span><span />
          </div>
          <div className="nfl-player-list">
            {players.map((player, index) => <PlayerRow key={player.id} player={player} market={market} rank={index + 1} watched={watched.has(player.id)} inSlip={slip.has(player.id)} onSelect={setSelected} onToggleWatch={(item) => toggleSet(setWatched, item.id)} onToggleSlip={(item) => toggleSet(setSlip, item.id)} />)}
            {!players.length && <div className="nfl-empty"><Icon name="Search" size={22} /><b>No players match these filters</b><button onClick={() => { setQuery(''); setPosition('all'); setTeam('all') }}>Clear filters</button></div>}
          </div>
        </section>

        <aside className="nfl-decision-rail" aria-label="NFL slate summary">
          <section className="nfl-slate-card">
            <div><span>Demo slate rating</span><strong>High scoring</strong></div><b className="nfl-rating mono">7.8</b>
            <ul><li><Icon name="Check" size={12} /> Both scorer markets supported</li><li><Icon name="Check" size={12} /> Price and implied probability shown</li><li><Icon name="Info" size={12} /> Live NFL feed still required</li></ul>
          </section>
          <section className="nfl-featured-card">
            <span>{market === 'anytime' ? 'Top demo anytime play' : 'Top demo first scorer'}</span>
            <h2>{featured.name}</h2>
            <p>{featured.team} vs {featured.opponent} · {featured.kickoff}</p>
            <div><b className="mono">{formatPercent(featured[market].probability)}</b><em>at</em><b className="mono">{formatOdds(featured[market].odds)}</b></div>
            <button onClick={() => toggleSet(setSlip, featured.id)}><Icon name={slip.has(featured.id) ? 'Check' : 'Plus'} size={15} />{slip.has(featured.id) ? 'Added to slip' : 'Add to touchdown slip'}</button>
          </section>
          <section className="nfl-builder-card"><header>Active builder</header><div><span><small>Watchlist</small><b>{watched.size} {watched.size === 1 ? 'player' : 'players'}</b></span><span><small>TD slip</small><b>{slip.size} {slip.size === 1 ? 'leg' : 'legs'}</b></span></div></section>
        </aside>
      </div>

      <PlayerResearch player={selected} market={market} onClose={() => setSelected(null)} inSlip={selected ? slip.has(selected.id) : false} onToggleSlip={(item) => toggleSet(setSlip, item.id)} />
    </div>
  )
}
