import React from 'react'

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
  }
  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <div className="crash-card">
            <h2>Something broke rendering the board.</h2>
            <p className="dim">This is usually a stale cached version. Reloading fresh almost always fixes it.</p>
            <button className="crash-reload" onClick={() => location.replace(location.pathname + '?_r=' + Date.now())}>
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
