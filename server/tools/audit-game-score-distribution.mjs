import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MLB_GAME_SCORE_DISPERSION,
  negativeBinomialDistribution,
} from '../../src/sports/mlb/logic/gameProjection.js'
import { validateMlbSeasonResults } from '../../src/sports/mlb/logic/teamScoringForm.js'

const PUBLIC_RESULTS_URL = 'https://pub-f7f0c61cfc5840ce8b07ddb42902aa48.r2.dev/mlb-game-results.json'
const supplied = process.argv.find((value) => value.startsWith('--results='))
const jsonOutput = process.argv.includes('--json')

async function loadArtifact() {
  const localPath = resolve(supplied ? supplied.slice('--results='.length) : 'dist/mlb-game-results.json')
  if (existsSync(localPath)) {
    return { source: localPath, artifact: JSON.parse(readFileSync(localPath, 'utf8')) }
  }
  if (supplied) throw new Error(`file not found at ${localPath}`)
  const response = await fetch(PUBLIC_RESULTS_URL)
  if (!response.ok) throw new Error(`results fetch failed (${response.status})`)
  return { source: PUBLIC_RESULTS_URL, artifact: await response.json() }
}

function moments(values) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1)
  return {
    mean,
    variance,
    dispersion: variance > mean ? (mean ** 2) / (variance - mean) : Number.POSITIVE_INFINITY,
  }
}

function poissonProbability(runs, mean) {
  let probability = Math.exp(-mean)
  for (let value = 1; value <= runs; value++) probability *= mean / value
  return probability
}

function negativeBinomialProbability(runs, mean, dispersion) {
  return negativeBinomialDistribution(mean, dispersion, Math.max(40, runs))[runs]
}

function averageLogLoss(values, probability) {
  return values.reduce(
    (sum, value) => sum - Math.log(Math.max(Number.EPSILON, probability(value))),
    0,
  ) / values.length
}

try {
  const { source, artifact } = await loadArtifact()
  const validation = validateMlbSeasonResults(artifact)
  if (!validation.ok) throw new Error(validation.errors.join('\n- '))
  const games = [...artifact.games].sort((left, right) => (
    left.officialDate.localeCompare(right.officialDate) || left.gamePk - right.gamePk
  ))
  const split = Math.floor(games.length * 0.7)
  const trainingRuns = games.slice(0, split).flatMap((game) => [game.awayRuns, game.homeRuns])
  const testRuns = games.slice(split).flatMap((game) => [game.awayRuns, game.homeRuns])
  const full = moments([...trainingRuns, ...testRuns])
  const training = moments(trainingRuns)
  const poissonLogLoss = averageLogLoss(testRuns, (runs) => poissonProbability(runs, training.mean))
  const calibratedLogLoss = averageLogLoss(
    testRuns,
    (runs) => negativeBinomialProbability(runs, training.mean, MLB_GAME_SCORE_DISPERSION),
  )
  const report = {
    source,
    season: artifact.season,
    throughDate: artifact.throughDate,
    games: games.length,
    trainingGames: split,
    testGames: games.length - split,
    teamRunMean: Number(full.mean.toFixed(4)),
    teamRunVariance: Number(full.variance.toFixed(4)),
    momentDispersion: Number(full.dispersion.toFixed(4)),
    trainingDispersion: Number(training.dispersion.toFixed(4)),
    modelDispersion: MLB_GAME_SCORE_DISPERSION,
    heldOutPoissonLogLoss: Number(poissonLogLoss.toFixed(6)),
    heldOutNegativeBinomialLogLoss: Number(calibratedLogLoss.toFixed(6)),
    heldOutImprovementPct: Number((((poissonLogLoss - calibratedLogLoss) / poissonLogLoss) * 100).toFixed(2)),
    verdict: calibratedLogLoss < poissonLogLoss ? 'negative-binomial-wins' : 'poisson-wins',
  }
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(
      `[game-score-distribution] ${report.games} games through ${report.throughDate} `
      + `(${report.trainingGames} train / ${report.testGames} test)`,
    )
    console.log(
      `[game-score-distribution] team runs mean ${report.teamRunMean} · variance ${report.teamRunVariance} `
      + `· moment r ${report.momentDispersion} · model r ${report.modelDispersion}`,
    )
    console.log(
      `[game-score-distribution] held-out log loss Poisson ${report.heldOutPoissonLogLoss} `
      + `vs NB ${report.heldOutNegativeBinomialLogLoss} `
      + `(${report.heldOutImprovementPct}% better)`,
    )
  }
  if (report.verdict !== 'negative-binomial-wins') process.exitCode = 1
} catch (error) {
  console.error(`[game-score-distribution] ${error.message}`)
  process.exitCode = 1
}
