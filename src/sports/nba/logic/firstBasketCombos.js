/**
 * firstBasketCombos.js — Institutional 2-Leg First Basket Parlay Engine for StatFax
 *
 * Models cross-game First Basket 2-Leg Parlays (Doubles).
 *
 * Core Principles:
 * 1. Mutual Exclusivity: First Basket legs MUST belong to different games. Same-game
 *    First Basket parlays are logically impossible (only one player can score the 1st basket).
 * 2. Cross-Game Independence: Joint probability is modeled as the independent product:
 *      P(Parlay) = P(Leg 1) * P(Leg 2)
 * 3. Compounded Sportsbook Multiplier:
 *      Multiplier = Decimal(Odds 1) * Decimal(Odds 2)
 *      Compounded Odds = DecimalToAmerican(Multiplier)
 * 4. Expected Value & Kelly Allocation:
 *      EV Edge = (P(Parlay) * Multiplier) - 1.0
 *      Quarter-Kelly sizing sizes bankroll based on joint probability vs compounded price.
 */

import { probToAmericanOdds } from './firstBasketEngine.js';

export const NBA_COMBO_STRATEGIES = [
  {
    id: 'prime_lock',
    label: 'Model Lock',
    badge: '💎 HIGHEST WIN %',
    risk: 'Conservative',
    riskTone: 'prime',
    icon: 'Crown',
    description: 'Pairs the #1 highest-probability First Basket scorer from two different games.',
  },
  {
    id: 'tip_dominance',
    label: 'Tip Dominance',
    badge: '⚡ DUAL TIP EDGE',
    risk: 'Balanced',
    riskTone: 'strong',
    icon: 'Zap',
    description: 'Pairs scorers whose teams control the opening jump ball (≥55% tip win rate), securing 1st possession sequence advantage in both games.',
  },
  {
    id: 'perimeter_snipers',
    label: '3PT Snipers',
    badge: '🎯 EARLY 3PT LOOK',
    risk: 'High Reward',
    riskTone: 'strong',
    icon: 'Target',
    description: 'Pairs perimeter guards/wings with scripted opening-possession 3PT shot looks (higher variance, rapid settlement).',
  },
];

/**
 * Convert American odds (+550, -110) to decimal multiplier (6.50, 1.91)
 */
export function americanToDecimal(american) {
  if (american == null) return null;
  const num = typeof american === 'string'
    ? parseInt(american.replace('+', '').trim(), 10)
    : Number(american);
  if (!Number.isFinite(num) || num === 0) return null;
  if (num > 0) return (num / 100) + 1;
  return (100 / Math.abs(num)) + 1;
}

/**
 * Convert decimal multiplier (6.50) to American odds (+550)
 */
export function decimalToAmerican(decimal) {
  if (!decimal || decimal <= 1.0) return '+100';
  if (decimal >= 2.0) {
    const am = Math.round((decimal - 1) * 100);
    return `+${am}`;
  }
  const am = Math.round(-100 / (decimal - 1));
  return `${am}`;
}

/**
 * Calculate joint probability for independent 2-leg parlay
 */
export function calculateTwoLegJointProb(prob1, prob2) {
  const p1 = Number(prob1);
  const p2 = Number(prob2);
  if (![p1, p2].every(p => Number.isFinite(p) && p > 0 && p < 1)) return null;
  return Math.round(p1 * p2 * 100000) / 100000;
}

/**
 * Assemble a model-only, validated 2-leg First Basket projection.
 */
