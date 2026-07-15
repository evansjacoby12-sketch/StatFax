import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertValidAiHrHistoricalReplay } from '../lib/aiHrHistorical.mjs'
import { assertValidAiHrFullSlateValidation } from '../lib/aiHrFullSlateValidation.mjs'

const reportPath = resolve(process.cwd(), process.argv[2] || 'dist/ai-hr-full-slate-validation.json')
const replayPath = resolve(process.cwd(), process.argv[3] || 'dist/ai-hr-historical.json')
if (!existsSync(reportPath)) throw new Error(`AI HR full-slate validation not found: ${reportPath}`)
if (!existsSync(replayPath)) throw new Error(`AI HR historical replay not found: ${replayPath}`)
const report = JSON.parse(readFileSync(reportPath, 'utf8'))
const replay = JSON.parse(readFileSync(replayPath, 'utf8'))
assertValidAiHrHistoricalReplay(replay)
const validation = assertValidAiHrFullSlateValidation(report, replay)
console.log(JSON.stringify(validation.metrics, null, 2))
for (const warning of validation.warnings) console.warn(`[validate-ai-full-slate] ${warning}`)
