import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { GradeChip, ScoreRing, ProbBar, Stat } from './atoms.jsx'
import { groupPitchers, pitchUsage } from '../lib/pitchers.js'
import { pct, num, rate, gameTime } from '../lib/format.js'
import { teamColor, teamLogo, playerHeadshot, hexToRgba } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'

// Pitcher Plan — one card per starting pitcher: vulnerability verdict, the
// lineup ranked as HR targets, pitch mix, and splits + fatigue. Reads the
// already-filtered batter list so the board's filters narrow the pool.
export default function PitchersView({ batters, onSelect, selectedId, watchlist, slip }) {
  const pitchers = useMemo(() => groupPitchers(batters), [batters])
  if (!pitchers.length) {
    return <div className="empty-note">No pitchers match the current filters.</div>
  }
  return (
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

function PitcherCard({ entry, onSelect, selectedId, watchlist, slip }) {
  const { pitcher, vuln, targets, team, game } = entry
  const color = teamColor(team?.id)
  const logo = teamLogo(team?.id)
  const season = pitcher.season || {}
  const sav = pitcher.savant || {}
  const x = pitcher.xStats || {}
  const usage = pitchUsage(pitcher.pitchMix)
  const worst = pitcher.pitchMix?.worstPitch
  const vl = pitcher.splits?.vl
  const vr = pitcher.splits?.vr
  const pl3d = pitcher.recentForm?.pitchesL3D
  const hand = pitcher.hand ? `${pitcher.hand}HP` : null

  const matchup = game ? `${game.awayTeam?.abbr} @ ${game.homeTeam?.abbr}` : null
  const live = useLiveMode() && game?.isLive

  return (
    <section className="pcard" style={{ '--tc': color }}>
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
            {live ? <span className="pcard-live">LIVE</span> : game?.gameDate && <span className="dim"> · {gameTime(game.gameDate)}</span>}
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
                <span className="ptarget-name">
                  {b.name}
                  <span className="bathand">{b.batSide}</span>
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
