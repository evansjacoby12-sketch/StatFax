import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { interpretWind, stadiumFor } from '../lib/wind.js'
import { compass, skyLabel } from '../lib/weather.js'
import { num, signedPct, gameTime } from '../lib/format.js'
import { teamColor, teamLogo, hexToRgba } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'

const WX_SORTS = [
  { key: 'air', label: 'Best air', icon: 'CloudSun' },
  { key: 'park', label: 'Best parks', icon: 'Gauge' },
  { key: 'wind', label: 'Wind out', icon: 'TrendingUp' },
  { key: 'warm', label: 'Warmest', icon: 'Thermometer' },
  { key: 'time', label: 'First pitch', icon: 'Clock' },
]

function sortGames(games, sort) {
  const byAir = (a, b) => (b.envFactor ?? 0) - (a.envFactor ?? 0) || (a.gamePk ?? 0) - (b.gamePk ?? 0)
  const arr = games.slice()
  const startOf = (g) => (g.game?.gameDate ? Date.parse(g.game.gameDate) : Infinity)
  if (sort === 'park') arr.sort((a, b) => (b.parkHR ?? 0) - (a.parkHR ?? 0) || byAir(a, b))
  else if (sort === 'wind') arr.sort((a, b) => (b.windOutMph ?? -99) - (a.windOutMph ?? -99) || byAir(a, b))
  else if (sort === 'warm') arr.sort((a, b) => (b.tempF ?? -99) - (a.tempF ?? -99) || byAir(a, b))
  else if (sort === 'time') arr.sort((a, b) => startOf(a) - startOf(b) || byAir(a, b))
  else arr.sort((a, b) => byAir(a, b) || (b.windOutMph ?? 0) - (a.windOutMph ?? 0))
  return arr
}

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

  const summary = useMemo(() => {
    const outdoor = allGames.filter((g) => !g.closed)
    const favorable = allGames.filter((g) => (g.envFactor ?? 0) >= 1.03)
    const rainRisk = outdoor.filter((g) => (g.weather?.precipProbPct ?? 0) >= 50)
    const bestCarry = sortGames(allGames, 'air')[0] || null
    const warmest = sortGames(outdoor, 'warm')[0] || null
    return { outdoor, favorable, rainRisk, bestCarry, warmest }
  }, [allGames])

  if (!allGames.length) return <WeatherEmpty message="No games match the current slate filters." />

  const alertTone = summary.rainRisk.length ? 'watch' : summary.favorable.length ? 'boost' : 'clear'
  const alertTitle = summary.rainRisk.length
    ? `${summary.rainRisk.length} ${summary.rainRisk.length === 1 ? 'game needs' : 'games need'} a weather check`
    : summary.favorable.length
      ? `${summary.favorable.length} ${summary.favorable.length === 1 ? 'game has' : 'games have'} HR-friendly air`
      : 'No major weather edges on this slate'
  const alertCopy = summary.rainRisk.length
    ? 'Rain risk is elevated. Recheck conditions closer to first pitch.'
    : summary.favorable.length
      ? 'Ranked below by modeled park-and-weather carry.'
      : 'Conditions are mostly neutral, suppressed, or protected by a roof.'

  return (
    <div className="wxboard">
      <div className="mobile-page-kicker wx-mobile-kicker">
        <span><Icon name="CloudSun" size={14} /> Weather impact</span>
        <small className="mono">{games.length} matchups</small>
      </div>

      <section className={`wxboard-alert tone-${alertTone}`} aria-label="Slate weather verdict">
        <div className="wxboard-alert-copy">
          <span className="wxboard-alert-icon"><Icon name={summary.rainRisk.length ? 'TriangleAlert' : 'CloudSun'} size={19} /></span>
          <div>
            <span className="wxboard-alert-kicker">Slate weather verdict</span>
            <h1>{alertTitle}</h1>
            <p>{alertCopy}</p>
          </div>
        </div>
        <div className="wxboard-alert-stats">
          <SummaryStat
            label="Best air"
            value={gameLabel(summary.bestCarry)}
            detail={summary.bestCarry?.envFactor != null ? signedPct(summary.bestCarry.envFactor - 1, 0) : '—'}
          />
          <SummaryStat
            label="Rain watch"
            value={String(summary.rainRisk.length)}
            detail={summary.rainRisk.length ? 'monitor' : 'clear'}
            tone={summary.rainRisk.length ? 'bad' : 'good'}
          />
          <SummaryStat
            label="Warmest"
            value={summary.warmest?.game?.homeTeam?.abbr || '—'}
            detail={summary.warmest?.tempF != null ? `${Math.round(summary.warmest.tempF)}°F` : '—'}
          />
        </div>
      </section>

      <section className="wxboard-panel" aria-label="Weather decision board">
        <div className="wxboard-toolbar">
          <div className="wxboard-title">
            <span><Icon name="ListFilter" size={15} /></span>
            <div>
              <h2>Weather decision board</h2>
              <p>{games.length} of {allGames.length} games · strongest carry first</p>
            </div>
          </div>

          <div className="wxboard-controls">
            <label className="wx-sort-select wxboard-select">
              <Icon name="ArrowUpDown" size={15} />
              <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort weather games">
                {WX_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
              <Icon name="ChevronDown" size={15} />
            </label>
            <div className="wxboard-sorts" role="group" aria-label="Sort games by">
              {WX_SORTS.map((s) => (
                <button key={s.key} className={sort === s.key ? 'on' : ''} onClick={() => setSort(s.key)} aria-pressed={sort === s.key}>
                  <Icon name={s.icon} size={12} /> {s.label}
                </button>
              ))}
            </div>
            <div className="wxboard-filters" role="group" aria-label="Filter weather games">
              <button className={outdoorOnly ? 'on' : ''} onClick={() => setOutdoorOnly((value) => !value)} aria-pressed={outdoorOnly}>
                <Icon name="Sun" size={13} /> Outdoor
              </button>
              <button className={favorableOnly ? 'on' : ''} onClick={() => setFavorableOnly((value) => !value)} aria-pressed={favorableOnly}>
                <Icon name="Flame" size={13} /> Favorable
              </button>
            </div>
          </div>
        </div>

        {games.length ? (
          <div className="wxboard-list">
            <div className="wxboard-columns" aria-hidden="true">
              <span>Rank</span><span>Matchup</span><span>Weather state</span><span>Carry</span><span>Park HR</span><span>Rain</span><span>Affected hitters</span><span />
            </div>
            {games.map((game, index) => (
              <WeatherRow key={game.gamePk} g={game} rank={index + 1} onSelect={onSelect} selectedId={selectedId} />
            ))}
          </div>
        ) : (
          <WeatherEmpty message="No games match these weather filters." compact />
        )}
      </section>
    </div>
  )
}

