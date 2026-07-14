import {
  assertValidAiHrContext,
  buildAiHrEntityIndex,
  normalizeAiHrContext,
  summarizeAiHrTargets,
} from './aiHrContext.mjs'
import {
  assertValidAiHrShadowLedger,
  buildAiHrShadowRecords,
  mergeAiHrShadowLedger,
} from './aiHrShadow.mjs'
import {
  assertValidAiHrEvaluation,
  buildAiHrEvaluation,
} from './aiHrEvaluation.mjs'
import { applySimResolution } from './simResolution.mjs'
import {
  fitScoreCalibrationAdaptive,
  lookupProb,
} from '../../src/sports/mlb/logic/isotonicCalibration.js'

export const AI_HR_HISTORICAL_VERSION = 2
export const AI_HR_HISTORICAL_MODE = 'historical-replay'
export const AI_HR_HISTORICAL_BASELINE = 'walk-forward-score-calibration+sim-resolution'

const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const round = (value, digits = 12) => Number(Number(value).toFixed(digits))

function recordsByDate(backtestLog) {
  return backtestLog?.records && typeof backtestLog.records === 'object'
    ? backtestLog.records
    : backtestLog?.modelHistory?.records || {}
}

export function selectAiHrHistoricalDates(backtestLog, { from = null, to = null, maxDates = null } = {}) {
  let dates = Object.entries(recordsByDate(backtestLog))
    .filter(([date, records]) => (
      validDate(date) && Array.isArray(records) &&
      records.some((record) => finite(record?.playerId) && finite(record?.gamePk) && finite(record?.score))
    ))
    .map(([date]) => date)
    .sort()
  if (validDate(from)) dates = dates.filter((date) => date >= from)
  if (validDate(to)) dates = dates.filter((date) => date <= to)
  if (Number.isInteger(maxDates) && maxDates > 0) dates = dates.slice(-maxDates)
  return dates
}

/**
 * Rebuild the probability available on a historical morning without allowing
 * that date (or any future outcome) into calibration. The returned rows are an
 * explicit allow-list; outcome fields from the reconcile log are never copied.
 */
export function buildAiHrWalkForwardBaseline(backtestLog, date) {
  if (!validDate(date)) throw new Error('historical baseline date must be YYYY-MM-DD')
  const source = recordsByDate(backtestLog)
  const trainingDates = Object.keys(source).filter((candidate) => validDate(candidate) && candidate < date).sort()
  const trainingRecords = Object.fromEntries(trainingDates.map((candidate) => [candidate, source[candidate]]))
  const fit = fitScoreCalibrationAdaptive({ dates: trainingDates, records: trainingRecords }, { lookbackDays: 30 })
  const table = fit.table
  const rows = (source[date] || [])
    .filter((record) => finite(record?.playerId) && finite(record?.gamePk) && finite(record?.score))
    .map((record) => {
      const score = Number(record.score)
      const anchor = lookupProb(score, table)
      return {
        playerId: Number(record.playerId),
        gamePk: Number(record.gamePk),
        name: String(record.name || '').trim(),
        score,
        grade: typeof record.grade === 'string' ? record.grade : record.grade?.label || 'SKIP',
        lineupConfirmed: record.lineupConfirmed === true,
        simHRProb: finite(record.simHRProb) ? Number(record.simHRProb) : null,
        _anchorProb: anchor,
        hrProbability: anchor,
      }
    })
  applySimResolution(rows, { table, lookupProb })
  for (const row of rows) {
    row.hrProbability = round(row.hrProbability)
    delete row._anchorProb
  }
  return {
    rows,
    audit: {
      method: AI_HR_HISTORICAL_BASELINE,
      targetDate: date,
      trainingDates,
      latestTrainingDate: trainingDates.at(-1) || null,
      trainingRows: Number(fit.totalN) || trainingDates.reduce((sum, candidate) => sum + (source[candidate]?.length || 0), 0),
      calibrationMethod: fit.method || 'fallback',
      calibrationBucketSize: fit.bucketSize || null,
      targetRows: rows.length,
      outcomeFieldsCopied: false,
    },
  }
}

function scheduleGames(schedule) {
  if (Array.isArray(schedule)) return schedule
  return (schedule?.dates || []).flatMap((entry) => entry?.games || [])
}

function teamShape(team) {
  return {
    id: Number(team?.id),
    name: String(team?.name || '').trim(),
    abbr: String(team?.abbreviation || team?.teamCode || team?.name || '').trim().toUpperCase(),
  }
}

