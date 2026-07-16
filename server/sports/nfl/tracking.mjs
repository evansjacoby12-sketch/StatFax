import { buildNFLComboBoard, NFL_COMBO_STRATEGIES } from '../../../ui/src/lib/nflCombos.js'

const PROBABILITY_MARKETS = new Set(['anytime_td', 'first_td', 'two_plus_td'])
const PROJECTION_KEYS = { passing_yards: 'passingYards', receptions: 'receptions', receiving_yards: 'receivingYards', rushing_yards: 'rushingYards', rushing_receiving_yards: 'rushingReceivingYards', passing_rushing_yards: 'passingRushingYards' }

const americanProfit = (odds) => !Number.isFinite(Number(odds)) || Number(odds) === 0 ? null : Number(odds) > 0 ? Number(odds) / 100 : 100 / Math.abs(Number(odds))
const actualValue = (player, marketId) => {
  const stats = player?.live?.stats || {}
  if (marketId === 'passing_yards') return Number(stats.passingYards || 0)
  if (marketId === 'receptions') return Number(stats.receptions || 0)
  if (marketId === 'receiving_yards') return Number(stats.receivingYards || 0)
  if (marketId === 'rushing_yards') return Number(stats.rushingYards || 0)
  if (marketId === 'rushing_receiving_yards') return Number(stats.rushingYards || 0) + Number(stats.receivingYards || 0)
  if (marketId === 'passing_rushing_yards') return Number(stats.passingYards || 0) + Number(stats.rushingYards || 0)
  return null
}

function recordKey(player, marketId) { return `${player.gameId}:${player.id}:${marketId}` }

const terminal = (status) => ['won', 'lost', 'void'].includes(status)
const boardKey = (snapshot, strategy, scope, legs) => `${snapshot?.meta?.season || 'unknown'}:${snapshot?.meta?.week || 'week'}:${strategy}:${scope}:${legs}`
const playerResultKey = (gameId, playerId) => `${gameId}:${playerId}`

function frozenLeg(leg) {
  return {
    key: leg.key, playerId: leg.playerId, name: leg.name, position: leg.position, team: leg.team, opponent: leg.opponent,
    gameId: leg.gameKey, kickoffAt: leg.kickoffAt || null, marketId: leg.marketId, marketLabel: leg.marketLabel,
    probability: leg.probability, odds: leg.odds, evidenceConfidence: leg.evidenceConfidence,
  }
}

function frozenCombo(combo, rank) {
  return {
    id: combo.id, rank, strategy: combo.strategy, scope: combo.scope, probability: combo.probability,
    independentProbability: combo.independentProbability, probabilityMethod: combo.probabilityMethod,
    actionableProbability: combo.actionableProbability, buildQuality: combo.buildQuality, evidenceConfidence: combo.evidenceConfidence,
    legs: combo.legs.map(frozenLeg), status: 'pending', outcome: null,
  }
}

function captureBoard(snapshot, strategy, scope, legs) {
  const board = buildNFLComboBoard(snapshot, { strategy, scope, legs, minGrade: 'LEAN' })
  return {
    at: snapshot.generatedAt || new Date().toISOString(), coverage: board.coverage, exposure: board.exposure, calibration: board.calibration,
    combos: board.combos.map((combo, index) => frozenCombo(combo, index + 1)),
  }
}

function comboHasStarted(combo, snapshot, now) {
  const players = new Map((snapshot?.players || []).map((player) => [playerResultKey(player.gameId, player.id), player]))
  return combo.legs.some((leg) => {
    const player = players.get(playerResultKey(leg.gameId, leg.playerId))
    return player?.live?.isLive || player?.live?.isFinal || (leg.kickoffAt && +new Date(leg.kickoffAt) <= +new Date(now))
  })
}

function settleFrozenCombo(combo, snapshot, now) {
  const players = new Map((snapshot?.players || []).map((player) => [playerResultKey(player.gameId, player.id), player]))
  const legs = combo.legs.map((leg) => {
    const player = players.get(playerResultKey(leg.gameId, leg.playerId))
    if (!player) return { ...leg, status: leg.status || 'pending' }
    const live = player.live || {}
    const touchdowns = Number(live.stats?.totalTds || 0)
    if (leg.marketId === 'anytime_td' && touchdowns >= 1) return { ...leg, status: 'won', outcome: 1, settledAt: new Date(now).toISOString() }
    if (leg.marketId === 'two_plus_td' && touchdowns >= 2) return { ...leg, status: 'won', outcome: 1, settledAt: new Date(now).toISOString() }
    if (leg.marketId === 'first_td' && live.isFirstTdScorer) return { ...leg, status: 'won', outcome: 1, settledAt: new Date(now).toISOString() }
    if (!live.isFinal) return { ...leg, status: live.isLive ? 'live' : 'pending' }
    if (leg.marketId === 'first_td' && !live.firstTdKnown) return { ...leg, status: 'void', outcome: null, settledAt: new Date(now).toISOString() }
    return { ...leg, status: 'lost', outcome: 0, settledAt: new Date(now).toISOString() }
  })
  const statuses = legs.map((leg) => leg.status)
  const status = statuses.includes('lost') ? 'lost'
    : statuses.every((value) => value === 'won' || value === 'void') ? (statuses.every((value) => value === 'void') ? 'void' : 'won')
      : statuses.includes('live') || statuses.includes('won') ? 'live' : 'pending'
  const outcome = status === 'won' ? 1 : status === 'lost' ? 0 : null
  return { ...combo, legs, status, outcome, settledAt: terminal(status) ? combo.settledAt || new Date(now).toISOString() : null, brier: outcome == null || !Number.isFinite(Number(combo.probability)) ? null : (Number(combo.probability) - outcome) ** 2 }
}