function SummaryStat({ label, value, detail, tone = '' }) {
  return (
    <div className={`wxboard-summary-stat ${tone ? `tone-${tone}` : ''}`}>
      <small>{label}</small>
      <b>{value}</b>
      <span className="mono">{detail}</span>
    </div>
  )
}

function WeatherEmpty({ message, compact = false }) {
  return (
    <div className={`wxboard-empty ${compact ? 'compact' : ''}`}>
      <Icon name="CloudSun" size={20} />
      <span>{message}</span>
    </div>
  )
}

function groupWeather(batters) {
  const map = new Map()
  for (const b of batters || []) {
    let entry = map.get(b.gamePk)
    if (!entry) {
      entry = { gamePk: b.gamePk, game: b.game || null, weather: b.weather || null, parkHR: b.gameParkHRFactor, batters: [] }
      map.set(b.gamePk, entry)
    }
    if (entry.weather == null && b.weather) entry.weather = b.weather
    if (entry.parkHR == null && b.gameParkHRFactor != null) entry.parkHR = b.gameParkHRFactor
    entry.batters.push(b)
  }
  return [...map.values()].map((entry) => {
    const factors = entry.batters.map((b) => b.parkWeatherHandFactor).filter((value) => Number.isFinite(value))
    entry.envFactor = factors.length ? factors.reduce((sum, value) => sum + value, 0) / factors.length : null
    const home = entry.game?.homeTeam?.abbr
    entry.wind = interpretWind(entry.weather, home, { roofClosed: entry.weather?.roofClosed })
    entry.stadium = stadiumFor(home)
    entry.closed = !!(entry.weather?.roofClosed || entry.stadium?.type === 'Fixed Dome')
    entry.tempF = entry.weather?.tempF ?? null
    entry.windOutMph = entry.closed ? null : (entry.wind?.windOutMph ?? null)
    entry.helped = entry.batters
      .slice()
      .sort((a, b) => (b.parkWeatherHandFactor ?? 0) - (a.parkWeatherHandFactor ?? 0) || (b.hrProbability ?? 0) - (a.hrProbability ?? 0))
    return entry
  })
}

