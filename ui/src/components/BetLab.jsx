import { useState } from 'react'
import WorkspaceShell from './WorkspaceShell.jsx'
import GroupsView from './GroupsView.jsx'
import ParlayBuilder from './ParlayBuilder.jsx'
import SameGameView from './SameGameView.jsx'
import TopStraightsView from './TopStraightsView.jsx'

const TABS = [
  { id: 'explore', label: 'Explore combos', icon: 'Layers' },
  { id: 'straights', label: 'Top 10 straights', icon: 'ListOrdered' },
  { id: 'builder', label: 'Custom builder', icon: 'Sparkles' },
  { id: 'same-game', label: 'Same game', icon: 'Zap' },
  { id: 'saved', label: 'Saved', icon: 'Bookmark' },
]

export default function BetLab({ initialTab = 'explore', onClose, batters, selectedId, onSelect, scorecard, generatedAt, windowMode, comboConf, favorConsistency, lockedBoard, slipSet, onToggleSlip, comboLock, legs, onRemove, onClear, onReplace, sgpScorecard }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <WorkspaceShell
      icon="Beaker"
      eyebrow="Decision workspace"
      title="Bet Lab"
      description="Explore model-built combinations, construct a slip, or isolate one game—without hiding the probability tradeoffs."
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      onClose={onClose}
      status={legs.length ? `${legs.length} ${legs.length === 1 ? 'leg' : 'legs'} on slip` : 'Slip empty'}
    >
      {tab !== 'straights' && <div className="workspace-brief">
        <span><b>Decision rule</b> Build from confirmed, individually defensible legs. More legs increase payout—not reliability.</span>
        <span><b>Probability</b> All-hit is the independent product; StatFax applies no unproven same-game uplift.</span>
      </div>}
      {tab === 'explore' && <GroupsView batters={batters} onSelect={onSelect} selectedId={selectedId} scorecard={scorecard} generatedAt={generatedAt} windowMode={windowMode} comboConf={comboConf} favorConsistency={favorConsistency} lockedBoard={lockedBoard} slipSet={slipSet} onToggleSlip={onToggleSlip} comboLock={comboLock} />}
      {tab === 'straights' && <TopStraightsView batters={batters} onSelect={onSelect} slipSet={slipSet} onToggleSlip={onToggleSlip} />}
      {(tab === 'builder' || tab === 'saved') && <ParlayBuilder batters={batters} legs={legs} slipSet={slipSet} onToggle={onToggleSlip} onRemove={onRemove} onClear={onClear} onReplace={onReplace} onSelect={onSelect} onClose={onClose} favorConsistency={favorConsistency} scorecard={scorecard} initialTab={tab === 'saved' ? 'saved' : 'legs'} />}
      {tab === 'same-game' && <SameGameView batters={batters} onSelect={onSelect} favorConsistency={favorConsistency} comboConf={comboConf} sgpScorecard={sgpScorecard} />}
    </WorkspaceShell>
  )
}
