const BASE_URL = import.meta.env?.BASE_URL ?? '/'
export const LIST_BUILDER_EVIDENCE_URL = `${BASE_URL}data/list-builder-evidence.json`
export const LIST_BUILDER_EVIDENCE_WINDOW_OPTIONS = Object.freeze([
  Object.freeze({ id: 'd14', label: '14D' }),
  Object.freeze({ id: 'd30', label: '30D' }),
  Object.freeze({ id: 'season', label: 'Season' }),
])

export function isListBuilderEvidenceArtifact(value) {
  if (!value || value.version !== 1 || !value.windows || !value.recipes) return false
  return LIST_BUILDER_EVIDENCE_WINDOW_OPTIONS.every(({ id }) => value.windows[id] && typeof value.windows[id] === 'object')
}

export async function loadListBuilderEvidence({ fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${LIST_BUILDER_EVIDENCE_URL}?t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Rolling evidence unavailable (HTTP ${response.status})`)
  const artifact = await response.json()
  if (!isListBuilderEvidenceArtifact(artifact)) throw new Error('Rolling evidence contract is invalid')
  return artifact
}
