import Icon from './Icon.jsx'
import { sportUi } from '../lib/sportUi.js'

export default function SportMobileDock({ sport, value, onChange, tabs = null, className = '' }) {
  const items = tabs || sportUi(sport).mobileViews
  const activeIndex = items.findIndex((item) => item.id === value)
  return <nav
    className={`bottom-nav ${sport}-bottom-nav ${className}`.trim()}
    aria-label={`${sportUi(sport).label} primary navigation`}
    data-has-active={activeIndex >= 0}
    style={{ '--bottom-nav-index': Math.max(0, activeIndex), '--bottom-nav-count': items.length }}
  >
    <span className="bottom-nav-indicator" aria-hidden="true" />
    {items.map((item) => <button
      key={item.id}
      type="button"
      className={`bottom-nav-btn ${value === item.id ? 'active' : ''}`}
      onClick={() => onChange(item.id)}
      aria-current={value === item.id ? 'page' : undefined}
      aria-label={item.label}
    >
      <Icon name={item.icon} size={20} />
      <span className="bottom-nav-label">{item.label}</span>
    </button>)}
  </nav>
}
