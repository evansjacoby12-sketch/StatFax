export const FIRST_INNING_PITCHER_PROFILE_VERSION = 2
export const FIRST_INNING_PITCHER_SCORELESS_PRIOR = 0.733
export const FIRST_INNING_PITCHER_SCORELESS_PRIOR_STARTS = 8

const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
const round = (value, digits = 3) => {
  if (!Number.isFinite(value)) return null
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function dateAgeDays(date, asOf) {
  const from = Date.parse(`${date}T12:00:00.000Z`)
  const to = Date.parse(`${asOf}T12:00:00.000Z`)
  return Number.isFinite(from) && Number.isFinite(to)
    ? Math.floor((to - from) / 86_400_000)
    : null
}

function firstInningRuns(plays) {
  if (!plays.length) return null
  const scoreField = plays[0]?.about?.isTopInning ? 'awayScore' : 'homeScore'
  const scoreboard = plays
    .map((play) => Number(play?.result?.[scoreField]))
    .filter(Number.isFinite)
  if (scoreboard.length) return Math.max(0, ...scoreboard)

  const scoringRunners = plays.reduce((runs, play) => (
    runs + (play?.runners || []).filter((runner) => runner?.movement?.isScoringEvent === true).length
  ), 0)
  if (scoringRunners > 0) return scoringRunners

  const rbi = plays.reduce((runs, play) => runs + (Number(play?.result?.rbi) || 0), 0)
  return Math.max(0, rbi)
}

function playStats(plays) {
  const totals = { bf: 0, outs: 0, k: 0, bb: 0, hbp: 0, hr: 0 }
  let inningKey = null
  let previousOuts = 0
  for (const play of plays) {
    const key = `${play?.about?.inning || 0}-${play?.about?.isTopInning ? 'T' : 'B'}`
    if (key !== inningKey) {
      inningKey = key
      previousOuts = 0
    }
    const eventType = String(play?.result?.eventType || '')
    const outsAfter = Number(play?.count?.outs)
    if (Number.isFinite(outsAfter)) {
      totals.outs += Math.max(0, outsAfter - previousOuts)
      previousOuts = outsAfter
    }
    totals.bf++
    if (eventType === 'strikeout' || eventType === 'strikeout_double_play') totals.k++
    if (eventType === 'walk') totals.bb++
    if (eventType === 'hit_by_pitch') totals.hbp++
    if (eventType === 'home_run') totals.hr++
  }
  return totals
}

export function parsePitcherMicroGame(playByPlay, {
  pitcherId,
  gamePk,
  date,
  season,
} = {}) {
  const pitcherPlays = (playByPlay?.allPlays || [])
    .filter((play) => Number(play?.matchup?.pitcher?.id) === Number(pitcherId))
    .filter((play) => play?.about?.isComplete !== false)
  if (!pitcherPlays.length) return null

  const firstInningPlays = pitcherPlays.filter((play) => Number(play?.about?.inning) === 1)
  const seenBatters = new Set()
  const firstTimeThroughPlays = []
  for (const play of pitcherPlays) {
    const batterId = Number(play?.matchup?.batter?.id)
    if (!Number.isFinite(batterId) || seenBatters.has(batterId)) continue
    seenBatters.add(batterId)
    firstTimeThroughPlays.push(play)
  }
  if (!firstInningPlays.length || !firstTimeThroughPlays.length) return null
  const starterFieldingHalfIsTop = firstInningPlays[0]?.about?.isTopInning === true
  const firstInningHalfPlays = (playByPlay?.allPlays || [])
    .filter((play) => Number(play?.about?.inning) === 1)
    .filter((play) => (play?.about?.isTopInning === true) === starterFieldingHalfIsTop)
    .filter((play) => play?.about?.isComplete !== false)

  return {
    version: FIRST_INNING_PITCHER_PROFILE_VERSION,
    gamePk: Number(gamePk),
    pitcherId: Number(pitcherId),
    date,
    season: Number(season),
    firstInning: {
      ...playStats(firstInningPlays),
      runs: firstInningRuns(firstInningHalfPlays),
    },
    firstTimeThrough: playStats(firstTimeThroughPlays),
  }
}

export function selectPitcherStartSample({
  currentStarts = [],
  previousStarts = [],
  currentSeasonStarts = 0,
  asOf,
  windowDays = 60,
} = {}) {
  const current = currentStarts
    .map((start) => ({ ...start, ageDays: dateAgeDays(start.date, asOf) }))
    .filter((start) => Number.isFinite(start.ageDays) && start.ageDays >= 1 && start.ageDays <= windowDays)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 10)
    .map((start) => ({
      ...start,
      sampleSource: 'current',
      sampleWeight: start.ageDays <= 30 ? 1 : 0.7,
    }))

  if (Number(currentSeasonStarts) >= 8) {
    return {
      sampleMode: 'current-season-only',
      current,
      previous: [],
      selected: current,
    }
  }

  const priorNeeded = Math.max(0, 8 - current.length)
  const previous = previousStarts
    .filter((start) => typeof start?.date === 'string' && start.date < asOf)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, priorNeeded)
    .map((start) => ({
      ...start,
      sampleSource: 'previous',
      sampleWeight: 0.55,
    }))
  return {
    sampleMode: previous.length ? 'blended-previous-season' : 'current-season-only',
    current,
    previous,
    selected: [...current, ...previous],
  }
}

