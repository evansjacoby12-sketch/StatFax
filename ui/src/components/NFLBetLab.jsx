import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import WorkspaceShell from './WorkspaceShell.jsx'
import { buildNFLComboBoard, NFL_COMBO_STRATEGIES } from '../lib/nflCombos.js'
import { isNFLTDMarket } from '../lib/nflTickets.js'

const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`
const price = (value) => value == null ? 'Price N/A' : value > 0 ? `+${value}` : String(value)
const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)', SKIP: 'var(--skip)' }
const TABS = [
  { id: 'explore', label: 'Explore combos', icon: 'Layers' },
  { id: 'builder', label: 'Custom builder', icon: 'Sparkles' },
  { id: 'same-game', label: 'Same game', icon: 'Zap' },
]

function ComboGrid({ stackBoards, slip, onAddCombo }) {
  return <div className="nfl-combo-grid nfl-stack-showcase">{stackBoards.map(({ stack, board, combo, unavailableReason }) => {
    if (!combo) return <article className="nfl-combo-card nfl-stack-unavailable" key={stack.id} style={{ '--nfl-combo-grade': 'var(--skip)' }}>
      <header><div><span className="nfl-combo-rank mono">#1</span><span className="nfl-combo-strategy">{stack.cardLabel || stack.label}</span><span className={`nfl-stack-risk is-${stack.riskTone || 'caution'}`}>{stack.risk}</span></div><span className="nfl-combo-grade">Unavailable</span></header>
      <div className="nfl-stack-unavailable-body"><Icon name="ShieldAlert" size={28} /><b>No valid {stack.label} build</b><span>{unavailableReason || board?.coverage?.limitations?.join(' · ') || `No ${stack.label} combo clears these controls.`}</span></div>
      <footer><button type="button" disabled><Icon name="Plus" size={14} />Add all legs</button></footer>
    </article>
    const isAdded = combo.legs.every((leg) => slip.has(leg.key))
    const color = GRADE_COLORS[combo.grade]
    return <article className="nfl-combo-card" key={`${stack.id}:${combo.id}`} style={{ '--nfl-combo-grade': color }}>
      <header><div><span className="nfl-combo-rank mono">#1</span><span className="nfl-combo-strategy">{stack.cardLabel || stack.label}</span><span className={`nfl-stack-risk is-${stack.riskTone || 'caution'}`}>{stack.risk}</span>{combo.scope === 'same-game' && <span className="nfl-combo-sgp">Same game</span>}</div><span className="nfl-combo-grade" style={{ color }}>BUILD {combo.grade} · {combo.score}</span></header>
      <div className="nfl-stack-card-intro"><Icon name={stack.icon || 'Layers'} size={12} /><span><b>{stack.label}</b>{stack.description}</span><small>{board.calibration.ready ? `${board.calibration.samples} calibration samples` : 'Calibration collecting'}</small></div>
      <div className="nfl-combo-metrics"><span><small>{combo.probabilityMethod === 'stack-calibrated-joint' ? 'Calibrated joint' : 'Independent baseline'}</small><strong className="mono" style={{ color }}>{pct(combo.probability)}</strong></span><span><small>Parlay price</small><strong className="mono">{price(combo.americanOdds)}</strong></span><span><small>Evidence</small><strong className="mono">{combo.evidenceConfidence}</strong></span></div>
      <ol className="nfl-combo-legs">{combo.legs.map((leg, legIndex) => <li key={leg.key}><span className="nfl-combo-ord mono">{legIndex + 1}</span><div><b>{leg.name}</b><small>{leg.team} vs {leg.opponent} · {leg.marketLabel}</small><span>{leg.model.signals?.slice(0, 2).map((signal) => <em key={signal.key}>{signal.text}</em>)}</span></div><aside><strong className="mono">{pct(leg.probability)}</strong><small className="mono">{price(leg.odds)}</small></aside></li>)}</ol>
      <p className="nfl-combo-why"><Icon name="Sparkles" size={13} />{combo.rationale}</p>
      <footer><button type="button" className={isAdded ? 'active' : ''} onClick={() => onAddCombo(combo)}><Icon name={isAdded ? 'Check' : 'Plus'} size={14} />{isAdded ? 'Combo added' : `Add all ${combo.legs.length} legs`}</button></footer>
    </article>
  })}</div>
}

function ComboExplorer({ snapshot, slip, onAddCombo, scope, legCount, setLegCount, minGrade, setMinGrade }) {
  const stackBoards = useMemo(() => NFL_COMBO_STRATEGIES.map((stack) => {
    if (!stack.scopes.includes(scope)) return { stack, board: null, combo: null, unavailableReason: scope === 'same-game' ? 'This stack is cross-game only.' : 'This stack does not support the selected scope.' }
    const board = buildNFLComboBoard(snapshot, { legs: legCount, strategy: stack.id, scope, minGrade, limit: 1 })
    return { stack, board, combo: board.combos[0] || null, unavailableReason: null }
  }), [legCount, minGrade, scope, snapshot])
  const availableCount = stackBoards.filter((entry) => entry.combo).length
  const calibratedCount = stackBoards.filter((entry) => entry.board?.calibration?.ready).length
  return <section className="nfl-combo-explorer" aria-label={scope === 'same-game' ? 'NFL same-game combinations' : 'NFL combination explorer'}>
    <div className="nfl-lab-controls" aria-label="NFL parlay controls">
      <fieldset><legend>Legs</legend><div className="nfl-lab-segment">{[2, 3, 4].map((count) => <button type="button" key={count} className={legCount === count ? 'active' : ''} aria-pressed={legCount === count} onClick={() => setLegCount(count)}>{count}</button>)}</div></fieldset>
      <label><span>Minimum grade</span><select value={minGrade} onChange={(event) => setMinGrade(event.target.value)}><option value="LEAN">Lean+</option><option value="STRONG">Strong+</option><option value="PRIME">Prime only</option></select></label>
      <div className="nfl-lab-scope"><span>Game scope</span><b><Icon name={scope === 'same-game' ? 'Zap' : 'LayoutGrid'} size={13} />{scope === 'same-game' ? 'One matchup' : 'Across slate'}</b></div>
    </div>
    <div className="nfl-lab-summary"><span><Icon name="LayoutGrid" size={14} /><b>Best of every stack</b> · One top-ranked TD combination from each named strategy<em>Change 2 / 3 / 4 legs once to rebuild every stack on this page.</em></span><small>{availableCount} of {NFL_COMBO_STRATEGIES.length} stacks available · {calibratedCount} calibrated</small></div>
    <ComboGrid stackBoards={stackBoards} slip={slip} onAddCombo={onAddCombo} />
  </section>
}

function CustomBuilder({ slipLegs, onToggleLeg, onClearSlip, onSaveTicket }) {
  const allHit = slipLegs.length ? slipLegs.reduce((product, leg) => product * Number(leg.probability || 0), 1) : null
  const average = slipLegs.length ? slipLegs.reduce((sum, leg) => sum + Number(leg.probability || 0), 0) / slipLegs.length : null
  return <section className="nfl-custom-builder" aria-labelledby="nfl-custom-builder-title">
    <header><div><span className="nfl-eyebrow"><Icon name="Sparkles" size={13} /> Touchdown decision</span><h3 id="nfl-custom-builder-title">Custom TD slip</h3><p>Add Anytime TD, First TD or 2+ TD legs from Signals or a model-built parlay.</p></div><span className="nfl-ticket-count">{slipLegs.length} leg{slipLegs.length === 1 ? '' : 's'}</span></header>
    <div className="nfl-builder-metrics"><span><small>All-hit model</small><b className="mono">{pct(allHit)}</b></span><span><small>Average leg</small><b className="mono">{pct(average)}</b></span><span><small>Pricing</small><b>{slipLegs.length && slipLegs.every((leg) => leg.odds != null) ? 'Complete' : 'Missing prices'}</b></span></div>
    {slipLegs.length ? <><ol className="nfl-builder-legs">{slipLegs.map((leg, index) => <li key={leg.key}><span className="nfl-combo-ord mono">{index + 1}</span><div><b>{leg.name}</b><small>{leg.marketLabel}</small></div><aside><strong className="mono">{pct(leg.probability)}</strong><small className="mono">{price(leg.odds)}</small></aside><button type="button" onClick={() => onToggleLeg(leg.key)} aria-label={`Remove ${leg.name} from slip`}><Icon name="X" size={14} /></button></li>)}</ol>{slipLegs.length === 1 && <p className="nfl-combo-why"><Icon name="Info" size={13} />Add one more touchdown leg to create a parlay.</p>}</> : <div className="nfl-ticket-empty"><Icon name="Plus" size={18} /><b>Your TD slip is empty</b><span>Add a touchdown parlay here or choose an individual TD prop from Signals.</span></div>}
    <footer><button type="button" onClick={onClearSlip} disabled={!slipLegs.length}>Clear</button><button type="button" className="primary" onClick={() => onSaveTicket(slipLegs)} disabled={slipLegs.length < 2}><Icon name="Bookmark" size={14} />Track TD parlay</button></footer>
  </section>
}

export default function NFLBetLab({ snapshot, slip, slipLegs, tab, onTabChange, onAddCombo, onToggleLeg, onSaveTicket }) {
  const [legCount, setLegCount] = useState(2)
  const [minGrade, setMinGrade] = useState('LEAN')
  const tdSlipLegs = useMemo(() => slipLegs.filter((leg) => isNFLTDMarket(leg.marketId)), [slipLegs])
  const clearTDSlip = () => tdSlipLegs.forEach((leg) => onToggleLeg(leg.key))
  return <WorkspaceShell embedded icon="Beaker" eyebrow="Decision workspace" title="TD Bet Lab" description="Build NFL touchdown parlays from Anytime TD, First TD and 2+ TD scorer markets only." tabs={TABS} activeTab={tab} onTabChange={onTabChange} status={tdSlipLegs.length ? `${tdSlipLegs.length} TD ${tdSlipLegs.length === 1 ? 'leg' : 'legs'} on slip` : 'TD slip empty'}>
    <div className="workspace-brief">
      <span><b>TD-only rule</b> Every leg is Anytime TD, First TD or 2+ TD. Yardage and reception props stay outside Bet Lab.</span>
      <span><b>Variance</b> First TD and 2+ TD carry greater uncertainty. All-hit remains the independent product with no unproven same-game uplift.</span>
    </div>
    {tab === 'explore' && <ComboExplorer snapshot={snapshot} slip={slip} onAddCombo={onAddCombo} scope="all" legCount={legCount} setLegCount={setLegCount} minGrade={minGrade} setMinGrade={setMinGrade} />}
    {tab === 'builder' && <CustomBuilder slipLegs={tdSlipLegs} onToggleLeg={onToggleLeg} onClearSlip={clearTDSlip} onSaveTicket={onSaveTicket} />}
    {tab === 'same-game' && <ComboExplorer snapshot={snapshot} slip={slip} onAddCombo={onAddCombo} scope="same-game" legCount={legCount} setLegCount={setLegCount} minGrade={minGrade} setMinGrade={setMinGrade} />}
  </WorkspaceShell>
}
