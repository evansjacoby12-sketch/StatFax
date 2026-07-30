import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('BetLab replaces the MLB custom builder with a priced-honest NRFI/YRFI zone and Results owns live tracking', async () => {
  const [app, lab, zone, results, trackingUi, ledgerUi, tracking, css] = await Promise.all([
    readFile(new URL('../ui/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/BetLab.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/FirstInningZone.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/ResultsView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/ModelTrackingResults.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/ModelTrackingLedger.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/lib/modelTracking.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8'),
  ])

  assert.match(lab, /label: 'NRFI \/ YRFI zone'/)
  assert.doesNotMatch(lab, /label: 'Custom builder'/)
  assert.doesNotMatch(lab, /ParlayBuilder/)
  assert.match(lab, /<FirstInningZone/)
  assert.doesNotMatch(lab, /<FirstInningZone[\s\S]*?generatedAt=\{generatedAt\}/)
  assert.match(app, /firstInningHistoricalValidation=\{data\.raw\?\.firstInningHistoricalValidation \|\| null\}/)
  assert.match(app, /gameProjections=\{data\.raw\?\.gameProjections \|\| \{\}\}/)
  assert.match(zone, /Forecast V9 \+ 1st Inning Layer/)
  assert.doesNotMatch(zone, /Today&apos;s model tracking/)
  assert.match(results, /<ModelTrackingResults/)
  assert.match(results, /gameProjections=\{gameProjections\}/)
  assert.match(trackingUi, /Seven-day model tracking/)
  assert.match(trackingUi, /WINDOW_DAYS = 7/)
  assert.match(trackingUi, /resultsByDate: history\?\.gameForecasts\?\.resultsByDate/)
  assert.match(trackingUi, /finals form the record/)
  assert.match(trackingUi, /active leads stay live/)
  assert.match(trackingUi, /title="Over"/)
  assert.match(trackingUi, /title="Under"/)
  assert.match(trackingUi, /title="NRFI"/)
  assert.match(trackingUi, /title="YRFI"/)
  assert.match(trackingUi, /tracking=\{tracking\.firstInning\.nrfi\}/)
  assert.match(trackingUi, /tracking=\{tracking\.firstInning\.yrfi\}/)
  assert.match(trackingUi, /onOpenDetails/)
  assert.match(results, /modelDetailsOpen/)
  assert.match(results, /!modelDetailsOpen && <ModelResults/)
  assert.match(ledgerUi, /Seven-day game results/)
  assert.match(ledgerUi, /Moneyline/)
  assert.match(ledgerUi, /O\/U total/)
  assert.match(ledgerUi, /NRFI \/ YRFI/)
  assert.match(ledgerUi, /Checks and Xs appear only after that market settles/)
  assert.match(ledgerUi, /PASS and WATCH remain visible/)
  assert.match(tracking, /PLAY \+ LEAN/)
  assert.match(tracking, /STRONG \+ LEAN/)
  assert.match(tracking, /diagnosticLabel: 'PASS'/)
  assert.match(tracking, /diagnosticLabel: 'WATCH'/)
  assert.match(tracking, /over: directionalSplit/)
  assert.match(tracking, /under: directionalSplit/)
  assert.match(tracking, /nrfi: directionalSplit/)
  assert.match(tracking, /yrfi: directionalSplit/)
  assert.match(zone, /NRFI and YRFI are complementary model probabilities/)
  assert.match(zone, /Qualified only/)
  assert.match(zone, /Lineup ready/)
  assert.match(zone, /All start times/)
  assert.match(zone, /Case/)
  assert.match(zone, /Caution/)
  assert.match(zone, /No value or EV claim/)
  assert.doesNotMatch(zone, /american|sportsbook odds|expectedRoi/)
  assert.match(css, /\.fi-game-main/)
  assert.match(css, /\.fi-model-results-grid/)
  assert.match(css, /\.fi-track-card\.is-moneyline/)
  assert.match(css, /\.model-ledger-row/)
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.model-ledger-row/)
  assert.match(css, /\.fi-half/)
  assert.match(css, /\.fi-case-caution/)
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*?\.fi-game-main/)
})
