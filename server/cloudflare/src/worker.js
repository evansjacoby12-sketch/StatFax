/**
 * StatFax slate-cron trigger Worker
 * ─────────────────────────────────
 * Fires every 10 minutes via Cloudflare's cron scheduler and pokes the
 * `slate-cron` GitHub workflow via `repository_dispatch`. The actual
 * fetch-slate.mjs work still happens on GitHub Actions runners — this
 * Worker just provides the reliable heartbeat that GitHub's own
 * scheduled-event trigger conspicuously does not.
 *
 * Why: GitHub Actions' `schedule` trigger on private free-tier repos is
 * heavily throttled. Empirically we were getting ~4-8 runs/day with
 * multi-hour gaps when asking for every 10 minutes (144/day). External
 * cron + `repository_dispatch` solves this — Cloudflare's Worker cron is
 * a hard guarantee (give or take a few seconds), and `repository_dispatch`
 * has no rate-limiting issues at this volume.
 *
 * Deployment: see README.md in this directory.
 *
 * Required Worker secrets (set via `wrangler secret put`):
 *   GITHUB_TOKEN  — fine-grained PAT with Actions: write on this repo
 *
 * Required Worker vars (set in wrangler.toml or dashboard):
 *   GITHUB_REPO   — "owner/repo" (e.g. "evansjacoby12-sketch/StatFax")
 *   EVENT_TYPE    — repository_dispatch event_type to fire
 *                   (matches the workflow's `on.repository_dispatch.types`)
 */

export default {
  /**
   * Cloudflare invokes this on the cron schedule defined in wrangler.toml.
   * We POST to GitHub's dispatches endpoint; the workflow's `on:
   * repository_dispatch` trigger picks it up and runs.
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(triggerSlateRefresh(env));
  },

  /**
   * Manual test trigger — `curl https://<worker>.workers.dev/` from a
   * browser or terminal to verify the Worker can reach GitHub end-to-end.
   * Returns plain text so it's easy to eyeball.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Natural-language → backtest-filter parser (used by the Signal Backtest UI).
    if (url.pathname === '/parse') {
      return handleParse(request, env);
    }
    if (url.pathname === '/list-builder') {
      return handleListBuilder(request, env);
    }
    if (url.pathname === '/explain') {
      return handleExplain(request, env);
    }
    if (url.pathname === '/savant-bip') {
      return handleSavantBip(request, env);
    }
    if (url.pathname !== '/' && url.pathname !== '/trigger') {
      return new Response('Not found', { status: 404 });
    }
    const result = await triggerSlateRefresh(env);
    return new Response(
      result.ok
        ? `OK — dispatched ${env.EVENT_TYPE || 'slate-refresh'} at ${new Date().toISOString()}\n`
        : `FAIL — ${result.status}: ${result.body}\n`,
      {
        status: result.ok ? 200 : 502,
        // CORS so the PWA's press-and-hold "build slate" button can read the
        // result (a plain GET reaches the Worker either way — this just lets
        // the browser see whether the dispatch succeeded).
        headers: { 'Content-Type': 'text/plain', ...corsHeaders(env) },
      }
    );
  },
};

/**
 * POST to GitHub's repository_dispatch endpoint.
 *
 * Returns `{ ok, status, body }` so the manual-trigger path can surface
 * the error to the caller; the scheduled path just fire-and-forgets but
 * logs failures to Cloudflare's Worker logs for tailing with
 * `wrangler tail`.
 */
async function triggerSlateRefresh(env) {
  const repo      = env.GITHUB_REPO || 'evansjacoby12-sketch/StatFax';
  const eventType = env.EVENT_TYPE  || 'slate-refresh';
  const token     = env.GITHUB_TOKEN;

  if (!token) {
    console.error('Missing GITHUB_TOKEN secret');
    return { ok: false, status: 500, body: 'Missing GITHUB_TOKEN secret' };
  }

  const url = `https://api.github.com/repos/${repo}/dispatches`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization':         `Bearer ${token}`,
      'Accept':                'application/vnd.github+json',
      'X-GitHub-Api-Version':  '2022-11-28',
      'User-Agent':            'statfax-cron-worker',
      'Content-Type':          'application/json',
    },
    body: JSON.stringify({
      event_type:     eventType,
      // Optional client payload — surfaces in the workflow run as
      // ${{ github.event.client_payload.* }} for debugging.
      client_payload: { triggeredAt: new Date().toISOString(), via: 'cf-worker-cron' },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`GitHub dispatch failed ${res.status}: ${body}`);
    return { ok: false, status: res.status, body };
  }
  // 204 No Content on success — no body to read.
  console.log(`Dispatched ${eventType} to ${repo}`);
  return { ok: true, status: res.status, body: '' };
}

