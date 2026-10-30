/**
 * firstBasketEngine.js — Institutional NBA First Basket Scorer & Sequence Intelligence Engine
 *
 * Implements the full First Basket modeling pipeline:
 * 1. Opening Tip-Off Model with Bayesian sample shrinkage and standing reach advantage.
 * 2. First-Possession Sequence & Markov Chain:
 *    - Turnovers (which flip possession without a shot).
 *    - Early-minute shot share (minutes 0-3 scripted play distribution).
 *    - Zone shot mix (Rim/Paint vs Mid-Range vs 3PT) with defensive resistance.
 *    - Offensive Rebounds (misses that extend the sequence for second-chance putbacks).
 *    - Free Throw Settlement Rules (DraftKings/FanDuel FG-only vs First Point Scored).
 * 3. Multi-Book Odds De-Vigging (DraftKings, FanDuel, BetMGM, Caesars) & Closing Line Edge.
 * 4. Quarter-Kelly Bankroll Sizing & Confirmed Lineups Window (~30m pre-tip).
 */

import { getJumperProfile, predictJumpBallMatchup, TIP_WIN_CONVERSION_RATE } from '../data/jumpBalls.js';

// ─── Constants & Rules ─────────────────────────────────────────────────────────

export const SETTLEMENT_RULES = {
  FIRST_FIELD_GOAL:   'FIRST_FIELD_GOAL',   // Standard DraftKings & FanDuel: FTs do NOT count; field goals only.
  FIRST_POINT_SCORED: 'FIRST_POINT_SCORED', // First Point market: Made free throws CAN settle the bet.
};

export const FIRST_BASKET_TIERS = {
  PRIME:  14,   // 💎 ELITE (~14%+ probability)
  STRONG:  9,   // ⚡ STRONG (~9-13.9%)
  VALUE:   6,   // 👀 VALUE (~6-8.9%)
  LEAN:    4,   // 🎯 LEAN (~4-5.9%)
  LONG:    0,   // 🎲 LONGSHOT (<4%)
};

// Positional early possession initiation weights (neutral 1.0; player earlyShare and zone make rates govern conversion)
export const FB_POSITION_WEIGHTS = {
  C:  1.00,
  PF: 1.00,
  PG: 1.00,
  SF: 1.00,
  SG: 1.00,
};

// Shot proximity conversion is modeled directly by expectedMakeRate (rim FG%, mid FG%, 3PT FG%);
// set to 1.00 to eliminate artificial double-counting of rim finishers
export const FB_SHOT_PROXIMITY_WEIGHTS = {
  C:  1.00,
  PF: 1.00,
  SF: 1.00,
  PG: 1.00,
  SG: 1.00,
};

export const STARTER_WEIGHT = 1.00;
export const BENCH_WEIGHT   = 0.015; // Bench accounts for <2% of 1st baskets league-wide
export const LEAGUE_EARLY_TURNOVER_RATE = 0.125; // 12.5% of opening possessions end in turnovers
export const LEAGUE_OREB_RATE           = 0.260; // 26% offensive rebound rate on missed shots
export const LEAGUE_SHOOTING_FOUL_RATE  = 0.045; // 4.5% shooting fouls on 1st possession

// ─── Math & Odds Helpers ───────────────────────────────────────────────────────

export function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Convert probability (0-1) to American Odds string (+450, -110)
 */
export function probToAmericanOdds(prob) {
  if (!prob || prob <= 0) return '+9900';
  if (prob >= 0.99) return '-9900';
  if (prob >= 0.5) {
    const american = Math.round((-100 * prob) / (1 - prob));
    return `${american}`;
  }
  const american = Math.round((100 * (1 - prob)) / prob);
  return `+${american}`;
}

/**
 * Convert American Odds string/number (+450, -110) to implied probability (0-1)
 */
export function americanOddsToProb(odds) {
  const num = typeof odds === 'string' ? parseInt(odds.replace('+', ''), 10) : Number(odds);
  if (!Number.isFinite(num) || num === 0) return null;
  if (num > 0) return 100 / (num + 100);
  return Math.abs(num) / (Math.abs(num) + 100);
}

/**
 * De-vig multi-runner market via power/additive normalization
 */
