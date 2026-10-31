const normalizeName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s+(jr|sr|ii|iii|iv|v)$/, '');

/** Blend recent first-two-possession shot share into season role conservatively. */
export function blendRecentOpeningRole(starters, recentRole) {
  const last5 = recentRole?.last5;
  const last10 = recentRole?.last10;
  const valid = [last5, last10].every(window => Number.isFinite(Number(window?.sampleGames)) && Number(window.sampleGames) >= 0 &&
    Number.isFinite(Number(window?.shotCount)) && Number(window.shotCount) >= 0 && window?.byPlayer && typeof window.byPlayer === 'object');
  const currentShares = starters.map(player => Math.max(0, Number(player.earlyShotShare) || 0));
  const currentTotal = currentShares.reduce((sum, share) => sum + share, 0);
  const normalizedPrior = currentTotal > 0 ? currentShares.map(share => share / currentTotal) : starters.map(() => 1 / Math.max(1, starters.length));
  const minimumGames = Number(last10?.sampleGames) || 0;
  if (!valid || minimumGames < 5 || !(Number(last10?.shotCount) > 0)) {
    return starters.map((player, index) => ({ ...player, earlyShotShare: normalizedPrior[index], openingRoleRecent: {
      applied: false, source: valid ? 'pbpstats_recent_opening_possessions' : 'unavailable',
      last5Games: Number(last5?.sampleGames) || 0, last10Games: minimumGames,
      last5Share: null, last10Share: null, blendWeight: 0,
    } }));
  }
  const shareInWindow = window => {
    const counts = starters.map(player => Math.max(0, Number(window.byPlayer[normalizeName(player.name)]) || 0));
    const total = counts.reduce((sum, count) => sum + count, 0);
    return total > 0 ? counts.map(count => count / total) : null;
  };
  const share5 = shareInWindow(last5);
  const share10 = shareInWindow(last10);
  if (!share10) return starters.map((player, index) => ({ ...player, earlyShotShare: normalizedPrior[index], openingRoleRecent: {
    applied: false, source: 'pbpstats_recent_opening_possessions', last5Games: Number(last5.sampleGames) || 0,
    last10Games: minimumGames, last5Share: null, last10Share: null, blendWeight: 0,
  } }));

  // Give L10 the larger say because L5 is especially noisy in this low-volume event.
  const trend = share5
    ? share5.map((share, index) => 0.35 * share + 0.65 * share10[index])
    : share10;
  const blendWeight = 0.10 * Math.min(1, minimumGames / 10);
  const blended = normalizedPrior.map((share, index) => share * (1 - blendWeight) + trend[index] * blendWeight);
  const total = blended.reduce((sum, share) => sum + share, 0) || 1;
  return starters.map((player, index) => ({
    ...player,
    earlyShotShare: blended[index] / total,
    openingRoleRecent: {
      applied: true, source: 'pbpstats_recent_opening_possessions',
      last5Games: Number(last5.sampleGames) || 0, last10Games: minimumGames,
      last5Share: share5?.[index] ?? null, last10Share: share10[index], blendWeight,
    },
  }));
}
