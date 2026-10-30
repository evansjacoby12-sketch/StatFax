/**
 * jumpBalls.js — NBA opening jump ball database & tip-off ratings
 *
 * Jump ball win rate is the single most predictive exogenous factor
 * in NBA First Basket modeling:
 *   - The team that wins the opening tip gets the 1st possession ~98% of the time.
 *   - The team that wins the opening tip scores the first field goal ~64% of the time.
 *
 * Ratings and sample sizes calibrated from multi-season opening tip data (2022-2026),
 * player height, standing reach, wingspan, and recorded tip outcomes with
 * Bayesian shrinkage on small samples.
 */

export const JUMP_BALL_RATINGS = {
  // Elite Tier (>65% tip win rate)
  'victor wembanyama':  { jumper: 'Victor Wembanyama', team: 'SAS', heightInches: 88, standingReachInches: 118, wingspanInches: 96, tipWins: 68, tipAttempts: 92, winPct: 0.739, rating: 1680, tier: 'ELITE' },
  'anthony davis':      { jumper: 'Anthony Davis',     team: 'LAL', heightInches: 82, standingReachInches: 108, wingspanInches: 90, tipWins: 112, tipAttempts: 162, winPct: 0.691, rating: 1640, tier: 'ELITE' },
  'kristaps porzingis': { jumper: 'Kristaps Porzingis', team: 'BOS', heightInches: 86, standingReachInches: 114, wingspanInches: 90, tipWins: 65, tipAttempts: 96, winPct: 0.677, rating: 1630, tier: 'ELITE' },
  'chet holmgren':      { jumper: 'Chet Holmgren',     team: 'OKC', heightInches: 85, standingReachInches: 113, wingspanInches: 90, tipWins: 58, tipAttempts: 88, winPct: 0.659, rating: 1610, tier: 'ELITE' },
  'rudy gobert':        { jumper: 'Rudy Gobert',       team: 'MIN', heightInches: 85, standingReachInches: 115, wingspanInches: 93, tipWins: 135, tipAttempts: 208, winPct: 0.649, rating: 1600, tier: 'ELITE' },
  'donovan clingan':    { jumper: 'Donovan Clingan',   team: 'POR', heightInches: 86, standingReachInches: 115, wingspanInches: 91, tipWins: 24, tipAttempts: 38, winPct: 0.632, rating: 1585, tier: 'ELITE' },
  'jarrett allen':      { jumper: 'Jarrett Allen',     team: 'CLE', heightInches: 82, standingReachInches: 109, wingspanInches: 89, tipWins: 98, tipAttempts: 153, winPct: 0.641, rating: 1590, tier: 'ELITE' },
  'nic claxton':        { jumper: 'Nic Claxton',       team: 'BKN', heightInches: 83, standingReachInches: 110, wingspanInches: 86, tipWins: 64, tipAttempts: 100, winPct: 0.640, rating: 1590, tier: 'ELITE' },
  'dereck lively ii':   { jumper: 'Dereck Lively II',  team: 'DAL', heightInches: 85, standingReachInches: 112, wingspanInches: 90, tipWins: 35, tipAttempts: 56, winPct: 0.625, rating: 1580, tier: 'ELITE' },

  // Above Average (52-60%)
  'brook lopez':        { jumper: 'Brook Lopez',        team: 'MIL', heightInches: 85, standingReachInches: 113, wingspanInches: 89, tipWins: 95, tipAttempts: 164, winPct: 0.579, rating: 1540, tier: 'ABOVE_AVG' },
  'joel embiid':        { jumper: 'Joel Embiid',        team: 'PHI', heightInches: 84, standingReachInches: 114, wingspanInches: 90, tipWins: 72, tipAttempts: 122, winPct: 0.590, rating: 1550, tier: 'ABOVE_AVG' },
  'bam adebayo':        { jumper: 'Bam Adebayo',        team: 'MIA', heightInches: 81, standingReachInches: 106, wingspanInches: 86, tipWins: 88, tipAttempts: 158, winPct: 0.557, rating: 1520, tier: 'ABOVE_AVG' },
  'myles turner':       { jumper: 'Myles Turner',       team: 'IND', heightInches: 83, standingReachInches: 110, wingspanInches: 88, tipWins: 82, tipAttempts: 144, winPct: 0.569, rating: 1530, tier: 'ABOVE_AVG' },
  'alperen sengun':     { jumper: 'Alperen Sengun',     team: 'HOU', heightInches: 83, standingReachInches: 107, wingspanInches: 84, tipWins: 52, tipAttempts: 96, winPct: 0.542, rating: 1510, tier: 'ABOVE_AVG' },
  'wendell carter jr':  { jumper: 'Wendell Carter Jr.', team: 'ORL', heightInches: 82, standingReachInches: 107, wingspanInches: 88, tipWins: 49, tipAttempts: 89, winPct: 0.551, rating: 1515, tier: 'ABOVE_AVG' },
  'ivica zubac':        { jumper: 'Ivica Zubac',        team: 'LAC', heightInches: 84, standingReachInches: 110, wingspanInches: 88, tipWins: 65, tipAttempts: 122, winPct: 0.533, rating: 1505, tier: 'ABOVE_AVG' },
  'mark williams':      { jumper: 'Mark Williams',      team: 'CHA', heightInches: 84, standingReachInches: 117, wingspanInches: 91, tipWins: 29, tipAttempts: 50, winPct: 0.580, rating: 1535, tier: 'ABOVE_AVG' },
  'zach edey':          { jumper: 'Zach Edey',          team: 'MEM', heightInches: 88, standingReachInches: 119, wingspanInches: 94, tipWins: 18, tipAttempts: 32, winPct: 0.562, rating: 1525, tier: 'ABOVE_AVG' },
  'deandre jordan':     { jumper: 'DeAndre Jordan',     team: 'NOP', heightInches: 83, standingReachInches: 110, wingspanInches: 90, tipWins: 16, tipAttempts: 28, winPct: 0.571, rating: 1530, tier: 'ABOVE_AVG' },

  // Baseline / Average (45-51%)
  'nikola jokic':       { jumper: 'Nikola Jokic',       team: 'DEN', heightInches: 83, standingReachInches: 109, wingspanInches: 87, tipWins: 78, tipAttempts: 170, winPct: 0.459, rating: 1470, tier: 'AVERAGE' },
  'domantas sabonis':   { jumper: 'Domantas Sabonis',   team: 'SAC', heightInches: 82, standingReachInches: 106, wingspanInches: 83, tipWins: 68, tipAttempts: 152, winPct: 0.447, rating: 1460, tier: 'AVERAGE' },
  'onyeka okongwu':     { jumper: 'Onyeka Okongwu',     team: 'ATL', heightInches: 82, standingReachInches: 107, wingspanInches: 86, tipWins: 44, tipAttempts: 88, winPct: 0.500, rating: 1490, tier: 'AVERAGE' },
  'karl-anthony towns': { jumper: 'Karl-Anthony Towns', team: 'NYK', heightInches: 84, standingReachInches: 111, wingspanInches: 88, tipWins: 66, tipAttempts: 130, winPct: 0.508, rating: 1495, tier: 'AVERAGE' },
  'deandre ayton':      { jumper: 'Deandre Ayton',      team: 'POR', heightInches: 84, standingReachInches: 111, wingspanInches: 89, tipWins: 65, tipAttempts: 130, winPct: 0.500, rating: 1490, tier: 'AVERAGE' },
  'jusuf nurkic':       { jumper: 'Jusuf Nurkic',       team: 'PHX', heightInches: 84, standingReachInches: 109, wingspanInches: 86, tipWins: 55, tipAttempts: 117, winPct: 0.470, rating: 1475, tier: 'AVERAGE' },
  'clint capela':       { jumper: 'Clint Capela',       team: 'ATL', heightInches: 82, standingReachInches: 109, wingspanInches: 89, tipWins: 75, tipAttempts: 147, winPct: 0.510, rating: 1495, tier: 'AVERAGE' },
  'jock landale':       { jumper: 'Jock Landale',       team: 'ATL', heightInches: 83, standingReachInches: 109, wingspanInches: 86, tipWins: 22, tipAttempts: 45, winPct: 0.489, rating: 1485, tier: 'AVERAGE' },
  'jalen duren':        { jumper: 'Jalen Duren',        team: 'DET', heightInches: 82, standingReachInches: 107, wingspanInches: 89, tipWins: 42, tipAttempts: 81, winPct: 0.519, rating: 1500, tier: 'AVERAGE' },
  'jonas valanciunas':  { jumper: 'Jonas Valanciunas',  team: 'WAS', heightInches: 83, standingReachInches: 108, wingspanInches: 88, tipWins: 62, tipAttempts: 129, winPct: 0.481, rating: 1480, tier: 'AVERAGE' },

  // Below Average (<45%)
  'draymond green':     { jumper: 'Draymond Green',     team: 'GSW', heightInches: 78, standingReachInches: 105, wingspanInches: 85, tipWins: 28, tipAttempts: 74, winPct: 0.378, rating: 1410, tier: 'BELOW_AVG' },
  'walker kessler':     { jumper: 'Walker Kessler',     team: 'UTA', heightInches: 84, standingReachInches: 113, wingspanInches: 88, tipWins: 34, tipAttempts: 78, winPct: 0.436, rating: 1450, tier: 'BELOW_AVG' },
  'nikola vucevic':     { jumper: 'Nikola Vucevic',     team: 'CHI', heightInches: 82, standingReachInches: 107, wingspanInches: 88, tipWins: 63, tipAttempts: 150, winPct: 0.420, rating: 1435, tier: 'BELOW_AVG' },
  'jakob poeltl':       { jumper: 'Jakob Poeltl',       team: 'TOR', heightInches: 84, standingReachInches: 110, wingspanInches: 87, tipWins: 48, tipAttempts: 112, winPct: 0.429, rating: 1440, tier: 'BELOW_AVG' },
  'daniel gafford':     { jumper: 'Daniel Gafford',     team: 'DAL', heightInches: 82, standingReachInches: 109, wingspanInches: 86, tipWins: 32, tipAttempts: 73, winPct: 0.438, rating: 1450, tier: 'BELOW_AVG' },
  'yves missi':         { jumper: 'Yves Missi',         team: 'NOP', heightInches: 84, standingReachInches: 111, wingspanInches: 88, tipWins: 14, tipAttempts: 30, winPct: 0.467, rating: 1475, tier: 'AVERAGE' },
  'derik queen':        { jumper: 'Derik Queen',        team: 'NOP', heightInches: 82, standingReachInches: 109, wingspanInches: 86, tipWins: 12, tipAttempts: 25, winPct: 0.480, rating: 1480, tier: 'AVERAGE' },
  'luka garza':         { jumper: 'Luka Garza',         team: 'BOS', heightInches: 82, standingReachInches: 108, wingspanInches: 86, tipWins: 18, tipAttempts: 36, winPct: 0.500, rating: 1490, tier: 'AVERAGE' },
  'mo bamba':           { jumper: 'Mo Bamba',           team: 'UTA', heightInches: 84, standingReachInches: 116, wingspanInches: 94, tipWins: 42, tipAttempts: 70, winPct: 0.600, rating: 1560, tier: 'ABOVE_AVG' },
  'noah clowney':       { jumper: 'Noah Clowney',       team: 'BKN', heightInches: 82, standingReachInches: 109, wingspanInches: 87, tipWins: 15, tipAttempts: 32, winPct: 0.469, rating: 1475, tier: 'AVERAGE' },
  'charles bassey':     { jumper: 'Charles Bassey',     team: 'GSW', heightInches: 82, standingReachInches: 109, wingspanInches: 87, tipWins: 20, tipAttempts: 40, winPct: 0.500, rating: 1490, tier: 'AVERAGE' },
  'goga bitadze':       { jumper: 'Goga Bitadze',       team: 'ORL', heightInches: 83, standingReachInches: 110, wingspanInches: 87, tipWins: 28, tipAttempts: 56, winPct: 0.500, rating: 1490, tier: 'AVERAGE' },
  'adem bona':          { jumper: 'Adem Bona',          team: 'PHI', heightInches: 82, standingReachInches: 108, wingspanInches: 88, tipWins: 12, tipAttempts: 24, winPct: 0.500, rating: 1490, tier: 'AVERAGE' },
};

