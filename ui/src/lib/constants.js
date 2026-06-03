// Shared UI constants. Kept in one place so the board, the games view, and the
// filter bar never drift (e.g. the "hot bat" threshold and the sort vocabulary
// used to live in two files each).
import { GRADE_ORDER } from './badges.js'

// heatIndex ≥ this counts as a "hot bat" — drives both the Hot-only filter and
// the inline heat badge in the games view.
export const HOT_HEAT = 58

// Sort options shown in the Filters dropdown.
export const SORTS = [
  { key: 'hrProbability', label: 'HR Probability' },
  { key: 'score', label: 'Model Score' },
  { key: 'heat', label: 'Heat Index' },
  { key: 'battingOrder', label: 'Lineup Spot' },
  { key: 'zone', label: 'Zone Hitter' },
]

// Sort keys that should default to descending when first selected (bigger = better).
export const DESC_BY_DEFAULT = new Set(['hrProbability', 'score', 'rating', 'heat', 'edge', 'expectedHRs', 'zone'])

export const DEFAULT_FILTERS = {
  q: '',
  grades: new Set(GRADE_ORDER),
  gamePk: '',
  confirmedOnly: false,
  watchedOnly: false,
  hotOnly: false,
  badges: new Set(),
  sort: 'hrProbability',
  dir: 'desc',
}
