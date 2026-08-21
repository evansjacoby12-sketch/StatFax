import { useState } from 'react'
import Icon from './Icon.jsx'
import {
  hasSiteAccess,
  isConfiguredSitePasswordHash,
  normalizeSitePasswordHash,
  rememberSiteAccess,
  sha256Hex,
} from '../lib/siteAccess.js'
import './SitePasswordGate.css'

const EXPECTED_HASH = normalizeSitePasswordHash(import.meta.env.VITE_SITE_PASSWORD_HASH)
const IS_LOCAL_DEV = import.meta.env.DEV

export default function SitePasswordGate({ children }) {
  const configured = isConfiguredSitePasswordHash(EXPECTED_HASH)
  const [unlocked, setUnlocked] = useState(() => configured && hasSiteAccess(EXPECTED_HASH))
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  // Local development stays frictionless. Production deploys use
  // `build:protected`, which refuses to publish without a valid hash.
  if (!configured && IS_LOCAL_DEV) return children
  if (unlocked) return children

  const submit = async (event) => {
    event.preventDefault()
    if (!configured || checking) return
    if (!password) {
      setError('Enter the shared password.')
      return
    }

    setChecking(true)
    setError('')
    try {
      const enteredHash = await sha256Hex(password)
      if (enteredHash !== EXPECTED_HASH) {
        setError('That password does not match.')
        setPassword('')
        return
      }
      rememberSiteAccess(EXPECTED_HASH)
      setUnlocked(true)
    } catch (err) {
      setError(err?.message || 'Password check failed. Try again.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="site-access-shell">
      <main className="site-access-card" aria-labelledby="site-access-title">
        <div className="site-access-mark" aria-hidden="true">
          <img src={`${import.meta.env.BASE_URL}icon.png`} alt="" />
        </div>

        <div className="site-access-kicker">
          <Icon name="Lock" size={12} />
          Private access
        </div>
        <h1 id="site-access-title">Unlock StatFax</h1>
        <p className="site-access-copy">Enter the shared password to open the model board.</p>

        {configured ? (
          <form className="site-access-form" onSubmit={submit} noValidate>
            <label htmlFor="site-password">Shared password</label>
            <div className={`site-access-input ${error ? 'has-error' : ''}`}>
              <Icon name="Lock" size={17} aria-hidden="true" />
              <input
                id="site-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                  if (error) setError('')
                }}
                autoComplete="current-password"
                autoCapitalize="none"
                spellCheck="false"
                autoFocus
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'site-access-error' : 'site-access-note'}
              />
              <button
                type="button"
                className="site-access-reveal"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                <Icon name={showPassword ? 'EyeOff' : 'Eye'} size={18} />
              </button>
            </div>

            <div className="site-access-message" aria-live="polite">
              {error && (
                <span id="site-access-error" role="alert">
                  <Icon name="TriangleAlert" size={13} />
                  {error}
                </span>
              )}
            </div>

            <button className="site-access-submit" type="submit" disabled={checking}>
              {checking ? <Icon name="Loader" size={16} className="site-access-spinner" /> : <Icon name="Lock" size={16} />}
              {checking ? 'Checking…' : 'Unlock StatFax'}
            </button>
          </form>
        ) : (
          <div className="site-access-config" role="alert">
            <Icon name="TriangleAlert" size={16} />
            <div>
              <strong>Access is not configured</strong>
              <span>The site owner needs to add the password secret and redeploy.</span>
            </div>
          </div>
        )}

        <p className="site-access-note" id="site-access-note">
          <Icon name="Shield" size={13} />
          Access stays unlocked for this browser session.
        </p>
      </main>
    </div>
  )
}
