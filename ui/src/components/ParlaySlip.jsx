import { useState } from 'react'
import Icon from './Icon.jsx'
import { computeParlay } from '../lib/parlay.js'
import { pct, american, signedPct } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'

export default function ParlaySlip({ legs, onRemove, onClear, onSelect }) {
  const [open, setOpen] = useState(false)
  if (!legs.length) return null
  const p = computeParlay(legs)

  return (
    <div className={`slip ${open ? 'open' : ''}`}>
      {open && (
        <div className="slip-panel">
          <div className="slip-panel-head">
            <span className="slip-panel-title">
              <Icon name="Layers" size={14} /> Parlay · {p.n} {p.n === 1 ? 'leg' : 'legs'}
            </span>
            <button className="slip-clear" onClick={onClear}>
              Clear all
            </button>
          </div>
          <div className="slip-legs">
            {legs.map((b) => (
              <div className="slip-leg" key={b.id}>
                <button className="slip-leg-main" onClick={() => onSelect(b)} title="Open detail">
                  <span
                    className="slip-leg-grade"
                    style={{ background: b.grade?.color || gradeColor(b.grade?.label) }}
                  />
                  <span className="slip-leg-name">{b.name}</span>
                  <span className="slip-leg-team">{b.team}</span>
                </button>
                <span className="slip-leg-prob mono">{pct(b.hrProbability, 1)}</span>
                <span className="slip-leg-odds mono">
                  {b.odds?.best ? american(b.odds.best.american) : '—'}
                </span>
                <button
                  className="slip-leg-remove"
                  onClick={() => onRemove(b.id)}
                  aria-label={`Remove ${b.name}`}
                >
                  <Icon name="X" size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="slip-bar" onClick={() => setOpen((o) => !o)}>
        <span className="slip-bar-left">
          <span className="slip-count">{p.n}</span>
          <span className="slip-bar-label">Parlay</span>
        </span>
        <span className="slip-bar-stats">
          <span className="slip-stat">
            <span className="slip-stat-k">Model</span>
            <span className="slip-stat-v mono">{pct(p.modelProb, p.modelProb < 0.01 ? 2 : 1)}</span>
          </span>
          <span className="slip-stat">
            <span className="slip-stat-k">{p.allPriced ? 'Odds' : 'Fair'}</span>
            <span className="slip-stat-v mono">
              {p.allPriced ? american(p.american) : american(p.fairAmerican)}
            </span>
          </span>
          {p.edge != null && (
            <span className="slip-stat">
              <span className="slip-stat-k">Edge</span>
              <span className={`slip-stat-v mono ${p.edge >= 0 ? 'pos' : 'neg'}`}>
                {signedPct(p.edge, 0)}
              </span>
            </span>
          )}
          {!p.allPriced && p.n > 0 && (
            <span className="slip-stat slip-unpriced">{p.priced}/{p.n} priced</span>
          )}
        </span>
        <Icon name={open ? 'ChevronDown' : 'ChevronUp'} size={16} />
      </button>
    </div>
  )
}
