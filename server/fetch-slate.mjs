/**
 * fetch-slate.mjs — backend slate generator
 *
 * Runs in GitHub Actions on a 10-min cron during MLB hours. Fetches today's
 * schedule + lineups + batter/pitcher stats + Statcast + weather, bundles
 * everything into a single JSON payload, and writes it to `dist/daily.json`
 * for GitHub Pages to serve.
 *
 * The Expo app reads this JSON as a SHARED CACHE (via BackendService.js),
 * which solves the cross-device consistency problem: previously every user
 * device hit MLB + WeatherAPI independently with its own API keys and timing,
 * which produced subtly-different scores for the same player. With a single
 * shared snapshot, every user gets identical inputs → identical scores.
 *
 * No model code runs here. Scoring stays in the Expo app, OTA-updateable.
 * The backend's job is purely "fetch + cache + serve."
 *
 * Run locally:    node server/fetch-slate.mjs
 * Env required:   none — weather via NWS (api.weather.gov), no keys.
 *
 * ─── Snapshot contract ─────────────────────────────────────────────────────
 *
 * The shape below is what every client reads from R2. Any change here is a
 * CROSS-VERSION breaking change — old app builds will read this same JSON
 * until users update, so add new fields, don't rename or remove. Bump
 * `version` when the shape changes meaningfully.
 *
 * @typedef {Object} Snapshot
 * @property {number}  version       Schema version (currently 4).
 * @property {string}  generatedAt   ISO UTC timestamp when cron started.
 * @property {string}  finishedAt    ISO UTC timestamp when cron finished.
 * @property {string}  date          'YYYY-MM-DD' in America/New_York (rolls 12 AM ET).
 *                                   Client rejects if !== todayInCT()
 *                                   (with weather-only venue fallback —
 *                                   see BackendService.getSnapshotWeatherByVenue).
 * @property {Game[]}  games         Today's games (post-postpone-filter).
 * @property {Object.<string,LineupBlock>} lineupsByGame      Keyed by gamePk.
 * @property {Object.<string,RosterPlayer[]>} rosterByTeam     Keyed by teamId.
 * @property {Object.<string,BatterStats>}    batterStats      Keyed by playerId.
 * @property {Object.<string,PitcherStats>}   pitcherStats     Keyed by playerId.
 * @property {Object.<string,number>}         bullpenHR9       Keyed by teamId.
 * @property {Object.<string,Weather>}        weatherByGame    Keyed by gamePk.
 * @property {Object.<string,number[]>}       homerersByGame   Keyed by gamePk
 *                                                              (Final games only).
 * @property {Object.<string,ScoredBatter>}   scoredBatters
 *   IMPORTANT: keyed by COMPOSITE `${playerId}-${gamePk}` (canonical)
 *   AND legacy `${playerId}` (back-compat for older clients on old OTAs).
 *   The composite key preserves both games of a doubleheader; the legacy
 *   key is last-write-wins. New code should always use the composite.
 * @property {SlateStats} stats
 * @property {NanDebug[]} _nanDebug  Capped diagnostic list — batters that
 *                                   tripped the NaN fallback during scoring.
 *
 * @typedef {Object} Weather
 * @property {number} tempF           First-pitch hour, °F.
 * @property {number} windSpeedMph    "wind FROM" speed, mph (meteorological).
 * @property {number} windDirDeg      "wind FROM" compass bearing.
 * @property {number} windGustMph     Peak gust expected in the hour, mph.
 * @property {number} humidity        Relative humidity, percent.
 * @property {number} pressureMb      Mean sea-level pressure, millibars.
 * @property {number} precipProbPct   Precipitation probability, percent.
 * @property {number} cloudCoverPct   Cloud cover, percent.
 * @property {WeatherHour[]} hours    Hour-by-hour across the game window
 *                                    (first-pitch hour is hours[0]; ~4 entries).
 *                                    Unlocks "wind shifts later in the game"
 *                                    surfaces — UI/model can read any hour.
 * @property {'nws'} source    Provider tag (single-source post-rewrite).
 * @property {string} fetchedAt       ISO UTC when the forecast was fetched.
 * @property {string} gameStartIso    ISO UTC of first pitch (echoed back).
 * @property {?string} timezone       Venue local TZ (e.g. 'America/Phoenix').
 *
 * @typedef {Object} WeatherHour
 * @property {number} hourOffset      0 = first-pitch hour; 1 = +1h; etc.
 * @property {string} tIso            Venue-local ISO timestamp (no TZ suffix).
 * @property {number} tempF
 * @property {number} windSpeedMph
 * @property {number} windDirDeg
 * @property {number} windGustMph
 * @property {number} humidity
 * @property {number} pressureMb
 * @property {number} precipProbPct
 * @property {number} cloudCoverPct
 *
 * @typedef {Object} ScoredBatter
 * @property {number}   playerId
 * @property {number}   gamePk         Which game this row belongs to. The
 *                                     client filters scoredBatters[id] by
 *                                     `row.gamePk === game.gamePk` to handle
 *                                     legacy-key doubleheader collisions.
 * @property {string}   name
 * @property {'L'|'R'|'S'} batSide
 * @property {string}   team
 * @property {number}   teamId
 * @property {boolean}  isHome
 * @property {?number}  battingOrder
 * @property {?number}  currentInning
 * @property {boolean}  lineupConfirmed PER-SIDE confirmation, not whole-game.
 * @property {Object}   season         { ab, hr, h, avg, slg, iso, hrRate }
 * @property {?Object}  recent
 * @property {?number}  barrelPct      Statcast contact quality.
 * @property {?number}  exitVelo
 * @property {?number}  hardHitPct
 * @property {?PitcherBlock} pitcher
 * @property {number}   score          0-100 composite.
 * @property {number}   batterScore
 * @property {number}   matchupScore
 * @property {number}   envScore
 * @property {?number}  hrProbability  Bayesian model output.
 * @property {string[]} reasons        Human-readable "why this score".
 * @property {string[]} [eli5Reasons]  Friendlier wording for ELI5 mode.
 * @property {Object}   [flags]        hot/due/cold/bullpenLegend/dayEdge etc.
 * @property {?ZoneMatchup} [zoneMatchup]  3×3 batter ISO + pitcher freq grids,
 *   matched zones, and Zone Rating. Only present for the top ~25 batters per
 *   game (cron capacity). Resolves opener → bulk pitcher automatically.
 * @property {?number} [zoneBonus]  Score adjustment applied from zoneMatchup,
 *   range -2..+4. Present only when the bonus is non-zero. See "8.65) Zone
 *   score bonus pass" in fetch-slate.mjs for the formula.
 * @property {?number} [baseScore]  Pre-zone-bonus composite score. Preserved
 *   so the score breakdown UI can show "X base + N zone bonus" decomposition.
 *
 * @typedef {Object} ZoneMatchup
 * @property {Object} batter         { id, hand, grid: ZoneCell[9], sampleBIP, season }
 * @property {Object} pitcher        { id, hand, grid: ZoneCell[9], samplePitches, season }
 * @property {number[]} matchedZones Indices into the 9-grid where batter-hot meets pitcher-frequent.
 * @property {number} zoneRating     0-10 overall matchup quality.
 * @property {?string} badge         'ZONE_MASTER' when matchedZones.length >= 2.
 * @property {?Object} opener        Present on opener games: { id, recentAvgIP }.
 * @property {?Object} bulk          Present when bulk pitcher was resolved:
 *                                   { id, name, confidence, candidates }.
 * @property {'starter'|'bulk'|'opener-no-bulk'} matchupAgainst
 *   Which pitcher the zones reflect — UI uses this to label correctly.
 * @property {string} asOf           ISO timestamp of when the matchup was computed.
 *
 * @typedef {Object} ZoneCell
 * @property {?number} iso       (batter grid only) ISO for this zone.
 * @property {?number} freq      (pitcher grid only) Share of pitches in this zone.
 * @property {number}  count     Sample size for this cell (BIP for batter, pitches for pitcher).
 * @property {number}  hrCount   HR markers in this zone (currently always 0; see fetcher TODO).
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildModel } from './build-model.mjs';
import { buildZoneMatchupForGame, primeFromPriorCache as primeZoneCache, dumpCache as dumpZoneCache } from './fetch-zone-matchup.mjs';
import { fetchHourlyForecast } from './weather.mjs';
import umpireFactorsRaw from '../src/sports/mlb/data/umpire-factors.json' with { type: 'json' };

// Resolve a name → HR multiplier (1.0 default). Wrapped in a function so we
// can change the JSON shape (e.g. adding name normalization) without
// touching call sites. See data/umpire-factors.json for sourcing + TODO.
function umpireHrFactor(name) {
  if (!name) return umpireFactorsRaw._default ?? 1.0;
  const f = umpireFactorsRaw.umpires?.[name];
  return Number.isFinite(f) ? f : (umpireFactorsRaw._default ?? 1.0);
}
// Resolve a name → zone style string ('high'|'low'|'wide') or null.
function umpireZoneStyleFor(name) {
  if (!name) return null;
  return umpireFactorsRaw.zoneStyles?.[name] ?? null;
}
// Resolve a name → K multiplier. Tight zones → more Ks (kFactor > 1).
function umpireKFactor(name) {
  if (!name) return 1.0;
  const f = umpireFactorsRaw.kFactors?.[name];
  return Number.isFinite(f) ? f : 1.0;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH  = resolve(__dirname, '../dist/daily.json');
// Calibration artifacts — uploaded to the same R2 bucket alongside daily.json.
// The next cron run reads these back as priorCalibration + priorBacktestLog.
const CALIBRATION_OUT_PATH = resolve(__dirname, '../dist/calibration.json');
const BACKTEST_OUT_PATH    = resolve(__dirname, '../dist/backtest-log.json');
// Per-day "pregame freeze": once a batter's game starts we keep serving his
// pre-first-pitch model/form values. Persisted across cron runs via the same
// Actions cache mechanism as the backtest log.
const FREEZE_OUT_PATH      = resolve(__dirname, '../dist/pregame-freeze.json');
const ZONE_CACHE_OUT_PATH  = resolve(__dirname, '../dist/zone-cache.json');
const BOARD_HISTORY_OUT_PATH = resolve(__dirname, '../dist/board-history.json');
const MLB_BASE  = 'https://statsapi.mlb.com/api/v1';
const MLB_V11   = 'https://statsapi.mlb.com/api/v1.1';
const SEASON    = new Date().getFullYear();
// NOTE: HR-prop odds were removed from statfax-brain. The engine scores on
// model signal alone, so the pipeline needs no odds API key and the snapshot
// carries no odds. (The HRSauce app keeps its own odds integration.)

// Normalize a player name for robust cross-source matching: strip accents,
// lowercase, drop punctuation + common suffixes, collapse whitespace.
// e.g. "Víctor Mesa Jr." → "victor mesa". Generic helper — handy whenever you
// join feeds that spell names differently (a UI/matching layer can reuse it).
function normalizeName(s) {
  // Backslash-free on purpose: strip combining diacritics + non-alphanumerics
  // by char code, then drop a trailing generational suffix (e.g. "Victor
  // Mesa Jr." → "victor mesa") so differently-spelled names match robustly.
  let out = '';
  for (const ch of String(s || '').normalize('NFD')) {
    const c = ch.codePointAt(0);
    if (c >= 0x300 && c <= 0x36f) continue;
    const lower = ch.toLowerCase();
    const lc = lower.codePointAt(0);
    out += ((lc >= 97 && lc <= 122) || (lc >= 48 && lc <= 57)) ? lower : ' ';
  }
  out = out.trim().replace(/ +/g, ' ');
  return out.replace(/ (jr|sr|ii|iii|iv)$/, '');
}

// Build the model bundle FIRST, then dynamic-import the bundled output. The
// build emits server/.build/model.mjs from src/logic/ProbabilityEngine.js
// (and its transitive imports). The same scoreBatter() that runs on-device
// runs here too, so every device reads pre-scored output from the snapshot.
// Cross-device score drift becomes structurally impossible.
await buildModel();
const {
  scoreBatter,
  calculateBallCarry,
  calculateGameHREnv,
  findStadium,
  findStadiumByTeam,
  gradeFromScore,
  setActiveCalibration,
  // Math improvement helpers — re-exported through ProbabilityEngine.js so
  // they ride along inside the model.mjs bundle. Same source files are
  // used on-device by the client via Metro's bundler.
  americanToImpliedProb,
  dejuicedImpliedProb,
  blendScoreWithVegas,
  fitIsotonicFromBacktest,
  fitIsotonicAdaptive,
  lookupProb,
  computeMetricsFromBacktest,
  baselineBrierForRate,
  baselineLogLossForRate,
  detectReverseSplit,
  computeHotnessPosterior,
  hotnessMultiplier,
  parkWeatherHandFactor,
  estimateRemainingPAs,
  applyPADecay,
  computeLogOddsScore,
} = await import('./.build/model.mjs');

import {
  extractPredictionRecord,
  reconcileDate,
  repairRecentDays,
  computeMultipliers,
  fetchHomerersForDate,
  fetchPitcherKsForDate,
} from './reconcile.mjs';
import {
  comboRowFromSnapshot,
  buildComboRecords,
  buildSGPRecords,
  gradeCombos,
  bestAvailableCombo,
  appendComboDay,
  comboScorecard,
} from './parlay-combos.mjs';

// ─── Server-side K-distribution estimator (mirrors client kBrain) ────────────
// Produces { k, lo, hi, lambda, probs } for a pitcher start against a given
// batter list. No trend/conf needed here — just the Poisson distribution for
// the freeze + scorecard. Inline Poisson math; no external dependencies.
const _SS_LEAGUE_K_PCT   = 0.22;
const _SS_BF_PER_IP      = 4.3;
const _SS_LEAGUE_WHIFF   = 24.5;
const _SS_LEAGUE_SWSTR   = 11.0;  // SwStr% league avg (swinging-strikes / total pitches)
const _SS_STAB_BF        = 150;   // regression threshold for pitcher platoon splits
const _SS_K_LINES        = [3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5];

function _ssEffSide(batSide, pitcherHand) {
  if (batSide === 'S') return pitcherHand === 'L' ? 'R' : 'L';
  return batSide || 'R';
}
function _ssPoissonCDF(k, lambda) {
  if (lambda <= 0) return 1;
  let sum = 0, term = Math.exp(-lambda);
  for (let i = 0; i <= Math.floor(k); i++) { sum += term; term *= lambda / (i + 1); }
  return Math.min(1, sum);
}
function _ssFindQuantile(lambda, p) {
  let k = Math.max(0, Math.round(lambda - 3));
  while (_ssPoissonCDF(k, lambda) < p && k < 30) k++;
  return k;
}
function _ssKOverProb(lambda, line) {
  if (!Number.isFinite(lambda) || lambda <= 0) return null;
  return 1 - _ssPoissonCDF(Math.floor(line), lambda);
}
function _ssPitchMixKBoost(pitchMix) {
  if (!pitchMix) return 0;
  const LIFT = { sl: 0.012, st: 0.015, cu: 0.010, kc: 0.010, ch: 0.009, fs: 0.011 };
  let boost = 0;
  for (const [code, lift] of Object.entries(LIFT)) {
    const raw = Number(pitchMix[`${code}Pct`] ?? 0);
    const pct = raw > 1.5 ? raw / 100 : raw;
    boost += pct * lift;
  }
  return Math.min(0.04, boost);
}

// Temperature adjustment: cold air reduces grip/spin → fewer Ks; hot → slight boost.
// Ignored for indoor (roofClosed) venues. Clamped ±8%.
function _ssTempAdj(weather) {
  if (!weather || weather.roofClosed) return 1;
  const t = weather.tempF;
  if (!Number.isFinite(t)) return 1;
  return Math.max(0.92, Math.min(1.08, 1 + (t - 72) * 0.003));
}
// Umpire K adjustment. Uses dedicated kFactor when available (from umpire-factors.json kFactors table);
// falls back to hrFactor proxy for unlisted umpires (tight HR zone ≈ tight K zone).
function _ssUmpireKAdj(umpire) {
  const kf = umpire?.kFactor;
  if (Number.isFinite(kf)) return Math.max(0.92, Math.min(1.08, kf));
  const hf = umpire?.hrFactor;
  if (!Number.isFinite(hf)) return 1;
  return Math.max(0.92, Math.min(1.08, 1 + (1 - hf) * 0.15));
}

function computeKDist(pitcher, targets, { weather, umpire, parkFactorK } = {}) {
  const s = pitcher?.season || {};

  // Season K rate — anchor for stabilization and fallback
  let seasonKRate = s.bf > 0 && Number.isFinite(s.k) ? s.k / s.bf
    : Number.isFinite(s.kPer9) ? (s.kPer9 / 9) / _SS_BF_PER_IP
    : null;

  // ── Step A: Per-batter log-odds matchup with split stabilization ──────────
  // For each batter, combines pitcher platoon K rate with batter's own K rate
  // via the odds-ratio formula, dividing out league-average double-counting.
  // Pitcher splits < _SS_STAB_BF BF against that hand are regressed toward
  // their season rate to prevent small-sample volatility from distorting the
  // projection early in the year.
  const vl = pitcher?.splits?.vl;
  const vr = pitcher?.splits?.vr;
  const vlKRate = (vl?.kPct != null && Number.isFinite(vl.kPct)) ? vl.kPct / 100 : null;
  const vrKRate = (vr?.kPct != null && Number.isFinite(vr.kPct)) ? vr.kPct / 100 : null;

  let splitKRate = null;
  if (seasonKRate != null && (vlKRate != null || vrKRate != null)) {
    const stabVl = vlKRate != null
      ? (Number.isFinite(vl?.bf) && vl.bf < _SS_STAB_BF
          ? (vlKRate * vl.bf + seasonKRate * _SS_STAB_BF) / (vl.bf + _SS_STAB_BF)
          : vlKRate)
      : seasonKRate;
    const stabVr = vrKRate != null
      ? (Number.isFinite(vr?.bf) && vr.bf < _SS_STAB_BF
          ? (vrKRate * vr.bf + seasonKRate * _SS_STAB_BF) / (vr.bf + _SS_STAB_BF)
          : vrKRate)
      : seasonKRate;

    const leagueOdds = _SS_LEAGUE_K_PCT / (1 - _SS_LEAGUE_K_PCT);
    const perBatterK = (targets || []).map(b => {
      const side = _ssEffSide(b.batSide, pitcher?.hand);
      const pK   = Math.min(0.99, side === 'L' ? stabVl : stabVr);
      const ss   = b.season;
      const pa   = (ss?.ab || 0) + (ss?.bb || 0);
      const bK   = Math.min(0.99, pa > 0 ? (ss?.k || 0) / pa : _SS_LEAGUE_K_PCT);
      const matchupOdds = (pK / (1 - pK)) * (bK / (1 - bK)) / leagueOdds;
      return matchupOdds / (1 + matchupOdds);
    });
    if (perBatterK.length) splitKRate = perBatterK.reduce((a, b) => a + b, 0) / perBatterK.length;
  }

  if (seasonKRate == null && splitKRate == null) return null;
  if (seasonKRate == null) seasonKRate = splitKRate;

  // ── Step B: Recent form blend ──────────────────────────────────────────────
  const rf = pitcher?.recentForm;
  let recentKRate = null;
  const recentStarts = (rf?.recentStarts || []).filter(x => Number.isFinite(x.ip) && x.ip > 0);
  if (recentStarts.length >= 2) {
    const kbf = recentStarts.slice(0, 6).map(x => {
      const bf = x.bf ?? (x.ip * _SS_BF_PER_IP);
      return bf > 0 && Number.isFinite(x.k) ? x.k / bf : null;
    }).filter(v => v != null);
    if (kbf.length) recentKRate = kbf.reduce((a, b) => a + b, 0) / kbf.length;
  } else if (Number.isFinite(rf?.k9)) {
    recentKRate = (rf.k9 / 9) / _SS_BF_PER_IP;
  }
  let baseKRate;
  if (splitKRate != null) {
    baseKRate = recentKRate != null ? splitKRate * 0.55 + recentKRate * 0.45 : splitKRate;
  } else {
    baseKRate = recentKRate != null ? seasonKRate * 0.60 + recentKRate * 0.40 : seasonKRate;
  }

  // ── Step C: SwStr% (preferred) or Whiff% ─────────────────────────────────
  // SwStr% (swinging-strikes / total pitches) correlates more tightly to raw
  // K% than Whiff% (swinging-strikes / swings) because it naturally penalizes
  // pitchers who get called strikes but few actual misses. Use whiff% as fallback.
  const swStrPct = pitcher?.savant?.swStrPct;
  const whiffPct = pitcher?.savant?.whiffPct;
  let kRate = baseKRate;
  if (swStrPct != null && Number.isFinite(swStrPct)) {
    kRate = baseKRate * (1 + ((swStrPct - _SS_LEAGUE_SWSTR) / _SS_LEAGUE_SWSTR) * 0.30);
  } else if (whiffPct != null && Number.isFinite(whiffPct)) {
    kRate = baseKRate * (1 + ((whiffPct - _SS_LEAGUE_WHIFF) / _SS_LEAGUE_WHIFF) * 0.25);
  }
  kRate = Math.min(0.45, kRate);

  // ── Step D: Pitch-mix boost (only when SwStr%/Whiff% unavailable) ─────────
  const hasMissMetric = (swStrPct != null && Number.isFinite(swStrPct)) || (whiffPct != null && Number.isFinite(whiffPct));
  const boost = hasMissMetric ? 0 : _ssPitchMixKBoost(pitcher?.pitchMix);
  const adjustedKRate = kRate + boost;

  // ── Opponent K adjustment ─────────────────────────────────────────────────
  // Computed before expBF — needed for Vegas proxy below.
  const oppKs = (targets || []).map(b => {
    const ss = b.season;
    if (!ss || !(ss.ab > 0)) return null;
    const pa = (ss.ab || 0) + (ss.bb || 0);
    return pa > 0 ? (ss.k || 0) / pa : null;
  }).filter(v => v != null);
  const oppK   = oppKs.length ? oppKs.reduce((a, b) => a + b, 0) / oppKs.length : _SS_LEAGUE_K_PCT;
  const oppAdj = Math.max(0.82, Math.min(1.22, oppK / _SS_LEAGUE_K_PCT));

  // ── Expected BF (pitch-volume model with Vegas proxy) ─────────────────────
  // When per-start pitch counts are available (numberOfPitches in game logs),
  // use Projected Pitches ÷ P/BF for a more accurate volume estimate than
  // raw IP. Vegas proxy: elite-contact lineup (oppK < 0.185, analogous to
  // implied runs > 4.5) faces more hard contact → pitcher pulled earlier → −5%.
  const vegasTrim  = oppK < 0.185 ? 0.95 : 1.0;
  const pitchVals  = recentStarts.slice(0, 6).map(x => x.pitches).filter(v => Number.isFinite(v) && v > 50);
  const bfVals     = recentStarts.slice(0, 6).map(x => x.bf ?? (Number.isFinite(x.ip) ? x.ip * _SS_BF_PER_IP : null)).filter(Number.isFinite);
  let expBF;
  if (pitchVals.length >= 2 && bfVals.length >= 2) {
    const avgPitches = pitchVals.reduce((a, b) => a + b, 0) / pitchVals.length;
    const avgBF      = bfVals.reduce((a, b) => a + b, 0) / bfVals.length;
    const pPerBF     = Math.max(3.5, Math.min(4.5, avgPitches / avgBF));
    expBF = Math.max(3.5 * _SS_BF_PER_IP, Math.min(7.5 * _SS_BF_PER_IP, (avgPitches * vegasTrim) / pPerBF));
  } else {
    const ipVals = recentStarts.map(x => x.ip).filter(Number.isFinite).slice(0, 6);
    const expIP  = ipVals.length >= 2
      ? ipVals.reduce((a, b) => a + b, 0) / ipVals.length
      : (Number.isFinite(rf?.ip) && rf?.games > 0 ? rf.ip / rf.games : 5.3);
    expBF = Math.max(3.5 * _SS_BF_PER_IP, Math.min(7.5 * _SS_BF_PER_IP, expIP * _SS_BF_PER_IP * vegasTrim));
  }

  // ── TTTO penalty (Third Time Through the Order) ────────────────────────────
  // Pitchers with richer arsenals (4+ pitch types ≥10% usage) degrade less
  // on third exposure — diverse sequencing keeps batters off-balance longer.
  // Two-pitch arms show steeper decay. Scale the 12% baseline ±3pp by diversity.
  const PM = pitcher?.pitchMix;
  const pitchDiversity = PM
    ? ['ffPct','siPct','fcPct','slPct','cuPct','kcPct','chPct','fsPct']
        .filter(f => (PM[f] ?? 0) >= 10).length
    : 2;
  const tttoRate    = pitchDiversity >= 4 ? 0.096 : pitchDiversity <= 2 ? 0.144 : 0.12;
  const tttoBF      = Math.max(0, expBF - 18);
  const tttoPenalty = expBF > 0 ? (1 - tttoBF * tttoRate / expBF) : 1.0;

  // ── Environmental multipliers ──────────────────────────────────────────────
  const tempAdj = _ssTempAdj(weather);
  // Base K factor from umpire's overall zone size, then apply a pitch-location ×
  // zone-tendency interaction: a "low"-zone ump rewards breaking-ball-heavy
  // pitchers; a "high"-zone ump rewards FB-heavy arms; "wide" is a flat boost.
  let umpireAdj = _ssUmpireKAdj(umpire);
  const umpZone = umpire?.zoneStyle;
  if (umpZone && PM) {
    const fastPct  = ((PM.ffPct ?? 0) + (PM.siPct ?? 0) + (PM.fcPct ?? 0)) / 100;
    const breakPct = ((PM.slPct ?? 0) + (PM.cuPct ?? 0) + (PM.kcPct ?? 0)) / 100;
    let zoneX = 1.0;
    if      (umpZone === 'high' && fastPct  > 0.40) zoneX = 1 + (fastPct  - 0.40) * 0.08;
    else if (umpZone === 'low'  && breakPct > 0.25) zoneX = 1 + (breakPct - 0.25) * 0.08;
    else if (umpZone === 'wide')                    zoneX = 1.015;
    umpireAdj = Math.min(1.12, umpireAdj * zoneX);
  }
  const pAdj = Number.isFinite(parkFactorK) && parkFactorK > 0 ? parkFactorK : 1.0;

  const lambda = expBF * adjustedKRate * oppAdj * tempAdj * umpireAdj * pAdj * tttoPenalty;
  const probs = {};
  for (const line of _SS_K_LINES) probs[line] = _ssKOverProb(lambda, line);
  const lo = Math.max(0, _ssFindQuantile(lambda, 0.10));
  const hi = _ssFindQuantile(lambda, 0.90);

  return { k: lambda, lo, hi, lambda, probs, tempAdj, umpireAdj, parkKAdj: pAdj, tempF: weather?.tempF ?? null, tttoPenalty, vegasTrim };
}

// Intraday board history — append a compact snapshot of TODAY's canonical combos
// (one per strategy/size) + lineup-confirmation state on every run, so we can
// later measure how much the board changes morning → first pitch and prove
// whether early (unconfirmed) boards are systematically worse. Rolls over daily,
// capped. Non-fatal. Analyze with model-lab/board-evolution.mjs once a day settles.
function appendBoardSnapshot(scoredBatters, games, date) {
  try {
    const liveOrFinal = new Set((games || []).filter(g => g.isLive || g.isFinal).map(g => g.gamePk));
    const rows = Object.values(scoredBatters || {});
    const seen = new Set();
    const pool = [];
    for (const r of rows) {
      if (r.playerId == null || seen.has(r.playerId)) continue;
      seen.add(r.playerId);
      if (liveOrFinal.has(r.gamePk)) continue;      // bettable board = pregame games only
      const cr = comboRowFromSnapshot(r);
      if (cr) { cr.lineupConfirmed = r.lineupConfirmed === true; pool.push(cr); }
    }
    // Lineup-confirmation summary over still-playable games.
    const gconf = new Map();
    for (const r of rows) {
      if (r.gamePk == null || liveOrFinal.has(r.gamePk)) continue;
      gconf.set(r.gamePk, (gconf.get(r.gamePk) || false) || r.lineupConfirmed === true);
    }
    const records = buildComboRecords(pool);
    const combos = records.map(c => ({ s: c.strategy, n: c.size, legs: c.legs }));
    let hist = { date, snapshots: [] };
    if (existsSync(BOARD_HISTORY_OUT_PATH)) {
      try { const prev = JSON.parse(readFileSync(BOARD_HISTORY_OUT_PATH, 'utf8')); if (prev?.date === date && Array.isArray(prev.snapshots)) hist = prev; } catch {}
    }
    hist.snapshots.push({
      at: new Date().toISOString(),
      lineupsConfirmed: [...gconf.values()].filter(Boolean).length,
      lineupsTotal: gconf.size,
      combos,
    });
    if (hist.snapshots.length > 250) hist.snapshots = hist.snapshots.slice(-250);
    writeFileSync(BOARD_HISTORY_OUT_PATH, JSON.stringify(hist));
    console.log(`[board-history] +1 snapshot (${hist.snapshots.length} today) · lineups ${[...gconf.values()].filter(Boolean).length}/${gconf.size}`);
    return { combos: records, gameCount: gconf.size };
  } catch (e) {
    console.warn(`[board-history] non-fatal: ${e.message}`);
    return null;
  }
}

// Per-window combo boards — split the slate into start WINDOWS you could bet as
// one ticket (games within ~2.5h of the window's first pitch, so the latest
// leg's lineup posts before the earliest locks), then build each window's own
// combos from frozen pregame values. Lets the Results page grade the board you
// actually bet in each window (early vs late), not just the idealized all-slate
// board. Returns null when the day doesn't split (one window == the full board).
const WINDOW_SPAN_MS = 2.5 * 3600e3;
function buildWindowBoards(scoredBatters, games) {
  const sorted = (games || [])
    .filter((g) => g.gameDate)
    .map((g) => ({ pk: g.gamePk, t: new Date(g.gameDate).getTime() }))
    .sort((a, b) => a.t - b.t);
  if (!sorted.length) return null;
  const wins = [];
  for (const g of sorted) {
    const last = wins[wins.length - 1];
    if (last && g.t - last.minT <= WINDOW_SPAN_MS) { last.pks.add(g.pk); last.maxT = g.t; }
    else wins.push({ pks: new Set([g.pk]), minT: g.t, maxT: g.t });
  }
  if (wins.length < 2) return null; // single window — full board already covers it
  const rows = Object.values(scoredBatters || {});
  const seen = new Set();
  const cr = [];
  for (const r of rows) {
    if (r.playerId == null || seen.has(r.playerId)) continue;
    seen.add(r.playerId);
    const x = comboRowFromSnapshot(r);
    if (x) cr.push(x);
  }
  const short = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: SLATE_TZ, hour: 'numeric', minute: '2-digit' });
  return wins.map((w) => ({
    label: w.minT === w.maxT ? short(w.minT) : `${short(w.minT)}–${short(w.maxT)}`,
    minT: w.minT,
    games: w.pks.size,
    combos: buildComboRecords(cr.filter((r) => w.pks.has(r.gamePk))).map((c) => ({ strategy: c.strategy, size: c.size, legs: c.legs })),
  }));
}

// Day Rating (1–5★) — a "should I even bet HR props today?" gauge from the three
// levers that actually move a slate: how homer-prone the starting pitching is
// (the biggest one), the park/weather environment, and the supply of elite bats.
// Bat *quality* per se barely varies day to day (top tier saturates ~26%), so
// it's deliberately lightly weighted; pitching + conditions are what separate a
// loaded slate from a skip.
function computeDayRating(scoredBatters, games) {
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const all = Object.values(scoredBatters || {});
  const seen = new Set();
  const rows = all.filter((r) => (r.playerId != null && !seen.has(r.playerId) ? (seen.add(r.playerId), true) : false));
  const gamePks = new Set(rows.map((r) => r.gamePk).filter((p) => p != null));
  const nGames = Math.max(1, gamePks.size);

  // Supply (25%): PRIME bats per game — depth of playable HR threats.
  const prime = rows.filter((b) => (b.grade?.label || b.grade) === 'PRIME').length;
  const primePerGame = prime / nGames;
  const supply = clamp01((primePerGame - 2.5) / (4.5 - 2.5));

  // Pitching (45%): the biggest lever — homer-prone starters. Share with
  // HR/9 ≥ 1.3, blended with the average HR/9 of today's starters.
  // Require ≥ 20 IP to prevent thin-sample call-ups (0 HR in 5 IP = 0.00 HR/9)
  // from artificially suppressing the average on normal days.
  const MIN_IP = 20;
  const arms = [...new Map(
    rows.filter((b) => b.pitcher?.id != null && Number.isFinite(b.pitcher?.season?.hrPer9) && (b.pitcher?.season?.ip ?? 0) >= MIN_IP)
        .map((b) => [b.pitcher.id, b.pitcher.season.hrPer9]),
  ).values()];
  const softShare = arms.length ? arms.filter((h) => h >= 1.3).length / arms.length : 0;
  const avgHr9 = arms.length ? arms.reduce((s, h) => s + h, 0) / arms.length : 1.2;
  const pitching = (clamp01((softShare - 0.25) / 0.30) + clamp01((avgHr9 - 1.05) / 0.35)) / 2;

  // Environment (30%): share of games in a hitter's park or favorable air/wind.
  const byGame = new Map();
  for (const b of rows) {
    if (b.gamePk == null) continue;
    const g = byGame.get(b.gamePk) || { air: 0, park: 0 };
    if (Number.isFinite(b.parkWeatherHandFactor)) g.air = Math.max(g.air, b.parkWeatherHandFactor);
    if (Number.isFinite(b.gameParkHRFactor)) g.park = Math.max(g.park, b.gameParkHRFactor);
    byGame.set(b.gamePk, g);
  }
  let favGames = 0;
  for (const [, g] of byGame) if (g.park >= 1.08 || g.air >= 1.05) favGames++;
  const environment = clamp01((favGames / byGame.size) / 0.5);

  const score = Math.round(100 * (0.45 * pitching + 0.30 * environment + 0.25 * supply));
  const stars = score >= 80 ? 5 : score >= 62 ? 4 : score >= 45 ? 3 : score >= 30 ? 2 : 1;
  const VERDICT = {
    5: 'Loaded HR slate — lean in.',
    4: 'Strong HR day — plenty of good spots.',
    3: 'Average slate — be selective.',
    2: 'Soft slate — few good spots, bet light.',
    1: 'Skip-worthy — stingy arms / poor conditions.',
  };
  return {
    stars, score, verdict: VERDICT[stars],
    factors: { pitching: +pitching.toFixed(2), environment: +environment.toFixed(2), supply: +supply.toFixed(2) },
    primePerGame: +primePerGame.toFixed(1), softArmPct: Math.round(softShare * 100),
    favGames, games: byGame.size,
  };
}

// below — see the second import block right after buildModel() runs.
import { combineModels, scoreWithML, loadMLModel, DEFAULT_ENSEMBLE_OPTS, weightsFromBrier } from './models/ensemble.mjs';
import { trainEnsembleWeights, extractFeatures } from './models/trainEnsembleWeights.mjs';
import { trainFeatModel, scoreFeatProb, probToScore } from './models/featModel.mjs';

// EXPERIMENTAL: blend a feature-based ML model into the SCORE/ranking (not just
// the probability). Gated on enough logged feature rows + a measured CV-AUC
// edge over the rule score; weight is sized by that edge and capped. Set to
// false for instant rollback to pure-rule ranking.
const EXPERIMENTAL_ML_RANK = true;
const EXPERIMENTAL_ML_RANK_CAP = 0.25; // "nudge, don't dominate" — small-sample-safe
import { fetchBatterExpectedStats } from './statcastExpected.mjs';
import { fetchCatcherFraming } from './catcherFraming.mjs';
import { fetchRecentBatterBarrelsMultiWindow, fetchRecentPitcherVelo } from './statcastRecent.mjs';
import { applySimResolution } from './lib/simResolution.mjs';
import { fetchHROdds } from './lib/theOddsApi.mjs';
import { pitchMixScore } from '../ui/src/lib/scout.js';

// ─── HTTP helpers ────────────────────────────────────────────────────────────

async function getJson(url, opts = {}, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return res.json();
      // Fail fast on a real 4xx (bad request / not found); retry only transient
      // rate-limit (429) and 5xx. A single MLB brown-out otherwise silently
      // drops that batch of stats (callers swallow the throw → empty data).
      if (res.status !== 429 && res.status < 500) throw new Error(`HTTP ${res.status}: ${url}`);
      lastErr = new Error(`HTTP ${res.status}: ${url}`);
    } catch (e) {
      lastErr = e; // network error / timeout — retry
    }
    if (attempt < retries) await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  throw lastErr;
}

async function mlbGet(path) {
  return getJson(`${MLB_BASE}${path}`);
}

// Same browser-like headers MLBService uses on Baseball Savant requests so
// Cloudflare doesn't return an HTML challenge page.
const SAVANT_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Accept':          'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://baseballsavant.mlb.com/',
  'Origin':          'https://baseballsavant.mlb.com',
};

async function savantGet(url) {
  try {
    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) return null;
    const raw = await res.text();
    const text = raw.replace(/^﻿/, '').trimStart();
    // Bail out if Cloudflare returned an HTML challenge page
    if (!text.startsWith('[') && !text.startsWith('{')) return null;
    try { return JSON.parse(text); } catch { return null; }
  } catch {
    return null;
  }
}

/**
 * Scrape a Baseball Savant HTML page for the embedded `var data = [...];`
 * blob. Several leaderboard endpoints (pitch-arsenals etc) switched from
 * JSON to HTML, so we recover the same dataset by extracting the JS
 * literal out of the HTML response.
 *
 * Returns the parsed array (or null if not found).
 */
