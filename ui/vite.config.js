import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// The brain writes its scored slate here. The UI is a sibling folder (ui/),
// so the dist lives one level up.
const DIST_DIR = path.resolve(__dirname, '..', 'dist')

/**
 * Serve the brain's live dist/ folder at /data/* during dev, reading fresh
 * from disk on every request. That way the board always reflects the latest
 * `npm run slate` without copying the 6MB daily.json around. On build, the
 * data files are copied into the output so `vite preview` works offline too.
 */
function statfaxData() {
  return {
    name: 'statfax-data',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '')
        const file = path.join(DIST_DIR, rel)
        // Stay inside dist/.
        if (!file.startsWith(DIST_DIR) || !rel.endsWith('.json')) return next()
        fs.readFile(file, (err, buf) => {
          if (err) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: `not found: ${rel}`, dist: DIST_DIR }))
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(buf)
        })
      })
    },
    closeBundle() {
      const outData = path.resolve(__dirname, 'dist', 'data')
      try {
        fs.mkdirSync(outData, { recursive: true })
        // Bundle the data into the static build so a plain static host (GitHub
        // Pages, Cloudflare Pages, …) serves a fully self-contained snapshot.
        for (const f of ['daily.json', 'backtest-log.json', 'calibration.json', 'context.json', 'mlb-data-health.json', 'mlb-data-health-history.json', 'board-history.json', 'brief.json']) {
          const src = path.join(DIST_DIR, f)
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outData, f))
        }
        const nflSrc = path.join(DIST_DIR, 'nfl', 'daily.json')
        if (fs.existsSync(nflSrc)) {
          const nflOut = path.join(outData, 'nfl')
          fs.mkdirSync(nflOut, { recursive: true })
          fs.copyFileSync(nflSrc, path.join(nflOut, 'daily.json'))
        }
      } catch (e) {
        this.warn(`could not copy data into build: ${e.message}`)
      }
      // Stamp the build's commit SHA so the UpdateBanner can compare a STABLE id
      // (immune to non-deterministic bundle hashes / CDN edge skew) instead of
      // parsing the cached index.html. version.json is tiny + always cache-busted.
      try {
        const sha = process.env.GITHUB_SHA || 'dev'
        fs.writeFileSync(path.resolve(__dirname, 'dist', 'version.json'), JSON.stringify({ sha, builtAt: new Date().toISOString() }))
      } catch (e) {
        this.warn(`could not write version.json: ${e.message}`)
      }
    },
  }
}

export default defineConfig(({ command }) => ({
  // Relative base on build → works at any URL (root host OR a GitHub Pages
  // project subpath). Root '/' in dev keeps the dev server simple.
  base: command === 'build' ? './' : '/',
  // Bake the commit SHA + build timestamp into the app. SHA is 'dev' locally
  // (GITHUB_SHA only set in CI); the timestamp fallback lets the banner fire
  // even in dev-SHA builds when a newer deploy has a later builtAt.
  define: {
    __BUILD_SHA__:  JSON.stringify(process.env.GITHUB_SHA || 'dev'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [react(), statfaxData()],
  server: {
    port: 5180,
    // Allow the dev server to be reached through the ngrok tunnel (Vite blocks
    // unknown Host headers by default). The leading dot also covers any other
    // *.ngrok-free.dev subdomain you spin up.
    allowedHosts: ['boastful-lizard-slashing.ngrok-free.dev', '.ngrok-free.dev'],
  },
}))
