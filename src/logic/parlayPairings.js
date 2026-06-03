/**
 * Best 2-Man parlay recommender
 * ──────────────────────────────
 * Given the scored slate + odds, find the highest expected-value 2-leg
 * combinations and surface them with a short "why" tag so the user
 * understands the angle (cross-park HR stack, both ZONE MASTER, both
 * have positive Vegas edge, etc.).
 *
 * CROSS-GAME BY DEFAULT
 * ─────────────────────
 * The recommender pairs batters from DIFFERENT games. Two HRs in the same
 * game are positively correlated — a high-scoring game lifts both bats — so
 * they're not two independent shots, and most books either restrict the
 * same-game combo or price the correlation into a lower SGP multiplier. Net,
 * a same-game "stack" is a worse parlay than it looks, and surfacing a board
 * full of them buries the genuinely diversified plays. So we only pair across
 * games (the app's own guidance is "spread your legs across games"). The one
 * exception is a single-game slate, where we fall back to same-game so the
 * feature still renders something — those pairs carry `sameGame: true`.
 *
 * Why this module exists: pure parlay math is hard to eyeball. Two PRIMEs
 * from different parks might LOOK like a lock, but if both face elite arms
 * and Vegas agrees with the model (no +EV edge), it's a bad bet. Two STRONGs
 * the book has mispriced can beat two PRIMEs the book nailed. We surface the
 * actual EV winners; the user keeps final say.
 *
 * The math (per pair):
 *   • modelProb     = server isotonic prob (fallback: score → prob curve)
 *   • impliedProb   = de-juiced book "Yes" price
 *   • edge          = modelProb − impliedProb          (per leg)
 *   • jointProb     = p1 × p2                           (independent; legs are
 *                                                        cross-game so this holds)
 *   • jointDecimal  = d1 × d2                           (parlay multiplier / $1)
 *   • ev            = jointProb × jointDecimal − 1      (per $1 staked)
 *
 * Pairs with real odds rank on EV; pairs without (lines not posted yet) fall
 * back to model-only joint probability so the card isn't empty pre-market.
 */

import { SCORE_TIERS } from '../sports/mlb/logic/ProbabilityEngine';

// ─── Math helpers ────────────────────────────────────────────────────────────

/** American odds → decimal payout multiplier (e.g. +450 → 5.50, -120 → 1.833). */
export function americanToDecimal(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1;
}

/** Decimal → American (for displaying the parlay's combined American odds). */
function decimalToAmerican(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2
    ? Math.round((decimal - 1) * 100)
    : Math.round(-100 / (decimal - 1));
}

/** American odds → raw implied probability (still includes the book's vig). */
function americanToRawImplied(american) {
  const n = Number(american);
  if (!Number.isFinite(n) || n === 0) return null;
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100);
}

/**
 * De-juiced implied probability for a HR prop.
 *
 * HR props are binary (yes/no), so the cleanest de-juice is to take the
 * "Yes" raw implied + the "No" raw implied (which sum to >1 because of the
 * vig) and normalize: p_fair = p_yes / (p_yes + p_no). When only the Yes
 * side is stored, fall back to a flat ~8% hold (typical HR-market vig).
 */
function dejuicedImpliedProb(yesAmerican, noAmerican) {
  const py = americanToRawImplied(yesAmerican);
  if (py == null) return null;
  const pn = americanToRawImplied(noAmerican);
  if (pn != null && pn > 0) return py / (py + pn);
  const HOLD = 0.08;
  return py / (1 + HOLD);
}

/**
 * Model score (0–100) → HR probability, used only when the server's
 * isotonic-calibrated `hrProbability` is missing (older snapshot / slow
 * path). Linear 0.025 + score·0.0015, clamped. Good enough for EV ordering
 * since both legs share the curve.
 */
function scoreToModelProb(score) {
  const s = Number(score) || 0;
  return Math.max(0.005, Math.min(0.30, 0.025 + s * 0.0015));
}

/** Number coerce or null. Number(undefined)→NaN, then map NaN→null. */
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ─── Per-batter enrichment ───────────────────────────────────────────────────