function updateNFLStackBoards(existingBoards = [], snapshots = [], now = new Date()) {
  const boards = new Map(existingBoards.map((board) => [board.id, board]))
  for (const snapshot of snapshots.filter(Boolean)) {
    for (const strategy of NFL_COMBO_STRATEGIES) for (const scope of strategy.scopes) for (const legs of [2, 3, 4]) {
      const id = boardKey(snapshot, strategy.id, scope, legs)
      const existing = boards.get(id)
      if (existing?.locked) continue
      const capture = captureBoard(snapshot, strategy.id, scope, legs)
      if (!capture.combos.length) continue
      const started = capture.combos.some((combo) => comboHasStarted(combo, snapshot, now))
      if (started) {
        if (existing) boards.set(id, { ...existing, locked: true, lockedAt: existing.lockedAt || new Date(now).toISOString() })
        continue
      }
      if (!existing) boards.set(id, { id, season: snapshot.meta?.season, week: snapshot.meta?.week, strategy: strategy.id, scope, legs, status: 'open', locked: false, revisions: 1, opened: capture, closing: capture })
      else boards.set(id, { ...existing, revisions: Number(existing.revisions || 1) + 1, closing: capture })
    }
  }
  const current = snapshots.filter(Boolean).at(-1)
  if (current) for (const [id, board] of boards) {
    const opened = { ...board.opened, combos: (board.opened?.combos || []).map((combo) => settleFrozenCombo(combo, current, now)) }
    const closing = { ...board.closing, combos: (board.closing?.combos || []).map((combo) => settleFrozenCombo(combo, current, now)) }
    const statuses = closing.combos.map((combo) => combo.status)
    const status = statuses.length && statuses.every(terminal) ? 'settled' : statuses.some((value) => value === 'live' || value === 'won' || value === 'lost') ? 'live' : 'open'
    boards.set(id, { ...board, opened, closing, status, settledAt: status === 'settled' ? board.settledAt || new Date(now).toISOString() : null })
  }
  return [...boards.values()].sort((a, b) => String(b.id).localeCompare(String(a.id))).slice(0, 2000)
}

export function updateNFLTracking(log = {}, previousSnapshot = null, currentSnapshot = null, now = new Date()) {
  const records = new Map((log.records || []).map((record) => [record.id, record]))
  for (const snapshot of [previousSnapshot, currentSnapshot].filter(Boolean)) {
    for (const player of snapshot.players || []) {
      if (player.live?.isFinal || player.live?.isLive) continue
      for (const [marketId, market] of Object.entries(player.markets || {})) {
        const id = recordKey(player, marketId)
        const existing = records.get(id)
        const observation = { at: snapshot.generatedAt, probability: market.probability ?? null, projection: market.projection ?? player.projections?.[PROJECTION_KEYS[marketId]] ?? null, line: market.line ?? null, odds: market.odds ?? null }
        if (existing) {
          existing.closing = observation
          existing.observations = Number(existing.observations || 1) + 1
        } else records.set(id, { id, gameId: player.gameId, kickoffAt: player.kickoffAt, playerId: player.id, playerName: player.name, position: player.position, team: player.team, marketId, opened: observation, closing: observation, observations: 1, status: 'open' })
      }
    }
  }
  const finalPlayers = new Map((currentSnapshot?.players || []).filter((player) => player.live?.isFinal).map((player) => [`${player.gameId}:${player.id}`, player]))
  for (const record of records.values()) {
    if (record.status === 'settled') continue
    const player = finalPlayers.get(`${record.gameId}:${record.playerId}`)
    if (!player) continue
    let outcome
    if (record.marketId === 'anytime_td') outcome = Number(player.live.stats?.totalTds || 0) >= 1 ? 1 : 0
    else if (record.marketId === 'two_plus_td') outcome = Number(player.live.stats?.totalTds || 0) >= 2 ? 1 : 0
    else if (record.marketId === 'first_td') outcome = player.live.firstTdKnown ? (player.live.isFirstTdScorer ? 1 : 0) : null
    else outcome = actualValue(player, record.marketId)
    if (outcome == null) { record.status = 'void'; record.settledAt = new Date(now).toISOString(); continue }
    const probability = Number(record.closing?.probability)
    const line = Number(record.closing?.line)
    const odds = Number(record.closing?.odds)
    const won = PROBABILITY_MARKETS.has(record.marketId) ? outcome === 1 : Number.isFinite(line) ? outcome > line : null
    const profit = won == null || americanProfit(odds) == null ? null : won ? americanProfit(odds) : -1
    record.status = 'settled'; record.outcome = outcome; record.won = won; record.profit = profit; record.settledAt = new Date(now).toISOString()
    if (PROBABILITY_MARKETS.has(record.marketId) && Number.isFinite(probability)) record.brier = (probability - outcome) ** 2
    if (!PROBABILITY_MARKETS.has(record.marketId) && Number.isFinite(Number(record.closing?.projection))) record.absoluteError = Math.abs(Number(record.closing.projection) - outcome)
  }
  const stackBoards = updateNFLStackBoards(log.stackBoards || [], [previousSnapshot, currentSnapshot], now)
  return { version: 2, updatedAt: new Date(now).toISOString(), records: [...records.values()].sort((a, b) => String(b.kickoffAt).localeCompare(String(a.kickoffAt))).slice(0, 50000), stackBoards }
}

