import { buildAiHrEntityIndex, summarizeAiHrTargets } from './aiHrContext.mjs'
import { callOpenAiStructured, OPENAI_DEFAULT_MODEL, searchTavily } from './aiProviders.mjs'

export const AI_HR_RESEARCH_PROVIDER = 'tavily+openai'
export const AI_HR_RESEARCH_VERSION = 2
export const AI_HR_RESEARCH_KINDS = Object.freeze([
  'starter-change',
  'opener-risk',
  'pitch-limit',
  'lineup-status',
  'injury',
  'scratch-risk',
  'weather',
  'roof',
  'bullpen',
  'callup',
])

const RESEARCH_KIND_SET = new Set(AI_HR_RESEARCH_KINDS)
const BATTER_PERFORMANCE_PATTERN = /\b(?:home[ -]?runs?|homers?|homered|rbi|ops|slugging|batting|player of the game|hit(?:ting)? streak|last \d+ games?)\b/i

const validIso = (value) => typeof value === 'string' && !Number.isNaN(Date.parse(value))

function isoDate(value) {
  return new Date(value).toISOString().slice(0, 10)
}

function shiftDate(date, days) {
  return new Date(Date.parse(`${date}T12:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10)
}

function uniqueSources(results) {
  const byUrl = new Map()
  for (const result of results) {
    for (const source of result.sources || []) {
      if (!byUrl.has(source.url) || (source.score || 0) > (byUrl.get(source.url).score || 0)) byUrl.set(source.url, source)
    }
  }
  return [...byUrl.values()].sort((left, right) => (right.score || 0) - (left.score || 0)).slice(0, 24)
}

export function buildAiHrResearchQueries(slate) {
  const summary = summarizeAiHrTargets(slate)
  const matchups = summary.games.map((game) => game.matchup).join(', ')
  const teams = [...new Set(summary.games.flatMap((game) => game.bullpens.map((bullpen) => bullpen.team)).filter(Boolean))].join(', ')
  return [
    `MLB ${summary.date} confirmed lineups injuries scratches ${matchups}`,
    `MLB ${summary.date} probable pitchers starter changes openers pitch limits ${matchups}`,
    `MLB ${summary.date} game weather wind roof status ${matchups}`,
    `MLB ${summary.date} bullpen unavailable overworked relievers ${teams}`,
  ]
}

function signalSchema(entityKeys, sourceUrls) {
  const evidence = {
    type: 'object',
    properties: {
      url: { type: 'string', enum: sourceUrls },
      title: { type: 'string' },
      publishedAt: { type: ['string', 'null'] },
    },
    required: ['url', 'title', 'publishedAt'],
    additionalProperties: false,
  }
  return {
    type: 'object',
    properties: {
      signals: {
        type: 'array',
        maxItems: 24,
        items: {
          type: 'object',
          properties: {
            entityKey: { type: 'string', enum: entityKeys },
            kind: { type: 'string', enum: AI_HR_RESEARCH_KINDS },
            direction: { type: 'string', enum: ['boost', 'suppress', 'uncertain'] },
            severity: { type: 'string', enum: ['alert', 'warn', 'info'] },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            note: { type: 'string' },
            observedAt: { type: 'string' },
            expiresAt: { type: 'string' },
            evidence: { type: 'array', minItems: 1, maxItems: 3, items: evidence },
          },
          required: ['entityKey', 'kind', 'direction', 'severity', 'confidence', 'note', 'observedAt', 'expiresAt', 'evidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['signals'],
    additionalProperties: false,
  }
}

function sourcesText(sources) {
  return sources.map((source, index) => [
    `SOURCE ${index + 1}`,
    `URL: ${source.url}`,
    `TITLE: ${source.title}`,
    `PUBLISHED_AT: ${source.publishedAt || 'UNKNOWN'}`,
    `CONTENT: ${source.content}`,
  ].join('\n')).join('\n\n')
}

function targetsText(slate) {
  const summary = summarizeAiHrTargets(slate)
  return `ALLOWED GAMES AND BULLPENS:\n${summary.games.map((game) => (
    `- ${game.entityKey} | ${game.matchup} | ${game.gameDate || '?'} | ${game.venue || '?'}\n` +
    `  pitchers: ${game.pitchers.map((pitcher) => `${pitcher.entityKey}=${pitcher.name}`).join('; ')}\n` +
    `  bullpens: ${game.bullpens.map((bullpen) => `${bullpen.entityKey}=${bullpen.team}`).join('; ')}`
  )).join('\n')}\n\nALLOWED BATTERS:\n${summary.batters.map((batter) => `- ${batter.entityKey} | ${batter.name} (${batter.team}, ${batter.grade})`).join('\n')}`
}

export function buildAiHrExtractionInput({ slate, sources, generatedAt, historical = false }) {
  return `SLATE DATE: ${slate.date}\nRESEARCH CUTOFF: ${generatedAt}\nMODE: ${historical ? 'historical time-locked replay' : 'live pregame'}\n\n${targetsText(slate)}\n\nRETRIEVED SOURCES:\n${sourcesText(sources)}`
}

export function bindAiHrEvidenceToSources(raw, sources) {
  const sourceIndex = new Map(sources.map((source) => [source.url, source]))
  return {
    signals: (Array.isArray(raw?.signals) ? raw.signals : []).map((signal) => ({
      ...signal,
      evidence: (Array.isArray(signal?.evidence) ? signal.evidence : [])
        .map((item) => sourceIndex.get(item?.url))
        .filter(Boolean)
        .map((source) => ({ url: source.url, title: source.title, publishedAt: source.publishedAt })),
    })),
  }
}

function normalizedWords(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

function noteNamesEntity(note, name) {
  const noteWords = new Set(normalizedWords(note))
  const nameWords = normalizedWords(name).filter((word) => !['jr', 'sr', 'ii', 'iii', 'iv'].includes(word))
  const surname = nameWords.at(-1)
  return Boolean(surname && surname.length >= 3 && noteWords.has(surname))
}

function directionIsMaterial(signal, entity) {
  if (signal.kind === 'lineup-status' || signal.kind === 'scratch-risk') {
    return entity.entityType === 'batter' && ['suppress', 'uncertain'].includes(signal.direction)
  }
  if (signal.kind === 'callup') return signal.direction === 'uncertain'
  if (signal.kind === 'injury' && entity.entityType === 'batter') {
    return ['suppress', 'uncertain'].includes(signal.direction)
  }
  return ['boost', 'suppress', 'uncertain'].includes(signal.direction)
}

/**
 * Deterministic guard after extraction. The statistical engine already owns
 * recent form, season power, and prior-game outcomes; allowing those through
 * would double-count them as "AI" evidence.
 */
export function filterAiHrResearchSignals(raw, entityIndex) {
  return {
    signals: (Array.isArray(raw?.signals) ? raw.signals : []).filter((signal) => {
      const entity = entityIndex.get(signal?.entityKey)
      if (!entity || !RESEARCH_KIND_SET.has(signal?.kind) || !directionIsMaterial(signal, entity)) return false
      if (['batter', 'pitcher'].includes(entity.entityType) && !noteNamesEntity(signal?.note, entity.name)) return false
      if (entity.entityType === 'batter' && BATTER_PERFORMANCE_PATTERN.test(String(signal?.note || ''))) return false
      return true
    }),
  }
}

export async function researchAiHrSignals({
  slate,
  generatedAt = new Date().toISOString(),
  historical = false,
  tavilyApiKey = process.env.TAVILY_API_KEY,
  openAiApiKey = process.env.OPENAI_API_KEY,
  model = process.env.AI_HR_MODEL || OPENAI_DEFAULT_MODEL,
  fetchImpl = fetch,
}) {
  if (!validIso(generatedAt)) throw new Error('AI HR research generatedAt must be ISO')
  const queries = buildAiHrResearchQueries(slate)
  const date = isoDate(generatedAt)
  const searches = []
  for (const query of queries) {
    searches.push(await searchTavily({
      apiKey: tavilyApiKey,
      query,
      startDate: historical ? shiftDate(date, -2) : shiftDate(date, -1),
      // Tavily's end date is exclusive. Pull the target day, then enforce the
      // exact intraday cutoff again in the historical context normalizer.
      endDate: shiftDate(date, 1),
      maxResults: 8,
      topic: 'news',
      fetchImpl,
    }))
  }
  const sources = uniqueSources(searches)
  if (!sources.length) return {
    raw: { signals: [] },
    model,
    provider: AI_HR_RESEARCH_PROVIDER,
    audit: { version: AI_HR_RESEARCH_VERSION, queries: searches.map((search) => search.query), sources: [], responseId: null },
  }
  const entities = buildAiHrEntityIndex(slate)
  const extracted = await callOpenAiStructured({
    apiKey: openAiApiKey,
    model,
    instructions: `You extract only EXTERNAL pregame MLB context that is absent from a statistical HR model. Use only supplied sources and exact allowed entity keys. Material facts are starter changes, opener plans, documented pitch limits, injuries/scratch risk, unusual weather or roof changes, unavailable/overworked bullpen arms, and callups with missing MLB history. Never emit recent performance, prior-game results, home runs, hot/cold streaks, season totals, rankings, odds, projections, routine lineup confirmation, probability math, or betting advice. Do not use kind "other". A player-targeted note must explicitly name that player. Direction is from the affected batter's HR perspective; use uncertain when the effect is not defensible. In historical mode, ignore facts with a missing source timestamp or a timestamp after the cutoff. Return an empty signals array when no material external fact is supported.`,
    input: buildAiHrExtractionInput({ slate, sources, generatedAt, historical }),
    schema: signalSchema([...entities.keys()], sources.map((source) => source.url)),
    schemaName: 'ai_hr_context',
    maxOutputTokens: 3000,
    fetchImpl,
  })
  const bound = bindAiHrEvidenceToSources(extracted.value, sources)
  const filtered = filterAiHrResearchSignals(bound, entities)
  return {
    raw: filtered,
    model: extracted.model,
    provider: AI_HR_RESEARCH_PROVIDER,
    audit: {
      version: AI_HR_RESEARCH_VERSION,
      queries: searches.map((search) => search.query),
      sourceCount: sources.length,
      sources: sources.map(({ content, score, ...source }) => source),
      tavilyCredits: searches.reduce((sum, search) => sum + (search.usageCredits || 0), 0) || null,
      responseId: extracted.responseId,
      extractedSignalCount: bound.signals.length,
      filteredSignalCount: filtered.signals.length,
    },
  }
}