/**
 * Flatten the games array into a list of candidates with pre-computed model
 * prob, best price, decimal odds, implied prob, and Vegas edge.
 *
 * Filters out:
 *   - Anyone below STRONG (score < 52) — never recommend a Sleeper leg; the
 *     joint hit rate gets crushed.
 *   - Anyone whose game has no lineup yet (lineupConfirmed === false) IF
 *     confirmed lineups exist elsewhere — don't recommend a guy who might be
 *     benched while certain plays exist.
 *   - Anyone already off the board (homered today — server or live signal).
 * Odds are OPTIONAL: missing prices fall back to model-only ranking.
 */
function enrichCandidates(results, hrHittersToday = null) {
  const out = [];
  const haveAnyConfirmed = (results || []).some(g => g.lineupConfirmed);

  for (const game of results || []) {
    const gameHomerers = new Set(game.homererIds || []);
    for (const batter of game.batters || []) {
      if (!batter || (batter.score ?? 0) < SCORE_TIERS.STRONG) continue;
      if (haveAnyConfirmed && !game.lineupConfirmed) continue;
      if (gameHomerers.has(batter.playerId)) continue;
      if (hrHittersToday?.has?.(batter.playerId)) continue;
      if (batter.homeredToday) continue;

      const odds    = batter.odds;
      const best    = odds?.best;
      const price   = best?.price ?? null;
      const decimal = americanToDecimal(price);
      const hasOdds = Number.isFinite(decimal);

      const noPrice   = best?.noPrice ?? odds?.noPrice ?? null;
      const implied   = hasOdds ? dejuicedImpliedProb(price, noPrice) : null;
      const modelProb = Number.isFinite(batter.hrProbability)
        ? batter.hrProbability
        : scoreToModelProb(batter.score);
      const edge      = implied != null ? modelProb - implied : null;

      // Snapshot stores grade as {label,min,color}; downstream wants the key.
      const gradeStr = typeof batter.grade === 'string'
        ? batter.grade
        : (batter.grade?.label || 'SKIP');

      // Opposing pitcher signals (HR-prone / fatigue / hand).
      const oppPitcher = batter.pitcher || pickOpposingPitcher(batter, game);
      const oppHrPer9Season = numOrNull(oppPitcher?.season?.hrPer9 ?? oppPitcher?.hrPer9);
      const oppHrPer9Recent = numOrNull(oppPitcher?.recentForm?.hrPer9);
      const oppHand = oppPitcher?.hand || oppPitcher?.throws || oppPitcher?.pitchHand
        || pitcherHandForBatter(batter, game);

      // Weather (wind-out detection); roof closed → wind irrelevant.
      const weather = game.weather || game.weatherByGame?.[game.gamePk] || null;
      const windSpeedMph = numOrNull(weather?.windSpeedMph);
      const isOutdoor = !weather?.roofClosed;

      const isOpenerGame = detectOpenerFromPABreakdown(batter.paBreakdown);
      const recent7HR    = numOrNull(batter.recent7?.hr);

      out.push({
        // identity
        playerId:        batter.playerId,
        name:            batter.name,
        gamePk:          game.gamePk,
        teamId:          batter.teamId,
        team:            batter.team,
        // signals
        score:           batter.score,
        grade:           gradeStr,
        batSide:         batter.batSide,
        hot:             batter.hot,
        zoneMaster:      batter.zoneMatchup?.badge === 'ZONE_MASTER',
        lineupConfirmed: !!game.lineupConfirmed,
        // game context
        gameMatchup:     `${game.awayTeam?.abbr ?? '?'} @ ${game.homeTeam?.abbr ?? '?'}`,
        venueName:       game.venueName,
        hrEnvScore:      game.hrEnvScore ?? 50,
        oppPitcherHand:  oppHand,
        // odds (nullable)
        americanOdds:    price,
        decimalOdds:     decimal,
        bookKey:         best?.book ?? null,
        hasOdds,
        // model vs market
        modelProb,
        impliedProb:     implied,
        edge,
        // categorized-tag signals
        oppHrPer9Season,
        oppHrPer9Recent,
        windSpeedMph,
        isOutdoor,
        isOpenerGame,
        recent7HR,
        hrStreak:        numOrNull(batter.hrStreak),   // consecutive games with a HR
        // pass-through for addToParlayPick parity
        globalRank:      batter.globalRank,
        due:             batter.due,
        cold:            batter.cold,
        bullpenLegend:   batter.bullpenLegend,
        bullpenSplits:   batter.bullpenSplits,
        reasons:         batter.reasons,
        eli5Reasons:     batter.eli5Reasons,
      });
    }
  }
  return out;
}

