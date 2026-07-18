import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Bet Lab exposes Core Pair roles and longer-parlay volatility', async () => {
  const source = await readFile(new URL('../ui/src/components/GroupsView.jsx', import.meta.url), 'utf8')
  assert.match(source, /g\.strategy === 'core'/)
  assert.match(source, /LOWER VARIANCE/)
  assert.match(source, /CORE \+ VOLATILE/)
  assert.match(source, /const coreFirst/)
  assert.match(source, /role\.toUpperCase\(\)/)
  assert.match(source, /Support: the strongest separate-game/)
  assert.match(source, /g\.size >= 3 && i === weakestIdx/)
  assert.match(source, /> VOLATILE/)
})
