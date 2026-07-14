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
        } else records.set(id, { id, gameId: player.gameId, kickoffAt: player.kickoffAt, season: snapshot.meta?.season ?? null, seasonType: snapshot.meta?.seasonType ?? null, week: snapshot.meta?.weekNumber ?? null, playerId: player.id, playerName: player.name, position: player.position, team: player.team, marketId, opened: observation, closing: observation, observations: 1, status: 'open' })
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
  return { version: 1, updatedAt: new Date(now).toISOString(), records: [...records.values()].sort((a, b) => String(b.kickoffAt).localeCompare(String(a.kickoffAt))).slice(0, 50000) }
}

export function summarizeNFLTracking(log = {}) {
  const settled = (log.records || []).filter((record) => record.status === 'settled')
  const preseasonSettled = settled.filter((record) => /preseason/i.test(String(record.seasonType || ''))).length
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
  return { updatedAt: log.updatedAt || null, open: (log.records || []).filter((record) => record.status === 'open').length, settled: settled.length, preseasonSettled, markets: Object.fromEntries(Object.entries(markets).map(([id, value]) => [id, { samples: value.samples, hitRate: value.samples ? value.wins / value.samples : null, brier: value.brierSamples ? value.brierTotal / value.brierSamples : null, mae: value.errorSamples ? value.errorTotal / value.errorSamples : null, profit: value.roiSamples ? value.profit : null, roi: value.roiSamples ? value.profit / value.roiSamples : null, roiSamples: value.roiSamples, calibration: [...value.calibration.values()].map((bin) => ({ ...bin, predicted: bin.predicted / bin.samples, observed: bin.observed / bin.samples })) }])) }
}
