import test from 'node:test';
import assert from 'node:assert/strict';

import {
  predictJumpBallMatchup,
  getJumperProfile,
  calculateRegressedTipWinRate,
  JUMP_BALL_RATINGS,
} from '../src/sports/nba/data/jumpBalls.js';

import {
  scoreTeamFirstBasket,
  scoreGameFirstBasket,
  computeOddsEdge,
  calculateQuarterKelly,
  probToAmericanOdds,
  americanOddsToProb,
  gradeFromScore,
  devigOddsMarket,
  SETTLEMENT_RULES,
  simulateGameFirstBasketMonteCarlo,
} from '../src/sports/nba/logic/firstBasketEngine.js';

import { NBA_DEMO_SNAPSHOT } from '../src/sports/nba/data/demoSlate.js';
import { buildLiveNBASnapshot, loadNBASnapshot, validateNBASnapshot, nbaDateKeyInZone } from '../src/sports/nba/api/NBAService.js';
import { getStartersForTeam } from '../src/sports/nba/data/teamRosters.js';

test('NBA slate date follows Chicago time across UTC midnight', () => {
  assert.equal(nbaDateKeyInZone(new Date('2026-10-31T01:51:00Z')), '20261030');
  assert.equal(nbaDateKeyInZone(new Date('2026-10-31T06:00:00Z')), '20261031');
});

test('jumpBalls: jumper lookup and rating profiles', () => {
  const wemby = getJumperProfile('Victor Wembanyama');
  assert.equal(wemby.tier, 'ELITE');
  assert.ok(wemby.winPct >= 0.70);

  const ad = getJumperProfile('Anthony Davis');
  assert.equal(ad.tier, 'ELITE');

  const fallback = getJumperProfile('Unknown Center', 'XYZ');
  assert.equal(fallback.isFallback, true);
  assert.equal(fallback.rating, 1500);
  const unlistedStarter = getJumperProfile('Unlisted Starter', 'BOS');
  assert.equal(unlistedStarter.isFallback, true);
  assert.equal(unlistedStarter.tipAttempts, 0);
  assert.equal(unlistedStarter.standingReachInches, null);
});

test('jumpBalls: matchup tip probability does not claim unsupported team-first probability', () => {
  // Anthony Davis (1640) vs Nikola Jokic (1470)
  const matchup = predictJumpBallMatchup('Anthony Davis', 'Nikola Jokic');

  assert.ok(matchup.tipProbA > 0.65, `AD should have >65% tip win prob, got ${matchup.tipProbA}`);
  assert.ok(matchup.tipProbB < 0.35, `Jokic should have <35% tip win prob, got ${matchup.tipProbB}`);
  assert.ok(Math.abs((matchup.tipProbA + matchup.tipProbB) - 1.0) < 0.002);

  // A tip matchup alone cannot determine which team scores first.
  assert.equal(matchup.teamAScoresFirstProb, null);
  assert.equal(matchup.teamBScoresFirstProb, null);
});

