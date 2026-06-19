import { useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip, BadgeRow, ProbBar, ProbRing } from './atoms.jsx'
import { teamColor, teamLogo, hexToRgba, readableOn, playerHeadshot } from '../lib/teams.js'
import { pct, num, gameTime, signedPct } from '../lib/format.js'
import { gradeColor, eli5IconName, toneColor } from '../lib/badges.js'
import { HOT_HEAT } from '../lib/constants.js'
import { compass } from '../lib/weather.js'
import { interpretWind } from '../lib/wind.js'
import { useLiveMode } from '../lib/liveMode.js'

const lastName = (n) => (n || '').trim().split(/\s+/).slice(-1)[0]

// Game of the Day — the best HR environment on the slate, cross-checking
// everything at once. Ranks games by total expected HRs (the model's xHR already
// bakes in the pitcher matchup, park, and weather), then surfaces the WHY: both
// starters' HR/9, the wind/park, the PRIME/STRONG count, and the top threats.
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
  // A home batter faces the AWAY starter and vice-versa, so pull both starters
  // (with full season stats) off the batters' pitcher field.
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
    <button className="god-pitcher" onClick={() => onOpenPitcher?.(p.id, gamePk)} title={`${p.name} — open pitcher card`}>
      {lastName(p.name)} {hr9 != null && <b className={tone}>{num(hr9, 2)}</b>}
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
    <section className="god-card">
      <div className="god-head">
        <span className="god-kicker">
          <Icon name="Flame" size={14} /> Game of the Day
        </span>
        <span className="god-xhr mono">
          {num(god.xhr, 1)} <em>exp HR</em>
        </span>
      </div>
      <div className="god-matchup">
        <b>
          {away} @ {home}
        </b>
        {g?.venueName ? ` · ${g.venueName}` : ''}
        {g?.gameDate ? ` · ${gameTime(g.gameDate)}` : ''}
      </div>
      <div className="god-factors">
        <span className="god-fac" title="Both starters' HR allowed per 9 — higher = more hittable">
          <Icon name="Shield" size={12} /> vs <GodPitcher p={god.awayPitcher} onOpenPitcher={onOpenPitcher} gamePk={god.gamePk} />
          <span className="god-amp">·</span>
          <GodPitcher p={god.homePitcher} onOpenPitcher={onOpenPitcher} gamePk={god.gamePk} /> HR/9
        </span>
        {wind && wind.verdict !== 'CROSS' && (
          <span className={`god-fac ${wind.verdict === 'OUT' ? 'good' : 'bad'}`}>
            <Icon name="Wind" size={12} /> {wind.caption}
          </span>
        )}
        {god.park != null && Math.abs(god.park - 1) >= 0.02 && (
          <span className={`god-fac ${god.park >= 1.05 ? 'good' : god.park <= 0.95 ? 'bad' : ''}`}>
            <Icon name="Gauge" size={12} /> {signedPct(god.park - 1, 0)} park
          </span>
        )}
        <span className="god-fac">
          <Icon name="Award" size={12} /> {god.primeStrong} PRIME/STRONG
        </span>
      </div>
      <div className="god-threats">
        <span className="god-threats-k dim">Top threats</span>
        {god.threats.map((b) => (
          <button key={b.id} className="god-threat" onClick={() => onSelect(b)} style={{ '--row-accent': gradeColor(b.grade?.label) }}>
            {lastName(b.name)} <span className="mono">{pct(b.hrProbability, 2)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

export default function GamesView({ games, batters, onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip, onOpenPitcher }) {
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

  const ctx = { onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip, onOpenPitcher }
  const god = computeGameOfDay(batters)
  const [view, setView] = useState('extractor') // 'extractor' = HR King/Target cards · 'detail' = full silos
  return (
    <>
      <div className="games-controls" role="group" aria-label="Games view">
        <span className="games-controls-k dim">View</span>
        <button className={`badge-toggle ${view === 'extractor' ? 'on' : ''}`} onClick={() => setView('extractor')}>HR Extractor</button>
        <button className={`badge-toggle ${view === 'detail' ? 'on' : ''}`} onClick={() => setView('detail')}>Detail</button>
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

// Per-game environment-alert line composed from the real env signals.
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
  return { tone, text: parts.length ? `${lead} — ${parts.join(', ')}.` : `${lead}.`, env }
}

// "Lineup HR Extractor" card — per game, crowns the top bat (HR King) and the
// second (Elite Target) with their full eli5 reasons + an environment alert.
function ExtractorCard({ game: g, groups, idx = 0, ...ctx }) {
  const awayC = teamColor(g.awayTeam?.id)
  const homeC = teamColor(g.homeTeam?.id)
  // Combined lineup, best HR threats first (batters arrive pre-sorted by score).
  const all = [...(groups.away || []), ...(groups.home || [])]
    .filter((b) => (b.grade?.label || b.grade) !== 'SKIP')
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.hrProbability ?? 0) - (a.hrProbability ?? 0))
  const king = all[0]
  const target = all[1]
  const alert = envAlert(groups.away?.[0] || groups.home?.[0], g)
  if (!king) return null
  return (
    <section className="xcard" style={{ '--i': Math.min(idx, 12) }}>
      <header
        className="xc-head"
        style={{ background: `linear-gradient(100deg, ${hexToRgba(awayC, 0.22)}, transparent 42%, transparent 58%, ${hexToRgba(homeC, 0.22)})` }}
      >
        <div className="xc-matchup">
          <span className="xc-teams">{g.awayTeam?.abbr} @ {g.homeTeam?.abbr}</span>
          <span className="xc-arms dim">{g.awayPitcher?.name || 'TBD'} vs {g.homePitcher?.name || 'TBD'}</span>
        </div>
        <GameStatus g={g} />
      </header>
      <GameChips sample={groups.away?.[0] || groups.home?.[0]} />
      {alert && (
        <div className={`xc-alert ${alert.tone}`}>
          <Icon name="TriangleAlert" size={12} /> {alert.text}
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
  return (
    <div className={`xc-bat ${rank}`} role="button" tabIndex={0} onClick={() => onSelect?.(b)}>
      <div className="xc-bat-head">
        <span className="xc-crown">{isKing ? '👑' : '🔥'}</span>
        <span className="xc-label">{isKing ? 'HR King' : 'Elite Target'}</span>
        <span className="xc-bat-name">{b.name}</span>
        <span className="xc-bat-team dim">{b.team}{b.battingOrder ? ` · #${b.battingOrder}` : ''}</span>
        <span className="xc-bat-right">
          <span className="xc-bat-prob mono">{pct(b.hrProbability, 1)}</span>
          <GradeChip grade={b.grade} size="sm" score={b.score} />
        </span>
      </div>
      {reasons.length > 0 && (
        <ul className="xc-reasons">
          {reasons.map((r, i) => (
            <li key={i} className={`xc-reason tone-${r.tone}`}>
              <span className="xc-reason-ico" style={{ color: toneColor(r.tone) }}>
                <Icon name={eli5IconName(r.icon)} size={12} />
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
      <div className="gc-status live">
        <span className="live-dot" />
        {(g.inningHalf || '').slice(0, 3)} {g.currentInning}
      </div>
    )
  }
  if (g.isFinal) return <div className="gc-status final">Final</div>
  return <div className="gc-status">{gameTime(g.gameDate) || 'TBD'}</div>
}

function TeamHead({ team, pitcher, score, showScore, align, gamePk, onOpenPitcher }) {
  const color = teamColor(team?.id)
  const logo = teamLogo(team?.id)
  const canOpen = !!onOpenPitcher && pitcher?.id != null
  return (
    <div className={`gc-team ${align}`} style={{ '--tc': color }}>
      {logo && <img className="gc-logo" src={logo} alt={team?.name || ''} loading="lazy" />}
      <div className="gc-team-txt">
        <span className="gc-abbr">{team?.abbr}</span>
        {canOpen ? (
          <button
            className="gc-pitcher pitch-link"
            onClick={() => onOpenPitcher(pitcher.id, gamePk)}
            title={`Open ${pitcher.name}'s pitcher card`}
          >
            {pitcher.name}
          </button>
        ) : (
          <span className="gc-pitcher">{pitcher?.name || 'TBD'}</span>
        )}
      </div>
      {showScore && <span className="gc-score mono">{score ?? 0}</span>}
    </div>
  )
}

function GameCard({ game: g, groups, idx = 0, ...ctx }) {
  const liveMode = useLiveMode()
  const awayC = teamColor(g.awayTeam?.id)
  const homeC = teamColor(g.homeTeam?.id)
  const showScore = liveMode && (g.isLive || g.isFinal)
  return (
    <section className={`game-card ${g.isFinal ? 'final' : ''}`} style={{ '--i': Math.min(idx, 12) }}>
      <header
        className="gc-head"
        style={{
          background: `linear-gradient(100deg, ${hexToRgba(awayC, 0.22)}, transparent 42%, transparent 58%, ${hexToRgba(homeC, 0.22)})`,
        }}
      >
        <TeamHead team={g.awayTeam} pitcher={g.awayPitcher} score={g.awayScore} showScore={showScore} align="left" gamePk={g.gamePk} onOpenPitcher={ctx.onOpenPitcher} />
        <div className="gc-center">
          <GameStatus g={g} />
          <span className="gc-venue">{g.venueName || ''}</span>
        </div>
        <TeamHead team={g.homeTeam} pitcher={g.homePitcher} score={g.homeScore} showScore={showScore} align="right" gamePk={g.gamePk} onOpenPitcher={ctx.onOpenPitcher} />
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
        {logo && <img className="silo-logo" src={logo} alt={`${team?.name || team?.abbr || ''} logo`} loading="lazy" />}
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
      style={{ '--row-accent': color }}
    >
      <img className="sb-avatar" src={playerHeadshot(b.playerId, 96)} alt={b.name} loading="lazy" />
      <div className="sb-content">
        <div className="sb-line1">
          {b.battingOrder ? <span className="sb-order mono">{b.battingOrder}</span> : <span className="sb-order mono dim">–</span>}
          <span className={`sb-name ${hrToday ? 'hr-glow' : ''}`}>{b.name}</span>
          <span className="bathand">{b.batSide}</span>
          {hrToday && (
            <span className="hr-tag sm" title="Already homered">
              <Icon name="Flame" size={9} />
            </span>
          )}
          <ProbRing value={b.hrProbability} color={color} size={42} />
        </div>
        <div className="sb-line2">
          <GradeChip grade={b.grade} size="sm" score={b.score} />
          {b.heatIndex >= HOT_HEAT && (
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
