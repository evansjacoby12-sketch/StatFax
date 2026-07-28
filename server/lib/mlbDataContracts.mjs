import {
  CLEAN_PREGAME_FEATURE_CAPTURE,
  CLEAN_PREGAME_FEATURE_GENERATION,
  HISTORICAL_FEATURE_VERSION,
  buildHistoricalFeatureCoverage,
  validateHistoricalFeatureRecord,
} from './historicalFeatureArchive.mjs'
import { validateZoneEvidenceArchive } from './zoneEvaluation.mjs'
import { validatePitcherContactLeakEvidence } from '../../src/sports/mlb/logic/pitcherContactLeak.js'
import { isValidFrozenPitcherCorrection } from './pitcherProvenance.mjs'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const GRADE_LABELS = new Set(['PRIME', 'STRONG', 'LEAN', 'SKIP'])
const K_VOLUME_SOURCES = new Set(['recent-pitches-bf', 'recent-ip', 'season-ip'])

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isValidDate = (value) => typeof value === 'string' && DATE_RE.test(value)
const isSortedUnique = (values) => values.every((value, index) => (
  (index === 0 || values[index - 1] < value) && values.indexOf(value) === index
))

function result(errors, warnings, metrics) {
  return { ok: errors.length === 0, errors, warnings, metrics }
}

function validateKDistribution(key, dist, errors) {
  const prefix = `kDistByPitcher.${key}`
  if (!/^\d+-\d+$/.test(key)) errors.push(`${prefix}: key must be pitcherId-gamePk`)
  if (!isObject(dist)) {
    errors.push(`${prefix}: distribution must be an object`)
    return
  }
  for (const field of ['k', 'lo', 'hi', 'lambda', 'expIP', 'expBF', 'adjustedKRate', 'calibration']) {
    if (!Number.isFinite(dist[field])) errors.push(`${prefix}.${field}: must be finite`)
  }
  if (Number.isFinite(dist.lo) && Number.isFinite(dist.hi) && dist.lo > dist.hi) {
    errors.push(`${prefix}: lo cannot exceed hi`)
  }
  if (!K_VOLUME_SOURCES.has(dist.volumeSource)) errors.push(`${prefix}.volumeSource: unsupported value`)
  if (!['up', 'down', 'flat'].includes(dist.trend)) errors.push(`${prefix}.trend: unsupported value`)
  if (!['low', 'med', 'high'].includes(dist.conf)) errors.push(`${prefix}.conf: unsupported value`)
  if (!Number.isInteger(dist.modelVersion) || dist.modelVersion < 2) {
    errors.push(`${prefix}.modelVersion: expected version 2 or newer`)
  }
  if (dist.modelVersion >= 4) {
    for (const field of [
      'oppK', 'oppRecentK', 'recentKCoverage', 'pitchWhiffCoverage',
      'pitchWhiffAdj', 'h2hKAdj', 'h2hSample', 'matchupAdj',
    ]) {
      if (!Number.isFinite(dist[field])) errors.push(`${prefix}.${field}: required for K model v4+`)
    }
    if (Number.isFinite(dist.recentKCoverage) && (dist.recentKCoverage < 0 || dist.recentKCoverage > 1)) {
      errors.push(`${prefix}.recentKCoverage: expected probability in [0,1]`)
    }
    if (Number.isFinite(dist.pitchWhiffCoverage) && (dist.pitchWhiffCoverage < 0 || dist.pitchWhiffCoverage > 1)) {
      errors.push(`${prefix}.pitchWhiffCoverage: expected probability in [0,1]`)
    }
    if (Number.isFinite(dist.matchupAdj) && (dist.matchupAdj < 0.94 || dist.matchupAdj > 1.06)) {
      errors.push(`${prefix}.matchupAdj: expected capped adjustment in [0.94,1.06]`)
    }
  }
  if (!isObject(dist.probs) || !Object.keys(dist.probs).length) {
    errors.push(`${prefix}.probs: expected at least one strikeout line`)
  } else {
    for (const [line, probability] of Object.entries(dist.probs)) {
      if (!Number.isFinite(Number(line)) || !Number.isFinite(probability) || probability < 0 || probability > 1) {
        errors.push(`${prefix}.probs.${line}: expected probability in [0,1]`)
      }
    }
  }
}

function validateZoneMatchup(prefix, zone, errors) {
  if (!isObject(zone)) {
    errors.push(`${prefix}: expected an object`)
    return
  }
  if (!Number.isInteger(zone.modelVersion) || zone.modelVersion < 2) errors.push(`${prefix}.modelVersion: expected 2+`)
  if (zone.advisoryOnly !== true) errors.push(`${prefix}.advisoryOnly: must be true`)
  for (const field of ['attackZones', 'chaseZones', 'matchedZones', 'cellEvidence']) {
    if (!Array.isArray(zone[field])) errors.push(`${prefix}.${field}: expected an array`)
  }
  if (Array.isArray(zone.cellEvidence) && zone.cellEvidence.length !== 13) errors.push(`${prefix}.cellEvidence: expected 13 cells`)
  if (Array.isArray(zone.attackZones) && Array.isArray(zone.matchedZones) && JSON.stringify(zone.attackZones) !== JSON.stringify(zone.matchedZones)) errors.push(`${prefix}.matchedZones: must equal attackZones`)
  if (zone.zoneRating != null && (!Number.isFinite(zone.zoneRating) || zone.zoneRating < 0 || zone.zoneRating > 10)) errors.push(`${prefix}.zoneRating: expected null or 0..10`)
  if (!['high', 'medium', 'limited'].includes(zone.reliability?.status)) errors.push(`${prefix}.reliability.status: unsupported`)
  if (zone.badge != null && zone.badge !== 'ZONE_MASTER') errors.push(`${prefix}.badge: unsupported`)
}

function validateMarketPrice(prefix, price, errors) {
  if (!isObject(price)) {
    errors.push(`${prefix}: expected an object`)
    return
  }
  if (!Number.isFinite(price.american) || (price.american > -100 && price.american < 100)) {
    errors.push(`${prefix}.american: expected American odds outside (-100,100)`)
  }
  if (!Number.isFinite(price.decimal) || price.decimal <= 1) errors.push(`${prefix}.decimal: expected value above 1`)
  if (!Number.isFinite(price.impliedProbability) || price.impliedProbability <= 0 || price.impliedProbability >= 1) {
    errors.push(`${prefix}.impliedProbability: expected probability in (0,1)`)
  }
}

function validateGameOdds(gameOdds, gameIds, errors) {
  if (gameOdds == null) return 0
  if (!isObject(gameOdds)) {
    errors.push('gameOdds: expected an object')
    return 0
  }
  for (const [gamePk, market] of Object.entries(gameOdds)) {
    const prefix = `gameOdds.${gamePk}`
    if (!Number.isFinite(Number(gamePk)) || (gameIds.size && !gameIds.has(Number(gamePk)))) {
      errors.push(`${prefix}: game is missing from games[]`)
    }
    if (!isObject(market?.books) || !Object.keys(market.books).length) errors.push(`${prefix}.books: expected at least one book`)
    for (const [bookKey, book] of Object.entries(market?.books || {})) {
      if (book.moneyline) {
        validateMarketPrice(`${prefix}.books.${bookKey}.moneyline.away`, book.moneyline.away, errors)
        validateMarketPrice(`${prefix}.books.${bookKey}.moneyline.home`, book.moneyline.home, errors)
      }
      if (book.total) {
        if (!Number.isFinite(book.total.line) || book.total.line <= 0) errors.push(`${prefix}.books.${bookKey}.total.line: expected a positive number`)
        validateMarketPrice(`${prefix}.books.${bookKey}.total.over`, book.total.over, errors)
        validateMarketPrice(`${prefix}.books.${bookKey}.total.under`, book.total.under, errors)
      }
    }
    for (const [marketKey, sides] of [['moneyline', ['away', 'home']], ['total', ['over', 'under']]]) {
      const consensus = market?.consensus?.[marketKey]
      if (!consensus) continue
      if (!Number.isInteger(consensus.books) || consensus.books < 1) errors.push(`${prefix}.consensus.${marketKey}.books: expected a positive integer`)
      if (marketKey === 'total' && (!Number.isFinite(consensus.line) || consensus.line <= 0)) {
        errors.push(`${prefix}.consensus.total.line: expected a positive number`)
      }
      let fairSum = 0
      for (const side of sides) {
        validateMarketPrice(`${prefix}.consensus.${marketKey}.${side}`, consensus[side], errors)
        const fair = consensus[side]?.fairProbability
        if (!Number.isFinite(fair) || fair <= 0 || fair >= 1) errors.push(`${prefix}.consensus.${marketKey}.${side}.fairProbability: expected probability in (0,1)`)
        else fairSum += fair
      }
      if (Math.abs(fairSum - 1) > 0.002) errors.push(`${prefix}.consensus.${marketKey}: fair probabilities must sum to 1`)
    }
  }
  return Object.keys(gameOdds).length
}

function validateProbability(prefix, value, errors) {
  if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`${prefix}: expected probability in [0,1]`)
}

function validateOptionalIso(prefix, value, errors) {
  if (value != null && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) {
    errors.push(`${prefix}: expected null or an ISO timestamp`)
  }
}

function validateTrackedAmerican(prefix, value, errors) {
  if (value != null && (!Number.isFinite(value) || (value > -100 && value < 100))) {
    errors.push(`${prefix}: expected null or valid American odds`)
  }
}

