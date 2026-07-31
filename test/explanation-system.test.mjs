import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('MLB explanations use one scoped vocabulary without stale model claims', async () => {
  const [catalog, learn, start, keys, glossary, atoms, header, dayRating, groups, groupCards, liveCombos, sportUi] = await Promise.all([
    readFile(new URL('../ui/src/lib/explanationCatalog.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/LearnCenter.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/HowToPick.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/Guide.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/Legend.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/atoms.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/Header.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/DayRating.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/lib/groups.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/GroupsView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/LiveCombosView.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/lib/sportUi.js', import.meta.url), 'utf8'),
  ])

  for (const grade of ['PRIME', 'STRONG', 'LEAN', 'SKIP']) assert.match(catalog, new RegExp(`key: '${grade}'`))
  assert.match(catalog, /export const GAME_CALLS/)
  assert.match(catalog, /export const FIRST_INNING_CALLS/)
  assert.match(catalog, /export const SLATE_CONDITIONS/)
  assert.match(catalog, /Grade ≠|grade, a probability|A 0–100 evidence score/i)

  assert.match(learn, /label: 'Start here'/)
  assert.match(learn, /label: 'Keys'/)
  assert.match(learn, /label: 'Glossary'/)
  assert.match(start, /Grade ≠ probability ≠ market call/)
  assert.match(keys, /GRADE_DEFINITIONS/)
  assert.match(keys, /GAME_CALLS/)
  assert.match(keys, /FIRST_INNING_CALLS/)
  assert.match(glossary, /STAT_TERMS/)

  assert.doesNotMatch(`${start}\n${keys}\n${glossary}`, /45% batter|30% matchup|25% environment/)
  assert.doesNotMatch(keys, /Results → Combo results|Tap the .* in the header|Scores lock in the morning/)
  assert.match(atoms, /aria-label=\{accessibleLabel\}/)
  assert.match(atoms, /aria-label=\{`\$\{b\.label\}: \$\{b\.desc\}`\}/)
  assert.match(header, /what every call, grade and badge means/)
  assert.match(dayRating, /Slate condition/)
  assert.doesNotMatch(dayRating, /return 'PLAY'|return 'PASS'/)
  assert.doesNotMatch(groups, /best audited|42\.9%|2\.3× HR lift/)
  assert.match(groupCards, /UserRoundCheck[\s\S]*?READY/)
  assert.doesNotMatch(groupCards, /Frozen at the morning lock|combo is frozen at the morning lock/)
  assert.match(liveCombos, /Results → My Tickets → History/)
  assert.match(sportUi, /Model results \+ tracked tickets/)
})
