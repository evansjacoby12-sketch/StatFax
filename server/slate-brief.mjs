/**
 * Slate Decision Brief.
 *
 * OpenAI selects from an allow-listed set of already-scored players, games,
 * and watchouts, then adds short narrative notes. Player names, grades,
 * probabilities, scores, and factual warnings always come from the engine.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callOpenAiStructured, OPENAI_DEFAULT_MODEL } from './lib/aiProviders.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SLATE_PATH = resolve(__dirname, '../dist/daily.json');
const CONTEXT_PATH = resolve(__dirname, '../dist/context.json');
const OUT_PATH = resolve(__dirname, '../dist/brief.json');
const R2_SLATE = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev/daily.json';
const MODEL = process.env.BRIEF_MODEL || OPENAI_DEFAULT_MODEL;
const DRY_RUN = process.argv.includes('--dry-run');
const STALE_HOURS = Number(process.env.BRIEF_STALE_HOURS || 4);

export const BRIEF_VERSION = 3;

function cleanText(value, max = 160) {
  return String(value || '')
    .replace(/[*_`#<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

// AI prose should never compete with the engine's displayed numbers. Reject
// numeric claims and betting language, then use an engine-authored fallback.
function cleanAiNarrative(value, max) {
  const text = cleanText(value, max);
  if (!text || /\d|%|\b(?:lock|guarantee(?:d)?|best bet|wager|odds?|value)\b/i.test(text)) return '';
  return text;
}

function gradeOf(batter) {
  return batter?.grade?.label || batter?.grade || 'SKIP';
}

function teamName(team) {
  if (!team) return null;
  return typeof team === 'string' ? team : team.abbr || team.name || team.teamName || null;
}

function matchupOf(game) {
  const away = teamName(game?.awayTeam) || teamName(game?.away) || 'Away';
  const home = teamName(game?.homeTeam) || teamName(game?.home) || 'Home';
  return `${away} @ ${home}`;
}

function stableBatterSort(a, b) {
  return (Number(b.score) || 0) - (Number(a.score) || 0)
    || (Number(b.hrProbability) || 0) - (Number(a.hrProbability) || 0)
    || String(a.playerId ?? a.name ?? '').localeCompare(String(b.playerId ?? b.name ?? ''))
    || String(a.gamePk ?? '').localeCompare(String(b.gamePk ?? ''));
}

function priorIsFresh(slateDate) {
  try {
    if (!existsSync(OUT_PATH)) return false;
    const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    if (
      prev.version !== BRIEF_VERSION
      || prev.skipped
      || prev.error
      || !prev.headline
      || !Array.isArray(prev.leaders)
      || prev.date !== slateDate
    ) return false;
    return (Date.now() - new Date(prev.generatedAt).getTime()) / 3600e3 < STALE_HOURS;
  } catch {
    return false;
  }
}

function write(obj) {
  writeFileSync(OUT_PATH, JSON.stringify(obj));
  const n = obj.headline ? `${obj.leaders?.length || 0} leaders` : 'empty';
  console.log(`[brief] wrote ${OUT_PATH} — ${n}${obj.skipped ? ' (skipped)' : ''}`);
}

async function loadSlate() {
  if (existsSync(SLATE_PATH)) return JSON.parse(readFileSync(SLATE_PATH, 'utf8'));
  const res = await fetch(`${R2_SLATE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`no local slate and R2 fetch failed (${res.status})`);
  return res.json();
}

// Read high-severity sourced context without giving the AI authority to alter it.
export function loadAlerts() {
  try {
    if (!existsSync(CONTEXT_PATH)) return [];
    const ctx = JSON.parse(readFileSync(CONTEXT_PATH, 'utf8'));
    return (ctx.signals || ctx.flags || [])
      .filter((f) => f && (f.severity === 'alert' || f.severity === 'warn') && f.entity && f.note)
      .slice(0, 8)
      .map((f) => `${f.entity}${f.team ? ` (${f.team})` : ''}: ${f.note}`);
  } catch {
    return [];
  }
}

// Produce the only facts and selections the narration layer is allowed to use.
export function summarizeSlateBrief(slate, alerts = loadAlerts()) {
  const games = slate.games || [];
  const gamesByPk = new Map(games.map((game) => [String(game.gamePk), game]));
  const rawBatters = Object.values(slate.scoredBatters || {});
  const seen = new Set();
  const batters = rawBatters.filter((batter) => {
    const key = batter.playerId != null && batter.gamePk != null
      ? `${batter.playerId}:${batter.gamePk}`
      : `${batter.name}|${batter.team}|${batter.gamePk}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort(stableBatterSort);

  const actionable = batters.filter((batter) => gradeOf(batter) !== 'SKIP');
  const leaderPool = (actionable.length >= 2 ? actionable : batters).slice(0, 8);
  const leaders = leaderPool.map((batter) => {
    const game = gamesByPk.get(String(batter.gamePk));
    const idPart = batter.playerId != null && batter.gamePk != null
      ? `${batter.playerId}:${batter.gamePk}`
      : `${batter.name}|${batter.team}|${batter.gamePk}`;
    return {
      id: `player:${idPart}`,
      playerId: batter.playerId ?? null,
      gamePk: batter.gamePk ?? null,
      gameNumber: Number.isFinite(game?.gameNumber) ? game.gameNumber : null,
      name: cleanText(batter.name, 80),
      team: cleanText(batter.team, 20),
      grade: cleanText(gradeOf(batter), 16),
      hrProbability: Number.isFinite(batter.hrProbability) ? batter.hrProbability : null,
      score: Number.isFinite(batter.score) ? batter.score : null,
      pitcher: cleanText(batter.pitcher?.name || '', 80) || null,
      matchup: matchupOf(game),
      venue: cleanText(game?.venueName || '', 100) || null,
      lineupConfirmed: batter.lineupConfirmed === true,
      reason: cleanText(batter.reasons?.[0] || 'Ranks near the top of the current model board.', 140),
    };
  });

  const environmentSeen = new Set();
  const environments = batters
    .filter((batter) => Number.isFinite(batter.envScore))
    .slice()
    .sort((a, b) => (Number(b.envScore) || 0) - (Number(a.envScore) || 0) || stableBatterSort(a, b))
    .filter((batter) => {
      const game = gamesByPk.get(String(batter.gamePk));
      const key = String(batter.gamePk ?? game?.venueName ?? batter.team);
      if (environmentSeen.has(key)) return false;
      environmentSeen.add(key);
      return true;
    })
    .slice(0, 5)
    .map((batter) => {
      const game = gamesByPk.get(String(batter.gamePk));
      const key = batter.gamePk ?? game?.venueName ?? batter.team;
      return {
        id: `game:${key}`,
        gamePk: batter.gamePk ?? null,
        matchup: matchupOf(game),
        venue: cleanText(game?.venueName || batter.team, 100),
        score: Math.round(batter.envScore),
        leader: cleanText(batter.name, 80),
        reason: `${cleanText(game?.venueName || batter.team, 100)} has the strongest engine-rated environment on this board.`,
      };
    });

  const watchouts = (alerts || []).map((alert, index) => ({
    id: `alert:${index}`,
    label: 'Context alert',
    fact: cleanText(alert, 220),
  })).filter((item) => item.fact);

  const gameCounts = new Map();
  for (const batter of batters) {
    const key = String(batter.gamePk ?? 'unknown');
    gameCounts.set(key, (gameCounts.get(key) || 0) + 1);
  }
  const concentrated = [...gameCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (concentrated && (games.length <= 1 || concentrated[1] / Math.max(batters.length, 1) >= 0.6)) {
    const game = gamesByPk.get(concentrated[0]);
    watchouts.push({
      id: 'concentration',
      label: 'Concentrated slate',
      fact: `${concentrated[1]} of ${batters.length} board entries come from ${matchupOf(game)}.`,
    });
  }

  const confirmedCount = batters.filter((batter) => batter.lineupConfirmed === true).length;
  if (confirmedCount < batters.length) {
    watchouts.push({
      id: 'lineups',
      label: 'Lineup readiness',
      fact: `${confirmedCount} of ${batters.length} board entries have confirmed lineup spots.`,
    });
  }
  watchouts.push({
    id: 'variance',
    label: 'Outcome variance',
    fact: 'Home-run outcomes remain high variance even at the top of the board.',
  });

  return {
    date: slate.date,
    gameCount: games.length,
    batCount: batters.length,
    confirmedCount,
    primeCount: batters.filter((batter) => gradeOf(batter) === 'PRIME').length,
    strongCount: batters.filter((batter) => gradeOf(batter) === 'STRONG').length,
    leaders,
    environments,
    watchouts,
  };
}

export function buildBriefPrompt(sum) {
  const facts = {
    date: sum.date,
    board: {
      games: sum.gameCount,
      entries: sum.batCount,
      prime: sum.primeCount,
      strong: sum.strongCount,
      confirmedLineups: sum.confirmedCount,
    },
    leaderCandidates: sum.leaders,
    environmentCandidates: sum.environments,
    watchoutCandidates: sum.watchouts,
  };
  const leaderCount = Math.min(2, sum.leaders.length);
  return `Create a StatFax Decision Brief that is readable in ten seconds.

Choose exactly ${leaderCount} distinct leader IDs, one environment ID when candidates exist, and one watchout ID. Write one short evidence note for each choice. The headline should characterize the shape of the board, not repeat the counts or promise an outcome.

Rules:
- Use only the supplied facts and IDs. Never invent or alter a player, opponent, venue, grade, score, probability, alert, or lineup status.
- Do not put numbers in the headline or notes; the application displays engine numbers separately.
- Explain why the supplied context matters without saying lock, guaranteed, best bet, wager, odds, or value.
- Return JSON only through the required schema.

ENGINE FACTS:
${JSON.stringify(facts, null, 2)}`;
}

export function buildBriefSchema(sum) {
  const leaderIds = sum.leaders.map((item) => item.id);
  const environmentIds = sum.environments.map((item) => item.id);
  const watchoutIds = sum.watchouts.map((item) => item.id);
  const leaderCount = Math.min(2, leaderIds.length);
  return {
    type: 'object',
    properties: {
      headline: { type: 'string', maxLength: 100 },
      leaders: {
        type: 'array',
        minItems: leaderCount,
        maxItems: leaderCount,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', enum: leaderIds },
            note: { type: 'string', maxLength: 120 },
          },
          required: ['id', 'note'],
          additionalProperties: false,
        },
      },
      environment: {
        type: 'object',
        properties: {
          id: { type: ['string', 'null'], enum: [...environmentIds, null] },
          note: { type: 'string', maxLength: 140 },
        },
        required: ['id', 'note'],
        additionalProperties: false,
      },
      watchout: {
        type: 'object',
        properties: {
          id: { type: 'string', enum: watchoutIds },
          note: { type: 'string', maxLength: 140 },
        },
        required: ['id', 'note'],
        additionalProperties: false,
      },
    },
    required: ['headline', 'leaders', 'environment', 'watchout'],
    additionalProperties: false,
  };
}

export function assembleDecisionBrief(sum, aiResult = {}, meta = {}) {
  const leaderById = new Map(sum.leaders.map((item) => [item.id, item]));
  const requestedLeaders = Array.isArray(aiResult.leaders) ? aiResult.leaders : [];
  const selected = [];
  const used = new Set();
  for (const choice of requestedLeaders) {
    const candidate = leaderById.get(choice?.id);
    if (!candidate || used.has(candidate.id)) continue;
    used.add(candidate.id);
    selected.push({ candidate, note: cleanAiNarrative(choice.note, 120) });
  }
  for (const candidate of sum.leaders) {
    if (selected.length >= Math.min(2, sum.leaders.length)) break;
    if (used.has(candidate.id)) continue;
    used.add(candidate.id);
    selected.push({ candidate, note: '' });
  }

  const leaders = selected.map(({ candidate, note }) => ({
    id: candidate.id,
    name: candidate.name,
    team: candidate.team,
    grade: candidate.grade,
    hrProbability: candidate.hrProbability,
    score: candidate.score,
    pitcher: candidate.pitcher,
    gamePk: candidate.gamePk,
    gameNumber: candidate.gameNumber,
    matchup: candidate.matchup,
    note: note || candidate.reason,
  }));

  const requestedEnvironment = sum.environments.find((item) => item.id === aiResult.environment?.id);
  const environmentCandidate = requestedEnvironment || sum.environments[0] || null;
  const environmentNote = requestedEnvironment
    ? cleanAiNarrative(aiResult.environment?.note, 140)
    : '';
  const environment = environmentCandidate ? {
    id: environmentCandidate.id,
    matchup: environmentCandidate.matchup,
    venue: environmentCandidate.venue,
    score: environmentCandidate.score,
    leader: environmentCandidate.leader,
    note: environmentNote || environmentCandidate.reason,
  } : null;

  const requestedWatchout = sum.watchouts.find((item) => item.id === aiResult.watchout?.id);
  const watchoutCandidate = requestedWatchout || sum.watchouts[0];
  const watchoutNote = requestedWatchout ? cleanAiNarrative(aiResult.watchout?.note, 140) : '';
  const watchout = watchoutCandidate ? {
    id: watchoutCandidate.id,
    label: watchoutCandidate.label,
    fact: watchoutCandidate.fact,
    note: watchoutNote,
  } : null;

  const fallbackHeadline = leaders.length
    ? `${leaders[0].name} leads the current home-run board.`
    : 'The current home-run board is ready for review.';

  return {
    version: BRIEF_VERSION,
    date: sum.date,
    generatedAt: meta.generatedAt || new Date().toISOString(),
    model: meta.model || MODEL,
    source: 'openai',
    headline: cleanAiNarrative(aiResult.headline, 100) || fallbackHeadline,
    leaders,
    environment,
    watchout,
    primeCount: sum.primeCount,
    strongCount: sum.strongCount,
  };
}

export async function callOpenAiBrief(sum) {
  const response = await callOpenAiStructured({
    apiKey: process.env.OPENAI_API_KEY,
    model: MODEL,
    instructions: 'Return a concise StatFax Decision Brief using only the supplied allow-listed engine facts.',
    input: buildBriefPrompt(sum),
    schemaName: 'slate_decision_brief',
    maxOutputTokens: 600,
    schema: buildBriefSchema(sum),
  });
  return response.value || {};
}

async function main() {
  const base = {
    version: BRIEF_VERSION,
    date: null,
    generatedAt: new Date().toISOString(),
    model: MODEL,
    source: 'openai',
    headline: '',
    leaders: [],
  };
  let slate;
  try {
    slate = await loadSlate();
  } catch (error) {
    console.warn(`[brief] no slate: ${error.message}`);
    return write({ ...base, skipped: true });
  }
  base.date = slate.date;
  const sum = summarizeSlateBrief(slate);

  if (!sum.leaders.length) {
    console.warn('[brief] empty board — nothing to summarize');
    return write({ ...base, skipped: true });
  }
  if (DRY_RUN) {
    const prompt = buildBriefPrompt(sum);
    console.log(`[brief] --dry-run: Decision Brief prompt built (${prompt.length} chars), no API call`);
    return write({ ...base, skipped: true, dryRun: true });
  }
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[brief] OPENAI_API_KEY not set — skipping (model predictions unaffected)');
    return write({ ...base, skipped: true });
  }
  if (priorIsFresh(slate.date)) {
    const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    const ageMin = Math.round((Date.now() - new Date(prev.generatedAt).getTime()) / 60000);
    console.log(`[brief] reusing today's Decision Brief (${ageMin}m old, < ${STALE_HOURS}h) — no API call`);
    return;
  }
  try {
    const aiResult = await callOpenAiBrief(sum);
    write(assembleDecisionBrief(sum, aiResult, { generatedAt: base.generatedAt, model: MODEL }));
  } catch (error) {
    console.warn(`[brief] pass failed (non-fatal): ${error.message}`);
    write({ ...base, skipped: true, error: error.message });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
