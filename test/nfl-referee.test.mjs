import test from 'node:test'
import assert from 'node:assert/strict'

import { getRefereeCrew, nflRefereeImpact } from '../src/sports/nfl/logic/referee.js'
import { scoreNFLProp } from '../src/sports/nfl/logic/ScoringEngine.js'
import { buildNFLSignals } from '../src/sports/nfl/logic/signals.js'
import NFL_DEMO_SNAPSHOT from '../src/sports/nfl/data/demoSlate.js'

const player = (name) => NFL_DEMO_SNAPSHOT.players.find((item) => item.name === name)

test('getRefereeCrew resolves active NFL crews and handles fallbacks', () => {
  const vinovich = getRefereeCrew('Bill Vinovich')
  assert.equal(vinovich.name, 'Bill Vinovich')
  assert.equal(vinovich.style, 'Let Them Play')
  assert.equal(vinovich.flagsPerGame, 9.8)

  const novakCase = getRefereeCrew('scott novak')
  assert.equal(novakCase.name, 'Scott Novak')
  assert.equal(novakCase.style, 'DPI Heavy')

  const unknown = getRefereeCrew('Unknown Official')
  assert.equal(unknown.flagsPerGame, 12.2)
  assert.equal(unknown.totalScoreFactor, 1.0)

  assert.equal(getRefereeCrew(null), null)
})

test('nflRefereeImpact bounds adjustments and applies crew tendencies', () => {
  const hill = player('Tyreek Hill')

  // 1. DPI Heavy Crew (Scott Novak) boosts deep pass receivers
  const novakImpact = nflRefereeImpact('Scott Novak', 'receiving_yards', hill)
  assert.ok(novakImpact.factor > 1.0, `Expected Novak factor > 1.0, got ${novakImpact.factor}`)
  assert.ok(novakImpact.factor <= 1.05, `Expected Novak factor <= 1.05, got ${novakImpact.factor}`)
  assert.equal(novakImpact.style, 'DPI Heavy')
  assert.ok(novakImpact.label.includes('Scott Novak'))

  // 2. Flag Heavy / High Holding Crew (Carl Cheffers) creates rush penalty drag
  const henry = player('Derrick Henry')
  const cheffersImpact = nflRefereeImpact('Carl Cheffers', 'rushing_yards', henry)
  assert.ok(cheffersImpact.factor < 1.0, `Expected Cheffers factor < 1.0, got ${cheffersImpact.factor}`)
  assert.ok(cheffersImpact.factor >= 0.95, `Expected Cheffers factor >= 0.95, got ${cheffersImpact.factor}`)

  // 3. Let Them Play Crew (Bill Vinovich) boosts overall game pace and touchdown expectation
  const vinovichImpact = nflRefereeImpact('Bill Vinovich', 'anytime_td', henry)
  assert.ok(vinovichImpact.factor > 1.0, `Expected Vinovich factor > 1.0, got ${vinovichImpact.factor}`)

  // 4. Null / Missing referee defaults to neutral
  const nullImpact = nflRefereeImpact(null, 'receiving_yards', hill)
  assert.equal(nullImpact.factor, 1.0)
})

test('referee crew factors integrate into scoreNFLProp calculations', () => {
  const hill = player('Tyreek Hill')

  // Baseline without referee
  const baseResult = scoreNFLProp({ ...hill, referee: null }, 'receiving_yards')

  // Under DPI-heavy crew (Scott Novak)
  const novakResult = scoreNFLProp({ ...hill, referee: 'Scott Novak' }, 'receiving_yards')
  assert.ok(novakResult.mean > baseResult.mean, 'DPI heavy referee should increase receiving yardage mean')
  assert.ok(novakResult.reasons.some((r) => r.includes('Scott Novak')))

  // Under Flag-heavy crew (Carl Cheffers) on rushing
  const henry = player('Derrick Henry')
  const baseHenry = scoreNFLProp({ ...henry, referee: null }, 'rushing_yards')
  const cheffersHenry = scoreNFLProp({ ...henry, referee: 'Carl Cheffers' }, 'rushing_yards')
  assert.ok(cheffersHenry.mean < baseHenry.mean, 'Flag heavy crew should suppress rushing yardage mean')
})

test('officiating signals trigger for notable crew profiles', () => {
  const hill = player('Tyreek Hill')
  const novakSignals = buildNFLSignals({ ...hill, referee: 'Scott Novak' })
  assert.ok(novakSignals.some((s) => s.key === 'ref-dpi-edge'), 'Scott Novak should trigger ref-dpi-edge')

  const henry = player('Derrick Henry')
  const vinovichSignals = buildNFLSignals({ ...henry, referee: 'Bill Vinovich' })
  assert.ok(vinovichSignals.some((s) => s.key === 'ref-let-them-play'), 'Bill Vinovich should trigger ref-let-them-play')

  const cheffersSignals = buildNFLSignals({ ...henry, referee: 'Carl Cheffers' })
  assert.ok(cheffersSignals.some((s) => s.key === 'ref-flag-heavy'), 'Carl Cheffers should trigger ref-flag-heavy')
})
