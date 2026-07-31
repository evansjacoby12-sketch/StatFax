import { useState } from 'react'
import WorkspaceShell from './WorkspaceShell.jsx'
import HowToPick from './HowToPick.jsx'
import Guide from './Guide.jsx'
import Legend from './Legend.jsx'

const TABS = [
  { id: 'playbook', label: 'Start here', icon: 'Focus' },
  { id: 'guide', label: 'Keys', icon: 'BookOpen' },
  { id: 'glossary', label: 'Glossary', icon: 'Search' },
]

export default function LearnCenter({ initialTab = 'playbook', onClose }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <WorkspaceShell
      icon="GraduationCap"
      eyebrow="Reference workspace"
      title="Learn Center"
      description="How to use the MLB engine and what every grade, call, badge, and data state means."
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
