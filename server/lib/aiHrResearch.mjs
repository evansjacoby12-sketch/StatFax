import { buildAiHrEntityIndex, summarizeAiHrTargets } from './aiHrContext.mjs'
import { callOpenAiStructured, OPENAI_DEFAULT_MODEL, searchTavily } from './aiProviders.mjs'

export const AI_HR_RESEARCH_PROVIDER = 'tavily+openai'
export const AI_HR_RESEARCH_VERSION = 1

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
  const names = summary.batters.slice(0, 20).map((batter) => batter.name).join(', ')
  const matchups = summary.games.map((game) => game.matchup).join(', ')
  const teams = [...new Set(summary.games.flatMap((game) => game.bullpens.map((bullpen) => bullpen.team)).filter(Boolean))].join(', ')
  return [
    `MLB ${summary.date} confirmed lineups injuries scratches ${names}`,
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
            kind: { type: 'string', enum: ['lineup-status', 'injury', 'scratch-risk', 'weather', 'roof', 'bullpen', 'callup', 'other'] },
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
    instructions: `You extract sourced MLB home-run context from retrieval results. Use only the supplied sources and exact allowed entity keys. Never infer a result, probability, score adjustment, multiplier, lock, or betting recommendation. Direction is from the affected batter's HR perspective. Do not create pitcher targets. In historical mode, ignore any fact whose source timestamp is missing or after the cutoff. Return an empty signals array when no material pregame fact is supported.`,
    input: buildAiHrExtractionInput({ slate, sources, generatedAt, historical }),
    schema: signalSchema([...entities.keys()].filter((key) => !key.startsWith('pitcher:')), sources.map((source) => source.url)),
    schemaName: 'ai_hr_context',
    maxOutputTokens: 3000,
    fetchImpl,
  })
  return {
    raw: bindAiHrEvidenceToSources(extracted.value, sources),
    model: extracted.model,
    provider: AI_HR_RESEARCH_PROVIDER,
    audit: {
      version: AI_HR_RESEARCH_VERSION,
      queries: searches.map((search) => search.query),
      sourceCount: sources.length,
      sources: sources.map(({ content, score, ...source }) => source),
      tavilyCredits: searches.reduce((sum, search) => sum + (search.usageCredits || 0), 0) || null,
      responseId: extracted.responseId,
    },
  }
}
