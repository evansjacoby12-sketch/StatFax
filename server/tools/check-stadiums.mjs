#!/usr/bin/env node
/**
 * check-stadiums.mjs — static-data smoke test for stadiums.json
 *
 * Cheap insurance against typos in the stadium data file: a single
 * field with a wrong sign or out-of-range value can silently break wind
 * verdicts for an entire team's home games. Run as part of a pre-commit
 * hook, or wire into the cron workflow before the slate generator
 * touches stadiums.
 *
 * Validates:
 *   - Exactly 30 entries (one per MLB team)
 *   - Every required field is present and well-typed
 *   - Bearings are in [0, 360)
 *   - Lat in [25, 50] (MLB territory: Miami to Toronto)
 *   - Lon in [-125, -65] (Seattle to Boston)
 *   - Team abbreviations are unique
 *   - Stadium type is one of: 'Open' | 'Retractable' | 'Fixed Dome'
 *   - Park factors are in a sane range (0.7 - 1.5)
 *
 * Exits non-zero on any failure so CI can gate on it.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STADIUMS_PATH = resolve(HERE, '../../src/sports/mlb/data/stadiums.json');

const REQUIRED_TEAMS = new Set([
  'ARI','ATL','BAL','BOS','CHC','CWS','CIN','CLE','COL','DET',
  'HOU','KC','LAA','LAD','MIA','MIL','MIN','NYM','NYY','OAK',
  'PHI','PIT','SD','SF','SEA','STL','TB','TEX','TOR','WSH',
]);

const VALID_TYPES = new Set(['Open', 'Retractable', 'Fixed Dome']);

const errors = [];
const warn   = [];

function check(cond, msg) {
  if (!cond) errors.push(msg);
}

function warnIf(cond, msg) {
  if (cond) warn.push(msg);
}

const raw = await readFile(STADIUMS_PATH, 'utf-8');
let data;
try {
  data = JSON.parse(raw);
} catch (e) {
  console.error(`[check-stadiums] FATAL: stadiums.json is not valid JSON: ${e.message}`);
  process.exit(1);
}

const stadiums = data.stadiums;
check(Array.isArray(stadiums), 'data.stadiums must be an array');
if (!Array.isArray(stadiums)) {
  console.error(errors.join('\n'));
  process.exit(1);
}

check(stadiums.length === 30, `expected 30 stadiums, got ${stadiums.length}`);

const seenTeams = new Set();
for (const s of stadiums) {
  const prefix = `[${s.team || '???'}]`;

  check(typeof s.team === 'string' && REQUIRED_TEAMS.has(s.team),
    `${prefix} team must be a valid MLB abbreviation`);
  check(!seenTeams.has(s.team), `${prefix} duplicate team entry`);
  seenTeams.add(s.team);

  check(typeof s.name === 'string' && s.name.length > 0,
    `${prefix} name missing`);
  check(typeof s.lat === 'number' && s.lat >= 25 && s.lat <= 50,
    `${prefix} lat ${s.lat} out of [25, 50] MLB range`);
  check(typeof s.lon === 'number' && s.lon >= -125 && s.lon <= -65,
    `${prefix} lon ${s.lon} out of [-125, -65] MLB range`);
  check(typeof s.bearing === 'number' && s.bearing >= 0 && s.bearing < 360,
    `${prefix} bearing ${s.bearing} out of [0, 360)`);
  check(typeof s.elevationFt === 'number' && s.elevationFt >= 0 && s.elevationFt <= 6000,
    `${prefix} elevationFt ${s.elevationFt} out of [0, 6000] sane range`);
  check(VALID_TYPES.has(s.type),
    `${prefix} type '${s.type}' must be one of ${[...VALID_TYPES].join('|')}`);
  check(typeof s.parkFactor === 'number' && s.parkFactor >= 0.7 && s.parkFactor <= 1.5,
    `${prefix} parkFactor ${s.parkFactor} out of [0.7, 1.5] sane range`);
  check(typeof s.parkFactorL === 'number' && s.parkFactorL >= 0.7 && s.parkFactorL <= 1.5,
    `${prefix} parkFactorL ${s.parkFactorL} out of [0.7, 1.5] sane range`);
  check(typeof s.parkFactorR === 'number' && s.parkFactorR >= 0.7 && s.parkFactorR <= 1.5,
    `${prefix} parkFactorR ${s.parkFactorR} out of [0.7, 1.5] sane range`);

  // Warn on bearings that look like defaults (round numbers) which
  // historically were placeholders for stadiums where the actual
  // orientation wasn't measured. Not an error since they may genuinely
  // be 0 (N-facing) but worth flagging for a satellite re-derive.
  warnIf(s.bearing === 0 || s.bearing === 45 || s.bearing === 90,
    `${prefix} bearing ${s.bearing} is a round number — verify via satellite (see server/tools/compute-bearings.mjs)`);
}

// Cross-check: every REQUIRED_TEAMS entry must appear.
for (const t of REQUIRED_TEAMS) {
  if (!seenTeams.has(t)) errors.push(`missing entry for team ${t}`);
}

if (warn.length) {
  console.warn('\n[check-stadiums] WARNINGS:');
  for (const w of warn) console.warn(`  ⚠ ${w}`);
}

if (errors.length) {
  console.error('\n[check-stadiums] ERRORS:');
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

console.log(`[check-stadiums] ✓ all ${stadiums.length} entries valid${warn.length ? ` (${warn.length} warning${warn.length === 1 ? '' : 's'})` : ''}`);
