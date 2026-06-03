/**
 * @fileoverview Pre-built parlay template builders.
 *
 * Pure functions — no React, no side effects. Each builder scans the
 * results slate and returns up to `count` batter legs that match a
 * specific archetype. The returned leg shape matches what ParlayScreen's
 * addToParlayPick / handleAddCard expect, so the call site can call
 * addToParlayPick(leg) directly for each returned element.
 *
 * Deduplication: each builder tracks seen playerIds so the same batter
 * never appears twice (e.g. doubleheader games would otherwise score the
 * same player for each game pk).
 */

import { SCORE_TIERS } from '../sports/mlb/logic/ProbabilityEngine';

// ─── Park lists ──────────────────────────────────────────────────────────────

/** HR-friendly parks. Matches the NUKE_PARKS list in parlayPairings.js. */
const NUKE_PARK_NAMES = [
  'Coors Field',
  'Great American Ball Park',
  'Yankee Stadium',
  'Citizens Bank Park',
  'Globe Life Field',
  'Camden Yards',
  'Oriole Park at Camden Yards',
];

function isNukePark(venueName) {
  if (!venueName) return false;
  return NUKE_PARK_NAMES.some(n => venueName.includes(n));
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Normalize `batter.grade` to a plain string label like "PRIME" / "STRONG".
 * The field can be either a raw string OR an object `{ label, min, color }`.
 */
function gradeLabel(batter) {
  if (!batter.grade) return 'SKIP';
  if (typeof batter.grade === 'string') return batter.grade;
  return batter.grade.label || 'SKIP';
}

/**
 * Build a parlay leg from a raw batter + its parent game.
 * Shape matches handleAdd / handleAddCard in ParlayScreen.
 */
function makeLeg(batter, game) {
  return {
    playerId:      batter.playerId,
    gamePk:        game.gamePk,
    name:          batter.name,
    team:          batter.team,
    teamId:        batter.teamId,
    score:         batter.score,
    grade:         batter.grade,
    globalRank:    batter.globalRank,
    hot:           batter.hot,
    due:           batter.due,
    cold:          batter.cold,
    bullpenLegend: batter.bullpenLegend,
    bullpenSplits: batter.bullpenSplits,
    reasons:       batter.reasons,
    eli5Reasons:   batter.eli5Reasons,
  };
}

/**
 * Flatten all batters from the results slate into `{ batter, game }` pairs,
 * sorted descending by `batter.score`. The `filter` predicate receives
 * `(batter, game)` and must return true for the batter to be included.
 *
 * Deduplication by playerId: only the first (highest-score) game entry for
 * each player is kept when the same player appears in multiple games
 * (doubleheader).
 */
function buildSortedPool(results, filter) {
  const seen = new Set();
  const pool = [];

  if (!Array.isArray(results)) return pool;

  for (const game of results) {
    for (const batter of game.batters || []) {
      if (!filter(batter, game)) continue;
      if (seen.has(batter.playerId)) continue;
      seen.add(batter.playerId);
      pool.push({ batter, game });
    }
  }

  pool.sort((a, b) => b.batter.score - a.batter.score);
  return pool;
}

// ─── Template builders ────────────────────────────────────────────────────────

/**
 * NUKE PARK STACK — top `count` scoring batters whose game is played at a
 * known HR-friendly ballpark. Mix of teams is fine.
 *
 * @param {Array}  results  Today's slate from AppContext
 * @param {number} count    How many legs to return (default 3)
 * @returns {Array} Array of batter legs, empty if no qualifying picks
 */
export function buildNukeParkTemplate(results, count = 3) {
  const pool = buildSortedPool(
    results,
    (_batter, game) => isNukePark(game.venueName),
  );
  return pool.slice(0, count).map(({ batter, game }) => makeLeg(batter, game));
}

/**
 * ZONE MASTER TRIO — top `count` batters where the zone-matchup badge is
 * 'ZONE_MASTER' AND the score is at least STRONG (≥ 52).
 *
 * @param {Array}  results  Today's slate from AppContext
 * @param {number} count    How many legs to return (default 3)
 * @returns {Array} Array of batter legs, empty if no qualifying picks
 */
export function buildZoneMasterTemplate(results, count = 3) {
  const pool = buildSortedPool(
    results,
    (batter) =>
      batter.zoneMatchup?.badge === 'ZONE_MASTER' &&
      batter.score >= SCORE_TIERS.STRONG,
  );
  return pool.slice(0, count).map(({ batter, game }) => makeLeg(batter, game));
}

/**
 * PRIME ONLY — top `count` batters graded PRIME (handles grade as string or
 * object).
 *
 * @param {Array}  results  Today's slate from AppContext
 * @param {number} count    How many legs to return (default 3)
 * @returns {Array} Array of batter legs, empty if no qualifying picks
 */
export function buildPrimeOnlyTemplate(results, count = 3) {
  const pool = buildSortedPool(
    results,
    (batter) => gradeLabel(batter) === 'PRIME',
  );
  return pool.slice(0, count).map(({ batter, game }) => makeLeg(batter, game));
}

/**
 * HOT BATS — top `count` batters where `batter.hot === true`.
 *
 * @param {Array}  results  Today's slate from AppContext
 * @param {number} count    How many legs to return (default 3)
 * @returns {Array} Array of batter legs, empty if no qualifying picks
 */
export function buildHotBatsTemplate(results, count = 3) {
  const pool = buildSortedPool(
    results,
    (batter) => batter.hot === true,
  );
  return pool.slice(0, count).map(({ batter, game }) => makeLeg(batter, game));
}
