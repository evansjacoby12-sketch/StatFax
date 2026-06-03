/**
 * Primary accent color for each MLB team, keyed by MLB Stats API team ID.
 * Used for the left (away) and right (home) strips on game cards.
 */
export const TEAM_COLORS = {
  108: '#BA0021', // LAA Angels       — red
  109: '#A71930', // ARI Diamondbacks — red
  110: '#DF4601', // BAL Orioles      — orange
  111: '#BD3039', // BOS Red Sox      — red
  112: '#0E3386', // CHC Cubs         — blue
  113: '#C6011F', // CIN Reds         — red
  114: '#E31937', // CLE Guardians    — red
  115: '#9B5EA2', // COL Rockies      — purple
  116: '#FA4616', // DET Tigers       — orange
  117: '#EB6E1F', // HOU Astros       — orange
  118: '#004687', // KC  Royals       — blue
  119: '#005A9C', // LAD Dodgers      — blue
  120: '#AB0003', // WSH Nationals    — red
  121: '#002D72', // NYM Mets         — blue
  133: '#003831', // OAK Athletics    — green
  134: '#FDB827', // PIT Pirates      — gold
  135: '#C9A96E', // SD  Padres       — sand
  136: '#005C5C', // SEA Mariners     — teal
  137: '#FD5A1E', // SF  Giants       — orange
  138: '#C41E3A', // STL Cardinals    — red
  139: '#8FBCE6', // TB  Rays         — sky blue
  140: '#003278', // TEX Rangers      — blue
  141: '#134A8E', // TOR Blue Jays    — blue
  142: '#002B5C', // MIN Twins        — navy
  143: '#E81828', // PHI Phillies     — red
  144: '#CE1141', // ATL Braves       — red
  145: '#C4CED4', // CWS White Sox    — silver
  146: '#00A3E0', // MIA Marlins      — teal
  147: '#003087', // NYY Yankees      — navy
  158: '#FFC52F', // MIL Brewers      — gold
};

export function getTeamColor(teamId) {
  return TEAM_COLORS[teamId] || '#666666';
}

/** Convert a hex color + 0–1 opacity into an rgba() string. */
export function hexToRgba(hex, opacity) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}