function validateGameMarketSnapshot(prefix, snapshot, errors) {
  if (!isObject(snapshot)) {
    errors.push(`${prefix}: expected an object`)
    return
  }
  validateOptionalIso(`${prefix}.capturedAt`, snapshot.capturedAt, errors)
  if (snapshot.capturedAt == null) errors.push(`${prefix}.capturedAt: required`)
  validateOptionalIso(`${prefix}.sourceUpdatedAt`, snapshot.sourceUpdatedAt, errors)
  if (snapshot.moneyline == null && snapshot.total == null) {
    errors.push(`${prefix}: requires a moneyline or total`)
  }
  if (snapshot.moneyline != null) {
    const moneyline = snapshot.moneyline
    const at = `${prefix}.moneyline`
    if (!isObject(moneyline)) {
      errors.push(`${at}: expected null or an object`)
    } else {
      if (!Number.isInteger(moneyline.books) || moneyline.books < 0) {
        errors.push(`${at}.books: expected a non-negative integer`)
      }
      for (const side of ['away', 'home']) {
        validateTrackedAmerican(`${at}.${side}American`, moneyline[`${side}American`], errors)
        validateOptionalMetric(`${at}.${side}FairProbability`, moneyline[`${side}FairProbability`], errors, {
          min: 0,
          max: 1,
        })
      }
      if (
        Number.isFinite(moneyline.awayFairProbability)
        && Number.isFinite(moneyline.homeFairProbability)
        && Math.abs(moneyline.awayFairProbability + moneyline.homeFairProbability - 1) > 0.002
      ) errors.push(`${at}: fair probabilities must sum to 1`)
    }
  }
  if (snapshot.total != null) {
    const total = snapshot.total
    const at = `${prefix}.total`
    if (!isObject(total)) {
      errors.push(`${at}: expected null or an object`)
    } else {
      if (!Number.isInteger(total.books) || total.books < 0) {
        errors.push(`${at}.books: expected a non-negative integer`)
      }
      validateOptionalMetric(`${at}.line`, total.line, errors, { min: 0.5, max: 30 })
      for (const side of ['over', 'under']) {
        validateTrackedAmerican(`${at}.${side}American`, total[`${side}American`], errors)
        validateOptionalMetric(`${at}.${side}FairProbability`, total[`${side}FairProbability`], errors, {
          min: 0,
          max: 1,
        })
      }
      if (
        Number.isFinite(total.overFairProbability)
        && Number.isFinite(total.underFairProbability)
        && Math.abs(total.overFairProbability + total.underFairProbability - 1) > 0.002
      ) errors.push(`${at}: fair probabilities must sum to 1`)
    }
  }
}

function validateGameMarketTrackingEntry(prefix, entry, errors) {
  if (!isObject(entry)) {
    errors.push(`${prefix}: expected an object`)
    return
  }
  if (!Number.isFinite(entry.gamePk)) errors.push(`${prefix}.gamePk: expected a finite game ID`)
  if (!entry.gameDate || Number.isNaN(Date.parse(entry.gameDate))) {
    errors.push(`${prefix}.gameDate: expected an ISO timestamp`)
  }
  for (const field of ['awayTeamId', 'homeTeamId']) {
    if (entry[field] != null && !Number.isFinite(entry[field])) {
      errors.push(`${prefix}.${field}: expected null or a finite team ID`)
    }
  }
  if (!Number.isInteger(entry.gameNumber) || entry.gameNumber < 1) {
    errors.push(`${prefix}.gameNumber: expected a positive integer`)
  }
  if (!['pregame', 'frozen'].includes(entry.status)) errors.push(`${prefix}.status: unsupported`)
  validateGameMarketSnapshot(`${prefix}.opening`, entry.opening, errors)
  validateGameMarketSnapshot(`${prefix}.current`, entry.current, errors)
  if (entry.closing != null) validateGameMarketSnapshot(`${prefix}.closing`, entry.closing, errors)
  if (entry.status === 'pregame' && entry.closing != null) {
    errors.push(`${prefix}.closing: must be null while pregame`)
  }
  if (entry.status === 'frozen' && entry.closing == null) {
    errors.push(`${prefix}.closing: required when frozen`)
  }
  for (const field of ['firstCapturedAt', 'lastObservedAt', 'lastChangedAt', 'closedAt']) {
    validateOptionalIso(`${prefix}.${field}`, entry[field], errors)
  }
  for (const field of ['firstCapturedAt', 'lastObservedAt', 'lastChangedAt']) {
    if (entry[field] == null) errors.push(`${prefix}.${field}: required`)
  }
  if (entry.status === 'frozen' && entry.closedAt == null) errors.push(`${prefix}.closedAt: required when frozen`)
  if (entry.status === 'pregame' && entry.closedAt != null) errors.push(`${prefix}.closedAt: must be null while pregame`)
  for (const field of ['observationCount', 'revisionCount']) {
    if (!Number.isInteger(entry[field]) || entry[field] < 1) {
      errors.push(`${prefix}.${field}: expected a positive integer`)
    }
  }
  if (
    Number.isInteger(entry.observationCount)
    && Number.isInteger(entry.revisionCount)
    && entry.revisionCount > entry.observationCount
  ) errors.push(`${prefix}.revisionCount: cannot exceed observationCount`)
  const movement = entry.movement
  if (!isObject(movement)) {
    errors.push(`${prefix}.movement: expected an object`)
  } else {
    for (const field of ['moneylineHomeProbability', 'moneylineHomePrice', 'totalLine', 'overPrice']) {
      validateOptionalMetric(`${prefix}.movement.${field}`, movement[field], errors, { min: -10000, max: 10000 })
    }
    if (typeof movement.material !== 'boolean') errors.push(`${prefix}.movement.material: expected boolean`)
    if (!Array.isArray(movement.changed) || movement.changed.some((value) => typeof value !== 'string')) {
      errors.push(`${prefix}.movement.changed: expected an array of strings`)
    } else if (movement.material !== (movement.changed.length > 0)) {
      errors.push(`${prefix}.movement.material: must match changed[]`)
    }
  }
}

function validateGameMarketDecision(prefix, decision, projection, errors) {
  if (!isObject(decision)) {
    errors.push(`${prefix}: expected an object for model v8`)
    return
  }
  if (decision.version !== 1) errors.push(`${prefix}.version: expected 1`)
  if (decision.advisoryOnly !== true) errors.push(`${prefix}.advisoryOnly: must be true`)
  if (!['collecting', 'ready'].includes(decision.status)) errors.push(`${prefix}.status: unsupported`)
  const policy = decision.policy
  if (!isObject(policy)) {
    errors.push(`${prefix}.policy: expected an object`)
  } else {
    if (policy.version !== 1) errors.push(`${prefix}.policy.version: expected 1`)
    if (policy.status !== decision.status) errors.push(`${prefix}.policy.status: must match decision status`)
    for (const market of ['moneyline', 'total']) {
      const value = policy[market]
      const at = `${prefix}.policy.${market}`
      if (!isObject(value)) {
        errors.push(`${at}: expected an object`)
        continue
      }
      if (typeof value.ready !== 'boolean') errors.push(`${at}.ready: expected boolean`)
      for (const field of ['sample', 'dates', 'minimumGames', 'minimumDates']) {
        const minimum = field.startsWith('minimum')
        if (!Number.isInteger(value[field]) || value[field] < (minimum ? 1 : 0)) {
          errors.push(`${at}.${field}: expected a ${minimum ? 'positive' : 'non-negative'} integer`)
        }
      }
      if (
        typeof value.ready === 'boolean'
        && Number.isInteger(value.sample)
        && Number.isInteger(value.dates)
        && Number.isInteger(value.minimumGames)
        && Number.isInteger(value.minimumDates)
        && value.ready !== (value.sample >= value.minimumGames && value.dates >= value.minimumDates)
      ) errors.push(`${at}.ready: inconsistent with sample gates`)
    }
  }

  const tiers = ['play', 'lean', 'pass', 'unavailable']
  for (const market of ['moneyline', 'total']) {
    const value = decision[market]
    const at = `${prefix}.${market}`
    if (!isObject(value)) {
      errors.push(`${at}: expected an object`)
      continue
    }
    if (value.market !== market) errors.push(`${at}.market: expected ${market}`)
    if (!tiers.includes(value.rawTier)) errors.push(`${at}.rawTier: unsupported`)
    if (!tiers.includes(value.tier)) errors.push(`${at}.tier: unsupported`)
    if (typeof value.provisional !== 'boolean') errors.push(`${at}.provisional: expected boolean`)
    if (value.tier === 'play' && value.provisional !== false) errors.push(`${at}.tier: PLAY cannot be provisional`)
    if (value.rawTier === 'play' && value.provisional === true && value.tier !== 'lean') {
      errors.push(`${at}.tier: provisional PLAY must be capped to LEAN`)
    }
    if (typeof value.reason !== 'string' || !value.reason.trim()) errors.push(`${at}.reason: expected non-empty text`)
    if (!Number.isInteger(value.books) || value.books < 0) errors.push(`${at}.books: expected a non-negative integer`)
    validateOptionalMetric(`${at}.coverage`, value.coverage, errors, { min: 0, max: 1 })
    validateOptionalMetric(`${at}.modelEdge`, value.modelEdge, errors, { min: -1, max: 1 })
    validateOptionalMetric(`${at}.expectedRoi`, value.expectedRoi, errors, { min: -1, max: 20 })
    if (value.american != null && (!Number.isFinite(value.american) || (value.american > -100 && value.american < 100))) {
      errors.push(`${at}.american: expected null or valid American odds`)
    }
    if (!isObject(value.gates)) {
      errors.push(`${at}.gates: expected an object`)
    } else {
      const names = market === 'moneyline'
        ? ['edge', 'roi', 'coverage', 'marketQuality']
        : ['edge', 'roi', 'coverage', 'marketQuality', 'separation']
      for (const name of names) {
        if (typeof value.gates[name] !== 'boolean') errors.push(`${at}.gates.${name}: expected boolean`)
      }
    }
  }

  const moneyline = decision.moneyline
  if (isObject(moneyline)) {
    if (!['away', 'home'].includes(moneyline.forecastSide)) errors.push(`${prefix}.moneyline.forecastSide: unsupported`)
    if (moneyline.selectedSide != null && !['away', 'home'].includes(moneyline.selectedSide)) {
      errors.push(`${prefix}.moneyline.selectedSide: unsupported`)
    }
    validateOptionalMetric(`${prefix}.moneyline.forecastProbability`, moneyline.forecastProbability, errors, { min: 0, max: 1 })
    validateOptionalMetric(`${prefix}.moneyline.modelProbability`, moneyline.modelProbability, errors, { min: 0, max: 1 })
    validateOptionalMetric(`${prefix}.moneyline.marketFairProbability`, moneyline.marketFairProbability, errors, { min: 0, max: 1 })
    const expectedForecast = moneyline.forecastSide === 'home'
      ? projection.homeWinProbability
      : projection.awayWinProbability
    if (
      Number.isFinite(expectedForecast)
      && Number.isFinite(moneyline.forecastProbability)
      && Math.abs(expectedForecast - moneyline.forecastProbability) > 0.001
    ) errors.push(`${prefix}.moneyline.forecastProbability: must match forecast side probability`)
  }

  const total = decision.total
  if (isObject(total)) {
    if (total.selectedSide != null && !['over', 'under'].includes(total.selectedSide)) {
      errors.push(`${prefix}.total.selectedSide: unsupported`)
    }
    for (const field of [
      'modelWinProbability',
      'modelLoseProbability',
      'modelPushProbability',
      'conditionalModelProbability',
      'marketFairProbability',
    ]) validateOptionalMetric(`${prefix}.total.${field}`, total[field], errors, { min: 0, max: 1 })
    for (const field of ['line', 'projectedTotal']) {
      validateOptionalMetric(`${prefix}.total.${field}`, total[field], errors, { min: 0, max: 30 })
    }
    for (const field of ['projectionDelta', 'runSeparation']) {
      validateOptionalMetric(`${prefix}.total.${field}`, total[field], errors, { min: -30, max: 30 })
    }
    if (
      Number.isFinite(total.projectedTotal)
      && Number.isFinite(projection.projectedTotal)
      && Math.abs(total.projectedTotal - projection.projectedTotal) > 0.03
    ) errors.push(`${prefix}.total.projectedTotal: must match projection`)
    if (
      Number.isFinite(total.modelWinProbability)
      && Number.isFinite(total.modelLoseProbability)
      && Number.isFinite(total.modelPushProbability)
      && Math.abs(total.modelWinProbability + total.modelLoseProbability + total.modelPushProbability - 1) > 0.002
    ) errors.push(`${prefix}.total: win, lose, and push probabilities must sum to 1`)
  }
}