test('firstBasketEngine: team first basket multinomial logit sums to 1.0', () => {
  const roster = [
    { id: '1', name: 'Center Star', position: 'C', isStarter: true, seasonStats: { pointsPerGame: 25, usageProxy: 22, fgaPerGame: 18, threesAttemptedPerGame: 1 } },
    { id: '2', name: 'Guard Star', position: 'PG', isStarter: true, seasonStats: { pointsPerGame: 24, usageProxy: 20, fgaPerGame: 17, threesAttemptedPerGame: 6 } },
    { id: '3', name: 'Wing Starter', position: 'SF', isStarter: true, seasonStats: { pointsPerGame: 15, usageProxy: 13, fgaPerGame: 11, threesAttemptedPerGame: 5 } },
    { id: '4', name: 'Forward Starter', position: 'PF', isStarter: true, seasonStats: { pointsPerGame: 14, usageProxy: 12, fgaPerGame: 10, threesAttemptedPerGame: 2 } },
    { id: '5', name: 'Defensive Guard', position: 'SG', isStarter: true, seasonStats: { pointsPerGame: 10, usageProxy: 8, fgaPerGame: 7, threesAttemptedPerGame: 4 } },
    { id: '6', name: 'Bench Guy 1', position: 'C', isStarter: false, seasonStats: { pointsPerGame: 8, usageProxy: 7, fgaPerGame: 6, threesAttemptedPerGame: 0 } },
  ];

  const scored = scoreTeamFirstBasket(roster, {}, { abbr: 'TST' });
  assert.equal(scored.length, 6);

  // Probabilities must sum to ~1.0
  const sumProb = scored.reduce((acc, p) => acc + p.teamProb, 0);
  assert.ok(Math.abs(sumProb - 1.0) < 0.01, `Team probs must sum to ~1.0, got ${sumProb}`);

  // Center star with high paint proximity should lead the team
  const topPick = scored[0];
  assert.equal(topPick.id, '1');
  assert.ok(topPick.teamProb > 0.25);

  // Bench guy should have near-zero probability
  const bench = scored.find(p => p.id === '6');
  assert.ok(bench.teamProb < 0.02, `Bench prob should be <2%, got ${bench.teamProb}`);
});

test('firstBasketEngine: game first basket joint distribution sums to 1.0 across both teams', () => {
  const homePlayers = [
    { id: 'h1', name: 'Home C', position: 'C', isStarter: true, seasonStats: { pointsPerGame: 20, usageProxy: 18 } },
    { id: 'h2', name: 'Home PG', position: 'PG', isStarter: true, seasonStats: { pointsPerGame: 20, usageProxy: 18 } },
    { id: 'h3', name: 'Home SF', position: 'SF', isStarter: true, seasonStats: { pointsPerGame: 15, usageProxy: 14 } },
    { id: 'h4', name: 'Home PF', position: 'PF', isStarter: true, seasonStats: { pointsPerGame: 12, usageProxy: 11 } },
    { id: 'h5', name: 'Home SG', position: 'SG', isStarter: true, seasonStats: { pointsPerGame: 10, usageProxy: 9 } },
  ];

  const awayPlayers = [
    { id: 'a1', name: 'Away C', position: 'C', isStarter: true, seasonStats: { pointsPerGame: 20, usageProxy: 18 } },
    { id: 'a2', name: 'Away PG', position: 'PG', isStarter: true, seasonStats: { pointsPerGame: 20, usageProxy: 18 } },
    { id: 'a3', name: 'Away SF', position: 'SF', isStarter: true, seasonStats: { pointsPerGame: 15, usageProxy: 14 } },
    { id: 'a4', name: 'Away PF', position: 'PF', isStarter: true, seasonStats: { pointsPerGame: 12, usageProxy: 11 } },
    { id: 'a5', name: 'Away SG', position: 'SG', isStarter: true, seasonStats: { pointsPerGame: 10, usageProxy: 9 } },
  ];

  const gameResult = scoreGameFirstBasket({
    gameId: 'test-game',
    homeTeam: { abbr: 'HOM' },
    awayTeam: { abbr: 'AWY' },
    homePlayers,
    awayPlayers,
    homeJumper: 'Anthony Davis',   // Elite jumper
    awayJumper: 'Nikola Jokic',    // Lower jumper
    marketOdds: { h1: '+500', a1: '+550' },
  });

  assert.equal(gameResult.players.length, 10);

  // Total game probability across all players must equal ~1.00
  const totalGameProb = gameResult.players.reduce((acc, p) => acc + p.gameProb, 0);
  assert.ok(Math.abs(totalGameProb - 1.0) < 0.02, `Game probs must sum to ~1.0, got ${totalGameProb}`);
  assert.ok(gameResult.players.every(p => !p.recommendationEligible && p.edgePct == null && p.kellyUnits == null),
    'Unqualified engine calls must not emit edges or Kelly sizes');

  // Home team with tip advantage should have higher aggregate first basket probability
  const homeAgg = gameResult.players.filter(p => p.isHome).reduce((acc, p) => acc + p.gameProb, 0);
  const awayAgg = gameResult.players.filter(p => !p.isHome).reduce((acc, p) => acc + p.gameProb, 0);
  assert.ok(homeAgg > awayAgg, `Home team should have edge (${homeAgg} vs ${awayAgg})`);
});

