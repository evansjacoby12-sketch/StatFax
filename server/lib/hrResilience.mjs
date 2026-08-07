const DAY_MS = 86_400_000;

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const round = (value, digits = 3) => (
  Number.isFinite(value) ? +Number(value).toFixed(digits) : null
);

function parseDate(value) {
  const time = Date.parse(`${String(value || '')}T12:00:00Z`);
  return Number.isFinite(time) ? time : null;
}

function daysBetween(earlier, later) {
  const a = parseDate(earlier);
  const b = parseDate(later);
  return a == null || b == null ? null : Math.round((b - a) / DAY_MS);
}

function historyDates(backtestLog) {
  return [...new Set([
    ...(backtestLog?.modelHistory?.dates || []),
    ...(backtestLog?.settledDates || []),
    ...(backtestLog?.dates || []),
    ...Object.keys(backtestLog?.modelHistory?.records || {}),
    ...Object.keys(backtestLog?.records || {}),
  ])].filter((date) => parseDate(date) != null).sort();
}

/**
 * Decay short-window form after a real calendar interruption, then recover it
 * over the next four settled slate days. This is deliberately calendar-based:
 * no post-break outcome from the target day can leak into its own score.
 */
export function buildCalendarGapFormDecay(backtestLog, slateDate) {
  const priorDates = historyDates(backtestLog).filter((date) => date < slateDate);
  if (!priorDates.length) {
    return {
      weight: 1,
      status: 'collecting',
      latestSettledDate: null,
      calendarGapDays: null,
      recoverySlateDay: null,
      breakStartDate: null,
      returnDate: null,
    };
  }

  const timeline = [...priorDates, slateDate];
  let lastBreakIndex = -1;
  let breakGapDays = null;
  for (let index = 1; index < timeline.length; index++) {
    const gap = daysBetween(timeline[index - 1], timeline[index]);
    if (gap != null && gap >= 3) {
      lastBreakIndex = index;
      breakGapDays = gap;
    }
  }

  const latestSettledDate = priorDates.at(-1);
  const currentGap = daysBetween(latestSettledDate, slateDate);
  if (lastBreakIndex < 0) {
    const routineWeight = currentGap === 2 ? 0.85 : 1;
    return {
      weight: routineWeight,
      status: routineWeight < 1 ? 'routine-gap' : 'normal',
      latestSettledDate,
      calendarGapDays: currentGap,
      recoverySlateDay: null,
      breakStartDate: null,
      returnDate: null,
    };
  }

  const recoverySlateDay = timeline.length - lastBreakIndex;
  const recoveryWeights = [0.35, 0.55, 0.75, 0.90, 1];
  const weight = recoveryWeights[Math.min(recoverySlateDay - 1, recoveryWeights.length - 1)];
  return {
    weight,
    status: weight < 1 ? 'post-break-decay' : 'normal',
    latestSettledDate,
    calendarGapDays: currentGap,
    breakGapDays,
    recoverySlateDay,
    breakStartDate: timeline[lastBreakIndex - 1],
    returnDate: timeline[lastBreakIndex],
  };
}

function uniqueSlateRows(scoredBatters) {
  const rows = [];
  const seen = new Set();
  for (const row of Object.values(scoredBatters || {})) {
    if (!row || row.playerId == null || seen.has(String(row.playerId))) continue;
    seen.add(String(row.playerId));
    rows.push(row);
  }
  return rows;
}

/**
 * Cross-sectional league power regime from the active slate's recent hitters.
 * HR/PA uses the strict last-X-games batting block; barrels use the ~14-day
 * Statcast window. Both are compared with the same hitters' season baselines,
 * preventing roster composition from masquerading as a league-wide power move.
 */
