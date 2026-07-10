/**
 * validate-ceil.mjs — forward-validate the ADVISORY ceiling (barrelScore) + form
 * (formScore) metrics by SHORTLIST HIT-RATE on reconciled outcomes, the way HR
 * props are actually read: "bats passing a CEIL/matchup/form threshold homer at
 * X% vs the Y% base rate." AUC is reported too, but hit-rate is the ship gate.
 *
 *   npm run lab:validate-ceil
 *
 * The ceiling fields (feat.ceil/form/mxev/ss/hrd) were instrumented 2026-07-10,
 * so until a week or so of reconciled slates accrue this prints a coverage notice
 * and exits 0 (nothing to validate yet). Once ~200+ reconciled bats carry `ceil`
 * it renders the shortlist table + a SHIP / NO-SHIP read. Advisory metrics never
 * touch the HR score — this only decides whether they're worth SHOWING.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  resolve(__dirname, 'data/backtest-log.json'),   // pulled history (lab:pull)
  resolve(__dirname, '../dist/backtest-log.json'), // freshest local slate
];
const path = CANDIDATES.find(existsSync);
if (!path) {
  console.log('No backtest-log.json found (looked in model-lab/data/ and dist/). Run `npm run lab:pull` or `npm run slate`.');
  process.exit(0);
}
const log = JSON.parse(readFileSync(path, 'utf8'));

// Flatten reconciled opportunities (played bats with a settled HR outcome).
const bats = [];
for (const recs of Object.values(log.records || {})) {
  const arr = Array.isArray(recs) ? recs : Object.values(recs);
  for (const r of arr) {
    if (r.actuallyPlayed === false) continue;
    if (typeof r.homered !== 'boolean') continue;
    const f = r.feat || {};
    bats.push({ ceil: f.ceil, form: f.form, ms: f.ms, hr: r.homered ? 1 : 0 });
  }
}
const N = bats.length, HR = bats.reduce((s, b) => s + b.hr, 0);
const base = N ? HR / N : 0;
console.log(`\nReconciled corpus: ${N} bats · ${HR} HR · base rate ${(100 * base).toFixed(2)}%  (${path.split('/').slice(-2).join('/')})`);

const withCeil = bats.filter(b => Number.isFinite(b.ceil));
console.log(`ceiling coverage: ${withCeil.length}/${N} bats carry feat.ceil (instrumented 2026-07-10)`);
if (withCeil.length < 200) {
  console.log(`\n⏳ Not enough accrued yet to validate (need ~200+, have ${withCeil.length}). Let the new`);
  console.log(`   ceiling fields log for ~a week of slates, then re-run. Nothing ships off CEIL/FORM`);
  console.log(`   until the shortlist hit-rate below clears the base rate on real outcomes.`);
  process.exit(0);
}

// ── AUC (rank) for reference ────────────────────────────────────────────────
function auc(items, key) {
  const rows = items.filter(b => Number.isFinite(b[key])).map(b => ({ v: b[key], y: b.hr }));
  const all = rows.sort((a, b) => a.v - b.v);
  const nP = rows.filter(r => r.y === 1).length, nN = rows.length - nP;
  if (!nP || !nN) return NaN;
  let i = 0, sumPos = 0;
  while (i < all.length) { let j = i; while (j < all.length && all[j].v === all[i].v) j++; const ar = (i + 1 + j) / 2; for (let k = i; k < j; k++) if (all[k].y === 1) sumPos += ar; i = j; }
  return (sumPos - nP * (nP + 1) / 2) / (nP * nN);
}
console.log(`\nAUC vs HR — ceil ${auc(withCeil, 'ceil').toFixed(4)} · form ${auc(bats.filter(b => Number.isFinite(b.form)), 'form').toFixed(4)}  (0.50 = no signal)`);

// ── SHORTLIST HIT-RATE (the ship gate) ──────────────────────────────────────
const rate = a => a.length ? 100 * a.reduce((s, b) => s + b.hr, 0) / a.length : NaN;
const lift = r => `${(r - 100 * base >= 0 ? '+' : '')}${(r - 100 * base).toFixed(1)}pt`;
const SHORTLISTS = [
  { label: 'CEIL ≥ 65',                          pred: b => b.ceil >= 65 },
  { label: 'CEIL ≥ 70 + FORM ≥ 60',              pred: b => b.ceil >= 70 && b.form >= 60 },
  { label: 'CEIL ≥ 75 + Matchup ≥ 60 (Elite)',   pred: b => b.ceil >= 75 && b.ms >= 60 },
  { label: 'CEIL ≥ 75 + Matchup ≥ 60 + FORM ≥ 35', pred: b => b.ceil >= 75 && b.ms >= 60 && b.form >= 35 },
];
console.log(`\nSHORTLIST HIT-RATE (vs ${(100 * base).toFixed(1)}% base):`);
let anyWin = false;
for (const s of SHORTLISTS) {
  const c = withCeil.filter(b => { try { return s.pred(b); } catch { return false; } });
  if (!c.length) { console.log(`  ${s.label.padEnd(40)} —  (0 bats qualify)`); continue; }
  const r = rate(c);
  const win = r > 100 * base * 1.15;   // needs a clear edge, not noise
  if (win) anyWin = true;
  console.log(`  ${s.label.padEnd(40)} ${r.toFixed(1)}%  (n=${c.length}, ${lift(r)})${win ? '  ✓' : ''}`);
}
console.log(`\nVERDICT: ${anyWin
  ? '✅ SHIP — at least one shortlist clears the base rate with a real edge. Surface CEIL/FORM + the winning shortlist as a board signal.'
  : '❌ HOLD — no shortlist beats the base rate convincingly. Do not surface; keep logging or rethink the construction.'}`);
