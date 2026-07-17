// Pure List Builder parlay engine.
//
// The engine only consumes exact List Builder matches and never changes player
// projections. It ranks independent, separate-game combinations from actionable
// PRIME/STRONG rows, then exposes a tightly bounded pool for the Random curated
// action. Historical recipe evidence is normalized separately so an individual-
// pick hit rate can never be mistaken for a parlay's modeled all-hit chance.

export const LIST_BUILDER_PARLAY_SIZES = Object.freeze([2, 3, 4])
export const LIST_BUILDER_PARLAY_DISPLAY_COUNT = 3
export const LIST_BUILDER_PARLAY_POOL_LIMIT = 24
export const LIST_BUILDER_PARLAY_RANDOM_LIMIT = 18
export const LIST_BUILDER_PARLAY_RANDOM_FLOOR = 0.8
export const LIST_BUILDER_PARLAY_EVIDENCE_MIN_SAMPLE = 30

const ELIGIBLE_GRADES = new Set(['PRIME', 'STRONG'])

function batterOf(item) {
  return item?.batter || item || null
}

function gradeOf(batter) {
  return String(batter?.grade?.label || batter?.grade || 'SKIP').toUpperCase()
}

function playerKeyOf(batter) {
  const value = batter?.playerId ?? batter?.id
  return value == null ? null : String(value)
}

function gameKeyOf(batter) {
  const value = batter?.gamePk ?? batter?.game?.gamePk
  return value == null ? null : String(value)
}

function rowKeyOf(batter) {
  const value = batter?.id
  return value == null ? `${playerKeyOf(batter)}:${gameKeyOf(batter)}` : String(value)
}

function stableCompare(a, b) {
  return String(a).localeCompare(String(b), 'en', { numeric: true })
}

function candidateCompare(a, b) {
  return (b.probability - a.probability)
    || (b.score - a.score)
    || (b.fitScore - a.fitScore)
    || stableCompare(a.rowKey, b.rowKey)
}

function exclusionReason(batter) {
  if (!batter) return 'invalidRow'
  if (!ELIGIBLE_GRADES.has(gradeOf(batter))) return 'grade'
  if (!Number.isFinite(batter.hrProbability) || batter.hrProbability <= 0 || batter.hrProbability >= 1) return 'projection'
  if (!Number.isFinite(batter.score)) return 'score'
  if (!playerKeyOf(batter)) return 'player'
  if (!gameKeyOf(batter)) return 'game'
  if (!batter.game || batter.game.isLive === true || batter.game.isFinal === true) return 'pregame'
  if (batter.dataTrust?.status) return 'dataTrust'
  if (batter.lineupConfirmed === true && !Number.isFinite(batter.battingOrder)) return 'notStarting'
  return null
}

export function auditListBuilderParlayPool(items = []) {
  const excluded = {
    invalidRow: 0,
    grade: 0,
    projection: 0,
    score: 0,
    player: 0,
    game: 0,
    pregame: 0,
    dataTrust: 0,
    notStarting: 0,
    duplicate: 0,
  }
  const seenRows = new Set()
  const eligible = []

  for (const item of items || []) {
    const batter = batterOf(item)
    const reason = exclusionReason(batter)
    if (reason) {
      excluded[reason]++
      continue
    }
    const rowKey = rowKeyOf(batter)
    if (seenRows.has(rowKey)) {
      excluded.duplicate++
      continue
    }
    seenRows.add(rowKey)
    eligible.push({
      item,
      batter,
      rowKey,
      playerKey: playerKeyOf(batter),
      gameKey: gameKeyOf(batter),
      grade: gradeOf(batter),
      probability: batter.hrProbability,
      score: batter.score,
      fitScore: Number.isFinite(item?.evaluation?.fitScore) ? item.evaluation.fitScore : 0,
    })
  }

  eligible.sort(candidateCompare)
  const constructionPool = eligible.slice(0, LIST_BUILDER_PARLAY_POOL_LIMIT)
  const supportedSizes = LIST_BUILDER_PARLAY_SIZES.filter((size) => canBuildSize(constructionPool, size))

  return {
    eligible,
    constructionPool,
    eligibleCount: eligible.length,
    constructionCount: constructionPool.length,
    uniqueGames: new Set(eligible.map((candidate) => candidate.gameKey)).size,
    supportedSizes,
    excluded,
  }
}

function canBuildSize(pool, size, start = 0, players = new Set(), games = new Set()) {
  if (players.size === size) return true
  if (pool.length - start < size - players.size) return false
  for (let index = start; index < pool.length; index++) {
    const candidate = pool[index]
    if (players.has(candidate.playerKey) || games.has(candidate.gameKey)) continue
    players.add(candidate.playerKey)
    games.add(candidate.gameKey)
    if (canBuildSize(pool, size, index + 1, players, games)) return true
    players.delete(candidate.playerKey)
    games.delete(candidate.gameKey)
  }
  return false
}

function combinationRationale(legs, avgFit) {
  const primeCount = legs.filter((leg) => leg.grade === 'PRIME').length
  if (primeCount === legs.length) return `All ${legs.length} legs are PRIME in separate games`
  if (avgFit >= 90) return 'Elite criteria fit with separate-game exposure'
  if (primeCount > 0) return `${primeCount} PRIME anchor${primeCount === 1 ? '' : 's'} with STRONG support`
  return 'Balanced STRONG legs with valid model projections'
}