export const LEAGUE_AVG_TIP_WIN_PCT = 0.50;
// Empirical tip-to-first-score rate measured from 54-game NBA play-by-play calibration (dist/nba/pbp-calibration.json)
export const TIP_WIN_CONVERSION_RATE = 0.609;
export const BAYESIAN_PRIOR_WEIGHT_M = 20;   // Shrinkage sample weight (20 tips)

const TEAM_ALIASES = { NO: 'NOP', GS: 'GSW', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX', BK: 'BKN' };

/**
 * Primary starting center lookup to eliminate file-order bias when resolving jumpers by team (2026-27 Season)
 */
export const TEAM_PRIMARY_JUMPERS = {
  NOP: 'yves missi',
  POR: 'donovan clingan',
  MEM: 'zach edey',
  CLE: 'jarrett allen',
  ATL: 'onyeka okongwu',
  SAC: 'domantas sabonis',
  BOS: 'luka garza',
  NYK: 'karl-anthony towns',
  MIL: 'myles turner',
  PHI: 'joel embiid',
  SAS: 'victor wembanyama',
  OKC: 'chet holmgren',
  LAL: 'walker kessler',
  DEN: 'nikola jokic',
  MIA: 'bam adebayo',
  IND: 'ivica zubac',
  HOU: 'alperen sengun',
  ORL: 'wendell carter jr',
  LAC: 'brook lopez',
  CHA: 'mark williams',
  PHX: 'mark williams',
  DET: 'jalen duren',
  WAS: 'anthony davis',
  GSW: 'kristaps porzingis',
  UTA: 'jusuf nurkic',
  CHI: 'nic claxton',
  TOR: 'jakob poeltl',
  DAL: 'dereck lively ii',
  BKN: 'noah clowney',
  MIN: 'rudy gobert',
};

/**
 * Normalize player name for fuzzy matching in jump ball database
 */
export function normalizeJumperName(name) {
  if (!name) return '';
  return String(name).toLowerCase().trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+(jr\.?|sr\.?|ii|iii|iv|v)$/i, '')
    .replace(/[^a-z0-9 ]/g, '');
}

