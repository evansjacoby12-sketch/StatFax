import test from 'node:test';
import assert from 'node:assert/strict';
import { nbaTeamLogoCandidates, nbaTeamLogoLabel } from '../ui/src/lib/nbaTeamLogo.js';

test('NBA ESPN logo aliases use provider-supported team codes', () => {
  assert.match(nbaTeamLogoCandidates('NOP')[0], /\/no\.png$/);
  assert.match(nbaTeamLogoCandidates('UTA')[0], /\/utah\.png$/);
  assert.match(nbaTeamLogoCandidates('WAS')[0], /\/wsh\.png$/);
  assert.match(nbaTeamLogoCandidates('BOS')[0], /\/bos\.png$/);
});

test('NBA team logos try the supplied source before provider fallback and deduplicate URLs', () => {
  const candidates = nbaTeamLogoCandidates({ abbr: 'GSW' }, 'https://example.test/team.png');
  assert.equal(candidates[0], 'https://example.test/team.png');
  assert.equal(candidates[1], 'https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/gs.png');
  assert.equal(new Set(candidates).size, candidates.length);
});

test('NBA logo text fallback always has an accessible team label', () => {
  assert.equal(nbaTeamLogoLabel({ abbr: 'PHX' }), 'PHX');
  assert.equal(nbaTeamLogoLabel(''), 'NBA');
});
