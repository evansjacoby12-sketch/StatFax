import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('dedicated AI-HR scoring and research entrypoints stay retired', () => {
  for (const path of [
    'server/context-pass.mjs',
    'server/ai-hr-production.mjs',
    'server/ai-hr-shadow.mjs',
    'server/ai-hr-evaluate.mjs',
    'server/ai-hr-attribution.mjs',
    'server/ai-hr-history.mjs',
    '.github/workflows/ai-hr-history.yml',
  ]) assert.equal(existsSync(new URL(path, root)), false, path)

  const pkg = JSON.parse(read('package.json'))
  assert.deepEqual(Object.keys(pkg.scripts).filter((name) => /ai:hr|ai-(?:context|shadow|production|evaluation|history|attribution)/i.test(name)), [])
  assert.doesNotMatch(read('.github/workflows/deploy.yml'), /AI HR|ai:hr|TAVILY_API_KEY|AI_HR_MODEL/)
})

test('HR board ignores legacy AI-HR fields and presents deterministic probability only', () => {
  const ui = [
    read('ui/src/components/BatterRow.jsx'),
    read('ui/src/components/PlayerDrawer.jsx'),
    read('ui/src/lib/data.js'),
  ].join('\n')
  assert.doesNotMatch(ui, /aiHr|baselineHrProbability|AI Δ|Sourced AI context|external-context adjustment/)
  assert.match(read('MODEL-DECISIONS.md'), /AI-HR production overlay v1 was retired on 2026-08-02/)
})
