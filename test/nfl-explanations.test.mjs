import test from 'node:test'
import assert from 'node:assert/strict'
import { nflSignalCaption, nflSignalText } from '../ui/src/lib/nflExplanations.js'

test('NFL ELI5 translates stat signals into plain English', () => {
  assert.equal(nflSignalText({ key: 'touchdown', games: 3, text: '3G TD streak', tone: 'hot' }, 'eli5'), 'Scored a touchdown in 3 straight games')
  assert.equal(nflSignalText({ key: 'route-participation', text: '82% routes/dropback', tone: 'strong' }, 'eli5'), 'Runs a route on most passing plays')
  assert.equal(nflSignalText({ key: 'snap-limit', text: 'Snap limit 65%', tone: 'warn' }, 'eli5'), 'May play fewer snaps than usual (about 65% maximum)')
  assert.equal(nflSignalText({ key: 'committee-risk', text: '48% backfield carry share', tone: 'bad' }, 'eli5'), 'Shares backfield work and gets only about 48% of the carries')
  assert.equal(nflSignalText({ key: 'end-zone-alpha', text: '40% end-zone target share', tone: 'prime' }, 'eli5'), "Gets 40% of his team's end-zone throws")
})

test('NFL ELI15 preserves the engine stat wording', () => {
  const signal = { key: 'rz-targets', text: '6 RZ targets L3', tone: 'prime' }
  assert.equal(nflSignalText(signal, 'eli15'), signal.text)
  assert.equal(nflSignalCaption('eli15'), 'Active model evidence')
  assert.equal(nflSignalCaption('eli5'), 'Why it matters')
})
