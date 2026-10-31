import test from 'node:test';
import assert from 'node:assert/strict';
import { blendRecentOpeningRole } from '../src/sports/nba/logic/openingRoleForm.js';

const starters = [
  { name: 'Player One', earlyShotShare: 0.6 },
  { name: 'Player Two', earlyShotShare: 0.4 },
];

test('recent opening-role form nudges season shares conservatively and preserves total share', () => {
  const result = blendRecentOpeningRole(starters, {
    last5: { sampleGames: 5, shotCount: 10, byPlayer: { 'player one': 10 } },
    last10: { sampleGames: 10, shotCount: 20, byPlayer: { 'player one': 20 } },
  });
  assert.equal(result[0].openingRoleRecent.applied, true);
  assert.equal(result[0].openingRoleRecent.blendWeight, 0.1);
  assert.ok(result[0].earlyShotShare > 0.6);
  assert.ok(result[0].earlyShotShare < 0.65);
  assert.ok(Math.abs(result.reduce((sum, player) => sum + player.earlyShotShare, 0) - 1) < 1e-12);
});

test('thin or unavailable recent samples leave the season role unchanged', () => {
  const result = blendRecentOpeningRole(starters, {
    last5: { sampleGames: 2, shotCount: 4, byPlayer: { 'player one': 4 } },
    last10: { sampleGames: 2, shotCount: 4, byPlayer: { 'player one': 4 } },
  });
  assert.deepEqual(result.map(player => player.earlyShotShare), [0.6, 0.4]);
  assert.equal(result[0].openingRoleRecent.applied, false);
  assert.equal(result[0].openingRoleRecent.blendWeight, 0);
  assert.equal(blendRecentOpeningRole(starters, null)[1].earlyShotShare, 0.4);
});
