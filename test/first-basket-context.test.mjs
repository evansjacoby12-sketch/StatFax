import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFirstBasketContext, nbaSeasonForDate, parseNbaZoneStats, parsePbpOpeningShots } from '../server/sports/nba/first-basket-context.mjs';

test('NBA official shot-zone rows become count-backed rates', () => {
  const zones = ['Restricted Area', 'In The Paint (Non-RA)', 'Mid-Range', 'Left Corner 3', 'Right Corner 3', 'Above the Break 3', 'Backcourt'];
  const headers = ['PLAYER_ID', 'PLAYER_NAME', 'TEAM_ID', 'TEAM_ABBREVIATION', 'AGE'];
  const row = ['123', 'A Player', '1610612738', 'BOS', 25];
  for (let i = 0; i < zones.length; i++) {
    headers.push(`${zones[i]} FGM`, `${zones[i]} FGA`, `${zones[i]} FG_PCT`);
    row.push(i + 1, 10, (i + 1) / 10);
  }
  const parsed = parseNbaZoneStats({ season: '2026-27', resultSets: [{ name: 'ShotLocations', headers, rowSet: [row] }] });
  assert.equal(parsed['123'].rim.made, 3);
  assert.equal(parsed['123'].rim.attempts, 20);
  assert.equal(parsed['123'].mid.pct, 0.3);
  assert.equal(parsed['123'].three.made, 15);
  assert.equal(parsed['123'].season, '2026-27');
});

test('PBP Stats first-possession parser selects possession 1 or 2 and captures first-shot tempo', () => {
  const result = parsePbpOpeningShots({ results: [
    { gid: 'g1', period: 1, poss_num: 1, player: 'Jayson Tatum', player_id: 1628369, start_time: 720, shot_time: 700, made: false, start_type: 'OffDeadBall' },
    { gid: 'g1', period: 1, poss_num: 1, player: 'Jaylen Brown', player_id: 1627759, start_time: 720, shot_time: 680, made: true, start_type: 'OffDeadBall' },
    { gid: 'g1', period: 1, poss_num: 3, player: 'Jayson Tatum', player_id: 1628369, start_time: 660, shot_time: 650, made: true, start_type: 'OffSteal' },
    { gid: 'g2', period: 1, poss_num: 2, player: 'Derrick White', player_id: 1628401, start_time: 720, shot_time: 690, made: true, start_type: 'OffDefRebound' },
    { gid: 'g3', period: 2, poss_num: 1, player: 'Jayson Tatum', player_id: 1628369, start_time: 720, shot_time: 700, made: true },
  ] });
  assert.equal(result.status, 'ok');
  assert.equal(result.sampleCount, 2);
  assert.equal(result.byPlayer['jayson tatum'].misses, 1);
  assert.equal(result.byPlayer['jaylen brown'], undefined);
  assert.equal(result.byPlayer['derrick white'].made, 1);
  assert.equal(result.byPlayer['derrick white'].startTypes.OffDefRebound, 1);
  assert.deepEqual(result.openingTempo, { sampleCount: 2, totalSeconds: 50, meanSeconds: 25 });
});

test('PBP Stats parser builds date-ordered L5 and L10 opening-role windows', () => {
  const results = Array.from({ length: 12 }, (_, index) => ({
    gid: `g${String(index + 1).padStart(2, '0')}`,
    game_date: `2026-10-${String(index + 1).padStart(2, '0')}`,
    period: 1, poss_num: 1,
    player: index >= 7 ? 'Recent Lead' : 'Season Lead',
    player_id: index >= 7 ? 2 : 1,
    start_time: 720, shot_time: 700, made: true,
  }));
  const result = parsePbpOpeningShots({ results });
  assert.equal(result.recentRole.last5.sampleGames, 5);
  assert.equal(result.recentRole.last5.shotCount, 5);
  assert.equal(result.recentRole.last5.byPlayer['recent lead'], 5);
  assert.equal(result.recentRole.last10.sampleGames, 10);
  assert.equal(result.recentRole.last10.byPlayer['recent lead'], 5);
  assert.equal(result.recentRole.last10.byPlayer['season lead'], 5);
});

test('PBP Stats capped responses are rejected as incomplete', () => {
  const result = parsePbpOpeningShots({ results: Array.from({ length: 500 }, () => ({})) });
  assert.equal(result.status, 'truncated');
  assert.deepEqual(result.byPlayer, {});
});

test('NBA season anchor follows the October season boundary', () => {
  assert.equal(nbaSeasonForDate(new Date('2026-10-30T12:00:00Z')), '2026-27');
  assert.equal(nbaSeasonForDate(new Date('2026-04-01T12:00:00Z')), '2025-26');
});

test('context fetch combines official zone data and both teams opening history', async () => {
  const zoneHeaders = ['PLAYER_ID', 'PLAYER_NAME', 'TEAM_ID', 'TEAM_ABBREVIATION', 'AGE'];
  const zoneRow = ['123', 'Jayson Tatum', '1610612738', 'BOS', 28];
  for (const zone of ['Restricted Area', 'In The Paint (Non-RA)', 'Mid-Range', 'Left Corner 3', 'Right Corner 3', 'Above the Break 3', 'Backcourt']) {
    zoneHeaders.push(`${zone} FGM`, `${zone} FGA`, `${zone} FG_PCT`);
    zoneRow.push(8, 10, 0.8);
  }
  const calls = [];
  const fetchImpl = async url => {
    calls.push(String(url));
    if (String(url).includes('stats.nba.com')) return { ok: true, json: async () => ({ resultSets: [{ name: 'ShotLocations', headers: zoneHeaders, rowSet: [zoneRow] }] }) };
    return { ok: true, json: async () => ({ results: [
      { gid: 'g1', period: 1, poss_num: 1, player: 'Jayson Tatum', player_id: 1628369, start_time: 720, shot_time: 700, made: true, start_type: 'OffDeadBall' },
    ] }) };
  };
  const context = await fetchFirstBasketContext([{ homeTeam: { abbr: 'BOS' }, awayTeam: { abbr: 'LAL' } }], {
    fetchImpl, season: '2026-27', previousSeason: '2025-26',
  });
  assert.equal(context.zoneStatus, 'ok');
  assert.equal(context.zoneStatsByPlayerId['123'].rim.attempts, 20);
  assert.equal(context.openingStatus, 'ok');
  assert.equal(context.openingByTeam.BOS.byPlayer['jayson tatum'].attempts, 2);
  assert.equal(context.openingByTeam.LAL.sampleCount, 2);
  assert.deepEqual(context.openingByTeam.BOS.openingTempo, { sampleCount: 2, totalSeconds: 40, meanSeconds: 20 });
  assert.equal(calls.filter(x => x.includes('get-shots')).length, 4);
});
