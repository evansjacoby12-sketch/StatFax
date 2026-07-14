import { normalizePlayerName } from './providers/odds.mjs'

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const n = (value, fallback = null) => value == null || value === '' || !Number.isFinite(Number(value)) ? fallback : Number(value)
const truthy = (value) => value === true || value === 1 || String(value).toLowerCase() === 'true'

const POSITION_BASELINES = {
  QB: { snap: .98, routes: 0, targetPerRoute: 0, carry: .18, rz: .82, insideFive: .72 },
  RB: { snap: .58, routes: .43, targetPerRoute: .17, carry: .58, rz: .48, insideFive: .52 },
  WR: { snap: .76, routes: .72, targetPerRoute: .20, carry: .02, rz: .62, insideFive: .44 },
  TE: { snap: .70, routes: .58, targetPerRoute: .18, carry: 0, rz: .58, insideFive: .48 },
}

const DEPTH_SNAP = {
  QB: [.98, .05, .02, .01], RB: [.64, .30, .13, .06], WR: [.88, .78, .58, .30, .16, .08], TE: [.80, .48, .22, .10],
}

function weightedRecent(history, key, fallback = null) {
  let total = 0, weightTotal = 0
  for (const [index, game] of (history?.recentGames || []).slice(0, 8).entries()) {
    const value = n(game?.[key])
    if (value == null) continue
    const weight = .82 ** index
    total += value * weight
    weightTotal += weight
  }
  return weightTotal ? total / weightTotal : fallback
}

function indexPlayers(payload) {
  const byId = new Map(), byName = new Map()
  for (const player of payload?.players || []) {
    if (player.espnId != null) byId.set(String(player.espnId), player)
    if (player.name) byName.set(normalizePlayerName(player.name), player)
  }
  return { byId, byName }
}

export function indexNFLLineups(payload) {
  const players = indexPlayers(payload)
  return {
    ...players,
    byTeam: new Map((payload?.teams || []).filter((team) => team.team).map((team) => [String(team.team).toUpperCase(), team])),
    generatedAt: payload?.generatedAt || null,
    confirmedAt: payload?.confirmedAt || null,
    source: payload?.source || null,
  }
}

export function lineupFor(player, index) {
  return index?.byId?.get(String(player?.espnId || '')) || index?.byName?.get(normalizePlayerName(player?.name)) || null
}

export function teamLineupFor(team, index) {
  return index?.byTeam?.get(String(team || '').toUpperCase()) || null
}

export function normalizeTeamLineup(entry = {}, team = null) {
  entry = entry || {}
  const offensiveLine = entry.offensiveLine || {}
  const defense = entry.defense || {}
  const personnel = entry.personnel || entry.personnelRates || {}
  const offensiveLineAvailable = Object.keys(offensiveLine).length > 0
  const defenseAvailable = Object.keys(defense).length > 0
  const startersAvailable = n(offensiveLine.startersAvailable, 5)
  const continuity = clamp(n(offensiveLine.continuity, offensiveLine.gamesTogether != null ? Math.min(1, n(offensiveLine.gamesTogether, 0) / 8) : .7), 0, 1)
  return {
    team: entry.team || team,
    confirmed: truthy(entry.confirmed),
    confirmedAt: entry.confirmedAt || null,
    source: entry.source || null,
    personnel: {
      eleven: clamp(n(personnel.eleven ?? personnel['11'], .62)), twelve: clamp(n(personnel.twelve ?? personnel['12'], .22)),
      thirteen: clamp(n(personnel.thirteen ?? personnel['13'], .05)), twentyOne: clamp(n(personnel.twentyOne ?? personnel['21'], .08)),
      empty: clamp(n(personnel.empty, .08)), heavy: clamp(n(personnel.heavy, .08)), noHuddle: clamp(n(personnel.noHuddle, .10)),
    },
    offensiveLine: {
      available: offensiveLineAvailable, starters: offensiveLine.starters || [], startersAvailable, continuity,
      passProtectionFactor: clamp(n(offensiveLine.passProtectionFactor, .96 + continuity * .04 - Math.max(0, 5 - startersAvailable) * .025), .82, 1.10),
      runBlockingFactor: clamp(n(offensiveLine.runBlockingFactor, .96 + continuity * .04 - Math.max(0, 5 - startersAvailable) * .022), .84, 1.10),
    },
    defense: {
      available: defenseAvailable, starters: defense.starters || [], secondaryAvailable: n(defense.secondaryAvailable, null), linebackersAvailable: n(defense.linebackersAvailable, null),
      nickelRate: clamp(n(defense.nickelRate, .55)), dimeRate: clamp(n(defense.dimeRate, .15)), blitzRate: clamp(n(defense.blitzRate, .25)),
      boxRate: clamp(n(defense.boxRate, .30)), coverageFactor: clamp(n(defense.coverageFactor, 1), .88, 1.12), frontFactor: clamp(n(defense.frontFactor, 1), .88, 1.12),
      pressureRate: n(defense.pressureRate), quickPressureRate: n(defense.quickPressureRate), trackingVerified: truthy(defense.trackingVerified ?? defense.verified),
    },
  }
}