/* ─────────────────────────────────────────────────────────────────────────
 * Natural-language backtest parser
 * ─────────────────────────────────────────────────────────────────────────
 * POST /parse  { query, grades:[...allowed], signals:[...allowed] }
 *   → { grades:[...], signals:[...] }   (a subset of the allowed lists)
 *
 * OpenAI ONLY translates English → the existing filter chips.
 * It never sees the data or does math — the browser runs the returned filter
 * against the backtest log it already loaded. Cheap (tool-use, tiny prompt,
 * cached system block).
 *
 * Required Worker secret:  OPENAI_API_KEY  (wrangler secret put)
 * Optional Worker var:     ALLOW_ORIGIN       (default "*"; set to your site)
 */
const OPENAI_MODEL = 'gpt-5.6-luna';

function openAiOutputText(payload) {
  if (typeof payload?.output_text === 'string') return payload.output_text.trim();
  return (Array.isArray(payload?.output) ? payload.output : [])
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
    .filter((item) => item?.type === 'output_text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('')
    .trim();
}

async function callOpenAiStructured(env, { instructions, input, schema, schemaName, maxOutputTokens }) {
  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || OPENAI_MODEL,
      instructions,
      input,
      max_output_tokens: maxOutputTokens,
      text: { format: { type: 'json_schema', name: schemaName, strict: true, schema } },
    }),
  });
  if (!resp.ok) {
    const detail = (await resp.text()).slice(0, 300);
    const error = new Error('LLM error');
    error.status = resp.status;
    error.detail = detail;
    throw error;
  }
  const text = openAiOutputText(await resp.json());
  if (!text) throw new Error('LLM returned no output');
  return JSON.parse(text);
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
function jsonResponse(obj, status, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

async function handleParse(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400, env);
  }
  const query = String(body.query || '').slice(0, 500).trim();
  const grades = Array.isArray(body.grades) && body.grades.length ? body.grades : ['PRIME', 'STRONG', 'LEAN', 'SKIP'];
  const signals = Array.isArray(body.signals) ? body.signals : [];
  if (!query) return jsonResponse({ grades: [], signals: [] }, 200, env);
  if (!env.OPENAI_API_KEY) return jsonResponse({ error: 'OPENAI_API_KEY not set on the worker' }, 500, env);

  const schema = {
    type: 'object',
    properties: {
      grades: { type: 'array', items: { type: 'string', enum: grades } },
      signals: signals.length
        ? { type: 'array', items: { type: 'string', enum: signals } }
        : { type: 'array', maxItems: 0, items: { type: 'string' } },
    },
    required: ['grades', 'signals'],
    additionalProperties: false,
  };
  const system =
    `You translate a baseball bettor's plain-English request into a StatFax home-run backtest filter.\n` +
    `Grade tiers (quality, best→worst): PRIME > STRONG > LEAN > SKIP.\n` +
    `Signal flags available: ${signals.join(', ') || '(none)'}.\n` +
    `Map the request to the closest grades and signals using ONLY the exact enum values provided.\n` +
    `If a concept has no matching signal (e.g. handedness, home/away, a specific team), omit it rather than forcing one.\n` +
    `Examples: "hot bats"→signals:["hot"]; "best plays"/"elite"→grades:["PRIME"]; "due hitters"→signals:["due"]; ` +
    `"strong or better"→grades:["PRIME","STRONG"]. Prefer few, confident filters.`;

  let out;
  try {
    out = await callOpenAiStructured(env, {
      instructions: system,
      input: query,
      schema,
      schemaName: 'apply_filters',
      maxOutputTokens: 256,
    });
  } catch (e) {
    return jsonResponse({ error: e.message === 'LLM error' ? 'LLM error' : 'LLM unreachable', status: e.status, detail: e.detail || String(e).slice(0, 200) }, 502, env);
  }

  // Sanitize: never return anything outside the allowed lists.
  const g = (out.grades || []).filter((x) => grades.includes(x));
  const s = (out.signals || []).filter((x) => signals.includes(x));
  return jsonResponse({ grades: g, signals: s }, 200, env);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Explain-this-pick narrator
 * ─────────────────────────────────────────────────────────────────────────
 * POST /explain  { name, grade, hrProb, batterScore, matchupScore, envScore,
 *                  pitcher, park, reasons:[...] }
 *   → { text: "two-to-three sentence plain-English explanation" }
 *
 * Turns the model's ALREADY-COMPUTED reason lines (from ProbabilityEngine's
 * buildReasons) into a natural-language paragraph. It is a pure narration
 * layer: it receives facts the engine already decided and rephrases them.
 * It NEVER sees raw data, does math, or influences a score/grade — the
 * number is fixed before this endpoint is ever called. The browser caches the
 * result per player/day.
 *
 * Required Worker secret:  OPENAI_API_KEY  (wrangler secret put)
 * Optional Worker var:     ALLOW_ORIGIN       (default "*"; set to your site)
 */
