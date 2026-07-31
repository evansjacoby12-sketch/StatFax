// Shared UI constants. Kept in one place so the board, the games view, and the
// filter bar never drift (e.g. the "hot bat" threshold and the sort vocabulary
// used to live in two files each).

// heatIndex ≥ this counts as a "hot bat" — drives both the Hot-only filter and
// the inline heat badge in the games view.
export const HOT_HEAT = 58

// Sort options shown in the Filters dropdown.
export const SORTS = [
  { key: 'hrProbability', label: 'HR Probability' },
  { key: 'score', label: 'Model Score' },
  { key: 'heat', label: 'Heat Index' },
  { key: 'air', label: 'Air Pull' },
  { key: 'battingOrder', label: 'Lineup Spot' },
  { key: 'zone', label: 'Zone Hitter' },
]

// Sort keys that should default to descending when first selected (bigger = better).
export const DESC_BY_DEFAULT = new Set(['hrProbability', 'score', 'rating', 'heat', 'edge', 'expectedHRs', 'zone', 'air'])

export const DEFAULT_FILTERS = {
  q: '',
  // Open on the decision tier. WATCH/LEAN/SKIP remain one click away in filters.
  grades: new Set(['PRIME', 'STRONG']),
  gamePks: new Set(),
  confirmedOnly: false,
  watchedOnly: false,
  hotOnly: false,
  precisionOnly: false,
  sleepersOnly: false,
  badges: new Set(),
  sort: 'hrProbability',
  dir: 'desc',
}
