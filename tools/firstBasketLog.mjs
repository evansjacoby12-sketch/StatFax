#!/usr/bin/env node
/**
 * firstBasketLog.mjs — append-only prediction log + backtest scorer for the NBA first-basket model.
 *
 * Why this exists: a model can only be judged on predictions that were written down BEFORE tip.
 * This tool snapshots what the model said, records who actually scored first, and scores the
 * model (log loss, Brier, calibration, center-bias check, tip calibration, lineup mismatches).
 *
 * Commands (run from the repo root):
 *   node tools/firstBasketLog.mjs snapshot --games CLE@ATL,SAC@NOP,MEM@POR [--version v3] [--note "..."]
 *   node tools/firstBasketLog.mjs snapshot --from-json my-run.json [--version v3]
 *   node tools/firstBasketLog.mjs result --game SAC@NOP --scorer "Trey Murphy" \
 *        [--tip-winner SAC] [--starters "NOP=Fears,Murphy,Williamson,Jones,Missi"] [--date 2026-10-29]
 *   node tools/firstBasketLog.mjs score [--version v3] [--include-backfill] [--json]
 *
 * Flags: --dir <folder> (default data/first-basket-log), --date YYYY-MM-DD (default: today, local)
 * --backfill marks a snapshot as made AFTER tip; `score` ignores those unless --include-backfill.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { FIRST_BASKET_MODEL_VERSION } from '../src/sports/nba/logic/firstBasketEngine.js';

const DEFAULT_DIR = 'data/first-basket-log';
const PROB_FLOOR = 0.005; // scorer outside the model gets this probability in log loss
const BIN_EDGES = [0, 0.06, 0.09, 0.12, 0.15, 0.2, 1.01];
const MIN_GAMES = 30; // below this, results are noise

/* ───────────────────────────── helpers ───────────────────────────── */

export function normName(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Find one player by full or partial name. Returns null if missing or ambiguous. */
export function matchPlayer(players, input) {
  const q = normName(input);
  if (!q) return null;
  const exact = players.filter(p => normName(p.name) === q);
  if (exact.length === 1) return exact[0];
  const partial = players.filter(p => {
    const n = normName(p.name);
    return n.includes(q) || q.includes(n) || n.split(' ').pop() === q;
  });
  return partial.length === 1 ? partial[0] : null;
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    let val = true;
    if (next !== undefined && !next.startsWith('--')) { val = next; i++; }
    out[key] = key in out ? [].concat(out[key], val) : val;
  }
  return out;
}

export function parseStarters(values) {
  const out = {};
  for (const v of [].concat(values ?? [])) {
    const s = String(v);
    const i = s.indexOf('=');
    if (i < 1) throw new Error(`--starters expects "TEAM=Name1,Name2,..." (got "${s}")`);
    out[s.slice(0, i).trim().toUpperCase()] = s.slice(i + 1).split(',').map(x => x.trim()).filter(Boolean);
  }
  return out;
}

export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).map((l, i) => {
    try { return JSON.parse(l); } catch { throw new Error(`${file}: invalid JSON on line ${i + 1}`); }
  });
}

function appendJsonl(file, rec) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(rec) + '\n');
}

const gameDateInChicago = iso => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(iso || Date.now()));

function liveSnapshotRecords(snapshot, version = FIRST_BASKET_MODEL_VERSION) {
  if (snapshot?.sport !== 'nba' || snapshot?.source?.mode !== 'live') return [];
  return (snapshot.games || []).filter(g => !g.isLive && !g.isFinal && g.status !== 'LIVE' && g.status !== 'FINAL')
    .map(game => {
      const players = (snapshot.players || []).filter(p => p.gameId === game.gameId);
      if (!players.length) return null;
      const home = game.homeTeam?.abbr;
      const away = game.awayTeam?.abbr;
      const tip = game.tipMatchup || {};
      return {
        type: 'prediction',
        loggedAt: new Date().toISOString(),
        date: gameDateInChicago(game.date),
        game: `${away}@${home}`,
        gameId: String(game.gameId),
        away, home, modelVersion: version, preTip: true,
        note: 'Captured automatically from the live pregame slate pipeline.',
        lineupStatus: game.lineupStatus || null,
        inputQuality: game.inputQuality || null,
        openingTempoShadow: game.openingTempoShadow || null,
        tip: {
          tipProbHome: tip.homeTipProb ?? tip.tipProbA ?? null,
          homeScoresFirst: tip.homeScoresFirstProb ?? tip.teamAScoresFirstProb ?? null,
        },
        players: players.map(p => ({
          name: p.name, team: p.team, position: p.position,
          pCredit: p.teamProb, pJoint: p.gameProb,
          starter: Boolean(p.isStarter), marketOdds: p.books || null,
          earlyShotShare: p.earlyShotShare ?? null,
          openingRoleRecent: p.openingRoleRecent || null,
          zoneFG: p.zoneFG || null,
          openingHistorySamples: p.openingHistorySamples ?? null,
          openingShotAttempts: p.openingShotAttempts ?? null,
          openingShotMakes: p.openingShotMakes ?? null,
          openingStartTypes: p.openingStartTypes || null,
          dataSources: p.dataSources || null,
        })),
      };
    }).filter(Boolean);
}

