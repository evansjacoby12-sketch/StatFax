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

test('buildTwoLegCombo rejects same-game legs (mutually exclusive)', () => {
  const leg1 = { id: 'p1', name: 'Jalen Johnson', gameId: 'g1', team: 'ATL', gameProb: 0.15 };
  const leg2 = { id: 'p2', name: 'Donovan Mitchell', gameId: 'g1', team: 'CLE', gameProb: 0.13 };

  assert.throws(() => {
    buildTwoLegCombo(leg1, leg2);
  }, /Cannot parlay players in the same game/);
});

test('buildTwoLegCombo computes compounded odds and Kelly units across different games', () => {
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
  // Odds: 6.5 * 6.0 = 39.0 -> +3800
  assert.equal(combo.compoundedDecimal, 39.0);
  assert.equal(combo.compoundedAmerican, '+3800');
  assert.ok(combo.tags.includes('prime_lock'));
  assert.ok(combo.tags.includes('tip_dominance'));
  assert.ok(combo.kellyUnits >= 0.1);
});

test('generateTwoLegBoard generates all cross-game pairings across a slate', () => {
  const fakeGames = [
    {
      gameId: 'g1',
      awayTeam: { abbr: 'CLE' },
      homeTeam: { abbr: 'ATL' },
      players: [
        { id: 'p1', name: 'Jalen Johnson', team: 'ATL', gameProb: 0.15, isStarter: true, gamePickRank: 1 },
        { id: 'p2', name: 'Donovan Mitchell', team: 'CLE', gameProb: 0.132, isStarter: true, gamePickRank: 2 },
      ],
    },
    {
      gameId: 'g2',
      awayTeam: { abbr: 'SAC' },
      homeTeam: { abbr: 'NOP' },
      players: [
        { id: 'p3', name: 'Zion Williamson', team: 'NOP', gameProb: 0.158, isStarter: true, gamePickRank: 1 },
        { id: 'p4', name: 'Domantas Sabonis', team: 'SAC', gameProb: 0.134, isStarter: true, gamePickRank: 2 },
      ],
    },
    {
      gameId: 'g3',
      awayTeam: { abbr: 'MEM' },
      homeTeam: { abbr: 'POR' },
      players: [
        { id: 'p5', name: 'Cameron Boozer', team: 'MEM', gameProb: 0.144, isStarter: true, gamePickRank: 1 },
        { id: 'p6', name: 'Zach Edey', team: 'MEM', gameProb: 0.138, isStarter: true, gamePickRank: 2 },
      ],
    },
  ];

  const board = generateTwoLegBoard(fakeGames);
  assert.equal(board.gamePairsCount, 3); // 3 choose 2 = 3 pairs: (g1, g2), (g1, g3), (g2, g3)
  assert.ok(board.totalAvailable > 0);
  assert.ok(board.byStrategy.prime_lock);
  assert.ok(board.byStrategy.tip_dominance);
});