async function savantGetEmbedded(url) {
  try {
    const res = await fetch(url, { headers: SAVANT_HEADERS });
    if (!res.ok) return null;
    const html = await res.text();
    // Match `var data = [...];` non-greedily up to the next `var ` token.
    // The data array can be multi-line + contain escaped chars so we use
    // [\s\S] (matches everything incl. newlines) with a lazy quantifier.
    const m = html.match(/var\s+data\s*=\s*(\[[\s\S]*?\])\s*;\s*(?:\n|\r|var\s)/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  } catch {
    return null;
  }
}

/**
 * Fetch a Baseball Savant CSV download endpoint.
 * The "Download CSV" links have more permissive Cloudflare rules than the
 * internal JSON API. Returns array of row-objects (header → value), [] on failure.
 */
async function savantCSV(url) {
  try {
    const res = await fetch(url, {
      headers: { ...SAVANT_HEADERS, Accept: 'text/csv, text/plain, */*' },
    });
    if (!res.ok) return [];
    const raw = await res.text();
    const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!text || text.startsWith('<') || text.startsWith('{')) return [];

    const lines = text.split('\n');
    if (lines.length < 2) return [];

    const parseRow = (line) => {
      const vals = [];
      let cur = '', inQ = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = !inQ;
        } else if (c === ',' && !inQ) {
          vals.push(cur); cur = '';
        } else {
          cur += c;
        }
      }
      vals.push(cur);
      return vals;
    };

    const headers = parseRow(lines[0]);
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = parseRow(line);
      const obj  = {};
      headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? '').trim(); });
      return obj;
    });
  } catch {
    return [];
  }
}

