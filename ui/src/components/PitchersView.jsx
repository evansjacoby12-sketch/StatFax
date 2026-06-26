import { useMemo, useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip, ScoreRing, ProbBar, Stat } from './atoms.jsx'
import { groupPitchers, pitchUsage, effSide, K_LINES, kOverProb } from '../lib/pitchers.js'
import { pct, num, rate, gameTime } from '../lib/format.js'
import { teamColor, teamLogo, playerHeadshot, hexToRgba } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'
import { gradeColor } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

const PSORT = [
  { k: 'vuln', label: 'Most hittable' },
  { k: 'time', label: 'Game time' },
]

export default function PitchersView({ batters, onSelect, selectedId, watchlist, slip, focusKey, onFocusDone }) {
  const [sort, setSort] = useState('vuln')
  const [view, setView] = useState('preview')
  const [kOpen, setKOpen] = useState(false)
  const grouped = useMemo(() => groupPitchers(batters), [batters])
  
  const pitchers = useMemo(() => {
    if (sort !== 'time') return grouped
    return [...grouped].sort(
      (a, b) =>
        (a.game?.gameDate || '').localeCompare(b.game?.gameDate || '') ||
        (b.vuln?.score ?? 0) - (a.vuln?.score ?? 0),
    )
  }, [grouped, sort])

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
    return <div className="empty-note" style={{ padding: '64px', textAlign: 'center', color: 'var(--text-faint)' }}>No pitchers match the current filters.</div>
  }
  return (
    <>
      <div className="pitchers-controls" role="group" aria-label="Pitcher view" style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
        <span className="pitchers-controls-k dim" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>View Mode:</span>
        <button 
          className={`badge-toggle ${view === 'preview' ? 'on' : ''}`} 
          onClick={() => setView('preview')}
          style={{
            borderColor: view === 'preview' ? 'var(--accent)' : 'var(--border-soft)',
            background: view === 'preview' ? 'var(--hover)' : 'transparent',
            color: view === 'preview' ? '#fff' : 'var(--text-faint)'
          }}
        >
          Vulnerability
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
          Detail Cards
        </button>
        <button
          className={`badge-toggle ${view === 'kbrain' ? 'on' : ''}`}
          onClick={() => setView('kbrain')}
          style={{
            borderColor: view === 'kbrain' ? 'var(--accent)' : 'var(--border-soft)',
            background: view === 'kbrain' ? 'var(--hover)' : 'transparent',
            color: view === 'kbrain' ? '#fff' : 'var(--text-faint)'
          }}
        >
          <Icon name="Zap" size={11} style={{ marginRight: '3px' }} />K Brain
        </button>
        
        {view === 'detail' && (
          <>
            <span className="pitchers-controls-k dim" style={{ marginLeft: 12, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sort:</span>
            {PSORT.map((t) => (
              <button 
                key={t.k} 
                className={`badge-toggle ${sort === t.k ? 'on' : ''}`} 
                onClick={() => setSort(t.k)}
                style={{
                  borderColor: sort === t.k ? 'var(--accent)' : 'var(--border-soft)',
                  background: sort === t.k ? 'var(--hover)' : 'transparent',
                  color: sort === t.k ? '#fff' : 'var(--text-faint)'
                }}
              >
                {t.label}
              </button>
            ))}
          </>
        )}
      </div>

      <KParlaySection pitchers={grouped} open={kOpen} onToggle={() => setKOpen((v) => !v)} />

      {view === 'kbrain' ? (
        <KBrainView pitchers={grouped} />
      ) : view === 'preview' ? (
        <PitcherPreview pitchers={grouped} onSelect={onSelect} />
      ) : (
        <div className="pitchers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
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

// ─── K Brain view ────────────────────────────────────────────────────────────
const TREND_ICON = { up: '↑', down: '↓', flat: '→' }
const TREND_COLOR = { up: 'var(--strong)', down: 'var(--bad)', flat: 'var(--text-faint)' }
const CONF_COLOR = { high: 'var(--strong)', med: 'var(--accent)', low: 'var(--text-faint)' }

function KBrainView({ pitchers }) {
  // Per-pitcher line input: pitcherId → user-entered sportsbook line
  const [lines, setLines] = useState({})
  const arms = [...pitchers]
    .filter((e) => e.estK && Number.isFinite(e.estK.lambda))
    .sort((a, b) => (b.estK.lambda - a.estK.lambda))

  if (!arms.length) {
    return <div className="empty-note" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-faint)' }}>No K estimates available — missing recent start data.</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '4px' }}>
        Poisson K distribution per start. Enter the sportsbook's line to see implied edge.
      </div>
      {arms.map((e) => {
        const ek = e.estK
        const oppTeam = e.targets[0]?.team || '?'
        const myLine = lines[e.key]
        const myLineNum = myLine !== undefined && myLine !== '' ? parseFloat(myLine) : null
        const myProb = myLineNum != null && Number.isFinite(myLineNum) ? kOverProb(ek.lambda, myLineNum) : null

        // Show 4 key thresholds around the est K
        const anchor = Math.round(ek.k)
        const showLines = K_LINES.filter((l) => l >= anchor - 2 && l <= anchor + 2).slice(0, 5)

        return (
          <div key={e.key} style={{ background: 'rgba(16,24,48,0.45)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', padding: '14px 16px' }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <img src={playerHeadshot(e.pitcher.id, 60)} alt="" loading="lazy" style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover', background: 'rgba(255,255,255,0.04)', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: '800', fontSize: '14px', color: '#fff' }}>{e.pitcher.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
                  {e.pitcher.hand}HP · vs {oppTeam}
                  {e.game?.gameDate && <span> · {gameTime(e.game.gameDate)}</span>}
                </div>
              </div>
              {/* Est K badge */}
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: '22px', fontWeight: '900', color: '#fff', lineHeight: 1 }}>{ek.k.toFixed(1)}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-faint)' }}>est K ({ek.lo}–{ek.hi})</div>
              </div>
              {/* Trend + conf */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                <span style={{ fontSize: '16px', color: TREND_COLOR[ek.trend] }}>{TREND_ICON[ek.trend]}</span>
                <span style={{ fontSize: '9px', color: CONF_COLOR[ek.conf], textTransform: 'uppercase', letterSpacing: '0.04em' }}>{ek.conf}</span>
              </div>
            </div>

            {/* K-over probability bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: '10px' }}>
              {showLines.map((line) => {
                const p = ek.probs[line]
                if (p == null) return null
                const pct100 = p * 100
                // Colour: green ≥60%, yellow 40–59%, red <40%
                const barColor = pct100 >= 60 ? 'var(--strong)' : pct100 >= 40 ? '#f59e0b' : 'var(--bad)'
                return (
                  <div key={line} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                    <span className="mono" style={{ width: '32px', color: 'var(--text-dim)', flexShrink: 0 }}>{line}+</span>
                    <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '99px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct100}%`, background: barColor, borderRadius: '99px', transition: 'width 0.3s' }} />
                    </div>
                    <span className="mono" style={{ width: '34px', textAlign: 'right', fontWeight: '700', color: barColor }}>{pct100.toFixed(0)}%</span>
                  </div>
                )
              })}
            </div>

            {/* Sportsbook line input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-faint)', flexShrink: 0 }}>Book line:</span>
              <input
                type="number"
                step="0.5"
                min="0"
                max="15"
                placeholder="e.g. 6.5"
                value={lines[e.key] ?? ''}
                onChange={(ev) => setLines((prev) => ({ ...prev, [e.key]: ev.target.value }))}
                style={{ width: '70px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '4px 8px', color: '#fff', fontSize: '12px', fontFamily: 'monospace' }}
              />
              {myProb != null && Number.isFinite(myProb) && (
                <span style={{ fontSize: '12px', fontWeight: '700', color: myProb >= 0.55 ? 'var(--strong)' : myProb >= 0.40 ? '#f59e0b' : 'var(--bad)' }}>
                  {(myProb * 100).toFixed(0)}% over · {myProb >= 0.55 ? 'value ✓' : myProb <= 0.35 ? 'fade ✗' : 'neutral'}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Build K-prop parlay combos across pitchers. Ranks pitchers by estimated K
// count, then builds 2-leg and 3-leg combos with a suggested line (round down
// from the est K midpoint so the target is realistic) and combined probability.
function buildKParlays(pitchers) {
  const pool = pitchers
    .filter((e) => e.estK && Number.isFinite(e.estK.k) && e.estK.k >= 4)
    .sort((a, b) => (b.estK.k - a.estK.k) || (b.vuln?.score ?? 0) - (a.vuln?.score ?? 0))
  if (pool.length < 2) return []
  const combos = []
  for (const size of [2, 3]) {
    if (pool.length < size) continue
    const legs = pool.slice(0, size)
    combos.push({ size, legs })
  }
  return combos
}

// Suggest a K line: floor to nearest 0.5 below the est midpoint so the line
// is hittable (e.g. est 7.2 → offer 6.5+, not 7.5+).
function kLine(estK) {
  return Math.floor(estK.k * 2) / 2  // floor to nearest 0.5
}

function KParlaySection({ pitchers, open, onToggle }) {
  const combos = useMemo(() => buildKParlays(pitchers), [pitchers])
  if (!combos.length) return null
  return (
    <div style={{ marginBottom: '16px', background: 'rgba(16,24,48,0.35)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', color: open ? '#fff' : 'var(--text-dim)', textAlign: 'left' }}
      >
        <Icon name="Zap" size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontWeight: '800', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>K-Prop Parlays</span>
        <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: '400' }}>· {combos.length} combo{combos.length !== 1 ? 's' : ''} · top strikeout arms</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} style={{ marginLeft: 'auto', color: 'var(--text-faint)' }} />
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {combos.map((c) => (
            <div key={c.size} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-faint)' }}>{c.size}-leg parlay</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                {c.legs.map((e, i) => {
                  const line = kLine(e.estK)
                  const oppTeam = e.targets[0]?.team || '?'
                  return (
                    <span key={e.key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '5px 10px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '1px', lineHeight: 1.3 }}>
                        <span style={{ fontWeight: '700', color: '#fff' }}>{e.pitcher.name}</span>
                        <span style={{ fontSize: '10px', color: 'var(--accent)' }}>
                          <b>{line}+ K</b>
                          <span style={{ color: 'var(--text-faint)', marginLeft: '4px' }}>est {e.estK.lo}–{e.estK.hi} vs {oppTeam}</span>
                        </span>
                      </span>
                      {i < c.legs.length - 1 && <span style={{ color: 'var(--text-faint)', fontSize: '11px', fontWeight: '700' }}>+</span>}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const PVP_TIERS = [
  { key: 'vuln', label: 'Tier 1 — High Vulnerability', sub: 'best targets', color: '#ff5c5c', test: (s) => s >= 80 },
  { key: 'shaky', label: 'Tier 2 — Shaky', sub: 'decent targets', color: '#ffb02e', test: (s) => s >= 60 && s < 80 },
  { key: 'mild', label: 'Tier 3 — Mild', sub: 'situational', color: '#ffd60a', test: (s) => s >= 40 && s < 60 },
  { key: 'tough', label: 'Tier 4 — Tough', sub: 'avoid targeting', color: '#32d74b', test: (s) => s < 40 },
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
      <div className="pvp-cap dim" style={{ fontSize: '11px', marginBottom: '20px' }}>
        Starters ranked by HR-vulnerability. Matching bats = best HR targets.
      </div>
      {PVP_TIERS.map((t) => {
        const rows = scored.filter((e) => t.test(e.vuln?.score ?? 50))
        if (!rows.length) return null
        return (
          <div className="pvp-tier" key={t.key} style={{
            background: 'rgba(16, 24, 48, 0.3)',
            border: '1px solid rgba(255,255,255,0.04)',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '16px'
          }}>
            <div className="pvp-tier-head" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', marginBottom: '12px' }}>
              <span className="pvp-dot" style={{ background: t.color, width: '8px', height: '8px', borderRadius: '50%', boxShadow: `0 0 8px ${t.color}` }} />
              <b style={{ color: '#fff' }}>{t.label}</b> 
              <span className="dim" style={{ fontSize: '12px' }}>· {t.sub}</span>
              <span className="pvp-tier-n dim" style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: '4px', fontSize: '11px' }}>{rows.length}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
              {rows.map((e) => <PvpRow key={e.key} e={e} onSelect={onSelect} />)}
            </div>
          </div>
        )
      })}
      {tbd.length > 0 && (
        <div className="pvp-tier" style={{
          background: 'rgba(16, 24, 48, 0.3)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '12px',
          padding: '16px'
        }}>
          <div className="pvp-tier-head" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', marginBottom: '8px' }}>
            <span className="pvp-dot" style={{ background: '#64748b', width: '8px', height: '8px', borderRadius: '50%' }} />
            <b style={{ color: '#fff' }}>TBD / low sample</b> 
            <span className="dim" style={{ fontSize: '12px' }}>· treat league-avg</span>
          </div>
          <div className="pvp-tbd dim" style={{ fontSize: '12px', paddingLeft: '16px' }}>{tbd.map((e) => `${e.pitcher.name} (${e.targets[0]?.team || '?'})`).join(' · ')}</div>
        </div>
      )}
    </div>
  )
}

// Build 2-leg and 3-leg SGP suggestions from the top targets for a pitcher.
// Joint probability is a naive product (no within-game correlation adjustment)
// but gives a useful fair-value floor for the SGP price.
function sgpLegs(targets, n) {
  const seen = new Set()
  const pool = targets.filter((b) => b.playerId != null && Number.isFinite(b.hrProbability) && !seen.has(b.playerId) && seen.add(b.playerId))
  if (pool.length < n) return null
  const legs = pool.slice(0, n)
  const prob = legs.reduce((acc, b) => acc * b.hrProbability, 1)
  return { legs, prob }
}

function SgpCombo({ legs, prob, onSelect }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
      {legs.map((b, i) => (
        <span key={b.playerId} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            className={`pvp-bat ${(b.grade?.label || b.grade) === 'PRIME' ? 'prime' : ''}`}
            onClick={() => onSelect?.(b)}
            title={`${b.name} · ${pct(b.hrProbability, 1)} HR`}
            style={{ fontSize: '11px' }}
          >
            {lastName(b.name)}
          </button>
          {i < legs.length - 1 && <span style={{ color: 'var(--text-faint)', fontSize: '10px' }}>+</span>}
        </span>
      ))}
      <span className="mono" style={{ marginLeft: '4px', fontSize: '10px', color: 'var(--text-faint)' }}>~{pct(prob, 1)} fair</span>
    </div>
  )
}

function PvpRow({ e, onSelect }) {
  const [open, setOpen] = useState(false)
  const p = e.pitcher
  const s = p.season || {}
  const sav = p.savant || {}
  const seen = new Set()
  const tg = e.targets.filter((b) => b.playerId != null && !seen.has(b.playerId) && seen.add(b.playerId)).slice(0, 4)
  const oppTeam = tg[0]?.team || '?'
  const sgp2 = sgpLegs(e.targets, 2)
  const sgp3 = sgpLegs(e.targets, 3)
  return (
    <div className="pvp-row" style={{ flexWrap: 'wrap' }}>
      <div className="pvp-p" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        <span className="pvp-name" style={{ color: '#fff', fontWeight: '600' }}>{p.name}</span>
        <span className="pvp-hand dim"> ({p.hand})</span>
        <span className="pvp-vs dim"> vs {oppTeam}</span>
      </div>
      <div className="pvp-stats mono">
        <span><b style={{ color: '#fff' }}>{num(s.hrPer9, 2)}</b> HR/9</span>
        <span title={e.estK ? `Projected strikeouts: ${e.estK.lo}–${e.estK.hi} (≈${e.estK.expIP.toFixed(1)} IP vs a ${pct(e.estK.oppK, 0)}-K lineup)` : undefined}><b style={{ color: 'var(--accent)' }}>{e.estK ? Math.round(e.estK.k) : '—'}</b> est K</span>
        <span><b style={{ color: '#fff' }}>{sav.exitVeloAgainst != null ? num(sav.exitVeloAgainst, 0) : '—'}</b> EV</span>
      </div>
      <div className="pvp-bats" style={{ justifyContent: 'flex-end' }}>
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
        {(sgp2 || sgp3) && (
          <button
            className="pvp-chevron"
            onClick={(ev) => { ev.stopPropagation(); setOpen((v) => !v) }}
            aria-expanded={open}
            title={open ? 'Hide SGP combos' : 'Show SGP combos'}
            style={{ background: 'none', border: 'none', padding: '2px 4px', cursor: 'pointer', color: open ? 'var(--accent)' : 'var(--text-faint)', display: 'flex', alignItems: 'center' }}
          >
            <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} />
          </button>
        )}
      </div>
      {open && (sgp2 || sgp3) && (
        <div className="pvp-sgp" style={{ width: '100%', padding: '8px 8px 4px', display: 'flex', flexDirection: 'column', gap: '6px', borderTop: '1px solid rgba(255,255,255,0.04)', marginTop: '4px' }}>
          <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>SGP combos</span>
          {sgp2 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-faint)', width: '28px' }}>2-leg</span>
              <SgpCombo legs={sgp2.legs} prob={sgp2.prob} onSelect={onSelect} />
            </div>
          )}
          {sgp3 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '10px', color: 'var(--text-faint)', width: '28px' }}>3-leg</span>
              <SgpCombo legs={sgp3.legs} prob={sgp3.prob} onSelect={onSelect} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const HITTABLE = 'bad'
const TOUGH = 'good'
function tone(value, { hi, lo, invert = false }) {
  if (value == null || Number.isNaN(value)) return undefined
  const hot = value >= hi
  const cold = value <= lo
  if (!hot && !cold) return undefined
  return (invert ? cold : hot) ? HITTABLE : TOUGH
}

export function PitcherCard({ entry, onSelect, selectedId, watchlist, slip }) {
  const [sgpOpen, setSgpOpen] = useState(false)
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
    <section id={`pcard-${entry.key}`} className={`pcard ${isFinal ? 'final' : ''}`} style={{ 
      '--tc': color,
      background: 'rgba(16, 24, 48, 0.45)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'var(--glass-shadow)',
      borderRadius: '16px',
      padding: '20px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div className="pcard-accent" style={{ background: hexToRgba(color, 0.08), position: 'absolute', inset: 0, zIndex: 0 }} />

      {/* Header */}
      <header className="pcard-head" style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '16px', position: 'relative', zIndex: 1 }}>
        <img className="pcard-photo" src={playerHeadshot(pitcher.id, 96)} alt={pitcher.name} loading="lazy" style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover', background: 'rgba(255,255,255,0.03)' }} />
        <div className="pcard-id" style={{ flex: '1', minWidth: '0' }}>
          <div className="pcard-name" style={{ fontSize: '15px', fontWeight: '800', color: '#fff' }}>{pitcher.name}</div>
          <div className="pcard-sub" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-dim)', flexWrap: 'wrap', marginTop: '2px' }}>
            {logo && <img className="pcard-logo" src={logo} alt="" loading="lazy" style={{ width: '14px', height: '14px' }} />}
            <span>{team?.abbr}</span>
            {hand && <span className="pcard-hand">({hand})</span>}
            {matchup && <span>· {matchup}</span>}
            {live ? <span className="pcard-live" style={{ color: 'var(--bad)', fontWeight: '700' }}>LIVE</span> : isFinal ? <span className="final-tag">FINAL</span> : game?.gameDate && <span>· {gameTime(game.gameDate)}</span>}
          </div>
        </div>
        <div className="pcard-vuln" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="pcard-vgrade" style={{ color: vuln?.grade?.color, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {vuln?.grade?.label}
          </span>
          <ScoreRing score={vuln?.score ?? 0} color={vuln?.grade?.color} size={48} />
        </div>
      </header>

      {/* Driver stats */}
      <div className="pcard-stats" style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(3, 1fr)', 
        gap: '6px', 
        marginBottom: '14px', 
        position: 'relative', 
        zIndex: 1 
      }}>
        <Stat label="HR/9" value={num(season.hrPer9, 2)} tone={tone(season.hrPer9, { hi: 1.4, lo: 0.9 })} />
        <Stat label="K/9" value={num(season.kPer9, 1)} tone={tone(season.kPer9, { hi: 10, lo: 6.5, invert: true })} />
        <Stat label="Est K" value={entry.estK ? `${Math.round(entry.estK.k)}` : '—'} sub={entry.estK ? `${entry.estK.lo}–${entry.estK.hi}` : null} />
        <Stat label="ERA" value={num(season.era, 2)} tone={tone(season.era, { hi: 4.6, lo: 3.0 })} />
        <Stat label="Barrel%" value={sav.barrelPctAllowed != null ? num(sav.barrelPctAllowed, 1) : '—'} tone={tone(sav.barrelPctAllowed, { hi: 9, lo: 6 })} />
        <Stat label="EV against" value={sav.exitVeloAgainst != null ? `${num(sav.exitVeloAgainst, 1)}` : '—'} tone={tone(sav.exitVeloAgainst, { hi: 90, lo: 87 })} />
        <Stat
          label={Number.isFinite(x.xEra) ? 'xERA' : 'xwOBA'}
          value={Number.isFinite(x.xEra) ? num(x.xEra, 2) : Number.isFinite(x.xwOba) ? rate(x.xwOba) : '—'}
        />
      </div>

      {attackSide && (
        <div className="pcard-attack" style={{ 
          background: 'rgba(0,0,0,0.15)', 
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '8px', 
          padding: '8px 12px', 
          display: 'flex', 
          gap: '12px', 
          fontSize: '12px', 
          marginBottom: '14px', 
          position: 'relative', 
          zIndex: 1 
        }}>
          <span className="pa-cap" style={{ fontWeight: '700', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Icon name="Crosshair" size={12} style={{ color: 'var(--accent)' }} /> Platoon Target
          </span>
          <span className={`pa-hand ${attackSide === 'L' ? 'on' : ''}`} style={{ color: attackSide === 'L' ? 'var(--strong)' : 'var(--text-faint)', fontWeight: attackSide === 'L' ? '700' : '400' }}>
            LHB <b className="mono">{lH != null ? num(lH, 2) : '—'}</b>
          </span>
          <span className={`pa-hand ${attackSide === 'R' ? 'on' : ''}`} style={{ color: attackSide === 'R' ? 'var(--strong)' : 'var(--text-faint)', fontWeight: attackSide === 'R' ? '700' : '400' }}>
            RHB <b className="mono">{rH != null ? num(rH, 2) : '—'}</b>
          </span>
          <span className="pa-unit dim" style={{ marginLeft: 'auto', fontSize: '10px' }}>HR/9</span>
        </div>
      )}

      <div className="pcard-cols" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px', position: 'relative', zIndex: 1 }}>
        {/* Top HR targets */}
        <div className="pcard-targets">
          <h4 className="pcard-h4" style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
            <Icon name="Crosshair" size={12} style={{ color: 'var(--accent)' }} /> Top HR targets
          </h4>
          <ul className="ptarget-list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {targets.slice(0, 5).map((b) => (
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
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 6px',
                  borderRadius: '6px',
                  background: selectedId === b.id ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)',
                  border: `1px solid ${selectedId === b.id ? 'var(--accent)' : 'transparent'}`,
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                <span className="ptarget-ord mono" style={{ color: 'var(--text-faint)' }}>{b.battingOrder || '–'}</span>
                <span className={`ptarget-name ${liveMode && b.liveContext?.isHRThisGame ? 'hr-glow' : ''}`} style={{ flex: '1', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ fontWeight: '600', color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden' }}>{b.name}</span>
                  <span className={`bathand ${attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'pa-match' : ''}`} style={{
                    fontSize: '8px',
                    borderColor: attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'var(--strong)' : 'rgba(255,255,255,0.1)',
                    background: attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'rgba(16,185,129,0.1)' : 'transparent',
                    color: attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'var(--strong)' : 'inherit',
                    padding: '0 3px',
                    borderRadius: '3px',
                    borderStyle: 'solid',
                    borderWidth: '1px'
                  }}>
                    {b.batSide}
                  </span>
                </span>
                <GradeChip grade={b.grade} size="sm" score={b.score} />
              </li>
            ))}
          </ul>

          {/* SGP combos — collapsible */}
          {(() => {
            const sgp2 = sgpLegs(targets, 2)
            const sgp3 = sgpLegs(targets, 3)
            if (!sgp2 && !sgp3) return null
            return (
              <div style={{ marginTop: '10px' }}>
                <button
                  onClick={() => setSgpOpen((v) => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', color: sgpOpen ? 'var(--accent)' : 'var(--text-faint)', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  <Icon name="Zap" size={11} />
                  SGP combos
                  <Icon name={sgpOpen ? 'ChevronUp' : 'ChevronDown'} size={11} style={{ marginLeft: '2px' }} />
                </button>
                {sgpOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', padding: '10px 12px', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
                    {sgp2 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-faint)', minWidth: '30px' }}>2-leg</span>
                        <SgpCombo legs={sgp2.legs} prob={sgp2.prob} onSelect={onSelect} />
                      </div>
                    )}
                    {sgp3 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-faint)', minWidth: '30px' }}>3-leg</span>
                        <SgpCombo legs={sgp3.legs} prob={sgp3.prob} onSelect={onSelect} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* Pitch mix + splits/fatigue */}
        <div className="pcard-side" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {usage.length > 0 && (
            <div className="pcard-mix">
              <h4 className="pcard-h4" style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                <Icon name="Layers" size={12} style={{ color: 'var(--accent)' }} /> Pitch mix
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {usage.slice(0, 4).map((p) => (
                  <div className="mix-row" key={p.code} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
                    <span className="mix-label" style={{ width: '45px', color: 'var(--text-dim)' }}>{p.label}</span>
                    <span className="mix-track" style={{ flex: '1', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', overflow: 'hidden' }}>
                      <span className="mix-fill" style={{ display: 'block', height: '100%', width: `${Math.min(100, p.pct)}%`, background: 'var(--accent)' }} />
                    </span>
                    <span className="mix-pct mono" style={{ width: '22px', textAlign: 'right' }}>{num(p.pct, 0)}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(vl || vr || Number.isFinite(pl3d)) && (
            <div className="pcard-splits">
              <h4 className="pcard-h4" style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                <Icon name="BarChart3" size={12} style={{ color: 'var(--accent)' }} /> splits & workload
              </h4>
              <div className="split-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '6px', padding: '4px', textAlign: 'center' }}>
                  <div style={{ fontSize: '7px', color: 'var(--text-faint)', textTransform: 'uppercase' }}>vs LHB</div>
                  <span className="mono" style={{ fontSize: '11px', fontWeight: '700', color: vl?.hrPer9 >= 1.3 ? 'var(--b-hot)' : '#fff' }}>{num(vl?.hrPer9, 2)}</span>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '6px', padding: '4px', textAlign: 'center' }}>
                  <div style={{ fontSize: '7px', color: 'var(--text-faint)', textTransform: 'uppercase' }}>vs RHB</div>
                  <span className="mono" style={{ fontSize: '11px', fontWeight: '700', color: vr?.hrPer9 >= 1.3 ? 'var(--b-hot)' : '#fff' }}>{num(vr?.hrPer9, 2)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
