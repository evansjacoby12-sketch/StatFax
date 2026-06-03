import Icon from './Icon.jsx'
import { BADGES, gradeColor, GRADE_ORDER } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

const VIEWS = [
  ['List', 'Board', 'Every hitter ranked by the model’s HR probability. Sort and filter to find tonight’s best power spots.'],
  ['LayoutGrid', 'Games', 'The slate as game cards — team colors, starters, live score, and each lineup split into two silos.'],
  ['Crosshair', 'Pitchers', 'One card per starter: a 0–100 vulnerability score, the lineup ranked as HR targets, pitch mix, and splits.'],
  ['Wind', 'Weather', 'One card per game ranked by the air — real wind OUT/IN verdict, temp, park factor, and who it helps.'],
  ['Activity', 'Results', 'The model’s track record: discrimination (AUC), top-decile hit rate, Brier vs baseline, and calibration.'],
]

const TOOLS = [
  ['Search', 'Search', 'Filter by batter, team, or pitcher name.'],
  ['Trophy', 'Grade chips', 'Toggle PRIME / STRONG / LEAN / SKIP to focus the board.'],
  ['SlidersHorizontal', 'Filters (chevron)', 'Game, confirmed-lineup-only, watchlist-only, hot bats, and the signal chips.'],
  ['Activity', 'Live / Pregame', 'Flip the whole board between live scores + innings and a clean pregame projection look.'],
  ['Radio', 'Auto', 'Soft-refresh the slate every 60s for live games — filters and selection survive.'],
  ['Star', 'Watchlist', 'Star any batter (row or drawer), then filter to just your list.'],
  ['Plus', 'Parlay', 'Add legs with the + on a row; the slip shows combined model probability and model-fair price.'],
]

export default function Guide({ onClose }) {
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="modal guide-modal" role="dialog" aria-modal="true" aria-label="Guide">
        <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>
        <div className="model-head">
          <h2>
            <Icon name="Info" size={18} /> Guide
          </h2>
          <div className="model-sub dim">
            StatFax ranks every hitter by the model’s own home-run probability — a pure model board.
          </div>
        </div>

        <h3 className="section-title">
          <Icon name="LayoutGrid" size={14} /> The views
        </h3>
        <div className="guide-list">
          {VIEWS.map(([icon, name, desc]) => (
            <div className="guide-row" key={name}>
              <span className="guide-ico">
                <Icon name={icon} size={15} />
              </span>
              <span className="guide-txt">
                <b>{name}</b>
                <span className="dim">{desc}</span>
              </span>
            </div>
          ))}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="Trophy" size={14} /> Reading a pick
        </h3>
        <p className="guide-p dim">
          Each row leads with the engine’s <b>grade</b> and its <b>HR probability</b> (calibrated chance of ≥1 HR
          today), plus the model’s top reason. Tap any row for the full drawer — score breakdown, Statcast, the
          opposing pitcher, weather, career H2H, and recent starts.
        </p>
        <div className="guide-grades">
          {GRADE_ORDER.map((g) => {
            const c = gradeColor(g)
            return (
              <span key={g} className="grade-chip grade-md" style={{ color: c, borderColor: hexA(c, 0.45), background: hexA(c, 0.12) }}>
                {g}
              </span>
            )
          })}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="SlidersHorizontal" size={14} /> Signals
        </h3>
        <div className="guide-badges">
          {BADGES.map((b) => (
            <div className="guide-badge" key={b.key}>
              <span className="badge" style={{ color: b.color, borderColor: 'color-mix(in srgb,' + b.color + ' 40%, transparent)' }}>
                <Icon name={b.lucide} size={11} />
                {b.label}
              </span>
              <span className="dim">{b.desc}</span>
            </div>
          ))}
        </div>

        <h3 className="section-title" style={{ marginTop: 18 }}>
          <Icon name="Gauge" size={14} /> Filters &amp; tools
        </h3>
        <div className="guide-list">
          {TOOLS.map(([icon, name, desc]) => (
            <div className="guide-row" key={name}>
              <span className="guide-ico">
                <Icon name={icon} size={15} />
              </span>
              <span className="guide-txt">
                <b>{name}</b>
                <span className="dim">{desc}</span>
              </span>
            </div>
          ))}
        </div>

        <p className="guide-foot dim">
          Tap the <Icon name="Info" size={12} /> in the header for the full legend of grades, signals, and stat
          definitions.
        </p>
      </div>
    </>
  )
}
