import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip, ProbBar } from './atoms.jsx'
import { interpretWind, stadiumFor } from '../lib/wind.js'
import { compass, skyLabel } from '../lib/weather.js'
import { pct, num, signedPct, gameTime } from '../lib/format.js'
import { teamColor, teamLogo, hexToRgba } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'
import { hexA } from './atoms.jsx'

const WX_SORTS = [
  { key: 'air', label: 'Best air', icon: 'Wind' },
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

  if (!allGames.length) return <div className="empty-note" style={{ padding: '64px', textAlign: 'center', color: 'var(--text-faint)' }}>No games match the current filters.</div>

  return (
    <>
      <div className="wx-controls" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
        <div className="wx-sorts" role="group" aria-label="Sort games by" style={{ display: 'flex', gap: '6px' }}>
          {WX_SORTS.map((s) => (
            <button
              key={s.key}
              className={`badge-toggle ${sort === s.key ? 'on' : ''}`}
              onClick={() => setSort(s.key)}
              aria-pressed={sort === s.key}
              style={{
                borderColor: sort === s.key ? 'var(--accent)' : 'var(--border-soft)',
                background: sort === s.key ? 'var(--hover)' : 'transparent',
                color: sort === s.key ? '#fff' : 'var(--text-faint)',
                fontSize: '11px',
                padding: '4px 10px',
                borderRadius: '6px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Icon name={s.icon} size={11} />
              {s.label}
            </button>
          ))}
        </div>
        <div className="wx-filters" style={{ display: 'flex', gap: '6px' }}>
          <button
            className={`badge-toggle ${outdoorOnly ? 'on' : ''}`}
            onClick={() => setOutdoorOnly((o) => !o)}
            aria-pressed={outdoorOnly}
            title="Hide domes & closed roofs"
            style={{
              borderColor: outdoorOnly ? 'var(--accent)' : 'var(--border-soft)',
              background: outdoorOnly ? 'rgba(0, 216, 246, 0.08)' : 'transparent',
              color: outdoorOnly ? '#fff' : 'var(--text-faint)',
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Icon name="Sun" size={11} />
            Outdoor only
          </button>
          <button
            className={`badge-toggle ${favorableOnly ? 'on' : ''}`}
            onClick={() => setFavorableOnly((f) => !f)}
            aria-pressed={favorableOnly}
            title="Only HR-friendly conditions"
            style={{
              borderColor: favorableOnly ? 'var(--accent)' : 'var(--border-soft)',
              background: favorableOnly ? 'rgba(0, 216, 246, 0.08)' : 'transparent',
              color: favorableOnly ? '#fff' : 'var(--text-faint)',
              fontSize: '11px',
              padding: '4px 10px',
              borderRadius: '6px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Icon name="Flame" size={11} />
            Favorable
          </button>
        </div>
      </div>

      {games.length ? (
        <div className="wx-games" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 1fr))', gap: '16px' }}>
          {games.map((g) => (
            <WeatherCard key={g.gamePk} g={g} onSelect={onSelect} selectedId={selectedId} />
          ))}
        </div>
      ) : (
        <div className="empty-note" style={{ padding: '64px', textAlign: 'center', color: 'var(--text-faint)' }}>No games match these weather filters.</div>
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
  return [...map.values()].map((e) => {
    const facs = e.batters.map((b) => b.parkWeatherHandFactor).filter((v) => Number.isFinite(v))
    e.envFactor = facs.length ? facs.reduce((s, v) => s + v, 0) / facs.length : null
    const home = e.game?.homeTeam?.abbr
    e.wind = interpretWind(e.weather, home, { roofClosed: e.weather?.roofClosed })
    e.stadium = stadiumFor(home)
    e.closed = !!(e.weather?.roofClosed || e.stadium?.type === 'Fixed Dome')
    e.tempF = e.weather?.tempF ?? null
    e.windOutMph = e.closed ? null : (e.wind?.windOutMph ?? null)
    e.helped = e.batters
      .slice()
      .sort(
        (a, b) =>
          (b.parkWeatherHandFactor ?? 0) - (a.parkWeatherHandFactor ?? 0) ||
          (b.hrProbability ?? 0) - (a.hrProbability ?? 0),
      )
    return e
  })
}

function envLabel(f) {
  if (f == null) return { label: '—', tone: '' }
  if (f >= 1.08) return { label: 'Bandbox', tone: 'good' }
  if (f >= 1.03) return { label: 'Favorable', tone: 'good' }
  if (f <= 0.95) return { label: 'Suppressed', tone: 'bad' }
  return { label: 'Neutral', tone: '' }
}

function WindDial({ wind }) {
  const rot = wind?.arrowRotation ?? 0
  const tint = wind?.tint || 'var(--text-faint)'
  return (
    <svg viewBox="0 0 64 64" className="wind-dial" aria-hidden="true" style={{ width: '56px', height: '56px', flexShrink: '0', overflow: 'visible' }}>
      <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1.5" />
      <text x="32" y="10" fill="var(--text-faint)" fontSize="7" fontWeight="800" textAnchor="middle">CF</text>
      <text x="32" y="58" fill="var(--text-faint)" fontSize="7" fontWeight="800" textAnchor="middle">HP</text>
      {/* Outer g: CSS-transitioned heading (eases when a refresh shifts the wind).
          Inner g: gentle idle sway so the arrow reads as live air, not a print. */}
      <g style={{ transform: `rotate(${rot}deg)`, transformOrigin: '32px 32px', transition: 'transform 0.8s cubic-bezier(0.22, 1, 0.36, 1)' }}>
        <g className="wind-sway" style={{ transformOrigin: '32px 32px' }}>
          <line x1="32" y1="46" x2="32" y2="20" stroke={tint} strokeWidth="3" strokeLinecap="round" style={{ filter: `drop-shadow(0 0 3px ${hexA(tint, 0.4)})` }} />
          <path d="M32 14 L27 24 L37 24 Z" fill={tint} />
        </g>
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
      style={{ 
        background: `linear-gradient(100deg, ${hexToRgba(awayC, 0.16)}, transparent 45%, transparent 55%, ${hexToRgba(homeC, 0.16)})`,
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '12px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px'
      }}
    >
      <header className="wxcard-head" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {logo && <img className="wxcard-logo" src={logo} alt="" loading="lazy" style={{ width: '24px', height: '24px' }} />}
        <div className="wxcard-id" style={{ flex: '1', minWidth: '0' }}>
          <div className="wxcard-matchup" style={{ fontSize: '15px', fontWeight: '800', color: '#fff' }}>{matchup}</div>
          <div className="wxcard-sub dim" style={{ fontSize: '11px', marginTop: '2px' }}>
            {game?.venueName || ''}
            {game?.gameDate && <span> · {gameTime(game.gameDate)}</span>}
          </div>
        </div>
        <span className={`wxcard-env tone-${env.tone || 'mut'}`} style={{
          fontSize: '11px',
          fontWeight: '700',
          padding: '2px 8px',
          borderRadius: '4px',
          background: env.tone === 'good' ? 'rgba(16, 185, 129, 0.1)' : env.tone === 'bad' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.05)',
          color: env.tone === 'good' ? 'var(--strong)' : env.tone === 'bad' ? 'var(--bad)' : 'var(--text-dim)'
        }}>
          {env.label}
          {envFactor != null && <b className="mono"> {signedPct(envFactor - 1, 0)}</b>}
        </span>
      </header>

      <div className="wxcard-body" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div className="wxcard-wind" style={{ width: '120px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
          {closed ? (
            <div className="wx-roof" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Icon name="House" size={20} style={{ color: 'var(--text-faint)' }} />
              <span style={{ fontSize: '12px', fontWeight: '600', color: '#fff', marginTop: '4px' }}>{isDome ? 'Dome' : 'Closed'}</span>
              <span className="dim" style={{ fontSize: '10px' }}>no air carry</span>
            </div>
          ) : wind ? (
            <>
              <WindDial wind={wind} />
              <div className="wx-verdict" style={{ color: wind.tint, textAlign: 'center', fontSize: '11px', fontWeight: '600', marginTop: '4px' }}>
                <b>{wind.verdict}</b>
                <span className="dim" style={{ display: 'block', fontWeight: '400', fontSize: '10px', marginTop: '2px' }}>{wind.caption}</span>
              </div>
            </>
          ) : (
            <div className="wx-roof" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Icon name="Wind" size={20} style={{ color: 'var(--text-faint)' }} />
              <span className="dim" style={{ fontSize: '11px', marginTop: '4px' }}>{w?.windSpeedMph != null ? `${Math.round(w.windSpeedMph)} mph calm` : 'Calm wind'}</span>
            </div>
          )}
        </div>

        <div className="wxcard-stats" style={{ flex: '1', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          <Wx icon="Thermometer" k="Temp" v={w?.tempF != null ? `${Math.round(w.tempF)}°F` : '—'} />
          <Wx icon="Wind" k="Wind" v={w?.windSpeedMph != null ? `${Math.round(w.windSpeedMph)} ${compass(w.windDirDeg) || ''}`.trim() : '—'} sub={Number.isFinite(w?.windGustMph) && w.windGustMph <= 90 && w.windGustMph >= (w?.windSpeedMph || 0) ? `G${Math.round(w.windGustMph)}` : null} />
          <Wx icon="Droplet" k="Humidity" v={w?.humidity != null ? `${w.humidity}%` : '—'} />
          <Wx icon="Cloud" k="Precip" v={w?.precipProbPct != null ? `${w.precipProbPct}%` : '—'} sub={sky} />
          <Wx icon="Gauge" k="Park HR" v={parkHR != null ? `${num(parkHR, 2)}×` : '—'} />
        </div>
      </div>

      <div className="wxcard-helped" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '10px' }}>
        {(() => {
          // Honest header: only call it "helped" when the air is genuinely a
          // tailwind. On a neutral/suppressed park this list is just the bats
          // ranked by air factor — i.e. the least-hurt, not boosted.
          const f = g.envFactor
          const helped = f != null && f >= 1.03
          const suppressed = f != null && f <= 0.95
          const title = helped ? 'Helped by Air' : suppressed ? 'Least suppressed by air' : 'Top bats · neutral air'
          const color = helped ? 'var(--good)' : suppressed ? 'var(--bad)' : 'var(--text-faint)'
          return (
            <h4 className="pcard-h4" style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
              <Icon name="Wind" size={11} style={{ color }} /> {title}
              {f != null && <span style={{ marginLeft: 'auto', fontWeight: '700', color }}>{num(f, 2)}×</span>}
            </h4>
          )
        })()}
        <ul className="ptarget-list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {g.helped.slice(0, 4).map((b) => (
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 8px',
                borderRadius: '6px',
                background: selectedId === b.id ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)',
                border: `1px solid ${selectedId === b.id ? 'var(--accent)' : 'transparent'}`,
                cursor: 'pointer',
                fontSize: '12px'
              }}
            >
              <span className="ptarget-ord mono" style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{b.battingOrder || '–'}</span>
              <span className={`ptarget-name ${liveMode && b.liveContext?.isHRThisGame ? 'hr-glow' : ''}`} style={{ flex: '1', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <span style={{ fontWeight: '600', color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden' }}>{b.name}</span>
                <span className="bathand" style={{ fontSize: '9px', opacity: 0.6 }}>{b.batSide}</span>
                {b.parkWeatherHandFactor != null && (
                  <span className="ptarget-h2h dim" style={{ fontSize: '10px', color: 'var(--text-faint)', marginLeft: 'auto' }}>{signedPct(b.parkWeatherHandFactor - 1, 0)} air</span>
                )}
              </span>
              <GradeChip grade={b.grade} size="sm" score={b.score} />
              <span className="ptarget-prob" style={{ width: '40px', display: 'flex', justifyContent: 'flex-end' }}>
                <ProbBar value={b.hrProbability} showLabel={false} />
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
    <div className="wx-stat" style={{
      background: 'rgba(0,0,0,0.15)',
      border: '1px solid rgba(255,255,255,0.03)',
      borderRadius: '6px',
      padding: '4px 8px',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      <span className="wx-stat-k dim" style={{ fontSize: '9px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k}</span>
      <span className="wx-stat-v mono" style={{ fontSize: '12px', fontWeight: '700', color: '#fff', display: 'flex', alignItems: 'baseline', gap: '3px', marginTop: '2px' }}>
        {v}
        {sub && <span className="wx-stat-sub dim" style={{ fontSize: '9px', fontWeight: '400' }}> {sub}</span>}
      </span>
    </div>
  )
}
