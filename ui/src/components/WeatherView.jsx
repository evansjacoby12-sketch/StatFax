import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip, ProbBar } from './atoms.jsx'
import { interpretWind, stadiumFor } from '../lib/wind.js'
import { compass, skyLabel } from '../lib/weather.js'
import { pct, num, signedPct, gameTime } from '../lib/format.js'
import { teamColor, teamLogo, hexToRgba } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'

// How the weather page can be ranked. Each is a distinct "what helps a HR"
// lens: the air (park × weather × hand), the park alone, wind blowing out,
// or heat (warm air carries the ball).
const WX_SORTS = [
  { key: 'air', label: 'Best air', icon: 'Wind' },
  { key: 'park', label: 'Best parks', icon: 'Gauge' },
  { key: 'wind', label: 'Wind out', icon: 'TrendingUp' },
  { key: 'warm', label: 'Warmest', icon: 'Thermometer' },
]

function sortGames(games, sort) {
  const byAir = (a, b) => (b.envFactor ?? 0) - (a.envFactor ?? 0)
  const arr = games.slice()
  if (sort === 'park') arr.sort((a, b) => (b.parkHR ?? 0) - (a.parkHR ?? 0) || byAir(a, b))
  else if (sort === 'wind') arr.sort((a, b) => (b.windOutMph ?? -99) - (a.windOutMph ?? -99) || byAir(a, b))
  else if (sort === 'warm') arr.sort((a, b) => (b.tempF ?? -99) - (a.tempF ?? -99) || byAir(a, b))
  else arr.sort((a, b) => byAir(a, b) || (b.windOutMph ?? 0) - (a.windOutMph ?? 0))
  return arr
}

// Weather Report — one card per game, ranked by how much tonight's park + air
// helps home runs. Wind gets the real OUT/IN verdict (engine port). Reuses the
// already-filtered batter list so the board's filters narrow the slate.
export default function WeatherView({ batters, onSelect, selectedId }) {
  const [sort, setSort] = useState('air')
  const [outdoorOnly, setOutdoorOnly] = useState(false)
  const [favorableOnly, setFavorableOnly] = useState(false)

  const allGames = useMemo(() => groupWeather(batters), [batters])
  const games = useMemo(() => {
    let list = allGames
    if (outdoorOnly) list = list.filter((g) => !g.closed)
    if (favorableOnly) list = list.filter((g) => (g.envFactor ?? 0) >= 1.03)
    return sortGames(list, sort)
  }, [allGames, sort, outdoorOnly, favorableOnly])

  if (!allGames.length) return <div className="empty-note">No games match the current filters.</div>

  return (
    <>
      <div className="wx-controls">
        <div className="wx-sorts" role="group" aria-label="Sort games by">
          {WX_SORTS.map((s) => (
            <button
              key={s.key}
              className={`badge-toggle ${sort === s.key ? 'on' : ''}`}
              onClick={() => setSort(s.key)}
              aria-pressed={sort === s.key}
            >
              <Icon name={s.icon} size={12} />
              {s.label}
            </button>
          ))}
        </div>
        <div className="wx-filters">
          <button
            className={`badge-toggle ${outdoorOnly ? 'on' : ''}`}
            onClick={() => setOutdoorOnly((o) => !o)}
            aria-pressed={outdoorOnly}
            title="Hide domes & closed roofs (no wind/air effect)"
          >
            <Icon name="Sun" size={12} />
            Outdoor only
          </button>
          <button
            className={`badge-toggle ${favorableOnly ? 'on' : ''}`}
            onClick={() => setFavorableOnly((f) => !f)}
            aria-pressed={favorableOnly}
            title="Only HR-friendly air (≥ +3% park × weather)"
          >
            <Icon name="Flame" size={12} />
            Favorable
          </button>
        </div>
      </div>

      {games.length ? (
        <div className="wx-games">
          {games.map((g) => (
            <WeatherCard key={g.gamePk} g={g} onSelect={onSelect} selectedId={selectedId} />
          ))}
        </div>
      ) : (
        <div className="empty-note">No games match these weather filters.</div>
      )}
    </>
  )
}

