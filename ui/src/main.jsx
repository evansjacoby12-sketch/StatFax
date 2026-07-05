import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { applySafeAreaFix } from './lib/safeArea.js'
import './index.css'

// Before first paint: measure the real status-bar inset (env() lies on some
// iOS standalone installs) and publish it as --safe-top for the header.
applySafeAreaFix()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// Offline support: cached shell + last slate. Prod only — the dev server's
// module graph and a SW cache fight each other.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
