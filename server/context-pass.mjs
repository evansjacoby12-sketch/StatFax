/**
 * Context pass — the LLM "soft-factor" layer.
 *
 * Once a day, after the slate is built, Tavily retrieves time-bounded sources
 * and OpenAI extracts the unstructured factors the stats model is blind to — injuries,
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
 *   TAVILY_API_KEY      required for source retrieval.
 *   OPENAI_API_KEY      required for strict structured extraction.
 *   AI_HR_MODEL         optional OpenAI extraction model.
 * Flags:  --dry-run     build the prompt + write a stub, no API call (testing).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertValidAiHrContext,
  emptyAiHrContext,
  normalizeAiHrContext,
  validateAiHrContext,
} from './lib/aiHrContext.mjs';
import { researchAiHrSignals } from './lib/aiHrResearch.mjs';
import { OPENAI_DEFAULT_MODEL } from './lib/aiProviders.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLATE_PATH = resolve(__dirname, '../dist/daily.json');
const OUT_PATH = resolve(__dirname, '../dist/context.json');
const R2_SLATE = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev/daily.json';
const MODEL = process.env.AI_HR_MODEL || process.env.CONTEXT_MODEL || OPENAI_DEFAULT_MODEL;
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

async function main() {
  const generatedAt = new Date().toISOString();
  const empty = (extra = {}) => emptyAiHrContext({
    date: slate?.date || null,
    generatedAt,
    model: MODEL,
    source: 'tavily+openai',
    ...extra,
  });
  let slate;
  try {
    slate = await loadSlate();
  } catch (e) {
    console.warn(`[context] no slate: ${e.message}`);
    return write(empty({ skipped: true, error: e.message }));
  }
  if (DRY_RUN) {
    console.log('[context] --dry-run: provider calls skipped');
    return write(empty({ skipped: true, dryRun: true }));
  }
  if (!process.env.TAVILY_API_KEY || !process.env.OPENAI_API_KEY) {
    console.warn('[context] TAVILY_API_KEY / OPENAI_API_KEY not set — skipping (model predictions unaffected)');
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
    const research = await researchAiHrSignals({ slate, generatedAt, model: MODEL });
    const context = normalizeAiHrContext({
      raw: research.raw,
      slate,
      generatedAt,
      model: research.model,
      source: research.provider,
    });
    context.research = research.audit;
    write(context);
  } catch (e) {
    console.warn(`[context] pass failed (non-fatal): ${e.message}`);
    write(empty({ skipped: true, error: e.message }));
  }
}

main();
