import { useState } from 'react'
import WorkspaceShell from './WorkspaceShell.jsx'
import GroupsView from './GroupsView.jsx'
import FirstInningZone from './FirstInningZone.jsx'
import SameGameView from './SameGameView.jsx'
import TopStraightsView from './TopStraightsView.jsx'

const TABS = [
  { id: 'explore', label: 'Explore combos', icon: 'GitMerge' },
  { id: 'straights', label: 'Top 10 straights', icon: 'ListOrdered' },
  { id: 'first-inning', label: 'NRFI / YRFI zone', icon: 'TimerReset' },
  { id: 'same-game', label: 'Same game', icon: 'MapPinHouse' },
]

export default function BetLab({
  initialTab = 'explore',
  onClose,
  batters,
  selectedId,
  onSelect,
  scorecard,
  resiliencePolicy = null,
  generatedAt,
  windowMode,
  comboConf,
  favorConsistency,
  lockedBoard,
  slipSet,
  onToggleSlip,
  comboLock,
  legs,
  sgpScorecard,
  games = [],
  gameProjections = {},
  gameProjectionEvaluation = null,
  firstInningHistoricalValidation = null,
}) {
  const [tab, setTab] = useState(initialTab === 'builder' ? 'first-inning' : initialTab)
  const firstInningCount = Object.values(gameProjections)
    .filter((projection) => projection?.firstInning).length

  return (
    <WorkspaceShell
      icon="Beaker"
      eyebrow="Decision workspace"
      title="Bet Lab"
      description="Explore model-built combinations, rank first-inning outcomes, or isolate one game—without hiding the probability tradeoffs."
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      onClose={onClose}
      status={tab === 'first-inning'
        ? `${firstInningCount} first-inning matchups`
        : legs.length
          ? `${legs.length} ${legs.length === 1 ? 'leg' : 'legs'} on slip`
          : 'Slip empty'}
    >
      {tab === 'first-inning' ? (
        <div className="workspace-brief">
          <span><b>Decision rule</b> Rank NRFI and YRFI by modeled probability, input coverage, and decision separation.</span>
          <span><b>Pricing</b> These are directional model leans. No value or EV claim is made without a sportsbook price.</span>
        </div>
      ) : tab !== 'straights' && (
        <div className="workspace-brief">
          <span><b>Decision rule</b> Build from confirmed, individually defensible legs. More legs increase payout—not reliability.</span>
          <span><b>Probability</b> All-hit is the independent product; StatFax applies no unproven same-game uplift.</span>
        </div>
      )}

      {tab === 'explore' && (
        <GroupsView
          batters={batters}
          onSelect={onSelect}
          selectedId={selectedId}
          scorecard={scorecard}
          resiliencePolicy={resiliencePolicy}
          generatedAt={generatedAt}
          windowMode={windowMode}
          comboConf={comboConf}
          favorConsistency={favorConsistency}
          lockedBoard={lockedBoard}
          slipSet={slipSet}
          onToggleSlip={onToggleSlip}
          comboLock={comboLock}
        />
      )}
      {tab === 'straights' && (
        <TopStraightsView
          batters={batters}
          onSelect={onSelect}
          slipSet={slipSet}
          onToggleSlip={onToggleSlip}
        />
      )}
      {tab === 'first-inning' && (
        <FirstInningZone
          games={games}
          gameProjections={gameProjections}
          gameProjectionEvaluation={gameProjectionEvaluation}
          historicalValidation={firstInningHistoricalValidation}
        />
      )}
      {tab === 'same-game' && (
        <SameGameView
          batters={batters}
          onSelect={onSelect}
          favorConsistency={favorConsistency}
          comboConf={comboConf}
          sgpScorecard={sgpScorecard}
        />
      )}
    </WorkspaceShell>
  )
}
