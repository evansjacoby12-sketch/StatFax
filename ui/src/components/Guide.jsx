import Icon from './Icon.jsx'
import { BADGES, gradeColor } from '../lib/badges.js'
import {
  DATA_STATES,
  FIRST_INNING_CALLS,
  GAME_CALLS,
  GRADE_DEFINITIONS,
  LABEL_SCOPES,
  SLATE_CONDITIONS,
  WORKSPACE_DEFINITIONS,
} from '../lib/explanationCatalog.js'
import { hexA, Badge } from './atoms.jsx'

function DefinitionRows({ items, icon = 'ChevronRight' }) {
  return (
    <div className="guide-list">
      {items.map(([name, desc, extra]) => (
        <div className="guide-row" key={name}>
          <span className="guide-ico"><Icon name={icon} size={15} /></span>
          <span className="guide-txt">
            <b>{name}</b>
            {extra && <span className="guide-key-example">{desc}</span>}
            <span className="dim">{extra || desc}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function CallRows({ calls }) {
  return (
    <div className="guide-list">
      {calls.map((call) => (
        <div className="guide-row" key={call.tier}>
          <span className={`call-key-tier is-${call.tone}`}>
            <Icon name={call.icon} size={11} /> {call.tier}
          </span>
          <span className="guide-txt"><b>{call.short}</b><span className="dim">{call.description}</span></span>
        </div>
      ))}
    </div>
  )
}

export default function Guide({ onClose, embedded = false }) {
  return (
    <>
      {!embedded && <div className="drawer-scrim" onClick={onClose} />}
      <div className={embedded ? 'learn-embedded' : 'modal guide-modal'} role={embedded ? 'tabpanel' : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-label="MLB label keys">
        {!embedded && <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>}
        <div className="model-head">
          <h2><Icon name="BookOpen" size={18} /> Keys</h2>
          <div className="model-sub dim">The scope and meaning of every decision label used by the MLB engine.</div>
        </div>

        <div className="guide-callout">
          <span className="guide-callout-h"><Icon name="Info" size={14} /> Read the section before the label</span>
          <span className="dim">LEAN and STRONG appear in more than one tool. Their meaning comes from the section: HR board, game market, first inning, or slate condition.</span>
        </div>

        <h3 className="section-title"><Icon name="Layers" size={14} /> Label scopes</h3>
        <DefinitionRows items={LABEL_SCOPES} icon="Focus" />

        <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="Trophy" size={14} /> HR grades</h3>
        <div className="legend-grades">
          {GRADE_DEFINITIONS.map((grade) => {
            const color = gradeColor(grade.key)
            return (
              <div className="legend-grade" key={grade.key}>
                <span className="grade-chip grade-md" style={{ color, borderColor: hexA(color, 0.45), background: hexA(color, 0.12) }}>{grade.key}</span>
                <span className="legend-grade-min mono">{grade.threshold}</span>
                <span className="legend-grade-desc"><b>{grade.short}</b><span className="dim">{grade.description}</span></span>
              </div>
            )
          })}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="ChartNoAxesCombined" size={14} /> Game-market calls</h3>
        <p className="guide-p dim">Applies only to moneyline and over/under decisions at the displayed market.</p>
        <CallRows calls={GAME_CALLS} />

        <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="Clock3" size={14} /> First-inning calls</h3>
        <p className="guide-p dim">Applies only to NRFI/YRFI. It does not describe the full-game total or HR board.</p>
        <CallRows calls={FIRST_INNING_CALLS} />

        <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="CloudSun" size={14} /> Slate conditions</h3>
        <DefinitionRows items={SLATE_CONDITIONS.map((item) => [item.tier, item.description])} icon="Gauge" />

        <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="Database" size={14} /> Data and validation states</h3>
        <DefinitionRows items={DATA_STATES} icon="CircleDot" />

        <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="Focus" size={14} /> Signal badges</h3>
        <p className="guide-p dim">Badges explain supporting or cautionary evidence. They do not replace the grade, probability, or market call.</p>
        <div className="guide-badges">
          {BADGES.map((badge) => (
            <div className="guide-badge" key={badge.key}>
              <Badge badge={badge} />
              <span className="dim">{badge.desc}</span>
            </div>
          ))}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="Rows3" size={14} /> Menu map</h3>
        <DefinitionRows items={WORKSPACE_DEFINITIONS} icon="ChevronRight" />

        <p className="guide-foot dim">Use Glossary for stat definitions. Use Start here for the decision workflow.</p>
      </div>
    </>
  )
}
