import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LIST_BUILDER_EVIDENCE,
  LIST_BUILDER_PRESETS,
  MORE_LIST_BUILDER_PRESETS,
  PRIMARY_LIST_BUILDER_PRESETS,
} from '../ui/src/lib/list-builder-presets.js'
import { sanitizeListBuilderCriteria } from '../ui/src/lib/list-builder.js'

test('list builder exposes six primary and four secondary audited recipes', () => {
  assert.equal(PRIMARY_LIST_BUILDER_PRESETS.length, 6)
  assert.equal(MORE_LIST_BUILDER_PRESETS.length, 4)
  assert.equal(new Set(LIST_BUILDER_PRESETS.map((preset) => preset.id)).size, LIST_BUILDER_PRESETS.length)
  assert.deepEqual(PRIMARY_LIST_BUILDER_PRESETS.map((preset) => preset.id), [
    'best', 'hot-model', 'elite-model', 'hot-power', 'three-way', 'power',
  ])
})

test('preset evidence agrees with its hit count and slate baseline', () => {
  for (const preset of LIST_BUILDER_PRESETS) {
    const rate = (preset.evidence.hits / preset.evidence.sample) * 100
    const lift = rate / LIST_BUILDER_EVIDENCE.baselineRate
    assert.ok(Math.abs(rate - preset.evidence.hitRate) < 0.01, `${preset.id} hit rate drifted`)
    assert.ok(Math.abs(lift - preset.evidence.lift) < 0.01, `${preset.id} lift drifted`)
  }
})

test('every audited recipe uses supported deterministic criteria', () => {
  for (const preset of LIST_BUILDER_PRESETS) {
    const sanitized = sanitizeListBuilderCriteria(preset.criteria)
    for (const [key, value] of Object.entries(preset.criteria)) {
      assert.deepEqual(sanitized[key], value, `${preset.id} has unsupported criterion ${key}`)
    }
  }

  assert.equal(LIST_BUILDER_PRESETS.some((preset) => preset.id === 'park'), false)
  assert.equal(LIST_BUILDER_PRESETS.some((preset) => preset.id === 'confirmed'), false)
})
