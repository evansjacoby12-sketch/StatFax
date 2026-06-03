/**
 * score-offline.mjs — load the REAL scoring engine (bundled for Node by
 * server/build-model.mjs) and re-score recorded inputs with zero network. This
 * is the rule-engine fork loop: edit src/sports/mlb/logic/ProbabilityEngine.js,
 * re-run this, diff the scores against the baseline.
 *
 *   node model-lab/score-offline.mjs
 *
 * Corpus format — model-lab/data/inputs-YYYY-MM-DD.json: an array of
 *   { id, name, args: [ ...exact scoreBatter() argument list... ] }
 * The published daily.json stores OUTPUTS, not the 25-arg input bundle, so to
 * build this corpus you log inputs from the cron (see README → Capturing inputs).
 * Until then this just proves the offline engine bundles + runs.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel } from '../server/build-model.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, 'data');

// 1) Bundle src/sports/mlb/logic/ProbabilityEngine.js → server/.build/model.mjs.
await buildModel();
const engine = await import('../server/.build/model.mjs');
console.log(`Engine bundled + loaded. Exports: ${Object.keys(engine).join(', ')}`);

if (typeof engine.scoreBatter !== 'function') {
  console.error('scoreBatter is not exported from the bundle — check ProbabilityEngine exports.');
  process.exit(1);
}

// 2) Re-score the recorded input corpus, if present.
const files = existsSync(DATA) ? readdirSync(DATA).filter((f) => /^inputs-.*\.json$/.test(f)) : [];
if (!files.length) {
  console.log('\nNo data/inputs-*.json corpus yet — see README "Capturing inputs".');
  console.log('The offline engine is ready: once a corpus exists, this re-scores it with no API calls,');
  console.log('so you can A/B engine variants on identical inputs.');
  process.exit(0);
}

let n = 0, sum = 0, nan = 0;
const out = [];
for (const f of files) {
  const corpus = JSON.parse(readFileSync(resolve(DATA, f), 'utf8'));
  for (const row of corpus) {
    let res;
    try { res = engine.scoreBatter(...row.args); } catch { nan++; continue; }
    if (Number.isFinite(res?.score)) { n++; sum += res.score; out.push({ id: row.id, name: row.name, score: res.score, grade: res.grade?.label ?? res.grade }); }
    else nan++;
  }
}
console.log(`\nRe-scored ${n} records${nan ? ` (${nan} non-finite/errored)` : ''}.  Mean score ${(sum / (n || 1)).toFixed(1)}.`);
console.log('Top 10:');
out.sort((a, b) => b.score - a.score).slice(0, 10).forEach((r, i) => console.log(`  ${i + 1}. ${String(r.name).padEnd(22)} ${r.score}  ${r.grade}`));