/* Natural-language List Builder criteria. This is a translation layer only:
 * no slate/player data enters the prompt and the output cannot alter scoring. */
const LIST_BUILDER_FIELDS = Object.freeze({
  minOppHr9: [0, 4, 'minimum effective opposing-pitcher HR/9 exposure'],
  minPitchMix: [0, 10, 'minimum favorable pitch-mix score'],
  minParkFactor: [0.5, 1.6, 'minimum park and weather HR factor; 1.0 is neutral'],
  minRecentPitcherHr9: [0, 6, 'minimum opposing starter HR/9 over the last five starts'],
  maxPitcherK9: [0, 20, 'maximum opposing starter season K/9; use for low-strikeout contact matchups'],
  minContactCollision: [-10, 10, 'minimum batter-contact versus pitcher-contact-allowed matchup edge'],
  maxBattingOrder: [1, 9, 'latest allowed lineup spot; 4 means spots one through four'],
  minISO: [0, 0.6, 'minimum season isolated power; 0.200 is strong power'],
  minExitVelo: [70, 105, 'minimum average exit velocity in mph'],
  minBarrel: [0, 35, 'minimum season barrel percentage'],
  minHardHit: [0, 80, 'minimum hard-hit percentage'],
  minBlast: [0, 60, 'minimum blast percentage'],
  minLaunchAngle: [-10, 45, 'minimum average launch angle'],
  maxLaunchAngle: [0, 55, 'maximum average launch angle'],
  minPullPct: [0, 100, 'minimum pull percentage'],
  minScore: [0, 100, 'minimum StatFax model score'],
  minHeat: [0, 100, 'minimum StatFax heat index'],
  minHrProb: [0, 50, 'minimum already-computed HR probability as a percentage'],
  minRecBarrel: [0, 45, 'minimum recent barrel percentage; engine requires at least six BBE'],
  minHrDue: [0, 6, 'minimum HR setup evidence checks; never treat as being owed a result'],
  minPositives: [0, 15, 'minimum positive evidence count'],
  maxNegatives: [0, 10, 'maximum negative evidence count'],
});
const LIST_BUILDER_SIGNALS = Object.freeze([
  'precision', 'sleeper', 'hot', 'barrelKing', 'blast', 'pitchEdge',
  'pitchMixEdge', 'zoneEdge', 'hrPlatoonEdge', 'wxEdge', 'homeEdge', 'awayEdge',
]);
const LIST_BUILDER_SORTS = Object.freeze(['hrProbability', 'score', 'barrel', 'matchup', 'heat']);

