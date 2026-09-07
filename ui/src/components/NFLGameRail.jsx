import Icon from './Icon.jsx'

export default function NFLGameRail({ games = [], selectedGameIds = new Set(), onSelectGame, onClear }) {
  if (!games.length) return null
  const allActive = selectedGameIds.size === 0

  return (
    <nav className="nfl-game-rail" aria-label="NFL games quick filter">
      <div className="nfl-game-rail-scroll">
        <button
          type="button"
          className={`nfl-game-pill ${allActive ? 'active' : ''}`}
          aria-pressed={allActive}
          onClick={onClear}
        >
          <span className="nfl-game-pill-all">All Matchups</span>
          <b className="mono nfl-game-pill-count">{games.length}</b>
        </button>

        {games.map((game) => {
          const isSelected = selectedGameIds.has(String(game.id))
          return (
            <button
              key={game.id}
              type="button"
              className={`nfl-game-pill ${isSelected ? 'active' : ''} ${game.isLive ? 'is-live' : ''} ${game.isFinal ? 'is-final' : ''}`}
              aria-pressed={isSelected}
              onClick={() => onSelectGame?.(String(game.id))}
              title={`${game.label} · ${game.kickoff || 'Upcoming'}`}
            >
              <span className="nfl-game-pill-matchup">
                {game.label}
              </span>
              {game.isLive ? (
                <span className="nfl-game-pill-live">
                  <span className="live-dot" aria-hidden="true" />
                  LIVE
                </span>
              ) : game.isFinal ? (
                <span className="nfl-game-pill-final">FINAL</span>
              ) : game.kickoff ? (
                <span className="nfl-game-pill-time">{game.kickoff}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
