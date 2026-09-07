import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import WorkspaceShell from './WorkspaceShell.jsx'
import NFLGameRail from './NFLGameRail.jsx'
import { buildNFLComboBoard, NFL_COMBO_STRATEGIES, decimalOdds, americanOdds, calculateNFLJointTDProbability } from '../lib/nflCombos.js'
import { calculateQuarterKelly } from '../../../src/sports/nfl/logic/ScoringEngine.js'
import { isNFLTDMarket } from '../lib/nflTickets.js'

const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`
const price = (value) => value == null ? 'Price N/A' : value > 0 ? `+${value}` : String(value)
const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)', SKIP: 'var(--skip)' }
const TABS = [
  { id: 'explore', label: 'Explore combos', icon: 'Layers' },
  { id: 'builder', label: 'Custom builder', icon: 'Sparkles' },
  { id: 'same-game', label: 'Same game', icon: 'Zap' },
]

function ComboGrid({ stackBoards, slip, onAddCombo, onSaveTicket }) {
  return <div className="nfl-combo-grid nfl-stack-showcase">{stackBoards.map(({ stack, board, combo, unavailableReason }) => {
    if (!combo) return <article className="nfl-combo-card nfl-stack-unavailable" key={stack.id} style={{ '--nfl-combo-grade': 'var(--skip)' }}>
      <header><div><span className="nfl-combo-rank mono">#1</span><span className="nfl-combo-strategy">{stack.cardLabel || stack.label}</span><span className={`nfl-stack-risk is-${stack.riskTone || 'caution'}`}>{stack.risk}</span></div><span className="nfl-combo-grade">Unavailable</span></header>
      <div className="nfl-stack-unavailable-body"><Icon name="ShieldAlert" size={28} /><b>No valid {stack.label} build</b><span>{unavailableReason || board?.coverage?.limitations?.join(' · ') || `No ${stack.label} combo clears these controls.`}</span></div>
      <footer><button type="button" disabled><Icon name="Plus" size={14} />Add all legs</button></footer>
    </article>
    const isAdded = combo.legs.every((leg) => slip.has(leg.key))
    const color = GRADE_COLORS[combo.grade]
    const kellyUnits = (combo.americanOdds != null && combo.probability > 0)
      ? calculateQuarterKelly(combo.probability, combo.americanOdds)
      : null
    return <article className="nfl-combo-card" key={`${stack.id}:${combo.id}`} style={{ '--nfl-combo-grade': color }}>
      <header><div><span className="nfl-combo-rank mono">#1</span><span className="nfl-combo-strategy">{stack.cardLabel || stack.label}</span><span className={`nfl-stack-risk is-${stack.riskTone || 'caution'}`}>{stack.risk}</span>{combo.scope === 'same-game' && <span className="nfl-combo-sgp">Same game</span>}</div><span className="nfl-combo-grade" style={{ color }}>BUILD {combo.grade} · {combo.score}</span></header>
      <div className="nfl-stack-card-intro"><Icon name={stack.icon || 'Layers'} size={12} /><span><b>{stack.label}</b>{stack.description}</span><small>{board.calibration.ready ? `${board.calibration.samples} calibration samples` : 'Calibration collecting'}</small></div>
      <div className="nfl-combo-metrics"><span><small>{combo.probabilityMethod === 'stack-calibrated-joint' ? 'Calibrated joint' : 'Joint model'}</small><strong className="mono" style={{ color }}>{pct(combo.probability)}</strong></span><span><small>Parlay price</small><strong className="mono">{combo.americanOdds != null ? price(combo.americanOdds) : (combo.probability > 0 && americanOdds(1 / combo.probability) != null ? `Fair ${price(americanOdds(1 / combo.probability))}` : 'Price N/A')}</strong></span><span><small>{kellyUnits != null && kellyUnits > 0 ? 'Kelly size' : 'Evidence'}</small><strong className="mono">{kellyUnits != null && kellyUnits > 0 ? `${kellyUnits}u` : combo.evidenceConfidence}</strong></span></div>
      <ol className="nfl-combo-legs">{combo.legs.map((leg, legIndex) => <li key={leg.key}><span className="nfl-combo-ord mono">{legIndex + 1}</span><div><b>{leg.name}</b><small>{leg.team} vs {leg.opponent} · {leg.marketLabel}</small><span>{leg.model.signals?.slice(0, 2).map((signal) => <em key={signal.key}>{signal.text}</em>)}</span></div><aside><strong className="mono">{pct(leg.probability)}</strong><small className="mono">{legPriceDisplay(leg)}</small></aside></li>)}</ol>
      <p className="nfl-combo-why"><Icon name="Sparkles" size={13} />{combo.rationale}</p>
      <footer>
        <button type="button" className={isAdded ? 'active' : ''} onClick={() => onAddCombo(combo)}><Icon name={isAdded ? 'Check' : 'Plus'} size={14} />{isAdded ? 'Combo added' : `Add all ${combo.legs.length} legs`}</button>
        {onSaveTicket && (
          <button type="button" onClick={() => onSaveTicket(combo.legs)} title="Track this build directly in My Tickets"><Icon name="Bookmark" size={13} />Track ticket</button>
        )}
      </footer>
    </article>
  })}</div>
}

function legPriceDisplay(leg) {
  const fair = (leg.probability != null && leg.probability > 0) ? americanOdds(1 / leg.probability) : null
  return leg.odds != null ? price(leg.odds) : (fair != null ? `Fair ${price(fair)}` : 'No price')
}

function ComboExplorer({ snapshot, games, selectedGameKey, onSelectGame, slip, onAddCombo, onSaveTicket, scope, legCount, setLegCount, minGrade, setMinGrade }) {
  const selectedGame = useMemo(() => games.find((g) => g.id === selectedGameKey) || null, [games, selectedGameKey])
  const stackBoards = useMemo(() => {
    const globalExposure = { players: new Map(), playerCap: 1 }
    return NFL_COMBO_STRATEGIES.map((stack) => {
      if (!stack.scopes.includes(scope)) {
        return {
          stack,
          board: null,
          combo: null,
          unavailableReason: scope === 'same-game' ? 'This stack is cross-game only.' : 'This stack does not support the selected scope.',
        }
      }
      const board = buildNFLComboBoard(snapshot, {
        legs: legCount,
        strategy: stack.id,
        scope,
        minGrade,
        limit: 1,
        globalExposure,
        gameKey: selectedGameKey,
      })
      const combo = board.combos[0] || null
      if (combo) {
        for (const leg of combo.legs) {
          globalExposure.players.set(leg.playerId, (globalExposure.players.get(leg.playerId) || 0) + 1)
        }
      }
      const unavailableReason = !combo
        ? selectedGame
          ? `No valid ${stack.label} build in ${selectedGame.label}.`
          : null
        : null
      return { stack, board, combo, unavailableReason }
    })
  }, [legCount, minGrade, scope, snapshot, selectedGameKey, selectedGame])

  const availableCount = stackBoards.filter((entry) => entry.combo).length
  const calibratedCount = stackBoards.filter((entry) => entry.board?.calibration?.ready).length

  return <section className="nfl-combo-explorer" aria-label={scope === 'same-game' ? 'NFL same-game combinations' : 'NFL combination explorer'}>
    <div className="nfl-lab-controls" aria-label="NFL parlay controls">
      <fieldset><legend>Legs</legend><div className="nfl-lab-segment">{[2, 3, 4].map((count) => <button type="button" key={count} className={legCount === count ? 'active' : ''} aria-pressed={legCount === count} onClick={() => setLegCount(count)}>{count}</button>)}</div></fieldset>
      <label><span>Minimum grade</span><select value={minGrade} onChange={(event) => setMinGrade(event.target.value)}><option value="LEAN">Lean+</option><option value="STRONG">Strong+</option><option value="PRIME">Prime only</option></select></label>
      <div className="nfl-lab-scope"><span>Game scope</span><b><Icon name={scope === 'same-game' ? 'Zap' : 'LayoutGrid'} size={13} />{scope === 'same-game' ? (selectedGame ? selectedGame.label : 'Same Game') : 'Across slate'}</b></div>
    </div>

    <NFLGameRail
      games={games}
      selectedGameIds={selectedGameKey ? new Set([selectedGameKey]) : new Set()}
      onSelectGame={(id) => onSelectGame?.(id === selectedGameKey ? null : id)}
      onClear={() => onSelectGame?.(null)}
    />

    <div className="nfl-lab-summary">
      <span>
        <Icon name={scope === 'same-game' ? 'Zap' : 'LayoutGrid'} size={14} />
        <b>{selectedGame ? `${selectedGame.label} Stacks` : 'Best of every stack'}</b> · {selectedGame ? `Touchdown combinations for ${selectedGame.label}` : 'One top-ranked TD combination from each named strategy'}
        <em>Change 2 / 3 / 4 legs or select a matchup to rebuild stacks.</em>
      </span>
      <small>{availableCount} of {NFL_COMBO_STRATEGIES.length} stacks available · {calibratedCount} calibrated</small>
    </div>
    <ComboGrid stackBoards={stackBoards} slip={slip} onAddCombo={onAddCombo} onSaveTicket={onSaveTicket} />
  </section>
}

function CustomBuilder({ slipLegs, onToggleLeg, onClearSlip, onSaveTicket }) {
  const jointCalc = useMemo(() => calculateNFLJointTDProbability(slipLegs), [slipLegs])
  const allHit = jointCalc.probability
  const fairDecimal = (allHit != null && allHit > 0) ? 1 / allHit : null
  const fairAmerican = fairDecimal != null ? americanOdds(fairDecimal) : null

  const decimalPrices = slipLegs.map((leg) => decimalOdds(leg.odds))
  const allPriced = slipLegs.length > 0 && decimalPrices.every(Number.isFinite)
  const combinedDecimal = allPriced ? decimalPrices.reduce((product, price) => product * price, 1) : null
  const combinedAmerican = combinedDecimal ? americanOdds(combinedDecimal) : null
  const impliedProb = combinedDecimal ? 1 / combinedDecimal : null
  const combinedEdge = (allHit != null && impliedProb != null && jointCalc.isValid) ? allHit - impliedProb : null
  const parlayUnits = (combinedEdge != null && combinedEdge > 0 && combinedAmerican != null)
    ? calculateQuarterKelly(allHit, combinedAmerican)
    : null

  return <section className="nfl-custom-builder" aria-labelledby="nfl-custom-builder-title">
    <header><div><span className="nfl-eyebrow"><Icon name="Sparkles" size={13} /> Touchdown decision</span><h3 id="nfl-custom-builder-title">Custom TD slip</h3><p>Add Anytime TD, First TD or 2+ TD legs from Signals or a model-built parlay.</p></div><span className="nfl-ticket-count">{slipLegs.length} leg{slipLegs.length === 1 ? '' : 's'}</span></header>
    <div className="nfl-builder-metrics">
      <span>
        <small>All-hit model</small>
        <b className="mono">{jointCalc.isValid ? pct(allHit) : '—'}</b>
        {slipLegs.length > 1 && jointCalc.correlationLabel && (
          <span className={`nfl-correlation-badge is-${jointCalc.correlationType}`}>
            {jointCalc.correlationLabel}
          </span>
        )}
      </span>
      <span><small>Combined price</small><b className="mono">{combinedAmerican != null ? price(combinedAmerican) : (fairAmerican != null ? `Fair ${price(fairAmerican)}` : allPriced ? 'Pricing' : 'Missing prices')}</b></span>
      <span><small>Payout multiplier</small><b className="mono">{combinedDecimal != null ? `${combinedDecimal.toFixed(2)}x` : (fairDecimal != null ? `Fair ${fairDecimal.toFixed(2)}x` : '—')}</b></span>
      <span><small>Model edge</small><b className={`mono ${combinedEdge == null ? (allHit != null ? 'neutral' : '') : combinedEdge >= 0 ? 'positive' : 'negative'}`}>{combinedEdge != null ? `${combinedEdge >= 0 ? '+' : ''}${pct(combinedEdge)}` : (allHit != null && jointCalc.isValid ? 'Fair baseline' : '—')}</b></span>
      {parlayUnits != null && (
        <span><small>Suggested size</small><b className="mono text-prime">{parlayUnits}u</b></span>
      )}
    </div>
    {!jointCalc.isValid && jointCalc.conflictReason && (
      <div className="nfl-combo-conflict">
        <Icon name="TriangleAlert" size={13} />
        <span>{jointCalc.conflictReason}</span>
      </div>
    )}
    {slipLegs.length ? <><ol className="nfl-builder-legs">{slipLegs.map((leg, index) => {
      const legFair = (leg.probability != null && leg.probability > 0) ? americanOdds(1 / leg.probability) : null
      const legPriceDisplay = leg.odds != null ? price(leg.odds) : (legFair != null ? `Fair ${price(legFair)}` : 'No price')
      return <li key={leg.key}><span className="nfl-combo-ord mono">{index + 1}</span><div><b>{leg.name}</b><small>{leg.team && leg.opponent ? `${leg.team} vs ${leg.opponent} · ` : ''}{leg.marketLabel}</small></div><aside><strong className="mono">{pct(leg.probability)}</strong><small className="mono">{legPriceDisplay}</small></aside><button type="button" onClick={() => onToggleLeg(leg.key)} aria-label={`Remove ${leg.name} from slip`}><Icon name="X" size={14} /></button></li>
    })}</ol>{slipLegs.length === 1 && <p className="nfl-combo-why"><Icon name="Info" size={13} />Add one more touchdown leg to create a parlay.</p>}</> : <div className="nfl-ticket-empty"><Icon name="Plus" size={18} /><b>Your TD slip is empty</b><span>Add a touchdown parlay here or choose an individual TD prop from Signals.</span></div>}
    <footer><button type="button" onClick={onClearSlip} disabled={!slipLegs.length}>Clear</button><button type="button" className="primary" onClick={() => onSaveTicket(slipLegs)} disabled={slipLegs.length < 2 || !jointCalc.isValid}><Icon name="Bookmark" size={14} />Track TD parlay</button></footer>
  </section>
}

export default function NFLBetLab({ snapshot, slip, slipLegs, tab, onTabChange, onAddCombo, onToggleLeg, onSaveTicket }) {
  const [legCount, setLegCount] = useState(2)
  const [minGrade, setMinGrade] = useState('LEAN')
  const [selectedGameKey, setSelectedGameKey] = useState(null)

  const games = useMemo(() => {
    const matchups = new Map()
    for (const player of snapshot?.players || []) {
      const key = String(player.gameId || player.gamePk || [player.team, player.opponent].filter(Boolean).sort().join('-'))
      if (!key || matchups.has(key)) continue
      const awayTeam = player.isHome ? player.opponent : player.team
      const homeTeam = player.isHome ? player.team : player.opponent
      const label = `${awayTeam} @ ${homeTeam}`
      matchups.set(key, {
        id: key,
        label,
        awayTeam,
        homeTeam,
        kickoff: player.kickoff || '',
        isLive: Boolean(player.live?.isLive),
        isFinal: Boolean(player.live?.isFinal),
      })
    }
    return [...matchups.values()]
  }, [snapshot])

  const tdSlipLegs = useMemo(() => slipLegs.filter((leg) => isNFLTDMarket(leg.marketId)), [slipLegs])
  const clearTDSlip = () => tdSlipLegs.forEach((leg) => onToggleLeg(leg.key))

  return <WorkspaceShell embedded icon="Beaker" eyebrow="Decision workspace" title="TD Bet Lab" description="Build NFL touchdown parlays from Anytime TD, First TD and 2+ TD scorer markets only." tabs={TABS} activeTab={tab} onTabChange={onTabChange} status={tdSlipLegs.length ? `${tdSlipLegs.length} TD ${tdSlipLegs.length === 1 ? 'leg' : 'legs'} on slip` : 'TD slip empty'}>
    <div className="workspace-brief">
      <span><b>TD-only rule</b> Every leg is Anytime TD, First TD or 2+ TD. Yardage and reception props stay outside Bet Lab.</span>
      <span><b>Variance & Correlation</b> Same-game touchdown correlation accounts for team TD budgets and cross-team shootout synergy. First TD scorers in the same game are mutually exclusive.</span>
    </div>
    {tab === 'explore' && <ComboExplorer snapshot={snapshot} games={games} selectedGameKey={selectedGameKey} onSelectGame={setSelectedGameKey} slip={slip} onAddCombo={onAddCombo} onSaveTicket={onSaveTicket} scope="all" legCount={legCount} setLegCount={setLegCount} minGrade={minGrade} setMinGrade={setMinGrade} />}
    {tab === 'builder' && <CustomBuilder slipLegs={tdSlipLegs} onToggleLeg={onToggleLeg} onClearSlip={clearTDSlip} onSaveTicket={onSaveTicket} />}
    {tab === 'same-game' && <ComboExplorer snapshot={snapshot} games={games} selectedGameKey={selectedGameKey} onSelectGame={setSelectedGameKey} slip={slip} onAddCombo={onAddCombo} onSaveTicket={onSaveTicket} scope="same-game" legCount={legCount} setLegCount={setLegCount} minGrade={minGrade} setMinGrade={setMinGrade} />}
  </WorkspaceShell>
}