/** Append only changed, pre-tip live slate snapshots for prospective evaluation. */
export function appendPregamePredictions(snapshot, { dir = DEFAULT_DIR, version = FIRST_BASKET_MODEL_VERSION } = {}) {
  const file = resolve(dir, 'predictions.jsonl');
  const prior = readJsonl(file);
  const records = liveSnapshotRecords(snapshot, version);
  let written = 0;
  for (const record of records) {
    const prev = [...prior].reverse().find(p => p.type === 'prediction' &&
      p.date === record.date && p.modelVersion === record.modelVersion &&
      ((p.gameId && p.gameId === record.gameId) || (!p.gameId && p.game === record.game)));
    const signature = r => JSON.stringify({
      players: r.players.map(p => [p.name, p.pJoint, p.marketOdds, p.earlyShotShare, p.openingRoleRecent, p.zoneFG,
        p.openingHistorySamples, p.openingShotAttempts, p.openingShotMakes, p.openingStartTypes, p.dataSources]),
      lineupStatus: r.lineupStatus,
      inputQuality: r.inputQuality,
      openingTempoShadow: r.openingTempoShadow,
      tip: r.tip,
    });
    if (prev && signature(prev) === signature(record)) continue;
    appendJsonl(file, record);
    prior.push(record);
    written++;
  }
  return { considered: records.length, written, path: file };
}

const localDate = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
const pct = (x, d = 1) => (x == null || Number.isNaN(x) ? '—' : (x * 100).toFixed(d) + '%');
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const num = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const identityKey = record => `${record.date}|${record.gameId ? `id:${record.gameId}` : `game:${record.game}`}`;

function gitVersion() {
  try {
    const opts = { stdio: ['ignore', 'pipe', 'ignore'] };
    const h = execSync('git rev-parse --short HEAD', opts).toString().trim();
    const dirty = execSync('git status --porcelain', opts).toString().trim() ? '-dirty' : '';
    return h + dirty;
  } catch { return 'unknown'; }
}

/* ─────────────────────────── scoring (pure) ─────────────────────────── */

export function scoreSnapshot(snap, result) {
  const total = snap.players.reduce((s, p) => s + p.pJoint, 0) || 1;
  const players = snap.players.map(p => ({ ...p, p: p.pJoint / total })); // renormalize to sum 1
  const hit = matchPlayer(players, result.scorer);
  const n = players.length;
  const pActual = hit ? hit.p : 0;
  const top = players.reduce((a, b) => (b.p > a.p ? b : a));
  const rank = hit ? 1 + players.filter(x => x.p > hit.p).length : null;

  const out = {
    date: snap.date, game: snap.game, gameId: snap.gameId ?? result.gameId ?? null, modelVersion: snap.modelVersion,
    scorer: result.scorer, matched: hit ? hit.name : null, outsideModel: !hit,
    pActual, nPlayers: n,
    logLoss: -Math.log(Math.max(pActual, PROB_FLOOR)),
    baselineLogLoss: Math.log(n),
    brier: players.reduce((s, x) => s + (x.p - (x === hit ? 1 : 0)) ** 2, 0) + (hit ? 0 : 1),
    uniformBrier: (n - 1) / n,
    rank, top1: rank === 1, top3: rank != null && rank <= 3,
    topPick: top.name, topPickP: top.p,
    scorerPosition: hit?.position ?? null,
    players: players.map(x => ({ ...x, scored: x === hit })),
  };

  const tempo = snap.openingTempoShadow;
  const homeTempo = tempo?.home;
  const awayTempo = tempo?.away;
  const homeSeconds = homeTempo?.meanSecondsToFirstShot;
  const awaySeconds = awayTempo?.meanSecondsToFirstShot;
  const actualFirstTeam = hit?.team || result.scorerTeam || null;
  if (Number.isFinite(homeSeconds) && Number.isFinite(awaySeconds) &&
      Number(homeTempo.sampleCount) >= 5 && Number(awayTempo.sampleCount) >= 5 &&
      Math.abs(homeSeconds - awaySeconds) >= 1 && actualFirstTeam) {
    const fasterTeam = homeSeconds < awaySeconds ? snap.home : snap.away;
    out.openingTempoShadowResult = {
      fasterTeam,
      fasterBySeconds: Math.round(Math.abs(homeSeconds - awaySeconds) * 100) / 100,
      actualFirstTeam,
      fasterTeamScoredFirst: actualFirstTeam === fasterTeam,
    };
  } else {
    out.openingTempoShadowResult = null;
  }

  const tipWinner = result.tipWinner ? String(result.tipWinner).toUpperCase() : null;
  if (snap.tip && tipWinner && [snap.home, snap.away].includes(tipWinner)) {
    out.tipBrier = (snap.tip.tipProbHome - (tipWinner === snap.home ? 1 : 0)) ** 2; // coin flip = 0.25
  }
  if (snap.tip && hit) {
    out.teamFirstBrier = (snap.tip.homeScoresFirst - (hit.team === snap.home ? 1 : 0)) ** 2;
  }
  const modelTeams = new Set(players.map(p => p.team).filter(Boolean));
  const actualTeams = result.starters || null;
  out.lineupEvidenceMissing = !actualTeams || [...modelTeams].some(team => !Array.isArray(actualTeams[team]));
  if (actualTeams) {
    out.lineupMismatch = {};
    for (const [team, names] of Object.entries(actualTeams)) {
      const teamPlayers = players.filter(x => x.team === team);
      const notInModel = names.filter(nm => !matchPlayer(teamPlayers, nm));
      const notStarting = teamPlayers.filter(tp => !names.some(nm => matchPlayer([tp], nm))).map(tp => tp.name);
      if (notInModel.length || notStarting.length) out.lineupMismatch[team] = { notInModel, notStarting };
    }
  }
  return out;
}

