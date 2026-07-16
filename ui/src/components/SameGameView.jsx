import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { toast } from './Toast.jsx'
import { pct } from '../lib/format.js'
import { lastFirst, consistencyFactor, legFlags, legIsBad, risingForm } from '../lib/groups.js'
import { comboStatus, legStatus, VERDICT_META, LEG_META } from '../lib/live.js'
import { gradeFor, paWeight, isBenched } from '../lib/combo-engine.js'

const SIZES = [2, 3, 4]
const GRADE_COLOR = { S: '#d6b56f', A: '#69b99e', B: '#8587b7', C: '#9aa6b6', D: '#676673' }

// Same-Game Parlays: the best `size` bats from ONE game stacked together.
// Honors the same consistency lean as the combos page.
function buildSGP(batters, size, { favorConsistency, confirmedOnly = true } = {}) {
  // Rank by model score (grade quality) so an SGP stacks a game's best-graded
  // bats — the PRIME/STRONG studs you'd actually stack — matching the settled
  // SGP record (server buildSGPRecords). Tilt by the batting-order PA weight so
  // a top-of-order stud edges a comparable bat batting 8th. HR prob breaks ties.
  const rankVal = (b) => (b.score ?? 0) * paWeight(b.battingOrder) * (favorConsistency ? consistencyFactor(b) : 1)
  const legProb = (b) => (b.hrProbability ?? 0) * paWeight(b.battingOrder)
  const byGame = new Map()
  for (const b of batters || []) {
    // Show every game regardless of state (pregame / live / final).
    if ((b.grade?.label || 'SKIP') === 'SKIP') continue
    if (!Number.isFinite(b.hrProbability)) continue
    if (isBenched(b)) continue // confirmed lineup, no order slot — won't hit
    if (confirmedOnly && b.lineupConfirmed !== true) continue
    if (!byGame.has(b.gamePk)) byGame.set(b.gamePk, { gamePk: b.gamePk, game: b.game, parkHR: b.gameParkHRFactor, bats: [] })
    byGame.get(b.gamePk).bats.push(b)
  }
  const out = []
  for (const g of byGame.values()) {
    const legs = g.bats
      .slice()
      .sort((a, b) => rankVal(b) - rankVal(a) || (b.hrProbability ?? 0) - (a.hrProbability ?? 0) || String(a.id).localeCompare(String(b.id)))
      .slice(0, size)
    if (legs.length < size) continue
    const probs = legs.map(legProb)
    const comboIndep = probs.reduce((p, x) => p * x, 1) // independent baseline
    // Use the independent product until residual SGP correlation is validated.
    const combo = comboIndep
    const avg = legs.reduce((s, b) => s + (b.score ?? 0), 0) / legs.length
    // Weakness + lineup-confirmation (same guards as the combos page).
    const legInfo = legs.map((b) => { const flags = legFlags(b); return { flags, bad: legIsBad(b, flags), unconfirmed: b.lineupConfirmed !== true, rising: risingForm(b) } })
    const tone = legInfo.some((l) => l.bad) ? 'risk' : legInfo.some((l) => l.flags.length) ? 'caution' : 'tail'
    out.push({ ...g, legs, legInfo, combo, comboIndep, rho: 0, grade: gradeFor(avg), avg, tone })
  }
  return out.sort((a, b) => b.combo - a.combo || (a.gamePk ?? 0) - (b.gamePk ?? 0))
}