export function buildLeaguePowerRegime(scoredBatters, { formWeight = 1 } = {}) {
  const rows = uniqueSlateRows(scoredBatters);
  let recentHr = 0;
  let recentPa = 0;
  let seasonHr = 0;
  let seasonPa = 0;
  let recentBarrels = 0;
  let recentBbe = 0;
  let seasonBarrels = 0;
  let seasonBbe = 0;
  let hitterSamples = 0;
  let barrelSamples = 0;

  for (const row of rows) {
    const recent = row.recent;
    const season = row.season;
    const rPa = (recent?.ab || 0) + (recent?.bb || 0);
    const sPa = (season?.ab || 0) + (season?.bb || 0);
    if (rPa >= 20 && sPa >= 80 && Number.isFinite(recent?.hr) && Number.isFinite(season?.hr)) {
      recentHr += recent.hr;
      recentPa += rPa;
      seasonHr += season.hr;
      seasonPa += sPa;
      hitterSamples++;
    }

    const rPct = row.recentBarrel?.recentBarrelPct;
    const rBbe = row.recentBarrel?.recentBBE;
    const sPct = Number.isFinite(row.barrelPctBBE) ? row.barrelPctBBE : row.barrelPct;
    const sBbe = row.seasonBBE;
    if (
      Number.isFinite(rPct) && rBbe >= 6
      && Number.isFinite(sPct) && sBbe >= 30
    ) {
      recentBarrels += rPct / 100 * rBbe;
      recentBbe += rBbe;
      seasonBarrels += sPct / 100 * sBbe;
      seasonBbe += sBbe;
      barrelSamples++;
    }
  }

  const recentHrPa = recentPa ? recentHr / recentPa : null;
  const seasonHrPa = seasonPa ? seasonHr / seasonPa : null;
  const recentBarrelRate = recentBbe ? recentBarrels / recentBbe : null;
  const seasonBarrelRate = seasonBbe ? seasonBarrels / seasonBbe : null;
  const hrRatio = recentHrPa != null && seasonHrPa > 0 ? recentHrPa / seasonHrPa : null;
  const barrelRatio = recentBarrelRate != null && seasonBarrelRate > 0
    ? recentBarrelRate / seasonBarrelRate
    : null;
  const components = [
    Number.isFinite(hrRatio) ? { value: hrRatio, weight: 0.55 } : null,
    Number.isFinite(barrelRatio) ? { value: barrelRatio, weight: 0.45 } : null,
  ].filter(Boolean);
  const weightTotal = components.reduce((sum, item) => sum + item.weight, 0);
  const rawPowerIndex = weightTotal
    ? components.reduce((sum, item) => sum + item.value * item.weight, 0) / weightTotal
    : null;
  const safeFormWeight = clamp(Number.isFinite(formWeight) ? formWeight : 1, 0.25, 1);
  const powerIndex = rawPowerIndex == null
    ? null
    : 1 + (rawPowerIndex - 1) * safeFormWeight;
  const ready = hitterSamples >= 30 && recentPa >= 800 && components.length === 2;
  const status = !ready
    ? 'collecting'
    : powerIndex <= 0.90
      ? 'low'
      : powerIndex < 0.98
        ? 'soft'
        : powerIndex >= 1.08
          ? 'elevated'
          : 'normal';
  const probabilityFactor = ready
    ? clamp(Math.pow(powerIndex, 0.35), 0.90, 1.08)
    : 1;

  return {
    ready,
    status,
    hitters: rows.length,
    hitterSamples,
    barrelSamples,
    recentPa,
    recentBbe,
    recentHrPa: round(recentHrPa, 4),
    seasonHrPa: round(seasonHrPa, 4),
    recentBarrelRate: round(recentBarrelRate, 4),
    seasonBarrelRate: round(seasonBarrelRate, 4),
    hrRatio: round(hrRatio),
    barrelRatio: round(barrelRatio),
    rawPowerIndex: round(rawPowerIndex),
    powerIndex: round(powerIndex),
    formWeight: round(safeFormWeight),
    probabilityFactor: round(probabilityFactor),
  };
}

function aucOf(rows, scoreOf) {
  const usable = rows
    .map((row) => ({ score: scoreOf(row), y: row.homered === true ? 1 : 0 }))
    .filter((row) => Number.isFinite(row.score));
  const positives = usable.filter((row) => row.y === 1).length;
  const negatives = usable.length - positives;
  if (!positives || !negatives) return null;
  usable.sort((a, b) => a.score - b.score);
  let rankSum = 0;
  let index = 0;
  while (index < usable.length) {
    let end = index + 1;
    while (end < usable.length && usable[end].score === usable[index].score) end++;
    const averageRank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor++) {
      if (usable[cursor].y === 1) rankSum += averageRank;
    }
    index = end;
  }
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

function coreRank(row) {
  const feat = row?.feat;
  if (!feat || !Number.isFinite(feat.bs) || !Number.isFinite(feat.setup)) {
    return null;
  }
  return (
    0.80 * clamp(feat.bs / 88, 0, 1) * 100
    + 0.20 * clamp(feat.setup / 6, 0, 1) * 100
  );
}