function summarize(scored) {
  const byVersion = {};
  for (const s of scored) (byVersion[s.modelVersion] ??= []).push(s);
  return Object.entries(byVersion).map(([version, a]) => ({
    version, games: a.length,
    logLoss: mean(a.map(x => x.logLoss)),
    baselineLogLoss: mean(a.map(x => x.baselineLogLoss)),
    edgeVsUniform: mean(a.map(x => x.baselineLogLoss - x.logLoss)), // > 0 beats a 1-in-N guess
    brier: mean(a.map(x => x.brier)),
    uniformBrier: mean(a.map(x => x.uniformBrier)),
    top1Rate: mean(a.map(x => +x.top1)),
    expectedTop1: mean(a.map(x => x.topPickP)), // what the model itself expects its #1 pick to hit
    top3Rate: mean(a.map(x => +x.top3)),
    outsideModel: a.filter(x => x.outsideModel).length,
  }));
}

function summarizeOpeningTempoShadow(scored) {
  const rows = scored.filter(s => s.openingTempoShadowResult);
  return {
    games: rows.length,
    fasterTeamFirstRate: rows.length ? mean(rows.map(s => +s.openingTempoShadowResult.fasterTeamScoredFirst)) : NaN,
    meanFasterBySeconds: rows.length ? mean(rows.map(s => s.openingTempoShadowResult.fasterBySeconds)) : NaN,
  };
}

function calibrate(scored) {
  const bins = BIN_EDGES.slice(0, -1).map((lo, i) => ({ lo, hi: BIN_EDGES[i + 1], n: 0, sumP: 0, hits: 0 }));
  for (const s of scored) for (const pl of s.players) {
    const b = bins.find(x => pl.p >= x.lo && pl.p < x.hi);
    if (!b) continue;
    b.n++; b.sumP += pl.p; b.hits += pl.scored ? 1 : 0;
  }
  return bins.filter(b => b.n).map(b => ({
    range: `${pct(b.lo, 0)}-${pct(Math.min(b.hi, 1), 0)}`, n: b.n, predicted: b.sumP / b.n, observed: b.hits / b.n,
  }));
}

/** Does the model over-credit centers? Compare predicted vs observed share of first baskets by position. */
function positionCheck(scored) {
  if (!scored.length) return null;
  const predictedC = mean(scored.map(s => s.players.filter(p => p.position === 'C').reduce((t, p) => t + p.p, 0)));
  const observedC = mean(scored.map(s => (s.scorerPosition === 'C' ? 1 : 0)));
  return { games: scored.length, predictedC, observedC };
}