export default function SameGameView({ batters, onSelect, favorConsistency = false, comboConf = 'off', sgpScorecard = null }) {
  const [size, setSize] = useState(2)
  const [includeProjected, setIncludeProjected] = useState(false)
  const { confirmedSgps, allSgps } = useMemo(() => ({
    confirmedSgps: buildSGP(batters, size, { favorConsistency, confirmedOnly: true }),
    allSgps: buildSGP(batters, size, { favorConsistency, confirmedOnly: false }),
  }), [batters, size, favorConsistency])
  const sgps = includeProjected ? allSgps : confirmedSgps
  const projectedGames = Math.max(0, allSgps.length - confirmedSgps.length)
  const scOv = sgpScorecard?.overall
  return (
    <div className="sgp-view">
      {scOv && scOv.combos > 0 && (
        <div className="sgp-record" title="Settled same-game parlays graded against actual home runs.">
          <Icon name="Activity" size={13} />
          <span>SGP record · <b className="mono">{pct(scOv.hitRate, scOv.hitRate < 0.01 ? 1 : 0)}</b> cashed</span>
          <span className="dim">{scOv.allHit}/{scOv.combos} · {sgpScorecard.days}d</span>
          {scOv.hitRate < 0.03 && <span className="sgp-record-warn">long-shot bet</span>}
        </div>
      )}
      <p className="sgp-intro dim">
        Every leg must homer in the same game. The headline is the independent
        product of each calibrated leg rate, with no unvalidated correlation boost.
        Research projected stacks early, finalize after every lineup is posted, and treat three- and four-leg tickets as lottery plays.
      </p>
      <div className="sgp-mobile-brief">
        <Icon name="GitBranch" size={16} />
        <span>
          <b>Research early, confirm before betting.</b>
          <small>Independent estimate · every leg must homer</small>
        </span>
      </div>
      <div className="sgp-size-bar">
        <span className="sgp-size-label">Ticket size</span>
        <div className="grp-controls" role="group" aria-label="Legs per SGP">
          {SIZES.map((s) => (
            <button type="button" key={s} className={`badge-toggle ${size === s ? 'on' : ''}`} onClick={() => setSize(s)} aria-pressed={size === s}>
              {s}-leg
            </button>
          ))}
        </div>
      </div>
      <div className="sgp-lineup-policy">
        <span>
          <Icon name={includeProjected ? 'Clock3' : 'UserRoundCheck'} size={15} />
          <span>
            <b>{includeProjected ? 'Projected lineups included' : 'Action-ready lineups only'}</b>
            <small>{includeProjected ? 'Preview mode · verify before betting' : 'Safer default · starters verified'}</small>
          </span>
        </span>
        <button
          type="button"
          onClick={() => setIncludeProjected((value) => !value)}
          aria-pressed={includeProjected}
        >
          {includeProjected ? 'Hide projections' : `Show projections${projectedGames ? ` ${projectedGames}` : ''}`}
        </button>
      </div>
      <div className="sgp-mobile-list-meta">
        <span><b className="mono">{sgps.length}</b> games</span>
        <span>Best all-hit first</span>
      </div>
      {sgps.length === 0 ? (
        <div className="empty-note">
          {includeProjected
            ? `No game has ${size} eligible bats right now.`
            : `No fully action-ready ${size}-leg SGPs yet. Use Show projections only for an early preview.`}
        </div>
      ) : (
        <div className="grp-list">
          {sgps.map((g, idx) => {
            const c = GRADE_COLOR[g.grade]
            const matchup = g.game ? `${g.game.awayTeam?.abbr} @ ${g.game.homeTeam?.abbr}` : `Game ${g.gamePk}`
            const live = comboStatus(g.legs)
            const lv = VERDICT_META[live.code]
            const cashed = live.started && g.legs.length > 0 && live.hits >= g.legs.length
            return (
              <section className={`grp-card grp-ticket-card sgp-card sgp-ticket-card tone-${g.tone}${cashed ? ' cashed' : ''}`} data-size={size} key={g.gamePk} style={{ '--gc': c, '--i': Math.min(idx, 8) }} title={cashed ? 'Cashed — every leg homered' : undefined}>
                <header className="grp-head sgp-card-head">
                  <div className="sgp-card-title">
                    <span className="grp-legbadge">{size}-LEG SGP</span>
                    <span className="grp-strategy">
                      {matchup}
                      {g.parkHR != null && <span className="dim"> · park {g.parkHR.toFixed(2)}×</span>}
                    </span>
                  </div>
                  <div className="sgp-card-state">
                  {live.started ? (
                    <span className="grp-live-tag" title={`Live: ${live.hits}/${live.n} legs homered`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', color: lv.color, background: `color-mix(in srgb, ${lv.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${lv.color} 35%, transparent)`, borderRadius: '5px', padding: '1px 6px' }}>
                      <Icon name={lv.icon} size={10} className={live.code === 'live' ? 'spin-pulse' : ''} /> {lv.label} {live.hits}/{live.n}
                    </span>
                  ) : (
                    <span className="grp-locked-tag"><Icon name="Lock" size={10} /> LOCKED</span>
                  )}
                  {comboConf === 'percent' && <span className="grp-conf pct">{pct(g.combo, g.combo < 0.01 ? 2 : 1)}</span>}
                  <span className={`grp-grade grade-glow-${g.grade}`} style={{ color: c, borderColor: c }}>{g.grade}</span>
                  </div>
                  <button
                    type="button"
                    className="grp-copy sgp-copy"
                    title="Copy this SGP as text"
                    onClick={(e) => {
                      e.stopPropagation()
                      const legsTxt = g.legs.map((b) => lastFirst(b.name).split(',')[0]).join(' + ')
                      const line = `${size}-leg SGP ${matchup}: ${legsTxt} — independent all-hit ≈ ${pct(g.combo, g.combo < 0.01 ? 2 : 1)} (StatFax)`
                      navigator.clipboard?.writeText(line).then(() => toast.success('SGP copied')).catch(() => toast.warn('Copy failed'))
                    }}
                  >
                    <Icon name="Copy" size={12} />
                  </button>
                </header>
                <div className="grp-ticket-summary sgp-ticket-summary">
                  <span className="grp-ticket-price">
                    <small className="grp-ticket-kicker">All-hit chance</small>
                    <strong className="mono">{pct(g.combo, g.combo < 0.01 ? 2 : 1)}</strong>
                  </span>
                  <span className="grp-ticket-return sgp-ticket-method">
                    <span>Same-game model</span>
                    <b>Independent</b>
                    <small>No correlation uplift</small>
                  </span>
                </div>
                <ul className="grp-legs">
                  {g.legs.map((b, i) => {
                    const info = g.legInfo[i]
                    const st = legStatus(b)
                    const sm = LEG_META[st.code]
                    return (
                      <li
                        className={`sgp-leg ${info.bad ? 'weak-leg' : ''}`}
                        key={b.id}
                        onClick={() => onSelect(b)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onSelect(b)
                          }
                        }}
                        role="button"
                        tabIndex={0}
                        style={st.code === 'hit' ? { background: 'color-mix(in srgb, var(--strong) 7%, transparent)' } : st.code === 'dead' ? { opacity: 0.6 } : undefined}
                      >
                        <span className="sgp-leg-ord mono">{i + 1}</span>
                        <div className="sgp-leg-body">
                          <span className="sgp-leg-name">{b.name}</span>
                          {st.code !== 'pending' && (
                            <span className="grp-chip" style={{ color: sm.color, background: `color-mix(in srgb, ${sm.color} 12%, transparent)`, borderColor: 'transparent' }} title={st.code === 'hit' ? 'Homered' : st.code === 'dead' ? 'Game final — no HR' : 'Game in progress'}>
                              <Icon name={sm.icon} size={10} className={st.code === 'live' ? 'spin-pulse' : ''} /> {st.code === 'hit' ? 'HR' : st.code === 'dead' ? 'no HR' : st.label}
                            </span>
                          )}
                          {info.unconfirmed && <span className="grp-chip unconf"><Icon name="Clock" size={10} /> NO LINEUP</span>}
                          {info.rising && <span className="grp-chip rising" title={`Rising — L14 barrel ${info.rising.recent.toFixed(0)}% vs ${info.rising.season.toFixed(0)}% season (+${info.rising.delta.toFixed(0)} pts)`}><Icon name="TrendingUp" size={10} /> RISING</span>}
                          {info.bad && <span className="grp-chip weak" title={info.flags.join(' · ') || 'long-shot HR%'}><Icon name="TriangleAlert" size={10} /> WEAK</span>}
                        </div>
                        <GradeChip grade={b.grade} score={b.score} size="sm" />
                        <span className="sgp-leg-prob mono">{pct(b.hrProbability, 2)}</span>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
