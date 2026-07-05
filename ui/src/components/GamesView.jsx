import { useState, useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { GradeChip, BadgeRow, ProbBar, ProbRing } from './atoms.jsx'
import { teamColor, teamLogo, hexToRgba, readableOn, playerHeadshot } from '../lib/teams.js'
import { pct, num, gameTime, signedPct } from '../lib/format.js'
import { gradeColor, eli5IconName, toneColor } from '../lib/badges.js'
import { HOT_HEAT } from '../lib/constants.js'
import { compass } from '../lib/weather.js'
import { interpretWind } from '../lib/wind.js'
import { useLiveMode } from '../lib/liveMode.js'
import { hexA } from './atoms.jsx'

const lastName = (n) => (n || '').trim().split(/\s+/).slice(-1)[0]

function computeGameOfDay(batters) {
  const byGame = new Map()
  for (const b of batters || []) {
    if (b.game?.isFinal || !Number.isFinite(b.expectedHRs)) continue
    let g = byGame.get(b.gamePk)
    if (!g) {
      g = { gamePk: b.gamePk, game: b.game, bats: [], xhr: 0, primeStrong: 0 }
      byGame.set(b.gamePk, g)
    }
    g.bats.push(b)
    g.xhr += b.expectedHRs
    const lbl = b.grade?.label
    if (lbl === 'PRIME' || lbl === 'STRONG') g.primeStrong++
  }
  const list = [...byGame.values()].filter((g) => g.bats.length >= 4 && g.primeStrong >= 1)
  if (!list.length) return null
  list.sort((a, b) => b.xhr - a.xhr)
  const g = list[0]
  if (!g) return null
  g.awayPitcher = g.bats.find((b) => b.isHome)?.pitcher || null
  g.homePitcher = g.bats.find((b) => !b.isHome)?.pitcher || null
  g.park = g.bats[0]?.gameParkHRFactor ?? null
  g.weather = g.bats[0]?.weather || g.game?.weather || null
  g.threats = g.bats
    .filter((b) => (b.grade?.label || 'SKIP') !== 'SKIP')
    .sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0))
    .slice(0, 4)
  return g
}

function GodPitcher({ p, onOpenPitcher, gamePk }) {
  if (!p?.name) return null
  const hr9 = p.season?.hrPer9
  const tone = hr9 >= 1.3 ? 'pos' : hr9 <= 0.9 ? 'neg' : ''
  return (
    <button className="god-pitcher" onClick={() => onOpenPitcher?.(p.id, gamePk)} title={`${p.name} — open pitcher card`} style={{
      color: 'var(--accent)',
      fontWeight: '600',
      borderBottom: '1px dashed rgba(0, 216, 246, 0.4)',
      display: 'inline-block'
    }}>
      {lastName(p.name)} {hr9 != null && <b className={tone} style={{ marginLeft: '4px' }}>{num(hr9, 2)}</b>}
    </button>
  )
}

