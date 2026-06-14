/**
 * Context pass — the LLM "soft-factor" layer.
 *
 * Once a day, after the slate is built, this asks Claude (with web search) to
 * research the unstructured stuff the stats model is blind to — injuries,
 * scratches/rest-day risk, call-up pitchers with no track record, bullpen
 * usage, and game-time weather — and emits dist/context.json: a flat list of
 * flags keyed by player/pitcher name that the builder + UI can surface.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLATE_PATH = resolve(__dirname, '../dist/daily.json');
const OUT_PATH = resolve(__dirname, '../dist/context.json');
const R2_SLATE = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev/daily.json';
const MODEL = process.env.CONTEXT_MODEL || 'claude-haiku-4-5-20251001';
const DRY_RUN = process.argv.includes('--dry-run');

function write(obj) {
  writeFileSync(OUT_PATH, JSON.stringify(obj));
  console.log(`[context] wrote ${OUT_PATH} — ${obj.flags?.length ?? 0} flag(s)${obj.skipped ? ' (skipped)' : ''}`);
}

async function loadSlate() {
  if (existsSync(SLATE_PATH)) return JSON.parse(readFileSync(SLATE_PATH, 'utf8'));
  const res = await fetch(`${R2_SLATE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`no local slate and R2 fetch failed (${res.status})`);
  return res.json();
}

// Compact the slate to just what the model needs to research (keeps tokens low).
function summarize(slate) {
  const bats = Object.values(slate.scoredBatters || {});
  const seen = new Set();
  const uniq = bats.filter((b) => (seen.has(b.playerId) ? false : (seen.add(b.playerId), true)));
  const games = (slate.games || []).map((g) => {
    const et = g.gameDate ? new Date(new Date(g.gameDate).getTime() - 4 * 3600e3).toISOString().slice(11, 16) + ' ET' : '';
    return {
      matchup: `${g.awayTeam?.abbr}@${g.homeTeam?.abbr}`,
      venue: g.venueName,
      time: et,
      pitchers: [g.awayPitcher?.fullName || g.awayPitcher?.name, g.homePitcher?.fullName || g.homePitcher?.name].filter(Boolean),
    };
  });
  // Top ~28 bats by score — the ones the combos actually use.
  const watch = uniq
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, 28)
    .map((b) => `${b.name} (${b.team}, ${b.grade?.label || b.grade}, vs ${b.pitcher?.name || '?'})`);
  return { date: slate.date, games, watch };
}

function buildPrompt(sum) {
  return `You are a sharp MLB betting research assistant. For tonight's home-run prop slate (${sum.date}), research CURRENT news and return ONLY soft-factor context the stats model can't see. Use web search for today's lineups, injuries, weather, and pitcher news.

GAMES:
${sum.games.map((g) => `- ${g.matchup} ${g.time} @ ${g.venue} | probables: ${g.pitchers.join(' vs ')}`).join('\n')}

KEY BATS TO WATCH:
${sum.watch.join('\n')}

For each meaningful finding, emit a flag. Focus on things that change a bet:
- injury / scratch risk / load-management rest-day risk for a listed bat
- a probable pitcher who is a recent call-up or season debut (no track record)
- notable game-time weather (wind blowing out/in, heat, rain risk)
- bullpen overuse/unavailability that opens late-game HR windows
- a bat that is notably hot or cold beyond what season stats show

Return STRICT JSON only (no prose, no markdown fences):
{"flags":[{"entity":"<player or pitcher name>","team":"<abbr>","kind":"injury|scratch-risk|rest-risk|callup|weather|bullpen|form|other","severity":"alert|warn|info","note":"<one concise sentence, cite the source if possible>"}]}
If you find nothing noteworthy, return {"flags":[]}.`;
}

function parseFlags(text) {
  const m = text.match(/\{[\s\S]*\}/); // first JSON object, tolerant of stray prose
  if (!m) return [];
  try {
    const obj = JSON.parse(m[0]);
    return Array.isArray(obj.flags)
      ? obj.flags.filter((f) => f && f.entity && f.note).map((f) => ({
          entity: String(f.entity).slice(0, 60),
          team: f.team ? String(f.team).slice(0, 4) : null,
          kind: ['injury', 'scratch-risk', 'rest-risk', 'callup', 'weather', 'bullpen', 'form', 'other'].includes(f.kind) ? f.kind : 'other',
          severity: ['alert', 'warn', 'info'].includes(f.severity) ? f.severity : 'info',
          note: String(f.note).slice(0, 240),
        }))
      : [];
  } catch {
    return [];
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
  const base = { date: null, generatedAt: new Date().toISOString(), model: MODEL, source: 'claude-web-search', flags: [] };
  let slate;
  try {
    slate = await loadSlate();
  } catch (e) {
    console.warn(`[context] no slate: ${e.message}`);
    return write({ ...base, skipped: true });
  }
  base.date = slate.date;
  const sum = summarize(slate);
  const prompt = buildPrompt(sum);

  if (DRY_RUN) {
    console.log('[context] --dry-run: prompt built (' + prompt.length + ' chars), no API call');
    return write({ ...base, skipped: true, dryRun: true });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[context] ANTHROPIC_API_KEY not set — skipping (model predictions unaffected)');
    return write({ ...base, skipped: true });
  }
  try {
    const text = await callClaude(prompt);
    write({ ...base, flags: parseFlags(text) });
  } catch (e) {
    console.warn(`[context] pass failed (non-fatal): ${e.message}`);
    write({ ...base, skipped: true, error: e.message });
  }
}

main();
