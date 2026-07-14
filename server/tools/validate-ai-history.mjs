import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidAiHrHistoricalReplay } from '../lib/aiHrHistorical.mjs'

const path = resolve(process.cwd(), process.argv[2] || 'dist/ai-hr-historical.json')
if (!existsSync(path)) throw new Error(`AI HR historical replay not found: ${path}`)
const replay = JSON.parse(readFileSync(path, 'utf8'))
const validation = assertValidAiHrHistoricalReplay(replay)
console.log(JSON.stringify(validation.metrics, null, 2))
for (const warning of validation.warnings) console.warn(`[validate-ai-history] ${warning}`)
