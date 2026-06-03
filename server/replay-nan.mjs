/**
 * replay-nan.mjs — re-run scoreBatter on the inputs the cron captured when
 * the composite came back NaN. Pulls the live snapshot from R2, picks the
 * affected batter (by name or playerId), and reruns the same call locally
 * to surface which intermediate factor went non-finite.
 *
 * Usage:
 *   node server/replay-nan.mjs                       # list everyone in _nanDebug
 *   node server/replay-nan.mjs 670541                # replay by playerId
 *   node server/replay-nan.mjs Yordan                # replay by name (substring)
 *
 * The script also computes every matchupScore sub-factor manually so we can
 * print which one tripped — that's the actual diagnostic value here. The
 * bundled model.mjs only exposes the final composite, not the per-factor
 * intermediates, so we have to redo the math.
 */

import { readFileSync } from 'node:fs';
import { buildModel } from './build-model.mjs';

const SNAPSHOT_URL = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev/daily.json';
const LEAGUE_AVG_HR9   = 1.15;
const LEAGUE_AVG_ERA   = 4.10;
const LEAGUE_AVG_K9    = 8.5;
const LEAGUE_AVG_HARD_HIT = 37.5;
const LEAGUE_AVG_BARREL   = 7.5;
const LEAGUE_AVG_EV       = 88.0;

await buildModel();
const { scoreBatter } = await import('./.build/model.mjs');