export function summarizeNFLTracking(log = {}) {
  const settled = (log.records || []).filter((record) => record.status === 'settled')
  const markets = {}
  for (const record of settled) {
    const bucket = markets[record.marketId] ||= { samples: 0, wins: 0, brierTotal: 0, brierSamples: 0, errorTotal: 0, errorSamples: 0, profit: 0, roiSamples: 0, calibration: new Map() }
    bucket.samples++
    if (record.won === true) bucket.wins++
    if (Number.isFinite(record.brier)) { bucket.brierTotal += record.brier; bucket.brierSamples++ }
    if (PROBABILITY_MARKETS.has(record.marketId) && Number.isFinite(Number(record.closing?.probability)) && Number.isFinite(Number(record.outcome))) {
      const probability = Number(record.closing.probability)
      const lower = Math.min(.9, Math.floor(probability * 10) / 10)
      const key = lower.toFixed(1)
      const bin = bucket.calibration.get(key) || { lower, upper: lower + .1, samples: 0, predicted: 0, observed: 0 }
      bin.samples++; bin.predicted += probability; bin.observed += Number(record.outcome); bucket.calibration.set(key, bin)
    }
    if (Number.isFinite(record.absoluteError)) { bucket.errorTotal += record.absoluteError; bucket.errorSamples++ }
    if (Number.isFinite(record.profit)) { bucket.profit += record.profit; bucket.roiSamples++ }
  }
  const stackSummary = {}
  for (const board of log.stackBoards || []) {
    const key = `${board.strategy}:${board.scope}:${board.legs}`
    const bucket = stackSummary[key] ||= { strategy: board.strategy, scope: board.scope, legs: board.legs, boards: 0, revisions: 0, settled: 0, wins: 0, brierTotal: 0, brierSamples: 0 }
    bucket.boards++; bucket.revisions += Number(board.revisions || 0)
    for (const combo of board.closing?.combos || []) if (terminal(combo.status) && combo.status !== 'void') {
      bucket.settled++; if (combo.status === 'won') bucket.wins++
      if (Number.isFinite(combo.brier)) { bucket.brierTotal += combo.brier; bucket.brierSamples++ }
    }
  }
  return { updatedAt: log.updatedAt || null, open: (log.records || []).filter((record) => record.status === 'open').length, settled: settled.length, markets: Object.fromEntries(Object.entries(markets).map(([id, value]) => [id, { samples: value.samples, hitRate: value.samples ? value.wins / value.samples : null, brier: value.brierSamples ? value.brierTotal / value.brierSamples : null, mae: value.errorSamples ? value.errorTotal / value.errorSamples : null, profit: value.roiSamples ? value.profit : null, roi: value.roiSamples ? value.profit / value.roiSamples : null, roiSamples: value.roiSamples, calibration: [...value.calibration.values()].map((bin) => ({ ...bin, predicted: bin.predicted / bin.samples, observed: bin.observed / bin.samples })) }])), stacks: Object.fromEntries(Object.entries(stackSummary).map(([key, value]) => [key, { ...value, hitRate: value.settled ? value.wins / value.settled : null, brier: value.brierSamples ? value.brierTotal / value.brierSamples : null }])) }
}
