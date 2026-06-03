/**
 * backtest.mjs — offline backtest of the RULE model against the reconciled log.
 * Reports base rate, per-grade hit rates + lift, score→prob calibration, and
 * Brier / LogLoss / AUC. Same math the production reconcile loop uses, run
 * locally with zero network.
 *
 *   node model-lab/backtest.mjs            # all logged days
 *   node model-lab/backtest.mjs --days=7   # most recent 7 reconciled days
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brier, logLoss, auc, baseRate, calibration, fitScoreToProb } from './lib/metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = JSON.parse(readFileSync(resolve(__dirname, 'data/backtest-log.json'), 'utf8'));

const daysArg = process.argv.find((a) => a.startsWith('--days='));
const nDays = daysArg ? parseInt(daysArg.split('=')[1], 10) : log.dates.length;
const dates = log.dates.slice(-nDays);

// Flatten; drop never-played (scratched) records so we don't bias the rate.
const recs = [];
for (const d of dates) for (const r of (log.records[d] || [])) {
  if (r.actuallyPlayed === false) continue;
  recs.push(r);
}
console.log(`Backtest · ${dates.length} days · ${recs.length} predictions (${dates[0]} … ${dates[dates.length - 1]})\n`);

const base = baseRate(recs.map((r) => ({ y: r.homered })));
console.log(`Base HR rate: ${(base * 100).toFixed(2)}%  (${recs.filter((r) => r.homered).length}/${recs.length})\n`);

console.log('Per-grade hit rate:');
for (const g of ['PRIME', 'STRONG', 'LEAN', 'SKIP']) {
  const gr = recs.filter((r) => r.grade === g);
  if (!gr.length) continue;
  const rate = baseRate(gr.map((r) => ({ y: r.homered })));
  console.log(`  ${g.padEnd(7)} n=${String(gr.length).padStart(4)}  ${(rate * 100).toFixed(1).padStart(5)}%  ${(rate / base).toFixed(2)}x base`);
}

const ruleP = fitScoreToProb(recs.map((r) => ({ score: r.score, y: r.homered ? 1 : 0 })));
const ruleRows = recs.map((r) => ({ p: ruleP(r.score), y: r.homered ? 1 : 0 }));
const baseRows = recs.map((r) => ({ p: base, y: r.homered ? 1 : 0 }));

console.log('\nMetrics (lower Brier/LogLoss, higher AUC = better):');
console.log(`  Baseline (base rate)  Brier ${brier(baseRows).toFixed(4)}  LogLoss ${logLoss(baseRows).toFixed(4)}`);
console.log(`  Rule model (score→p)  Brier ${brier(ruleRows).toFixed(4)}  LogLoss ${logLoss(ruleRows).toFixed(4)}  AUC ${auc(ruleRows).toFixed(4)}`);

console.log('\nCalibration (predicted vs observed HR rate):');
for (const c of calibration(ruleRows, 10)) {
  console.log(`  ${(c.lo * 100).toFixed(0).padStart(3)}–${(c.hi * 100).toFixed(0).padStart(3)}%  n=${String(c.n).padStart(4)}  pred ${(c.pred * 100).toFixed(1).padStart(5)}%  obs ${(c.obs * 100).toFixed(1).padStart(5)}%`);
}
