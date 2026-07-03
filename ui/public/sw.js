/* StatFax service worker — offline-capable board.
 *
 * Strategies:
 *   · navigations      → network-first, fall back to the cached shell (offline)
 *   · /assets/*        → cache-first (content-hashed by Vite, immutable)
 *   · /data/*.json     → network-first; offline falls back to the LAST slate
 *                        (query-stripped cache key — the app cache-busts with ?t=)
 *   · google fonts     → cache-first (woff2 files are immutable)
 *   · /api/*           → never cached (local-server live endpoints)
 *
 * Bump VERSION to force a full cache flush on the next deploy.
 */
const VERSION = 'sf-v1'
const SHELL = `${VERSION}-shell`
const ASSETS = `${VERSION}-assets`
const DATA = `${VERSION}-data`
const FONTS = `${VERSION}-fonts`
const ASSET_LIMIT = 60

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icon.svg'])).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Trim a cache to its most recent N entries (insertion order ≈ oldest first).
async function trim(name, limit) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  if (keys.length > limit) await Promise.all(keys.slice(0, keys.length - limit).map((k) => cache.delete(k)))
}

async function networkFirstNav(req) {
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(SHELL)
      cache.put('/', res.clone())
    }
    return res
  } catch {
    return (await caches.match('/')) || Response.error()
  }
}

async function cacheFirst(req, name) {
  const hit = await caches.match(req, { cacheName: name })
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    const cache = await caches.open(name)
    cache.put(req, res.clone())
    trim(name, ASSET_LIMIT)
  }
  return res
}

async function networkFirstData(req) {
  // Strip the cache-buster query so every poll updates ONE cache entry per file.
  const url = new URL(req.url)
  url.search = ''
  const key = url.href
  try {
    const res = await fetch(req)
    if (res.ok) {
      const cache = await caches.open(DATA)
      cache.put(key, res.clone())
    }
    return res
  } catch {
    const hit = await caches.match(key, { cacheName: DATA })
    if (hit) return hit
    throw new Error('offline, no cached data')
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.pathname.startsWith('/api/')) return // live server endpoints — always network

  if (req.mode === 'navigate') {
    e.respondWith(networkFirstNav(req))
    return
  }
  if (url.origin === location.origin && url.pathname.startsWith('/assets/')) {
    e.respondWith(cacheFirst(req, ASSETS))
    return
  }
  if (url.origin === location.origin && url.pathname.startsWith('/data/') && url.pathname.endsWith('.json')) {
    e.respondWith(networkFirstData(req))
    return
  }
  if (url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONTS))
    return
  }
  if (url.hostname === 'fonts.googleapis.com') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone()
          caches.open(FONTS).then((c) => c.put(req, copy))
        }
        return res
      }).catch(() => caches.match(req, { cacheName: FONTS }))
    )
    return
  }
  // Everything else (MLB headshots/logos, statsapi) — straight to network.
})

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})
