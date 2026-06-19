import { useMemo, useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip, ScoreRing, ProbBar, Stat } from './atoms.jsx'
import { groupPitchers, pitchUsage, effSide } from '../lib/pitchers.js'
import { pct, num, rate, gameTime } from '../lib/format.js'
import { teamColor, teamLogo, playerHeadshot, hexToRgba } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'

const PSORT = [
  { k: 'vuln', label: 'Most hittable' },
  { k: 'time', label: 'Game time' },
]

// Pitcher Plan — one card per starting pitcher: vulnerability verdict, the
// lineup ranked as HR targets, pitch mix, and splits + fatigue. Reads the
// already-filtered batter list so the board's filters narrow the pool.
export default function PitchersView({ batters, onSelect, selectedId, watchlist, slip, focusKey, onFocusDone }) {
  const [sort, setSort] = useState('vuln')
  const [view, setView] = useState('preview') // 'preview' = tiered vulnerability board · 'detail' = full cards
  const grouped = useMemo(() => groupPitchers(batters), [batters])
  // 'vuln' = groupPitchers' default (most hittable first). 'time' = by game
  // start, which also puts both starters of a game next to each other; ties
  // within a game fall back to vulnerability.
  const pitchers = useMemo(() => {
    if (sort !== 'time') return grouped
    return [...grouped].sort(
      (a, b) =>
        (a.game?.gameDate || '￿').localeCompare(b.game?.gameDate || '￿') ||
        (b.vuln?.score ?? 0) - (a.vuln?.score ?? 0),
    )
  }, [grouped, sort])

  // When arriving from a batter's "Opposing pitcher" link, scroll that card into
  // view and flash it. Runs after the cards mount; clears the focus once done.
  useEffect(() => {
    if (!focusKey) return
    const el = document.getElementById(`pcard-${focusKey}`)
    if (el) {
      const t = setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add('flash')
        setTimeout(() => el.classList.remove('flash'), 1600)
      }, 60)
      onFocusDone?.()
      return () => clearTimeout(t)
    }
    onFocusDone?.()
  }, [focusKey, pitchers, onFocusDone])

  if (!pitchers.length) {
    return <div className="empty-note">No pitchers match the current filters.</div>
  }
  return (
    <>
      <div className="pitchers-controls" role="group" aria-label="Pitcher view">
        <span className="pitchers-controls-k dim">View</span>
        <button className={`badge-toggle ${view === 'preview' ? 'on' : ''}`} onClick={() => setView('preview')}>Vulnerability</button>
        <button className={`badge-toggle ${view === 'detail' ? 'on' : ''}`} onClick={() => setView('detail')}>Detail</button>
        {view === 'detail' && (
          <>
            <span className="pitchers-controls-k dim" style={{ marginLeft: 8 }}>Sort</span>
            {PSORT.map((t) => (
              <button key={t.k} className={`badge-toggle ${sort === t.k ? 'on' : ''}`} onClick={() => setSort(t.k)}>
                {t.label}
              </button>
            ))}
          </>
        )}
      </div>
      {view === 'preview' ? (
        <PitcherPreview pitchers={grouped} onSelect={onSelect} />
      ) : (
        <div className="pitchers">
          {pitchers.map((e) => (
            <PitcherCard
              key={e.key}
              entry={e}
              onSelect={onSelect}
              selectedId={selectedId}
              watchlist={watchlist}
              slip={slip}
            />
          ))}
        </div>
      )}
    </>
  )
}

