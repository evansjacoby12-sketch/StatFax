import { useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { computeParlay, parlayGrade } from '../lib/parlay.js'
import { pct, american, signedPct } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

const GRADE_COLOR = { S: '#f5a623', A: '#10b981', B: '#3b82f6', C: '#94a3b8', D: '#64748b' }

function parlaySummary(p, pg) {
  if (!p.n) return ''
  const size = p.n === 1 ? 'single-leg parlay' : `${p.n}-leg parlay`
  const hit = pct(p.modelProb, p.modelProb < 0.01 ? 2 : 1)
  const who = p.n === 1 ? 'it' : `all ${p.n}`
  const grade = pg ? `Grade ${pg.letter} · ` : ''
  let s = `${grade}${size} — model gives ${who} a ${hit} chance to cash.`
  if (p.allPriced) {
    s += ` Pays ${american(p.american)}`
    s += p.edge != null ? `, a ${signedPct(p.edge, 0)} edge vs market.` : '.'
  } else {
    s += ` Fair price ${american(p.fairAmerican)}`
    s += p.n > 1 && p.priced > 0 ? ` (${p.priced}/${p.n} legs priced).` : '.'
  }
  return s
}

export default function ParlaySlip({ legs, onRemove, onClear, onSelect, onOpenBuilder }) {
  const [open, setOpen] = useState(false)
  const [wager, setWager] = useState('10')
  if (!legs.length) return null
  const p = computeParlay(legs)
  const payDecimal = p.allPriced ? p.decimal : p.fairDecimal
  const wagerNum = parseFloat(wager)
  const payout = Number.isFinite(wagerNum) && wagerNum > 0 && payDecimal ? wagerNum * payDecimal : null
  const pg = parlayGrade(legs)
  const gColor = pg ? GRADE_COLOR[pg.letter] : null
  const weak =
    legs.length >= 2
      ? legs.slice().sort((a, b) => (a.hrProbability ?? 1) - (b.hrProbability ?? 1) || (a.score ?? 0) - (b.score ?? 0) || String(a.id).localeCompare(String(b.id)))[0]
      : null
  const weakId = weak?.id

  return (
    <div className={`slip ${open ? 'open' : ''}`} style={{
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      zIndex: '100',
      width: '380px',
      maxWidth: 'calc(100vw - 40px)',
      background: 'var(--glass-bg)',
      border: '1px solid rgba(255, 255, 255, 0.08)',
      boxShadow: 'var(--glass-shadow)',
      borderRadius: '16px',
      backdropFilter: 'blur(16px)',
      overflow: 'hidden',
      transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
    }}>
      {open && (
        <div className="slip-panel" style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="slip-panel-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <span className="slip-panel-title" style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="Layers" size={14} /> Parlay · {p.n} {p.n === 1 ? 'leg' : 'legs'}
            </span>
            {pg && (
              <span className="slip-grade" style={{ 
                color: gColor, 
                borderColor: hexA(gColor, 0.4), 
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '6px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: '800',
                background: hexA(gColor, 0.08)
              }} title={`Avg leg score ${Math.round(pg.avgScore)}`}>
                Grade {pg.letter}
              </span>
            )}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {onOpenBuilder && (
                <button className="slip-build" onClick={onOpenBuilder} title="Open the full parlay builder" style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Icon name="Sparkles" size={12} /> Build
                </button>
              )}
              <button className="slip-clear" onClick={onClear} style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: '600' }}>
                Clear all
              </button>
            </div>
          </div>
          
          <div className="slip-summary" style={{ fontSize: '12px', color: 'var(--text-dim)', marginBottom: '14px', lineHeight: '1.4' }}>
            {parlaySummary(p, pg)}
            {weak && (
              <span className="slip-weak-note" style={{ display: 'flex', marginTop: '6px', color: 'var(--b-hot)', alignItems: 'center', gap: '4px', fontSize: '11px' }}>
                <Icon name="TriangleAlert" size={11} />
                <span>Weak link: <b>{weak.name}</b> ({pct(weak.hrProbability, 2)})</span>
              </span>
            )}
          </div>

          <div className="slip-wager" style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            background: 'rgba(0,0,0,0.15)',
            border: '1px solid rgba(255,255,255,0.04)',
            borderRadius: '10px',
            padding: '8px 12px',
            marginBottom: '14px'
          }}>
            <label className="slip-wager-field" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span className="slip-wager-k" style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>Wager $</span>
              <input
                className="slip-wager-input mono"
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={wager}
                onChange={(e) => setWager(e.target.value)}
                aria-label="Wager"
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#fff',
                  fontSize: '15px',
                  fontWeight: '700',
                  outline: 'none',
                  width: '80px'
                }}
              />
            </label>
            <span className="slip-wager-arrow" aria-hidden="true" style={{ color: 'var(--text-faint)' }}>
              <Icon name="ChevronRight" size={14} />
            </span>
            <span className="slip-wager-field" style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'flex-end' }}>
              <span className="slip-wager-k" style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>Payout{p.allPriced ? '' : ' (fair)'}</span>
              <span className="slip-wager-payout mono" style={{ fontSize: '15px', fontWeight: '800', color: 'var(--strong)' }}>{payout != null ? `$${payout >= 100 ? Math.round(payout) : payout.toFixed(2)}` : '—'}</span>
            </span>
          </div>

          <div className="slip-legs" style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto' }}>
            {legs.map((b) => (
              <div className={`slip-leg ${b.id === weakId ? 'weak' : ''}`} key={b.id} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 8px',
                background: 'rgba(255,255,255,0.01)',
                border: `1px solid ${b.id === weakId ? 'rgba(249,115,22,0.15)' : 'rgba(255,255,255,0.04)'}`,
                borderRadius: '8px'
              }}>
                <button className="slip-leg-main" onClick={() => onSelect(b)} title="Open detail" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  flex: '1',
                  textAlign: 'left',
                  minWidth: '0'
                }}>
                  <span className="slip-leg-grade" style={{ background: gradeColor(b.grade?.label), width: '6px', height: '6px', borderRadius: '50%' }} />
                  <span className="slip-leg-name" style={{ fontSize: '12px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                  <span className="slip-leg-team" style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{b.team}</span>
                  {b.id === weakId && (
                    <span className="slip-weak-tag" title="Weakest leg" style={{ fontSize: '9px', background: 'rgba(249,115,22,0.08)', color: 'var(--b-hot)', borderRadius: '4px', padding: '1px 4px', display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
                      <Icon name="TriangleAlert" size={8} /> weak
                    </span>
                  )}
                </button>
                <GradeChip grade={b.grade} size="sm" score={b.score} />
                <span className="slip-leg-prob mono" style={{ fontSize: '11px', color: 'var(--text-dim)' }}>{pct(b.hrProbability, 1)}</span>
                <span className="slip-leg-odds mono" style={{ fontSize: '11px', color: '#fff', fontWeight: '600', width: '40px', textAlign: 'right' }}>{b.odds?.best ? american(b.odds.best.american) : '—'}</span>
                <button className="slip-leg-remove" onClick={() => onRemove(b.id)} aria-label={`Remove ${b.name}`} style={{ color: 'var(--text-faint)', display: 'grid', placeItems: 'center' }}>
                  <Icon name="X" size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button className="slip-bar" onClick={() => setOpen((o) => !o)} style={{
        width: '100%',
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: open ? 'rgba(0,0,0,0.1)' : 'transparent',
        border: 'none',
        color: '#fff',
        cursor: 'pointer'
      }}>
        <span className="slip-bar-left" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className="slip-count" style={{
            background: 'var(--accent)',
            color: '#fff',
            fontSize: '11px',
            fontWeight: '800',
            borderRadius: '50%',
            width: '20px',
            height: '20px',
            display: 'grid',
            placeItems: 'center'
          }}>{p.n}</span>
          <span className="slip-bar-label" style={{ fontSize: '13px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Parlay Slip</span>
          {pg && (
            <span className="slip-bar-grade" style={{ 
              color: gColor, 
              borderColor: hexA(gColor, 0.4),
              borderWidth: '1px',
              borderStyle: 'solid',
              fontSize: '10px',
              fontWeight: '800',
              padding: '1px 5px',
              borderRadius: '4px',
              background: hexA(gColor, 0.08)
            }}>
              {pg.letter}
            </span>
          )}
        </span>
        <span className="slip-bar-stats" style={{ display: 'flex', gap: '14px', marginRight: '8px' }}>
          <span className="slip-stat" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span className="slip-stat-k" style={{ fontSize: '8px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Model</span>
            <span className="slip-stat-v mono" style={{ fontSize: '12px', fontWeight: '700', color: 'var(--accent)' }}>{pct(p.modelProb, p.modelProb < 0.01 ? 2 : 1)}</span>
          </span>
          {p.edge != null && (
            <span className="slip-stat" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <span className="slip-stat-k" style={{ fontSize: '8px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Edge</span>
              <span className={`slip-stat-v mono ${p.edge >= 0 ? 'pos' : 'neg'}`} style={{ fontSize: '12px', fontWeight: '700' }}>{signedPct(p.edge, 0)}</span>
            </span>
          )}
        </span>
        <Icon name={open ? 'ChevronDown' : 'ChevronUp'} size={14} style={{ color: 'var(--text-faint)' }} />
      </button>
    </div>
  )
}
