import test from 'node:test';
import assert from 'node:assert/strict';
import {
  americanToDecimal,
  decimalToAmerican,
  calculateTwoLegJointProb,
  buildTwoLegCombo,
  generateTwoLegBoard,
  NBA_COMBO_STRATEGIES,
} from '../src/sports/nba/logic/firstBasketCombos.js';

test('americanToDecimal and decimalToAmerican convert odds accurately', () => {
  assert.equal(americanToDecimal('+500'), 6.0);
  assert.equal(americanToDecimal('+100'), 2.0);
  assert.equal(americanToDecimal('-110'), 100 / 110 + 1);

  assert.equal(decimalToAmerican(6.0), '+500');
  assert.equal(decimalToAmerican(2.0), '+100');
  assert.equal(decimalToAmerican(1.909), '-110');
});

test('calculateTwoLegJointProb computes independent joint probability', () => {
  const p = calculateTwoLegJointProb(0.15, 0.14);
  assert.equal(p, 0.021); // 15% * 14% = 2.1%
});

test('BetLab requires valid probabilities and keeps stake/EV out of model-only combos', () => {
  const baseA = { id: 'a', name: 'A', gameId: 'g1', team: 'AAA', gameProb: 0.1 };
  const baseB = { id: 'b', name: 'B', gameId: 'g2', team: 'BBB', gameProb: 0.1 };
  assert.equal(buildTwoLegCombo(baseA, { ...baseB, bookOdds: '+550' }).edgePct, null);
  assert.equal(buildTwoLegCombo({ ...baseA, bookOdds: '+550', gameProb: null }, { ...baseB, bookOdds: '+550' }), null);

  const priced = buildTwoLegCombo(
    { ...baseA, bookOdds: '+300' },
    { ...baseB, bookOdds: '+300' },
  );
  assert.ok(priced);
  assert.equal(priced.edgePct, null);
  assert.equal(priced.kellyUnits, null);
});

test('model-only BetLab combo generation ignores book prices', () => {
  const board = generateTwoLegBoard([
    { gameId: 'g1', players: [{ id: 'a', name: 'A', team: 'AAA', gameProb: 0.12, isStarter: true }] },
    { gameId: 'g2', players: [{ id: 'b', name: 'B', team: 'BBB', gameProb: 0.10, bookOdds: '+10000', isStarter: true }] },
  ]);
  assert.equal(board.totalAvailable, 1);
  assert.equal(board.combos[0].jointProb, 0.012);
  assert.equal(board.combos[0].edgePct, null);
  assert.equal(board.combos[0].kellyUnits, null);
});

test('buildTwoLegCombo rejects same-game legs (mutually exclusive)', () => {
  const leg1 = { id: 'p1', name: 'Jalen Johnson', gameId: 'g1', team: 'ATL', gameProb: 0.15 };
  const leg2 = { id: 'p2', name: 'Donovan Mitchell', gameId: 'g1', team: 'CLE', gameProb: 0.13 };

  assert.throws(() => {
    buildTwoLegCombo(leg1, leg2);
  }, /Cannot parlay players in the same game/);
});

test('buildTwoLegCombo computes model-only joint probability across different games', () => {
  const leg1 = {
    id: 'p1',
    name: 'Jalen Johnson',
    gameId: 'g1',
    team: 'ATL',
    gameProb: 0.15,
    bookOdds: '+550',
    gamePickRank: 1,
    tipMatchup: { winProbA: 0.60 },
  };
  const leg2 = {
    id: 'p2',
    name: 'Zion Williamson',
    gameId: 'g2',
    team: 'NOP',
    gameProb: 0.158,
    bookOdds: '+500',
    gamePickRank: 1,
    tipMatchup: { winProbA: 0.58 },
  };

  const combo = buildTwoLegCombo(leg1, leg2);
  assert.ok(combo);
  assert.equal(combo.legs.length, 2);
  assert.equal(combo.jointProb, 0.0237); // 15% * 15.8% = 2.37%
  assert.equal(combo.compoundedDecimal, undefined);
  assert.equal(combo.compoundedAmerican, undefined);
  assert.ok(combo.tags.includes('prime_lock'));
  assert.ok(combo.tags.includes('tip_dominance'));
  assert.equal(combo.kellyUnits, null, 'the model-only combo must not calculate a price-based stake');
});

test('generateTwoLegBoard generates all cross-game pairings across a slate', () => {
  const fakeGames = [
    {
      gameId: 'g1',
      awayTeam: { abbr: 'CLE' },
      homeTeam: { abbr: 'ATL' },
      players: [
        { id: 'p1', name: 'Jalen Johnson', team: 'ATL', gameProb: 0.15, bookOdds: '+550', isStarter: true, gamePickRank: 1 },
        { id: 'p2', name: 'Donovan Mitchell', team: 'CLE', gameProb: 0.132, bookOdds: '+600', isStarter: true, gamePickRank: 2 },
      ],
    },
    {
      gameId: 'g2',
      awayTeam: { abbr: 'SAC' },
      homeTeam: { abbr: 'NOP' },
      players: [
        { id: 'p3', name: 'Zion Williamson', team: 'NOP', gameProb: 0.158, bookOdds: '+500', isStarter: true, gamePickRank: 1 },
        { id: 'p4', name: 'Domantas Sabonis', team: 'SAC', gameProb: 0.134, bookOdds: '+650', isStarter: true, gamePickRank: 2 },
      ],
    },
    {
      gameId: 'g3',
      awayTeam: { abbr: 'MEM' },
      homeTeam: { abbr: 'POR' },
      players: [
        { id: 'p5', name: 'Cameron Boozer', team: 'MEM', gameProb: 0.144, bookOdds: '+550', isStarter: true, gamePickRank: 1 },
        { id: 'p6', name: 'Zach Edey', team: 'MEM', gameProb: 0.138, bookOdds: '+650', isStarter: true, gamePickRank: 2 },
      ],
    },
  ];

  const board = generateTwoLegBoard(fakeGames);
  assert.equal(board.gamePairsCount, 3); // 3 choose 2 = 3 pairs: (g1, g2), (g1, g3), (g2, g3)
  assert.ok(board.totalAvailable > 0);
  assert.ok(board.byStrategy.prime_lock);
  assert.ok(board.byStrategy.tip_dominance);
});