function validateGameProjectionRecord(prefix, projection, errors, gameIds = null) {
  if (!isObject(projection)) {
    errors.push(`${prefix}: expected an object`)
    return
  }
  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(projection.modelVersion)) errors.push(`${prefix}.modelVersion: expected 1 through 8`)
  if (projection.advisoryOnly !== true) errors.push(`${prefix}.advisoryOnly: must be true`)
  if (projection.captureState !== 'pregame') errors.push(`${prefix}.captureState: expected pregame`)
  if (!Number.isFinite(projection.gamePk)) errors.push(`${prefix}.gamePk: must be finite`)
  else if (gameIds?.size && !gameIds.has(projection.gamePk)) errors.push(`${prefix}.gamePk: game is missing from games[]`)
  for (const field of ['capturedAt', 'gameDate']) {
    if (!projection[field] || Number.isNaN(Date.parse(projection[field]))) errors.push(`${prefix}.${field}: expected an ISO timestamp`)
  }
  for (const field of ['awayExpectedRuns', 'homeExpectedRuns', 'projectedTotal']) {
    if (!Number.isFinite(projection[field]) || projection[field] < 0 || projection[field] > 20) {
      errors.push(`${prefix}.${field}: expected finite runs in [0,20]`)
    }
  }
  if (
    Number.isFinite(projection.awayExpectedRuns)
    && Number.isFinite(projection.homeExpectedRuns)
    && Number.isFinite(projection.projectedTotal)
    && Math.abs(projection.awayExpectedRuns + projection.homeExpectedRuns - projection.projectedTotal) > 0.03
  ) {
    errors.push(`${prefix}.projectedTotal: must equal away plus home expected runs`)
  }
  validateProbability(`${prefix}.awayWinProbability`, projection.awayWinProbability, errors)
  validateProbability(`${prefix}.homeWinProbability`, projection.homeWinProbability, errors)
  validateProbability(`${prefix}.tieAfterNineProbability`, projection.tieAfterNineProbability, errors)
  validateProbability(`${prefix}.projectedWinnerProbability`, projection.projectedWinnerProbability, errors)
  if (
    Number.isFinite(projection.awayWinProbability)
    && Number.isFinite(projection.homeWinProbability)
    && Math.abs(projection.awayWinProbability + projection.homeWinProbability - 1) > 0.002
  ) {
    errors.push(`${prefix}: win probabilities must sum to 1`)
  }
  if (!['away', 'home'].includes(projection.projectedWinner)) errors.push(`${prefix}.projectedWinner: expected away or home`)
  if (!['limited', 'medium'].includes(projection.confidence?.status)) errors.push(`${prefix}.confidence.status: unsupported`)
  validateProbability(`${prefix}.confidence.coverage`, projection.confidence?.coverage, errors)
  if (!isObject(projection.inputs?.away) || !isObject(projection.inputs?.home)) errors.push(`${prefix}.inputs: expected away and home factor breakdowns`)
  if (projection.modelVersion >= 2) {
    for (const side of ['away', 'home']) {
      const input = projection.inputs?.[side]
      const at = `${prefix}.inputs.${side}`
      if (!isObject(input)) continue
      if (!Number.isFinite(input.baseRunsPerTeam)) errors.push(`${at}.baseRunsPerTeam: required for model v2`)
      else validateOptionalMetric(`${at}.baseRunsPerTeam`, input.baseRunsPerTeam, errors, { min: 3.8, max: 5 })
      if (!Number.isFinite(input.teamScoringFactor)) errors.push(`${at}.teamScoringFactor: required for model v2`)
      else validateOptionalMetric(`${at}.teamScoringFactor`, input.teamScoringFactor, errors, { min: 0.92, max: 1.08 })
      const scoring = input.teamScoring
      if (!isObject(scoring)) {
        errors.push(`${at}.teamScoring: expected an object for model v2`)
        continue
      }
      validateOptionalMetric(`${at}.teamScoring.factor`, scoring.factor, errors, { min: 0.92, max: 1.08 })
      validateProbability(`${at}.teamScoring.coverage`, scoring.coverage, errors)
      if (
        Number.isFinite(input.teamScoringFactor)
        && Number.isFinite(scoring.factor)
        && Math.abs(input.teamScoringFactor - scoring.factor) > 0.001
      ) errors.push(`${at}.teamScoringFactor: must match teamScoring.factor`)
      if (scoring.cutoffDate != null && !isValidDate(scoring.cutoffDate)) {
        errors.push(`${at}.teamScoring.cutoffDate: expected null or YYYY-MM-DD`)
      }
      validateOptionalMetric(`${at}.teamScoring.leagueRunsPerTeam`, scoring.leagueRunsPerTeam, errors, { min: 0, max: 20 })
      for (const field of ['teamGames', 'opponentGames']) {
        if (!Number.isInteger(scoring[field]) || scoring[field] < 0) {
          errors.push(`${at}.teamScoring.${field}: expected a non-negative integer`)
        }
      }
      for (const field of [
        'teamRunsPerGame',
        'teamRecent14RunsPerGame',
        'opponentRunsAllowedPerGame',
        'opponentRecent14RunsAllowedPerGame',
      ]) {
        validateOptionalMetric(`${at}.teamScoring.${field}`, scoring[field], errors, { min: 0, max: 20 })
      }
    }
  }
  if (projection.modelVersion >= 3) {
    for (const side of ['away', 'home']) {
      const input = projection.inputs?.[side]
      const at = `${prefix}.inputs.${side}`
      if (!isObject(input)) continue
      for (const [field, min, max] of [
        ['starterFactor', 0.72, 1.35],
        ['bullpenFactor', 0.78, 1.28],
        ['bullpenAvailabilityFactor', 1, 1.07],
        ['pitchingFactor', 0.82, 1.24],
        ['expectedStarterIP', 1, 8],
        ['starterWorkloadCoverage', 0, 1],
        ['starterShare', 0.12, 0.89],
        ['bullpenShare', 0.11, 0.88],
      ]) {
        if (!Number.isFinite(input[field])) errors.push(`${at}.${field}: required for model v3`)
        else validateOptionalMetric(`${at}.${field}`, input[field], errors, { min, max })
      }
      if (!['opener', 'recent-starts', 'season-starts', 'league-average'].includes(input.starterWorkloadSource)) {
        errors.push(`${at}.starterWorkloadSource: unsupported`)
      }
      if (
        Number.isFinite(input.starterShare)
        && Number.isFinite(input.bullpenShare)
        && Math.abs(input.starterShare + input.bullpenShare - 1) > 0.001
      ) errors.push(`${at}: starterShare and bullpenShare must sum to 1`)
      validateOptionalMetric(
        `${at}.bullpenEstimatedRunsAllowed9`,
        input.bullpenEstimatedRunsAllowed9,
        errors,
        { min: 0, max: 20 },
      )
      for (const field of ['bullpenUnavailable', 'bullpenTaxed']) {
        if (!Number.isInteger(input[field]) || input[field] < 0) {
          errors.push(`${at}.${field}: expected a non-negative integer`)
        }
      }
      const bullpen = input.bullpenContext
      if (!isObject(bullpen)) {
        errors.push(`${at}.bullpenContext: expected an object for model v3`)
        continue
      }
      validateOptionalMetric(`${at}.bullpenContext.qualityFactor`, bullpen.qualityFactor, errors, { min: 0.78, max: 1.28 })
      validateOptionalMetric(`${at}.bullpenContext.availabilityFactor`, bullpen.availabilityFactor, errors, { min: 1, max: 1.07 })
      validateProbability(`${at}.bullpenContext.unavailableShare`, bullpen.unavailableShare, errors)
      validateProbability(`${at}.bullpenContext.taxedShare`, bullpen.taxedShare, errors)
      validateProbability(`${at}.bullpenContext.coverage`, bullpen.coverage, errors)
      if (!Array.isArray(bullpen.unavailableNames) || bullpen.unavailableNames.some((name) => typeof name !== 'string')) {
        errors.push(`${at}.bullpenContext.unavailableNames: expected an array of strings`)
      }
      if (
        Number.isFinite(input.bullpenFactor)
        && Number.isFinite(bullpen.qualityFactor)
        && Math.abs(input.bullpenFactor - bullpen.qualityFactor) > 0.001
      ) errors.push(`${at}.bullpenFactor: must match bullpenContext.qualityFactor`)
      if (
        Number.isFinite(input.bullpenAvailabilityFactor)
        && Number.isFinite(bullpen.availabilityFactor)
        && Math.abs(input.bullpenAvailabilityFactor - bullpen.availabilityFactor) > 0.001
      ) errors.push(`${at}.bullpenAvailabilityFactor: must match bullpenContext.availabilityFactor`)
    }
  }
  if (projection.modelVersion >= 4) {
    for (const side of ['away', 'home']) {
      const input = projection.inputs?.[side]
      const at = `${prefix}.inputs.${side}`
      if (!isObject(input)) continue
      for (const [field, min, max] of [
        ['overallOffenseFactor', 0.84, 1.18],
        ['platoonFactor', 0.84, 1.18],
        ['platoonCoverage', 0, 1],
        ['runEnvironmentFactor', 0.86, 1.17],
        ['runEnvironmentCoverage', 0, 1],
      ]) {
        if (!Number.isFinite(input[field])) errors.push(`${at}.${field}: required for model v4`)
        else validateOptionalMetric(`${at}.${field}`, input[field], errors, { min, max })
      }
      if (input.opposingPitcherHand != null && !['L', 'R'].includes(input.opposingPitcherHand)) {
        errors.push(`${at}.opposingPitcherHand: expected null, L, or R`)
      }
      validateOptionalMetric(`${at}.lineupVsHandObp`, input.lineupVsHandObp, errors, { min: 0, max: 1 })
      validateOptionalMetric(`${at}.lineupVsHandSlg`, input.lineupVsHandSlg, errors, { min: 0, max: 1.5 })
      validateOptionalMetric(`${at}.parkRunFactor`, input.parkRunFactor, errors, { min: 0.8, max: 1.3 })
      validateOptionalMetric(`${at}.weatherRunFactor`, input.weatherRunFactor, errors, { min: 0.9, max: 1.1 })
      if (input.environmentSource !== 'run-specific') {
        errors.push(`${at}.environmentSource: expected run-specific for model v4`)
      }
      const environment = input.runEnvironment
      if (!isObject(environment)) {
        errors.push(`${at}.runEnvironment: expected an object for model v4`)
        continue
      }
      for (const [field, min, max] of [
        ['factor', 0.86, 1.17],
        ['rawParkFactor', 0.8, 1.3],
        ['appliedParkFactor', 0.88, 1.18],
        ['weatherFactor', 0.9, 1.1],
        ['tempFactor', 0.96, 1.04],
        ['windFactor', 0.96, 1.04],
        ['coverage', 0, 1],
      ]) {
        if (!Number.isFinite(environment[field])) errors.push(`${at}.runEnvironment.${field}: required for model v4`)
        else validateOptionalMetric(`${at}.runEnvironment.${field}`, environment[field], errors, { min, max })
      }
      validateOptionalMetric(`${at}.runEnvironment.windComponent`, environment.windComponent, errors, { min: -1, max: 1 })
      if (!['indoor', 'outdoor', 'roof-pending', 'missing'].includes(environment.weatherStatus)) {
        errors.push(`${at}.runEnvironment.weatherStatus: unsupported`)
      }
      for (const field of ['roofClosed', 'roofPending']) {
        if (typeof environment[field] !== 'boolean') errors.push(`${at}.runEnvironment.${field}: expected boolean`)
      }
      if (
        Number.isFinite(input.runEnvironmentFactor)
        && Number.isFinite(environment.factor)
        && Math.abs(input.runEnvironmentFactor - environment.factor) > 0.001
      ) errors.push(`${at}.runEnvironmentFactor: must match runEnvironment.factor`)
      if (
        Number.isFinite(input.parkRunFactor)
        && Number.isFinite(environment.rawParkFactor)
        && Math.abs(input.parkRunFactor - environment.rawParkFactor) > 0.001
      ) errors.push(`${at}.parkRunFactor: must match runEnvironment.rawParkFactor`)
      if (
        Number.isFinite(input.weatherRunFactor)
        && Number.isFinite(environment.weatherFactor)
        && Math.abs(input.weatherRunFactor - environment.weatherFactor) > 0.001
      ) errors.push(`${at}.weatherRunFactor: must match runEnvironment.weatherFactor`)
    }
  }
  if (projection.modelVersion >= 5) {
    for (const side of ['away', 'home']) {
      const input = projection.inputs?.[side]
      const at = `${prefix}.inputs.${side}`
      if (!isObject(input)) continue
      for (const [field, min, max] of [
        ['teamContextFactor', 0.92, 1.08],
        ['opponentDefenseFactor', 0.96, 1.04],
        ['baserunningFactor', 0.973, 1.027],
        ['scheduleFactor', 0.96, 1.01],
        ['teamRunContextCoverage', 0, 1],
      ]) {
        if (!Number.isFinite(input[field])) errors.push(`${at}.${field}: required for model v5`)
        else validateOptionalMetric(`${at}.${field}`, input[field], errors, { min, max })
      }
      const context = input.teamRunContext
      if (!isObject(context)) {
        errors.push(`${at}.teamRunContext: expected an object for model v5`)
        continue
      }
      validateOptionalMetric(`${at}.teamRunContext.factor`, context.factor, errors, { min: 0.92, max: 1.08 })
      validateProbability(`${at}.teamRunContext.coverage`, context.coverage, errors)
      if (
        Number.isFinite(input.teamContextFactor)
        && Number.isFinite(context.factor)
        && Math.abs(input.teamContextFactor - context.factor) > 0.001
      ) errors.push(`${at}.teamContextFactor: must match teamRunContext.factor`)
      if (
        Number.isFinite(input.teamRunContextCoverage)
        && Number.isFinite(context.coverage)
        && Math.abs(input.teamRunContextCoverage - context.coverage) > 0.001
      ) errors.push(`${at}.teamRunContextCoverage: must match teamRunContext.coverage`)

      const defense = context.defense
      if (defense != null) {
        if (!isObject(defense)) errors.push(`${at}.teamRunContext.defense: expected null or object`)
        else {
          validateOptionalMetric(`${at}.teamRunContext.defense.factor`, defense.factor, errors, { min: 0.96, max: 1.04 })
          validateProbability(`${at}.teamRunContext.defense.coverage`, defense.coverage, errors)
          validateOptionalMetric(`${at}.teamRunContext.defense.defenseRunsAdjustment`, defense.defenseRunsAdjustment, errors, { min: -0.18, max: 0.18 })
          if (!Number.isFinite(defense.teamId)) errors.push(`${at}.teamRunContext.defense.teamId: expected finite team ID`)
          if (!Number.isInteger(defense.games) || defense.games < 20) errors.push(`${at}.teamRunContext.defense.games: expected 20+`)
          if (
            Number.isFinite(input.opponentDefenseFactor)
            && Number.isFinite(defense.factor)
            && Math.abs(input.opponentDefenseFactor - defense.factor) > 0.001
          ) errors.push(`${at}.opponentDefenseFactor: must match teamRunContext.defense.factor`)
        }
      } else if (input.opponentDefenseFactor !== 1) {
        errors.push(`${at}.opponentDefenseFactor: must be neutral without defense context`)
      }

      const baserunning = context.baserunning
      if (baserunning != null) {
        if (!isObject(baserunning)) errors.push(`${at}.teamRunContext.baserunning: expected null or object`)
        else {
          validateOptionalMetric(`${at}.teamRunContext.baserunning.factor`, baserunning.factor, errors, { min: 0.973, max: 1.027 })
          validateProbability(`${at}.teamRunContext.baserunning.coverage`, baserunning.coverage, errors)
          validateOptionalMetric(`${at}.teamRunContext.baserunning.baserunningRunsAdjustment`, baserunning.baserunningRunsAdjustment, errors, { min: -0.12, max: 0.12 })
          if (!Number.isFinite(baserunning.teamId)) errors.push(`${at}.teamRunContext.baserunning.teamId: expected finite team ID`)
          if (!Number.isInteger(baserunning.games) || baserunning.games < 20) errors.push(`${at}.teamRunContext.baserunning.games: expected 20+`)
          if (
            Number.isFinite(input.baserunningFactor)
            && Number.isFinite(baserunning.factor)
            && Math.abs(input.baserunningFactor - baserunning.factor) > 0.001
          ) errors.push(`${at}.baserunningFactor: must match teamRunContext.baserunning.factor`)
        }
      } else if (input.baserunningFactor !== 1) {
        errors.push(`${at}.baserunningFactor: must be neutral without baserunning context`)
      }

      const schedule = context.schedule
      if (!isObject(schedule)) {
        errors.push(`${at}.teamRunContext.schedule: expected an object for model v5`)
      } else {
        validateOptionalMetric(`${at}.teamRunContext.schedule.factor`, schedule.factor, errors, { min: 0.96, max: 1.01 })
        validateProbability(`${at}.teamRunContext.schedule.coverage`, schedule.coverage, errors)
        if (!isValidDate(schedule.targetDate)) errors.push(`${at}.teamRunContext.schedule.targetDate: expected YYYY-MM-DD`)
        if (schedule.lastGameDate != null && !isValidDate(schedule.lastGameDate)) {
          errors.push(`${at}.teamRunContext.schedule.lastGameDate: expected null or YYYY-MM-DD`)
        }
        for (const field of ['previousDayGames', 'consecutiveDays', 'historyGames']) {
          if (!Number.isInteger(schedule[field]) || schedule[field] < 0) {
            errors.push(`${at}.teamRunContext.schedule.${field}: expected a non-negative integer`)
          }
        }
        if (schedule.daysRest != null && (!Number.isInteger(schedule.daysRest) || schedule.daysRest < 0)) {
          errors.push(`${at}.teamRunContext.schedule.daysRest: expected null or non-negative integer`)
        }
        for (const field of ['sameSeries', 'travelSpot', 'secondDoubleheaderGame']) {
          if (typeof schedule[field] !== 'boolean') errors.push(`${at}.teamRunContext.schedule.${field}: expected boolean`)
        }
        if (
          Number.isFinite(input.scheduleFactor)
          && Number.isFinite(schedule.factor)
          && Math.abs(input.scheduleFactor - schedule.factor) > 0.001
        ) errors.push(`${at}.scheduleFactor: must match teamRunContext.schedule.factor`)
      }
    }
  }
  if (projection.modelVersion >= 6) {
    const distribution = projection.scoreDistribution
    const at = `${prefix}.scoreDistribution`
    if (!isObject(distribution)) {
      errors.push(`${at}: expected an object for model v6`)
    } else {
      if (distribution.family !== 'negative-binomial') errors.push(`${at}.family: expected negative-binomial`)
      if (distribution.parameterization !== 'NB2') errors.push(`${at}.parameterization: expected NB2`)
      validateOptionalMetric(`${at}.dispersion`, distribution.dispersion, errors, { min: 0.5, max: 20 })
      validateProbability(`${at}.intervalLevel`, distribution.intervalLevel, errors)
      if (Number.isFinite(distribution.intervalLevel) && Math.abs(distribution.intervalLevel - 0.8) > 0.001) {
        errors.push(`${at}.intervalLevel: expected the calibrated 0.8 interval`)
      }

      for (const [side, expectedMean, maxRuns] of [
        ['away', projection.awayExpectedRuns, 30],
        ['home', projection.homeExpectedRuns, 30],
        ['total', projection.projectedTotal, 60],
      ]) {
        const summary = distribution[side]
        const summaryAt = `${at}.${side}`
        if (!isObject(summary)) {
          errors.push(`${summaryAt}: expected an object`)
          continue
        }
        for (const field of ['low', 'high', 'mode']) {
          if (!Number.isInteger(summary[field]) || summary[field] < 0 || summary[field] > maxRuns) {
            errors.push(`${summaryAt}.${field}: expected an integer in [0,${maxRuns}]`)
          }
        }
        if (
          Number.isInteger(summary.low)
          && Number.isInteger(summary.high)
          && summary.low > summary.high
        ) errors.push(`${summaryAt}: low cannot exceed high`)
        validateOptionalMetric(`${summaryAt}.mean`, summary.mean, errors, { min: 0, max: 20 })
        validateOptionalMetric(`${summaryAt}.variance`, summary.variance, errors, { min: 0, max: 100 })
        validateProbability(`${summaryAt}.coverage`, summary.coverage, errors)
        if (
          Number.isFinite(summary.mean)
          && Number.isFinite(expectedMean)
          && Math.abs(summary.mean - expectedMean) > 0.03
        ) errors.push(`${summaryAt}.mean: must match its expected runs`)
        if (
          Number.isFinite(summary.mean)
          && summary.mean > 0
          && Number.isFinite(summary.variance)
          && summary.variance <= summary.mean
        ) errors.push(`${summaryAt}.variance: must be overdispersed above its mean`)
        if (
          Number.isFinite(summary.coverage)
          && Number.isFinite(distribution.intervalLevel)
          && summary.coverage + 0.001 < distribution.intervalLevel
        ) errors.push(`${summaryAt}.coverage: cannot be below intervalLevel`)
      }

      const mode = distribution.mostLikelyScore
      if (!isObject(mode)) {
        errors.push(`${at}.mostLikelyScore: expected an object`)
      } else {
        for (const side of ['away', 'home']) {
          if (!Number.isInteger(mode[side]) || mode[side] < 0 || mode[side] > 30) {
            errors.push(`${at}.mostLikelyScore.${side}: expected an integer in [0,30]`)
          }
          if (
            Number.isInteger(mode[side])
            && Number.isInteger(distribution[side]?.mode)
            && mode[side] !== distribution[side].mode
          ) errors.push(`${at}.mostLikelyScore.${side}: must match ${side}.mode`)
          if (
            Number.isInteger(mode[side])
            && Number.isInteger(projection.estimatedScore?.[side])
            && mode[side] !== projection.estimatedScore[side]
          ) errors.push(`${prefix}.estimatedScore.${side}: must match scoreDistribution.mostLikelyScore`)
        }
        validateProbability(`${at}.mostLikelyScore.probability`, mode.probability, errors)
      }
    }
  }
  if (projection.modelVersion >= 7) {
    const blend = projection.marketBlend
    const at = `${prefix}.marketBlend`
    if (!isObject(blend)) {
      errors.push(`${at}: expected an object for model v7`)
    } else {
      if (blend.version !== 1) errors.push(`${at}.version: expected 1`)
      if (blend.evidenceGated !== true) errors.push(`${at}.evidenceGated: must be true`)
      if (!['collecting', 'inactive', 'active'].includes(blend.policyStatus)) {
        errors.push(`${at}.policyStatus: unsupported`)
      }
      if (typeof blend.applied !== 'boolean') errors.push(`${at}.applied: expected boolean`)
      for (const section of ['side', 'total']) {
        const value = blend[section]
        const sectionAt = `${at}.${section}`
        if (!isObject(value)) {
          errors.push(`${sectionAt}: expected an object`)
          continue
        }
        for (const field of ['eligible', 'applied']) {
          if (typeof value[field] !== 'boolean') errors.push(`${sectionAt}.${field}: expected boolean`)
        }
        if (value.applied === true && value.eligible !== true) errors.push(`${sectionAt}: applied requires eligible`)
        if (!Number.isFinite(value.weight)) errors.push(`${sectionAt}.weight: required for model v7`)
        else validateOptionalMetric(`${sectionAt}.weight`, value.weight, errors, { min: 0, max: 0.2 })
        if (value.eligible === false && value.weight !== 0) errors.push(`${sectionAt}.weight: must be zero when ineligible`)
        for (const field of ['sample', 'dates', 'minimumGames', 'minimumDates']) {
          if (!Number.isInteger(value[field]) || value[field] < (field.startsWith('minimum') ? 1 : 0)) {
            errors.push(`${sectionAt}.${field}: expected a ${field.startsWith('minimum') ? 'positive' : 'non-negative'} integer`)
          }
        }
        if (typeof value.reason !== 'string' || !value.reason.trim()) {
          errors.push(`${sectionAt}.reason: expected non-empty text`)
        }
      }

      const side = blend.side
      if (isObject(side)) {
        for (const field of ['baseHomeWinProbability', 'preBlendHomeWinProbability', 'finalHomeWinProbability']) {
          if (!Number.isFinite(side[field])) errors.push(`${at}.side.${field}: required for model v7`)
          else validateOptionalMetric(`${at}.side.${field}`, side[field], errors, { min: 0, max: 1 })
        }
        validateOptionalMetric(`${at}.side.marketHomeWinProbability`, side.marketHomeWinProbability, errors, { min: 0, max: 1 })
        validateOptionalMetric(`${at}.side.marketAdvantageBrier`, side.marketAdvantageBrier, errors, { min: -1, max: 1 })
        if (!Number.isFinite(side.minimumAdvantageBrier)) errors.push(`${at}.side.minimumAdvantageBrier: required for model v7`)
        else validateOptionalMetric(`${at}.side.minimumAdvantageBrier`, side.minimumAdvantageBrier, errors, { min: 0, max: 1 })
        if (side.applied === true && !Number.isFinite(side.marketHomeWinProbability)) {
          errors.push(`${at}.side.marketHomeWinProbability: required when applied`)
        }
        if (
          Number.isFinite(side.finalHomeWinProbability)
          && Number.isFinite(projection.homeWinProbability)
          && Math.abs(side.finalHomeWinProbability - projection.homeWinProbability) > 0.001
        ) errors.push(`${at}.side.finalHomeWinProbability: must match homeWinProbability`)
        const expectedHome = side.applied
          ? side.preBlendHomeWinProbability * (1 - side.weight) + side.marketHomeWinProbability * side.weight
          : side.preBlendHomeWinProbability
        if (
          Number.isFinite(expectedHome)
          && Number.isFinite(side.finalHomeWinProbability)
          && Math.abs(expectedHome - side.finalHomeWinProbability) > 0.002
        ) errors.push(`${at}.side.finalHomeWinProbability: inconsistent blend arithmetic`)
      }

      const total = blend.total
      if (isObject(total)) {
        for (const field of [
          'baseAwayExpectedRuns',
          'baseHomeExpectedRuns',
          'baseProjectedTotal',
          'finalAwayExpectedRuns',
          'finalHomeExpectedRuns',
          'finalProjectedTotal',
        ]) {
          if (!Number.isFinite(total[field])) errors.push(`${at}.total.${field}: required for model v7`)
          else validateOptionalMetric(`${at}.total.${field}`, total[field], errors, { min: 0, max: 30 })
        }
        validateOptionalMetric(`${at}.total.marketTotal`, total.marketTotal, errors, { min: 0, max: 30 })
        validateOptionalMetric(`${at}.total.marketAdvantageMae`, total.marketAdvantageMae, errors, { min: -30, max: 30 })
        if (!Number.isFinite(total.minimumAdvantageMae)) errors.push(`${at}.total.minimumAdvantageMae: required for model v7`)
        else validateOptionalMetric(`${at}.total.minimumAdvantageMae`, total.minimumAdvantageMae, errors, { min: 0, max: 30 })
        if (total.applied === true && !Number.isFinite(total.marketTotal)) {
          errors.push(`${at}.total.marketTotal: required when applied`)
        }
        if (
          Number.isFinite(total.finalProjectedTotal)
          && Number.isFinite(projection.projectedTotal)
          && Math.abs(total.finalProjectedTotal - projection.projectedTotal) > 0.03
        ) errors.push(`${at}.total.finalProjectedTotal: must match projectedTotal`)
        for (const [field, projectionField] of [
          ['finalAwayExpectedRuns', 'awayExpectedRuns'],
          ['finalHomeExpectedRuns', 'homeExpectedRuns'],
        ]) {
          if (
            Number.isFinite(total[field])
            && Number.isFinite(projection[projectionField])
            && Math.abs(total[field] - projection[projectionField]) > 0.03
          ) errors.push(`${at}.total.${field}: must match ${projectionField}`)
        }
        if (
          Number.isFinite(total.baseAwayExpectedRuns)
          && Number.isFinite(total.baseHomeExpectedRuns)
          && Number.isFinite(total.baseProjectedTotal)
          && Math.abs(total.baseAwayExpectedRuns + total.baseHomeExpectedRuns - total.baseProjectedTotal) > 0.03
        ) errors.push(`${at}.total.baseProjectedTotal: must equal base team runs`)
        const expectedTotal = total.applied
          ? total.baseProjectedTotal * (1 - total.weight) + total.marketTotal * total.weight
          : total.baseProjectedTotal
        if (
          Number.isFinite(expectedTotal)
          && Number.isFinite(total.finalProjectedTotal)
          && Math.abs(expectedTotal - total.finalProjectedTotal) > 0.03
        ) errors.push(`${at}.total.finalProjectedTotal: inconsistent blend arithmetic`)
      }
      if (
        typeof blend.applied === 'boolean'
        && isObject(blend.side)
        && isObject(blend.total)
        && blend.applied !== (blend.side.applied || blend.total.applied)
      ) errors.push(`${at}.applied: must match side or total application`)
    }
  }
  if (projection.modelVersion >= 8) {
    validateGameMarketDecision(`${prefix}.marketDecision`, projection.marketDecision, projection, errors)
  }
  if (projection.probablePitchers != null) {
    if (!isObject(projection.probablePitchers)) {
      errors.push(`${prefix}.probablePitchers: expected an object`)
    } else {
      for (const side of ['away', 'home']) {
        const pitcher = projection.probablePitchers[side]
        if (pitcher == null) continue
        if (!isObject(pitcher)) {
          errors.push(`${prefix}.probablePitchers.${side}: expected null or an object`)
          continue
        }
        if (pitcher.id != null && !Number.isFinite(pitcher.id)) {
          errors.push(`${prefix}.probablePitchers.${side}.id: expected null or finite`)
        }
        if (pitcher.name != null && typeof pitcher.name !== 'string') {
          errors.push(`${prefix}.probablePitchers.${side}.name: expected null or text`)
        }
      }
    }
  }
  if (projection.marketTracking != null) {
    validateGameMarketTrackingEntry(`${prefix}.marketTracking`, projection.marketTracking, errors)
    if (
      Number.isFinite(projection.marketTracking?.gamePk)
      && Number.isFinite(projection.gamePk)
      && projection.marketTracking.gamePk !== projection.gamePk
    ) errors.push(`${prefix}.marketTracking.gamePk: must match projection gamePk`)
  }
  if (projection.revision != null) {
    const revision = projection.revision
    const at = `${prefix}.revision`
    if (!isObject(revision)) {
      errors.push(`${at}: expected an object`)
    } else {
      if (!Number.isInteger(revision.number) || revision.number < 1) {
        errors.push(`${at}.number: expected a positive integer`)
      }
      for (const field of ['firstCapturedAt', 'lastChangedAt', 'previousCapturedAt', 'observedAt']) {
        validateOptionalIso(`${at}.${field}`, revision[field], errors)
      }
      for (const field of ['firstCapturedAt', 'lastChangedAt', 'observedAt']) {
        if (revision[field] == null) errors.push(`${at}.${field}: required`)
      }
      if (typeof revision.material !== 'boolean') errors.push(`${at}.material: expected boolean`)
      if (!Array.isArray(revision.reasons) || revision.reasons.some((value) => typeof value !== 'string')) {
        errors.push(`${at}.reasons: expected an array of strings`)
      }
    }
  }
  for (const side of ['away', 'home']) {
    const playerIds = projection.inputs?.[side]?.lineupPlayerIds
    if (
      playerIds != null
      && (!Array.isArray(playerIds) || playerIds.some((playerId) => !Number.isFinite(playerId)))
    ) errors.push(`${prefix}.inputs.${side}.lineupPlayerIds: expected an array of finite player IDs`)
  }
  if (projection.freezeState != null && !['refreshing-pregame', 'final-pregame'].includes(projection.freezeState)) {
    errors.push(`${prefix}.freezeState: unsupported`)
  }
}