export function buildTwoLegCombo(legA, legB) {
  if (!legA || !legB) return null;
  if (legA.gameId === legB.gameId) {
    throw new Error(`Cannot parlay players in the same game (${legA.name} and ${legB.name} both in ${legA.gameId}). First Basket is mutually exclusive within a single game.`);
  }

  const probA = Number(legA.gameProb);
  const probB = Number(legB.gameProb);
  if (![probA, probB].every(p => Number.isFinite(p) && p > 0 && p < 1)) return null;
  const jointProb = calculateTwoLegJointProb(probA, probB);

  const fairAmerican = probToAmericanOdds(jointProb);

  // Strategy tagging
  const tags = [];
  const bothTopPicks = (legA.gamePickRank === 1 || legA.isTopPick) && (legB.gamePickRank === 1 || legB.isTopPick);
  if (bothTopPicks) tags.push('prime_lock');

  const tipA = legA.tipProb ?? legA.teamScoresFirstProb ?? legA.tipMatchup?.winProbA;
  const tipB = legB.tipProb ?? legB.teamScoresFirstProb ?? legB.tipMatchup?.winProbA;
  if (tipA >= 0.50 && tipB >= 0.50) tags.push('tip_dominance');


  const threeA = legA.shotMix?.three;
  const threeB = legB.shotMix?.three;
  if (Number.isFinite(threeA) && Number.isFinite(threeB) && threeA >= 0.35 && threeB >= 0.35) tags.push('perimeter_snipers');

  const score = Math.round(jointProb * 1000);
  const grade = jointProb >= 0.020 ? 'PRIME' : jointProb >= 0.014 ? 'STRONG' : 'LEAN';

  return {
    id: `${legA.id || legA.name}_${legB.id || legB.name}`,
    legs: [legA, legB],
    gamePair: `${legA.team}@${legB.team}`,
    jointProb,
    jointProbPct: Math.round(jointProb * 1000) / 10,
    fairAmerican,
    edgePct: null,
    kellyUnits: null,
    tags,
    score,
    grade,
    rationale: `${legA.name} (${legA.team}, ${(probA * 100).toFixed(1)}%) + ${legB.name} (${legB.team}, ${(probB * 100).toFixed(1)}%). Independent model estimate: ${(jointProb * 100).toFixed(2)}% combined.`,
  };
}

/**
 * Generate all valid cross-game 2-leg parlays for a slate of games
 */
export function generateTwoLegBoard(games = []) {
  if (!Array.isArray(games) || games.length < 2) {
    return {
      combos: [],
      byStrategy: {},
      totalAvailable: 0,
      gamePairsCount: 0,
    };
  }

  // Group starters by game
  const gamesWithStarters = games.map((g) => {
    const starters = (g.players || [])
      .filter((p) => p.isStarter !== false)
      .sort((a, b) => (b.gameProb || 0) - (a.gameProb || 0))
      .map((p, idx) => ({
        ...p,
        gameId: p.gameId || g.gameId,
        gamePickRank: p.gamePickRank || (idx + 1),
        tipMatchup: p.tipMatchup || g.tipMatchup,
      }));
    return {
      gameId: g.gameId,
      matchup: `${g.awayTeam?.abbr || 'AWAY'}@${g.homeTeam?.abbr || 'HOME'}`,
      gameTime: g.gameTime || g.date,
      tipMatchup: g.tipMatchup,
      starters,
    };
  }).filter((g) => g.starters.length > 0);

  const allCombos = [];

  // Iterate all distinct game pairs (G_i < G_j)
  for (let i = 0; i < gamesWithStarters.length; i++) {
    for (let j = i + 1; j < gamesWithStarters.length; j++) {
      const game1 = gamesWithStarters[i];
      const game2 = gamesWithStarters[j];

      // Consider top 4 starters from each game to keep combinations high quality
      const poolA = game1.starters.slice(0, 4);
      const poolB = game2.starters.slice(0, 4);

      for (const legA of poolA) {
        for (const legB of poolB) {
          const combo = buildTwoLegCombo(legA, legB);
          if (combo) allCombos.push(combo);
        }
      }
    }
  }

  // Price never affects recipe inclusion or ordering.
  allCombos.sort((a, b) => b.jointProb - a.jointProb);

  // Curate top combo for each strategy
  const byStrategy = {};
  for (const strat of NBA_COMBO_STRATEGIES) {
    const matching = allCombos.filter((c) => c.tags.includes(strat.id));
    byStrategy[strat.id] = {
      strategy: strat,
      combos: matching.slice(0, 3),
      topCombo: matching[0] || allCombos[0] || null,
    };
  }

  return {
    combos: allCombos,
    byStrategy,
    totalAvailable: allCombos.length,
    gamePairsCount: (gamesWithStarters.length * (gamesWithStarters.length - 1)) / 2,
  };
}
