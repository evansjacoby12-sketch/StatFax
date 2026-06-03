import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applySimResolution } from '../server/lib/simResolution.mjs'

// Simple monotonic isotonic table + lookup for unit testing (no bundle dep).
const TABLE = [
  { scoreLo: 0, scoreHi: 20, observedProb: 0.05 },
  { scoreLo: 20, scoreHi: 40, observedProb: 0.05 },
  { scoreLo: 40, scoreHi: 60, observedProb: 0.12 },
  { scoreLo: 60, scoreHi: 80, observedProb: 0.22 },
  { scoreLo: 80, scoreHi: 100, observedProb: 0.26 },
]
function lookupProb(score, table, fallback) {
  if (!Array.isArray(table) || !table.length) return fallback ? fallback(score) : 0.05
  const mids = table.map((b) => (b.scoreLo + b.scoreHi) / 2)
  const probs = table.map((b) => b.observedProb)
  const s = Math.max(0, Math.min(100, score))
  if (s <= mids[0]) return probs[0]
  if (s >= mids[mids.length - 1]) return probs[probs.length - 1]
  for (let i = 0; i < mids.length - 1; i++) {
    if (s >= mids[i] && s <= mids[i + 1]) {
      const t = (s - mids[i]) / (mids[i + 1] - mids[i])
      return probs[i] + t * (probs[i + 1] - probs[i])
    }
  }
  return probs[probs.length - 1]
}

const mkRows = () =>
  [
    [65, 0.18], [66, 0.10], [67, 0.14], [68, 0.09], [70, 0.20], [72, 0.12],
  ].map(([score, sim]) => {
    const a = lookupProb(score, TABLE)
    return { score, simHRProb: sim, _anchorProb: a, hrProbability: a }
  })

test('dual-key safety: the SAME object passed twice never NaNs (the slate aliases id + id-gamePk)', () => {
  const rows = mkRows()
  const withDupes = [...rows, ...rows] // every object appears twice, like Object.keys(scoredBatters)
  applySimResolution(withDupes, { table: TABLE, lookupProb })
  for (const r of rows) {
    assert.ok(Number.isFinite(r.hrProbability), `hrProbability finite for score ${r.score}`)
    assert.ok(r.hrProbability > 0 && r.hrProbability < 1)
  }
})

test('calibration preserved: per-bucket mean probability is unchanged by the tilt', () => {
  const rows = mkRows()
  const anchorMean = rows.reduce((s, r) => s + r._anchorProb, 0) / rows.length
  applySimResolution(rows, { table: TABLE, lookupProb })
  const blendMean = rows.reduce((s, r) => s + r.hrProbability, 0) / rows.length
  assert.ok(Math.abs(anchorMean - blendMean) < 0.005, `mean preserved (${anchorMean} vs ${blendMean})`)
})

test('resolution: higher-sim row is ranked above lower-sim row within a bucket', () => {
  const rows = mkRows()
  applySimResolution(rows, { table: TABLE, lookupProb })
  const hi = rows.find((r) => r.score === 70) // sim 0.20 (highest)
  const lo = rows.find((r) => r.score === 68) // sim 0.09 (lowest)
  assert.ok(hi.hrProbability > lo.hrProbability, 'high-sim ranks above low-sim')
})

test('rows without a usable sim keep the anchor', () => {
  const a = lookupProb(50, TABLE)
  const rows = [{ score: 50, simHRProb: null, _anchorProb: a, hrProbability: a }]
  applySimResolution(rows, { table: TABLE, lookupProb })
  assert.equal(rows[0].hrProbability, a)
})

test('no-op when table or lookupProb missing', () => {
  const rows = mkRows()
  const res = applySimResolution(rows, { table: [], lookupProb })
  assert.equal(res.adjusted, 0)
})
