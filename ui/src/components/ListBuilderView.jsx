import { useState, useRef } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct, num } from '../lib/format.js'
import { pitchMixScore, hrSetup } from '../lib/scout.js'
import { positiveReasonCount, negativeReasonCount } from '../lib/combo-engine.js'
import { lastFirst } from '../lib/groups.js'

// ─── field helpers ───────────────────────────────────────────────────────────

const blast = (b) => {
  const t = b.batTracking
  if (!t) return null
  const r = Number.isFinite(t.recentBlastPerContact) && (t.recentSwings ?? 0) >= 25
    ? t.recentBlastPerContact
    : Number.isFinite(t.blastPerContact) ? t.blastPerContact : null
  return r
}

const BOOL_SIGNALS = [
  { key: 'precision',     label: 'Precision',      get: b => b.precision },
  { key: 'hot',           label: 'Hot Bat',        get: b => b.hot },
  { key: 'barrelKing',    label: 'Barrel King',    get: b => b.barrelKing },
  { key: 'blast',         label: 'Blast',          get: b => b.blast },
  { key: 'pitchEdge',     label: 'Pitch Edge',     get: b => b.pitchEdge },
  { key: 'pitchMixEdge',  label: 'Pitch Mix Edge', get: b => b.pitchMixEdge },
  { key: 'zoneEdge',      label: 'Zone Match',     get: b => b.zoneEdge },
  { key: 'hrPlatoonEdge', label: 'Platoon Edge',   get: b => b.hrPlatoonEdge },
  { key: 'wxEdge',        label: 'Weather Boost',  get: b => b.wxEdge },
  { key: 'homeEdge',      label: 'Home Edge',      get: b => b.homeEdge },
  { key: 'awayEdge',      label: 'Away Edge',      get: b => b.awayEdge },
]

// ─── empty form ──────────────────────────────────────────────────────────────

const EMPTY = {
  // Pitcher matchup
  minOppHr9: '', minPitchMix: '', minParkFactor: '',
  // Statcast
  minExitVelo: '', minBarrel: '', minHardHit: '',
  minBlast: '', minLaunchAngle: '', maxPullPct: '',
  // Form / model
  minScore: '', minHeat: '', minHrProb: '',
  minRecBarrel: '', minHrDue: '', minPositives: '', maxNegatives: '',
  // Signals (booleans)
  signals: new Set(),
}

// ─── sub-components ──────────────────────────────────────────────────────────

function Field({ label, name, value, onChange, hint, min, max, step = 'any', placeholder = '' }) {
  return (
    <div className="lbv-field">
      <label className="lbv-label">{label}</label>
      <input
        className="lbv-input"
        type="number"
        name={name}
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder || 'blank = skip'}
        onChange={e => onChange(name, e.target.value)}
      />
      {hint && <span className="lbv-hint dim">{hint}</span>}
    </div>
  )
}

function SigCheck({ sig, active, onToggle }) {
  return (
    <label className="lbv-sigcheck">
      <input type="checkbox" checked={active} onChange={() => onToggle(sig.key)} />
      {sig.label}
    </label>
  )
}

function ResultRow({ b, onSelect, cols }) {
  return (
    <li className="lbv-row" role="button" tabIndex={0} onClick={() => onSelect(b)} onKeyDown={e => e.key === 'Enter' && onSelect(b)}>
      <GradeChip grade={b.grade} size="sm" score={b.score} />
      <div className="lbv-row-name">
        <span className="lbv-name">{lastFirst(b.name)}</span>
        <span className="lbv-team dim">{b.team}</span>
      </div>
      {cols.map(c => (
        <span key={c.key} className="lbv-row-stat mono">{c.fmt(b)}</span>
      ))}
      <span className="lbv-row-hrp mono">{pct(b.hrProbability, 1)}</span>
    </li>
  )
}

// ─── main view ───────────────────────────────────────────────────────────────

