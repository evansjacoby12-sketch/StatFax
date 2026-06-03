import Icon from './Icon.jsx'
import { GradeChip, BadgeRow, ProbBar } from './atoms.jsx'
import { teamColor, teamLogo, hexToRgba, readableOn, playerHeadshot } from '../lib/teams.js'
import { pct, num, gameTime } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { compass } from '../lib/weather.js'

export default function GamesView({ games, batters, onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip }) {
  // Group the (already filtered + sorted) batters by game, then by side.
  const byGame = new Map()
  for (const b of batters) {
    if (!byGame.has(b.gamePk)) byGame.set(b.gamePk, { away: [], home: [] })
    byGame.get(b.gamePk)[b.isHome ? 'home' : 'away'].push(b)
  }

  // Order: live first, then scheduled by start time, finals last.
  const phase = (g) => (g.isLive ? 0 : g.isFinal ? 2 : 1)
  const ordered = games
    .filter((g) => {
      const grp = byGame.get(g.gamePk)
      return grp && grp.away.length + grp.home.length > 0
    })
    .sort((a, b) => phase(a) - phase(b) || new Date(a.gameDate) - new Date(b.gameDate))

  if (!ordered.length) {
    return (
      <div className="empty">
        <Icon name="Search" size={28} />
        <p>No batters match these filters.</p>
      </div>
    )
  }

  const ctx = { onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip }
  return (
    <div className="games-grid">
      {ordered.map((g, i) => (
        <GameCard key={g.gamePk} game={g} groups={byGame.get(g.gamePk)} idx={i} {...ctx} />
      ))}
    </div>
  )
}

function GameStatus({ g }) {
  if (g.isLive) {
    return (
      <div className="gc-status live">
        <span className="live-dot" />
        {(g.inningHalf || '').slice(0, 3)} {g.currentInning}
      </div>
    )
  }
  if (g.isFinal) return <div className="gc-status final">Final</div>
  return <div className="gc-status">{gameTime(g.gameDate) || 'TBD'}</div>
}

function TeamHead({ team, pitcher, score, showScore, align }) {
  const color = teamColor(team?.id)
  const logo = teamLogo(team?.id)
  return (
    <div className={`gc-team ${align}`} style={{ '--tc': color }}>
      {logo && <img className="gc-logo" src={logo} alt={team?.name || ''} loading="lazy" />}
      <div className="gc-team-txt">
        <span className="gc-abbr">{team?.abbr}</span>
        <span className="gc-pitcher">{pitcher?.name || 'TBD'}</span>
      </div>
      {showScore && <span className="gc-score mono">{score ?? 0}</span>}
    </div>
  )
}

function GameCard({ game: g, groups, idx = 0, ...ctx }) {
  const awayC = teamColor(g.awayTeam?.id)
  const homeC = teamColor(g.homeTeam?.id)
  const showScore = g.isLive || g.isFinal
  return (
    <section className="game-card" style={{ '--i': Math.min(idx, 12) }}>
      <header
        className="gc-head"
        style={{
          background: `linear-gradient(100deg, ${hexToRgba(awayC, 0.22)}, transparent 42%, transparent 58%, ${hexToRgba(homeC, 0.22)})`,
        }}
      >
        <TeamHead team={g.awayTeam} pitcher={g.awayPitcher} score={g.awayScore} showScore={showScore} align="left" />
        <div className="gc-center">
          <GameStatus g={g} />
          <span className="gc-venue">{g.venueName || ''}</span>
        </div>
        <TeamHead team={g.homeTeam} pitcher={g.homePitcher} score={g.homeScore} showScore={showScore} align="right" />
      </header>

      <GameChips sample={groups.away[0] || groups.home[0]} />

      <div className="gc-silos">
        <Silo team={g.awayTeam} batters={groups.away} {...ctx} />
        <Silo team={g.homeTeam} batters={groups.home} {...ctx} />
      </div>
    </section>
  )
}

