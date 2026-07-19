import test from 'node:test'
import assert from 'node:assert/strict'
import { GRADE_FORM_MIN_SAMPLE, summarizeGradeForm } from '../ui/src/lib/gradeForm.js'

function gradeRows(grade, total, hits) {
  return Array.from({ length: total }, (_, index) => ({
    grade,
    homered: index < hits,
    actuallyPlayed: true,
  }))
}

test('grade form uses the latest settled slates and only eligible appearances', () => {
  const records = {}
  for (let day = 10; day <= 18; day++) {
    const date = `2026-07-${day}`
    records[date] = [
      { grade: 'PRIME', homered: day % 2 === 0, actuallyPlayed: true },
      { grade: 'STRONG', homered: false, actuallyPlayed: true },
      { grade: 'PRIME', homered: true, actuallyPlayed: false },
    ]
  }
  records['2026-07-19'] = [{ grade: 'PRIME', homered: null, actuallyPlayed: true }]

  const summary = summarizeGradeForm(records, 7)
  assert.equal(summary.dateCount, 7)
  assert.equal(summary.newestDate, '2026-07-18')
  assert.equal(summary.oldestDate, '2026-07-12')
  assert.deepEqual(summary.grades.PRIME, {
    grade: 'PRIME',
    hits: 4,
    n: 7,
    rate: 4 / 7,
    ciLow: summary.grades.PRIME.ciLow,
    ciHigh: summary.grades.PRIME.ciHigh,
  })
  assert.equal(summary.grades.STRONG.n, 7)
  assert.equal(summary.verdict.key, 'low-sample')
})

test('grade form marks a statistically clear STRONG reversal as drift', () => {
  const records = {
    '2026-07-18': [
      ...gradeRows('PRIME', 100, 15),
      ...gradeRows('STRONG', 100, 35),
    ],
  }
  const summary = summarizeGradeForm(records, 14)
  assert.equal(summary.sampleReady, true)
  assert.equal(summary.leader, 'STRONG')
  assert.equal(summary.verdict.key, 'drift-signal')
  assert.ok(summary.pValue < 0.05)
  assert.equal(summary.gapPoints, 20)
})

test('grade form keeps a small STRONG lead in watch-only status', () => {
  const records = {
    '2026-07-18': [
      ...gradeRows('PRIME', GRADE_FORM_MIN_SAMPLE, 16),
      ...gradeRows('STRONG', GRADE_FORM_MIN_SAMPLE, 20),
    ],
  }
  const summary = summarizeGradeForm(records, 30)
  assert.equal(summary.sampleReady, true)
  assert.equal(summary.leader, 'STRONG')
  assert.equal(summary.verdict.key, 'watch-only')
  assert.ok(summary.pValue > 0.05)
})

test('grade form confirms the expected grade order when PRIME separates', () => {
  const records = {
    '2026-07-18': [
      ...gradeRows('PRIME', 120, 42),
      ...gradeRows('STRONG', 240, 48),
    ],
  }
  const summary = summarizeGradeForm(records, 14)
  assert.equal(summary.leader, 'PRIME')
  assert.equal(summary.verdict.key, 'order-holds')
  assert.equal(summary.verdict.tone, 'positive')
  assert.ok(summary.grades.PRIME.ciLow < summary.grades.PRIME.rate)
  assert.ok(summary.grades.PRIME.ciHigh > summary.grades.PRIME.rate)
})