function groupWeather(batters) {
  const map = new Map()
  for (const b of batters || []) {
    let e = map.get(b.gamePk)
    if (!e) {
      e = { gamePk: b.gamePk, game: b.game || null, weather: b.weather || null, parkHR: b.gameParkHRFactor, batters: [] }
      map.set(b.gamePk, e)
    }
    if (e.weather == null && b.weather) e.weather = b.weather
    if (e.parkHR == null && b.gameParkHRFactor != null) e.parkHR = b.gameParkHRFactor
    e.batters.push(b)
  }
  const list = [...map.values()].map((e) => {
    const facs = e.batters.map((b) => b.parkWeatherHandFactor).filter((v) => Number.isFinite(v))
    e.envFactor = facs.length ? facs.reduce((s, v) => s + v, 0) / facs.length : null
    const home = e.game?.homeTeam?.abbr
    e.wind = interpretWind(e.weather, home, { roofClosed: e.weather?.roofClosed })
    e.stadium = stadiumFor(home)
    // Derived metrics the control bar sorts/filters on.
    e.closed = !!(e.weather?.roofClosed || e.stadium?.type === 'Fixed Dome')
    e.tempF = e.weather?.tempF ?? null
    e.windOutMph = e.closed ? null : (e.wind?.windOutMph ?? null)
    // Most weather-helped bats first (fall back to model HR prob).
    e.helped = e.batters
      .slice()
      .sort(
        (a, b) =>
          (b.parkWeatherHandFactor ?? 0) - (a.parkWeatherHandFactor ?? 0) ||
          (b.hrProbability ?? 0) - (a.hrProbability ?? 0),
      )
    return e
  })
  return list
}

function envLabel(f) {
  if (f == null) return { label: '—', tone: '' }
  if (f >= 1.08) return { label: 'Bandbox', tone: 'good' }
  if (f >= 1.03) return { label: 'Favorable', tone: 'good' }
  if (f <= 0.95) return { label: 'Suppressed', tone: 'bad' }
  return { label: 'Neutral', tone: '' }
}

function WindDial({ wind }) {
  // Field frame: CF at top, home at bottom. Arrow points the TO direction
  // (arrowRotation: 0 = up toward CF = blowing out).
  const rot = wind?.arrowRotation ?? 0
  const tint = wind?.tint || 'var(--text-faint)'
  return (
    <svg viewBox="0 0 64 64" className="wind-dial" aria-hidden="true">
      <circle cx="32" cy="32" r="30" className="wd-ring" />
      <text x="32" y="11" className="wd-cf" textAnchor="middle">CF</text>
      <g transform={`rotate(${rot} 32 32)`}>
        <line x1="32" y1="44" x2="32" y2="20" stroke={tint} strokeWidth="3" strokeLinecap="round" />
        <path d="M32 16 L27 25 L37 25 Z" fill={tint} />
      </g>
    </svg>
  )
}

