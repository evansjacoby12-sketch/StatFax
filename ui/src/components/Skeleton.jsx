// Loading skeleton that mirrors the real chrome + board so the first paint
// doesn't jump. Shown only on the very first load (refreshes are seamless).
export default function Skeleton() {
  return (
    <div className="app" aria-busy="true" aria-label="Loading slate">
      <div className="topbar">
        <header className="header">
          <div className="header-left">
            <div className="brand-sport">
              <div className="brand">
                <span className="brand-mark sk-pulse" />
                <div className="brand-txt">
                  <span className="sk-bar" style={{ width: 84, height: 14 }} />
                  <span className="sk-bar" style={{ width: 64, height: 9, marginTop: 5 }} />
                </div>
              </div>
              <span className="sk-bar sport-switcher-skeleton" />
            </div>
            <span className="sk-bar" style={{ width: 220, height: 12 }} />
          </div>
          <div className="header-right">
            <span className="sk-bar" style={{ width: 130, height: 34, borderRadius: 10 }} />
            <span className="sk-bar" style={{ width: 34, height: 34, borderRadius: 9 }} />
          </div>
        </header>
        <div className="filters">
          <div className="filters-row">
            <span className="sk-bar" style={{ width: 150, height: 38, borderRadius: 10 }} />
            <span className="sk-bar" style={{ width: 300, height: 38, borderRadius: 10 }} />
            <span className="sk-bar" style={{ width: 360, height: 38, borderRadius: 10 }} />
          </div>
        </div>
      </div>
      <main className="main">
        <div className="board">
          <div className="board-head" style={{ position: 'static' }} />
          <div className="board-body">
            {Array.from({ length: 12 }).map((_, i) => (
              <div className="board-row sk-row" key={i}>
                <span className="sk-bar" style={{ width: 16, height: 12 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span className="sk-bar" style={{ width: 160, height: 13 }} />
                  <span className="sk-bar" style={{ width: 120, height: 10 }} />
                </div>
                <span className="sk-bar" style={{ width: 56, height: 22, borderRadius: 7 }} />
                <span className="sk-bar" style={{ width: '70%', height: 8, borderRadius: 4 }} />
                <span className="sk-bar" style={{ width: 40, height: 12 }} />
                <span className="sk-bar" style={{ width: 60, height: 8, borderRadius: 4 }} />
                <span className="sk-bar" style={{ width: 80, height: 18, borderRadius: 6 }} />
                <span className="sk-bar" style={{ width: 44, height: 14 }} />
                <span className="sk-bar" style={{ width: 56, height: 22, borderRadius: 7 }} />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
