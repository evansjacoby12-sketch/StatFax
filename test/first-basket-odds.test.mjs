import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchFirstBasketOddsForGames, mapFirstBasketMarket, normalizeMarketName } from '../server/sports/nba/first-basket-odds.mjs';

test('first-basket odds parser maps Yes prices by player and bookmaker', () => {
  const mapped = mapFirstBasketMarket({ bookmakers: [{ key: 'draftkings', markets: [{
    key: 'player_first_basket', outcomes: [
      { name: 'Yes', description: 'Jayson Tatum', price: 550 },
      { name: 'No', description: 'Jayson Tatum', price: -800 },
      { name: 'Yes', description: 'Nikola Jokić', price: 700 },
    ],
  }] }] });
  assert.deepEqual(mapped['jayson tatum'].books, { draftkings: '+550' });
  assert.equal(mapped['nikola jokic'].books.draftkings, '+700');
  assert.equal(normalizeMarketName('Jayson Tatum III'), 'jayson tatum');
});

test('first-basket odds fetch returns no prices without a configured key', async () => {
  const res = await fetchFirstBasketOddsForGames([], { apiKey: '', now: 0 });
  assert.equal(res.status, 'no_key');
  assert.deepEqual(res.games, {});
});

test('first-basket odds fetch matches event, requests the player market, and returns real quotes', async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(new URL(url));
    if (String(url).endsWith('/events?apiKey=secret')) {
      return { ok: true, json: async () => [{ id: 'event-1', home_team: 'Boston Celtics', away_team: 'Chicago Bulls' }] };
    }
    return { ok: true, json: async () => ({ bookmakers: [{ key: 'fanduel', markets: [{
      key: 'player_first_basket', last_update: '2026-10-30T15:59:00.000Z',
      outcomes: [{ name: 'Yes', description: 'Jayson Tatum', price: 500 }],
    }] }] }) };
  };
  const res = await fetchFirstBasketOddsForGames([{
    gameId: 'espn-1', homeTeam: { name: 'Boston Celtics' }, awayTeam: { name: 'Chicago Bulls' },
  }], { apiKey: 'secret', fetchImpl, now: Date.parse('2026-10-30T16:00:00.000Z') });
  assert.equal(res.status, 'ok');
  assert.equal(res.games['espn-1'].players['jayson tatum'].books.fanduel, '+500');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].searchParams.get('markets'), 'player_first_basket');
  assert.equal(calls[1].searchParams.get('apiKey'), 'secret');
});
