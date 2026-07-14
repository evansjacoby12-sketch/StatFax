const STREAK_FIELDS = {
  touchdown: (game) => Number(game.totalTds ?? 0) > 0,
  receptions: (game) => Number(game.receptions ?? 0) >= 3,
  passing: (game) => Number(game.passingYards ?? 0) >= 200,
  rushing: (game) => Number(game.rushingYards ?? 0) >= 40,
  receiving: (game) => Number(game.receivingYards ?? 0) >= 50,
}

const n = (value, fallback = null) => value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value)
const pct = (value) => `${Math.round(Number(value) * 100)}%`

const SIGNAL_PRIORITY = {
  'snap-limit': 100, 'scoring-role-lost': 99, 'quick-pressure-risk': 98, 'protection-mismatch': 97, 'committee-risk': 96,
  'end-zone-alpha': 94, 'goal-to-go-dominator': 93, 'role-inheritance': 92, 'opportunity-spike': 91, 'drive-participation': 90,
  'qb-keeper-threat': 89, 'goal-line-package': 88, 'goal-line': 87, 'air-yards-leader': 86, 'defense-funnel': 85,
  'separation-edge': 84, 'yac-creator': 83, 'rushing-over-expected': 82, 'rz-targets': 80, 'rz-touches': 79,
  'route-participation': 72, 'target-share': 71, 'snap-share': 70, 'lineup-confirmed': 69,
}

const ASSESSMENT_ORDER = { avoid: 3, caution: 2, good: 1 }
const CRITICAL_RISK_SIGNALS = new Set(['snap-limit', 'scoring-role-lost', 'quick-pressure-risk', 'protection-mismatch'])

export function nflSignalAssessment(signal) {
  if (signal?.tone === 'bad') return 'avoid'
  if (signal?.tone === 'warn') return 'caution'
  return 'good'
}

export function assessNFLSignals(signals = []) {
  const groups = { avoid: [], caution: [], good: [] }
  for (const signal of signals) groups[nflSignalAssessment(signal)].push(signal)
  const critical = groups.avoid.some((signal) => CRITICAL_RISK_SIGNALS.has(signal.key))
  if (groups.avoid.length >= 2 || critical) return { level: 'avoid', label: groups.avoid.length >= 2 ? 'Avoid · read first' : 'Be wary', headline: 'Material risk signals need review before betting', groups }
  if (groups.avoid.length) return { level: 'avoid', label: 'Be wary', headline: 'A negative signal needs review before betting', groups }
  if (groups.caution.length) return { level: 'caution', label: 'Caution', headline: 'Mixed evidence or conditions to monitor', groups }
  if (groups.good.length) return { level: 'good', label: 'Positive', headline: 'Supporting evidence is present', groups }
  return { level: 'caution', label: 'Limited signals', headline: 'There is not enough signal evidence yet', groups }
}

function orderedGames(player) {
  return [...(player?.recentGames || [])].sort((a, b) => Number(b.season || 0) - Number(a.season || 0) || Number(b.week || 0) - Number(a.week || 0))
}

function opportunity(game, position) {
  if (position === 'QB') return n(game?.attempts, 0) + n(game?.carries, 0)
  return n(game?.targets, 0) + n(game?.carries, 0)
}

function opportunityTrend(player) {
  const games = orderedGames(player)
  if (games.length < 5) return null
  const average = (rows) => rows.reduce((sum, game) => sum + opportunity(game, player?.position), 0) / rows.length
  const recent = average(games.slice(0, 2))
  const baseline = average(games.slice(2, 6))
  if (baseline < 5) return null
  return { recent, baseline, change: recent / baseline - 1 }
}

function verifiedTracking(player) {
  const tracking = player?.tracking || player?.lineup?.tracking || {}
  return tracking.verified === true ? tracking : null
}

export function consecutiveGames(games = [], predicate) {
  let streak = 0
  for (const game of games) {
    if (!predicate(game)) break
    streak += 1
  }
  return streak
}

export function nflStreakSignals(player) {
  const games = [...(player?.recentGames || [])].sort((a, b) => Number(b.season || 0) - Number(a.season || 0) || Number(b.week || 0) - Number(a.week || 0))
  const labels = {
    touchdown: 'TD', receptions: '3+ REC', passing: '200+ PASS', rushing: '40+ RUSH', receiving: '50+ REC YDS',
  }
  return Object.entries(STREAK_FIELDS)
    .map(([key, predicate]) => ({ key, games: consecutiveGames(games, predicate), label: labels[key] }))
    .filter((signal) => signal.games >= 2)
    .map((signal) => ({ ...signal, text: `${signal.games}G ${signal.label} streak`, tone: signal.games >= 3 ? 'hot' : 'neutral' }))
}

