export const PRIME_CAP_SCORE_FLOOR = 72;
export const PRIME_CAP_PER_GAME = 1.5;
export const PRIME_CAP_MIN = 2;

function gradeOf(row) {
  return row?.grade?.label || row?.grade || null;
}

function rowKey(row) {
  if (row?.playerId == null) return null;
  return `${row.playerId}-${row.gamePk ?? 'unknown'}`;
}

export function primeCapForGames(gameCount, { multiplier = 1, minimum = PRIME_CAP_MIN } = {}) {
  const games = Math.max(0, Math.trunc(Number(gameCount) || 0));
  if (!games) return 0;
  const safeMultiplier = Math.max(0.25, Math.min(1.25, Number(multiplier) || 1));
  const safeMinimum = Math.max(0, Math.trunc(Number(minimum) || 0));
  return Math.max(safeMinimum, Math.round(games * PRIME_CAP_PER_GAME * safeMultiplier));
}

export function planGameNormalizedPrimeCap(scoredBatters = {}, gameCount = 0, options = {}) {
  const seen = new Set();
  const uniqueRows = [];

  for (const row of Object.values(scoredBatters || {})) {
    const key = rowKey(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueRows.push(row);
  }

  const cap = primeCapForGames(gameCount, options);
  const rawPrime = uniqueRows.filter((row) => gradeOf(row) === 'PRIME');
  const eligiblePrime = rawPrime
    .filter((row) => Number.isFinite(row.score) && row.score >= PRIME_CAP_SCORE_FLOOR)
    .sort((a, b) => (b.score - a.score)
      || ((a.playerId ?? 0) - (b.playerId ?? 0))
      || ((a.gamePk ?? 0) - (b.gamePk ?? 0)));
  const belowFloor = rawPrime.filter((row) => !Number.isFinite(row.score) || row.score < PRIME_CAP_SCORE_FLOOR);
  const overflow = eligiblePrime.slice(cap);
  const demoteKeys = new Set([...belowFloor, ...overflow].map(rowKey));

  return {
    cap,
    multiplier: Math.max(0.25, Math.min(1.25, Number(options?.multiplier) || 1)),
    minimum: Math.max(0, Math.trunc(Number(options?.minimum ?? PRIME_CAP_MIN) || 0)),
    gameCount: Math.max(0, Math.trunc(Number(gameCount) || 0)),
    rawPrimeCount: rawPrime.length,
    eligiblePrimeCount: eligiblePrime.length,
    retainedCount: Math.min(eligiblePrime.length, cap),
    demotedCount: demoteKeys.size,
    belowFloorCount: belowFloor.length,
    demoteKeys,
  };
}

/**
 * Apply the final PRIME label cap in place. Scores and probabilities are never
 * changed, and non-PRIME rows are never promoted just to fill the allowance.
 */
export function applyGameNormalizedPrimeCap(
  scoredBatters = {},
  gameCount = 0,
  strongGrade = 'STRONG',
  options = {},
) {
  const plan = planGameNormalizedPrimeCap(scoredBatters, gameCount, options);
  if (!plan.demotedCount) return plan;

  for (const row of Object.values(scoredBatters || {})) {
    const key = rowKey(row);
    if (key && plan.demoteKeys.has(key) && gradeOf(row) === 'PRIME') row.grade = strongGrade;
  }
  return plan;
}
