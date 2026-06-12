import Icon from './Icon.jsx'

// Mobile bottom tab bar — the v2 primary navigation, replacing the cramped
// top view pills. Fixed to the bottom with safe-area padding so it clears the
// home indicator.
const TABS = [
  { key: 'board', label: 'Board', icon: 'List' },
  { key: 'games', label: 'Games', icon: 'LayoutGrid' },
  { key: 'pitchers', label: 'Arms', icon: 'Target' },
  { key: 'weather', label: 'Weather', icon: 'Wind' },
  { key: 'results', label: 'Model', icon: 'Activity' },
]

export default function BottomNav({ view, onView }) {
  return (
    <nav className="v2nav" role="tablist" aria-label="Primary">
      {TABS.map((t) => {
        const on = view === t.key
        return (
          <button
            key={t.key}
            className={`v2nav-tab ${on ? 'on' : ''}`}
            role="tab"
            aria-selected={on}
            aria-label={t.label}
            onClick={() => onView(t.key)}
          >
            <Icon name={t.icon} size={20} />
            <span className="v2nav-lbl">{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
