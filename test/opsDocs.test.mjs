import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (name) => readFile(new URL(`../${name}`, import.meta.url), 'utf8')

test('owner documentation covers health, recovery, model boundaries, and release verification', async () => {
  const [ops, model, release, agents, env] = await Promise.all([
    read('OPS.md'),
    read('MODEL-DECISIONS.md'),
    read('RELEASE-CHECKLIST.md'),
    read('AGENTS.md'),
    read('.env.example'),
  ])

  assert.match(ops, /npm run doctor/)
  assert.match(ops, /npm run mlb:recover -- --missing-only/)
  assert.match(ops, /ALERT_WEBHOOK_URL/)
  assert.match(model, /gateOverride: true/)
  assert.match(model, /Forecast V10/)
  assert.match(model, /current model version is 4/i)
  assert.match(model, /Run lines are not a production market/)
  assert.match(release, /npm test/)
  assert.match(release, /Release tag/)
  assert.match(agents, /Do not duplicate model math in the UI/)
  assert.match(env, /OPENAI_API_KEY=\r?\n/)
  assert.doesNotMatch(env, /(?:sk-proj-|tvly-|github_pat_)[A-Za-z0-9_-]+/)
})

test('README routes owners to durable runbooks', async () => {
  const readme = await read('README.md')
  assert.match(readme, /OPS\.md/)
  assert.match(readme, /MODEL-DECISIONS\.md/)
  assert.match(readme, /RELEASE-CHECKLIST\.md/)
})