async function fetchSnapshot() {
  const res = await fetch(`${SNAPSHOT_URL}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
  return res.json();
}

function blendStat(splitVal, seasonVal, splitIP, k = 35) {
  if (splitVal == null) return seasonVal;
  if (seasonVal == null) return splitVal;
  const weight = Math.min(1, (splitIP || 0) / k);
  return splitVal * weight + seasonVal * (1 - weight);
}

function resolveEffectiveSide(batSide, pitcherHand) {
  if (!batSide || batSide === 'L') return 'L';
  if (batSide === 'R') return 'R';
  return pitcherHand === 'L' ? 'R' : 'L';
}

// Recompute every matchup factor independently so we can pinpoint which
// one went NaN. Mirrors the formulas in src/logic/ProbabilityEngine.js but
// returns each piece labeled.
function diagnoseMatchup(inputs) {
  const { batter, pitcherSplits, pitcherSeason, pitcherSavant, pitchMix,
          battingOrder, h2h, pitcherHand, recentForm } = inputs;
  const effectiveSide = resolveEffectiveSide(batter.batSide, pitcherHand);
  const split    = effectiveSide === 'L' ? pitcherSplits?.vsL : pitcherSplits?.vsR;
  const fallback = pitcherSplits?.vsR || pitcherSplits?.vsL || null;
  const chosen   = split || fallback;
  const splitIP  = chosen?.ip ?? 0;

  // Vuln stats — note that `??` does NOT catch NaN, only null/undefined.
  const vulnHr9Raw = blendStat(chosen?.hrPer9, pitcherSeason?.hrPer9, splitIP);
  const vulnEraRaw = blendStat(chosen?.era,    pitcherSeason?.era,    splitIP);
  const vulnHr9 = vulnHr9Raw ?? LEAGUE_AVG_HR9;
  const vulnEra = vulnEraRaw ?? LEAGUE_AVG_ERA;

  const hr9Factor = Math.min(25, Math.max(-15, (vulnHr9 - LEAGUE_AVG_HR9) * 18));
  const eraFactor = Math.min(12, Math.max(-12, (vulnEra - LEAGUE_AVG_ERA) * 3));
  const kFactor   = pitcherSeason?.kPer9
    ? Math.min(8, Math.max(-8, (LEAGUE_AVG_K9 - pitcherSeason.kPer9) * 1.2))
    : 0;

  const h2hFactor = h2h
    ? Math.min(6, Math.max(-4, (h2h.hrRate - 0.04) * 100))
    : 0;

  const hhFactor  = pitcherSavant?.hardHitPctAllowed != null
    ? (pitcherSavant.hardHitPctAllowed - LEAGUE_AVG_HARD_HIT) * 1.2 : 0;
  const brlFactor = pitcherSavant?.barrelPctAllowed != null
    ? (pitcherSavant.barrelPctAllowed - LEAGUE_AVG_BARREL) * 3.0 : 0;
  const evFactor  = pitcherSavant?.exitVeloAgainst != null
    ? (pitcherSavant.exitVeloAgainst - LEAGUE_AVG_EV) * 0.8 : 0;
  const contactQ  = pitcherSavant ? Math.min(100, Math.max(0, 50 + hhFactor + brlFactor + evFactor)) : 50;
  const contactFactor = Math.min(10, Math.max(-10, (contactQ - 50) * 0.2));

  return {
    effectiveSide,
    chosenSplit: chosen,
    splitIP,
    blendStat: { hr9Raw: vulnHr9Raw, eraRaw: vulnEraRaw },
    vuln:      { hr9: vulnHr9, era: vulnEra },
    factors: {
      hr9Factor, eraFactor, kFactor, h2hFactor,
      contactFactor,
    },
  };
}

const arg = process.argv[2];
const snap = await fetchSnapshot();
const debug = snap._nanDebug || [];

if (!debug.length) {
  console.log(`Snapshot has no _nanDebug entries (generated ${snap.generatedAt}). Either nothing tripped the fallback or the snapshot pre-dates the diagnostic.`);
  process.exit(0);
}

if (!arg) {
  console.log(`Snapshot ${snap.generatedAt} — ${debug.length} batters tripped fallback:`);
  for (const e of debug) {
    console.log(`  ${e.playerId}  ${e.name.padEnd(28)} symptoms: matchup=${e.symptoms.matchupScore} env=${e.symptoms.envScore} batter=${e.symptoms.batterScore}`);
  }
  console.log(`\nUsage: node server/replay-nan.mjs <playerId|name>`);
  process.exit(0);
}

const match = debug.find(e => String(e.playerId) === arg || e.name.toLowerCase().includes(arg.toLowerCase()));
if (!match) {
  console.error(`No _nanDebug entry matches "${arg}".`);
  process.exit(1);
}

console.log(`Replaying ${match.name} (id ${match.playerId}, ${match.batSide}-side, isHome=${match.isHome})`);
console.log(`Snapshot symptoms:`, match.symptoms);
console.log('');

const i = match.inputs;
const result = scoreBatter(
  i.batter, i.opposingPitcher,
  i.pitcherSplits, i.pitcherSeason,
  i.carry, i.savantStats, i.h2h, i.pitcherSavant,
  i.recent30, i.pitchMix, i.battingOrder, i.recent7,
  i.pitcherHand, i.batterHomePF, i.batterArsenal, i.recentForm,
  i.dayNightSplits, i.isDayGame, i.homeAwaySplits, i.isHomeGame,
  i.bullpenSplits, i.opposingBullpenHR9,
);

console.log('Local re-run result:');
console.log('  score:        ', result.score, Number.isFinite(result.score) ? '(finite)' : '(NaN/null)');
console.log('  matchupScore: ', result.matchupScore, Number.isFinite(result.matchupScore) ? '(finite)' : '(NaN/null)');
console.log('  envScore:     ', result.envScore, Number.isFinite(result.envScore) ? '(finite)' : '(NaN/null)');
console.log('  batterScore:  ', result.batterScore);
console.log('');

if (Number.isFinite(result.score)) {
  console.log('** Local repro is FINITE while snapshot was NaN.');
  console.log('** Means a transient input on the cron host produced NaN that does not appear in the captured _nanDebug snapshot of inputs.');
  console.log('** Likely culprit: floating-point edge case on Node 20 (Actions) vs current local Node, or an upstream API field that varies by request.');
}

console.log('\nManual factor breakdown:');
const dx = diagnoseMatchup(i);
console.log(JSON.stringify(dx, null, 2));

// Highlight any NaN we found in the breakdown
function findNan(obj, path = '') {
  for (const [k, v] of Object.entries(obj || {})) {
    if (typeof v === 'number' && !Number.isFinite(v)) {
      console.log(`  ⚠️  NaN at ${path}${k} = ${v}`);
    } else if (v && typeof v === 'object') {
      findNan(v, `${path}${k}.`);
    }
  }
}
console.log('\nNaN scan of factors:');
findNan(dx);
