import { useState } from 'react'
import WorkspaceShell from './WorkspaceShell.jsx'
import HowToPick from './HowToPick.jsx'
import Guide from './Guide.jsx'
import Legend from './Legend.jsx'

const TABS = [
  { id: 'playbook', label: 'Playbook', icon: 'Focus' },
  { id: 'guide', label: 'Guide', icon: 'BookOpen' },
  { id: 'glossary', label: 'Glossary', icon: 'Search' },
]

export default function LearnCenter({ initialTab = 'playbook', onClose }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <WorkspaceShell
      icon="GraduationCap"
      eyebrow="Reference workspace"
      title="Learn Center"
      description="A practical playbook, product guide, and plain-language definition library in one place."
      tabs={TABS}
      activeTab={tab}
      onTabChange={setTab}
      onClose={onClose}
      size="reading"
      status={null}
    >
      {tab === 'playbook' && <HowToPick embedded />}
      {tab === 'guide' && <Guide embedded />}
      {tab === 'glossary' && <Legend embedded />}
    </WorkspaceShell>
  )
}
