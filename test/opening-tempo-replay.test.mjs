import test from 'node:test';
import assert from 'node:assert/strict';
import { openingTempoAt } from '../fb-model/eval/evaluate_opening_tempo_replay.mjs';

test('historical opening tempo uses earlier dates only and advances once per observation', () => {
  const events = [
    { date: '2025-10-20', elapsed: 18 },
    { date: '2025-10-21', elapsed: 22 },
    { date: '2025-10-22', elapsed: 99 },
  ];
  const state = { index: 0, count: 0, total: 0 };
  assert.deepEqual(openingTempoAt(events, '2025-10-21', state), { meanSeconds: 18, sampleCount: 1 });
  assert.deepEqual(openingTempoAt(events, '2025-10-21', state), { meanSeconds: 18, sampleCount: 1 });
  assert.deepEqual(openingTempoAt(events, '2025-10-22', state), { meanSeconds: 20, sampleCount: 2 });
});
