import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'
import { pct, num, rate } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { hexA } from './atoms.jsx'
import { locationRating5, arsenalRating5 as arsenalRating5Of } from '../lib/zoneEdge.js'
import { pitchLeagueSlg } from '../lib/scout.js'
import { buildZoneMatchup, effectiveBatterSide, ZONE_MODEL_VERSION } from '../../../src/sports/mlb/logic/zoneMatchup.js'

const r3 = (v) => (v == null || Number.isNaN(v) ? '—' : rate(v))
const p0 = (v) => (v == null || Number.isNaN(v) ? '—' : pct(v, 0))
const n1 = (v) => (v == null || Number.isNaN(v) ? '—' : num(v, 1))
const i0 = (v) => (v == null || Number.isNaN(v) ? '—' : String(Math.round(v)))

// Order mirrors the requested spec. Capability-gating (hasMetric, below) hides
// any metric the loaded grid doesn't carry yet, so this list can run ahead of
// the server data — new chips light up automatically once a zone refetch lands.
const BATTER_METRICS = [
  { key: 'iso', label: 'ISO', fmt: r3 },
  { key: 'slg', label: 'SLG', fmt: r3 },
  { key: 'avg', label: 'AVG', fmt: r3 },
  { key: 'xwoba', label: 'wOBA', fmt: r3 },
  { key: 'hardHitPct', label: 'HH%', fmt: p0 },
  { key: 'barrelPct', label: 'BRL', fmt: p0 },
  { key: 'ev', label: 'EV', fmt: n1 },
]
const PITCHER_METRICS = [
  { key: 'freq', label: 'Location', fmt: p0 },
  { key: 'iso', label: 'ISO', fmt: r3 },
  { key: 'slg', label: 'SLG', fmt: r3 },
  { key: 'avg', label: 'AVG', fmt: r3 },
  { key: 'xwoba', label: 'wOBA', fmt: r3 },
  { key: 'hardHitPct', label: 'HH%', fmt: p0 },
  { key: 'barrelPct', label: 'BRL', fmt: p0 },
  { key: 'ev', label: 'EV', fmt: n1 },
  { key: 'whiffPct', label: 'Whiff', fmt: p0 },
]
// Pitcher batting-line metrics are sparse per zone (few batted balls allowed),
// so we surface a small-sample caveat when one of them is the active lens.
const PITCHER_SPARSE = new Set(['iso', 'slg', 'avg'])

const PITCHES = [
  { code: 'ff', label: '4-Seam', bucket: 'fastball' },
  { code: 'si', label: 'Sinker', bucket: 'fastball' },
  { code: 'fc', label: 'Cutter', bucket: 'fastball' },
  { code: 'sl', label: 'Slider', bucket: 'breaking' },
  { code: 'st', label: 'Sweeper', bucket: 'breaking' },
  { code: 'sv', label: 'Slurve', bucket: 'breaking' },
  { code: 'cu', label: 'Curve', bucket: 'breaking' },
  { code: 'kc', label: 'Knuckle-Curve', bucket: 'breaking' },
  { code: 'ch', label: 'Changeup', bucket: 'offspeed' },
  { code: 'fs', label: 'Splitter', bucket: 'offspeed' },
  { code: 'kn', label: 'Knuckleball', bucket: 'offspeed' },
]
const PITCH_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'fastball', label: 'Fastballs' },
  { key: 'breaking', label: 'Breaking' },
  { key: 'offspeed', label: 'Offspeed' },
]

// Catcher's view, top-row = up in the zone. "Heart" = dead-center (1).
const ZONE_NAMES = [
  'Up & Left', 'Up', 'Up & Right', 'Left', 'Heart', 'Right', 'Low & Left', 'Low', 'Low & Right',
  'Up-left chase', 'Up-right chase', 'Low-left chase', 'Low-right chase',
]

// Cool→hot ramp tuned for the dark theme: muted blue (cold) → red-orange (hot).
function heatColor(t) {
  if (t == null || Number.isNaN(t)) return 'rgba(148,163,184,0.05)'
  const h = 220 - 208 * t
  const s = 42 + 48 * t
  const l = 15 + 31 * t
  return `hsl(${h} ${s}% ${l}%)`
}