test('firstBasketEngine: odds conversions, edge, and Kelly sizing', () => {
  // Fair odds
  assert.equal(probToAmericanOdds(0.20), '+400');
  assert.equal(probToAmericanOdds(0.50), '-100');

  // American to prob
  assert.ok(Math.abs(americanOddsToProb('+400') - 0.20) < 0.01);
  assert.ok(Math.abs(americanOddsToProb('+500') - 0.1667) < 0.01);

  // Edge calculation: Model prob 0.20 (+400 fair) vs Book odds +500 (implied 0.1667)
  const edge = computeOddsEdge(0.20, '+500');
  assert.ok(edge > 19 && edge < 21, `Edge should be ~20%, got ${edge}`);

  // Quarter-Kelly unit sizing on +EV bet
  const kelly = calculateQuarterKelly(0.20, '+500');
  assert.ok(kelly >= 0.1 && kelly <= 0.35, `Quarter-Kelly should be between 0.1u and 0.35u, got ${kelly}`);

  // Negative EV bet should size at 0
  const noKelly = calculateQuarterKelly(0.12, '+500');
  assert.equal(noKelly, 0);
});

test('demoSlate and NBAService: snapshot validity and loading', async () => {
  assert.equal(NBA_DEMO_SNAPSHOT.sport, 'nba');
  assert.equal(NBA_DEMO_SNAPSHOT.games.length, 4);
  assert.ok(NBA_DEMO_SNAPSHOT.players.length >= 24);

  // Validate contract
  const validated = validateNBASnapshot(NBA_DEMO_SNAPSHOT);
  assert.equal(validated.sport, 'nba');

  // Load snapshot via dual mode loader
  const loaded = await loadNBASnapshot();
  assert.equal(loaded.sport, 'nba');
  assert.ok(loaded.players.length > 0);

  // Verify top players have scores, grades, and tip matchups
  const top1 = loaded.players[0];
  assert.ok(top1.score > 0);
  assert.ok(['PRIME', 'STRONG', 'VALUE'].includes(top1.grade));
  assert.ok(top1.fairGameOdds);
  assert.ok(top1.tipMatchup);
  assert.ok(top1.eli5);
  assert.ok(top1.eli15);
});

test('NBA v7 snapshot contract requires recent-role quality, simulation evidence, and player game identity', () => {
  assert.throws(() => validateNBASnapshot({
    sport: 'nba', modelVersion: 'nba-first-basket-v7', source: { mode: 'live' },
    market: {}, games: [{ gameId: '1', status: 'SCHEDULED' }],
    players: [{ id: 'p1', gameId: '1' }],
  }), /input-quality evidence/);
  assert.throws(() => validateNBASnapshot({
    sport: 'nba', modelVersion: 'nba-first-basket-v7', source: { mode: 'live' }, market: {},
    games: [{ gameId: '1', status: 'SCHEDULED', inputQuality: { recommendationEligible: false } }],
    players: [{ id: 'p1', gameId: '1', inputQuality: {} }],
  }), /eligibility evidence is incomplete/);
  const shadowSnapshot = {
    sport: 'nba', modelVersion: 'nba-first-basket-v7', source: { mode: 'live' }, market: {},
    games: [{
      gameId: '1', status: 'SCHEDULED',
      probabilitySource: 'monte_carlo_possession_sequence_v1',
      simTelemetry: { iterations: 5000, unresolvedTrials: 0, homeWins: 2600, awayWins: 2400 },
      inputQuality: {
        projectionEligible: false, recommendationEligible: false,
        playerSeasonStatCoverage: 0, teamMatchupCoverage: 0, zoneRateCoverage: 0,
        openingTeamCoverage: 0, minimumOpeningHistorySamples: 0,
        jumpBallCoverage: 0,
        recentOpeningRoleCoverage: 0, recentOpeningRoleSamples: 0,
        openingDataStatus: 'unavailable', zoneSource: 'unavailable',
      },
      openingTempoShadow: {
        featureVersion: 1,
        source: 'pbpstats_first_opening_possession_shot',
        includedInProbability: false,
        unit: 'seconds_from_possession_start_to_first_field_goal_attempt',
        home: { meanSecondsToFirstShot: 17.5, sampleCount: 21 },
        away: { meanSecondsToFirstShot: 18.2, sampleCount: 19 },
      },
    }],
    players: [{ id: 'p1', gameId: '1', inputQuality: {} }],
  };
  assert.equal(validateNBASnapshot(shadowSnapshot), shadowSnapshot);
  shadowSnapshot.games[0].openingTempoShadow.includedInProbability = true;
  assert.throws(() => validateNBASnapshot(shadowSnapshot), /opening tempo shadow evidence is malformed/);
  shadowSnapshot.games[0].openingTempoShadow.includedInProbability = false;
  shadowSnapshot.games[0].simTelemetry.unresolvedTrials = 1;
  assert.throws(() => validateNBASnapshot(shadowSnapshot), /possession simulation probability evidence is incomplete/);
});

