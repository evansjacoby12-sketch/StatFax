import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCoreRankingEmphasis,
  buildCalendarGapFormDecay,
  buildHrResiliencePolicy,
  buildLeaguePowerRegime,
  buildRankingHealth,
  comboOptionsFromHrPolicy,
} from '../server/lib/hrResilience.mjs';

const cleanRecord = ({ score, homered, bs = score * 0.75, heat = score, setup = score / 17 }) => ({
  score,
  homered,
  actuallyPlayed: true,
  featureGeneration: 3,
  featureCapture: 'pregame-freeze',
  simHRProb: Math.max(0.02, Math.min(0.30, score / 400)),
  feat: { bs, heat, setup: Math.max(0, Math.min(6, setup)) },
});

function history({ inverse = false } = {}) {
  const records = {};
  for (let day = 1; day <= 6; day++) {
    const date = `2026-07-${String(day).padStart(2, '0')}`;
    records[date] = Array.from({ length: 100 }, (_, index) => cleanRecord({
      score: 100 - index,
      homered: inverse ? index >= 90 : index < 10,
    }));
  }
  return {
    dates: Object.keys(records),
    settledDates: Object.keys(records),
    modelHistory: { dates: Object.keys(records), records },
  };
}

function lowPowerRows() {
  return Object.fromEntries(Array.from({ length: 40 }, (_, index) => {
    const recentHr = index < 8 ? 1 : 0;
    const row = {
      playerId: index + 1,
      gamePk: 1000 + index,
      recent: { ab: 24, bb: 1, hr: recentHr },
      season: { ab: 190, bb: 10, hr: 7 },
      recentBarrel: { recentBarrelPct: 5, recentBBE: 10 },
      barrelPctBBE: 10,
      seasonBBE: 100,
    };
    return [`${row.playerId}-${row.gamePk}`, row];
  }));
}

test('calendar-gap decay is strongest on return day and recovers over settled slates', () => {
  const log = {
    settledDates: ['2026-07-10', '2026-07-16'],
    dates: ['2026-07-10', '2026-07-16'],
  };
  const returnDay = buildCalendarGapFormDecay({ settledDates: ['2026-07-10'] }, '2026-07-16');
  const secondDay = buildCalendarGapFormDecay(log, '2026-07-17');
  assert.equal(returnDay.status, 'post-break-decay');
  assert.equal(returnDay.weight, 0.35);
  assert.equal(secondDay.weight, 0.55);
  assert.equal(secondDay.returnDate, '2026-07-16');
});

test('league power regime combines recent HR/PA and barrels and bounds probability impact', () => {
  const regime = buildLeaguePowerRegime(lowPowerRows());
  assert.equal(regime.ready, true);
  assert.equal(regime.status, 'low');
  assert.ok(regime.hrRatio < 0.5);
  assert.equal(regime.barrelRatio, 0.5);
  assert.ok(regime.probabilityFactor >= 0.90);
  assert.ok(regime.probabilityFactor < 1);
  const postBreak = buildLeaguePowerRegime(lowPowerRows(), { formWeight: 0.35 });
  assert.ok(postBreak.powerIndex > regime.powerIndex);
  assert.ok(postBreak.powerIndex < 1);
});

test('ranking gate uses AUC, top-ten hit rate, and lift while Brier stays advisory', () => {
  const healthy = buildRankingHealth(history(), '2026-07-07');
  assert.equal(healthy.ready, true);
  assert.equal(healthy.status, 'high');
  assert.equal(healthy.passed, 3);
  assert.equal(healthy.brierUsedByGate, false);
  assert.ok(healthy.auc > 0.9);
  assert.ok(healthy.topTen.lift > 5);

  const weak = buildRankingHealth(history({ inverse: true }), '2026-07-07');
  assert.equal(weak.status, 'low');
  assert.equal(weak.checks.auc, false);
  assert.equal(weak.checks.topTenHitRate, false);
  assert.equal(weak.checks.topTenLift, false);
});

test('low power plus low ranking confidence cuts PRIME and auto-combo exposure', () => {
  const policy = buildHrResiliencePolicy({
    backtestLog: history({ inverse: true }),
    scoredBatters: lowPowerRows(),
    slateDate: '2026-07-07',
  });
  const combo = comboOptionsFromHrPolicy(policy);
  assert.equal(policy.throttle.level, 'defensive');
  assert.equal(policy.throttle.primeCapMultiplier, 0.5);
  assert.deepEqual(combo.sizes, [2]);
  assert.equal(combo.maxCombosPerSize, 2);
});

test('stalled context lift activates a bounded Batter Score and Setup correction', () => {
  const policy = buildHrResiliencePolicy({
    backtestLog: history(),
    scoredBatters: lowPowerRows(),
    slateDate: '2026-07-07',
  });
  assert.equal(policy.ranking.context.status, 'stalled');
  assert.equal(policy.coreEmphasis.active, true);

  const row = { playerId: 1, gamePk: 2, score: 55, batterScore: 80, grade: 'STRONG' };
  const result = applyCoreRankingEmphasis(
    { '1-2': row },
    policy,
    (score) => (score >= 72 ? 'PRIME' : 'STRONG'),
    { heatIndex: () => 80, hrSetup: () => ({ n: 6 }) },
  );
  assert.equal(result.applied, 1);
  assert.ok(row.score > 55);
  assert.ok(row.hrResilience.scoreDelta <= 4);
  assert.equal(policy.ranking.shadow.productionFallback, 'batter-plus-setup');
  assert.ok(policy.ranking.shadow.candidates.some((candidate) => candidate.key === 'batter-barrel-setup'));
});
