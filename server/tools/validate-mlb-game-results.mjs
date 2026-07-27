import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateMlbSeasonResults } from '../../src/sports/mlb/logic/teamScoringForm.js'

const prefix = '--results='
const supplied = process.argv.find((value) => value.startsWith(prefix))
const path = resolve(supplied ? supplied.slice(prefix.length) : 'dist/mlb-game-results.json')

try {
  if (!existsSync(path)) throw new Error(`file not found at ${path}`)
  const artifact = JSON.parse(readFileSync(path, 'utf8'))
  const validation = validateMlbSeasonResults(artifact)
  if (!validation.ok) throw new Error(validation.errors.join('\n- '))
  console.log(
    `[mlb-game-results] valid season ${artifact.season}: `
    + `${validation.metrics.games} finals · ${validation.metrics.teams} teams · `
    + `${validation.metrics.fromDate || 'no games'} through ${validation.metrics.throughDate}`,
  )
} catch (error) {
  console.error(`[mlb-game-results] ${error.message}`)
  process.exitCode = 1
}