/** Opposing pitcher's throwing hand ('L'|'R') for a batter, or null. */
function pitcherHandForBatter(batter, game) {
  const isHome = batter.teamId && game.homeTeam?.id && batter.teamId === game.homeTeam.id;
  const opp    = isHome ? game.awayPitcher : game.homePitcher;
  return opp?.pitchHand || opp?.throws || null;
}

/** Fallback when batter.pitcher isn't attached — pull from game's home/away. */
function pickOpposingPitcher(batter, game) {
  const isHome = batter.teamId && game.homeTeam?.id && batter.teamId === game.homeTeam.id;
  return isHome ? game.awayPitcher : game.homePitcher;
}

/**
 * Detect opener games from the per-PA hit-prob breakdown. The server emits
 * paBreakdown as `[{pa, p, pitcherHR9}, ...]`; an opener shows >=15% variance
 * in pitcherHR9 across the first 4 PAs (opener → bulk swap), where a routine
 * starter-deep game stays flat until late.
 */
function detectOpenerFromPABreakdown(paBreakdown) {
  if (!Array.isArray(paBreakdown) || paBreakdown.length < 4) return false;
  const first4 = paBreakdown.slice(0, 4).map(p => Number(p?.pitcherHR9)).filter(Number.isFinite);
  if (first4.length < 4) return false;
  const min = Math.min(...first4);
  const max = Math.max(...first4);
  return min > 0 && (max - min) / min >= 0.15;
}

// ─── Pair scoring ────────────────────────────────────────────────────────────

/**
 * Build a pair object from two enriched candidates with joint math + tag.
 *
 * We do NOT apply a same-game correlation boost. The recommender pairs across
 * games by construction, where independence (jointProb = p1·p2) holds. In the
 * single-game fallback the legs ARE correlated, but boosting their joint prob
 * would (a) over-promise the hit rate and (b) compound with the already-too-
 * generous jointDecimal = d1·d2 (real SGP markets price the combo lower). So
 * same-game pairs keep the plain independent estimate and carry sameGame:true
 * for the UI to treat with caution.
 */
function scorePair(a, b) {
  const sameGame      = a.gamePk === b.gamePk;
  const jointProb     = a.modelProb * b.modelProb;

  const bothHaveOdds  = a.hasOdds && b.hasOdds;
  const jointDecimal  = bothHaveOdds ? a.decimalOdds * b.decimalOdds : null;
  const jointAmerican = bothHaveOdds ? decimalToAmerican(jointDecimal) : null;
  const ev            = bothHaveOdds ? jointProb * jointDecimal - 1 : null;

  return {
    legs:           [a, b],
    sameGame,
    jointProb,
    jointDecimal,
    jointAmerican,
    ev,
    bothHaveOdds,
    // Single sort key: real EV when both legs priced, else model-only joint
    // prob. Callers partition by bothHaveOdds so the two scales never mix.
    rankScore:      bothHaveOdds ? ev : jointProb,
    why:            pickWhyTag(a, b, sameGame),
  };
}

/** rankScore with a safe fallback to jointProb. */
function rankOf(pair) {
  return Number.isFinite(pair?.rankScore) ? pair.rankScore : (pair?.jointProb || 0);
}

/**
 * Pick the single strongest "why" tag for a pair, plus its category. The
 * modal groups pairs into sections (Structural / Matchup / Environment /
 * Market / Momentum) so the user sees what KIND of edge each leans on.
 * Order matters — the first matching gate wins, strongest signal first.
 */