test('firstBasket: tip-off Bayesian shrinkage and reach differential prior', () => {
  // Center with only 4 tips (sample size N=4, 3 wins = 75% raw)
  const smallSampleCenter = {
    jumper: 'Young Backup',
    tipWins: 3,
    tipAttempts: 4,
    winPct: 0.75,
    heightInches: 82,
    standingReachInches: 108,
  };

  // With 0 reach differential, raw 75% shrinks heavily toward 50% league prior with weight m=20
  // (4 * 0.75 + 20 * 0.50) / 24 = (3 + 10) / 24 = 13/24 ≈ 0.542
  const regressedRate = calculateRegressedTipWinRate(smallSampleCenter, 0);
  assert.ok(regressedRate < 0.60, `Small sample should shrink from 75% to <60%, got ${regressedRate}`);
  assert.ok(regressedRate > 0.52);

  // When facing a center with a +5" reach advantage (+5 inches adds ~11% to reach prior)
  const regressedWithReachAdv = calculateRegressedTipWinRate(smallSampleCenter, 5);
  assert.ok(regressedWithReachAdv > regressedRate, `Reach advantage should raise regressed prior`);
});

test('firstBasket: Markov sequence with early turnovers and offensive rebound putbacks', () => {
  const testPlayers = [
    {
      id: 'c1',
      name: 'Big Man',
      position: 'C',
      isStarter: true,
      earlyShotShare: 0.35,
      shotMix: { rim: 0.80, mid: 0.15, three: 0.05 },
      rimFG: 0.70,
      seasonStats: { usageProxy: 24 },
    },
    {
      id: 'g1',
      name: 'Shooter',
      position: 'SG',
      isStarter: true,
      earlyShotShare: 0.25,
      shotMix: { rim: 0.10, mid: 0.20, three: 0.70 },
      threeFG: 0.40,
      seasonStats: { usageProxy: 18 },
    },
  ];

  // Standard defense
  const stdScored = scoreTeamFirstBasket(testPlayers, {
    orebRateAllowed: 0.26,
    foulTurnoverForced: 0.12,
  });

  assert.equal(stdScored.length, 2);
  assert.ok(stdScored[0].teamProb > stdScored[1].teamProb);
  assert.equal(stdScored[0].turnoverRate, 12.3); // (12.5 + 12) / 2
  assert.equal(stdScored[0].orebExtensionPct, 26.0); // (26 + 26) / 2

  // Severe rim protection defense: opponent cuts rim FG by 15%
  const toughRimScored = scoreTeamFirstBasket(testPlayers, {
    rimProtectionFactor: 0.85,
    orebRateAllowed: 0.20,
    foulTurnoverForced: 0.16,
  });

  // Big Man's make rate drops when facing tough rim protection
  assert.ok(toughRimScored[0].expectedMakeRate < stdScored[0].expectedMakeRate);
});