export function scoreLog(predictions, results, { includeBackfill = false, version = null } = {}) {
  const resultsById = new Map();
  const resultsByGame = new Map();
  for (const r of results) {
    if (r.gameId) resultsById.set(`${r.date}|id:${r.gameId}`, r);
    resultsByGame.set(`${r.date}|game:${r.game}`, r);
  }
  const resultFor = record => (record.gameId && resultsById.get(identityKey(record))) ||
    resultsByGame.get(`${record.date}|game:${record.game}`);

  const preds = predictions.filter(p =>
    (includeBackfill || p.preTip !== false) && (!version || p.modelVersion === version));

  const latest = new Map();   // date|gameId|version -> last snapshot logged
  const topPicks = new Map(); // date|gameId -> top pick history
  for (const p of preds) {
    const key = identityKey(p);
    latest.set(`${key}|${p.modelVersion}`, p);
    const top = p.players.reduce((a, b) => (b.pJoint > a.pJoint ? b : a)).name;
    if (!topPicks.has(key)) topPicks.set(key, []);
    topPicks.get(key).push(top);
  }

  const scored = [];
  const unscored = new Set();
  for (const snap of latest.values()) {
    const res = resultFor(snap);
    if (res) scored.push(scoreSnapshot(snap, res));
    else unscored.add(`${snap.date} ${snap.game}`);
  }

  // A prediction for the wrong starting five is not a valid evaluation of
  // the model that was actually available at tip. Keep it visible for
  // diagnosis, but exclude it from performance summaries and learned priors.
  const eligibleScored = scored.filter(s => !s.lineupEvidenceMissing &&
    (!s.lineupMismatch || Object.keys(s.lineupMismatch).length === 0));

  const flips = [];
  for (const [key, seq] of topPicks) {
    if (new Set(seq).size > 1) {
      flips.push({ key, picks: seq.filter((t, i) => i === 0 || t !== seq[i - 1]), resolved: resultsById.has(key) || resultsByGame.has(key) });
    }
  }

  return {
    scored, eligibleScored, excludedLineupMismatch: scored.length - eligibleScored.length,
    flips, unscored: [...unscored],
    summary: summarize(eligibleScored), calibration: calibrate(eligibleScored), position: positionCheck(eligibleScored),
    tip: {
      games: eligibleScored.filter(s => s.tipBrier != null).length,
      tipBrier: mean(eligibleScored.filter(s => s.tipBrier != null).map(s => s.tipBrier)),
      teamFirstBrier: mean(eligibleScored.filter(s => s.teamFirstBrier != null).map(s => s.teamFirstBrier)),
    },
    openingTempoShadow: summarizeOpeningTempoShadow(eligibleScored),
  };
}

export function formatReport(r) {
  const L = [];
  L.push(`First-basket evaluation: ${r.scored.length} scored game-snapshot(s), ${r.eligibleScored.length} eligible`);
  if (r.excludedLineupMismatch) L.push(`Excluded from metrics and learning: ${r.excludedLineupMismatch} game(s) with missing or mismatched starter evidence`);
  if (!r.scored.length) {
    L.push('Nothing to score yet. Log a pre-tip snapshot AND a result for the same date + game.');
  }
  if (r.scored.length) {
    L.push('', 'PER GAME');
    L.push('date        game      version                scorer                p(scorer)   rank  model #1 (p)');
    for (const s of r.scored) {
      L.push([
        s.date, s.game.padEnd(8), s.modelVersion.padEnd(22).slice(0, 22),
        (s.matched ?? `${s.scorer}*`).padEnd(20).slice(0, 20),
        pct(s.pActual).padStart(9), `${s.rank ?? '-'}/${s.nPlayers}`.padStart(6),
        `${s.topPick} (${pct(s.topPickP)})`,
      ].join('  '));
    }
    if (r.scored.some(s => s.outsideModel)) L.push('* scorer was not in the model: scored at the probability floor');

    L.push('', 'BY MODEL VERSION  (edge > 0 means better than a 1-in-N guess)');
    L.push('version                games  logloss  uniform   edge   brier  uniformB  top1  model-expects  top3');
    for (const v of r.summary) {
      L.push([
        v.version.padEnd(22).slice(0, 22), String(v.games).padStart(5), num(v.logLoss).padStart(8),
        num(v.baselineLogLoss).padStart(8), num(v.edgeVsUniform).padStart(6), num(v.brier).padStart(7),
        num(v.uniformBrier).padStart(8), pct(v.top1Rate, 0).padStart(5), pct(v.expectedTop1, 0).padStart(13),
        pct(v.top3Rate, 0).padStart(5),
      ].join('  '));
    }

    L.push('', 'CALIBRATION  (when the model says X%, how often does that player score first?)');
    L.push('predicted range     n   avg predicted   observed');
    for (const b of r.calibration) {
      L.push(`${b.range.padEnd(16)} ${String(b.n).padStart(5)}   ${pct(b.predicted).padStart(13)}   ${pct(b.observed).padStart(8)}`);
    }

    if (r.position) {
      L.push('', 'CENTER CHECK  (share of first baskets by centers)');
      L.push(`model expects ${pct(r.position.predictedC)} vs observed ${pct(r.position.observedC)} over ${r.position.games} game(s)`);
    }
    if (r.tip.games || Number.isFinite(r.tip.teamFirstBrier)) {
      L.push('', 'TIP / TEAM-FIRST CALIBRATION  (Brier; a 50/50 guess scores 0.250, lower is better)');
      if (r.tip.games) L.push(`tip winner: ${num(r.tip.tipBrier)} over ${r.tip.games} game(s)`);
      if (Number.isFinite(r.tip.teamFirstBrier)) L.push(`team that scores first: ${num(r.tip.teamFirstBrier)}`);
    }
    if (r.openingTempoShadow?.games) {
      L.push('', 'OPENING TEMPO SHADOW  (descriptive only; not part of probabilities)');
      L.push(`faster historical first-shot team scored first: ${pct(r.openingTempoShadow.fasterTeamFirstRate, 0)} over ${r.openingTempoShadow.games} game(s); mean gap ${num(r.openingTempoShadow.meanFasterBySeconds, 1)} sec`);
    }

    const mism = r.scored.filter(s => s.lineupMismatch && Object.keys(s.lineupMismatch).length);
    if (mism.length) {
      L.push('', 'LINEUP MISMATCHES  (model lineup vs actual starters)');
      for (const s of mism) for (const [team, m] of Object.entries(s.lineupMismatch)) {
        L.push(`${s.date} ${s.game} ${team}: actual starters not in model: [${m.notInModel.join(', ')}]; model players not starting: [${m.notStarting.join(', ')}]`);
      }
    }
  }
  if (r.flips.length) {
    L.push('', 'TOP-PICK FLIPS  (same game, pre-tip snapshots disagreed)');
    for (const f of r.flips) L.push(`${f.key.replace('|', ' ')}: ${f.picks.join(' -> ')}`);
  }
  if (r.unscored.length) L.push('', `Awaiting results: ${r.unscored.join(', ')}`);
  const nGames = new Set(r.eligibleScored.map(identityKey)).size;
  if (nGames < MIN_GAMES) {
    L.push('', `CAUTION: only ${nGames} distinct game(s) scored. Below ~${MIN_GAMES}, every number here is mostly luck.`);
  }
  return L.join('\n');
}