export function devigOddsMarket(oddsMap) {
  const entries = Object.entries(oddsMap).map(([id, odds]) => ({
    id,
    odds,
    implied: americanOddsToProb(odds) || 0,
  }));

  const totalImplied = entries.reduce((sum, e) => sum + e.implied, 0);
  if (totalImplied <= 0) return {};

  const devigged = {};
  for (const e of entries) {
    devigged[e.id] = {
      odds: e.odds,
      implied: e.implied,
      fairProb: e.implied / totalImplied,
      vigPct: Math.round((totalImplied - 1.0) * 1000) / 10,
    };
  }
  return devigged;
}

/**
 * Compute positive EV edge: (ModelProb - ImpliedProb) / ImpliedProb * 100
 */
export function computeOddsEdge(modelProb, bookOdds) {
  const implied = americanOddsToProb(bookOdds);
  if (!implied || implied <= 0 || !modelProb) return null;
  const edge = ((modelProb - implied) / implied) * 100;
  return Math.round(edge * 10) / 10;
}

/**
 * Fractional Kelly Criterion unit recommendation (Quarter-Kelly, bounded [0.10u, 1.00u])
 */
export function calculateQuarterKelly(modelProb, bookOdds) {
  const implied = americanOddsToProb(bookOdds);
  if (!implied || !modelProb || modelProb <= implied) return 0;

  const oddsNum = typeof bookOdds === 'string' ? parseInt(bookOdds.replace('+', ''), 10) : Number(bookOdds);
  const b = oddsNum > 0 ? oddsNum / 100 : 100 / Math.abs(oddsNum);
  const p = modelProb;
  const q = 1 - p;

  const fullKelly = (b * p - q) / b;
  if (fullKelly <= 0) return 0;

  const quarterKelly = fullKelly * 0.25;
  return Math.min(1.0, Math.max(0.1, Math.round(quarterKelly * 100) / 100));
}

export function gradeFromScore(score) {
  if (score >= FIRST_BASKET_TIERS.PRIME)  return 'PRIME';
  if (score >= FIRST_BASKET_TIERS.STRONG) return 'STRONG';
  if (score >= FIRST_BASKET_TIERS.VALUE)  return 'VALUE';
  if (score >= FIRST_BASKET_TIERS.LEAN)   return 'LEAN';
  return 'LONG';
}

export function normalizePosition(pos) {
  if (!pos || typeof pos !== 'string') return 'SF';
  const p = pos.toUpperCase().trim().split(/[-/,\s]/)[0];
  if (['PG', 'POINT', 'G'].includes(p)) return 'PG';
  if (['SG', 'SHOOTING'].includes(p))   return 'SG';
  if (['SF', 'FORWARD', 'F'].includes(p)) return 'SF';
  if (['PF', 'POWER'].includes(p))      return 'PF';
  if (['C', 'CENTER'].includes(p))      return 'C';
  return 'SF';
}

// ─── Sequence Markov Simulation ────────────────────────────────────────────────

/**
 * Compute the first possession scoring probabilities for a team,
 * incorporating turnovers, early shot shares, offensive rebounds, and settlement rules.
 */
