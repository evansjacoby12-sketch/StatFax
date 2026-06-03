/**
 * build-model.mjs — esbuild bundler for the HR scoring model
 *
 * Bundles src/logic/ProbabilityEngine.js (and everything it imports) into a
 * single self-contained Node-compatible ESM file at server/.build/model.mjs.
 *
 * The bundle is consumed by server/fetch-slate.mjs so the GitHub Actions
 * snapshot can ship PRE-SCORED batters. Every device then reads identical
 * scores from the shared snapshot — no possibility of cross-device drift
 * from per-device scoring loops running at different times against slightly
 * different inputs.
 *
 * Why bundle vs. import directly?
 *   - ProbabilityEngine imports a JSON file (stadiums.json) and a sibling
 *     module that depends on @react-native-async-storage/async-storage,
 *     which doesn't resolve in plain Node. esbuild inlines the JSON and
 *     aliases the RN-only package to a no-op shim.
 *   - One file output = trivial to load and gives a clean cache boundary.
 *
 * Run locally:    node server/build-model.mjs
 */

import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRY     = resolve(__dirname, '../src/sports/mlb/logic/ProbabilityEngine.js');
const OUTFILE   = resolve(__dirname, '.build/model.mjs');
const STUB      = resolve(__dirname, 'lib/asyncstorage-stub.mjs');

/**
 * Run the esbuild bundle. Importable from fetch-slate.mjs so the CI workflow
 * can re-run the build inline without spawning a separate node process.
 * Returns { outfile, bytes }.
 */
export async function buildModel() {
  mkdirSync(dirname(OUTFILE), { recursive: true });

  const startedAt = Date.now();
  await build({
    entryPoints: [ENTRY],
    outfile:     OUTFILE,
    bundle:      true,
    platform:    'node',
    format:      'esm',
    target:      'node18',
    // Bundle everything inline — the GitHub Actions runner has no per-bundle
    // node_modules quirks to worry about and a self-contained file is the
    // safest deployment artifact.
    external:    [],
    // Alias the React Native AsyncStorage package to a no-op Node shim.
    // calibration.js imports it at top level for the device-side persistence
    // path, but on the server CALIBRATION_ENABLED is hard-false so the
    // methods are never actually called.
    alias:       {
      '@react-native-async-storage/async-storage': STUB,
    },
    // JSON imports (stadiums.json) get inlined by default with bundle:true.
    loader:      { '.json': 'json' },
    // Keep the bundle readable for debugging — gzip transport compresses
    // the snapshot upload, so on-disk size matters less than legibility.
    minify:      false,
    sourcemap:   false,
    logLevel:    'info',
  });

  const bytes = statSync(OUTFILE).size;
  const kb    = (bytes / 1024).toFixed(1);
  const ms    = Date.now() - startedAt;
  console.log(`[build-model] wrote ${OUTFILE} (${kb} KB) in ${ms}ms`);
  return { outfile: OUTFILE, bytes };
}

// Auto-run when invoked as a CLI script (`node server/build-model.mjs`).
// When imported as a module the named export above is used instead.
const isMain = import.meta.url === `file://${process.argv[1]}` ||
               import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
if (isMain) {
  buildModel().catch((err) => {
    console.error('[build-model] FAILED:', err);
    process.exit(1);
  });
}