function pickWhyTag(a, b, sameGame) {
  // ── STRUCTURAL ──
  if (a.zoneMaster && b.zoneMaster) {
    return { category: 'STRUCTURAL', label: 'BOTH ZONE MASTER', tone: 'prime' };
  }

  // ── MARKET ──
  if (a.edge != null && b.edge != null && a.edge >= 0.03 && b.edge >= 0.03) {
    const combined = Math.round((a.edge + b.edge) * 100);
    return { category: 'MARKET', label: `BOTH +${combined}% VEGAS EDGE`, tone: 'edge' };
  }

  // ── MATCHUP ──
  const aHrP9 = a.oppHrPer9Recent ?? a.oppHrPer9Season;
  const bHrP9 = b.oppHrPer9Recent ?? b.oppHrPer9Season;
  if (aHrP9 != null && bHrP9 != null && aHrP9 >= 1.5 && bHrP9 >= 1.5) {
    return { category: 'MATCHUP', label: 'BOTH VS HR-PRONE STARTER', tone: 'matchup' };
  }
  const aTired = a.oppHrPer9Recent != null && a.oppHrPer9Season != null
    && a.oppHrPer9Recent >= a.oppHrPer9Season + 0.5;
  const bTired = b.oppHrPer9Recent != null && b.oppHrPer9Season != null
    && b.oppHrPer9Recent >= b.oppHrPer9Season + 0.5;
  if (aTired && bTired) {
    return { category: 'MATCHUP', label: 'BOTH VS TIRED STARTER', tone: 'matchup' };
  }
  if (a.isOpenerGame && b.isOpenerGame) {
    return { category: 'MATCHUP', label: 'BOTH VS OPENER GAME', tone: 'matchup' };
  }
  if (a.bullpenLegend && b.bullpenLegend) {
    return { category: 'MATCHUP', label: 'BOTH BULLPEN LEGENDS', tone: 'matchup' };
  }
  if (a.batSide && b.batSide && a.oppPitcherHand && b.oppPitcherHand) {
    const aPlatoon = a.batSide !== a.oppPitcherHand;
    const bPlatoon = b.batSide !== b.oppPitcherHand;
    if (aPlatoon && bPlatoon && a.batSide === b.batSide) {
      return { category: 'MATCHUP', label: `${a.batSide}HB PLATOON EDGE`, tone: 'platoon' };
    }
  }

  // ── ENVIRONMENT ──
  if (isNukePark(a.venueName) && isNukePark(b.venueName)) {
    return { category: 'ENVIRONMENT', label: 'NUKE PARK STACK', tone: 'prime' };
  }
  if (a.isOutdoor && b.isOutdoor
      && a.windSpeedMph >= 10 && b.windSpeedMph >= 10
      && a.hrEnvScore >= 72 && b.hrEnvScore >= 72) {
    return { category: 'ENVIRONMENT', label: 'WIND-OUT STACK', tone: 'env' };
  }
  // Same-park stack only reachable on the single-game fallback.
  if (sameGame && a.hrEnvScore >= 65) {
    return { category: 'ENVIRONMENT', label: `STACK AT ${shortVenue(a.venueName)}`, tone: 'stack' };
  }
  if (!sameGame && a.hrEnvScore >= 60 && b.hrEnvScore >= 60) {
    return { category: 'ENVIRONMENT', label: 'CROSS-PARK HR STACK', tone: 'park' };
  }

  // ── MOMENTUM ──
  // A real HR streak = homered in 2+ STRAIGHT games (server-computed from the
  // game log, `hrStreak`), NOT a count of HRs in the last 7 days. hrStreak === N
  // means the batter went deep in each of his last N games, so requiring 2+ on
  // both legs is a genuine back-to-back-or-better mutual streak — which is what
  // "ON HR STREAK" should mean.
  if (a.hrStreak >= 2 && b.hrStreak >= 2) {
    return { category: 'MOMENTUM', label: 'BOTH ON HR STREAK', tone: 'hot' };
  }
  // Softer momentum — both flagged hot by the model (but not both with the
  // 2+ HR to call it a "streak").
  if (a.hot && b.hot) {
    return { category: 'MOMENTUM', label: 'BOTH HEATING UP', tone: 'hot' };
  }

  // ── STRUCTURAL (lower tier) ──
  if (a.zoneMaster || b.zoneMaster) {
    return { category: 'STRUCTURAL', label: 'ONE ZONE MASTER LEG', tone: 'zone' };
  }
  if (a.score >= 70 && b.score >= 70) {
    return { category: 'STRUCTURAL', label: 'BOTH ELITE SCORE', tone: 'prime' };
  }
  return { category: 'STRUCTURAL', label: 'HIGHEST COMBINED SCORE', tone: 'neutral' };
}

/** Hardcoded extreme HR parks — pop regardless of weather. */
const NUKE_PARKS = [
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
  return NUKE_PARKS.some(n => venueName.includes(n));
}

/** Chip-friendly venue label. "Great American Ball Park" → "GREAT AMERICAN…". */
function shortVenue(venue) {
  if (!venue) return 'PARK';
  const upper = venue.toUpperCase();
  if (upper.length <= 16) return upper;
  return upper.slice(0, 14).trim() + '…';
}

// ─── Pair generation (cross-game policy) ─────────────────────────────────────

