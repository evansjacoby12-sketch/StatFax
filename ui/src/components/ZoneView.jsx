import { useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct, num, rate } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'

// ── formatters ────────────────────────────────────────────────────────────
const r3 = (v) => (v == null || Number.isNaN(v) ? '—' : rate(v))
const p0 = (v) => (v == null || Number.isNaN(v) ? '—' : pct(v, 0))
const n1 = (v) => (v == null || Number.isNaN(v) ? '—' : num(v, 1))
const i0 = (v) => (v == null || Number.isNaN(v) ? '—' : String(Math.round(v)))

// Which metric paints each heatmap — the "ISO / SLG / etc." filter.
const BATTER_METRICS = [
  { key: 'iso', label: 'ISO', fmt: r3 },
  { key: 'slg', label: 'SLG', fmt: r3 },
  { key: 'ops', label: 'OPS', fmt: r3 },
  { key: 'avg', label: 'AVG', fmt: r3 },
  { key: 'ev', label: 'EV', fmt: n1 },
  { key: 'hrCount', label: 'HR', fmt: i0 },
]
const PITCHER_METRICS = [
  { key: 'freq', label: 'Usage', fmt: p0 },
  { key: 'xwoba', label: 'xwOBA', fmt: r3 },
  { key: 'hardHitPct', label: 'Hard%', fmt: p0 },
  { key: 'whiffPct', label: 'Whiff%', fmt: p0 },
  { key: 'hrCount', label: 'HR', fmt: i0 },
]

// Statcast pitch codes → display + bucket (cutter rides with the fastballs).
const PITCHES = [
  { code: 'ff', label: '4-Seam', bucket: 'fastball' },
  { code: 'si', label: 'Sinker', bucket: 'fastball' },
  { code: 'fc', label: 'Cutter', bucket: 'fastball' },
  { code: 'sl', label: 'Slider', bucket: 'breaking' },
  { code: 'cu', label: 'Curve', bucket: 'breaking' },
  { code: 'kc', label: 'Knuckle-Curve', bucket: 'breaking' },
  { code: 'ch', label: 'Changeup', bucket: 'offspeed' },
  { code: 'fs', label: 'Splitter', bucket: 'offspeed' },
]
const PITCH_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'fastball', label: 'Fastballs' },
  { key: 'breaking', label: 'Breaking' },
  { key: 'offspeed', label: 'Offspeed' },
]

// 0 (cool/low) → 1 (hot/high). Warmer = bigger value, consistently on both grids.
function heatColor(t) {
  if (t == null || Number.isNaN(t)) return 'var(--card-2)'
  const h = 220 - 200 * t
  const s = 45 + 35 * t
  const l = 18 + 22 * t
  return `hsl(${h} ${s}% ${l}%)`
}

// 5×5 placement for the 13-zone grid: indices 0-8 = the 3×3 strike zone
// (center), 9-12 = the four outer "chase" corners (MLB zones 11-14).
const ZONE_POS = [
  [2, 2], [2, 3], [2, 4],
  [3, 2], [3, 3], [3, 4],
  [4, 2], [4, 3], [4, 4],
  [1, 1], [1, 5], [5, 1], [5, 5],
]

function Heatmap({ grid, metric, fmt, matched }) {
  const vals = grid.map((c) => c?.[metric]).filter((v) => Number.isFinite(v))
  const min = vals.length ? Math.min(...vals) : 0
  const max = vals.length ? Math.max(...vals) : 1
  const is13 = grid.length >= 13 // 13-zone (3×3 + chase) vs legacy 3×3
  return (
    <div className={`zone-grid ${is13 ? 'zone-grid-13' : ''}`} role="img" aria-label="Strike-zone heatmap with chase zones, catcher's view">
      {grid.map((c, i) => {
        const v = c?.[metric]
        const t = Number.isFinite(v) && max > min ? (v - min) / (max - min) : null
        const isMatched = matched?.includes(i)
        const isChase = is13 && i >= 9
        const style = { background: heatColor(t) }
        if (is13) {
          const [r, col] = ZONE_POS[i] || [0, 0]
          style.gridRow = r
          style.gridColumn = col
        }
        return (
          <div
            key={i}
            className={`zone-cell ${isMatched ? 'matched' : ''} ${isChase ? 'zone-chase' : ''}`}
            style={style}
            title={isChase ? 'Chase zone (outside the strike zone)' : undefined}
          >
            <span className="zc-v mono">{fmt(v)}</span>
            {c?.count != null && <span className="zc-n mono">{c.count}</span>}
          </div>
        )
      })}
    </div>
  )
}

