import {
  CLEAN_PREGAME_FEATURE_CAPTURE,
  CLEAN_PREGAME_FEATURE_GENERATION,
} from './historicalFeatureArchive.mjs';
import {
  HR_MODEL_VERSION,
  HR_PROBABILITY_PIPELINE_VERSION,
} from '../../src/sports/mlb/logic/hrModelVersion.js';

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = (value, digits = 4) => Number.isFinite(value) ? +Number(value).toFixed(digits) : null;

function datesAndRecords(log, { preferHistory = false } = {}) {
  const source = preferHistory && log?.modelHistory?.records
    ? log.modelHistory
    : log;
  const records = source?.records || {};
  const dates = [...new Set([...(source?.dates || []), ...Object.keys(records)])]
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Array.isArray(records[date]))
    .sort();
  return { dates, records };
}

export function isCleanHrHistoryRow(row) {
  return row?.actuallyPlayed !== false
    && typeof row?.homered === 'boolean'
    && Number.isFinite(row?.gamePk)
    && Number.isFinite(row?.score)
    && row?.featureCapture === CLEAN_PREGAME_FEATURE_CAPTURE
    && row?.featureGeneration === CLEAN_PREGAME_FEATURE_GENERATION
    && row?.dataTrusted !== false;
}

/**
 * Restrict score calibration to identity-safe, pregame feature records. Exact
 * current-version rows take over once they have a real multi-date sample;
 * until then the clean prior generation remains an explicitly labeled bridge.
 */
export function buildCompatibleCalibrationLog(log, {
  modelVersion = HR_MODEL_VERSION,
  probabilityPipelineVersion = HR_PROBABILITY_PIPELINE_VERSION,
  lookbackDays = 30,
  minExactRows = 2500,
  minExactDates = 10,
} = {}) {
  const { dates: allDates, records: sourceRecords } = datesAndRecords(log);
  const dates = allDates.slice(-lookbackDays);
  const cleanRecords = {};
  const exactRecords = {};
  let cleanN = 0;
  let exactN = 0;
  for (const date of dates) {
    const clean = (sourceRecords[date] || []).filter(isCleanHrHistoryRow);
    if (clean.length) {
      cleanRecords[date] = clean;
      cleanN += clean.length;
    }
    const exact = clean.filter((row) => (
      row.hrModelVersion === modelVersion
      && row.probabilityPipelineVersion === probabilityPipelineVersion
    ));
    if (exact.length) {
      exactRecords[date] = exact;
      exactN += exact.length;
    }
  }
  const exactDates = Object.keys(exactRecords);
  const useExact = exactN >= minExactRows && exactDates.length >= minExactDates;
  const selectedRecords = useExact ? exactRecords : cleanRecords;
  const selectedDates = Object.keys(selectedRecords).sort();
  return {
    log: { dates: selectedDates, records: selectedRecords },
    meta: {
      source: useExact ? 'current-version' : 'clean-prior-generation-bridge',
      modelVersion,
      probabilityPipelineVersion,
      rows: useExact ? exactN : cleanN,
      dates: selectedDates.length,
      exactRows: exactN,
      exactDates: exactDates.length,
      requiredExactRows: minExactRows,
      requiredExactDates: minExactDates,
    },
  };
}

function aucOf(entries) {
  const rows = entries
    .filter((row) => Number.isFinite(row.probability))
    .slice()
    .sort((a, b) => a.probability - b.probability);
  const positives = rows.filter((row) => row.actual === 1).length;
  const negatives = rows.length - positives;
  if (!positives || !negatives) return null;
  let rankSum = 0;
  let index = 0;
  while (index < rows.length) {
    let end = index + 1;
    while (end < rows.length && rows[end].probability === rows[index].probability) end++;
    const averageRank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor++) {
      if (rows[cursor].actual === 1) rankSum += averageRank;
    }
    index = end;
  }
  return (rankSum - positives * (positives + 1) / 2) / (positives * negatives);
}

