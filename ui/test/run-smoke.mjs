// Bundles render-smoke.jsx (JSX + react-dom/server) with esbuild and runs it,
// propagating its exit code. Used by `npm run smoke` and the deploy workflow.
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const out = join(mkdtempSync(join(tmpdir(), 'smoke-')), 'smoke.cjs')
await build({
  entryPoints: ['test/render-smoke.jsx'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  outfile: out,
  logLevel: 'error',
})
const r = spawnSync(process.execPath, [out], { stdio: 'inherit' })
process.exit(r.status ?? 1)