/* ───────────────────────── learning & feedback ───────────────────────── */

export function learnFromLog(predictions, results, { includeBackfill = false } = {}) {
  const scoredData = scoreLog(predictions, results, { includeBackfill });
  const scored = scoredData.eligibleScored;

  const playerStats = {};
  const jumperStats = {};
  const positionStats = {
    PG: { expected: 0, hits: 0, n: 0 },
    SG: { expected: 0, hits: 0, n: 0 },
    SF: { expected: 0, hits: 0, n: 0 },
    PF: { expected: 0, hits: 0, n: 0 },
    C:  { expected: 0, hits: 0, n: 0 },
  };

  for (const s of scored) {
    for (const p of s.players) {
      const k = normName(p.name);
      if (!playerStats[k]) {
        playerStats[k] = {
          name: p.name,
          team: p.team,
          position: p.position || 'SF',
          games: 0,
          hits: 0,
          sumP: 0,
          avgP: 0,
        };
      }
      playerStats[k].games++;
      playerStats[k].sumP += p.p;
      if (p.scored) playerStats[k].hits++;
      playerStats[k].avgP = playerStats[k].sumP / playerStats[k].games;

      const pos = p.position || 'SF';
      if (positionStats[pos]) {
        positionStats[pos].n++;
        positionStats[pos].expected += p.p;
        if (p.scored) positionStats[pos].hits++;
      }
    }
  }

  // Tally jumper tip records from predictions and results
  const resByKey = new Map(results.map(r => [identityKey(r), r]));
  const resByGame = new Map(results.map(r => [`${r.date}|game:${r.game}`, r]));
  for (const p of predictions) {
    const res = resByKey.get(identityKey(p)) || resByGame.get(`${p.date}|game:${p.game}`);
    if (res && res.tipWinner && p.tip?.homeJumper && p.tip?.awayJumper) {
      const homeWon = res.tipWinner === p.home;
      const awayWon = res.tipWinner === p.away;
      const hJumper = p.tip.homeJumper;
      const aJumper = p.tip.awayJumper;

      jumperStats[hJumper] = jumperStats[hJumper] || { jumper: hJumper, tips: 0, wins: 0, losses: 0 };
      jumperStats[aJumper] = jumperStats[aJumper] || { jumper: aJumper, tips: 0, wins: 0, losses: 0 };

      jumperStats[hJumper].tips++;
      jumperStats[aJumper].tips++;

      if (homeWon) {
        jumperStats[hJumper].wins++;
        jumperStats[aJumper].losses++;
      } else if (awayWon) {
        jumperStats[aJumper].wins++;
        jumperStats[hJumper].losses++;
      }
    }
  }

  // Calculate O/E and Bayesian regressed factor for players
  const playerArray = Object.values(playerStats).map(p => {
    const oe = p.sumP > 0 ? p.hits / p.sumP : 1.0;
    // Bayesian regressed factor with sample weight m = 10 games prior
    const regressedFactor = (p.hits + 10 * 1.0) / (p.sumP + 10 * 1.0);
    return {
      ...p,
      oeRatio: Math.round(oe * 100) / 100,
      learnedAdjustment: Math.round(regressedFactor * 1000) / 1000,
    };
  }).sort((a, b) => b.hits - a.hits || b.avgP - a.avgP);

  // Position calibration
  const positionAnalysis = {};
  for (const [pos, st] of Object.entries(positionStats)) {
    const expRate = scored.length > 0 ? st.expected / scored.length : 0;
    const obsRate = scored.length > 0 ? st.hits / scored.length : 0;
    const ratio = st.expected > 0 ? st.hits / st.expected : 1.0;
    positionAnalysis[pos] = {
      n: st.n,
      hits: st.hits,
      expectedHits: Math.round(st.expected * 100) / 100,
      expectedShare: Math.round(expRate * 1000) / 10,
      observedShare: Math.round(obsRate * 1000) / 10,
      ratio: Math.round(ratio * 100) / 100,
    };
  }

  return {
    learnedAt: new Date().toISOString(),
    gamesScored: scored.length,
    modelVersion: scored[0]?.modelVersion || 'v3',
    jumpers: Object.values(jumperStats).map(j => ({
      ...j,
      observedWinPct: j.tips > 0 ? Math.round((j.wins / j.tips) * 1000) / 1000 : 0.5,
    })),
    positionAnalysis,
    playerLeaders: playerArray.slice(0, 15),
    allPlayers: playerArray,
  };
}