test('firstBasket: settlement rules differentiate FIRST_FIELD_GOAL vs FIRST_POINT_SCORED', () => {
  const highFoulDrawer = [
    {
      id: 'foul-star',
      name: 'Foul Magnet',
      position: 'C',
      isStarter: true,
      earlyShotShare: 0.30,
      ftRate: 0.60, // Draws fouls on 60% of shot attempts
      ftPct: 0.88,  // 88% FT shooter
      shotMix: { rim: 0.60, mid: 0.20, three: 0.20 },
    },
    {
      id: 'jump-shooter',
      name: 'Jump Shooter',
      position: 'SG',
      isStarter: true,
      earlyShotShare: 0.30,
      ftRate: 0.10, // Rarely draws fouls
      ftPct: 0.75,
      shotMix: { rim: 0.10, mid: 0.30, three: 0.60 },
    },
  ];

  // Under FIRST_FIELD_GOAL (DraftKings & FanDuel), FTs do NOT count
  const fgScored = scoreGameFirstBasket({
    homeTeam: { abbr: 'HOM' },
    awayTeam: { abbr: 'AWY' },
    homePlayers: highFoulDrawer,
    awayPlayers: highFoulDrawer,
    settlementRule: SETTLEMENT_RULES.FIRST_FIELD_GOAL,
  });

  // Under FIRST_POINT_SCORED, drawing a shooting foul & making a FT counts
  const ptScored = scoreGameFirstBasket({
    homeTeam: { abbr: 'HOM' },
    awayTeam: { abbr: 'AWY' },
    homePlayers: highFoulDrawer,
    awayPlayers: highFoulDrawer,
    settlementRule: SETTLEMENT_RULES.FIRST_POINT_SCORED,
  });

  const magnetFG = fgScored.players.find(p => p.id === 'foul-star');
  const magnetPT = ptScored.players.find(p => p.id === 'foul-star');

  // Foul magnet receives boost under FIRST_POINT_SCORED market
  assert.ok(magnetPT.breakdown.ftBonus > 0, 'ftBonus should be active in FIRST_POINT_SCORED');
  assert.equal(magnetFG.breakdown.ftBonus, 0, 'ftBonus must be 0 in FIRST_FIELD_GOAL');
});

test('firstBasket: multi-book odds de-vigging and line movement', () => {
  const oddsMap = {
    'over': '-110',
    'under': '-110',
  };

  const devigged = devigOddsMarket(oddsMap);
  assert.ok(devigged['over']);
  assert.ok(devigged['over'].fairProb < devigged['over'].implied, 'Fair prob must remove vig in an overround market');
  assert.equal(Math.round(devigged['over'].fairProb * 100), 50);

  // Sum of fair probabilities across the market must equal 1.00
  const fairSum = Object.values(devigged).reduce((acc, v) => acc + v.fairProb, 0);
  assert.ok(Math.abs(fairSum - 1.0) < 0.001, `Fair probs must sum to 1.0, got ${fairSum}`);

  // Test line movement in demo slate
  const wemby = NBA_DEMO_SNAPSHOT.players.find(p => p.name === 'Victor Wembanyama');
  assert.ok(wemby);
  assert.ok(wemby.lineMovement);
  assert.equal(wemby.lineMovement.opening, '+550');
  assert.equal(wemby.lineMovement.closing, '+450');
  assert.ok(wemby.lineMovement.movement.includes('Steam'));

  // Test multi-book quotes presence
  assert.ok(wemby.multiBookComparison);
  assert.ok(wemby.multiBookComparison.draftkings);
  assert.ok(wemby.multiBookComparison.fanduel);
  assert.ok(wemby.multiBookComparison.betmgm);
  assert.ok(wemby.multiBookComparison.caesars);
});