function baselineSnap(row) {
  const explicit = n(row.entry?.expectedSnapShare ?? row.entry?.snapShare ?? row.depth?.snapShare)
  if (explicit != null) return clamp(explicit, .01, 1)
  const historical = weightedRecent(row.history, 'snapShare')
  if (historical != null && historical > 0) return clamp(historical, .01, 1)
  const depth = Math.max(1, n(row.depth?.depthRank ?? row.player?.roleRank, 1))
  return DEPTH_SNAP[row.player.position]?.[depth - 1] ?? .05
}

function marketFactors(lineup, offense, opponentDefense) {
  const base = POSITION_BASELINES[lineup.position] || POSITION_BASELINES.WR
  const snapRatio = clamp(lineup.expectedSnapShare / Math.max(.05, lineup.baselineSnapShare), .72, 1.30)
  const routeRatio = lineup.position === 'QB' ? 1 : clamp(lineup.routesPerDropback / Math.max(.05, lineup.baselineRoutesPerDropback), .72, 1.30)
  const targetRatio = lineup.position === 'QB' ? 1 : clamp(lineup.targetPerRoute / Math.max(.05, base.targetPerRoute), .78, 1.25)
  const carryRatio = lineup.position === 'WR' || lineup.position === 'TE' ? 1 : clamp(lineup.carryShare / Math.max(.04, lineup.baselineCarryShare), .75, 1.30)
  const rzRatio = clamp(lineup.redZone.insideFiveShare / Math.max(.05, lineup.baselineInsideFiveShare), .75, 1.30)
  const confidence = .94 + lineup.roleConfidence * .06
  const restriction = lineup.restrictions.snapLimit == null ? 1 : clamp(lineup.restrictions.snapLimit / Math.max(.05, lineup.expectedSnapShare), .45, 1)
  const receiving = clamp((snapRatio * .35 + routeRatio * .40 + targetRatio * .25) * confidence * restriction * opponentDefense.coverageFactor, .68, 1.35)
  const rushing = clamp((snapRatio * .35 + carryRatio * .65) * confidence * restriction * offense.runBlockingFactor * opponentDefense.frontFactor, .68, 1.35)
  const passing = clamp(snapRatio * confidence * restriction * offense.passProtectionFactor * opponentDefense.coverageFactor, .70, 1.25)
  const touchdown = clamp((snapRatio * .30 + rzRatio * .50 + (lineup.redZone.goalLinePackage ? 1.08 : .92) * .20) * confidence * restriction, .62, 1.42)
  return { passing_yards: passing, passing_rushing_yards: (passing + rushing) / 2, receptions: receiving, receiving_yards: receiving, rushing_yards: rushing, rushing_receiving_yards: (rushing + receiving) / 2, anytime_td: touchdown, first_td: touchdown, two_plus_td: touchdown }
}

