import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip, BadgeRow, KV, hexA, ScoreRing } from './atoms.jsx'
import { eli5IconName, toneColor, gradeColor } from '../lib/badges.js'
import { pct, rate, num, signedPct, american, decimalToAmerican, ordinal } from '../lib/format.js'
import { bookLabel } from '../lib/data.js'
import { compass, skyLabel } from '../lib/weather.js'
import { interpretWind } from '../lib/wind.js'
import { playerHeadshot, teamColor } from '../lib/teams.js'
import { toolGrades, heatBreakdown, scoutVerdict, gradeLabel } from '../lib/scout.js'
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

export default function PlayerDrawer({ batter: b, onClose, watched, inSlip, onToggleWatch, onToggleSlip }) {
  const trapRef = useFocusTrap()
  const liveMode = useLiveMode()
  if (!b) return null
  const g = b.grade?.label || 'SKIP'
  const color = b.grade?.color || gradeColor(g)

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
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
          <ScoutReport b={b} />
          <PaCurve b={b} color={color} />
          <Why b={b} />
          <StatsSection b={b} />
          <StatcastSection b={b} />
          <EnvSection b={b} />
          <PitcherSection b={b} />
          <OddsSection b={b} />
          {liveMode && b.game?.isLive && <LiveSection b={b} />}
          <TechReasons b={b} />
        </div>
      </aside>
    </>
  )
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
            {pct(shownProb, 1)}
          </div>
          <div className="hero-main-sub">raw score {num(b.rawScore)}</div>
        </div>
        <ScoreRing score={b.score} color={color} size={66} />
      </div>
      <div className="hero-side">
        <KV k="Expected HRs" v={num(b.expectedHRs, 3)} />
        <KV k="Expected PAs" v={num(b.expectedPAs, 1)} />
        <KV k="Sim HR%" v={pct(b.simHRProb, 1)} />
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
  { key: 'heat', label: 'Heat', color: 'var(--b-hot)' },
  { key: 'matchup', label: 'Matchup', color: 'var(--strong)' },
  { key: 'environment', label: 'Park / Air', color: 'var(--accent)' },
]

function ScoutReport({ b }) {
  const [heatOpen, setHeatOpen] = useState(false)
  if (b.batterScore == null && b.matchupScore == null) return null
  const grades = toolGrades(b)
  const hb = heatBreakdown(b)
  return (
    <Section title="Scout report" icon="Crosshair">
      <div className="scout-verdict">{scoutVerdict(b)}</div>
      <div className="scout-grades">
        {SCOUT_TOOLS.map((t) => {
          const g = grades[t.key]
          const isHeat = t.key === 'heat'
          const Tag = isHeat ? 'button' : 'div'
          return (
            <Tag
              key={t.key}
              className={`scout-tool ${isHeat ? 'scout-tool-btn' : ''} ${isHeat && heatOpen ? 'open' : ''}`}
              onClick={isHeat ? () => setHeatOpen((o) => !o) : undefined}
              aria-expanded={isHeat ? heatOpen : undefined}
              title={isHeat ? `Heat index ${hb.total}/100 — tap for why` : `${t.label} grade ${g}/80`}
            >
              <div className="scout-tool-head">
                <span className="scout-tool-label">
                  {t.label}
                  {isHeat && <Icon name={heatOpen ? 'ChevronUp' : 'ChevronDown'} size={11} className="scout-tool-chev" />}
                </span>
                <span className="scout-tool-grade mono" style={{ color: t.color }}>
                  {g}
                  <span className="scout-tool-desc"> · {gradeLabel(g)}</span>
                </span>
              </div>
              <div className="scout-tool-track">
                <div className="scout-tool-fill" style={{ width: `${((g - 20) / 60) * 100}%`, background: t.color }} />
              </div>
            </Tag>
          )
        })}
      </div>
      {heatOpen && (
        <div className="heat-breakdown">
          <div className="heat-bd-row heat-bd-base">
            <span>Baseline form</span>
            <span className="mono">{hb.base}</span>
          </div>
          {hb.parts.map((p, i) => (
            <div className="heat-bd-row" key={i}>
              <span className="heat-bd-main">
                <span className="heat-bd-label">{p.label}</span>
                <span className="heat-bd-detail dim">{p.detail}</span>
              </span>
              <span className={`heat-bd-delta mono ${p.delta > 0 ? 'pos' : p.delta < 0 ? 'neg' : 'dim'}`}>
                {p.delta > 0 ? '+' : ''}
                {p.delta || '·'}
              </span>
            </div>
          ))}
          <div className="heat-bd-row heat-bd-total">
            <span>Heat index</span>
            <span className="mono">{hb.total}/100</span>
          </div>
        </div>
      )}
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
    <Section title="Statcast" icon="Gauge">
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
    <Section title="Park & weather" icon="Wind">
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
          <Cell k="Park HR factor" v={b.gameParkHRFactor != null ? `${num(b.gameParkHRFactor, 3)}×` : '—'} />
          <Cell
            k="Park·Wx·Hand"
            v={b.parkWeatherHandFactor != null ? `${num(b.parkWeatherHandFactor, 3)}×` : '—'}
          />
          {b.parkWeatherHandDelta != null && (
            <Cell k="Env delta" v={signedPct(b.parkWeatherHandDelta, 1)} />
          )}
        </div>
      )}
    </Section>
  )
}

function PitcherSection({ b }) {
  const p = b.pitcher
  if (!p) return null
  const s = p.season || {}
  const split = b.batSide === 'L' ? p.splits?.vl : p.splits?.vr
  const rf = p.recentForm
  return (
    <Section title="Opposing pitcher" icon="Shield">
      <div className="pitcher-head">
        <div>
          <div className="pitcher-name">{p.name}</div>
          <div className="pitcher-meta">
            {p.hand}HP{split ? ` · vs ${b.batSide}HB` : ''}
          </div>
        </div>
      </div>
      <div className="stat-grid">
        <Cell k="ERA" v={num(s.era, 2)} />
        <Cell k="HR/9" v={num(s.hrPer9, 2)} tone={s.hrPer9 >= 1.3 ? 'good' : s.hrPer9 <= 0.9 ? 'bad' : null} />
        <Cell k="K/9" v={num(s.kPer9, 1)} />
        <Cell k="WHIP" v={num(s.whip, 2)} />
        <Cell k="IP" v={num(s.ip, 1)} />
        <Cell k="HR" v={num(s.hr)} />
      </div>
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
        Model {pct(b.hrProbability, 1)} vs market {pct(o.marketImplied, 1)} · positive edge = model sees value
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

/* ---- small shared bits ---- */
function Section({ title, icon, children }) {
  return (
    <section className="drawer-section">
      <h3 className="section-title">
        <Icon name={icon} size={14} /> {title}
      </h3>
      {children}
    </section>
  )
}

function Cell({ k, v, unit, tone }) {
  return (
    <div className="cell">
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
