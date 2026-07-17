import {
  aiHrSignalAppliesToBatter,
} from './aiHrShadow.mjs'
import {
  isPregameMlbGame,
  validateAiHrContext,
} from './aiHrContext.mjs'

export const MLB_DATA_HEALTH_VERSION = 2
export const MLB_DATA_HEALTH_MODE = 'watchdog'

const AI_REVIEW_KINDS = new Set([
  'starter-change',
  'opener-risk',
  'pitch-limit',
  'lineup-status',
  'injury',
  'scratch-risk',
  'roof',
  'callup',
])
const ISSUE_SOURCES = new Set(['deterministic', 'ai-context'])
const ISSUE_SEVERITIES = new Set(['critical', 'warning', 'info'])
const ISSUE_SCOPES = new Set(['slate', 'game', 'batter'])
const EXACT_PITCH_MIX_FIELDS = [
  'ffPct', 'siPct', 'fcPct',
  'slPct', 'stPct', 'svPct', 'cuPct', 'kcPct',
  'chPct', 'fsPct', 'knPct',
]

const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value))
const same = (left, right) => left != null && right != null && String(left) === String(right)
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const clean = (value, max = 280) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

function issueId(code, gamePk = null, playerId = null, suffix = null) {
  return [code, gamePk, playerId, suffix].filter((value) => value != null && value !== '').join(':')
}

function gameLabel(game) {
  const away = clean(game?.awayTeam?.abbr || game?.awayTeam?.name, 20) || 'Away'
  const home = clean(game?.homeTeam?.abbr || game?.homeTeam?.name, 20) || 'Home'
  return `${away}@${home}`
}

function teamLabel(team) {
  return clean(team?.name || team?.abbr, 40) || 'Opponent'
}

function addIssue(issues, seen, issue) {
  if (!issue?.id || seen.has(issue.id)) return
  seen.add(issue.id)
  issues.push({
    evidence: [],
    requiresReview: issue.severity !== 'info',
    ...issue,
  })
}

function rowSide(row, game) {
  if (same(row?.teamId, game?.awayTeam?.id)) return 'away'
  if (same(row?.teamId, game?.homeTeam?.id)) return 'home'
  if (row?.isHome === false) return 'away'
  if (row?.isHome === true) return 'home'
  return null
}

function pitchMixUsageGap(mix) {
  if (!isObject(mix)) return null
  const familyUsage = ['fastballPct', 'breakingPct', 'offspeedPct']
    .reduce((sum, field) => sum + (finite(mix[field]) ? Number(mix[field]) : 0), 0)
  if (familyUsage <= 0) return null
  const exactUsage = EXACT_PITCH_MIX_FIELDS
    .reduce((sum, field) => sum + (finite(mix[field]) ? Number(mix[field]) : 0), 0)
  return Math.max(0, familyUsage - exactUsage)
}

function addQaFlagIssues(slate, issues, seen) {
  const qa = slate?._qaFlags || {}
  const mappings = [
    ['gamesMissingStadium', 'park-factor-missing', 'Park-factor lookup is missing', 'game'],
    ['insaneHrRate', 'implausible-hr-rate', 'An implausible season HR rate needs review', 'batter'],
  ]
  for (const [field, code, lead, scope] of mappings) {
    for (const [index, detail] of (Array.isArray(qa[field]) ? qa[field] : []).entries()) {
      const match = String(detail).match(/\((\d+)(?:,|\))/)
      const gamePk = scope === 'game' && match ? Number(match[1]) : null
      const playerId = scope === 'batter' && match ? Number(match[1]) : null
      addIssue(issues, seen, {
        id: issueId(code, gamePk, playerId, index + 1),
        source: 'deterministic',
        severity: 'warning',
        code,
        scope,
        gamePk,
        playerId,
        message: `${lead}: ${clean(detail)}`,
        blocksPublish: false,
      })
    }
  }
  if (Number(qa.nanFallbacks) > 0) {
    addIssue(issues, seen, {
      id: 'non-finite-score-fallbacks',
      source: 'deterministic',
      severity: 'warning',
      code: 'non-finite-score-fallbacks',
      scope: 'slate',
      gamePk: null,
      playerId: null,
      message: `${Number(qa.nanFallbacks)} batter score(s) required a non-finite fallback.`,
      blocksPublish: false,
    })
  }
}