export function evaluateTeamPossessionSequence({
  teamPlayers = [],
  oppDefense = {},
  settlementRule = SETTLEMENT_RULES.FIRST_FIELD_GOAL,
}) {
  const roster = Array.isArray(teamPlayers) ? [...teamPlayers] : [];
  if (roster.length === 0) return [];

  const teamOrebRate = oppDefense.orebRateAllowed != null
    ? (LEAGUE_OREB_RATE + oppDefense.orebRateAllowed) / 2
    : LEAGUE_OREB_RATE;

  const teamTurnoverRate = oppDefense.foulTurnoverForced != null
    ? (LEAGUE_EARLY_TURNOVER_RATE + oppDefense.foulTurnoverForced) / 2
    : LEAGUE_EARLY_TURNOVER_RATE;

  // Probability possession generates at least one field goal attempt before a defensive stop:
  // Modeled as Markov sequence:
  // 1. Initial Possession Turnover check (1 - TOV)
  // 2. Early-minute shot share (minutes 0-3 scripted looks)
  // 3. Make probability by shot zone adjusted for opponent rim & 3PT contest
  // 4. Offensive Rebound extension on misses (OREB rate * Make Rate)
  // 5. Settlement Rule: Under FIRST_POINT_SCORED, shooting fouls drawn settle immediately
  const rawRows = roster.map((player) => {
    const pos = normalizePosition(player.position);
    const isStarter = typeof player.isStarter === 'boolean'
      ? player.isStarter
      : (roster.indexOf(player) >= 0 ? roster.indexOf(player) < 5 : true);

    const starterFactor = isStarter ? STARTER_WEIGHT : BENCH_WEIGHT;
    const posFactor = FB_POSITION_WEIGHTS[pos] ?? 1.0;
    const proxFactor = FB_SHOT_PROXIMITY_WEIGHTS[pos] ?? 1.0;

    // Early-minute shot share (Min 0-3 scripted looks from play-by-play)
    const earlyShare = Number.isFinite(player.earlyShotShare)
      ? player.earlyShotShare
      : (Number.isFinite(player.firstShotShare) ? player.firstShotShare : (pos === 'C' ? 0.25 : pos === 'PG' ? 0.23 : 0.17));

    // Shot mix breakdown across Rim/Paint, Mid-range, and 3-pointers
    const shotMix = player.shotMix || {
      rim: pos === 'C' ? 0.65 : pos === 'PF' ? 0.45 : 0.25,
      mid: pos === 'C' ? 0.15 : 0.30,
      three: pos === 'C' ? 0.20 : pos === 'PF' ? 0.25 : 0.45,
    };

    // Make rates adjusted for opponent defensive resistance
    const rimMake = clamp((player.rimFG || 0.68) * (oppDefense.rimProtectionFactor || 1.0), 0.50, 0.82);
    const midMake = clamp((player.midFG || 0.44) * (oppDefense.midDefenseFactor || 1.0), 0.35, 0.55);
    const threeMake = clamp((player.threeFG || player.seasonStats?.threePointPct || 0.36) * (oppDefense.threePtDefenseFactor || 1.0), 0.28, 0.48);

    const expectedMakeRate = (shotMix.rim * rimMake) + (shotMix.mid * midMake) + (shotMix.three * threeMake);

    // Free throw rule consideration:
    // If book settles on FIRST_POINT_SCORED, drawing a foul and hitting FT settles immediately.
    // If book settles on FIRST_FIELD_GOAL (DraftKings/FanDuel standard), FTs do NOT count.
    const ftBonus = (settlementRule === SETTLEMENT_RULES.FIRST_POINT_SCORED)
      ? ((player.ftRate || 0.28) * (player.ftPct || 0.78) * LEAGUE_SHOOTING_FOUL_RATE)
      : 0;

    // Combined first shot scoring density
    // Clean empirical sequence continuation:
    // 1. Initial look conversion: earlyShare * expectedMakeRate
    // 2. Putback conversion on missed initial looks:
    // Second-chance putback only occurs IF the initial shot misses!
    const initialLookScoring = earlyShare * expectedMakeRate;
    const teamMissOpportunity = (1.0 - expectedMakeRate) * teamOrebRate;
    const playerOrebShare = pos === 'C' ? 0.30 : pos === 'PF' ? 0.24 : pos === 'SF' ? 0.18 : pos === 'SG' ? 0.14 : 0.14;
    const secondChancePutback = teamMissOpportunity * playerOrebShare * rimMake;

    const rawWeight = (1 - teamTurnoverRate) * (initialLookScoring + secondChancePutback) * starterFactor + ftBonus;

    const primaryMethod = shotMix.three > 0.40
      ? '3PT'
      : (shotMix.rim > 0.45 ? 'Paint / Dunk' : '2PT Mid / Drive');

    const scriptedSetPlay = player.scriptedSetPlay || (
      pos === 'C' ? 'High PnR Roll / Lob' :
      pos === 'PG' ? 'Horns Set / PnR Pull-Up' :
      pos === 'PF' ? 'Short Roll / Duck-In' :
      pos === 'SG' ? 'Stagger Screen Pin-Down' : 'Corner Flare / Cut'
    );

    const roleContext = player.roleContext || (
      isStarter
        ? 'Confirmed starting 5; full rotation clearance'
        : 'Bench reserve; <2% opening possession share'
    );

    return {
      player,
      pos,
      isStarter,
      earlyShare,
      seasonUsage: Number.isFinite(player.seasonStats?.usageProxy) ? player.seasonStats.usageProxy : Math.round(earlyShare * 100),
      shotMix,
      rimMake: Math.round(rimMake * 100),
      midMake: Math.round(midMake * 100),
      threeMake: Math.round(threeMake * 100),
      expectedMakeRate,
      rawWeight,
      primaryMethod,
      turnoverRate: teamTurnoverRate,
      orebRate: teamOrebRate,
      ftBonus,
      scriptedSetPlay,
      roleContext,
      posFactor,
      proxFactor,
      starterFactor,
    };
  });

  const totalRawWeight = rawRows.reduce((sum, r) => sum + r.rawWeight, 0);

  return rawRows.map((r) => {
    const teamProb = totalRawWeight > 0 ? r.rawWeight / totalRawWeight : 0;
    const score = Math.round(teamProb * 100);
    const grade = gradeFromScore(score);
    const fairOdds = probToAmericanOdds(teamProb);

    return {
      id: r.player.id || `${r.player.name}-${r.player.team || 'NBA'}`,
      name: r.player.name,
      team: r.player.team || 'NBA',
      opponent: r.player.opponent || '',
      position: r.pos,
      isStarter: r.isStarter,
      jersey: r.player.jersey || null,
      teamProb: Math.round(teamProb * 1000) / 1000,
      score,
      grade,
      fairOdds,
      earlyShotShare: r.earlyShare,
      seasonUsage: r.seasonUsage,
      expectedMakeRate: Math.round(r.expectedMakeRate * 1000) / 10,
      scriptedSetPlay: r.scriptedSetPlay,
      roleContext: r.roleContext,
      method: {
        primary: r.primaryMethod,
        prob2PT: Math.round((1 - r.shotMix.three) * 100) / 100,
        prob3PT: Math.round(r.shotMix.three * 100) / 100,
      },
      shotMix: r.shotMix,
      zoneFG: {
        rim: r.rimMake,
        mid: r.midMake,
        three: r.threeMake,
      },
      turnoverRate: Math.round(r.turnoverRate * 1000) / 10,
      orebExtensionPct: Math.round(r.orebRate * 1000) / 10,
      breakdown: {
        posWeight: r.posFactor,
        proximityWeight: r.proxFactor,
        usageFactor: Math.round(r.earlyShare * 1000) / 1000,
        starterWeight: r.starterFactor,
        expectedMakeRate: Math.round(r.expectedMakeRate * 1000) / 10,
        turnoverRate: Math.round(r.turnoverRate * 1000) / 10,
        orebRate: Math.round(r.orebRate * 1000) / 10,
        ftBonus: Math.round(r.ftBonus * 1000) / 1000,
      },
    };
  });
}