function reliabilityOf(entries) {
  const bins = Array.from({ length: 9 }, (_, index) => ({
    min: index * 0.05,
    max: index === 8 ? 1 : (index + 1) * 0.05,
    probabilities: [],
    actuals: [],
  }));
  for (const row of entries) {
    const index = Math.min(8, Math.max(0, Math.floor(row.probability / 0.05)));
    bins[index].probabilities.push(row.probability);
    bins[index].actuals.push(row.actual);
  }
  return bins.filter((bin) => bin.probabilities.length).map((bin) => ({
    binLo: bin.min,
    binHi: bin.max,
    n: bin.probabilities.length,
    avgPredicted: round(bin.probabilities.reduce((sum, value) => sum + value, 0) / bin.probabilities.length),
    observedRate: round(bin.actuals.reduce((sum, value) => sum + value, 0) / bin.actuals.length),
  }));
}

/**
 * Evaluate the exact probability that was published before first pitch.
 * Baseline comparisons are paired and future-only: each test date uses only
 * the compatible settled dates that preceded it to establish a base HR rate.
 */
export function buildForwardHrMetrics(log, {
  modelVersion = HR_MODEL_VERSION,
  probabilityPipelineVersion = HR_PROBABILITY_PIPELINE_VERSION,
  lookbackDays = 30,
  minimumPriorRows = 100,
  readyRows = 300,
  readyDates = 3,
  readyPositives = 20,
} = {}) {
  const { dates: allDates, records } = datesAndRecords(log, { preferHistory: true });
  const dates = allDates.slice(-lookbackDays);
  const prior = [];
  const evaluated = [];
  const availableByDate = [];

  for (const date of dates) {
    const dayRows = (records[date] || []).filter((row) => (
      isCleanHrHistoryRow(row)
      && row.dataTrusted === true
      && row.hrModelVersion === modelVersion
      && row.probabilityPipelineVersion === probabilityPipelineVersion
      && Number.isFinite(row.publishedHRProbability)
      && row.publishedHRProbability > 0
      && row.publishedHRProbability < 1
    ));
    if (!dayRows.length) continue;
    availableByDate.push({ date, n: dayRows.length });
    if (prior.length >= minimumPriorRows) {
      const baselineProbability = clamp(
        prior.filter((row) => row.actual === 1).length / prior.length,
        0.005,
        0.45,
      );
      for (const row of dayRows) {
        evaluated.push({
          date,
          probability: row.publishedHRProbability,
          baselineProbability,
          actual: row.homered ? 1 : 0,
          grade: row.displayGrade || row.grade || null,
        });
      }
    }
    for (const row of dayRows) prior.push({ actual: row.homered ? 1 : 0 });
  }

  const evaluationDates = new Set(evaluated.map((row) => row.date)).size;
  const positives = evaluated.filter((row) => row.actual === 1).length;
  const brier = evaluated.length
    ? evaluated.reduce((sum, row) => sum + (row.probability - row.actual) ** 2, 0) / evaluated.length
    : null;
  const baselineBrier = evaluated.length
    ? evaluated.reduce((sum, row) => sum + (row.baselineProbability - row.actual) ** 2, 0) / evaluated.length
    : null;
  const logLoss = evaluated.length
    ? evaluated.reduce((sum, row) => {
      const probability = clamp(row.probability, 1e-9, 1 - 1e-9);
      return sum - (row.actual * Math.log(probability) + (1 - row.actual) * Math.log(1 - probability));
    }, 0) / evaluated.length
    : null;
  const ready = evaluated.length >= readyRows
    && evaluationDates >= readyDates
    && positives >= readyPositives;
  const skill = Number.isFinite(brier) && baselineBrier > 0
    ? (baselineBrier - brier) / baselineBrier
    : null;

  return {
    version: 1,
    status: ready ? (skill > 0 ? 'validated' : 'under-baseline') : 'collecting',
    ready,
    evaluation: 'frozen-published-probability-expanding-window',
    modelVersion,
    probabilityPipelineVersion,
    lookbackDays,
    availableDates: availableByDate.length,
    availableRows: availableByDate.reduce((sum, day) => sum + day.n, 0),
    dates: evaluationDates,
    n: evaluated.length,
    positives,
    brier: round(brier),
    baselineBrier: round(baselineBrier),
    brierSkill: round(skill),
    logLoss: round(logLoss),
    auc: round(aucOf(evaluated)),
    reliability: reliabilityOf(evaluated),
    requirements: {
      priorRowsPerFirstTest: minimumPriorRows,
      readyRows,
      readyDates,
      readyPositives,
    },
  };
}