export function nflRoleSignals(player) {
  const usage = player?.usage || {}
  const lineup = player?.lineup || {}
  const tracking = verifiedTracking(player)
  const trend = opportunityTrend(player)
  const defense = player?.defenseVsPosition || {}
  const opponentDefense = lineup.opponentDefense || {}
  const signals = []
  if (n(usage.endZoneTargetShare) >= .35 && n(usage.endZoneTargetsL3, 0) >= 2) signals.push({ key: 'end-zone-alpha', text: `${pct(usage.endZoneTargetShare)} end-zone target share`, tone: 'prime' })
  if (n(usage.goalToGoOpportunityShare) >= .50 && n(usage.goalToGoOpportunitiesL3, 0) >= 3) signals.push({ key: 'goal-to-go-dominator', text: `${pct(usage.goalToGoOpportunityShare)} goal-to-go share`, tone: 'prime' })
  if (trend?.change >= .20 && trend.recent - trend.baseline >= 3) signals.push({ key: 'opportunity-spike', text: `Opportunities up ${pct(trend.change)}`, tone: 'prime' })
  if (trend?.change <= -.25 && trend.baseline - trend.recent >= 3) signals.push({ key: 'scoring-role-lost', text: `Opportunities down ${pct(Math.abs(trend.change))}`, tone: 'bad' })
  if (tracking && n(tracking.scoringDriveParticipation) >= .80) signals.push({ key: 'drive-participation', text: `${pct(tracking.scoringDriveParticipation)} scoring-drive participation`, tone: 'strong' })
  const carryShare = n(lineup.carryShare, n(usage.carryShare))
  if (player?.position === 'RB' && carryShare != null && carryShare < .55) signals.push({ key: 'committee-risk', text: `${pct(carryShare)} backfield carry share`, tone: 'bad' })
  if (n(defense.percentile) >= .75 && Object.values(defense.factors || {}).some((factor) => n(factor, 1) >= 1.04)) signals.push({ key: 'defense-funnel', text: `Defense funnels work to ${player.position}`, tone: 'strong' })
  if (player?.position === 'QB' && Math.max(n(usage.designedRedZoneRushesL3, 0), n(usage.goalLineTouchesL3, 0)) >= 3) signals.push({ key: 'qb-keeper-threat', text: `${Math.max(n(usage.designedRedZoneRushesL3, 0), n(usage.goalLineTouchesL3, 0))} recent red-zone QB runs`, tone: 'prime' })
  if (n(usage.airYardsShare) >= .35) signals.push({ key: 'air-yards-leader', text: `${pct(usage.airYardsShare)} team air-yards share`, tone: 'strong' })
  if (tracking && n(tracking.yacAboveExpectationPerReception) >= 1.5) signals.push({ key: 'yac-creator', text: `+${n(tracking.yacAboveExpectationPerReception).toFixed(1)} YAC over expected`, tone: 'strong' })
  if (tracking && n(tracking.rushingYardsOverExpectedPerAttempt) >= .5) signals.push({ key: 'rushing-over-expected', text: `+${n(tracking.rushingYardsOverExpectedPerAttempt).toFixed(1)} RYOE/att`, tone: 'strong' })
  if (tracking && n(tracking.averageSeparation) >= 3.2) signals.push({ key: 'separation-edge', text: `${n(tracking.averageSeparation).toFixed(1)} yd separation`, tone: 'strong' })
  if (opponentDefense.trackingVerified === true && n(lineup.offensiveLine?.passProtectionFactor) <= .94 && n(opponentDefense.pressureRate) >= .28) signals.push({ key: 'protection-mismatch', text: `${pct(opponentDefense.pressureRate)} opponent pressure rate`, tone: 'bad' })
  if (opponentDefense.trackingVerified === true && n(opponentDefense.quickPressureRate) >= .25) signals.push({ key: 'quick-pressure-risk', text: `${pct(opponentDefense.quickPressureRate)} quick-pressure rate`, tone: 'bad' })
  if (Number(usage.redZoneTargetsL3) >= 5) signals.push({ key: 'rz-targets', text: `${usage.redZoneTargetsL3} RZ targets L3`, tone: 'prime' })
  if (Number(usage.redZoneTouchesL3) >= 10) signals.push({ key: 'rz-touches', text: `${usage.redZoneTouchesL3} RZ touches L3`, tone: 'prime' })
  if (Number(usage.goalLineTouchesL3) >= 4) signals.push({ key: 'goal-line', text: 'Goal-line role', tone: 'strong' })
  if (Number(usage.targetShare) >= 0.25) signals.push({ key: 'target-share', text: `${Math.round(usage.targetShare * 100)}% target share`, tone: 'strong' })
  if (Number(usage.snapShare) >= 0.8) signals.push({ key: 'snap-share', text: `${Math.round(usage.snapShare * 100)}% snaps`, tone: 'neutral' })
  if (lineup.confirmed) signals.push({ key: 'lineup-confirmed', text: 'Lineup confirmed', tone: 'strong' })
  if (lineup.replacement?.inherited) signals.push({ key: 'role-inheritance', text: `Role up: ${lineup.replacement.replaces?.join(', ') || 'vacated work'}`, tone: 'prime' })
  if (Number(lineup.routesPerDropback) >= .75) signals.push({ key: 'route-participation', text: `${Math.round(lineup.routesPerDropback * 100)}% routes/dropback`, tone: 'strong' })
  if (lineup.redZone?.goalLinePackage) signals.push({ key: 'goal-line-package', text: 'Goal-line package', tone: 'prime' })
  if (lineup.restrictions?.snapLimit != null) signals.push({ key: 'snap-limit', text: `Snap limit ${Math.round(lineup.restrictions.snapLimit * 100)}%`, tone: Number(lineup.restrictions.snapLimit) <= .65 ? 'bad' : 'warn' })
  return signals
}

export function buildNFLSignals(player) {
  const split = Number(player?.splits?.activeEdge ?? 0)
  const splitLabel = player?.isHome ? 'Home' : 'Away'
  const splitSignal = Math.abs(split) >= 0.04 ? [{ key: 'split', text: `${splitLabel} edge ${split >= 0 ? '+' : ''}${Math.round(split * 100)}%`, tone: split > 0 ? 'strong' : 'warn' }] : []
  return [...nflRoleSignals(player), ...nflStreakSignals(player), ...splitSignal]
    .map((signal) => ({ ...signal, assessment: nflSignalAssessment(signal), priority: SIGNAL_PRIORITY[signal.key] ?? (signal.tone === 'bad' || signal.tone === 'warn' ? 75 : 50) }))
    .sort((a, b) => ASSESSMENT_ORDER[b.assessment] - ASSESSMENT_ORDER[a.assessment] || b.priority - a.priority || a.key.localeCompare(b.key))
}
