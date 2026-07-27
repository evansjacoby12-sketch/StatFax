import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Games workspace receives and labels advisory game forecasts and validation', async () => {
  const [app, games, css] = await Promise.all([
    readFile(new URL('../ui/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/GamesView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/App.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /gameProjections=\{data\.raw\?\.gameProjections \|\| \{\}\}/)
  assert.match(app, /gameProjectionEvaluation=\{data\.raw\?\.gameProjectionEvaluation \|\| null\}/)
  assert.match(games, /Model forecast v1/i)
  assert.match(games, /Estimated score/i)
  assert.match(games, /Market & validation/i)
  assert.match(games, /Frozen pregame/i)
  assert.match(games, /advisory/i)
  assert.match(css, /\.game-forecast-details/)
  assert.match(css, /\.game-forecast\.details-open/)
})
