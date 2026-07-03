import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import * as store from '../lib/storage.js'

const DISMISS_KEY = 'installPromptDismissed'
const SHOW_DELAY_MS = 25_000 // let them look at the board first

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream

// Bottom pill inviting the user to install the PWA. Android/desktop use the
// captured beforeinstallprompt event; iOS (no such event) gets Share → Add to
// Home Screen instructions. Dismissal is remembered — never nags twice.
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [show, setShow] = useState(false)
  const [ios, setIos] = useState(false)

  useEffect(() => {
    if (isStandalone() || store.load(DISMISS_KEY)) return

    let timer
    const arm = () => { timer = setTimeout(() => setShow(true), SHOW_DELAY_MS) }

    const onBip = (e) => {
      e.preventDefault()
      setDeferred(e)
      arm()
    }
    window.addEventListener('beforeinstallprompt', onBip)

    if (isIOS()) {
      setIos(true)
      arm()
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      clearTimeout(timer)
    }
  }, [])

  const dismiss = () => {
    setShow(false)
    store.save(DISMISS_KEY, true)
  }

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    const { outcome } = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }))
    setDeferred(null)
    setShow(false)
    if (outcome !== 'accepted') store.save(DISMISS_KEY, true)
  }

  if (!show || (!deferred && !ios)) return null

  return (
    <div className="install-pill" role="dialog" aria-label="Install StatFax">
      <Icon name="Sparkles" size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
      <div className="install-pill-txt">
        {ios ? (
          <>Add StatFax to your home screen: tap <b>Share</b> → <b>Add to Home Screen</b></>
        ) : (
          <>Install StatFax for full-screen board + offline slate</>
        )}
      </div>
      {!ios && (
        <button className="install-pill-btn" onClick={install}>Install</button>
      )}
      <button className="install-pill-x" onClick={dismiss} aria-label="Dismiss">
        <Icon name="X" size={14} />
      </button>
    </div>
  )
}
