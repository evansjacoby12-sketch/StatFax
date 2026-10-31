import test from 'node:test';
import assert from 'node:assert/strict';
import { normName, matchPlayer, parseStarters, scoreSnapshot, scoreLog, learnFromLog } from '../tools/firstBasketLog.mjs';

const snap = (over = {}) => ({
  date: '2026-10-29', game: 'AAA@BBB', away: 'AAA', home: 'BBB', modelVersion: 'v1', preTip: true,
  tip: { tipProbHome: 0.6, homeScoresFirst: 0.55 },
  players: [
    { name: 'Ann Alpha', team: 'AAA', position: 'C', pJoint: 0.4 },
    { name: 'Bob Beta', team: 'AAA', position: 'PG', pJoint: 0.3 },
    { name: 'Cal Gamma Jr.', team: 'BBB', position: 'SF', pJoint: 0.2 },
    { name: 'Dee Delta', team: 'BBB', position: 'C', pJoint: 0.1 },
  ],
  ...over,
});

test('normName strips accents, punctuation and suffixes', () => {
  assert.equal(normName('Trey Murphy III'), 'trey murphy');
  assert.equal(normName("De'Andre Hunter"), 'deandre hunter');
  assert.equal(normName('Nikola Jokić'), 'nikola jokic');
});

test('matchPlayer finds unique partial names and rejects ambiguous ones', () => {
  const ps = snap().players;
  assert.equal(matchPlayer(ps, 'gamma').name, 'Cal Gamma Jr.');
  const dup = [...ps, { name: 'Zed Gamma', team: 'AAA', position: 'PF', pJoint: 0.1 }];
  assert.equal(matchPlayer(dup, 'gamma'), null);
});

test('scoreSnapshot computes log loss, Brier and rank by hand', () => {
  const s = scoreSnapshot(snap(), { scorer: 'Cal Gamma' });
  assert.ok(Math.abs(s.logLoss - -Math.log(0.2)) < 1e-9);
  assert.ok(Math.abs(s.baselineLogLoss - Math.log(4)) < 1e-9);
  assert.ok(Math.abs(s.brier - (0.16 + 0.09 + 0.64 + 0.01)) < 1e-9);
  assert.equal(s.rank, 3);
  assert.equal(s.top1, false);
  assert.equal(s.top3, true);
  assert.equal(s.topPick, 'Ann Alpha');
});

test('a scorer outside the model is floored and counted', () => {
  const s = scoreSnapshot(snap(), { scorer: 'Walk On' });
  assert.equal(s.outsideModel, true);
  assert.ok(Math.abs(s.logLoss - -Math.log(0.005)) < 1e-9);
  assert.ok(Math.abs(s.brier - (0.16 + 0.09 + 0.04 + 0.01 + 1)) < 1e-9);
});

test('tip and team-first Brier use the home team probabilities', () => {
  const s = scoreSnapshot(snap(), { scorer: 'Cal Gamma', tipWinner: 'BBB' });
  assert.ok(Math.abs(s.tipBrier - 0.16) < 1e-9);        // (0.6 - 1)^2
  assert.ok(Math.abs(s.teamFirstBrier - 0.2025) < 1e-9); // (0.55 - 1)^2, scorer is on the home team
});

test('lineup mismatches are reported both ways', () => {
  const s = scoreSnapshot(snap(), { scorer: 'Ann Alpha', starters: parseStarters('AAA=Ann Alpha,Zed Newguy') });
  assert.deepEqual(s.lineupMismatch.AAA.notInModel, ['Zed Newguy']);
  assert.deepEqual(s.lineupMismatch.AAA.notStarting, ['Bob Beta']);
});

test('lineup-mismatched games stay visible but are excluded from metrics and learned feedback', () => {
  const prediction = snap();
  const result = {
    date: prediction.date, game: prediction.game, scorer: 'Ann Alpha',
    starters: parseStarters('AAA=Ann Alpha,Zed Newguy'),
  };
  const scored = scoreLog([prediction], [result]);
  assert.equal(scored.scored.length, 1);
  assert.equal(scored.excludedLineupMismatch, 1);
  assert.equal(scored.eligibleScored.length, 0);
  assert.equal(scored.summary.length, 0);
  assert.equal(learnFromLog([prediction], [result]).gamesScored, 0);
});

test('scoreLog keeps the latest snapshot per version, flags flips, ignores backfill', () => {
  const early = snap({ loggedAt: '1' });
  const late = snap({ loggedAt: '2', players: snap().players.map(p => ({ ...p, pJoint: p.name === 'Dee Delta' ? 0.9 : 0.1 })) });
  const backfill = snap({ modelVersion: 'post', preTip: false });
  const results = [{ date: '2026-10-29', game: 'AAA@BBB', scorer: 'Dee Delta',
    starters: { AAA: ['Ann Alpha', 'Bob Beta'], BBB: ['Cal Gamma Jr.', 'Dee Delta'] } }];
  const r = scoreLog([early, late, backfill], results);
  assert.equal(r.scored.length, 1);                      // backfill excluded, one version left
  assert.equal(r.scored[0].topPick, 'Dee Delta');        // latest snapshot of v1 used
  assert.equal(r.flips.length, 1);
  assert.deepEqual(r.flips[0].picks, ['Ann Alpha', 'Dee Delta']);
  assert.equal(scoreLog([early, late, backfill], results, { includeBackfill: true }).scored.length, 2);
});

test('learnFromLog tracks player hits, O/E ratios and jumper feedback', () => {
  const p = snap();
  const results = [{ date: '2026-10-29', game: 'AAA@BBB', scorer: 'Cal Gamma', tipWinner: 'BBB',
    starters: { AAA: ['Ann Alpha', 'Bob Beta'], BBB: ['Cal Gamma Jr.', 'Dee Delta'] } }];
  const l = learnFromLog([p], results);
  assert.equal(l.gamesScored, 1);
  const cal = l.allPlayers.find(x => x.name.includes('Cal Gamma'));
  assert.equal(cal.hits, 1);
  assert.ok(cal.oeRatio > 1.0);
  assert.ok(cal.learnedAdjustment > 1.0);
  assert.equal(l.positionAnalysis.SF.hits, 1);
});

test('gameId keeps same-matchup doubleheaders separate in evaluation', () => {
  const one = snap({ gameId: 'event-1' });
  const two = snap({ gameId: 'event-2', players: snap().players.map(p => ({
    ...p, pJoint: p.name === 'Dee Delta' ? 0.7 : p.name === 'Ann Alpha' ? 0.1 : 0.1,
  })) });
  const actualStarters = { AAA: ['Ann Alpha', 'Bob Beta'], BBB: ['Cal Gamma Jr.', 'Dee Delta'] };
  const results = [
    { date: one.date, game: one.game, gameId: 'event-1', scorer: 'Ann Alpha', starters: actualStarters },
    { date: two.date, game: two.game, gameId: 'event-2', scorer: 'Dee Delta', starters: actualStarters },
  ];
  const out = scoreLog([one, two], results);
  assert.equal(out.scored.length, 2);
  assert.deepEqual(out.scored.map(x => x.gameId).sort(), ['event-1', 'event-2']);
});

test('missing actual starter evidence blocks aggregate metrics', () => {
  const prediction = snap();
  const out = scoreLog([prediction], [{ date: prediction.date, game: prediction.game, scorer: 'Ann Alpha' }]);
  assert.equal(out.scored[0].lineupEvidenceMissing, true);
  assert.equal(out.eligibleScored.length, 0);
});