/**
 * Backward-compatible alias for team First Basket scoring
 */
export function scoreTeamFirstBasket(players, oppDefense = {}, teamInfo = {}) {
  const result = evaluateTeamPossessionSequence({
    teamPlayers: players,
    oppDefense,
  });
  return result.map((p) => ({
    ...p,
    team: teamInfo?.abbr || p.team,
  }));
}

// ─── Core Game First Basket Scoring ────────────────────────────────────────────

/**
 * Score full game First Basket with Markov opening possession sequence,
 * multi-book odds comparison, and settlement rules.
 */
export function scoreGameFirstBasket({
  gameId = 'game-1',
  homeTeam,
  awayTeam,
  homePlayers = [],
  awayPlayers = [],
  homeJumper = null,
  awayJumper = null,
  marketOdds = {},      // { [playerId]: { draftkings, fanduel, betmgm, caesars } or string }
  closingLines = {},    // benchmark lines: { [playerId]: { opening, closing, movement } or string }
  settlementRule = SETTLEMENT_RULES.FIRST_FIELD_GOAL,
  homeOppDefense = {},
  awayOppDefense = {},
  gameTime = null,
  lineupStatus = { confirmed: true, announcedMinutesAgo: 24, status: 'CONFIRMED' },
  pace = 100.0,
}) {
  // 1. Opening Tip Matchup with sample-size Bayesian shrinkage & reach differential
  const homeJumperName = typeof homeJumper === 'string'
    ? homeJumper
    : (homeJumper?.name || homePlayers.find((p) => normalizePosition(p.position) === 'C')?.name || homePlayers[0]?.name || homeTeam?.abbr);
  const awayJumperName = typeof awayJumper === 'string'
    ? awayJumper
    : (awayJumper?.name || awayPlayers.find((p) => normalizePosition(p.position) === 'C')?.name || awayPlayers[0]?.name || awayTeam?.abbr);

  const tipMatchup = predictJumpBallMatchup(homeJumperName, awayJumperName);

  // Home and Away First Basket probabilities based on tip winner conversion
  const homeTeamScoresFirstProb = tipMatchup.teamAScoresFirstProb;
  const awayTeamScoresFirstProb = tipMatchup.teamBScoresFirstProb;

  // 2. Sequence Markov evaluation for both teams
  const homeScored = evaluateTeamPossessionSequence({
    teamPlayers: homePlayers,
    oppDefense: homeOppDefense,
    settlementRule,
  });
  const awayScored = evaluateTeamPossessionSequence({
    teamPlayers: awayPlayers,
    oppDefense: awayOppDefense,
    settlementRule,
  });

  // Sort and assign teamRank
  homeScored.sort((a, b) => b.teamProb - a.teamProb);
  awayScored.sort((a, b) => b.teamProb - a.teamProb);
  homeScored.forEach((p, idx) => { p.teamRank = idx + 1; });
  awayScored.forEach((p, idx) => { p.teamRank = idx + 1; });

  // 3. Joint Game-Wide Probability Distribution
  const allGamePlayers = [
    ...homeScored.map((p) => ({
      ...p,
      isHome: true,
      gameProb: Math.round(p.teamProb * homeTeamScoresFirstProb * 1000) / 1000,
      teamScoresFirstProb: homeTeamScoresFirstProb,
    })),
    ...awayScored.map((p) => ({
      ...p,
      isHome: false,
      gameProb: Math.round(p.teamProb * awayTeamScoresFirstProb * 1000) / 1000,
      teamScoresFirstProb: awayTeamScoresFirstProb,
    })),
  ];

  // 4. Multi-Book Odds Matrix, De-Vigged Benchmark, and Edge Analysis
  const playersWithMarkets = allGamePlayers.map((player) => {
    const rawOdds = marketOdds[player.id] || marketOdds[player.name?.toLowerCase()] || null;

    // Multi-book quotes & comparison
    let books = null;
    let bestBook = null;
    let bestOdds = null;
    let bestEdge = null;
    const multiBookComparison = {};

    if (rawOdds && typeof rawOdds === 'object') {
      books = rawOdds;
      for (const [bookName, quote] of Object.entries(rawOdds)) {
        if (!quote) continue;
        const implied = americanOddsToProb(quote);
        const edge = computeOddsEdge(player.gameProb, quote);
        const quoteNum = parseInt(String(quote).replace('+', ''), 10);

        multiBookComparison[bookName] = {
          odds: quote,
          implied: implied ? Math.round(implied * 1000) / 10 : null,
          edge,
        };

        if (bestOdds === null || quoteNum > parseInt(String(bestOdds).replace('+', ''), 10)) {
          bestOdds = quote;
          bestBook = bookName;
          bestEdge = edge;
        }
      }
    } else if (rawOdds) {
      bestOdds = String(rawOdds);
      bestBook = 'consensus';
      bestEdge = computeOddsEdge(player.gameProb, bestOdds);
      books = { draftkings: bestOdds, fanduel: bestOdds };
      multiBookComparison.draftkings = { odds: bestOdds, implied: Math.round((americanOddsToProb(bestOdds) || 0) * 1000) / 10, edge: bestEdge };
      multiBookComparison.fanduel = { odds: bestOdds, implied: Math.round((americanOddsToProb(bestOdds) || 0) * 1000) / 10, edge: bestEdge };
    }

    const fairGameOdds = probToAmericanOdds(player.gameProb);
    const fairTeamOdds = player.fairOdds;
    const kellyUnits = bestOdds ? calculateQuarterKelly(player.gameProb, bestOdds) : null;

    // Line movement & closing line benchmark
    const rawBenchmark = closingLines[player.id] || closingLines[player.name?.toLowerCase()] || null;
    let closingBenchmark = null;
    let lineMovement = null;

    if (rawBenchmark && typeof rawBenchmark === 'object') {
      closingBenchmark = rawBenchmark.closing || rawBenchmark.line;
      lineMovement = rawBenchmark;
    } else if (rawBenchmark) {
      closingBenchmark = String(rawBenchmark);
      lineMovement = { opening: closingBenchmark, closing: closingBenchmark, movement: '0' };
    } else if (bestOdds) {
      closingBenchmark = bestOdds;
      lineMovement = { opening: bestOdds, closing: bestOdds, movement: 'Flat' };
    }

    // Rich narrative explanations
    const tipAdvantage = player.teamScoresFirstProb >= 0.55;
    const isTopTeamOption = player.teamRank === 1;

    const eli5 = isTopTeamOption
      ? `${player.name} is ${player.team}'s primary early option (${(player.earlyShotShare * 100).toFixed(0)}% early shot share, ${player.scriptedSetPlay}). ${tipAdvantage ? `${player.team} holds the opening tip edge (${(player.teamScoresFirstProb * 100).toFixed(0)}%).` : 'Scripted early volume overcomes neutral tip.'}`
      : `${player.name} takes ${(player.earlyShotShare * 100).toFixed(0)}% of early shots (${player.method.primary}). ${player.orebExtensionPct > 25 ? 'Benefits from offensive rebound putback sequence.' : ''}`;

    const eli15 = `Model prob ${(player.gameProb * 100).toFixed(1)}% (${fairGameOdds} fair) = ${(player.teamScoresFirstProb * 100).toFixed(1)}% team tip-conversion × ${(player.teamProb * 100).toFixed(1)}% team share. Script: ${player.scriptedSetPlay} (Make rate ${player.expectedMakeRate}%). OREB extension: ${player.orebExtensionPct}%. TOV risk: ${player.turnoverRate}%. Settlement: ${settlementRule}. Pace: ${pace}.`;

    // Bayesian 90% Credible Interval using Logit-Normal Delta Method
    // Produces naturally skewed bounds bounded in (0, 1) rather than symmetric normal approximations
    const mPrior = 25.0; // Dirichlet precision
    const varTeamShare = (player.teamProb * (1 - player.teamProb)) / (mPrior + 1.0);
    const varTeamFirst = 0.0035; // Beta tip-to-first-score variance
    const varGameProb = (player.teamProb * player.teamProb * varTeamFirst) +
                        (player.teamScoresFirstProb * player.teamScoresFirstProb * varTeamShare);
    const seProb = Math.sqrt(Math.max(0.0001, varGameProb));

    // Log-odds transformation (Delta Method)
    const pSafe = Math.max(0.01, Math.min(0.99, player.gameProb));
    const seLogit = seProb / (pSafe * (1.0 - pSafe));
    const logitP = Math.log(pSafe / (1.0 - pSafe));
    const z90 = 1.645;
    const logitLow = logitP - (z90 * seLogit);
    const logitHigh = logitP + (z90 * seLogit);
    const ci90Lower = 1.0 / (1.0 + Math.exp(-logitLow));
    const ci90Upper = 1.0 / (1.0 + Math.exp(-logitHigh));

    const ci90 = {
      lower: Math.max(0.5, Math.round(ci90Lower * 1000) / 10),
      upper: Math.min(95.0, Math.round(ci90Upper * 1000) / 10),
    };

    return {
      ...player,
      ci90,
      fairOdds: fairGameOdds,
      fairGameOdds,
      fairTeamOdds,
      bookOdds: bestOdds,
      bestBook,
      books,
      multiBookComparison,
      edgePct: bestEdge,
      kellyUnits,
      closingBenchmark,
      lineMovement,
      settlementRule,
      eli5,
      eli15,
    };
  });

  // 5. Rank by Game First Basket probability
  playersWithMarkets.sort((a, b) => b.gameProb - a.gameProb);
  const rankedPlayers = playersWithMarkets.map((p, idx) => ({ ...p, gameRank: idx + 1 }));

  return {
    gameId,
    gameTime,
    homeTeam,
    awayTeam,
    settlementRule,
    lineupStatus,
    pace,
    tipMatchup: {
      ...tipMatchup,
      homeJumper: homeJumperName,
      awayJumper: awayJumperName,
      homeTipProb: tipMatchup.tipProbA,
      awayTipProb: tipMatchup.tipProbB,
      homeScoresFirstProb: homeTeamScoresFirstProb,
      awayScoresFirstProb: awayTeamScoresFirstProb,
      reachDiffInches: tipMatchup.reachDiffInches,
      sampleConfidence: tipMatchup.sampleConfidence,
      homeProfile: tipMatchup.jumperA,
      awayProfile: tipMatchup.jumperB,
    },
    topPicks: rankedPlayers.slice(0, 5),
    players: rankedPlayers,
  };
}

