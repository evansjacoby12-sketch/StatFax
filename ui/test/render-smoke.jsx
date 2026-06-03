/* Headless render smoke test — fails (exit 1) if any view/component throws
 * while rendering, catching crashes (e.g. an undefined variable) BEFORE deploy.
 * Uses the freshly-generated ../dist/daily.json when present (CI), else a small
 * synthetic slate so it still runs locally. */
import React from 'react'
import { renderToString } from 'react-dom/server'
import { existsSync, readFileSync } from 'node:fs'
import { LiveModeContext } from '../src/lib/liveMode.js'
import { heatIndex } from '../src/lib/scout.js'
import { DEFAULT_FILTERS } from '../src/lib/constants.js'
import Header from '../src/components/Header.jsx'
import Filters from '../src/components/Filters.jsx'
import BatterTable from '../src/components/BatterTable.jsx'
import GamesView from '../src/components/GamesView.jsx'
import PitchersView from '../src/components/PitchersView.jsx'
import WeatherView from '../src/components/WeatherView.jsx'
import ResultsView from '../src/components/ResultsView.jsx'
import PlayerDrawer from '../src/components/PlayerDrawer.jsx'
import ParlaySlip from '../src/components/ParlaySlip.jsx'
import Guide from '../src/components/Guide.jsx'
import HowToPick from '../src/components/HowToPick.jsx'
import Legend from '../src/components/Legend.jsx'

const SYNTH = {
  version: 4,
  date: '2026-06-03',
  generatedAt: new Date().toISOString(),
  stats: { scoredBatters: 2 },
  modelMetrics: null,
  games: [
    {
      gamePk: 1,
      gameDate: '2026-06-03T23:05:00Z',
      status: 'Live',
      isLive: true,
      isFinal: false,
      awayTeam: { id: 147, name: 'New York Yankees', abbr: 'NYY' },
      homeTeam: { id: 113, name: 'Cincinnati Reds', abbr: 'CIN' },
      awayPitcher: { id: 9, name: 'Away Arm', hand: 'R' },
      homePitcher: { id: 10, name: 'Home Arm', hand: 'L' },
      venueName: 'Great American Ball Park',
      currentInning: 5,
      inningHalf: 'Top',
      awayScore: 2,
      homeScore: 1,
    },
  ],
  weatherByGame: { 1: { tempF: 78, windSpeedMph: 11, windDirDeg: 200, humidity: 55, precipProbPct: 10, roofClosed: false } },
  scoredBatters: {},
}
function mkBatter(id, name, homered) {
  return {
    playerId: id,
    gamePk: 1,
    name,
    team: 'NYY',
    isHome: false,
    batSide: 'R',
    battingOrder: id,
    lineupConfirmed: true,
    score: 80 - id,
    grade: { label: id === 1 ? 'PRIME' : 'STRONG', color: id === 1 ? '#00d4ff' : '#32d74b' },
    hrProbability: 0.3 - id * 0.02,
    expectedHRs: 0.2,
    expectedPAs: 4,
    hot: true,
    due: false,
    cold: false,
    hrStreak: 1,
    barrelPct: 9,
    barrelPctBBE: 9,
    season: { avg: 0.27, obp: 0.35, slg: 0.5, ab: 200, hr: 14 },
    recent: { ab: 100, hr: 8, h: 28, tb: 55, avg: 0.28, slg: 0.55 },
    recent7: { avg: 0.31, slg: 0.62, ab: 24, hr: 3, iso: 0.31 },
    recentBarrel: { recentBarrelPct: 11, recentEV: 91, recentBBE: 20 },
    reasons: ['Strong ISO (.230)'],
    eli5Reasons: [],
    badges: ['hot'],
    parkWeatherHandFactor: 1.07,
    parkWeatherHandDelta: 0.07,
    gameParkHRFactor: 1.18,
    primaryPitchEdge: { passes: true, pitchName: '4-seam', batterSlg: 0.6, pitcherFreq: 0.55 },
    pitcher: {
      id: 10,
      name: 'Home Arm',
      hand: 'L',
      homeParkFactor: 1.18,
      season: { hrPer9: 1.7, kPer9: 6, era: 5.1, whip: 1.4 },
      savant: { barrelPctAllowed: 11, exitVeloAgainst: 91, hardHitPctAllowed: 44 },
      xStats: { xwOba: 0.34 },
      recentForm: { hrPer9: 2.1, pitchesL3D: 40 },
      splits: { vl: { hrPer9: 1.9, avg: 0.27 }, vr: { hrPer9: 1.6, avg: 0.25 } },
      pitchMix: { ffPct: 0.52, slPct: 0.28, chPct: 0.2, worstPitch: { name: 'Slider', rv: 2.1 } },
    },
    liveContext: homered
      ? { isHRThisGame: true, abCount: 3, expectedRemainingABs: 1, nearMissHR: 0, currentInning: 5, runDiff: 1, pullRisk: false }
      : null,
  }
}
SYNTH.scoredBatters['1'] = mkBatter(1, 'Aaron Judge', true)
SYNTH.scoredBatters['1-1'] = SYNTH.scoredBatters['1']
SYNTH.scoredBatters['2'] = mkBatter(2, 'Elly De La Cruz', false)
SYNTH.scoredBatters['2-1'] = SYNTH.scoredBatters['2']