test('firstBasket: 5000-trial Monte Carlo simulation engine per game', () => {
  const homePlayers = [
    { id: 'h1', name: 'Anthony Davis', position: 'C', earlyShotShare: 0.28, rimFG: 0.72, shotMix: { rim: 0.65, mid: 0.25, three: 0.1 } },
    { id: 'h2', name: 'Austin Reaves', position: 'PG', earlyShotShare: 0.22, threeFG: 0.38, shotMix: { rim: 0.25, mid: 0.3, three: 0.45 } },
    { id: 'h3', name: 'Rui Hachimura', position: 'PF', earlyShotShare: 0.18, shotMix: { rim: 0.45, mid: 0.3, three: 0.25 } },
    { id: 'h4', name: 'DLo Russell', position: 'SG', earlyShotShare: 0.18, shotMix: { rim: 0.2, mid: 0.3, three: 0.5 } },
    { id: 'h5', name: 'Jarred Vanderbilt', position: 'SF', earlyShotShare: 0.14, shotMix: { rim: 0.6, mid: 0.2, three: 0.2 } },
  ];

  const awayPlayers = [
    { id: 'a1', name: 'Nikola Jokic', position: 'C', earlyShotShare: 0.25, rimFG: 0.70, shotMix: { rim: 0.6, mid: 0.25, three: 0.15 } },
    { id: 'a2', name: 'Jamal Murray', position: 'PG', earlyShotShare: 0.25, threeFG: 0.38, shotMix: { rim: 0.25, mid: 0.35, three: 0.4 } },
    { id: 'a3', name: 'Michael Porter Jr', position: 'SF', earlyShotShare: 0.20, shotMix: { rim: 0.2, mid: 0.2, three: 0.6 } },
    { id: 'a4', name: 'Aaron Gordon', position: 'PF', earlyShotShare: 0.16, shotMix: { rim: 0.65, mid: 0.2, three: 0.15 } },
    { id: 'a5', name: 'Christian Braun', position: 'SG', earlyShotShare: 0.14, shotMix: { rim: 0.45, mid: 0.25, three: 0.3 } },
  ];

  const simResult = simulateGameFirstBasketMonteCarlo({
    homePlayers,
    awayPlayers,
    tipMatchup: { tipProbA: 0.68, tipProbB: 0.32 },
    iterations: 5000,
    seed: 'TEST-SEED-5K',
  });

  assert.equal(simResult.iterations, 5000);
  assert.equal(simResult.homeWins + simResult.awayWins, 5000);
  assert.ok(simResult.homeWins > simResult.awayWins, 'Home team with 68% tip edge should win majority of 5000 simulations');

  // Verify total player wins equal 5,000 exactly
  let totalPlayerWins = 0;
  for (const stats of Object.values(simResult.playerStats)) {
    totalPlayerWins += stats.wins;
    assert.equal(stats.methodCounts.twoPt + stats.methodCounts.threePt + stats.methodCounts.freeThrow, stats.wins, 'shot methods must equal total wins');
  }
  assert.equal(totalPlayerWins, 5000, 'Sum of all player wins across 5000 trials must equal 5000');

  // Determinism check: identical seed produces identical win counts
  const simResult2 = simulateGameFirstBasketMonteCarlo({
    homePlayers,
    awayPlayers,
    tipMatchup: { tipProbA: 0.68, tipProbB: 0.32 },
    iterations: 5000,
    seed: 'TEST-SEED-5K',
  });
  assert.equal(simResult2.homeWins, simResult.homeWins);
  assert.equal(simResult2.playerStats.h1.wins, simResult.playerStats.h1.wins);

  // Check integration through scoreGameFirstBasket
  const game = scoreGameFirstBasket({
    gameId: 'sim-test-game',
    homeTeam: { abbr: 'LAL' },
    awayTeam: { abbr: 'DEN' },
    homePlayers,
    awayPlayers,
    homeJumper: 'Anthony Davis',
    awayJumper: 'Nikola Jokic',
    simIterations: 5000,
  });

  assert.ok(game.simTelemetry);
  assert.equal(game.simTelemetry.iterations, 5000);
  assert.equal(game.simTelemetry.homeWins + game.simTelemetry.awayWins, 5000);

  const topPick = game.topPicks[0];
  assert.ok(topPick.simWins > 0);
  assert.equal(topPick.simTotal, 5000);
  assert.ok(topPick.simProb > 0);
  assert.ok(topPick.simPct.endsWith('%'));
  assert.ok(topPick.simMethods);
  assert.equal(topPick.simMethods.twoPt + topPick.simMethods.threePt + topPick.simMethods.freeThrow, topPick.simWins);
  assert.equal(topPick.gameProb, topPick.simWins / topPick.simTotal);
  assert.equal(game.probabilitySource, 'monte_carlo_possession_sequence_v1');
  assert.equal(game.simTelemetry.unresolvedTrials, 0);
  assert.equal(topPick.ci90.type, 'monte_carlo_sampling_error_only');
  assert.ok(topPick.eli15.includes('possession simulation:'));
});

