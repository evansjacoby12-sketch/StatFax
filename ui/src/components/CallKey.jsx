import Icon from './Icon.jsx'
import { FIRST_INNING_CALLS, GAME_CALLS } from '../lib/explanationCatalog.js'

const GROUPS = [
  {
    title: 'Game markets',
    scope: 'Moneyline and over/under only',
    items: GAME_CALLS,
  },
  {
    title: 'First inning',
    scope: 'NRFI and YRFI only',
    items: FIRST_INNING_CALLS,
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
            <p className="call-key-scope">{group.scope}</p>
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