function normalizeListBuilderCriteria(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const criteria = {};
  for (const [key, [min, max]] of Object.entries(LIST_BUILDER_FIELDS)) {
    const value = source[key];
    criteria[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : null;
  }
  criteria.signals = [...new Set(Array.isArray(source.signals) ? source.signals : [])]
    .filter((key) => LIST_BUILDER_SIGNALS.includes(key));
  criteria.signalMode = source.signalMode === 'any' ? 'any' : 'all';
  criteria.pregameOnly = source.pregameOnly !== false;
  criteria.confirmedOnly = source.confirmedOnly === true;
  criteria.trustedOnly = source.trustedOnly === true;
  criteria.sort = LIST_BUILDER_SORTS.includes(source.sort) ? source.sort : 'hrProbability';
  return criteria;
}

async function handleListBuilder(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400, env);
  }
  const query = String(body.query || '').trim().slice(0, 500);
  if (!query) return jsonResponse({ error: 'Describe the list you want.' }, 400, env);
  if (!env.OPENAI_API_KEY) return jsonResponse({ error: 'AI criteria is not configured.' }, 503, env);

  const numericProperties = Object.fromEntries(Object.entries(LIST_BUILDER_FIELDS).map(([key, [minimum, maximum]]) => [
    key,
    { type: ['number', 'null'], minimum, maximum },
  ]));
  const criteriaProperties = {
    ...numericProperties,
    signals: { type: 'array', items: { type: 'string', enum: LIST_BUILDER_SIGNALS } },
    signalMode: { type: 'string', enum: ['all', 'any'] },
    pregameOnly: { type: 'boolean' },
    confirmedOnly: { type: 'boolean' },
    trustedOnly: { type: 'boolean' },
    sort: { type: 'string', enum: LIST_BUILDER_SORTS },
  };
  const schema = {
    type: 'object',
    properties: {
      criteria: {
        type: 'object',
        properties: criteriaProperties,
        required: Object.keys(criteriaProperties),
        additionalProperties: false,
      },
      summary: { type: 'string', maxLength: 240 },
    },
    required: ['criteria', 'summary'],
    additionalProperties: false,
  };
  const fieldGuide = Object.entries(LIST_BUILDER_FIELDS)
    .map(([key, [min, max, meaning]]) => `${key} (${min}–${max}): ${meaning}`)
    .join('\n');
  const instructions =
    `Translate one plain-English MLB home-run candidate-list request into the closest StatFax List Builder criteria.\n` +
    `This is configuration, not prediction. Use null for every numeric gate the request does not support. Never infer player names, results, odds, or new probabilities.\n` +
    `Keep pregameOnly true unless the person explicitly requests otherwise. Confirmed means confirmedOnly. Reliable/clean/trusted data means trustedOnly.\n` +
    `For a range such as launch angle 8 to 32, set both minLaunchAngle and maxLaunchAngle. For selected signals, use signalMode "all" only when every signal is required; otherwise use "any".\n` +
    `Prefer a few faithful filters over aggressive assumptions. Explain the translation in one short summary without promises.\n\n` +
    `Numeric fields:\n${fieldGuide}\n\n` +
    `Signals: ${LIST_BUILDER_SIGNALS.join(', ')}. Sorts: ${LIST_BUILDER_SORTS.join(', ')}.`;

  let result;
  try {
    result = await callOpenAiStructured(env, {
      instructions,
      input: query,
      schema,
      schemaName: 'list_builder_criteria',
      maxOutputTokens: 700,
    });
  } catch (e) {
    console.error('List Builder OpenAI request failed', { status: e.status, detail: e.detail || e.message });
    return jsonResponse({ error: e.message === 'LLM error' ? 'AI criteria request failed.' : 'AI criteria is temporarily unavailable.', status: e.status }, 502, env);
  }

  return jsonResponse({
    criteria: normalizeListBuilderCriteria(result?.criteria),
    summary: String(result?.summary || 'Translated into visible StatFax criteria.').trim().slice(0, 240),
  }, 200, env);
}

