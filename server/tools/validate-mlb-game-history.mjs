import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { validateMlbGameHistory } from '../../src/sports/mlb/logic/gameHistoricalValidation.js'

const prefix = '--history='
const supplied = process.argv.find((arg) => arg.startsWith(prefix))
const path = resolve(supplied ? supplied.slice(prefix.length) : 'dist/mlb-game-history.json')

try {
  const history = JSON.parse(readFileSync(path, 'utf8'))
  const validation = validateMlbGameHistory(history)
  if (!validation.ok) throw new Error(validation.errors.join('; '))
  console.log(
    `[mlb-game-history] valid ${validation.metrics.seasons} seasons · `
    + `${validation.metrics.games} regular-season finals`,
  )
} catch (error) {
  console.error(`[mlb-game-history] ${error.message}`)
  process.exitCode = 1
}