function legacyCoreRank(row) {
  const feat = row?.feat;
  if (!feat || !Number.isFinite(feat.bs) || !Number.isFinite(feat.heat) || !Number.isFinite(feat.setup)) return null;
  return (
    0.62 * clamp(feat.bs / 88, 0, 1) * 100
    + 0.23 * clamp(feat.heat / 100, 0, 1) * 100
    + 0.15 * clamp(feat.setup / 6, 0, 1) * 100
  );
}

function barrelCoreRank(row) {
  const feat = row?.feat;
  if (!feat || !Number.isFinite(feat.bs) || !Number.isFinite(feat.brl) || !Number.isFinite(feat.setup)) return null;
  return (
    0.62 * clamp(feat.bs / 88, 0, 1) * 100
    + 0.23 * clamp(feat.brl / 20, 0, 1) * 100
    + 0.15 * clamp(feat.setup / 6, 0, 1) * 100
  );
}

function cleanHistory(backtestLog, slateDate, lookbackDays) {
  const records = backtestLog?.modelHistory?.records || backtestLog?.records || {};
  const dates = historyDates(backtestLog)
    .filter((date) => date < slateDate && Array.isArray(records[date]))
    .slice(-lookbackDays);
  const rowsByDate = new Map();
  for (const date of dates) {
    const rows = (records[date] || []).filter((row) => (
      row?.actuallyPlayed !== false
      && typeof row?.homered === 'boolean'
      && Number.isFinite(row?.score)
      && row?.featureGeneration === 3
      && row?.featureCapture === 'pregame-freeze'
    ));
    if (rows.length) rowsByDate.set(date, rows);
  }
  return rowsByDate;
}

function topNMetrics(rowsByDate, scoreOf, topN = 10) {
  let hits = 0;
  let n = 0;
  for (const rows of rowsByDate.values()) {
    const top = rows
      .filter((row) => Number.isFinite(scoreOf(row)))
      .slice()
      .sort((a, b) => scoreOf(b) - scoreOf(a))
      .slice(0, topN);
    hits += top.filter((row) => row.homered === true).length;
    n += top.length;
  }
  return { hits, n, hitRate: n ? hits / n : null };
}

/**
 * Ranking health is intentionally independent from calibration health. Brier is
 * reported for context, but the production gate uses AUC plus the daily top-ten
 * hit rate and its lift over the same window's base HR rate.
 */
