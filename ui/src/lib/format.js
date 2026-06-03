// Display formatters. Keep these pure + boring.

export function pct(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return '—'
  return `${(x * 100).toFixed(digits)}%`
}

export function num(x, digits = 0) {
  if (x == null || Number.isNaN(x)) return '—'
  return Number(x).toFixed(digits)
}

// Baseball "rate" stats are shown without a leading zero: .268
export function rate(x, digits = 3) {
  if (x == null || Number.isNaN(x)) return '—'
  const s = Number(x).toFixed(digits)
  return s.startsWith('0') ? s.slice(1) : s.startsWith('-0') ? '-' + s.slice(2) : s
}

export function american(odds) {
  if (odds == null || Number.isNaN(odds)) return '—'
  return odds > 0 ? `+${odds}` : `${odds}`
}

export function decimalToAmerican(dec) {
  if (!dec || dec <= 1) return null
  return dec >= 2 ? Math.round((dec - 1) * 100) : Math.round(-100 / (dec - 1))
}

export function signedPct(x, digits = 1) {
  if (x == null || Number.isNaN(x)) return '—'
  const v = x * 100
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`
}

export function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x))
}

export function timeAgo(iso) {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const now = Date.now()
  const mins = Math.round((now - then) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function gameTime(iso) {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}
