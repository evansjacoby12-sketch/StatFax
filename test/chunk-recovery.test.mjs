import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isChunkLoadError, recoverChunkLoadError } from '../ui/src/lib/chunkRecovery.js'

test('chunk recovery recognizes dynamic-import failures across browsers', () => {
  for (const message of [
    'Failed to fetch dynamically imported module: https://statfax.online/assets/WeatherView-old.js',
    'Importing a module script failed.',
    'error loading dynamically imported module',
    'ChunkLoadError: Loading chunk 12 failed',
    'Unable to preload CSS for /assets/FindPlays-old.css',
  ]) assert.equal(isChunkLoadError(new Error(message)), true, message)

  assert.equal(isChunkLoadError(new Error('Cannot read properties of null')), false)
})

test('chunk recovery stays inert outside a browser', () => {
  assert.equal(recoverChunkLoadError(new Error('Failed to fetch dynamically imported module')), false)
})

test('the entry shell covers preload, promise, and static asset failures', () => {
  const html = readFileSync(new URL('../ui/index.html', import.meta.url), 'utf8')
  assert.match(html, /vite:preloadError/)
  assert.match(html, /unhandledrejection/)
  assert.match(html, /__STATFAX_RECOVER_STALE_ASSET__/)
  assert.match(html, /COOLDOWN_MS = 30000/)
})

test('the React boundary requests stale-chunk recovery', () => {
  const source = readFileSync(new URL('../ui/src/components/ErrorBoundary.jsx', import.meta.url), 'utf8')
  assert.match(source, /recoverChunkLoadError\(error\)/)
  assert.match(source, /recoverChunkLoadError\(this\.state\.error, \{ force: true \}\)/)
})