function deterministicIssues(slate, generatedAt) {
  const issues = []
  const seen = new Set()
  const games = new Map()
  const rowsByGame = new Map()

  for (const game of Array.isArray(slate?.games) ? slate.games : []) {
    if (!finite(game?.gamePk)) continue
    const gamePk = Number(game.gamePk)
    games.set(gamePk, game)
    rowsByGame.set(gamePk, [])
    if (finite(game?.awayTeam?.id) && same(game.awayTeam.id, game?.homeTeam?.id)) {
      addIssue(issues, seen, {
        id: issueId('same-team-game', gamePk), source: 'deterministic', severity: 'critical',
        code: 'same-team-game', scope: 'game', gamePk, playerId: null,
        message: `${gameLabel(game)} has the same team ID on both sides.`, blocksPublish: true,
      })
    }
    if (!finite(game?.awayTeam?.id) || !finite(game?.homeTeam?.id)) {
      addIssue(issues, seen, {
        id: issueId('team-identity-missing', gamePk), source: 'deterministic', severity: 'warning',
        code: 'team-identity-missing', scope: 'game', gamePk, playerId: null,
        message: `${gameLabel(game)} is missing an MLB team ID.`, blocksPublish: false,
      })
    }
    if (!validIso(game?.gameDate)) {
      addIssue(issues, seen, {
        id: issueId('game-time-missing', gamePk), source: 'deterministic', severity: 'warning',
        code: 'game-time-missing', scope: 'game', gamePk, playerId: null,
        message: `${gameLabel(game)} is missing a valid first-pitch time.`, blocksPublish: false,
      })
    }
  }

  for (const row of Object.values(isObject(slate?.scoredBatters) ? slate.scoredBatters : {})) {
    const gamePk = finite(row?.gamePk) ? Number(row.gamePk) : null
    const playerId = finite(row?.playerId) ? Number(row.playerId) : null
    const game = games.get(gamePk)
    if (!game) {
      addIssue(issues, seen, {
        id: issueId('batter-game-missing', gamePk, playerId), source: 'deterministic', severity: 'critical',
        code: 'batter-game-missing', scope: 'batter', gamePk, playerId,
        message: `${clean(row?.name, 80) || `Batter ${playerId}`} points to game ${gamePk}, which is absent from the slate.`, blocksPublish: true,
      })
      continue
    }
    rowsByGame.get(gamePk)?.push(row)
    const side = rowSide(row, game)
    const awayId = game?.awayTeam?.id
    const homeId = game?.homeTeam?.id

    if (finite(row?.teamId) && finite(awayId) && finite(homeId) && !same(row.teamId, awayId) && !same(row.teamId, homeId)) {
      addIssue(issues, seen, {
        id: issueId('batter-team-mismatch', gamePk, playerId), source: 'deterministic', severity: 'critical',
        code: 'batter-team-mismatch', scope: 'batter', gamePk, playerId,
        message: `${clean(row?.name, 80) || `Batter ${playerId}`} is assigned to a team outside ${gameLabel(game)}.`, blocksPublish: true,
      })
    }
    if ((side === 'away' && row?.isHome === true) || (side === 'home' && row?.isHome === false)) {
      addIssue(issues, seen, {
        id: issueId('home-away-mismatch', gamePk, playerId), source: 'deterministic', severity: 'critical',
        code: 'home-away-mismatch', scope: 'batter', gamePk, playerId,
        message: `${clean(row?.name, 80) || `Batter ${playerId}`} has a home/away identity contradiction.`, blocksPublish: true,
      })
    }

    const expectedPitcher = side === 'away' ? game?.homePitcher : side === 'home' ? game?.awayPitcher : null
    if (finite(expectedPitcher?.id) && finite(row?.pitcher?.id) && !same(expectedPitcher.id, row.pitcher.id)) {
      addIssue(issues, seen, {
        id: issueId('opposing-pitcher-mismatch', gamePk, playerId), source: 'deterministic', severity: 'critical',
        code: 'opposing-pitcher-mismatch', scope: 'batter', gamePk, playerId,
        message: `${clean(row?.name, 80) || `Batter ${playerId}`} is scored against ${clean(row?.pitcher?.name, 80) || row.pitcher.id}, not listed opponent ${clean(expectedPitcher?.name, 80) || expectedPitcher.id}.`,
        blocksPublish: true,
      })
    } else if (finite(expectedPitcher?.id) && !finite(row?.pitcher?.id) && isPregameMlbGame(game)) {
      addIssue(issues, seen, {
        id: issueId('opposing-pitcher-attachment-missing', gamePk, playerId), source: 'deterministic', severity: 'critical',
        code: 'opposing-pitcher-attachment-missing', scope: 'batter', gamePk, playerId,
        message: `${clean(row?.name, 80) || `Batter ${playerId}`} is missing listed opponent ${clean(expectedPitcher?.name, 80) || expectedPitcher.id}.`, blocksPublish: true,
      })
    }
  }

  const now = Date.parse(generatedAt)
  for (const [gamePk, game] of games) {
    if (!isPregameMlbGame(game)) continue
    const rows = rowsByGame.get(gamePk) || []
    const starterSides = [
      {
        side: 'away', pitcher: game?.awayPitcher, starterTeam: game?.awayTeam,
        battingTeam: game?.homeTeam, battingSide: 'home',
      },
      {
        side: 'home', pitcher: game?.homePitcher, starterTeam: game?.homeTeam,
        battingTeam: game?.awayTeam, battingSide: 'away',
      },
    ]
    for (const side of starterSides) {
      if (finite(side.pitcher?.id)) continue
      const affectedRows = rows.filter((row) => rowSide(row, game) === side.battingSide)
      const affectedPlayerIds = affectedRows.map((row) => Number(row.playerId)).filter(finite)
      const count = affectedPlayerIds.length
      const battingTeam = teamLabel(side.battingTeam)
      const impact = count
        ? `${count} ${battingTeam} hitter${count === 1 ? '' : 's'} use pitcher-neutral inputs`
        : `${battingTeam} hitter projections use pitcher-neutral inputs`
      addIssue(issues, seen, {
        id: issueId('listed-starter-missing', gamePk, null, side.side),
        source: 'deterministic', severity: 'warning', code: 'listed-starter-missing',
        scope: 'game', gamePk, playerId: null, teamId: finite(side.battingTeam?.id) ? Number(side.battingTeam.id) : null,
        affectedPlayerIds,
        message: `${gameLabel(game)}: ${teamLabel(side.starterTeam)} have no probable starter listed; ${impact} until MLB lists one.`,
        blocksPublish: false,
      })
    }
    for (const pitcher of [game?.awayPitcher, game?.homePitcher]) {
      if (!finite(pitcher?.id)) continue
      const gap = pitchMixUsageGap(slate?.pitcherPitchMix?.[pitcher.id])
      if (gap != null && gap >= 5) {
        addIssue(issues, seen, {
          id: issueId('pitch-mix-taxonomy-gap', gamePk, null, pitcher.id),
          source: 'deterministic', severity: 'warning',
          code: 'pitch-mix-taxonomy-gap', scope: 'game', gamePk, playerId: null,
          message: `${clean(pitcher?.name, 80) || `Pitcher ${pitcher.id}`} has ${gap.toFixed(0)}% of arsenal usage in a pitch family that is missing from exact pitch-type data.`,
          blocksPublish: false,
        })
      }
    }
    if (rows.length < 5) {
      addIssue(issues, seen, {
        id: issueId('few-scored-batters', gamePk), source: 'deterministic', severity: 'warning',
        code: 'few-scored-batters', scope: 'game', gamePk, playerId: null,
        message: `${gameLabel(game)} has only ${rows.length} scored batter${rows.length === 1 ? '' : 's'}.`, blocksPublish: false,
      })
    }
    if (game?.venueName && !slate?.weatherByGame?.[gamePk]) {
      addIssue(issues, seen, {
        id: issueId('weather-missing', gamePk), source: 'deterministic', severity: 'warning',
        code: 'weather-missing', scope: 'game', gamePk, playerId: null,
        message: `${gameLabel(game)} is missing game weather.`, blocksPublish: false,
      })
    }
    const startsAt = Date.parse(game?.gameDate)
    const minutesToStart = (startsAt - now) / 60000
    const confirmed = rows.filter((row) => row?.lineupConfirmed === true).length
    if (rows.length >= 5 && Number.isFinite(minutesToStart) && minutesToStart >= -15 && minutesToStart <= 90 && confirmed === 0) {
      addIssue(issues, seen, {
        id: issueId('lineup-unconfirmed-near-start', gamePk), source: 'deterministic', severity: 'warning',
        code: 'lineup-unconfirmed-near-start', scope: 'game', gamePk, playerId: null,
        message: `${gameLabel(game)} is within 90 minutes of first pitch with no confirmed hitters.`, blocksPublish: false,
      })
    }
  }
  addQaFlagIssues(slate, issues, seen)
  return issues
}