test('v7 ranked probabilities respond to verified zone rates and reflect the simulation', () => {
  const player = (id, team, zoneFG) => ({
    id, name: id, team, position: 'C', isStarter: true, earlyShotShare: 1,
    shotMix: { rim: 1, mid: 0, three: 0 }, zoneFG,
  });
  const makeGame = (homeRate, awayRate, pace = 100) => scoreGameFirstBasket({
    gameId: 'zone-sensitivity', homeTeam: { abbr: 'H' }, awayTeam: { abbr: 'A' },
    homePlayers: [player('home', 'H', { rim: homeRate, mid: 42, three: 36 })],
    awayPlayers: [player('away', 'A', { rim: awayRate, mid: 42, three: 36 })],
    homeJumper: { name: 'Unknown Home', standingReachInches: 109, tipAttempts: 20, tipWins: 10 },
    awayJumper: { name: 'Unknown Away', standingReachInches: 109, tipAttempts: 20, tipWins: 10 },
    pace, simIterations: 10000, seed: 'zone-rate-sensitivity',
  });
  const homeAdvantage = makeGame(80, 50);
  const awayAdvantage = makeGame(50, 80);
  const paceOnlyChange = makeGame(80, 50, 140);
  assert.ok(homeAdvantage.tipMatchup.homeScoresFirstProb > 0.5);
  assert.ok(awayAdvantage.tipMatchup.homeScoresFirstProb < 0.5);
  assert.equal(homeAdvantage.players.find(p => p.id === 'home').gameProb,
    homeAdvantage.players.find(p => p.id === 'home').simProb);
  assert.equal(awayAdvantage.players.find(p => p.id === 'away').gameProb,
    awayAdvantage.players.find(p => p.id === 'away').simProb);
  assert.equal(paceOnlyChange.players.find(p => p.id === 'home').gameProb,
    homeAdvantage.players.find(p => p.id === 'home').gameProb,
    'whole-game pace is descriptive only for first-basket probabilities');
});

test('FIRST_POINT_SCORED simulation includes made-free-throw first scorers', () => {
  const foulPlayer = (id, team) => ({
    id, name: id, team, position: 'G', isStarter: true, earlyShotShare: 1,
    shotMix: { rim: 1, mid: 0, three: 0 }, rimFG: 0.6, ftRate: 1, ftPct: 1,
  });
  const game = scoreGameFirstBasket({
    gameId: 'first-point-sim', homeTeam: { abbr: 'H' }, awayTeam: { abbr: 'A' },
    homePlayers: [foulPlayer('home-ft', 'H')], awayPlayers: [foulPlayer('away-ft', 'A')],
    settlementRule: SETTLEMENT_RULES.FIRST_POINT_SCORED, simIterations: 10000, seed: 'first-point',
  });
  assert.ok(game.players.some(p => p.simMethods.freeThrow > 0));
  assert.equal(game.players.reduce((sum, p) => sum + p.gameProb, 0), 1);
  const fgOnlyGame = scoreGameFirstBasket({
    gameId: 'first-field-goal-sim', homeTeam: { abbr: 'H' }, awayTeam: { abbr: 'A' },
    homePlayers: [foulPlayer('home-fg', 'H')], awayPlayers: [foulPlayer('away-fg', 'A')],
    settlementRule: SETTLEMENT_RULES.FIRST_FIELD_GOAL, simIterations: 10000, seed: 'first-point',
  });
  assert.equal(fgOnlyGame.players.reduce((sum, p) => sum + p.simMethods.freeThrow, 0), 0);
});

