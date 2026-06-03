// Team colors (MLB Stats API team id → primary accent) + logo URLs.
// Colors mirror src/data/teamColors.js in the brain.

export const TEAM_COLORS = {
  108: '#BA0021', // LAA
  109: '#A71930', // ARI
  110: '#DF4601', // BAL
  111: '#BD3039', // BOS
  112: '#0E3386', // CHC
  113: '#C6011F', // CIN
  114: '#E31937', // CLE
  115: '#9B5EA2', // COL
  116: '#FA4616', // DET
  117: '#EB6E1F', // HOU
  118: '#004687', // KC
  119: '#005A9C', // LAD
  120: '#AB0003', // WSH
  121: '#002D72', // NYM
  133: '#003831', // OAK / ATH
  134: '#FDB827', // PIT
  135: '#C9A96E', // SD
  136: '#005C5C', // SEA
  137: '#FD5A1E', // SF
  138: '#C41E3A', // STL
  139: '#8FBCE6', // TB
  140: '#003278', // TEX
  141: '#134A8E', // TOR
  142: '#002B5C', // MIN
  143: '#E81828', // PHI
  144: '#CE1141', // ATL
  145: '#C4CED4', // CWS
  146: '#00A3E0', // MIA
  147: '#003087', // NYY
  158: '#FFC52F', // MIL
}

export function teamColor(teamId) {
  return TEAM_COLORS[teamId] || '#5b6b80'
}

// Crisp scalable team logo (transparent SVG). Falls back gracefully if missing.
export function teamLogo(teamId) {
  return teamId ? `https://www.mlbstatic.com/team-logos/${teamId}.svg` : null
}

// Player headshot. The `d_people:generic:headshot` default means a missing
// player resolves to a silhouette rather than a broken image.
export function playerHeadshot(playerId, w = 120) {
  return playerId
    ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_${w},q_auto:best/v1/people/${playerId}/headshot/67/current`
    : null
}

export function hexToRgba(hex, a) {
  if (!hex || hex[0] !== '#') return hex
  const h = hex.slice(1)
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16)
  const g = parseInt(n.slice(2, 4), 16)
  const b = parseInt(n.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

// Relative luminance → pick readable text color over a team-colored fill.
export function readableOn(hex) {
  if (!hex || hex[0] !== '#') return '#fff'
  const h = hex.slice(1)
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.6 ? '#0a0f16' : '#ffffff'
}