function validateGameProjections(projections, gameIds, errors) {
  if (projections == null) return 0
  if (!isObject(projections)) {
    errors.push('gameProjections: expected an object')
    return 0
  }
  for (const [gamePk, projection] of Object.entries(projections)) {
    const prefix = `gameProjections.${gamePk}`
    if (String(projection?.gamePk) !== String(gamePk)) errors.push(`${prefix}.gamePk: must match map key`)
    validateGameProjectionRecord(prefix, projection, errors, gameIds)
  }
  return Object.keys(projections).length
}

function validateOptionalMetric(prefix, value, errors, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (value == null) return
  if (!Number.isFinite(value) || value < min || value > max) {
    errors.push(`${prefix}: expected null or finite value in [${min},${max}]`)
  }
}

function validateGameProjectionEvaluation(evaluation, errors) {
  if (evaluation == null) return 0
  if (!isObject(evaluation)) {
    errors.push('gameProjectionEvaluation: expected an object')
    return 0
  }
  const prefix = 'gameProjectionEvaluation'
  if (![1, 2].includes(evaluation.version)) errors.push(`${prefix}.version: expected 1 or 2`)
  if (evaluation.advisoryOnly !== true) errors.push(`${prefix}.advisoryOnly: must be true`)
  if (!['collecting', 'review-ready'].includes(evaluation.status)) errors.push(`${prefix}.status: unsupported`)
  if (evaluation.updatedAt != null && Number.isNaN(Date.parse(evaluation.updatedAt))) errors.push(`${prefix}.updatedAt: expected null or ISO timestamp`)
  for (const field of ['games', 'dates']) {
    if (!Number.isInteger(evaluation.minimumSample?.[field]) || evaluation.minimumSample[field] < 1) {
      errors.push(`${prefix}.minimumSample.${field}: expected a positive integer`)
    }
  }
  for (const field of ['games', 'dates', 'winnerGames', 'totalGames', 'marketMoneylineGames', 'marketTotalGames']) {
    if (!Number.isInteger(evaluation.sample?.[field]) || evaluation.sample[field] < 0) {
      errors.push(`${prefix}.sample.${field}: expected a non-negative integer`)
    }
  }
  validateProbability(`${prefix}.sample.progress`, evaluation.sample?.progress, errors)

  for (const section of ['winner', 'total']) {
    if (!isObject(evaluation[section])) errors.push(`${prefix}.${section}: expected an object`)
  }
  for (const field of ['sample', 'marketSample']) {
    if (!Number.isInteger(evaluation.winner?.[field]) || evaluation.winner[field] < 0) errors.push(`${prefix}.winner.${field}: expected a non-negative integer`)
    if (!Number.isInteger(evaluation.total?.[field]) || evaluation.total[field] < 0) errors.push(`${prefix}.total.${field}: expected a non-negative integer`)
  }
  for (const field of ['accuracy', 'brier', 'coinFlipBrier', 'marketBrier']) {
    validateOptionalMetric(`${prefix}.winner.${field}`, evaluation.winner?.[field], errors, { min: 0, max: 1 })
  }
  for (const field of ['improvementVsCoinFlip', 'improvementVsMarket']) {
    validateOptionalMetric(`${prefix}.winner.${field}`, evaluation.winner?.[field], errors, { min: -1, max: 1 })
  }
  if (evaluation.version >= 2) {
    if (!Number.isInteger(evaluation.winner?.marketDates) || evaluation.winner.marketDates < 0) {
      errors.push(`${prefix}.winner.marketDates: expected a non-negative integer`)
    }
    for (const field of ['pairedModelBrier', 'pairedBaseBrier']) {
      validateOptionalMetric(`${prefix}.winner.${field}`, evaluation.winner?.[field], errors, { min: 0, max: 1 })
    }
    validateOptionalMetric(
      `${prefix}.winner.baseImprovementVsMarket`,
      evaluation.winner?.baseImprovementVsMarket,
      errors,
      { min: -1, max: 1 },
    )
  }
  if (!Array.isArray(evaluation.winner?.calibration)) {
    errors.push(`${prefix}.winner.calibration: expected an array`)
  } else {
    for (const [index, bin] of evaluation.winner.calibration.entries()) {
      const at = `${prefix}.winner.calibration[${index}]`
      if (!Number.isInteger(bin?.sample) || bin.sample < 1) errors.push(`${at}.sample: expected a positive integer`)
      for (const field of ['minProbability', 'maxProbability', 'meanProbability', 'observedWinRate']) {
        validateProbability(`${at}.${field}`, bin?.[field], errors)
      }
    }
  }
  for (const field of ['mae', 'rmse', 'teamRunMae', 'marketLineMae']) {
    validateOptionalMetric(`${prefix}.total.${field}`, evaluation.total?.[field], errors, { min: 0, max: 30 })
  }
  for (const field of ['bias', 'improvementVsMarket']) {
    validateOptionalMetric(`${prefix}.total.${field}`, evaluation.total?.[field], errors, { min: -30, max: 30 })
  }
  if (evaluation.version >= 2) {
    if (!Number.isInteger(evaluation.total?.marketDates) || evaluation.total.marketDates < 0) {
      errors.push(`${prefix}.total.marketDates: expected a non-negative integer`)
    }
    for (const field of ['pairedModelMae', 'pairedBaseMae']) {
      validateOptionalMetric(`${prefix}.total.${field}`, evaluation.total?.[field], errors, { min: 0, max: 30 })
    }
    validateOptionalMetric(
      `${prefix}.total.baseImprovementVsMarket`,
      evaluation.total?.baseImprovementVsMarket,
      errors,
      { min: -30, max: 30 },
    )
  }
  if (typeof evaluation.note !== 'string' || !evaluation.note.trim()) errors.push(`${prefix}.note: expected non-empty text`)
  return evaluation.sample?.games || 0
}