function aiIssues(slate, context, generatedAt) {
  if (!context || !validateAiHrContext(context).ok || context.skipped || context.date !== slate?.date) return []
  const now = Date.parse(generatedAt)
  return context.signals
    .filter((signal) => (
      AI_REVIEW_KINDS.has(signal.kind) &&
      Date.parse(signal.observedAt) <= now &&
      Date.parse(signal.expiresAt) > now &&
      !(signal.kind === 'lineup-status' && signal.direction === 'boost' && signal.severity === 'info')
    ))
    .map((signal) => ({
      id: issueId('ai-context', signal.gamePk, signal.entityType === 'batter' ? signal.entityId : null, signal.id),
      source: 'ai-context',
      severity: 'warning',
      code: `external-${signal.kind}`,
      scope: signal.entityType === 'batter' ? 'batter' : 'game',
      gamePk: Number(signal.gamePk),
      playerId: signal.entityType === 'batter' && finite(signal.entityId) ? Number(signal.entityId) : null,
      entityKey: signal.entityKey,
      signalId: signal.id,
      confidence: signal.confidence,
      message: `${signal.entity}: ${signal.note}`,
      blocksPublish: false,
      requiresReview: true,
      evidence: signal.evidence.map((item) => ({
        url: item.url,
        title: item.title,
        publishedAt: item.publishedAt ?? null,
      })),
    }))
}

