import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('NFL header receives sport scope and cannot wire MLB workspace actions', async () => {
  const [app, header] = await Promise.all([readFile(new URL('../ui/src/App.jsx', import.meta.url), 'utf8'), readFile(new URL('../ui/src/components/Header.jsx', import.meta.url), 'utf8')])
  const nflBranch = app.slice(app.indexOf("if (sport === 'nfl')"), app.indexOf('return (', app.indexOf("if (sport === 'nfl')") + 50))
  assert.match(app, /<Header[\s\S]*?sport="nfl"/)
  assert.doesNotMatch(nflBranch, /openMlb|onOpenGroups|onOpenWeather|onOpenBacktest|onOpenSettings/)
  assert.match(header, /<HelpMenu[\s\S]*?sport=\{sport\}/)
  assert.match(header, /const isNFL = sport === 'nfl'/)
})

test('NFL board exposes aligned themed multi-select position, team, and game filters', async () => {
  const [board, sharedFilters, styles] = await Promise.all([
    readFile(new URL('../ui/src/components/NFLBoard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/SportMultiFilterBar.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8'),
  ])
  assert.match(board, /<SportMultiFilterBar[\s\S]*?filters=\{propFilters\}/)
  assert.match(sharedFilters, /filters\.map\(\(filter\) => <Select[\s\S]*?multi value=\{filter\.value\}/)
  assert.match(board, /id: 'positions', label: 'Positions', value: positionFilters/)
  assert.match(board, /id: 'teams', label: 'Teams', value: teamFilters/)
  assert.match(board, /id: 'games', label: 'Games', value: gameFilters/)
  assert.match(board, /label: 'All games'/)
  assert.match(board, /gameFilters\.has\(String\(gameKeyFor\(player\)\)\)/)
  assert.match(styles, /\.nfl-prop-filters \{[^}]*align-items: stretch/)
  assert.match(styles, /\.nfl-prop-filters \.select-wrap/)
})

test('NFL signals use distinct glyphs and semantic color families without resizing chips', async () => {
  const [board, rail, styles] = await Promise.all([
    readFile(new URL('../ui/src/components/NFLBoard.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/SportSignalRail.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8'),
  ])
  for (const tone of ['prime', 'strong', 'lean', 'accent', 'silver', 'bad']) assert.match(board, new RegExp(`tone: '${tone}'`))
  for (const icon of ['ArrowUp', 'Target', 'Crosshair', 'MapPin', 'Radio', 'Clock', 'Flame', 'TrendingUp', 'Zap', 'BarChart3', 'Shield', 'House', 'Plane', 'Wind', 'UserCheck', 'TriangleAlert']) assert.match(board, new RegExp(`icon: '${icon}'`))
  assert.match(rail, /data-signal-tone=\{filter\.tone \|\| undefined\}/)
  assert.match(styles, /\.sport-signal-chip \{[\s\S]*?height: 28px/)
  assert.match(styles, /\.sport-signal-chip\[data-signal-tone='prime'\] \{ --signal-color: var\(--prime\); \}/)
  assert.match(styles, /\.sport-signal-chip\.active[\s\S]*?var\(--signal-color\)/)
  for (const context of ['is-volume', 'is-red-zone', 'is-matchup', 'is-weather']) assert.match(board, new RegExp(`className=.*${context}`))
  assert.match(styles, /\.nfl-card-context > \.is-red-zone \{ --context-color: var\(--prime\); \}/)
  assert.match(styles, /\.nfl-card-context > \.is-matchup \{ --context-color: var\(--accent\); \}/)
  assert.match(styles, /\.nfl-card-context > \.is-weather\.tone-bad \{ --context-color: var\(--bad\); \}/)
})

test('sport UI contracts share navigation primitives without sharing sport state', async () => {
  const [app, config, dock] = await Promise.all([
    readFile(new URL('../ui/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/lib/sportUi.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/SportMobileDock.jsx', import.meta.url), 'utf8'),
  ])
  for (const sport of ['mlb', 'nfl', 'nba']) assert.match(config, new RegExp(`${sport}: Object\\.freeze`))
  assert.match(config, /nba:[\s\S]*?enabled: false/)
  assert.match(app, /<SportMobileDock sport="nfl" value=\{nflView\}/)
  assert.match(app, /<SportMobileDock sport="mlb" value=\{bottomNavView\}/)
  assert.match(dock, /sportUi\(sport\)/)
  assert.match(dock, /onChange\(item\.id\)/)
})

test('sport refresh, reconnect, shortcuts, and heavy workspaces stay sport scoped', async () => {
  const [app, logLoader, main, serviceWorker] = await Promise.all([
    readFile(new URL('../ui/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/lib/backtestLog.js', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/main.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/public/sw.js', import.meta.url), 'utf8'),
  ])
  assert.match(app, /if \(sport === 'mlb'\) load\(\)/)
  assert.match(app, /if \(sport !== 'mlb'\) return undefined/)
  assert.match(app, /if \(sport === 'nfl'\) refreshNFL\(\)/)
  assert.match(app, /nflHasLiveGames \? LIVE_REFRESH_MS : SLATE_REFRESH_MS/)
  assert.match(app, /sport === 'nfl' \? '\.sport-filter-search input' : '\.search input'/)
  assert.match(app, /SPORT_UI\.nfl\.primaryViews/)
  assert.match(app, /const NFLBoard = lazy/)
  assert.match(app, /const PlayerDrawer = lazy/)
  assert.match(logLoader, /if \(cachedLog\)/)
  assert.match(logLoader, /if \(pendingLog\)/)
  assert.match(main, /BASE_URL.*sw\.js/)
  assert.match(serviceWorker, /const SCOPE_URL = self\.registration\.scope/)
})

test('NFL Bet Lab shares the core MLB workspace modes without a Saved destination', async () => {
  const [mlbLab, nflLab, shell, board] = await Promise.all([
    readFile(new URL('../ui/src/components/BetLab.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/NFLBetLab.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/WorkspaceShell.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/NFLBoard.jsx', import.meta.url), 'utf8'),
  ])
  for (const label of ['Explore combos', 'Custom builder', 'Same game']) {
    assert.match(mlbLab, new RegExp(`label: '${label}'`))
    assert.match(nflLab, new RegExp(`label: '${label}'`))
  }
  assert.match(mlbLab, /label: 'Top 10 straights'/)
  assert.doesNotMatch(mlbLab, /label: 'Saved'/)
  assert.doesNotMatch(nflLab, /label: 'Saved'/)
  assert.match(nflLab, /<WorkspaceShell[\s\S]*?embedded[\s\S]*?title="TD Bet Lab"/)
  assert.match(nflLab, /isNFLTDMarket/)
  assert.match(nflLab, /Yardage and reception props stay outside Bet Lab/)
  assert.match(nflLab, /disabled=\{slipLegs\.length < 2\}/)
  assert.match(nflLab, /nfl-stack-risk/)
  assert.match(nflLab, /stack\.scopes\.includes\(scope\)/)
  assert.match(nflLab, /Best of every stack/i)
  assert.match(nflLab, /NFL_COMBO_STRATEGIES\.map/)
  assert.match(nflLab, /limit: 1/)
  assert.doesNotMatch(nflLab, />TD stack</)
  assert.match(nflLab, /\[2, 3, 4\]\.map/)
  assert.match(nflLab, /className="workspace-brief"/)
  assert.match(nflLab, /tab === 'same-game'[\s\S]*?scope="same-game"/)
  assert.doesNotMatch(nflLab, /savedContent|tab === 'saved'/)
  assert.match(shell, /embedded = false/)
  assert.match(board, /setBetLabView\('builder'\)/)
  assert.doesNotMatch(board, /setBetLabView\('saved'\)/)
  assert.doesNotMatch(board, /BET_LAB_TABS/)
})

test('NFL owns football-specific Learn Center and Cheat Sheet workspaces', async () => {
  const [app, header, learn, cheat] = await Promise.all([
    readFile(new URL('../ui/src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/Header.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/NFLLearnCenter.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../ui/src/components/NFLCheatSheet.jsx', import.meta.url), 'utf8'),
  ])
  for (const label of ['Playbook', 'Guide', 'Glossary']) assert.match(learn, new RegExp(`label: '${label}'`))
  for (const label of ['Touchdowns', 'Receiving', 'Rushing', 'Passing']) assert.match(cheat, new RegExp(`label: '${label}'`))
  assert.match(header, /label: 'NFL Cheat Sheet'/)
  assert.match(header, /label: 'NFL Learn Center'/)
  assert.match(header, /function HelpMenu\(\{[^}]*onOpenSplits/)
  assert.match(app, /onOpenHowTo=\{\(\) => setNflLearnTab\('playbook'\)\}/)
  assert.match(app, /onOpenSplits=\{\(\) => setShowNFLCheatSheet\(true\)\}/)
  assert.match(app, /<NFLLearnCenter/)
  assert.match(app, /<NFLCheatSheet snapshot=\{nflData\}/)
  assert.doesNotMatch(learn, /home run|hitter|pitcher|barrel|Statcast/i)
})

test('NFL player research uses the approved tabbed evidence workspace', async () => {
  const [board, styles] = await Promise.all([readFile(new URL('../ui/src/components/NFLBoard.jsx', import.meta.url), 'utf8'), readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8')])
  for (const tab of ['Overview', 'Role', 'Matchup', 'Game log']) assert.match(board, new RegExp(`label: '${tab}'`))
  assert.match(board, /className="nfl-research-decision"/)
  assert.match(board, /className="nfl-research-tabs"/)
  assert.match(board, /tab === 'gamelog'/)
  assert.match(board, /function PlayerHeadshotSilo/)
  assert.match(board, /player\.headshotUrl/)
  assert.match(board, /!hasHeadshot && <span className="nfl-headshot-fallback"/)
  assert.match(board, /onError=\{\(\) => setFailedUrl\(player\.headshotUrl\)\}/)
  assert.match(board, /variant="workspace"/)
  assert.match(styles, /\.nfl-headshot-silo\.is-compact/)
  assert.match(styles, /\.nfl-headshot-silo\.is-workspace/)
  assert.match(styles, /\.nfl-search > \.sr-only[\s\S]*?clip-path: inset\(50%\)/)
  assert.match(board, /Lineup intelligence/)
  assert.match(board, /Routes \/ dropback/)
  assert.match(board, /Vacated opportunity/)
  assert.match(board, /Betting signal assessment/)
  assert.match(board, /red flags always appear first/)
  assert.match(board, /const levels = \['avoid', 'caution', 'good'\]/)
  assert.doesNotMatch(board, /current\.signals\?\.slice\(0, 6\)/)
  assert.match(styles, /\.nfl-assessment-badge\.is-avoid/)
  assert.match(styles, /\.nfl-assessment-badge\.is-caution/)
  assert.match(styles, /\.nfl-assessment-badge\.is-good/)
  assert.match(styles, /\.nfl-lineup-grid/)
  assert.match(styles, /\.nfl-prop-drawer \{ width: min\(860px, 100vw\)/)
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.nfl-prop-drawer \{ width: 100vw;/)
})

test('NFL ranked board shares the approved MLB decision-ladder structure', async () => {
  const [board, styles] = await Promise.all([readFile(new URL('../ui/src/components/NFLBoard.jsx', import.meta.url), 'utf8'), readFile(new URL('../ui/src/app.css', import.meta.url), 'utf8')])
  for (const heading of ['Rank', 'Player identity', 'Model verdict', 'Key evidence', 'Actions']) assert.match(board, new RegExp(`>${heading}<`))
  assert.match(board, /className="decision-ladder-row nfl-decision-ladder-row"/)
  assert.match(board, /className="mobile-decision-card nfl-mobile-decision-card"/)
  assert.match(board, /<ProbRing value=\{model\.probability\}/)
  assert.match(board, /className="nfl-evidence-cells"/)
  assert.match(board, /compactSignalValue/)
  assert.match(styles, /\.nfl-decision-ladder-head,[\s\S]*?\.nfl-decision-ladder-row/)
  assert.match(styles, /\.nfl-mobile-risk\.is-avoid/)
})

test('NFL performance surfaces frozen stack tracking and historical stack validation', async () => {
  const board = await readFile(new URL('../ui/src/components/NFLBoard.jsx', import.meta.url), 'utf8')
  assert.match(board, /Frozen stack boards/)
  assert.match(board, /Settled stack builds/)
  assert.match(board, /TD stack validation/)
  assert.match(board, /Observed all-hit/)
  assert.match(board, /Raw independent/)
  assert.match(board, /Live TD calibration/)
  assert.match(board, /Touchdowns observed/)
  assert.match(board, /Weekly launch refresh/)
})
