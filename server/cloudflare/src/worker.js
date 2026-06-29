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
        headers: { 'Content-Type': 'text/plain' },
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
 * The LLM (Claude Haiku) ONLY translates English → the existing filter chips.
 * It never sees the data or does math — the browser runs the returned filter
 * against the backtest log it already loaded. Cheap (tool-use, tiny prompt,
 * cached system block).
 *
 * Required Worker secret:  ANTHROPIC_API_KEY  (wrangler secret put)
 * Optional Worker var:     ALLOW_ORIGIN       (default "*"; set to your site)
 */
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

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
  if (!env.ANTHROPIC_API_KEY) return jsonResponse({ error: 'ANTHROPIC_API_KEY not set on the worker' }, 500, env);

  const tool = {
    name: 'apply_filters',
    description: 'Select the grade tiers and signal flags that match the request.',
    input_schema: {
      type: 'object',
      properties: {
        grades: {
          type: 'array',
          items: { type: 'string', enum: grades },
          description: 'Grade tiers to include (OR). Empty = all grades.',
        },
        signals: {
          type: 'array',
          items: { type: 'string', enum: signals },
          description: 'Signal flags that must ALL be present (AND). Empty = no signal filter.',
        },
      },
      required: ['grades', 'signals'],
    },
  };
  const system =
    `You translate a baseball bettor's plain-English request into a StatFax home-run backtest filter.\n` +
    `Grade tiers (quality, best→worst): PRIME > STRONG > LEAN > SKIP.\n` +
    `Signal flags available: ${signals.join(', ') || '(none)'}.\n` +
    `Map the request to the closest grades and signals using ONLY the exact enum values provided.\n` +
    `If a concept has no matching signal (e.g. handedness, home/away, a specific team), omit it rather than forcing one.\n` +
    `Examples: "hot bats"→signals:["hot"]; "best plays"/"elite"→grades:["PRIME"]; "due hitters"→signals:["due"]; ` +
    `"strong or better"→grades:["PRIME","STRONG"]. Prefer few, confident filters.`;

  let data;
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || ANTHROPIC_MODEL,
        max_tokens: 256,
        // Cache the (stable) instructions so repeat queries are cheaper.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: [tool],
        tool_choice: { type: 'tool', name: 'apply_filters' },
        messages: [{ role: 'user', content: query }],
      }),
    });
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 300);
      return jsonResponse({ error: 'LLM error', status: resp.status, detail }, 502, env);
    }
    data = await resp.json();
  } catch (e) {
    return jsonResponse({ error: 'LLM unreachable', detail: String(e).slice(0, 200) }, 502, env);
  }

  const use = (data.content || []).find((b) => b.type === 'tool_use');
  const out = use?.input || { grades: [], signals: [] };
  // Sanitize: never return anything outside the allowed lists.
  const g = (out.grades || []).filter((x) => grades.includes(x));
  const s = (out.signals || []).filter((x) => signals.includes(x));
  return jsonResponse({ grades: g, signals: s }, 200, env);
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