function GameOfDay({ god, onSelect, onOpenPitcher }) {
  if (!god) return null
  const g = god.game
  const away = g?.awayTeam?.abbr || '—'
  const home = g?.homeTeam?.abbr || '—'
  const wind = interpretWind(god.weather, g?.homeTeam?.abbr, { roofClosed: god.weather?.roofClosed })
  return (
    <section className="god-card" style={{
      background: 'linear-gradient(135deg, rgba(0, 216, 246, 0.12) 0%, rgba(8,12,28,0.85) 100%)',
      border: '1px solid rgba(0, 216, 246, 0.25)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 16px var(--accent-glow)',
      borderRadius: '16px',
      padding: '20px',
      marginBottom: '24px',
      position: 'relative'
    }}>
      <div className="god-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span className="god-kicker" style={{
          fontSize: '12px',
          fontWeight: '800',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <Icon name="Flame" size={14} style={{ filter: 'drop-shadow(0 0 4px var(--accent))' }} /> Game of the Day
        </span>
        <span className="god-xhr mono" style={{ fontSize: '13px', fontWeight: '700', color: '#fff' }}>
          {num(god.xhr, 1)} <em style={{ fontStyle: 'normal', color: 'var(--text-faint)' }}>exp HR</em>
        </span>
      </div>
      <div className="god-matchup" style={{ fontSize: '18px', fontWeight: '800', color: '#fff', marginBottom: '12px' }}>
        {away} @ {home}
        <span style={{ fontSize: '13px', color: 'var(--text-dim)', fontWeight: '400', marginLeft: '8px' }}>
          {g?.venueName ? ` · ${g.venueName}` : ''}
          {g?.gameDate ? ` · ${gameTime(g.gameDate)}` : ''}
        </span>
      </div>
      <div className="god-factors" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '14px', fontSize: '13px' }}>
        <span className="god-fac" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="Shield" size={12} style={{ color: 'var(--text-faint)' }} /> vs <GodPitcher p={god.awayPitcher} onOpenPitcher={onOpenPitcher} gamePk={god.gamePk} />
          <span className="god-amp">·</span>
          <GodPitcher p={god.homePitcher} onOpenPitcher={onOpenPitcher} gamePk={god.gamePk} /> HR/9
        </span>
        {wind && wind.verdict !== 'CROSS' && (
          <span className={`god-fac ${wind.verdict === 'OUT' ? 'good' : 'bad'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="Wind" size={12} /> {wind.caption}
          </span>
        )}
        {god.park != null && Math.abs(god.park - 1) >= 0.02 && (
          <span className={`god-fac ${god.park >= 1.05 ? 'good' : god.park <= 0.95 ? 'bad' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="Gauge" size={12} /> {signedPct(god.park - 1, 0)} park
          </span>
        )}
        <span className="god-fac" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="Award" size={12} style={{ color: 'var(--text-faint)' }} /> {god.primeStrong} PRIME/STRONG
        </span>
      </div>
      <div className="god-threats" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '14px' }}>
        <span className="god-threats-k dim" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top threats:</span>
        {god.threats.map((b) => (
          <button 
            key={b.id} 
            className="god-threat" 
            onClick={() => onSelect(b)} 
            style={{ 
              '--row-accent': gradeColor(b.grade?.label),
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${hexA(gradeColor(b.grade?.label), 0.25)}`,
              borderRadius: '6px',
              padding: '3px 8px',
              fontSize: '12px',
              color: '#fff',
              fontWeight: '600'
            }}
          >
            {lastName(b.name)} <span className="mono" style={{ color: gradeColor(b.grade?.label) }}>{pct(b.hrProbability, 1)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function GamesView({ games, batters, onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip, onOpenPitcher }) {
  const byGame = new Map()
  for (const b of batters) {
    if (!byGame.has(b.gamePk)) byGame.set(b.gamePk, { away: [], home: [] })
    byGame.get(b.gamePk)[b.isHome ? 'home' : 'away'].push(b)
  }

  const phase = (g) => (g.isLive ? 0 : g.isFinal ? 2 : 1)
  const ordered = games
    .filter((g) => {
      const grp = byGame.get(g.gamePk)
      return grp && grp.away.length + grp.home.length > 0
    })
    .sort((a, b) => phase(a) - phase(b) || new Date(a.gameDate) - new Date(b.gameDate))

  if (!ordered.length) {
    return (
      <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px', color: 'var(--text-faint)', gap: '12px' }}>
        <Icon name="Search" size={32} />
        <p>No batters match these filters.</p>
      </div>
    )
  }

  const ctx = { onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip, onOpenPitcher }
  const god = computeGameOfDay(batters)
  const [view, setView] = useState('extractor')

  return (
    <>
      <div className="games-controls" role="group" aria-label="Games view" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px' }}>
        <span className="games-controls-k dim" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>View Mode:</span>
        <button 
          className={`badge-toggle ${view === 'extractor' ? 'on' : ''}`} 
          onClick={() => setView('extractor')}
          style={{
            borderColor: view === 'extractor' ? 'var(--accent)' : 'var(--border-soft)',
            background: view === 'extractor' ? 'var(--hover)' : 'transparent',
            color: view === 'extractor' ? '#fff' : 'var(--text-faint)'
          }}
        >
          HR Extractor
        </button>
        <button 
          className={`badge-toggle ${view === 'detail' ? 'on' : ''}`} 
          onClick={() => setView('detail')}
          style={{
            borderColor: view === 'detail' ? 'var(--accent)' : 'var(--border-soft)',
            background: view === 'detail' ? 'var(--hover)' : 'transparent',
            color: view === 'detail' ? '#fff' : 'var(--text-faint)'
          }}
        >
          Detail Silos
        </button>
      </div>
      <GameOfDay god={god} onSelect={onSelect} onOpenPitcher={onOpenPitcher} />
      <div className="games-grid">
        {ordered.map((g, i) =>
          view === 'extractor' ? (
            <ExtractorCard key={g.gamePk} game={g} groups={byGame.get(g.gamePk)} idx={i} {...ctx} />
          ) : (
            <GameCard key={g.gamePk} game={g} groups={byGame.get(g.gamePk)} idx={i} {...ctx} />
          ),
        )}
      </div>
    </>
  )
}

function envAlert(bat, game) {
  if (!bat) return null
  const w = bat.weather
  const park = bat.gameParkHRFactor
  const env = bat.envScore
  const wind = w ? interpretWind(w, game?.homeTeam?.abbr, { roofClosed: w?.roofClosed }) : null
  const parts = []
  if (Number.isFinite(w?.tempF) && w.tempF >= 80) parts.push('warm air adds carry')
  if (wind?.verdict === 'OUT') parts.push(`wind out (${wind.caption})`)
  else if (wind?.verdict === 'IN') parts.push('wind holding it in')
  if (Number.isFinite(park) && park >= 1.08) parts.push("hitter's park")
  else if (Number.isFinite(park) && park <= 0.92) parts.push("pitcher's park")
  const tone = Number.isFinite(env) ? (env >= 78 ? 'good' : env <= 45 ? 'bad' : '') : ''
  const lead = !Number.isFinite(env) ? 'Environment' : env >= 78 ? 'Strong HR environment' : env >= 62 ? 'Above-average HR environment' : env <= 45 ? 'Suppressed HR environment' : 'Neutral environment'
  return { tone, text: parts.length ? `${parts.join(', ')}` : `${lead}.`, env }
}

function ExtractorCard({ game: g, groups, idx = 0, ...ctx }) {
  const awayC = teamColor(g.awayTeam?.id)
  const homeC = teamColor(g.homeTeam?.id)
  const all = [...(groups.away || []), ...(groups.home || [])]
    .filter((b) => (b.grade?.label || b.grade) !== 'SKIP')
    .sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        (b.hrProbability ?? 0) - (a.hrProbability ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    )
  const king = all[0]
  const target = all[1]
  const alert = envAlert(groups.away?.[0] || groups.home?.[0], g)
  if (!king) return null
  return (
    <section className="xcard" style={{ 
      '--i': Math.min(idx, 12),
      background: 'rgba(17, 18, 20, 0.45)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'var(--glass-shadow)',
      borderRadius: '16px',
      overflow: 'hidden'
    }}>
      <header
        className="xc-head"
        style={{ 
          background: `linear-gradient(100deg, ${hexToRgba(awayC, 0.15)}, transparent 45%, transparent 55%, ${hexToRgba(homeC, 0.15)})`,
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        <div className="xc-matchup">
          <span className="xc-teams" style={{ fontWeight: '800' }}>{g.awayTeam?.abbr} @ {g.homeTeam?.abbr}</span>
          <span className="xc-arms dim" style={{ fontSize: '11px', display: 'block', marginTop: '2px' }}>{g.awayPitcher?.name || 'TBD'} vs {g.homePitcher?.name || 'TBD'}</span>
        </div>
        <GameStatus g={g} />
      </header>
      <GameChips sample={groups.away?.[0] || groups.home?.[0]} game={g} />
      {alert && (
        <div className={`xc-alert ${alert.tone}`} style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          margin: '0 12px 12px',
          borderRadius: '8px',
          fontSize: '11px',
          fontWeight: '500',
          background: alert.tone === 'good' ? 'rgba(16, 185, 129, 0.08)' : alert.tone === 'bad' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.03)',
          color: alert.tone === 'good' ? 'var(--strong)' : alert.tone === 'bad' ? 'var(--bad)' : 'var(--text-dim)',
          border: alert.tone === 'good' ? '1px solid rgba(16, 185, 129, 0.15)' : alert.tone === 'bad' ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid rgba(255,255,255,0.05)'
        }}>
          <Icon name="TriangleAlert" size={11} />
          <span>{alert.text}</span>
        </div>
      )}
      <ExtractorBat b={king} rank="king" onSelect={ctx.onSelect} />
      {target && <ExtractorBat b={target} rank="target" onSelect={ctx.onSelect} />}
    </section>
  )
}

function ExtractorBat({ b, rank, onSelect }) {
  const reasons = (b.eli5Reasons || []).slice(0, 5)
  const isKing = rank === 'king'
  const color = gradeColor(b.grade?.label)
  return (
    <div className={`xc-bat ${rank}`} role="button" tabIndex={0} onClick={() => onSelect?.(b)} style={{
      borderLeft: `3px solid ${color}`,
      background: 'rgba(255,255,255,0.01)',
      borderBottom: !isKing ? 'none' : '1px solid rgba(255,255,255,0.03)'
    }}>
      <div className="xc-bat-head">
        <span className="xc-crown">{isKing ? '👑' : '🎯'}</span>
        <span className="xc-label" style={{ color: color, fontWeight: '700' }}>{isKing ? 'HR King' : 'Elite Target'}</span>
        <span className="xc-bat-name" style={{ fontWeight: '600', color: '#fff' }}>{b.name}</span>
        <span className="xc-bat-team dim">{b.team}{b.battingOrder ? ` · #${b.battingOrder}` : ''}</span>
        <span className="xc-bat-right">
          <span className="xc-bat-prob mono" style={{ color: color, fontWeight: '800' }}>{pct(b.hrProbability, 1)}</span>
          <GradeChip grade={b.grade} size="sm" score={b.score} />
        </span>
      </div>
      {reasons.length > 0 && (
        <ul className="xc-reasons">
          {reasons.map((r, i) => (
            <li key={i} className={`xc-reason tone-${r.tone}`}>
              <span className="xc-reason-ico" style={{ color: toneColor(r.tone) }}>
                <Icon name={eli5IconName(r.icon)} size={11} />
              </span>
              {r.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GameStatus({ g }) {
  const liveMode = useLiveMode()
  if (liveMode && g.isLive) {
    return (
      <div className="gc-status live" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--bad)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <span className="live-dot" />
        {(g.inningHalf || '').slice(0, 3)} {g.currentInning}
      </div>
    )
  }
  if (g.isFinal) return <div className="gc-status final" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-faint)' }}>Final</div>
  return <div className="gc-status" style={{ background: 'rgba(0, 216, 246, 0.08)', color: 'var(--accent)' }}>{gameTime(g.gameDate) || 'TBD'}</div>
}

function TeamHead({ team, pitcher, score, showScore, align, gamePk, onOpenPitcher }) {
  const color = teamColor(team?.id)
  const logo = teamLogo(team?.id)
  const canOpen = !!onOpenPitcher && pitcher?.id != null
  // Flash the score pill when a poll brings a higher score. Works because
  // GameCard is keyed by stable gamePk, so this instance survives refreshes.
  const prevScore = useRef(score)
  const [popped, setPopped] = useState(false)
  useEffect(() => {
    const scored = showScore && Number.isFinite(score) && Number.isFinite(prevScore.current) && score > prevScore.current
    prevScore.current = score
    if (scored) {
      setPopped(true)
      const t = setTimeout(() => setPopped(false), 1400)
      return () => clearTimeout(t)
    }
  }, [score, showScore])
  return (
    <div className={`gc-team ${align}`} style={{ '--tc': color }}>
      {logo && <img className="gc-logo" src={logo} alt={team?.name || ''} loading="lazy" style={{ width: '28px', height: '28px' }} />}
      <div className="gc-team-txt">
        <span className="gc-abbr" style={{ fontSize: '15px', fontWeight: '800' }}>{team?.abbr}</span>
        {canOpen ? (
          <button
            className="gc-pitcher pitch-link"
            onClick={() => onOpenPitcher(pitcher.id, gamePk)}
            title={`Open ${pitcher.name}'s pitcher card`}
            style={{
              color: 'var(--accent)',
              fontSize: '11px',
              borderBottom: '1px dashed rgba(0, 216, 246, 0.3)'
            }}
          >
            {pitcher.name}
          </button>
        ) : (
          <span className="gc-pitcher" style={{ fontSize: '11px' }}>{pitcher?.name || 'TBD'}</span>
        )}
      </div>
      {showScore && <span className={`gc-score mono${popped ? ' scored' : ''}`} style={{ fontSize: '18px', fontWeight: '800', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '6px' }}>{score ?? 0}</span>}
    </div>
  )
}

function GameCard({ game: g, groups, idx = 0, ...ctx }) {
  const liveMode = useLiveMode()
  const awayC = teamColor(g.awayTeam?.id)
  const homeC = teamColor(g.homeTeam?.id)
  const showScore = liveMode && (g.isLive || g.isFinal)
  return (
    <section className={`game-card ${g.isFinal ? 'final' : ''}`} style={{ 
      '--i': Math.min(idx, 12),
      background: 'rgba(17, 18, 20, 0.45)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'var(--glass-shadow)',
      borderRadius: '16px',
      overflow: 'hidden'
    }}>
      <header
        className="gc-head"
        style={{
          background: `linear-gradient(100deg, ${hexToRgba(awayC, 0.15)}, transparent 45%, transparent 55%, ${hexToRgba(homeC, 0.15)})`,
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        <TeamHead team={g.awayTeam} pitcher={g.awayPitcher} score={g.awayScore} showScore={showScore} align="left" gamePk={g.gamePk} onOpenPitcher={ctx.onOpenPitcher} />
        <div className="gc-center">
          <GameStatus g={g} />
          <span className="gc-venue" style={{ fontSize: '10px' }}>{g.venueName || ''}</span>
        </div>
        <TeamHead team={g.homeTeam} pitcher={g.homePitcher} score={g.homeScore} showScore={showScore} align="right" gamePk={g.gamePk} onOpenPitcher={ctx.onOpenPitcher} />
      </header>

      <GameChips sample={groups.away[0] || groups.home[0]} game={g} />

      <div className="gc-silos" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <Silo team={g.awayTeam} batters={groups.away} {...ctx} />
        <Silo team={g.homeTeam} batters={groups.home} {...ctx} />
      </div>
    </section>
  )
}

function GameChips({ sample, game }) {
  const w = sample?.weather
  const park = sample?.gameParkHRFactor
  if (!w && park == null) return null
  const chips = []
  if (w?.tempF != null) chips.push({ icon: 'Thermometer', text: `${Math.round(w.tempF)}°F` })
  // Wind: park-relative verdict (out = HR-friendly green, in = red) with an
  // arrow rotated to the actual blow direction (0deg = out to CF). Falls back
  // to the raw compass chip when we can't resolve the park orientation.
  const wind = w && !w.roofClosed ? interpretWind(w, game?.homeTeam?.abbr, { roofClosed: w.roofClosed }) : null
  if (wind) {
    chips.push({
      icon: 'ArrowUp',
      rot: wind.arrowRotation,
      text: `${Math.round(wind.mph)} ${wind.verdict === 'OUT' ? `out ${wind.side}` : wind.verdict === 'IN' ? 'in' : 'cross'}`,
      tone: wind.verdict === 'OUT' ? 'good' : wind.verdict === 'IN' ? 'bad' : '',
      title: wind.caption,
    })
  } else if (w?.windSpeedMph != null) {
    chips.push({ icon: 'Wind', text: `${Math.round(w.windSpeedMph)} ${compass(w.windDirDeg) || ''}`.trim() })
  }
  if (park != null)
    chips.push({ icon: 'Gauge', text: `${num(park, 2)}× park`, tone: park >= 1.05 ? 'good' : park <= 0.95 ? 'bad' : '' })
  if (w?.roofClosed) chips.push({ icon: 'House', text: 'Roof closed' })
  else if (w?.precipProbPct >= 40) chips.push({ icon: 'Droplet', text: `${w.precipProbPct}% rain` })
  if (!chips.length) return null
  return (
    <div className="gc-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '12px', background: 'rgba(0,0,0,0.1)' }}>
      {chips.map((c, i) => (
        <span className={`gc-chip ${c.tone || ''}`} key={i} title={c.title} style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          background: c.tone === 'good' ? 'rgba(16, 185, 129, 0.08)' : c.tone === 'bad' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.03)',
          color: c.tone === 'good' ? 'var(--strong)' : c.tone === 'bad' ? 'var(--bad)' : 'var(--text-dim)',
          border: c.tone === 'good' ? '1px solid rgba(16, 185, 129, 0.15)' : c.tone === 'bad' ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid rgba(255,255,255,0.05)',
          padding: '2px 8px',
          borderRadius: '6px'
        }}>
          <Icon name={c.icon} size={11} style={c.rot != null ? { transform: `rotate(${c.rot}deg)` } : undefined} />
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
    <div className="silo" style={{ '--tc': color, borderRight: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="silo-head" style={{ 
        background: hexToRgba(color, 0.12),
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.04)'
      }}>
        {logo && <img className="silo-logo" src={logo} alt={team?.abbr} loading="lazy" style={{ width: '18px', height: '18px' }} />}
        <span className="silo-team" style={{ color: '#fff', fontSize: '13px', fontWeight: '800' }}>
          {team?.abbr}
        </span>
        <span className="silo-count mono" style={{ fontSize: '11px', background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '4px', marginLeft: 'auto' }}>{batters.length}</span>
      </div>
      <div className="silo-body" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {batters.length === 0 ? (
          <div className="silo-empty" style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '12px' }}>No matching batters</div>
        ) : (
          batters.map((b) => <SiloBatter key={b.id} b={b} {...ctx} />)
        )}
      </div>
    </div>
  )
}

function SiloBatter({ b, onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip }) {
  const color = gradeColor(b.grade?.label)
  const watched = watchlist.has(b.id)
  const inSlip = slip.has(b.id)
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn(b)
  }
  const hrToday = useLiveMode() && b.liveContext?.isHRThisGame
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
      style={{ 
        '--row-accent': color,
        borderLeft: `2px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.02)',
        cursor: 'pointer',
        transition: 'background 0.15s'
      }}
    >
      <img className="sb-avatar" src={playerHeadshot(b.playerId, 96)} alt={b.name} loading="lazy" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', background: 'rgba(255,255,255,0.03)', marginRight: '10px' }} />
      <div className="sb-content" style={{ flex: '1', minWidth: '0' }}>
        <div className="sb-line1" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          {b.battingOrder ? <span className="sb-order mono" style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: '3px' }}>{b.battingOrder}</span> : null}
          <span className={`sb-name ${hrToday ? 'hr-glow' : ''}`} style={{ fontSize: '12px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
          <span className="bathand" style={{ fontSize: '9px', opacity: 0.6 }}>{b.batSide}</span>
          {hrToday && (
            <span className="hr-tag sm" title="Already homered" style={{ background: 'var(--b-hot)', color: '#000', borderRadius: '3px', padding: '1px 3px' }}>
              <Icon name="Flame" size={8} />
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
            <ProbRing value={b.hrProbability} color={color} size={36} />
          </div>
        </div>
        <div className="sb-line2" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
          <GradeChip grade={b.grade} size="sm" score={b.score} />
          {b.heatIndex >= HOT_HEAT && (
            <span className="sb-heat" title={`Heat index ${b.heatIndex}/100`} style={{ color: 'var(--b-hot)', display: 'inline-flex', alignItems: 'center', gap: '2px', fontWeight: '600' }}>
              <Icon name="Flame" size={10} />
              {b.heatIndex}
            </span>
          )}
          <span className="sb-acts" style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            <button 
              className={`act-btn star ${watched ? 'on' : ''}`} 
              onClick={stop(onToggleWatch)} 
              aria-label="Watch" 
              title={watched ? 'Unwatch' : 'Watch'}
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '4px',
                border: '1px solid var(--border-soft)',
                background: watched ? 'rgba(245,166,35,0.1)' : 'transparent',
                color: watched ? 'var(--prime)' : 'var(--text-faint)',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Icon name="Star" size={11} style={{ fill: watched ? 'currentColor' : 'none' }} />
            </button>
            <button 
              className={`act-btn add ${inSlip ? 'on' : ''}`} 
              onClick={stop(onToggleSlip)} 
              aria-label="Parlay" 
              title={inSlip ? 'In parlay' : 'Add to parlay'}
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '4px',
                border: '1px solid var(--border-soft)',
                background: inSlip ? 'rgba(16,185,129,0.1)' : 'transparent',
                color: inSlip ? 'var(--strong)' : 'var(--text-faint)',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Icon name={inSlip ? 'Check' : 'Plus'} size={11} />
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