function boxscorePlayerIds(boxscore, side) {
  return new Set(Object.values(boxscore?.teams?.[side]?.players || {})
    .map((player) => Number(player?.person?.id))
    .filter(Number.isFinite))
}

/** Only identity fields leave the historical MLB boxscore response. */
export function buildAiHrHistoricalSlate({ date, baselineRows, schedule, boxscores = new Map() }) {
  const wanted = new Set((baselineRows || []).map((row) => Number(row.gamePk)))
  const games = scheduleGames(schedule)
    .filter((game) => wanted.has(Number(game?.gamePk)))
    .map((game) => ({
      gamePk: Number(game.gamePk),
      gameDate: new Date(game.gameDate).toISOString(),
      status: 'Scheduled',
      isLive: false,
      isFinal: false,
      venueName: String(game?.venue?.name || '').trim() || null,
      awayTeam: teamShape(game?.teams?.away?.team || game?.awayTeam),
      homeTeam: teamShape(game?.teams?.home?.team || game?.homeTeam),
    }))
    .sort((left, right) => left.gamePk - right.gamePk)
  const gameIndex = new Map(games.map((game) => [game.gamePk, game]))
  const scoredBatters = {}

  for (const row of baselineRows || []) {
    const game = gameIndex.get(Number(row.gamePk))
    if (!game) continue
    const boxscore = boxscores instanceof Map ? boxscores.get(game.gamePk) : boxscores[game.gamePk]
    const awayIds = boxscorePlayerIds(boxscore, 'away')
    const homeIds = boxscorePlayerIds(boxscore, 'home')
    const isAway = awayIds.has(Number(row.playerId))
    const isHome = homeIds.has(Number(row.playerId))
    if (isAway === isHome) continue
    const team = isAway ? game.awayTeam : game.homeTeam
    scoredBatters[`${row.playerId}-${row.gamePk}`] = {
      playerId: row.playerId,
      gamePk: row.gamePk,
      name: row.name,
      score: row.score,
      grade: row.grade,
      lineupConfirmed: row.lineupConfirmed,
      simHRProb: row.simHRProb,
      hrProbability: row.hrProbability,
      teamId: team.id,
      team: team.abbr,
      isHome,
      pitcher: null,
    }
  }
  return { date, games, scoredBatters }
}

export function historicalAsOf(slate, minutesBeforeFirstPitch = 60) {
  const starts = (slate?.games || []).map((game) => Date.parse(game.gameDate)).filter(Number.isFinite)
  if (!starts.length) throw new Error('historical slate has no valid first-pitch timestamp')
  return new Date(Math.min(...starts) - Math.max(1, minutesBeforeFirstPitch) * 60_000).toISOString()
}

export function buildAiHrHistoricalPrompt(slate, asOf) {
  if (!validIso(asOf)) throw new Error('historical replay cutoff must be ISO')
  const summary = summarizeAiHrTargets(slate)
  return `You are running a time-locked MLB home-run context replay for ${summary.date}.
Act as if the current time is exactly ${asOf}. Use web search only for reporting published on or before that cutoff. Never use a game recap, box score, result, final score, or any knowledge of what happened after the cutoff.

Find sourced facts the numeric model could not know: confirmed lineup/injury or scratch news for listed batters, material game-time weather or roof status, and documented bullpen overuse or unavailability. The player-to-game mapping below is identity-only and contains frozen pregame model rows; it does not imply that a player appeared.

ALLOWED GAME AND BULLPEN TARGETS:
${summary.games.map((game) => `- ${game.entityKey} | ${game.matchup} | first pitch ${game.gameDate || '?'} | ${game.venue || '?'}\n  bullpens: ${game.bullpens.map((bullpen) => `${bullpen.entityKey}=${bullpen.team}`).join('; ')}`).join('\n')}

ALLOWED BATTER TARGETS:
${summary.batters.map((batter) => `- ${batter.entityKey} | ${batter.name} (${batter.team}, ${batter.grade})`).join('\n')}

Return STRICT JSON only:
{"signals":[{"entityKey":"<EXACT allowed key>","kind":"lineup-status|injury|scratch-risk|weather|roof|bullpen|callup|other","direction":"boost|suppress|uncertain","severity":"alert|warn|info","confidence":0.0,"note":"<one factual sentence known by the cutoff>","observedAt":"<ISO at or before cutoff>","expiresAt":"<ISO after cutoff, no more than 24h later>","evidence":[{"url":"https://<direct source URL>","title":"<source title>","publishedAt":"<REQUIRED ISO timestamp at or before cutoff>"}]}]}

Rules:
- entityKey must exactly match an allowed key. Do not create pitcher targets.
- Every evidence item requires a direct URL and a precise publishedAt timestamp at or before ${asOf}. If its publication time cannot be established, omit the entire signal.
- direction is from the affected batter's HR perspective; it is a hypothesis, not a probability or betting recommendation.
- Do not output probabilities, weights, score changes, multipliers, locks, or outcomes.
- Return {"signals":[]} when no trustworthy time-eligible fact is available.`
}