function weightedTotals(records, field) {
  const totals = { bf: 0, outs: 0, k: 0, bb: 0, hbp: 0, hr: 0 }
  for (const record of records) {
    const stats = record?.[field]
    const weight = Number(record?.sampleWeight)
    if (!stats || !(weight > 0)) continue
    for (const key of Object.keys(totals)) totals[key] += (Number(stats[key]) || 0) * weight
  }
  return totals
}

function weightedScorelessRate(records) {
  let sample = 0
  let scoreless = 0
  for (const record of records) {
    const runs = Number(record?.firstInning?.runs)
    const weight = Number(record?.sampleWeight)
    if (!Number.isFinite(runs) || !(weight > 0)) continue
    sample += weight
    if (runs === 0) scoreless += weight
  }
  return {
    sample,
    scoreless,
    rate: sample > 0 ? scoreless / sample : null,
  }
}

function rate9(value, outs) {
  return outs > 0 ? value * 27 / outs : null
}

export function buildPitcherFirstInningProfile(records, {
  pitcherId,
  asOf,
  sampleMode = 'current-season-only',
  currentSeasonStarts = 0,
  currentWindowStarts = 0,
  previousSeasonStartsUsed = 0,
  fipConstant = 3.1,
} = {}) {
  const first = weightedTotals(records, 'firstInning')
  const tto = weightedTotals(records, 'firstTimeThrough')
  const scoreless = weightedScorelessRate(records)
  const effectiveStarts = records.reduce(
    (sum, record) => sum + (Number(record?.sampleWeight) || 0),
    0,
  )
  const firstInningIp = first.outs / 3
  const fipCore = firstInningIp > 0
    ? ((13 * first.hr) + (3 * (first.bb + first.hbp)) - (2 * first.k)) / firstInningIp
    : null
  const firstInningFip = Number.isFinite(fipCore) ? fipCore + fipConstant : null
  const startCoverage = clamp(effectiveStarts / 8, 0, 1)
  const firstCoverage = clamp(first.bf / 34, 0, 1)
  const ttoCoverage = clamp(tto.bf / 72, 0, 1)
  const coverage = 0.45 * startCoverage + 0.25 * firstCoverage + 0.30 * ttoCoverage
  const adjustedScorelessRate = scoreless.sample > 0
    ? (
        scoreless.scoreless
        + (FIRST_INNING_PITCHER_SCORELESS_PRIOR * FIRST_INNING_PITCHER_SCORELESS_PRIOR_STARTS)
      ) / (scoreless.sample + FIRST_INNING_PITCHER_SCORELESS_PRIOR_STARTS)
    : null

  return {
    version: FIRST_INNING_PITCHER_PROFILE_VERSION,
    source: 'MLB Stats API play-by-play',
    asOf,
    pitcherId: Number(pitcherId),
    windowDays: 60,
    sampleMode,
    currentSeasonStarts: Number(currentSeasonStarts) || 0,
    currentWindowStarts: Number(currentWindowStarts) || 0,
    previousSeasonStartsUsed: Number(previousSeasonStartsUsed) || 0,
    effectiveStarts: round(effectiveStarts, 2),
    scorelessFirstInningRate: round(scoreless.rate, 4),
    adjustedScorelessFirstInningRate: round(adjustedScorelessRate, 4),
    firstInningScoringAllowedRate: Number.isFinite(adjustedScorelessRate)
      ? round(1 - adjustedScorelessRate, 4)
      : null,
    scorelessFirstInningStarts: round(scoreless.scoreless, 2),
    scorelessFirstInningSample: round(scoreless.sample, 2),
    scorelessPriorRate: FIRST_INNING_PITCHER_SCORELESS_PRIOR,
    scorelessPriorStarts: FIRST_INNING_PITCHER_SCORELESS_PRIOR_STARTS,
    firstInningFip: Number.isFinite(firstInningFip) ? round(clamp(firstInningFip, 0, 15)) : null,
    firstInningK9: Number.isFinite(rate9(first.k, first.outs)) ? round(clamp(rate9(first.k, first.outs), 0, 30)) : null,
    firstInningBb9: Number.isFinite(rate9(first.bb, first.outs)) ? round(clamp(rate9(first.bb, first.outs), 0, 30)) : null,
    ttoK9: Number.isFinite(rate9(tto.k, tto.outs)) ? round(clamp(rate9(tto.k, tto.outs), 0, 30)) : null,
    ttoBb9: Number.isFinite(rate9(tto.bb, tto.outs)) ? round(clamp(rate9(tto.bb, tto.outs), 0, 30)) : null,
    ttoKMinusBbPct: tto.bf > 0 ? round((tto.k - tto.bb) / tto.bf, 4) : null,
    coverage: round(clamp(coverage, 0, 1)),
    samples: {
      firstInningBattersFaced: round(first.bf, 1),
      firstInningOuts: round(first.outs, 1),
      firstTimeThroughBattersFaced: round(tto.bf, 1),
      firstTimeThroughOuts: round(tto.outs, 1),
    },
  }
}
