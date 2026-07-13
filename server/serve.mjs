/**
 * serve.mjs — always-on production server (zero deps, Node built-ins only).
 *
 * One process that:
 *   1. Serves the built UI (ui/dist) as a static site + SPA fallback.
 *   2. Serves the live brain output (dist/*.json) at /data/* — read fresh each
 *      request, so the board always reflects the latest slate.
 *   3. Auto-refreshes the slate on a schedule (default every 20 min) by running
 *      server/fetch-slate.mjs — no manual `npm run slate`, no cron needed.
 *
 *   npm run serve                 # port 5180, refresh every 20 min
 *   PORT=8080 REFRESH_MINUTES=10 npm run serve
 *
 * Point ngrok (or any tunnel) at this port for phone access.
 */
import http from 'node:http'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const UI_DIST = path.join(ROOT, 'ui', 'dist')
const DATA_DIR = path.join(ROOT, 'dist')
const PORT = +(process.env.PORT || 5180)
// Clamp to [1 min, 12 h] — also keeps the setInterval delay inside int32.
const REFRESH_MIN = Math.min(Math.max(+(process.env.REFRESH_MINUTES || 20) || 20, 1), 720)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
}

// ── Slate scheduler ─────────────────────────────────────────────────────────
let refreshing = false
let lastRun = 0
let lastOk = null
function runSlate(reason) {
  if (refreshing) {
    console.log(`[serve] skip refresh (${reason}) — one already running`)
    return
  }
  refreshing = true
  const t0 = Date.now()
  console.log(`[serve] slate refresh (${reason})…`)
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'fetch-slate.mjs')], { cwd: ROOT, stdio: 'inherit' })
  child.on('exit', (code) => {
    const nfl = spawn(process.execPath, [path.join(ROOT, 'server', 'sports', 'nfl', 'fetch-nfl-slate.mjs')], { cwd: ROOT, stdio: 'inherit' })
    nfl.on('exit', (nflCode) => {
      refreshing = false
      lastRun = Date.now()
      lastOk = code === 0 && nflCode === 0
      console.log(`[serve] pipelines ${lastOk ? 'ok' : `FAILED (mlb=${code}, nfl=${nflCode})`} in ${((Date.now() - t0) / 1000).toFixed(0)}s`)
    })
    nfl.on('error', (e) => {
      refreshing = false
      lastRun = Date.now()
      lastOk = false
      console.warn(`[serve] NFL slate spawn error: ${e.message}`)
    })
  })
  child.on('error', (e) => {
    refreshing = false
    console.warn(`[serve] slate spawn error: ${e.message}`)
  })
}
function initialRefresh() {
  try {
    const st = fsSync.statSync(path.join(DATA_DIR, 'daily.json'))
    const ageMin = (Date.now() - st.mtimeMs) / 60000
    if (ageMin > REFRESH_MIN) runSlate(`startup · ${ageMin.toFixed(0)}m stale`)
    else console.log(`[serve] daily.json is ${ageMin.toFixed(0)}m old — fresh enough`)
  } catch {
    runSlate('startup · no slate yet')
  }
}

// ── Static + data serving ───────────────────────────────────────────────────
function head(res, status, type) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' })
}
async function serveFile(res, file) {
  try {
    const data = await fs.readFile(file)
    head(res, 200, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream')
    res.end(data)
    return true
  } catch {
    return false
  }
}

const server = http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])

  if (url === '/api/status') {
    head(res, 200, 'application/json')
    return res.end(JSON.stringify({ refreshing, lastRun, lastOk, refreshMinutes: REFRESH_MIN }))
  }

  if (url === '/api/refresh' && req.method === 'POST') {
    runSlate('manual')
    head(res, 202, 'application/json')
    return res.end(JSON.stringify({ triggered: true, refreshing: true }))
  }

  // Live brain data.
  if (url.startsWith('/data/')) {
    const rel = url.slice(6).replace(/^\/+/, '')
    const file = path.join(DATA_DIR, rel)
    if (file.startsWith(DATA_DIR) && rel.endsWith('.json') && (await serveFile(res, file))) return
    head(res, 404, 'application/json')
    return res.end(JSON.stringify({ error: `not found: ${rel}` }))
  }

  // Static UI (with SPA fallback to index.html).
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '')
  const file = path.join(UI_DIST, rel)
  if (file.startsWith(UI_DIST) && (await serveFile(res, file))) return
  if (await serveFile(res, path.join(UI_DIST, 'index.html'))) return
  head(res, 404, 'text/plain')
  res.end('not found')
})

if (!fsSync.existsSync(path.join(UI_DIST, 'index.html'))) {
  console.warn('[serve] UI is not built yet — run:  npm --prefix ui run build')
}
server.listen(PORT, () => {
  console.log(`[serve] StatFax → http://localhost:${PORT}  (auto-refresh every ${REFRESH_MIN}m)`)
  initialRefresh()
  setInterval(() => runSlate('interval'), REFRESH_MIN * 60000)
})
