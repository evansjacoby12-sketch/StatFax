import Icon from './Icon.jsx'
import { pct, num } from '../lib/format.js'
import { gradeColor, GRADE_ORDER } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

export default function ModelPanel({ meta, onClose }) {
  const m = meta.modelMetrics
  const ens = meta.ensembleMeta
  if (!m) {
    return (
      <ModalShell onClose={onClose}>
        <p className="dim">No model metrics in this slate.</p>
      </ModalShell>
    )
  }
  const brierImp = (m.baselineBrier - m.brier) / m.baselineBrier
  const llImp = (m.baselineLogLoss - m.logLoss) / m.baselineLogLoss

  return (
    <ModalShell onClose={onClose}>
      <div className="model-head">
        <h2>
          <Icon name="Gauge" size={18} /> Model calibration
        </h2>
        <div className="model-sub dim">
          {num(m.totalReconciled)} graded picks · {m.windowDays}-day window · base rate {pct(m.baseRate, 1)}
        </div>
      </div>

      <div className="model-kpis">
        <Kpi label="Brier score" value={m.brier.toFixed(4)} delta={brierImp} deltaLabel="vs baseline" good="lower" />
        <Kpi label="Log loss" value={m.logLoss.toFixed(4)} delta={llImp} deltaLabel="vs baseline" good="lower" />
        {ens && (
          <Kpi
            label="Ensemble"
            value={`${pct(ens.mlWeight, 0)} ML`}
            sub={ens.reason}
            plain
          />
        )}
      </div>

      <div className="model-cols">
        <div className="model-col">
          <h3 className="section-title">
            <Icon name="Activity" size={14} /> Reliability
          </h3>
          <ReliabilityChart bins={m.reliability || []} />
          <p className="chart-cap dim">
            Points on the dashed line = perfectly calibrated. Above = model under-predicts; below = over-predicts.
            Dot size ∝ sample count.
          </p>
        </div>

        <div className="model-col">
          <h3 className="section-title">
            <Icon name="BarChart3" size={14} /> Accuracy by tier
          </h3>
          <div className="tier-bars">
            {GRADE_ORDER.map((t) => {
              const bt = m.brierByTier?.[t]
              const n = m.perTierCount?.[t]
              if (bt == null) return null
              const w = Math.max(4, Math.min(100, (bt / 0.3) * 100))
              return (
                <div className="tier-bar" key={t}>
                  <div className="tier-bar-head">
                    <span style={{ color: gradeColor(t) }}>{t}</span>
                    <span className="mono dim">
                      {bt.toFixed(3)} · n={n ?? '—'}
                    </span>
                  </div>
                  <div className="tier-bar-track">
                    <div
                      className="tier-bar-fill"
                      style={{ width: `${w}%`, background: gradeColor(t) }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="chart-cap dim">Brier per grade (lower is better). PRIME picks fire more often, so their Brier sits higher by design.</p>
        </div>
      </div>
    </ModalShell>
  )
}

function ReliabilityChart({ bins }) {
  const W = 320
  const H = 240
  const pad = { l: 38, r: 12, t: 12, b: 34 }
  const iw = W - pad.l - pad.r
  const ih = H - pad.t - pad.b
  const maxX = Math.max(0.3, ...bins.map((b) => b.avgPredicted), ...bins.map((b) => b.observedRate)) * 1.05
  const x = (v) => pad.l + (v / maxX) * iw
  const y = (v) => pad.t + ih - (v / maxX) * ih
  const maxN = Math.max(1, ...bins.map((b) => b.n || 0))
  const ticks = [0, 0.1, 0.2, 0.3].filter((t) => t <= maxX)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="reliability" role="img" aria-label="Reliability diagram">
      {/* grid */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={pad.t} x2={x(t)} y2={pad.t + ih} className="grid" />
          <line x1={pad.l} y1={y(t)} x2={pad.l + iw} y2={y(t)} className="grid" />
          <text x={x(t)} y={H - 12} className="axis-lbl" textAnchor="middle">
            {Math.round(t * 100)}%
          </text>
          <text x={pad.l - 6} y={y(t) + 3} className="axis-lbl" textAnchor="end">
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}
      {/* perfect-calibration diagonal */}
      <line x1={x(0)} y1={y(0)} x2={x(maxX)} y2={y(maxX)} className="diag" />
      {/* connecting line */}
      <polyline
        className="rel-line"
        points={bins.map((b) => `${x(b.avgPredicted)},${y(b.observedRate)}`).join(' ')}
      />
      {/* points */}
      {bins.map((b, i) => (
        <circle
          key={i}
          cx={x(b.avgPredicted)}
          cy={y(b.observedRate)}
          r={4 + 7 * Math.sqrt((b.n || 0) / maxN)}
          className="rel-pt"
        >
          <title>
            predicted {pct(b.avgPredicted, 1)} → observed {pct(b.observedRate, 1)} (n={b.n})
          </title>
        </circle>
      ))}
      <text x={pad.l + iw / 2} y={H - 1} className="axis-title" textAnchor="middle">
        predicted
      </text>
    </svg>
  )
}

function Kpi({ label, value, delta, deltaLabel, good, sub, plain }) {
  const better = good === 'lower' ? delta > 0 : delta > 0
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value mono">{value}</div>
      {!plain && delta != null && (
        <div className={`kpi-delta mono ${better ? 'up' : 'down'}`}>
          {better ? '▲' : '▼'} {pct(Math.abs(delta), 0)} {deltaLabel}
        </div>
      )}
      {sub && <div className="kpi-sub dim">{sub}</div>}
    </div>
  )
}

function ModalShell({ children, onClose }) {
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
          <Icon name="X" size={18} />
        </button>
        {children}
      </div>
    </>
  )
}
