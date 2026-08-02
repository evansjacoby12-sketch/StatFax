import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Games workspace receives and labels advisory game forecasts and validation', async () => {
  const [app, games, marketView, css] = await Promise.all([
    readFile(new URL('../ui/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/GamesView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/lib/gameMarketView.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8'),
  ])

  assert.match(app, /gameProjections=\{data\.raw\?\.gameProjections \|\| \{\}\}/)
  assert.match(app, /gameProjectionEvaluation=\{data\.raw\?\.gameProjectionEvaluation \|\| null\}/)
  assert.match(app, /gameMarketEvaluation=\{data\.raw\?\.gameMarketEvaluation \|\| null\}/)
  assert.match(app, /gameMarketPortfolio=\{data\.raw\?\.gameMarketPortfolio \|\| null\}/)
  assert.match(games, /Model forecast v\{projection\.modelVersion \|\| 1\}/i)
  assert.match(games, /projected runs/i)
  assert.match(games, /Projected total/i)
  assert.match(games, /Game market decision grades/i)
  assert.match(games, /Forecast favorite:/i)
  assert.match(games, /Model chance/i)
  assert.match(games, /Est\. ROI/i)
  assert.match(games, /Curated slate/i)
  assert.match(games, /historical games/i)
  assert.match(games, /Forward monitor/i)
  assert.match(games, /Blow-Up Risk/i)
  assert.match(games, /chance of \{blowUpRisk\.thresholdRuns\}\+ runs/i)
  assert.match(marketView, /3-season validated/i)
  assert.match(games, /gameMarketMovementCaution/)
  assert.match(games, /gameMarketPortfolioSelection/)
  assert.match(games, /gameMarketValidation/)
  assert.doesNotMatch(games, /intervalLabel/)
  assert.doesNotMatch(games, /Most likely/i)
  assert.doesNotMatch(games, />Estimated score</i)
  assert.match(games, /Market & validation/i)
  assert.match(games, /Market input/i)
  assert.match(games, /Comparison only/)
  assert.match(games, /Frozen pregame/i)
  assert.match(games, /advisory/i)
  assert.match(css, /\.game-forecast-details/)
  assert.match(css, /\.game-decision-card\.play/)
  assert.match(css, /\.game-decision-card\.lean/)
  assert.match(css, /\.game-decision-card\.pass/)
  assert.match(css, /\.game-decision-card\.unavailable/)
  assert.match(css, /\.game-decision-curated/)
  assert.match(css, /\.game-decision-caution/)
  assert.match(css, /\.game-decision-blowup\.high/)
  assert.match(css, /\.game-forecast-projection/)
  assert.match(css, /\.game-forecast\.details-open/)
})