export function formatLearnReport(learnData) {
  const L = [];
  L.push(`NBA First Basket Learning Feedback: ${learnData.gamesScored} game(s) processed`);
  if (!learnData.gamesScored) {
    L.push('No scored games found to learn from.');
    return L.join('\n');
  }

  L.push('', '1. JUMPER EMPIRICAL TIP FEEDBACK (Beta-Binomial update)');
  L.push('jumper                   tips  wins  losses   obs win%');
  for (const j of learnData.jumpers) {
    L.push([
      j.jumper.padEnd(22).slice(0, 22),
      String(j.tips).padStart(5),
      String(j.wins).padStart(5),
      String(j.losses).padStart(7),
      pct(j.observedWinPct).padStart(10),
    ].join('  '));
  }

  L.push('', '2. POSITIONAL SHARE & ATTRIBUTION CALIBRATION');
  L.push('pos  starts   expected   actual   exp share   act share   O/E ratio');
  for (const [pos, s] of Object.entries(learnData.positionAnalysis)) {
    L.push([
      pos.padEnd(4),
      String(s.n).padStart(5),
      String(s.expectedHits).padStart(9),
      String(s.hits).padStart(7),
      (s.expectedShare + '%').padStart(10),
      (s.observedShare + '%').padStart(10),
      (s.ratio.toFixed(2) + 'x').padStart(10),
    ].join('  '));
  }

  L.push('', '3. PLAYER FIRST-BASKET HIT RATES VS MODEL EXPECTATION (Top Scorers)');
  L.push('player                 team  pos  starts  hits   exp hits   avg p    O/E   learned adj');
  for (const p of learnData.playerLeaders) {
    L.push([
      p.name.padEnd(21).slice(0, 21),
      p.team.padEnd(4),
      p.position.padEnd(3),
      String(p.games).padStart(6),
      String(p.hits).padStart(5),
      p.sumP.toFixed(2).padStart(9),
      pct(p.avgP).padStart(7),
      (p.oeRatio.toFixed(2) + 'x').padStart(6),
      p.learnedAdjustment.toFixed(3).padStart(12),
    ].join('  '));
  }

  return L.join('\n');
}