function WeatherCard({ g, onSelect, selectedId }) {
  const liveMode = useLiveMode()
  const { game, weather: w, wind, envFactor, parkHR, stadium } = g
  const homeC = teamColor(game?.homeTeam?.id)
  const awayC = teamColor(game?.awayTeam?.id)
  const logo = teamLogo(game?.homeTeam?.id)
  const sky = skyLabel(w)
  const env = envLabel(envFactor)
  const isDome = stadium?.type === 'Fixed Dome'
  const closed = w?.roofClosed || isDome
  const matchup = game ? `${game.awayTeam?.abbr} @ ${game.homeTeam?.abbr}` : `Game ${g.gamePk}`

  return (
    <section
      className="wxcard"
      style={{ background: `linear-gradient(100deg, ${hexToRgba(awayC, 0.16)}, transparent 45%, transparent 55%, ${hexToRgba(homeC, 0.16)})` }}
    >
      <header className="wxcard-head">
        {logo && <img className="wxcard-logo" src={logo} alt="" loading="lazy" />}
        <div className="wxcard-id">
          <div className="wxcard-matchup">{matchup}</div>
          <div className="wxcard-sub dim">
            {game?.venueName || ''}
            {game?.gameDate && <span> · {gameTime(game.gameDate)}</span>}
          </div>
        </div>
        <span className={`wxcard-env tone-${env.tone || 'mut'}`}>
          {env.label}
          {envFactor != null && <b className="mono"> {signedPct(envFactor - 1, 0)}</b>}
        </span>
      </header>

      <div className="wxcard-body">
        <div className="wxcard-wind">
          {closed ? (
            <div className="wx-roof">
              <Icon name="House" size={22} />
              <span>{isDome ? 'Dome' : 'Roof closed'}</span>
              <span className="dim">no wind effect</span>
            </div>
          ) : wind ? (
            <>
              <WindDial wind={wind} />
              <div className="wx-verdict" style={{ color: wind.tint }}>
                <b>{wind.verdict}</b>
                <span>{wind.caption}</span>
              </div>
            </>
          ) : (
            <div className="wx-roof">
              <Icon name="Wind" size={22} />
              <span className="dim">{w?.windSpeedMph != null ? `${Math.round(w.windSpeedMph)} mph calm` : 'No wind data'}</span>
            </div>
          )}
        </div>

        <div className="wxcard-stats">
          <Wx icon="Thermometer" k="Temp" v={w?.tempF != null ? `${Math.round(w.tempF)}°F` : '—'} />
          <Wx icon="Wind" k="Wind" v={w?.windSpeedMph != null ? `${Math.round(w.windSpeedMph)} ${compass(w.windDirDeg) || ''}`.trim() : '—'} sub={w?.windGustMph ? `G${Math.round(w.windGustMph)}` : null} />
          <Wx icon="Droplet" k="Humidity" v={w?.humidity != null ? `${w.humidity}%` : '—'} />
          <Wx icon="Cloud" k="Precip" v={w?.precipProbPct != null ? `${w.precipProbPct}%` : '—'} sub={sky} />
          <Wx icon="Gauge" k="Park HR" v={parkHR != null ? `${num(parkHR, 2)}×` : '—'} />
        </div>
      </div>

      <div className="wxcard-helped">
        <h4 className="pcard-h4">
          <Icon name="Wind" size={13} /> Most helped by the air
        </h4>
        <ul className="ptarget-list">
          {g.helped.slice(0, 6).map((b) => (
            <li
              key={b.id}
              className={`ptarget ${selectedId === b.id ? 'selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(b)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(b)
                }
              }}
            >
              <span className="ptarget-ord mono">{b.battingOrder || '–'}</span>
              <span className={`ptarget-name ${liveMode && b.liveContext?.isHRThisGame ? 'hr-glow' : ''}`}>
                {b.name}
                <span className="bathand">{b.batSide}</span>
                {b.parkWeatherHandFactor != null && (
                  <span className="ptarget-h2h dim">{signedPct(b.parkWeatherHandFactor - 1, 0)} air</span>
                )}
              </span>
              <GradeChip grade={b.grade} size="sm" score={b.score} />
              <span className="ptarget-prob">
                <ProbBar value={b.hrProbability} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Wx({ icon, k, v, sub }) {
  return (
    <div className="wx-stat">
      <Icon name={icon} size={13} />
      <div className="wx-stat-txt">
        <span className="wx-stat-k dim">{k}</span>
        <span className="wx-stat-v mono">
          {v}
          {sub && <span className="wx-stat-sub dim"> {sub}</span>}
        </span>
      </div>
    </div>
  )
}