// Returns a min-max normalizer over the finite values (single-value → 0.5).
function normalizer(vals) {
  const fin = vals.filter((v) => Number.isFinite(v))
  if (!fin.length) return () => null
  const min = Math.min(...fin)
  const max = Math.max(...fin)
  return (v) => (!Number.isFinite(v) ? null : max > min ? (v - min) / (max - min) : 0.5)
}

// A metric is "available" only if at least one zone in the grid carries a real
// value for it — lets the UI offer the full metric list but show only the lenses
// the current data actually supports.
const hasMetric = (grid, key) => Array.isArray(grid) && grid.some((c) => Number.isFinite(c?.[key]))

const MODES = [
  { key: 'attack', label: 'Attack', icon: 'Focus' },
  { key: 'batter', label: 'Batter', icon: 'User' },
  { key: 'pitcher', label: 'Pitcher', icon: 'Radar' },
]

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
            padding: '2px 7px',
            borderRadius: '5px',
          }}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

// The framed 3×3 strike zone with a home-plate base for orientation.
function ZoneStrike({ cells, mode, bFmt, pFmt, selectedCell, onSelect, priorityByIndex }) {
  return (
    <div className="z3-frame" style={{ width: '100%', maxWidth: '410px', margin: '0 auto' }}>
      <div className="z3-stage" style={{ position: 'relative', padding: '4px 4px 0' }}>
        <div
          className="z3-grid"
          role="img"
          aria-label="Strike-zone 3 by 3 attack map"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gridTemplateRows: 'repeat(3, 1fr)',
            gap: '5px',
            aspectRatio: '1 / 1',
            padding: '7px',
            borderRadius: '14px',
            background: 'rgba(0,0,0,0.28)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.03), 0 6px 18px rgba(0,0,0,0.35)',
          }}
        >
          {cells.map((c) => {
            const t = mode === 'attack' ? c.edgeT : mode === 'batter' ? c.bT : c.pT
            const big = mode === 'attack' ? r3(c.iso) : mode === 'batter' ? bFmt(c.bVal) : pFmt(c.pVal)
            const sub =
              mode === 'attack'
                ? c.usage != null ? p0(c.usage) : null
                : c.count != null && c.count > 0 ? `${c.count}` : null
            return (
              <button
                type="button"
                key={c.i}
                className={`z3-cell state-${c.state} ${c.matched ? 'matched' : ''}${selectedCell?.i === c.i ? ' selected' : ''}`}
                onClick={() => onSelect(c.i)}
                aria-pressed={selectedCell?.i === c.i}
                aria-label={`${c.name}, ${big}${sub != null ? `, ${sub}` : ''}, ${c.state}`}
                title={`${c.name}${c.iso != null ? ` · adjusted ISO ${r3(c.iso)}` : ''}${c.locationRatio != null ? ` · ${num(c.locationRatio, 2)}× location baseline` : ''}${c.count ? ` · ${c.count} BIP` : ''}`}
                style={{
                  position: 'relative',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1px',
                  borderRadius: '9px',
                  background: heatColor(t),
                  border: '1px solid rgba(255,255,255,0.06)',
                  cursor: 'pointer',
                }}
              >
                {priorityByIndex.has(c.i) && <span className="z3-priority mono">{priorityByIndex.get(c.i)}</span>}
                {c.matched && (
                  <span className="z3-flame" aria-hidden="true">
                    <Icon name="Flame" size={9} />
                  </span>
                )}
                {!c.matched && c.relative && <span className="z3-state-mark mono" aria-hidden="true">R</span>}
                <span className="z3-val mono" title={c.lowSample ? 'Small sample — shrunk toward season' : undefined} style={{ fontSize: '14px', fontWeight: '800', color: '#fff', lineHeight: 1, textShadow: '0 1px 3px rgba(0,0,0,0.5)', opacity: c.lowSample ? 0.5 : 1, fontStyle: c.lowSample ? 'italic' : 'normal' }}>{big}</span>
                {sub != null && <span className="z3-sub mono" style={{ fontSize: '8.5px', fontWeight: '600', color: 'rgba(255,255,255,0.62)', lineHeight: 1 }}>{mode === 'attack' ? sub : `${sub} BIP`}</span>}
              </button>
            )
          })}
        </div>
      </div>
      {/* home plate */}
      <svg viewBox="0 0 120 22" width="64" style={{ display: 'block', margin: '2px auto 0' }} aria-hidden="true">
        <polygon points="10,2 110,2 110,11 60,20 10,11" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
      </svg>
      <div className="z3-view dim" style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text-faint)', marginTop: '2px' }}>Catcher&apos;s view</div>
    </div>
  )
}

