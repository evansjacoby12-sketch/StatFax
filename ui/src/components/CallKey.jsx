import Icon from './Icon.jsx'

const GROUPS = [
  {
    title: 'Game markets',
    items: [
      {
        tier: 'PLAY',
        icon: 'CircleCheck',
        tone: 'actionable',
        description: 'Best actionable edge — every decision gate cleared.',
      },
      {
        tier: 'LEAN',
        icon: 'TrendingUp',
        tone: 'lean',
        description: 'Usable model edge — short of every PLAY gate.',
      },
      {
        tier: 'PASS',
        icon: 'Minus',
        tone: 'diagnostic',
        description: 'Direction only — not recommended as a bet.',
      },
    ],
  },
  {
    title: 'First inning',
    items: [
      {
        tier: 'STRONG',
        icon: 'Shield',
        tone: 'actionable',
        description: 'Fully qualified NRFI/YRFI setup.',
      },
      {
        tier: 'LEAN',
        icon: 'TrendingUp',
        tone: 'lean',
        description: 'Qualified direction with smaller separation.',
      },
      {
        tier: 'WATCH',
        icon: 'Eye',
        tone: 'diagnostic',
        description: 'Diagnostic matchup — not actionable yet.',
      },
    ],
  },
]

function TierItem({ item }) {
  return (
    <div className="call-key-item">
      <span className={`call-key-tier is-${item.tone}`}>
        <Icon name={item.icon} size={11} />
        {item.tier}
      </span>
      <span>{item.description}</span>
    </div>
  )
}

export default function CallKey({ className = '' }) {
  return (
    <details className={`call-key ${className}`.trim()} aria-label="Model call key">
      <summary className="call-key-intro">
        <Icon name="Info" size={16} />
        <span>
          <b>Call key</b>
          <small>What PLAY, LEAN, PASS, STRONG and WATCH mean</small>
        </span>
        <Icon className="call-key-chevron" name="ChevronDown" size={15} />
      </summary>
      <div className="call-key-body">
        {GROUPS.map((group) => (
          <section className="call-key-group" key={group.title}>
            <h3>{group.title}</h3>
            <div className="call-key-list">
              {group.items.map((item) => (
                <TierItem key={`${group.title}-${item.tier}`} item={item} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </details>
  )
}