export function buildTeamLineup(rows = [], teamEntry = null, opponentEntry = null, { generatedAt = null, source = null } = {}) {
  const team = rows[0]?.player?.team || teamEntry?.team || null
  const offense = normalizeTeamLineup(teamEntry, team)
  const opponent = normalizeTeamLineup(opponentEntry)
  const prepared = rows.map((row) => {
    const entry = row.entry || {}
    const base = POSITION_BASELINES[row.player.position] || POSITION_BASELINES.WR
    const baseline = baselineSnap(row)
    return {
      ...row,
      baseline,
      depthOrder: Math.max(1, n(entry.depthOrder ?? entry.depthRank ?? row.depth?.depthRank ?? row.player?.roleRank, 1)),
      active: row.availability?.eligible !== false && entry.active !== false && entry.inactive !== true,
      routes: clamp(n(entry.routesPerDropback ?? entry.routeParticipation, Math.min(1, baseline / Math.max(.05, base.snap) * base.routes))),
      targetPerRoute: clamp(n(entry.targetPerRoute, weightedRecent(row.history, 'targetShare', base.targetPerRoute))),
      carry: clamp(n(entry.carryShare ?? row.depth?.carryShare, base.carry * Math.min(1.25, baseline / Math.max(.05, base.snap)))),
      rz: clamp(n(entry.redZoneSnapShare, base.rz * Math.min(1.25, baseline / Math.max(.05, base.snap)))),
      insideFive: clamp(n(entry.insideFiveSnapShare ?? entry.goalLineShare ?? row.depth?.goalLineShare, base.insideFive * Math.min(1.25, baseline / Math.max(.05, base.snap)))),
    }
  })

  const inherited = new Map()
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const group = prepared.filter((row) => row.player.position === position)
    const unavailable = group.filter((row) => !row.active)
    const available = group.filter((row) => row.active)
    const vacatedSnap = unavailable.reduce((sum, row) => sum + row.baseline, 0)
    const weights = available.map((row) => n(row.entry?.replacementPriority, 1 / Math.max(1, row.depthOrder)))
    const weightTotal = weights.reduce((sum, value) => sum + value, 0) || 1
    available.forEach((row, index) => inherited.set(row.player.espnId || row.player.name, {
      snap: vacatedSnap * weights[index] / weightTotal * .82,
      sources: unavailable.map((item) => item.player.name),
      opportunityShare: vacatedSnap * weights[index] / weightTotal,
    }))
  }

  return prepared.map((row) => {
    const entry = row.entry || {}
    const boost = inherited.get(row.player.espnId || row.player.name) || { snap: 0, sources: [], opportunityShare: 0 }
    const expectedSnapShare = row.active ? clamp(n(entry.expectedSnapShare, row.baseline + boost.snap), .01, 1) : 0
    const baselineRoutes = row.routes
    const lineup = {
      status: entry.status || (offense.confirmed ? 'confirmed' : 'projected'),
      confirmed: truthy(entry.confirmed) || offense.confirmed,
      confirmedAt: entry.confirmedAt || offense.confirmedAt || null,
      generatedAt, source: entry.source || source || offense.source || row.depth?.source || 'historical-role',
      active: row.active, starter: entry.starter != null ? truthy(entry.starter) : row.depthOrder === 1,
      position: row.player.position, depthOrder: row.depthOrder,
      roleConfidence: clamp(n(entry.roleConfidence, offense.confirmed ? .96 : row.depth ? .82 : .62)),
      baselineSnapShare: row.baseline, expectedSnapShare,
      baselineRoutesPerDropback: baselineRoutes,
      routesPerDropback: row.active ? clamp(n(entry.routesPerDropback ?? entry.routeParticipation, baselineRoutes + boost.snap * .72)) : 0,
      targetPerRoute: row.targetPerRoute,
      passBlockShare: clamp(n(entry.passBlockShare, row.player.position === 'TE' ? .18 : row.player.position === 'RB' ? .20 : .02)),
      baselineCarryShare: row.carry, carryShare: row.active ? clamp(n(entry.carryShare, row.carry + boost.opportunityShare * .62)) : 0,
      alignments: { slot: clamp(n(entry.slotShare, 0)), wide: clamp(n(entry.wideShare, row.player.position === 'WR' ? 1 - n(entry.slotShare, .35) : 0)), backfield: clamp(n(entry.backfieldShare, row.player.position === 'RB' ? .92 : 0)), inline: clamp(n(entry.inlineShare, row.player.position === 'TE' ? .68 : 0)), motion: clamp(n(entry.motionRate, 0)) },
      personnel: { eleven: clamp(n(entry.personnel?.eleven ?? entry.personnel?.['11'], offense.personnel.eleven)), twelve: clamp(n(entry.personnel?.twelve ?? entry.personnel?.['12'], offense.personnel.twelve)), thirteen: clamp(n(entry.personnel?.thirteen ?? entry.personnel?.['13'], offense.personnel.thirteen)), twentyOne: clamp(n(entry.personnel?.twentyOne ?? entry.personnel?.['21'], offense.personnel.twentyOne)), empty: clamp(n(entry.personnel?.empty, offense.personnel.empty)), heavy: clamp(n(entry.personnel?.heavy, offense.personnel.heavy)) },
      redZone: { snapShare: row.rz, insideTenShare: clamp(n(entry.insideTenSnapShare, (row.rz + row.insideFive) / 2)), insideFiveShare: row.insideFive, endZoneRouteShare: clamp(n(entry.endZoneRouteShare, row.routes * .75)), firstReadShare: clamp(n(entry.firstReadShare, row.targetPerRoute)), designedTouchShare: clamp(n(entry.designedTouchShare, row.carry)), goalLinePackage: entry.goalLinePackage != null ? truthy(entry.goalLinePackage) : row.insideFive >= .45 },
      baselineInsideFiveShare: row.insideFive,
      situations: { twoMinuteShare: clamp(n(entry.twoMinuteShare, expectedSnapShare)), noHuddleShare: clamp(n(entry.noHuddleShare, offense.personnel.noHuddle)), leadingShare: clamp(n(entry.leadingShare, expectedSnapShare)), trailingShare: clamp(n(entry.trailingShare, expectedSnapShare)) },
      restrictions: { snapLimit: n(entry.snapLimit), returnFromAbsence: truthy(entry.returnFromAbsence), gameTimeDecision: truthy(entry.gameTimeDecision), injuryTrend: entry.injuryTrend || null },
      replacement: { inherited: boost.sources.length > 0, replaces: entry.replacementFor ? [entry.replacementFor] : boost.sources, vacatedOpportunityShare: clamp(n(entry.vacatedOpportunityShare, boost.opportunityShare)), allocation: entry.allocation || null },
      tracking: {
        verified: truthy(entry.tracking?.verified ?? entry.trackingVerified), source: entry.tracking?.source || entry.trackingSource || null,
        scoringDriveParticipation: n(entry.tracking?.scoringDriveParticipation ?? entry.scoringDriveParticipation),
        yacAboveExpectationPerReception: n(entry.tracking?.yacAboveExpectationPerReception ?? entry.yacAboveExpectationPerReception),
        rushingYardsOverExpectedPerAttempt: n(entry.tracking?.rushingYardsOverExpectedPerAttempt ?? entry.rushingYardsOverExpectedPerAttempt),
        averageSeparation: n(entry.tracking?.averageSeparation ?? entry.averageSeparation),
      },
      offensiveLine: offense.offensiveLine,
      opponentDefense: opponent.defense,
    }
    lineup.marketFactors = marketFactors(lineup, offense.offensiveLine, opponent.defense)
    return { player: row.player, history: row.history, depth: row.depth, availability: row.availability, lineup }
  })
}

export function summarizeLineupCoverage(players = [], teams = []) {
  const available = players.filter((player) => player.lineup)
  const count = (predicate) => available.filter(predicate).length
  return {
    players: available.length,
    confirmedPlayers: count((player) => player.lineup.confirmed),
    routeParticipation: count((player) => Number.isFinite(player.lineup.routesPerDropback)),
    alignments: count((player) => Object.values(player.lineup.alignments || {}).some((value) => value > 0)),
    redZonePackages: count((player) => Number.isFinite(player.lineup.redZone?.insideFiveShare)),
    restrictions: count((player) => player.lineup.restrictions?.snapLimit != null || player.lineup.restrictions?.gameTimeDecision),
    inheritedRoles: count((player) => player.lineup.replacement?.inherited),
    offensiveLines: teams.filter((team) => team?.offensiveLine?.available).length,
    defensiveLineups: teams.filter((team) => team?.defense?.available).length,
  }
}
