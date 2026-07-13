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

test('NFL board exposes aligned position, team, and game filters', async () => {
  const [board, styles] = await Promise.all([readFile(new URL('../ui/src/components/NFLBoard.jsx', import.meta.url), 'utf8'), readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8')])
  assert.match(board, /aria-label="Position"/)
  assert.match(board, /aria-label="Team"/)
  assert.match(board, /aria-label="Game"/)
  assert.match(board, /<option value="all">All games<\/option>/)
  assert.match(board, /gameKeyFor\(player\) === game/)
  assert.match(styles, /\.nfl-prop-filters \{[^}]*align-items: stretch/)
})

test('NFL player research uses the approved tabbed evidence workspace', async () => {
  const [board, styles] = await Promise.all([readFile(new URL('../ui/src/components/NFLBoard.jsx', import.meta.url), 'utf8'), readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8')])
  for (const tab of ['Overview', 'Role', 'Matchup', 'Game log']) assert.match(board, new RegExp(`label: '${tab}'`))
  assert.match(board, /className="nfl-research-decision"/)
  assert.match(board, /className="nfl-research-tabs"/)
  assert.match(board, /tab === 'gamelog'/)
  assert.match(board, /function PlayerHeadshotSilo/)
  assert.match(board, /player\.headshotUrl/)
  assert.match(board, /variant="workspace"/)
  assert.match(styles, /\.nfl-headshot-silo\.is-compact/)
  assert.match(styles, /\.nfl-headshot-silo\.is-workspace/)
  assert.match(styles, /\.nfl-search > \.sr-only[\s\S]*?clip-path: inset\(50%\)/)
  assert.match(styles, /\.nfl-prop-drawer \{ width: min\(860px, 100vw\)/)
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.nfl-prop-drawer \{ width: 100vw;/)
})