export default function ListBuilderView({ batters = [], onSelect }) {
  const [form, setForm] = useState(EMPTY)
  const [results, setResults] = useState(null) // null = not built yet

  const setField = (name, val) => setForm(f => ({ ...f, [name]: val }))

  const toggleSig = (key) => setForm(f => {
    const s = new Set(f.signals)
    s.has(key) ? s.delete(key) : s.add(key)
    return { ...f, signals: s }
  })

  const num_ = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null }

  const buildList = () => {
    const f = form
    const out = batters.filter(b => {
      if (num_(f.minOppHr9)     != null && (b.pitcher?.season?.hrPer9 ?? 0) < num_(f.minOppHr9))     return false
      if (num_(f.minPitchMix)   != null && (pitchMixScore(b) ?? 0)           < num_(f.minPitchMix))   return false
      if (num_(f.minParkFactor) != null && (b.gameParkHRFactor ?? 1)         < num_(f.minParkFactor)) return false
      if (num_(f.minExitVelo)   != null && (b.exitVelo ?? 0)                 < num_(f.minExitVelo))   return false
      if (num_(f.minBarrel)     != null && ((b.barrelPctBBE ?? b.barrelPct ?? 0)) < num_(f.minBarrel)) return false
      if (num_(f.minHardHit)    != null && (b.hardHitPct ?? 0)               < num_(f.minHardHit))    return false
      if (num_(f.minBlast)      != null && (blast(b) ?? 0)                   < num_(f.minBlast))      return false
      if (num_(f.minLaunchAngle)!= null && (b.launchAngle ?? 0)              < num_(f.minLaunchAngle))return false
      if (num_(f.maxPullPct)    != null && (b.pullPct ?? 100)                > num_(f.maxPullPct))    return false
      if (num_(f.minScore)      != null && (b.score ?? 0)                    < num_(f.minScore))      return false
      if (num_(f.minHeat)       != null && (b.heatIndex ?? 0)                < num_(f.minHeat))       return false
      if (num_(f.minHrProb)     != null && ((b.hrProbability ?? 0) * 100)    < num_(f.minHrProb))     return false
      if (num_(f.minRecBarrel)  != null && (b.recentBarrel?.recentBarrelPct ?? 0) < num_(f.minRecBarrel)) return false
      if (num_(f.minHrDue)      != null && hrSetup(b).n                      < num_(f.minHrDue))      return false
      if (num_(f.minPositives)  != null && positiveReasonCount(b)            < num_(f.minPositives))  return false
      if (num_(f.maxNegatives)  != null && negativeReasonCount(b)            > num_(f.maxNegatives))  return false
      for (const key of f.signals) {
        const s = BOOL_SIGNALS.find(s => s.key === key)
        if (!s?.get(b)) return false
      }
      return true
    }).sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0))
    setResults(out)
  }

  const reset = () => { setForm(EMPTY); setResults(null) }

  // Build display columns from active numeric fields
  const cols = [
    num_(form.minScore)    != null && { key: 'score',   label: 'Score',   fmt: b => Math.round(b.score ?? 0) },
    num_(form.minHeat)     != null && { key: 'heat',    label: 'Heat',    fmt: b => Math.round(b.heatIndex ?? 0) },
    num_(form.minBarrel)   != null && { key: 'barrel',  label: 'Brl%',    fmt: b => `${num(b.barrelPctBBE ?? b.barrelPct, 1)}%` },
    num_(form.minHardHit)  != null && { key: 'hardhit', label: 'HH%',     fmt: b => `${num(b.hardHitPct, 1)}%` },
    num_(form.minExitVelo) != null && { key: 'ev',      label: 'EV',      fmt: b => `${num(b.exitVelo, 1)}` },
    num_(form.minBlast)    != null && { key: 'blast',   label: 'Blast%',  fmt: b => `${num(blast(b), 1)}%` },
    num_(form.minOppHr9)   != null && { key: 'hr9',     label: 'HR/9',    fmt: b => num(b.pitcher?.season?.hrPer9, 2) },
  ].filter(Boolean).slice(0, 3)

  return (
    <div className="lbv-root">
      <div className="lbv-header">
        <h2 className="lbv-title">List Builder</h2>
        <p className="lbv-sub dim">Set your Statcast criteria — hit Build to pull everyone who clears every gate.</p>
      </div>

      {/* ── 1. Pitcher Matchup ── */}
      <section className="lbv-section">
        <h3 className="lbv-sec-title"><span className="lbv-num">1</span> Pitcher Matchup</h3>
        <p className="lbv-sec-desc dim">Filters based on tonight's opposing pitcher.</p>
        <div className="lbv-grid">
          <Field label="Min Opp HR/9"     name="minOppHr9"     value={form.minOppHr9}     onChange={setField} hint="e.g. 1.3 = HR-prone arms" step="0.1" min="0" max="4" />
          <Field label="Min Pitch Mix"    name="minPitchMix"   value={form.minPitchMix}   onChange={setField} hint="0–10; 7 = favorable" step="0.5" min="0" max="10" />
          <Field label="Min Park Factor"  name="minParkFactor" value={form.minParkFactor} onChange={setField} hint="1.0 = neutral; 1.1 = HR park" step="0.05" min="0.5" max="1.6" />
        </div>
      </section>

      {/* ── 2. Statcast Thresholds ── */}
      <section className="lbv-section">
        <h3 className="lbv-sec-title"><span className="lbv-num">2</span> Statcast Thresholds</h3>
        <p className="lbv-sec-desc dim">Leave any field blank to skip that gate.</p>
        <div className="lbv-grid">
          <Field label="Min Exit Velo"    name="minExitVelo"    value={form.minExitVelo}    onChange={setField} hint="mph; e.g. 90" step="0.5" min="70" max="105" />
          <Field label="Min Barrel%"      name="minBarrel"      value={form.minBarrel}      onChange={setField} hint="BBE%; MLB avg ~7%" step="1" min="0" max="30" />
          <Field label="Min Hard Hit%"    name="minHardHit"     value={form.minHardHit}     onChange={setField} hint="EV ≥95mph; e.g. 45" step="1" min="0" max="75" />
          <Field label="Min Blast%"       name="minBlast"       value={form.minBlast}       onChange={setField} hint="Bat tracking; e.g. 20" step="1" min="0" max="60" />
          <Field label="Min Launch Angle" name="minLaunchAngle" value={form.minLaunchAngle} onChange={setField} hint="°; HR window 8–32°" step="1" min="0" max="35" />
          <Field label="Max Pull%"        name="maxPullPct"     value={form.maxPullPct}     onChange={setField} hint="e.g. 50 = not pull-heavy" step="1" min="0" max="100" />
        </div>
      </section>

      {/* ── 3. Form & Model ── */}
      <section className="lbv-section">
        <h3 className="lbv-sec-title"><span className="lbv-num">3</span> Form &amp; Model</h3>
        <p className="lbv-sec-desc dim">Model score, heat index, and trend signals.</p>
        <div className="lbv-grid">
          <Field label="Min Score"        name="minScore"      value={form.minScore}      onChange={setField} hint="0–100 model grade" step="5" min="0" max="100" />
          <Field label="Min Heat Index"   name="minHeat"       value={form.minHeat}       onChange={setField} hint="0–100; 70+ = hot" step="5" min="0" max="100" />
          <Field label="Min HR Prob%"     name="minHrProb"     value={form.minHrProb}     onChange={setField} hint="e.g. 15 = ≥15%" step="1" min="0" max="40" />
          <Field label="Min Recent Brl%"  name="minRecBarrel"  value={form.minRecBarrel}  onChange={setField} hint="Last 14 days" step="1" min="0" max="40" />
          <Field label="Min HR Due Score" name="minHrDue"      value={form.minHrDue}      onChange={setField} hint="0–6 checklist" step="1" min="0" max="6" />
          <Field label="Min + Trends"     name="minPositives"  value={form.minPositives}  onChange={setField} hint="Green bullets in Trends" step="1" min="0" max="15" />
          <Field label="Max − Trends"     name="maxNegatives"  value={form.maxNegatives}  onChange={setField} hint="Red bullets limit" step="1" min="0" max="10" />
        </div>
      </section>

      {/* ── 4. Signals ── */}
      <section className="lbv-section">
        <h3 className="lbv-sec-title"><span className="lbv-num">4</span> Signals</h3>
        <p className="lbv-sec-desc dim">Require any combination of matchup &amp; form signals.</p>
        <div className="lbv-siglist">
          {BOOL_SIGNALS.map(s => (
            <SigCheck key={s.key} sig={s} active={form.signals.has(s.key)} onToggle={toggleSig} />
          ))}
        </div>
      </section>

      {/* ── Actions ── */}
      <div className="lbv-actions">
        <button className="lbv-build" onClick={buildList}>
          <Icon name="Filter" size={15} /> Build List
        </button>
        <button className="lbv-reset" onClick={reset}>Reset</button>
      </div>

      {/* ── Results ── */}
      {results === null ? (
        <div className="lbv-empty">
          <Icon name="ListFilter" size={28} style={{ color: 'var(--text-faint)' }} />
          <p>No list yet</p>
          <p className="dim" style={{ fontSize: '12px' }}>Set your criteria above and hit <b>Build List</b></p>
        </div>
      ) : (
        <div className="lbv-results">
          <div className="lbv-count">
            <Icon name="Users" size={13} style={{ color: 'var(--accent)' }} />
            <b style={{ color: '#fff' }}>{results.length}</b>
            <span>/ {batters.length} players match</span>
            {results.length === 0 && <span className="dim"> — loosen a filter</span>}
          </div>
          {results.length > 0 && (
            <ul className="lbv-list">
              <li className="lbv-row lbv-row-head">
                <span style={{ width: '44px' }} />
                <span className="lbv-row-name" />
                {cols.map(c => <span key={c.key} className="lbv-row-stat dim">{c.label}</span>)}
                <span className="lbv-row-hrp dim">HR%</span>
              </li>
              {results.map(b => <ResultRow key={b.id} b={b} onSelect={onSelect} cols={cols} />)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
