import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { GradeChip, BadgeRow, KV, hexA, ScoreRing } from './atoms.jsx'
import { eli5IconName, toneColor, gradeColor } from '../lib/badges.js'
import { pct, rate, num, signedPct, american, decimalToAmerican, ordinal } from '../lib/format.js'
import { bookLabel } from '../lib/data.js'
import { compass, skyLabel } from '../lib/weather.js'
import { interpretWind } from '../lib/wind.js'
import { playerHeadshot, teamColor } from '../lib/teams.js'
import { toolGrades, heatBreakdown, scoutVerdict, gradeLabel, hrSetup } from '../lib/scout.js'
import { blastOf, blastVsHandOf } from '../lib/groups.js'
import { estimatedKs } from '../lib/pitchers.js'
import { useLiveMode } from '../lib/liveMode.js'
import { useEliLevel, reasonsForLevel } from '../lib/eliLevel.js'

function useFocusTrap() {
  const ref = useRef(null)
  useEffect(() => {
    const restore = document.activeElement
    const el = ref.current
    const focusables = () =>
      el
        ? [...el.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
            (x) => !x.disabled && x.offsetParent !== null,
          )
        : []
    ;(focusables()[0] || el)?.focus()
    const onKey = (e) => {
      if (e.key !== 'Tab') return
      const f = focusables()
      if (!f.length) return
      const first = f[0]
      const last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    el?.addEventListener('keydown', onKey)
    return () => {
      el?.removeEventListener('keydown', onKey)
      if (restore && typeof restore.focus === 'function') restore.focus()
    }
  }, [])
  return ref
}

function useCountUp(target, ms = 550) {
  const [v, setV] = useState(target)
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setV(target)
      return
    }
    let raf
    let start = null
    const tick = (t) => {
      if (start === null) start = t
      const p = Math.min(1, (t - start) / ms)
      setV(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

export default function PlayerDrawer({ batter: b, batters, onClose, watched, inSlip, onToggleWatch, onToggleSlip, onOpenZone, onOpenPitcher }) {
  const trapRef = useFocusTrap()
  const liveMode = useLiveMode()

  useEffect(() => {
    if (typeof document === 'undefined') return
    // Lock the scroll container (.app) while the drawer is open — it keeps its
    // scrollTop, so no save/restore jump. (.app is the scroller, not body.)
    const scroller = document.querySelector('.app')
    if (!scroller) return
    const prev = scroller.style.overflow
    scroller.style.overflow = 'hidden'
    return () => {
      scroller.style.overflow = prev
    }
  }, [])

  if (!b) return null
  const g = b.grade?.label || 'SKIP'
  const color = gradeColor(g)

  const content = (
    <>
      <div className="drawer-scrim drawer-scrim-top" onClick={onClose} style={{ backdropFilter: 'blur(4px)' }} />
      <aside
        className="drawer"
        style={{ 
          '--accent': color,
          background: 'var(--glass-bg)',
          borderLeft: '1px solid rgba(255, 255, 255, 0.08)',
          boxShadow: 'var(--glass-shadow)',
          backdropFilter: 'blur(16px)'
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`${b.name} detail`}
        tabIndex={-1}
        ref={trapRef}
      >
        <button className="drawer-grab" onClick={onClose} aria-label="Close" title="Close" />
        <DrawerHeader
          b={b}
          color={color}
          onClose={onClose}
          watched={watched}
          inSlip={inSlip}
          onToggleWatch={onToggleWatch}
          onToggleSlip={onToggleSlip}
        />
        <div className="drawer-body" style={{ padding: '20px', overflowY: 'auto' }}>
          <HeroNumbers b={b} color={color} />
          <PlateMatchup b={b} onOpenZone={onOpenZone} />
          <ScoutReport b={b} />
          <HrSetupSection b={b} />
          <ZoneTeaser b={b} onOpen={onOpenZone} />
          <HrFormSection b={b} />
          <PaCurve b={b} color={color} />
          <Why b={b} />
          <StatsSection b={b} />
          <StatcastSection b={b} />
          <PercentileSection b={b} />
          <EnvSection b={b} />
          <PitcherSection b={b} batters={batters} onOpenPitcher={onOpenPitcher} />
          <OddsSection b={b} />
          {liveMode && b.game?.isLive && <LiveSection b={b} />}
          <TechReasons b={b} />
        </div>
      </aside>
    </>
  )

  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

function DrawerHeader({ b, color, onClose, watched, inSlip, onToggleWatch, onToggleSlip }) {
  const liveMode = useLiveMode()
  return (
    <div className="drawer-head" style={{ 
      background: `linear-gradient(180deg, ${hexA(color, 0.15)} 0%, transparent 100%)`,
      padding: '24px 20px 20px',
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
      position: 'relative'
    }}>
      <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close" style={{
        position: 'absolute',
        top: '20px',
        right: '20px'
      }}>
        <Icon name="X" size={18} />
      </button>
      <div className="drawer-head-main" style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        <img
          className="drawer-avatar"
          src={playerHeadshot(b.playerId, 160)}
          alt={b.name}
          style={{ 
            borderColor: hexA(color, 0.4),
            borderWidth: '2px',
            borderStyle: 'solid',
            borderRadius: '12px',
            width: '80px',
            height: '80px',
            background: 'var(--card-2)',
            objectFit: 'cover'
          }}
        />
        <div className="drawer-title" style={{ flex: '1', minWidth: '0' }}>
          <div className="drawer-name-row" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
            <h2 className={liveMode && b.liveContext?.isHRThisGame ? 'hr-glow' : ''} style={{
              fontFamily: 'var(--display)',
              fontSize: '22px',
              fontWeight: '800',
              color: '#fff',
              letterSpacing: '-0.02em'
            }}>{b.name}</h2>
            <span className="bathand-lg" style={{
              fontSize: '11px',
              fontFamily: 'var(--mono)',
              background: 'rgba(255,255,255,0.05)',
              padding: '1px 6px',
              borderRadius: '4px',
              color: 'var(--text-dim)',
              border: '1px solid rgba(255,255,255,0.08)'
            }}>{b.batSide}HB</span>
            <GradeChip grade={b.grade} size="lg" />
          </div>
          <div className="drawer-sub" style={{ fontSize: '13px', color: 'var(--text-dim)', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
            <span className="team-tag" style={{ color: '#fff', fontWeight: '700' }}>{b.team}</span> vs{' '}
            <span className="opp-tag">{b.opponent?.name || '—'}</span>
            {b.battingOrder ? <span className="dot-sep">·</span> : null}
            {b.battingOrder ? <span>Batting {ordinal(b.battingOrder)}</span> : null}
            <span className="dot-sep">·</span>
            <span>{b.isHome ? 'Home' : 'Away'}</span>
            {b.game?.venueName ? (
              <>
                <span className="dot-sep">·</span>
                <span>{b.game.venueName}</span>
              </>
            ) : null}
          </div>
          <div className="drawer-badges" style={{ marginBottom: '12px' }}>
            <BadgeRow batter={b} />
          </div>
          <div className="drawer-actions" style={{ display: 'flex', gap: '8px' }}>
            <button 
              className={`d-act ${inSlip ? 'on' : ''}`} 
              onClick={() => onToggleSlip(b)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: inSlip ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255,255,255,0.04)',
                color: inSlip ? 'var(--strong)' : '#fff',
                border: inSlip ? '1px solid var(--strong)' : '1px solid rgba(255,255,255,0.08)',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '600'
              }}
            >
              <Icon name={inSlip ? 'Check' : 'Plus'} size={14} />
              {inSlip ? 'In parlay' : 'Add to parlay'}
            </button>
            <button 
              className={`d-act ghost ${watched ? 'on' : ''}`} 
              onClick={() => onToggleWatch(b)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                background: watched ? 'rgba(245, 166, 35, 0.12)' : 'transparent',
                color: watched ? 'var(--prime)' : 'var(--text-dim)',
                border: watched ? '1px solid var(--prime)' : '1px solid transparent',
                padding: '6px 14px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: '600'
              }}
            >
              <Icon name="Star" size={14} style={{ fill: watched ? 'currentColor' : 'none' }} />
              {watched ? 'Watching' : 'Watch'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function HeroNumbers({ b, color }) {
  const vegas = b.vegasImpliedProb
  const diff = vegas != null && b.hrProbability != null ? b.hrProbability - vegas : null
  const shownProb = useCountUp(b.hrProbability)
  return (
    <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px', marginBottom: '20px' }}>
      <div className="hero-main" style={{ 
        borderColor: hexA(color, 0.3), 
        background: `linear-gradient(135deg, ${hexA(color, 0.08)} 0%, rgba(255,255,255,0.01) 100%)`,
        padding: '16px',
        borderRadius: '12px',
        borderWidth: '1px',
        borderStyle: 'solid',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div className="hero-main-info">
          <div className="hero-main-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: '4px' }}>HR Probability</div>
          <div className="hero-main-val mono" style={{ color, fontSize: '32px', fontWeight: '800', lineHeight: 1.1 }}>
            {pct(shownProb, 2)}
          </div>
          <div className="hero-main-sub" style={{ fontSize: '10px', color: 'var(--text-faint)', marginTop: '4px' }}>raw score {num(b.rawScore)}</div>
        </div>
        <ScoreRing score={b.score} color={color} size={60} />
      </div>
      <div className="hero-side" style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '12px',
        padding: '12px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '6px'
      }}>
        <KV k="Expected HRs" v={num(b.expectedHRs, 3)} />
        <KV k="Expected PAs" v={num(b.expectedPAs, 1)} />
        <KV k="Sim HR%" v={pct(b.simHRProb, 2)} />
        <KV k="Ensemble" v={num(b.ensembleScore)} />
        {vegas != null && <KV k="Market implied" v={pct(vegas, 1)} />}
        {diff != null && (
          <KV k="Model vs Mkt" v={signedPct(diff, 1)} accent={diff >= 0 ? 'var(--good)' : 'var(--bad)'} />
        )}
      </div>
    </div>
  )
}

const SCOUT_TOOLS = [
  { key: 'power', label: 'Power', color: 'var(--prime)' },
  { key: 'matchup', label: 'Matchup', color: 'var(--strong)' },
  { key: 'environment', label: 'Park / Air', color: 'var(--accent)' },
]

const LG_BLAST = 15
const LG_BARREL = 8
const LG_HR9 = 1.25

function plateMatchup(b) {
  const ms = b.matchupScore
  if (!Number.isFinite(ms)) return null
  const lean = Math.round(ms - 50)
  const verdict =
    lean >= 12 ? 'Batter Favored' :
    lean >= 4 ? 'Lean Batter' :
    lean > -4 ? 'Even Matchup' :
    lean > -12 ? 'Lean Pitcher' : 'Pitcher Favored'
  const tone = lean >= 4 ? 'good' : lean <= -4 ? 'bad' : 'even'
  return { lean, verdict, tone }
}

function PillarBar({ label, value, hint }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
  const tone = v == null ? '' : v >= 67 ? 'good' : v >= 45 ? 'mid' : 'bad'
  return (
    <div className="pm-pillar" title={hint} style={{ marginBottom: '10px' }}>
      <div className="pm-pillar-top" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
        <span className="pm-pillar-label" style={{ color: 'var(--text-dim)' }}>{label}</span>
        <span className="pm-pillar-val mono" style={{ fontWeight: '700' }}>{v == null ? '—' : Math.round(v)}</span>
      </div>
      <span className="pm-pillar-track" style={{ display: 'block', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', height: '4px', overflow: 'hidden' }}>
        <span className={`pm-pillar-fill ${tone}`} style={{ 
          display: 'block', 
          width: `${v ?? 0}%`, 
          height: '100%',
          background: tone === 'good' ? 'var(--strong)' : tone === 'mid' ? 'var(--prime)' : 'var(--bad)'
        }} />
      </span>
    </div>
  )
}

function PlateMatchup({ b, onOpenZone }) {
  const pm = plateMatchup(b)
  if (!pm) return null
  const blast = blastOf(b)
  const vsHandBlast = blastVsHandOf(b)
  const barrel = Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct
  const hr9 = Number.isFinite(b.effectiveHR9) ? b.effectiveHR9 : b.pitcher?.season?.hrPer9
  const slot = b.battingOrder
  const pas = b.expectedPAs
  const jump = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const acts = [
    { label: 'Zone', icon: 'Crosshair', go: () => (b?.zoneMatchup ? onOpenZone?.(b) : jump('sec-zone')()) },
    { label: 'Pitcher', icon: 'Shield', go: jump('sec-pitcher') },
    { label: 'Statcast', icon: 'Gauge', go: jump('sec-statcast') },
    { label: 'Air', icon: 'Wind', go: jump('sec-env') },
  ]
  return (
    <section className="drawer-section pm-card" style={{
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.05)',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '20px'
    }}>
      <div className="pm-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span className="pm-title" style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="Target" size={14} /> Plate Matchup
        </span>
        <span className={`pm-hr-pill ${pm.tone}`} style={{
          fontSize: '10px',
          fontWeight: '700',
          padding: '2px 8px',
          borderRadius: '6px',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: pm.tone === 'good' ? 'rgba(16, 185, 129, 0.1)' : pm.tone === 'bad' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.05)',
          color: pm.tone === 'good' ? 'var(--strong)' : pm.tone === 'bad' ? 'var(--bad)' : 'var(--text-dim)'
        }}>
          <Icon name="Zap" size={10} /> HR Signal
        </span>
      </div>
      <div className={`pm-verdict tone-${pm.tone}`} style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px',
        borderRadius: '8px',
        marginBottom: '14px',
        background: pm.tone === 'good' ? 'rgba(16, 185, 129, 0.05)' : pm.tone === 'bad' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${pm.tone === 'good' ? 'rgba(16, 185, 129, 0.15)' : pm.tone === 'bad' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.04)'}`
      }}>
        <div className="pm-verdict-txt">
          <span className="pm-verdict-label" style={{ fontSize: '15px', fontWeight: '800', color: '#fff', display: 'block' }}>{pm.verdict}</span>
          <span className="pm-verdict-sub dim" style={{ fontSize: '11px' }}>batter vs {b.pitcher?.name || 'TBD'}</span>
        </div>
        <span className="pm-verdict-num mono" style={{
          fontSize: '20px',
          fontWeight: '800',
          color: pm.tone === 'good' ? 'var(--strong)' : pm.tone === 'bad' ? 'var(--bad)' : '#fff'
        }}>{pm.lean > 0 ? '+' : ''}{pm.lean}</span>
      </div>
      <div className="pm-pillars" style={{ marginBottom: '14px' }}>
        <PillarBar label="Bat threat" value={b.batterScore} hint="Hitter's own HR threat." />
        <PillarBar label="Matchup fit" value={b.matchupScore} hint="This batter vs this starter." />
        <PillarBar label="Park / Weather" value={b.envScore} hint="Venue HR factors." />
      </div>
      <div className="pm-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
        {Number.isFinite(blast) && (
          <span className={`pm-chip ${blast >= LG_BLAST ? 'good' : ''}`}>
            <Icon name="Zap" size={10} /> Blast {num(blast, 0)}%
            {Number.isFinite(vsHandBlast) && <span className="pm-chip-sub"> · vs {b.batTracking?.vsHand}P {num(vsHandBlast, 0)}%</span>}
          </span>
        )}
        {Number.isFinite(barrel) && (
          <span className={`pm-chip ${barrel >= LG_BARREL ? 'good' : ''}`}>
            <Icon name="Crosshair" size={10} /> Barrel {num(barrel, 0)}%
          </span>
        )}
        {Number.isFinite(hr9) && (
          <span className={`pm-chip ${hr9 >= LG_HR9 ? 'good' : 'bad'}`}>
            <Icon name="Flame" size={10} /> Arm {num(hr9, 2)} HR/9
          </span>
        )}
      </div>
      <div className="pm-foot" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '12px' }}>
        <span className="pm-lineup" style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <Icon name="List" size={11} />
          {slot ? <> Batting <b>{ordinal(slot)}</b></> : <> Lineup <b>{b.lineupConfirmed ? 'set' : 'projected'}</b></>}
          {Number.isFinite(pas) && <span className="dim"> · ~{num(pas, 1)} PA</span>}
        </span>
        <div className="pm-acts" style={{ display: 'flex', gap: '4px' }}>
          {acts.map((a) => (
            <button key={a.label} className="pm-act" onClick={a.go} style={{
              fontSize: '10px',
              fontWeight: '600',
              padding: '3px 8px',
              borderRadius: '4px',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.06)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              color: 'var(--text-dim)'
            }}>
              <Icon name={a.icon} size={10} /> {a.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function ScoutReport({ b }) {
  if (b.batterScore == null && b.matchupScore == null) return null
  const grades = toolGrades(b)
  return (
    <Section title="Scout report" icon="Crosshair">
      <div className="scout-verdict" style={{ fontSize: '14px', fontWeight: '600', color: '#fff', marginBottom: '14px', lineHeight: '1.4' }}>{scoutVerdict(b)}</div>
      <div className="scout-grades" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {SCOUT_TOOLS.map((t) => {
          const g = grades[t.key]
          return (
            <div key={t.key} className="scout-tool" title={`${t.label} grade ${g}/80`}>
              <div className="scout-tool-head" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span className="scout-tool-label" style={{ color: 'var(--text-dim)' }}>{t.label}</span>
                <span className="scout-tool-grade mono" style={{ color: t.color, fontWeight: '700' }}>
                  {g}
                  <span className="scout-tool-desc" style={{ fontSize: '10px', color: 'var(--text-faint)' }}> · {gradeLabel(g)}</span>
                </span>
              </div>
              <div className="scout-tool-track" style={{ background: 'rgba(255,255,255,0.04)', height: '5px', borderRadius: '99px', overflow: 'hidden' }}>
                <div className="scout-tool-fill" style={{ width: `${((g - 20) / 60) * 100}%`, background: t.color, height: '100%', borderRadius: '99px' }} />
              </div>
            </div>
          )
        })}
      </div>
      {b.zoneBonus != null && b.zoneBonus !== 0 && (
        <div className="zone-bonus" style={{ fontSize: '12px', marginTop: '14px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)', color: 'var(--text-dim)' }}>
          Zone matchup{' '}
          <span className={`mono ${b.zoneBonus >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: '700' }}>
            {b.zoneBonus >= 0 ? '+' : ''}
            {num(b.zoneBonus)}
          </span>
        </div>
      )}
    </Section>
  )
}

function PaCurve({ b, color }) {
  const pa = b.paBreakdown
  if (!Array.isArray(pa) || !pa.length) return null
  const max = Math.max(0.02, ...pa.map((x) => x.p || 0))
  return (
    <Section title="Per plate appearance" icon="BarChart3">
      <div className="pa-curve" style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', height: '80px', alignItems: 'flex-end', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        {pa.map((x, i) => (
          <div
            className="pa-bar-wrap"
            key={i}
            title={`PA ${x.pa}: ${pct(x.p, 1)} HR chance`}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: '1', height: '100%', justifyContent: 'flex-end' }}
          >
            <div className="pa-bar-track" style={{ background: 'rgba(255,255,255,0.03)', width: '100%', flex: '1', borderRadius: '4px', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
              <div
                className="pa-bar"
                style={{ 
                  height: `${Math.max(4, (x.p / max) * 100)}%`, 
                  background: color, 
                  opacity: x.partial ? 0.4 : 1,
                  width: '100%',
                  borderRadius: '4px',
                  boxShadow: `0 0 8px ${hexA(color, 0.4)}`
                }}
              />
            </div>
            <span className="pa-bar-lbl mono" style={{ fontSize: '10px', marginTop: '4px', color: 'var(--text-faint)' }}>{x.pa}</span>
          </div>
        ))}
      </div>
      <div className="pa-curve-cap dim" style={{ fontSize: '11px', marginTop: '8px' }}>
        HR chance per PA. Sum = <b className="mono" style={{ color: '#fff' }}>{num(b.expectedHRs, 3)}</b> xHR over{' '}
        {num(b.expectedPAs, 1)} PA.
      </div>
    </Section>
  )
}

function Why({ b }) {
  const level = useEliLevel()
  const items = reasonsForLevel(b, level)
  if (!items.length) return null
  const title = level === 'eli15' ? 'Why — stats breakdown' : 'Why — plain English'
  return (
    <Section title={title} icon="Info">
      <ul className="eli5" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map((r, i) => (
          <li key={i} className={`eli5-item tone-${r.tone}`} style={{
            display: 'flex',
            gap: '10px',
            alignItems: 'flex-start',
            padding: '10px 12px',
            borderRadius: '8px',
            background: r.tone === 'good' ? 'rgba(16,185,129,0.04)' : r.tone === 'bad' ? 'rgba(239,68,68,0.04)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${r.tone === 'good' ? 'rgba(16,185,129,0.1)' : r.tone === 'bad' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.04)'}`
          }}>
            <span className="eli5-icon" style={{ color: toneColor(r.tone), marginTop: '1px' }}>
              <Icon name={eli5IconName(r.icon)} size={13} />
            </span>
            <span className="eli5-text" style={{ fontSize: '12px', color: 'var(--text-dim)', lineHeight: '1.4' }}>{r.text}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function StatLine({ label, s }) {
  if (!s) return null
  return (
    <div className="statline" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
      <span className="statline-label" style={{ fontSize: '12px', color: 'var(--text-dim)', fontWeight: '600' }}>{label}</span>
      <div className="statline-vals" style={{ display: 'flex', gap: '10px' }}>
        <Mini k="AVG" v={rate(s.avg)} />
        <Mini k="OBP" v={rate(s.obp)} />
        <Mini k="SLG" v={rate(s.slg)} />
        <Mini k="ISO" v={rate(s.iso ?? (s.slg != null && s.avg != null ? s.slg - s.avg : null))} />
        <Mini k="HR" v={num(s.hr)} />
        <Mini k="AB" v={num(s.ab)} />
      </div>
    </div>
  )
}

function StatsSection({ b }) {
  if (!b.season && !b.recent) return null
  return (
    <Section title="Hitting" icon="Activity">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <StatLine label="Season" s={b.season} />
        <StatLine label="Last 30" s={b.recent} />
      </div>
      {b.hrStreak ? (
        <div className="note" style={{ color: 'var(--b-hot)', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.15)', borderRadius: '6px', padding: '8px 12px', marginTop: '10px', fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="Flame" size={12} /> <span>Active home-run streak signal</span>
        </div>
      ) : null}
    </Section>
  )
}

function StatcastSection({ b }) {
  const x = b.xStats || {}
  const has = [b.barrelPct, b.exitVelo, b.launchAngle, x.xSLG].some((v) => v != null)
  if (!has) return null
  return (
    <Section title="Statcast" icon="Gauge" id="sec-statcast">
      <div className="stat-grid">
        <Cell k="Barrel%" v={b.barrelPct != null ? `${num(b.barrelPct, 1)}%` : '—'} />
        <Cell k="Barrel/BBE" v={b.barrelPctBBE != null ? `${num(b.barrelPctBBE, 1)}%` : '—'} />
        <Cell k="Exit Velo" v={b.exitVelo != null ? `${num(b.exitVelo, 1)}` : '—'} unit="mph" />
        <Cell k="Launch Angle" v={b.launchAngle != null ? `${num(b.launchAngle, 1)}°` : '—'} />
        <Cell k="xBA" v={rate(x.xBA)} />
        <Cell k="xSLG" v={rate(x.xSLG)} />
        <Cell k="xISO" v={rate(x.xISO)} />
        <Cell k="xwOBA" v={rate(x.xwOBA)} />
        {b.pullPct != null && (
          <Cell
            k="Pull%"
            v={`${num(b.pullPct, 0)}%`}
            tone={b.pullPct >= 45 ? 'good' : null}
            title="Share of batted balls pulled — pull-side contact clears fences more often."
          />
        )}
      </div>
      {b.primaryPitchEdge?.passes && (
        <div className="note good" style={{
          marginTop: '12px',
          background: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.15)',
          borderRadius: '8px',
          padding: '10px 12px',
          fontSize: '11px',
          color: 'var(--strong)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <Icon name="Target" size={12} /> 
          <span>Crushes the {b.primaryPitchEdge.pitchName} ({rate(b.primaryPitchEdge.batterSlg)} SLG) — pitcher throws it {pct(b.primaryPitchEdge.pitcherFreq, 0)}</span>
        </div>
      )}
      {b.pitchTypeSplits?.length > 0 && (
        <div className="pitch-splits">
          <div className="pitch-splits-cap dim">SLG vs the arsenal (by usage)</div>
          <div className="pitch-splits-row">
            {b.pitchTypeSplits.map((p) => (
              <span
                key={p.key}
                className="pitch-split"
                title={`${p.name} — thrown ${p.usage}%${p.whiff != null ? ` · ${num(p.whiff, 0)}% whiff` : ''}`}
              >
                <span className="ps-name">{p.name}</span>
                {p.slg != null ? (
                  <b className={`ps-slg ${p.slg >= 0.5 ? 'pos' : p.slg <= 0.35 ? 'neg' : ''}`}>{rate(p.slg)}</b>
                ) : (
                  <b className="ps-slg dim">—</b>
                )}
                <span className="ps-usage dim">{p.usage}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

const PCTILE_ROWS = [
  { k: 'hrRate', label: 'HR/AB', v: (b) => (b.season?.ab >= 30 ? pct(b.season.hr / b.season.ab, 1) : null) },
  { k: 'iso', label: 'ISO', v: (b) => rate(b.season?.iso ?? (b.season?.slg != null && b.season?.avg != null ? b.season.slg - b.season.avg : null)) },
  { k: 'xiso', label: 'xISO', v: (b) => rate(b.xStats?.xISO) },
  { k: 'barrel', label: 'Barrel%', v: (b) => (b.barrelPctBBE ?? b.barrelPct) != null ? `${num(b.barrelPctBBE ?? b.barrelPct, 1)}%` : null },
  { k: 'ev', label: 'Exit velo', v: (b) => (b.exitVelo != null ? `${num(b.exitVelo, 1)} mph` : null) },
  { k: 'hardHit', label: 'Hard-hit%', v: (b) => (b.hardHitPct != null ? `${num(b.hardHitPct, 0)}%` : null) },
]
const pctileColor = (p) => `hsl(${220 - 180 * (p / 100)} 75% 50%)`

function PercentileSection({ b }) {
  // Prefer the true vs-MLB Statcast percentile (server-computed across every
  // qualified batter) for the metrics it covers; fall back to the slate-
  // relative rank otherwise. Keep the slate rank as a secondary tag so you can
  // still see where a bat lands among tonight's options.
  const rows = PCTILE_ROWS.map((r) => {
    const mlbP = b.pctileMLB?.[r.k]
    const slateP = b.pctile?.[r.k]
    const mlb = Number.isFinite(mlbP)
    return { ...r, p: mlb ? mlbP : slateP, slateP, basis: mlb ? 'MLB' : 'slate', val: r.v(b) }
  }).filter((r) => r.p != null)
  if (!rows.length) return null
  return (
    <Section title="Percentiles" icon="BarChart3">
      <div className="pctile-cap dim" style={{ fontSize: '11px', marginBottom: '14px' }}>Statcast power quality ranked vs <b>all MLB</b> (Savant); rate stats vs today&apos;s slate. Small line = rank among today&apos;s bats.</div>
      <div className="pctile-list" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {rows.map((r) => (
          <div className="pctile-row" key={r.k} title={`${r.label}: better than ${r.p}% (${r.basis === 'MLB' ? 'vs all MLB' : "vs today's slate"})`} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
            <span className="pctile-label" style={{ width: '66px', color: 'var(--text-dim)', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{r.label}</span>
            <span className="pctile-bar" style={{ flex: '1', height: '8px', background: 'var(--card-2)', borderRadius: '99px', position: 'relative', overflow: 'hidden' }}>
              <span className="pctile-fill" style={{ width: `${r.p}%`, background: pctileColor(r.p), opacity: 1, height: '100%', display: 'block', borderRadius: '99px' }} />
            </span>
            <span className="pctile-rank mono" style={{ width: '52px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.15 }}>
              <span>
                <b style={{ fontWeight: '800', color: pctileColor(r.p) }}>{r.p}</b>
                <span className="dim" style={{ fontSize: '8px', fontWeight: '700', marginLeft: '3px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{r.basis}</span>
              </span>
              {r.basis === 'MLB' && Number.isFinite(r.slateP) && (
                <span className="dim" style={{ fontSize: '9px', color: 'var(--text-faint)' }}>{r.slateP} slate</span>
              )}
            </span>
            <span className="pctile-val mono" style={{ width: '58px', textAlign: 'right', fontWeight: '700', color: '#fff' }}>{r.val ?? '—'}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

function WindDial({ deg, speed }) {
  const rot = (deg ?? 0) + 180
  return (
    <div className="wind-dial" title={`Wind from ${compass(deg) || '—'} (${deg ?? '—'}°)`} style={{
      background: 'rgba(0,0,0,0.15)',
      border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '50%',
      padding: '4px',
      width: '64px',
      height: '64px',
      display: 'grid',
      placeItems: 'center',
      flexShrink: '0'
    }}>
      <svg viewBox="0 0 64 64" width="56" height="56">
        <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1.5" />
        <text x="32" y="11" fill="var(--text-faint)" fontSize="8" fontWeight="800" textAnchor="middle">
          N
        </text>
        {deg != null && (
          <g transform={`rotate(${rot} 32 32)`}>
            <path d="M32 14 L37 32 L32 28 L27 32 Z" fill="var(--accent)" style={{ filter: 'drop-shadow(0 0 4px var(--accent))' }} />
          </g>
        )}
        <text x="32" y="34" fill="#fff" fontSize="12" fontWeight="800" textAnchor="middle" dominantBaseline="central">
          {speed != null ? Math.round(speed) : '—'}
        </text>
        <text x="32" y="46" fill="var(--text-faint)" fontSize="6" fontWeight="700" textAnchor="middle">
          mph
        </text>
      </svg>
    </div>
  )
}

function Wx({ icon, k, v, sub }) {
  return (
    <div className="wx" style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
      <Icon name={icon} size={14} style={{ color: 'var(--accent)' }} />
      <div className="wx-body">
        <div className="wx-k" style={{ fontSize: '9px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
        <div className="wx-v mono" style={{ fontSize: '12px', fontWeight: '700', color: '#fff' }}>
          {v}
          {sub ? <span className="wx-sub" style={{ fontSize: '10px', color: 'var(--text-dim)' }}> · {sub}</span> : null}
        </div>
      </div>
    </div>
  )
}

function EnvSection({ b }) {
  const w = b.weather
  const hasFactors = [b.gameParkHRFactor, b.parkWeatherHandFactor].some((v) => v != null)
  if (!w && !hasFactors) return null
  const sky = skyLabel(w)
  const wind = interpretWind(w, b.game?.homeTeam?.abbr, { roofClosed: w?.roofClosed })
  return (
    <Section title="Park & weather" icon="Wind" id="sec-env">
      {wind && (
        <div className="wind-verdict-line" style={{ 
          color: wind.tint, 
          display: 'flex', 
          alignItems: 'center', 
          gap: '6px', 
          fontSize: '12px', 
          fontWeight: '700', 
          background: hexA(wind.tint, 0.08),
          padding: '8px 12px',
          borderRadius: '8px',
          border: `1px solid ${hexA(wind.tint, 0.25)}`,
          marginBottom: '12px'
        }}>
          <Icon name="Wind" size={13} />
          <b>{wind.verdict}</b>
          <span>{wind.caption}</span>
        </div>
      )}
      {w && (
        <div className="weather" style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '12px' }}>
          <WindDial deg={w.windDirDeg} speed={w.windSpeedMph} />
          <div className="weather-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', flex: '1' }}>
            <Wx icon="Thermometer" k="Temp" v={w.tempF != null ? `${Math.round(w.tempF)}°F` : '—'} />
            <Wx
              icon="Wind"
              k="Wind"
              v={w.windSpeedMph != null ? `${Math.round(w.windSpeedMph)} ${compass(w.windDirDeg) || ''}` : '—'}
              sub={Number.isFinite(w.windGustMph) && w.windGustMph <= 90 && w.windGustMph >= (w.windSpeedMph || 0) ? `G${Math.round(w.windGustMph)}` : null}
            />
            <Wx icon="Droplet" k="Humidity" v={w.humidity != null ? `${w.humidity}%` : '—'} />
            <Wx icon="Cloud" k="Precip" v={w.precipProbPct != null ? `${w.precipProbPct}%` : '—'} />
          </div>
        </div>
      )}
      {sky && (
        <div className="note" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-dim)', background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '6px', marginBottom: '12px' }}>
          <Icon name={w.roofClosed ? 'House' : 'Cloud'} size={12} style={{ color: 'var(--accent)' }} /> 
          <span>{sky}{w.source ? ` (${w.source.toUpperCase()})` : ''}</span>
        </div>
      )}
      {hasFactors && (
        <div className="stat-grid" style={{ marginTop: w ? 12 : 0 }}>
          <Cell
            k="Park HR factor"
            v={b.gameParkHRFactor != null ? `${num(b.gameParkHRFactor, 3)}×` : '—'}
            title="Park-only HR multiplier (1.00 = average)"
          />
          <Cell
            k="Air factor"
            v={b.parkWeatherHandFactor != null ? `${num(b.parkWeatherHandFactor, 3)}×` : '—'}
            title="Combined conditions factor"
          />
          {b.parkWeatherHandFactor != null && (
            <Cell
              k="Air vs neutral"
              v={signedPct(b.parkWeatherHandFactor - 1, 1)}
              title="Condition change versus standard"
            />
          )}
        </div>
      )}
    </Section>
  )
}

function battedBallLabel(goAo) {
  if (!Number.isFinite(goAo) || goAo <= 0) return '—'
  const tag = goAo <= 0.92 ? 'FB' : goAo >= 1.45 ? 'GB' : 'neu'
  return `${goAo.toFixed(2)} · ${tag}`
}
function ballTone(goAo) {
  if (!Number.isFinite(goAo) || goAo <= 0) return null
  if (goAo <= 0.92) return 'good'
  if (goAo >= 1.45) return 'bad'
  return null
}

function PitcherSection({ b, batters, onOpenPitcher }) {
  const p = b.pitcher
  if (!p) return null
  const s = p.season || {}
  // Per-start strikeout projection, opponent-adjusted: this pitcher faces b's
  // whole lineup (same game + same team), so their combined K% feeds the
  // estimate — same as the Pitchers page. Falls back to neutral if the lineup
  // isn't available.
  const lineup = (batters || []).filter((x) => x.gamePk === b.gamePk && x.team === b.team)
  const estK = estimatedKs(p, lineup)
  const split = b.batSide === 'L' ? p.splits?.vl : p.splits?.vr
  const rf = p.recentForm
  const canOpen = !!onOpenPitcher && p.id != null
  const idBlock = (
    <div>
      <div className="pitcher-name" style={{ fontSize: '15px', fontWeight: '800', color: '#fff' }}>{p.name}</div>
      <div className="pitcher-meta" style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
        {p.hand}HP{split ? ` · vs ${b.batSide}HB` : ''}
      </div>
    </div>
  )
  return (
    <Section title="Opposing pitcher" icon="Shield" id="sec-pitcher">
      <div className="pitcher-head" style={{ marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '10px' }}>
        {canOpen ? (
          <button className="pitcher-link" onClick={() => onOpenPitcher(p.id, b.gamePk)} title={`Open ${p.name}'s pitcher card`} style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            color: 'var(--accent)'
          }}>
            {idBlock}
            <span className="pitcher-link-cta" style={{ fontSize: '11px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '2px' }}>
              Pitcher card <Icon name="ChevronRight" size={12} />
            </span>
          </button>
        ) : (
          idBlock
        )}
      </div>
      <div className="stat-grid" style={{ marginBottom: '12px' }}>
        <Cell k="ERA" v={num(s.era, 2)} />
        <Cell k="HR/9" v={num(s.hrPer9, 2)} tone={s.hrPer9 >= 1.3 ? 'good' : s.hrPer9 <= 0.9 ? 'bad' : null} />
        <Cell k="K/9" v={num(s.kPer9, 1)} />
        <Cell k="Est K" v={estK ? `${Math.round(estK.k)}` : '—'} title={estK ? `Projected strikeouts this start: ${estK.lo}–${estK.hi} (≈${estK.expIP.toFixed(1)} IP vs a ${pct(estK.oppK, 0)}-K lineup).` : 'Need a season K sample.'} />
        <Cell k="WHIP" v={num(s.whip, 2)} />
        <Cell k="IP" v={num(s.ip, 1)} />
        <Cell
          k="GB/FB"
          v={battedBallLabel(s.goAo)}
          tone={ballTone(s.goAo)}
          title="League ~1.15."
        />
      </div>
      {b.flyBallMatchup && (
        <div className="note good" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.06)', padding: '6px 10px', borderRadius: '6px', marginBottom: '8px', border: '1px solid rgba(16,185,129,0.1)' }}>
          <Icon name="Wind" size={12} style={{ color: 'var(--strong)' }} /> <span>Fly-ball arm matchup (GB/FB {num(s.goAo, 2)})</span>
        </div>
      )}
      {b.hrPlatoonEdge && (
        <div className="note good" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(16,185,129,0.06)', padding: '6px 10px', borderRadius: '6px', marginBottom: '8px', border: '1px solid rgba(16,185,129,0.1)' }}>
          <Icon name="Target" size={12} style={{ color: 'var(--strong)' }} /> <span>Gives up more HRs vs {b.batSide === 'S' ? 'this side' : `${b.batSide}HB`}</span>
        </div>
      )}
      {split && (
        <div className="split-line" style={{ display: 'flex', gap: '10px', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', fontSize: '11px', marginBottom: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
          <span className="split-label" style={{ fontWeight: '700', color: 'var(--text-dim)' }}>vs {b.batSide}HB</span>
          <Mini k="HR/9" v={num(split.hrPer9, 2)} />
          <Mini k="AVG" v={rate(split.avg)} />
          {split.slg != null && split.slg > 0 && <Mini k="SLG" v={rate(split.slg)} />}
          {split.iso != null && <Mini k="ISO" v={rate(split.iso)} />}
          {split.kPct != null && <Mini k="K%" v={`${num(split.kPct, 0)}%`} />}
          <Mini k="IP" v={num(split.ip, 1)} />
        </div>
      )}
      {b.h2h && b.h2h.ab > 0 && (
        <div className="split-line h2h-line" style={{ display: 'flex', gap: '10px', padding: '8px 10px', background: 'rgba(99,102,241,0.04)', borderRadius: '6px', fontSize: '11px', marginBottom: '12px', border: '1px solid rgba(99,102,241,0.1)' }}>
          <span className="split-label" style={{ fontWeight: '700', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
            <Icon name="Crosshair" size={11} /> Career H2H
          </span>
          <Mini k="" v={`${b.h2h.h}-for-${b.h2h.ab}`} />
          <Mini k="HR" v={num(b.h2h.hr)} />
          <Mini k="AVG" v={rate(b.h2h.avg)} />
          <Mini k="OPS" v={rate(b.h2h.ops)} />
        </div>
      )}
      {rf?.recentStarts?.length ? (
        <div className="recent-starts" style={{ marginTop: '12px' }}>
          <div className="recent-starts-head" style={{ fontSize: '12px', fontWeight: '700', color: '#fff', display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>Recent Starts</span>
            <span className="recent-starts-sub" style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: '400' }}>
              {num(rf.hrPer9, 2)} HR/9 · {num(rf.era, 2)} ERA (L{rf.games})
            </span>
          </div>
          <div className="starts-table" style={{ display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', overflow: 'hidden' }}>
            <div className="starts-row starts-th" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', fontSize: '10px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
              <span>Date</span>
              <span>Opp</span>
              <span>IP</span>
              <span>H</span>
              <span>ER</span>
              <span>K</span>
              <span>HR</span>
            </div>
            {rf.recentStarts.slice(0, 5).map((st, i) => (
              <div className="starts-row" key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '11px', color: 'var(--text-dim)' }}>
                <span className="mono">{st.date?.slice(5)}</span>
                <span>
                  {st.isHome ? 'vs' : '@'} {st.opp}
                </span>
                <span className="mono">{num(st.ip, 1)}</span>
                <span className="mono">{st.h}</span>
                <span className="mono">{st.er}</span>
                <span className="mono">{st.k}</span>
                <span className={`mono ${st.hr > 0 ? 'pos' : ''}`} style={st.hr > 0 ? { color: 'var(--b-hot)', fontWeight: '700' } : {}}>{st.hr}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Section>
  )
}

function OddsSection({ b }) {
  const o = b.odds
  if (!o?.books?.length) return null
  return (
    <Section title="Market odds" icon="Percent">
      <div className="odds-table" style={{ display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', overflow: 'hidden', marginBottom: '8px' }}>
        <div className="odds-row odds-th" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 30px', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', fontSize: '10px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
          <span>Book</span>
          <span>Price</span>
          <span>Implied</span>
          <span>Edge</span>
          <span />
        </div>
        {o.books
          .slice()
          .sort((a, b2) => (b2.edge ?? -9) - (a.edge ?? -9))
          .map((row) => (
            <div className="odds-row" key={row.book} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 30px', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '12px', alignItems: 'center' }}>
              <span className="odds-book" style={{ color: '#fff', fontWeight: '600' }}>{bookLabel(row.book)}</span>
              <span className="mono">{american(row.american ?? decimalToAmerican(row.decimal))}</span>
              <span className="mono dim">{pct(row.implied, 1)}</span>
              <span className={`mono ${row.edge >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: '700' }}>{signedPct(row.edge, 1)}</span>
              <span style={{ display: 'grid', placeItems: 'center' }}>
                {row.link ? (
                  <a href={row.link} target="_blank" rel="noreferrer" className="odds-link" title="Open bet slip" style={{ color: 'var(--accent)' }}>
                    <Icon name="ExternalLink" size={12} />
                  </a>
                ) : null}
              </span>
            </div>
          ))}
      </div>
      <div className="odds-foot" style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
        Model {pct(b.hrProbability, 2)} vs market average {pct(o.marketImplied, 2)} · positive edge = value play
      </div>
    </Section>
  )
}

function LiveSection({ b }) {
  const lc = b.liveContext
  if (!lc) return null
  return (
    <Section title="Live Context" icon="CircleDot">
      <div className="stat-grid">
        <Cell k="AB so far" v={num(lc.abCount)} />
        <Cell k="Proj. ABs left" v={num(lc.expectedRemainingABs)} />
        <Cell k="Near-miss HR" v={num(lc.nearMissHR)} />
        <Cell k="HR already" v={lc.isHRThisGame ? 'Yes' : 'No'} />
        <Cell k="Inning" v={num(lc.currentInning)} />
        <Cell k="Run diff" v={lc.runDiff != null ? `${lc.runDiff > 0 ? '+' : ''}${lc.runDiff}` : '—'} />
        <Cell k="Pull risk" v={lc.pullRisk ? 'Yes' : 'No'} />
      </div>
    </Section>
  )
}

function TechReasons({ b }) {
  if (!b.reasons?.length) return null
  return (
    <Section title="Model details" icon="ListFilter" collapsible>
      <ul className="tech-reasons" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {b.reasons.map((r, i) => (
          <li key={i} style={{ display: 'flex', gap: '6px', fontSize: '11px', color: 'var(--text-dim)', lineHeight: '1.4' }}>
            <Icon name="ChevronRight" size={10} style={{ color: 'var(--accent)', marginTop: '2px', flexShrink: 0 }} />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function zoneHeat(t) {
  if (t == null || Number.isNaN(t)) return 'var(--card-2)'
  return `hsl(${220 - 180 * t} ${45 + 35 * t}% ${18 + 22 * t}%)`
}

// 13 Statcast zones → full 5×5 (row-major); center 3×3 = in-zone idx 0–8, outer
// ring = chase idx 9–12, edge-midpoints blend the two they sit between.
const ZMINI_MAP25 = [
  [9], [9], [9, 10], [10], [10],
  [9], [0], [1], [2], [10],
  [9, 11], [3], [4], [5], [10, 12],
  [11], [6], [7], [8], [12],
  [11], [11], [11, 12], [12], [12],
]
const avgN = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

function MiniGrid({ grid, metric, matched }) {
  const vals = grid.map((c) => c?.[metric]).filter((v) => Number.isFinite(v))
  const min = vals.length ? Math.min(...vals) : 0
  const max = vals.length ? Math.max(...vals) : 1
  const is13 = grid.length >= 13
  const cells = is13
    ? ZMINI_MAP25.map((src) => ({
        v: avgN(src.map((j) => grid[j]?.[metric]).filter((x) => Number.isFinite(x))),
        chase: src.every((j) => j >= 9),
        matched: src.some((j) => matched?.includes(j)),
      }))
    : grid.map((c, i) => ({ v: c?.[metric], chase: false, matched: matched?.includes(i) }))
  const cols = is13 ? 5 : Math.max(1, Math.ceil(Math.sqrt(grid.length)))
  return (
    <div className={`zmini-grid ${is13 ? 'zmini-grid-13' : ''}`} style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gridTemplateRows: `repeat(${cols}, 1fr)`,
      gap: '2px',
      width: '80px',
      height: '80px',
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
      padding: '2px',
      borderRadius: '6px'
    }}>
      {cells.map((c, i) => {
        const t = Number.isFinite(c.v) && max > min ? (c.v - min) / (max - min) : null
        return (
          <span
            key={i}
            className={`zmini-cell ${c.matched ? 'matched' : ''} ${c.chase ? 'chase' : ''}`}
            style={{
              background: zoneHeat(t),
              borderRadius: '2px',
              border: c.matched ? '1px solid var(--accent)' : 'none',
              opacity: c.chase ? 0.85 : 1
            }}
          />
        )
      })}
    </div>
  )
}

function ZoneTeaser({ b, onOpen }) {
  const z = b?.zoneMatchup
  if (!z || !z.batter?.grid || !z.pitcher?.grid) return null
  const matched = z.matchedZones?.length || 0
  return (
    <Section title="Zone matchup" icon="Crosshair" id="sec-zone">
      <button className="zone-teaser" onClick={() => onOpen?.(b)} aria-label="Open zone matchup" style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid rgba(255,255,255,0.05)',
        borderRadius: '12px',
        padding: '14px',
        width: '100%',
        textAlign: 'left',
        display: 'flex',
        gap: '16px',
        alignItems: 'center'
      }}>
        <div className="zteaser-grids" style={{ display: 'flex', gap: '10px' }}>
          <div className="zteaser-one" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <MiniGrid grid={z.batter.grid} metric="iso" matched={z.matchedZones} />
            <span className="zteaser-cap dim" style={{ fontSize: '9px', marginTop: '4px' }}>Hitter ISO</span>
          </div>
          <div className="zteaser-one" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <MiniGrid grid={z.pitcher.grid} metric="freq" matched={z.matchedZones} />
            <span className="zteaser-cap dim" style={{ fontSize: '9px', marginTop: '4px' }}>Pitcher Loc</span>
          </div>
        </div>
        <div className="zteaser-meta" style={{ flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div className="zteaser-rating" style={{ fontSize: '18px', fontWeight: '800', color: '#fff' }}>
            <span className="mono" style={{ color: 'var(--accent)' }}>{num(z.zoneRating, 1)}</span>
            <span className="dim" style={{ fontSize: '11px', fontWeight: '400', marginLeft: '6px' }}>zone rating</span>
          </div>
          <div className="zteaser-matched dim" style={{ fontSize: '11px' }}>
            {matched} zones matched
            {z.badge === 'ZONE_MASTER' && <span className="zone-master-tag" style={{ background: 'var(--accent)', color: '#fff', fontSize: '9px', padding: '1px 4px', borderRadius: '3px', marginLeft: '6px', fontWeight: '800' }}>ZONE MASTER</span>}
          </div>
          <span className="zteaser-cta" style={{ fontSize: '11px', fontWeight: '600', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '2px', marginTop: '6px' }}>
            Full matchup map <Icon name="ChevronRight" size={12} />
          </span>
        </div>
      </button>
    </Section>
  )
}

function HrSetupSection({ b }) {
  const { checks, n } = hrSetup(b)
  const heat = b.heatIndex != null ? b.heatIndex : heatBreakdown(b).total
  const tone = heat >= 70 ? 'good' : heat >= 50 ? 'warn' : 'bad'
  const tag = heat >= 70 ? 'On fire 🔥' : heat >= 58 ? 'Hot' : heat >= 45 ? 'Warm' : 'Cool'
  return (
    <Section title="Setup & form" icon="Flame">
      <div className={`hrsetup-score ${tone}`} style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '6px',
        marginBottom: '14px',
        paddingBottom: '12px',
        borderBottom: '1px solid rgba(255,255,255,0.03)'
      }}>
        <span className="hrs-n mono" style={{
          fontSize: '28px',
          fontWeight: '800',
          color: tone === 'good' ? 'var(--strong)' : tone === 'warn' ? 'var(--prime)' : 'var(--bad)',
          lineHeight: 1
        }}>{heat}</span>
        <span className="hrs-of dim" style={{ fontSize: '11px' }}>/ 100</span>
        <span className="hrs-tag" style={{
          fontSize: '11px',
          fontWeight: '700',
          color: tone === 'good' ? 'var(--strong)' : tone === 'warn' ? 'var(--prime)' : 'var(--bad)',
          background: tone === 'good' ? 'rgba(16,185,129,0.08)' : tone === 'warn' ? 'rgba(245,166,35,0.08)' : 'rgba(239,68,68,0.08)',
          padding: '2px 8px',
          borderRadius: '4px',
          marginLeft: '8px'
        }}>{tag}</span>
        <span className="hrs-setup dim" style={{ fontSize: '11px', marginLeft: 'auto' }}>setup {n}/6 matching</span>
      </div>
      <ul className="hrsetup-list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {checks.map((c) => (
          <li key={c.label} className={`hrs-row ${c.pass ? 'on' : 'off'}`} style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-start',
            fontSize: '12px',
            color: c.pass ? 'var(--text)' : 'var(--text-faint)'
          }}>
            <Icon name={c.pass ? 'Check' : 'X'} size={12} style={{ color: c.pass ? 'var(--strong)' : 'var(--text-faint)', marginTop: '2px' }} />
            <div className="hrs-txt">
              <span className="hrs-label" style={{ fontWeight: c.pass ? '600' : '400' }}>{c.label}</span>
              <span className="hrs-detail dim" style={{ fontSize: '10px', display: 'block', marginTop: '1px' }}>{c.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

const HRF_MAX = 0.08
function hrfTone(r) {
  if (r == null) return ''
  if (r >= 0.05) return 'good'
  if (r >= 0.03) return 'warn'
  return 'bad'
}
function HrFormSection({ b }) {
  const windows = [
    { k: 'L7', w: b.recent7 },
    { k: 'L30', w: b.recent },
    { k: 'Season', w: b.season },
  ].map(({ k, w }) => {
    const ab = w?.ab ?? 0
    const hr = w?.hr ?? 0
    return { k, hr, ab, rate: ab ? hr / ab : null }
  })
  if (!windows.some((x) => x.ab)) return null
  return (
    <Section title="Recent form" icon="Flame">
      <div className="hrform" style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
        {windows.map(({ k, hr, ab, rate }) => (
          <div className="hrf-row" key={k} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
            <span className="hrf-k" style={{ width: '50px', color: 'var(--text-dim)', fontWeight: '600' }}>{k}</span>
            <span className="hrf-bar" style={{ flex: '1', height: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '99px', overflow: 'hidden' }}>
              <span
                className={`hrf-fill ${hrfTone(rate)}`}
                style={{ 
                  display: 'block',
                  height: '100%',
                  borderRadius: '99px',
                  width: rate == null ? '0%' : `${Math.min(100, (rate / HRF_MAX) * 100)}%`,
                  background: hrfTone(rate) === 'good' ? 'var(--strong)' : hrfTone(rate) === 'warn' ? 'var(--prime)' : 'rgba(255,255,255,0.1)'
                }}
              />
            </span>
            <span className="hrf-val mono" style={{ width: '45px', textAlign: 'right', fontWeight: '700' }}>{rate == null ? '—' : pct(rate, 1)}</span>
            <span className="hrf-sub dim" style={{ width: '90px', textAli: 'right', fontSize: '10px' }}>{ab ? `${hr} HR · ${ab} AB` : 'no sample'}</span>
          </div>
        ))}
      </div>
      <SplitChips b={b} />
    </Section>
  )
}

function SplitRow({ label, left, right }) {
  const lv = left.iso
  const rv = right.iso
  const betterLeft = (lv ?? -1) >= (rv ?? -1)
  return (
    <div className="split-row" style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '12px' }}>
      <span className="split-label dim" style={{ flex: '1', color: 'var(--text-faint)' }}>{label}</span>
      <span className={`split-side ${betterLeft && lv != null ? 'better' : ''} ${left.tonight ? 'tonight' : ''}`} style={{
        width: '90px',
        textAlign: 'right',
        color: betterLeft && lv != null ? 'var(--strong)' : 'var(--text-dim)',
        fontWeight: betterLeft && lv != null ? '700' : '400',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '4px'
      }}>
        {left.name}
        {left.tonight && <span className="split-dot" style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent)' }} />}
        <b className="mono" style={{ marginLeft: '4px' }}>{lv != null ? rate(lv) : '—'}</b>
      </span>
      <span className={`split-side ${!betterLeft && rv != null ? 'better' : ''} ${right.tonight ? 'tonight' : ''}`} style={{
        width: '90px',
        textAlign: 'right',
        color: !betterLeft && rv != null ? 'var(--strong)' : 'var(--text-dim)',
        fontWeight: !betterLeft && rv != null ? '700' : '400',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: '4px'
      }}>
        {right.name}
        {right.tonight && <span className="split-dot" style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent)' }} />}
        <b className="mono" style={{ marginLeft: '4px' }}>{rv != null ? rate(rv) : '—'}</b>
      </span>
    </div>
  )
}

function SplitChips({ b }) {
  const ha = b.homeAwaySplits
  const dn = b.dayNightSplits
  if (!ha && !dn) return null
  return (
    <div className="split-chips" style={{ borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '10px', marginTop: '10px' }}>
      {ha && (ha.homeISO != null || ha.awayISO != null) && (
        <SplitRow
          label="ISO · home / away"
          left={{ name: 'Home', iso: ha.homeISO, tonight: b.isHome === true }}
          right={{ name: 'Away', iso: ha.awayISO, tonight: b.isHome === false }}
        />
      )}
      {dn && (dn.dayISO != null || dn.nightISO != null) && (
        <SplitRow label="ISO · day / night" left={{ name: 'Day', iso: dn.dayISO }} right={{ name: 'Night', iso: dn.nightISO }} />
      )}
    </div>
  )
}

function Section({ title, icon, children, id }) {
  return (
    <section className="drawer-section" id={id} style={{
      background: 'rgba(255, 255, 255, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.04)',
      borderRadius: '12px',
      padding: '16px',
      marginBottom: '16px'
    }}>
      <h3 className="section-title" style={{
        fontSize: '12px',
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: 'var(--text-dim)',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        marginBottom: '14px',
        borderBottom: '1px solid rgba(255,255,255,0.03)',
        paddingBottom: '8px'
      }}>
        <Icon name={icon} size={14} style={{ color: 'var(--accent)' }} /> {title}
      </h3>
      {children}
    </section>
  )
}

function Cell({ k, v, unit, tone, title }) {
  return (
    <div className="cell" title={title} style={{
      background: 'rgba(0,0,0,0.15)',
      border: '1px solid rgba(255,255,255,0.03)',
      borderRadius: '8px',
      padding: '8px 12px',
      textAlign: 'center'
    }}>
      <div className="cell-k" style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>{k}</div>
      <div className="cell-v mono" style={{
        fontSize: '14px',
        fontWeight: '700',
        color: tone ? toneColor(tone) : '#fff'
      }}>
        {v}
        {unit ? <span className="cell-unit" style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: '400' }}> {unit}</span> : null}
      </div>
    </div>
  )
}

function Mini({ k, v }) {
  return (
    <span className="mini" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: 'var(--text-dim)' }}>
      {k && <span className="mini-k" style={{ color: 'var(--text-faint)' }}>{k}:</span>}
      <span className="mini-v mono" style={{ fontWeight: '700' }}>{v}</span>
    </span>
  )
}