test('confirmed lineups receive the shrunk PBP opening-shot share', () => {
  const home = getStartersForTeam('BOS');
  const away = getStartersForTeam('NYK');
  const teamBlock = (abbr, players) => ({
    team: { abbreviation: abbr },
    statistics: [{ athletes: players.map(p => ({
      starter: true, athlete: { id: p.id, displayName: p.name, position: { abbreviation: p.position } },
    })) }],
  });
  const game = { gameId: 'confirmed-opening-history', date: '2026-10-31T00:00:00Z',
    homeTeam: { abbr: 'BOS' }, awayTeam: { abbr: 'NYK' } };
  const statsById = new Map([...home, ...away].map(p => [String(p.id), {
    gamesPlayed: 10, threesAttemptedPerGame: 4, threePointPct: 0.36,
  }]));
  const zonesById = Object.fromEntries([...home, ...away].map(p => [String(p.id), {
    rim: { made: 30, attempts: 50 }, mid: { made: 20, attempts: 50 },
    three: { made: 40, attempts: 100 }, source: 'nba_stats_leaguedashplayershotlocations',
  }]));
  const history = players => {
    const byPlayer = { [players[0].name.toLowerCase()]: { attempts: 8, made: 5 } };
    const recentByPlayer = { [players[0].name.toLowerCase()]: 20 };
    return { status: 'ok', season: '2026-27', sampleCount: 10, byPlayer,
      recentRole: {
        last5: { sampleGames: 5, shotCount: 10, byPlayer: { [players[0].name.toLowerCase()]: 10 } },
        last10: { sampleGames: 10, shotCount: 20, byPlayer: recentByPlayer },
      },
      openingTempo: { sampleCount: 10, totalSeconds: 180, meanSeconds: 18 } };
  };
  const snapshot = buildLiveNBASnapshot([game], {
    gameSummaries: { [game.gameId]: { boxscore: { players: [teamBlock('BOS', home), teamBlock('NYK', away)] } } },
    playerStatsById: statsById,
    zoneStatsByPlayerId: zonesById,
    teamStatsByTeam: {
      BOS: { pace: 99, paceSource: 'nba_stats_leaguedashteamstats_advanced', paceSeason: '2026-27', opp3PtPct: 0.35 },
      NYK: { pace: 101, paceSource: 'nba_stats_leaguedashteamstats_advanced', paceSeason: '2026-27', opp3PtPct: 0.37 },
    },
    openingTendenciesByTeam: { BOS: history(home), NYK: history(away) },
  });
  const teamPlayers = snapshot.players.filter(p => p.isHome);
  const observedOpener = teamPlayers.find(p => p.name === home[0].name);
  assert.ok(snapshot.games[0].lineupStatus.confirmed);
  assert.ok(observedOpener.earlyShotShare > 0.30, `PBP-shrunk share should be applied, got ${observedOpener.earlyShotShare}`);
  assert.equal(observedOpener.dataSources.earlyShotShare, 'pbpstats_season_l5_l10_blended');
  assert.equal(observedOpener.openingRoleRecent.applied, true);
  assert.equal(snapshot.games[0].inputQuality.recentOpeningRoleCoverage, 1);
  assert.equal(snapshot.games[0].pace, 100);
  assert.deepEqual(snapshot.games[0].paceEvidence, {
    source: 'nba_stats_leaguedashteamstats_advanced', season: '2026-27', coverage: 1,
    home: { team: 'BOS', pace: 99, source: 'nba_stats_leaguedashteamstats_advanced' },
    away: { team: 'NYK', pace: 101, source: 'nba_stats_leaguedashteamstats_advanced' },
  });
  assert.equal(observedOpener.zoneFG.rim, 62);
  assert.ok(!observedOpener.recommendationBlocks.includes('opening_sequence_rates_not_observed'));
  assert.equal(snapshot.games[0].probabilitySource, 'monte_carlo_possession_sequence_v1');
  assert.equal(validateNBASnapshot(snapshot), snapshot);
});


