import { sanitizeListBuilderCriteria } from './list-builder.js'

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
