import { createContext, useContext } from 'react'

// Global "explain like I'm…" depth for every explanation surface on the site
// (board reason line, the drawer "Why" section, Pick of the Day). One source of
// truth so the whole app speaks at the same level. Persisted in App via
// store.load/save('eliLevel'). Defaults to the friendliest tier.
//
//   eli5  → plain English, no jargon   (b.eli5Reasons — pre-written, tone + icon)
//   eli15 → the stats behind the call  (b.reasons — the model's stat lines)
export const EliLevelContext = createContext('eli5')

export function useEliLevel() {
  return useContext(EliLevelContext)
}

export const ELI_LEVELS = [
  { key: 'eli5', label: 'ELI5', long: "Explain like I'm 5", blurb: 'Plain English — no jargon.' },
  { key: 'eli15', label: 'ELI15', long: "Explain like I'm 15", blurb: 'The stats behind the call.' },
]

export function nextEliLevel(level) {
  return level === 'eli5' ? 'eli15' : 'eli5'
}

// Normalize a batter's reasons to a single {text, tone, icon} shape at the
// chosen depth. eli5Reasons already carry tone + icon; the stat `reasons` are
// bare strings, so we wrap them with a neutral tone + activity glyph.
export function reasonsForLevel(b, level) {
  if (level === 'eli15') {
    return (b?.reasons || []).map((t) => ({ text: t, tone: 'neutral', icon: 'activity' }))
  }
  return b?.eli5Reasons || []
}

// The single headline reason used on the board row / Pick of the Day.
export function topReasonForLevel(b, level) {
  if (level === 'eli15') return b?.reasons?.[0] || b?.eli5Reasons?.[0]?.text || null
  return b?.eli5Reasons?.[0]?.text || b?.reasons?.[0] || null
}
