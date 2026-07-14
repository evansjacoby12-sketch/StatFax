/**
 * pull-data.mjs — download the R2 model artifacts into model-lab/data/ so the
 * rest of the lab runs fully offline. Re-run anytime to refresh the corpus.
 *
 *   node model-lab/pull-data.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(__dirname, 'data');
const BASE = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev';

async function getJson(url) {
  const res = await fetch(`${url}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

mkdirSync(DATA, { recursive: true });

console.log('Pulling backtest-log.json …');
const log = await getJson(`${BASE}/backtest-log.json`);
writeFileSync(resolve(DATA, 'backtest-log.json'), JSON.stringify(log));
const evidenceDates = log.modelHistory?.dates?.length ? log.modelHistory.dates : (log.dates || []);
const evidenceRecords = log.modelHistory?.dates?.length ? log.modelHistory.records : (log.records || {});
const days = evidenceDates.length;
const total = evidenceDates.reduce((s, d) => s + (evidenceRecords?.[d]?.length || 0), 0);
console.log(`  ✓ ${days} evidence days, ${total} reconciled predictions (${evidenceDates[0]} … ${evidenceDates[days - 1]})`);

console.log('Pulling daily.json (today’s snapshot) …');
try {
  const snap = await getJson(`${BASE}/daily.json`);
  writeFileSync(resolve(DATA, `daily-${snap.date}.json`), JSON.stringify(snap));
  const n = Object.keys(snap.scoredBatters || {}).filter((k) => k.includes('-')).length;
  console.log(`  ✓ ${snap.date}: ${n} scored batter-games`);
} catch (e) {
  console.log(`  – skipped (${e.message})`);
}

console.log('\nDone → model-lab/data/.  Next:  node model-lab/backtest.mjs   |   node model-lab/train-logreg.mjs');