// Tiered "Pitcher Vulnerability preview" — starters grouped by how hittable they
// are, one tight row each: stat cell (HR/9 · Barrel% · EV · GB-AO) + the bats
// that match up best. Reuses the vuln score + targets the cards already compute.
const PVP_TIERS = [
  { key: 'vuln', label: 'Tier 1 — most hittable', sub: 'attack this side', color: '#FF453A', test: (s) => s >= 80 },
  { key: 'shaky', label: 'Tier 2 — shaky', sub: 'solid targets', color: '#FF9F0A', test: (s) => s >= 60 && s < 80 },
  { key: 'mild', label: 'Mild', sub: 'situational', color: '#FFD60A', test: (s) => s >= 40 && s < 60 },
  { key: 'tough', label: 'Tough — don’t target', sub: 'talent plays only', color: '#32D74B', test: (s) => s < 40 },
]
function lastName(name) {
  const p = (name || '').trim().split(/\s+/)
  return p.length > 1 ? p.slice(1).join(' ') : name || ''
}
function PitcherPreview({ pitchers, onSelect }) {
  const tbd = pitchers.filter((e) => !Number.isFinite(e.pitcher?.season?.hrPer9))
  const scored = pitchers.filter((e) => Number.isFinite(e.pitcher?.season?.hrPer9))
  return (
    <div className="pvp">
      <div className="pvp-cap dim">
        Starters by HR-vulnerability · stat cell: HR/9 · Barrel% allowed · EV against · GB-AO. Matching bats = best HR targets (PRIME in bold).
      </div>
      {PVP_TIERS.map((t) => {
        const rows = scored.filter((e) => t.test(e.vuln?.score ?? 50))
        if (!rows.length) return null
        return (
          <div className="pvp-tier" key={t.key}>
            <div className="pvp-tier-head">
              <span className="pvp-dot" style={{ background: t.color }} />
              <b>{t.label}</b> <span className="dim">· {t.sub}</span>
              <span className="pvp-tier-n dim">{rows.length}</span>
            </div>
            {rows.map((e) => <PvpRow key={e.key} e={e} onSelect={onSelect} />)}
          </div>
        )
      })}
      {tbd.length > 0 && (
        <div className="pvp-tier">
          <div className="pvp-tier-head">
            <span className="pvp-dot" style={{ background: '#6b7787' }} />
            <b>TBD / low sample</b> <span className="dim">· treat league-avg, don’t target</span>
          </div>
          <div className="pvp-tbd dim">{tbd.map((e) => `${e.pitcher.name} (${e.targets[0]?.team || '?'})`).join(' · ')}</div>
        </div>
      )}
    </div>
  )
}
function PvpRow({ e, onSelect }) {
  const p = e.pitcher
  const s = p.season || {}
  const sav = p.savant || {}
  const atk = e.attackSide === 'L' ? 'LHB' : e.attackSide === 'R' ? 'RHB' : '—'
  const seen = new Set()
  const tg = e.targets.filter((b) => b.playerId != null && !seen.has(b.playerId) && seen.add(b.playerId)).slice(0, 4)
  const oppTeam = tg[0]?.team || '?'
  return (
    <div className="pvp-row">
      <div className="pvp-p">
        <span className="pvp-name">{p.name}</span>
        <span className="pvp-hand dim"> ({p.hand})</span>
        <span className="pvp-vs dim"> vs {oppTeam} · <b style={{ color: 'var(--text-dim)' }}>{atk}</b></span>
      </div>
      <div className="pvp-stats mono">
        <span><b className={tone(s.hrPer9, { hi: 1.4, lo: 0.9 }) === HITTABLE ? 'pvp-hi' : ''}>{num(s.hrPer9, 2)}</b> HR/9</span>
        <span><b>{sav.barrelPctAllowed != null ? num(sav.barrelPctAllowed, 1) : '—'}</b> brl</span>
        <span><b>{sav.exitVeloAgainst != null ? num(sav.exitVeloAgainst, 1) : '—'}</b> EV</span>
        <span><b>{Number.isFinite(s.goAo) ? num(s.goAo, 2) : '—'}</b> GB/AO</span>
      </div>
      <div className="pvp-bats">
        {tg.map((b) => (
          <button
            key={b.playerId}
            className={`pvp-bat ${(b.grade?.label || b.grade) === 'PRIME' ? 'prime' : ''}`}
            onClick={() => onSelect?.(b)}
            title={`${b.name} · ${pct(b.hrProbability, 1)} HR`}
          >
            {lastName(b.name)}
          </button>
        ))}
      </div>
    </div>
  )
}

