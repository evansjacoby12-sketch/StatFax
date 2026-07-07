import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { toast } from './Toast.jsx'
import { pct, num } from '../lib/format.js'
import { lastFirst, consistencyFactor, legFlags, legIsBad, risingForm } from '../lib/groups.js'
import { correlatedJoint, gameCorrelation } from '../lib/parlay.js'
import { comboStatus, legStatus, VERDICT_META, LEG_META } from '../lib/live.js'
import { gradeFor, paWeight, isBenched } from '../lib/combo-engine.js'

const SIZES = [2, 3, 4]
const GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }

// Stars from leg strength minus caution/weak penalty (mirrors the combos page).
function sgpStars(legs, tone) {
  const probs = legs.map((b) => b.hrProbability).filter(Number.isFinite)
  const avg = probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : 0
  const normP = Math.min(1, Math.max(0, (avg - 0.15) / (0.27 - 0.15)))
  const penalty = tone === 'risk' ? 0.45 : tone === 'caution' ? 0.2 : 0
  return Math.max(1, Math.round(1 + Math.min(1, Math.max(0, normP - penalty)) * 4))
}

// Same-Game Parlays: the best `size` bats from ONE game stacked together.
// Honors the same consistency lean as the combos page.
function buildSGP(batters, size, { favorConsistency } = {}) {
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
    // Same-game legs are positively correlated; scale up by the game's HR-env
    // tilt (avg park×weather of the legs, else the game park factor). See parlay.js.
    const facs = legs.map((b) => b.parkWeatherHandFactor).filter(Number.isFinite)
    const envTilt = facs.length ? facs.reduce((s, x) => s + x, 0) / facs.length : (Number.isFinite(g.parkHR) ? g.parkHR : 1)
    const rho = gameCorrelation(envTilt)
    const combo = correlatedJoint(probs, rho) // correlation-adjusted all-hit (headline)
    const avg = legs.reduce((s, b) => s + (b.score ?? 0), 0) / legs.length
    // Weakness + lineup-confirmation (same guards as the combos page).
    const legInfo = legs.map((b) => { const flags = legFlags(b); return { flags, bad: legIsBad(b, flags), unconfirmed: b.lineupConfirmed !== true, rising: risingForm(b) } })
    const tone = legInfo.some((l) => l.bad) ? 'risk' : legInfo.some((l) => l.flags.length) ? 'caution' : 'tail'
    out.push({ ...g, legs, legInfo, combo, comboIndep, rho, envTilt, grade: gradeFor(avg), avg, tone, stars: sgpStars(legs, tone) })
  }
  return out.sort((a, b) => b.combo - a.combo || (a.gamePk ?? 0) - (b.gamePk ?? 0))
}

