export const SITE_ACCESS_STORAGE_KEY = 'statfax.site-access.v1'

const SHA256_HEX = /^[a-f0-9]{64}$/

export function normalizeSitePasswordHash(value) {
  return String(value || '').trim().toLowerCase()
}

export function isConfiguredSitePasswordHash(value) {
  return SHA256_HEX.test(normalizeSitePasswordHash(value))
}

export async function sha256Hex(value, cryptoApi = globalThis.crypto) {
  if (!cryptoApi?.subtle) throw new Error('Secure password checking is unavailable in this browser.')
  const bytes = new TextEncoder().encode(String(value))
  const digest = await cryptoApi.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function hasSiteAccess(expectedHash, storage = globalThis.sessionStorage) {
  const normalized = normalizeSitePasswordHash(expectedHash)
  if (!isConfiguredSitePasswordHash(normalized) || !storage) return false
  try {
    return storage.getItem(SITE_ACCESS_STORAGE_KEY) === normalized
  } catch {
    return false
  }
}

export function rememberSiteAccess(expectedHash, storage = globalThis.sessionStorage) {
  const normalized = normalizeSitePasswordHash(expectedHash)
  if (!isConfiguredSitePasswordHash(normalized) || !storage) return false
  try {
    storage.setItem(SITE_ACCESS_STORAGE_KEY, normalized)
    return true
  } catch {
    return false
  }
}

export function clearSiteAccess(storage = globalThis.sessionStorage) {
  try {
    storage?.removeItem(SITE_ACCESS_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in strict/private browser modes. The in-memory
    // gate still works for the current page and will simply ask again on reload.
  }
}
