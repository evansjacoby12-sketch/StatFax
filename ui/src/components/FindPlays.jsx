import { useState } from 'react'
import WorkspaceShell from './WorkspaceShell.jsx'
import WeatherView from './WeatherView.jsx'
import CheatSheet from './CheatSheet.jsx'
import ListBuilderView from './ListBuilderView.jsx'

const TABS = [
  { id: 'weather', label: 'Weather', icon: 'CloudSun' },
  { id: 'cheat-sheet', label: 'Cheat sheet', icon: 'Rows3' },
  { id: 'list-builder', label: 'List builder', icon: 'ClipboardList' },
]

export default function FindPlays({
  initialTab = 'weather', onClose, batters, slateDate, selectedId, onSelect, onOpenPitcher,
  watchlist, slip, onToggleWatch, onToggleSlip, onUseParlay,
}) {
  const [tab, setTab] = useState(initialTab)
  return (
    <WorkspaceShell
      icon="ScanSearch"
      eyebrow="Discovery workspace"
      title="Find Plays"
      description="Move from slate conditions to a focused candidate list while keeping the evidence visible."
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      onClose={onClose}
      status={`${batters.length} slate hitters`}
    >
      <div className="workspace-brief compact">
        <span><b>Start broad</b> Weather finds games, Cheat Sheet finds profiles, and List Builder tests your own criteria.</span>
      </div>
      {tab === 'weather' && <WeatherView batters={batters} onSelect={onSelect} selectedId={selectedId} />}
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
          onUseParlay={onUseParlay}
        />
      )}
    </WorkspaceShell>
  )
}