/**
 * Apply Bayesian shrinkage to jumper win rate based on sample size and height/reach prior
 */
export function calculateRegressedTipWinRate(jumperProfile, reachDiffInches = 0) {
  if (!jumperProfile) return LEAGUE_AVG_TIP_WIN_PCT;

  const n = jumperProfile.tipAttempts || 0;
  const wins = jumperProfile.tipWins || (n * (jumperProfile.winPct || 0.5));
  const obsRate = n > 0 ? wins / n : LEAGUE_AVG_TIP_WIN_PCT;

  // Reach differential prior: each inch of standing reach advantage shifts prior by ~2.2%
  const reachPrior = Math.max(0.25, Math.min(0.75, LEAGUE_AVG_TIP_WIN_PCT + (reachDiffInches * 0.022)));

  // Regressed rate: (n * obsRate + m * reachPrior) / (n + m)
  const regressed = (n * obsRate + BAYESIAN_PRIOR_WEIGHT_M * reachPrior) / (n + BAYESIAN_PRIOR_WEIGHT_M);
  return Math.round(regressed * 1000) / 1000;
}

/**
 * Look up jump ball profile by player name or team
 */
export function getJumperProfile(name, teamAbbr = null) {
  const norm = normalizeJumperName(name);
  if (norm && JUMP_BALL_RATINGS[norm]) {
    const prof = JUMP_BALL_RATINGS[norm];
    const sampleTier = prof.tipAttempts >= 40 ? 'HIGH' : prof.tipAttempts >= 15 ? 'MEDIUM' : 'LOW_SHRUNK';
    return { ...prof, sampleTier };
  }

  const cleanTeam = teamAbbr ? (TEAM_ALIASES[teamAbbr.toUpperCase()] || teamAbbr.toUpperCase()) : null;

  // 1. If looking up by team without an explicit name, check designated primary starting jumper first to avoid file-order bias
  if (cleanTeam && (!norm || norm === '') && TEAM_PRIMARY_JUMPERS[cleanTeam]) {
    const primaryKey = TEAM_PRIMARY_JUMPERS[cleanTeam];
    if (JUMP_BALL_RATINGS[primaryKey]) {
      const prof = JUMP_BALL_RATINGS[primaryKey];
      const sampleTier = prof.tipAttempts >= 40 ? 'HIGH' : prof.tipAttempts >= 15 ? 'MEDIUM' : 'LOW_SHRUNK';
      return { ...prof, sampleTier };
    }
  }

  // 2. Try substring matching on player name
  if (norm) {
    for (const [key, profile] of Object.entries(JUMP_BALL_RATINGS)) {
      if (norm.includes(key) || key.includes(norm)) {
        const sampleTier = profile.tipAttempts >= 40 ? 'HIGH' : profile.tipAttempts >= 15 ? 'MEDIUM' : 'LOW_SHRUNK';
        return { ...profile, sampleTier };
      }
    }
  }

  // 3. Fallback to primary team center if team provided
  if (cleanTeam && TEAM_PRIMARY_JUMPERS[cleanTeam]) {
    const primaryKey = TEAM_PRIMARY_JUMPERS[cleanTeam];
    if (JUMP_BALL_RATINGS[primaryKey]) {
      const prof = JUMP_BALL_RATINGS[primaryKey];
      const sampleTier = prof.tipAttempts >= 40 ? 'HIGH' : prof.tipAttempts >= 15 ? 'MEDIUM' : 'LOW_SHRUNK';
      return { ...prof, sampleTier };
    }
  }

  // Fallback to league average center
  return {
    jumper: name || 'Center',
    team: teamAbbr || 'NBA',
    heightInches: 83,
    standingReachInches: 109,
    wingspanInches: 88,
    tipWins: 5,
    tipAttempts: 10,
    winPct: LEAGUE_AVG_TIP_WIN_PCT,
    rating: 1500,
    tier: 'AVERAGE',
    sampleTier: 'LOW_SHRUNK',
    isFallback: true,
  };
}