// Tone token for a pitcher stat from the HR-hunter's POV: 'bad' (red) = hittable
// (good target), 'good' (green) = tough. Mirrors the vulnerability grade colors.
// These are the tokens Stat's toneColor() understands.
const HITTABLE = 'bad'
const TOUGH = 'good'
function tone(value, { hi, lo, invert = false }) {
  if (value == null || Number.isNaN(value)) return undefined
  const hot = value >= hi
  const cold = value <= lo
  if (!hot && !cold) return undefined
  // invert=true means a HIGH value is good for the pitcher (e.g. K/9).
  return (invert ? cold : hot) ? HITTABLE : TOUGH
}

export function PitcherCard({ entry, onSelect, selectedId, watchlist, slip }) {
  const { pitcher, vuln, targets, team, game, attackSide } = entry
  const color = teamColor(team?.id)
  const logo = teamLogo(team?.id)
  const season = pitcher.season || {}
  const sav = pitcher.savant || {}
  const x = pitcher.xStats || {}
  const usage = pitchUsage(pitcher.pitchMix)
  const worst = pitcher.pitchMix?.worstPitch
  const vl = pitcher.splits?.vl
  const vr = pitcher.splits?.vr
  const lH = vl?.hrPer9
  const rH = vr?.hrPer9
  const pl3d = pitcher.recentForm?.pitchesL3D
  const hand = pitcher.hand ? `${pitcher.hand}HP` : null

  const matchup = game ? `${game.awayTeam?.abbr} @ ${game.homeTeam?.abbr}` : null
  const liveMode = useLiveMode()
  const live = liveMode && game?.isLive
  const isFinal = game?.isFinal

  return (
    <section id={`pcard-${entry.key}`} className={`pcard ${isFinal ? 'final' : ''}`} style={{ '--tc': color }}>
      <div className="pcard-accent" style={{ background: hexToRgba(color, 0.5) }} />

      {/* Header */}
      <header className="pcard-head">
        <img className="pcard-photo" src={playerHeadshot(pitcher.id, 96)} alt={pitcher.name} loading="lazy" />
        <div className="pcard-id">
          <div className="pcard-name">{pitcher.name}</div>
          <div className="pcard-sub">
            {logo && <img className="pcard-logo" src={logo} alt="" loading="lazy" />}
            {team?.abbr}
            {hand && <span className="pcard-hand">{hand}</span>}
            {matchup && <span className="dim"> · {matchup}</span>}
            {live ? <span className="pcard-live">LIVE</span> : isFinal ? <span className="final-tag">FINAL</span> : game?.gameDate && <span className="dim"> · {gameTime(game.gameDate)}</span>}
          </div>
        </div>
        <div className="pcard-vuln">
          <ScoreRing score={vuln?.score ?? 0} color={vuln?.grade?.color} size={62} />
          <span className="pcard-vgrade" style={{ color: vuln?.grade?.color }}>
            {vuln?.grade?.label}
          </span>
        </div>
      </header>

      {/* Driver stats */}
      <div className="pcard-stats">
        <Stat label="HR/9" value={num(season.hrPer9, 2)} tone={tone(season.hrPer9, { hi: 1.4, lo: 0.9 })} />
        <Stat label="K/9" value={num(season.kPer9, 1)} tone={tone(season.kPer9, { hi: 10, lo: 6.5, invert: true })} />
        <Stat label="ERA" value={num(season.era, 2)} tone={tone(season.era, { hi: 4.6, lo: 3.0 })} />
        <Stat label="Barrel%" value={sav.barrelPctAllowed != null ? num(sav.barrelPctAllowed, 1) : '—'} tone={tone(sav.barrelPctAllowed, { hi: 9, lo: 6 })} />
        <Stat label="EV against" value={sav.exitVeloAgainst != null ? `${num(sav.exitVeloAgainst, 1)}` : '—'} tone={tone(sav.exitVeloAgainst, { hi: 90, lo: 87 })} />
        <Stat
          label={Number.isFinite(x.xEra) ? 'xERA' : 'xwOBA'}
          value={Number.isFinite(x.xEra) ? num(x.xEra, 2) : Number.isFinite(x.xwOba) ? rate(x.xwOba) : '—'}
        />
      </div>

      {attackSide && (
        <div className="pcard-attack">
          <span className="pa-cap">
            <Icon name="Crosshair" size={12} /> Attack with
          </span>
          <span className={`pa-hand ${attackSide === 'L' ? 'on' : ''}`}>
            LHB <b className="mono">{lH != null ? num(lH, 2) : '—'}</b>
          </span>
          <span className={`pa-hand ${attackSide === 'R' ? 'on' : ''}`}>
            RHB <b className="mono">{rH != null ? num(rH, 2) : '—'}</b>
          </span>
          <span className="pa-unit dim">HR/9</span>
        </div>
      )}

      <div className="pcard-cols">
        {/* Top HR targets */}
        <div className="pcard-targets">
          <h4 className="pcard-h4">
            <Icon name="Crosshair" size={13} /> Top HR targets
          </h4>
          <ul className="ptarget-list">
            {targets.slice(0, 8).map((b) => (
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
                  <span
                    className={`bathand ${attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'pa-match' : ''}`}
                    title={attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'On the attack side' : undefined}
                  >
                    {b.batSide}
                  </span>
                  {watchlist?.has(b.id) && <Icon name="Star" size={10} />}
                  {slip?.has(b.id) && <Icon name="Plus" size={10} />}
                  {b.h2h?.ab > 0 && (
                    <span className="ptarget-h2h dim" title="Career vs this pitcher">
                      {b.h2h.hr}HR/{b.h2h.ab}AB
                    </span>
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

        {/* Pitch mix + splits/fatigue */}
        <div className="pcard-side">
          {usage.length > 0 && (
            <div className="pcard-mix">
              <h4 className="pcard-h4">
                <Icon name="Layers" size={13} /> Pitch mix
              </h4>
              {usage.map((p) => (
                <div className="mix-row" key={p.code}>
                  <span className="mix-label">{p.label}</span>
                  <span className="mix-track">
                    <span className="mix-fill" style={{ width: `${Math.min(100, p.pct)}%` }} />
                  </span>
                  <span className="mix-pct mono">{num(p.pct, 0)}%</span>
                </div>
              ))}
              {worst?.name && (
                <div className="mix-worst">
                  <Icon name="Flame" size={12} /> Most hittable: <b>{worst.name}</b>
                  {Number.isFinite(worst.rv) && <span className="dim"> ({worst.rv > 0 ? '+' : ''}{num(worst.rv, 1)} rv)</span>}
                </div>
              )}
            </div>
          )}

          {(vl || vr || Number.isFinite(pl3d)) && (
            <div className="pcard-splits">
              <h4 className="pcard-h4">
                <Icon name="BarChart3" size={13} /> Splits &amp; workload
              </h4>
              <div className="split-grid">
                <Stat label="vs LHB HR/9" value={num(vl?.hrPer9, 2)} sub={vl?.avg != null ? rate(vl.avg) : null} tone={tone(vl?.hrPer9, { hi: 1.4, lo: 0.9 })} />
                <Stat label="vs RHB HR/9" value={num(vr?.hrPer9, 2)} sub={vr?.avg != null ? rate(vr.avg) : null} tone={tone(vr?.hrPer9, { hi: 1.4, lo: 0.9 })} />
                {Number.isFinite(pl3d) && (
                  <Stat
                    label="Pitches (3d)"
                    value={num(pl3d, 0)}
                    sub={pl3d >= 80 ? 'heavy' : pl3d >= 50 ? 'some work' : 'fresh'}
                    tone={pl3d >= 80 ? HITTABLE : undefined}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
