import Icon from './Icon.jsx'
import { gradeColor, activeBadges, toneColor } from '../lib/badges.js'
import { pct, rate, num } from '../lib/format.js'

export function GradeChip({ grade, size = 'md', score = null }) {
  const label = grade?.label || 'SKIP'
  const color = grade?.color || gradeColor(label)
  return (
    <span
      className={`grade-chip grade-${size}`}
      style={{ color, borderColor: hexA(color, 0.45), background: hexA(color, 0.12) }}
      title={score != null ? `${label} · model score ${score}/100` : label}
    >
      {label}
      {score != null && <b className="grade-score mono">{Math.round(score)}</b>}
    </span>
  )
}

// Compact circular model-score gauge (conic-gradient ring, 0–100).
export function ScoreRing({ score = 0, color = 'var(--prime)', size = 64 }) {
  const pctVal = Math.max(0, Math.min(100, score))
  return (
    <div
      className="score-ring"
      style={{
        width: size,
        height: size,
        background: `conic-gradient(${color} ${pctVal * 3.6}deg, var(--card-2) 0)`,
      }}
      title={`Model score ${Math.round(score)}/100`}
    >
      <div className="score-ring-hole">
        <span className="score-ring-val mono" style={{ color }}>
          {Math.round(score)}
        </span>
        <span className="score-ring-cap">SCORE</span>
      </div>
    </div>
  )
}

export function RatingDots({ rating = 0 }) {
  // rating 2..9 — render as a compact 0-10 meter
  const filled = Math.round(rating)
  return (
    <span className="rating-meter" title={`Model rating ${rating}/10`}>
      <span className="rating-fill" style={{ width: `${(filled / 10) * 100}%` }} />
    </span>
  )
}

export function ProbBar({ value, max = 0.28, color = 'var(--prime)', showLabel = true }) {
  const w = Math.max(2, Math.min(100, (value / max) * 100))
  return (
    <div className="probbar">
      <div className="probbar-track">
        <div className="probbar-fill" style={{ width: `${w}%`, background: color }} />
      </div>
      {showLabel && <span className="probbar-label mono">{pct(value, 1)}</span>}
    </div>
  )
}

export function BadgeRow({ batter, max = 99 }) {
  const badges = activeBadges(batter).slice(0, max)
  if (!badges.length) return null
  return (
    <span className="badge-row">
      {badges.map((b) => (
        <span
          key={b.key}
          className="badge"
          title={b.desc}
          style={{ color: b.color, borderColor: 'color-mix(in srgb, ' + b.color + ' 40%, transparent)' }}
        >
          <Icon name={b.lucide} size={11} />
          {b.label}
        </span>
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

// hex (#rrggbb) + alpha → rgba()
export function hexA(hex, a) {
  if (!hex || hex[0] !== '#') return hex
  const h = hex.slice(1)
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

export { pct, rate, num }