function validateGameScoreData(data, errors, snapshotDate) {
  if (data == null) return 0
  const prefix = 'gameScoreData'
  if (!isObject(data)) {
    errors.push(`${prefix}: expected an object`)
    return 0
  }
  if (data.version !== 1) errors.push(`${prefix}.version: expected 1`)
  if (data.source !== 'MLB season final scores') errors.push(`${prefix}.source: unsupported`)
  if (!Number.isInteger(data.season)) errors.push(`${prefix}.season: expected an integer`)
  if (!isValidDate(data.cutoffDate)) errors.push(`${prefix}.cutoffDate: expected YYYY-MM-DD`)
  else if (isValidDate(snapshotDate) && data.cutoffDate !== snapshotDate) {
    errors.push(`${prefix}.cutoffDate: must match snapshot date`)
  }
  for (const field of ['archivedFinals', 'eligibleFinals', 'teams']) {
    if (!Number.isInteger(data[field]) || data[field] < 0) errors.push(`${prefix}.${field}: expected a non-negative integer`)
  }
  validateOptionalMetric(`${prefix}.leagueRunsPerTeam`, data.leagueRunsPerTeam, errors, { min: 0, max: 20 })
  if (
    Number.isInteger(data.archivedFinals)
    && Number.isInteger(data.eligibleFinals)
    && data.eligibleFinals > data.archivedFinals
  ) errors.push(`${prefix}.eligibleFinals: cannot exceed archivedFinals`)
  const evaluation = data.evaluation
  if (!isObject(evaluation)) {
    errors.push(`${prefix}.evaluation: expected an object`)
  } else {
    const at = `${prefix}.evaluation`
    if (evaluation.version !== 1) errors.push(`${at}.version: expected 1`)
    if (evaluation.advisoryOnly !== true) errors.push(`${at}.advisoryOnly: must be true`)
    if (evaluation.methodology !== 'expanding-date walk-forward') errors.push(`${at}.methodology: unsupported`)
    for (const field of ['games', 'teamRuns', 'dates']) {
      if (!Number.isInteger(evaluation.sample?.[field]) || evaluation.sample[field] < 0) {
        errors.push(`${at}.sample.${field}: expected a non-negative integer`)
      }
    }
    for (const field of ['fromDate', 'throughDate']) {
      if (evaluation.sample?.[field] != null && !isValidDate(evaluation.sample[field])) {
        errors.push(`${at}.sample.${field}: expected null or YYYY-MM-DD`)
      }
    }
    for (const section of ['baseline', 'seasonForm']) {
      if (!isObject(evaluation[section])) {
        errors.push(`${at}.${section}: expected an object`)
        continue
      }
      validateOptionalMetric(`${at}.${section}.teamRunMae`, evaluation[section].teamRunMae, errors, { min: 0, max: 30 })
      validateOptionalMetric(`${at}.${section}.teamRunRmse`, evaluation[section].teamRunRmse, errors, { min: 0, max: 30 })
      validateOptionalMetric(`${at}.${section}.winnerAccuracy`, evaluation[section].winnerAccuracy, errors, { min: 0, max: 1 })
    }
    if (!isObject(evaluation.improvement)) {
      errors.push(`${at}.improvement: expected an object`)
    } else {
      for (const field of ['teamRunMae', 'teamRunRmse']) {
        validateOptionalMetric(`${at}.improvement.${field}`, evaluation.improvement[field], errors, { min: -30, max: 30 })
      }
      validateOptionalMetric(`${at}.improvement.winnerAccuracy`, evaluation.improvement.winnerAccuracy, errors, { min: -1, max: 1 })
    }
  }
  return Number.isInteger(data.eligibleFinals) ? data.eligibleFinals : 0
}