export function buildRankingHealth(backtestLog, slateDate, { lookbackDays = 10, topN = 10 } = {}) {
  const rowsByDate = cleanHistory(backtestLog, slateDate, lookbackDays);
  const rows = [...rowsByDate.values()].flat();
  const positives = rows.filter((row) => row.homered === true).length;
  const baseRate = rows.length ? positives / rows.length : null;
  const auc = aucOf(rows, (row) => row.score);
  const top = topNMetrics(rowsByDate, (row) => row.score, topN);
  const lift = top.hitRate != null && baseRate > 0 ? top.hitRate / baseRate : null;
  const probRows = rows.filter((row) => Number.isFinite(row.simHRProb));
  const brier = probRows.length
    ? probRows.reduce((sum, row) => sum + (row.simHRProb - (row.homered ? 1 : 0)) ** 2, 0) / probRows.length
    : null;
  const ready = rowsByDate.size >= 5 && rows.length >= 500 && positives >= 40 && top.n >= 50;
  const thresholds = {
    auc: 0.60,
    topTenHitRate: Math.max(0.18, (baseRate || 0) * 1.25),
    topTenLift: 1.35,
  };
  const checks = ready ? {
    auc: auc >= thresholds.auc,
    topTenHitRate: top.hitRate >= thresholds.topTenHitRate,
    topTenLift: lift >= thresholds.topTenLift,
  } : { auc: false, topTenHitRate: false, topTenLift: false };
  const passed = Object.values(checks).filter(Boolean).length;
  const status = !ready ? 'collecting' : passed >= 3 ? 'high' : passed === 2 ? 'guarded' : 'low';

  const coreRows = rows.filter((row) => coreRank(row) != null);
  const coreCoverage = rows.length ? coreRows.length / rows.length : 0;
  const coreAuc = coreCoverage >= 0.75 ? aucOf(coreRows, coreRank) : null;
  const coreTop = coreCoverage >= 0.75 ? topNMetrics(rowsByDate, coreRank, topN) : { hitRate: null, n: 0 };
  const coreLift = coreTop.hitRate != null && baseRate > 0 ? coreTop.hitRate / baseRate : null;
  const contextReady = ready && coreCoverage >= 0.75 && Number.isFinite(coreAuc) && Number.isFinite(coreLift);
  const contextAucLift = contextReady ? auc - coreAuc : null;
  const contextTopTenLift = contextReady ? lift - coreLift : null;
  const contextEarnedLift = contextReady
    && (contextAucLift >= 0.005 || contextTopTenLift >= 0.10);
  const contextStatus = !contextReady ? 'collecting' : contextEarnedLift ? 'earning' : 'stalled';

  const shadowCandidate = (key, scoreOf) => {
    const candidateRows = rows.filter((row) => scoreOf(row) != null);
    const coverage = rows.length ? candidateRows.length / rows.length : 0;
    const candidateAuc = coverage >= 0.75 ? aucOf(candidateRows, scoreOf) : null;
    const candidateTop = coverage >= 0.75 ? topNMetrics(rowsByDate, scoreOf, topN) : { hitRate: null, n: 0 };
    const candidateLift = candidateTop.hitRate != null && baseRate > 0 ? candidateTop.hitRate / baseRate : null;
    const aucEdge = Number.isFinite(candidateAuc) && Number.isFinite(auc) ? candidateAuc - auc : null;
    const topLiftEdge = Number.isFinite(candidateLift) && Number.isFinite(lift) ? candidateLift - lift : null;
    return {
      key,
      coverage: round(coverage),
      n: candidateRows.length,
      auc: round(candidateAuc, 4),
      aucEdge: round(aucEdge, 4),
      topTenHitRate: round(candidateTop.hitRate, 4),
      topTenLift: round(candidateLift),
      topTenLiftEdge: round(topLiftEdge),
      clearsRankingGate: coverage >= 0.75
        && (aucEdge >= 0.005 || topLiftEdge >= 0.10),
    };
  };
  const rankingShadow = [
    shadowCandidate('batter-plus-setup', coreRank),
    shadowCandidate('legacy-batter-heat-setup', legacyCoreRank),
    shadowCandidate('batter-barrel-setup', barrelCoreRank),
  ];

  return {
    ready,
    status,
    lookbackDays,
    dates: rowsByDate.size,
    n: rows.length,
    positives,
    baseRate: round(baseRate, 4),
    auc: round(auc, 4),
    topTen: {
      n: top.n,
      hits: top.hits,
      hitRate: round(top.hitRate, 4),
      lift: round(lift),
    },
    checks,
    thresholds: {
      auc: thresholds.auc,
      topTenHitRate: round(thresholds.topTenHitRate, 4),
      topTenLift: thresholds.topTenLift,
    },
    passed,
    brier: round(brier, 4),
    brierUsedByGate: false,
    context: {
      status: contextStatus,
      ready: contextReady,
      coverage: round(coreCoverage),
      fullAuc: round(auc, 4),
      coreAuc: round(coreAuc, 4),
      aucLift: round(contextAucLift, 4),
      fullTopTenLift: round(lift),
      coreTopTenLift: round(coreLift),
      topTenLiftDelta: round(contextTopTenLift),
      earnedLift: contextEarnedLift,
    },
    shadow: {
      evaluation: 'same-date-paired-ranking-only',
      productionFallback: 'batter-plus-setup',
      candidates: rankingShadow,
    },
  };
}

function throttleFor(power, ranking) {
  const lowPower = power?.ready === true && power.status === 'low';
  const weakRanking = ranking?.status === 'low';
  const unknownRanking = ranking?.status === 'collecting';
  const guardedRanking = ranking?.status === 'guarded';

  if (lowPower && weakRanking) {
    return {
      level: 'defensive',
      reason: 'low-power-and-low-ranking-confidence',
      primeCapMultiplier: 0.50,
      primeCapMinimum: 1,
      combos: {
        allowedSizes: [2],
        maxCombosPerSize: 2,
        maxPerBat: 1,
        globalMaxPerBat: 2,
      },
    };
  }
  if (lowPower || weakRanking || unknownRanking) {
    return {
      level: 'cautious',
      reason: lowPower ? 'low-power-regime' : 'ranking-confidence-not-high',
      primeCapMultiplier: 0.75,
      primeCapMinimum: 1,
      combos: {
        allowedSizes: [2, 3],
        maxCombosPerSize: 4,
        maxPerBat: 1,
        globalMaxPerBat: 3,
      },
    };
  }
  if (power?.status === 'soft' || guardedRanking) {
    return {
      level: 'selective',
      reason: power?.status === 'soft' ? 'soft-power-regime' : 'guarded-ranking-health',
      primeCapMultiplier: 0.85,
      primeCapMinimum: 2,
      combos: {
        allowedSizes: [2, 3],
        maxCombosPerSize: 5,
        maxPerBat: 2,
        globalMaxPerBat: 3,
      },
    };
  }
  return {
    level: 'normal',
    reason: 'power-and-ranking-healthy',
    primeCapMultiplier: 1,
    primeCapMinimum: 2,
    combos: {
      allowedSizes: [2, 3, 4],
      maxCombosPerSize: null,
      maxPerBat: 2,
      globalMaxPerBat: 4,
    },
  };
}