// Rephrases already-computed engine evidence; it never changes a score.
async function handleExplain(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
  if (request.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'bad json' }, 400, env);
  }

  const name    = String(body.name || 'This hitter').slice(0, 60).trim();
  const grade   = String(body.grade || '').slice(0, 12).trim().toUpperCase();
  const reasons = (Array.isArray(body.reasons) ? body.reasons : [])
    .map((r) => String(r).slice(0, 200).trim())
    .filter(Boolean)
    .slice(0, 14);

  if (!reasons.length) return jsonResponse({ text: '' }, 200, env);
  if (!env.OPENAI_API_KEY) return jsonResponse({ error: 'OPENAI_API_KEY not set on the worker' }, 500, env);

  // Optional context numbers — all pre-computed by the engine. Passed as
  // facts to keep the model grounded, never for it to recompute anything.
  const num = (x, d) => (Number.isFinite(x) ? x : d);
  const facts = [
    grade && `Grade: ${grade}`,
    Number.isFinite(body.hrProb) && `Model HR probability today: ${(body.hrProb * 100).toFixed(1)}%`,
    Number.isFinite(body.batterScore)  && `Bat-threat pillar: ${Math.round(num(body.batterScore))}/100`,
    Number.isFinite(body.matchupScore) && `Matchup pillar: ${Math.round(num(body.matchupScore))}/100`,
    Number.isFinite(body.envScore)     && `Park/weather pillar: ${Math.round(num(body.envScore))}/100`,
    body.pitcher && `Opposing pitcher: ${String(body.pitcher).slice(0, 40)}`,
    body.park && `Venue: ${String(body.park).slice(0, 40)}`,
  ].filter(Boolean).join('\n');

  const system =
    `You are StatFax, a home-run betting model. In 2-3 short sentences, explain to a bettor WHY the model rates ${name} the way it does today.\n` +
    `Rules:\n` +
    `- Use ONLY the facts and reason lines provided. Never invent stats, names, or numbers.\n` +
    `- Weave the strongest 3-4 signals into a flowing explanation; do not just list them.\n` +
    `- Lead with what drives the grade (power/matchup/park), then the caveats if any.\n` +
    `- Conversational and confident, but NEVER promise a home run or give a guarantee. No "lock", "guaranteed", "will hit".\n` +
    `- No preamble ("Here's why…"), no markdown, no bullet points. Just the explanation prose.`;

  const userContent =
    `Player: ${name}\n${facts}\n\nModel reason lines:\n` +
    reasons.map((r) => `- ${r}`).join('\n');

  let result;
  try {
    result = await callOpenAiStructured(env, {
      instructions: system,
      input: userContent,
      schemaName: 'pick_explanation',
      maxOutputTokens: 220,
      schema: {
        type: 'object',
        properties: { text: { type: 'string' } },
        required: ['text'],
        additionalProperties: false,
      },
    });
  } catch (e) {
    return jsonResponse({ error: e.message === 'LLM error' ? 'LLM error' : 'LLM unreachable', status: e.status, detail: e.detail || String(e).slice(0, 200) }, 502, env);
  }

  const text = String(result?.text || '').trim();
  return jsonResponse({ text }, 200, env);
}

/* ─────────────────────────────────────────────────────────────────────────
 * Baseball Savant BIP proxy
 * ─────────────────────────────────────────────────────────────────────────
 * GET /savant-bip?playerId=xxx&season=2025
 *   → { bips: [{x,y,events,bbType,ev,la,dist,date}], count: N }
 *
 * Proxies Savant statcast_search CSV (BIP events only) using browser-
 * spoofed headers. Returns parsed JSON with CORS headers for direct
 * browser calls from the StatFax UI.
 *
 * Optional Worker var:  ALLOW_ORIGIN  (default "*")
 */