function EvidencePriorityCard({ label, cell, rank, tone = 'attack', onSelect }) {
  if (!cell) return null
  return (
    <button type="button" className={`attack-priority-card ${tone}`} onClick={() => onSelect?.(cell.i)}>
      <span className="attack-priority-rank mono">{rank}</span>
      <span className="attack-priority-copy"><small>{label}</small><strong>{cell.name}</strong></span>
      <span className="attack-priority-data mono"><b>{r3(cell.iso)}</b>{cell.locationRatio != null && <small>{num(cell.locationRatio, 2)}× loc</small>}</span>
      <Icon name="ChevronRight" size={14} />
    </button>
  )
}

export default function ZoneView({ batter: b, onClose }) {
  const [mode, setMode] = useState('attack')
  const [bMetric, setBMetric] = useState('iso')
  const [pMetric, setPMetric] = useState('freq')
  const [pitchFilter, setPitchFilter] = useState('all')
  const [selectedZone, setSelectedZone] = useState(null)
  const [arsenalOpen, setArsenalOpen] = useState(false)

  const z = b?.zoneMatchup
  const color = gradeColor(b?.grade?.label || 'SKIP')

  // Only offer the metric lenses the loaded grids actually carry. If the
  // selected metric isn't available (e.g. old cached zone data), fall back to
  // the first available one so the map never goes blank.
  const bMetricsAvail = BATTER_METRICS.filter((m) => hasMetric(z?.batter?.grid, m.key))
  const pMetricsAvail = PITCHER_METRICS.filter((m) => hasMetric(z?.pitcher?.grid, m.key))
  const bMetricEff = bMetricsAvail.some((m) => m.key === bMetric) ? bMetric : (bMetricsAvail[0]?.key || 'iso')
  const pMetricEff = pMetricsAvail.some((m) => m.key === pMetric) ? pMetric : (pMetricsAvail[0]?.key || 'freq')
  const bFmt = BATTER_METRICS.find((m) => m.key === bMetricEff)?.fmt || r3
  const pFmt = PITCHER_METRICS.find((m) => m.key === pMetricEff)?.fmt || r3

  // New snapshots already contain the canonical evidence. Rebuild only legacy
  // payloads so the UI never revives the retired min-max matcher while a slate
  // refresh is rolling out.
  const zoneEvidence = useMemo(() => {
    if ((z?.modelVersion ?? 0) >= ZONE_MODEL_VERSION && Array.isArray(z?.cellEvidence)) return z
    if (!Array.isArray(z?.batter?.grid) || !Array.isArray(z?.pitcher?.grid)) return null
    const pitcherHand = b?.pitcher?.hand === 'L' ? 'L' : 'R'
    const side = effectiveBatterSide(b?.batSide, pitcherHand)
    const rebuilt = buildZoneMatchup(
      { ...z.batter, batSide: b?.batSide, effectiveSide: side },
      { ...z.pitcher, pitcherHand, vsHand: side },
      { effectiveBatterSide: side, pitcherHand },
    )
    // A legacy switch-hitter payload was fetched against the wrong stance, so
    // it remains limited until the next v2 server refresh rather than claiming
    // a verified attack from mismatched data.
    if (rebuilt && b?.batSide === 'S') {
      return {
        ...rebuilt,
        attackZones: [],
        matchedZones: [],
        badge: null,
        reliability: { ...rebuilt.reliability, status: 'limited', label: 'Refresh required', reason: 'Legacy switch-hitter location split; waiting for the corrected stance feed.' },
      }
    }
    return rebuilt
  }, [z, b?.batSide, b?.pitcher?.hand])

  const rating5 = locationRating5(zoneEvidence)

  // Display lenses can normalize their own color ramp, but Attack mode consumes
  // the server's absolute 0–100 evidence score and qualification state exactly.
  const cells = useMemo(() => {
    const bGrid = z?.batter?.grid
    const pGrid = z?.pitcher?.grid
    if (!Array.isArray(bGrid) && !Array.isArray(pGrid)) return null
    const evidenceByIndex = new Map((zoneEvidence?.cellEvidence || []).map((cell) => [cell.index, cell]))
    const attacks = new Set(zoneEvidence?.attackZones || [])
    const relatives = new Set(zoneEvidence?.relativeZones || [])
    const chases = new Set(zoneEvidence?.chaseZones || [])
    const bSel = Array.from({ length: 13 }, (_, i) => bGrid?.[i]?.[bMetricEff])
    const pSel = Array.from({ length: 13 }, (_, i) => pGrid?.[i]?.[pMetricEff])
    const bN = normalizer(bSel.slice(0, 9))
    const pN = normalizer(pSel.slice(0, 9))

    return Array.from({ length: 13 }, (_, i) => {
      const evidence = evidenceByIndex.get(i) || {}
      const matched = attacks.has(i)
      const chase = chases.has(i)
      const relative = relatives.has(i)
      return {
        i,
        name: ZONE_NAMES[i],
        bVal: bGrid?.[i]?.[bMetricEff],
        pVal: pGrid?.[i]?.[pMetricEff],
        iso: evidence.adjustedISO ?? null,
        rawISO: evidence.rawISO ?? bGrid?.[i]?.iso ?? null,
        usage: evidence.pitcherFreq ?? pGrid?.[i]?.freq ?? null,
        count: evidence.batterCount ?? bGrid?.[i]?.count ?? null,
        locationRatio: evidence.locationRatio ?? null,
        leagueFreq: evidence.leagueFreq ?? null,
        attackScore: evidence.attackScore ?? 0,
        sampleStatus: evidence.sampleStatus || 'unavailable',
        lowSample: evidence.sampleStatus !== 'reliable',
        bT: bN(bSel[i]),
        pT: pN(pSel[i]),
        edgeT: Number.isFinite(evidence.attackScore) ? evidence.attackScore / 100 : null,
        matched,
        chase,
        relative,
        state: matched ? 'attack' : chase ? 'chase' : relative ? 'relative' : evidence.sampleStatus === 'reliable' ? 'avoid' : 'limited',
      }
    })
  }, [z, zoneEvidence, bMetricEff, pMetricEff])

  const strikeCells = cells?.slice(0, 9) || []
  const cellAt = (index) => (cells || []).find((cell) => cell.i === index)
  const attackZones = (zoneEvidence?.attackZones || []).map(cellAt).filter(Boolean)
  const relativeZones = (zoneEvidence?.relativeZones || []).map(cellAt).filter(Boolean)
  const chaseZones = (zoneEvidence?.chaseZones || []).map(cellAt).filter(Boolean)
  const avoidCell = strikeCells
    .filter((cell) => cell.state === 'avoid')
    .slice()
    .sort((a, c) => a.attackScore - c.attackScore)[0] || null
  const selectedCell = cellAt(selectedZone) || attackZones[0] || relativeZones[0] || strikeCells[4] || null
  const priorityByIndex = new Map(attackZones.map((cell, index) => [cell.i, index + 1]))

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

  // ② Arsenal edge rating — usage-weighted (batter SLG − league SLG) across the
  // pitcher's WHOLE mix (unfiltered), so the headline reflects the pitch-type
  // edge the location rating is blind to. Same 0–5 scale.
  const allPitches = useMemo(() => PITCHES
    .map((p) => ({ code: p.code, key: p.code, label: p.label, usage: mix[`${p.code}Pct`] ?? null, bSlg: arsenal[`${p.code}Slg`] ?? null, leagueSlg: arsenal.leagueSlg?.[p.code] ?? null }))
    .filter((p) => (p.usage ?? 0) > 0), [mix, arsenal])
  const bestPitchEdge = allPitches
    .filter((p) => Number.isFinite(p.bSlg) && (p.usage ?? 0) >= 8)
    .map((p) => ({ ...p, edge: p.bSlg - pitchLeagueSlg(p) }))
    .sort((a, c) => c.edge - a.edge)[0] || null
  // Arsenal rating via the shared helper (identical to the drawer teaser). Blind
  // spot + coverage stay local — they need per-pitch detail beyond the rating.
  const arsenalRating5 = useMemo(() => arsenalRating5Of(b), [b])
  const { blindSpot, coverage } = useMemo(() => {
    let coveredUsage = 0, totalUsage = 0
    for (const p of allPitches) {
      totalUsage += p.usage
      if (Number.isFinite(p.bSlg)) coveredUsage += p.usage
    }
    const top = allPitches.slice().sort((a, c) => (c.usage ?? 0) - (a.usage ?? 0))[0]
    return {
      blindSpot: top && !Number.isFinite(top.bSlg) ? top : null,
      coverage: totalUsage > 0 ? Math.min(1, coveredUsage / 100) : null,
    }
  }, [allPitches])
  // One-line plain-English read, keeping location and pitch-type research as
  // distinct evidence instead of collapsing them into one optimistic score.
  const synthesis = useMemo(() => {
    const parts = []
    const ranked = allPitches
      .filter((p) => Number.isFinite(p.bSlg) && (p.usage ?? 0) >= 8)
      .map((p) => ({ ...p, edge: p.bSlg - pitchLeagueSlg(p) }))
      .sort((a, c) => c.edge - a.edge)
    const best = ranked[0]
    if (best && best.edge > 0.06) parts.push(`Feasts on the ${best.label.toLowerCase()} (${r3(best.bSlg)}, ${Math.round(best.usage)}% usage)`)
    const topZone = attackZones[0]
    if (topZone) parts.push(`${attackZones.length} verified strike-zone attack${attackZones.length > 1 ? 's' : ''}; strongest is ${topZone.name}`)
    else parts.push('No strike-zone cell clears every evidence gate')
    if (blindSpot) parts.push(`but no book on his #1 pitch (${Math.round(blindSpot.usage)}% ${blindSpot.label.toLowerCase()})`)
    if (!parts.length) return null
    return parts.join(' · ').replace(/^./, (m) => m.toUpperCase()) + '.'
  }, [allPitches, attackZones, blindSpot])

  const pHand = b?.pitcher?.hand ? `${b.pitcher.hand}HP` : null
  const modeCaption =
    mode === 'attack'
      ? <>Absolute evidence from adjusted batter ISO, handedness-specific pitcher exposure, and sample gates. Flame = a <b>verified strike-zone attack</b>; a bright cell alone is not enough.</>
      : mode === 'batter'
        ? <>Batter hot/cold zones — where <b>{b?.name}</b> ({b?.batSide}HB) does damage, by <b>{BATTER_METRICS.find((m) => m.key === bMetricEff)?.label}</b>. Small number = batted balls in that zone.</>
        : <>Pitcher location — where <b>{b?.pitcher?.name || 'the starter'}</b>{pHand ? <> ({pHand})</> : null} works, by <b>{PITCHER_METRICS.find((m) => m.key === pMetricEff)?.label}</b>.{PITCHER_SPARSE.has(pMetricEff) && <span style={{ color: 'var(--prime)' }}> Small sample per zone — read as a tendency, not a number.</span>}</>

  // Mode-aware heat scale: hot/cold for the batter, frequency for the pitcher.
  const scaleLabel =
    mode === 'batter' ? 'Cold → Hot'
    : mode === 'pitcher' ? (pMetricEff === 'freq' ? 'Rare → Frequent' : 'Low → High')
    : 'Evidence: 0 → 100'

  return (
    <div className="zone-page" role="dialog" aria-modal="true" aria-label={`${b?.name} zone matchup`} style={{
      position: 'fixed',
      inset: '0',
      zIndex: '150',
      background: 'var(--bg)',
      padding: 'calc(20px + env(safe-area-inset-top, 0px)) 20px calc(20px + env(safe-area-inset-bottom, 0px))',
      overflowY: 'auto',
    }}>
      <header className="zone-head" style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        maxWidth: '1000px',
        margin: '0 auto 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        paddingBottom: '14px',
        gap: '12px',
      }}>
        <button className="zone-back" onClick={onClose} aria-label="Back" style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '13px',
          fontWeight: '700',
          color: 'var(--accent)',
          border: '1px solid rgba(151, 149, 203, 0.25)',
          background: 'rgba(151, 149, 203, 0.05)',
          padding: '6px 14px',
          borderRadius: '8px',
          flexShrink: 0,
        }}>
          <Icon name="ChevronLeft" size={16} />
          Back
        </button>
        <div className="zone-title" style={{ flex: '1', minWidth: '0' }}>
          <div className="zone-matchup-line" style={{ fontSize: '17px', fontWeight: '800', color: '#fff', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
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
        {rating5 != null && (
          <div className="zone-rating-badge" title="Advisory location tendency versus the handedness baseline" style={{
            borderColor: color,
            color,
            borderWidth: '1.5px',
            borderStyle: 'solid',
            borderRadius: '10px',
            padding: '4px 12px',
            textAlign: 'center',
            background: hexA(color, 0.06),
            boxShadow: `0 0 10px ${hexA(color, 0.08)}`,
            flexShrink: 0,
          }}>
            <span className="zrb-n mono" style={{ fontSize: '18px', fontWeight: '800', display: 'block' }}>{rating5}<span style={{ fontSize: '9px', opacity: 0.6 }}>/5</span></span>
            <span className="zrb-cap" style={{ fontSize: '7px', fontWeight: '700', letterSpacing: '0.08em', textTransform: 'uppercase' }}>LOCATION</span>
          </div>
        )}
      </header>

      <div className="zone-body" style={{ maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {!z || !cells ? (
          <div className="empty-note" style={{ padding: '64px', textAlign: 'center', color: 'var(--text-faint)' }}>No zone data for this matchup yet.</div>
        ) : (
          <>
            <section className="zone-card" style={{
              background: 'rgba(17, 18, 20, 0.45)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: '14px',
              padding: '20px',
            }}>
              <div className="zone-blueprint-head">
                <h3 className="zone-h3" style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', color: '#fff' }}>
                  <Icon name="Focus" size={14} style={{ color: 'var(--accent)' }} /> Attack Blueprint
                  <span className="zone-advisory-chip">
                    {b?.zonePowerCollision?.applied ? 'Included in HR%' : 'Evidence only'}
                  </span>
                </h3>
                <div className="zone-blueprint-controls">
                  <CommandTabs
                    className="z3-seg"
                    variant="compact"
                    label="Map mode"
                    value={mode}
                    onChange={setMode}
                    tabs={MODES.map((item) => ({ ...item, id: item.key, iconSize: 11 }))}
                    ariaPressed
                  />
                  {(mode === 'batter' || mode === 'pitcher') && (
                    mode === 'batter'
                      ? <MetricChips metrics={bMetricsAvail} value={bMetricEff} onChange={setBMetric} />
                      : <MetricChips metrics={pMetricsAvail} value={pMetricEff} onChange={setPMetric} />
                  )}
                </div>
              </div>

              <p className="zone-explain dim" style={{ fontSize: '12px', marginBottom: '16px', lineHeight: '1.45', minHeight: '34px' }}>
                {modeCaption}
              </p>

              <div className="blueprint-score-ribbon">
                <div className="primary"><small>Verified attacks</small><strong className="mono" style={{ color: attackZones.length ? 'var(--strong)' : 'var(--text)' }}>{attackZones.length}</strong></div>
                <div><small>Location tendency</small><strong className="mono">{rating5 ?? '—'}<span>/5</span></strong></div>
                <div><small>Reliability</small><strong>{zoneEvidence?.reliability?.label || 'Unknown'}</strong></div>
                <div><small>Separate arsenal</small><strong className="mono">{arsenalRating5 ?? '—'}<span>/5</span></strong></div>
              </div>

              <div className="z3-wrap blueprint-layout">
                <div>
                  <ZoneStrike cells={strikeCells} mode={mode} bFmt={bFmt} pFmt={pFmt} selectedCell={selectedCell} onSelect={setSelectedZone} priorityByIndex={priorityByIndex} />
                </div>

                <div className="z3-readout" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div className="blueprint-matchup-read">
                    <div className="blueprint-read-label"><Icon name="Sparkles" size={12} /> Matchup read</div>
                    <p>{synthesis}</p>
                    {!attackZones.length && <div className="zone-no-attack"><Icon name="ShieldCheck" size={12} /> No verified attack — research the relative tendencies, but do not treat one as qualified.</div>}
                    <div className="blueprint-read-facts">
                      <span><small>Best pitch edge</small><b>{bestPitchEdge ? `${bestPitchEdge.label} · ${r3(bestPitchEdge.bSlg)}` : 'No qualified edge'}</b></span>
                      <span className={blindSpot ? 'warn' : ''}><small>Unknown</small><b>{blindSpot ? `${blindSpot.label} · ${Math.round(blindSpot.usage)}% use` : 'Pitch book covered'}</b></span>
                    </div>
                  </div>

                  {selectedCell && (
                    <div className={`selected-zone-read${selectedCell.lowSample ? ' low-sample' : ''}`}>
                      <div className="selected-zone-head"><span>Selected zone</span><strong>{selectedCell.name}</strong></div>
                      <div className="selected-zone-stats">
                        <span><small>Adjusted ISO</small><b className="mono">{r3(selectedCell.iso)}</b></span>
                        <span><small>Pitcher use</small><b className="mono">{selectedCell.usage != null ? p0(selectedCell.usage) : '—'}</b></span>
                        <span><small>Vs baseline</small><b className="mono">{selectedCell.locationRatio != null ? `${num(selectedCell.locationRatio, 2)}×` : '—'}</b></span>
                        <span><small>Sample</small><b className="mono">{selectedCell.count != null ? `${selectedCell.count} BIP` : '—'}</b></span>
                      </div>
                      <p>{selectedCell.state === 'attack'
                        ? 'Verified attack: adjusted ISO and pitcher exposure both clear the published gates.'
                        : selectedCell.state === 'chase'
                          ? 'Chase opportunity: supported overlap outside the strike zone; kept separate from attack zones.'
                          : selectedCell.state === 'relative'
                            ? 'Relative tendency only: one or more absolute attack gates are still short.'
                            : selectedCell.state === 'avoid'
                              ? 'Avoid: supported data, but the damage/exposure overlap is not favorable.'
                              : 'Limited evidence: this cell cannot be qualified.'}</p>
                      <div className={`selected-zone-state ${selectedCell.state}`}>{selectedCell.state === 'attack' ? 'Verified attack' : selectedCell.state === 'chase' ? 'Chase opportunity' : selectedCell.state === 'relative' ? 'Relative tendency' : selectedCell.state === 'avoid' ? 'Avoid' : 'Limited sample'}</div>
                      {selectedCell.lowSample && <div className="selected-zone-warning"><Icon name="TriangleAlert" size={11} /> {zoneEvidence?.reliability?.reason || 'Cell sample is below the evidence minimum.'}</div>}
                    </div>
                  )}

                  <div className="attack-priority-list">
                    <div className="attack-priority-title"><Icon name="Layers" size={12} /> Evidence ladder</div>
                    {attackZones.slice(0, 2).map((cell, index) => <EvidencePriorityCard key={`attack-${cell.i}`} label={index === 0 ? 'Verified attack' : 'Secondary attack'} cell={cell} rank={String(index + 1)} onSelect={setSelectedZone} />)}
                    {!attackZones.length && <div className="attack-priority-empty">No strike-zone cell clears ISO .200, 1.10× exposure, and sample gates.</div>}
                    {relativeZones[0] && <EvidencePriorityCard label="Relative tendency" cell={relativeZones[0]} rank="R" tone="relative" onSelect={setSelectedZone} />}
                    {chaseZones[0] && <EvidencePriorityCard label="Chase opportunity" cell={chaseZones[0]} rank="C" tone="chase" onSelect={setSelectedZone} />}
                    {avoidCell && <EvidencePriorityCard label="Avoid" cell={avoidCell} rank="!" tone="avoid" onSelect={setSelectedZone} />}
                  </div>

                  <div className="z3-legend dim" style={{ fontSize: '11px', display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', color: 'var(--text-faint)' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ display: 'inline-flex', borderRadius: '3px', overflow: 'hidden' }}>
                        {[0.05, 0.4, 0.7, 0.95].map((t) => <span key={t} style={{ width: '11px', height: '11px', background: heatColor(t), display: 'inline-block' }} />)}
                      </span>
                      {scaleLabel}
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: '11px', height: '11px', borderRadius: '3px', border: '1.5px solid var(--prime)', boxShadow: '0 0 6px rgba(198,154,87,0.5)' }} /> verified attack
                    </span>
                    <span>R = relative only · C = chase · ! = avoid</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="zone-card arsenal-disclosure">
              <button type="button" className="arsenal-summary" onClick={() => setArsenalOpen((open) => !open)} aria-expanded={arsenalOpen}>
                <span><Icon name="ChartSpline" size={14} /> Arsenal · pitch types</span>
                <span>{b?.pitcher?.name}{pHand ? ` (${pHand})` : ''}</span>
                <Icon name="ChevronDown" size={15} className="arsenal-chevron" />
              </button>
              {arsenalOpen && (
              <div className="arsenal-content">
              <div className="zone-side-head arsenal-filter-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <span className="arsenal-filter-label">Pitch family</span>
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
                        borderRadius: '4px',
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="zone-explain dim" style={{ fontSize: '12px', marginBottom: '12px', lineHeight: '1.4' }}>
                Pitcher&apos;s usage mix vs batter stats (SLG and Whiff rate) per pitch type.
              </p>
              {blindSpot && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 12px', marginBottom: '14px', borderRadius: '8px', background: 'rgba(198,154,87,0.08)', border: '1px solid rgba(198,154,87,0.22)', color: 'var(--prime)', fontSize: '12px', lineHeight: 1.4 }}>
                  <Icon name="TriangleAlert" size={14} style={{ flexShrink: 0 }} />
                  <span>
                    <b>No book on his #1 pitch</b> — {b?.name?.split(' ').slice(-1)[0] || 'the batter'} has no tracked SLG vs {b?.pitcher?.name?.split(' ').slice(-1)[0] || 'the starter'}&apos;s {blindSpot.label.toLowerCase()} ({Math.round(blindSpot.usage)}% of his pitches). A real unknown in this matchup.
                  </span>
                </div>
              )}
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
                      <span className="pitch-name" data-label="Pitch" style={{ color: '#fff', fontWeight: '600' }}>{p.label}</span>
                      <span className="pitch-usage" data-label="Usage" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="pitch-bar-track" style={{ flex: '1', height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', overflow: 'hidden' }}>
                          <span
                            className="pitch-bar-fill"
                            style={{
                              display: 'block',
                              height: '100%',
                              width: `${((p.usage ?? 0) / maxUsage) * 100}%`,
                              background: 'var(--accent)',
                              borderRadius: '99px',
                              boxShadow: '0 0 6px var(--accent-glow)',
                            }}
                          />
                        </span>
                        <span className="mono" style={{ width: '36px', textAlign: 'right' }}>{p.usage != null ? `${num(p.usage, 0)}%` : '—'}</span>
                      </span>
                      <span className="mono" data-label="Velo">{p.speed != null ? `${num(p.speed, 0)} mph` : '—'}</span>
                      <span className="mono pitch-slg" data-label="Batter SLG" style={{ color: 'var(--accent)', fontWeight: '700' }}>{r3(p.bSlg)}</span>
                      <span className="mono" data-label="Whiff">{p.bWhiff != null ? `${num(p.bWhiff, 0)}%` : '—'}</span>
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
              </div>
              )}
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
      gap: '4px',
    }}>
      <span className="zb-label dim" style={{ fontSize: '11px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="zb-usage mono" style={{ fontSize: '15px', fontWeight: '800', color: '#fff' }}>{usage != null ? `${num(usage, 0)}%` : '—'}</span>
        <span className="zb-slg mono" style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: '700' }}>SLG {r3(slg)}</span>
      </div>
    </div>
  )
}
