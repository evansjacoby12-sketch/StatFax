import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const root = new URL('../', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('production workflow builds without a site password gate', () => {
  const workflow = read('.github/workflows/deploy.yml')
  const main = read('ui/src/main.jsx')
  const packageJson = JSON.parse(read('ui/package.json'))

  assert.doesNotMatch(workflow, /VITE_SITE_PASSWORD_HASH/)
  assert.doesNotMatch(workflow, /build:protected/)
  assert.equal(packageJson.scripts.build, 'vite build')
  assert.doesNotMatch(main, /SitePasswordGate/)
})
