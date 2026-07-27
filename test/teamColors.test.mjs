import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { TEAM_COLORS as engineTeamColors } from '../src/data/teamColors.js'
import { TEAM_COLORS as uiTeamColors } from '../ui/src/lib/teams.js'

test('Detroit uses its navy primary and stays distinct from Baltimore orange', () => {
  assert.equal(engineTeamColors[116], '#0C2340')
  assert.equal(uiTeamColors[116], '#0C2340')
  assert.equal(engineTeamColors[116], uiTeamColors[116])
  assert.notEqual(uiTeamColors[116], uiTeamColors[110])
})

test('forecast win bar marks the exact probability split independently of team colors', async () => {
  const css = await readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8')
  assert.match(css, /\.game-forecast-win i::after/)
  assert.match(css, /left:\s*var\(--forecast-away-share\)/)
  assert.match(css, /width:\s*2px/)
  assert.match(css, /translateX\(-1px\)/)
})
