const hash = String(process.env.VITE_SITE_PASSWORD_HASH || '').trim().toLowerCase()

if (!/^[a-f0-9]{64}$/.test(hash)) {
  console.error('[site-access] Refusing protected build: VITE_SITE_PASSWORD_HASH must be a 64-character SHA-256 hash.')
  process.exit(1)
}

console.log('[site-access] Protected build configuration is present.')