/**
 * Build every qualifying pair from the pool. By default ONLY cross-game pairs
 * are produced — that's the whole point. `allowSameGame` opens the floodgates
 * for the single-game-slate fallback. The edge floor applies only when both
 * legs are priced (model-only pairs skip it so pre-market still recommends).
 */
function generatePairs(pool, { minEdgePerLeg = 0, allowSameGame = false } = {}) {
  const pairs = [];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const a = pool[i];
      const b = pool[j];
      if (!allowSameGame && a.gamePk === b.gamePk) continue;   // cross-game only
      const pair = scorePair(a, b);
      if (pair.bothHaveOdds) {
        if (a.edge != null && a.edge < minEdgePerLeg) continue;
        if (b.edge != null && b.edge < minEdgePerLeg) continue;
      }
      pairs.push(pair);
    }
  }
  return pairs;
}

/**
 * Cross-game pairs, with a single-game-slate fallback. Returns { pairs }.
 * When the slate has just one game (or every other game is filtered out),
 * cross-game yields nothing — only then do we relax to same-game so the
 * card isn't empty.
 */
function buildPairPool(pool, { minEdgePerLeg = 0 } = {}) {
  let pairs = generatePairs(pool, { minEdgePerLeg, allowSameGame: false });
  if (pairs.length === 0) {
    pairs = generatePairs(pool, { minEdgePerLeg, allowSameGame: true });
  }
  return pairs;
}

// ─── Diversity selector ───────────────────────────────────────────────────────

/**
 * Greedily pick the top-K pairs subject to per-player AND per-game caps.
 *
 * Two problems this solves:
 *   1. jointProb = p1·p2, so the single highest-prob player pairs into the
 *      best joint with EVERY other bat → without a player cap the top rows
 *      collapse to (Top + #2), (Top + #3), (Top + #4): same lead every row.
 *   2. The best ENVIRONMENT (e.g. a Coors game) seeds many high pairs → a
 *      game cap stops the list from being three pairs all touching one game,
 *      which reads as "it keeps showing the same games."
 *
 * Passes: strict (both caps) → relax game cap → relax player cap (fill). This
 * always returns up to topN, preferring maximum spread across games + players.
 */
function diversifySelect(sortedPairs, topN, opts = {}) {
  const { maxPerPlayer = 1, maxPerGame = 2 } = opts;
  if (!Array.isArray(sortedPairs) || sortedPairs.length === 0) return [];
  if (topN >= sortedPairs.length) return sortedPairs.slice(0, topN);

  const selected    = [];
  const chosen      = new Set();
  const playerCount = new Map();
  const gameCount   = new Map();
  const inc = (map, key) => map.set(key, (map.get(key) || 0) + 1);

  const sweep = (enforceGameCap) => {
    for (const pair of sortedPairs) {
      if (selected.length >= topN) break;
      if (chosen.has(pair)) continue;
      const a = pair?.legs?.[0];
      const b = pair?.legs?.[1];
      if (!a || !b || a.playerId == null || b.playerId == null) continue;
      if ((playerCount.get(a.playerId) || 0) >= maxPerPlayer) continue;
      if ((playerCount.get(b.playerId) || 0) >= maxPerPlayer) continue;
      if (enforceGameCap) {
        if ((gameCount.get(a.gamePk) || 0) >= maxPerGame) continue;
        if ((gameCount.get(b.gamePk) || 0) >= maxPerGame) continue;
      }
      selected.push(pair);
      chosen.add(pair);
      inc(playerCount, a.playerId); inc(playerCount, b.playerId);
      inc(gameCount, a.gamePk);     inc(gameCount, b.gamePk);
    }
  };

  sweep(true);                              // strict: player + game caps
  if (selected.length < topN) sweep(false); // relax the game cap, keep player cap

  // Final fill — slate too thin for the player cap; backfill so no empty slots.
  if (selected.length < topN) {
    for (const pair of sortedPairs) {
      if (selected.length >= topN) break;
      if (!chosen.has(pair)) { selected.push(pair); chosen.add(pair); }
    }
  }
  return selected;
}

// ─── Public entrypoint ──────────────────────────────────────────────────────

/**
 * Top N best 2-man parlay recommendations from the slate (cross-game).
 *
 * @param {Array}  results
 * @param {object} opts
 * @param {number} opts.poolCap        Max candidates to combine (default 20).
 * @param {number} opts.topN           How many recommendations to return.
 * @param {number} opts.minEdgePerLeg  Per-leg Vegas-edge floor when priced.
 * @returns {Array<Pair>} Top N pairs, EV-desc (or jointProb-desc pre-market).
 */
