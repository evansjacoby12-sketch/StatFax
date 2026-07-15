import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildListBuilderEvidence,
  mergeListBuilderHistory,
  validateListBuilderEvidence,
  wilsonInterval,
} from '../server/lib/listBuilderEvidence.mjs'

const row = ({
  playerId, score = 80, homered = false, played = true, hot = 1,
  lineupConfirmed = true, dataTrusted = true, simHRProb = 0.15,
} = {}) => ({
  playerId,
  gamePk: 1000 + playerId,
  score,
  homered,
  actuallyPlayed: played,
  lineupConfirmed,
  dataTrusted,
  simHRProb,
  badges: ['barrelKing'],
  feat: {
    hot, brl: 14, rbrl: 14, rbbe: 12, la: 20, phr9: 1.5, pm: 7,
    park: 1.05, ev: 91, hh: 45, heat: 70, setup: 4, pos: 6, neg: 1,
  },
})

function fixture() {
  return {
    dates: ['2026-07-01', '2026-07-02'],
    records: {
      '2026-07-01': [
        row({ playerId: 1, homered: true }),
        row({ playerId: 2, hot: 0 }),
      ],
      '2026-07-02': [
        row({ playerId: 3, homered: true }),
        row({ playerId: 4, played: false, homered: false }),
      ],
    },
    modelHistory: {
      dates: ['2026-06-30', '2026-07-01'],
      records: {
        '2026-06-30': [row({ playerId: 5, score: 50 })],
        // Must lose to the richer operational copy above.
        '2026-07-01': [row({ playerId: 99, score: 10 })],
      },
    },
  }
}

test('rolling evidence merges archive history and prefers operational rows', () => {
  const history = mergeListBuilderHistory(fixture())
  assert.deepEqual(history.dates, ['2026-06-30', '2026-07-01', '2026-07-02'])
  assert.equal(history.records['2026-07-01'][0].playerId, 1)
})

test('rolling windows exclude scratches and score recipes against the slate baseline', () => {
  const artifact = buildListBuilderEvidence({
    backtestLog: fixture(),
    generatedAt: '2026-07-03T12:00:00.000Z',
  })
  assert.equal(artifact.windows.d14.population, 4)
  assert.equal(artifact.windows.d14.homers, 2)
  assert.equal(artifact.windows.d14.baselineRate, 50)

  const hot = artifact.recipes['hot-model'].windows.d14
  assert.equal(hot.evaluable, 4)
  assert.equal(hot.matches, 2)
  assert.equal(hot.hits, 2)
  assert.equal(hot.hitRate, 100)
  assert.equal(hot.lift, 2)
  assert.deepEqual(hot.confidence95, wilsonInterval(2, 2))

  const best = artifact.recipes.best.windows.d14
  assert.equal(best.coverage, 1)
  assert.equal(best.matches, 3)
  assert.equal(best.hits, 2)
  assert.equal(validateListBuilderEvidence(artifact).ok, true)
})

test('missing historical gates produce limited coverage instead of assumed passes', () => {
  const log = fixture()
  delete log.records['2026-07-01'][0].dataTrusted
  const artifact = buildListBuilderEvidence({ backtestLog: log, generatedAt: '2026-07-03T12:00:00.000Z' })
  const best = artifact.recipes.best.windows.d14
  assert.equal(best.evaluable, 3)
  assert.equal(best.missingByGate.trustedOnly, 1)
})

test('evidence validator rejects arithmetic tampering', () => {
  const artifact = buildListBuilderEvidence({ backtestLog: fixture(), generatedAt: '2026-07-03T12:00:00.000Z' })
  artifact.recipes['hot-model'].windows.d14.hitRate = 99
  const validation = validateListBuilderEvidence(artifact)
  assert.equal(validation.ok, false)
  assert.ok(validation.errors.some((error) => error.includes('hitRate')))
})

test('slate deployment builds, validates, publishes, and bundles rolling evidence', () => {
  const slate = readFileSync(new URL('../server/fetch-slate.mjs', import.meta.url), 'utf8')
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  const vite = readFileSync(new URL('../ui/vite.config.js', import.meta.url), 'utf8')
  assert.match(slate, /buildListBuilderEvidence/)
  assert.match(slate, /LIST_BUILDER_EVIDENCE_OUT_PATH/)
  assert.match(workflow, /npm run validate:list-builder-evidence/)
  assert.match(workflow, /backtest-log\.json list-builder-evidence\.json/)
  assert.match(vite, /list-builder-evidence\.json/)
})
