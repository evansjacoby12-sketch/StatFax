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
import { useLiveMode } from '../lib/liveMode.js'

// Focus-trap + restore-focus for the slide-over (accessibility).
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

// Animate a number from 0 → target (eased). Respects reduced-motion.
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

export default function PlayerDrawer({ batter: b, onClose, watched, inSlip, onToggleWatch, onToggleSlip, onOpenZone, onOpenPitcher }) {
  const trapRef = useFocusTrap()
  const liveMode = useLiveMode()
  // Lock the background page while the sheet is open. Without this the main
  // window scroller still moves behind the sheet, scrolling the board into view
  // beneath it. iOS-safe approach: pin <body> in place (position:fixed at the
  // current offset) and restore the scroll position on close.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const body = document.body
    const scrollY = window.scrollY
    const prev = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'
    body.style.overflow = 'hidden'
    return () => {
      Object.assign(body.style, prev)
      window.scrollTo(0, scrollY)
    }
  }, [])
  if (!b) return null
  const g = b.grade?.label || 'SKIP'
  const color = gradeColor(g)

  // Portal to <body>: rendered inside .app the fixed sheet was being resolved
  // against an ancestor containing block on iOS (it floated up, leaving the
  // board visible beneath it, and top/bottom anchors were ignored). At body
  // level — no transformed/filtered ancestor — position:fixed is finally
  // relative to the viewport.
  const content = (
    <>
      <div className="drawer-scrim drawer-scrim-top" onClick={onClose} />
      <aside
        className="drawer"
        style={{ '--accent': color }}
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
        <div className="drawer-body">
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
          <PitcherSection b={b} onOpenPitcher={onOpenPitcher} />
          {liveMode && b.game?.isLive && <LiveSection b={b} />}
          <TechReasons b={b} />
        </div>
      </aside>
    </>
  )
  // Guard for the Node smoke renderer (no DOM) — portal only in the browser.
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

