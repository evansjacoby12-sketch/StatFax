#!/usr/bin/env node
/**
 * seed-hp-cf-coords.mjs (one-time)
 *
 * Populates `homePlateLatLon` + `centerFieldLatLon` for every stadium in
 * stadiums.json so `compute-bearings.mjs` has something to operate on
 * without requiring a full satellite-picking pass.
 *
 * Method (transparent — these are approximations, not surveyor-grade):
 *   - HP coord    = stadium's existing { lat, lon } field. These public
 *                   coordinates are the stadium's main address, which is
 *                   typically within 30-100ft of actual home plate.
 *   - CF coord    = HP + (current `bearing` field) + 400ft (standard
 *                   MLB CF depth). Walked via great-circle destination
 *                   formula at the local lat/lon.
 *
 * Implication: because CF is DERIVED from bearing, running
 * compute-bearings.mjs after this seed will RECOMPUTE roughly the same
 * bearings (modulo rounding). It's circular — no independent verification.
 *
 * What this DOES accomplish:
 *   - Puts the HP/CF data structure in place so future precise pickings
 *     are an edit-in-place job, not a full data backfill.
 *   - Documents the geometry assumption (400ft CF) for every park.
 *   - Surfaces bearing rounding errors (the derived value should match
 *     the stored value within ±1°; bigger drift means something is off
 *     in either the formulas or the source bearings).
 *
 * To replace approximations with real picks later:
 *   1. Open Google Maps satellite at the park
 *   2. Right-click HP dirt → "What's here?" → copy decimal lat,lon
 *   3. Right-click dead-CF wall midpoint → copy
 *   4. Update the stadium's `homePlateLatLon` and `centerFieldLatLon`
 *   5. Run `node server/tools/compute-bearings.mjs --write` to refresh
 *      the bearing field from the new geometry
 *
 * This script runs ONCE and overwrites stadiums.json. After it runs,
 * the seed coords are committed and this script's job is done. Re-run
 * only if every stadium needs re-seeding (e.g., we discover all our
 * bearings are systematically off — unlikely).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const STADIUMS_PATH = resolve(HERE, '../../src/sports/mlb/data/stadiums.json');

// Standard MLB CF depth — most parks are 395-420ft. 400 is a reasonable
// average that keeps the great-circle bearing math accurate.
const CF_DEPTH_FT     = 400;
const CF_DEPTH_METERS = CF_DEPTH_FT * 0.3048;
const R_EARTH_M       = 6371000;

/**
 * Great-circle destination point. Given a start [lat, lon], an initial
 * compass bearing (degrees, clockwise from true north), and a distance
 * in meters, returns the destination [lat, lon].
 *
 * Standard spherical-earth formula — accurate to centimeters at the
 * sub-km distances we're dealing with (CF is ~120m from HP).
 */
function destinationLatLon(lat1, lon1, bearingDeg, distanceM) {
  const δ  = distanceM / R_EARTH_M;
  const θ  = (bearingDeg * Math.PI) / 180;
  const φ1 = (lat1 * Math.PI) / 180;
  const λ1 = (lon1 * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  return [+(φ2 * (180 / Math.PI)).toFixed(6), +(λ2 * (180 / Math.PI)).toFixed(6)];
}

async function main() {
  const raw = await readFile(STADIUMS_PATH, 'utf-8');
  const data = JSON.parse(raw);

  for (const s of data.stadiums) {
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    if (!Number.isFinite(s.bearing)) continue;
    if (s.homePlateLatLon && s.centerFieldLatLon) continue;  // already populated, leave alone

    const hp = [+s.lat.toFixed(6), +s.lon.toFixed(6)];
    const cf = destinationLatLon(hp[0], hp[1], s.bearing, CF_DEPTH_METERS);

    s.homePlateLatLon   = hp;
    s.centerFieldLatLon = cf;
  }

  await writeFile(STADIUMS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`[seed-hp-cf] wrote ${STADIUMS_PATH}`);
}

main().catch(e => {
  console.error('[seed-hp-cf] fatal:', e);
  process.exit(1);
});