function loadSlate() {
  const p = '../dist/daily.json'
  if (existsSync(p)) {
    try {
      return JSON.parse(readFileSync(p, 'utf8'))
    } catch {}
  }
  return SYNTH
}

const d = loadSlate()
const gamesByPk = new Map((d.games || []).map((g) => [g.gamePk, g]))
const dedup = new Map()
for (const b of Object.values(d.scoredBatters || {})) {
  const id = `${b.playerId}-${b.gamePk}`
  if (!dedup.has(id)) dedup.set(id, b)
}
const batters = [...dedup.values()].map((b) => {
  const game = gamesByPk.get(b.gamePk) || null
  const opp = game ? (b.isHome ? game.awayTeam : game.homeTeam) : null
  return { ...b, id: `${b.playerId}-${b.gamePk}`, game, opponent: opp, weather: d.weatherByGame?.[b.gamePk] || null, h2h: null, odds: null, edge: null, heatIndex: heatIndex(b) }
})
const meta = { version: d.version, date: d.date, stats: d.stats || {}, modelMetrics: d.modelMetrics || null, ensembleMeta: null, scoreToProb: null, oddsBooks: [] }
const noop = () => {}
const live = batters.find((b) => b.liveContext?.isHRThisGame) || batters[0]
const normal = batters[batters.length - 1] || batters[0]

const cases = []
const add = (name, el) => cases.push([name, el])
for (const mode of [true, false]) {
  const tag = mode ? 'live' : 'pregame'
  add(`Header[${tag}]`, <Header meta={meta} counts={{ games: (d.games || []).length, total: batters.length, shown: batters.length }} onRefresh={noop} onOpenModel={noop} onOpenLegend={noop} autoRefresh={false} onToggleAuto={noop} liveScores={mode} onToggleLive={noop} refreshing={false} gradeCounts={{}} total={batters.length} onOpenGuide={noop} onOpenHowTo={noop} />)
  add(`Filters[${tag}]`, <Filters value={DEFAULT_FILTERS} onChange={noop} gradeCounts={{}} games={d.games || []} badgeCounts={{}} watchCount={0} view="board" onView={noop} />)
  add(`BatterTable[${tag}]`, <BatterTable batters={batters} onSelect={noop} sort="hrProbability" dir="desc" onSort={noop} watchlist={new Set()} slip={new Set()} onToggleWatch={noop} onToggleSlip={noop} />)
  add(`GamesView[${tag}]`, <GamesView games={d.games || []} batters={batters} onSelect={noop} watchlist={new Set()} slip={new Set()} onToggleWatch={noop} onToggleSlip={noop} />)
  add(`PitchersView[${tag}]`, <PitchersView batters={batters} onSelect={noop} watchlist={new Set()} slip={new Set()} />)
  add(`WeatherView[${tag}]`, <WeatherView batters={batters} onSelect={noop} />)
  add(`PlayerDrawer.live[${tag}]`, <PlayerDrawer batter={live} onClose={noop} watched={false} inSlip={false} onToggleWatch={noop} onToggleSlip={noop} />)
  add(`PlayerDrawer.normal[${tag}]`, <PlayerDrawer batter={normal} onClose={noop} watched onToggleWatch={noop} onToggleSlip={noop} />)
}
add('ResultsView', <ResultsView meta={meta} />)
add('ParlaySlip', <ParlaySlip legs={batters.slice(0, 2)} onRemove={noop} onClear={noop} onSelect={noop} />)
add('Guide', <Guide onClose={noop} />)
add('HowToPick', <HowToPick onClose={noop} />)
add('Legend', <Legend onClose={noop} />)

let failed = 0
for (const [name, el] of cases) {
  try {
    renderToString(<LiveModeContext.Provider value={true}>{el}</LiveModeContext.Provider>)
  } catch (e) {
    failed++
    console.error(`✗ ${name}: ${e && e.message}`)
  }
}
if (failed) {
  console.error(`\nrender-smoke FAILED — ${failed}/${cases.length} components threw.`)
  process.exit(1)
}
console.log(`render-smoke OK — ${cases.length} renders, slate=${existsSync('../dist/daily.json') ? 'live' : 'synthetic'}, ${batters.length} batters.`)
