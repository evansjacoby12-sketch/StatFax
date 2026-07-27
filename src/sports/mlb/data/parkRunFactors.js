/**
 * Statcast park run factors, where 1.00 is league average.
 *
 * Most parks use Baseball Savant's rolling 2024-2026 `index_runs` value.
 * Sutter Health Park uses 2025-2026 because it does not have a three-year
 * MLB sample. Las Vegas Ballpark is retained as a neutral fallback for the
 * alternate venue entry in stadiums.json.
 */
export const PARK_RUN_FACTOR_SOURCE = {
  provider: 'Baseball Savant Statcast Park Factors',
  metric: 'index_runs',
  defaultPeriod: '2024-2026',
  retrievedAt: '2026-07-27',
}

const FACTORS = {
  'American Family Field': { factor: 0.94, period: '2024-2026' },
  'Angel Stadium': { factor: 1.00, period: '2024-2026' },
  'Busch Stadium': { factor: 0.94, period: '2024-2026' },
  'Camden Yards': { factor: 1.06, period: '2024-2026' },
  'Chase Field': { factor: 1.08, period: '2024-2026' },
  'Citi Field': { factor: 0.98, period: '2024-2026' },
  'Citizens Bank Park': { factor: 1.04, period: '2024-2026' },
  'Comerica Park': { factor: 1.00, period: '2024-2026' },
  'Coors Field': { factor: 1.28, period: '2024-2026' },
  'Daikin Park': { factor: 1.00, period: '2024-2026' },
  'Dodger Stadium': { factor: 1.02, period: '2024-2026' },
  'Fenway Park': { factor: 1.04, period: '2024-2026' },
  'Globe Life Field': { factor: 0.86, period: '2024-2026' },
  'Great American Ball Park': { factor: 1.04, period: '2024-2026' },
  'Kauffman Stadium': { factor: 1.02, period: '2024-2026' },
  'Las Vegas Ballpark': { factor: 1.00, period: 'neutral-fallback' },
  'loanDepot park': { factor: 1.00, period: '2024-2026' },
  'Nationals Park': { factor: 1.04, period: '2024-2026' },
  'Oracle Park': { factor: 0.94, period: '2024-2026' },
  'Petco Park': { factor: 0.94, period: '2024-2026' },
  'PNC Park': { factor: 1.02, period: '2024-2026' },
  'Progressive Field': { factor: 0.98, period: '2024-2026' },
  'Rate Field': { factor: 0.96, period: '2024-2026' },
  'Rogers Centre': { factor: 1.02, period: '2024-2026' },
  'Sutter Health Park': { factor: 1.23, period: '2025-2026' },
  'Target Field': { factor: 1.06, period: '2024-2026' },
  'T-Mobile Park': { factor: 0.83, period: '2024-2026' },
  'Tropicana Field': { factor: 0.94, period: '2024-2026' },
  'Truist Park': { factor: 1.00, period: '2024-2026' },
  'Wrigley Field': { factor: 0.94, period: '2024-2026' },
  'Yankee Stadium': { factor: 1.02, period: '2024-2026' },
}

const ALIASES = {
  'oriole park at camden yards': 'Camden Yards',
  'uniqlo field at dodger stadium': 'Dodger Stadium',
}

function normalize(value) {
  return String(value || '').trim().toLowerCase()
}

export function parkRunFactorForVenue(venueName) {
  const normalized = normalize(venueName)
  const canonical = ALIASES[normalized]
    || Object.keys(FACTORS).find((name) => normalize(name) === normalized)
  if (!canonical) return null
  return {
    ...FACTORS[canonical],
    venue: canonical,
    source: PARK_RUN_FACTOR_SOURCE.provider,
  }
}

export const PARK_RUN_FACTORS = Object.freeze(FACTORS)
