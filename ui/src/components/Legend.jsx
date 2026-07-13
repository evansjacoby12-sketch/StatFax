import { useState } from 'react'
import Icon from './Icon.jsx'
import { BADGES, gradeColor } from '../lib/badges.js'
import { hexA, Badge } from './atoms.jsx'

const GRADES = [
  { label: 'PRIME', min: 72, desc: 'Top-tier play — signals stack strongly' },
  { label: 'STRONG', min: 52, desc: 'Above-average HR case' },
  { label: 'LEAN', min: 36, desc: 'Marginal — some edge, some risk' },
  { label: 'SKIP', min: 0, desc: 'Model sees little HR upside' },
]

const TERMS = [
  ['HR Probability', 'Calibrated chance of ≥1 HR today. Isotonic-mapped from the model score, then sim-resolved for ranking.'],
  ['Model score', '0–100 composite: 45% batter · 30% matchup · 25% environment, after calibration.'],
  ['xHR', 'Expected HRs this game (sum of per-PA HR probabilities).'],
  ['Rating', 'Quick 0–10 read of the score.'],
  ['All-hit', 'Chance that every parlay leg homers. Leg probabilities multiply, so it falls quickly as legs are added.'],
  ['Confirmed lineup', 'The player is in the posted starting order. SGPs show confirmed-lineup tickets by default.'],
  ['Projected lineup', 'The player is expected to start, but the official order is not posted. Preview only; verify before betting.'],
  ['SGP probability', 'Independent product of the calibrated leg rates. No same-game correlation uplift is currently applied.'],
  ['Edge', 'Model probability vs the best book price. Positive = model sees value.'],
  ['Barrel%', 'Share of batted balls hit at HR-optimal exit velo + launch angle.'],
  ['xSLG / xISO', "Statcast 'expected' slugging / isolated power from contact quality — strips out luck."],
]

export default function Legend({ onClose, embedded = false }) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visibleBadges = needle ? BADGES.filter((badge) => `${badge.label} ${badge.desc}`.toLowerCase().includes(needle)) : BADGES
  const visibleTerms = needle ? TERMS.filter(([term, description]) => `${term} ${description}`.toLowerCase().includes(needle)) : TERMS
  return (
    <>
      {!embedded && <div className="drawer-scrim" onClick={onClose} />}
      <div className={embedded ? 'learn-embedded' : 'modal legend-modal'} role={embedded ? 'tabpanel' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="Legend">
        {!embedded && <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>}
        <div className="model-head">
          <h2>
            <Icon name="Info" size={18} /> Legend
          </h2>
          <div className="model-sub dim">What the grades, signals, and stats mean</div>
        </div>

        {embedded && (
          <label className="learn-search">
            <Icon name="Search" size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search grades, signals, or stats…" aria-label="Search glossary" />
          </label>
        )}

        <h3 className="section-title">
          <Icon name="Trophy" size={14} /> Grades
        </h3>
        <div className="legend-grades">
          {GRADES.map((g) => {
            const c = gradeColor(g.label)
            return (
              <div className="legend-grade" key={g.label}>
                <span className="grade-chip grade-md" style={{ color: c, borderColor: hexA(c, 0.45), background: hexA(c, 0.12) }}>
                  {g.label}
                </span>
                <span className="legend-grade-min mono">score ≥ {g.min}</span>
                <span className="legend-grade-desc dim">{g.desc}</span>
              </div>
            )
          })}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="SlidersHorizontal" size={14} /> Signals
        </h3>
        <div className="legend-badges">
          {visibleBadges.map((b) => (
            <div className="legend-badge" key={b.key}>
              <Badge badge={b} />
              <span className="legend-badge-desc dim">{b.desc}</span>
            </div>
          ))}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="Gauge" size={14} /> Stats
        </h3>
        <dl className="legend-terms">
          {visibleTerms.map(([k, v]) => (
            <div className="legend-term" key={k}>
              <dt>{k}</dt>
              <dd className="dim">{v}</dd>
            </div>
          ))}
        </dl>
        {needle && visibleBadges.length === 0 && visibleTerms.length === 0 && <div className="learn-search-empty">No glossary entries match “{query}”.</div>}
      </div>
    </>
  )
}
