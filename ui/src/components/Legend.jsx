import { useState } from 'react'
import Icon from './Icon.jsx'
import { BADGES, gradeColor } from '../lib/badges.js'
import { DATA_STATES, GRADE_DEFINITIONS, STAT_TERMS } from '../lib/explanationCatalog.js'
import { hexA, Badge } from './atoms.jsx'

export default function Legend({ onClose, embedded = false }) {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visibleGrades = needle ? GRADE_DEFINITIONS.filter((grade) => `${grade.key} ${grade.threshold} ${grade.short} ${grade.description}`.toLowerCase().includes(needle)) : GRADE_DEFINITIONS
  const visibleBadges = needle ? BADGES.filter((badge) => `${badge.label} ${badge.desc}`.toLowerCase().includes(needle)) : BADGES
  const allTerms = [...DATA_STATES, ...STAT_TERMS]
  const visibleTerms = needle ? allTerms.filter(([term, description]) => `${term} ${description}`.toLowerCase().includes(needle)) : allTerms
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
          {visibleGrades.map((grade) => {
            const c = gradeColor(grade.key)
            return (
              <div className="legend-grade" key={grade.key}>
                <span className="grade-chip grade-md" style={{ color: c, borderColor: hexA(c, 0.45), background: hexA(c, 0.12) }}>
                  {grade.key}
                </span>
                <span className="legend-grade-min mono">{grade.threshold}</span>
                <span className="legend-grade-desc"><b>{grade.short}</b><span className="dim">{grade.description}</span></span>
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
        {needle && visibleGrades.length === 0 && visibleBadges.length === 0 && visibleTerms.length === 0 && <div className="learn-search-empty">No glossary entries match “{query}”.</div>}
      </div>
    </>
  )
}