function summarize(issues) {
  const hardFailures = issues.filter((issue) => issue.blocksPublish).length
  const warnings = issues.filter((issue) => issue.severity === 'warning').length
  const aiAlerts = issues.filter((issue) => issue.source === 'ai-context').length
  const affectedGames = new Set(issues.map((issue) => issue.gamePk).filter(finite)).size
  const affectedPlayerIds = new Set()
  for (const issue of issues) {
    if (finite(issue.playerId)) affectedPlayerIds.add(Number(issue.playerId))
    for (const playerId of Array.isArray(issue.affectedPlayerIds) ? issue.affectedPlayerIds : []) {
      if (finite(playerId)) affectedPlayerIds.add(Number(playerId))
    }
  }
  const affectedBatters = affectedPlayerIds.size
  return { hardFailures, warnings, aiAlerts, affectedGames, affectedBatters }
}

export function buildMlbDataHealth({ slate, context = null, generatedAt = new Date().toISOString() }) {
  const at = validIso(generatedAt) ? new Date(generatedAt).toISOString() : new Date().toISOString()
  const issues = [...deterministicIssues(slate, at), ...aiIssues(slate, context, at)]
    .sort((left, right) => (
      Number(right.blocksPublish) - Number(left.blocksPublish) ||
      left.source.localeCompare(right.source) ||
      (left.gamePk ?? 0) - (right.gamePk ?? 0) ||
      left.id.localeCompare(right.id)
    ))
  const counts = summarize(issues)
  const status = counts.hardFailures ? 'critical' : counts.warnings ? 'limited' : 'ready'
  return {
    version: MLB_DATA_HEALTH_VERSION,
    mode: MLB_DATA_HEALTH_MODE,
    date: slate?.date || null,
    generatedAt: at,
    slateGeneratedAt: slate?.generatedAt || null,
    status,
    scoreImpact: false,
    enforcement: {
      deterministicIdentityFailuresBlockPublish: true,
      aiAlertsBlockPublish: false,
      aiAlertsChangeScores: false,
    },
    ai: {
      status: !context ? 'missing' : !validateAiHrContext(context).ok ? 'invalid' : context.skipped ? 'skipped' : context.date !== slate?.date ? 'stale' : 'checked',
      contextGeneratedAt: validIso(context?.generatedAt) ? context.generatedAt : null,
      model: clean(context?.model, 100) || null,
    },
    counts,
    issues,
  }
}

