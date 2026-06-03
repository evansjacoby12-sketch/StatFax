#!/usr/bin/env node
/**
 * compute-bearings.mjs
 *
 * Reads `src/data/stadiums.json` and, for each stadium that has both
 * `homePlateLatLon` and `centerFieldLatLon`, computes the compass
 * bearing FROM home plate TO center field via the great-circle initial-
 * bearing formula. Writes the result back into the `bearing` field.
 *
 * Why this exists:
 *   Stadium CF bearings were hand-edited based on memory + ballparks.com,
 *   which was wrong for ~15 of 30 parks (wrong-stadium for renamed parks,
 *   missing for new builds, estimated for the rest). That caused weeks
 *   of "the compass is flipped on park X" iterations. With actual
 *   home-plate + CF coordinates picked from Google Maps satellite, the
 *   bearing is derived from raw geometry — no judgment calls, no
 *   convention drift.
 *
 * To re-derive bearings:
 *   1. For each stadium, open https://maps.google.com and switch to
 *      satellite view at the stadium's lat/lon. Zoom in until you can
 *      see the infield.
 *   2. Right-click the dirt patch behind home plate → "What's here?" →
 *      copy the decimal lat,lon. That's `homePlateLatLon`.
 *   3. Right-click the dead center of the outfield wall (or the CF
 *      camera position) → "What's here?" → copy. That's
 *      `centerFieldLatLon`.
 *   4. Add both as `[lat, lon]` arrays to the stadium's entry in
 *      stadiums.json.
 *   5. Run: `node server/tools/compute-bearings.mjs --write`
 *
 * Dry-run by default (just prints the deltas). Pass `--write` to
 * actually update the JSON.
 *
 * Bearings stay in [0, 360) clockwise from true north.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STADIUMS_PATH = resolve(HERE, '../../src/sports/mlb/data/stadiums.json');

const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

/**
 * Initial bearing from [lat1, lon1] to [lat2, lon2], in compass degrees
 * (clockwise from true north, [0, 360)). Uses the standard great-circle
 * formula — accurate enough for distances <1km (every CF is within 130m
 * of home plate, so even simple equirectangular would work, but this
 * version is correct regardless).
 */
export function bearingBetween([lat1, lon1], [lat2, lon2]) {
  const φ1 = lat1 * TO_RAD;
  const φ2 = lat2 * TO_RAD;
  const Δλ = (lon2 - lon1) * TO_RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * TO_DEG) + 360) % 360;
}

async function main() {
  const raw = await readFile(STADIUMS_PATH, 'utf-8');
  const data = JSON.parse(raw);
  const write = process.argv.includes('--write');

  let updated = 0;
  let skipped = 0;
  const report = [];

  for (const s of data.stadiums) {
    if (!Array.isArray(s.homePlateLatLon) || !Array.isArray(s.centerFieldLatLon)) {
      report.push(`  ${s.team.padEnd(4)} ${s.name.padEnd(30)} [no coords — using ${s.bearing}°]`);
      skipped++;
      continue;
    }
    const computed = Math.round(bearingBetween(s.homePlateLatLon, s.centerFieldLatLon));
    const delta    = computed - s.bearing;
    const wrapped  = ((delta + 540) % 360) - 180;   // signed diff in [-180, 180]
    report.push(`  ${s.team.padEnd(4)} ${s.name.padEnd(30)} ${String(s.bearing).padStart(4)}° → ${String(computed).padStart(4)}°  (Δ ${wrapped >= 0 ? '+' : ''}${wrapped}°)`);
    if (write) s.bearing = computed;
    updated++;
  }

  console.log(`[bearings] ${updated} stadiums derived, ${skipped} skipped (need coords)\n`);
  console.log(report.join('\n'));

  if (write) {
    // Preserve trailing newline for git-diff politeness.
    await writeFile(STADIUMS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
    console.log(`\n[bearings] wrote ${STADIUMS_PATH}`);
  } else {
    console.log(`\n[bearings] dry run — pass --write to apply`);
  }
}

main().catch(e => {
  console.error('[bearings] fatal:', e);
  process.exit(1);
});