function DrawerHeader({ b, color, onClose, watched, inSlip, onToggleWatch, onToggleSlip }) {
  const liveMode = useLiveMode()
  return (
    <div className="drawer-head" style={{ background: `linear-gradient(180deg, ${hexA(color, 0.16)}, transparent)` }}>
      <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close">
        <Icon name="X" size={18} />
      </button>
      <div className="drawer-head-main">
        <img
          className="drawer-avatar"
          src={playerHeadshot(b.playerId, 160)}
          alt={b.name}
          style={{ borderColor: hexA(color, 0.5) }}
        />
        <div className="drawer-title">
        <div className="drawer-name-row">
          <h2 className={liveMode && b.liveContext?.isHRThisGame ? 'hr-glow' : ''}>{b.name}</h2>
          <span className="bathand-lg">{b.batSide}HB</span>
          <GradeChip grade={b.grade} size="lg" />
        </div>
        <div className="drawer-sub">
          <span className="team-tag">{b.team}</span> vs{' '}
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
        <div className="drawer-badges">
          <BadgeRow batter={b} />
        </div>
        <div className="drawer-actions">
          <button className={`d-act ${inSlip ? 'on' : ''}`} onClick={() => onToggleSlip(b)}>
            <Icon name={inSlip ? 'Check' : 'Plus'} size={15} />
            {inSlip ? 'In parlay' : 'Add to parlay'}
          </button>
          <button className={`d-act ghost ${watched ? 'on' : ''}`} onClick={() => onToggleWatch(b)}>
            <Icon name="Star" size={15} />
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
    <div className="hero-grid">
      <div className="hero-main" style={{ borderColor: hexA(color, 0.35), background: hexA(color, 0.07) }}>
        <div className="hero-main-info">
          <div className="hero-main-label">HR Probability</div>
          <div className="hero-main-val mono" style={{ color }}>
            {pct(shownProb, 2)}
          </div>
          <div className="hero-main-sub">raw score {num(b.rawScore)}</div>
        </div>
        <ScoreRing score={b.score} color={color} size={66} />
      </div>
      <div className="hero-side">
        <KV k="Expected HRs" v={num(b.expectedHRs, 3)} />
        <KV k="Expected PAs" v={num(b.expectedPAs, 1)} />
        <KV k="Sim HR%" v={pct(b.simHRProb, 2)} />
        <KV k="Ensemble" v={num(b.ensembleScore)} />
        {vegas != null && <KV k="Market implied" v={pct(vegas, 1)} />}
        {diff != null && (
          <KV k="Model − Market" v={signedPct(diff, 1)} accent={diff >= 0 ? 'var(--good)' : 'var(--bad)'} />
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

// Plate Matchup HR Signal — the headline "who's favored" verdict. The model's
// matchupScore IS the batter-vs-pitcher favorability (50 = neutral), so the lean
// is just (matchupScore − 50). The pillar bars below it are the real sub-scores
// that drive the composite, and the detail chips are the live contact-quality
// numbers (blast / barrel / opposing HR-9) behind the call — no invented stats.
const LG_BLAST = 15 // league-average blast per squared-up contact (%)
const LG_BARREL = 8 // league-average barrel rate per BBE (%)
const LG_HR9 = 1.25 // league-average HR allowed per 9
function plateMatchup(b) {
  const ms = b.matchupScore
  if (!Number.isFinite(ms)) return null
  const lean = Math.round((ms - 50) * 10) / 10
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
    <div className="pm-pillar" title={hint}>
      <div className="pm-pillar-top">
        <span className="pm-pillar-label">{label}</span>
        <span className="pm-pillar-val mono">{v == null ? '—' : Math.round(v)}</span>
      </div>
      <span className="pm-pillar-track">
        <span className={`pm-pillar-fill ${tone}`} style={{ width: `${v ?? 0}%` }} />
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
  // Quick-jump actions to the sections that already exist in the drawer.
  const jump = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const acts = [
    { label: 'Zone', icon: 'Crosshair', go: () => (b?.zoneMatchup ? onOpenZone?.(b) : jump('sec-zone')()) },
    { label: 'Pitcher', icon: 'Shield', go: jump('sec-pitcher') },
    { label: 'Statcast', icon: 'Gauge', go: jump('sec-statcast') },
    { label: 'Air', icon: 'Wind', go: jump('sec-env') },
  ]
  return (
    <section className="drawer-section pm-card">
      <div className="pm-head">
        <span className="pm-title"><Icon name="Target" size={14} /> Plate Matchup</span>
        <span className={`pm-hr-pill ${pm.tone}`}><Icon name="Zap" size={11} /> HR Signal</span>
      </div>
      <div className={`pm-verdict tone-${pm.tone}`}>
        <div className="pm-verdict-txt">
          <span className="pm-verdict-label">{pm.verdict}</span>
          <span className="pm-verdict-sub dim">batter vs {b.pitcher?.name || 'TBD'}</span>
        </div>
        <span className="pm-verdict-num mono">{pm.lean > 0 ? '+' : ''}{pm.lean.toFixed(1)}</span>
      </div>
      <div className="pm-pillars">
        <PillarBar label="Bat threat" value={b.batterScore} hint="The hitter's own HR threat — power, contact quality, recent form." />
        <PillarBar label="Matchup" value={b.matchupScore} hint="This batter vs this starter — handedness, HR-9, zone fit." />
        <PillarBar label="Park / Air" value={b.envScore} hint="Venue HR factor + weather pushing the ball out (or holding it in)." />
      </div>
      <div className="pm-chips">
        {Number.isFinite(blast) && (
          <span className={`pm-chip ${blast >= LG_BLAST ? 'good' : ''}`} title={`League avg ${LG_BLAST}% per squared-up contact`}>
            <Icon name="Zap" size={10} /> Blast {num(blast, 0)}%
            {Number.isFinite(vsHandBlast) && <span className="pm-chip-sub"> · vs {b.batTracking?.vsHand}HP {num(vsHandBlast, 0)}%</span>}
          </span>
        )}
        {Number.isFinite(barrel) && (
          <span className={`pm-chip ${barrel >= LG_BARREL ? 'good' : ''}`} title={`League avg ${LG_BARREL}% of batted balls`}>
            <Icon name="Crosshair" size={10} /> Barrel {num(barrel, 0)}%
          </span>
        )}
        {Number.isFinite(hr9) && (
          <span className={`pm-chip ${hr9 >= 1.3 ? 'good' : hr9 < LG_HR9 ? 'bad' : ''}`} title={`Opposing starter's HR allowed per 9 (league avg ${LG_HR9})`}>
            <Icon name="Flame" size={10} /> Arm {num(hr9, 2)} HR/9
          </span>
        )}
      </div>
      <div className="pm-foot">
        <span className="pm-lineup">
          <Icon name="List" size={11} />
          {slot ? <> Batting <b>{ordinal(slot)}</b></> : <> Lineup <b>{b.lineupConfirmed ? 'set' : 'projected'}</b></>}
          {Number.isFinite(pas) && <span className="dim"> · ~{num(pas, 1)} PA{slot && slot <= 5 ? ' (premium slot)' : ''}</span>}
        </span>
        <div className="pm-acts">
          {acts.map((a) => (
            <button key={a.label} className="pm-act" onClick={a.go}>
              <Icon name={a.icon} size={13} /> {a.label}
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
      <div className="scout-verdict">{scoutVerdict(b)}</div>
      <div className="scout-grades">
        {SCOUT_TOOLS.map((t) => {
          const g = grades[t.key]
          return (
            <div key={t.key} className="scout-tool" title={`${t.label} grade ${g}/80`}>
              <div className="scout-tool-head">
                <span className="scout-tool-label">{t.label}</span>
                <span className="scout-tool-grade mono" style={{ color: t.color }}>
                  {g}
                  <span className="scout-tool-desc"> · {gradeLabel(g)}</span>
                </span>
              </div>
              <div className="scout-tool-track">
                <div className="scout-tool-fill" style={{ width: `${((g - 20) / 60) * 100}%`, background: t.color }} />
              </div>
            </div>
          )
        })}
      </div>
      {b.zoneBonus != null && b.zoneBonus !== 0 && (
        <div className="zone-bonus">
          Zone matchup{' '}
          <span className={`mono ${b.zoneBonus >= 0 ? 'pos' : 'neg'}`}>
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
      <div className="pa-curve">
        {pa.map((x, i) => (
          <div
            className="pa-bar-wrap"
            key={i}
            title={`PA ${x.pa}: ${pct(x.p, 1)} HR chance${x.partial ? ` · ${pct(x.partial, 0)} likely to occur` : ''}`}
          >
            <div className="pa-bar-track">
              <div
                className="pa-bar"
                style={{ height: `${Math.max(4, (x.p / max) * 100)}%`, background: color, opacity: x.partial ? 0.5 : 1 }}
              />
            </div>
            <span className="pa-bar-lbl mono">{x.pa}</span>
          </div>
        ))}
      </div>
      <div className="pa-curve-cap dim">
        HR chance per plate appearance — later PAs may face the bullpen. Sum = <b className="mono">{num(b.expectedHRs, 3)}</b> xHR over{' '}
        {num(b.expectedPAs, 1)} PA.
      </div>
    </Section>
  )
}

function Why({ b }) {
  const items = b.eli5Reasons || []
  if (!items.length) return null
  return (
    <Section title="Why" icon="Info">
      <ul className="eli5">
        {items.map((r, i) => (
          <li key={i} className={`eli5-item tone-${r.tone}`}>
            <span className="eli5-icon" style={{ color: toneColor(r.tone) }}>
              <Icon name={eli5IconName(r.icon)} size={15} />
            </span>
            <span className="eli5-text">{r.text}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function StatLine({ label, s }) {
  if (!s) return null
  return (
    <div className="statline">
      <span className="statline-label">{label}</span>
      <div className="statline-vals">
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
      <StatLine label="Season" s={b.season} />
      <StatLine label="Last 30" s={b.recent} />
      {b.hrStreak ? (
        <div className="note">
          <Icon name="Flame" size={13} /> HR streak signal active
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
        <Cell k="Launch∠" v={b.launchAngle != null ? `${num(b.launchAngle, 1)}°` : '—'} />
        <Cell k="xBA" v={rate(x.xBA)} />
        <Cell k="xSLG" v={rate(x.xSLG)} />
        <Cell k="xISO" v={rate(x.xISO)} />
        <Cell k="xwOBA" v={rate(x.xwOBA)} />
      </div>
      {b.primaryPitchEdge?.passes && (
        <div className="note good">
          <Icon name="Target" size={13} /> Crushes the {b.primaryPitchEdge.pitchName} (
          {rate(b.primaryPitchEdge.batterSlg)} SLG) — pitcher throws it{' '}
          {pct(b.primaryPitchEdge.pitcherFreq, 0)} of the time
        </div>
      )}
    </Section>
  )
}

// Savant-style percentile bars vs TODAY'S SLATE (see attachSlatePercentiles).
// Blue = bottom of the slate, red = top, chip rides the end of the fill.
const PCTILE_ROWS = [
  { k: 'hrRate', label: 'HR/AB', v: (b) => (b.season?.ab >= 30 ? pct(b.season.hr / b.season.ab, 1) : null) },
  { k: 'iso', label: 'ISO', v: (b) => rate(b.season?.iso ?? (b.season?.slg != null && b.season?.avg != null ? b.season.slg - b.season.avg : null)) },
  { k: 'xiso', label: 'xISO', v: (b) => rate(b.xStats?.xISO) },
  { k: 'barrel', label: 'Barrel%', v: (b) => (b.barrelPctBBE ?? b.barrelPct) != null ? `${num(b.barrelPctBBE ?? b.barrelPct, 1)}%` : null },
  { k: 'ev', label: 'Exit velo', v: (b) => (b.exitVelo != null ? `${num(b.exitVelo, 1)} mph` : null) },
  { k: 'hardHit', label: 'Hard-hit%', v: (b) => (b.hardHitPct != null ? `${num(b.hardHitPct, 0)}%` : null) },
]
const pctileColor = (p) => `hsl(${215 - 200 * (p / 100)} 72% 50%)`

function PercentileSection({ b }) {
  const rows = PCTILE_ROWS.map((r) => ({ ...r, p: b.pctile?.[r.k], val: r.v(b) })).filter((r) => r.p != null)
  if (!rows.length) return null
  return (
    <Section title="Percentiles" icon="BarChart3">
      <div className="pctile-cap dim">Power profile ranked against every batter on today&apos;s slate.</div>
      <div className="pctile-list">
        {rows.map((r) => (
          <div className="pctile-row" key={r.k} title={`${r.label}: better than ${r.p}% of today's slate`}>
            <span className="pctile-label">{r.label}</span>
            <span className="pctile-bar">
              <span className="pctile-fill" style={{ width: `${r.p}%`, background: pctileColor(r.p) }} />
              <span
                className="pctile-chip mono"
                style={{ left: `clamp(0px, calc(${r.p}% - 11px), calc(100% - 22px))`, background: pctileColor(r.p) }}
              >
                {r.p}
              </span>
            </span>
            <span className="pctile-val mono">{r.val ?? '—'}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

function WindDial({ deg, speed }) {
  // Arrow points the way the wind blows TO (deg is the direction it comes FROM).
  const rot = (deg ?? 0) + 180
  return (
    <div className="wind-dial" title={`Wind from ${compass(deg) || '—'} (${deg ?? '—'}°)`}>
      <svg viewBox="0 0 64 64" width="58" height="58">
        <circle cx="32" cy="32" r="29" className="wd-ring" />
        <text x="32" y="11" className="wd-n" textAnchor="middle">
          N
        </text>
        {deg != null && (
          <g transform={`rotate(${rot} 32 32)`}>
            <path d="M32 14 L38 34 L32 29 L26 34 Z" className="wd-arrow" />
          </g>
        )}
        <text x="32" y="36" className="wd-spd" textAnchor="middle">
          {speed != null ? Math.round(speed) : '—'}
        </text>
        <text x="32" y="46" className="wd-unit" textAnchor="middle">
          mph
        </text>
      </svg>
    </div>
  )
}

function Wx({ icon, k, v, sub }) {
  return (
    <div className="wx">
      <Icon name={icon} size={14} className="wx-icon" />
      <div className="wx-body">
        <div className="wx-k">{k}</div>
        <div className="wx-v mono">
          {v}
          {sub ? <span className="wx-sub"> · {sub}</span> : null}
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
        <div className="wind-verdict-line" style={{ color: wind.tint }}>
          <Icon name="Wind" size={13} />
          <b>{wind.verdict}</b>
          <span>{wind.caption}</span>
        </div>
      )}
      {w && (
        <div className="weather">
          <WindDial deg={w.windDirDeg} speed={w.windSpeedMph} />
          <div className="weather-grid">
            <Wx icon="Thermometer" k="Temp" v={w.tempF != null ? `${Math.round(w.tempF)}°F` : '—'} />
            <Wx
              icon="Wind"
              k="Wind"
              v={w.windSpeedMph != null ? `${Math.round(w.windSpeedMph)} ${compass(w.windDirDeg) || ''}` : '—'}
              sub={w.windGustMph ? `G${Math.round(w.windGustMph)}` : null}
            />
            <Wx icon="Droplet" k="Humidity" v={w.humidity != null ? `${w.humidity}%` : '—'} />
            <Wx icon="Cloud" k="Precip" v={w.precipProbPct != null ? `${w.precipProbPct}%` : '—'} />
          </div>
        </div>
      )}
      {sky && (
        <div className={`note ${w.roofClosed ? '' : ''}`}>
          <Icon name={w.roofClosed ? 'House' : 'Cloud'} size={13} /> {sky}
          {w.source ? ` · ${w.source.toUpperCase()}` : ''}
        </div>
      )}
      {hasFactors && (
        <div className="stat-grid" style={{ marginTop: w ? 12 : 0 }}>
          <Cell
            k="Park HR factor"
            v={b.gameParkHRFactor != null ? `${num(b.gameParkHRFactor, 3)}×` : '—'}
            title="Park-only HR multiplier for tonight's venue (1.00 = league-average park)"
          />
          <Cell
            k="Air factor"
            v={b.parkWeatherHandFactor != null ? `${num(b.parkWeatherHandFactor, 3)}×` : '—'}
            title="Combined park × weather × batter-handedness HR multiplier (1.00 = neutral conditions)"
          />
          {b.parkWeatherHandFactor != null && (
            <Cell
              k="Air vs neutral"
              v={signedPct(b.parkWeatherHandFactor - 1, 1)}
              title="How much the air helps or hurts HRs vs neutral — Air factor minus 1"
            />
          )}
        </div>
      )}
    </Section>
  )
}

// GO/AO ratio → fly-ball/ground-ball descriptor. League average ≈ 1.15.
function battedBallLabel(goAo) {
  if (!Number.isFinite(goAo) || goAo <= 0) return '—'
  const tag = goAo <= 0.92 ? 'FB' : goAo >= 1.45 ? 'GB' : 'neu'
  return `${goAo.toFixed(2)} · ${tag}`
}
function ballTone(goAo) {
  if (!Number.isFinite(goAo) || goAo <= 0) return null
  if (goAo <= 0.92) return 'good' // fly-ball arm = HR-friendly for the hitter
  if (goAo >= 1.45) return 'bad'  // ground-ball arm = HR-suppressing
  return null
}

function PitcherSection({ b, onOpenPitcher }) {
  const p = b.pitcher
  if (!p) return null
  const s = p.season || {}
  const split = b.batSide === 'L' ? p.splits?.vl : p.splits?.vr
  const rf = p.recentForm
  const canOpen = !!onOpenPitcher && p.id != null
  const idBlock = (
    <div>
      <div className="pitcher-name">{p.name}</div>
      <div className="pitcher-meta">
        {p.hand}HP{split ? ` · vs ${b.batSide}HB` : ''}
      </div>
    </div>
  )
  return (
    <Section title="Opposing pitcher" icon="Shield" id="sec-pitcher">
      <div className="pitcher-head">
        {canOpen ? (
          <button className="pitcher-link" onClick={() => onOpenPitcher(p.id, b.gamePk)} title={`Open ${p.name}'s pitcher card`}>
            {idBlock}
            <span className="pitcher-link-cta">
              Pitcher card <Icon name="ChevronRight" size={14} />
            </span>
          </button>
        ) : (
          idBlock
        )}
      </div>
      <div className="stat-grid">
        <Cell k="ERA" v={num(s.era, 2)} />
        <Cell k="HR/9" v={num(s.hrPer9, 2)} tone={s.hrPer9 >= 1.3 ? 'good' : s.hrPer9 <= 0.9 ? 'bad' : null} />
        <Cell k="K/9" v={num(s.kPer9, 1)} />
        <Cell k="WHIP" v={num(s.whip, 2)} />
        <Cell k="IP" v={num(s.ip, 1)} />
        <Cell
          k="GB/FB"
          v={battedBallLabel(s.goAo)}
          tone={ballTone(s.goAo)}
          title="Ground-out : air-out ratio — fly-ball arms (low) allow more HR, ground-ball arms (high) fewer. League ~1.15."
        />
      </div>
      {b.flyBallMatchup && (
        <div className="note good">
          <Icon name="Wind" size={13} /> Fly-ball-prone arm (GB/FB {num(s.goAo, 2)}) — more balls in the air, HR-friendly matchup
        </div>
      )}
      {b.hrPlatoonEdge && (
        <div className="note good">
          <Icon name="Target" size={13} /> Gives up more HR to {b.batSide === 'S' ? 'this batter’s side' : `${b.batSide}HB`} — platoon HR split
        </div>
      )}
      {split && (
        <div className="split-line">
          <span className="split-label">vs {b.batSide}HB</span>
          <Mini k="HR/9" v={num(split.hrPer9, 2)} />
          <Mini k="AVG" v={rate(split.avg)} />
          <Mini k="IP" v={num(split.ip, 1)} />
        </div>
      )}
      {b.h2h && b.h2h.ab > 0 && (
        <div className="split-line h2h-line">
          <span className="split-label">
            <Icon name="Crosshair" size={12} /> Career H2H
          </span>
          <Mini k="" v={`${b.h2h.h}-for-${b.h2h.ab}`} />
          <Mini k="HR" v={num(b.h2h.hr)} />
          <Mini k="AVG" v={rate(b.h2h.avg)} />
          <Mini k="OPS" v={rate(b.h2h.ops)} />
        </div>
      )}
      {rf?.recentStarts?.length ? (
        <div className="recent-starts">
          <div className="recent-starts-head">
            Recent starts
            <span className="recent-starts-sub">
              {num(rf.hrPer9, 2)} HR/9 · {num(rf.era, 2)} ERA (L{rf.games})
            </span>
          </div>
          <div className="starts-table">
            <div className="starts-row starts-th">
              <span>Date</span>
              <span>Opp</span>
              <span>IP</span>
              <span>H</span>
              <span>ER</span>
              <span>K</span>
              <span>HR</span>
            </div>
            {rf.recentStarts.slice(0, 5).map((st, i) => (
              <div className="starts-row" key={i}>
                <span className="mono">{st.date?.slice(5)}</span>
                <span>
                  {st.isHome ? 'vs' : '@'} {st.opp}
                </span>
                <span className="mono">{num(st.ip, 1)}</span>
                <span className="mono">{st.h}</span>
                <span className="mono">{st.er}</span>
                <span className="mono">{st.k}</span>
                <span className={`mono ${st.hr > 0 ? 'pos' : ''}`}>{st.hr}</span>
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
    <Section title="Market" icon="Percent">
      <div className="odds-table">
        <div className="odds-row odds-th">
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
            <div className="odds-row" key={row.book}>
              <span className="odds-book">{bookLabel(row.book)}</span>
              <span className="mono">{american(row.american ?? decimalToAmerican(row.decimal))}</span>
              <span className="mono dim">{pct(row.implied, 1)}</span>
              <span className={`mono ${row.edge >= 0 ? 'pos' : 'neg'}`}>{signedPct(row.edge, 1)}</span>
              <span>
                {row.link ? (
                  <a href={row.link} target="_blank" rel="noreferrer" className="odds-link" title="Open bet slip">
                    <Icon name="ExternalLink" size={13} />
                  </a>
                ) : null}
              </span>
            </div>
          ))}
      </div>
      <div className="odds-foot">
        Model {pct(b.hrProbability, 2)} vs market {pct(o.marketImplied, 2)} · positive edge = model sees value
      </div>
    </Section>
  )
}

function LiveSection({ b }) {
  const lc = b.liveContext
  if (!lc) return null
  return (
    <Section title="Live context" icon="CircleDot">
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
    <Section title="Model reasons (detail)" icon="ListFilter" collapsible>
      <ul className="tech-reasons">
        {b.reasons.map((r, i) => (
          <li key={i}>
            <Icon name="ChevronRight" size={12} />
            {r}
          </li>
        ))}
      </ul>
    </Section>
  )
}

// Compact zone-matchup preview — two mini heatmaps (batter ISO + pitcher
// location) with matched zones ringed. Clicking opens the full Zone page.
function zoneHeat(t) {
  if (t == null || Number.isNaN(t)) return 'var(--card-2)'
  return `hsl(${220 - 200 * t} ${45 + 35 * t}% ${18 + 22 * t}%)`
}
// 5×5 placement for the 13-zone mini-grid (matches ZoneView): 0-8 = strike
// zone (center 3×3), 9-12 = the four chase corners.
const ZMINI_POS = [
  [2, 2], [2, 3], [2, 4],
  [3, 2], [3, 3], [3, 4],
  [4, 2], [4, 3], [4, 4],
  [1, 1], [1, 5], [5, 1], [5, 5],
]
function MiniGrid({ grid, metric, matched }) {
  const vals = grid.map((c) => c?.[metric]).filter((v) => Number.isFinite(v))
  const min = vals.length ? Math.min(...vals) : 0
  const max = vals.length ? Math.max(...vals) : 1
  const is13 = grid.length >= 13
  return (
    <div className={`zmini-grid ${is13 ? 'zmini-grid-13' : ''}`}>
      {grid.map((c, i) => {
        const v = c?.[metric]
        const t = Number.isFinite(v) && max > min ? (v - min) / (max - min) : null
        const style = { background: zoneHeat(t) }
        if (is13) {
          const [r, col] = ZMINI_POS[i] || [0, 0]
          style.gridRow = r
          style.gridColumn = col
        }
        return (
          <span
            key={i}
            className={`zmini-cell ${matched?.includes(i) ? 'matched' : ''} ${is13 && i >= 9 ? 'chase' : ''}`}
            style={style}
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
      <button className="zone-teaser" onClick={() => onOpen?.(b)} aria-label="Open full zone matchup">
        <div className="zteaser-grids">
          <div className="zteaser-one">
            <MiniGrid grid={z.batter.grid} metric="iso" matched={z.matchedZones} />
            <span className="zteaser-cap dim">Batter ISO</span>
          </div>
          <div className="zteaser-one">
            <MiniGrid grid={z.pitcher.grid} metric="freq" matched={z.matchedZones} />
            <span className="zteaser-cap dim">Pitcher loc</span>
          </div>
        </div>
        <div className="zteaser-meta">
          <div className="zteaser-rating">
            <span className="mono">{num(z.zoneRating, 1)}</span>
            <span className="dim">zone rating</span>
          </div>
          <div className="zteaser-matched dim">
            {matched} matched zone{matched === 1 ? '' : 's'}
            {z.badge === 'ZONE_MASTER' && <span className="zone-master-tag"> · ZONE MASTER</span>}
          </div>
          <span className="zteaser-cta">
            Full matchup <Icon name="ChevronRight" size={14} />
          </span>
        </div>
      </button>
    </Section>
  )
}

// HR Setup — a 6-box "why this is a play" checklist (RudeBets-style), but every
// box is a signal that actually predicts HRs. Deliberately NO "due/drought" box:
// that's the gambler's fallacy we falsified + removed from the model. Hot takes
// its slot (the strongest positive signal in the audit).
function HrSetupSection({ b }) {
  const { checks, n } = hrSetup(b)
  // Heat index (0–100, recent-form) headlines the section; the 6-box setup
  // checklist (form + matchup + park) is the "why". One combined block.
  const heat = b.heatIndex != null ? b.heatIndex : heatBreakdown(b).total
  const tone = heat >= 70 ? 'good' : heat >= 50 ? 'warn' : 'bad'
  const tag = heat >= 70 ? 'On fire 🔥' : heat >= 58 ? 'Hot' : heat >= 45 ? 'Warm' : 'Cool'
  return (
    <Section title="Heat index" icon="Flame">
      <div className={`hrsetup-score ${tone}`}>
        <span className="hrs-n mono">{heat}</span>
        <span className="hrs-of dim">/ 100</span>
        <span className="hrs-tag">{tag}</span>
        <span className="hrs-setup dim">setup {n}/6</span>
      </div>
      <ul className="hrsetup-list">
        {checks.map((c) => (
          <li key={c.label} className={`hrs-row ${c.pass ? 'on' : 'off'}`}>
            <Icon name={c.pass ? 'Check' : 'X'} size={14} />
            <div className="hrs-txt">
              <span className="hrs-label">{c.label}</span>
              <span className="hrs-detail dim">{c.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// Recent HR-rate over windows (LineTerminal-style sample-aware bars) + the two
// situational splits we carry. Honest framing: it's HR-per-AB, not a per-game
// "hit rate" (we don't log game-by-game), with the sample shown beside each bar.
const HRF_MAX = 0.08 // ~8% HR/AB fills the bar (elite territory)
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
    <Section title="HR form" icon="Flame">
      <div className="hrform">
        {windows.map(({ k, hr, ab, rate }) => (
          <div className="hrf-row" key={k}>
            <span className="hrf-k">{k}</span>
            <span className="hrf-bar">
              <span
                className={`hrf-fill ${hrfTone(rate)}`}
                style={{ width: rate == null ? '0%' : `${Math.min(100, (rate / HRF_MAX) * 100)}%` }}
              />
            </span>
            <span className="hrf-val mono">{rate == null ? '—' : pct(rate, 1)}</span>
            <span className="hrf-sub dim">{ab ? `${hr} HR · ${ab} AB` : 'no sample'}</span>
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
    <div className="split-row">
      <span className="split-label dim">{label}</span>
      <span className={`split-side ${betterLeft && lv != null ? 'better' : ''} ${left.tonight ? 'tonight' : ''}`}>
        {left.name}
        {left.tonight && <span className="split-dot" title="Tonight" />}
        <b className="mono">{lv != null ? rate(lv) : '—'}</b>
      </span>
      <span className={`split-side ${!betterLeft && rv != null ? 'better' : ''} ${right.tonight ? 'tonight' : ''}`}>
        {right.name}
        {right.tonight && <span className="split-dot" title="Tonight" />}
        <b className="mono">{rv != null ? rate(rv) : '—'}</b>
      </span>
    </div>
  )
}

function SplitChips({ b }) {
  const ha = b.homeAwaySplits
  const dn = b.dayNightSplits
  if (!ha && !dn) return null
  return (
    <div className="split-chips">
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

/* ---- small shared bits ---- */
function Section({ title, icon, children, id }) {
  return (
    <section className="drawer-section" id={id}>
      <h3 className="section-title">
        <Icon name={icon} size={14} /> {title}
      </h3>
      {children}
    </section>
  )
}

function Cell({ k, v, unit, tone, title }) {
  return (
    <div className="cell" title={title}>
      <div className="cell-k">{k}</div>
      <div className="cell-v mono" style={tone ? { color: toneColor(tone) } : undefined}>
        {v}
        {unit ? <span className="cell-unit"> {unit}</span> : null}
      </div>
    </div>
  )
}

function Mini({ k, v }) {
  return (
    <span className="mini">
      <span className="mini-k">{k}</span>
      <span className="mini-v mono">{v}</span>
    </span>
  )
}
