import Icon from './Icon.jsx'
import { gradeColor, activeBadges, toneColor } from '../lib/badges.js'
import { pct, rate, num } from '../lib/format.js'

export function GradeChip({ grade, size = 'md', score = null }) {
  const label = grade?.label || 'SKIP'
  const color = gradeColor(label)
  return (
    <span
      className={`grade-chip grade-${size} label-${label.toLowerCase()}`}
      style={{
        color,
        borderColor: hexA(color, 0.4),
        background: `linear-gradient(135deg, ${hexA(color, 0.15)} 0%, ${hexA(color, 0.05)} 100%)`,
        boxShadow: `0 4px 12px ${hexA(color, 0.08)}, inset 0 1px 0 rgba(255, 255, 255, 0.05)`,
        textShadow: `0 0 8px ${hexA(color, 0.4)}`,
        fontWeight: '700',
        letterSpacing: '0.05em'
      }}
      title={score != null ? `${label} · model score ${score}/100` : label}
    >
      {label}
      {score != null && (
        <b className="grade-score mono" style={{ color: '#ffffff' }}>
          {Math.round(score)}
        </b>
      )}
    </span>
  )
}

// Compact circular model-score gauge (conic-gradient ring, 0–100) with a premium glowing backdrop
export function ScoreRing({ score = 0, color = 'var(--prime)', size = 64 }) {
  const pctVal = Math.max(0, Math.min(100, score))
  return (
    <div
      className="score-ring"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} ${pctVal * 3.6}deg, rgba(255, 255, 255, 0.05) 0)`,
        boxShadow: `0 0 16px ${hexA(color, 0.15)}`,
        borderRadius: '50%',
        padding: '3px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }}
      title={`Model score ${Math.round(score)}/100`}
    >
      <div 
        className="score-ring-hole" 
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: 'var(--bg)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <span className="score-ring-val mono" style={{ color, fontSize: '13px', fontWeight: '800', lineHeight: 1 }}>
          {Math.round(score)}
        </span>
        <span className="score-ring-cap" style={{ fontSize: '7px', color: 'var(--text-dim)', fontWeight: '700', letterSpacing: '0.08em', marginTop: '2px' }}>SCORE</span>
      </div>
    </div>
  )
}

export function RatingDots({ rating = 0 }) {
  // rating 2..9 — render as a compact 0-10 meter with glowing progress bar
  const filled = Math.round(rating)
  return (
    <span className="rating-meter" title={`Model rating ${rating}/10`}>
      <span 
        className="rating-fill" 
        style={{ 
          width: `${(filled / 10) * 100}%`,
          background: 'linear-gradient(90deg, var(--accent) 0%, var(--prime) 100%)',
          boxShadow: '0 0 8px var(--prime)'
        }} 
      />
    </span>
  )
}

export function ProbBar({ value, max = 0.28, color = 'var(--prime)', showLabel = true }) {
  const w = Math.max(2, Math.min(100, (value / max) * 100))
  return (
    <div className="probbar">
      <div className="probbar-track" style={{ background: 'rgba(255, 255, 255, 0.05)', borderRadius: '99px', height: '6px', overflow: 'hidden' }}>
        <div 
          className="probbar-fill" 
          style={{ 
            width: `${w}%`, 
            background: `linear-gradient(90deg, ${hexA(color, 0.7)} 0%, ${color} 100%)`,
            boxShadow: `0 0 8px ${color}`,
            borderRadius: '99px',
            height: '100%'
          }} 
        />
      </div>
      {showLabel && <span className="probbar-label mono" style={{ fontSize: '12px', fontWeight: '600' }}>{pct(value, 2)}</span>}
    </div>
  )
}

// Semicircle HR-probability gauge — a top half-arc on a track (fills left→right
// to value×100; HR% tops out near ~31), with the whole-number percent beneath
// it in the grade color and a faint glow.
export function ProbRing({ value, color = 'var(--prime)', size = 48 }) {
  const has = value != null && !Number.isNaN(value)
  const pctVal = Math.max(0, Math.min(100, (value || 0) * 100))
  const stroke = 4
  const r = (size - stroke) / 2
  const cx = size / 2
  const cy = size / 2 // flat side (diameter) of the semicircle
  const arc = `M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}` // top semicircle, left→right
  const L = Math.PI * r // arc length of a semicircle
  const dash = (pctVal / 100) * L
  const h = size * 0.82 // crop height: top arc + room for the value below
  return (
    <svg
      className="prob-ring"
      width={size}
      height={h}
      viewBox={`0 0 ${size} ${h}`}
      role="img"
      aria-label={has ? `HR probability ${pct(value, 2)}` : 'No probability'}
      style={{ overflow: 'visible' }}
    >
      <title>{has ? `HR probability ${pct(value, 2)}` : 'No probability'}</title>
      <path className="pr-track" d={arc} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} strokeLinecap="round" />
      {has && (
        <path
          d={arc}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${L}`}
          style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'stroke-dasharray .35s ease' }}
        />
      )}
      <text className="pr-val mono" x={cx} y={cy + size * 0.15} textAnchor="middle" dominantBaseline="central" fill={color} style={{ fontWeight: '800', fontSize: '11px' }}>
        {has ? pctVal.toFixed(2) : '—'}
      </text>
    </svg>
  )
}

export function Badge({ badge }) {
  const b = badge
  return (
    <span
      className="badge"
      data-badge-key={b.key}
      title={b.desc}
      style={{
        borderColor: hexA(b.color, 0.2),
        background: `linear-gradient(135deg, ${hexA(b.color, 0.08)} 0%, rgba(255, 255, 255, 0.01) 100%)`,
        boxShadow: `0 2px 6px ${hexA(b.color, 0.04)}, inset 0 1px 0 rgba(255, 255, 255, 0.04)`
      }}
    >
      <span 
        className="badge-dot" 
        style={{ 
          backgroundColor: b.color,
          boxShadow: `0 0 6px 1px ${b.color}`
        }} 
      />
      <Icon name={b.lucide} size={10} style={{ color: b.color }} />
      <span className="badge-label">{b.label}</span>
    </span>
  )
}

export function BadgeRow({ batter, max = 99 }) {
  const badges = activeBadges(batter).slice(0, max)
  if (!badges.length) return null
  return (
    <span className="badge-row">
      {badges.map((b) => (
        <Badge key={b.key} badge={b} />
      ))}
    </span>
  )
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value mono" style={tone ? { color: toneColor(tone) } : undefined}>
        {value}
      </div>
      {sub != null && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

// Compact stat-line key/value used in the drawer.
export function KV({ k, v, accent }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v mono" style={accent ? { color: accent } : undefined}>
        {v}
      </span>
    </div>
  )
}

export function fmtStatLine(s) {
  if (!s) return null
  return `${rate(s.avg)}/${rate(s.obp ?? null)}/${rate(s.slg)}`
}

// hex (#rrggbb) or CSS var() + alpha
export function hexA(color, a) {
  if (!color) return 'transparent'
  if (color.startsWith('var(') || color.startsWith('color-mix(')) {
    return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`
  }
  if (color[0] !== '#') return color
  const h = color.slice(1)
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

export { pct, rate, num }