function issueAppliesToRow(issue, row, game, contextBySignalId) {
  if (issue.scope === 'slate') return true
  if (issue.scope === 'batter') return same(issue.playerId, row.playerId) && (issue.gamePk == null || same(issue.gamePk, row.gamePk))
  if (!same(issue.gamePk, row.gamePk)) return false
  if (finite(issue.teamId) && !same(issue.teamId, row.teamId)) return false
  if (issue.source !== 'ai-context') return true
  const signal = contextBySignalId.get(issue.signalId)
  return signal ? aiHrSignalAppliesToBatter(signal, row, game) : true
}

export function applyMlbDataHealth({ slate, context = null, generatedAt = new Date().toISOString() }) {
  const report = buildMlbDataHealth({ slate, context, generatedAt })
  const output = structuredClone(slate)
  const games = new Map((output.games || []).map((game) => [Number(game.gamePk), game]))
  const contextBySignalId = new Map((context?.signals || []).map((signal) => [signal.id, signal]))

  for (const row of Object.values(output.scoredBatters || {})) {
    delete row.dataTrust
    const game = games.get(Number(row.gamePk))
    const related = report.issues.filter((issue) => issueAppliesToRow(issue, row, game, contextBySignalId))
    if (!related.length) continue
    row.dataTrust = {
      status: related.some((issue) => issue.blocksPublish) ? 'blocked' : 'review',
      checkedAt: report.generatedAt,
      issueCodes: [...new Set(related.map((issue) => issue.code))].sort(),
      aiAlerts: related.filter((issue) => issue.source === 'ai-context').length,
    }
  }
  output.dataHealth = {
    version: report.version,
    status: report.status,
    generatedAt: report.generatedAt,
    scoreImpact: false,
    report: 'mlb-data-health.json',
    ...report.counts,
    issues: report.issues.slice(0, 12).map((issue) => ({
      id: issue.id,
      source: issue.source,
      severity: issue.severity,
      code: issue.code,
      scope: issue.scope,
      gamePk: issue.gamePk,
      playerId: issue.playerId,
      teamId: issue.teamId ?? null,
      affectedBatters: Array.isArray(issue.affectedPlayerIds) ? issue.affectedPlayerIds.length : (finite(issue.playerId) ? 1 : 0),
      message: issue.message,
      blocksPublish: issue.blocksPublish,
      confidence: issue.confidence ?? null,
      evidence: issue.evidence,
    })),
  }
  return { slate: output, report }
}