export default function SameGameView({ batters, onSelect, favorConsistency = false, comboConf = 'off' }) {
  const [size, setSize] = useState(2)
  const sgps = useMemo(() => buildSGP(batters, size, { favorConsistency }), [batters, size, favorConsistency])
  return (
    <>
      <p className="sgp-intro dim">
        Every leg from the <b>same game</b> — a "this game goes off" bet. Same‑game HR legs are{' '}
        <b>correlated</b> (shared park, weather, opposing pitcher), so they cash together more than the
        independent odds suggest — but books price SGPs with a correlation discount, so the payout is{' '}
        <i>lower</i> than the same legs across games. Best used on high‑HR parks.
      </p>
      <div className="grp-controls" role="group" aria-label="Legs per SGP">
        {SIZES.map((s) => (
          <button key={s} className={`badge-toggle ${size === s ? 'on' : ''}`} onClick={() => setSize(s)}>
            {s}-leg
          </button>
        ))}
      </div>
      {sgps.length === 0 ? (
        <div className="empty-note">No game has {size} eligible bats right now.</div>
      ) : (
        <div className="grp-list">
          {sgps.map((g, idx) => {
            const c = GRADE_COLOR[g.grade]
            const matchup = g.game ? `${g.game.awayTeam?.abbr} @ ${g.game.homeTeam?.abbr}` : `Game ${g.gamePk}`
            const live = comboStatus(g.legs)
            const lv = VERDICT_META[live.code]
            const cashed = live.started && g.legs.length > 0 && live.hits >= g.legs.length
            return (
              <section className={`grp-card sgp-card tone-${g.tone}${cashed ? ' cashed' : ''}`} key={g.gamePk} style={{ '--gc': c, '--i': Math.min(idx, 8) }} title={cashed ? '💰 CASHED — every leg homered' : undefined}>
                <header className="grp-head">
                  <span className="grp-legbadge">{size}-LEG SGP</span>
                  <span className="grp-strategy">
                    {matchup}
                    {g.parkHR != null && <span className="dim"> · park {g.parkHR.toFixed(2)}×</span>}
                  </span>
                  {live.started ? (
                    <span className="grp-live-tag" title={`Live: ${live.hits}/${live.n} legs homered`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', color: lv.color, background: `color-mix(in srgb, ${lv.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${lv.color} 35%, transparent)`, borderRadius: '5px', padding: '1px 6px' }}>
                      <Icon name={lv.icon} size={10} className={live.code === 'live' ? 'spin-pulse' : ''} /> {lv.label} {live.hits}/{live.n}
                    </span>
                  ) : (
                    <span className="grp-locked-tag"><Icon name="Lock" size={10} /> LOCKED</span>
                  )}
                  {comboConf === 'stars' && <span className="grp-conf">{'★'.repeat(g.stars)}<span className="grp-conf-off">{'★'.repeat(5 - g.stars)}</span></span>}
                  {comboConf === 'percent' && <span className="grp-conf pct">{pct(g.combo, g.combo < 0.01 ? 2 : 1)}</span>}
                  <span className={`grp-grade grade-glow-${g.grade}`} style={{ color: c, borderColor: c }}>{g.grade}</span>
                  <button
                    className="grp-copy"
                    title="Copy this SGP as text"
                    onClick={(e) => {
                      e.stopPropagation()
                      const legsTxt = g.legs.map((b) => lastFirst(b.name).split(',')[0]).join(' + ')
                      const line = `${size}-leg SGP ${matchup}: ${legsTxt} — all-hit ≈ ${pct(g.combo, g.combo < 0.01 ? 2 : 1)} corr-adj (StatFax)`
                      navigator.clipboard?.writeText(line).then(() => toast.success('SGP copied')).catch(() => toast.warn('Copy failed'))
                    }}
                  >
                    <Icon name="Copy" size={12} />
                  </button>
                </header>
                <div className="grp-sub dim">
                  all‑hit ≈ <b className="mono">{pct(g.combo, g.combo < 0.01 ? 2 : 1)}</b>
                  {g.rho > 0 ? (
                    <span title={`Correlation-adjusted for this game's HR environment (park × weather ${num(g.envTilt, 2)}×). Independent product is ${pct(g.comboIndep, g.comboIndep < 0.01 ? 2 : 1)}; books still apply a correlation discount to the payout.`}>
                      {' '}· corr-adj (indep {pct(g.comboIndep, g.comboIndep < 0.01 ? 2 : 1)})
                    </span>
                  ) : (
                    <span> · independent (neutral park)</span>
                  )}
                </div>
                <ul className="grp-legs">
                  {g.legs.map((b, i) => {
                    const info = g.legInfo[i]
                    const st = legStatus(b)
                    const sm = LEG_META[st.code]
                    return (
                      <li className={`sgp-leg ${info.bad ? 'weak-leg' : ''}`} key={b.id} onClick={() => onSelect(b)} role="button" tabIndex={0} style={st.code === 'hit' ? { background: 'color-mix(in srgb, var(--strong) 7%, transparent)' } : st.code === 'dead' ? { opacity: 0.6 } : undefined}>
                        <span className="sgp-leg-ord mono">{i + 1}</span>
                        <div className="sgp-leg-body">
                          <span className="sgp-leg-name">{lastFirst(b.name)}</span>
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
    </>
  )
}