/**
 * A normal context accepts unknown evidence timestamps for live advisory use.
 * A historical replay cannot: missing or post-cutoff provenance rejects the
 * whole candidate so a later article cannot leak the target game's result.
 */
export function normalizeAiHrHistoricalContext({ raw, slate, asOf, model, source = 'tavily+openai' }) {
  if (!validIso(asOf)) throw new Error('historical replay cutoff must be ISO')
  const entities = buildAiHrEntityIndex(slate)
  const candidates = Array.isArray(raw?.signals) ? raw.signals : []
  const eligible = []
  let timeRejected = 0

  for (const candidate of candidates) {
    const entity = entities.get(String(candidate?.entityKey || '').trim())
    const gameCutoff = validIso(entity?.gameDate) ? Math.min(Date.parse(asOf), Date.parse(entity.gameDate)) : Date.parse(asOf)
    const evidence = Array.isArray(candidate?.evidence) ? candidate.evidence : []
    const evidenceTimes = evidence.map((item) => Date.parse(item?.publishedAt))
    if (!entity || !evidence.length || evidenceTimes.some((time) => !Number.isFinite(time) || time > gameCutoff)) {
      timeRejected++
      continue
    }
    const observedAt = new Date(Math.max(...evidenceTimes)).toISOString()
    const expiresAt = new Date(Math.min(
      Date.parse(asOf) + 24 * 60 * 60_000,
      validIso(entity.gameDate) ? Date.parse(entity.gameDate) + 60 * 60_000 : Date.parse(asOf) + 8 * 60 * 60_000,
    )).toISOString()
    eligible.push({ ...candidate, observedAt, expiresAt })
  }

  const context = normalizeAiHrContext({
    raw: { signals: eligible },
    slate,
    generatedAt: asOf,
    model,
    source,
  })
  context.stats.requested = candidates.length
  context.stats.rejected = candidates.length - context.stats.accepted
  context.replay = {
    asOf: new Date(asOf).toISOString(),
    evidencePolicy: 'all-evidence-published-at-or-before-cutoff',
    timeRejected,
  }
  return context
}

export function buildAiHrHistoricalReplay({ runs, backtestLog, generatedAt = new Date().toISOString() }) {
  if (!Array.isArray(runs)) throw new Error('historical replay runs must be an array')
  let ledger = null
  const dates = []
  const contexts = []

  for (const run of runs.slice().sort((left, right) => left.date.localeCompare(right.date))) {
    assertValidAiHrContext(run.context)
    if (run.context.date !== run.date || run.context.replay?.asOf !== run.asOf) throw new Error(`historical context does not reconcile for ${run.date}`)
    const records = buildAiHrShadowRecords({ slate: run.slate, context: run.context, generatedAt: run.asOf })
    ledger = mergeAiHrShadowLedger({
      previous: ledger,
      date: run.date,
      records,
      replaceGamePks: run.slate.games.map((game) => game.gamePk),
      updatedAt: run.asOf,
    })
    dates.push({
      date: run.date,
      asOf: run.asOf,
      games: run.slate.games.length,
      baselineRows: Object.keys(run.slate.scoredBatters).length,
      signalsRequested: run.context.stats.requested,
      signalsAccepted: run.context.stats.accepted,
      signalsRejected: run.context.stats.rejected,
      shadowRows: records.length,
      trainingDates: run.baselineAudit.trainingDates.length,
      latestTrainingDate: run.baselineAudit.latestTrainingDate,
    })
    contexts.push(run.context)
  }

  if (!ledger) {
    ledger = mergeAiHrShadowLedger({
      previous: null,
      date: validDate(backtestLog?.dates?.at?.(-1)) ? backtestLog.dates.at(-1) : '1970-01-01',
      records: [],
      updatedAt: generatedAt,
    })
  }
  assertValidAiHrShadowLedger(ledger)
  const evaluation = buildAiHrEvaluation({ ledger, backtestLog, generatedAt })
  assertValidAiHrEvaluation(evaluation)
  const replay = {
    version: AI_HR_HISTORICAL_VERSION,
    mode: AI_HR_HISTORICAL_MODE,
    scoreImpact: false,
    autoPromotion: false,
    researchProvider: 'tavily+openai',
    generatedAt: new Date(generatedAt).toISOString(),
    baseline: {
      method: AI_HR_HISTORICAL_BASELINE,
      leakagePolicy: 'target-date-and-future-outcomes-excluded',
      identityHydration: 'MLB schedule and boxscore player/team IDs only',
      outcomesExposedToResearchPrompt: false,
    },
    dates,
    contexts,
    ledger,
    evaluation,
  }
  assertValidAiHrHistoricalReplay(replay)
  return replay
}

