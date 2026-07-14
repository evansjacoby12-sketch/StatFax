/**
 * Context pass — the LLM "soft-factor" layer.
 *
 * Once a day, after the slate is built, this asks Claude (with web search) to
 * research the unstructured stuff the stats model is blind to — injuries,
 * scratches/rest-day risk, call-up pitchers with no track record, bullpen
 * usage, and game-time weather — and emits dist/context.json using the strict
 * AI HR context contract. Every accepted signal is tied to a slate-owned
 * entity key, source URL, confidence, observation time, and expiration time.
 *
 * IMPORTANT: this NEVER touches the HR predictions. The model stays statistical;
 * this only adds a human-readable context overlay (and catches data gaps like a
 * pitcher with no season sample). It's advisory.
 *
 * Env:
 *   ANTHROPIC_API_KEY   required — without it the pass is skipped (empty file).
 *   CONTEXT_MODEL       optional — defaults to Haiku (cheap). Bump to
 *                       claude-sonnet-4-6 / claude-opus-4-8 for sharper research.
 * Flags:  --dry-run     build the prompt + write a stub, no API call (testing).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertValidAiHrContext,
  emptyAiHrContext,
  normalizeAiHrContext,
  summarizeAiHrTargets,
  validateAiHrContext,
} from './lib/aiHrContext.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLATE_PATH = resolve(__dirname, '../dist/daily.json');
const OUT_PATH = resolve(__dirname, '../dist/context.json');
const R2_SLATE = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev/daily.json';
const MODEL = process.env.CONTEXT_MODEL || 'claude-haiku-4-5-20251001';
const DRY_RUN = process.argv.includes('--dry-run');
// The pipeline ticks every ~10 min; only re-run the (paid) research this often.
const STALE_HOURS = Number(process.env.CONTEXT_STALE_HOURS || 3);

// Reuse the prior context.json if it's for today, succeeded, and is recent —
// so we hit the API a handful of times a day (refreshing as lineups/news firm
// up), not 144×. Retries when the prior run was empty/skipped/failed.
function priorIsFresh(slateDate) {
  try {
    if (!existsSync(OUT_PATH)) return false;
    const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    if (prev.skipped || prev.error || prev.date !== slateDate || !validateAiHrContext(prev).ok) return false;
    return (Date.now() - new Date(prev.generatedAt).getTime()) / 3600e3 < STALE_HOURS;
  } catch {
    return false;
  }
}

function write(obj) {
  assertValidAiHrContext(obj);
  writeFileSync(OUT_PATH, JSON.stringify(obj));
  console.log(`[context] wrote ${OUT_PATH} — ${obj.signals.length} sourced signal(s), ${obj.stats.rejected} rejected${obj.skipped ? ' (skipped)' : ''}`);
}

async function loadSlate() {
  if (existsSync(SLATE_PATH)) return JSON.parse(readFileSync(SLATE_PATH, 'utf8'));
  const res = await fetch(`${R2_SLATE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`no local slate and R2 fetch failed (${res.status})`);
  return res.json();
}

function buildPrompt(sum) {
  return `You are a careful MLB home-run research extractor. For tonight's slate (${sum.date}), research CURRENT news and return ONLY sourced facts the statistical HR model cannot reliably obtain from its numeric feeds. Use web search for official lineups, injuries, pitcher roles, roof/weather changes, and bullpen availability.

ALLOWED GAME, PITCHER, AND BULLPEN TARGETS:
${sum.games.map((g) => `- ${g.entityKey} | ${g.matchup} | ${g.gameDate || '?'} @ ${g.venue || '?'}\n  pitchers: ${g.pitchers.map((p) => `${p.entityKey}=${p.name}`).join('; ') || 'none'}\n  bullpens: ${g.bullpens.map((b) => `${b.entityKey}=${b.team}`).join('; ')}`).join('\n')}

ALLOWED BATTER TARGETS:
${sum.batters.map((b) => `- ${b.entityKey} | ${b.name} (${b.team}, ${b.grade}, vs ${b.opposingPitcher || '?'})`).join('\n')}

Emit only meaningful candidate HR features:
- starter change, opener risk, or a documented pitch limit
- confirmed lineup status, injury, or scratch risk for a listed batter
- game-time weather or roof status that changed or is not yet stable
- bullpen overuse or key reliever unavailability
- a call-up or season debut with insufficient MLB history

Return STRICT JSON only (no prose, no markdown fences):
{"signals":[{"entityKey":"<EXACT allowed key above>","kind":"starter-change|opener-risk|pitch-limit|lineup-status|injury|scratch-risk|weather|roof|bullpen|callup|other","direction":"boost|suppress|uncertain","severity":"alert|warn|info","confidence":0.0,"note":"<one concise factual sentence>","observedAt":"<ISO timestamp>","expiresAt":"<ISO timestamp no more than 24h later>","evidence":[{"url":"https://<direct source URL>","title":"<source title>","publishedAt":"<ISO timestamp or null>"}]}]}

Rules:
- entityKey MUST exactly match one of the allowed keys. Never invent an ID.
- Every signal MUST have at least one direct http/https evidence URL. No source means omit it.
- direction is always from the affected BATTER'S HR perspective: boost means more HR-friendly, suppress means less HR-friendly, and uncertain means the effect is unknown.
- For a pitcher target, direction describes the effect on batters facing that pitcher. For a bullpen target, it describes the effect on opposing batters facing that bullpen.
- direction is a hypothesis for later backtesting, NOT a probability adjustment.
- Do not output probabilities, score changes, multipliers, weights, locks, or betting recommendations.
- Prefer official MLB/team/venue/weather sources and current reporting. Avoid rumor-only social posts.
- If nothing trustworthy is found, return {"signals":[]}.`;
}

function parseSignals(text) {
  const m = text.match(/\{[\s\S]*\}/); // first JSON object, tolerant of stray prose
  if (!m) return { signals: [] };
  try {
    const obj = JSON.parse(m[0]);
    return { signals: Array.isArray(obj.signals) ? obj.signals : [] };
  } catch {
    return { signals: [] };
  }
}

async function callClaude(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return text;
}

async function main() {
  const generatedAt = new Date().toISOString();
  const empty = (extra = {}) => emptyAiHrContext({
    date: slate?.date || null,
    generatedAt,
    model: MODEL,
    source: 'claude-web-search',
    ...extra,
  });
  let slate;
  try {
    slate = await loadSlate();
  } catch (e) {
    console.warn(`[context] no slate: ${e.message}`);
    return write(empty({ skipped: true, error: e.message }));
  }
  const sum = summarizeAiHrTargets(slate);
  const prompt = buildPrompt(sum);

  if (DRY_RUN) {
    console.log('[context] --dry-run: prompt built (' + prompt.length + ' chars), no API call');
    return write(empty({ skipped: true, dryRun: true }));
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[context] ANTHROPIC_API_KEY not set — skipping (model predictions unaffected)');
    return write(empty({ skipped: true }));
  }
  // The pipeline ticks every ~10 min; reuse a recent good run instead of paying
  // for ~144 web-search calls/day. Refreshes every STALE_HOURS as news firms up.
  if (priorIsFresh(slate.date)) {
    const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    const ageMin = Math.round((Date.now() - new Date(prev.generatedAt).getTime()) / 60000);
    console.log(`[context] reusing today's context.json (${ageMin}m old, < ${STALE_HOURS}h) — no API call`);
    return; // leave the existing file in place
  }
  try {
    const text = await callClaude(prompt);
    write(normalizeAiHrContext({
      raw: parseSignals(text),
      slate,
      generatedAt,
      model: MODEL,
      source: 'claude-web-search',
    }));
  } catch (e) {
    console.warn(`[context] pass failed (non-fatal): ${e.message}`);
    write(empty({ skipped: true, error: e.message }));
  }
}

main();
