import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normName, bookLabel } from '../ui/src/lib/data.js'

test('normName strips accents, suffixes, punctuation, case', () => {
  assert.equal(normName('José García Jr.'), 'jose garcia')
  assert.equal(normName('Luis García Jr.'), 'luis garcia')
  assert.equal(normName('Shohei Ohtani'), 'shohei ohtani')
  assert.equal(normName('Ronald Acuña II'), 'ronald acuna')
  assert.equal(normName("D'Angelo  Ortiz"), 'dangelo ortiz')
  assert.equal(normName(''), '')
  assert.equal(normName(null), '')
})

test('normName makes accent/suffix variants match', () => {
  assert.equal(normName('Luis García Jr.'), normName('Luis Garcia'))
})

test('bookLabel maps known books, passes through unknown', () => {
  assert.equal(bookLabel('fanduel'), 'FanDuel')
  assert.equal(bookLabel('draftkings'), 'DraftKings')
  assert.equal(bookLabel('somebook'), 'somebook')
})