async function handleSavantBip(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env) });
  if (request.method !== 'GET') return jsonResponse({ error: 'GET only' }, 405, env);

  const url = new URL(request.url);
  const playerId = url.searchParams.get('playerId') || '';
  const season = url.searchParams.get('season') || String(new Date().getFullYear());

  if (!/^\d{1,9}$/.test(playerId)) return jsonResponse({ error: 'invalid playerId' }, 400, env);
  if (!/^\d{4}$/.test(season))    return jsonResponse({ error: 'invalid season' },   400, env);

  // all=true required; season param is hfSea (not hfSe).
  // No group_by — individual event rows with hc_x/hc_y coordinates.
  // No hfBBT filter — fetch all events, filter to BIP client-side.
  const savantUrl = [
    'https://baseballsavant.mlb.com/statcast_search/csv',
    '?all=true',
    '&hfGT=R%7C',
    `&hfSea=${season}%7C`,
    '&player_type=batter',
    `&batters_lookup%5B%5D=${playerId}`,
    '&min_pitches=0&min_results=0',
    '&sort_col=game_date&sort_order=desc',
    '&min_pas=0&type=details',
  ].join('');

  const debug = url.searchParams.get('debug') === '1';

  let csv;
  try {
    const resp = await fetch(savantUrl, {
      headers: {
        'User-Agent':      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer':         'https://baseballsavant.mlb.com/',
        'Origin':          'https://baseballsavant.mlb.com',
      },
    });
    if (!resp.ok) return jsonResponse({ error: 'savant error', status: resp.status }, 502, env);
    csv = await resp.text();
  } catch (e) {
    return jsonResponse({ error: 'savant unreachable', detail: String(e).slice(0, 200) }, 502, env);
  }

  if (debug) {
    return new Response(csv.slice(0, 2000), { headers: { 'Content-Type': 'text/plain', ...corsHeaders(env) } });
  }

  const trimmed = csv.replace(/^﻿/, '').trimStart();
  if (trimmed.startsWith('<') || trimmed.startsWith('{')) {
    return jsonResponse({ error: 'savant challenge', preview: trimmed.slice(0, 120) }, 503, env);
  }

  // Filter to batted-ball events (those with hc_x/hc_y) after parsing.
  // Strikeouts, walks, HBP have null coordinates and are dropped in parseBipCsv.
  const all = parseBipCsv(csv);
  const bips = all.filter(b => b.bbType !== '');
  return jsonResponse({ bips, count: bips.length, total: all.length }, 200, env);
}

function parseBipCsv(csv) {
  const lines = csv.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const header = parseCsvRow(lines[0].replace(/^﻿/, ''));
  const col = (name) => header.indexOf(name);

  const iX = col('hc_x'), iY = col('hc_y');
  const iEv = col('events'), iBbt = col('bb_type');
  const iLS = col('launch_speed'), iLA = col('launch_angle');
  const iDist = col('hit_distance_sc'), iDate = col('game_date');

  if (iX < 0 || iY < 0) return [];

  const bips = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const f = parseCsvRow(line);
    const x = parseFloat(f[iX]);
    const y = parseFloat(f[iY]);
    if (isNaN(x) || isNaN(y)) continue;
    bips.push({
      x, y,
      events: iEv   >= 0 ? (f[iEv]   || '') : '',
      bbType: iBbt  >= 0 ? (f[iBbt]  || '') : '',
      ev:     iLS   >= 0 ? (parseFloat(f[iLS])   || null) : null,
      la:     iLA   >= 0 ? (parseFloat(f[iLA])   || null) : null,
      dist:   iDist >= 0 ? (parseFloat(f[iDist]) || null) : null,
      date:   iDate >= 0 ? (f[iDate] || '') : '',
    });
  }
  return bips;
}

function parseCsvRow(line) {
  const fields = [];
  let field = '', inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"')              { inQuote = !inQuote; }
    else if (c === ',' && !inQuote) { fields.push(field); field = ''; }
    else                        { field += c; }
  }
  fields.push(field);
  return fields;
}
