import { useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { computeParlay, parlayGrade } from '../lib/parlay.js'
import { pct, american, signedPct } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'

const GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }

// One- or two-sentence read on the built parlay, straight from the builder's
// math (grade, model all-hit probability, combined price, edge vs market).
function parlaySummary(p, pg) {
  if (!p.n) return ''
  const size = p.n === 1 ? 'single-leg parlay' : `${p.n}-leg parlay`
  const hit = pct(p.modelProb, p.modelProb < 0.01 ? 2 : 1)
  const who = p.n === 1 ? 'it' : `all ${p.n}`
  const grade = pg ? `Grade ${pg.letter} · ` : ''
  let s = `${grade}${size} — the model gives ${who} a ${hit} chance to hit together.`
  if (p.allPriced) {
    s += ` Pays ${american(p.american)}`
    s += p.edge != null ? `, a ${signedPct(p.edge, 0)} edge vs the market.` : '.'
  } else {
    s += ` Fair price ${american(p.fairAmerican)}`
    s += p.n > 1 && p.priced > 0 ? ` (${p.priced}/${p.n} legs priced).` : '.'
  }
  return s
}

export default function ParlaySlip({ legs, onRemove, onClear, onSelect }) {
  const [open, setOpen] = useState(false)
  const [wager, setWager] = useState('10')
  if (!legs.length) return null
  const p = computeParlay(legs)
  // Payout calculator: book price when every leg is priced, else the model's
  // fair price (flagged so it's clear no book is actually paying it).
  const payDecimal = p.allPriced ? p.decimal : p.fairDecimal
  const wagerNum = parseFloat(wager)
  const payout = Number.isFinite(wagerNum) && wagerNum > 0 && payDecimal ? wagerNum * payDecimal : null
  const pg = parlayGrade(legs)
  const gColor = pg ? GRADE_COLOR[pg.letter] : null
  // Weak link = the leg most likely to sink the parlay: lowest HR prob, then
  // lowest model score (prob saturates at the top, so score breaks the ties).
  // Only flagged once there are 2+ legs.
  const weak =
    legs.length >= 2
      ? legs.slice().sort((a, b) => (a.hrProbability ?? 1) - (b.hrProbability ?? 1) || (a.score ?? 0) - (b.score ?? 0))[0]
      : null
  const weakId = weak?.id

  return (
    <div className={`slip ${open ? 'open' : ''}`}>
      {open && (
        <div className="slip-panel">
          <div className="slip-panel-head">
            <span className="slip-panel-title">
              <Icon name="Layers" size={14} /> Parlay · {p.n} {p.n === 1 ? 'leg' : 'legs'}
            </span>
            {pg && (
              <span className="slip-grade" style={{ color: gColor, borderColor: gColor }} title={`Avg leg score ${Math.round(pg.avgScore)}`}>
                {pg.letter}
              </span>
            )}
            <button className="slip-clear" onClick={onClear}>
              Clear all
            </button>
          </div>
          <div className="slip-summary">
            {parlaySummary(p, pg)}
            {weak && (
              <span className="slip-weak-note">
                {' '}
                <Icon name="TriangleAlert" size={11} /> Weak link: <b>{weak.name}</b> ({pct(weak.hrProbability, 1)}).
              </span>
            )}
          </div>
          <div className="slip-wager">
            <label className="slip-wager-field">
              <span className="slip-wager-k">Wager $</span>
              <input
                className="slip-wager-input mono"
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={wager}
                onChange={(e) => setWager(e.target.value)}
                aria-label="Wager amount in dollars"
              />
            </label>
            <span className="slip-wager-arrow" aria-hidden="true">
              <Icon name="ChevronRight" size={14} />
            </span>
            <span className="slip-wager-field">
              <span className="slip-wager-k">Payout{p.allPriced ? '' : ' (fair)'}</span>
              <span className="slip-wager-payout mono">{payout != null ? `$${payout >= 100 ? Math.round(payout) : payout.toFixed(2)}` : '—'}</span>
            </span>
          </div>
          <div className="slip-legs">
            {legs.map((b) => (
              <div className={`slip-leg ${b.id === weakId ? 'weak' : ''}`} key={b.id}>
                <button className="slip-leg-main" onClick={() => onSelect(b)} title="Open detail">
                  <span className="slip-leg-grade" style={{ background: gradeColor(b.grade?.label) }} />
                  <span className="slip-leg-name">{b.name}</span>
                  <span className="slip-leg-team">{b.team}</span>
                  {b.id === weakId && (
                    <span className="slip-weak-tag" title="Weakest leg — most likely to sink the parlay">
                      <Icon name="TriangleAlert" size={10} /> weak link
                    </span>
                  )}
                </button>
                <GradeChip grade={b.grade} size="sm" score={b.score} />
                <span className="slip-leg-prob mono">{pct(b.hrProbability, 1)}</span>
                <span className="slip-leg-odds mono">{b.odds?.best ? american(b.odds.best.american) : '—'}</span>
                <button className="slip-leg-remove" onClick={() => onRemove(b.id)} aria-label={`Remove ${b.name}`}>
                  <Icon name="X" size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="slip-bar" onClick={() => setOpen((o) => !o)}>
        <span className="slip-bar-left">
          <span className="slip-count">{p.n}</span>
          <span className="slip-bar-label">Parlay</span>
          {pg && (
            <span className="slip-bar-grade" style={{ color: gColor, borderColor: gColor }}>
              {pg.letter}
            </span>
          )}
        </span>
        <span className="slip-bar-stats">
          <span className="slip-stat">
            <span className="slip-stat-k">Model</span>
            <span className="slip-stat-v mono">{pct(p.modelProb, p.modelProb < 0.01 ? 2 : 1)}</span>
          </span>
          {p.edge != null && (
            <span className="slip-stat">
              <span className="slip-stat-k">Edge</span>
              <span className={`slip-stat-v mono ${p.edge >= 0 ? 'pos' : 'neg'}`}>{signedPct(p.edge, 0)}</span>
            </span>
          )}
        </span>
        <Icon name={open ? 'ChevronDown' : 'ChevronUp'} size={16} />
      </button>
    </div>
  )
}
