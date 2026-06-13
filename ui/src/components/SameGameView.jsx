import { useMemo, useState } from 'react'
import { GradeChip } from './atoms.jsx'
import { pct } from '../lib/format.js'
import { lastFirst } from '../lib/groups.js'

const SIZES = [2, 3, 4]
const GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }
const gradeFor = (avg) => (avg >= 76 ? 'S' : avg >= 70 ? 'A' : avg >= 62 ? 'B' : avg >= 54 ? 'C' : 'D')

// Same-Game Parlays: the best `size` bats from ONE game stacked together.
// Unlike Parlay Combos (one bat per game, uncorrelated), every leg here shares
// the game — a "this game goes off" bet.
function buildSGP(batters, size) {
  const byGame = new Map()
  for (const b of batters || []) {
    if (b.game?.isFinal) continue
    if ((b.grade?.label || 'SKIP') === 'SKIP') continue
    if (!Number.isFinite(b.hrProbability)) continue
    if (!byGame.has(b.gamePk)) byGame.set(b.gamePk, { gamePk: b.gamePk, game: b.game, parkHR: b.gameParkHRFactor, bats: [] })
    byGame.get(b.gamePk).bats.push(b)
  }
  const out = []
  for (const g of byGame.values()) {
    const legs = g.bats
      .slice()
      .sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0) || (b.score ?? 0) - (a.score ?? 0))
      .slice(0, size)
    if (legs.length < size) continue
    const combo = legs.reduce((p, b) => p * (b.hrProbability ?? 0), 1) // independent baseline
    const avg = legs.reduce((s, b) => s + (b.score ?? 0), 0) / legs.length
    out.push({ ...g, legs, combo, grade: gradeFor(avg), avg })
  }
  return out.sort((a, b) => b.combo - a.combo)
}

export default function SameGameView({ batters, onSelect }) {
  const [size, setSize] = useState(2)
  const sgps = useMemo(() => buildSGP(batters, size), [batters, size])
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
          {sgps.map((g) => {
            const c = GRADE_COLOR[g.grade]
            const matchup = g.game ? `${g.game.awayTeam?.abbr} @ ${g.game.homeTeam?.abbr}` : `Game ${g.gamePk}`
            return (
              <section className="grp-card sgp-card" key={g.gamePk} style={{ '--gc': c }}>
                <header className="grp-head">
                  <span className="grp-legbadge">{size}-LEG SGP</span>
                  <span className="grp-strategy">
                    {matchup}
                    {g.parkHR != null && <span className="dim"> · park {g.parkHR.toFixed(2)}×</span>}
                  </span>
                  <span className="grp-grade" style={{ color: c, borderColor: c }}>
                    {g.grade}
                  </span>
                </header>
                <div className="grp-sub dim">
                  all‑hit ≈ <b className="mono">{pct(g.combo, g.combo < 0.01 ? 2 : 1)}</b> (independent) · correlated, so true odds are better
                </div>
                <ul className="grp-legs">
                  {g.legs.map((b, i) => (
                    <li className="sgp-leg" key={b.id} onClick={() => onSelect(b)} role="button" tabIndex={0}>
                      <span className="sgp-leg-ord mono">{i + 1}</span>
                      <span className="sgp-leg-name">{lastFirst(b.name)}</span>
                      <GradeChip grade={b.grade} score={b.score} size="sm" />
                      <span className="sgp-leg-prob mono">{pct(b.hrProbability, 2)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