function gameLabel(g) {
  if (!g?.game) return '—'
  return `${g.game.awayTeam?.abbr || 'Away'} @ ${g.game.homeTeam?.abbr || 'Home'}`
}

function weatherState(g) {
  const precip = g.weather?.precipProbPct ?? 0
  const isDome = g.stadium?.type === 'Fixed Dome'
  if (g.closed) return { key: 'dome', label: isDome ? 'Dome' : 'Roof closed', icon: 'House', note: 'Air neutralized' }
  if (precip >= 50) return { key: 'rain', label: 'Rain watch', icon: 'CloudRain', note: `${Math.round(precip)}% precipitation` }
  if (g.envFactor != null && g.envFactor >= 1.03) return { key: 'favorable', label: 'Favorable', icon: 'TrendingUp', note: 'HR carry boosted' }
  if (g.envFactor != null && g.envFactor <= 0.95) return { key: 'suppressed', label: 'Suppressed', icon: 'TrendingDown', note: 'HR carry reduced' }
  return { key: 'neutral', label: 'Neutral', icon: 'Minus', note: 'No major air edge' }
}

function carryLabel(g) {
  if (g.closed) return g.stadium?.type === 'Fixed Dome' ? 'Dome' : 'Closed'
  if (!g.wind) return 'Calm'
  return `${g.weather?.windSpeedMph != null ? Math.round(g.weather.windSpeedMph) : '—'} mph ${g.wind.verdict}`
}

