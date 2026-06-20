import { useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct, num, rate } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

const r3 = (v) => (v == null || Number.isNaN(v) ? '—' : rate(v))
const p0 = (v) => (v == null || Number.isNaN(v) ? '—' : pct(v, 0))
const n1 = (v) => (v == null || Number.isNaN(v) ? '—' : num(v, 1))
const i0 = (v) => (v == null || Number.isNaN(v) ? '—' : String(Math.round(v)))

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

function heatColor(t) {
  if (t == null || Number.isNaN(t)) return 'var(--card-2)'
  const h = 220 - 180 * t
  const s = 45 + 35 * t
  const l = 15 + 25 * t
  return `hsl(${h} ${s}% ${l}%)`
}

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
  const is13 = grid.length >= 13
  return (
    <div className={`zone-grid ${is13 ? 'zone-grid-13' : ''}`} role="img" aria-label="Strike-zone heatmap" style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(5, 1fr)',
      gridTemplateRows: 'repeat(5, 1fr)',
      gap: '4px',
      background: 'rgba(0,0,0,0.2)',
      border: '1px solid rgba(255,255,255,0.06)',
      padding: '6px',
      borderRadius: '12px',
      aspectRatio: '1',
      width: '100%',
      maxWidth: '300px',
      margin: '0 auto'
    }}>
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
            style={{
              ...style,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              borderRadius: '6px',
              position: 'relative',
              border: isMatched ? '2px solid var(--accent)' : 'none',
              boxShadow: isMatched ? '0 0 8px var(--accent-glow)' : 'none'
            }}
            title={isChase ? 'Chase zone' : undefined}
          >
            <span className="zc-v mono" style={{ fontSize: '11px', fontWeight: '800', color: '#fff' }}>{fmt(v)}</span>
            {c?.count != null && <span className="zc-n mono" style={{ fontSize: '8px', color: 'var(--text-faint)', position: 'absolute', bottom: '2px', right: '4px' }}>{c.count}</span>}
          </div>
        )
      })}
    </div>
  )
}

