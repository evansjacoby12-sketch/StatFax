import { useState } from 'react'
import WorkspaceShell from './WorkspaceShell.jsx'
import CheatSheet from './CheatSheet.jsx'
import ListBuilderView from './ListBuilderView.jsx'

const TABS = [
  { id: 'cheat-sheet', label: 'Cheat sheet', icon: 'Rows3' },
  { id: 'list-builder', label: 'List builder', icon: 'ClipboardList' },
]

export default function FindPlays({
  initialTab = 'cheat-sheet', onClose, batters, slateDate, onSelect, onOpenPitcher,
  watchlist, slip, onToggleWatch, onToggleSlip,
}) {
  const [tab, setTab] = useState(initialTab === 'weather' ? 'cheat-sheet' : initialTab)
  return (
    <WorkspaceShell
      icon="ScanSearch"
      eyebrow="Discovery workspace"
      title="Find Plays"
      description="Move from ranked profiles to a focused candidate list while keeping the evidence visible."
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      onClose={onClose}
      status={`${batters.length} slate hitters`}
    >
      <div className="workspace-brief compact">
        <span><b>Start broad</b> Cheat Sheet finds profiles; List Builder tests a specific, evidence-backed recipe.</span>
      </div>
      {tab === 'cheat-sheet' && <CheatSheet batters={batters} onSelect={onSelect} onOpenPitcher={onOpenPitcher} />}
      {tab === 'list-builder' && (
        <ListBuilderView
          batters={batters}
          slateDate={slateDate}
          onSelect={onSelect}
          watchlist={watchlist}
          slip={slip}
          onToggleWatch={onToggleWatch}
          onToggleSlip={onToggleSlip}
        />
      )}
    </WorkspaceShell>
  )
}