function MetricChips({ metrics, value, onChange }) {
  return (
    <div className="zone-metrics" role="group" aria-label="Metric">
      {metrics.map((m) => (
        <button
          key={m.key}
          className={`badge-toggle ${value === m.key ? 'on' : ''}`}
          onClick={() => onChange(m.key)}
          aria-pressed={value === m.key}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

export default function ZoneView({ batter: b, onClose }) {
  const [bMetric, setBMetric] = useState('iso')
  const [pMetric, setPMetric] = useState('freq')
  const [pitchFilter, setPitchFilter] = useState('all')

  const z = b?.zoneMatchup
  const color = gradeColor(b?.grade?.label || 'SKIP')

  const bFmt = BATTER_METRICS.find((m) => m.key === bMetric)?.fmt || r3
  const pFmt = PITCHER_METRICS.find((m) => m.key === pMetric)?.fmt || r3

  // Pitch-type rows the pitcher actually throws, filtered by bucket.
  const arsenal = b?.arsenal || {}
  const mix = b?.pitchMix || {}
  const pitchRows = PITCHES
    .map((p) => ({
      ...p,
      usage: mix[`${p.code}Pct`] ?? null,
      bSlg: arsenal[`${p.code}Slg`] ?? null,
      bWhiff: arsenal[`${p.code}Whiff`] ?? null,
      speed: mix.shape?.[p.code]?.speed ?? null,
    }))
    .filter((p) => (p.usage ?? 0) > 0)
    .filter((p) => pitchFilter === 'all' || p.bucket === pitchFilter)
    .sort((a, c) => (c.usage ?? 0) - (a.usage ?? 0))
  const maxUsage = Math.max(1, ...pitchRows.map((p) => p.usage ?? 0))

  return (
    <div className="zone-page" role="dialog" aria-modal="true" aria-label={`${b?.name} zone matchup`}>
      <header className="zone-head">
        <button className="zone-back" onClick={onClose} aria-label="Back">
          <Icon name="ChevronRight" size={18} className="zone-back-ico" />
          Back
        </button>
        <div className="zone-title">
          <div className="zone-matchup-line">
            <b>{b?.name}</b>
            <span className="bathand">{b?.batSide}</span>
            <span className="zone-vs">vs</span>
            <b>{b?.pitcher?.name || 'TBD'}</b>
            {b?.pitcher?.hand && <span className="phand">{b.pitcher.hand}HP</span>}
          </div>
          <div className="zone-sub dim">
            {b?.team} · {b?.opponent?.abbr ? `@ ${b.opponent.abbr}` : ''}
            {z?.batter?.sampleBIP != null && <span> · {z.batter.sampleBIP} BIP sample</span>}
          </div>
        </div>
        {z?.zoneRating != null && (
          <div className="zone-rating-badge" style={{ borderColor: color, color }}>
            <span className="zrb-n mono">{num(z.zoneRating, 1)}</span>
            <span className="zrb-cap">ZONE</span>
          </div>
        )}
      </header>

      <div className="zone-body">
        {!z ? (
          <div className="empty-note">No zone data for this matchup yet.</div>
        ) : (
          <>
            <section className="zone-card">
              <h3 className="zone-h3">
                <Icon name="Crosshair" size={14} /> Matchup
              </h3>
              <p className="zone-explain dim">
                Where <b>{b?.name}</b> does damage (left) vs. where <b>{b?.pitcher?.name || 'the pitcher'}</b> lives
                (right), catcher&apos;s view. Cells ringed in amber are the <b>matched zones</b> — the pitcher works
                spots this batter punishes. {z.matchedZones?.length || 0} matched → Zone Rating{' '}
                <b className="mono">{num(z.zoneRating, 1)}</b>
                {z.badge === 'ZONE_MASTER' && <span className="zone-master-tag"> · ZONE MASTER</span>}.
              </p>

              <div className="zone-pair">
                <div className="zone-side">
                  <div className="zone-side-head">
                    <span className="zone-side-label">Batter damage</span>
                    <MetricChips metrics={BATTER_METRICS} value={bMetric} onChange={setBMetric} />
                  </div>
                  {z.batter?.grid ? (
                    <Heatmap grid={z.batter.grid} metric={bMetric} fmt={bFmt} matched={z.matchedZones} />
                  ) : (
                    <div className="empty-note">No batter zone grid.</div>
                  )}
                </div>

                <div className="zone-side">
                  <div className="zone-side-head">
                    <span className="zone-side-label">Pitcher location</span>
                    <MetricChips metrics={PITCHER_METRICS} value={pMetric} onChange={setPMetric} />
                  </div>
                  {z.pitcher?.grid ? (
                    <Heatmap grid={z.pitcher.grid} metric={pMetric} fmt={pFmt} matched={z.matchedZones} />
                  ) : (
                    <div className="empty-note">No pitcher zone grid.</div>
                  )}
                </div>
              </div>
              <div className="zone-legend dim">
                <span className="zl-swatch" style={{ background: heatColor(0.05) }} /> low
                <span className="zl-swatch" style={{ background: heatColor(0.95) }} /> high
                <span className="zl-sep">·</span>
                <span className="zl-ring" /> matched zone <span className="zl-sep">·</span> small number = batted balls
              </div>
            </section>

            <section className="zone-card">
              <div className="zone-side-head">
                <h3 className="zone-h3">
                  <Icon name="Layers" size={14} /> Pitch types
                </h3>
                <div className="zone-metrics" role="group" aria-label="Filter pitch types">
                  {PITCH_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      className={`badge-toggle ${pitchFilter === f.key ? 'on' : ''}`}
                      onClick={() => setPitchFilter(f.key)}
                      aria-pressed={pitchFilter === f.key}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="zone-explain dim">
                Zone grids are aggregate, so pitch type is its own lens: the starter&apos;s usage vs. how hard{' '}
                {b?.name} hits each pitch (SLG) and how often he misses (whiff).
              </p>
              {pitchRows.length ? (
                <div className="pitch-table">
                  <div className="pitch-row pitch-row-head">
                    <span>Pitch</span>
                    <span>Usage</span>
                    <span>Velo</span>
                    <span>Batter SLG</span>
                    <span>Whiff</span>
                  </div>
                  {pitchRows.map((p) => (
                    <div className="pitch-row" key={p.code}>
                      <span className="pitch-name">{p.label}</span>
                      <span className="pitch-usage">
                        <span className="pitch-bar-track">
                          <span
                            className="pitch-bar-fill"
                            style={{ width: `${((p.usage ?? 0) / maxUsage) * 100}%` }}
                          />
                        </span>
                        <span className="mono">{p.usage != null ? `${num(p.usage, 0)}%` : '—'}</span>
                      </span>
                      <span className="mono">{p.speed != null ? `${num(p.speed, 0)}` : '—'}</span>
                      <span className="mono pitch-slg">{r3(p.bSlg)}</span>
                      <span className="mono">{p.bWhiff != null ? `${num(p.bWhiff, 0)}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-note">No pitch-type data for this filter.</div>
              )}
              <div className="zone-buckets">
                <Bucket label="Fastballs" usage={mix.fastballPct} slg={arsenal.fastballSlg} />
                <Bucket label="Breaking" usage={mix.breakingPct} slg={arsenal.breakingSlg} />
                <Bucket label="Offspeed" usage={mix.offspeedPct} slg={arsenal.offspeedSlg} />
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  )
}

function Bucket({ label, usage, slg }) {
  return (
    <div className="zone-bucket">
      <span className="zb-label dim">{label}</span>
      <span className="zb-usage mono">{usage != null ? `${num(usage, 0)}%` : '—'}</span>
      <span className="zb-slg mono">SLG {r3(slg)}</span>
    </div>
  )
}