function GameChips({ sample }) {
  const w = sample?.weather
  const park = sample?.gameParkHRFactor
  if (!w && park == null) return null
  const chips = []
  if (w?.tempF != null) chips.push({ icon: 'Thermometer', text: `${Math.round(w.tempF)}°F` })
  if (w?.windSpeedMph != null)
    chips.push({ icon: 'Wind', text: `${Math.round(w.windSpeedMph)} ${compass(w.windDirDeg) || ''}`.trim() })
  if (park != null)
    chips.push({ icon: 'Gauge', text: `${num(park, 2)}× park`, tone: park >= 1.05 ? 'good' : park <= 0.95 ? 'bad' : '' })
  if (w?.roofClosed) chips.push({ icon: 'House', text: 'Roof closed' })
  else if (w?.precipProbPct >= 40) chips.push({ icon: 'Droplet', text: `${w.precipProbPct}% rain` })
  if (!chips.length) return null
  return (
    <div className="gc-chips">
      {chips.map((c, i) => (
        <span className={`gc-chip ${c.tone || ''}`} key={i}>
          <Icon name={c.icon} size={11} />
          {c.text}
        </span>
      ))}
    </div>
  )
}

function Silo({ team, batters, ...ctx }) {
  const color = teamColor(team?.id)
  const logo = teamLogo(team?.id)
  return (
    <div className="silo" style={{ '--tc': color }}>
      <div className="silo-head" style={{ background: hexToRgba(color, 0.16) }}>
        {logo && <img className="silo-logo" src={logo} alt="" loading="lazy" />}
        <span className="silo-team" style={{ color: readableOn('#11161f') }}>
          {team?.abbr}
        </span>
        <span className="silo-count mono">{batters.length}</span>
      </div>
      <div className="silo-body">
        {batters.length === 0 ? (
          <div className="silo-empty">No matching batters</div>
        ) : (
          batters.map((b) => <SiloBatter key={b.id} b={b} {...ctx} />)
        )}
      </div>
    </div>
  )
}

function SiloBatter({ b, onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip }) {
  const color = b.grade?.color || gradeColor(b.grade?.label)
  const watched = watchlist.has(b.id)
  const inSlip = slip.has(b.id)
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn(b)
  }
  const hrToday = b.liveContext?.isHRThisGame
  return (
    <div
      className={`silo-row ${selectedId === b.id ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(b)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(b)
        }
      }}
      style={{ '--row-accent': color }}
    >
      <img className="sb-avatar" src={playerHeadshot(b.playerId, 96)} alt="" loading="lazy" />
      <div className="sb-content">
        <div className="sb-line1">
          {b.battingOrder ? <span className="sb-order mono">{b.battingOrder}</span> : <span className="sb-order mono dim">–</span>}
          <span className="sb-name">{b.name}</span>
          <span className="bathand">{b.batSide}</span>
          {hrToday && (
            <span className="hr-tag sm" title="Already homered">
              <Icon name="Flame" size={9} />
            </span>
          )}
          <span className="sb-prob mono" style={{ color }}>
            {pct(b.hrProbability, 1)}
          </span>
        </div>
        <div className="sb-line2">
          <GradeChip grade={b.grade} size="sm" score={b.score} />
          {b.heatIndex >= 58 && (
            <span className="sb-heat" title={`Heat index ${b.heatIndex}/100`}>
              <Icon name="Flame" size={10} />
              {b.heatIndex}
            </span>
          )}
          <ProbBar value={b.hrProbability} color={color} showLabel={false} />
          <span className="sb-acts">
            <button className={`act-btn star ${watched ? 'on' : ''}`} onClick={stop(onToggleWatch)} aria-label="Watch" title={watched ? 'Unwatch' : 'Watch'}>
              <Icon name="Star" size={13} />
            </button>
            <button className={`act-btn add ${inSlip ? 'on' : ''}`} onClick={stop(onToggleSlip)} aria-label="Parlay" title={inSlip ? 'In parlay' : 'Add to parlay'}>
              <Icon name={inSlip ? 'Check' : 'Plus'} size={13} />
            </button>
          </span>
        </div>
        {b.reasons?.[0] && <div className="sb-reason">{b.reasons[0]}</div>}
      </div>
    </div>
  )
}
