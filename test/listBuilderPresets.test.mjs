import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ADVANCED_LIST_BUILDER_PRESETS,
  LIST_BUILDER_EVIDENCE,
  LIST_BUILDER_PRESETS,
  MORE_LIST_BUILDER_PRESETS,
  PRIMARY_LIST_BUILDER_PRESETS,
} from '../ui/src/lib/list-builder-presets.js'
import { sanitizeListBuilderCriteria } from '../ui/src/lib/list-builder.js'

test('list builder exposes audited recipes plus five advanced matchup recipes', () => {
  assert.equal(PRIMARY_LIST_BUILDER_PRESETS.length, 6)
  assert.equal(MORE_LIST_BUILDER_PRESETS.length, 4)
  assert.equal(ADVANCED_LIST_BUILDER_PRESETS.length, 5)
  assert.equal(new Set(LIST_BUILDER_PRESETS.map((preset) => preset.id)).size, LIST_BUILDER_PRESETS.length)
  assert.deepEqual(PRIMARY_LIST_BUILDER_PRESETS.map((preset) => preset.id), [
    'best', 'hot-model', 'elite-model', 'hot-power', 'three-way', 'power',
  ])
  assert.deepEqual(ADVANCED_LIST_BUILDER_PRESETS.map((preset) => preset.id), [
    'pitch-type-punish', 'recent-pitcher-leak', 'contact-collision', 'low-k-power', 'top-four-power',
  ])
})

test('preset evidence agrees with its hit count and slate baseline', () => {
  for (const preset of LIST_BUILDER_PRESETS) {
    if (!Number.isFinite(preset.evidence.hits) || !Number.isFinite(preset.evidence.sample) || preset.evidence.sample <= 0) continue
    const rate = (preset.evidence.hits / preset.evidence.sample) * 100
    const lift = rate / LIST_BUILDER_EVIDENCE.baselineRate
    assert.ok(Math.abs(rate - preset.evidence.hitRate) < 0.01, `${preset.id} hit rate drifted`)
    assert.ok(Math.abs(lift - preset.evidence.lift) < 0.01, `${preset.id} lift drifted`)
  }
})

test('advanced recipes disclose the exact historical features needed for readiness', () => {
  for (const preset of ADVANCED_LIST_BUILDER_PRESETS) {
    assert.ok(['evaluated', 'limited-coverage', 'collecting'].includes(preset.readiness.fallbackStatus))
    assert.ok(preset.readiness.features.length >= 2)
  }
  assert.equal(ADVANCED_LIST_BUILDER_PRESETS.find((preset) => preset.id === 'recent-pitcher-leak').readiness.fallbackStatus, 'collecting')
  assert.equal(ADVANCED_LIST_BUILDER_PRESETS.find((preset) => preset.id === 'contact-collision').readiness.fallbackStatus, 'collecting')
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
  assert.equal(LIST_BUILDER_PRESETS.find((preset) => preset.id === 'best').criteria.confirmedOnly, undefined)
})