export async function reconcileFromESPN(date = localDate(), dir = DEFAULT_DIR) {
  const dStr = date.replace(/-/g, '');
  console.log(`[reconcile] Querying ESPN NBA scoreboard for ${date}...`);
  const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${dStr}`, {
    headers: { 'User-Agent': 'StatFax/2.0' },
  });
  if (!res.ok) throw new Error(`ESPN scoreboard query failed with status ${res.status}`);
  const data = await res.json();
  const events = data.events || [];
  if (!events.length) {
    console.log(`[reconcile] No games found on ESPN for ${date}.`);
    return [];
  }

  const resFile = resolve(dir, 'results.jsonl');
  const existing = readJsonl(resFile);
  const existingKeys = new Set(existing.map(identityKey));
  const reconciled = [];

  const TEAM_ALIASES = { NO: 'NOP', GS: 'GSW', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX', BK: 'BKN' };
  const normAbbr = a => (TEAM_ALIASES[a?.toUpperCase()] || a?.toUpperCase() || '');

  for (const e of events) {
    const rawAway = e.competitions?.[0]?.competitors?.find(c => c.homeAway === 'away')?.team?.abbreviation;
    const rawHome = e.competitions?.[0]?.competitors?.find(c => c.homeAway === 'home')?.team?.abbreviation;
    if (!rawAway || !rawHome) continue;
    const away = normAbbr(rawAway);
    const home = normAbbr(rawHome);
    const game = `${away}@${home}`;
    const gameId = String(e.id);
    const key = `${date}|id:${gameId}`;

    if (existingKeys.has(key) || existingKeys.has(`${date}|game:${game}`)) {
      console.log(`[reconcile] ${key} already logged, skipping.`);
      continue;
    }

    // Fetch summary
    const sumRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${e.id}`, {
      headers: { 'User-Agent': 'StatFax/2.0' },
    });
    if (!sumRes.ok) continue;
    const sum = await sumRes.json();
    const plays = sum.plays || [];
    if (!plays.length) continue;

    // 1. Opening tip
    const jumpPlay = plays.find(p => p.period?.number === 1 && (p.type?.text?.toLowerCase().includes('jump') || p.type?.id === '615'));
    let tipWinner = null;
    if (jumpPlay) {
      const match = jumpPlay.text?.match(/^(.+?)\s+vs\.\s+(.+?)\s+\((.+?)\s+gains\s+possession\)/i);
      const posPlayer = match ? match[3].trim() : null;
      if (jumpPlay.team?.abbreviation) {
        tipWinner = normAbbr(jumpPlay.team.abbreviation);
      } else if (posPlayer && sum.boxscore?.players) {
        for (const t of sum.boxscore.players) {
          if (t.statistics?.[0]?.athletes?.some(a => normName(a.athlete.displayName) === normName(posPlayer))) {
            tipWinner = normAbbr(t.team.abbreviation);
            break;
          }
        }
      }
    }

    // 2. First scoring play (Field Goal preferred for standard markets)
    const fgPlay = plays.find(p => p.scoringPlay && p.scoreValue >= 2);
    const anyScorePlay = plays.find(p => p.scoringPlay && p.scoreValue >= 1);
    const targetPlay = fgPlay || anyScorePlay;
    if (!targetPlay) continue;

    let scorer = null;
    const scoreMatch = targetPlay.text?.match(/^(.+?)\s+(makes|drills|sinks|hits)/i);
    if (scoreMatch) {
      scorer = scoreMatch[1].trim();
    } else if (targetPlay.participants?.[0]?.athlete?.displayName) {
      scorer = targetPlay.participants[0].athlete.displayName;
    }
    if (!scorer) continue;

    // 3. Starters
    let starters = null;
    if (sum.boxscore?.players) {
      starters = {};
      for (const t of sum.boxscore.players) {
        const tAbbr = normAbbr(t.team.abbreviation);
        const actualStarters = (t.statistics?.[0]?.athletes || []).filter(a => a.starter === true)
          .map(a => a.athlete.displayName).filter(Boolean);
        if (actualStarters.length === 5) starters[tAbbr] = actualStarters;
      }
    }

    const rec = {
      type: 'result',
      loggedAt: new Date().toISOString(),
      date,
      game,
      gameId,
      scorer,
      tipWinner,
      starters,
      note: `Auto-reconciled from ESPN (event ${e.id}, play: "${targetPlay.text}")`,
    };

    appendJsonl(resFile, rec);
    reconciled.push(rec);
    console.log(`[reconcile] Logged ${rec.date} ${rec.game}: Scorer "${rec.scorer}", Tip: ${rec.tipWinner || 'unknown'}`);
  }

  return reconciled;
}

/* ───────────────────────── snapshots (engine / json) ───────────────────────── */

async function snapshotFromEngine(game, root) {
  const [away, home] = game.split('@').map(s => s.trim().toUpperCase());
  const load = p => import(pathToFileURL(resolve(root, p)).href);
  try {
    const { scoreGameFirstBasket } = await load('src/sports/nba/logic/firstBasketEngine.js');
    const { getStartersForTeam } = await load('src/sports/nba/data/teamRosters.js');
    const { getJumpBallMatchup } = await load('src/sports/nba/data/jumpBalls.js');
    const jump = getJumpBallMatchup(home, away);
    const scored = scoreGameFirstBasket({
      homeTeam: { abbr: home }, awayTeam: { abbr: away },
      homePlayers: getStartersForTeam(home), awayPlayers: getStartersForTeam(away),
      homeJumper: jump.jumperA, awayJumper: jump.jumperB,
    });
    return {
      game: `${away}@${home}`,
      tip: {
        homeJumper: jump.jumperA.jumper, awayJumper: jump.jumperB.jumper,
        tipProbHome: scored.tipMatchup.homeTipProb,
        homeScoresFirst: scored.tipMatchup.homeScoresFirstProb,
      },
      players: scored.players.map(p => ({
        name: p.name, team: p.team, position: p.position, pCredit: p.teamProb, pJoint: p.gameProb,
      })),
    };
  } catch (err) {
    throw new Error(`Could not call the engine for ${game}: ${err.message}\n` +
      'If the engine API changed, adapt snapshotFromEngine() in this file, or export your run to JSON and use --from-json.');
  }
}

