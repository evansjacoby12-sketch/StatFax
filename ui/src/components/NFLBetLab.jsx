import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import WorkspaceShell from './WorkspaceShell.jsx'
import { buildNFLCombos, NFL_COMBO_STRATEGIES } from '../lib/nflCombos.js'

const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`
const price = (value) => value == null ? 'Price N/A' : value > 0 ? `+${value}` : String(value)
const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)', SKIP: 'var(--skip)' }
const TABS = [
  { id: 'explore', label: 'Explore combos', icon: 'Layers' },
  { id: 'builder', label: 'Custom builder', icon: 'Sparkles' },
  { id: 'same-game', label: 'Same game', icon: 'Zap' },
]

function ComboGrid({ combos, slip, onAddCombo }) {
  if (!combos.length) return <div className="nfl-lab-empty"><Icon name="Beaker" size={24} /><b>No valid combos for these controls</b><span>Lower the minimum grade or try another strategy.</span></div>
  return <div className="nfl-combo-grid">{combos.map((combo, index) => {
    const isAdded = combo.legs.every((leg) => slip.has(leg.key))
    const color = GRADE_COLORS[combo.grade]
    return <article className="nfl-combo-card" key={combo.id} style={{ '--nfl-combo-grade': color }}>
      <header><div><span className="nfl-combo-rank mono">#{index + 1}</span><span className="nfl-combo-strategy">{NFL_COMBO_STRATEGIES.find((item) => item.id === combo.strategy)?.label}</span>{combo.scope === 'same-game' && <span className="nfl-combo-sgp">Same game</span>}</div><span className="nfl-combo-grade" style={{ color }}>{combo.grade} · {combo.score}</span></header>
      <div className="nfl-combo-metrics"><span><small>All-hit model</small><strong className="mono" style={{ color }}>{pct(combo.probability)}</strong></span><span><small>Parlay price</small><strong className="mono">{price(combo.americanOdds)}</strong></span><span><small>Avg. edge</small><strong className={`mono ${combo.avgEdge >= 0 ? 'positive' : 'negative'}`}>{combo.avgEdge >= 0 ? '+' : ''}{pct(combo.avgEdge)}</strong></span></div>
      <ol className="nfl-combo-legs">{combo.legs.map((leg, legIndex) => <li key={leg.key}><span className="nfl-combo-ord mono">{legIndex + 1}</span><div><b>{leg.name}</b><small>{leg.team} vs {leg.opponent} · {leg.marketLabel}{leg.line != null && !leg.marketId.includes('td') ? ` over ${leg.line}` : ''}</small><span>{leg.model.signals?.slice(0, 2).map((signal) => <em key={signal.key}>{signal.text}</em>)}</span></div><aside><strong className="mono">{pct(leg.probability)}</strong><small className="mono">{price(leg.odds)}</small></aside></li>)}</ol>
      <p className="nfl-combo-why"><Icon name="Sparkles" size={13} />{combo.rationale}</p>
      <footer><button type="button" className={isAdded ? 'active' : ''} onClick={() => onAddCombo(combo)}><Icon name={isAdded ? 'Check' : 'Plus'} size={14} />{isAdded ? 'Combo added' : `Add all ${combo.legs.length} legs`}</button></footer>
    </article>
  })}</div>
}

function ComboExplorer({ snapshot, slip, onAddCombo, scope, legCount, setLegCount, strategy, setStrategy, minGrade, setMinGrade }) {
  const combos = useMemo(() => buildNFLCombos(snapshot, { legs: legCount, strategy, scope, minGrade }), [legCount, minGrade, scope, snapshot, strategy])
  const selectedStrategy = NFL_COMBO_STRATEGIES.find((item) => item.id === strategy)
  return <section className="nfl-combo-explorer" aria-label={scope === 'same-game' ? 'NFL same-game combinations' : 'NFL combination explorer'}>
    <div className="nfl-lab-controls" aria-label="NFL parlay controls">
      <fieldset><legend>Legs</legend><div className="nfl-lab-segment">{[2, 3, 4].map((count) => <button type="button" key={count} className={legCount === count ? 'active' : ''} aria-pressed={legCount === count} onClick={() => setLegCount(count)}>{count}</button>)}</div></fieldset>
      <label><span>Strategy</span><select value={strategy} onChange={(event) => setStrategy(event.target.value)}>{NFL_COMBO_STRATEGIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label><span>Minimum grade</span><select value={minGrade} onChange={(event) => setMinGrade(event.target.value)}><option value="LEAN">Lean+</option><option value="STRONG">Strong+</option><option value="PRIME">Prime only</option></select></label>
      <div className="nfl-lab-scope"><span>Game scope</span><b><Icon name={scope === 'same-game' ? 'Zap' : 'LayoutGrid'} size={13} />{scope === 'same-game' ? 'One matchup' : 'Across slate'}</b></div>
    </div>
    <div className="nfl-lab-summary"><span><Icon name={selectedStrategy?.icon || 'Layers'} size={14} /><b>{selectedStrategy?.label}</b> · {selectedStrategy?.description}</span><small>{combos.length} ranked build{combos.length === 1 ? '' : 's'} · model probabilities assume independent legs</small></div>
    <ComboGrid combos={combos} slip={slip} onAddCombo={onAddCombo} />
  </section>
}

function CustomBuilder({ slipLegs, onToggleLeg, onClearSlip, onSaveTicket }) {
  const allHit = slipLegs.length ? slipLegs.reduce((product, leg) => product * Number(leg.probability || 0), 1) : null
  const average = slipLegs.length ? slipLegs.reduce((sum, leg) => sum + Number(leg.probability || 0), 0) / slipLegs.length : null
  return <section className="nfl-custom-builder" aria-labelledby="nfl-custom-builder-title">
    <header><div><span className="nfl-eyebrow"><Icon name="Sparkles" size={13} /> Active decision</span><h3 id="nfl-custom-builder-title">Custom slip</h3><p>Add props from Signals or a model combo, then review the complete ticket here.</p></div><span className="nfl-ticket-count">{slipLegs.length} leg{slipLegs.length === 1 ? '' : 's'}</span></header>
    <div className="nfl-builder-metrics"><span><small>All-hit model</small><b className="mono">{pct(allHit)}</b></span><span><small>Average leg</small><b className="mono">{pct(average)}</b></span><span><small>Pricing</small><b>{slipLegs.length && slipLegs.every((leg) => leg.odds != null) ? 'Complete' : 'Missing prices'}</b></span></div>
    {slipLegs.length ? <ol className="nfl-builder-legs">{slipLegs.map((leg, index) => <li key={leg.key}><span className="nfl-combo-ord mono">{index + 1}</span><div><b>{leg.name}</b><small>{leg.marketLabel}{leg.line != null && !leg.marketId.includes('td') ? ` · over ${leg.line}` : ''}</small></div><aside><strong className="mono">{pct(leg.probability)}</strong><small className="mono">{price(leg.odds)}</small></aside><button type="button" onClick={() => onToggleLeg(leg.key)} aria-label={`Remove ${leg.name} from slip`}><Icon name="X" size={14} /></button></li>)}</ol> : <div className="nfl-ticket-empty"><Icon name="Plus" size={18} /><b>Your slip is empty</b><span>Add a full combo here or choose individual props from Signals.</span></div>}
    <footer><button type="button" onClick={onClearSlip} disabled={!slipLegs.length}>Clear</button><button type="button" className="primary" onClick={onSaveTicket} disabled={!slipLegs.length}><Icon name="Bookmark" size={14} />Track ticket</button></footer>
  </section>
}

export default function NFLBetLab({ snapshot, slip, slipLegs, tab, onTabChange, onAddCombo, onToggleLeg, onClearSlip, onSaveTicket }) {
  const [legCount, setLegCount] = useState(2)
  const [strategy, setStrategy] = useState('balanced')
  const [minGrade, setMinGrade] = useState('LEAN')
  return <WorkspaceShell
    embedded
    icon="Beaker"
    eyebrow="Decision workspace"
    title="Bet Lab"
    description="Explore model-built NFL combinations, construct a slip, or isolate one game—without hiding the probability tradeoffs."
    tabs={TABS}
    activeTab={tab}
    onTabChange={onTabChange}
    status={slip.size ? `${slip.size} ${slip.size === 1 ? 'leg' : 'legs'} on slip` : 'Slip empty'}
  >
    <div className="workspace-brief">
      <span><b>Decision rule</b> Build from available, individually defensible props. More legs increase payout—not reliability.</span>
      <span><b>Probability</b> All-hit is the independent product; StatFax applies no unproven same-game uplift.</span>
    </div>
    {tab === 'explore' && <ComboExplorer snapshot={snapshot} slip={slip} onAddCombo={onAddCombo} scope="all" legCount={legCount} setLegCount={setLegCount} strategy={strategy} setStrategy={setStrategy} minGrade={minGrade} setMinGrade={setMinGrade} />}
    {tab === 'builder' && <CustomBuilder slipLegs={slipLegs} onToggleLeg={onToggleLeg} onClearSlip={onClearSlip} onSaveTicket={onSaveTicket} />}
    {tab === 'same-game' && <ComboExplorer snapshot={snapshot} slip={slip} onAddCombo={onAddCombo} scope="same-game" legCount={legCount} setLegCount={setLegCount} strategy={strategy} setStrategy={setStrategy} minGrade={minGrade} setMinGrade={setMinGrade} />}
  </WorkspaceShell>
}