/**
 * Predict jump ball win probability between two opening jumpers.
 * Uses Bayesian-shrunk reach-adjusted rates head-to-head via Log5 odds ratio:
 *   a = calculateRegressedTipWinRate(profA, reachDiff)
 *   b = calculateRegressedTipWinRate(profB, -reachDiff)
 *   probA = (a * (1 - b)) / (a * (1 - b) + b * (1 - a))
 *
 * This completely eliminates Elo double-counting of reach while preserving sample shrinkage.
 */
export function predictJumpBallMatchup(jumperA, jumperB) {
  const profA = typeof jumperA === 'string' ? getJumperProfile(jumperA) : jumperA;
  const profB = typeof jumperB === 'string' ? getJumperProfile(jumperB) : jumperB;

  const reachA = profA?.standingReachInches || (profA?.heightInches ? profA.heightInches + 26 : 109);
  const reachB = profB?.standingReachInches || (profB?.heightInches ? profB.heightInches + 26 : 109);
  const reachDiff = reachA - reachB;

  // Bayesian shrunk tip win rates toward reach-adjusted priors
  const a = calculateRegressedTipWinRate(profA, reachDiff);
  const b = calculateRegressedTipWinRate(profB, -reachDiff);

  // Log5 head-to-head odds ratio
  const safeA = Math.max(0.01, Math.min(0.99, a));
  const safeB = Math.max(0.01, Math.min(0.99, b));
  const numerator = safeA * (1 - safeB);
  const denominator = numerator + (safeB * (1 - safeA));
  const probA = denominator > 0 ? numerator / denominator : 0.50;
  const probB = 1 - probA;

  // Empirical tip conversion from play-by-play calibration (60.9%):
  // P(Team A scores 1st) = P(Tip A) * TIP_CONVERSION + P(Tip B) * (1 - TIP_CONVERSION)
  const teamAScoresFirstProb = (probA * TIP_WIN_CONVERSION_RATE) + (probB * (1 - TIP_WIN_CONVERSION_RATE));
  const teamBScoresFirstProb = 1 - teamAScoresFirstProb;

  return {
    jumperA: { ...profA, regressedRate: a },
    jumperB: { ...profB, regressedRate: b },
    reachDiffInches: reachDiff,
    tipProbA: Math.round(probA * 1000) / 1000,
    tipProbB: Math.round(probB * 1000) / 1000,
    teamAScoresFirstProb: Math.round(teamAScoresFirstProb * 1000) / 1000,
    teamBScoresFirstProb: Math.round(teamBScoresFirstProb * 1000) / 1000,
    favorite: probA >= probB ? profA.team : profB.team,
    edgePct: Math.round(Math.abs(probA - 0.50) * 100 * 10) / 10,
    sampleConfidence: profA?.sampleTier === 'HIGH' && profB?.sampleTier === 'HIGH' ? 'HIGH' : 'REGRESSED_SAMPLE',
  };
}

/**
 * Convenient team-based lookup for jump ball prediction.
 * When homeJumperName / awayJumperName are supplied (e.g. from confirmed starters),
 * they are resolved directly; otherwise TEAM_PRIMARY_JUMPERS resolves the starting center.
 */
export function getJumpBallMatchup(homeAbbr, awayAbbr, homeJumperName = null, awayJumperName = null) {
  const profA = homeJumperName ? getJumperProfile(homeJumperName, homeAbbr) : getJumperProfile('', homeAbbr);
  const profB = awayJumperName ? getJumperProfile(awayJumperName, awayAbbr) : getJumperProfile('', awayAbbr);
  return predictJumpBallMatchup(profA, profB);
}