function MetricChips({ metrics, value, onChange }) {
  return (
    <div className="zone-metrics" role="group" aria-label="Metric" style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {metrics.map((m) => (
        <button
          key={m.key}
          className={`badge-toggle ${value === m.key ? 'on' : ''}`}
          onClick={() => onChange(m.key)}
          aria-pressed={value === m.key}
          style={{
            borderColor: value === m.key ? 'var(--accent)' : 'var(--border-soft)',
            background: value === m.key ? 'var(--hover)' : 'transparent',
            color: value === m.key ? '#fff' : 'var(--text-faint)',
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '4px'
          }}
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
    .sort((a, c) => (c.usage ?? 0) - (a.usage ?? 0) || String(a.code).localeCompare(String(c.code)))
  const maxUsage = Math.max(1, ...pitchRows.map((p) => p.usage ?? 0))

  return (
    <div className="zone-page" role="dialog" aria-modal="true" aria-label={`${b?.name} zone matchup`} style={{
      position: 'fixed',
      inset: '0',
      zIndex: '150',
      background: 'var(--bg)',
      padding: '20px',
      overflowY: 'auto'
    }}>
      <header className="zone-head" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        maxWidth: '1000px',
        margin: '0 auto 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        paddingBottom: '14px'
      }}>
        <button className="zone-back" onClick={onClose} aria-label="Back" style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '13px',
          fontWeight: '700',
          color: 'var(--accent)',
          border: '1px solid rgba(0, 216, 246, 0.25)',
          background: 'rgba(0, 216, 246, 0.05)',
          padding: '6px 14px',
          borderRadius: '8px'
        }}>
          <Icon name="ChevronLeft" size={16} />
          Back
        </button>
        <div className="zone-title" style={{ flex: '1', minWidth: '0', marginLeft: '16px' }}>
          <div className="zone-matchup-line" style={{ fontSize: '18px', fontWeight: '800', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span>{b?.name}</span>
            <span className="bathand" style={{ fontSize: '10px', fontFamily: 'var(--mono)', opacity: 0.6 }}>({b?.batSide})</span>
            <span style={{ fontSize: '12px', color: 'var(--text-faint)', fontWeight: '400' }}>vs</span>
            <span>{b?.pitcher?.name || 'TBD'}</span>
            {b?.pitcher?.hand && <span className="phand" style={{ fontSize: '10px', fontFamily: 'var(--mono)', opacity: 0.6 }}>({b.pitcher.hand}HP)</span>}
          </div>
          <div className="zone-sub dim" style={{ fontSize: '12px', marginTop: '2px' }}>
            {b?.team} · {b?.opponent?.abbr ? `@ ${b.opponent.abbr}` : ''}
            {z?.batter?.sampleBIP != null && <span> · {z.batter.sampleBIP} BIP sample</span>}
          </div>
        </div>
        {z?.zoneRating != null && (
          <div className="zone-rating-badge" style={{ 
            borderColor: color, 
            color,
            borderWidth: '1.5px',
            borderStyle: 'solid',
            borderRadius: '10px',
            padding: '4px 12px',
            textAlign: 'center',
            background: hexA(color, 0.06),
            boxShadow: `0 0 10px ${hexA(color, 0.08)}`
          }}>
            <span className="zrb-n mono" style={{ fontSize: '18px', fontWeight: '800', display: 'block' }}>{num(z.zoneRating, 1)}</span>
            <span className="zrb-cap" style={{ fontSize: '7px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' }}>ZONE</span>
          </div>
        )}
      </header>

      <div className="zone-body" style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {!z ? (
          <div className="empty-note" style={{ padding: '64px', textAlign: 'center', color: 'var(--text-faint)' }}>No zone data for this matchup yet.</div>
        ) : (
          <>
            <section className="zone-card" style={{
              background: 'rgba(16, 24, 48, 0.45)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '12px',
              padding: '20px'
            }}>
              <h3 className="zone-h3" style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px', color: '#fff' }}>
                <Icon name="Crosshair" size={14} style={{ color: 'var(--accent)' }} /> Heatmap Matchup
              </h3>
              <p className="zone-explain dim" style={{ fontSize: '12px', marginBottom: '20px', lineHeight: '1.4' }}>
                Where <b>{b?.name}</b> hits (left) vs where <b>{b?.pitcher?.name || 'starter'}</b> throws (right), catcher&apos;s view. Cells highlighted in amber represent the <b>matched zones</b>. {z.matchedZones?.length || 0} matched zones → Zone Rating <b className="mono" style={{ color: 'var(--accent)' }}>{num(z.zoneRating, 1)}</b>.
              </p>

              <div className="zone-pair" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', marginBottom: '16px' }}>
                <div className="zone-side">
                  <div className="zone-side-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span className="zone-side-label" style={{ fontSize: '13px', fontWeight: '700', color: '#fff' }}>Batter Damage</span>
                    <MetricChips metrics={BATTER_METRICS} value={bMetric} onChange={setBMetric} />
                  </div>
                  {z.batter?.grid ? (
                    <Heatmap grid={z.batter.grid} metric={bMetric} fmt={bFmt} matched={z.matchedZones} />
                  ) : (
                    <div className="empty-note">No batter zone grid.</div>
                  )}
                </div>

                <div className="zone-side">
                  <div className="zone-side-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span className="zone-side-label" style={{ fontSize: '13px', fontWeight: '700', color: '#fff' }}>Pitcher Location</span>
                    <MetricChips metrics={PITCHER_METRICS} value={pMetric} onChange={setPMetric} />
                  </div>
                  {z.pitcher?.grid ? (
                    <Heatmap grid={z.pitcher.grid} metric={pMetric} fmt={pFmt} matched={z.matchedZones} />
                  ) : (
                    <div className="empty-note">No pitcher zone grid.</div>
                  )}
                </div>
              </div>
              <div className="zone-legend dim" style={{ fontSize: '11px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '12px' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span className="zl-swatch" style={{ background: heatColor(0.05), width: '12px', height: '12px', borderRadius: '3px' }} /> low
                  <span className="zl-swatch" style={{ background: heatColor(0.95), width: '12px', height: '12px', borderRadius: '3px' }} /> high
                </span>
                <span className="zl-sep">·</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <span className="zl-ring" style={{ width: '10px', height: '10px', borderRadius: '2px', border: '1.5px solid var(--accent)' }} /> matched zone
                </span>
                <span className="zl-sep">·</span>
                <span>small number = batted balls count</span>
              </div>
            </section>

            <section className="zone-card" style={{
              background: 'rgba(16, 24, 48, 0.45)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '12px',
              padding: '20px'
            }}>
              <div className="zone-side-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <h3 className="zone-h3" style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', color: '#fff' }}>
                  <Icon name="Layers" size={14} style={{ color: 'var(--accent)' }} /> Pitch types breakdown
                </h3>
                <div className="zone-metrics" role="group" aria-label="Filter pitch types">
                  {PITCH_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      className={`badge-toggle ${pitchFilter === f.key ? 'on' : ''}`}
                      onClick={() => setPitchFilter(f.key)}
                      aria-pressed={pitchFilter === f.key}
                      style={{
                        borderColor: pitchFilter === f.key ? 'var(--accent)' : 'var(--border-soft)',
                        background: pitchFilter === f.key ? 'var(--hover)' : 'transparent',
                        color: pitchFilter === f.key ? '#fff' : 'var(--text-faint)',
                        fontSize: '10px',
                        padding: '2px 8px',
                        borderRadius: '4px'
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="zone-explain dim" style={{ fontSize: '12px', marginBottom: '16px', lineHeight: '1.4' }}>
                Pitcher&apos;s usage mix vs batter stats (SLG and Whiff rate) per pitch type.
              </p>
              {pitchRows.length ? (
                <div className="pitch-table" style={{ display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', overflow: 'hidden', marginBottom: '16px' }}>
                  <div className="pitch-row pitch-row-head" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1fr 1fr 1fr', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', fontSize: '10px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
                    <span>Pitch</span>
                    <span>Usage</span>
                    <span>Velo</span>
                    <span>Batter SLG</span>
                    <span>Whiff</span>
                  </div>
                  {pitchRows.map((p) => (
                    <div className="pitch-row" key={p.code} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1fr 1fr 1fr', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '12px', alignItems: 'center' }}>
                      <span className="pitch-name" style={{ color: '#fff', fontWeight: '600' }}>{p.label}</span>
                      <span className="pitch-usage" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="pitch-bar-track" style={{ flex: '1', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', overflow: 'hidden' }}>
                          <span
                            className="pitch-bar-fill"
                            style={{ 
                              display: 'block',
                              height: '100%',
                              width: `${((p.usage ?? 0) / maxUsage) * 100}%`,
                              background: 'var(--accent)',
                              borderRadius: '99px',
                              boxShadow: '0 0 6px var(--accent-glow)'
                            }}
                          />
                        </span>
                        <span className="mono" style={{ width: '36px', textAlign: 'right' }}>{p.usage != null ? `${num(p.usage, 0)}%` : '—'}</span>
                      </span>
                      <span className="mono">{p.speed != null ? `${num(p.speed, 0)} mph` : '—'}</span>
                      <span className="mono pitch-slg" style={{ color: 'var(--accent)', fontWeight: '700' }}>{r3(p.bSlg)}</span>
                      <span className="mono">{p.bWhiff != null ? `${num(p.bWhiff, 0)}%` : '—'}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-note" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-faint)' }}>No pitch-type data for this filter.</div>
              )}
              <div className="zone-buckets" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
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
    <div className="zone-bucket" style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.04)',
      borderRadius: '8px',
      padding: '10px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '4px'
    }}>
      <span className="zb-label dim" style={{ fontSize: '11px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="zb-usage mono" style={{ fontSize: '15px', fontWeight: '800', color: '#fff' }}>{usage != null ? `${num(usage, 0)}%` : '—'}</span>
        <span className="zb-slg mono" style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: '700' }}>SLG {r3(slg)}</span>
      </div>
    </div>
  )
}