function makeCombination(legs) {
  const allHit = legs.reduce((product, leg) => product * leg.probability, 1)
  const weakest = [...legs].sort(
    (a, b) => (a.probability - b.probability) || (a.score - b.score) || stableCompare(a.rowKey, b.rowKey),
  )[0]
  const avgScore = legs.reduce((sum, leg) => sum + leg.score, 0) / legs.length
  const avgFit = legs.reduce((sum, leg) => sum + leg.fitScore, 0) / legs.length
  const signature = legs.map((leg) => leg.rowKey).slice().sort(stableCompare).join('|')
  return {
    signature,
    size: legs.length,
    legs,
    allHit,
    weakest,
    avgScore,
    avgFit,
    rationale: combinationRationale(legs, avgFit),
  }
}

function combinationCompare(a, b) {
  return (b.allHit - a.allHit)
    || (b.weakest.probability - a.weakest.probability)
    || (b.avgScore - a.avgScore)
    || (b.avgFit - a.avgFit)
    || stableCompare(a.signature, b.signature)
}

function enumerateCombinations(pool, size) {
  const out = []
  const chosen = []
  const players = new Set()
  const games = new Set()

  function visit(start) {
    if (chosen.length === size) {
      out.push(makeCombination([...chosen]))
      return
    }
    if (pool.length - start < size - chosen.length) return
    for (let index = start; index < pool.length; index++) {
      const candidate = pool[index]
      if (players.has(candidate.playerKey) || games.has(candidate.gameKey)) continue
      chosen.push(candidate)
      players.add(candidate.playerKey)
      games.add(candidate.gameKey)
      visit(index + 1)
      games.delete(candidate.gameKey)
      players.delete(candidate.playerKey)
      chosen.pop()
    }
  }

  visit(0)
  return out.sort(combinationCompare)
}

function takeDiverse(combinations, count = LIST_BUILDER_PARLAY_DISPLAY_COUNT) {
  const selected = []
  const selectedSignatures = new Set()
  const exposure = new Map()

  const tryTake = (combo, enforceExposure) => {
    if (selectedSignatures.has(combo.signature)) return false
    if (enforceExposure && combo.legs.some((leg) => (exposure.get(leg.playerKey) || 0) >= 2)) return false
    selected.push(combo)
    selectedSignatures.add(combo.signature)
    for (const leg of combo.legs) exposure.set(leg.playerKey, (exposure.get(leg.playerKey) || 0) + 1)
    return true
  }

  for (const combo of combinations) {
    tryTake(combo, true)
    if (selected.length >= count) return selected
  }
  for (const combo of combinations) {
    tryTake(combo, false)
    if (selected.length >= count) break
  }
  return selected
}

export function buildListBuilderParlays(items = [], { size = 2 } = {}) {
  const audit = auditListBuilderParlayPool(items)
  const safeSize = LIST_BUILDER_PARLAY_SIZES.includes(size) ? size : 2
  const combinations = audit.supportedSizes.includes(safeSize)
    ? enumerateCombinations(audit.constructionPool, safeSize)
    : []
  const best = combinations[0]?.allHit || 0
  let randomPool = combinations
    .slice(0, LIST_BUILDER_PARLAY_RANDOM_LIMIT)
    .filter((combo) => combo.allHit >= best * LIST_BUILDER_PARLAY_RANDOM_FLOOR)
  if (randomPool.length < Math.min(LIST_BUILDER_PARLAY_DISPLAY_COUNT, combinations.length)) {
    randomPool = combinations.slice(0, Math.min(LIST_BUILDER_PARLAY_DISPLAY_COUNT, combinations.length))
  }

  return {
    ...audit,
    size: safeSize,
    combinations,
    curated: takeDiverse(combinations),
    randomPool,
  }
}

export function createSeededRandom(seed = 1) {
  let state = Number(seed) >>> 0
  return () => {
    state += 0x6D2B79F5
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function randomizeListBuilderParlays(engine, random = Math.random) {
  const pool = [...(engine?.randomPool || [])]
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.max(0, Math.min(0.999999999, random())) * (index + 1))
    ;[pool[index], pool[swap]] = [pool[swap], pool[index]]
  }
  return takeDiverse(pool)
}

export function wilsonInterval95(hits, sample) {
  if (!Number.isFinite(hits) || !Number.isFinite(sample) || sample <= 0 || hits < 0 || hits > sample) return null
  const z = 1.959963984540054
  const proportion = hits / sample
  const denominator = 1 + (z * z) / sample
  const center = (proportion + (z * z) / (2 * sample)) / denominator
  const margin = (z * Math.sqrt((proportion * (1 - proportion) + (z * z) / (4 * sample)) / sample)) / denominator
  return {
    low: Math.max(0, center - margin) * 100,
    high: Math.min(1, center + margin) * 100,
  }
}

export function normalizeListBuilderParlayEvidence(evidence, { label = 'Current recipe', source = 'tracked' } = {}) {
  const sample = Math.max(0, Math.floor(Number(evidence?.matches ?? evidence?.sample) || 0))
  const rawHits = Number(evidence?.hits)
  const hits = Number.isFinite(rawHits) ? Math.max(0, Math.min(sample, Math.floor(rawHits))) : null
  const hitRate = hits != null && sample > 0
    ? (hits / sample) * 100
    : Number.isFinite(evidence?.hitRate) ? evidence.hitRate : null
  const suppliedInterval = evidence?.confidence95
  const confidence95 = Number.isFinite(suppliedInterval?.low) && Number.isFinite(suppliedInterval?.high)
    ? { low: suppliedInterval.low, high: suppliedInterval.high }
    : hits != null ? wilsonInterval95(hits, sample) : null
  const valid = sample >= LIST_BUILDER_PARLAY_EVIDENCE_MIN_SAMPLE
    && Number.isFinite(hitRate)
    && hitRate >= 0
    && hitRate <= 100
    && confidence95 != null

  return {
    valid,
    label,
    source,
    sample,
    hits,
    hitRate: valid ? hitRate : null,
    confidence95: valid ? confidence95 : null,
  }
}