export function validateDailySnapshot(snapshot) {
  const errors = []
  const warnings = []
  if (!isObject(snapshot)) return result(['snapshot: expected an object'], [], {})

  if (snapshot.version !== 5) errors.push(`version: expected 5, received ${String(snapshot.version)}`)
  if (!isValidDate(snapshot.date)) errors.push('date: expected YYYY-MM-DD')
  for (const field of ['generatedAt', 'finishedAt']) {
    if (!snapshot[field] || Number.isNaN(Date.parse(snapshot[field]))) errors.push(`${field}: expected an ISO timestamp`)
  }
  if (!Array.isArray(snapshot.games)) errors.push('games: expected an array')
  if (!isObject(snapshot.scoredBatters)) errors.push('scoredBatters: expected an object')

  const games = Array.isArray(snapshot.games) ? snapshot.games : []
  const gamesByPk = new Map()
  for (const [index, game] of games.entries()) {
    const prefix = `games[${index}]`
    if (!isObject(game)) {
      errors.push(`${prefix}: game must be an object`)
      continue
    }
    if (!Number.isFinite(game.gamePk)) errors.push(`${prefix}.gamePk: must be finite`)
    else if (gamesByPk.has(game.gamePk)) errors.push(`${prefix}.gamePk: duplicate ${game.gamePk}`)
    else gamesByPk.set(game.gamePk, game)
    if (Number.isFinite(game.awayTeam?.id) && game.awayTeam.id === game.homeTeam?.id) {
      errors.push(`${prefix}: awayTeam and homeTeam cannot have the same id`)
    }
  }
  const gameIds = new Set(gamesByPk.keys())
  const entries = isObject(snapshot.scoredBatters) ? Object.entries(snapshot.scoredBatters) : []
  const seen = new Set()
  for (const [key, row] of entries) {
    const prefix = `scoredBatters.${key}`
    if (!isObject(row)) {
      errors.push(`${prefix}: row must be an object`)
      continue
    }
    const expectedKey = `${row.playerId}-${row.gamePk}`
    if (key !== expectedKey) errors.push(`${prefix}: expected composite key ${expectedKey}`)
    if (seen.has(expectedKey)) errors.push(`${prefix}: duplicate batter-game row`)
    seen.add(expectedKey)
    if (!Number.isFinite(row.playerId) || !Number.isFinite(row.gamePk)) errors.push(`${prefix}: playerId and gamePk must be finite`)
    if (gameIds.size && !gameIds.has(row.gamePk)) errors.push(`${prefix}.gamePk: game is missing from games[]`)
    const game = gamesByPk.get(row.gamePk)
    if (game) {
      const awayId = game.awayTeam?.id
      const homeId = game.homeTeam?.id
      const matchesAway = Number.isFinite(row.teamId) && Number.isFinite(awayId) && row.teamId === awayId
      const matchesHome = Number.isFinite(row.teamId) && Number.isFinite(homeId) && row.teamId === homeId
      if (Number.isFinite(row.teamId) && Number.isFinite(awayId) && Number.isFinite(homeId) && !matchesAway && !matchesHome) {
        errors.push(`${prefix}.teamId: does not belong to game ${row.gamePk}`)
      }
      if ((matchesAway && row.isHome === true) || (matchesHome && row.isHome === false)) {
        errors.push(`${prefix}.isHome: contradicts teamId`)
      }
      const expectedPitcherId = matchesAway ? game.homePitcher?.id : matchesHome ? game.awayPitcher?.id : null
      if (Number.isFinite(expectedPitcherId) && Number.isFinite(row.pitcher?.id) && row.pitcher.id !== expectedPitcherId) {
        if (!isValidFrozenPitcherCorrection(row, game, expectedPitcherId)) {
          errors.push(`${prefix}.pitcher.id: expected opposing starter ${expectedPitcherId}`)
        }
      }
    }
    if (!Number.isFinite(row.score) || row.score < 0 || row.score > 100) errors.push(`${prefix}.score: expected finite value in [0,100]`)
    if (row.hrProbability != null && (!Number.isFinite(row.hrProbability) || row.hrProbability < 0 || row.hrProbability > 1)) {
      errors.push(`${prefix}.hrProbability: expected null or probability in [0,1]`)
    }
    if (row.zoneBonus != null || row.baseScore != null) errors.push(`${prefix}: retired zone score adjustment fields are forbidden`)
    if (row.zoneMatchup != null) validateZoneMatchup(`${prefix}.zoneMatchup`, row.zoneMatchup, errors)
    if (row.pitcherContactLeak != null) errors.push(...validatePitcherContactLeakEvidence(row.pitcherContactLeak, `${prefix}.pitcherContactLeak`))
    if (row.preGamePredictionRecord != null) {
      const frozen = row.preGamePredictionRecord
      const at = `${prefix}.preGamePredictionRecord`
      if (!isObject(frozen)) {
        errors.push(`${at}: expected an object`)
      } else {
        if (frozen.featureCapture !== CLEAN_PREGAME_FEATURE_CAPTURE) errors.push(`${at}.featureCapture: expected ${CLEAN_PREGAME_FEATURE_CAPTURE}`)
        if (frozen.featureGeneration !== CLEAN_PREGAME_FEATURE_GENERATION) errors.push(`${at}.featureGeneration: expected ${CLEAN_PREGAME_FEATURE_GENERATION}`)
        if (String(frozen.playerId) !== String(row.playerId)) errors.push(`${at}.playerId: must match row playerId`)
        if (String(frozen.gamePk) !== String(row.gamePk)) errors.push(`${at}.gamePk: must match row gamePk`)
        if (!Number.isFinite(frozen.score) || frozen.score < 0 || frozen.score > 100) errors.push(`${at}.score: expected finite value in [0,100]`)
        if (!GRADE_LABELS.has(frozen.grade)) errors.push(`${at}.grade: unsupported label ${String(frozen.grade)}`)
        errors.push(...validateHistoricalFeatureRecord(frozen, at))
      }
    }
    const grade = row.grade?.label || row.grade
    if (grade != null && !GRADE_LABELS.has(grade)) errors.push(`${prefix}.grade: unsupported label ${String(grade)}`)
  }

  if (Number.isFinite(snapshot.stats?.scoredBatters) && snapshot.stats.scoredBatters !== entries.length) {
    errors.push(`stats.scoredBatters: expected ${entries.length}, received ${snapshot.stats.scoredBatters}`)
  }
  for (const [key, dist] of Object.entries(snapshot.kDistByPitcher || {})) validateKDistribution(key, dist, errors)
  const gameMarkets = validateGameOdds(snapshot.gameOdds, gameIds, errors)
  const gameProjections = validateGameProjections(snapshot.gameProjections, gameIds, errors)
  const gameProjectionResults = validateGameProjectionEvaluation(snapshot.gameProjectionEvaluation, errors)
  const gameScoreResults = validateGameScoreData(snapshot.gameScoreData, errors, snapshot.date)

  if (games.length && entries.length === 0) warnings.push('scoredBatters: empty despite scheduled games')
  return result(errors, warnings, {
    games: games.length,
    gameMarkets,
    gameProjections,
    gameProjectionResults,
    gameScoreResults,
    scoredBatters: entries.length,
    kDistributions: Object.keys(snapshot.kDistByPitcher || {}).length,
  })
}

