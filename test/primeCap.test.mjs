import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIME_CAP_SCORE_FLOOR,
  applyGameNormalizedPrimeCap,
  planGameNormalizedPrimeCap,
  primeCapForGames,
} from '../server/lib/primeCap.mjs';

function primeRow(playerId, score, gamePk = 100) {
  return {
    playerId,
    gamePk,
    score,
    hrProbability: score / 400,
    grade: { label: 'PRIME', color: '#gold' },
  };
}

test('PRIME game cap follows slate size and keeps the absolute score floor', () => {
  assert.equal(PRIME_CAP_SCORE_FLOOR, 72);
  assert.equal(primeCapForGames(15), 23);
  assert.equal(primeCapForGames(10), 15);
  assert.equal(primeCapForGames(1), 2);
  assert.equal(primeCapForGames(0), 0);
});

test('PRIME game cap retains only the highest scores without changing projections', () => {
  const rows = Object.fromEntries(Array.from({ length: 30 }, (_, index) => {
    const row = primeRow(index + 1, 100 - index, 200 + index);
    return [`${row.playerId}-${row.gamePk}`, row];
  }));
  const originalProbabilities = Object.values(rows).map((row) => row.hrProbability);

  const result = applyGameNormalizedPrimeCap(rows, 15, { label: 'STRONG', color: '#green' });
  const retained = Object.values(rows).filter((row) => row.grade.label === 'PRIME');
  const demoted = Object.values(rows).filter((row) => row.grade.label === 'STRONG');

  assert.equal(result.cap, 23);
  assert.equal(result.retainedCount, 23);
  assert.equal(result.demotedCount, 7);
  assert.equal(retained.length, 23);
  assert.equal(Math.min(...retained.map((row) => row.score)), 78);
  assert.equal(Math.max(...demoted.map((row) => row.score)), 77);
  assert.deepEqual(Object.values(rows).map((row) => row.hrProbability), originalProbabilities);
});

test('PRIME game cap never promotes STRONG rows to fill unused capacity', () => {
  const rows = {
    prime: primeRow(1, 88),
    strong: { ...primeRow(2, 84), grade: { label: 'STRONG', color: '#green' } },
  };

  const result = applyGameNormalizedPrimeCap(rows, 10, { label: 'STRONG', color: '#green' });
  assert.equal(result.cap, 15);
  assert.equal(result.retainedCount, 1);
  assert.equal(rows.prime.grade.label, 'PRIME');
  assert.equal(rows.strong.grade.label, 'STRONG');
});

test('PRIME game cap enforces the floor and demotes every alias of an overflow row', () => {
  const top = primeRow(1, 91, 301);
  const second = primeRow(2, 85, 302);
  const overflow = primeRow(3, 79, 303);
  const belowFloor = primeRow(4, 71, 304);
  const rows = {
    top,
    second,
    overflow,
    overflowAlias: { ...overflow },
    belowFloor,
  };

  const planned = planGameNormalizedPrimeCap(rows, 1);
  assert.equal(planned.cap, 2);
  assert.equal(planned.rawPrimeCount, 4);
  assert.equal(planned.belowFloorCount, 1);
  assert.equal(planned.demotedCount, 2);

  applyGameNormalizedPrimeCap(rows, 1, { label: 'STRONG', color: '#green' });
  assert.equal(rows.top.grade.label, 'PRIME');
  assert.equal(rows.second.grade.label, 'PRIME');
  assert.equal(rows.overflow.grade.label, 'STRONG');
  assert.equal(rows.overflowAlias.grade.label, 'STRONG');
  assert.equal(rows.belowFloor.grade.label, 'STRONG');
});