function WeatherRow({ g, rank, onSelect, selectedId }) {
  const [expanded, setExpanded] = useState(false)
  const liveMode = useLiveMode()
  const state = weatherState(g)
  const { game, weather, wind, envFactor, parkHR } = g
  const awayColor = teamColor(game?.awayTeam?.id)
  const homeColor = teamColor(game?.homeTeam?.id)
  const matchup = gameLabel(g)
  const topHitters = g.helped.slice(0, 3)

  return (
    <article
      className={`wxboard-row state-${state.key} ${expanded ? 'is-expanded' : ''}`}
      style={{ '--wx-away': hexToRgba(awayColor, 0.12), '--wx-home': hexToRgba(homeColor, 0.12) }}
    >
      <div className="wxboard-row-main">
        <div className="wxboard-rank mono"><span>#</span>{rank}</div>

        <div className="wxboard-matchup">
          <div className="wxboard-logos" aria-hidden="true">
            {teamLogo(game?.awayTeam?.id) && <img src={teamLogo(game.awayTeam.id)} alt="" loading="lazy" />}
            {teamLogo(game?.homeTeam?.id) && <img src={teamLogo(game.homeTeam.id)} alt="" loading="lazy" />}
          </div>
          <div>
            <strong>{matchup}</strong>
            <span>{game?.gameDate ? gameTime(game.gameDate) : 'Time TBD'}{game?.venueName ? ` · ${game.venueName}` : ''}</span>
          </div>
        </div>

        <div className={`wxboard-state tone-${state.key}`}>
          <Icon name={state.icon} size={13} />
          <span><b>{state.label}</b><small>{state.note}</small></span>
        </div>

        <BoardMetric label="Carry" value={carryLabel(g)} detail={g.closed ? 'No wind effect' : (wind?.caption || 'Light wind')} icon={g.closed ? 'House' : 'Wind'} />
        <BoardMetric label="Park HR" value={parkHR != null ? `${num(parkHR, 2)}×` : '—'} detail={envFactor != null ? `${signedPct(envFactor - 1, 0)} total air` : 'No factor'} icon="Gauge" />
        <BoardMetric label="Rain" value={weather?.precipProbPct != null ? `${Math.round(weather.precipProbPct)}%` : '—'} detail={skyLabel(weather) || 'No forecast'} icon="CloudRain" tone={(weather?.precipProbPct ?? 0) >= 50 ? 'bad' : (weather?.precipProbPct ?? 100) <= 20 ? 'good' : ''} />

        <div className="wxboard-hitters" aria-label="Top affected hitters">
          {topHitters.length ? topHitters.map((b) => (
            <button
              key={b.id}
              className={`${selectedId === b.id ? 'selected' : ''} ${liveMode && b.liveContext?.isHRThisGame ? 'hr-glow' : ''}`}
              onClick={() => onSelect(b)}
              title={`Open ${b.name}`}
            >
              <span><strong>{b.name}</strong><small className="mono">{b.hrProbability != null ? `${Math.round(b.hrProbability * 100)}% HR` : 'HR —'}</small></span>
              <GradeChip grade={b.grade} size="sm" score={b.score} />
            </button>
          )) : <span className="wxboard-no-hitters">No hitter projections</span>}
        </div>

        <button className="wxboard-expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} forecast details for ${matchup}`}>
          <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={17} />
        </button>
      </div>

      {expanded && (
        <div className="wxboard-details">
          <div className="wxboard-detail-grid">
            <Detail label="Temperature" value={weather?.tempF != null ? `${Math.round(weather.tempF)}°F` : '—'} icon="Thermometer" />
            <Detail label="Wind" value={weather?.windSpeedMph != null ? `${Math.round(weather.windSpeedMph)} mph ${compass(weather.windDirDeg) || ''}`.trim() : '—'} icon="Wind" />
            <Detail label="Gust" value={Number.isFinite(weather?.windGustMph) && weather.windGustMph <= 90 ? `${Math.round(weather.windGustMph)} mph` : '—'} icon="TrendingUp" />
            <Detail label="Humidity" value={weather?.humidity != null ? `${Math.round(weather.humidity)}%` : '—'} icon="Droplet" />
            <Detail label="Sky" value={skyLabel(weather) || '—'} icon="Cloud" />
            <Detail label="Roof" value={g.closed ? (g.stadium?.type === 'Fixed Dome' ? 'Fixed dome' : 'Closed') : 'Open air'} icon="House" />
          </div>
          {g.helped.length > 3 && (
            <div className="wxboard-more-hitters">
              <span>More projected hitters</span>
              <div>
                {g.helped.slice(3, 8).map((b) => (
                  <button key={b.id} onClick={() => onSelect(b)} className={selectedId === b.id ? 'selected' : ''}>
                    {b.name}<small className="mono">{b.hrProbability != null ? `${Math.round(b.hrProbability * 100)}%` : '—'}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </article>
  )
}

function BoardMetric({ label, value, detail, icon, tone = '' }) {
  const metricKey = label.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className={`wxboard-metric metric-${metricKey} ${tone ? `tone-${tone}` : ''}`}>
      <small><Icon name={icon} size={11} /> {label}</small>
      <b className="mono">{value}</b>
      <span>{detail}</span>
    </div>
  )
}

function Detail({ label, value, icon }) {
  return (
    <div className="wxboard-detail">
      <span><Icon name={icon} size={12} /> {label}</span>
      <b className="mono">{value}</b>
    </div>
  )
}