function validateRecordRows(records, dates, prefix, errors, warnings, { compact = false } = {}) {
  let rows = 0
  let missingFeatures = 0
  let legacyGameRows = 0
  for (const date of dates) {
    const dayRows = records?.[date]
    if (!Array.isArray(dayRows)) {
      errors.push(`${prefix}.records.${date}: expected an array`)
      continue
    }
    const seen = new Set()
    rows += dayRows.length
    for (let index = 0; index < dayRows.length; index++) {
      const row = dayRows[index]
      const at = `${prefix}.records.${date}[${index}]`
      if (!isObject(row)) {
        errors.push(`${at}: expected an object`)
        continue
      }
      if (!Number.isFinite(row.playerId)) errors.push(`${at}.playerId: must be finite`)
      if (row.gamePk != null && !Number.isFinite(row.gamePk)) errors.push(`${at}.gamePk: must be finite or null`)
      if (!Number.isFinite(row.score)) errors.push(`${at}.score: must be finite`)
      if (typeof row.homered !== 'boolean') errors.push(`${at}.homered: must be boolean`)
      if (compact && typeof row.actuallyPlayed !== 'boolean') errors.push(`${at}.actuallyPlayed: must be boolean`)
      if (row.feat != null && !isObject(row.feat)) errors.push(`${at}.feat: must be an object or null`)
      if (row.zoneEvidence != null) errors.push(...validateZoneEvidenceArchive(row.zoneEvidence, row.simHRProb, `${at}.zoneEvidence`))
      if (row.contactLeakEvidence != null) errors.push(...validatePitcherContactLeakEvidence(row.contactLeakEvidence, `${at}.contactLeakEvidence`))
      errors.push(...validateHistoricalFeatureRecord(row, at))
      if (compact && !row.feat) missingFeatures++
      if (row.gamePk == null) {
        legacyGameRows++
      } else {
        const identity = `${row.playerId}-${row.gamePk}`
        if (seen.has(identity)) errors.push(`${at}: duplicate ${identity}`)
        seen.add(identity)
      }
    }
  }
  if (missingFeatures) warnings.push(`${prefix}: ${missingFeatures} row(s) are missing feature vectors`)
  if (legacyGameRows) warnings.push(`${prefix}: ${legacyGameRows} legacy row(s) lack gamePk; doubleheader uniqueness cannot be verified`)
  return rows
}