// Concurrency-limited Promise.all — keeps from blasting MLB API with hundreds
// of parallel requests. Returns results in input order.
async function pMap(items, fn, concurrency = 8) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      try { results[i] = await fn(items[i], i); }
      catch (e) { results[i] = { __error: e?.message || String(e) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

// ─── Date helpers ────────────────────────────────────────────────────────────

// Operating-day anchor: the slate's "today" rolls over at midnight in this zone.
// Eastern (MLB's standard game-date reference) → new slate at 12 AM ET.
const SLATE_TZ = 'America/New_York';

function todayInTZ(timeZone = SLATE_TZ) {
  // Anchor to the operating zone so the script's "today" matches the
  // user-facing slate roll-over. A UTC-anchored "today" would tick to tomorrow
  // mid-evening on game nights, breaking late reconciliation.
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return fmt.format(new Date());
}

// ─── Schedule + lineups ──────────────────────────────────────────────────────

async function fetchSchedule(date) {
  const data = await mlbGet(`/schedule?sportId=1&date=${date}&hydrate=probablePitcher(note),venue,linescore,team`);
  const games = [];
  for (const dayEntry of data.dates || []) {
    for (const g of dayEntry.games || []) {
      games.push({
        gamePk:        g.gamePk,
        gameDate:      g.gameDate,
        status:        g.status?.detailedState || g.status?.abstractGameState,
        // MLB tags "Warmup" with abstractGameState === 'Live' even though first
        // pitch hasn't been thrown — so it isn't really started and its props
        // are still bettable pregame. Exclude it so the board doesn't flash LIVE
        // and the parlay builder doesn't drop the game before it actually starts.
        isLive:        g.status?.abstractGameState === 'Live' && g.status?.detailedState !== 'Warmup',
        isFinal:       g.status?.abstractGameState === 'Final',
        awayTeam:      {
          id:   g.teams?.away?.team?.id,
          name: g.teams?.away?.team?.name,
          abbr: g.teams?.away?.team?.abbreviation,
        },
        homeTeam:      {
          id:   g.teams?.home?.team?.id,
          name: g.teams?.home?.team?.name,
          abbr: g.teams?.home?.team?.abbreviation,
        },
        awayPitcher:   g.teams?.away?.probablePitcher
          ? { id: g.teams.away.probablePitcher.id, name: g.teams.away.probablePitcher.fullName }
          : null,
        homePitcher:   g.teams?.home?.probablePitcher
          ? { id: g.teams.home.probablePitcher.id, name: g.teams.home.probablePitcher.fullName }
          : null,
        venueName:     g.venue?.name,
        venueId:       g.venue?.id,
        // Linescore for in-progress games — lets the app skip a redundant
        // live-feed call for the game header state.
        currentInning: g.linescore?.currentInning ?? null,
        inningHalf:    g.linescore?.inningHalf ?? null,
        awayScore:     g.teams?.away?.score ?? null,
        homeScore:     g.teams?.home?.score ?? null,
      });
    }
  }
  return games;
}

async function fetchLineups(gamePk) {
  // Track per-side confirmation so that when team A has posted its lineup
  // but team B hasn't yet (common during pre-game), we can use A's
  // confirmed batting order WHILE still falling back to B's active roster
  // for scoring. Previous version returned confirmed:true the moment ANY
  // side had data, which suppressed the roster fallback for the empty
  // side and left it with zero batters in the snapshot (the SF Giants
  // ghost-lineup bug).
  let away = [], home = [];
  let awayConfirmed = false, homeConfirmed = false;

  // Pass 1: schedule lineup hydration (pre-game)
  try {
    const data = await mlbGet(`/schedule?sportId=1&gamePk=${gamePk}&hydrate=lineups`);
    const game = data.dates?.[0]?.games?.[0];
    if (game?.lineups) {
      const a = (game.lineups.awayPlayers || []).map(p => p.id ?? p).filter(Number.isInteger);
      const h = (game.lineups.homePlayers || []).map(p => p.id ?? p).filter(Number.isInteger);
      if (a.length) { away = a; awayConfirmed = true; }
      if (h.length) { home = h; homeConfirmed = true; }
    }
  } catch {}

  // Pass 2: boxscore batting order — only consult for sides still missing
  // (live + completed games will have data here even when the pre-game
  // /schedule hydration is empty). No reason to refetch a side we already
  // confirmed in Pass 1.
  if (!awayConfirmed || !homeConfirmed) {
    try {
      const bs = await mlbGet(`/game/${gamePk}/boxscore`);
      const norm = arr => (arr || []).map(p => (typeof p === 'object' ? p.id : p)).filter(Boolean);
      if (!awayConfirmed) {
        const a = norm(bs.teams?.away?.battingOrder);
        if (a.length) { away = a; awayConfirmed = true; }
      }
      if (!homeConfirmed) {
        const h = norm(bs.teams?.home?.battingOrder);
        if (h.length) { home = h; homeConfirmed = true; }
      }
    } catch {}
  }

  return {
    away, home,
    awayConfirmed, homeConfirmed,
    // Legacy `confirmed` kept for backward compat with anything reading
    // the snapshot's old shape. Now means "both sides confirmed", which
    // matches the old intent of the field (used to gate per-batter
    // batting-order assignment that requires the FULL lineup to be set).
    confirmed: awayConfirmed && homeConfirmed,
  };
}

async function fetchActiveBatters(teamId) {
  try {
    const data = await mlbGet(`/teams/${teamId}/roster/active`);
    return (data.roster || [])
      .filter(p => p.position?.type !== 'Pitcher')
      .map(p => ({
        id:      p.person.id,
        name:    p.person.fullName,
        batSide: p.person.batSide?.code || 'R',
      }));
  } catch {
    return [];
  }
}

// ─── Stats batch fetches ─────────────────────────────────────────────────────

async function fetchBatterStatsBatch(playerIds) {
  if (!playerIds.length) return {};
  const result = {};
  const chunks = [];
  for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
  await Promise.all(chunks.map(async chunk => {
    try {
      const ids = chunk.join(',');
      const url = `${MLB_BASE}/people?personIds=${ids}` +
        `&hydrate=stats(group=[hitting],type=[season,lastXGames],season=${SEASON},gameType=[R],limit=15)`;
      const data = await getJson(url);
      for (const person of data.people || []) {
        const out = { id: person.id, name: person.fullName, batSide: person.batSide?.code || 'R', season: null, recent: null };
        for (const sg of person.stats || []) {
          const splits = sg.splits || [];
          if (sg.type?.displayName === 'statsSingleSeason' || sg.type?.displayName === 'season') {
            const s = splits[0]?.stat;
            if (s) out.season = {
              ab:  +s.atBats || 0, hr: +s.homeRuns || 0, h: +s.hits || 0,
              avg: +s.avg   || 0, slg: +s.slg     || 0,
              obp: +s.obp   || 0, ops: +s.ops     || 0,
              k:   +s.strikeOuts || 0, bb: +s.baseOnBalls || 0,
            };
          } else if (sg.type?.displayName === 'lastXGames') {
            const totals = splits.reduce((acc, sp) => {
              const s = sp.stat || {};
              acc.ab  += +s.atBats || 0;
              acc.hr  += +s.homeRuns || 0;
              acc.h   += +s.hits || 0;
              acc.tb  += +s.totalBases || 0;
              acc.k   += +s.strikeOuts || 0;
              acc.bb  += +s.baseOnBalls || 0;
              return acc;
            }, { ab: 0, hr: 0, h: 0, tb: 0, k: 0, bb: 0 });
            const avg = totals.ab ? totals.h / totals.ab : 0;
            const slg = totals.ab ? totals.tb / totals.ab : 0;
            out.recent = { ...totals, avg, slg };
          }
        }
        result[person.id] = out;
      }
    } catch {}
  }));
  return result;
}

async function fetchPitcherStatsBatch(playerIds) {
  if (!playerIds.length) return {};
  const result = {};
  const chunks = [];
  for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
  await Promise.all(chunks.map(async chunk => {
    try {
      const ids = chunk.join(',');
      const url = `${MLB_BASE}/people?personIds=${ids}` +
        `&hydrate=stats(group=[pitching],type=[season,statSplits],season=${SEASON},gameType=[R],sitCodes=[vl,vr])`;
      const data = await getJson(url);
      for (const person of data.people || []) {
        const out = { id: person.id, name: person.fullName, throws: person.pitchHand?.code || 'R', season: null, splits: null };
        for (const sg of person.stats || []) {
          const splits = sg.splits || [];
          if (sg.type?.displayName === 'statsSingleSeason' || sg.type?.displayName === 'season') {
            const s = splits[0]?.stat;
            if (s) {
              const ip = parseIP(s.inningsPitched);
              const hr = +s.homeRuns || 0;
              const k  = +s.strikeOuts || 0;
              // Ground-out : air-out ratio — a stable proxy for a pitcher's
              // fly-ball/ground-ball tilt (the MLB stat object carries
              // groundOuts/airOuts and a pre-divided groundOutsToAirouts).
              // Fly-ball arms (low GO/AO) allow more HR; ground-ball arms fewer.
              // Far more sample-stable than HR/9 early in the year.
              const groundOuts = +s.groundOuts || 0;
              const airOuts    = +s.airOuts || 0;
              const goAo = airOuts > 0 ? groundOuts / airOuts
                         : (s.groundOutsToAirouts != null && s.groundOutsToAirouts !== '-.--')
                           ? parseFloat(s.groundOutsToAirouts) : null;
              out.season = {
                ip,
                hr,
                era:   +s.era || 0,
                whip:  +s.whip || 0,
                k,
                bb:    +s.baseOnBalls || 0,
                bf:    +s.battersFaced || 0,
                groundOuts,
                airOuts,
                goAo:  Number.isFinite(goAo) && goAo > 0 ? +goAo.toFixed(3) : null,
                // hrPer9/kPer9 are how the scoring model reads HR risk and
                // strikeout rate (ProbabilityEngine reads `pitcherSeason.hrPer9`
                // in synergy calc + matchup factors). MLBService.getPitcherStats
                // computes these on-device; we were omitting them here, which
                // meant a few code paths fell back to LEAGUE_AVG instead of
                // the pitcher's actual rate. Now they match.
                hrPer9: ip > 0 ? (hr * 9) / ip : null,
                kPer9:  ip > 0 ? (k  * 9) / ip : null,
              };
            }
          } else if (sg.type?.displayName === 'statSplits') {
            const sp = {};
            for (const split of splits) {
              const code = split.split?.code;
              const s    = split.stat || {};
              if (!code) continue;
              const ip = parseIP(s.inningsPitched);
              const hr = +s.homeRuns || 0;
              const bf = +s.battersFaced || 0;
              const kk = +s.strikeOuts || 0;
              const bbb = +s.baseOnBalls || 0;
              const slg = +s.slg || 0;
              const avg = +s.avg || 0;
              sp[code] = {
                ip,
                hr,
                era: +s.era || 0,
                avg,
                // Full slash so the matchup view can show how each side hits this
                // arm (the stat object already carries these — just extracting).
                obp: +s.obp || 0,
                slg,
                ops: +s.ops || 0,
                iso: slg && avg ? +(slg - avg).toFixed(3) : null,
                bf,
                kPct: bf > 0 ? +((kk / bf) * 100).toFixed(1) : null,
                bbPct: bf > 0 ? +((bbb / bf) * 100).toFixed(1) : null,
                // Same fix on the split — the model blends split.hrPer9 with
                // season.hrPer9 weighted by IP. Without this the blend got an
                // undefined split-side value and defaulted to the season rate
                // regardless of the platoon split's actual HR-allowed rate.
                hrPer9: ip > 0 ? (hr * 9) / ip : null,
              };
            }
            out.splits = sp;
          }
        }
        result[person.id] = out;
      }
    } catch {}
  }));
  return result;
}

// MLB API innings-pitched uses ".1=⅓, .2=⅔" convention. Convert to decimal.
function parseIP(ipStr) {
  if (ipStr == null) return 0;
  const ip = parseFloat(ipStr);
  if (!isFinite(ip)) return 0;
  const whole = Math.floor(ip);
  const dec   = +(ip - whole).toFixed(1);
  if (Math.abs(dec - 0.1) < 0.05) return whole + 1 / 3;
  if (Math.abs(dec - 0.2) < 0.05) return whole + 2 / 3;
  return ip;
}

function safeFloat(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// parseStat mirrors MLBService's helper so split parsers produce the same
// shape — { avg, slg, ab, hr, pa, iso, hrRate }.
function parseStat(stat = {}) {
  const avg  = safeFloat(stat.avg);
  const slg  = safeFloat(stat.slg);
  const ab   = stat.atBats   || 0;
  const hr   = stat.homeRuns || 0;
  const pa   = stat.plateAppearances || ab || 1;
  const iso  = slg - avg;
  const hrRate = ab > 0 ? hr / ab : 0;
  return { avg, slg, ab, hr, pa, iso, hrRate };
}

// ─── Bullpen HR/9 per team ───────────────────────────────────────────────────

async function fetchBullpenHR9Map(teamIds) {
  const map = {};
  await pMap(teamIds, async (teamId) => {
    try {
      const data = await mlbGet(`/teams/${teamId}/stats?stats=statSplits&group=pitching&sitCodes=rp&season=${SEASON}`);
      const split = data.stats?.[0]?.splits?.find(s => s.split?.code === 'rp');
      if (!split?.stat) return;
      const ip = parseIP(split.stat.inningsPitched);
      const hr = +split.stat.homeRuns || 0;
      if (ip < 30) return;   // <30 IP is too noisy
      map[teamId] = (hr * 9) / ip;
    } catch {}
  }, 8);
  return map;
}

// ─── Pitcher recent form / hands ─────────────────────────────────────────────

/**
 * Recent pitcher form — last 5 starts aggregated.
 * Reveals when a pitcher is trending way worse (or better) than season line.
 * Returns { games, ip, era, hrPer9, k9, lastStartDate } or null.
 */

/**
 * Live in-game context for a single game (Tier-1 live signals).
 * Walks the play-by-play to compute per-batter stats that the cron can
 * use to nudge scores during in-progress games. Called only for games
 * with isLive === true, so the cost is bounded to actual in-progress
 * games (usually 1-6 at a time across MLB hours).
 *
 * Returns:
 *   {
 *     perBatter: {
 *       [playerId]: {
 *         abCount,           // plate appearances logged this game
 *         nearMissHR,        // hard-hit (≥100 mph) non-HR balls at HR
 *                            // launch angle (18-35°). Best next-AB
 *                            // predictor in the live-data toolbox.
 *         isHRThisGame,      // already hit one — UI uses for HR badge
 *       },
 *     },
 *     currentInning,         // top of N-th half-inning
 *     runDiff,               // abs run differential — feeds blowout detection
 *   }
 *
 * Returns null on any fetch / parse failure — caller silently skips
 * adjustments for that game (pre-game model output stands).
 */
async function fetchLiveGameContext(gamePk) {
  if (!gamePk) return null;
  try {
    const data = await getJson(`${MLB_V11}/game/${gamePk}/feed/live`);
    const linescore = data?.liveData?.linescore;
    const allPlays  = data?.liveData?.plays?.allPlays;
    if (!Array.isArray(allPlays)) return null;

    const homeRuns = linescore?.teams?.home?.runs ?? 0;
    const awayRuns = linescore?.teams?.away?.runs ?? 0;
    const runDiff       = Math.abs(homeRuns - awayRuns);
    const currentInning = linescore?.currentInning ?? 0;

    // Event types that DON'T count as a plate appearance (no AB consumed).
    // MLB API uses these eventType strings — verified against /feed/live
    // responses. Anything not in this set is treated as an AB.
    const NON_AB_EVENTS = new Set([
      'walk', 'intent_walk', 'hit_by_pitch',
      'sac_fly', 'sac_bunt',
      'catcher_interf', 'fielders_choice_out',
      // 'strikeout' IS an AB; don't exclude it.
    ]);

    const perBatter = {};
    for (const play of allPlays) {
      const batterId = play?.matchup?.batter?.id;
      if (!batterId) continue;
      if (!perBatter[batterId]) {
        perBatter[batterId] = { abCount: 0, nearMissHR: 0, isHRThisGame: false };
      }
      const slot = perBatter[batterId];
      const eventType = play?.result?.eventType || '';

      // Plate appearance counter.
      if (eventType && !NON_AB_EVENTS.has(eventType)) {
        slot.abCount++;
      }

      // HR-this-game flag (drives the UI's "already homered" indicator).
      if (eventType === 'home_run') {
        slot.isHRThisGame = true;
        continue;   // not a "near miss" — it's the real thing
      }

      // Near-miss: ≥100 mph exit velo at HR launch angle (18-35°) that
      // wasn't actually a HR. Lots of these die at the warning track on
      // any given day; turning them into a quantified "barreled balls
      // this game" stat surfaces the bettor's intuition that a guy is
      // "due" mathematically.
      const hd = play?.hitData;
      if (hd) {
        const ls = parseFloat(hd.launchSpeed);
        const la = parseFloat(hd.launchAngle);
        if (Number.isFinite(ls) && Number.isFinite(la)
            && ls >= 100 && la >= 18 && la <= 35) {
          slot.nearMissHR++;
        }
      }
    }

    // Per-pitcher K tracking: grab starter's current Ks from the live boxscore.
    const boxscore = data?.liveData?.boxscore;
    const perPitcher = {};
    for (const side of ['home', 'away']) {
      const pitcherIds = boxscore?.teams?.[side]?.pitchers || [];
      if (!pitcherIds.length) continue;
      const starterId = pitcherIds[0];
      const player = boxscore?.teams?.[side]?.players?.[`ID${starterId}`];
      const ks = player?.stats?.pitching?.strikeOuts;
      const ip = player?.stats?.pitching?.inningsPitched;
      if (Number.isFinite(ks)) {
        perPitcher[starterId] = { ks, ip: ip != null ? parseFloat(ip) : null };
      }
    }

    return { perBatter, perPitcher, currentInning, runDiff };
  } catch {
    return null;
  }
}

async function fetchPitcherRecentForm(pitcherId) {
  try {
    const data = await mlbGet(
      `/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${SEASON}&gameType=R`
    );
    const splits = data.stats?.[0]?.splits || [];
    if (!splits.length) return null;

    const ordered = [...splits].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const lastN   = ordered.slice(0, 5);

    // Per-game rows for the last 10 starts — powers the "Recent Starts"
    // table in PlayerDetailModal. Aggregate stats above stay 5-game so
    // the matchup model isn't moved when this UI ships; the 10-row table
    // is purely informational. Each row carries the lightweight fields
    // a table cell renders: date / opp abbr / IP / H / ER / BB / K / HR
    // / per-game ERA. Anything missing from the API → null so the row
    // renders "—" cleanly.
    // MLB team id → abbreviation. The gameLog `opponent` block only carries
    // { id, name } — NO `abbreviation`/`teamName` — so the old read always
    // resolved to null and the OPP column rendered "—". Map the id instead;
    // fall back to the full team name, then null, if a new id ever appears.
    const TEAM_ABBR_BY_ID = {
      108:'LAA',109:'ARI',110:'BAL',111:'BOS',112:'CHC',113:'CIN',114:'CLE',115:'COL',
      116:'DET',117:'HOU',118:'KC',119:'LAD',120:'WSH',121:'NYM',133:'ATH',134:'PIT',
      135:'SD',136:'SEA',137:'SF',138:'STL',139:'TB',140:'TEX',141:'TOR',142:'MIN',
      143:'PHI',144:'ATL',145:'CWS',146:'MIA',147:'NYY',158:'MIL',
    };
    const recentStarts = ordered.slice(0, 10).map(g => {
      const stat = g.stat || {};
      const gameIp = parseIP(stat.inningsPitched);
      const gameEr = parseInt(stat.earnedRuns, 10);
      const opp = TEAM_ABBR_BY_ID[g.opponent?.id] || g.opponent?.name || null;
      const isHome = !!(g.isHome);
      return {
        date:   g.date || null,
        opp,
        isHome,
        ip:     Number.isFinite(gameIp) ? gameIp : null,
        h:      Number.isFinite(parseInt(stat.hits, 10))         ? parseInt(stat.hits, 10)         : null,
        er:     Number.isFinite(gameEr)                          ? gameEr                          : null,
        bb:     Number.isFinite(parseInt(stat.baseOnBalls, 10))  ? parseInt(stat.baseOnBalls, 10)  : null,
        k:      Number.isFinite(parseInt(stat.strikeOuts, 10))   ? parseInt(stat.strikeOuts, 10)   : null,
        hr:     Number.isFinite(parseInt(stat.homeRuns, 10))     ? parseInt(stat.homeRuns, 10)     : null,
        pitches: Number.isFinite(parseInt(stat.numberOfPitches, 10)) ? parseInt(stat.numberOfPitches, 10) : null,
        era:    (Number.isFinite(gameIp) && gameIp > 0 && Number.isFinite(gameEr))
                  ? (gameEr * 9) / gameIp
                  : null,
      };
    });

    let ip = 0, er = 0, hr = 0, k = 0;
    for (const g of lastN) {
      const stat = g.stat || {};
      ip += parseIP(stat.inningsPitched);
      er += parseInt(stat.earnedRuns,  10) || 0;
      hr += parseInt(stat.homeRuns,    10) || 0;
      k  += parseInt(stat.strikeOuts,  10) || 0;
    }
    if (ip < 5) return null;

    // Fatigue signal — sum pitches thrown across games in the last 3
    // calendar days. Most starters (4-day rest) → 0. A starter on short
    // rest (pitched 3 days ago) → ~80-110. A reliever / opener with
    // multiple recent appearances → can stack higher. The model uses
    // this in computeRecentFormFactor to nudge batter edge upward when
    // the opposing pitcher is on a heavy short-term workload.
    const cutoffMs = Date.now() - 3 * 86400000;
    let pitchesL3D = 0;
    for (const g of ordered) {
      const gameMs = Date.parse(g.date || '');
      if (!Number.isFinite(gameMs) || gameMs < cutoffMs) continue;
      // MLB Stats API gameLog uses `numberOfPitches`, not `pitchesThrown`.
      // Verified against /stats?stats=gameLog response — every game stat
      // block carries numberOfPitches for pitching gameType=R.
      const p = parseInt(g.stat?.numberOfPitches, 10);
      if (Number.isFinite(p)) pitchesL3D += p;
    }

    return {
      games:         lastN.length,
      ip,
      era:           (er * 9) / ip,
      hrPer9:        (hr * 9) / ip,
      k9:            (k  * 9) / ip,
      lastStartDate: ordered[0]?.date || null,
      pitchesL3D,
      recentStarts,
    };
  } catch {
    return null;
  }
}

/**
 * Batch-fetch pitcher throwing hand for a set of pitcher IDs.
 * Returns { [pitcherId]: 'L' | 'R' }.
 */
async function fetchPitcherHands(pitcherIds) {
  if (!pitcherIds.length) return {};
  try {
    const ids  = pitcherIds.join(',');
    const data = await mlbGet(`/people?personIds=${ids}`);
    const out  = {};
    for (const p of data.people || []) {
      if (p.id && p.pitchHand?.code) out[p.id] = p.pitchHand.code;
    }
    return out;
  } catch {
    return {};
  }
}

// ─── Statcast (Baseball Savant) — league-wide leaderboards ───────────────────

/**
 * League-wide Statcast contact-quality + zone data for all qualified batters.
 * Two-pass: try the JSON percentile-rankings endpoint first; fall back to
 * CSV leaderboard if it returns nothing. Returns { [playerId]: { ... } }.
 */
async function fetchSavantBatterStatsAll(year = SEASON) {
  const pf = v => (v != null && v !== '' ? parseFloat(v) : null);
  const out = {};

  // Pass 1: JSON percentile rankings
  try {
    const data = await savantGet(`https://baseballsavant.mlb.com/percentile-rankings?type=batter&year=${year}`);
    if (Array.isArray(data) && data.length) {
      for (const p of data) {
        if (!p.player_id) continue;
        out[Number(p.player_id)] = {
          exitVelo:     pf(p.avg_hit_speed),
          hardHitPct:   pf(p.hard_hit_percent),
          // barrelPct = barrels per PA (brl_pa). Kept as the SCORING input
          // because scoreBatter's thresholds were calibrated against it.
          barrelPct:    pf(p.brl_pa),
          // barrelPctBBE = barrels per batted-ball event (brl_percent) —
          // the STANDARD "Barrel%" everyone quotes (MLB median ~8%, elite
          // ~13%+). Used for DISPLAY + Heat Index so our numbers match
          // RudeBets / Savant / Baseball Reference. brl_pa is always lower
          // because walks + strikeouts sit in the denominator, which is
          // why Riley read 6.4% (brl_pa) when his real Barrel% is ~11.5%.
          barrelPctBBE: pf(p.brl_percent),
          whiffPct:     pf(p.whiff_percent),
          // NOTE: the percentile-rankings endpoint does NOT carry launch
          // angle (it's percentiles for xwOBA/EV/barrel/etc only), so
          // launch_angle_avg is virtually always absent here → null. We
          // backfill it from the statcast CSV leaderboard below. Without
          // that merge launchAngle was null for EVERY batter, which made
          // the Heat Index "LA in HR window" check impossible to pass and
          // capped everyone at 5/6.
          launchAngle:  pf(p.launch_angle_avg),
          pullPct:      pf(p.pull_percent),
          izContactPct: pf(p.iz_contact_percent),
          xSlg:         pf(p.xslg),
        };
      }
      if (Object.keys(out).length) {
        // Backfill launch angle AND hard-hit% from the statcast custom
        // leaderboard CSV. The percentile-rankings endpoint carries
        // `avg_hit_speed` (exitVelo) but NOT `avg_hit_angle` (launchAngle) and
        // NOT `hard_hit_percent` (hardHitPct) — those two were always null
        // here, which is why the calibration log showed `ev` ~45% covered but
        // `hh` 100% null in every row (the savant fields all reach the row
        // identically, so the gap had to be upstream in THIS fetch). The
        // statcast leaderboard CSV carries both columns (`avg_hit_angle`,
        // `hard_hit_percent`), so one cached call backfills both. Merges only
        // launchAngle + hardHitPct; leaves the percentile values otherwise intact.
        try {
          const laRows = await savantCSV(
            `https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${year}&position=&team=&min=q&csv=true`
          );
          for (const p of laRows) {
            const id = Number(p.player_id);
            if (!id || !out[id]) continue;
            if (out[id].launchAngle == null) out[id].launchAngle = pf(p.avg_hit_angle);
            // hard_hit_percent is the BATTER's hard-hit% (not the pitcher's
            // hardHitPctAllowed) — this is the field `hh` in the calibration
            // feature vector. Backfill only when the percentile pass left it null.
            if (out[id].hardHitPct == null) out[id].hardHitPct = pf(p.hard_hit_percent);
          }
        } catch { /* leaderboard backfill is best-effort */ }
        return out;
      }
    }
  } catch {}

  // Pass 2: CSV leaderboards (contact-quality + expected stats)
  try {
    const [statRows, xRows] = await Promise.all([
      savantCSV(`https://baseballsavant.mlb.com/leaderboard/statcast?type=batter&year=${year}&position=&team=&min=q&csv=true`),
      savantCSV(`https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${year}&position=&team=&min=q&csv=true`),
    ]);
    for (const p of statRows) {
      const id = Number(p.player_id);
      if (!id) continue;
      const pa       = parseFloat(p.pa)       || 1;
      const attempts = parseFloat(p.attempts) || pa;
      const whiffs   = parseFloat(p.whiffs)   || 0;
      const swings   = parseFloat(p.swing)    || 0;
      out[id] = {
        exitVelo:    pf(p.avg_hit_speed),
        hardHitPct:  p.hard_hit_percent ? pf(p.hard_hit_percent)
                   : p.hard_hit        ? (parseFloat(p.hard_hit) / attempts) * 100
                   : null,
        barrelPct:   p.brl_pa   ? pf(p.brl_pa)
                   : p.barreled ? (parseFloat(p.barreled) / pa) * 100
                   : null,
        // Standard Barrel% (barrels/BBE) — see note in pass 1. attempts is
        // the batted-ball-event count (falls back to PA when absent).
        barrelPctBBE: p.brl_percent ? pf(p.brl_percent)
                    : p.barreled    ? (parseFloat(p.barreled) / attempts) * 100
                    : null,
        // Column is avg_hit_angle on this endpoint (NOT avg_launch_angle —
        // that key doesn't exist here and silently returned null).
        launchAngle: pf(p.avg_hit_angle),
        whiffPct:    p.whiff_percent ? pf(p.whiff_percent)
                   : swings > 0     ? (whiffs / swings) * 100
                   : null,
        pullPct:     pf(p.pull_percent) ?? null,
        izContactPct: pf(p.iz_contact_percent) ?? null,
        xSlg:        null,
      };
    }
    for (const p of xRows) {
      const id  = Number(p.player_id);
      if (!id) continue;
      const xSlg = pf(p.est_slg);
      if (out[id]) {
        out[id].xSlg = xSlg;
      } else {
        out[id] = {
          exitVelo: null, hardHitPct: null, barrelPct: null,
          launchAngle: null, whiffPct: null, pullPct: null,
          izContactPct: null, xSlg,
        };
      }
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * League-wide Statcast BAT-TRACKING leaderboard (bat speed, blast rate,
 * squared-up rate). Separate endpoint from the contact-quality leaderboards.
 * "Blast" = a swing that's both fast AND squared-up — the most HR-predictive
 * slice of bat tracking. Returns { [playerId]: { batSpeed, blastPct,
 * blastPerContact, squaredUpPct, hardSwingPct, swingLength, swings } } with the
 * rate fields as 0-100 percentages. Best-effort: {} if Savant rate-limits.
 *
 * Pass { dateStart, dateEnd } for a recent window (sharps watch recent blast
 * rate — a bat blasting 40%+ over its last handful of games is a live power
 * signal). minSwings is the sample gate ('q' = season-qualified; a number for
 * windowed pulls where nobody qualifies yet).
 */
async function fetchSavantBatTracking(year = SEASON, { dateStart = '', dateEnd = '', minSwings = 'q', pitchHand = '', pitchType = '' } = {}) {
  const pf = v => (v != null && v !== '' ? parseFloat(v) : null);
  const pct = v => { const n = pf(v); return n == null ? null : n * 100; }; // fraction → %
  const out = {};
  try {
    const rows = await savantCSV(
      `https://baseballsavant.mlb.com/leaderboard/bat-tracking` +
      `?attackZone=&batSide=&contactType=&count=&dateStart=${dateStart}&dateEnd=${dateEnd}&gameType=&isHardHit=` +
      `&minSwings=${minSwings}&minGroupSwings=1&pitchHand=${pitchHand}&pitchType=${pitchType}&seasonStart=&seasonEnd=&team=` +
      `&type=batter&year=${year}&csv=true`
    );
    for (const p of rows) {
      const id = Number(p.id ?? p.player_id);
      if (!id) continue;
      out[id] = {
        batSpeed:       pf(p.avg_bat_speed),              // mph
        blastPct:       pct(p.blast_per_swing),           // blasts per competitive swing, %
        blastPerContact: pct(p.blast_per_bat_contact),    // blasts per bat-contact, %
        squaredUpPct:   pct(p.squared_up_per_swing),      // %
        hardSwingPct:   pct(p.hard_swing_rate),           // fast-swing rate, %
        swingLength:    pf(p.swing_length),               // ft
        swings:         pf(p.swings_competitive),         // sample size
      };
    }
  } catch { /* best-effort — model unaffected if bat tracking is unavailable */ }
  return out;
}

// Recent (~2wk) blast rate split by the PITCHER's hand — the matchup-relevant
// "how's he blasting vs LHP/RHP lately" cut. Returns { L: Map<id,%>, R: Map }
// of blasts-per-squared-up-contact with the swing sample, for the side that
// matches today's starter. Two calls; best-effort.
async function fetchBlastVsHand(year = SEASON, win = {}) {
  const mk = async (hand) => {
    const data = await fetchSavantBatTracking(year, { ...win, pitchHand: hand });
    const m = new Map();
    for (const [id, v] of Object.entries(data)) {
      if (Number.isFinite(v.blastPerContact)) m.set(Number(id), { blast: v.blastPerContact, swings: v.swings });
    }
    return m;
  };
  try {
    const [L, R] = await Promise.all([mk('L'), mk('R')]);
    return { L, R };
  } catch { return { L: new Map(), R: new Map() }; }
}

// Season blast rate per individual pitch type — so we can usage-weight a
// batter's blast vs the exact MIX today's starter throws (the "vs his mix"
// number sharps quote). Returns { [PITCH_CODE]: Map<id, blastPerContact%> }.
// Season (not recent) so each pitch-type slice has a usable sample.
const BLAST_PITCH_TYPES = ['FF', 'SI', 'FC', 'SL', 'CU', 'KC', 'CH', 'FS'];
// pitchMix usage keys (server pitcher block) → Savant pitch-type codes.
const PITCH_USAGE_KEY = { FF: 'ffPct', SI: 'siPct', FC: 'fcPct', SL: 'slPct', CU: 'cuPct', KC: 'kcPct', CH: 'chPct', FS: 'fsPct' };
// A batter's blast rate vs the exact mix a starter throws: usage-weighted blend
// of his per-pitch-type blast over the pitches the starter uses. coverage = the
// share of the starter's arsenal we actually have a blast number for (so a
// thin-sample read can be down-ranked / hidden).
function blastVsMix(id, pitchMix, blastByPitch) {
  if (!pitchMix || !blastByPitch) return null;
  let wsum = 0, bsum = 0, cov = 0, total = 0;
  for (const pt of BLAST_PITCH_TYPES) {
    const usage = pitchMix[PITCH_USAGE_KEY[pt]];
    if (!(usage > 0)) continue;
    total += usage;
    const b = blastByPitch[pt]?.get(id);
    if (Number.isFinite(b)) { wsum += usage; bsum += usage * b; cov += usage; }
  }
  if (wsum <= 0 || total <= 0) return null;
  return { blast: bsum / wsum, coverage: cov / total };
}
async function fetchBlastByPitchType(year = SEASON) {
  const out = {};
  try {
    const results = await Promise.all(
      BLAST_PITCH_TYPES.map(async (pt) => {
        const data = await fetchSavantBatTracking(year, { minSwings: 10, pitchType: pt });
        const m = new Map();
        for (const [id, v] of Object.entries(data)) {
          if (Number.isFinite(v.blastPerContact)) m.set(Number(id), v.blastPerContact);
        }
        return [pt, m];
      }),
    );
    for (const [pt, m] of results) out[pt] = m;
  } catch { /* best-effort */ }
  return out;
}

/**
 * League-wide Statcast contact-quality + zone data for all qualified pitchers.
 * Returns { [pitcherId]: { hardHitPctAllowed, barrelPctAllowed, ... } }.
 */
async function fetchSavantPitcherStats(year = SEASON) {
  const pf = v => (v != null && v !== '' ? parseFloat(v) : null);
  const out = {};

  // Pass 1: JSON percentile rankings
  try {
    const data = await savantGet(`https://baseballsavant.mlb.com/percentile-rankings?type=pitcher&year=${year}`);
    if (Array.isArray(data) && data.length) {
      for (const p of data) {
        if (!p.player_id) continue;
        out[Number(p.player_id)] = {
          hardHitPctAllowed: pf(p.hard_hit_percent),
          barrelPctAllowed:  pf(p.brl_pa),
          exitVeloAgainst:   pf(p.avg_hit_speed),
          whiffPct:          pf(p.whiff_percent),
          swStrPct:          pf(p.swstr_pct) ?? pf(p.swing_miss_pct) ?? null,
          zonePct:           pf(p.zone_percent),
          heartPct:          pf(p.meatball_percent) ?? pf(p.heart_percent),
          outZonePct:        pf(p.out_zone_percent),
          edgePct:           pf(p.edge_percent),
        };
      }
      if (Object.keys(out).length) return out;
    }
  } catch {}

  // Pass 2: CSV
  try {
    const rows = await savantCSV(
      `https://baseballsavant.mlb.com/leaderboard/statcast?type=pitcher&year=${year}&position=&team=&min=q&csv=true`
    );
    for (const p of rows) {
      const id = Number(p.player_id);
      if (!id) continue;
      const pa       = parseFloat(p.pa)       || 1;
      const attempts = parseFloat(p.attempts) || pa;
      out[id] = {
        // Hard Hit% on the statcast CSV is `ev95percent` (% of batted balls
        // >= 95 mph). There is NO `hard_hit_percent` column here, and the
        // pitcher percentile-rankings endpoint (pass 1) 404s, so this CSV path
        // runs and the old read was always null → "—" on the vuln card (and a
        // missing input to the vulnerability score).
        hardHitPctAllowed: pf(p.ev95percent)
                         ?? (p.hard_hit_percent ? pf(p.hard_hit_percent)
                         :   p.hard_hit         ? (parseFloat(p.hard_hit) / attempts) * 100
                         :   null),
        barrelPctAllowed:  p.brl_pa   ? pf(p.brl_pa)
                         : p.barreled ? (parseFloat(p.barreled) / pa) * 100
                         : null,
        exitVeloAgainst:   pf(p.avg_hit_speed),
        whiffPct:          pf(p.whiff_percent) ?? null,
        swStrPct:          pf(p.swstr_pct) ?? pf(p.swing_miss_pct) ?? null,
        zonePct:           pf(p.zone_percent)  ?? null,
        heartPct:          pf(p.meatball_percent) ?? pf(p.heart_percent) ?? null,
        outZonePct:        pf(p.out_zone_percent) ?? null,
        edgePct:           pf(p.edge_percent)     ?? null,
      };
    }
    return out;
  } catch {
    return out;
  }
}

// ─── Pitch arsenal helpers ───────────────────────────────────────────────────
// Savant's pitch-arsenal-stats CSV is LONG (one row per player per pitch type),
// so we group by player_id and pivot pitch_type into the wide per-pitch shape
// the snapshot consumers read. The old /pitch-arsenals HTML page only carries
// pitch MOVEMENT, not usage/results — reading ff_pct / ff_slg / ff_run_value off
// it returned null for every player, silently killing the whole pitch-matchup
// signal. pitch-arsenal-stats carries usage + run value + slg + whiff.
const ARSENAL_PT_KEY = { FF: 'ff', SI: 'si', FC: 'fc', SL: 'sl', CU: 'cu', KC: 'kc', CH: 'ch', FS: 'fs' };
const arsenalBucket = (pt) =>
  ['FF', 'SI', 'FC', 'FA'].includes(pt)               ? 'fastball'
  : ['CH', 'FS', 'FO', 'SC', 'KN', 'EP'].includes(pt) ? 'offspeed'
  : 'breaking'; // SL, CU, KC, ST (sweeper), SV (slurve), CS + other breakers
function groupByPlayerId(rows) {
  const m = new Map();
  for (const r of rows) {
    const id = Number(r.player_id);
    if (!id) continue;
    if (!m.has(id)) m.set(id, []);
    m.get(id).push(r);
  }
  return m;
}

/**
 * Pitcher pitch arsenal usage + run values + per-pitch shape from Savant.
 * Returns { [pitcherId]: PitchMix } — matches MLBService.getSavantPitcherPitchMix.
 *
 * Usage + run values come from the pitch-arsenal-stats CSV. Pitch movement
 * (speed/spin/break) is merged from the /pitch-arsenals HTML page, which still
 * carries shape even though it lacks usage/results.
 */
async function fetchSavantPitcherPitchMix(year = SEASON) {
  const out = {};
  const whiffByPlayer = new Map();
  try {
    const rows = await savantCSV(
      `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=pitcher&pitchType=&year=${year}&team=&min=10&csv=true`
    );
    if (!rows.length) return out;
    const pf = (v) => (v != null && v !== '' ? parseFloat(v) : null);

    for (const [id, prs] of groupByPlayerId(rows)) {
      const pct = {}, rv100 = {}, whiff = {};
      let fastballPct = 0, breakingPct = 0, offspeedPct = 0;
      let rvNum = 0, rvDen = 0;
      const all = [];
      for (const r of prs) {
        const pt    = (r.pitch_type || '').toUpperCase();
        const usage = pf(r.pitch_usage) ?? 0;   // season usage %
        const rv    = pf(r.run_value_per_100);   // + = good for the batter
        const key = ARSENAL_PT_KEY[pt];
        if (key) { pct[key] = usage; rv100[key] = rv; whiff[key] = pf(r.whiff_percent); }
        const bucket = arsenalBucket(pt);
        if      (bucket === 'fastball') fastballPct += usage;
        else if (bucket === 'breaking') breakingPct += usage;
        else                            offspeedPct += usage;
        if (rv != null) { rvNum += rv * usage; rvDen += usage; }
        all.push({ name: r.pitch_name || pt, rv, usage });
      }
      whiffByPlayer.set(id, whiff);
      // Worst pitch = highest run value allowed among pitches thrown 5%+.
      const ranked = all.filter(p => p.rv != null && p.usage >= 5).sort((a, b) => b.rv - a.rv);
      const worstPitch = ranked.length ? { name: ranked[0].name, rv: ranked[0].rv } : null;
      const wAvg = (ks) => {
        let n = 0, d = 0;
        for (const k of ks) { if (rv100[k] != null && pct[k]) { n += rv100[k] * pct[k]; d += pct[k]; } }
        return d ? n / d : null;
      };

      out[id] = {
        fastballPct, breakingPct, offspeedPct,
        ffPct: pct.ff ?? 0, siPct: pct.si ?? 0, fcPct: pct.fc ?? 0, slPct: pct.sl ?? 0,
        cuPct: pct.cu ?? 0, kcPct: pct.kc ?? 0, chPct: pct.ch ?? 0, fsPct: pct.fs ?? 0,
        fastballRunVal: wAvg(['ff', 'si', 'fc']),
        breakingRunVal: wAvg(['sl', 'cu', 'kc']),
        offspeedRunVal: wAvg(['ch', 'fs']),
        totalRunVal: rvDen ? rvNum / rvDen : 0,
        worstPitch,
        shape: null,
      };
    }

    // Merge pitch movement (speed/spin/break) from the HTML arsenal page.
    try {
      const moveData = await savantGetEmbedded(`https://baseballsavant.mlb.com/pitch-arsenals?year=${year}&min=1&type=pitcher`);
      if (Array.isArray(moveData)) {
        for (const p of moveData) {
          const id = Number(p.pitcher ?? p.player_id);
          if (!id || !out[id]) continue;
          const o  = out[id];
          const wh = whiffByPlayer.get(id) || {};
          const mk = (k) => ({
            pct:     o[`${k}Pct`] ?? 0,
            speed:   pf(p[`${k}_avg_speed`]),
            spin:    pf(p[`${k}_avg_spin`]),
            breakX:  pf(p[`${k}_avg_break_x`]),
            breakZ:  pf(p[`${k}_avg_break_z`]),
            whiff:   wh[k] ?? null,
            putAway: null,
          });
          o.shape = { ff: mk('ff'), si: mk('si'), fc: mk('fc'), sl: mk('sl'), cu: mk('cu'), kc: mk('kc'), ch: mk('ch'), fs: mk('fs') };
        }
      }
    } catch {}

    return out;
  } catch {
    return out;
  }
}

/**
 * Pitcher expected stats (xERA, xwOBA) from Savant.
 * Returns { [pitcherId]: { xEra, xwOba } }.
 */
async function fetchPitcherExpectedStats(year = SEASON) {
  const out = {};
  try {
    const rows = await savantCSV(
      `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=pitcher` +
      `&year=${year}&position=&team=&min=q&csv=true`
    );
    const pf = v => (v != null && v !== '' ? parseFloat(v) : null);
    for (const p of rows) {
      const id = Number(p.player_id);
      if (!id) continue;
      out[id] = { xEra: pf(p.est_era), xwOba: pf(p.est_woba) };
    }
    return out;
  } catch {
    return out;
  }
}

/**
 * Per-batter performance per pitch type (SLG, run-value, whiff% by pitch).
 * Returns { [batterId]: BatterArsenal } — matches getSavantBatterPitchPerf.
 *
 * Sourced from the pitch-arsenal-stats CSV (type=batter): one row per pitch
 * type, grouped + pivoted into the wide shape. (The old /pitch-arsenals page
 * ignores type=batter and just returns pitcher movement, so every result field
 * came back null.)
 */
async function fetchSavantBatterPitchPerf(year = SEASON) {
  const out = {};
  try {
    const rows = await savantCSV(
      `https://baseballsavant.mlb.com/leaderboard/pitch-arsenal-stats?type=batter&pitchType=&year=${year}&team=&min=10&csv=true`
    );
    if (!rows.length) return out;
    const pf = (v) => (v != null && v !== '' ? parseFloat(v) : null);
    const avg = (...vals) => {
      const xs = vals.filter(v => v != null);
      return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
    };

    for (const [id, prs] of groupByPlayerId(rows)) {
      const slg = {}, rv = {}, whiff = {};
      const all = [];
      for (const r of prs) {
        const pt  = (r.pitch_type || '').toUpperCase();
        const key = ARSENAL_PT_KEY[pt];
        const sg  = pf(r.slg), rvv = pf(r.run_value_per_100), wh = pf(r.whiff_percent), us = pf(r.pitch_usage) ?? 0;
        if (key) { slg[key] = sg; rv[key] = rvv; whiff[key] = wh; }
        all.push({ name: r.pitch_name || pt, slg: sg, rv: rvv, usage: us });
      }
      // Best/worst pitch for the batter by SLG among pitches seen 8%+ of the time.
      const seen = all.filter(p => p.slg != null && p.usage >= 8);
      const pick = (cmp) => { const x = [...seen].sort(cmp)[0]; return { name: x.name, slg: x.slg, rv: x.rv }; };
      const bestPitch  = seen.length ? pick((a, b) => b.slg - a.slg) : null;
      const worstPitch = seen.length ? pick((a, b) => a.slg - b.slg) : null;

      out[id] = {
        fastballSlg: avg(slg.ff, slg.si, slg.fc),
        breakingSlg: avg(slg.sl, slg.cu, slg.kc),
        offspeedSlg: avg(slg.ch, slg.fs),
        fastballRV:  avg(rv.ff, rv.si, rv.fc),
        breakingRV:  avg(rv.sl, rv.cu, rv.kc),
        offspeedRV:  avg(rv.ch, rv.fs),
        ffSlg: slg.ff ?? null, siSlg: slg.si ?? null, fcSlg: slg.fc ?? null, slSlg: slg.sl ?? null,
        cuSlg: slg.cu ?? null, kcSlg: slg.kc ?? null, chSlg: slg.ch ?? null, fsSlg: slg.fs ?? null,
        ffRV: rv.ff ?? null, siRV: rv.si ?? null, fcRV: rv.fc ?? null, slRV: rv.sl ?? null,
        cuRV: rv.cu ?? null, kcRV: rv.kc ?? null, chRV: rv.ch ?? null, fsRV: rv.fs ?? null,
        ffWhiff: whiff.ff ?? null, siWhiff: whiff.si ?? null, fcWhiff: whiff.fc ?? null, slWhiff: whiff.sl ?? null,
        cuWhiff: whiff.cu ?? null, kcWhiff: whiff.kc ?? null, chWhiff: whiff.ch ?? null, fsWhiff: whiff.fs ?? null,
        bestPitch,
        worstPitch,
      };
    }
    return out;
  } catch {
    return out;
  }
}

// ─── Batter lastXGames windows (30 / 7) ──────────────────────────────────────

/**
 * Batch fetch 30-game hitting stats. Returns { [playerId]: parseStat shape }.
 */
async function fetchBatterStats30Game(playerIds) {
  if (!playerIds.length) return {};
  const out = {};
  const chunks = [];
  for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
  await Promise.all(chunks.map(async chunk => {
    try {
      const ids  = chunk.join(',');
      const data = await mlbGet(
        `/people?personIds=${ids}` +
        `&hydrate=stats(group=[hitting],type=[lastXGames],season=${SEASON},gameType=[R],limit=30)`
      );
      for (const person of data.people || []) {
        const statGroup = (person.stats || []).find(
          s => s.type?.displayName?.toLowerCase() === 'lastxgames'
        );
        const splits = statGroup?.splits || [];
        if (!splits.length) continue;
        out[person.id] = parseStat(splits[splits.length - 1].stat);
      }
    } catch {}
  }));
  return out;
}

/**
 * Batch fetch 7-game hitting stats. Returns { [playerId]: parseStat shape }.
 */
async function fetchBatterStats7Game(playerIds) {
  if (!playerIds.length) return {};
  const out = {};
  const chunks = [];
  for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
  await Promise.all(chunks.map(async chunk => {
    try {
      const ids  = chunk.join(',');
      const data = await mlbGet(
        `/people?personIds=${ids}` +
        `&hydrate=stats(group=[hitting],type=[lastXGames],season=${SEASON},gameType=[R],limit=7)`
      );
      for (const person of data.people || []) {
        const statGroup = (person.stats || []).find(
          s => s.type?.displayName?.toLowerCase() === 'lastxgames'
        );
        const splits = statGroup?.splits || [];
        if (!splits.length) continue;
        out[person.id] = parseStat(splits[splits.length - 1].stat);
      }
    } catch {}
  }));
  return out;
}

/**
 * Consecutive-game HR streak per batter.
 *
 * "HR streak" = how many of a batter's MOST RECENT games had >= 1 home run,
 * counted back from his last game until the first gap. This is the literal
 * streak — NOT "how many HR in the last 7 days." 0 = didn't homer in his last
 * game; 2 = back-to-back HR games; etc.
 *
 * Uses type=gameLog, the only stat type that returns true per-game splits
 * (lastXGames only returns aggregates). gameLog splits come back chronological
 * (oldest -> newest), so we walk from the end. Batched like the other
 * people-stat fetches; limit=10 comfortably covers any real streak (the MLB
 * record for consecutive games with a HR is 8).
 */
async function fetchBatterHrStreak(playerIds) {
  if (!playerIds.length) return {};
  const out = {};
  const chunks = [];
  for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
  await Promise.all(chunks.map(async chunk => {
    try {
      const ids  = chunk.join(',');
      const data = await mlbGet(
        `/people?personIds=${ids}` +
        `&hydrate=stats(group=[hitting],type=[gameLog],season=${SEASON},gameType=[R],limit=10)`
      );
      for (const person of data.people || []) {
        const sg = (person.stats || []).find(
          s => s.type?.displayName?.toLowerCase() === 'gamelog'
        );
        const splits = sg?.splits || [];
        let streak = 0;
        // Splits are oldest -> newest; count consecutive most-recent games
        // with a HR, stopping at the first game with none.
        for (let i = splits.length - 1; i >= 0; i--) {
          const hr = +(splits[i]?.stat?.homeRuns) || 0;
          if (hr >= 1) streak++;
          else break;
        }
        out[person.id] = streak;
      }
    } catch {}
  }));
  return out;
}

// ─── Batter situational splits (day/night, home/away, sp/rp) ─────────────────

async function fetchDayNightSplitsBatch(playerIds) {
  if (!playerIds.length) return {};
  const out = {};
  const chunks = [];
  for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
  await Promise.all(chunks.map(async chunk => {
    try {
      const ids  = chunk.join(',');
      const data = await mlbGet(
        `/people?personIds=${ids}` +
        `&hydrate=stats(group=[hitting],type=[statSplits],sitCodes=[d,n],season=${SEASON},gameType=[R])`
      );
      for (const person of data.people || []) {
        const statGroup = (person.stats || []).find(
          s => s.type?.displayName?.toLowerCase().includes('split')
        );
        if (!statGroup) continue;
        let day = null, night = null;
        for (const s of statGroup.splits || []) {
          const code = s.split?.code;
          const p = parseStat(s.stat);
          if (code === 'd') day   = p;
          if (code === 'n') night = p;
        }
        if (day || night) {
          out[person.id] = {
            dayISO:    day?.iso    ?? null,
            nightISO:  night?.iso  ?? null,
            dayHRRate: day?.hrRate ?? null,
            nightHRRate: night?.hrRate ?? null,
            dayAB:    day?.ab     ?? 0,
            nightAB:  night?.ab   ?? 0,
          };
        }
      }
    } catch {}
  }));
  return out;
}

async function fetchHomeAwaySplitsBatch(playerIds) {
  if (!playerIds.length) return {};
  const out = {};
  const chunks = [];
  for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
  await Promise.all(chunks.map(async chunk => {
    try {
      const ids  = chunk.join(',');
      const data = await mlbGet(
        `/people?personIds=${ids}` +
        `&hydrate=stats(group=[hitting],type=[statSplits],sitCodes=[h,a],season=${SEASON},gameType=[R])`
      );
      for (const person of data.people || []) {
        const statGroup = (person.stats || []).find(
          s => s.type?.displayName?.toLowerCase().includes('split')
        );
        if (!statGroup) continue;
        let home = null, away = null;
        for (const s of statGroup.splits || []) {
          const code = s.split?.code;
          const p = parseStat(s.stat);
          if (code === 'h') home = p;
          if (code === 'a') away = p;
        }
        if (home || away) {
          out[person.id] = {
            homeISO: home?.iso ?? null,
            awayISO: away?.iso ?? null,
            homeAB:  home?.ab  ?? 0,
            awayAB:  away?.ab  ?? 0,
          };
        }
      }
    } catch {}
  }));
  return out;
}

/**
 * Batter splits vs starters (sp) and relievers (rp) — used to flag
 * "Bullpen Legend" hitters. Returns { [playerId]: { spAb, spHr, ..., bullpenLegend } }.
 */
/**
 * Fetch the home-plate umpire for each game from the boxscore endpoint.
 * Returns a Map<gamePk, { id, name }> — empty entry when the umpire
 * isn't announced yet (game far in advance, ump assignments come ~24h
 * before first pitch).
 *
 * Used to apply per-umpire HR multipliers via umpireHrFactor(name). The
 * multiplier table lives in src/sports/mlb/data/umpire-factors.json
 * and is neutral 1.0 by default until populated with real data.
 */
async function fetchHomePlateUmpires(games) {
  const out = new Map();
  if (!games?.length) return out;
  await pMap(games, async (g) => {
    if (!g?.gamePk) return;
    try {
      const bs = await mlbGet(`/game/${g.gamePk}/boxscore`);
      const hp = (bs?.officials || []).find(o => o?.officialType === 'Home Plate');
      if (hp?.official?.fullName) {
        out.set(g.gamePk, { id: hp.official.id, name: hp.official.fullName });
      }
    } catch {}
  }, 6);
  return out;
}

async function fetchBullpenSplitsBatch(playerIds) {
  if (!playerIds.length) return {};
  const out = {};
  const chunks = [];
  for (let i = 0; i < playerIds.length; i += 50) chunks.push(playerIds.slice(i, i + 50));
  await Promise.all(chunks.map(async chunk => {
    try {
      const ids  = chunk.join(',');
      const data = await mlbGet(
        `/people?personIds=${ids}` +
        `&hydrate=stats(group=[hitting],type=[statSplits],sitCodes=[sp,rp],season=${SEASON},gameType=[R])`
      );
      for (const person of data.people || []) {
        const statGroup = (person.stats || []).find(
          s => s.type?.displayName?.toLowerCase().includes('split')
        );
        if (!statGroup) continue;
        let sp = null, rp = null;
        for (const s of statGroup.splits || []) {
          const code = s.split?.code;
          const p = parseStat(s.stat);
          if (code === 'sp') sp = p;
          if (code === 'rp') rp = p;
        }
        if (!sp && !rp) continue;

        const spAb     = sp?.ab ?? 0;
        const spHr     = sp?.hr ?? 0;
        const spHrRate = spAb > 0 ? spHr / spAb : 0;
        const rpAb     = rp?.ab ?? 0;
        const rpHr     = rp?.hr ?? 0;
        const rpHrRate = rpAb > 0 ? rpHr / rpAb : 0;

        const hasSample      = rpAb >= 30 && rpHr >= 3;
        const elevatedRate   = rpHrRate >= 0.055 && (spHrRate === 0 || rpHrRate >= spHrRate * 1.35);
        const eliteAbsolute  = rpHrRate >= 0.075;
        const bullpenLegend  = hasSample && (elevatedRate || eliteAbsolute);
        const bullpenRatio   = spHrRate > 0 ? rpHrRate / spHrRate : null;

        out[person.id] = {
          spAb, spHr, spHrRate, spIso: sp?.iso ?? null,
          rpAb, rpHr, rpHrRate, rpIso: rp?.iso ?? null,
          bullpenLegend,
          bullpenRatio,
        };
      }
    } catch {}
  }));
  return out;
}


// ─── Weather ─────────────────────────────────────────────────────────────────
//
// All weather fetching moved into `./weather.mjs` (NWS client).
// Snapshot shape published here: see the Weather + WeatherHour typedefs at
// the top of this file.
//
// Provider rationale, why we dropped the MLB live-feed override, and what
// the headline vs hours[] split is for — all in weather.mjs's header.

/**
 * Detect roof state at a retractable-stadium game by querying MLB's live
 * feed for `weather.condition`. MLB publishes the literal string
 * "Roof Closed" when the roof is closed (verified on Chase Field, Rogers
 * Centre, loanDepot park as of 2026 season). Anything else (sunny,
 * partly cloudy, drizzle, etc.) means the roof is open and outdoor
 * weather actually applies.
 *
 * Returns:
 *   true   — roof confirmed closed (use indoor air-density defaults)
 *   false  — roof confirmed open (use the snapshot's outdoor weather)
 *   null   — couldn't determine (live feed empty / fetch failed); caller
 *            treats null conservatively as "assume closed"
 *
 * Only call for retractable stadiums — Fixed Dome is always closed (no
 * need to check) and Open parks have no roof (waste of a request).
 */
async function fetchRoofState(gamePk) {
  if (!gamePk) return null;
  try {
    const data = await getJson(`${MLB_V11}/game/${gamePk}/feed/live`);
    const cond = data?.gameData?.weather?.condition || '';
    if (!cond) return null;
    const c = cond.toLowerCase();
    if (c.includes('roof closed') || c === 'dome') return true;
    // Anything else — actual weather words like sunny / cloudy / rain
    // — means MLB is reporting outdoor conditions, so the roof is open.
    return false;
  } catch {
    return null;
  }
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

// Public R2 URL the HRSauce cron publishes the snapshot to. Read back at
// startup by the calibration loop (yesterday's snapshot → reconcile).
const R2_PUBLIC_BASE  = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev';
const SNAPSHOT_URL    = `${R2_PUBLIC_BASE}/daily.json`;
const CALIBRATION_URL = `${R2_PUBLIC_BASE}/calibration.json`;
const BACKTEST_URL    = `${R2_PUBLIC_BASE}/backtest-log.json`;
const ZONE_CACHE_URL  = `${R2_PUBLIC_BASE}/zone-cache.json`;

/**
 * Pull a JSON artifact from R2's public bucket. Used to seed today's run
 * with yesterday's calibration multipliers + backtest log so the cron's
 * pipeline is stateless (state lives in R2, not the runner). Returns null
 * on any failure — caller is responsible for treating that as the
 * boot-strap "no prior state" case.
 */
async function fetchFromR2(url) {
  try {
    const res = await fetch(`${url}?t=${Date.now()}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/**
 * Compute YYYY-MM-DD for `daysBack` days ago, anchored to the operating zone
 * (SLATE_TZ). Matches todayInTZ() so calibration log dates and snapshot dates
 * line up exactly.
 */
function ctDateMinusDays(daysBack) {
  const d = new Date(Date.now() - daysBack * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: SLATE_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

async function main() {
  const startedAt = new Date();
  const date      = todayInTZ(); // operating day (SLATE_TZ = Eastern → rolls at 12 AM ET)
  // Print BOTH wall-clock UTC and resolved CT date so when the cron logs
  // are reviewed we can immediately see if the day boundary calculation
  // matches expectations — without this, debugging stale snapshots
  // (snapshot.date === yesterday) requires re-running the script locally.
  console.log(`[slate] generating ${date} (UTC ${startedAt.toISOString()})`);

  // ── Calibration: read prior multipliers + log, reconcile yesterday ─────
  //
  // The server-side calibration loop. We pull yesterday's calibration.json
  // and backtest-log.json from R2, optionally reconcile yesterday's
  // predictions against MLB outcomes, recompute multipliers from the
  // rolling 30-day log, and hydrate the bundled model with the result
  // BEFORE the scoring loop runs.
  //
  // We fetch yesterday's snapshot directly here, date-matched to yesterday.
  // The calibration use case NEEDS yesterday's snapshot to reconcile
  // predictions against outcomes — an earlier shared fetch that gated on
  // date === today silently returned null on the first cron of each day, so
  // reconciliation never fired and the backtest log stayed empty for weeks.
  // Verified Oct 2025.
  let backtestLog = (await fetchFromR2(BACKTEST_URL)) || { dates: [], records: {} };

  // The combo scorecard (log.combos) only persists in the GitHub Actions cache
  // of the local dist file — R2 never gets it written back, so loading from R2
  // alone silently drops the combo history every run (scorecard stuck at 0-1
  // days). The Actions cache restores the prior run's dist/backtest-log.json
  // before this runs, so merge its combos back in. Defensive: if the local file
  // has more reconciled dates, use it as the base; always union the combo log.
  try {
    if (existsSync(BACKTEST_OUT_PATH)) {
      const local = JSON.parse(readFileSync(BACKTEST_OUT_PATH, 'utf8'));
      if ((local?.dates?.length || 0) > (backtestLog?.dates?.length || 0)) backtestLog = local;
      const lc = local?.combos, bc = backtestLog?.combos;
      if (lc?.byDate || bc?.byDate || lc?.lateByDate || bc?.lateByDate || lc?.windowsByDate || bc?.windowsByDate || lc?.fullByDate || bc?.fullByDate || lc?.sgpByDate || bc?.sgpByDate) {
        backtestLog.combos = {
          byDate:        { ...(bc?.byDate || {}),        ...(lc?.byDate || {}) },
          bestByDate:    { ...(bc?.bestByDate || {}),    ...(lc?.bestByDate || {}) },
          lateByDate:    { ...(bc?.lateByDate || {}),    ...(lc?.lateByDate || {}) },
          windowsByDate: { ...(bc?.windowsByDate || {}), ...(lc?.windowsByDate || {}) },
          fullByDate:    { ...(bc?.fullByDate || {}),    ...(lc?.fullByDate || {}) },
          sgpByDate:     { ...(bc?.sgpByDate || {}),     ...(lc?.sgpByDate || {}) },
        };
      }
    }
  } catch (e) {
    console.warn(`[combo] local backtest merge skipped: ${e?.message}`);
  }

  const yesterdayCT = ctDateMinusDays(1);
  let reconcilePredictions = null;
  let calibSnapshot = null;
  // The latest published snapshot (today's earlier cron, or yesterday's on the
  // day's first run). Reused by the weather carry-forward below, which needs
  // today's prior weatherByGame when a fresh fetch returns nothing. Declared at
  // function scope so that block can read it — it previously referenced an
  // UNDECLARED `priorSnapshot`, which threw ReferenceError and crashed the whole
  // slate on the exact weather-outage path the carry-forward exists to rescue.
  let priorSnapshot = null;
  try {
    const res = await fetch(`${SNAPSHOT_URL}?t=${Date.now()}`);
    if (res.ok) {
      const prior = await res.json();
      priorSnapshot = prior; // keep regardless of date — weather carry-forward wants today's
      // Accept ONLY yesterday's snapshot for RECONCILE — today's would mean an
      // earlier cron already overwrote yesterday's data on R2 and we lost the
      // reconciliation window (handled gracefully below: skip without log
      // append, calibration just keeps yesterday's multipliers).
      if (prior?.date === yesterdayCT) calibSnapshot = prior;
      else console.log(`[calib] prior snapshot is ${prior?.date} — needed ${yesterdayCT}, skipping reconcile this run`);
    }
  } catch (e) {
    console.warn(`[calib] snapshot fetch for reconcile failed: ${e?.message}`);
  }

  let comboRows = [];
  if (calibSnapshot?.scoredBatters) {
    // Snapshot stores both composite (`${id}-${gamePk}`) AND legacy (`${id}`)
    // keys for back-compat — dedupe to composite-only so we don't double-
    // count each batter in the calibration sample.
    const seen = new Set();
    reconcilePredictions = [];
    for (const [key, row] of Object.entries(calibSnapshot.scoredBatters)) {
      if (!key.includes('-')) continue;     // skip legacy id-only keys
      if (!row || !Number.isFinite(row.score)) continue;
      const dedup = `${row.playerId}-${row.gamePk}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);
      reconcilePredictions.push(extractPredictionRecord(row));
      // Same frozen rows feed the pregame combo scorecard (graded below).
      const cr = comboRowFromSnapshot(row);
      if (cr) comboRows.push(cr);
    }
    console.log(`[calib] found ${reconcilePredictions.length} yesterday-predictions to reconcile`);
  }
  // Fetch yesterday's HR outcomes ONCE and share them between the per-batter
  // reconcile and the combo scorecard (avoids a second box-score sweep).
  let yesterdayOutcomes = null;
  if (reconcilePredictions?.length) {
    yesterdayOutcomes = await fetchHomerersForDate(yesterdayCT);
  }
  // Anti-regression guard: remember how many reconciled dates we STARTED with
  // (after restoring R2 + the Actions-cache local file). reconcile/repair/append
  // only ever add or hold (the 30-day trim swaps oldest-for-newest), so the final
  // log must have >= this many dates. Fewer ⇒ data was lost this run; we refuse to
  // overwrite below this at write time so a bad run can't shrink the cached log.
  const restoredLogDates = backtestLog?.dates?.length || 0;
  backtestLog = await reconcileDate(yesterdayCT, reconcilePredictions, backtestLog, yesterdayOutcomes);
  // Self-heal late-game / transient misses on recent days — a PRIME pick whose
  // HR landed in a late west-coast game after this date was first reconciled
  // would otherwise stay logged as a miss forever, deflating measured accuracy.
  // Monotonic false→true correction; days with all games Final are skipped.
  // Scans ALL still-unsettled dates in the window (capped ~7) so a suspended
  // game that keeps a date open past the old 3-day tail still gets its late HR
  // upgraded instead of frozen as a permanent miss.
  backtestLog = await repairRecentDays(backtestLog, 7);

  // Combo scorecard — grade yesterday's canonical PREGAME combos (one per
  // strategy per size, off the same frozen snapshot the per-batter reconcile
  // used) against actual HR outcomes, and roll them into the embedded combo log.
  // Idempotent per date; only logs once yesterday's slate is fully Final so a
  // late west-coast game in progress can't freeze a half-day as all-miss.
  try {
    if (comboRows.length && yesterdayOutcomes?.allFinal && !backtestLog?.combos?.byDate?.[yesterdayCT]) {
      const graded = gradeCombos(buildComboRecords(comboRows), yesterdayOutcomes.homerers);
      const best = bestAvailableCombo(comboRows, yesterdayOutcomes.homerers);
      backtestLog = appendComboDay(backtestLog, yesterdayCT, graded, best);
      const hit = graded.filter((c) => c.allHit).length;
      console.log(`[combo] graded ${graded.length} pregame combos for ${yesterdayCT} — ${hit} cashed · best available ${best.n}/${best.n}`);
    }
  } catch (e) {
    console.warn(`[combo] scorecard skipped: ${e?.message}`);
  }

  // Self-heal: backfill any recent day whose full board was captured live
  // (combos.fullByDate) but never graded into byDate — e.g. the one-shot
  // next-day grading above missed it because a late west-coast game wasn't Final
  // at the rollover, and by the next run the frozen snapshot had moved on. Grades
  // the persisted full board against that day's actual HRs. Keeps the scorecard
  // + Results Full board from silently dropping a day.
  try {
    const recent = [...new Set([...(backtestLog.dates || [])])].sort().slice(-4);
    for (const dd of recent) {
      if (dd === yesterdayCT) continue; // just handled above
      if (backtestLog?.combos?.byDate?.[dd]) continue;
      const fb = backtestLog?.combos?.fullByDate?.[dd];
      if (!fb?.length) continue;
      const out = await fetchHomerersForDate(dd);
      if (!out?.allFinal) continue;
      backtestLog = appendComboDay(backtestLog, dd, gradeCombos(fb, out.homerers), null);
      console.log(`[combo] self-healed ${dd} full board from fullByDate (${fb.length} combos)`);
    }
  } catch (e) {
    console.warn(`[combo] self-heal skipped: ${e?.message}`);
  }

  const calibration = computeMultipliers(backtestLog);
  console.log(`[calib] multipliers — samples:${calibration.samples} ready:${calibration.ready === true} badges:${Object.keys(calibration.badges).length} grades:${Object.keys(calibration.grades).length}`);
  setActiveCalibration(calibration);

  // ─── Isotonic score→prob calibration + log-loss / Brier metrics ──────────
  // Tier 1 math: fit a monotonic score-bucket-to-hit-rate table from the
  // rolling 30-day backtest log. This becomes the canonical mapping every
  // downstream consumer uses for "what's the actual HR probability at
  // this score" — replaces the rough `0.025 + score*0.0015` approximation
  // we were using everywhere. Also computes Brier + log-loss so the
  // ModelPerformance screen can show whether the model is actually
  // beating naive baselines week over week.
  let scoreToProbTable = null;
  let modelMetrics     = null;
  try {
    // Bucket width is CV-SELECTED each run (fitIsotonicAdaptive) instead of a
    // hardcoded 15. The old 15 came from an offline CV that ran on a log whose
    // pre-game scores had drifted (live-decay/Final freeze bug — since fixed),
    // which biased the choice coarse and pinned the top-bucket ceiling low. The
    // selector starts at 15 and only goes finer when it measurably improves
    // 5-fold Brier on the now-clean log, lifting the ceiling for the genuinely
    // hot top band. See server/tools/model-metrics.mjs.
    scoreToProbTable = fitIsotonicAdaptive(backtestLog, { lookbackDays: 30 });
    console.log(`[calib] isotonic — totalN:${scoreToProbTable.totalN} buckets:${scoreToProbTable.table?.length} bucketSize:${scoreToProbTable.bucketSize} adaptive:${scoreToProbTable.adaptive === true}` +
      (Array.isArray(scoreToProbTable.cv) ? ` cv:[${scoreToProbTable.cv.map(c => `${c.bucketSize}:${c.brier.toFixed(4)}`).join(' ')}]` : ''));
  } catch (e) {
    console.warn(`[calib] isotonic fit failed: ${e?.message}`);
  }
  try {
    // Use the just-fit isotonic table for the metric prob conversion. Falls
    // back to the rough linear scoreToProb when the table is sparse/missing.
    const probFn = (s) => lookupProb(s, scoreToProbTable?.table, (sc) => Math.max(0.005, Math.min(0.30, sc / 100 * 0.28)));
    modelMetrics = computeMetricsFromBacktest(backtestLog, { lookbackDays: 30, scoreToProbFn: probFn });
    if (modelMetrics) {
      // The Brier/logLoss just computed are IN-SAMPLE — scored on the very rows
      // the isotonic table was fit on, so they read optimistically. Attach the
      // honest out-of-sample 5-fold CV Brier (at the chosen bucket) so skill is
      // judged week-over-week on an OOS number, not the flattering in-sample one.
      const chosenCv = Array.isArray(scoreToProbTable?.cv)
        ? scoreToProbTable.cv.find(c => c.bucketSize === scoreToProbTable.bucketSize)
        : null;
      modelMetrics.inSample = true;
      modelMetrics.cvBrier  = Number.isFinite(chosenCv?.brier) ? +chosenCv.brier.toFixed(4) : null;
      // Empirical base HR rate over the reconciled window (played records only).
      // The logged set is the displayed top-N batters, whose base rate (~12%) is
      // far above the league per-PA rate, so the old hardcoded 0.035 made the
      // Brier/log-loss skill scores meaningless. Benchmark against the set's own
      // base rate: "could you beat always predicting the base rate?"
      let baseRate = 0.035;
      try {
        const recs = (backtestLog?.dates || [])
          .flatMap(d => backtestLog?.records?.[d] || [])
          .filter(r => r.actuallyPlayed !== false && r.homered != null);
        if (recs.length >= 100) baseRate = recs.filter(r => r.homered).length / recs.length;
      } catch {}
      modelMetrics.baseRate        = baseRate;
      modelMetrics.baselineBrier   = baselineBrierForRate(baseRate);
      modelMetrics.baselineLogLoss = baselineLogLossForRate(baseRate);
      console.log(`[calib] metrics — brier:${modelMetrics.brier?.toFixed(4)} logLoss:${modelMetrics.logLoss?.toFixed(4)} n:${modelMetrics.totalReconciled}`);
    }
  } catch (e) {
    console.warn(`[calib] metrics compute failed: ${e?.message}`);
  }

  // ─── ML stacker training (Phase 3 inference) ─────────────────────────────
  // Train a logistic-regression stacker on the backtest log every cron run.
  // Inputs are the rule model's existing sub-scores + badges + grade — so
  // this is a "meta-model" that learns the right weighting of signals the
  // rule scorer already produces. Output weights land in
  // dist/ensemble-weights.json which scoreWithML reads at inference time.
  // Trains in <100ms on 1000+ records — pure-JS gradient descent, zero deps.
  try {
    const trained = trainEnsembleWeights(backtestLog, { lookbackDays: 30 });
    writeFileSync(`${process.cwd()}/dist/ensemble-weights.json`, JSON.stringify(trained, null, 2));
    console.log(`[ml] trained weights — n:${trained.trainedOn} brier:${trained.brier.toFixed(4)} logLoss:${trained.logLoss.toFixed(4)} intercept:${trained.intercept.toFixed(3)}`);
  } catch (e) {
    console.warn(`[ml] training failed: ${e?.message}`);
  }

  // ─── Ensemble HOLDOUT gate ───────────────────────────────────────────────
  // The stacker above is trained on the full window for inference, but to
  // decide HOW MUCH to trust it we evaluate it OUT-OF-SAMPLE: train a model on
  // the older days only, then measure Brier on the most recent (held-out) days
  // for BOTH the rule prob (isotonic score→prob) and the ML prob. The ML earns
  // blend weight ONLY if it beats the rule model on a sufficient holdout, and
  // even then it's capped conservatively. With thin data the gate stays at
  // ml=0 (pure rule) and auto-ramps as the backtest log grows — so making the
  // ensemble "canonical" can never hurt accuracy on unproven data.
  let ensembleMeta = { mlWeight: 0, ruleHoldoutBrier: null, mlHoldoutBrier: null, holdoutN: 0, trainN: 0, reason: 'init' };
  try {
    const HOLDOUT_DAYS = 5, MIN_HOLDOUT = 400, MIN_TRAIN_DAYS = 3;
    const sortedDates = (backtestLog?.dates || []).slice().sort();
    if (sortedDates.length >= MIN_TRAIN_DAYS + 1) {
      const testDates  = sortedDates.slice(-HOLDOUT_DAYS);
      const trainDates = sortedDates.slice(0, sortedDates.length - testDates.length);
      if (trainDates.length >= MIN_TRAIN_DAYS) {
        const holdoutModel = trainEnsembleWeights({ dates: trainDates, records: backtestLog.records }, { lookbackDays: trainDates.length });
        const sig = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
        const ruleProbOf = (s) => lookupProb(s, scoreToProbTable?.table, (sc) => Math.max(0.005, Math.min(0.30, sc / 100 * 0.28)));
        let ruleBrierSum = 0, mlBrierSum = 0, n = 0;
        for (const d of testDates) {
          for (const rec of (backtestLog.records[d] || [])) {
            if (rec.actuallyPlayed === false || rec.homered == null || !Number.isFinite(rec.score)) continue;
            const y = rec.homered ? 1 : 0;
            const feat = extractFeatures(rec);
            let z = holdoutModel.intercept;
            for (let i = 0; i < feat.length; i++) z += holdoutModel.weights[i] * feat[i];
            ruleBrierSum += (ruleProbOf(rec.score) - y) ** 2;
            mlBrierSum   += (sig(z)               - y) ** 2;
            n++;
          }
        }
        if (n >= MIN_HOLDOUT) {
          const ruleBrier = ruleBrierSum / n, mlBrier = mlBrierSum / n;
          // Only blend ML if it beats the rule model out-of-sample. Cap at 0.25.
          const mlWeight = mlBrier < ruleBrier
            ? Math.min(0.25, weightsFromBrier(ruleBrier, mlBrier, { minWeight: 0, maxWeight: 0.5 }).ml)
            : 0;
          ensembleMeta = {
            mlWeight: +mlWeight.toFixed(3),
            ruleHoldoutBrier: +ruleBrier.toFixed(4),
            mlHoldoutBrier: +mlBrier.toFixed(4),
            holdoutN: n, trainN: holdoutModel.trainedOn,
            reason: mlWeight > 0 ? 'ml-beats-rule' : 'rule-wins',
          };
        } else {
          ensembleMeta.reason = `holdout-too-small(${n})`;
        }
      } else {
        ensembleMeta.reason = 'train-window-too-small';
      }
    } else {
      ensembleMeta.reason = `not-enough-days(${sortedDates.length})`;
    }
    console.log(`[ml] holdout — ruleBrier:${ensembleMeta.ruleHoldoutBrier} mlBrier:${ensembleMeta.mlHoldoutBrier} n:${ensembleMeta.holdoutN} → mlWeight:${ensembleMeta.mlWeight} (${ensembleMeta.reason})`);
  } catch (e) {
    console.warn(`[ml] holdout eval failed: ${e?.message}`);
  }
  const ensembleBlendWeights = { rule: 1 - ensembleMeta.mlWeight, ml: ensembleMeta.mlWeight };

  // EXPERIMENTAL feature-model for the ranking blend. Train on the logged
  // `feat` vectors; size the blend weight by the measured CV-AUC edge over the
  // rule score (capped). Stays off (weight 0) until it has enough rows AND
  // actually out-ranks the rule model out-of-sample.
  let featModel = { ready: false, n: 0 };
  let featRankWeight = 0;
  try {
    if (EXPERIMENTAL_ML_RANK) {
      featModel = trainFeatModel(backtestLog);
      if (featModel.ready && Number.isFinite(featModel.cvAuc) && Number.isFinite(featModel.ruleAuc)) {
        const edge = featModel.cvAuc - featModel.ruleAuc;
        featRankWeight = edge > 0.01 ? Math.min(EXPERIMENTAL_ML_RANK_CAP, edge * 10) : 0;
      }
      console.log(`[ml-rank] featModel ready:${featModel.ready} n:${featModel.n} cvAUC:${featModel.cvAuc?.toFixed?.(4)} ruleAUC:${featModel.ruleAuc?.toFixed?.(4)} → rankWeight:${featRankWeight.toFixed(2)}`);
    }
  } catch (e) {
    console.warn(`[ml-rank] featModel train failed: ${e?.message}`);
  }
  ensembleMeta.featRank = {
    enabled: featRankWeight > 0,
    weight: +featRankWeight.toFixed(3),
    n: featModel.n || 0,
    cvAuc: Number.isFinite(featModel.cvAuc) ? +featModel.cvAuc.toFixed(4) : null,
    ruleAuc: Number.isFinite(featModel.ruleAuc) ? +featModel.ruleAuc.toFixed(4) : null,
  };

  // 1) Schedule
  const rawGames = await fetchSchedule(date);
  // Drop Postponed games entirely. Two reasons:
  //   1. They never happen, so they can't be bet on — pure UI noise.
  //   2. They were quietly poisoning calibration: scoredBatters for postponed
  //      games went into the snapshot, then tomorrow's reconcile noted that
  //      none of those players homered (because the game didn't happen) and
  //      logged them as failed predictions. Over time this biased the model
  //      toward thinking PRIME/STRONG over-predict.
  // The detailedState we store includes "Postponed" and rarer variants like
  // "Cancelled" — match both.
  const POSTPONED_STATES = new Set(['Postponed', 'Cancelled', 'Suspended']);
  const games = rawGames.filter(g => !POSTPONED_STATES.has(g.status));
  const dropped = rawGames.length - games.length;
  console.log(`[slate] ${games.length} games (dropped ${dropped} postponed/cancelled)`);

  // 2) Lineups (parallel, capped concurrency)
  const lineupsByGame = {};
  const lineupResults = await pMap(games, async g => ({ gamePk: g.gamePk, lineups: await fetchLineups(g.gamePk) }), 8);
  for (const r of lineupResults) {
    if (r?.gamePk) lineupsByGame[r.gamePk] = r.lineups;
  }

  // 2b) Resolve each game's STARTING catcher per side so the scorer can apply
  // the OPPOSING catcher's pitch-framing effect (an elite framer suppresses a
  // batter's HR odds). Isolated, additive pass — one boxscore read per game
  // (parallel). Pre-game games without an announced defense resolve to null,
  // and framing simply doesn't apply. Shape:
  //   { [gamePk]: { away: catcherId|null, home: catcherId|null } }
  const catchersByGame = {};
  await pMap(games, async g => {
    try {
      const bs = await mlbGet(`/game/${g.gamePk}/boxscore`);
      const findCatcher = (side) => {
        const t = bs?.teams?.[side];
        for (const pid of (t?.battingOrder || [])) {
          if (t.players?.[`ID${pid}`]?.position?.abbreviation === 'C') return pid;
        }
        return null;
      };
      catchersByGame[g.gamePk] = { away: findCatcher('away'), home: findCatcher('home') };
    } catch {
      catchersByGame[g.gamePk] = { away: null, home: null };
    }
  }, 8);

  // 2c) Short-window Statcast recency signals (both fail soft to {}):
  //   • recentBarrels    — last ~14d batted-ball quality per batter, fetched in
  //                        ONE league-wide statcast_search request (no per-player
  //                        loop). Strongest published 7-14d HR predictor.
  //   • pitcherVeloTrend — per-starter fastball velo, recent ~21d vs the
  //                        pitcher's own season baseline (velo decline => more
  //                        hittable). Only today's ~30 starters, bounded conc.
  // See server/statcastRecent.mjs.
  const starterIds = games.flatMap(g => [g.awayPitcher?.id, g.homePitcher?.id]).filter(Boolean);
  let recentBarrels = { sevenDay: {}, fourteenDay: {} }, pitcherVeloTrend = {};
  try {
    const recStart = Date.now();
    [recentBarrels, pitcherVeloTrend] = await Promise.all([
      fetchRecentBatterBarrelsMultiWindow(SEASON, { endDate: date }),
      fetchRecentPitcherVelo(starterIds, SEASON, { windowDays: 21, endDate: date }),
    ]);
    console.log(`[recent] barrels:${Object.keys(recentBarrels.fourteenDay ?? {}).length} batters · veloTrend:${Object.keys(pitcherVeloTrend).length}/${new Set(starterIds).size} starters (${Date.now() - recStart}ms)`);
  } catch (e) {
    console.warn(`[recent] fetch failed: ${e?.message}`);
  }

  // 3) Active-roster fallback — fetch per-side based on which sides DIDN'T
  // confirm a lineup. Used to gate purely on game-level `confirmed`, which
  // meant a partial-confirmation game (one team posted, other hadn't) got
  // ZERO roster fallback for the empty side and ended up with zero scored
  // batters for that team in the snapshot. Now: if home is empty but away
  // is confirmed, we still fetch the home active roster.
  const teamIdsNeedingRoster = new Set();
  for (const g of games) {
    const l = lineupsByGame[g.gamePk];
    if (!l?.awayConfirmed) teamIdsNeedingRoster.add(g.awayTeam.id);
    if (!l?.homeConfirmed) teamIdsNeedingRoster.add(g.homeTeam.id);
  }
  const rosterByTeam = {};
  const rosterResults = await pMap([...teamIdsNeedingRoster], async (id) => {
    const batters = await fetchActiveBatters(id);
    return { id, batters };
  }, 8);
  for (const r of rosterResults) {
    if (r?.id) rosterByTeam[r.id] = r.batters;
  }

  // 4) Collect every batter ID we'll need stats for — per side, using
  // confirmed lineups where present and active-roster fallback where not.
  // Previously the home/away decision was coupled to the game-level
  // `confirmed` flag, so partial-confirmation games had whichever side
  // happened to be empty miss out on the roster ID list (and thus all
  // downstream stats fetches + scoring).
  const allBatterIds = new Set();
  for (const g of games) {
    const l = lineupsByGame[g.gamePk];
    const awayIds = l?.awayConfirmed && l.away?.length
      ? l.away
      : (rosterByTeam[g.awayTeam.id] || []).map(p => p.id);
    const homeIds = l?.homeConfirmed && l.home?.length
      ? l.home
      : (rosterByTeam[g.homeTeam.id] || []).map(p => p.id);
    [...awayIds, ...homeIds].forEach(id => allBatterIds.add(id));
  }

  // 5) Probable-pitcher IDs
  const allPitcherIds = new Set();
  for (const g of games) {
    if (g.awayPitcher?.id) allPitcherIds.add(g.awayPitcher.id);
    if (g.homePitcher?.id) allPitcherIds.add(g.homePitcher.id);
  }

  console.log(`[slate] ${allBatterIds.size} batters, ${allPitcherIds.size} pitchers`);

  const batterIdArr  = [...allBatterIds];
  const pitcherIdArr = [...allPitcherIds];

  // 6) Stats fetches — parallel. League-wide Savant leaderboards are single
  //    cached calls regardless of slate size, so we lump them in here too.
  const [
    batterStats,
    pitcherStats,
    bullpenHR9,
    pitcherHands,
    savantBatter,
    savantPitcher,
    pitcherPitchMix,
    pitcherXStats,
    batterExpected,
    batterArsenal,
    batter30Game,
    batter7Game,
    hrStreakMap,
    dayNightSplits,
    homeAwaySplits,
    bullpenSplits,
    umpiresByGame,
    catcherFraming,
    batTracking,
    batTrackingRecent,
    blastVsHand,
    blastByPitch,
  ] = await Promise.all([
    fetchBatterStatsBatch(batterIdArr),
    fetchPitcherStatsBatch(pitcherIdArr),
    fetchBullpenHR9Map([...new Set(games.flatMap(g => [g.awayTeam.id, g.homeTeam.id]))]),
    fetchPitcherHands(pitcherIdArr),
    fetchSavantBatterStatsAll(),
    fetchSavantPitcherStats(),
    fetchSavantPitcherPitchMix(),
    fetchPitcherExpectedStats(),
    fetchBatterExpectedStats(SEASON),
    fetchSavantBatterPitchPerf(),
    fetchBatterStats30Game(batterIdArr),
    fetchBatterStats7Game(batterIdArr),
    fetchBatterHrStreak(batterIdArr),
    fetchDayNightSplitsBatch(batterIdArr),
    fetchHomeAwaySplitsBatch(batterIdArr),
    fetchBullpenSplitsBatch(batterIdArr),
    fetchHomePlateUmpires(games),
    fetchCatcherFraming(SEASON),
    fetchSavantBatTracking(),
    // Recent ~2-week bat-tracking window — the "blasting lately" signal sharps
    // watch (40%+ recent blast rate = live power). minSwings low since nobody
    // is season-qualified inside a 14-day slice.
    fetchSavantBatTracking(SEASON, { dateStart: ctDateMinusDays(14), dateEnd: todayInTZ(), minSwings: 10 }),
    // Recent blast split by pitcher hand (vs-LHP / vs-RHP) — matchup-relevant.
    fetchBlastVsHand(SEASON, { dateStart: ctDateMinusDays(14), dateEnd: todayInTZ(), minSwings: 5 }),
    // Season blast per pitch type — to usage-weight "blast vs his mix" per game.
    fetchBlastByPitchType(),
  ]);

  // 6b) League-wide Statcast percentile pools. savantBatter holds every
  // qualified MLB batter, so ranking a player's value within it gives the
  // honest "vs MLB" percentile (Savant-style) for the player-card power
  // profile — as opposed to the slate-relative rank the client computes.
  const mlbPool = Object.values(savantBatter || {});
  const mlbSorted = {
    ev:      mlbPool.map((s) => s?.exitVelo).filter(Number.isFinite).sort((a, b) => a - b),
    barrel:  mlbPool.map((s) => s?.barrelPctBBE).filter(Number.isFinite).sort((a, b) => a - b),
    hardHit: mlbPool.map((s) => s?.hardHitPct).filter(Number.isFinite).sort((a, b) => a - b),
  };
  // Mid-rank percentile (ties share rank); needs a real pool to mean anything.
  const mlbPctile = (arr, v) => {
    if (!Number.isFinite(v) || arr.length < 30) return null;
    let lo = 0; while (lo < arr.length && arr[lo] < v) lo++;
    let hi = lo; while (hi < arr.length && arr[hi] === v) hi++;
    return Math.round(((lo + (hi - lo) / 2) / arr.length) * 100);
  };

  // 7) Pitcher recent form (gameLog) — per-pitcher fetch, parallelized
  const pitcherRecentForm = {};
  const recentFormResults = await pMap(pitcherIdArr, async (pid) => ({ pid, form: await fetchPitcherRecentForm(pid) }), 6);
  for (const r of recentFormResults) {
    if (r?.pid && r.form) pitcherRecentForm[r.pid] = r.form;
  }

  // 7b) Head-to-head (H2H) stats — per batter × opposing pitcher pair
  //
  // Previously left out of the snapshot because the cross-product is huge
  // (every batter × every pitcher). But the SLATE-RELEVANT subset is bounded:
  // every batter in today's lineups paired with the OPPOSING pitcher they'll
  // face. That's roughly Σ(lineupSize) per game = ~270 pairs/day in season.
  // Capping at 100 random pairs keeps the per-snapshot fetch under ~30 sec.
  //
  // Keyed as "<batterId>-<pitcherId>" so the app can do an exact-match lookup
  // when scoring each at-bat.
  const h2hPairs = [];
  for (const g of games) {
    const l = lineupsByGame[g.gamePk];
    if (!l) continue;
    const awayIds = l.away?.length ? l.away
                  : (rosterByTeam[g.awayTeam.id] || []).map(p => p.id);
    const homeIds = l.home?.length ? l.home
                  : (rosterByTeam[g.homeTeam.id] || []).map(p => p.id);
    if (g.homePitcher?.id) for (const bid of awayIds) h2hPairs.push([bid, g.homePitcher.id]);
    if (g.awayPitcher?.id) for (const bid of homeIds) h2hPairs.push([bid, g.awayPitcher.id]);
  }
  // Cap the H2H fetch DETERMINISTICALLY: sort by a stable key (batterId, then
  // pitcherId) and take the first N. This was a Math.random shuffle for a
  // "representative slice" — but H2H feeds the h2hFactor in the score, so a
  // random sample meant a batter got an H2H score nudge on one run and not the
  // next, silently reshuffling the whole board every 10-min rebuild. A fixed
  // sample → stable scores → no shuffling. H2H is a minor career factor; which
  // 200 pairs we sample matters far less than sampling the SAME ones each run.
  const h2hSampleSize = Math.min(h2hPairs.length, 200);
  const h2hSample = h2hPairs
    .slice()
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, h2hSampleSize);
  const h2h = {};
  const h2hResults = await pMap(h2hSample, async ([bid, pid]) => {
    try {
      // MLB Stats API vsPlayer split — career career stats for this batter
      // against this specific pitcher.
      const data = await mlbGet(`/people/${bid}/stats?stats=vsPlayer&group=hitting&opposingPlayerId=${pid}`);
      const splits = data?.stats?.[0]?.splits || [];
      // Pick the "all" split (cumulative career) if present; otherwise the first.
      const s = splits.find(sp => sp.split?.code === 'vsp') || splits[0];
      if (!s?.stat) return null;
      const stat = s.stat;
      const ab = parseInt(stat.atBats, 10) || 0;
      if (ab < 3) return null;   // Sub-3 AB samples are too noisy to trust
      const hr = parseInt(stat.homeRuns, 10) || 0;
      return {
        key:  `${bid}-${pid}`,
        ab,
        hr,
        h:   parseInt(stat.hits, 10) || 0,
        avg: parseFloat(stat.avg) || 0,
        slg: parseFloat(stat.slg) || 0,
        ops: parseFloat(stat.ops) || 0,
        k:   parseInt(stat.strikeOuts, 10) || 0,
        // hrRate is what scoreBatter actually reads for the h2hFactor —
        // missing this field silently NaN'd matchupScore for every batter
        // with prior career history against the opposing pitcher
        // (h2h.hrRate undefined → (undefined - 0.04) * 100 = NaN → matchup
        // NaN → composite NaN). The `?? null` fallback inside the model
        // doesn't catch undefined-then-arithmetic, only direct null.
        hrRate: ab > 0 ? hr / ab : 0,
      };
    } catch { return null; }
  }, 10);
  for (const r of h2hResults) {
    if (r?.key) h2h[r.key] = r;
  }

  // 8) Weather per game — single-source: NWS hourly forecast.
  //
  // For each game we resolve the stadium (for lat/lon) and ask weather.mjs
  // for the hour-by-hour forecast covering the game window. The result has
  // both a flat headline (first-pitch hour — what the legacy UI + scoring
  // engine read directly) AND an hours[] array unlocking later progression
  // features. See the Weather typedef at the top of this file for the full
  // shape, or weather.mjs for the why behind the provider choice.
  //
  // Concurrency capped at 4 (was 8). The prior provider (Open-Meteo)'s free tier was generous
  // (10k/day) but the per-second burst limit is tighter; with 8 concurrent
  // requests, ~half the second batch was silently 429-ing on the May 25
  // morning cron and returning null weather for those games. 4 is below
  // the threshold and weather.mjs has 1 retry on top — combined, that
  // got us back to ~100% success across all venues.
  const weatherByGame = {};
  const wResults = await pMap(games, async (g) => {
    const stadium = findStadium(g.venueName);
    if (!stadium) return { gamePk: g.gamePk, weather: null };
    const weather = await fetchHourlyForecast(stadium, g.gameDate);
    return { gamePk: g.gamePk, weather };
  }, 4);
  for (const r of wResults) {
    if (r?.gamePk && r.weather) weatherByGame[r.gamePk] = r.weather;
  }

  // ── Weather outage fallback ───────────────────────────────────────────────
  // When the weather provider (NWS) is throwing errors (happens — May 26 we saw
  // a multi-hour outage), every forecast fetch above returns null and the
  // weatherByGame map ends up empty. The slate-qa hard-fail downstream
  // would then block the entire snapshot, leaving every user with stale
  // data. That's worse than shipping with stale weather.
  //
  // So: if the fresh fetch produced nothing AND the prior snapshot has
  // weather for the same games (today's previous run), carry it forward.
  // The snapshot keeps weather at the top-level key `weatherByGame`
  // (not nested inside each game), so look there.
  // Mark the rows so downstream + clients can tell it's not live.
  if (Object.keys(weatherByGame).length === 0) {
    const priorWeatherByGame =
      priorSnapshot?.weatherByGame && typeof priorSnapshot.weatherByGame === 'object'
        ? priorSnapshot.weatherByGame
        : {};
    let carried = 0;
    for (const g of games) {
      const pw = priorWeatherByGame[g.gamePk];
      if (pw) {
        // Shallow tag so the client can choose to badge it. Doesn't change
        // any field the air-density / wind model reads.
        weatherByGame[g.gamePk] = { ...pw, _carriedForward: true };
        carried++;
      }
    }
    if (carried > 0) {
      console.warn(`[slate] weather carry-forward — fresh fetch returned 0, reused ${carried}/${games.length} from prior snapshot (likely NWS outage)`);
    } else {
      console.warn(`[slate] weather carry-forward unavailable — prior snapshot has no weatherByGame to reuse`);
    }
  }

  // 8a) Roof state for retractable parks. Only ~5 retractable stadiums
  // in MLB (ARI, MIA, MIL, TOR, SEA), and on any given day usually 1-3
  // are in the slate. Cheap to check, and lets the air-density model
  // skip the "force indoor defaults" path when the roof is actually open.
  const retractables = games.filter(g => findStadium(g.venueName)?.type === 'Retractable');
  if (retractables.length) {
    const roofResults = await pMap(
      retractables,
      async (g) => ({ gamePk: g.gamePk, roofClosed: await fetchRoofState(g.gamePk) }),
      6,
    );
    for (const r of roofResults) {
      if (r?.gamePk && weatherByGame[r.gamePk]) {
        weatherByGame[r.gamePk].roofClosed = r.roofClosed;
      }
    }
  }

  // 8b) HR-prop odds were removed from statfax-brain — the engine scores on
  //     model signal alone, so there's no Vegas blend and no odds in the
  //     published snapshot.

  // 8.5) Score every batter using the bundled model — same scoreBatter() the
  // mobile app runs, just executed once here so every device reads identical
  // scores from the snapshot. Mirrors HomeScreen.runFetch's scoreTeam loop
  // argument-for-argument so behavior is byte-identical to the per-device
  // path (which still exists as a fallback when the snapshot is missing).
  console.log(`[slate] scoring ${allBatterIds.size} batters…`);
  const scoreStart = Date.now();
  const scoredBatters = {};
  // Collected during the scoring loop — one entry per batter that tripped
  // the NaN fallback. Attached to the snapshot under `_nanDebug` and capped
  // so the JSON doesn't balloon if every batter trips.
  const nanDebug = [];
  // Per-batter scoreBatter() input bundles, frozen so model-lab/score-offline.mjs
  // can re-score any engine variant on byte-identical inputs — true held-out
  // counterfactual re-scoring (e.g. "what did pulling the Due bonus actually do
  // to AUC/Brier?"). Written to dist/inputs-<date>.json. See README "Capturing
  // inputs". Kept out of daily.json to keep the device payload lean.
  const inputCorpus = [];

  for (const game of games) {
    const venueStadium = findStadium(game.venueName);
    const weather      = weatherByGame[game.gamePk] || null;

    // Day game = first pitch before ~5pm LOCAL time at the venue. Identical
    // logic to HomeScreen's resolution so day/night edges line up exactly.
    const venueTZ = venueStadium?.timezone || 'America/New_York';
    let isDayGame = false;
    try {
      const localHour = parseInt(
        new Intl.DateTimeFormat('en-US', { timeZone: venueTZ, hour: 'numeric', hour12: false })
          .format(new Date(game.gameDate)),
        10,
      );
      isDayGame = Number.isFinite(localHour) && localHour < 17;
    } catch {
      isDayGame = new Date(game.gameDate).getUTCHours() < 22;
    }

    // Resolve who's batting for each side. Per-side: confirmed lineup wins,
    // else fall back to the active roster we fetched in step 3. This is
    // what lets a partial-confirmation game (e.g., White Sox lineup posted
    // but Giants haven't yet) still display BOTH teams' players — CWS
    // gets its confirmed batting order, SF gets its roster projection.
    const lineup = lineupsByGame[game.gamePk] || { away: [], home: [], awayConfirmed: false, homeConfirmed: false, confirmed: false };
    const awayIds = lineup.awayConfirmed && lineup.away?.length
      ? lineup.away
      : (rosterByTeam[game.awayTeam.id] || []).map(p => p.id);
    const homeIds = lineup.homeConfirmed && lineup.home?.length
      ? lineup.home
      : (rosterByTeam[game.homeTeam.id] || []).map(p => p.id);

    // Assign batting-order slots per side based on per-side confirmation.
    // Roster projections are in alphabetical/jersey order — not real
    // batting order — so a roster-fallback side gets no order map.
    const awayOrder = new Map();
    const homeOrder = new Map();
    if (lineup.awayConfirmed) awayIds.forEach((id, i) => awayOrder.set(id, i + 1));
    if (lineup.homeConfirmed) homeIds.forEach((id, i) => homeOrder.set(id, i + 1));

    // Per-game home-plate umpire + its HR-friendliness factor. The factor
    // is 1.0 (neutral) for any umpire not in the data table; only applies
    // an env-score multiplier when we have known data for that ump. See
    // src/sports/mlb/data/umpire-factors.json for the table + TODO.
    const homePlateUmpire = umpiresByGame.get(game.gamePk) || null;
    const umpFactor       = umpireHrFactor(homePlateUmpire?.name);
    const umpKFactor      = umpireKFactor(homePlateUmpire?.name);

    const scoreSide = (ids, opposingPitcher, orderMap, batterTeamAbbr, isHome, opposingTeamId) => {
      const pd          = opposingPitcher ? pitcherStats[opposingPitcher.id] : null;
      const stadium     = venueStadium;
      const homeStadium = findStadiumByTeam(batterTeamAbbr);
      const opposingBullpenHR9 = opposingTeamId != null ? (bullpenHR9[opposingTeamId] ?? null) : null;

      for (const id of ids) {
        const batter = batterStats[id];
        if (!batter) continue;

        // Switch-hitter side resolution (matches HomeScreen exactly)
        const pitcherHandForCarry = opposingPitcher ? (pitcherHands[opposingPitcher.id] ?? pd?.throws ?? null) : null;
        const effectiveBatSide = batter.batSide === 'S'
          ? (pitcherHandForCarry === 'L' ? 'R' : 'L')
          : batter.batSide;

        // Hand-aware home-park factor (LH PF used for LHB, etc).
        const batterHomePF = (effectiveBatSide === 'L' && homeStadium?.parkFactorL != null) ? homeStadium.parkFactorL
                           : (effectiveBatSide === 'R' && homeStadium?.parkFactorR != null) ? homeStadium.parkFactorR
                           : (homeStadium?.parkFactor ?? 1.0);

        // Merge Statcast contact-quality (savantBatter) with Statcast
        // expected-stats (batterExpected: xBA, xSLG, xISO, xwOBA) into a
        // single savantStats blob so scoreBatter can read `savantStats.xISO`
        // alongside `savantStats.barrelPct`. Either side may be null when
        // Savant rate-limits — graceful spread handles both cases.
        const savantStatsBase = savantBatter[id] ?? null;
        const xStatsForBatter = batterExpected[id] ?? null;
        const savantStats     = (savantStatsBase || xStatsForBatter)
          ? { ...(savantStatsBase ?? {}), ...(xStatsForBatter ?? {}) }
          : null;
        const carry         = stadium
          ? calculateBallCarry(weather, stadium, effectiveBatSide, savantStats?.launchAngle ?? null)
          : { score: 50, windComponent: 0, tempBoost: 0, parkFactor: 1.0 };

        // TODAY'S-VENUE park HR factor, hand-resolved. Distinct from
        // batterHomePF (the batter's OWN home park, used to neutralize his
        // stats). This is the park he's HITTING IN today — the number
        // RudeBets surfaces as "HR Park: +12% HRs today." Already baked
        // into envScore via calculateBallCarry; we surface it as a clean
        // field so Heat Index / Scout Report can show it for every game,
        // regardless of whether weather data is present (parkWeatherHand-
        // Factor is null without weather; this never is). 1.0 = neutral.
        const gameParkHRFactor = (effectiveBatSide === 'L' && stadium?.parkFactorL != null) ? stadium.parkFactorL
                               : (effectiveBatSide === 'R' && stadium?.parkFactorR != null) ? stadium.parkFactorR
                               : (stadium?.parkFactor ?? 1.0);
        const h2hStats      = opposingPitcher ? (h2h[`${id}-${opposingPitcher.id}`] ?? null) : null;
        const pitcherSavant = opposingPitcher ? (savantPitcher[opposingPitcher.id]    ?? null) : null;
        const pitchMix      = opposingPitcher ? (pitcherPitchMix[opposingPitcher.id]  ?? null) : null;
        const recent30      = batter30Game[id] ?? null;
        const recent7       = batter7Game[id]  ?? null;
        const battingOrder  = orderMap.get(id) ?? null;
        const bSplits       = bullpenSplits[id] ?? null;
        const dnSplits      = dayNightSplits[id] ?? null;
        const haSplits      = homeAwaySplits[id] ?? null;
        const recentForm    = opposingPitcher ? (pitcherRecentForm[opposingPitcher.id] ?? null) : null;
        const bArsenal      = batterArsenal[id] ?? null;
        // Opposing catcher's framing runs — the batter faces the OTHER side's
        // defense, so pick away/home opposite to this batter's side.
        const oppCatcherId  = catchersByGame[game.gamePk]?.[isHome ? 'away' : 'home'] ?? null;
        const oppCatcherFramingRuns = (oppCatcherId != null && catcherFraming[oppCatcherId])
          ? catcherFraming[oppCatcherId].framingRuns
          : null;
        const r7  = recentBarrels.sevenDay?.[id]    ?? null;
        const r14 = recentBarrels.fourteenDay?.[id] ?? null;
        const recentBarrelForBatter = (r7 || r14) ? {
          sevenDay:    r7  ? { pct: r7.recentBarrelPct,  bbe: r7.recentBBE  } : null,
          fourteenDay: r14 ? { pct: r14.recentBarrelPct, bbe: r14.recentBBE } : null,
          // Legacy flat fields — read by reconcile.mjs / combo-engine.js
          recentBarrelPct: (r14 ?? r7).recentBarrelPct,
          recentEV:        (r14 ?? r7).recentEV,
          recentBBE:       (r14 ?? r7).recentBBE,
        } : null;
        const veloTrendForPitcher   = opposingPitcher ? (pitcherVeloTrend[opposingPitcher.id] ?? null) : null;

        // Build the argument list once so it's a single source of truth: we
        // spread it into scoreBatter() now AND freeze the same array into the
        // input corpus below, guaranteeing the offline re-scorer sees exactly
        // what the live run scored (no drift between call site and corpus).
        const scoreArgs = [
          batter,
          opposingPitcher,
          pd?.splits ?? null,
          pd?.season ?? null,
          carry,
          savantStats,
          h2hStats,
          pitcherSavant,
          recent30,
          pitchMix,
          battingOrder,
          recent7,
          pitcherHandForCarry,
          batterHomePF,
          bArsenal,
          recentForm,
          dnSplits,
          isDayGame,
          haSplits,
          isHome,
          bSplits,
          opposingBullpenHR9,
          weather,       // for sprayWindAdj — wind blowing into pull direction
          stadium,       // for sprayWindAdj — stadium bearing for pull math
          oppCatcherFramingRuns,  // opposing catcher's framing runs (HR suppression)
          recentBarrelForBatter,  // batter's last ~14d batted-ball quality
          veloTrendForPitcher,    // opposing starter fastball velo trend
        ];
        const result = scoreBatter(...scoreArgs);
        // Freeze inputs for every scored batter (NaN rows included — they're the
        // ones worth replaying). Keyed by playerId + gamePk so it joins back to
        // the reconciled outcome log for held-out scoring.
        inputCorpus.push({ id, name: batter.name, gamePk: game.gamePk, args: scoreArgs });

        // Sanity net: if some upstream input made it past our guards and the
        // composite came back non-finite, fall back to the (always-finite)
        // batter-only score so the row still appears in the snapshot. The
        // matchup + env signals silently zero for THIS one batter; we
        // re-derive the grade from the fallback score so the displayed tier
        // matches the displayed number. Earlier today this branch dropped
        // the row entirely, which made Yordan Alvarez (and ~48 other batters
        // whose matchupScore intermittently NaN's for reasons we haven't
        // pinned down) disappear from confirmed lineups mid-game — a worse
        // failure mode than showing a partial score.
        let safeResult = result;
        if (!Number.isFinite(result?.score)) {
          const fallbackScore = Number.isFinite(result?.batterScore) ? result.batterScore : 0;
          const fallbackGrade = typeof gradeFromScore === 'function'
            ? gradeFromScore(fallbackScore)
            : { label: 'SKIP', min: 0, color: '#444444' };
          console.warn(`[slate] ${batter.name} (id ${id}): scoreBatter non-finite — fallback to batterScore=${fallbackScore} (matchup=${result?.matchupScore} env=${result?.envScore})`);

          // Stash the inputs that produced this NaN so we can replay locally
          // and find the root cause. The snapshot is the only artifact the
          // cron exposes to us (no Actions log access from the device side),
          // so we attach a compact diagnostic record per affected batter.
          // The replay script (server/replay-nan.mjs) reads this back and
          // re-runs scoreBatter to isolate the offending factor.
          nanDebug.push({
            playerId: id,
            name:     batter.name,
            batSide:  batter.batSide,
            isHome,
            symptoms: {
              score:        result?.score,
              matchupScore: result?.matchupScore,
              envScore:     result?.envScore,
              batterScore:  result?.batterScore,
              hrProbability: result?.hrProbability,
              rating:       result?.rating,
            },
            inputs: {
              batter,
              opposingPitcher,
              pitcherSplits:  pd?.splits ?? null,
              pitcherSeason:  pd?.season ?? null,
              carry,
              savantStats,
              h2h:            h2hStats,
              pitcherSavant,
              recent30,
              pitchMix,
              battingOrder,
              recent7,
              pitcherHand:    pitcherHandForCarry,
              batterHomePF,
              batterArsenal:  bArsenal,
              recentForm,
              dayNightSplits: dnSplits,
              isDayGame,
              homeAwaySplits: haSplits,
              isHomeGame:     isHome,
              bullpenSplits:  bSplits,
              opposingBullpenHR9,
            },
          });

          safeResult = {
            ...result,
            score:         fallbackScore,
            grade:         fallbackGrade,
            // Probability outputs depend on the composite; null them out
            // rather than ship NaN/0 that the UI would render as "0% to homer".
            hrProbability: null,
            expectedHRs:   null,
            rating:        Math.max(1, Math.min(10, Math.round(fallbackScore / 10))),
            // Preserve whichever subscores ARE finite so the player-detail
            // modal can still show what we have. Null the NaN ones; the modal
            // already renders "—" for null sub-scores.
            matchupScore:  Number.isFinite(result?.matchupScore) ? result.matchupScore : null,
            envScore:      Number.isFinite(result?.envScore)     ? result.envScore     : null,
          };
        }

        // Primary-pitch edge — derived server-side so the client doesn't
        // need both the pitcher's full mix and the batter's full arsenal
        // on the row to compute it. Finds the pitcher's most-thrown pitch
        // type and looks up the batter's SLG against it. When the batter
        // mashes that exact pitch (SLG ≥ season SLG + 0.030), we emit a
        // compact `primaryPitchEdge` object the Heat Index check reads.
        //
        // Map of pitch keys → human-readable names. Mirrors the keys
        // emitted by fetchSavantPitcherPitchMix (ffPct, siPct, …) and
        // fetchSavantBatterPitchPerf (ffSlg, siSlg, …).
        const PITCH_NAMES = {
          ff: '4-seam', si: 'sinker', fc: 'cutter',
          sl: 'slider', cu: 'curveball', kc: 'knuckle curve',
          ch: 'changeup', fs: 'splitter',
        };
        let primaryPitchEdge = null;
        if (pitchMix && bArsenal) {
          let topKey = null;
          let topFreq = 0;
          for (const k of Object.keys(PITCH_NAMES)) {
            const freq = Number(pitchMix[`${k}Pct`]);
            if (Number.isFinite(freq) && freq > topFreq) {
              topFreq = freq;
              topKey  = k;
            }
          }
          if (topKey && topFreq >= 10) {   // topFreq is a usage % (0–100)
            const batterSlg = Number(bArsenal[`${topKey}Slg`]);
            const seasonSlg = Number(batter.season?.slg);
            if (Number.isFinite(batterSlg) && Number.isFinite(seasonSlg)) {
              // "Passes" when batter's SLG against this exact pitch
              // exceeds his season SLG by 30+ points — significant
              // signal he can punish the pitcher's bread-and-butter.
              const edge = batterSlg - seasonSlg;
              primaryPitchEdge = {
                passes:      edge >= 0.030,
                pitchKey:    topKey,
                pitchName:   PITCH_NAMES[topKey],
                batterSlg:   batterSlg,
                pitcherFreq: topFreq / 100,   // store as fraction; HeatIndex ×100 for display
              };
            }
          }
        }
        // Compact pitch-type splits: for each pitch the starter throws ≥10%, the
        // batter's SLG (and whiff%) vs that exact pitch type. Powers the
        // pitch-type matchup row. Only pitches actually thrown → tiny payload.
        let pitchTypeSplits = null;
        if (pitchMix && bArsenal) {
          const rows = [];
          for (const k of Object.keys(PITCH_NAMES)) {
            const usage = Number(pitchMix[`${k}Pct`]);
            if (!Number.isFinite(usage) || usage < 10) continue;
            const slg = Number(bArsenal[`${k}Slg`]);
            const whiff = Number(bArsenal[`${k}Whiff`]);
            rows.push({
              key: k,
              name: PITCH_NAMES[k],
              usage: +usage.toFixed(0),
              slg: Number.isFinite(slg) ? +slg.toFixed(3) : null,
              whiff: Number.isFinite(whiff) ? +whiff.toFixed(1) : null,
            });
          }
          if (rows.length) { rows.sort((a, b) => b.usage - a.usage); pitchTypeSplits = rows; }
        }

        // Pre-compose season helpers (iso, hrRate) the way the app does so
        // the mobile renderer can drop them straight into the row.
        const seasonAvg = batter.season?.avg ?? 0;
        const seasonSlg = batter.season?.slg ?? 0;
        const seasonAb  = batter.season?.ab  ?? 0;
        const seasonHr  = batter.season?.hr  ?? 0;
        const season    = batter.season
          ? { ...batter.season, iso: seasonSlg - seasonAvg, hrRate: seasonAb > 0 ? seasonHr / seasonAb : 0 }
          : null;

        // Opposing-pitcher composite — mirrors the app's PlayerDetailModal payload
        // so tapping a batter row shows the same TOUGH/NEUTRAL/SHAKY/VULNERABLE
        // verdict as the dedicated Pitcher Vulnerability screen.
        //
        // homeParkFactor: the OPPOSING pitcher's home stadium HR factor.
        // Used by calcVulnerabilityScore to neutralize Coors-style inflation
        // (Rockies starter HR/9 looks bad mostly because half his starts are
        // at altitude — the verdict should reflect his true skill, not the
        // park his team plays in). Falls back to 1.0 if the lookup misses.
        const pitcherTeamAbbr        = isHome ? game.awayTeam.abbr : game.homeTeam.abbr;
        const pitcherHomeStadium     = findStadiumByTeam(pitcherTeamAbbr);
        const pitcherHomeParkFactor  = pitcherHomeStadium?.parkFactor ?? 1.0;
        const pitcherBlock = opposingPitcher ? {
          id:              opposingPitcher.id,
          name:            opposingPitcher.name,
          hand:            pitcherHandForCarry,
          season:          pd?.season ?? null,
          splits:          pd?.splits ?? null,
          recentForm:      recentForm,
          savant:          pitcherSavant,
          pitchMix:        pitchMix,
          xStats:          pitcherXStats[opposingPitcher.id] ?? null,
          homeParkFactor:  pitcherHomeParkFactor,
          gameParkHRFactor: stadium?.parkFactor ?? 1.0,
          gameParkKFactor:  stadium?.parkFactorK ?? 1.0,
        } : null;

        // Doubleheader fix: write under BOTH a composite key
        // `${id}-${gamePk}` (the new canonical lookup) and the legacy
        // `${id}` (kept for backward compat with clients that haven't
        // picked up the new OTA yet). For non-doubleheaders the two keys
        // point to the same single row. For doubleheaders the composite
        // keys preserve BOTH games while the legacy key is last-wins —
        // not perfect for old clients on DH days, but those would have
        // been broken either way; new clients use the composite key and
        // see both games correctly.
        const row = {
          playerId:   id,
          name:       batter.name,
          batSide:    batter.batSide,
          gamePk:     game.gamePk,
          team:       batterTeamAbbr,
          teamId:     isHome ? game.homeTeam.id : game.awayTeam.id,
          isHome,
          battingOrder,
          currentInning: game.currentInning ?? null,
          // Per-side lineup confirmation flag piped onto the batter row so
          // PlayerDetailModal can render "Lineup: Confirmed / Projected"
          // without having to walk back up to results[gameOf(batter)]. A
          // batter is "confirmed" iff THEIR side's lineup was posted —
          // partial-confirmation games (one team posted, other hasn't)
          // honestly reflect each side's state instead of all-or-nothing.
          lineupConfirmed: isHome ? !!lineup.homeConfirmed : !!lineup.awayConfirmed,
          season,
          recent:     batter.recent || null,
          // Statcast contact-quality fields lifted onto the row so the app
          // can render Zone Kings / parlay strategies without re-joining.
          barrelPct:  savantStats?.barrelPct  ?? null,
          // Standard Barrel% (barrels/BBE) for display + Heat Index so our
          // numbers match RudeBets / Savant. Falls back to brl_pa-based
          // barrelPct on the client when BBE version is unavailable.
          barrelPctBBE: savantStats?.barrelPctBBE ?? null,
          exitVelo:   savantStats?.exitVelo   ?? null,
          hardHitPct: savantStats?.hardHitPct ?? null,
          // True vs-MLB Statcast percentiles (ranked across every qualified
          // batter, not just today's slate) for the power-profile bars. Null
          // per metric when the Statcast value is missing.
          pctileMLB: {
            ev:      mlbPctile(mlbSorted.ev,      savantStats?.exitVelo),
            barrel:  mlbPctile(mlbSorted.barrel,  savantStats?.barrelPctBBE),
            hardHit: mlbPctile(mlbSorted.hardHit, savantStats?.hardHitPct),
          },
          // Bat tracking (Statcast 2024+): bat speed + BLAST rate. "Blast" =
          // a swing that's fast AND squared-up — the most HR-predictive slice.
          // We carry season + a recent ~2-week window (recentBlastPct), since a
          // bat blasting 40%+ lately is a live power signal regardless of its
          // season line. All rate fields are 0-100 %. Null when Savant is dry.
          batTracking: (batTracking[id] || batTrackingRecent[id]) ? {
            batSpeed:        batTracking[id]?.batSpeed ?? null,
            blastPct:        batTracking[id]?.blastPct ?? null,            // per swing, season
            blastPerContact: batTracking[id]?.blastPerContact ?? null,    // per bat-contact, season
            squaredUpPct:    batTracking[id]?.squaredUpPct ?? null,
            recentBlastPct:        batTrackingRecent[id]?.blastPct ?? null,         // per swing, ~14d
            recentBlastPerContact: batTrackingRecent[id]?.blastPerContact ?? null,  // per bat-contact, ~14d
            recentSwings:    batTrackingRecent[id]?.swings ?? null,
            // Matchup-relevant cuts: recent blast vs today's starter's HAND, and
            // the usage-weighted blast vs his exact MIX (the number sharps quote).
            // Display context — the model nudge still rides the validated metric.
            vsHand:      pitcherHandForCarry || null,
            vsHandBlast: (pitcherHandForCarry === 'L' ? blastVsHand.L : pitcherHandForCarry === 'R' ? blastVsHand.R : null)?.get(id)?.blast ?? null,
            vsHandSwings: (pitcherHandForCarry === 'L' ? blastVsHand.L : pitcherHandForCarry === 'R' ? blastVsHand.R : null)?.get(id)?.swings ?? null,
            vsMixBlast:    blastVsMix(id, pitchMix, blastByPitch)?.blast ?? null,
            vsMixCoverage: blastVsMix(id, pitchMix, blastByPitch)?.coverage ?? null,
          } : null,
          // Launch angle — was previously NOT surfaced on the row even
          // though scoreBatter uses it. Heat Index "LA in HR window" check
          // needs it; without it that check could never pass.
          launchAngle: savantStats?.launchAngle ?? null,
          // Pull rate (% of batted balls pulled) — a HR-relevant batted-ball
          // tendency (pull-side power clears fences more often). Fetched in the
          // savant blob but wasn't surfaced on the row; now exposed for the
          // matchup view. Null when the savant sample is missing.
          pullPct: savantStats?.pullPct ?? null,
          // Primary-pitch edge (derived above) — compact "does this batter
          // mash the pitcher's bread-and-butter?" signal for Heat Index.
          // Null when we don't have both arsenals to compute it.
          primaryPitchEdge,
          // Batter SLG/whiff vs each pitch the starter throws (≥10% usage).
          pitchTypeSplits,
          // Today's-venue hand-resolved park HR factor (1.0 = neutral).
          // Always present (unlike parkWeatherHandFactor) so the Heat Index
          // "HR Park" check works for every game.
          gameParkHRFactor,
          // Statcast expected stats — luck-adjusted contact quality. PlayerDetailModal
          // can render these as "true talent" alongside the observed numbers.
          xStats: xStatsForBatter ? {
            xBA:   xStatsForBatter.xBA,
            xSLG:  xStatsForBatter.xSLG,
            xISO:  xStatsForBatter.xISO,
            xwOBA: xStatsForBatter.xwOBA,
          } : null,
          pitcher:    pitcherBlock,
          // Home-plate umpire (when announced — usually ~24h before first
          // pitch). Stored even when the HR factor is neutral 1.0 so the
          // modal can display the ump name regardless.
          umpire:     homePlateUmpire ? { ...homePlateUmpire, hrFactor: umpFactor, kFactor: umpKFactor, zoneStyle: umpireZoneStyleFor(homePlateUmpire.name) } : null,
          // Short-window recency signals (also fed into scoreBatter above) —
          // surfaced on the row so they're logged for model training and can be
          // shown in the modal Scout Report later.
          recentBarrel:      recentBarrelForBatter,   // { recentBarrelPct, recentEV, recentBBE }
          opposingVeloTrend: veloTrendForPitcher,      // { recentFastballVelo, seasonFastballVelo, veloDelta }
          // Consecutive most-recent games with >=1 HR (the literal streak, not
          // a 7-day HR count). Powers the "ON HR STREAK" parlay tag + card badge.
          hrStreak:          hrStreakMap[id] ?? 0,
          ...safeResult,
        };
        // Apply umpire HR factor on the env contribution of the composite.
        // No-op when the factor is 1.0 (default for any ump not in the
        // umpire-factors.json table). When the table is populated with
        // real data, ~10-15% of games will get a small ±2-3% nudge.
        if (umpFactor !== 1.0 && Number.isFinite(row.score) && Number.isFinite(row.envScore)) {
          const envPart = row.envScore * 0.25;
          const delta   = Math.round(envPart * (umpFactor - 1.0));
          if (delta !== 0) {
            row.umpireBonus = delta;
            row.score       = Math.max(0, Math.min(100, row.score + delta));
            row.grade       = gradeFromScore(row.score);
          }
        }
        // Capture the RAW pregame engine sim as simHRProb HERE — straight off
        // scoreBatter's Bayesian output, BEFORE any live PA-decay (8.68) or
        // Final settlement (which zero score/grade) and BEFORE the isotonic
        // calibration block overwrites row.hrProbability. The old lazy seed
        // (`if simHRProb === undefined → row.hrProbability`) ran AFTER those
        // mutations, so a played batter's logged simHRProb was a post-settlement
        // value polluting calibration. Pinning it at the source freezes the true
        // pre-first-pitch sim; the freeze block below carries it forward for
        // started/Final games (same treatment preGameScore/preGameGrade get).
        row.simHRProb = Number.isFinite(row.hrProbability) ? row.hrProbability : null;
        // Write under composite key (canonical) + legacy id key (BC).
        scoredBatters[`${id}-${game.gamePk}`] = row;
        scoredBatters[id] = row;
      }
    };

    scoreSide(awayIds, game.homePitcher, awayOrder, game.awayTeam.abbr, false, game.homeTeam?.id ?? null);
    scoreSide(homeIds, game.awayPitcher, homeOrder, game.homeTeam.abbr, true,  game.awayTeam?.id ?? null);
  }
  // Count UNIQUE (player, game) pairs by filtering to composite keys only.
  const uniqueScored = Object.keys(scoredBatters).filter(k => k.includes('-')).length;
  console.log(`[slate] scored ${uniqueScored} batter-game pairs in ${((Date.now() - scoreStart) / 1000).toFixed(2)}s`);

  // ─── Math post-process pipeline (Tier 1-3) ────────────────────────────────
  // ORDER MATTERS HERE. Refinements (hotness, park/weather/hand) sharpen the
  // MODEL'S OWN view in sequence, each with a hard delta cap so no single step
  // can radically reshape the composite. (statfax-brain has no Vegas blend —
  // that market-anchor step was removed with the odds integration.)
  //
  // CAP DISCIPLINE — each step has a HARD point-delta ceiling. Without
  // caps, the post-process stack inflated PRIME from ~15 → 57:
  //   • park×weather is multiplicative (×0.82-1.18) — a 65pt score can
  //     swing 11pts from this alone, on top of the model's own park
  //     factor that already touched the matchup score. Cap ±5.
  // Cumulative cap budget across hotness/park is ±~10 pts which keeps the
  // snapshot's score distribution stable across cron runs. (The Vegas blend
  // that used to add a ±6 cap here was removed with the odds integration.)
  const PARK_WEATHER_MAX_DELTA = 5;
  // Blast-rate nudge (Statcast bat tracking) — validated to lift the HR
  // probability out-of-sample (model-lab/blast-model.mjs: Brier/LogLoss/AUC all
  // improve on a 22-day held-out split). Conservative bounded delta centered on
  // league-average blast: elite blasters get a small boost, weak ones a small
  // ding. Capped so it nudges like park-weather, never dominates the composite.
  // Parked at 0 (display/combos-only) until the 6-29 forward re-check confirms
  // blast on real game-time data, not the season proxy it was sized on. Set to 4
  // to re-enable the validated ±4 nudge. See model-lab/BLAST-RECHECK.md.
  const BLAST_MAX_DELTA   = 0;
  const LEAGUE_AVG_BLAST  = 15;  // ≈ median blasts-per-squared-up-contact %
  const BLAST_DELTA_K     = 0.4; // pts per % blast above/below average
  // Hotness with a synthetic 2-point series (recent30 → recent7) has
  // less information density than the algorithm assumes (it was
  // designed for game-by-game logs). The posterior swings sharply,
  // so we cap conservatively and tighten both the prior + neutral
  // band to make sure "hot regime" is genuinely earned, not noise.
  // Empirically: hotness=345 with ±4 cap pushed PRIME 28 → 41.
  // Tighter knobs target PRIME 15-25 even with hotness landing on
  // most batters.
  const HOTNESS_MAX_DELTA    = 2;
  const HOTNESS_PRIOR_RATE   = 0.15;          // was default 0.30
  const HOTNESS_NEUTRAL_BAND = [0.35, 0.70];  // was default [0.40, 0.60]
  const postProcessStart = Date.now();
  let hotnessApplied      = 0;
  let reverseSplitFlipped = 0;
  let parkWeatherApplied  = 0;
  let blastApplied        = 0;
  let logOddsApplied      = 0;
  let mlScoresApplied     = 0;
  let featRanked          = 0;
  // Load the ML model handle ONCE before the loop — loadMLModel caches
  // at module scope so subsequent calls are free, but pulling it out
  // here makes the per-row scoreWithML call explicit about the dependency.
  // Returns null if dist/ensemble-weights.json doesn't exist yet — first
  // cron run after the training step has shipped will produce the file.
  const mlModelHandle = await loadMLModel();
  const composedKeysForPost = Object.keys(scoredBatters).filter(k => k.includes('-'));
  for (const key of composedKeysForPost) {
    const row = scoredBatters[key];
    if (!row || !Number.isFinite(row.score)) continue;

    // Preserve the raw model score before any post-process touches it.
    // Downstream consumers (PlayerDetailModal breakdown) can show both
    // values so users see "model said X, blended-with-market gives Y."
    row.rawScore = row.score;

    // 1) Hotness posterior — sharpen the model's own assessment.
    //    Replaces the binary `hot` flag with a continuous multiplier
    //    [0.95, 1.10]. The binary `row.hot` still flows through for
    //    tags/chips; this is purely a score-side refinement.
    //
    // Input-shape note: computeHotnessPosterior expects an Array<{iso,ab}>
    // of game-by-game logs. We don't carry per-game logs through the
    // snapshot (would balloon payload), so we synthesize a 2-point
    // series — baseline (last 30 games) → recent (last 7 games) — using
    // the rolling-aggregate maps fetched up front. This is enough for
    // the Bayesian likelihood comparison to detect regime shifts.
    //
    // Looked up from the cron-scoped maps (batter30Game / batter7Game)
    // instead of off the row because rows only store the season block.
    // recent7 must have ≥10 AB so we're not amplifying noise from cold
    // starts off the IL.
    const recent30Stats = batter30Game[row.playerId] || null;
    const recent7Stats  = batter7Game[row.playerId]  || null;
    const recent30Iso = recent30Stats?.iso;
    const recent7Iso  = recent7Stats?.iso;
    const recent7Ab   = recent7Stats?.ab ?? 0;
    if (Number.isFinite(recent30Iso) && Number.isFinite(recent7Iso) && recent7Ab >= 10) {
      const syntheticLogs = [
        { iso: recent30Iso, ab: recent30Stats?.ab ?? 30 },
        { iso: recent7Iso,  ab: recent7Ab },
      ];
      const hot = computeHotnessPosterior(syntheticLogs, {
        windowSize: 10,
        priorHotRate: HOTNESS_PRIOR_RATE,
      });
      if (hot && Number.isFinite(hot.posterior)) {
        row.hotnessPosterior = hot.posterior;
        const mult = hotnessMultiplier(hot.posterior, { neutralBand: HOTNESS_NEUTRAL_BAND });
        if (mult !== 1.0) {
          const beforeHot = row.score;
          const rawDelta  = Math.round(beforeHot * (mult - 1));
          const capped    = Math.max(-HOTNESS_MAX_DELTA, Math.min(HOTNESS_MAX_DELTA, rawDelta));
          row.hotnessMultiplier = mult;
          row.hotnessDelta      = capped;
          row.score = Math.max(0, Math.min(100, beforeHot + capped));
          row.grade = gradeFromScore(row.score);
          hotnessApplied++;
        }
      }
    }

    // 2) Reverse-split pitcher flip — when the opposing pitcher has the
    //    rare profile of being WORSE vs same-handed batters, the
    //    standard platoon disadvantage flips. We don't aggressively
    //    rescore here — just attach the flag so downstream can warn
    //    and the next scoring pass uses the flipped HR9.
    if (row.pitcher) {
      const rs = detectReverseSplit(row.pitcher);
      if (rs?.isReverseSplit) {
        row.opposingReverseSplit = true;
        row.opposingReverseSplitSeverity = rs.severity;
        reverseSplitFlipped++;
        // Apply the flip: a same-handed batter normally carries a platoon
        // DISADVANTAGE, but this pitcher is worse vs same-handers — so the
        // hidden edge belongs to same-hand batters. Grant a modest bonus
        // scaled by severity (the same−opp HR9 gap), capped at +5 so a noisy
        // split can't dominate. Switch ('S') and opposite-hand batters are
        // unaffected (row.batSide === pHand is false for them).
        const pHand = row.pitcher.hand;
        if ((pHand === 'L' || pHand === 'R') && row.batSide === pHand) {
          const bonus = Math.min(5, Math.max(0, Math.round(rs.severity * 5)));
          if (bonus > 0) {
            row.reverseSplitDelta = bonus;
            row.score = Math.max(0, Math.min(100, row.score + bonus));
            row.grade = gradeFromScore(row.score);
          }
        }
      }
    }

    const gpk = row.gamePk;

    // 3) Park × weather × hand 3-way factor — replaces the additive sum
    //    of independent park / wind / hand contributions with a true
    //    interaction lookup. Subtle — mostly tweaks the top-5 HR-friendly
    //    parks. Skipped when weather missing (dome / no data).
    //
    // CAP: factor ranges ~0.82-1.18; a 65pt score × 1.18 = +12pts which
    // is too much for one signal (and stacks with model's own park
    // factor inside matchupScore). Convert factor to a point delta and
    // cap at ±PARK_WEATHER_MAX_DELTA so this nudges, never dominates.
    try {
      const game = games.find(g => g.gamePk === gpk);
      const w    = weatherByGame[gpk];
      if (game && w && Number.isFinite(w.windSpeedMph) && Number.isFinite(w.windDirDeg) && !w.roofClosed) {
        const factor = parkWeatherHandFactor(
          game.venueName,
          w.windDirDeg,
          w.windSpeedMph,
          row.batSide,
        );
        if (Number.isFinite(factor) && factor !== 1.0) {
          const beforePW = row.score;
          const rawDelta = Math.round(beforePW * (factor - 1));
          const capped   = Math.max(-PARK_WEATHER_MAX_DELTA, Math.min(PARK_WEATHER_MAX_DELTA, rawDelta));
          row.parkWeatherHandFactor = factor;
          row.parkWeatherHandDelta  = capped;
          row.score = Math.max(0, Math.min(100, beforePW + capped));
          row.grade = gradeFromScore(row.score);
          parkWeatherApplied++;
        }
      }
    } catch { /* graceful: weather/park lookup failures don't break scoring */ }

    // 3b) Blast-rate nudge — bat tracking's most HR-predictive slice (fast +
    //     squared-up contact). Prefer the recent ~2wk window (with a swing
    //     sample), else season; per squared-up contact. Bounded delta centered
    //     on league average so it only nudges. See blast-model.mjs validation.
    try {
      const bt = row.batTracking;
      const blast = bt
        ? (Number.isFinite(bt.recentBlastPerContact) && (bt.recentSwings ?? 0) >= 25
            ? bt.recentBlastPerContact
            : (Number.isFinite(bt.blastPerContact) ? bt.blastPerContact : null))
        : null;
      if (Number.isFinite(blast)) {
        const rawDelta = Math.round((blast - LEAGUE_AVG_BLAST) * BLAST_DELTA_K);
        const capped   = Math.max(-BLAST_MAX_DELTA, Math.min(BLAST_MAX_DELTA, rawDelta));
        if (capped !== 0) {
          const beforeBlast = row.score;
          row.blastRate  = blast;
          row.blastDelta = capped;
          row.score = Math.max(0, Math.min(100, beforeBlast + capped));
          row.grade = gradeFromScore(row.score);
          blastApplied++;
        }
      }
    } catch { /* graceful: bat-tracking gaps never break scoring */ }

    // 4) Vegas-anchor blend removed — statfax-brain scores on model signal
    //    only, so row.score is the finished composite here (no odds anchor,
    //    no market pull).

    // 5) Log-odds parallel score (#178) — composes batterScore/matchupScore/
    //    envScore in logit space relative to the league baseline HR rate
    //    (3.5%), then sigmoids back to probability + 0-100 score. Anchored
    //    to Vegas implied prob when available. Snapshot ships BOTH the
    //    additive `score` and `logOddsScore` so calibration can A/B which
    //    is more predictive over time. Does NOT replace `score` — purely
    //    additive on the snapshot.
    try {
      const logOdds = computeLogOddsScore(row, {
        includeVegas: null, // no odds in statfax-brain — no Vegas anchor
      });
      if (logOdds && Number.isFinite(logOdds.logOddsScore)) {
        row.logOddsScore  = logOdds.logOddsScore;
        row.logOddsHRProb = logOdds.logOddsHRProb;
        logOddsApplied++;
      }
    } catch { /* log-odds is a parallel diagnostic — never block scoring */ }

    // 6) Ensemble passthrough — now backed by the real learned stacker
    //    (#184). loadMLModel is cached at module scope so the disk read
    //    only happens once per process. scoreWithML returns null when no
    //    weights file exists yet, and combineModels passes the rule score
    //    through unchanged in that case — so the pipeline degrades gracefully.
    const mlScore = await scoreWithML(row, row.pitcher, mlModelHandle);
    row.mlScore = mlScore;
    // Diagnostic only — what a SCORE-level blend would be. We deliberately do
    // NOT mutate row.score with this: blending at the score level shifts the
    // distribution and inflates grade tiers (PRIME ≥72 etc. are tuned to the
    // rule score — a 0.25 ML blend ~doubled PRIME in testing). The ensemble is
    // instead applied at the PROBABILITY level in the calibrated-prob pass,
    // where the stacker's Brier edge actually lives, leaving score/grade stable.
    row.ensembleScore = combineModels({ ruleScore: row.score, mlScore, weights: ensembleBlendWeights });
    if (Number.isFinite(mlScore)) mlScoresApplied++;

    // EXPERIMENTAL: blend the feature-model probability into the SCORE/ranking.
    // featScore is mapped back onto the rule scale via the isotonic inverse, so
    // it blends like-for-like — unlike a raw mlScore blend, this keeps the score
    // distribution (and therefore the grade tiers) stable.
    if (featRankWeight > 0 && featModel.ready && scoreToProbTable?.table?.length && Number.isFinite(row.score)) {
      try {
        const fp = scoreFeatProb(extractPredictionRecord(row).feat, featModel);
        const fs = Number.isFinite(fp) ? probToScore(fp, scoreToProbTable.table) : null;
        if (Number.isFinite(fs)) {
          row.ruleScore = row.score;
          row.featProb  = fp;
          row.score     = Math.round(Math.max(0, Math.min(100, (1 - featRankWeight) * row.score + featRankWeight * fs)));
          row.grade     = gradeFromScore(row.score);
          row.rating    = Math.max(1, Math.min(10, Math.round(row.score / 10)));
          featRanked++;
        }
      } catch { /* feature blend is best-effort — never block scoring */ }
    }
  }
  // Score-distribution diagnostic so we can spot inflation regressions
  // before they ship. PRIME = score >= 72 by SCORE_TIERS.
  const tierCounts = { PRIME: 0, STRONG: 0, LEAN: 0, SKIP: 0 };
  for (const key of composedKeysForPost) {
    const r = scoredBatters[key];
    if (!r || !Number.isFinite(r.score)) continue;
    if (r.score >= 72)      tierCounts.PRIME++;
    else if (r.score >= 52) tierCounts.STRONG++;
    else if (r.score >= 36) tierCounts.LEAN++;
    else                    tierCounts.SKIP++;
  }
  console.log(`[math] post-process: hotness=${hotnessApplied} reverseSplit=${reverseSplitFlipped} parkXweather=${parkWeatherApplied} blast=${blastApplied} logOdds=${logOddsApplied} ml=${mlScoresApplied}/${mlModelHandle ? 'loaded' : 'no-weights'} featRank=${featRanked}@${featRankWeight.toFixed(2)} tiers=PRIME:${tierCounts.PRIME}/STRONG:${tierCounts.STRONG}/LEAN:${tierCounts.LEAN}/SKIP:${tierCounts.SKIP} (${((Date.now() - postProcessStart) / 1000).toFixed(2)}s)`);

  // 8.6) Zone matchup enrichment — for the top N batters per game, fetch
  // batter ISO-by-zone + opposing pitcher's location-frequency-by-zone,
  // compute matched zones + Zone Rating, and attach as `zoneMatchup` on
  // the row. Handles opener games by resolving the predicted bulk pitcher
  // (see fetch-zone-matchup.mjs).
  //
  // Cost: ~5 batters × 15 games = 75 batter API calls + 15 pitcher Savant
  // calls per cron run. Opener probes add 1 call per pitcher (~30 more)
  // and bulk resolution adds ~3 boxscore calls per opener game (~5-10
  // games × 3 = ~30 more). Total ~150 API calls per cron run.
  //
  // The in-memory cache in the fetcher module dedupes within a single
  // run (same pitcher across multiple batters in a game = one fetch).
  // Persistent caching (zones change weekly, not every 10 min) is the
  // next optimization — see TODO comment below.
  const zoneStart = Date.now();
  console.log('[slate] enriching top batters with zone matchups…');

  // Warm-start the zone cache from the previous cron's published cache
  // file. Zones change weekly (not every 10 min), so this typically lets
  // ~95%+ of zone lookups hit the cache instead of re-fetching from MLB /
  // Savant — huge reduction in API load. First-ever run (no cache in R2
  // yet) is the cold start where everything gets pulled fresh.
  const priorZoneCache = await fetchFromR2(ZONE_CACHE_URL);
  if (priorZoneCache) {
    const primed = primeZoneCache(priorZoneCache);
    console.log(`[slate] zone cache primed: ${primed} entries from prior run`);
  } else {
    console.log('[slate] no prior zone cache in R2 — cold start');
  }

  // Helper: resolve a pitcher's hand. First try the in-memory hands map
  // populated for all probable starters; fall back to MLB people lookup
  // for bulk pitchers we discover dynamically.
  const resolvePitcherHand = async (pid) => {
    if (pitcherHands[pid]) return pitcherHands[pid];
    try {
      const data = await mlbGet(`/people/${pid}`);
      return data?.people?.[0]?.pitchHand?.code || null;
    } catch { return null; }
  };

  // 25 covers a typical batting order (9) plus any bench bats who might
  // pinch-hit or platoon in. We expanded from 5 to 25 once zone matchup
  // started feeding the probability score — limiting to top-5 meant a
  // mid-lineup batter who'd benefit from a Zone Master bonus would never
  // get their zones fetched and would silently lose the boost. 25 ensures
  // every realistic HR candidate has zone data available for ranking.
  // Higher values quickly hit MLB API rate-limit territory; the
  // persistent cache makes this cheap on warmed runs.
  const TOP_N_PER_GAME = 25;
  const zoneJobs = [];

  for (const game of games) {
    // Collect this game's scored batters by composite key, sort by score.
    const gameRows = [];
    for (const key of Object.keys(scoredBatters)) {
      if (!key.includes('-')) continue;
      const gpk = +key.split('-')[1];
      if (gpk !== game.gamePk) continue;
      const row = scoredBatters[key];
      if (row?.score == null) continue;
      const id = +key.split('-')[0];
      gameRows.push({ id, score: row.score, row });
    }
    gameRows.sort((a, b) => b.score - a.score);
    const topN = gameRows.slice(0, TOP_N_PER_GAME);

    for (const b of topN) {
      const row = b.row;
      const opposing = row.pitcher;
      if (!opposing?.id) continue;

      zoneJobs.push((async () => {
        try {
          const matchup = await buildZoneMatchupForGame({
            batterId:            b.id,
            batterHand:          row.batSide === 'L' ? 'L' : 'R',   // S → R as a default
            probablePitcherId:   opposing.id,
            probablePitcherHand: (opposing.hand === 'L' ? 'L' : 'R'),
            resolvePitcherHand,
          });
          if (matchup) {
            row.zoneMatchup = matchup;
          }
        } catch { /* swallow — zone is enrichment, not critical path */ }
      })());
    }
  }

  // Cap parallelism so we don't hammer MLB / Savant simultaneously.
  // pMap is already in scope and used elsewhere in this file.
  await pMap(zoneJobs, j => j, 6);
  const zoneCount = Object.values(scoredBatters)
    .filter(r => r?.zoneMatchup)
    .length;
  // Half of zoneCount because composite + legacy keys both point to the
  // same row, both end up annotated.
  console.log(`[slate] zone matchup enriched on ${Math.floor(zoneCount / 2)} rows in ${((Date.now() - zoneStart) / 1000).toFixed(2)}s`);

  // 8.65) Zone score bonus pass. The base scoreBatter() model doesn't see
  // zone matchup data — that fetch happens AFTER scoring (zones are
  // expensive and we only enrich the top candidates). So we apply the
  // zone bump as a POST-SCORING adjustment here.
  //
  // Bonus formula (capped at -2..+4 to avoid swamping the base model):
  //   bonus = (zoneRating - 5) * 0.6
  //         + (badge === 'ZONE_MASTER' ? 1.5 : 0)
  //
  // Rationale: zoneRating 5 = neutral matchup, no bump. Rating 8 with
  // Zone Master badge ≈ +3.3 — meaningful but doesn't dominate. Rating
  // 1 with no badge ≈ -2.4, floored to -2. The badge is the structural
  // signal (2+ matched zones) so it gets its own kicker on top of the
  // continuous rating.
  //
  // Re-derives grade from the boosted score so an 80 → 84 PRIME stays
  // PRIME but a 70 → 73 STRONG can promote to PRIME. Stashes zoneBonus
  // on the row so the UI breakdown can show "+N zone bonus" separately
  // from the base composite.
  const zoneScoreStart = Date.now();
  let zoneScoreApplied = 0;
  // Iterate composite keys only — the legacy `${id}` key points at the
  // same row object so mutating once is enough; iterating both keys
  // would apply the bonus twice.
  for (const key of Object.keys(scoredBatters)) {
    if (!key.includes('-')) continue;
    const row = scoredBatters[key];
    const zm  = row?.zoneMatchup;
    if (!zm || !Number.isFinite(zm.zoneRating)) continue;
    if (!Number.isFinite(row.score)) continue;

    // Bonus is computed with fractional precision then rounded to an
    // INTEGER at the end so the final `score` value stays whole. Scores
    // are always rendered as integers everywhere; carrying decimals
    // through the pipeline just created noise like "78.7" in the UI.
    let rawBonus = (zm.zoneRating - 5) * 0.6;
    if (zm.badge === 'ZONE_MASTER') rawBonus += 1.5;
    const bonus = Math.round(Math.max(-2, Math.min(4, rawBonus)));

    if (bonus === 0) continue;

    const newScore = Math.max(0, Math.min(100, Math.round(row.score + bonus)));
    row.zoneBonus    = bonus;
    row.baseScore    = row.score;       // preserved for the breakdown UI
    row.score        = newScore;
    row.grade        = gradeFromScore(newScore);
    zoneScoreApplied++;
  }
  console.log(`[slate] zone bonus applied to ${zoneScoreApplied} rows in ${((Date.now() - zoneScoreStart) / 1000).toFixed(2)}s`);

  // Day rating computed here — BEFORE the PRIME cap — so supply uses the raw
  // PRIME count. The cap is a display cap (prevents board flooding); it must not
  // reduce the supply signal used to gauge slate quality.
  const preCapDayRating = computeDayRating(scoredBatters, games);

  // ─── PRIME relative cap ─────────────────────────────────────────────────────
  // Runs AFTER all pregame score/grade passes (incl. the zone-bonus re-grade
  // above) so it's the final word on the pregame grade, and BEFORE the live-decay
  // freeze so it flows into preGameGrade. PRIME is the ELITE tier; an absolute
  // bar (score ≥72) lets a big/soft slate flood it (66+ on a 14-gamer). Cap PRIME
  // to the top PRIME_PCT of PLAYABLE (non-SKIP) bats by score, demoting the
  // overflow to STRONG so "PRIME" always means the cream regardless of slate
  // size. GRADE LABEL ONLY — score + probability untouched (a demoted bat keeps
  // its 78). Demotes across BOTH snapshot keys (bare playerId + playerId-gamePk).
  const PRIME_PCT = 0.12;
  {
    const seen = new Set();
    const uniq = [];
    for (const k of Object.keys(scoredBatters)) {
      const r = scoredBatters[k];
      if (!r || r.playerId == null) continue;
      const id = `${r.playerId}-${r.gamePk}`;
      if (seen.has(id)) continue;
      seen.add(id);
      uniq.push(r);
    }
    const playable = uniq.filter((r) => (r.grade?.label || r.grade) !== 'SKIP');
    const cap = Math.max(8, Math.round(playable.length * PRIME_PCT));
    const primes = uniq
      .filter((r) => (r.grade?.label || r.grade) === 'PRIME')
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (a.playerId ?? 0) - (b.playerId ?? 0));
    if (primes.length > cap) {
      const demote = new Set(primes.slice(cap).map((r) => `${r.playerId}-${r.gamePk}`));
      const STRONG = gradeFromScore(60); // 60 is solidly inside the STRONG band
      for (const k of Object.keys(scoredBatters)) {
        const r = scoredBatters[k];
        if (r && demote.has(`${r.playerId}-${r.gamePk}`) && (r.grade?.label || r.grade) === 'PRIME') r.grade = STRONG;
      }
      console.log(`[slate] PRIME relative cap: ${primes.length} → ${cap} (top ${(PRIME_PCT * 100).toFixed(0)}% of ${playable.length} playable; demoted ${primes.length - cap} to STRONG)`);
    }
  }

  // 8.68) Live in-game context (Tier-1 live signals — display only)
  //
  // For games currently IN PROGRESS, pull the per-play live feed and
  // attach a `liveContext` to each batter row. The client renders this
  // as visual pills on the player modal:
  //
  //   🎯 JUST MISSED · 2×    barreled non-HR balls (≥100 mph, 18-35°)
  //   ⏱ ~1 AB LEFT           batter running out of chances
  //   ⚠ PULL RISK · blowout  manager likely benching regulars
  //
  // DESIGN NOTE: we deliberately do NOT mutate the score itself.
  // Earlier iterations applied multiplicative + additive math to the
  // score during live games, but the "pre-game lock-in" feel matters
  // more than perfect in-game probability. A user who locked a parlay
  // at PRIME 78 doesn't want to open the app two innings later and see
  // STRONG 55 — even when the math is right, the score-changing-on-me
  // experience reads as a flaky model. Pills convey the same info
  // without contradicting the locked pick: "Soto 78 PRIME · 🎯 JUST
  // MISSED · ⏱ 1 AB LEFT" — number anchored, context surfaced, user
  // makes their own call. Flipping back to score-mutating later is a
  // 10-min change if signals from real users say they want it.
  //
  // Skips pre-game + Final games (nothing to enrich). Pre-game scores
  // stay at their pre-game model output; Final games' results land in
  // homerersByGame via the next block.
  const liveKsByPitcher = {};
  const liveGames = games.filter(g => g.isLive);
  if (liveGames.length) {
    const liveStart = Date.now();
    console.log(`[slate] enriching ${liveGames.length} in-progress game(s) with live context…`);
    let liveTagged = 0;
    let liveNearMisses = 0;
    let livePullRisk = 0;

    const liveResults = await pMap(liveGames, async (g) => ({
      gamePk: g.gamePk,
      ctx:    await fetchLiveGameContext(g.gamePk),
    }), 4);

    for (const { gamePk, ctx } of liveResults) {
      if (!ctx) continue;
      const pullRisk = ctx.runDiff >= 8 && ctx.currentInning >= 5;
      if (pullRisk) livePullRisk++;

      // Expose starter live Ks for the K Brain live inning display.
      for (const [pitcherId, pData] of Object.entries(ctx.perPitcher || {})) {
        liveKsByPitcher[`${pitcherId}-${gamePk}`] = pData;
      }

      // Iterate composite keys only (`${id}-${gamePk}`) — legacy bare-id
      // keys are a back-compat mirror; tagging only composite keeps the
      // snapshot internally consistent without double-tagging.
      for (const key of Object.keys(scoredBatters)) {
        if (!key.includes('-')) continue;
        const [pidStr, gpkStr] = key.split('-');
        if (+gpkStr !== gamePk) continue;
        const row = scoredBatters[key];
        if (!row || !Number.isFinite(row.score)) continue;

        const live = ctx.perBatter[+pidStr] || { abCount: 0, nearMissHR: 0, isHRThisGame: false };
        if (live.nearMissHR > 0) liveNearMisses++;

        // Compute expectedRemainingABs for the AB-LEFT pill (display only).
        const expectedRemainingABs = Math.max(0, 4 - live.abCount);

        // PA-remaining Bayesian decay: as the game progresses, a batter's
        // remaining HR probability falls proportionally to remaining PAs.
        // Preserve the original pre-game score AND grade on the row so:
        //   1. PlayerDetailModal can show both values ("pregame 78 → live 36").
        //   2. Clients with the "Update Rankings Live" toggle OFF can swap
        //      back to the pregame values mid-game without needing to have
        //      cached a pre-game snapshot themselves (the cron may not have
        //      run before first pitch on the user's session).
        // Batters who already homered skip decay (they're filtered separately).
        if (!live.isHRThisGame) {
          const remainingPAs = estimateRemainingPAs(row.battingOrder, ctx.currentInning);
          const decayedScore = applyPADecay(row.score, remainingPAs);
          row.preGameScore   = row.score;
          row.preGameGrade   = row.grade;
          row.score          = decayedScore;
          row.grade          = gradeFromScore(decayedScore);
        }

        row.liveContext = {
          nearMissHR:           live.nearMissHR,
          abCount:              live.abCount,
          expectedRemainingABs,
          isHRThisGame:         live.isHRThisGame,
          pullRisk,
          currentInning:        ctx.currentInning,
          runDiff:              ctx.runDiff,
        };
        liveTagged++;
      }
    }
    console.log(`[slate] live-context: tagged ${liveTagged} rows (${liveNearMisses} near-miss, ${livePullRisk} pull-risk games) in ${((Date.now() - liveStart) / 1000).toFixed(2)}s`);
  }
  // 8.7) For TODAY's Final games, fetch box scores to determine which
  // batters actually homered. The UI uses this to show an "HR ✓" indicator
  // next to players on completed game cards so users can see results at a
  // glance instead of having to dig. Shape: { [gamePk]: [playerId, ...] }.
  // Cheap because final-game count per slate is usually 0-3 by the time
  // most users open the app.
  const homerersByGame = {};
  const todaysFinals = games.filter(g => g.isFinal);
  if (todaysFinals.length) {
    console.log(`[slate] fetching HR results for ${todaysFinals.length} final game(s)…`);
    await pMap(todaysFinals, async (g) => {
      try {
        const bs = await mlbGet(`/game/${g.gamePk}/boxscore`);
        const ids = [];
        for (const side of ['home', 'away']) {
          const players = bs?.teams?.[side]?.players || {};
          for (const p of Object.values(players)) {
            const hr = p?.stats?.batting?.homeRuns;
            if (Number.isFinite(hr) && hr > 0 && p?.person?.id) {
              ids.push(p.person.id);
            }
          }
        }
        homerersByGame[g.gamePk] = ids;
      } catch {
        // On failure, leave the entry undefined — the UI just won't show
        // HR checkmarks for that game. Better than a blank slate.
      }
    }, 4);
    const totalHomers = Object.values(homerersByGame).reduce((a, b) => a + b.length, 0);
    console.log(`[slate] ${totalHomers} total HRs across ${Object.keys(homerersByGame).length} final game(s)`);
  }

  // 8.75) Settle FINAL games.
  //
  // Once a game ends the HR-likelihood score is moot: a batter who didn't homer
  // has zero chances left, so their live score must be 0. Without this, Final
  // games revert to their full pre-game model score — every cron run re-scores
  // from scratch and the live PA-decay block (8.68) only touches IN-PROGRESS
  // games, so a finished no-HR player would pop back up to their pre-game value
  // (e.g. a 100) and read as a top pick even though the game is over.
  //
  // Mirror the live-decay block: mutate `score` for display but preserve
  // `preGameScore` / `preGameGrade` so the modal can still show the prediction
  // and the backtest/reconcile keeps the original call. Homerers settle to 0 too
  // (the game is over — no more chances for anyone) but are flagged via
  // homeredThisGame / homerersByGame so the UI still shows the HR✓ result.
  if (todaysFinals.length) {
    const finalPks = new Set(todaysFinals.map(g => g.gamePk));
    let settled = 0;
    for (const key of Object.keys(scoredBatters)) {
      if (!key.includes('-')) continue;            // composite keys only (matches 8.68)
      const [pidStr, gpkStr] = key.split('-');
      if (!finalPks.has(+gpkStr)) continue;
      const row = scoredBatters[key];
      if (!row || !Number.isFinite(row.score)) continue;
      const homered = (homerersByGame[+gpkStr] || []).includes(+pidStr);
      row.gameFinal       = true;
      row.homeredThisGame = homered;
      if (row.preGameScore == null) { row.preGameScore = row.score; row.preGameGrade = row.grade; }
      row.score = 0;
      row.grade = gradeFromScore(0);
      settled++;
    }
    console.log(`[slate] settled ${settled} final-game row(s) to score 0`);
  }

  // 8.9) Calibrated HR probability — map each batter's FINAL score through the
  // isotonic table so the displayed "% to homer", fair odds, model-vs-book EDGE
  // and BestTwoMan EV all use the empirically-calibrated rate from the rolling
  // backtest instead of the raw per-PA sim. The reliability curve showed the
  // sim was under-confident at the top (predicting ~24% where PRIME batters
  // actually homer ~37%); the isotonic table fixes that. Raw sim preserved as
  // simHRProb. Applied AFTER all score mutations (calibration, vegas, zone,
  // live-decay, final settlement) so live/finished games get the right
  // decayed/zeroed probability too.
  if (scoreToProbTable?.table?.length) {
    const linFallback = (s) => Math.max(0.005, Math.min(0.30, 0.025 + s * 0.0015));
    const calibratedRowObjs = [];
    for (const key of Object.keys(scoredBatters)) {
      if (!key.includes('-')) continue;   // composite keys only — the bare `id`
      const row = scoredBatters[key];     // alias points at the SAME object, so
      if (!row || !Number.isFinite(row.score)) continue; // process each once (else
      if (row.simHRProb === undefined) {  // sim-resolution sees it twice → NaN).
        row.simHRProb = Number.isFinite(row.hrProbability) ? row.hrProbability : null;
      }
      const ruleProb = lookupProb(row.score, scoreToProbTable.table,
        () => (Number.isFinite(row.simHRProb) ? row.simHRProb : linFallback(row.score)));
      // Ensemble (probability-level): blend in the ML stacker's prob to the
      // extent the holdout gate earned it. row.mlScore maps back to prob via the
      // same /0.28 convention scoreWithML used. ensembleMeta.mlWeight is 0
      // unless the ML beat the rule model out-of-sample — so this is a no-op
      // until proven, and never touches the score/grade distribution.
      let calProb = ruleProb;
      if (ensembleMeta.mlWeight > 0 && Number.isFinite(row.mlScore)) {
        const mlProb = Math.max(0.005, Math.min(0.30, row.mlScore / 100 * 0.28)); // 0.28 = PROB_AT_MAX_SCORE; matches ensemble.mjs prob/0.28 round-trip
        calProb = (1 - ensembleMeta.mlWeight) * ruleProb + ensembleMeta.mlWeight * mlProb;
      }
      // Store the calibrated LEVEL as the anchor, then let sim-resolution refine
      // the ranking within each score bucket below. Default hrProbability to the
      // anchor so rows without a usable sim (or in tiny buckets) keep it.
      row._anchorProb   = calProb;
      row.hrProbability = calProb;
      calibratedRowObjs.push(row);
    }

    // Sim-resolution: spread probabilities within each score bucket by the
    // AB-by-AB sim (simHRProb) WITHOUT moving the bucket mean — keeps the
    // isotonic calibration intact but restores ranking at the flat top/bottom
    // of the table where many players otherwise share an identical probability.
    const simRes = applySimResolution(calibratedRowObjs, { table: scoreToProbTable.table, lookupProb });
    for (const row of calibratedRowObjs) delete row._anchorProb;
    console.log(`[calib] applied isotonic HR-prob to ${calibratedRowObjs.length} scored rows; ` +
      `sim-resolution refined ${simRes.adjusted} across ${simRes.buckets} buckets`);
  }

  // Safety net — a scored row must never ship a null/NaN headline probability
  // (a degraded calibration step would otherwise leave the board blank). Backfill
  // Prefer the CALIBRATED isotonic value (what the main pass would have set),
  // then the raw sim, then a gentle score-linear prior. (Backfilling from raw
  // sim alone would ship the under-confident pre-calibration probability.)
  {
    const linFallback = (s) => Math.max(0.005, Math.min(0.3, 0.025 + s * 0.0015));
    let patched = 0;
    for (const key of Object.keys(scoredBatters)) {
      if (!key.includes('-')) continue; // composite keys only — the bare-id alias is the SAME object (matches every sibling loop; avoids the double-counted patched tally and the dual-key NaN trap if this ever becomes non-idempotent)
      const row = scoredBatters[key];
      if (!row || !Number.isFinite(row.score) || Number.isFinite(row.hrProbability)) continue;
      row.hrProbability = scoreToProbTable?.table?.length
        ? lookupProb(row.score, scoreToProbTable.table, (s) => (Number.isFinite(row.simHRProb) ? row.simHRProb : linFallback(s)))
        : Number.isFinite(row.simHRProb)
          ? row.simHRProb
          : linFallback(row.score);
      patched++;
    }
    if (patched) console.warn(`[calib] safety-net: backfilled ${patched} null/NaN hrProbability row(s)`);
  }

  // 8.85) Morning score lock — one scoring pass a day.
  // The first run at/after MORNING_LOCK_HOUR (UTC, default 13 ≈ 9am ET)
  // freezes every pregame batter's model outputs into the persisted log;
  // every later run re-publishes those frozen values instead of its own.
  // What still flows intraday: lineup confirmations, batting order,
  // scratches, odds, game state, live context — the FACTS. What no longer
  // churns: score, grade, probability, reasons — the TAKES. Exception: a
  // CHANGED starting pitcher invalidates the frozen matchup, so those
  // batters keep the fresh run's values and get pitcherChanged: true.
  // Runs before the morning cutoff float freely (probables/weather still
  // settling). Disable with MORNING_LOCK=0; move the cutoff with
  // MORNING_LOCK_HOUR. Live/final rows are skipped — the live-decay and
  // per-batter pregame-freeze passes own those.
  const MORNING_LOCK_ON = (process.env.MORNING_LOCK ?? '1') !== '0';
  const MORNING_LOCK_HOUR = +(process.env.MORNING_LOCK_HOUR ?? 13);
  // parkWeatherHandFactor is in the lock because it feeds the combo engine's
  // park strategy (rank score×air, gate air≥1.08): left floating, each 15-min
  // weather refresh could reorder park-combo legs all day while the scores
  // built FROM that same weather sat frozen. One lock, one story.
  const LOCK_FIELDS = ['score', 'grade', 'rating', 'hrProbability', 'simHRProb', 'expectedHRs', 'ensembleScore', 'batterScore', 'matchupScore', 'envScore', 'reasons', 'eli5Reasons', 'parkWeatherHandFactor'];
  if (MORNING_LOCK_ON) try {
    const gameByPk = new Map((games || []).map((g) => [g.gamePk, g]));
    const started = (pk) => { const g = gameByPk.get(pk); return !!(g && (g.isLive || g.isFinal)); };
    const ml = backtestLog.morningLock;
    if (ml?.date === date && ml.rows) {
      let frozen = 0, changed = 0;
      for (const key of Object.keys(scoredBatters)) {
        if (!key.includes('-')) continue; // bare-id alias is the SAME object
        const row = scoredBatters[key];
        if (!row || row.playerId == null || started(row.gamePk)) continue;
        const f = ml.rows[`${row.playerId}-${row.gamePk}`];
        if (!f) continue; // late-added batter — fresh values stand
        if ((row.pitcher?.id ?? null) !== (f.pitcherId ?? null)) { row.pitcherChanged = true; changed++; continue; }
        for (const k of LOCK_FIELDS) if (f[k] !== undefined) row[k] = f[k];
        frozen++;
      }
      console.log(`[lock] morning lock (${ml.at}): ${frozen} rows frozen, ${changed} kept fresh on pitcher change`);
    } else if (new Date().getUTCHours() >= MORNING_LOCK_HOUR) {
      const rows = {};
      for (const key of Object.keys(scoredBatters)) {
        if (!key.includes('-')) continue;
        const row = scoredBatters[key];
        if (!row || row.playerId == null || started(row.gamePk)) continue;
        const id = `${row.playerId}-${row.gamePk}`;
        if (rows[id]) continue;
        const f = { pitcherId: row.pitcher?.id ?? null };
        for (const k of LOCK_FIELDS) if (row[k] !== undefined) f[k] = row[k];
        rows[id] = f;
      }
      if (Object.keys(rows).length) {
        backtestLog.morningLock = { date, at: new Date().toISOString(), rows };
        console.log(`[lock] morning board locked at ${backtestLog.morningLock.at} (${Object.keys(rows).length} batters)`);
      }
    }
  } catch (e) { console.warn(`[lock] morning lock skipped: ${e?.message}`); }

  // 8.9) Pregame freeze. The Live/Pregame view toggle is display-only — it
  // hides live scores/innings but the model's recent-form stats (and Heat Index)
  // legitimately absorb today's in-progress results on each refresh (a player who
  // homers mid-game gets hotter). To make the board a stable pre-first-pitch
  // snapshot, once a batter's game is LIVE we restore his last pregame model/form
  // values, keeping only liveContext fresh. FINAL games are left untouched — the
  // earlier "Settle FINAL games" pass intentionally zeroes finished non-homerers,
  // and restoring their pregame score would float them back to the top of the
  // board. State persists across cron runs via Actions cache (keyed by date).
  try {
    const liveByGame  = new Map(games.map(g => [g.gamePk, g.isLive  === true]));
    const finalByGame = new Map(games.map(g => [g.gamePk, g.isFinal === true]));
    let prior = null;
    try { if (existsSync(FREEZE_OUT_PATH)) prior = JSON.parse(readFileSync(FREEZE_OUT_PATH, 'utf8')); } catch {}
    const priorByKey = prior && prior.date === date ? (prior.byKey || {}) : {};
    const nextByKey = {};
    let stored = 0, frozen = 0;
    for (const key of Object.keys(scoredBatters)) {
      if (!key.includes('-')) continue; // bare-id alias points at the SAME object
      const row = scoredBatters[key];
      if (!row || row.playerId == null) continue;
      const live  = liveByGame.get(row.gamePk)  === true;
      const final = finalByGame.get(row.gamePk) === true;
      if (!live && !final) {
        // Persist the pitch-mix score as a SCALAR while pitchTypeSplits still
        // exist on the row — end-of-day final rows lose the raw splits array,
        // which left the reconcile log's `pm` field null on every record.
        if (!Number.isFinite(row.pmScore)) {
          const s = pitchMixScore(row);
          if (Number.isFinite(s)) row.pmScore = +s.toFixed(3);
        }
        const { liveContext, ...rest } = row; // pregame: snapshot pre-first-pitch values
        nextByKey[key] = rest;
        stored++;
      } else if (priorByKey[key]) {
        const snap = priorByKey[key];
        if (live) {
          const lc = row.liveContext;
          Object.assign(row, snap); // live: restore frozen model/form fields for display
          if (lc !== undefined) row.liveContext = lc; // keep live context fresh
        }
        // Pin the LOGGED prediction (preGameScore/Grade — what reconcile + the
        // Results view read) to the TRUE pre-first-pitch snapshot, for BOTH live
        // and final games. Without this, preGameScore was re-derived from the
        // live-decayed / post-game recompute on every refresh, so the backtest
        // logged a drifted score (the board showed the frozen 87 while the log
        // captured ~80) — quietly under-calibrating started-game bats. FINAL rows
        // keep their settled score (0) on the board; only the logged fields move.
        row.preGameScore = snap.score;
        row.preGameGrade = snap.grade;
        // Same freeze treatment for the raw pregame sim: carry the frozen
        // pre-first-pitch simHRProb forward for FINAL games too. The LIVE branch
        // above already restored it via Object.assign(row, snap), but FINAL rows
        // were left with the post-game re-scored sim (the row is re-scored each
        // cron off stats that now include the game's results), polluting the
        // sim-resolution training signal. Only restore when the snapshot actually
        // carried one, so never-live (e.g. postponed) rows keep their own value.
        if (Number.isFinite(snap.simHRProb)) row.simHRProb = snap.simHRProb;
        if (Number.isFinite(snap.pmScore)) row.pmScore = snap.pmScore; // pitch-mix scalar survives to the post-Final snapshot reconcile reads
        nextByKey[key] = snap; // carry forward through final too, so it survives to the post-Final snapshot reconcile reads
        frozen++;
      }
    }
    mkdirSync(dirname(FREEZE_OUT_PATH), { recursive: true });
    writeFileSync(FREEZE_OUT_PATH, JSON.stringify({ date, byKey: nextByKey }));
    console.log(`[freeze] ${stored} pregame snapshotted, ${frozen} started-game batters frozen to pre-first-pitch`);
  } catch (e) {
    console.warn('[freeze] skipped:', e.message);
  }

  // 9) Assemble final payload
  // ── 8.95) HR prop odds (The Odds API) ──────────────────────────────────
  // payload.odds never existed before this — the UI's whole odds layer
  // (books, best price, +EV, edge) was dormant plumbing. Snapshot is cached
  // in the persisted log and refreshed at most every ODDS_REFRESH_MINUTES
  // (each refresh ≈ 1 credit per pregame game), so the 15-min cron doesn't
  // burn API credits. No key → board ships without prices, as before.
  let oddsByGamePk = {};
  try {
    const oddsKey = process.env.ODDS_API_KEY;
    const refreshMin = +(process.env.ODDS_REFRESH_MINUTES ?? 120);
    const cache = backtestLog.oddsCache;
    if (cache?.date === date) oddsByGamePk = cache.odds || {};
    // An EMPTY cached snapshot is never fresh — one pre-props morning save
    // must not block retries for the whole refresh window (bit us 2026-07-04:
    // a pre-fix run cached {} at 12:32 and the 1440-min window sat on it).
    const cacheFresh = cache?.date === date
      && Object.keys(cache.odds || {}).length > 0
      && Date.now() - Date.parse(cache.at) < refreshMin * 60_000;
    const anyPregame = games.some((g) => !g.isLive && !g.isFinal);
    if (oddsKey && cacheFresh) {
      console.log(`[odds] using cached snapshot from ${cache.at} (${Object.keys(oddsByGamePk).length} games)`);
    }
    if (oddsKey && !cacheFresh && anyPregame) {
      const { oddsByGamePk: got, remaining, priced, matched, debugSample } = await fetchHROdds(oddsKey, games);
      if (priced === 0 && debugSample) console.log(`[odds] diagnosis — ${matched} events matched, 0 priced; first response: ${debugSample}`);
      // Merge over the cache: started games keep their last pregame prices.
      oddsByGamePk = { ...oddsByGamePk, ...got };
      // Only start the refresh clock when the fetch actually priced games.
      // Books post batter_home_runs mid-morning; caching an early-morning
      // empty result would otherwise block retries for the whole window.
      // Empty pulls are free (The Odds API charges per market RETURNED), so
      // retrying every run until props post costs nothing.
      if (priced > 0) backtestLog.oddsCache = { date, at: new Date().toISOString(), odds: oddsByGamePk };
      console.log(`[odds] The Odds API: ${priced} games priced this refresh, ${Object.keys(oddsByGamePk).length} total (credits remaining: ${remaining ?? '?'})`);
    } else if (!oddsKey) {
      console.log('[odds] ODDS_API_KEY not set — board ships without market prices');
    }
  } catch (e) { console.warn(`[odds] fetch skipped: ${e?.message}`); }

  // Attach the market's implied HR prob to each row (mean of 1/decimal across
  // books). Feeds the reconcile log's `vig` — the field whose 94-of-7197
  // coverage blocked every odds-edge validation to date. Deliberately NOT a
  // morning-locked field: the market keeps moving, and frozen-model-vs-live-
  // market is exactly what the +EV signal should measure.
  try {
    const nrmName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const idxByPk = new Map();
    for (const [pk, og] of Object.entries(oddsByGamePk)) {
      const m = new Map();
      for (const players of Object.values(og.books || {})) {
        for (const [name, price] of Object.entries(players)) {
          if (!(price?.decimal > 1)) continue;
          const k = nrmName(name);
          if (!m.has(k)) m.set(k, []);
          m.get(k).push(1 / price.decimal);
        }
      }
      idxByPk.set(Number(pk), m);
    }
    let attached = 0;
    for (const key of Object.keys(scoredBatters)) {
      if (!key.includes('-')) continue; // bare-id alias is the SAME object
      const row = scoredBatters[key];
      const imps = idxByPk.get(row?.gamePk)?.get(nrmName(row?.name));
      if (imps?.length) { row.vegasImpliedProb = imps.reduce((s, x) => s + x, 0) / imps.length; attached++; }
    }
    if (attached) console.log(`[odds] vegasImpliedProb attached to ${attached} rows`);
  } catch (e) { console.warn(`[odds] implied-prob attach skipped: ${e?.message}`); }

  const payload = {
    version:     4,
    generatedAt: startedAt.toISOString(),
    finishedAt:  new Date().toISOString(),
    date,
    games,
    lineupsByGame,
    rosterByTeam,
    batterStats,
    pitcherStats,
    bullpenHR9,
    weatherByGame,
    // HR prop prices per game/book (The Odds API) — drives the board's odds
    // column, best-price display, +EV chips and parlay EV math client-side.
    odds: oddsByGamePk,

    // For Final games today: which players actually hit a HR.
    // Shape: { [gamePk]: [playerId, ...] }. Empty when no games are
    // finished yet. UI shows "HR ✓" next to these players' rows on the
    // completed game card.
    homerersByGame,

    // Phase-2 additions — cover the per-device-divergent endpoints that
    // previously caused subtle score differences between users.
    pitcherRecentForm,   // per-pitcher last-5-starts gameLog
    pitcherHands,        // { pid: 'L'|'R' } — switch-hitter split resolution
    savantBatter,        // ALL qualified batters (replaces narrow savantByPlayer)
    savantPitcher,       // league-wide pitcher contact-quality + zone data
    pitcherPitchMix,     // pitch arsenal usage / RV / shape per pitcher
    pitcherXStats,       // xERA / xwOBA per pitcher
    batterArsenal,       // batter SLG / RV / whiff% by pitch type
    batter30Game,        // 30-game rolling stats per batter (Who's Due calc)
    batter7Game,         // 7-game rolling stats per batter (hot-bat signal)
    dayNightSplits,      // day vs night splits per batter
    homeAwaySplits,      // home vs away splits per batter
    bullpenSplits,       // sp vs rp splits per batter (Bullpen Legend flag)
    h2h,                 // { "<bid>-<pid>": { ab, hr, avg, slg, ops, k } } — career B vs P
    catcherFraming,      // { [catcherId]: { framingRuns, framingPct } } — catcher strike-stealing ability

    // Phase-3: PRE-SCORED batters — server runs the same scoreBatter() the
    // mobile app does, so every device reads identical scores from this
    // snapshot. The per-device scoring loop becomes a fallback for when the
    // snapshot is missing/stale.
    scoredBatters,       // { [playerId]: { score, grade, badges, reasons, sim, ... } }

    // ─── Math improvements (Tier 1) ──────────────────────────────────────
    // scoreToProb: isotonic calibration table mapping raw score buckets
    // (0-10, 10-20, …, 90-100) to observed hit rate from the rolling
    // 30-day backtest. Every downstream consumer that needs a probability
    // (BestTwoMan EV, CalibrationStrip) should call lookupProb(score, ...)
    // instead of the rough linear approximation.
    scoreToProb:   scoreToProbTable,     // { table, totalN, fittedAt } | null
    // modelMetrics: Brier + log-loss + reliability curve from last 30
    // days of reconciled records. Shown on ModelPerformance screen.
    modelMetrics,                        // { brier, logLoss, reliability, ... } | null

    // comboScorecard: rolling hit rate of the canonical PREGAME parlay combos
    // (one per strategy per size), graded against actual HR outcomes. The real,
    // accumulating answer to "have our combos hit?" — see server/parlay-combos.mjs.
    comboScorecard: comboScorecard(backtestLog),  // { days, overall, byStrategy, bySize }
    // Day Rating (1-5★) — "should I bet HR props today?" gauge.
    dayRating: preCapDayRating,

    // ensembleMeta: out-of-sample holdout comparison of the ML stacker vs the
    // rule model, and the gated blend weight actually applied to scores.
    // mlWeight is 0 until the ML beats the rule model on the holdout.
    ensembleMeta,                        // { mlWeight, ruleHoldoutBrier, mlHoldoutBrier, holdoutN, reason }

    // Diagnostic counters so the app can show "Backend snapshot · 14 games"
    // in the slate-header status pill if we want.
    stats: {
      games:                games.length,
      batters:              Object.keys(batterStats).length,
      pitchers:             Object.keys(pitcherStats).length,
      withWeather:          Object.keys(weatherByGame).length,
      withSavantBatter:     Object.keys(savantBatter).length,
      withSavantPitcher:    Object.keys(savantPitcher).length,
      withPitchMix:         Object.keys(pitcherPitchMix).length,
      withPitcherXStats:    Object.keys(pitcherXStats).length,
      withBatterArsenal:    Object.keys(batterArsenal).length,
      withBatter30Game:     Object.keys(batter30Game).length,
      withBatter7Game:      Object.keys(batter7Game).length,
      withDayNightSplits:   Object.keys(dayNightSplits).length,
      withHomeAwaySplits:   Object.keys(homeAwaySplits).length,
      withBullpenSplits:    Object.keys(bullpenSplits).length,
      withPitcherRecentForm: Object.keys(pitcherRecentForm).length,
      withPitcherHands:     Object.keys(pitcherHands).length,
      withH2H:              Object.keys(h2h).length,
      withCatcherFraming:   Object.keys(catcherFraming).length,
      scoredBatters:        Object.keys(scoredBatters).length,
      // Calibration snapshot — what multipliers were applied to today's
      // scoring run. samples<1500 = bootstrapping; ready:true = active.
      calibration: {
        samples:    calibration.samples,
        ready:      calibration.ready === true,
        badges:     calibration.badges,
        grades:     calibration.grades,
        computedAt: calibration.computedAt,
        backtestDays: backtestLog?.dates?.length || 0,
      },
      // The event name that triggered this run — useful when correlating
      // with the gate logic (push/schedule/workflow_dispatch).
      triggerEvent:         process.env.GITHUB_EVENT_NAME || 'local',
      nanFallbacks:         nanDebug.length,
    },

    // Diagnostic: full inputs for every batter whose scoreBatter returned
    // a non-finite composite. Lets us pull the file from R2, run
    // `node server/replay-nan.mjs <playerId>` locally, and find the
    // offending factor without needing Actions log access. Capped to keep
    // the snapshot small (typically ~58/381 ≈ 15% trip the fallback, and
    // each entry is ~6 KB → ~350 KB worst case). Empty array when no
    // batter tripped — that's the goal state.
    _nanDebug: nanDebug.slice(0, 100),

    // Live K counts per pitcher, keyed by `${pitcherId}-${gamePk}`.
    // { ks: number, ip: number|null } — populated for in-progress games.
    liveKsByPitcher,
  };

  // ─── Server-side K-distribution pre-computation ──────────────────────────
  // Group scoredBatters by pitcher (pitcherId-gamePk) and compute kDist for
  // each. Mirrors the client-side kBrain() so the UI can use the pre-computed
  // value directly from daily.json instead of recomputing on every render.
  try {
    const kDistByPitcher = {};
    const pitcherGroups = new Map();
    for (const row of Object.values(payload.scoredBatters || {})) {
      if (!row?.pitcher?.id || row.gamePk == null) continue;
      const key = `${row.pitcher.id}-${row.gamePk}`;
      if (!pitcherGroups.has(key)) pitcherGroups.set(key, { pitcher: row.pitcher, targets: [] });
      pitcherGroups.get(key).targets.push(row);
    }
    for (const [key, { pitcher, targets }] of pitcherGroups) {
      const gamePk = targets[0]?.gamePk;
      const weather     = gamePk != null ? (weatherByGame[gamePk] || null) : null;
      const umpire      = targets[0]?.umpire || null;
      const parkFactorK = pitcher?.gameParkKFactor ?? 1.0;
      const kd = computeKDist(pitcher, targets, { weather, umpire, parkFactorK });
      if (kd) kDistByPitcher[key] = kd;
    }
    payload.kDistByPitcher = kDistByPitcher;
    console.log(`[kbrain] computed K dist for ${Object.keys(kDistByPitcher).length} pitchers`);
  } catch (e) { console.warn(`[kbrain] skipped: ${e?.message}`); }

  // ─── Data-quality flags ──────────────────────────────────────────────────
  // Surface anomalies that would silently degrade scores: missing weather
  // for outdoor games, doubleheader games with too few scored batters
  // (the bug we hit before composite keys), batters with unrealistic
  // season HR rates (usually small-sample early-season noise that should
  // be capped). StatRecap can render these so any drift gets caught
  // morning-after instead of being noticed weeks later.
  const composedScoredKeys = Object.keys(scoredBatters).filter(k => k.includes('-'));
  const compositeByGame = composedScoredKeys.reduce((acc, k) => {
    const gpk = k.split('-')[1];
    acc[gpk] = (acc[gpk] || 0) + 1;
    return acc;
  }, {});
  const _qaFlags = {
    outdoorGamesMissingWeather: games
      .filter(g => g.venueName && !weatherByGame[g.gamePk])
      .map(g => `${g.awayTeam.abbr}@${g.homeTeam.abbr} (${g.gamePk})`),
    gamesWithFewScoredBatters: games
      .filter(g => (compositeByGame[g.gamePk] ?? 0) < 5 && !g.isFinal)
      .map(g => `${g.awayTeam.abbr}@${g.homeTeam.abbr} (${g.gamePk}, ${compositeByGame[g.gamePk] ?? 0} batters)`),
    insaneHrRate: Object.entries(batterStats)
      .filter(([, b]) => b?.season?.ab >= 50 && b?.season?.hrRate > 0.20)
      .map(([id, b]) => `${b.name} (${id}, ${(b.season.hrRate * 100).toFixed(1)}% on ${b.season.ab} AB)`)
      .slice(0, 20),
    nanFallbacks: nanDebug.length,
    // Games whose venue isn't in the park-factor table → silently scored at a
    // NEUTRAL park (PF 1.0). Park is one of the largest env inputs, so a missed
    // launch pad (e.g. a venue rename or new park) would under-rate everyone in
    // that game with no other signal. Surfaced so it reads as a park-table gap,
    // not a weather problem.
    gamesMissingStadium: games
      .filter(g => g.venueName && !findStadium(g.venueName))
      .map(g => `${g.awayTeam?.abbr}@${g.homeTeam?.abbr} (${g.gamePk}, ${g.venueName})`),
  };
  payload._qaFlags = _qaFlags;

  // ─── Cron freshness lint ─────────────────────────────────────────────────
  // Single-line summary line that GitHub Actions logs. Easy to grep across
  // historical runs to spot when something started silently shipping empty.
  console.log(`[slate-qa] games=${games.length} sb=${composedScoredKeys.length} weather=${Object.keys(weatherByGame).length} dh-empty=${_qaFlags.gamesWithFewScoredBatters.length} no-weather=${_qaFlags.outdoorGamesMissingWeather.length} no-stadium=${_qaFlags.gamesMissingStadium.length} nan=${nanDebug.length}`);

  // Hard-fail the cron when the most-critical sections come back empty
  // despite there being games to score. This catches silent regressions
  // like the API key expiring or a schema change wiping a field — better
  // to fail loud than to ship a broken snapshot that bricks every device.
  if (games.length > 0) {
    if (composedScoredKeys.length === 0) {
      throw new Error('[slate-qa] FATAL: 0 scored batters despite ' + games.length + ' games. Likely scoring engine failure.');
    }
    if (Object.keys(weatherByGame).length === 0) {
      throw new Error('[slate-qa] FATAL: 0 weather rows despite ' + games.length + ' games. NWS unreachable or all stadium lookups failed?');
    }
  }

  // ── Locked board ──────────────────────────────────────────────────────────
  // The full board is rebuilt every run, so it churns right up until every
  // game has started — exactly when you can no longer bet it. This captures
  // the LAST all-pregame board each run and freezes it the moment the first
  // game goes live (final: true, never overwritten again). Published inside
  // daily.json so the Parlay Combos view can show "locked at HH:MM" with the
  // exact combos that were still fully bettable.
  try {
    backtestLog.combos = backtestLog.combos || {};
    const lbMap = backtestLog.combos.lockedByDate = backtestLog.combos.lockedByDate || {};
    const anyStarted = (payload.games || []).some((g) => g.isLive || g.isFinal);
    if (!anyStarted) {
      const seenL = new Set();
      const lockCr = [];
      for (const r of Object.values(payload.scoredBatters || {})) {
        if (r.playerId == null || seenL.has(r.playerId)) continue;
        seenL.add(r.playerId);
        const x = comboRowFromSnapshot(r);
        if (x) lockCr.push(x);
      }
      const board = buildComboRecords(lockCr).map((c) => ({ strategy: c.strategy, size: c.size, legs: c.legs }));
      if (board.length) lbMap[date] = { at: new Date().toISOString(), final: false, combos: board };
    } else if (lbMap[date] && !lbMap[date].final) {
      lbMap[date] = { ...lbMap[date], final: true };
      console.log(`[combo] locked board for ${date} frozen (captured ${lbMap[date].at}, ${lbMap[date].combos.length} combos)`);
    }
    const lk = Object.keys(lbMap).sort();
    for (const d of lk.slice(0, -14)) delete lbMap[d];
    payload.lockedBoard = lbMap[date] || null;
  } catch (e) { console.warn(`[combo] locked-board capture skipped: ${e?.message}`); }
  // Morning-lock stamp — lets the UI show "scores locked HH:MM" so the user
  // knows the board they're reading won't shift under them.
  payload.morningLockAt = backtestLog?.morningLock?.date === date ? backtestLog.morningLock.at : null;

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, JSON.stringify(payload));
  const sizeKB = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(`[slate] wrote ${OUT_PATH} (${sizeKB} KB) — took ${((Date.now() - startedAt.getTime()) / 1000).toFixed(1)}s`);

  // Capture this run's bettable combo board into the intraday history, and stash
  // the latest bettable board (≥2 pregame games) in the log as the "evening
  // board" — what you could actually still bet late, after day games started.
  // Overwrites each run, so by EOD it holds the last (latest) bettable board; it
  // lives in the persisted log so it survives the daily board-history rollover
  // and reaches the Results page (graded next day vs actual HRs).
  const liveBoard = appendBoardSnapshot(payload.scoredBatters, payload.games, date);
  if (liveBoard && liveBoard.gameCount >= 2 && liveBoard.combos.length) {
    backtestLog.combos = backtestLog.combos || {};
    backtestLog.combos.lateByDate = backtestLog.combos.lateByDate || {};
    backtestLog.combos.lateByDate[date] = liveBoard.combos;
    const keys = Object.keys(backtestLog.combos.lateByDate).sort();
    for (const d of keys.slice(0, -14)) delete backtestLog.combos.lateByDate[d]; // keep ~2 weeks
  }
  // Per-start-window boards (early / late / …) so Results can grade the board you
  // actually bet in each confirmable window — not just the all-slate board.
  const windowBoards = buildWindowBoards(payload.scoredBatters, payload.games);
  if (windowBoards) {
    backtestLog.combos = backtestLog.combos || {};
    backtestLog.combos.windowsByDate = backtestLog.combos.windowsByDate || {};
    backtestLog.combos.windowsByDate[date] = windowBoards;
    const wk = Object.keys(backtestLog.combos.windowsByDate).sort();
    for (const d of wk.slice(0, -14)) delete backtestLog.combos.windowsByDate[d];
    console.log(`[windows] ${date}: ${windowBoards.length} windows (${windowBoards.map((w) => `${w.label}·${w.games}g·${w.combos.length}c`).join(', ')})`);
  }
  // Full board (all games, frozen pregame) captured LIVE every run — overwritten
  // so it ends as the frozen all-slate board. Persisting it (vs only the one-shot
  // next-day grading) lets byDate self-heal if a late game wasn't Final at the
  // rollover. The canonical record the scorecard + Results Full board read.
  try {
    const seenF = new Set();
    const allCr = [];
    for (const r of Object.values(payload.scoredBatters || {})) {
      if (r.playerId == null || seenF.has(r.playerId)) continue;
      seenF.add(r.playerId);
      const x = comboRowFromSnapshot(r);
      if (x) allCr.push(x);
    }
    const fullBoard = buildComboRecords(allCr).map((c) => ({ strategy: c.strategy, size: c.size, legs: c.legs }));
    if (fullBoard.length) {
      backtestLog.combos = backtestLog.combos || {};
      backtestLog.combos.fullByDate = backtestLog.combos.fullByDate || {};
      backtestLog.combos.fullByDate[date] = fullBoard;
      const fk = Object.keys(backtestLog.combos.fullByDate).sort();
      for (const d of fk.slice(0, -14)) delete backtestLog.combos.fullByDate[d];
    }
  } catch (e) { console.warn(`[combo] fullByDate capture skipped: ${e?.message}`); }

  // Same-game parlays (best 2/3 bats per game, frozen pregame) so the Combos
  // page can grade SGPs against actual HRs day-by-day — the cross-game board
  // takes one bat per game and misses the same-game stacks that carry slates.
  try {
    const seenS = new Set();
    const sgpCr = [];
    for (const r of Object.values(payload.scoredBatters || {})) {
      if (r.playerId == null || seenS.has(r.playerId)) continue;
      seenS.add(r.playerId);
      const x = comboRowFromSnapshot(r);
      if (x) sgpCr.push(x);
    }
    const sgps = buildSGPRecords(sgpCr, { sizes: [2, 3] });
    if (sgps.length) {
      backtestLog.combos = backtestLog.combos || {};
      backtestLog.combos.sgpByDate = backtestLog.combos.sgpByDate || {};
      // Freeze-once: first run of the day captures pregame picks. Later runs
      // (in-game, post-game) don't overwrite so the scorecard reflects actual
      // pregame selections, not mid-game board shifts.
      if (!backtestLog.combos.sgpByDate[date]) {
        backtestLog.combos.sgpByDate[date] = sgps;
        const sk = Object.keys(backtestLog.combos.sgpByDate).sort();
        for (const d of sk.slice(0, -14)) delete backtestLog.combos.sgpByDate[d]; // keep ~2 weeks
        console.log(`[sgp] ${date}: froze ${sgps.length} same-game parlays (pregame)`);
      }
    }
  } catch (e) { console.warn(`[sgp] freeze skipped (non-fatal): ${e?.message}`); }

  // K-prop scorecard: freeze today's K estimates so we can grade them tomorrow
  try {
    if (payload.kDistByPitcher && Object.keys(payload.kDistByPitcher).length) {
      backtestLog.kProps = backtestLog.kProps || {};
      backtestLog.kProps.estByDate = backtestLog.kProps.estByDate || {};
      if (!backtestLog.kProps.estByDate[date]) {
        backtestLog.kProps.estByDate[date] = Object.entries(payload.kDistByPitcher)
          .map(([key, kd]) => {
            const [pitcherIdStr, gamePkStr] = key.split('-');
            const sample = Object.values(payload.scoredBatters || {}).find(
              r => String(r.pitcher?.id) === pitcherIdStr && String(r.gamePk) === gamePkStr
            );
            return {
              key,
              pitcherId: Number(pitcherIdStr),
              gamePk: Number(gamePkStr),
              name: sample?.pitcher?.name || '',
              estK: kd.k,
              lo: kd.lo,
              hi: kd.hi,
              lambda: kd.lambda,
              probs: kd.probs,
            };
          });
        const dk = Object.keys(backtestLog.kProps.estByDate).sort();
        for (const d of dk.slice(0, -14)) delete backtestLog.kProps.estByDate[d];
        console.log(`[kbrain] ${date}: froze ${backtestLog.kProps.estByDate[date].length} K estimates`);
      }
    }
  } catch (e) { console.warn(`[kbrain] freeze skipped: ${e?.message}`); }

  // Grade yesterday's K-prop estimates against actual outcomes
  try {
    const kEsts = backtestLog.kProps?.estByDate?.[yesterdayCT];
    if (kEsts?.length && yesterdayOutcomes?.allFinal) {
      if (!backtestLog.kProps.resultsByDate) backtestLog.kProps.resultsByDate = {};
      if (!backtestLog.kProps.resultsByDate[yesterdayCT]) {
        const { outcomes: kOutcomes } = await fetchPitcherKsForDate(yesterdayCT);
        const graded = kEsts.map((e) => {
          const actual = kOutcomes.get(e.key);
          return { ...e, actualK: actual?.k ?? null, actualIP: actual?.ip ?? null };
        }).filter((e) => e.actualK != null);
        backtestLog.kProps.resultsByDate[yesterdayCT] = graded;
        const dk = Object.keys(backtestLog.kProps.resultsByDate).sort();
        for (const d of dk.slice(0, -14)) delete backtestLog.kProps.resultsByDate[d];
        console.log(`[kbrain] graded ${graded.length} K props for ${yesterdayCT}`);
      }
    }
  } catch (e) { console.warn(`[kbrain] grade skipped: ${e?.message}`); }

  // Freeze this run's scoreBatter() inputs alongside the slate so the offline
  // lab (`npm run lab:score`) can re-score engine variants on identical inputs.
  // Separate file — never embedded in daily.json — so the device payload stays
  // lean. Non-fatal: a corpus write failure must never break the slate.
  try {
    const inputsPath = resolve(__dirname, `../dist/inputs-${date}.json`);
    const json = JSON.stringify(inputCorpus);
    writeFileSync(inputsPath, json);
    console.log(`[slate] wrote ${inputCorpus.length} input bundles → dist/inputs-${date}.json (${(json.length / 1024).toFixed(0)} KB)`);
  } catch (e) {
    console.warn(`[slate] could not write input corpus (non-fatal): ${e.message}`);
  }

  // Persist calibration state so tomorrow's cron run reads it back.
  // calibration.json is what setActiveCalibration() consumes at startup.
  // backtest-log.json is the rolling 30-day reconciliation history.
  // Both are uploaded by the same workflow step that uploads daily.json.
  writeFileSync(CALIBRATION_OUT_PATH, JSON.stringify(calibration));
  const finalLogDates = backtestLog?.dates?.length || 0;
  if (finalLogDates < restoredLogDates) {
    console.error(`[slate-qa] backtest-log REGRESSION: final ${finalLogDates} dates < restored ${restoredLogDates} — REFUSING to overwrite (preserving the richer on-disk log so the cache isn't poisoned).`);
  } else {
    writeFileSync(BACKTEST_OUT_PATH, JSON.stringify(backtestLog));
    console.log(`[calib] wrote calibration.json (${(JSON.stringify(calibration).length / 1024).toFixed(1)} KB) + backtest-log.json (${(JSON.stringify(backtestLog).length / 1024).toFixed(1)} KB)`);
  }

  // Persist the zone cache so the next cron run can warm-start instead
  // of re-fetching every batter/pitcher zone heatmap. The cache contains
  // {value, ts} pairs for every batter/pitcher/opener/bulk lookup made
  // this run, including anything primed from the prior cache and not
  // refreshed. 7-day TTL is enforced on prime, so stale entries get
  // dropped automatically.
  const zoneCacheDump = dumpZoneCache();
  const zoneCacheKB   = (JSON.stringify(zoneCacheDump).length / 1024).toFixed(1);
  writeFileSync(ZONE_CACHE_OUT_PATH, JSON.stringify(zoneCacheDump));
  console.log(`[zone] wrote zone-cache.json (${zoneCacheKB} KB, ${Object.keys(zoneCacheDump).length} entries)`);
}

// Loud top-level net for stray async failures (fire-and-forget writes, escaped
// pMap rejections) so a rejection exits non-zero for the Actions gate instead
// of leaving a partial run with an ambiguous exit code.
process.on('unhandledRejection', (err) => {
  console.error('[slate] UNHANDLED REJECTION:', err);
  process.exit(1);
});

main().catch(err => {
  console.error('[slate] FAILED:', err);
  process.exit(1);
});
