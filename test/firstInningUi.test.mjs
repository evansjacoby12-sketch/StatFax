import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('BetLab replaces the MLB custom builder with a priced-honest NRFI/YRFI zone', async () => {
  const [app, lab, zone, css] = await Promise.all([
    readFile(new URL('../ui/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/BetLab.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/FirstInningZone.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8'),
  ])

  assert.match(lab, /label: 'NRFI \/ YRFI zone'/)
  assert.doesNotMatch(lab, /label: 'Custom builder'/)
  assert.doesNotMatch(lab, /ParlayBuilder/)
  assert.match(lab, /<FirstInningZone/)
  assert.match(app, /firstInningHistoricalValidation=\{data\.raw\?\.firstInningHistoricalValidation \|\| null\}/)
  assert.match(app, /gameProjections=\{data\.raw\?\.gameProjections \|\| \{\}\}/)
  assert.match(zone, /Forecast V9 \+ 1st Inning Layer/)
  assert.match(zone, /NRFI and YRFI are complementary model probabilities/)
  assert.match(zone, /Qualified only/)
  assert.match(zone, /Lineup ready/)
  assert.match(zone, /All start times/)
  assert.match(zone, /Case/)
  assert.match(zone, /Caution/)
  assert.match(zone, /No value or EV claim/)
  assert.doesNotMatch(zone, /american|sportsbook odds|expectedRoi/)
  assert.match(css, /\.fi-game-main/)
  assert.match(css, /\.fi-half/)
  assert.match(css, /\.fi-case-caution/)
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.fi-game-main/)
})
