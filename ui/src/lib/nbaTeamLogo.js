const ESPN_LOGO_ABBR = {
  NOP: 'no',
  UTA: 'utah',
  WAS: 'wsh',
  GSW: 'gs',
  NYK: 'ny',
  SAS: 'sa',
  BKN: 'bkn',
};

/** Build ordered image sources with ESPN's actual short codes before giving up to initials. */
export function nbaTeamLogoCandidates(team, suppliedUrl = null) {
  const abbr = String(team?.abbr || team || '').trim().toUpperCase();
  const providerAbbr = ESPN_LOGO_ABBR[abbr] || abbr.toLowerCase();
  const canonicalAbbr = abbr.toLowerCase();
  const urls = [
    suppliedUrl,
    `https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${providerAbbr}.png`,
    providerAbbr === canonicalAbbr ? null : `https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${canonicalAbbr}.png`,
  ].filter(Boolean);
  return [...new Set(urls)];
}

export function nbaTeamLogoLabel(team) {
  const abbr = String(team?.abbr || team || '').trim().toUpperCase();
  return abbr || 'NBA';
}
