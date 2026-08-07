import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompatibleCalibrationLog,
  buildForwardHrMetrics,
  isCleanHrHistoryRow,
} from '../server/lib/hrModelEvaluation.mjs';

function dayRows(day, count = 120) {
  return Array.from({ length: count }, (_, index) => {
    const homered = index < 12;
    return {
      playerId: day * 1000 + index,
      gamePk: day * 10 + Math.floor(index / 9),
      score: homered ? 82 : 48,
      grade: homered ? 'PRIME' : 'LEAN',
      displayGrade: homered ? 'PRIME' : 'LEAN',
      homered,
      actuallyPlayed: true,
      dataTrusted: true,
      featureCapture: 'pregame-freeze',
      featureGeneration: 3,
      hrModelVersion: 2,
      probabilityPipelineVersion: 2,
      publishedHRProbability: homered ? 0.20 : 0.10,
    };
  });
}

function history() {
  const dates = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'];
  const records = Object.fromEntries(dates.map((date, index) => [date, dayRows(index + 1)]));
  return { dates, records, modelHistory: { dates, records } };
}

test('forward HR metrics score only frozen, exact-version published probabilities', () => {
  const log = history();
  log.modelHistory.records['2026-08-04'].push({
    ...dayRows(9, 1)[0],
    playerId: 99999,
    gamePk: null,
    publishedHRProbability: 0.99,
  });
  const result = buildForwardHrMetrics(log);
  assert.equal(result.ready, true);
  assert.equal(result.status, 'validated');
  assert.equal(result.availableRows, 480);
  assert.equal(result.n, 360, 'first date establishes the future-only baseline');
  assert.equal(result.dates, 3);
  assert.ok(result.brier < result.baselineBrier);
  assert.ok(result.brierSkill > 0);
  assert.ok(result.reliability.length > 0);
});

test('calibration population drops legacy identities and promotes exact versions only after its gate', () => {
  const log = history();
  log.records['2026-08-04'].push({ ...dayRows(9, 1)[0], playerId: 99999, gamePk: null });
  assert.equal(isCleanHrHistoryRow(log.records['2026-08-04'].at(-1)), false);

  const exact = buildCompatibleCalibrationLog(log, { minExactRows: 100, minExactDates: 2 });
  assert.equal(exact.meta.source, 'current-version');
  assert.equal(exact.meta.rows, 480);

  const bridge = buildCompatibleCalibrationLog(log, { minExactRows: 1000, minExactDates: 5 });
  assert.equal(bridge.meta.source, 'clean-prior-generation-bridge');
  assert.equal(bridge.meta.rows, 480);
});
