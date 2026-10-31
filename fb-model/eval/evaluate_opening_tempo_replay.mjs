#!/usr/bin/env node
/** Date-ordered shadow evaluation for historical team opening-shot tempo. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = resolve(ROOT, 'dist/nba/historical-pbp-replay-cache-2024-now.json');
const REPLAY = resolve(ROOT, 'fb-model/data/first-basket-historical-replay-2024-11-through-2026-10.json');
const OUTPUT = resolve(ROOT, 'fb-model/data/opening-tempo-historical-eval-2024-11-through-2026-10.json');
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const logit = p => Math.log(clamp(p, 1e-5, 1 - 1e-5) / (1 - clamp(p, 1e-5, 1 - 1e-5)));
const logistic = x => 1 / (1 + Math.exp(-clamp(x, -20, 20)));

function previousSeason(season) {
  const year = Number(season.slice(0, 4)) - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

function firstShotEvents(rows) {
  const firstByPossession = new Map();
  for (const row of rows || []) {
    if (Number(row.period) !== 1 || ![1, 2].includes(Number(row.poss_num)) || !row.game_date) continue;
    const start = Number(row.start_time), shot = Number(row.shot_time);
    const elapsed = start - shot;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 120) continue;
    const key = `${row.gid}:${row.poss_num}`;
    const prior = firstByPossession.get(key);
    if (!prior || shot > prior.shotTime) firstByPossession.set(key, { date: String(row.game_date), elapsed, shotTime: shot });
  }
  return [...firstByPossession.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function openingTempoAt(events, beforeDate, pointerState = { index: 0, count: 0, total: 0 }) {
  while (pointerState.index < (events?.length || 0) && events[pointerState.index].date < beforeDate) {
    pointerState.count++;
    pointerState.total += events[pointerState.index].elapsed;
    pointerState.index++;
  }
  return { meanSeconds: pointerState.count ? pointerState.total / pointerState.count : null, sampleCount: pointerState.count };
}

function fitBeta(rows) {
  if (rows.length < 100) return 0;
  let beta = 0;
  const regularization = 20;
  for (let iteration = 0; iteration < 30; iteration++) {
    let gradient = regularization * beta;
    let hessian = regularization;
    for (const row of rows) {
      const p = logistic(logit(row.baseHome) + beta * row.x);
      gradient += (p - row.homeScoredFirst) * row.x;
      hessian += p * (1 - p) * row.x * row.x;
    }
    const step = gradient / hessian;
    beta = clamp(beta - step, -1.5, 1.5);
    if (Math.abs(step) < 1e-7) break;
  }
  return beta;
}

function buildTempoFeatures(eventsByTeamSeason, season, away, home, date, pointers) {
  const tempoFor = team => {
    const totals = { count: 0, total: 0 };
    for (const dataSeason of [season, previousSeason(season)]) {
      const key = `${dataSeason}:${team}`;
      pointers[key] ||= { index: 0, count: 0, total: 0 };
      const value = openingTempoAt(eventsByTeamSeason[key], date, pointers[key]);
      totals.count += value.sampleCount;
      totals.total += value.sampleCount ? value.meanSeconds * value.sampleCount : 0;
    }
    return { sampleCount: totals.count, meanSeconds: totals.count ? totals.total / totals.count : null };
  };
  const awayTempo = tempoFor(away);
  const homeTempo = tempoFor(home);
  const delta = awayTempo.meanSeconds - homeTempo.meanSeconds;
  const qualified = awayTempo.sampleCount >= 5 && homeTempo.sampleCount >= 5 && Math.abs(delta) >= 1;
  return {
    away: awayTempo, home: homeTempo,
    deltaSecondsAwayMinusHome: Number.isFinite(delta) ? delta : null,
    x: qualified ? clamp(delta / 10, -2, 2) : 0,
    qualified,
  };
}

function playerRows(game, version) {
  return game[version]?.players || [];
}

function metrics(rows, version, adjusted) {
  const top1 = [], top3 = [], playerLL = [], playerBrier = [], teamBrier = [], teamLL = [];
  let covered = 0;
  for (const row of rows) {
    const basePlayers = playerRows(row.game, version);
    const probs = adjusted ? row.adjusted[version] : basePlayers.map(p => ({ id: p.id, team: p.team, prob: p.prob }));
    const sorted = [...probs].sort((a, b) => b.prob - a.prob);
    const actualInPool = probs.some(p => String(p.id) === String(row.game.actualPlayerId));
    top1.push(sorted[0]?.id === String(row.game.actualPlayerId) || sorted[0]?.id === row.game.actualPlayerId ? 1 : 0);
    top3.push(sorted.slice(0, 3).some(p => String(p.id) === String(row.game.actualPlayerId)) ? 1 : 0);
    if (actualInPool) {
      covered++;
      const actualProb = Math.max(1e-6, probs.find(p => String(p.id) === String(row.game.actualPlayerId)).prob);
      playerLL.push(-Math.log(actualProb));
      playerBrier.push(probs.reduce((sum, p) => sum + (p.prob - (String(p.id) === String(row.game.actualPlayerId) ? 1 : 0)) ** 2, 0));
    }
    const baseTeam = row.teamProb[version];
    const adjTeam = row.adjustedTeamProb[version];
    const actualHome = row.actualTeam === row.home;
    teamBrier.push(((adjusted ? adjTeam : baseTeam) - (actualHome ? 1 : 0)) ** 2);
    teamLL.push(-Math.log(Math.max(1e-6, actualHome ? (adjusted ? adjTeam : baseTeam) : 1 - (adjusted ? adjTeam : baseTeam))));
  }
  const mean = values => values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : null;
  return {
    games: rows.length, covered, top1Hits: top1.reduce((a, b) => a + b, 0), top1Rate: mean(top1), top3Rate: mean(top3),
    playerLogLoss: mean(playerLL), playerBrier: mean(playerBrier), teamFirstLogLoss: mean(teamLL), teamFirstBrier: mean(teamBrier),
  };
}

async function run() {
  const [cache, replay] = await Promise.all([
    readFile(CACHE, 'utf8').then(JSON.parse), readFile(REPLAY, 'utf8').then(JSON.parse),
  ]);
  const eventsByTeamSeason = Object.fromEntries(Object.entries(cache.opening || {}).map(([key, rows]) => [key, firstShotEvents(rows)]));
  const teamPointers = {};
  const training = { v6: [], v7: [] };
  const predictions = [];
  const gamesByDate = new Map();
  for (const game of replay.games || []) {
    const rows = game.v6?.players || [];
    const actualPlayer = rows.find(player => String(player.id) === String(game.actualPlayerId));
    if (!actualPlayer) continue;
    const [away, home] = game.matchup.split('@');
    const seasonStart = Number(game.date.slice(5, 7)) >= 10 ? Number(game.date.slice(0, 4)) : Number(game.date.slice(0, 4)) - 1;
    const season = `${seasonStart}-${String(seasonStart + 1).slice(-2)}`;
    const tempo = buildTempoFeatures(eventsByTeamSeason, season, away, home, game.date, teamPointers);
    const teamProb = {};
    for (const version of ['v6', 'v7']) {
      const players = playerRows(game, version);
      const pHome = players.filter(p => p.team === home).reduce((sum, p) => sum + p.prob, 0);
      teamProb[version] = pHome;
    }
    const record = { game, date: game.date, home, away, actualTeam: actualPlayer.team, tempo, teamProb };
    const day = gamesByDate.get(game.date) || [];
    day.push(record);
    gamesByDate.set(game.date, day);
  }

  const scored = [];
  for (const [date, day] of [...gamesByDate].sort(([a], [b]) => a.localeCompare(b))) {
    const betas = { v6: fitBeta(training.v6), v7: fitBeta(training.v7) };
    for (const row of day) {
      row.beta = { ...betas };
      row.adjustedTeamProb = {};
      row.adjusted = {};
      for (const version of ['v6', 'v7']) {
        const baseHome = row.teamProb[version];
        const adjustedHome = logistic(logit(baseHome) + betas[version] * row.tempo.x);
        row.adjustedTeamProb[version] = adjustedHome;
        const basePlayers = playerRows(row.game, version);
        const baseAway = 1 - baseHome;
        row.adjusted[version] = basePlayers.map(player => ({
          id: player.id, team: player.team,
          prob: player.prob * (player.team === row.home
            ? adjustedHome / Math.max(1e-6, baseHome)
            : (1 - adjustedHome) / Math.max(1e-6, baseAway)),
        }));
      }
      scored.push(row);
    }
    for (const row of day) if (row.tempo.qualified) for (const version of ['v6', 'v7']) {
      training[version].push({ x: row.tempo.x, baseHome: row.teamProb[version], homeScoredFirst: row.actualTeam === row.home ? 1 : 0 });
    }
  }
  const qualified = scored.filter(row => row.tempo.qualified);
  const fasterWins = qualified.filter(row => row.tempo.deltaSecondsAwayMinusHome * (row.actualTeam === row.home ? 1 : -1) > 0).length;
  const report = {
    schemaVersion: 1, createdAt: new Date().toISOString(),
    range: replay.range, seasons: replay.seasons,
    source: 'PBP Stats historical first-quarter shot records; first shot of team possession 1 or 2; game_date strictly before prediction date.',
    method: 'Walk-forward logistic residual adjustment: logit(simulated team-first probability) + beta × (away historical mean seconds minus home mean seconds)/10. Beta is fit only on qualified earlier calendar dates and regularized toward zero; within-date outcomes never train same-day games. Player shares within each team are preserved.',
    dataQuality: {
      gamesWithKnownActualTeam: scored.length,
      tempoQualifiedGames: qualified.length,
      tempoCoverage: scored.length ? qualified.length / scored.length : 0,
      meanPriorSamplesHome: qualified.length ? qualified.reduce((sum, row) => sum + row.tempo.home.sampleCount, 0) / qualified.length : null,
      meanPriorSamplesAway: qualified.length ? qualified.reduce((sum, row) => sum + row.tempo.away.sampleCount, 0) / qualified.length : null,
      fasterHistoricalTempoTeamFirst: qualified.length ? fasterWins / qualified.length : null,
      averageTempoGapSeconds: qualified.length ? qualified.reduce((sum, row) => sum + Math.abs(row.tempo.deltaSecondsAwayMinusHome), 0) / qualified.length : null,
    },
    metrics: Object.fromEntries(['v6', 'v7'].map(version => [version, {
      baseline: metrics(scored, version, false), tempoAdjusted: metrics(scored, version, true),
      finalWalkForwardBetaPerTenSeconds: fitBeta(training[version]),
    }])),
    games: scored.map(row => ({
      date: row.date, matchup: row.game.matchup, actualFirstScorer: row.game.actualFirstFieldGoalScorer,
      actualTeam: row.actualTeam, tempo: row.tempo, baseTeamFirst: row.teamProb, adjustedTeamFirst: row.adjustedTeamProb,
      beta: row.beta,
      picks: Object.fromEntries(['v6', 'v7'].map(version => {
        const base = playerRows(row.game, version).slice().sort((a, b) => b.prob - a.prob);
        const adjusted = row.adjusted[version].slice().sort((a, b) => b.prob - a.prob);
        const nameById = new Map(playerRows(row.game, version).map(p => [String(p.id), p.name]));
        const actual = String(row.game.actualPlayerId);
        return [version, { baselineTop1: base[0]?.name, tempoTop1: nameById.get(String(adjusted[0]?.id)), baselineHit: String(base[0]?.id) === actual,
          tempoHit: String(adjusted[0]?.id) === actual }];
      })),
    })),
  };
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ output: OUTPUT, range: report.range, dataQuality: report.dataQuality, metrics: report.metrics }, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => { console.error(`[opening-tempo-eval] ${error.stack || error}`); process.exitCode = 1; });
}
