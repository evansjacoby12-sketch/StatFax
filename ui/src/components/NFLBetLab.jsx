import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { buildNFLCombos, NFL_COMBO_STRATEGIES } from '../lib/nflCombos.js'

const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`
const price = (value) => value == null ? 'Price N/A' : value > 0 ? `+${value}` : String(value)
const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)', SKIP: 'var(--skip)' }

export default function NFLBetLab({ snapshot, slip, onAddCombo, onOpenTickets }) {
  const [legCount, setLegCount] = useState(2)
  const [strategy, setStrategy] = useState('balanced')
  const [scope, setScope] = useState('all')
  const [minGrade, setMinGrade] = useState('LEAN')
  const combos = useMemo(() => buildNFLCombos(snapshot, { legs: legCount, strategy, scope, minGrade }), [legCount, minGrade, scope, snapshot, strategy])
  const selectedStrategy = NFL_COMBO_STRATEGIES.find((item) => item.id === strategy)

  return <section className="nfl-bet-lab" aria-labelledby="nfl-bet-lab-title">
    <header className="nfl-bet-lab-head">
      <div><span className="nfl-eyebrow"><Icon name="Beaker" size={13} /> NFL combo engine</span><h2 id="nfl-bet-lab-title">Parlay Bet Lab</h2><p>Generate model-led NFL combinations, then send the complete build to your prop slip.</p></div>
      <button type="button" className="nfl-bet-lab-slip" onClick={onOpenTickets}><Icon name="ClipboardList" size={14} /><span><small>Active slip</small><b>{slip.size} leg{slip.size === 1 ? '' : 's'}</b></span></button>
    </header>

    <div className="nfl-lab-controls" aria-label="NFL parlay controls">
      <fieldset><legend>Legs</legend><div className="nfl-lab-segment">{[2, 3, 4].map((count) => <button type="button" key={count} className={legCount === count ? 'active' : ''} aria-pressed={legCount === count} onClick={() => setLegCount(count)}>{count}</button>)}</div></fieldset>
      <label><span>Strategy</span><select value={strategy} onChange={(event) => setStrategy(event.target.value)}>{NFL_COMBO_STRATEGIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span>Game scope</span><select value={scope} onChange={(event) => setScope(event.target.value)}><option value="all">Across slate</option><option value="same-game">Same game</option></select></label>
      <label><span>Minimum grade</span><select value={minGrade} onChange={(event) => setMinGrade(event.target.value)}><option value="LEAN">Lean+</option><option value="STRONG">Strong+</option><option value="PRIME">Prime only</option></select></label>
    </div>

    <div className="nfl-lab-summary"><span><Icon name={selectedStrategy?.icon || 'Layers'} size={14} /><b>{selectedStrategy?.label}</b> · {selectedStrategy?.description}</span><small>{combos.length} ranked build{combos.length === 1 ? '' : 's'} · model probabilities assume independent legs</small></div>

    {combos.length ? <div className="nfl-combo-grid">{combos.map((combo, index) => {
      const isAdded = combo.legs.every((leg) => slip.has(leg.key))
      const color = GRADE_COLORS[combo.grade]
      return <article className="nfl-combo-card" key={combo.id} style={{ '--nfl-combo-grade': color }}>
        <header><div><span className="nfl-combo-rank mono">#{index + 1}</span><span className="nfl-combo-strategy">{NFL_COMBO_STRATEGIES.find((item) => item.id === combo.strategy)?.label}</span>{combo.scope === 'same-game' && <span className="nfl-combo-sgp">Same game</span>}</div><span className="nfl-combo-grade" style={{ color }}>{combo.grade} · {combo.score}</span></header>
        <div className="nfl-combo-metrics"><span><small>All-hit model</small><strong className="mono" style={{ color }}>{pct(combo.probability)}</strong></span><span><small>Parlay price</small><strong className="mono">{price(combo.americanOdds)}</strong></span><span><small>Avg. edge</small><strong className={`mono ${combo.avgEdge >= 0 ? 'positive' : 'negative'}`}>{combo.avgEdge >= 0 ? '+' : ''}{pct(combo.avgEdge)}</strong></span></div>
        <ol className="nfl-combo-legs">{combo.legs.map((leg, legIndex) => <li key={leg.key}><span className="nfl-combo-ord mono">{legIndex + 1}</span><div><b>{leg.name}</b><small>{leg.team} vs {leg.opponent} · {leg.marketLabel}{leg.line != null && !leg.marketId.includes('td') ? ` over ${leg.line}` : ''}</small><span>{leg.model.signals?.slice(0, 2).map((signal) => <em key={signal.key}>{signal.text}</em>)}</span></div><aside><strong className="mono">{pct(leg.probability)}</strong><small className="mono">{price(leg.odds)}</small></aside></li>)}</ol>
        <p className="nfl-combo-why"><Icon name="Sparkles" size={13} />{combo.rationale}</p>
        <footer><button type="button" className={isAdded ? 'active' : ''} onClick={() => onAddCombo(combo)}><Icon name={isAdded ? 'Check' : 'Plus'} size={14} />{isAdded ? 'Combo added' : `Add all ${combo.legs.length} legs`}</button></footer>
      </article>
    })}</div> : <div className="nfl-lab-empty"><Icon name="Beaker" size={24} /><b>No valid combos for these controls</b><span>Lower the minimum grade, switch to across-slate, or try another strategy.</span></div>}
  </section>
}
