import { useState, useEffect } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { computeParlay, parlayGrade } from '../lib/parlay.js'
import { pct, american, signedPct } from '../lib/format.js'
import { gradeColor } from '../lib/badges.js'
import { hexA } from './atoms.jsx'
import { toast } from './Toast.jsx'

const GRADE_COLOR = { S: '#f5a623', A: '#10b981', B: '#3b82f6', C: '#94a3b8', D: '#64748b' }

// Roll the payout toward its new value when the wager or legs change —
// money that ticks up feels like money.
function useCountUp(target, ms = 450) {
  const [v, setV] = useState(target)
  useEffect(() => {
    if (target == null || !Number.isFinite(target)) { setV(target); return }
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(target); return }
    let raf, start = null
    const from = Number.isFinite(v) ? v : 0
    const tick = (t) => {
      if (start === null) start = t
      const p = Math.min(1, (t - start) / ms)
      setV(from + (target - from) * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, ms])
  return v
}

function buildCopyText(legs, p) {
  const header = `📊 StatFax Parlay · ${p.n} ${p.n === 1 ? 'leg' : 'legs'} · Model: ${pct(p.modelProb, 1)}${p.allPriced ? ` · ${american(p.american)}` : ''}`
  const items = legs.map((b, i) => {
    const odds = b.odds?.best?.american ? ` ${american(b.odds.best.american)}` : ''
    return `${i + 1}. ${b.name} (${b.team})${odds} — ${Math.round((b.hrProbability ?? 0) * 100)}% HR`
  })
  return [header, ...items].join('\n')
}

function parlaySummary(p, pg) {
  if (!p.n) return ''
  const size = p.n === 1 ? 'single-leg parlay' : `${p.n}-leg parlay`
  const hit = pct(p.modelProb, p.modelProb < 0.01 ? 2 : 1)
  const who = p.n === 1 ? 'it' : `all ${p.n} legs`
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
  const p = legs.length ? computeParlay(legs) : null
  const payDecimal = p ? (p.allPriced ? p.decimal : p.fairDecimal) : null
  const wagerNum = parseFloat(wager)
  const payout = p && Number.isFinite(wagerNum) && wagerNum > 0 && payDecimal ? wagerNum * payDecimal : null
  const shownPayout = useCountUp(payout)
  if (!legs.length) return null
  const pg = parlayGrade(legs)
  const gColor = pg ? GRADE_COLOR[pg.letter] : null
  const weak =
    legs.length >= 2
      ? legs.slice().sort((a, b) => (a.hrProbability ?? 1) - (b.hrProbability ?? 1) || (a.score ?? 0) - (b.score ?? 0) || String(a.id).localeCompare(String(b.id)))[0]
      : null
  const weakId = weak?.id

  return (
    <div className={`slip ${open ? 'open' : ''}`} style={{
      /* Geometry (position/bottom/right/width/z-index) is owned by app.css —
         base .slip for desktop, the @560 rules for the mobile bottom-sheet
         placement above the nav. Inline geometry here used to override the
         mobile rules and make the slip overlap the bottom-nav. */
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
              <Icon name="Layers" size={14} /> Parlay ·{' '}
              <span key={p.n} className="slip-legs-bump">{p.n} {p.n === 1 ? 'leg' : 'legs'}</span>
            </span>
            {pg && (
              <span className={`slip-grade grade-glow-${pg.letter}`} style={{
                color: gColor,
                borderColor: hexA(gColor, 0.4),
                borderWidth: '1px',
                borderStyle: 'solid',
                borderRadius: '6px',
                padding: '2px 8px',
                fontSize: '11px',
                fontWeight: '800',
                background: hexA(gColor, 0.08),
                whiteSpace: 'nowrap',
              }} title={`Avg leg score ${Math.round(pg.avgScore)}${pg.letter === 'S' ? ' — the cream' : ''}`}>
                {pg.letter === 'S' && <Icon name="Trophy" size={10} style={{ marginRight: '3px', verticalAlign: '-1px' }} />}
                Grade {pg.letter}
              </span>
            )}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {onOpenBuilder && (
                <button className="slip-build" onClick={onOpenBuilder} title="Open the full parlay builder" style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: '800', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Icon name="Sparkles" size={12} /> Build
                </button>
              )}
              <button
                className="slip-copy"
                title="Copy parlay to clipboard"
                onClick={() => {
                  navigator.clipboard?.writeText(buildCopyText(legs, p)).then(() => {
                    toast.success('Parlay copied!')
                  }).catch(() => toast.warn('Copy failed'))
                }}
                style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: '700', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
              >
                <Icon name="Copy" size={12} /> Copy
              </button>
              <button className="slip-clear" onClick={onClear} title="Remove every leg" style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: '600' }}>
                Clear
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
              <span className="slip-wager-payout mono" style={{ fontSize: '15px', fontWeight: '800', color: 'var(--strong)' }}>{shownPayout != null && Number.isFinite(shownPayout) ? `$${shownPayout >= 100 ? Math.round(shownPayout) : shownPayout.toFixed(2)}` : '—'}</span>
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
                  <span className="slip-leg-grade" style={{ background: gradeColor(b.grade?.label), width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0 }} />
                  {/* Name owns the flexible space and ellipsizes; the team + weak
                      tag are fixed-size so they can't squeeze the name to nothing. */}
                  <span className="slip-leg-name" style={{ flex: '1 1 auto', minWidth: 0, fontSize: '12px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
                  <span className="slip-leg-team" style={{ flexShrink: 0, fontSize: '10px', color: 'var(--text-faint)' }}>{b.team}</span>
                  {b.lineupConfirmed !== true && (
                    <span className="slip-leg-prov" title="Lineup not posted — this leg can still change" style={{ flexShrink: 0, color: 'var(--prime)', display: 'inline-flex' }}>
                      <Icon name="Clock" size={10} />
                    </span>
                  )}
                  {b.id === weakId && (
                    <Icon name="TriangleAlert" size={10} style={{ flexShrink: 0, color: 'var(--b-hot)' }} title="Weakest leg" />
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
          <span key={p.n} className="slip-count slip-count-bump" style={{
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
            <span className={`slip-bar-grade grade-glow-${pg.letter}`} style={{ 
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
