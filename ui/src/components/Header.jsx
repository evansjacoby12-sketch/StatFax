import Icon from './Icon.jsx'
import { timeAgo, pct } from '../lib/format.js'
import { GRADE_ORDER, gradeColor } from '../lib/badges.js'

export default function Header({
  meta,
  counts,
  onRefresh,
  onOpenModel,
  onOpenLegend,
  autoRefresh,
  onToggleAuto,
  refreshing,
  gradeCounts = {},
  total = 0,
}) {
  const m = meta.modelMetrics
  const brierEdge = m ? (m.baselineBrier - m.brier) / m.baselineBrier : null
  return (
    <header className="header">
      <div className="header-left">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="Trophy" size={18} />
          </span>
          <div className="brand-txt">
            <span className="brand-name">
              Stat<span className="brand-accent">Fax</span>
            </span>
            <span className="brand-sub">HR Model Board</span>
          </div>
        </div>
        <div className="slate-block">
          <div className="slate-meta">
            <span className="slate-date">{meta.date}</span>
            <span className="dot-sep">·</span>
            <span>{counts.games} games</span>
            <span className="dot-sep slate-batters">·</span>
            <span className="slate-batters">
              <b className="mono">{counts.shown}</b> / {counts.total} batters
            </span>
          </div>
          {total > 0 && (
            <div className="grade-bar" title="Grade distribution">
              {GRADE_ORDER.map((g) => {
                const n = gradeCounts[g] || 0
                if (!n) return null
                return (
                  <span
                    key={g}
                    className="grade-bar-seg"
                    style={{ flexGrow: n, background: gradeColor(g) }}
                    title={`${g}: ${n}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        <button className="metric-pill" onClick={onOpenModel} title="Model track record, accuracy & calibration">
          <Icon name="Gauge" size={14} />
          <span className="metric-pill-stack">
            <span className="metric-pill-k">Brier</span>
            <span className="metric-pill-v mono">{m ? m.brier.toFixed(4) : '—'}</span>
          </span>
          {brierEdge != null && (
            <span className={`metric-delta ${brierEdge >= 0 ? 'up' : 'down'} mono`}>
              {brierEdge >= 0 ? '▲' : '▼'} {pct(Math.abs(brierEdge), 0)} vs base
            </span>
          )}
        </button>

        <div className="gen-meta" title={`Generated ${meta.generatedAt}`}>
          <Icon name="Clock" size={13} />
          <span>{timeAgo(meta.generatedAt)}</span>
        </div>

        <button
          className={`toggle-btn auto-btn ${autoRefresh ? 'on' : ''}`}
          onClick={onToggleAuto}
          title="Auto-refresh the slate every 60s (for live games)"
          aria-pressed={autoRefresh}
        >
          <Icon name="Radio" size={14} className={autoRefresh ? 'spin-pulse' : ''} />
          Auto
        </button>

        <button className="icon-btn" onClick={onOpenLegend} title="Legend — grades, signals, stats" aria-label="Legend">
          <Icon name="Info" size={16} />
        </button>

        <button
          className={`icon-btn ${refreshing ? 'refreshing' : ''}`}
          onClick={onRefresh}
          title="Reload slate now"
          aria-label="Reload slate"
        >
          <Icon name="RefreshCw" size={15} />
        </button>
      </div>
    </header>
  )
}