export function buildBestTwoMan(results, opts = {}) {
  const {
    poolCap        = 20,
    topN           = 3,
    minEdgePerLeg  = 0,
    hrHittersToday = null,
  } = opts;

  if (!Array.isArray(results) || results.length === 0) return [];

  const enriched = enrichCandidates(results, hrHittersToday);
  if (enriched.length < 2) return [];

  enriched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const pool = enriched.slice(0, poolCap);

  const pairs = buildPairPool(pool, { minEdgePerLeg });
  if (pairs.length === 0) return [];

  const withOdds = pairs.filter(p => p.bothHaveOdds).sort((x, y) => y.ev - x.ev);
  const without  = pairs.filter(p => !p.bothHaveOdds).sort((x, y) => y.jointProb - x.jointProb);

  // Prefer fully-priced pairs; fall back to model-only when too few are priced.
  const ranked = withOdds.length >= topN ? withOdds : [...withOdds, ...without];
  return diversifySelect(ranked, topN, { maxPerPlayer: 1, maxPerGame: 2 });
}

// ─── Category-grouped recommender ───────────────────────────────────────────

/** Display order + label for each tag category. The modal renders sections in
 *  this order; empty categories are skipped. Keys match pickWhyTag().category. */
export const CATEGORY_ORDER = [
  { key: 'STRUCTURAL',  label: 'Structural',  emoji: '🎯', blurb: 'Model-derived signals' },
  { key: 'MATCHUP',     label: 'Matchup',     emoji: '⚔️', blurb: 'Pitcher correlations'   },
  { key: 'ENVIRONMENT', label: 'Environment', emoji: '🌬️', blurb: 'Park + weather'         },
  { key: 'MARKET',      label: 'Market',      emoji: '💰', blurb: 'Vegas mispricing'       },
  { key: 'MOMENTUM',    label: 'Momentum',    emoji: '🔥', blurb: 'Recent form'            },
];

/**
 * Build pair recommendations grouped by tag category. Each pair lands in
 * exactly ONE category (its strongest "why"). Within a category, pairs sort by
 * EV (or jointProb pre-market), then a player+game diversity pass keeps the
 * top rows from repeating the same lead bat or the same game.
 *
 * Returns an object keyed by category plus `_meta: { totalPairs, nonEmpty }`.
 *
 * @param {Array}  results
 * @param {object} opts
 * @param {number} opts.poolCap        Pool cap (default 24).
 * @param {number} opts.perCategoryN   Max pairs per section (default 3).
 * @param {number} opts.minEdgePerLeg  Edge floor when priced (default 0).
 * @param {number} opts.maxPerGame     Per-game cap within a section (default 2).
 */
export function buildBestTwoManByCategory(results, opts = {}) {
  const {
    poolCap        = 24,
    perCategoryN   = 3,
    minEdgePerLeg  = 0,
    hrHittersToday = null,
    maxPerGame     = 2,
  } = opts;

  const empty = CATEGORY_ORDER.reduce(
    (acc, c) => { acc[c.key] = []; return acc; },
    { _meta: { totalPairs: 0, nonEmpty: [] } }
  );
  if (!Array.isArray(results) || results.length === 0) return empty;

  const enriched = enrichCandidates(results, hrHittersToday);
  if (enriched.length < 2) return empty;

  enriched.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const pool = enriched.slice(0, poolCap);

  const pairs = buildPairPool(pool, { minEdgePerLeg });
  if (pairs.length === 0) return empty;

  // Bucket by strongest-why category.
  const buckets = CATEGORY_ORDER.reduce((acc, c) => { acc[c.key] = []; return acc; }, {});
  for (const pair of pairs) {
    const cat = pair.why?.category || 'STRUCTURAL';
    (buckets[cat] || (buckets[cat] = [])).push(pair);
  }

  const result = { _meta: { totalPairs: pairs.length, nonEmpty: [] } };
  for (const { key } of CATEGORY_ORDER) {
    const arr = (buckets[key] || []).slice().sort((x, y) => rankOf(y) - rankOf(x));
    result[key] = diversifySelect(arr, perCategoryN, { maxPerPlayer: 1, maxPerGame });
    if (result[key].length > 0) result._meta.nonEmpty.push(key);
  }
  return result;
}