export function validateMlbDataHealth({ slate, report }) {
  const errors = []
  const warnings = []
  if (!isObject(report)) return { ok: false, errors: ['report: expected an object'], warnings, metrics: {} }
  if (report.version !== MLB_DATA_HEALTH_VERSION) errors.push(`version: expected ${MLB_DATA_HEALTH_VERSION}`)
  if (report.mode !== MLB_DATA_HEALTH_MODE) errors.push(`mode: expected ${MLB_DATA_HEALTH_MODE}`)
  if (report.scoreImpact !== false) errors.push('scoreImpact: must be false')
  if (!validIso(report.generatedAt)) errors.push('generatedAt: expected an ISO timestamp')
  if (!Array.isArray(report.issues)) errors.push('issues: expected an array')
  if (report.enforcement?.aiAlertsBlockPublish !== false || report.enforcement?.aiAlertsChangeScores !== false) {
    errors.push('enforcement: AI alerts cannot block publishing or change scores')
  }

  const ids = new Set()
  for (const [index, issue] of (Array.isArray(report.issues) ? report.issues : []).entries()) {
    const at = `issues[${index}]`
    if (!isObject(issue)) { errors.push(`${at}: expected an object`); continue }
    if (!issue.id || ids.has(issue.id)) errors.push(`${at}.id: required and unique`)
    ids.add(issue.id)
    if (!ISSUE_SOURCES.has(issue.source)) errors.push(`${at}.source: unsupported value`)
    if (!ISSUE_SEVERITIES.has(issue.severity)) errors.push(`${at}.severity: unsupported value`)
    if (!ISSUE_SCOPES.has(issue.scope)) errors.push(`${at}.scope: unsupported value`)
    if (!clean(issue.code, 80) || !clean(issue.message, 280)) errors.push(`${at}: code and message are required`)
    if (typeof issue.blocksPublish !== 'boolean') errors.push(`${at}.blocksPublish: expected boolean`)
    if (issue.teamId != null && !finite(issue.teamId)) errors.push(`${at}.teamId: expected a finite MLB team ID`)
    if (issue.affectedPlayerIds != null && (!Array.isArray(issue.affectedPlayerIds) || issue.affectedPlayerIds.some((value) => !finite(value)))) {
      errors.push(`${at}.affectedPlayerIds: expected finite MLB player IDs`)
    }
    if (issue.source === 'ai-context') {
      if (issue.blocksPublish) errors.push(`${at}: AI context cannot block publishing`)
      if (!issue.signalId || !issue.entityKey) errors.push(`${at}: AI context requires signal provenance`)
      if (!Array.isArray(issue.evidence) || !issue.evidence.length) errors.push(`${at}.evidence: source-backed AI issue requires evidence`)
      for (const source of issue.evidence || []) {
        try {
          if (!['http:', 'https:'].includes(new URL(source?.url).protocol)) throw new Error('bad protocol')
        } catch { errors.push(`${at}.evidence: invalid source URL`) }
      }
    }
  }

  const expectedCounts = summarize(Array.isArray(report.issues) ? report.issues : [])
  for (const [field, value] of Object.entries(expectedCounts)) {
    if (report.counts?.[field] !== value) errors.push(`counts.${field}: expected ${value}`)
  }
  const expectedStatus = expectedCounts.hardFailures ? 'critical' : expectedCounts.warnings ? 'limited' : 'ready'
  if (report.status !== expectedStatus) errors.push(`status: expected ${expectedStatus}`)
  if (report.date !== slate?.date || report.slateGeneratedAt !== slate?.generatedAt) errors.push('report: slate identity does not reconcile')
  if (!isObject(slate?.dataHealth)) errors.push('slate.dataHealth: expected embedded summary')
  else {
    for (const field of ['status', 'generatedAt', 'hardFailures', 'warnings', 'aiAlerts', 'affectedGames', 'affectedBatters']) {
      const expected = field in expectedCounts ? expectedCounts[field] : report[field]
      if (slate.dataHealth[field] !== expected) errors.push(`slate.dataHealth.${field}: does not reconcile with report`)
    }
    if (slate.dataHealth.scoreImpact !== false) errors.push('slate.dataHealth.scoreImpact: must be false')
  }
  if (report.ai?.status !== 'checked') warnings.push(`AI cross-check status: ${report.ai?.status || 'unknown'}`)
  return { ok: errors.length === 0, errors, warnings, metrics: { ...expectedCounts, status: expectedStatus } }
}

export function assertValidMlbDataHealth(result) {
  const validation = validateMlbDataHealth(result)
  if (validation.ok) return validation
  throw new Error(`MLB data health failed validation:\n- ${validation.errors.join('\n- ')}`)
}

export function assertPublishableMlbDataHealth(report) {
  const blockers = (report?.issues || []).filter((issue) => issue.blocksPublish)
  if (!blockers.length) return report
  throw new Error(`MLB data health blocked publish:\n- ${blockers.map((issue) => issue.message).join('\n- ')}`)
}