export function buildHrResiliencePolicy({
  backtestLog,
  scoredBatters,
  slateDate,
  formDecay = buildCalendarGapFormDecay(backtestLog, slateDate),
} = {}) {
  const power = buildLeaguePowerRegime(scoredBatters, { formWeight: formDecay?.weight ?? 1 });
  const ranking = buildRankingHealth(backtestLog, slateDate);
  const throttle = throttleFor(power, ranking);
  const coreEmphasis = ranking.context.status === 'stalled'
    ? { active: true, weight: 0.18, maxScoreDelta: 4, reason: 'context-overlay-lift-stalled' }
    : { active: false, weight: 0, maxScoreDelta: 0, reason: ranking.context.status };
  return {
    version: 1,
    slateDate,
    formDecay,
    power,
    ranking,
    coreEmphasis,
    throttle,
  };
}

/**
 * Bounded ranking correction used only when the historical context overlay has
 * stopped beating the clean, full-coverage Batter Score + HR Setup rank.
 */
export function applyCoreRankingEmphasis(
  scoredBatters,
  policy,
  gradeFromScore,
  { heatIndex, hrSetup } = {},
) {
  if (!policy?.coreEmphasis?.active) return { applied: 0, raised: 0, lowered: 0, maxAbsDelta: 0 };
  let applied = 0;
  let raised = 0;
  let lowered = 0;
  let maxAbsDelta = 0;
  const weight = policy.coreEmphasis.weight;
  const maxDelta = policy.coreEmphasis.maxScoreDelta;
  const formWeight = policy.formDecay?.weight ?? 1;
  const seen = new Set();

  for (const row of Object.values(scoredBatters || {})) {
    const key = row?.playerId == null ? null : `${row.playerId}-${row.gamePk ?? 'unknown'}`;
    if (!key || seen.has(key) || !Number.isFinite(row.score) || !Number.isFinite(row.batterScore)) continue;
    seen.add(key);
    if (typeof heatIndex !== 'function' || typeof hrSetup !== 'function') continue;
    const setup = hrSetup(row).n;
    if (!Number.isFinite(setup)) continue;
    const decayedSetup = 2.5 + (setup - 2.5) * formWeight;
    const coreScore = (
      0.80 * clamp(row.batterScore / 88, 0, 1) * 100
      + 0.20 * clamp(decayedSetup / 6, 0, 1) * 100
    );
    const proposed = (1 - weight) * row.score + weight * coreScore;
    const delta = Math.round(clamp(proposed - row.score, -maxDelta, maxDelta));
    row.hrResilience = {
      formWeight,
      coreEmphasis: true,
      coreScore: round(coreScore, 1),
      scoreDelta: delta,
    };
    if (!delta) continue;
    row.score = Math.round(clamp(row.score + delta, 0, 100));
    row.grade = gradeFromScore(row.score);
    row.rating = Math.max(1, Math.min(10, Math.round(row.score / 10)));
    applied++;
    if (delta > 0) raised++;
    else lowered++;
    maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta));
  }
  return { applied, raised, lowered, maxAbsDelta };
}

export function comboOptionsFromHrPolicy(policy) {
  const combos = policy?.throttle?.combos || {};
  return {
    sizes: Array.isArray(combos.allowedSizes) ? combos.allowedSizes : [2, 3, 4],
    maxCombosPerSize: Number.isFinite(combos.maxCombosPerSize)
      ? combos.maxCombosPerSize
      : Infinity,
    maxPerBat: Number.isFinite(combos.maxPerBat) ? combos.maxPerBat : 2,
    globalMaxPerBat: Number.isFinite(combos.globalMaxPerBat) ? combos.globalMaxPerBat : 4,
  };
}
