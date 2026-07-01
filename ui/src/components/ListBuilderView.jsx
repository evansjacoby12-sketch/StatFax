import { useState, useMemo } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct, num } from '../lib/format.js'
import { pitchMixScore, hrSetup } from '../lib/scout.js'
import { positiveReasonCount, negativeReasonCount } from '../lib/combo-engine.js'
import { lastFirst } from '../lib/groups.js'

// ─── criteria definitions ────────────────────────────────────────────────────

const CATS = [
  { id: 'all',      label: 'All' },
  { id: 'model',    label: 'Model' },
  { id: 'matchup',  label: 'Matchup' },
  { id: 'statcast', label: 'Statcast' },
  { id: 'form',     label: 'Form' },
  { id: 'signals',  label: 'Signals' },
]

const NUM_CRIT = [
  { key: 'score',     label: 'Model Score',    cat: 'model',    get: b => b.score,                          min: 0,   max: 100, step: 5,   def: 60,  disp: v => `≥${v}` },
  { key: 'heat',      label: 'Heat Index',     cat: 'model',    get: b => b.heatIndex,                      min: 0,   max: 100, step: 5,   def: 50,  disp: v => `≥${v}` },
  { key: 'hrProb',    label: 'HR Prob',        cat: 'model',    get: b => (b.hrProbability ?? 0) * 100,     min: 5,   max: 40,  step: 1,   def: 15,  disp: v => `≥${v}%` },
  { key: 'pitcherH9', label: 'Opp HR/9',       cat: 'matchup',  get: b => b.pitcher?.season?.hrPer9,       min: 0.5, max: 3.0, step: 0.1, def: 1.3, disp: v => `≥${v.toFixed(1)}` },
  { key: 'parkFact',  label: 'Park Factor',    cat: 'matchup',  get: b => b.gameParkHRFactor,              min: 0.8, max: 1.5, step: 0.05,def: 1.0, disp: v => `≥${v.toFixed(2)}×` },
  { key: 'pitchMix',  label: 'Pitch Mix',      cat: 'matchup',  get: b => pitchMixScore(b),                min: 0,   max: 10,  step: 0.5, def: 6.0, disp: v => `≥${v}/10` },
  { key: 'exitVelo',  label: 'Exit Velo',      cat: 'statcast', get: b => b.exitVelo,                      min: 85,  max: 100, step: 0.5, def: 90,  disp: v => `≥${v}mph` },
  { key: 'barrel',    label: 'Barrel%',        cat: 'statcast', get: b => b.barrelPctBBE ?? b.barrelPct,   min: 0,   max: 25,  step: 1,   def: 8,   disp: v => `≥${v}%` },
  { key: 'hardHit',   label: 'Hard Hit%',      cat: 'statcast', get: b => b.hardHitPct,                    min: 30,  max: 70,  step: 2.5, def: 40,  disp: v => `≥${v}%` },
  { key: 'launchAng', label: 'Launch Angle',   cat: 'statcast', get: b => b.launchAngle,                   min: 0,   max: 35,  step: 1,   def: 10,  disp: v => `≥${v}°` },
  { key: 'recBarrel', label: 'Recent Barrel',  cat: 'form',     get: b => b.recentBarrel?.recentBarrelPct, min: 0,   max: 30,  step: 1,   def: 10,  disp: v => `≥${v}%` },
  { key: 'hrDue',     label: 'HR Due Score',   cat: 'form',     get: b => hrSetup(b).n,                    min: 1,   max: 6,   step: 1,   def: 3,   disp: v => `≥${v}/6` },
  { key: 'positives', label: '+ Trends',       cat: 'form',     get: b => positiveReasonCount(b),          min: 0,   max: 15,  step: 1,   def: 5,   disp: v => `≥${v}` },
  { key: 'negatives', label: '− Trends max',   cat: 'form',     get: b => -negativeReasonCount(b),         min: -8,  max: 0,   step: 1,   def: -2,  disp: v => `≤${-v} neg` },
]

