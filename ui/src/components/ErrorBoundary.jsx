import React from 'react'
import { isChunkLoadError, recoverChunkLoadError } from '../lib/chunkRecovery.js'

// Catches any render crash so the app shows a readable fallback (with the error
// + a reload that bypasses cache) instead of a blank white/black screen.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    // Surface to the console for diagnosis.
    console.error('StatFax crashed:', error, info)
    recoverChunkLoadError(error)
  }
  render() {
    if (this.state.error) {
      const staleChunk = isChunkLoadError(this.state.error)
      return (
        <div className="crash">
          <div className="crash-card">
            <h2>{staleChunk ? 'A newer StatFax version is ready.' : 'Something broke rendering the board.'}</h2>
            <p className="dim">{staleChunk ? 'A page module changed during an update. StatFax is loading the current version.' : 'Reloading a fresh copy usually fixes this.'}</p>
            <button className="crash-reload" onClick={() => {
              if (recoverChunkLoadError(this.state.error, { force: true })) return
              const url = new URL(location.href)
              url.searchParams.set('_r', Date.now())
              location.replace(url.href)
            }}>
              Reload
            </button>
            <pre className="crash-err">{String(this.state.error?.message || this.state.error)}</pre>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
