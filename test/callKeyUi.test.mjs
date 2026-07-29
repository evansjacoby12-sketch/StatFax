import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Games and NRFI/YRFI share an honest responsive call-key legend', async () => {
  const [key, games, firstInning, css] = await Promise.all([
    readFile(new URL('../ui/src/components/CallKey.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/GamesView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/FirstInningZone.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8'),
  ])

  assert.match(key, /aria-label="Model call key"/)
  assert.match(key, /title: 'Game markets'/)
  assert.match(key, /tier: 'PLAY'/)
  assert.match(key, /tier: 'PASS'/)
  assert.match(key, /Best actionable edge/)
  assert.match(key, /not recommended as a bet/)
  assert.match(key, /title: 'First inning'/)
  assert.match(key, /tier: 'STRONG'/)
  assert.match(key, /tier: 'WATCH'/)
  assert.match(key, /Diagnostic matchup — not actionable yet/)
  assert.match(key, /<Icon name=\{item\.icon\}/)

  assert.match(
    games,
    /<GameFilterBar[\s\S]*?<CallKey className="games-call-key" \/>[\s\S]*?<section className="games-accordion"/,
  )
  assert.match(
    firstInning,
    /<section className="fi-method">[\s\S]*?<CallKey className="fi-call-key" \/>[\s\S]*?<section className="fi-controls"/,
  )
  assert.match(css, /\.call-key\s*\{/)
  assert.match(css, /\.call-key-tier\.is-actionable/)
  assert.match(css, /\.call-key-tier\.is-lean/)
  assert.match(css, /\.call-key-tier\.is-diagnostic/)
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.call-key-item/)
})