const BOOL_CRIT = [
  { key: 'hot',          label: 'Hot Bat',       icon: 'Flame',         cat: 'signals', get: b => b.hot },
  { key: 'barrelKing',   label: 'Barrel King',   icon: 'Crosshair',     cat: 'signals', get: b => b.barrelKing },
  { key: 'blast',        label: 'Blast',         icon: 'Zap',           cat: 'signals', get: b => b.blast },
  { key: 'pitchEdge',    label: 'Pitch Edge',    icon: 'TrendingUp',    cat: 'signals', get: b => b.pitchEdge },
  { key: 'pitchMixEdge', label: 'Pitch Mix Edge',icon: 'Layers',        cat: 'signals', get: b => b.pitchMixEdge },
  { key: 'zoneEdge',     label: 'Zone Match',    icon: 'Target',        cat: 'signals', get: b => b.zoneEdge },
  { key: 'hrPlatoonEdge',label: 'Platoon Edge',  icon: 'ArrowLeftRight',cat: 'signals', get: b => b.hrPlatoonEdge },
  { key: 'wxEdge',       label: 'Weather Boost', icon: 'Wind',          cat: 'signals', get: b => b.wxEdge },
  { key: 'homeEdge',     label: 'Home Edge',     icon: 'Home',          cat: 'signals', get: b => b.homeEdge },
  { key: 'awayEdge',     label: 'Away Edge',     icon: 'Plane',         cat: 'signals', get: b => b.awayEdge },
]

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtVal(c, b) {
  const v = c.get(b)
  if (!Number.isFinite(v)) return '—'
  if (c.key === 'negatives') return `${Math.abs(v)}`
  if (c.key === 'hrProb') return pct(v / 100, 1)
  if (c.key === 'pitcherH9' || c.key === 'parkFact' || c.key === 'pitchMix') return num(v, 2)
  if (c.key === 'exitVelo') return `${num(v, 1)}mph`
  if (['barrel','hardHit','recBarrel'].includes(c.key)) return `${num(v, 1)}%`
  if (c.key === 'launchAng') return `${num(v, 1)}°`
  if (c.key === 'hrDue') return `${v}/6`
  return Math.round(v)
}

// ─── sub-components ──────────────────────────────────────────────────────────

function CritChip({ c, active, onClick }) {
  return (
    <button
      className={`lb-chip ${active ? 'lb-chip-on' : ''}`}
      onClick={onClick}
    >
      {c.label}
      {active && <Icon name="X" size={10} style={{ marginLeft: '3px', opacity: 0.7 }} />}
    </button>
  )
}

function BoolChip({ c, active, onClick }) {
  return (
    <button
      className={`lb-chip ${active ? 'lb-chip-on' : ''}`}
      onClick={onClick}
    >
      <Icon name={c.icon} size={11} />
      {c.label}
      {active && <Icon name="X" size={10} style={{ marginLeft: '3px', opacity: 0.7 }} />}
    </button>
  )
}

function Stepper({ c, value, onChange }) {
  const canDec = value - c.step >= c.min - 1e-9
  const canInc = value + c.step <= c.max + 1e-9
  const round = (v) => Math.round(v / c.step) * c.step
  return (
    <div className="lb-active-crit">
      <button className="lb-step-btn" disabled={!canDec} onClick={() => onChange(round(value - c.step))}>−</button>
      <span className="lb-step-val mono">{c.disp(value)}</span>
      <button className="lb-step-btn" disabled={!canInc} onClick={() => onChange(round(value + c.step))}>+</button>
      <span className="lb-step-label">{c.label}</span>
      <button className="lb-step-rm icon-btn" onClick={() => onChange(null)} aria-label="Remove">
        <Icon name="X" size={12} />
      </button>
    </div>
  )
}

// ─── main view ───────────────────────────────────────────────────────────────

