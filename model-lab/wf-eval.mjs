/**
 * wf-eval.mjs — Walk-forward evaluator for the ensemble stacker.
 *
 * Slides a training window across the reconciled backtest log, trains two
 * stacker variants on each window, and scores the next held-out window.
 * Honest holdout Brier/AUC — no training-set leakage.
 *
 * Four models compared on every window:
 *   1. BASELINE  — predict the overall training-set HR rate for everyone
 *   2. RULE      — rule model score → prob (isotonic fit on training set)
 *   3. SHALLOW   — current production stacker: score + badges + grade one-hots
 *   4. RICH      — raw Statcast + matchup signals (no sub-scores)
 *
 * Usage:
 *   node model-lab/wf-eval.mjs
 *   node model-lab/wf-eval.mjs --train=14 --holdout=7 --stride=7
 *   node model-lab/wf-eval.mjs --log=model-lab/data/backtest-log.json
 *   node model-lab/wf-eval.mjs --weights   # print rich stacker weights from last window
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brier, logLoss, auc, baseRate, fitScoreToProb } from './lib/metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI args ─────────────────────────────────────────────────────────────────
function arg(name, def) {
  const a = process.argv.find(a => a.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
}
const TRAIN_DAYS   = parseInt(arg('train',   '14'), 10);
const HOLDOUT_DAYS = parseInt(arg('holdout',  '7'), 10);
const STRIDE_DAYS  = parseInt(arg('stride',   '7'), 10);
const LOG_PATH     = arg('log', resolve(__dirname, 'data/backtest-log.json'));
const SHOW_WEIGHTS = process.argv.includes('--weights');

// ── Logistic regression (L2 ridge, full-batch GD) ────────────────────────────
function sigmoid(z) {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

function trainLogReg(X, y, { lr = 0.05, iters = 600, l2 = 0.01 } = {}) {
  const n = X.length;
  const d = X[0].length;
  const base = y.reduce((s, v) => s + v, 0) / n;
  const safe = Math.max(0.001, Math.min(0.999, base));
  const weights = new Array(d).fill(0);
  let intercept = Math.log(safe / (1 - safe));

  for (let iter = 0; iter < iters; iter++) {
    let bGrad = 0;
    const wGrad = new Array(d).fill(0);
    for (let i = 0; i < n; i++) {
      let z = intercept;
      for (let j = 0; j < d; j++) z += weights[j] * X[i][j];
      const err = sigmoid(z) - y[i];
      bGrad += err;
      for (let j = 0; j < d; j++) wGrad[j] += err * X[i][j];
    }
    intercept -= lr * (bGrad / n);
    for (let j = 0; j < d; j++) {
      weights[j] -= lr * (wGrad[j] / n + l2 * weights[j]);
    }
  }
  return { weights, intercept };
}

function predictLogReg(X, { weights, intercept }) {
  return X.map(row => {
    let z = intercept;
    for (let j = 0; j < row.length; j++) z += weights[j] * row[j];
    return sigmoid(z);
  });
}

// ── Imputation + z-score normalization (computed on training set only) ────────
function fitTransform(records, featKeys) {
  const stats = {};
  for (const k of featKeys) {
    const vals = records.map(r => r.feat?.[k]).filter(v => v != null && Number.isFinite(v));
    const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
    const variance = vals.length ? vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length : 1;
    stats[k] = { mean, std: Math.sqrt(variance) || 1 };
  }
  return stats;
}

// ── Shallow stacker feature extraction ───────────────────────────────────────
// Mirrors the current production schema: normalised score + badge booleans +
// grade one-hots. Every field is always present so no imputation is needed.
const BADGE_KEYS = ['hot', 'due', 'cold', 'bullpenLegend', 'homeEdge', 'awayEdge'];
const GRADE_KEYS = ['PRIME', 'STRONG', 'LEAN', 'SKIP'];

function extractShallow(record) {
  const score = Math.max(0, Math.min(1, (record.score ?? 0) / 100));
  const badgeArr = Array.isArray(record.badges) ? record.badges : null;
  const hasBadge = k => (badgeArr ? badgeArr.includes(k) : record[k] === true);
  const gradeLabel = typeof record.grade === 'string' ? record.grade
    : record.grade?.label ?? null;
  return [
    score,
    ...BADGE_KEYS.map(k => hasBadge(k) ? 1 : 0),
    ...GRADE_KEYS.map(k => gradeLabel === k ? 1 : 0),
  ];
}

export const SHALLOW_FEATURE_NAMES = ['score', ...BADGE_KEYS.map(k=>`badge_${k}`), ...GRADE_KEYS.map(k=>`grade_${k}`)];

// ── Rich stacker feature schema ───────────────────────────────────────────────
// Raw signals only — no rule-model sub-scores (bs/ms/es create double-counting
// and add 36% structural nulls from early log entries that lacked sub-scores),
// and NO ceiling/form COMPOSITES (ceil/form) — we feed their raw ingredients
// instead so the stacker learns the weighting rather than trusting a hand-built
// score. vig (Vegas prob) is 98% null — omitted until odds API is live.
// Missingness indicators for features with high null rates so the model knows
// when a value is imputed vs. observed.
const RAW_FEAT_KEYS = [
  'iso', 'xiso', 'brl', 'rbrl', 'ev', 'la',
  'phr9', 'pera', 'pk9', 'vdel', 'csw',
  'park', 'ord', 'hot', 'due',
  // Ceiling/form raw ingredients — INSTRUMENTED 2026-07-10. ~100% null until a
  // week of slates accrue, at which point fitTransform (impute-to-mean + z-score,
  // std||1) auto-activates them with no code change. hh was historically null
  // but is now fetched, so it re-enters here too.
  'hh', 'ss', 'evhi', 'rev',
];
// High null-rate columns → add _miss indicator (imputed-vs-observed flag).
const MISS_KEYS = ['xiso', 'brl', 'ev', 'la', 'hh', 'ss', 'evhi', 'rev'];

export const RICH_FEATURE_NAMES = [
  'score_norm',           // rule model composite — one of many inputs, not a dominant one
  ...RAW_FEAT_KEYS,
  ...MISS_KEYS.map(k => `${k}_miss`),
];

// Record must have feat populated (iso != null) to be included in rich model training/eval.
export function hasRichFeat(r) {
  return r.feat && r.feat.iso != null;
}

function extractRich(record, stats) {
  // Normalised rule score — kept as one input, not the dominant one
  const scoreNorm = Math.max(0, Math.min(1, (record.score ?? 0) / 100));

  // Raw signals: impute missing with training-set column mean, then z-score.
  const rawVals = RAW_FEAT_KEYS.map(k => {
    const raw = record.feat?.[k];
    const v = (raw != null && Number.isFinite(raw)) ? raw : stats[k].mean;
    return (v - stats[k].mean) / stats[k].std;
  });

  // Missingness indicators (1 = value was imputed)
  const missVals = MISS_KEYS.map(k => {
    const raw = record.feat?.[k];
    return (raw == null || !Number.isFinite(raw)) ? 1 : 0;
  });

  return [scoreNorm, ...rawVals, ...missVals];
}

// ── Evaluate a model (given predicted probs + labels) ────────────────────────
function evalRows(rows) {
  return { brier: brier(rows), logLoss: logLoss(rows), auc: auc(rows), n: rows.length };
}

// ── Load data ─────────────────────────────────────────────────────────────────
const log = JSON.parse(readFileSync(LOG_PATH, 'utf8'));
const allDates = log.dates || [];
const played = d => (log.records[d] || []).filter(r => r.actuallyPlayed !== false);

// ── Build windows ─────────────────────────────────────────────────────────────
const windows = [];
for (let start = 0; start + TRAIN_DAYS + HOLDOUT_DAYS <= allDates.length; start += STRIDE_DAYS) {
  windows.push({
    trainDates:   allDates.slice(start, start + TRAIN_DAYS),
    holdoutDates: allDates.slice(start + TRAIN_DAYS, start + TRAIN_DAYS + HOLDOUT_DAYS),
  });
}
// Always include a final window that uses everything up to the end, even if
// the holdout is shorter than HOLDOUT_DAYS (avoids losing the last few days).
const lastFull = windows.length > 0 ? windows[windows.length - 1] : null;
const remainStart = lastFull ? allDates.indexOf(lastFull.holdoutDates[lastFull.holdoutDates.length - 1]) + 1 : 0;
if (remainStart < allDates.length && remainStart >= TRAIN_DAYS) {
  const tail = {
    trainDates:   allDates.slice(remainStart - TRAIN_DAYS, remainStart),
    holdoutDates: allDates.slice(remainStart),
  };
  if (tail.holdoutDates.length > 0 && (!lastFull || tail.holdoutDates[0] !== (lastFull.holdoutDates[0]))) {
    windows.push(tail);
  }
}

if (!windows.length) {
  console.error(`Not enough dates for even one window (need ${TRAIN_DAYS + HOLDOUT_DAYS}, have ${allDates.length}).`);
  process.exit(1);
}

console.log(`Walk-forward eval — ${allDates.length} total dates · train=${TRAIN_DAYS} holdout=${HOLDOUT_DAYS} stride=${STRIDE_DAYS}`);
console.log(`Windows: ${windows.length}\n`);

// ── Per-window results accumulator ────────────────────────────────────────────
const accumulated = { baseline: [], rule: [], shallow: [], rich: [] };
let lastWindowWeights = null;

// ── Per-window header ─────────────────────────────────────────────────────────
const W = 12;
const col = (s, w=W) => String(s).padStart(w);
console.log(
  'Window'.padEnd(24),
  col('N-train'), col('N-test'),
  col('Base Brier'), col('Rule Brier'), col('Shal Brier'), col('Rich Brier'),
  col('Rule AUC'), col('Shal AUC'), col('Rich AUC'),
);
console.log('-'.repeat(24 + W * 9));

for (const { trainDates, holdoutDates } of windows) {
  const trainRecs   = trainDates.flatMap(played);
  const holdoutRecs = holdoutDates.flatMap(played);
  if (!trainRecs.length || !holdoutRecs.length) continue;

  const label = `${trainDates[0]}→${holdoutDates[holdoutDates.length - 1]}`;
  const trainRate = baseRate(trainRecs.map(r => ({ y: r.homered ? 1 : 0 })));
  const y_hold    = holdoutRecs.map(r => r.homered ? 1 : 0);

  // ── 1. BASELINE ──
  const baseRows = holdoutRecs.map(r => ({ p: trainRate, y: r.homered ? 1 : 0 }));

  // ── 2. RULE (isotonic score → prob, fit on training set) ──
  const scoreFn  = fitScoreToProb(trainRecs.map(r => ({ score: r.score, y: r.homered ? 1 : 0 })));
  const ruleRows = holdoutRecs.map(r => ({ p: scoreFn(r.score), y: r.homered ? 1 : 0 }));

  // ── 3. SHALLOW stacker ──
  const X_sh_train = trainRecs.map(extractShallow);
  const y_sh_train = trainRecs.map(r => r.homered ? 1 : 0);
  const shModel    = trainLogReg(X_sh_train, y_sh_train);
  const p_sh_hold  = predictLogReg(holdoutRecs.map(extractShallow), shModel);
  const shallowRows = holdoutRecs.map((r, i) => ({ p: p_sh_hold[i], y: y_hold[i] }));

  // ── 4. RICH stacker (records with feat only) ──
  const trainRich   = trainRecs.filter(hasRichFeat);
  const holdoutRich = holdoutRecs.filter(hasRichFeat);
  let richRows = null;
  let richModel = null;

  if (trainRich.length >= 50 && holdoutRich.length >= 10) {
    const impStats   = fitTransform(trainRich, RAW_FEAT_KEYS);
    const X_ri_train = trainRich.map(r => extractRich(r, impStats));
    const y_ri_train = trainRich.map(r => r.homered ? 1 : 0);
    richModel = trainLogReg(X_ri_train, y_ri_train, { l2: 0.05 });
    richModel._impStats = impStats; // stash for weight display

    const X_ri_hold = holdoutRich.map(r => extractRich(r, impStats));
    const p_ri_hold = predictLogReg(X_ri_hold, richModel);
    richRows = holdoutRich.map((r, i) => ({ p: p_ri_hold[i], y: r.homered ? 1 : 0 }));
    lastWindowWeights = { model: richModel, featureNames: RICH_FEATURE_NAMES };
  }

  // ── Accumulate for aggregate ──
  for (const r of baseRows)    accumulated.baseline.push(r);
  for (const r of ruleRows)    accumulated.rule.push(r);
  for (const r of shallowRows) accumulated.shallow.push(r);
  if (richRows) for (const r of richRows) accumulated.rich.push(r);

  // ── Per-window output ──
  const fmt = v => v == null ? '     n/a' : v.toFixed(4).padStart(W);
  const bBase  = brier(baseRows);
  const bRule  = brier(ruleRows);
  const bShal  = brier(shallowRows);
  const bRich  = richRows ? brier(richRows) : null;
  const aucRule = auc(ruleRows);
  const aucShal = auc(shallowRows);
  const aucRich = richRows ? auc(richRows) : null;

  console.log(
    label.padEnd(24),
    col(trainRecs.length), col(holdoutRecs.length),
    fmt(bBase), fmt(bRule), fmt(bShal), fmt(bRich),
    fmt(aucRule), fmt(aucShal), fmt(aucRich),
  );
}

// ── Aggregate across all holdout windows ─────────────────────────────────────
console.log('\n' + '─'.repeat(24 + W * 9));
console.log('AGGREGATE (all holdout days combined)\n');

function printMetrics(label, rows) {
  if (!rows.length) { console.log(`  ${label.padEnd(10)} no data`); return; }
  console.log(`  ${label.padEnd(10)} n=${String(rows.length).padStart(5)}  Brier=${brier(rows).toFixed(4)}  LogLoss=${logLoss(rows).toFixed(4)}  AUC=${auc(rows).toFixed(4)}`);
}

printMetrics('BASELINE',  accumulated.baseline);
printMetrics('RULE',      accumulated.rule);
printMetrics('SHALLOW',   accumulated.shallow);
printMetrics('RICH',      accumulated.rich);

// Brier skill score vs baseline: positive = improvement, 1.0 = perfect.
const baseBrier  = brier(accumulated.baseline);
const ruleBrier  = brier(accumulated.rule);
const shalBrier  = brier(accumulated.shallow);
const richBrier  = accumulated.rich.length ? brier(accumulated.rich) : null;

console.log('\n  Brier Skill Score vs baseline (higher = better):');
console.log(`    RULE    ${((1 - ruleBrier / baseBrier) * 100).toFixed(2).padStart(6)}%`);
console.log(`    SHALLOW ${((1 - shalBrier / baseBrier) * 100).toFixed(2).padStart(6)}%`);
if (richBrier != null)
  console.log(`    RICH    ${((1 - richBrier / baseBrier) * 100).toFixed(2).padStart(6)}%`);

// ── Rich stacker feature weights (last window) ────────────────────────────────
if (lastWindowWeights && (SHOW_WEIGHTS || true)) {
  const { model, featureNames } = lastWindowWeights;
  const pairs = featureNames.map((name, i) => ({ name, w: model.weights[i] }))
    .sort((a, b) => Math.abs(b.w) - Math.abs(a.w));

  console.log('\n  Rich stacker weights (last training window, sorted by |weight|):');
  console.log('  ' + '─'.repeat(40));
  for (const { name, w } of pairs) {
    const bar = '█'.repeat(Math.round(Math.abs(w) * 20)).padEnd(20);
    const sign = w >= 0 ? '+' : '-';
    console.log(`  ${name.padEnd(16)} ${sign}${Math.abs(w).toFixed(3)}  ${bar}`);
  }
  console.log(`  intercept          ${model.intercept >= 0 ? '+' : ''}${model.intercept.toFixed(3)}`);
}

// ── Promotion gate ────────────────────────────────────────────────────────────
console.log('\n  PROMOTION GATE — flip the switch when ALL of these are true:');
const ruleWins = windows.length >= 2;
const richVsRule = richBrier != null && richBrier < ruleBrier;
const richVsShallow = richBrier != null && richBrier < shalBrier;
const enoughData = accumulated.rich.length >= 500;

const check = ok => ok ? '✓' : '✗';
console.log(`  ${check(ruleWins)}   ≥2 complete walk-forward windows  (${windows.length})`);
console.log(`  ${check(enoughData)}   ≥500 holdout rich-feat records  (${accumulated.rich.length})`);
console.log(`  ${check(richVsRule)}   RICH holdout Brier < RULE Brier  (${richBrier?.toFixed(4) ?? 'n/a'} vs ${ruleBrier.toFixed(4)})`);
console.log(`  ${check(richVsShallow)}   RICH holdout Brier < SHALLOW Brier  (${richBrier?.toFixed(4) ?? 'n/a'} vs ${shalBrier.toFixed(4)})`);

const allGreen = ruleWins && enoughData && richVsRule && richVsShallow;
console.log(`\n  ${allGreen ? '→ ALL GREEN — safe to graduate to rich feature set.' : '→ Not ready. Accumulate more data and re-run.'}\n`);