export function validateBacktestLog(log) {
  const errors = []
  const warnings = []
  if (!isObject(log)) return result(['backtest: expected an object'], [], {})

  const dates = Array.isArray(log.dates) ? log.dates : []
  const records = isObject(log.records) ? log.records : {}
  if (!Array.isArray(log.dates)) errors.push('dates: expected an array')
  if (!isObject(log.records)) errors.push('records: expected an object')
  if (dates.length > 30) errors.push(`dates: operational window exceeds 30 days (${dates.length})`)
  if (!dates.every(isValidDate)) errors.push('dates: every value must use YYYY-MM-DD')
  if (!isSortedUnique(dates)) errors.push('dates: expected sorted unique values')
  for (const key of Object.keys(records)) if (!dates.includes(key)) errors.push(`records.${key}: orphan date not listed in dates[]`)
  const operationalRows = validateRecordRows(records, dates, 'operational', errors, warnings)

  const history = log.modelHistory
  let historyDates = []
  let historyRows = 0
  let historyRecords = {}
  if (history != null) {
    if (!isObject(history)) {
      errors.push('modelHistory: expected an object')
    } else {
      historyDates = Array.isArray(history.dates) ? history.dates : []
      historyRecords = isObject(history.records) ? history.records : {}
      if (history.version !== 1) errors.push(`modelHistory.version: expected 1, received ${String(history.version)}`)
      if (!Array.isArray(history.dates)) errors.push('modelHistory.dates: expected an array')
      if (!isObject(history.records)) errors.push('modelHistory.records: expected an object')
      if (historyDates.length > 180) errors.push(`modelHistory.dates: exceeds 180-day cap (${historyDates.length})`)
      if (!historyDates.every(isValidDate)) errors.push('modelHistory.dates: every value must use YYYY-MM-DD')
      if (!isSortedUnique(historyDates)) errors.push('modelHistory.dates: expected sorted unique values')
      for (const key of Object.keys(historyRecords)) if (!historyDates.includes(key)) errors.push(`modelHistory.records.${key}: orphan date`)
      for (const date of dates) if (!historyDates.includes(date)) errors.push(`modelHistory: missing operational date ${date}`)
      historyRows = validateRecordRows(historyRecords, historyDates, 'modelHistory', errors, warnings, { compact: true })
    }
  } else if (dates.length) {
    errors.push('modelHistory: required when operational records exist')
  }

  const featureArchive = buildHistoricalFeatureCoverage({ dates: historyDates, records: historyRecords })
  if (log.featureArchive == null) {
    if (historyRows) warnings.push(`featureArchive: missing derived schema-v${HISTORICAL_FEATURE_VERSION} coverage summary`)
  } else if (!isObject(log.featureArchive)) {
    errors.push('featureArchive: expected an object')
  } else if (JSON.stringify(log.featureArchive) !== JSON.stringify(featureArchive)) {
    errors.push('featureArchive: inconsistent with modelHistory')
  }

  const kResultDays = Object.keys(log.kProps?.resultsByDate || {}).length
  if (kResultDays > 180) errors.push(`kProps.resultsByDate: exceeds 180-day cap (${kResultDays})`)
  const kEstimateDays = Object.keys(log.kProps?.estByDate || {}).length
  if (kEstimateDays > 14) errors.push(`kProps.estByDate: exceeds 14-day cap (${kEstimateDays})`)

  let gameForecastDays = 0
  let gameForecastResults = 0
  if (log.gameForecasts != null) {
    const forecasts = log.gameForecasts
    if (!isObject(forecasts)) {
      errors.push('gameForecasts: expected an object')
    } else {
      if (forecasts.version !== 1) errors.push(`gameForecasts.version: expected 1, received ${String(forecasts.version)}`)
      for (const section of ['predictionsByDate', 'resultsByDate']) {
        const records = forecasts[section]
        const recordDates = isObject(records) ? Object.keys(records) : []
        if (!isObject(records)) errors.push(`gameForecasts.${section}: expected an object`)
        if (recordDates.length > 180) errors.push(`gameForecasts.${section}: exceeds 180-day cap (${recordDates.length})`)
        if (!recordDates.every(isValidDate)) errors.push(`gameForecasts.${section}: every key must use YYYY-MM-DD`)
        for (const date of recordDates) {
          if (!Array.isArray(records[date])) {
            errors.push(`gameForecasts.${section}.${date}: expected an array`)
            continue
          }
          const seen = new Set()
          for (let index = 0; index < records[date].length; index++) {
            const projection = records[date][index]
            const prefix = `gameForecasts.${section}.${date}[${index}]`
            validateGameProjectionRecord(prefix, projection, errors)
            if (seen.has(projection?.gamePk)) errors.push(`${prefix}: duplicate gamePk ${String(projection?.gamePk)}`)
            seen.add(projection?.gamePk)
            if (section === 'resultsByDate') {
              for (const field of ['actualAwayRuns', 'actualHomeRuns', 'actualTotal', 'absoluteTotalError']) {
                if (!Number.isFinite(projection?.[field]) || projection[field] < 0) errors.push(`${prefix}.${field}: expected a non-negative number`)
              }
              if (!['away', 'home', 'tie'].includes(projection?.actualWinner)) errors.push(`${prefix}.actualWinner: unsupported`)
              if (projection?.winnerBrier != null) validateProbability(`${prefix}.winnerBrier`, projection.winnerBrier, errors)
              if (projection?.winnerCorrect != null && typeof projection.winnerCorrect !== 'boolean') errors.push(`${prefix}.winnerCorrect: expected boolean or null`)
            }
          }
          if (section === 'predictionsByDate') gameForecastDays++
          else gameForecastResults += records[date].length
        }
      }
    }
  }

  let gameMarketDays = 0
  let gameMarketGames = 0
  if (log.gameMarketHistory != null) {
    const history = log.gameMarketHistory
    if (!isObject(history)) {
      errors.push('gameMarketHistory: expected an object')
    } else {
      if (history.version !== 1) {
        errors.push(`gameMarketHistory.version: expected 1, received ${String(history.version)}`)
      }
      const byDate = history.byDate
      const marketDates = isObject(byDate) ? Object.keys(byDate) : []
      if (!isObject(byDate)) errors.push('gameMarketHistory.byDate: expected an object')
      if (marketDates.length > 180) {
        errors.push(`gameMarketHistory.byDate: exceeds 180-day cap (${marketDates.length})`)
      }
      if (!marketDates.every(isValidDate)) {
        errors.push('gameMarketHistory.byDate: every key must use YYYY-MM-DD')
      }
      for (const date of marketDates) {
        const entries = byDate[date]
        if (!isObject(entries)) {
          errors.push(`gameMarketHistory.byDate.${date}: expected an object`)
          continue
        }
        gameMarketDays++
        for (const [gamePk, entry] of Object.entries(entries)) {
          const prefix = `gameMarketHistory.byDate.${date}.${gamePk}`
          if (!Number.isFinite(Number(gamePk))) errors.push(`${prefix}: key must be a finite game ID`)
          validateGameMarketTrackingEntry(prefix, entry, errors)
          if (Number.isFinite(entry?.gamePk) && String(entry.gamePk) !== String(gamePk)) {
            errors.push(`${prefix}.gamePk: must match map key`)
          }
          gameMarketGames++
        }
      }
    }
  }

  return result(errors, warnings, {
    operationalDays: dates.length,
    operationalRows,
    modelHistoryDays: historyDates.length,
    modelHistoryRows: historyRows,
    featureArchive,
    kResultDays,
    gameForecastDays,
    gameForecastResults,
    gameMarketDays,
    gameMarketGames,
  })
}

export function assertValidMlbData(label, validation) {
  if (validation.ok) return validation
  throw new Error(`${label} failed validation:\n- ${validation.errors.join('\n- ')}`)
}