export default function ListBuilderView({ batters = [], onSelect }) {
  const [cat, setCat] = useState('all')
  const [activeNums, setActiveNums] = useState({})   // { key: threshold }
  const [activeBools, setActiveBools] = useState(new Set())

  const hasAny = Object.keys(activeNums).length > 0 || activeBools.size > 0

  const visibleNum  = cat === 'all' || cat === 'signals' ? [] : NUM_CRIT.filter(c => cat === 'all' || c.cat === cat)
  const visibleBool = cat === 'all' || cat === 'signals' ? BOOL_CRIT : BOOL_CRIT.filter(c => c.cat === cat)

  // Show all chips when no category is pure-signals
  const showNum  = cat !== 'signals' ? NUM_CRIT.filter(c => cat === 'all' || c.cat === cat) : []
  const showBool = cat !== 'model' && cat !== 'matchup' && cat !== 'statcast' && cat !== 'form'
    ? BOOL_CRIT
    : []

  const toggleNum = (key) => {
    setActiveNums(prev => {
      if (key in prev) { const n = { ...prev }; delete n[key]; return n }
      return { ...prev, [key]: NUM_CRIT.find(c => c.key === key).def }
    })
  }

  const setNum = (key, val) => {
    if (val === null) {
      setActiveNums(prev => { const n = { ...prev }; delete n[key]; return n })
    } else {
      setActiveNums(prev => ({ ...prev, [key]: val }))
    }
  }

  const toggleBool = (key) => {
    setActiveBools(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  // Filtered + sorted batter list
  const matched = useMemo(() => {
    return batters.filter(b => {
      for (const [key, threshold] of Object.entries(activeNums)) {
        const c = NUM_CRIT.find(c => c.key === key)
        const val = c?.get(b)
        if (!Number.isFinite(val) || val < threshold - 1e-9) return false
      }
      for (const key of activeBools) {
        const c = BOOL_CRIT.find(c => c.key === key)
        if (!c?.get(b)) return false
      }
      return true
    }).sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0))
  }, [batters, activeNums, activeBools])

  // Which active num criteria to display on each row (first 3 active)
  const rowCols = Object.keys(activeNums).slice(0, 3).map(k => NUM_CRIT.find(c => c.key === k))

  return (
    <div className="lb-root">
      {/* Header */}
      <div className="lb-header">
        <div>
          <h2 className="lb-title">List Builder</h2>
          <p className="lb-sub dim">Filter today's slate by your Statcast criteria</p>
        </div>
        {hasAny && (
          <button className="lb-clear" onClick={() => { setActiveNums({}); setActiveBools(new Set()) }}>
            Clear all
          </button>
        )}
      </div>

      {/* Active steppers */}
      {Object.keys(activeNums).length > 0 && (
        <div className="lb-active-list">
          {Object.entries(activeNums).map(([key, val]) => {
            const c = NUM_CRIT.find(c => c.key === key)
            return <Stepper key={key} c={c} value={val} onChange={v => setNum(key, v)} />
          })}
        </div>
      )}
      {activeBools.size > 0 && (
        <div className="lb-bool-active">
          {[...activeBools].map(key => {
            const c = BOOL_CRIT.find(c => c.key === key)
            return (
              <button key={key} className="lb-chip lb-chip-on" onClick={() => toggleBool(key)}>
                <Icon name={c.icon} size={11} /> {c.label}
                <Icon name="X" size={10} style={{ marginLeft: '3px', opacity: 0.7 }} />
              </button>
            )
          })}
        </div>
      )}

      {/* Category tabs */}
      <div className="lb-cats">
        {CATS.map(t => (
          <button key={t.id} className={`lb-cat ${cat === t.id ? 'on' : ''}`} onClick={() => setCat(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Criterion chips */}
      <div className="lb-chips">
        {showNum.map(c => (
          <CritChip key={c.key} c={c} active={c.key in activeNums} onClick={() => toggleNum(c.key)} />
        ))}
        {showBool.map(c => (
          <BoolChip key={c.key} c={c} active={activeBools.has(c.key)} onClick={() => toggleBool(c.key)} />
        ))}
      </div>

      {/* Results */}
      <div className="lb-results">
        <div className="lb-count">
          <Icon name="Users" size={13} style={{ color: 'var(--accent)' }} />
          <span>
            {hasAny
              ? <><b style={{ color: '#fff' }}>{matched.length}</b> / {batters.length} players match</>
              : `${batters.length} players on today's slate`}
          </span>
          {hasAny && matched.length === 0 && (
            <span style={{ color: 'var(--text-faint)', marginLeft: '8px' }}>— loosen a filter</span>
          )}
        </div>

        {(!hasAny || matched.length > 0) && (
          <ul className="lb-list">
            {/* Column headers */}
            {rowCols.length > 0 && (
              <li className="lb-row lb-row-head">
                <span className="lb-col-grade" />
                <span className="lb-col-name" />
                {rowCols.map(c => (
                  <span key={c.key} className="lb-col-stat dim">{c.label}</span>
                ))}
                <span className="lb-col-hrp dim">HR%</span>
              </li>
            )}

            {(hasAny ? matched : batters.slice().sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0))).map(b => (
              <li
                key={b.id}
                className="lb-row"
                role="button"
                tabIndex={0}
                onClick={() => onSelect(b)}
                onKeyDown={e => e.key === 'Enter' && onSelect(b)}
              >
                <span className="lb-col-grade">
                  <GradeChip grade={b.grade?.label || b.grade} size="sm" score={b.score} />
                </span>
                <span className="lb-col-name">
                  <span className="lb-name">{lastFirst(b.name)}</span>
                  <span className="lb-team dim">{b.team}</span>
                </span>
                {rowCols.map(c => (
                  <span key={c.key} className="lb-col-stat mono">{fmtVal(c, b)}</span>
                ))}
                {rowCols.length === 0 && (
                  <>
                    <span className="lb-col-stat mono dim">{b.score != null ? Math.round(b.score) : '—'}</span>
                    <span className="lb-col-stat mono dim">{b.heatIndex != null ? Math.round(b.heatIndex) : '—'}</span>
                  </>
                )}
                <span className="lb-col-hrp mono">{pct(b.hrProbability, 1)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