function buildSnapshot(raw, ctx) {
  const [away, home] = raw.game.split('@').map(s => s.trim().toUpperCase());
  let players = raw.players.map(p => ({
    name: p.name, team: p.team, position: p.position ?? null,
    pCredit: p.pCredit ?? null, pJoint: Number(p.pJoint ?? p.gameProb),
  }));
  if (players.some(p => !Number.isFinite(p.pJoint) || p.pJoint < 0)) throw new Error(`${raw.game}: every player needs a numeric pJoint`);
  if (Math.max(...players.map(p => p.pJoint)) > 1) players = players.map(p => ({ ...p, pJoint: p.pJoint / 100 })); // percents -> fractions
  const sum = players.reduce((s, p) => s + p.pJoint, 0);
  if (Math.abs(sum - 1) > 0.05) console.warn(`warning: ${raw.game} probabilities sum to ${sum.toFixed(3)} (will be renormalized when scoring)`);
  return {
    type: 'prediction', loggedAt: new Date().toISOString(), date: ctx.date,
    game: `${away}@${home}`, away, home, modelVersion: ctx.version, preTip: !ctx.backfill,
    note: ctx.note ?? null, tip: raw.tip ?? null, players,
  };
}

/* ───────────────────────────────── CLI ───────────────────────────────── */

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  const dir = resolve(args.dir ?? DEFAULT_DIR);
  const predFile = resolve(dir, 'predictions.jsonl');
  const resFile = resolve(dir, 'results.jsonl');
  const date = args.date ?? localDate();

  if (cmd === 'snapshot') {
    const ctx = {
      date, version: typeof args.version === 'string' ? args.version : gitVersion(),
      backfill: Boolean(args.backfill), note: typeof args.note === 'string' ? args.note : null,
    };
    let raws;
    if (args['from-json']) {
      const parsed = JSON.parse(readFileSync(resolve(args['from-json']), 'utf8'));
      raws = [].concat(parsed);
    } else if (typeof args.games === 'string') {
      raws = [];
      for (const g of args.games.split(',').map(s => s.trim()).filter(Boolean)) raws.push(await snapshotFromEngine(g, process.cwd()));
    } else {
      throw new Error('snapshot needs --games AWAY@HOME,... or --from-json <file>');
    }
    for (const raw of raws) {
      const snap = buildSnapshot(raw, ctx);
      appendJsonl(predFile, snap);
      const top = snap.players.reduce((a, b) => (b.pJoint > a.pJoint ? b : a));
      console.log(`logged ${snap.date} ${snap.game} [${snap.modelVersion}${snap.preTip ? '' : ', BACKFILL'}] model #1: ${top.name} ${pct(top.pJoint)}`);
    }
    return;
  }

  if (cmd === 'result') {
    if (typeof args.game !== 'string' || typeof args.scorer !== 'string') {
      throw new Error('result needs --game AWAY@HOME and --scorer "Player Name"');
    }
    const [away, home] = args.game.split('@').map(s => s.trim().toUpperCase());
    const rec = {
      type: 'result', loggedAt: new Date().toISOString(), date, game: `${away}@${home}`,
      gameId: typeof args['game-id'] === 'string' ? args['game-id'] : null,
      scorer: args.scorer, tipWinner: typeof args['tip-winner'] === 'string' ? args['tip-winner'].toUpperCase() : null,
      starters: args.starters ? parseStarters(args.starters) : null,
      note: typeof args.note === 'string' ? args.note : null,
    };
    appendJsonl(resFile, rec);
    console.log(`logged result ${rec.date} ${rec.game}: ${rec.scorer}`);
    return;
  }

  if (cmd === 'score') {
    const report = scoreLog(readJsonl(predFile), readJsonl(resFile), {
      includeBackfill: Boolean(args['include-backfill']),
      version: typeof args.version === 'string' ? args.version : null,
    });
    if (args.json) {
      const slim = {
        ...report,
        eligibleGames: report.eligibleScored.length,
        scored: report.scored.map(({ players, ...rest }) => rest),
      };
      delete slim.eligibleScored;
      console.log(JSON.stringify(slim, null, 2));
    } else {
      console.log(formatReport(report));
    }
    return;
  }

  if (cmd === 'learn') {
    const learnData = learnFromLog(readJsonl(predFile), readJsonl(resFile), {
      includeBackfill: Boolean(args['include-backfill']),
    });
    const outFile = resolve(dir, 'learned-priors.json');
    writeFileSync(outFile, JSON.stringify(learnData, null, 2), 'utf8');
    if (args.json) {
      console.log(JSON.stringify(learnData, null, 2));
    } else {
      console.log(formatLearnReport(learnData));
      console.log(`\nSaved learned priors artifact to ${outFile}`);
    }
    return;
  }

  if (cmd === 'reconcile') {
    const results = await reconcileFromESPN(date, dir);
    console.log(`Reconciled ${results.length} game(s) from ESPN.`);
    return;
  }

  console.log('Usage: node tools/firstBasketLog.mjs <snapshot|result|score|learn|reconcile> [flags]\nSee the header of this file for examples.');
  if (cmd) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(err => { console.error(err.message); process.exitCode = 1; });
}
