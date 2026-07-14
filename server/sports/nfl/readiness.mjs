import { NFL_PROP_MARKET_LIST } from '../../../src/sports/nfl/logic/propEligibility.js'

const PROBABILITY_MARKETS = new Set(['anytime_td', 'first_td', 'two_plus_td'])
const MIN_FORWARD_REHEARSAL = 300
const MIN_PROJECTION_SAMPLES = 1_000
const MIN_PROBABILITY_SAMPLES = 5_000

const check = (id, label, passed, message, blocking = true) => ({ id, label, passed: Boolean(passed), state: passed ? 'ready' : blocking ? 'blocked' : 'advisory', message, blocking })

export function buildNFLReadiness(snapshot, { tracking = snapshot?.modelTracking || {}, now = new Date() } = {}) {
  const games = snapshot?.games || []
  const players = snapshot?.players || []
  const quality = snapshot?.dataQuality || {}
  const performance = snapshot?.modelPerformance || {}
  const meta = snapshot?.meta || {}
  const firstKickoff = games.length ? Math.min(...games.map((game) => +new Date(game.date)).filter(Number.isFinite)) : NaN
  const hoursToKickoff = Number.isFinite(firstKickoff) ? (firstKickoff - +new Date(now)) / 3_600_000 : null
  const expectedGames = Number(meta.expectedSlateGames || games.length)
  const regularWeekOne = /regular/i.test(String(meta.seasonType || '')) && Number(meta.weekNumber) === 1
  const preseasonSettled = Number(tracking.preseasonSettled ?? 0)
  const validatedMarkets = NFL_PROP_MARKET_LIST.filter((market) => {
    const metric = performance.markets?.[market.id]
    const minimum = PROBABILITY_MARKETS.has(market.id) ? MIN_PROBABILITY_SAMPLES : MIN_PROJECTION_SAMPLES
    return metric?.validationPath === 'production-v3' && Number(metric.samples || 0) >= minimum
  }).length

  const checks = [
    check('season-schedule', 'Season schedule', Number(meta.seasonScheduleGames || 0) >= 250, `${Number(meta.seasonScheduleGames || 0)} season events loaded`),
    check('complete-slate', 'Complete slate', games.length > 0 && games.length === expectedGames, `${games.length}/${expectedGames} games loaded`),
    check('roster-density', 'Roster coverage', games.length > 0 && players.length >= games.length * 20, `${players.length} eligible players across ${games.length} games`),
    check('current-context', 'Depth and availability', quality.depthChart && quality.officialAvailability, quality.depthChart && quality.officialAvailability ? 'Current depth and availability connected' : 'Current depth or availability is incomplete'),
    check('production-validation', 'Production-path validation', performance.version >= 3 && performance.requirements?.exactProductionScoring && validatedMarkets === NFL_PROP_MARKET_LIST.length, `${validatedMarkets}/${NFL_PROP_MARKET_LIST.length} markets meet replay sample minimums`),
    check('weather-window', 'Kickoff weather', hoursToKickoff == null || hoursToKickoff > 24 || (quality.weatherFresh && Number(quality.weatherCoverage) >= .8), hoursToKickoff != null && hoursToKickoff <= 24 ? `${Math.round(Number(quality.weatherCoverage || 0) * 100)}% weather coverage inside 24 hours` : 'Weather gate activates 24 hours before kickoff'),
    check('gameday-availability', 'Gameday availability', hoursToKickoff == null || hoursToKickoff > 3 || quality.officialAvailability, hoursToKickoff != null && hoursToKickoff <= 3 ? 'Official availability required inside 3 hours' : 'Final availability gate activates 3 hours before kickoff'),
    check('preseason-rehearsal', 'Forward rehearsal', !regularWeekOne || preseasonSettled >= MIN_FORWARD_REHEARSAL, regularWeekOne ? `${preseasonSettled}/${MIN_FORWARD_REHEARSAL} preseason forecasts settled` : `${preseasonSettled}/${MIN_FORWARD_REHEARSAL} preseason forecasts settled · enforced for Week 1`),
    check('lineup-packages', 'Confirmed deployment', Number(quality.lineupConfirmed || 0) > 0 && quality.packageUsage, Number(quality.lineupConfirmed || 0) > 0 && quality.packageUsage ? 'Confirmed roles and package usage connected' : 'Depth-derived roles active; package usage remains projected', false),
    check('live-participation', 'Verified live participation', Number(quality.liveParticipation || 0) > 0, Number(quality.liveParticipation || 0) > 0 ? `${quality.liveParticipation} verified live participation rows` : 'Live scoring uses box-score production only; snap/route claims disabled', false),
  ]
  const blocking = checks.filter((item) => item.blocking && !item.passed)
  const advisory = checks.filter((item) => !item.blocking && !item.passed)
  const gradesEnabled = blocking.length === 0
  const marketGates = Object.fromEntries(NFL_PROP_MARKET_LIST.map((market) => {
    const reasons = blocking.map((item) => item.message)
    const metric = performance.markets?.[market.id]
    const minimum = PROBABILITY_MARKETS.has(market.id) ? MIN_PROBABILITY_SAMPLES : MIN_PROJECTION_SAMPLES
    if (!(metric?.validationPath === 'production-v3' && Number(metric.samples || 0) >= minimum)) reasons.push(`${market.label} production replay is below ${minimum.toLocaleString()} samples`)
    return [market.id, { enabled: gradesEnabled && reasons.length === 0, reasons: [...new Set(reasons)] }]
  }))
  return {
    generatedAt: new Date(now).toISOString(),
    status: blocking.length ? 'blocked' : advisory.length ? 'conditional' : 'ready',
    gradesEnabled,
    checks,
    blocking: blocking.map((item) => item.id),
    advisory: advisory.map((item) => item.id),
    markets: marketGates,
    rehearsal: { preseasonSettled, target: MIN_FORWARD_REHEARSAL, complete: preseasonSettled >= MIN_FORWARD_REHEARSAL },
    hoursToKickoff,
  }
}

export function applyNFLReadiness(snapshot, options = {}) {
  const readiness = buildNFLReadiness(snapshot, options)
  snapshot.modelReadiness = readiness
  snapshot.players = (snapshot.players || []).map((player) => ({ ...player, modelGate: { status: readiness.status, markets: readiness.markets } }))
  const readinessFeed = {
    id: 'readiness', label: 'Week 1 readiness', state: readiness.status === 'ready' ? 'ready' : readiness.status === 'blocked' ? 'limited' : 'limited',
    message: readiness.gradesEnabled ? 'All blocking model gates passed' : `${readiness.blocking.length} blocking gate${readiness.blocking.length === 1 ? '' : 's'} active`, provider: 'production-replay', freshness: null,
  }
  const existingFeeds = (snapshot.dataHealth?.feeds || []).filter((feed) => feed.id !== 'readiness')
  const feeds = [...existingFeeds, readinessFeed]
  const issues = feeds.filter((feed) => feed.state !== 'ready')
  snapshot.dataHealth = { ...snapshot.dataHealth, status: feeds.some((feed) => feed.state === 'critical') ? 'critical' : issues.length ? 'limited' : 'ready', feeds, issues }
  return snapshot
}
