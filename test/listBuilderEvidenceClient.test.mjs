import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isListBuilderEvidenceArtifact,
  loadListBuilderEvidence,
} from '../ui/src/lib/list-builder-evidence.js'

const artifact = () => ({
  version: 1,
  windows: { d14: {}, d30: {}, season: {} },
  recipes: {},
})

test('browser loader cache-busts and accepts the rolling evidence contract', async () => {
  const result = await loadListBuilderEvidence({
    fetchImpl: async (url, options) => {
      assert.match(url, /data\/list-builder-evidence\.json\?t=\d+/)
      assert.equal(options.cache, 'no-store')
      return { ok: true, json: async () => artifact() }
    },
  })
  assert.equal(isListBuilderEvidenceArtifact(result), true)
})

test('browser loader rejects an invalid artifact so the UI can use its fallback', async () => {
  await assert.rejects(
    loadListBuilderEvidence({ fetchImpl: async () => ({ ok: true, json: async () => ({ version: 0 }) }) }),
    /contract is invalid/,
  )
})
