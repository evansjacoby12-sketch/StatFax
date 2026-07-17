const CHUNK_ERROR = /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css|loading css chunk|loading chunk .* failed|chunkloaderror/i

function errorMessage(value) {
  if (typeof value === 'string') return value
  if (typeof value?.message === 'string') return value.message
  if (typeof value?.reason?.message === 'string') return value.reason.message
  return String(value || '')
}

export function isChunkLoadError(value) {
  return CHUNK_ERROR.test(errorMessage(value))
}

export function recoverChunkLoadError(value, { force = false } = {}) {
  if (!force && !isChunkLoadError(value)) return false
  if (typeof window === 'undefined') return false
  const recover = window.__STATFAX_RECOVER_STALE_ASSET__
  return typeof recover === 'function' ? recover(force) : false
}
