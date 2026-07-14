/**
 * Slate Brief — the daily one-paragraph board summary.
 *
 * After the slate is built, this asks Claude to read TODAY'S already-scored
 * board and write a short, plain-English brief: the headline plays, the best
 * park/weather spots, and any alert worth knowing before you bet. It emits
 * dist/brief.json for the UI to render at the top of the board.
 *
 * IMPORTANT: like the context pass, this NEVER touches the HR predictions. It
 * is a pure narration layer over numbers the model already produced — it reads
 * the scored board (and the context pass's flags) and rephrases them. It does
 * no research and no math; the grades/probabilities are fixed before it runs.
 *
 * Env:
 *   ANTHROPIC_API_KEY   required — without it the brief is skipped (empty file).
 *   BRIEF_MODEL         optional — defaults to Haiku (cheap).
 *   BRIEF_STALE_HOURS   optional — reuse a same-day brief younger than this
 *                       (default 4). The pipeline ticks every ~10 min; this
 *                       keeps it to a few (cheap) calls/day as lineups firm up.
 * Flags:  --dry-run     build the prompt + write a stub, no API call.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SLATE_PATH = resolve(__dirname, '../dist/daily.json');
const CONTEXT_PATH = resolve(__dirname, '../dist/context.json');
const OUT_PATH = resolve(__dirname, '../dist/brief.json');
const R2_SLATE = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev/daily.json';
const MODEL = process.env.BRIEF_MODEL || 'claude-haiku-4-5-20251001';
const DRY_RUN = process.argv.includes('--dry-run');
const STALE_HOURS = Number(process.env.BRIEF_STALE_HOURS || 4);

// Reuse a same-day brief that succeeded and is still recent, so we hit the API
// a handful of times a day (refreshing as lineups firm up), not on every tick.
function priorIsFresh(slateDate) {
  try {
    if (!existsSync(OUT_PATH)) return false;
    const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    if (prev.skipped || prev.error || !prev.text || prev.date !== slateDate) return false;
    return (Date.now() - new Date(prev.generatedAt).getTime()) / 3600e3 < STALE_HOURS;
  } catch {
    return false;
  }
}

function write(obj) {
  writeFileSync(OUT_PATH, JSON.stringify(obj));
  const n = obj.text ? `${obj.text.length} chars` : 'empty';
  console.log(`[brief] wrote ${OUT_PATH} — ${n}${obj.skipped ? ' (skipped)' : ''}`);
}

async function loadSlate() {
  if (existsSync(SLATE_PATH)) return JSON.parse(readFileSync(SLATE_PATH, 'utf8'));
  const res = await fetch(`${R2_SLATE}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`no local slate and R2 fetch failed (${res.status})`);
  return res.json();
}

// Read the context pass's high-severity flags (if it ran) so the brief can
// weave in injuries/scratches/weather the stats board can't see.
function loadAlerts() {
  try {
    if (!existsSync(CONTEXT_PATH)) return [];
    const ctx = JSON.parse(readFileSync(CONTEXT_PATH, 'utf8'));
    // v1 AI HR context uses sourced `signals`; keep `flags` as a read-only
    // fallback while previously generated artifacts age out.
    return (ctx.signals || ctx.flags || [])
      .filter((f) => f && (f.severity === 'alert' || f.severity === 'warn') && f.entity && f.note)
      .slice(0, 8)
      .map((f) => `${f.entity}${f.team ? ` (${f.team})` : ''}: ${f.note}`);
  } catch {
    return [];
  }
}

// Compact the scored board to just what the brief needs (keeps tokens low).
function summarize(slate) {
  // Venue lives on games, not on the raw scored batter — resolve it by gamePk
  // (the same join the UI does in data.js).
  const gamesByPk = new Map((slate.games || []).map((g) => [g.gamePk, g]));
  const venueOf = (b) => gamesByPk.get(b.gamePk)?.venueName || null;

  const bats = Object.values(slate.scoredBatters || {});
  const seen = new Set();
  const uniq = bats.filter((b) => (seen.has(b.playerId) ? false : (seen.add(b.playerId), true)));
  const byScore = uniq.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const gradeOf = (b) => b.grade?.label || b.grade || 'SKIP';
  const primeCount = uniq.filter((b) => gradeOf(b) === 'PRIME').length;
  const strongCount = uniq.filter((b) => gradeOf(b) === 'STRONG').length;

  const line = (b) => {
    const prob = Number.isFinite(b.hrProbability) ? ` ${(b.hrProbability * 100).toFixed(0)}% HR` : '';
    const why = b.reasons?.[0] ? ` — ${String(b.reasons[0]).slice(0, 90)}` : '';
    const venue = venueOf(b);
    return `${b.name} (${b.team}, ${gradeOf(b)}${prob}, vs ${b.pitcher?.name || '?'}${venue ? ` @ ${venue}` : ''})${why}`;
  };

  // Headline plays — the top of the board.
  const topPlays = byScore.slice(0, 12).map(line);

  // Best park/weather spots — highest env-scored bats, deduped by venue so we
  // surface distinct ballparks rather than 4 Yankees.
  const parkSeen = new Set();
  const parkSpots = byScore
    .filter((b) => Number.isFinite(b.envScore))
    .sort((a, b) => (b.envScore ?? 0) - (a.envScore ?? 0))
    .filter((b) => {
      const v = venueOf(b) || b.team;
      if (parkSeen.has(v)) return false;
      parkSeen.add(v);
      return true;
    })
    .slice(0, 5)
    .map((b) => `${venueOf(b) || b.team}: env ${Math.round(b.envScore)}/100 (${b.name})`);

  return {
    date: slate.date,
    gameCount: (slate.games || []).length,
    batCount: uniq.length,
    primeCount,
    strongCount,
    topPlays,
    parkSpots,
    alerts: loadAlerts(),
  };
}

function buildPrompt(sum) {
  return `You are StatFax, a home-run betting model. Write a SHORT morning brief for today's slate (${sum.date}) that a bettor reads in 15 seconds before making picks.

BOARD SNAPSHOT (${sum.batCount} hitters across ${sum.gameCount} games; ${sum.primeCount} PRIME, ${sum.strongCount} STRONG):

TOP PLAYS (already ranked by the model):
${sum.topPlays.map((p) => `- ${p}`).join('\n')}

BEST PARK / WEATHER SPOTS (higher env = more HR-friendly):
${sum.parkSpots.map((p) => `- ${p}`).join('\n')}
${sum.alerts.length ? `\nCONTEXT ALERTS (injuries / scratches / weather to watch):\n${sum.alerts.map((a) => `- ${a}`).join('\n')}` : ''}

Write 3-4 sentences (one flowing paragraph, ~60-90 words). Rules:
- Use ONLY the facts above. Never invent stats, players, or numbers.
- Lead with the 1-2 headline plays by name, then call out the best park/weather spot, then any alert worth knowing.
- Confident and conversational, but NEVER promise a home run or say "lock"/"guaranteed".
- No preamble, no markdown, no bullet points, no title. Just the paragraph.`;
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
      max_tokens: 320,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Anthropic API ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}

async function main() {
  const base = { date: null, generatedAt: new Date().toISOString(), model: MODEL, source: 'claude', text: '' };
  let slate;
  try {
    slate = await loadSlate();
  } catch (e) {
    console.warn(`[brief] no slate: ${e.message}`);
    return write({ ...base, skipped: true });
  }
  base.date = slate.date;
  const sum = summarize(slate);

  if (!sum.topPlays.length) {
    console.warn('[brief] empty board — nothing to summarize');
    return write({ ...base, skipped: true });
  }

  const prompt = buildPrompt(sum);

  if (DRY_RUN) {
    console.log('[brief] --dry-run: prompt built (' + prompt.length + ' chars), no API call');
    return write({ ...base, skipped: true, dryRun: true });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('[brief] ANTHROPIC_API_KEY not set — skipping (model predictions unaffected)');
    return write({ ...base, skipped: true });
  }
  if (priorIsFresh(slate.date)) {
    const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    const ageMin = Math.round((Date.now() - new Date(prev.generatedAt).getTime()) / 60000);
    console.log(`[brief] reusing today's brief.json (${ageMin}m old, < ${STALE_HOURS}h) — no API call`);
    return; // leave the existing file in place
  }
  try {
    const text = await callClaude(prompt);
    write({ ...base, text, primeCount: sum.primeCount, strongCount: sum.strongCount });
  } catch (e) {
    console.warn(`[brief] pass failed (non-fatal): ${e.message}`);
    write({ ...base, skipped: true, error: e.message });
  }
}

main();
