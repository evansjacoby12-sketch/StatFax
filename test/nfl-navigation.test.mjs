import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('NFL header receives sport scope and cannot wire MLB workspace actions', async () => {
  const [app, header] = await Promise.all([readFile(new URL('../ui/src/App.jsx', import.meta.url), 'utf8'), readFile(new URL('../ui/src/components/Header.jsx', import.meta.url), 'utf8')])
  const nflBranch = app.slice(app.indexOf("if (sport === 'nfl')"), app.indexOf('return (', app.indexOf("if (sport === 'nfl')") + 50))
  assert.match(app, /<Header[\s\S]*?sport="nfl"/)
  assert.doesNotMatch(nflBranch, /openMlb|onOpenGroups|onOpenWeather|onOpenBacktest|onOpenSettings/)
  assert.match(header, /<HelpMenu[\s\S]*?sport=\{sport\}/)
  assert.match(header, /const isNFL = sport === 'nfl'/)
})
