/**
 * train-logreg.mjs — fit a logistic regression on the logged feature vectors
 * (feat) → P(HR), and compare it head-to-head with the rule model on a held-out
 * time split. This is the "build a new model on it" starting point: change the
 * features, swap the learner, change the split, re-run.
 *
 * Dependency-free (hand-rolled GD + L2), same spirit as server/models/
 * trainEnsembleWeights.mjs but on the FULL 20-feature vector instead of just
 * score/grade/badges.
 *
 *   node model-lab/train-logreg.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brier, logLoss, auc, baseRate, fitScoreToProb } from './lib/metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = JSON.parse(readFileSync(resolve(__dirname, 'data/backtest-log.json'), 'utf8'));

// The 20 logged features (server/reconcile.mjs → extractPredictionRecord.feat).
const FEATURES = ['bs', 'ms', 'es', 'iso', 'xiso', 'brl', 'rbrl', 'ev', 'hh', 'la', 'phr9', 'pera', 'pk9', 'vdel', 'csw', 'park', 'vig', 'ord', 'hot', 'due'];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

// Flatten reconciled, played records that carry a feature vector.
const all = [];
for (const d of log.dates) for (const r of (log.records[d] || [])) {
  if (r.actuallyPlayed === false || !r.feat) continue;
  all.push({ date: d, feat: r.feat, score: r.score, y: r.homered ? 1 : 0 });
}
if (all.length < 100) { console.error(`Only ${all.length} rows carry a feature vector — accumulate more feature-logged days first.`); process.exit(1); }

// Split. Prefer a time-based split (no leakage) across the days that actually
// carry features; fall back to a deterministic random 75/25 when too few days
// are feature-logged for a clean time split. (Features were added to the log
// recently, so early days have score/grade only — they don't qualify here.)
const featDates = [...new Set(all.map((r) => r.date))].sort();
let train, test, splitDesc;
if (featDates.length >= 3) {
  const cut = featDates[Math.floor(featDates.length * 0.75)];
  train = all.filter((r) => r.date < cut);
  test = all.filter((r) => r.date >= cut);
  splitDesc = `time split (train < ${cut} ≤ test)`;
} else {
  const shuffled = all.map((r, i) => ({ r, k: (i * 2654435761) >>> 0 })).sort((a, b) => a.k - b.k).map((x) => x.r);
  const n = Math.floor(shuffled.length * 0.75);
  train = shuffled.slice(0, n);
  test = shuffled.slice(n);
  splitDesc = `random 75/25 — only ${featDates.length} feature-logged day(s); accrue more days for a clean time split`;
}
console.log(`Rows with features: ${all.length} over ${featDates.length} day(s)`);
console.log(`Split: ${splitDesc}\n       train ${train.length} · test ${test.length}\n`);

// Standardize on TRAIN stats; impute missing with the column mean (→ 0 after z-score).
const mean = {}, std = {};
for (const f of FEATURES) {
  const vals = train.map((r) => num(r.feat[f])).filter((v) => v != null);
  const m = vals.reduce((s, v) => s + v, 0) / (vals.length || 1);
  const sd = Math.sqrt(vals.reduce((s, v) => s + (v - m) ** 2, 0) / (vals.length || 1)) || 1;
  mean[f] = m; std[f] = sd;
}
const vec = (feat) => FEATURES.map((f) => { const v = num(feat[f]); return ((v == null ? mean[f] : v) - mean[f]) / std[f]; });

// Logistic regression — batch gradient descent + L2.
const D = FEATURES.length;
const w = new Array(D).fill(0); let b = 0;
const LR = 0.1, L2 = 1e-3, EPOCHS = 500;
const Xtr = train.map((r) => vec(r.feat)), ytr = train.map((r) => r.y);
const sigmoid = (z) => 1 / (1 + Math.exp(-z));
for (let ep = 0; ep < EPOCHS; ep++) {
  const gw = new Array(D).fill(0); let gb = 0;
  for (let i = 0; i < Xtr.length; i++) {
    const p = sigmoid(b + Xtr[i].reduce((s, x, j) => s + x * w[j], 0));
    const err = p - ytr[i];
    for (let j = 0; j < D; j++) gw[j] += err * Xtr[i][j];
    gb += err;
  }
  for (let j = 0; j < D; j++) w[j] -= LR * (gw[j] / Xtr.length + L2 * w[j]);
  b -= LR * (gb / Xtr.length);
}

const predictML = (feat) => sigmoid(b + vec(feat).reduce((s, x, j) => s + x * w[j], 0));
const mlRows = test.map((r) => ({ p: predictML(r.feat), y: r.y }));

// Rule baseline: isotonic score→prob fit on TRAIN, evaluated on TEST.
const ruleP = fitScoreToProb(train.map((r) => ({ score: r.score, y: r.y })));
const ruleRows = test.map((r) => ({ p: ruleP(r.score), y: r.y }));
const base = baseRate(train.map((r) => ({ y: r.y })));
const baseRows = test.map((r) => ({ p: base, y: r.y }));

const fmt = (rows) => `Brier ${brier(rows).toFixed(4)}   LogLoss ${logLoss(rows).toFixed(4)}   AUC ${auc(rows).toFixed(4)}`;
console.log('TEST metrics (lower Brier/LogLoss, higher AUC = better):');
console.log(`  Baseline    ${fmt(baseRows)}`);
console.log(`  Rule model  ${fmt(ruleRows)}`);
console.log(`  LogReg ML   ${fmt(mlRows)}`);

console.log('\nLearned weights (standardized — feature signal strength):');
FEATURES.map((f, j) => ({ f, w: w[j] }))
  .sort((a, b2) => Math.abs(b2.w) - Math.abs(a.w))
  .slice(0, 12)
  .forEach(({ f, w: wj }) => console.log(`  ${f.padEnd(6)} ${wj >= 0 ? '+' : ''}${wj.toFixed(3)}`));

console.log('\nThis is the seed. Add features to the log → extend FEATURES, or swap the learner, then re-run.');