export function validateAiHrHistoricalReplay(replay) {
  const errors = []
  const warnings = []
  if (!isObject(replay)) return { ok: false, errors: ['replay: expected an object'], warnings, metrics: {} }
  if (replay.version !== AI_HR_HISTORICAL_VERSION) errors.push(`version: expected ${AI_HR_HISTORICAL_VERSION}`)
  if (replay.mode !== AI_HR_HISTORICAL_MODE) errors.push(`mode: expected ${AI_HR_HISTORICAL_MODE}`)
  if (replay.scoreImpact !== false || replay.autoPromotion !== false) errors.push('production controls: historical replay cannot affect scoring or auto-promote')
  if (replay.researchProvider !== 'tavily+openai') errors.push('researchProvider: expected tavily+openai')
  if (!validIso(replay.generatedAt)) errors.push('generatedAt: expected ISO timestamp')
  if (replay.baseline?.method !== AI_HR_HISTORICAL_BASELINE || replay.baseline?.outcomesExposedToResearchPrompt !== false) errors.push('baseline: invalid leakage controls')
  if (!Array.isArray(replay.dates) || !Array.isArray(replay.contexts) || replay.dates.length !== replay.contexts.length) errors.push('dates/contexts: expected reconciled arrays')

  for (let index = 0; index < (replay.contexts || []).length; index++) {
    const context = replay.contexts[index]
    const date = replay.dates?.[index]
    const validation = (() => { try { return assertValidAiHrContext(context) } catch (error) { errors.push(`contexts[${index}]: ${error.message}`); return null } })()
    if (!validation) continue
    if (context.date !== date?.date || context.replay?.asOf !== date?.asOf || !validIso(context.replay?.asOf)) errors.push(`contexts[${index}]: replay date/cutoff does not reconcile`)
    if (context.source !== 'tavily+openai') errors.push(`contexts[${index}].source: expected tavily+openai`)
    if (date?.latestTrainingDate != null && (!validDate(date.latestTrainingDate) || date.latestTrainingDate >= date.date)) errors.push(`dates[${index}]: walk-forward training reaches target or future date`)
    for (const signal of context.signals) {
      if (signal.evidence.some((item) => !validIso(item.publishedAt) || Date.parse(item.publishedAt) > Date.parse(context.replay.asOf))) errors.push(`contexts[${index}].${signal.id}: evidence violates historical cutoff`)
    }
  }
  try { assertValidAiHrShadowLedger(replay.ledger) } catch (error) { errors.push(`ledger: ${error.message}`) }
  try { assertValidAiHrEvaluation(replay.evaluation) } catch (error) { errors.push(`evaluation: ${error.message}`) }
  if (replay.ledger?.scoreImpact !== false || replay.evaluation?.autoPromotion !== false) errors.push('nested controls: replay ledger/evaluation must remain non-production')
  if (!replay.contexts?.some((context) => context.signals.length)) warnings.push('signals: historical research accepted no time-eligible signals')
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics: {
      dates: replay.dates?.length || 0,
      signals: replay.contexts?.reduce((sum, context) => sum + (context.signals?.length || 0), 0) || 0,
      settled: replay.evaluation?.coverage?.settledRecords || 0,
      gateStatus: replay.evaluation?.gate?.status || null,
      brierImprovement: replay.evaluation?.overall?.comparison?.brierImprovement ?? null,
    },
  }
}

export function assertValidAiHrHistoricalReplay(replay) {
  const validation = validateAiHrHistoricalReplay(replay)
  if (validation.ok) return validation
  throw new Error(`AI HR historical replay failed validation:\n- ${validation.errors.join('\n- ')}`)
}
