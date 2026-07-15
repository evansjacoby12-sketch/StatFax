import { sanitizeListBuilderCriteria } from './list-builder.js'
import { toListBuilderAnalystRequest } from './list-builder-analyst.js'

export const LIST_BUILDER_WORKER_URL = import.meta.env?.VITE_WORKER_URL || ''

export async function translateListBuilderQuery(query, options = {}) {
  const text = String(query || '').trim().slice(0, 500)
  if (!text) throw new Error('Describe the list you want first.')

  const workerUrl = String(options.workerUrl ?? LIST_BUILDER_WORKER_URL).replace(/\/$/, '')
  if (!workerUrl) throw new Error('AI criteria is not configured on this site.')
  const fetchImpl = options.fetchImpl || fetch

  const response = await fetchImpl(`${workerUrl}/list-builder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: text }),
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    // Keep the public error free of provider response bodies and secrets.
  }
  if (!response.ok) throw new Error(payload?.error || 'AI criteria is temporarily unavailable.')

  return {
    criteria: sanitizeListBuilderCriteria(payload?.criteria),
    summary: String(payload?.summary || 'Translated into visible StatFax criteria.').trim().slice(0, 240),
  }
}

const cleanText = (value, max) => String(value || '').trim().slice(0, max)
const cleanList = (value, maxItems = 3, maxLength = 180) => (Array.isArray(value) ? value : [])
  .map((item) => cleanText(item, maxLength))
  .filter(Boolean)
  .slice(0, maxItems)

export async function analyzeListBuilder(context, options = {}) {
  const analystContext = toListBuilderAnalystRequest(context)
  const workerUrl = String(options.workerUrl ?? LIST_BUILDER_WORKER_URL).replace(/\/$/, '')
  if (!workerUrl) throw new Error('AI Analyst is not configured on this site.')
  const fetchImpl = options.fetchImpl || fetch

  const response = await fetchImpl(`${workerUrl}/list-builder-analyst`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context: analystContext }),
  })

  let payload = null
  try {
    payload = await response.json()
  } catch {
    // Never expose provider response bodies or configuration details publicly.
  }
  if (!response.ok) throw new Error(payload?.error || 'AI Analyst is temporarily unavailable.')

  const allowedRelaxations = new Set(analystContext.safeRelaxations.map((candidate) => candidate.id))
  const candidateId = allowedRelaxations.has(payload?.relaxation?.candidateId)
    ? payload.relaxation.candidateId
    : null
  const comparisonAvailable = analystContext.selectedRecipes.length === 2 && payload?.comparison?.available === true

  return {
    contextSignature: context?.signature || null,
    headline: cleanText(payload?.headline || 'List review', 80),
    diagnosis: cleanText(payload?.diagnosis || 'The current aggregate evidence was reviewed.', 420),
    strongestEvidence: cleanList(payload?.strongestEvidence, 3, 180),
    relaxation: {
      candidateId,
      reason: cleanText(payload?.relaxation?.reason, 240),
    },
    comparison: {
      available: comparisonAvailable,
      verdict: cleanText(payload?.comparison?.verdict, 300),
      differences: comparisonAvailable ? cleanList(payload?.comparison?.differences, 3, 180) : [],
      caution: cleanText(payload?.comparison?.caution, 180),
    },
    limitations: cleanList(payload?.limitations, 3, 180),
  }
}
