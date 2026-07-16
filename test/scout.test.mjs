import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toGrade, gradeLabel, heatIndex, pitchMixScore, pitchMixSummary, toolGrades, scoutVerdict } from '../ui/src/lib/scout.js'

test('toGrade maps 0–100 onto the 20–80 scout scale (rounded to 5s)', () => {
  assert.equal(toGrade(0), 20)
  assert.equal(toGrade(100), 80)
  assert.equal(toGrade(50), 50)
  assert.equal(toGrade(undefined), 20)
  for (const x of [10, 33, 67, 88]) {
    const g = toGrade(x)
    assert.ok(g >= 20 && g <= 80 && g % 5 === 0, `${x} → ${g}`)
  }
})

test('gradeLabel descriptors', () => {
  assert.equal(gradeLabel(80), 'elite')
  assert.equal(gradeLabel(70), 'plus-plus')
  assert.equal(gradeLabel(50), 'average')
  assert.equal(gradeLabel(30), 'well below')
})

test('heatIndex: hot/streak bats run hot, cold bats run cold, all clamped 0–100', () => {
  const hot = { season: { avg: 0.25, slg: 0.45 }, recent: { avg: 0.3, slg: 0.65, ab: 40 }, hot: true, hrStreak: true, barrelPctBBE: 8, recentBarrel: { recentBarrelPct: 16, recentBBE: 12 } }
  const cold = { season: { avg: 0.26, slg: 0.5 }, recent: { avg: 0.15, slg: 0.22, ab: 40 }, cold: true }
  const neutral = { season: { avg: 0.25, slg: 0.45 }, recent: { avg: 0.25, slg: 0.45, ab: 40 } }
  const h = heatIndex(hot)
  const c = heatIndex(cold)
  const n = heatIndex(neutral)
  assert.ok(h > n && n > c, `hot ${h} > neutral ${n} > cold ${c}`)
  for (const v of [h, c, n]) assert.ok(v >= 0 && v <= 100)
  assert.ok(h >= 60, 'hot bat reads plus+')
  assert.ok(c <= 40, 'cold bat reads below')
})

test('toolGrades returns 4 tools in scout range', () => {
  const g = toolGrades({ batterScore: 70, matchupScore: 60, envScore: 55, season: {}, recent: {} })
  assert.deepEqual(Object.keys(g).sort(), ['environment', 'heat', 'matchup', 'power'])
  for (const v of Object.values(g)) assert.ok(v >= 20 && v <= 80)
})

test('scoutVerdict reflects grade + standout tools', () => {
  const v = scoutVerdict({ grade: { label: 'PRIME' }, batterScore: 85, matchupScore: 80, envScore: 80, season: {}, recent: {} })
  assert.ok(v.startsWith('Strong HR play'))
  assert.ok(/Carried by/.test(v))
})

test('pitch-mix score uses per-pitch league baselines and requires majority coverage', () => {
  assert.equal(pitchMixScore({ pitchTypeSplits: [
    { key: 'ff', usage: 60, slg: 0.432, leagueSlg: 0.432 },
  ] }), 5)

  assert.ok(Math.abs(pitchMixScore({ pitchTypeSplits: [
    { key: 'st', usage: 60, slg: 0.465, leagueSlg: 0.365 },
  ] }) - 7.5) < 1e-9, 'sweeper matchup is scored instead of dropped')

  assert.equal(pitchMixScore({ pitchTypeSplits: [
    { key: 'ff', usage: 40, slg: 0.700, leagueSlg: 0.432 },
  ] }), null, 'thin partial arsenal cannot receive a full-strength rating')
})

test('a real zero-SLG pitch book stays valid while null remains missing', () => {
  const zero = pitchMixSummary({ pitchTypeSplits: [
    { key: 'ff', usage: 60, slg: 0, whiff: 0, leagueSlg: 0.432 },
  ] })
  assert.equal(zero.score, 0)
  assert.equal(zero.coveredUsage, 60)

  const missing = pitchMixSummary({ pitchTypeSplits: [
    { key: 'ff', usage: 60, slg: null, whiff: null, leagueSlg: 0.432 },
  ] })
  assert.equal(missing.score, null)
  assert.equal(missing.coveredUsage, 0)
})
