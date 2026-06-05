import { useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { computeParlay, parlayGrade } from '../lib/parlay.js'
import { hrSetup, scoutVerdict } from '../lib/scout.js'
import { interpretWind } from '../lib/wind.js'
import { pct, num, american, signedPct } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'

const GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }
const lastName = (n) => (n || '').trim().split(/\s+/).slice(-1)[0]

// Per-leg "why" — the bettable factors that fed the grade. Each chip is
// { icon, text, tone } where tone tints it good/bad. Mirrors the signals the
// model actually weighs (recent form, pitcher, wind, park × weather, setup).
function legFactors(b) {
  const out = []
  if (b.heatIndex != null) {
    out.push({ icon: 'Flame', text: `Heat ${b.heatIndex}`, tone: b.heatIndex >= 58 ? 'good' : b.heatIndex < 40 ? 'bad' : '' })
  }
  if (b.pitcher?.name) {
    const era = b.pitcher.season?.era
    const hr9 = b.pitcher.season?.hrPer9
    out.push({
      icon: 'Shield',
      text: `vs ${lastName(b.pitcher.name)}${era != null ? ` ${num(era, 2)}` : ''}`,
      tone: hr9 != null ? (hr9 >= 1.3 ? 'good' : hr9 <= 0.9 ? 'bad' : '') : '',
    })
  }
  const wind = interpretWind(b.weather, b.game?.homeTeam?.abbr, { roofClosed: b.weather?.roofClosed })
  if (wind && wind.verdict !== 'CROSS') {
    out.push({ icon: 'Wind', text: wind.caption, tone: wind.verdict === 'OUT' ? 'good' : 'bad' })
  }
  const air = b.parkWeatherHandFactor
  if (air != null && Math.abs(air - 1) >= 0.02) {
    out.push({ icon: 'Gauge', text: `${signedPct(air - 1, 0)} air`, tone: air >= 1.05 ? 'good' : air <= 0.95 ? 'bad' : '' })
  }
  const setup = hrSetup(b).n
  out.push({ icon: 'Crosshair', text: `setup ${setup}/6`, tone: setup >= 5 ? 'good' : setup >= 3 ? '' : 'bad' })
  return out
}

export default function ParlaySlip({ legs, onRemove, onClear, onSelect }) {
  const [open, setOpen] = useState(false)
  if (!legs.length) return null
  const p = computeParlay(legs)
  const pg = parlayGrade(legs)
  const gColor = pg ? GRADE_COLOR[pg.letter] : null

  return (
    <div className={`slip ${open ? 'open' : ''}`}>
      {open && (
        <div className="slip-panel">
          <div className="slip-panel-head">
            <span className="slip-panel-title">
              <Icon name="Layers" size={14} /> Parlay · {p.n} {p.n === 1 ? 'leg' : 'legs'}
            </span>
            {pg && (
              <span className="slip-grade" style={{ color: gColor, borderColor: gColor }} title={`Avg leg score ${Math.round(pg.avgScore)}`}>
                {pg.letter}
              </span>
            )}
            <button className="slip-clear" onClick={onClear}>
              Clear all
            </button>
          </div>
          <div className="slip-legs">
            {legs.map((b) => (
              <div className="slip-leg" key={b.id}>
                <div className="slip-leg-top">
                  <button className="slip-leg-main" onClick={() => onSelect(b)} title="Open detail">
                    <span className="slip-leg-grade" style={{ background: gradeColor(b.grade?.label) }} />
                    <span className="slip-leg-name">{b.name}</span>
                    <span className="slip-leg-team">{b.team}</span>
                  </button>
                  <GradeChip grade={b.grade} size="sm" score={b.score} />
                  <span className="slip-leg-prob mono">{pct(b.hrProbability, 1)}</span>
                  <span className="slip-leg-odds mono">{b.odds?.best ? american(b.odds.best.american) : '—'}</span>
                  <button className="slip-leg-remove" onClick={() => onRemove(b.id)} aria-label={`Remove ${b.name}`}>
                    <Icon name="X" size={13} />
                  </button>
                </div>
                <div className="slip-leg-scout dim">{scoutVerdict(b)}</div>
                <div className="slip-leg-factors">
                  {legFactors(b).map((f, i) => (
                    <span className={`slip-fchip ${f.tone}`} key={i}>
                      <Icon name={f.icon} size={10} />
                      {f.text}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="slip-bar" onClick={() => setOpen((o) => !o)}>
        <span className="slip-bar-left">
          <span className="slip-count">{p.n}</span>
          <span className="slip-bar-label">Parlay</span>
          {pg && (
            <span className="slip-bar-grade" style={{ color: gColor, borderColor: gColor }}>
              {pg.letter}
            </span>
          )}
        </span>
        <span className="slip-bar-stats">
          <span className="slip-stat">
            <span className="slip-stat-k">Model</span>
            <span className="slip-stat-v mono">{pct(p.modelProb, p.modelProb < 0.01 ? 2 : 1)}</span>
          </span>
          <span className="slip-stat">
            <span className="slip-stat-k">{p.allPriced ? 'Odds' : 'Fair'}</span>
            <span className="slip-stat-v mono">{p.allPriced ? american(p.american) : american(p.fairAmerican)}</span>
          </span>
          {p.edge != null && (
            <span className="slip-stat">
              <span className="slip-stat-k">Edge</span>
              <span className={`slip-stat-v mono ${p.edge >= 0 ? 'pos' : 'neg'}`}>{signedPct(p.edge, 0)}</span>
            </span>
          )}
          {!p.allPriced && p.n > 0 && <span className="slip-stat slip-unpriced">{p.priced}/{p.n} priced</span>}
        </span>
        <Icon name={open ? 'ChevronDown' : 'ChevronUp'} size={16} />
      </button>
    </div>
  )
}
