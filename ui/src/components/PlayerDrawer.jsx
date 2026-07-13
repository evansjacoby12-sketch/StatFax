import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon.jsx'
import { GradeChip, BadgeRow, KV, hexA, ScoreRing } from './atoms.jsx'
import { activeBadges, eli5IconName, toneColor, gradeColor } from '../lib/badges.js'
import { pct, rate, num, signedPct, american, decimalToAmerican, ordinal } from '../lib/format.js'
import { bookLabel } from '../lib/data.js'
import { compass, skyLabel } from '../lib/weather.js'
import { interpretWind } from '../lib/wind.js'
import { playerHeadshot, teamAbbr } from '../lib/teams.js'
import { toolGrades, heatBreakdown, scoutVerdict, gradeLabel, hrSetup } from '../lib/scout.js'
import { blastOf, blastVsHandOf } from '../lib/groups.js'
import { estimatedKs } from '../lib/pitchers.js'
import { useLiveMode } from '../lib/liveMode.js'
import { useEliLevel, reasonsForLevel } from '../lib/eliLevel.js'
import { toast } from './Toast.jsx'
import { sharePickCard } from '../lib/shareCard.js'
import { useExplain } from '../lib/explain.js'
import { locationRating5, arsenalRating5, combinedEdge5 } from '../lib/zoneEdge.js'
import { powerReadyCriteria, barrelReadyCriteria } from '../lib/powerReady.js'
import * as store from '../lib/storage.js'

const WORKER_URL = import.meta.env?.VITE_WORKER_URL || ''

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

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
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    el?.addEventListener('keydown', onKey)
    return () => { el?.removeEventListener('keydown', onKey); if (restore?.focus) restore.focus() }
  }, [])
  return ref
}

function useCountUp(target, ms = 550) {
  const [v, setV] = useState(target)
  useEffect(() => {
    if (typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setV(target); return }
    let raf, start = null
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

function useGameLog(playerId, enabled) {
  const [log, setLog] = useState(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!playerId || !enabled) return
    setLoading(true)
    const yr = new Date().getFullYear()
    // No `limit` here: the API returns the season log date-ascending, so a
    // server-side limit would give the FIRST N games. Take the last 15
    // client-side and show them newest-first.
    fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=gameLog&group=hitting&season=${yr}&sportId=1`)
      .then(r => r.json())
      .then(data => {
        const splits = data?.stats?.[0]?.splits || []
        const recent = splits.slice(-15).reverse()
        setLog(recent.map(s => ({
          date: s.date,
          opp: s.opponent?.abbreviation || teamAbbr(s.opponent?.id) || s.opponent?.name || '?',
          isHome: s.isHome,
          gamePk: s.game?.gamePk ?? null,
          ab: s.stat?.atBats ?? 0,
          h: s.stat?.hits ?? 0,
          d: s.stat?.doubles ?? 0,
          t: s.stat?.triples ?? 0,
          hr: s.stat?.homeRuns ?? 0,
          rbi: s.stat?.rbi ?? 0,
          bb: s.stat?.baseOnBalls ?? 0,
          k: s.stat?.strikeOuts ?? 0,
          sf: s.stat?.sacFlies ?? 0,
          hbp: s.stat?.hitByPitch ?? 0,
        })))
      })
      .catch(() => setLog([]))
      .finally(() => setLoading(false))
  }, [playerId, enabled])
  return { log, loading }
}

function usePlatoonSplits(playerId, enabled) {
  const [splits, setSplits] = useState(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!playerId || !enabled) return
    setLoading(true)
    const yr = new Date().getFullYear()
    fetch(`https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=statSplits&group=hitting&season=${yr}&sportId=1&sitCodes=vl,vr,h,a,d,n`)
      .then(r => r.json())
      .then(data => {
        const all = data?.stats?.[0]?.splits || []
        const find = code => {
          const s = all.find(x => x.split?.code === code)?.stat
          if (!s) return null
          const avg = parseFloat(s.avg) || null
          const slg = parseFloat(s.slg) || null
          const obp = parseFloat(s.obp) || null
          return { ab: s.atBats ?? 0, avg, slg, obp, iso: slg != null && avg != null ? slg - avg : null, hr: s.homeRuns ?? 0, k: s.strikeOuts ?? 0, bb: s.baseOnBalls ?? 0 }
        }
        setSplits({ vsLHP: find('vl'), vsRHP: find('vr'), home: find('h'), away: find('a'), day: find('d'), night: find('n') })
      })
      .catch(() => setSplits(null))
      .finally(() => setLoading(false))
  }, [playerId, enabled])
  return { splits, loading }
}

function useSavantBIP(playerId, enabled) {
  const [bips, setBips] = useState(null)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!playerId || !enabled || !WORKER_URL) return
    setLoading(true)
    const season = new Date().getFullYear()
    fetch(`${WORKER_URL}/savant-bip?playerId=${playerId}&season=${season}`)
      .then(r => r.json())
      .then(d => setBips(d.bips || []))
      .catch(() => setBips([]))
      .finally(() => setLoading(false))
  }, [playerId, enabled])
  return { bips, loading }
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'overview',  label: 'Summary'   },
  { id: 'statcast',  label: 'Power'     },
  { id: 'matchup',   label: 'Matchup'   },
  { id: 'form',      label: 'Form'      },
  { id: 'splits',    label: 'Splits'    },
  { id: 'trends',    label: 'Trends'    },
  { id: 'spray',     label: 'Spray'     },
]

function TabBar({ active, onChange }) {
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [desktopMoreOpen, setDesktopMoreOpen] = useState(false)
  const desktopMoreRef = useRef(null)
  const primaryTabs = TABS.slice(0, 4)
  const moreTabs = TABS.slice(4)
  const moreActive = moreTabs.some((t) => t.id === active)
  // Sliding underline: one absolute bar measured off the active tab so it
  // glides between tabs (same motion language as the board's view toggle).
  const desktopWrapRef = useRef(null)
  const desktopIndRef = useRef(null)
  const mobileWrapRef = useRef(null)
  const mobileIndRef = useRef(null)
  useEffect(() => {
    const place = (wrap, ind) => {
      if (!wrap || !ind) return
      const btn = [...wrap.querySelectorAll('[data-tab]')]
        .find((item) => item.dataset.tab === active)
      if (!btn) { ind.style.opacity = '0'; return }
      const wrapBox = wrap.getBoundingClientRect()
      const buttonBox = btn.getBoundingClientRect()
      ind.style.opacity = '1'
      ind.style.transform = `translateX(${buttonBox.left - wrapBox.left + wrap.scrollLeft}px)`
      ind.style.width = `${buttonBox.width}px`
      btn.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
    }
    const placeAll = () => {
      place(desktopWrapRef.current, desktopIndRef.current)
      place(mobileWrapRef.current, mobileIndRef.current)
    }
    placeAll()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(placeAll) : null
    if (desktopWrapRef.current) ro?.observe(desktopWrapRef.current)
    if (mobileWrapRef.current) ro?.observe(mobileWrapRef.current)
    window.addEventListener('resize', placeAll)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', placeAll)
    }
  }, [active])
  useEffect(() => {
    if (!desktopMoreOpen) return
    const closeOutside = (event) => {
      if (!desktopMoreRef.current?.contains(event.target)) setDesktopMoreOpen(false)
    }
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setDesktopMoreOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [desktopMoreOpen])
  return (
    <>
      <div className="drawer-tabs desktop-drawer-tabs" ref={desktopWrapRef} role="tablist" aria-label="Player evidence sections">
        <span className="drawer-tab-ind" ref={desktopIndRef} aria-hidden="true" />
        {primaryTabs.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            data-tab={t.id}
            className={`drawer-tab ${active === t.id ? 'active' : ''}`}
            onClick={() => {
              setDesktopMoreOpen(false)
              onChange(t.id)
            }}
          >{t.label}</button>
        ))}
        <div className="desktop-tab-more" ref={desktopMoreRef}>
          <button
            type="button"
            className={`drawer-tab desktop-more-trigger${moreActive ? ' active' : ''}`}
            data-tab={moreActive ? active : 'more'}
            onClick={() => setDesktopMoreOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={desktopMoreOpen}
          >
            More <Icon name="ChevronDown" size={12} />
          </button>
          {desktopMoreOpen && (
            <div className="desktop-tab-menu" role="menu">
              {moreTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  className={active === t.id ? 'active' : ''}
                  onClick={() => {
                    onChange(t.id)
                    setDesktopMoreOpen(false)
                  }}
                >
                  <span>{t.label}</span>
                  {active === t.id && <Icon name="Check" size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mobile-drawer-tabs" ref={mobileWrapRef} role="tablist" aria-label="Player detail sections">
        <span className="mobile-drawer-tab-ind" ref={mobileIndRef} aria-hidden="true" />
        {primaryTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            data-tab={t.id}
            className={`mobile-drawer-tab${active === t.id ? ' active' : ''}`}
            onClick={() => {
              setMobileMoreOpen(false)
              onChange(t.id)
            }}
          >
            {t.label}
          </button>
        ))}
        <div className="mobile-tab-more">
          <button
            type="button"
            className={`mobile-drawer-tab mobile-more-trigger${moreActive ? ' active' : ''}`}
            data-tab={moreActive ? active : 'more'}
            onClick={() => setMobileMoreOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={mobileMoreOpen}
          >
            More · 3 <Icon name="ChevronDown" size={11} />
          </button>
          {mobileMoreOpen && (
            <div className="mobile-tab-menu" role="menu">
              {moreTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  className={active === t.id ? 'active' : ''}
                  onClick={() => {
                    onChange(t.id)
                    setMobileMoreOpen(false)
                  }}
                >
                  <span>{t.label}</span>
                  {active === t.id && <Icon name="Check" size={13} />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function PlayerDrawer({ batter: b, batters, onClose, watched, inSlip, onToggleWatch, onToggleSlip, onOpenZone, onOpenPitcher }) {
  const trapRef = useFocusTrap()
  const liveMode = useLiveMode()
  const [tab, setTab] = useState('overview')

  useEffect(() => {
    if (typeof document === 'undefined') return
    const scroller = document.querySelector('.app')
    if (!scroller) return
    const prev = scroller.style.overflow
    scroller.style.overflow = 'hidden'
    return () => { scroller.style.overflow = prev }
  }, [])

  // Reset to overview when batter changes
  useEffect(() => { setTab('overview') }, [b?.playerId])

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
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          boxShadow: 'var(--glass-shadow)',
          backdropFilter: 'blur(16px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={`${b.name} detail`}
        tabIndex={-1}
        ref={trapRef}
      >
        <button className="drawer-grab" onClick={onClose} aria-label="Close" title="Close" />
        <MobileDrawerHeader b={b} color={color} onClose={onClose} watched={watched} inSlip={inSlip} onToggleWatch={onToggleWatch} onToggleSlip={onToggleSlip} />
        <div className="player-research-shell">
          <DesktopResearchRail b={b} color={color} onClose={onClose} watched={watched} inSlip={inSlip} onToggleWatch={onToggleWatch} onToggleSlip={onToggleSlip} />
          <div className="player-research-main">
            <TabBar active={tab} onChange={setTab} />
            {/* key={tab} remounts the pane on tab change so the section-stagger
                entrance animation (.drawer-pane > * in app.css) replays. */}
            <div key={tab} className="drawer-pane" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {tab === 'overview'  && <OverviewTab  b={b} color={color} onOpenZone={onOpenZone} liveMode={liveMode} />}
              {tab === 'matchup'   && <MatchupTab   b={b} batters={batters} onOpenZone={onOpenZone} onOpenPitcher={onOpenPitcher} />}
              {tab === 'form'      && <FormTab      b={b} />}
              {tab === 'splits'    && <SplitsTab    b={b} />}
              {tab === 'statcast'  && <StatcastTab  b={b} />}
              {tab === 'trends'    && <TrendsTab    b={b} />}
              {tab === 'spray'     && <SprayTab     b={b} />}
            </div>
          </div>
        </div>
      </aside>
    </>
  )

  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}

// ---------------------------------------------------------------------------
// Tab panels
// ---------------------------------------------------------------------------

function OverviewTab({ b, color, onOpenZone, liveMode }) {
  return (
    <>
      <ResearchThesis b={b} />
      <PlateMatchup b={b} onOpenZone={onOpenZone} />
      <ScoutReport b={b} />
      <ExplainPick b={b} />
      <PaCurve b={b} color={color} />
      <EnvSection b={b} />
      <OddsSection b={b} />
      {liveMode && b.game?.isLive && <LiveSection b={b} />}
      <TechReasons b={b} />
    </>
  )
}

function MatchupTab({ b, batters, onOpenZone, onOpenPitcher }) {
  return (
    <>
      <PitchMixAdvantage b={b} />
      <PitcherSection b={b} batters={batters} onOpenPitcher={onOpenPitcher} />
      <ZoneTeaser b={b} onOpen={onOpenZone} />
    </>
  )
}

function FormTab({ b }) {
  const [logEnabled, setLogEnabled] = useState(false)
  useEffect(() => { setLogEnabled(true) }, [])
  const { log, loading } = useGameLog(b.playerId, logEnabled)
  return (
    <>
      <HrSetupSection b={b} />
      <HrFormSection b={b} />
      <GameLogTable log={log} loading={loading} />
    </>
  )
}

function SplitsTab({ b }) {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => { setEnabled(true) }, [])
  const { splits, loading } = usePlatoonSplits(b.playerId, enabled)
  return <BatterSplitsTable b={b} platoon={splits} loading={loading} />
}

function StatcastTab({ b }) {
  return (
    <>
      <BetaCeiling b={b} />
      <StatcastSection b={b} />
      <RollingWindows b={b} />
      <PercentileSection b={b} />
    </>
  )
}

// PRIVATE BETA — hidden unless the user flips "Beta: Ceiling & Form" in Settings
// (localStorage 'statfax:betaCeil', default off), so it never reaches anyone
// else's board. Renders the ADVISORY barrelScore/formScore + their raw top-end
// power inputs, loudly labeled UNVALIDATED. These never touch the HR score/prob;
// qualifying rows may carry the filterable POWER READY beta signal while the
// exact shortlist definition accrues forward results.
function ceilingFormCopy(b, level) {
  const ceil = b.ceilScore
  const form = b.formScore

  if (level === 'eli15') {
    return {
      heading: 'Stats behind the scores',
      ceiling: Number.isFinite(ceil)
        ? `${ceil}/100 blends Barrel%, xISO, robust top-five EV, BLAST, and sweet-spot × hard-hit quality.`
        : 'Needs at least three usable power-quality inputs before it is scored.',
      form: Number.isFinite(form)
        ? `${form}/100 blends recent barrel level, exit velocity, and BLAST; small samples are shrunk toward the season baseline.`
        : 'Needs a recent barrel or bat-tracking window before it is scored.',
    }
  }

  const ceilingRead = !Number.isFinite(ceil)
    ? 'We do not have enough power data yet.'
    : ceil >= 85
      ? 'When he squares it up, his best contact is explosive.'
      : ceil >= 75
        ? 'When he connects, he can do serious home-run damage.'
        : ceil >= 50
          ? 'He has solid power upside, but it is not elite.'
          : 'His best contact has shown limited home-run damage.'

  const formRead = !Number.isFinite(form)
    ? 'We do not have enough recent contact data yet.'
    : form >= 75
      ? 'He has been striking the ball very well lately.'
      : form >= 50
        ? 'His recent contact has been solid.'
        : 'He has not been making much dangerous contact lately.'

  return { heading: 'Plain-English read', ceiling: ceilingRead, form: formRead }
}

function BetaCeiling({ b }) {
  const level = useEliLevel()
  if (!store.load('betaCeil', false)) return null
  const ceil = b.ceilScore, form = b.formScore
  const explain = ceilingFormCopy(b, level)
  const tone = (s) => s == null ? 'var(--text-faint)'
    : s >= 75 ? 'var(--strong)' : s >= 50 ? 'var(--prime)' : 'var(--text-dim)'
  const big = (label, v) => (
    <div style={{ flex: 1, textAlign: 'center', padding: '10px 4px', background: 'rgba(255,255,255,0.02)', borderRadius: 10 }}>
      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: 'var(--mono)', color: tone(v), lineHeight: 1 }}>{v ?? '—'}</div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginTop: 6 }}>{label}</div>
    </div>
  )
  return (
    <Section title="Ceiling & Form · BETA" icon="Sparkles">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {big('Ceiling', ceil)}
        {big('Form', form)}
      </div>
      <SignalChecklist title="Power Ready" badge="POWER READY (beta)" crit={powerReadyCriteria(b)} meaning={SIGNAL_MEANING.powerReady[level] ?? SIGNAL_MEANING.powerReady.eli5} />
      <SignalChecklist title="Barrel Ready" badge="BARREL READY (beta)" crit={barrelReadyCriteria(b)} meaning={SIGNAL_MEANING.barrelReady[level] ?? SIGNAL_MEANING.barrelReady.eli5} />
      <div className="beta-ceil-explain" aria-label="Ceiling and form explanation">
        <div className="beta-ceil-explain-head">
          <Icon name={level === 'eli5' ? 'Sparkles' : 'BarChart3'} size={12} />
          {explain.heading}
        </div>
        <div className="beta-ceil-explain-row"><b>Ceiling</b><span>{explain.ceiling}</span></div>
        <div className="beta-ceil-explain-row"><b>Form</b><span>{explain.form}</span></div>
        <small>
          {b.powerReady ? 'Together, these helped trigger POWER READY (beta). ' : ''}
          They describe contact quality and do not directly raise the HR probability.
        </small>
      </div>
      {b.recentBarrel?.recentEVHi != null && <KV k="Top-5 EV (robust)" v={`${b.recentBarrel.recentEVHi.toFixed(1)} mph`} accent="var(--strong)" />}
      {b.sweetSpotPct != null && <KV k="Sweet-spot %" v={`${b.sweetSpotPct.toFixed(1)}%`} />}
      {b.hardHitPct != null   && <KV k="Hard-hit %" v={`${b.hardHitPct.toFixed(1)}%`} />}
      {b.maxEV != null      && <KV k="Peak EV (display)"   v={`${b.maxEV.toFixed(1)} mph`} />}
      {b.hrDistance != null && <KV k="Avg HR distance (display)" v={`${Math.round(b.hrDistance)} ft`} />}
      {ceil == null && (
        <p style={{ fontSize: 11, color: 'var(--text-faint)', margin: '8px 0 0' }}>
          No ceiling data on this row yet — populates on the next slate rebuild.
        </p>
      )}
      <p style={{ fontSize: 11, color: 'var(--bad)', margin: '10px 0 0', lineHeight: 1.5 }}>
        <b>UNVALIDATED BETA</b> — not a probability bonus or standalone betting signal.
        POWER READY qualifying rows are logged for forward shortlist validation.
      </p>
    </Section>
  )
}

// Plain-English MEANING of each beta signal — what it actually says about a bat,
// at the reader's ELI5/ELI15 depth. Keeps the criteria table from being just
// numbers: the reader learns what "qualifying" means, not only that it did.
const SIGNAL_MEANING = {
  powerReady: {
    eli5: 'Big power meeting a soft spot — his bat can do real damage and the pitcher/park is friendly, so a homer is in play even if he is not hot.',
    eli15: 'Elite power ceiling (≥75) in a plus HR matchup (≥60); form only has to clear a not-cold floor (≥35).',
  },
  barrelReady: {
    eli5: 'He is locked in right now — solid power and genuinely hot lately, so he is dangerous no matter who is pitching.',
    eli15: 'Solid power ceiling (≥70) plus a real recent-form surge (≥60); no matchup requirement.',
  },
}
// Friendly, human phrasing for a gate a bat is short on (used in the verdict).
const MISS_PHRASE = { ceiling: 'more raw power', matchup: 'a friendlier matchup', form: 'to heat up', sample: 'more recent at-bats' }

// Readable beta-signal criteria: a one-line MEANING, then each gate with its
// value, the threshold it must clear, and pass/fail — so you SEE exactly why a
// bat did or didn't qualify (e.g. "Matchup 57 · needs ≥60 ✗"). Renders for POWER
// READY and BARREL READY; thresholds come from powerReady.js so labels never drift.
function SignalChecklist({ title, badge, crit, meaning }) {
  const known = crit.filter((c) => c.value != null)
  if (known.length < 2) return null   // nothing meaningful to show yet
  const missing = crit.filter((c) => !c.met)
  const qualifies = missing.length === 0
  return (
    <div style={{ border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: 4 }}>
        {title} criteria
      </div>
      {meaning && (
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45, marginBottom: 9 }}>{meaning}</div>
      )}
      {crit.map((c) => (
        <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 12 }}>
          <Icon name={c.met ? 'Check' : 'X'} size={13} style={{ color: c.met ? 'var(--strong)' : 'var(--bad)', flexShrink: 0 }} />
          <b style={{ minWidth: 92 }}>{c.label}</b>
          <span className="mono" style={{ color: c.met ? 'var(--text)' : 'var(--bad)', minWidth: 54 }}>
            {c.value != null ? `${c.value}${c.isSample ? ` ${c.unit}` : ''}` : '—'}
          </span>
          <span style={{ color: 'var(--text-faint)', fontSize: 11 }}>needs ≥{c.need}{c.isSample ? ' BBE' : ''}</span>
        </div>
      ))}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: 12, fontWeight: 700, color: qualifies ? 'var(--strong)' : 'var(--text-dim)' }}>
        {qualifies
          ? `✓ Qualifies — ${badge}`
          : `Not yet — just needs ${missing.map((m) => MISS_PHRASE[m.key] || m.label.toLowerCase()).join(' & ')}`}
      </div>
    </div>
  )
}

function TrendsTab({ b }) {
  return (
    <>
      <TodaysOutlook b={b} />
      <DueIndicatorSection b={b} />
    </>
  )
}

function SprayTab({ b }) {
  const [enabled, setEnabled] = useState(false)
  useEffect(() => { setEnabled(true) }, [])
  const { bips, loading } = useSavantBIP(b.playerId, enabled)

  if (!WORKER_URL) return (
    <Section title="Spray Chart" icon="Target">
      <p style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: '24px 0', margin: 0 }}>
        Set <code>VITE_WORKER_URL</code> to your deployed Cloudflare Worker to enable live Savant BIP data.
      </p>
    </Section>
  )

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 0', gap: 10, color: 'var(--text-faint)', fontSize: 13 }}>
      <Icon name="Loader" size={16} style={{ animation: 'spin 1s linear infinite' }} />
      Loading Savant BIP data…
    </div>
  )

  if (!bips || bips.length === 0) return (
    <Section title="Spray Chart" icon="Target">
      <p style={{ color: 'var(--text-faint)', fontSize: 12, textAlign: 'center', padding: '24px 0', margin: 0 }}>
        {bips === null ? 'No data yet' : 'No batted ball events found this season.'}
      </p>
    </Section>
  )

  return (
    <>
      <SprayChart bips={bips} />
      <StatcastTrend bips={bips} />
    </>
  )
}

// ---------------------------------------------------------------------------
// SprayChart & StatcastTrend
// ---------------------------------------------------------------------------

const HIT_EVENTS = new Set(['single', 'double', 'triple', 'home_run'])

function bipDotColor(b) {
  if (b.events === 'home_run') return '#c96f7e'
  if (b.events === 'triple')   return '#f97316'
  if (b.events === 'double')   return '#facc15'
  if (HIT_EVENTS.has(b.events)) return '#4ade80'
  return 'rgba(148,163,184,0.45)'
}

function SprayChart({ bips }) {
  const [filter, setFilter] = useState('all')

  const displayed = bips.filter(b => {
    if (filter === 'gb') return b.bbType === 'ground_ball'
    if (filter === 'ld') return b.bbType === 'line_drive'
    if (filter === 'fb') return b.bbType === 'fly_ball'
    if (filter === 'hr') return b.events === 'home_run'
    return true
  })

  const hits = displayed.filter(b => HIT_EVENTS.has(b.events)).length
  const hrs  = displayed.filter(b => b.events === 'home_run').length

  const FILTERS = [
    { key: 'all', label: 'All'  },
    { key: 'gb',  label: 'GB'   },
    { key: 'ld',  label: 'LD'   },
    { key: 'fb',  label: 'FB'   },
    { key: 'hr',  label: 'HR'   },
  ]

  return (
    <Section title="Spray Chart" icon="Target">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)} style={{
            padding: '3px 10px', borderRadius: 12, border: 'none',
            fontSize: 11, fontWeight: 600, cursor: 'pointer',
            background: filter === f.key ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
            color: filter === f.key ? '#fff' : 'var(--text-dim)',
          }}>{f.label}</button>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-faint)' }}>
          {hits}H / {hrs}HR · {displayed.length} BIP
        </span>
      </div>

      <svg viewBox="0 0 250 250" style={{ width: '100%', maxWidth: 300, display: 'block', margin: '0 auto', borderRadius: 8 }}>
        <rect width="250" height="250" fill="#0c1a0c" rx="6"/>
        {/* Fair territory */}
        <path d="M 125,205 L 0,78 Q 125,2 250,78 Z" fill="#1a3d1a"/>
        {/* Foul lines */}
        <line x1="125" y1="205" x2="0"   y2="78" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
        <line x1="125" y1="205" x2="250" y2="78" stroke="rgba(255,255,255,0.45)" strokeWidth="0.8"/>
        {/* Outfield fence arc */}
        <path d="M 15,85 Q 125,8 235,85" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.2" strokeDasharray="4,3"/>
        {/* Infield dirt */}
        <polygon points="125,205 190,142 125,79 60,142" fill="#5c3d1e" stroke="#7a5230" strokeWidth="0.5"/>
        {/* Pitcher's mound */}
        <circle cx="125" cy="150" r="5" fill="#6b4820"/>
        {/* Bases — 2B */}
        <g transform="rotate(45,125,79)"><rect x="121.5" y="75.5" width="7" height="7" fill="white"/></g>
        {/* 1B */}
        <g transform="rotate(45,190,142)"><rect x="186.5" y="138.5" width="7" height="7" fill="white"/></g>
        {/* 3B */}
        <g transform="rotate(45,60,142)"><rect x="56.5" y="138.5" width="7" height="7" fill="white"/></g>
        {/* Home plate */}
        <polygon points="125,210 130,205 130,200 120,200 120,205" fill="white"/>
        {/* BIP dots */}
        {displayed.map((b, i) => (
          <circle key={i} cx={b.x} cy={b.y}
            r={b.events === 'home_run' ? 4.5 : 3}
            fill={bipDotColor(b)}
            opacity={b.events === 'home_run' ? 0.95 : 0.72}
            stroke={b.events === 'home_run' ? 'rgba(255,255,255,0.55)' : 'none'}
            strokeWidth={0.8}
          />
        ))}
      </svg>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        {[['#4ade80','Single'],['#facc15','Double'],['#f97316','Triple'],['#c96f7e','HR'],['rgba(148,163,184,0.65)','Out']].map(([c,l]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--text-faint)' }}>
            <svg width="8" height="8"><circle cx="4" cy="4" r="4" fill={c}/></svg>
            {l}
          </span>
        ))}
      </div>
    </Section>
  )
}

function StatcastTrend({ bips }) {
  const games = useMemo(() => {
    const byDate = {}
    for (const bip of bips) {
      if (!bip.date) continue
      if (!byDate[bip.date]) byDate[bip.date] = []
      byDate[bip.date].push(bip)
    }
    return Object.entries(byDate)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-15)
      .map(([date, evts]) => {
        const withEV = evts.filter(e => e.ev != null && e.ev > 0)
        const avgEV = withEV.length ? withEV.reduce((s, e) => s + e.ev, 0) / withEV.length : null
        const hhPct = withEV.length ? withEV.filter(e => e.ev >= 95).length / withEV.length * 100 : null
        return { date: date.slice(5), bip: evts.length, avgEV, hhPct }
      })
  }, [bips])

  if (!games.length) return null

  const evVals = games.filter(g => g.avgEV != null).map(g => g.avgEV)
  const minEV = evVals.length ? Math.min(...evVals) : 60
  const maxEV = evVals.length ? Math.max(...evVals) : 105
  const rangeEV = Math.max(maxEV - minEV, 8)

  const mid = Math.floor(games.length / 2)
  return (
    <Section title="Exit Velo Trend (per game)" icon="TrendingUp">
      {/* Bars all share one baseline — the date labels live in their own row
          below, not inside each bar column (which used to make labelled bars
          float higher than the rest). */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72, padding: '0 1px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {games.map((g, i) => {
          const h = g.avgEV != null ? Math.max(6, ((g.avgEV - minEV) / rangeEV) * 58 + 10) : 4
          const clr = g.avgEV == null ? 'rgba(148,163,184,0.18)'
            : g.avgEV >= 95 ? 'var(--b-hot)'
            : g.avgEV >= 90 ? '#facc15'
            : '#676673'
          return (
            <div key={i} title={g.avgEV != null ? `${g.date}: ${g.avgEV.toFixed(1)} mph avg EV · ${g.bip} BIP` : `${g.date}: no tracked BIP`}
              style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', cursor: 'default' }}>
              <div style={{ width: '100%', height: h, background: clr, borderRadius: '3px 3px 0 0', minHeight: 3 }}/>
            </div>
          )
        })}
      </div>
      {/* Horizontal date axis: first · middle · last */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>
        <span>{games[0]?.date}</span>
        {games.length > 2 && <span>{games[mid]?.date}</span>}
        <span>{games[games.length - 1]?.date}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 10, color: 'var(--text-faint)', justifyContent: 'center' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--b-hot)' }} /> ≥95 hard hit
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: '#facc15' }} /> ≥90 solid
        </span>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// DrawerHeader
// ---------------------------------------------------------------------------

// Plain-text share card — the drawer's key numbers in a paste-anywhere shape.
function playerCardText(b) {
  const g = b.grade?.label || 'SKIP'
  const hr = b.hrProbability != null ? `${(b.hrProbability * 100).toFixed(1)}% HR` : null
  const setup = hrSetup(b)
  const best = b.odds?.best
  const line1 = `⚾ ${b.name} (${b.team}) vs ${b.pitcher?.name || 'TBD'}${b.pitcher?.hand ? ` (${b.pitcher.hand}HP)` : ''}`
  const line2 = [
    `${g} ${Math.round(b.score ?? 0)}`,
    hr,
    Number.isFinite(b.heatIndex) ? `Heat ${b.heatIndex}` : null,
    setup.n ? `Setup ${setup.n}/6` : null,
    b.precision ? 'PRECISION' : null,
  ].filter(Boolean).join(' · ')
  const line3 = best?.american ? `Best odds ${american(best.american)}${best.book ? ` (${bookLabel(best.book)})` : ''}` : null
  return [line1, line2, line3, 'statfax.online'].filter(Boolean).join('\n')
}

function sharePlayerCard(b) {
  toast.info('Rendering card…', 1500)
  sharePickCard(b)
    .then((how) => { if (how !== 'cancelled') toast.success(how === 'shared' ? 'Card shared' : 'Card downloaded') })
    .catch(() => toast.warn("Couldn't render the card"))
}

function ResearchReasons({ b, compact = false }) {
  const reasons = reasonsForLevel(b, 'eli5').slice(0, 3)
  if (!reasons.length) return null
  return (
    <div className={`research-reasons${compact ? ' compact' : ''}`}>
      {reasons.map((reason, index) => (
        <div className="research-reason" key={`${reason.text}-${index}`}>
          <span className="research-reason-icon" style={{ color: toneColor(reason.tone) }}>
            <Icon name={eli5IconName(reason.icon)} size={compact ? 12 : 14} />
          </span>
          <span>{reason.text}</span>
        </div>
      ))}
    </div>
  )
}

function DesktopResearchRail({ b, color, onClose, watched, inSlip, onToggleWatch, onToggleSlip }) {
  const pitcherHand = b.pitcher?.hand ? `${b.pitcher.hand}HP` : null
  const market = b.vegasImpliedProb
  const hasMarket = Number.isFinite(market)
  const edge = hasMarket && Number.isFinite(b.hrProbability) ? b.hrProbability - market : null
  return (
    <aside className="research-decision-rail" style={{ '--rail-accent': color }}>
      <button className="research-rail-close" onClick={onClose} aria-label="Close player details">
        <Icon name="X" size={17} />
      </button>

      <div className="research-rail-identity">
        <img src={playerHeadshot(b.playerId, 160)} alt={b.name} />
        <div>
          <h2>{b.name}</h2>
          <div className="research-identity-chips">
            <span>{b.batSide}HB</span>
            <span>{b.team}</span>
          </div>
        </div>
      </div>

      <div className="research-decision-card">
        <div className="research-decision-head">
          <small>StatFax read</small>
          <GradeChip grade={b.grade} size="sm" score={b.score} />
        </div>
        <div className="research-decision-value">
          <strong className="mono" style={{ color }}>{pct(b.hrProbability, 1)}</strong>
          <span>HR probability</span>
        </div>
        <div className="research-market-row">
          {hasMarket ? (
            <>
              <span className={edge != null && edge >= 0 ? 'good' : 'bad'}>{signedPct(edge, 1)} edge</span>
              <span>{pct(market, 1)} market</span>
            </>
          ) : (
            <span>Market price unavailable</span>
          )}
        </div>
      </div>

      <dl className="research-context-list">
        <div><dt>Matchup</dt><dd>{b.team} vs {b.opponent?.abbr || b.opponent?.name || '—'}</dd></div>
        <div><dt>Lineup</dt><dd>{b.battingOrder ? `${ordinal(b.battingOrder)} spot · ${b.lineupConfirmed ? 'Confirmed' : 'Projected'}` : (b.lineupConfirmed ? 'Confirmed' : 'Projected')}</dd></div>
        <div><dt>Pitcher</dt><dd>{b.pitcher?.name || 'TBD'}{pitcherHand ? ` · ${pitcherHand}` : ''}</dd></div>
      </dl>

      <div className="research-thesis-label"><Icon name="Sparkles" size={12} /> Strongest reasons</div>
      <ResearchReasons b={b} />

      <div className="research-rail-actions">
        <button className={`research-add${inSlip ? ' on' : ''}`} onClick={() => onToggleSlip(b)}>
          <Icon name={inSlip ? 'Check' : 'Plus'} size={14} />{inSlip ? 'In parlay' : 'Add to parlay'}
        </button>
        <div>
          <button className={watched ? 'on' : ''} onClick={() => onToggleWatch(b)}>
            <Icon name="Star" size={14} style={{ fill: watched ? 'currentColor' : 'none' }} />{watched ? 'Watching' : 'Watch'}
          </button>
          <button onClick={() => sharePlayerCard(b)}><Icon name="Share2" size={14} />Share</button>
        </div>
      </div>
    </aside>
  )
}

function ResearchThesis({ b }) {
  return (
    <section className="research-mobile-thesis">
      <div className="research-thesis-label"><Icon name="Sparkles" size={12} /> Why it rates</div>
      <ResearchReasons b={b} compact />
    </section>
  )
}

function DrawerHeader({ b, color, onClose, watched, inSlip, onToggleWatch, onToggleSlip }) {
  const liveMode = useLiveMode()
  return (
    <div className="drawer-head" style={{
      background: `linear-gradient(180deg, ${hexA(color, 0.15)} 0%, transparent 100%)`,
      padding: '24px 20px 16px',
      borderBottom: '1px solid rgba(255,255,255,0.05)',
      position: 'relative',
      flexShrink: 0,
    }}>
      <button className="drawer-close icon-btn" onClick={onClose} aria-label="Close" style={{ position: 'absolute', top: '20px', right: '20px' }}>
        <Icon name="X" size={18} />
      </button>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
        <img
          src={playerHeadshot(b.playerId, 160)}
          alt={b.name}
          style={{ borderColor: hexA(color, 0.4), borderWidth: '2px', borderStyle: 'solid', borderRadius: '12px', width: '72px', height: '72px', background: 'var(--card-2)', objectFit: 'cover', flexShrink: 0, boxShadow: `0 0 20px ${hexA(color, 0.25)}, 0 4px 12px rgba(0,0,0,0.4)` }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px', paddingRight: '40px' }}>
            <h2 className={liveMode && b.liveContext?.isHRThisGame ? 'hr-glow' : ''} style={{ fontFamily: 'var(--display)', fontSize: '21px', fontWeight: '800', color: '#fff', letterSpacing: '-0.02em' }}>{b.name}</h2>
            <span style={{ fontSize: '10px', fontFamily: 'var(--mono)', background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: '4px', color: 'var(--text-dim)', border: '1px solid rgba(255,255,255,0.08)' }}>{b.batSide}HB</span>
            <GradeChip grade={b.grade} size="lg" />
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-dim)', display: 'flex', flexWrap: 'wrap', gap: '5px', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ color: '#fff', fontWeight: '700' }}>{b.team}</span>
            <span>vs {b.opponent?.name || '—'}</span>
            {b.battingOrder && <><span>·</span><span>Batting {ordinal(b.battingOrder)}</span></>}
            <span>·</span><span>{b.isHome ? 'Home' : 'Away'}</span>
            {b.game?.venueName && <><span>·</span><span>{b.game.venueName}</span></>}
          </div>
          <div style={{ marginBottom: b.precision ? '8px' : '10px' }}><BadgeRow batter={b} /></div>
          {b.precision && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(151,149,203,0.08)', border: '1px solid rgba(151,149,203,0.2)', borderRadius: '8px', padding: '6px 10px', marginBottom: '10px', fontSize: '11px', fontWeight: '700', color: 'var(--accent)' }}>
              <Icon name="Sparkles" size={12} />
              Precision Play — all 5 gates cleared
            </div>
          )}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button className={`d-act ${inSlip ? 'on' : ''}`} onClick={() => onToggleSlip(b)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: inSlip ? 'rgba(105,185,158,0.12)' : 'rgba(255,255,255,0.04)', color: inSlip ? 'var(--strong)' : '#fff', border: inSlip ? '1px solid var(--strong)' : '1px solid rgba(255,255,255,0.08)', padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600' }}>
              <Icon name={inSlip ? 'Check' : 'Plus'} size={13} />{inSlip ? 'In parlay' : 'Add to parlay'}
            </button>
            <button className={`d-act ghost ${watched ? 'on' : ''}`} onClick={() => onToggleWatch(b)} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: watched ? 'rgba(214,181,111,0.12)' : 'transparent', color: watched ? 'var(--prime)' : 'var(--text-dim)', border: watched ? '1px solid var(--prime)' : '1px solid transparent', padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600' }}>
              <Icon name="Star" size={13} style={{ fill: watched ? 'currentColor' : 'none' }} />{watched ? 'Watching' : 'Watch'}
            </button>
            <button
              className="d-act ghost"
              title="Copy this card as text"
              onClick={() => {
                navigator.clipboard?.writeText(playerCardText(b))
                  .then(() => toast.success(`${b.name}'s card copied`))
                  .catch(() => toast.warn('Copy failed'))
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', color: 'var(--text-dim)', border: '1px solid transparent', padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600' }}
            >
              <Icon name="Copy" size={13} />Copy
            </button>
            <button
              className="d-act ghost"
              title="Share this pick as an image card"
              onClick={() => {
                toast.info('Rendering card…', 1500)
                sharePickCard(b)
                  .then((how) => { if (how !== 'cancelled') toast.success(how === 'shared' ? 'Card shared' : 'Card downloaded') })
                  .catch(() => toast.warn("Couldn't render the card"))
              }}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'transparent', color: 'var(--text-dim)', border: '1px solid transparent', padding: '5px 12px', borderRadius: '8px', fontSize: '12px', fontWeight: '600' }}
            >
              <Icon name="Share2" size={13} />Share
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function MobileDrawerHeader({ b, color, onClose, watched, inSlip, onToggleWatch, onToggleSlip }) {
  const [signalsOpen, setSignalsOpen] = useState(false)
  const allSignals = activeBadges(b).filter((signal) =>
    store.load('betaCeil', false) || (signal.key !== 'powerReady' && signal.key !== 'barrelReady'))
  const hiddenSignalCount = Math.max(0, allSignals.length - 3)
  const shownSignals = signalsOpen ? allSignals : allSignals.slice(0, 3)
  const market = b.vegasImpliedProb
  const hasMarket = Number.isFinite(market)
  const edge = hasMarket && Number.isFinite(b.hrProbability) ? b.hrProbability - market : null

  useEffect(() => setSignalsOpen(false), [b.id])

  const share = () => {
    toast.info('Rendering card…', 1500)
    sharePickCard(b)
      .then((how) => { if (how !== 'cancelled') toast.success(how === 'shared' ? 'Card shared' : 'Card downloaded') })
      .catch(() => toast.warn("Couldn't render the card"))
  }

  return (
    <div className="mobile-player-head" style={{ '--player-accent': color }}>
      <div className="mobile-player-identity">
        <img className="mobile-player-avatar" src={playerHeadshot(b.playerId, 120)} alt={b.name} />
        <div className="mobile-player-who">
          <div className="mobile-player-name-line">
            <strong>{b.name}</strong>
            <span>{b.batSide}HB</span>
          </div>
          <div className="mobile-player-matchup">
            <b>{b.team}</b><span>› {b.opponent?.abbr || b.opponent?.name || '—'}</span><span>· vs {b.pitcher?.name || 'TBD'}</span>
          </div>
          <div className="mobile-player-chips">
            <GradeChip grade={b.grade} size="sm" score={b.score} />
            {b.hot && <span className="mobile-player-hot"><Icon name="Flame" size={9} /> Hot</span>}
          </div>
        </div>
        <div className="mobile-player-prob">
          <b className="mono">{pct(b.hrProbability, 1)}</b>
          <small>HR PROB</small>
        </div>
        <button className="mobile-player-close" onClick={onClose} aria-label="Close player details">
          <Icon name="X" size={17} />
        </button>
      </div>

      <div className="mobile-player-metrics">
        <span><small>Score</small><b className="mono">{Math.round(b.score ?? 0)}</b></span>
        <span><small>{hasMarket ? 'Market' : 'Sim'}</small><b className="mono">{hasMarket ? pct(market, 1) : pct(b.simHRProb, 1)}</b></span>
        <span><small>{hasMarket ? 'Edge' : 'Ens'}</small><b className={`mono${edge != null && edge >= 0 ? ' good' : edge != null ? ' bad' : ''}`}>{hasMarket ? signedPct(edge, 1) : num(b.ensembleScore)}</b></span>
      </div>

      <div
        id="mobile-player-signal-list"
        className={`mobile-player-signals${signalsOpen ? ' expanded' : ''}`}
        aria-label={signalsOpen ? 'All player signals' : 'Top player signals'}
        aria-live="polite"
      >
        {shownSignals.map((signal) => (
          <span key={signal.key} style={{ '--signal-color': signal.color }}>
            <i />{signal.label}
          </span>
        ))}
        {hiddenSignalCount > 0 && (
          <button
            type="button"
            className="more"
            onClick={() => setSignalsOpen((open) => !open)}
            aria-expanded={signalsOpen}
            aria-controls="mobile-player-signal-list"
            aria-label={signalsOpen ? 'Hide additional player signals' : `Show ${hiddenSignalCount} more player signals`}
          >
            <span>{signalsOpen ? 'Less' : `+${hiddenSignalCount}`}</span>
            <Icon name="ChevronDown" size={11} />
          </button>
        )}
      </div>

      <div className="mobile-player-actions">
        <button className={`mobile-player-add${inSlip ? ' on' : ''}`} onClick={() => onToggleSlip(b)}>
          <Icon name={inSlip ? 'Check' : 'Plus'} size={15} />
          {inSlip ? 'In parlay' : 'Add to parlay'}
        </button>
        <button className={`mobile-player-icon-action${watched ? ' on' : ''}`} onClick={() => onToggleWatch(b)} aria-label={watched ? `Stop watching ${b.name}` : `Watch ${b.name}`}>
          <Icon name="Star" size={16} style={{ fill: watched ? 'currentColor' : 'none' }} />
        </button>
        <button className="mobile-player-icon-action" onClick={share} aria-label={`Share ${b.name} pick`}>
          <Icon name="Share2" size={16} />
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HeroNumbers (Overview tab)
// ---------------------------------------------------------------------------

// Compact hero strip — one row: big HR%, score ring, and the model stats as a
// tight mini-grid (replaces the two tall boxes that ate ~180px of the modal).
function HeroMini({ k, v, tone, title }) {
  return (
    <div title={title} style={{ textAlign: 'right', minWidth: '52px' }}>
      <div style={{ fontSize: '8.5px', textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-faint)', marginBottom: '2px', whiteSpace: 'nowrap' }}>{k}</div>
      <div className="mono" style={{ fontSize: '13px', fontWeight: '700', color: tone || '#fff', whiteSpace: 'nowrap' }}>{v}</div>
    </div>
  )
}

function HeroNumbers({ b, color }) {
  const vegas = b.vegasImpliedProb
  const diff = vegas != null && b.hrProbability != null ? b.hrProbability - vegas : null
  const shownProb = useCountUp(b.hrProbability)
  const shownScore = useCountUp(b.score ?? 0)
  return (
    <div className="player-hero-numbers" style={{ display: 'flex', alignItems: 'center', gap: '16px', rowGap: '10px', flexWrap: 'wrap', padding: '12px 16px', marginBottom: '16px', borderRadius: '12px', border: `1px solid ${hexA(color, 0.25)}`, background: `linear-gradient(135deg, ${hexA(color, 0.07)} 0%, rgba(255,255,255,0.01) 100%)` }}>
      <div title={`raw score ${num(b.rawScore)}`}>
        <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)', marginBottom: '3px' }}>HR Probability</div>
        <div style={{ color, fontSize: '27px', fontWeight: '800', lineHeight: 1, fontFamily: 'var(--mono)' }}>{pct(shownProb, 2)}</div>
      </div>
      <ScoreRing score={shownScore} color={color} size={48} />
      <div style={{ display: 'flex', gap: '14px', rowGap: '8px', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
        <HeroMini k="xHR" v={num(b.expectedHRs, 3)} title="Expected HRs this game" />
        <HeroMini k="PAs" v={num(b.expectedPAs, 1)} title="Expected plate appearances" />
        <HeroMini k="Sim" v={pct(b.simHRProb, 1)} title="AB-by-AB simulated HR probability" />
        <HeroMini k="Ens" v={num(b.ensembleScore)} title="Ensemble model score" />
        {vegas != null && <HeroMini k="Market" v={pct(vegas, 1)} title="Market implied HR probability (mean across books)" />}
        {diff != null && <HeroMini k="vs Mkt" v={signedPct(diff, 1)} tone={diff >= 0 ? 'var(--good)' : 'var(--bad)'} title="Model probability minus market implied — positive = value" />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PlateMatchup
// ---------------------------------------------------------------------------

const LG_BLAST = 15, LG_BARREL = 8, LG_HR9 = 1.25

function plateMatchup(b) {
  const ms = b.matchupScore
  if (!Number.isFinite(ms)) return null
  const lean = Math.round(ms - 50)
  const verdict = lean >= 12 ? 'Batter Favored' : lean >= 4 ? 'Lean Batter' : lean > -4 ? 'Even Matchup' : lean > -12 ? 'Lean Pitcher' : 'Pitcher Favored'
  const tone = lean >= 4 ? 'good' : lean <= -4 ? 'bad' : 'even'
  return { lean, verdict, tone }
}

function PillarBar({ label, value, hint }) {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null
  const tone = v == null ? '' : v >= 67 ? 'good' : v >= 45 ? 'mid' : 'bad'
  return (
    <div className="pm-pillar" title={hint} style={{ marginBottom: '10px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
        <span style={{ color: 'var(--text-dim)' }}>{label}</span>
        <span style={{ fontWeight: '700', fontFamily: 'var(--mono)' }}>{v == null ? '—' : Math.round(v)}</span>
      </div>
      <span style={{ display: 'block', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', height: '4px', overflow: 'hidden' }}>
        <span className="pillar-fill" style={{ display: 'block', width: `${v ?? 0}%`, height: '100%', background: tone === 'good' ? 'var(--strong)' : tone === 'mid' ? 'var(--prime)' : 'var(--bad)', boxShadow: `0 0 6px ${tone === 'good' ? 'var(--strong)' : tone === 'mid' ? 'var(--prime)' : 'var(--bad)'}` }} />
      </span>
    </div>
  )
}

function PlateMatchup({ b, onOpenZone }) {
  const pm = plateMatchup(b)
  if (!pm) return null
  const blast = blastOf(b), vsHandBlast = blastVsHandOf(b)
  const barrel = Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct
  const hr9 = Number.isFinite(b.effectiveHR9) ? b.effectiveHR9 : b.pitcher?.season?.hrPer9
  const slot = b.battingOrder, pas = b.expectedPAs
  const jump = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const acts = [
    { label: 'Zone', icon: 'Crosshair', go: () => (b?.zoneMatchup ? onOpenZone?.(b) : jump('sec-zone')()) },
    { label: 'Pitcher', icon: 'Shield', go: jump('sec-pitcher') },
  ]
  return (
    <section className="plate-matchup-card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
      <div className="pm-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="Target" size={14} /> Plate Matchup
        </span>
        <span style={{ fontSize: '10px', fontWeight: '700', padding: '2px 8px', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px', background: pm.tone === 'good' ? 'rgba(105,185,158,0.1)' : pm.tone === 'bad' ? 'rgba(239,68,68,0.1)' : 'rgba(255,255,255,0.05)', color: pm.tone === 'good' ? 'var(--strong)' : pm.tone === 'bad' ? 'var(--bad)' : 'var(--text-dim)' }}>
          <Icon name="Zap" size={10} /> HR Signal
        </span>
      </div>
      <div className="pm-verdict-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px', borderRadius: '8px', marginBottom: '14px', background: pm.tone === 'good' ? 'rgba(105,185,158,0.05)' : pm.tone === 'bad' ? 'rgba(239,68,68,0.05)' : 'rgba(255,255,255,0.02)', border: `1px solid ${pm.tone === 'good' ? 'rgba(105,185,158,0.15)' : pm.tone === 'bad' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.04)'}` }}>
        <div>
          <span style={{ fontSize: '15px', fontWeight: '800', color: '#fff', display: 'block' }}>{pm.verdict}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-dim)' }}>batter vs {b.pitcher?.name || 'TBD'}</span>
        </div>
        <span style={{ fontSize: '20px', fontWeight: '800', fontFamily: 'var(--mono)', color: pm.tone === 'good' ? 'var(--strong)' : pm.tone === 'bad' ? 'var(--bad)' : '#fff' }}>{pm.lean > 0 ? '+' : ''}{pm.lean}</span>
      </div>
      <div className="pm-pillars" style={{ marginBottom: '14px' }}>
        <PillarBar label="Bat threat" value={b.batterScore} hint="Hitter's own HR threat." />
        <PillarBar label="Matchup fit" value={b.matchupScore} hint="This batter vs this starter." />
        <PillarBar label="Park / Weather" value={b.envScore} hint="Venue HR factors." />
      </div>
      <div className="pm-chip-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '14px' }}>
        {Number.isFinite(blast) && (
          <span className={`pm-chip ${blast >= LG_BLAST ? 'good' : ''}`}>
            <Icon name="Zap" size={10} /> Blast {num(blast, 0)}%
            {Number.isFinite(vsHandBlast) && <span className="pm-chip-sub"> · vs {b.batTracking?.vsHand}P {num(vsHandBlast, 0)}%</span>}
          </span>
        )}
        {Number.isFinite(barrel) && <span className={`pm-chip ${barrel >= LG_BARREL ? 'good' : ''}`}><Icon name="Crosshair" size={10} /> Barrel {num(barrel, 0)}%</span>}
        {Number.isFinite(hr9) && <span className={`pm-chip ${hr9 >= LG_HR9 ? 'good' : 'bad'}`}><Icon name="Flame" size={10} /> Arm {num(hr9, 2)} HR/9</span>}
      </div>
      <div className="pm-card-foot" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '12px' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
          <Icon name="List" size={11} />
          {slot ? <> Batting <b>{ordinal(slot)}</b></> : <> Lineup <b>{b.lineupConfirmed ? 'set' : 'projected'}</b></>}
          {Number.isFinite(pas) && <span style={{ color: 'var(--text-faint)' }}> · ~{num(pas, 1)} PA</span>}
        </span>
        <div style={{ display: 'flex', gap: '4px' }}>
          {acts.map(a => (
            <button key={a.label} onClick={a.go} style={{ fontSize: '10px', fontWeight: '600', padding: '3px 8px', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', display: 'inline-flex', alignItems: 'center', gap: '4px', color: 'var(--text-dim)' }}>
              <Icon name={a.icon} size={10} /> {a.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// ScoutReport
// ---------------------------------------------------------------------------

const SCOUT_TOOLS = [
  { key: 'power',       label: 'Power',     color: 'var(--prime)' },
  { key: 'matchup',     label: 'Matchup',   color: 'var(--strong)' },
  { key: 'environment', label: 'Park / Air', color: 'var(--accent)' },
]

function ScoutReport({ b }) {
  if (b.batterScore == null && b.matchupScore == null) return null
  const grades = toolGrades(b)
  return (
    <Section title="Why this play" icon="Crosshair" className="scout-report-card">
      <div className="scout-verdict" style={{ fontSize: '14px', fontWeight: '600', color: '#fff', marginBottom: '14px', lineHeight: '1.4' }}>{scoutVerdict(b)}</div>
      <div className="scout-tool-list" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {SCOUT_TOOLS.map(t => {
          const gv = grades[t.key]
          return (
            <div className="scout-tool-row" key={t.key} title={`${t.label} grade ${gv}/80`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-dim)' }}>{t.label}</span>
                <span style={{ color: t.color, fontWeight: '700', fontFamily: 'var(--mono)' }}>{gv}<span style={{ fontSize: '10px', color: 'var(--text-faint)' }}> · {gradeLabel(gv)}</span></span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.04)', height: '5px', borderRadius: '99px', overflow: 'hidden' }}>
                <div style={{ width: `${((gv - 20) / 60) * 100}%`, background: t.color, height: '100%', borderRadius: '99px' }} />
              </div>
            </div>
          )
        })}
      </div>
      {b.zoneBonus != null && b.zoneBonus !== 0 && (
        <div style={{ fontSize: '12px', marginTop: '14px', padding: '6px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)', color: 'var(--text-dim)' }}>
          Zone matchup <span style={{ fontWeight: '700', fontFamily: 'var(--mono)', color: b.zoneBonus >= 0 ? 'var(--strong)' : 'var(--bad)' }}>{b.zoneBonus >= 0 ? '+' : ''}{num(b.zoneBonus)}</span>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// PaCurve
// ---------------------------------------------------------------------------

function PaCurve({ b, color }) {
  const pa = b.paBreakdown
  if (!Array.isArray(pa) || !pa.length) return null
  const max = Math.max(0.02, ...pa.map(x => x.p || 0))
  return (
    <Section title="Per plate appearance" icon="BarChart3">
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', height: '80px', alignItems: 'flex-end', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
        {pa.map((x, i) => (
          <div key={i} title={`PA ${x.pa}: ${pct(x.p, 1)} HR chance`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ background: 'rgba(255,255,255,0.03)', width: '100%', flex: 1, borderRadius: '4px', display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
              <div style={{ height: `${Math.max(4, (x.p / max) * 100)}%`, background: color, opacity: x.partial ? 0.4 : 1, width: '100%', borderRadius: '4px', boxShadow: `0 0 8px ${hexA(color, 0.4)}` }} />
            </div>
            <span style={{ fontSize: '10px', marginTop: '4px', color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{x.pa}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '11px', marginTop: '8px', color: 'var(--text-dim)' }}>
        HR chance per PA. Sum = <b style={{ fontFamily: 'var(--mono)', color: '#fff' }}>{num(b.expectedHRs, 3)}</b> xHR over {num(b.expectedPAs, 1)} PA.
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// PitchMixAdvantage (new)
// ---------------------------------------------------------------------------

const LEAGUE_SLG = { FF: 0.382, SI: 0.372, FC: 0.350, SL: 0.300, CU: 0.275, KC: 0.293, CH: 0.323, FS: 0.305, SW: 0.298, ST: 0.278 }

function PitchBar({ adv }) {
  if (adv == null) return <div style={{ flex: 1, height: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', position: 'relative' }}><div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.12)', transform: 'translateX(-50%)' }} /></div>
  const MAX = 0.15
  const clamped = Math.max(-MAX, Math.min(MAX, adv))
  const isBatter = clamped >= 0
  const pct50 = Math.abs(clamped) / MAX * 50
  return (
    <div style={{ flex: 1, height: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: '1px', background: 'rgba(255,255,255,0.15)', transform: 'translateX(-50%)', zIndex: 1 }} />
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: isBatter ? '50%' : `${50 - pct50}%`, width: `${pct50}%`, background: isBatter ? 'rgba(105,185,158,0.75)' : 'rgba(239,68,68,0.65)', borderRadius: isBatter ? '0 4px 4px 0' : '4px 0 0 4px' }} />
    </div>
  )
}

function PitchMixAdvantage({ b }) {
  const splits = b.pitchTypeSplits
  if (!splits?.length) return (
    <Section title="Pitch Mix Matchup" icon="BarChart2">
      <p style={{ fontSize: '12px', color: 'var(--text-faint)' }}>No pitch split data available for this matchup.</p>
    </Section>
  )

  // A pitch showing 0 SLG AND 0 whiff has no tracked book — a hitter who'd
  // actually faced it would show *some* outcome. Treat it as missing, not as a
  // .000 (max-tough) matchup, so a high-usage unseen pitch can't sink the rating.
  const hasBook = (p) => p.slg != null && !(p.slg === 0 && !(p.whiff > 0))

  let totalW = 0, totalAdv = 0, coveredUsage = 0, totalUsage = 0
  for (const p of splits) {
    totalUsage += p.usage ?? 0
    if (!hasBook(p)) continue
    const league = LEAGUE_SLG[p.key] ?? 0.330
    totalW += p.usage ?? 0
    totalAdv += (p.slg - league) * (p.usage ?? 0)
    coveredUsage += p.usage ?? 0
  }
  const avgAdv = totalW > 0 ? totalAdv / totalW : 0
  const rating = totalW > 0 ? Math.max(0, Math.min(10, 5 + avgAdv * 25)) : null
  const ratingLabel = rating == null ? 'No book' : rating >= 7.5 ? 'Great' : rating >= 6 ? 'Favorable' : rating >= 5 ? 'Lean Batter' : rating >= 4 ? 'Neutral' : rating >= 2.5 ? 'Lean Pitcher' : 'Tough'
  const ratingColor = rating == null ? 'var(--text-faint)' : rating >= 6 ? 'var(--strong)' : rating >= 4 ? '#fff' : 'var(--bad)'
  // Biggest unseen pitch — flagged when it's a meaningful share of the arsenal.
  const blindSpot = splits.filter((p) => !hasBook(p)).sort((a, c) => (c.usage ?? 0) - (a.usage ?? 0))[0]
  const bigBlind = blindSpot && (blindSpot.usage ?? 0) >= 12 ? blindSpot : null
  const coverage = totalUsage > 0 ? Math.round((coveredUsage / totalUsage) * 100) : null

  return (
    <Section title="Pitch Mix Matchup Advantage" icon="BarChart2">
      {/* Rating header */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>PITCH MIX RATING</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '8px' }}>
          <span style={{ fontSize: '26px', fontWeight: '800', color: '#fff', fontFamily: 'var(--mono)' }}>{rating != null ? rating.toFixed(1) : '—'}</span>
          <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>/ 10</span>
          <span style={{ fontSize: '13px', fontWeight: '700', color: ratingColor, marginLeft: '4px' }}>{ratingLabel}</span>
          {coverage != null && coverage < 85 && <span style={{ fontSize: '10px', color: 'var(--text-faint)', marginLeft: 'auto' }}>{coverage}% of arsenal seen</span>}
        </div>
        <div style={{ height: '5px', background: 'rgba(255,255,255,0.06)', borderRadius: '99px', overflow: 'hidden', marginBottom: '4px' }}>
          <div style={{ width: `${(rating ?? 0) * 10}%`, height: '100%', background: ratingColor, borderRadius: '99px', transition: 'width 0.4s ease' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          <span>Tough</span><span>Neutral</span><span>Favorable</span><span>Great</span>
        </div>
      </div>

      {bigBlind && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 11px', marginBottom: '14px', borderRadius: '8px', background: 'rgba(198,154,87,0.08)', border: '1px solid rgba(198,154,87,0.22)', color: 'var(--prime)', fontSize: '11.5px', lineHeight: 1.4 }}>
          <Icon name="TriangleAlert" size={13} style={{ flexShrink: 0 }} />
          <span><b>No book on his {bigBlind.name?.toLowerCase() || 'top pitch'}</b> ({bigBlind.usage}% usage) — excluded from the rating. A real unknown here.</span>
        </div>
      )}

      {/* Per-pitch rows */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 36px 1fr 44px', gap: '6px 8px', fontSize: '9px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px', alignItems: 'center' }}>
          <span>PITCH</span><span style={{ textAlign: 'center' }}>USE</span>
          <span style={{ textAlign: 'center' }}>← PITCHER | BATTER →</span>
          <span style={{ textAlign: 'right' }}>SLG</span>
        </div>
        {splits.slice(0, 7).map(p => {
          const league = LEAGUE_SLG[p.key] ?? 0.330
          const seen = hasBook(p)
          const adv = seen ? p.slg - league : null
          return (
            <div key={p.key} style={{ display: 'grid', gridTemplateColumns: '1fr 36px 1fr 44px', gap: '6px 8px', alignItems: 'center', marginBottom: '10px', opacity: seen ? 1 : 0.55 }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#fff' }}>{p.name}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-faint)' }}>{seen ? (p.whiff != null ? `${num(p.whiff, 0)}% whiff` : '') : 'no book'}</div>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--text-dim)', textAlign: 'center', fontFamily: 'var(--mono)' }}>{p.usage}%</span>
              <PitchBar adv={adv} />
              <span style={{ fontSize: '11px', textAlign: 'right', fontWeight: '700', fontFamily: 'var(--mono)', color: adv != null && adv > 0.05 ? 'var(--strong)' : adv != null && adv < -0.05 ? 'var(--bad)' : 'var(--text-dim)' }}>
                {seen ? rate(p.slg) : '—'}
              </span>
            </div>
          )
        })}
      </div>
      <div style={{ fontSize: '10px', color: 'var(--text-faint)', marginTop: '6px', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '8px' }}>
        SLG vs each pitch type vs league avg. Bar extends right = batter advantage.{b.pitcher?.name ? ` Arsenal: ${b.pitcher.name}.` : ''}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// PitcherSection
// ---------------------------------------------------------------------------

function battedBallLabel(goAo) {
  if (!Number.isFinite(goAo) || goAo <= 0) return '—'
  return `${goAo.toFixed(2)} · ${goAo <= 0.92 ? 'FB' : goAo >= 1.45 ? 'GB' : 'neu'}`
}
function ballTone(goAo) {
  if (!Number.isFinite(goAo) || goAo <= 0) return null
  return goAo <= 0.92 ? 'good' : goAo >= 1.45 ? 'bad' : null
}

function PitcherSection({ b, batters, onOpenPitcher }) {
  const p = b.pitcher
  if (!p) return null
  const s = p.season || {}
  const lineup = (batters || []).filter(x => x.gamePk === b.gamePk && x.team === b.team)
  const estK = estimatedKs(p, lineup)
  const split = b.batSide === 'L' ? p.splits?.vl : p.splits?.vr
  const rf = p.recentForm
  const canOpen = !!onOpenPitcher && p.id != null
  const idBlock = (
    <div>
      <div style={{ fontSize: '15px', fontWeight: '800', color: '#fff' }}>{p.name}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>{p.hand}HP{split ? ` · vs ${b.batSide}HB` : ''}</div>
    </div>
  )
  return (
    <Section title="Opposing pitcher" icon="Shield" id="sec-pitcher">
      <div style={{ marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '10px' }}>
        {canOpen ? (
          <button className="pitcher-link" onClick={() => onOpenPitcher(p.id, b.gamePk)} title={`Open ${p.name}'s pitcher card`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', color: 'var(--accent)' }}>
            {idBlock}
            <span style={{ fontSize: '11px', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '2px' }}>Pitcher card <Icon name="ChevronRight" size={12} /></span>
          </button>
        ) : idBlock}
      </div>
      <div className="stat-grid" style={{ marginBottom: '12px' }}>
        <Cell k="ERA" v={num(s.era, 2)} />
        <Cell k="HR/9" v={num(s.hrPer9, 2)} tone={s.hrPer9 >= 1.3 ? 'good' : s.hrPer9 <= 0.9 ? 'bad' : null} />
        <Cell k="K/9" v={num(s.kPer9, 1)} />
        <Cell k="Est K" v={estK ? `${Math.round(estK.k)}` : '—'} title={estK ? `Projected K: ${estK.lo}–${estK.hi}` : 'Need a season K sample.'} />
        <Cell k="WHIP" v={num(s.whip, 2)} />
        <Cell k="IP" v={num(s.ip, 1)} />
        <Cell k="GB/FB" v={battedBallLabel(s.goAo)} tone={ballTone(s.goAo)} title="League ~1.15." />
      </div>
      {b.flyBallMatchup && <div className="note good" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(105,185,158,0.06)', padding: '6px 10px', borderRadius: '6px', marginBottom: '8px', border: '1px solid rgba(105,185,158,0.1)' }}><Icon name="Wind" size={12} style={{ color: 'var(--strong)' }} /> <span>Fly-ball arm matchup (GB/FB {num(s.goAo, 2)})</span></div>}
      {b.hrPlatoonEdge && <div className="note good" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(105,185,158,0.06)', padding: '6px 10px', borderRadius: '6px', marginBottom: '8px', border: '1px solid rgba(105,185,158,0.1)' }}><Icon name="Target" size={12} style={{ color: 'var(--strong)' }} /> <span>Gives up more HRs vs {b.batSide === 'S' ? 'this side' : `${b.batSide}HB`}</span></div>}
      {split && (
        <div style={{ display: 'flex', gap: '10px', padding: '8px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', fontSize: '11px', marginBottom: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
          <span style={{ fontWeight: '700', color: 'var(--text-dim)' }}>vs {b.batSide}HB</span>
          <Mini k="HR/9" v={num(split.hrPer9, 2)} />
          <Mini k="AVG" v={rate(split.avg)} />
          {split.slg != null && split.slg > 0 && <Mini k="SLG" v={rate(split.slg)} />}
          {split.iso != null && <Mini k="ISO" v={rate(split.iso)} />}
          {split.kPct != null && <Mini k="K%" v={`${num(split.kPct, 0)}%`} />}
          <Mini k="IP" v={num(split.ip, 1)} />
        </div>
      )}
      {b.h2h && b.h2h.ab > 0 && (
        <div style={{ display: 'flex', gap: '10px', padding: '8px 10px', background: 'rgba(99,102,241,0.04)', borderRadius: '6px', fontSize: '11px', marginBottom: '12px', border: '1px solid rgba(99,102,241,0.1)' }}>
          <span style={{ fontWeight: '700', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><Icon name="Crosshair" size={11} /> Career H2H</span>
          <Mini k="" v={`${b.h2h.h}-for-${b.h2h.ab}`} />
          <Mini k="HR" v={num(b.h2h.hr)} />
          <Mini k="AVG" v={rate(b.h2h.avg)} />
          <Mini k="OPS" v={rate(b.h2h.ops)} />
        </div>
      )}
      {rf?.recentStarts?.length ? (
        <div style={{ marginTop: '12px' }}>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#fff', display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span>Recent Starts</span>
            <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: '400' }}>{num(rf.hrPer9, 2)} HR/9 · {num(rf.era, 2)} ERA (L{rf.games})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', fontSize: '10px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
              {['Date','Opp','IP','H','ER','K','HR'].map(h => <span key={h}>{h}</span>)}
            </div>
            {rf.recentStarts.slice(0, 5).map((st, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '11px', color: 'var(--text-dim)' }}>
                <span style={{ fontFamily: 'var(--mono)' }}>{st.date?.slice(5)}</span>
                <span>{st.isHome ? 'vs' : '@'} {st.opp}</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{num(st.ip, 1)}</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{st.h}</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{st.er}</span>
                <span style={{ fontFamily: 'var(--mono)' }}>{st.k}</span>
                <span style={{ fontFamily: 'var(--mono)', color: st.hr > 0 ? 'var(--b-hot)' : undefined, fontWeight: st.hr > 0 ? '700' : undefined }}>{st.hr}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// ZoneTeaser
// ---------------------------------------------------------------------------

function zoneHeat(t) {
  if (t == null || Number.isNaN(t)) return 'var(--card-2)'
  return `hsl(${220 - 180 * t} ${45 + 35 * t}% ${18 + 22 * t}%)`
}

// Always renders the 9 inner strike-zone cells (indices 0–8) as a 3×3 grid.
// Chase zones (9–12) are intentionally excluded for clarity.
function MiniGrid({ grid, metric, matched }) {
  const inner = grid.slice(0, 9)
  const vals = inner.map(c => c?.[metric]).filter(v => Number.isFinite(v))
  const min = vals.length ? Math.min(...vals) : 0
  const max = vals.length ? Math.max(...vals) : 1
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)', gap: '2px', width: '72px', height: '72px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', padding: '2px', borderRadius: '6px' }}>
      {inner.map((c, i) => {
        const v = c?.[metric]
        const t = Number.isFinite(v) && max > min ? (v - min) / (max - min) : null
        return <span key={i} style={{ background: zoneHeat(t), borderRadius: '2px', border: matched?.includes(i) ? '1px solid var(--accent)' : 'none' }} />
      })}
    </div>
  )
}

function ZoneTeaser({ b, onOpen }) {
  const z = b?.zoneMatchup
  if (!z || !z.batter?.grid || !z.pitcher?.grid) return null
  const matched = z.matchedZones?.length || 0
  // Same combined edge (stronger of location vs arsenal) the full map headlines,
  // so the teaser and the full view never disagree. /5 scale to match.
  const loc = locationRating5(z)
  const ars = arsenalRating5(b)
  const edge = combinedEdge5(b)
  const edgeLabel = edge == null ? '' : edge >= 4 ? 'Great' : edge >= 3 ? 'Favorable' : edge >= 2 ? 'Neutral' : 'Tough'
  return (
    <Section title="Zone matchup" icon="Crosshair" id="sec-zone">
      <button onClick={() => onOpen?.(b)} aria-label="Open zone matchup" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '12px', padding: '14px', width: '100%', textAlign: 'left', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <MiniGrid grid={z.batter.grid} metric="iso" matched={z.matchedZones} />
            <span style={{ fontSize: '9px', marginTop: '4px', color: 'var(--text-faint)' }}>Hitter ISO</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <MiniGrid grid={z.pitcher.grid} metric="freq" matched={z.matchedZones} />
            <span style={{ fontSize: '9px', marginTop: '4px', color: 'var(--text-faint)' }}>Pitcher Loc</span>
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ fontSize: '18px', fontWeight: '800', color: '#fff' }}>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{edge != null ? edge : '—'}</span>
            <span style={{ fontSize: '11px', fontWeight: '400', color: 'var(--text-faint)' }}>/5</span>
            {edgeLabel && <span style={{ fontSize: '11px', fontWeight: '700', marginLeft: '6px', color: edge >= 3 ? 'var(--strong)' : 'var(--text-dim)' }}>{edgeLabel}</span>}
            <span style={{ fontSize: '11px', fontWeight: '400', marginLeft: '6px', color: 'var(--text-dim)' }}>zone edge</span>
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
            {loc != null && <span>Loc {loc}</span>}
            {ars != null && <span> · Arsenal {ars}</span>}
            {matched > 0 && <span> · {matched} hot zone{matched > 1 ? 's' : ''}</span>}
            {z.badge === 'ZONE_MASTER' && <span style={{ background: 'var(--accent)', color: '#fff', fontSize: '9px', padding: '1px 4px', borderRadius: '3px', marginLeft: '6px', fontWeight: '800' }}>ZONE MASTER</span>}
          </div>
          <span style={{ fontSize: '11px', fontWeight: '600', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: '2px', marginTop: '6px' }}>Full matchup map <Icon name="ChevronRight" size={12} /></span>
        </div>
      </button>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Form tab sections
// ---------------------------------------------------------------------------

function HrSetupSection({ b }) {
  const { checks, n } = hrSetup(b)
  const heat = b.heatIndex != null ? b.heatIndex : heatBreakdown(b).total
  const tone = heat >= 70 ? 'good' : heat >= 50 ? 'warn' : 'bad'
  const tag = heat >= 70 ? 'On fire 🔥' : heat >= 58 ? 'Hot' : heat >= 45 ? 'Warm' : 'Cool'
  return (
    <Section title="Setup & form" icon="Flame">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
        <span style={{ fontSize: '28px', fontWeight: '800', fontFamily: 'var(--mono)', color: tone === 'good' ? 'var(--strong)' : tone === 'warn' ? 'var(--prime)' : 'var(--bad)', lineHeight: 1 }}>{heat}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>/ 100</span>
        <span style={{ fontSize: '11px', fontWeight: '700', color: tone === 'good' ? 'var(--strong)' : tone === 'warn' ? 'var(--prime)' : 'var(--bad)', background: tone === 'good' ? 'rgba(105,185,158,0.08)' : tone === 'warn' ? 'rgba(214,181,111,0.08)' : 'rgba(239,68,68,0.08)', padding: '2px 8px', borderRadius: '4px', marginLeft: '8px' }}>{tag}</span>
        <span style={{ fontSize: '11px', color: 'var(--text-faint)', marginLeft: 'auto' }}>setup {n}/6</span>
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {checks.map(c => (
          <li key={c.label} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: '12px', color: c.pass ? 'var(--text)' : 'var(--text-faint)' }}>
            <Icon name={c.pass ? 'Check' : 'X'} size={12} style={{ color: c.pass ? 'var(--strong)' : 'var(--text-faint)', marginTop: '2px' }} />
            <div>
              <span style={{ fontWeight: c.pass ? '600' : '400' }}>{c.label}</span>
              <span style={{ fontSize: '10px', color: 'var(--text-faint)', display: 'block', marginTop: '1px' }}>{c.detail}</span>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

const HRF_MAX = 0.08
function hrfTone(r) { return r >= 0.05 ? 'good' : r >= 0.03 ? 'warn' : 'bad' }

function HrFormSection({ b }) {
  const windows = [
    { k: 'L7',     w: b.recent7  },
    { k: 'L30',    w: b.recent   },
    { k: 'Season', w: b.season   },
  ].map(({ k, w }) => {
    const ab = w?.ab ?? 0, hr = w?.hr ?? 0
    return { k, hr, ab, rate: ab ? hr / ab : null }
  })
  if (!windows.some(x => x.ab)) return null
  return (
    <Section title="Recent form" icon="Activity">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '14px' }}>
        {windows.map(({ k, hr, ab, rate }) => (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
            <span style={{ width: '50px', color: 'var(--text-dim)', fontWeight: '600' }}>{k}</span>
            <span style={{ flex: 1, height: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '99px', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', borderRadius: '99px', width: rate == null ? '0%' : `${Math.min(100, (rate / HRF_MAX) * 100)}%`, background: rate == null ? 'rgba(255,255,255,0.1)' : hrfTone(rate) === 'good' ? 'var(--strong)' : hrfTone(rate) === 'warn' ? 'var(--prime)' : 'rgba(255,255,255,0.1)' }} />
            </span>
            <span style={{ width: '45px', textAlign: 'right', fontWeight: '700', fontFamily: 'var(--mono)' }}>{rate == null ? '—' : pct(rate, 1)}</span>
            <span style={{ width: '90px', fontSize: '10px', color: 'var(--text-faint)' }}>{ab ? `${hr} HR · ${ab} AB` : 'no sample'}</span>
          </div>
        ))}
      </div>
      <SplitChips b={b} />
    </Section>
  )
}

function GameBreakdown({ g }) {
  const singles = Math.max(0, g.h - g.d - g.t - g.hr)
  const nonKOuts = Math.max(0, g.ab - g.h - g.k)
  const pa = g.ab + g.bb + (g.hbp ?? 0) + (g.sf ?? 0)
  const slg = g.ab > 0 ? (g.h + g.d + g.t * 2 + g.hr * 3) / g.ab : null
  const obp = pa > 0 ? (g.h + g.bb + (g.hbp ?? 0)) / pa : null
  const iso = g.ab > 0 ? (g.d + g.t * 2 + g.hr * 3) / g.ab : null

  const chips = [
    ...Array(g.hr).fill({ label: 'HR', bg: 'rgba(214,181,111,0.18)', color: 'var(--b-hot)', border: 'rgba(214,181,111,0.3)' }),
    ...Array(g.t).fill({ label: '3B', bg: 'rgba(251,146,60,0.14)', color: '#fb923c', border: 'rgba(251,146,60,0.25)' }),
    ...Array(g.d).fill({ label: '2B', bg: 'rgba(250,204,21,0.12)', color: '#fbbf24', border: 'rgba(250,204,21,0.22)' }),
    ...Array(singles).fill({ label: '1B', bg: 'rgba(105,185,158,0.10)', color: 'var(--strong)', border: 'rgba(105,185,158,0.2)' }),
    ...Array(g.bb).fill({ label: 'BB', bg: 'rgba(151,149,203,0.08)', color: 'var(--accent)', border: 'rgba(151,149,203,0.18)' }),
    ...Array(g.hbp ?? 0).fill({ label: 'HBP', bg: 'rgba(151,149,203,0.06)', color: 'var(--accent)', border: 'rgba(151,149,203,0.14)' }),
    ...Array(g.k).fill({ label: 'K', bg: 'rgba(239,68,68,0.10)', color: 'var(--bad)', border: 'rgba(239,68,68,0.2)' }),
    ...Array(nonKOuts).fill({ label: 'OUT', bg: 'rgba(255,255,255,0.03)', color: 'var(--text-faint)', border: 'rgba(255,255,255,0.07)' }),
  ]

  return (
    <div style={{ padding: '10px 14px 14px', background: 'rgba(99,102,241,0.05)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '10px' }}>
        {chips.map((c, i) => (
          <span key={i} style={{ fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '6px', background: c.bg, color: c.color, border: `1px solid ${c.border}`, fontFamily: 'var(--mono)' }}>
            {c.label}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '16px', fontSize: '11px', fontFamily: 'var(--mono)', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--text-faint)' }}>PA <b style={{ color: '#fff' }}>{pa}</b></span>
        {obp != null && <span style={{ color: 'var(--text-faint)' }}>OBP <b style={{ color: obp >= 0.4 ? 'var(--strong)' : '#fff' }}>{rate(obp)}</b></span>}
        {slg != null && <span style={{ color: 'var(--text-faint)' }}>SLG <b style={{ color: slg >= 0.5 ? 'var(--strong)' : '#fff' }}>{rate(slg)}</b></span>}
        {iso != null && <span style={{ color: 'var(--text-faint)' }}>ISO <b style={{ color: iso >= 0.2 ? 'var(--strong)' : '#fff' }}>{rate(iso)}</b></span>}
      </div>
    </div>
  )
}

function GameLogTable({ log, loading }) {
  const [selected, setSelected] = useState(null)

  if (loading) return (
    <Section title="Last 15 Games" icon="CalendarDays">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-faint)', padding: '16px 0' }}>
        <Icon name="Loader" size={14} style={{ animation: 'spin 1s linear infinite' }} /> Loading game log…
      </div>
    </Section>
  )
  if (!log?.length) return null
  const cols = ['Date','Opp','AB','H','2B','3B','HR','RBI','BB','K','']
  return (
    <Section title="Last 15 Games" icon="CalendarDays">
      <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', minWidth: '420px' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
              {cols.map(h => <th key={h} style={{ padding: '6px 8px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.04em', textAlign: h === 'Date' || h === 'Opp' ? 'left' : 'center', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {log.map((g, i) => {
              const open = selected === i
              return (
                <Fragment key={i}>
                  <tr
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected(open ? null : i)}
                    onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setSelected(open ? null : i)}
                    style={{
                      cursor: 'pointer',
                      borderBottom: open ? 'none' : '1px solid rgba(255,255,255,0.02)',
                      background: open ? 'rgba(99,102,241,0.08)' : g.hr > 0 ? 'rgba(214,181,111,0.04)' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{g.date?.slice(5)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{g.isHome ? 'vs' : '@'} {g.opp}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'var(--mono)' }}>{g.ab}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'var(--mono)' }}>{g.h}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'var(--mono)', color: g.d > 0 ? '#fff' : 'var(--text-faint)' }}>{g.d}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'var(--mono)', color: g.t > 0 ? '#fff' : 'var(--text-faint)' }}>{g.t}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontWeight: g.hr > 0 ? '800' : '400', color: g.hr > 0 ? 'var(--b-hot)' : 'var(--text-faint)' }}>{g.hr}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'var(--mono)' }}>{g.rbi}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'var(--mono)' }}>{g.bb}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontFamily: 'var(--mono)', color: g.k > 0 ? 'var(--bad)' : 'var(--text-faint)' }}>{g.k}</td>
                    <td style={{ padding: '6px 4px', textAlign: 'center', color: 'var(--text-faint)' }}>
                      <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={12} />
                    </td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={11} style={{ padding: 0, borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                        <GameBreakdown g={g} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Splits tab
// ---------------------------------------------------------------------------

function SplitStatRow({ label, s, tonight }) {
  if (!s) return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', opacity: 0.4 }}>
      <td style={{ padding: '7px 8px', fontSize: '12px', color: 'var(--text-faint)', fontWeight: tonight ? '700' : '400', whiteSpace: 'nowrap' }}>{label}{tonight && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', marginLeft: 5 }} />}</td>
      {['—','—','—','—','—','—','—'].map((v, i) => <td key={i} style={{ padding: '7px 8px', textAlign: 'center', fontSize: '11px', color: 'var(--text-faint)', fontFamily: 'var(--mono)' }}>{v}</td>)}
    </tr>
  )
  const iso = s.iso ?? (s.slg != null && s.avg != null ? s.slg - s.avg : null)
  const hrRate = s.ab > 0 ? s.hr / s.ab : null
  return (
    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', background: tonight ? 'rgba(99,102,241,0.04)' : 'transparent' }}>
      <td style={{ padding: '7px 8px', fontSize: '12px', color: tonight ? '#fff' : 'var(--text-dim)', fontWeight: tonight ? '700' : '400', whiteSpace: 'nowrap' }}>{label}{tonight && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', marginLeft: 5, verticalAlign: 'middle' }} />}</td>
      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>{s.ab || '—'}</td>
      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: '600', color: '#fff' }}>{s.avg != null ? rate(s.avg) : '—'}</td>
      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>{s.obp != null ? rate(s.obp) : '—'}</td>
      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-dim)' }}>{s.slg != null ? rate(s.slg) : '—'}</td>
      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: iso != null && iso >= 0.200 ? 'var(--strong)' : 'var(--text-dim)' }}>{iso != null ? rate(iso) : '—'}</td>
      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', fontWeight: s.hr > 0 ? '700' : '400', color: s.hr > 0 ? 'var(--b-hot)' : 'var(--text-faint)' }}>{s.hr != null ? s.hr : '—'}</td>
      <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', fontSize: '11px', color: hrRate != null && hrRate >= 0.04 ? 'var(--strong)' : 'var(--text-faint)' }}>{hrRate != null ? pct(hrRate, 1) : '—'}</td>
    </tr>
  )
}

function BatterSplitsTable({ b, platoon, loading }) {
  const dn = b.dayNightSplits
  const ha = b.homeAwaySplits

  const makeDnSplit = (iso, hrRate, ab) => ab ? { ab, avg: null, obp: null, slg: null, iso, hr: hrRate != null && ab ? Math.round(hrRate * ab) : null } : null
  const makeHaSplit = (iso, ab) => ab ? { ab, avg: null, obp: null, slg: null, iso, hr: null } : null

  const daySplit   = dn ? makeDnSplit(dn.dayISO,   dn.dayHRRate,   dn.dayAB)   : null
  const nightSplit = dn ? makeDnSplit(dn.nightISO, dn.nightHRRate, dn.nightAB) : null
  const homeSplit  = ha ? makeHaSplit(ha.homeISO, ha.homeAB) : null
  const awaySplit  = ha ? makeHaSplit(ha.awayISO, ha.awayAB) : null

  const pitcherHand = b.pitcher?.hand
  const tonightIsDay = b.game?.gameDate ? new Date(b.game.gameDate).getUTCHours() < 21 : false

  const colHeaders = ['Split','AB','AVG','OBP','SLG','ISO','HR','HR%']

  return (
    <Section title="Situational Splits" icon="SplitSquareVertical">
      {loading && <div style={{ fontSize: '11px', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}><Icon name="Loader" size={12} style={{ animation: 'spin 1s linear infinite' }} /> Loading platoon splits…</div>}
      <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '420px' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
              {colHeaders.map(h => <th key={h} style={{ padding: '7px 8px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.04em', textAlign: h === 'Split' ? 'left' : 'center', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            <SplitStatRow label="Season" s={b.season} tonight={false} />
            <SplitStatRow label="Last 30" s={b.recent} tonight={false} />
            <SplitStatRow label="Last 7" s={b.recent7} tonight={false} />
            {(platoon?.vsRHP || platoon?.vsLHP) && <>
              <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                <td colSpan={8} style={{ padding: '5px 8px', fontSize: '9px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>PLATOON</td>
              </tr>
              <SplitStatRow label="vs RHP" s={platoon?.vsRHP} tonight={pitcherHand === 'R'} />
              <SplitStatRow label="vs LHP" s={platoon?.vsLHP} tonight={pitcherHand === 'L'} />
            </>}
            {(platoon?.home || platoon?.away || homeSplit || awaySplit) && <>
              <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                <td colSpan={8} style={{ padding: '5px 8px', fontSize: '9px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>HOME / AWAY</td>
              </tr>
              <SplitStatRow label="Home" s={platoon?.home ?? homeSplit} tonight={b.isHome === true} />
              <SplitStatRow label="Away" s={platoon?.away ?? awaySplit} tonight={b.isHome === false} />
            </>}
            {(platoon?.day || platoon?.night || daySplit || nightSplit) && <>
              <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                <td colSpan={8} style={{ padding: '5px 8px', fontSize: '9px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>DAY / NIGHT</td>
              </tr>
              <SplitStatRow label="Day" s={platoon?.day ?? daySplit} tonight={tonightIsDay} />
              <SplitStatRow label="Night" s={platoon?.night ?? nightSplit} tonight={!tonightIsDay} />
            </>}
          </tbody>
        </table>
      </div>
      {!loading && !platoon && <div style={{ fontSize: '10px', color: 'var(--text-faint)', marginTop: '8px' }}>● = tonight's matchup. Platoon splits load automatically.</div>}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Statcast tab sections
// ---------------------------------------------------------------------------

function StatcastSection({ b }) {
  const x = b.xStats || {}
  const has = [b.barrelPct, b.exitVelo, b.launchAngle, x.xSLG].some(v => v != null)
  if (!has) return null
  return (
    <Section title="Statcast" icon="Gauge">
      <div className="stat-grid">
        <Cell k="Barrel%" v={b.barrelPct != null ? `${num(b.barrelPct, 1)}%` : '—'} />
        <Cell k="Barrel/BBE" v={b.barrelPctBBE != null ? `${num(b.barrelPctBBE, 1)}%` : '—'} />
        <Cell k="Exit Velo" v={b.exitVelo != null ? `${num(b.exitVelo, 1)}` : '—'} unit="mph" />
        <Cell k="Launch Angle" v={b.launchAngle != null ? `${num(b.launchAngle, 1)}°` : '—'} />
        <Cell k="xBA" v={rate(x.xBA)} />
        <Cell k="xSLG" v={rate(x.xSLG)} />
        <Cell k="xISO" v={rate(x.xISO)} />
        <Cell k="xwOBA" v={rate(x.xwOBA)} />
        {b.pullPct != null && <Cell k="Pull%" v={`${num(b.pullPct, 0)}%`} tone={b.pullPct >= 45 ? 'good' : null} title="Pull-side contact clears fences more often." />}
        {b.hardHitPct != null && <Cell k="Hard Hit%" v={`${num(b.hardHitPct, 0)}%`} tone={b.hardHitPct >= 40 ? 'good' : null} />}
      </div>
      {b.primaryPitchEdge?.passes && (
        <div style={{ marginTop: '12px', background: 'rgba(105,185,158,0.08)', border: '1px solid rgba(105,185,158,0.15)', borderRadius: '8px', padding: '10px 12px', fontSize: '11px', color: 'var(--strong)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="Target" size={12} />
          <span>Crushes the {b.primaryPitchEdge.pitchName} ({rate(b.primaryPitchEdge.batterSlg)} SLG) — pitcher throws it {pct(b.primaryPitchEdge.pitcherFreq, 0)}</span>
        </div>
      )}
      {b.pitchTypeSplits?.length > 0 && (
        <div className="pitch-splits" style={{ marginTop: '12px' }}>
          <div className="pitch-splits-cap dim" style={{ fontSize: '10px', color: 'var(--text-faint)', marginBottom: '8px' }}>SLG vs the arsenal (by usage)</div>
          <div className="pitch-splits-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {b.pitchTypeSplits.map(p => (
              <span key={p.key} className="pitch-split" title={`${p.name} — thrown ${p.usage}%${p.whiff != null ? ` · ${num(p.whiff, 0)}% whiff` : ''}`} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', padding: '6px 8px', fontSize: '10px' }}>
                <span style={{ color: 'var(--text-faint)', marginBottom: '2px' }}>{p.name}</span>
                {p.slg != null ? <b style={{ fontFamily: 'var(--mono)', fontWeight: '700', color: p.slg >= 0.5 ? 'var(--strong)' : p.slg <= 0.35 ? 'var(--bad)' : '#fff' }}>{rate(p.slg)}</b> : <b style={{ color: 'var(--text-faint)' }}>—</b>}
                <span style={{ color: 'var(--text-faint)', marginTop: '1px' }}>{p.usage}%</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Section>
  )
}

// Statcast barrel: EV ≥ 98 mph AND LA in a range that widens with EV.
// Sweet spot is LA 25-31° at 98 mph; each mph above 98 extends ±1° to the
// range, bottoming out at LA 8° and topping at LA 50°. This matches the
// publicly documented Statcast barrel formula without a full lookup table.
function isBarrel(ev, la) {
  if (!Number.isFinite(ev) || !Number.isFinite(la) || ev < 98) return false
  const laR = Math.round(la)
  if (laR < 8 || laR > 50) return false
  const dist = Math.max(0, 25 - laR, laR - 31)
  return ev >= 98 + dist
}

function RollingWindows({ b }) {
  const rb = b.recentBarrelForBatter
  const [enabled, setEnabled] = useState(false)
  useEffect(() => { setEnabled(true) }, [])
  const { bips } = useSavantBIP(b.playerId, enabled)

  const windows = useMemo(() => {
    if (!bips?.length) return null
    const today = new Date()
    const cutoff = (days) => {
      const d = new Date(today)
      d.setDate(d.getDate() - days)
      return d.toISOString().slice(0, 10)
    }
    const summarize = (evts) => {
      if (!evts.length) return null
      const withEV = evts.filter(e => e.ev != null && e.ev > 0)
      const avgEV = withEV.length ? withEV.reduce((s, e) => s + e.ev, 0) / withEV.length : null
      const hh = withEV.length ? withEV.filter(e => e.ev >= 95).length / withEV.length * 100 : null
      const barrelN = withEV.filter(e => isBarrel(e.ev, e.la)).length
      const barrelPct = withEV.length ? barrelN / withEV.length * 100 : null
      return { n: evts.length, avgEV, hh, barrelPct }
    }
    const c7 = cutoff(7), c14 = cutoff(14), c30 = cutoff(30)
    return {
      l7:  summarize(bips.filter(e => e.date >= c7)),
      l14: summarize(bips.filter(e => e.date >= c14)),
      l30: summarize(bips.filter(e => e.date >= c30)),
    }
  }, [bips])

  const rows = [
    {
      label: 'Last 7d',
      n: windows?.l7?.n ?? rb?.sevenDay?.bbe,
      barrel: windows?.l7?.barrelPct ?? rb?.sevenDay?.pct,
      ev: windows?.l7?.avgEV ?? rb?.recentEV,
      hh: windows?.l7?.hh,
    },
    {
      label: 'Last 14d',
      n: windows?.l14?.n ?? rb?.fourteenDay?.bbe,
      barrel: windows?.l14?.barrelPct ?? rb?.fourteenDay?.pct,
      ev: windows?.l14?.avgEV,
      hh: windows?.l14?.hh,
    },
    {
      label: 'Last 30d',
      n: windows?.l30?.n,
      barrel: windows?.l30?.barrelPct ?? null,
      ev: windows?.l30?.avgEV,
      hh: windows?.l30?.hh,
    },
    {
      label: 'Season',
      n: null,
      barrel: b.barrelPctBBE ?? b.barrelPct,
      ev: b.exitVelo,
      hh: b.hardHitPct,
    },
  ].filter(r => r.barrel != null || r.ev != null || r.n != null || r.hh != null)

  if (!rows.length) return null
  return (
    <Section title="Rolling Windows" icon="TrendingUp">
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
              {['Window','BIP','Barrel%','Avg EV','Hard Hit%'].map(h => <th key={h} style={{ padding: '6px 8px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase', fontSize: '9px', letterSpacing: '0.04em', textAlign: h === 'Window' ? 'left' : 'center', whiteSpace: 'nowrap' }}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', fontWeight: i === rows.length - 1 ? '400' : '600' }}>
                <td style={{ padding: '7px 8px', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{r.label}</td>
                <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', color: 'var(--text-faint)' }}>{r.n != null ? r.n : '—'}</td>
                <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', color: r.barrel != null && r.barrel >= 10 ? 'var(--strong)' : '#fff' }}>{r.barrel != null ? `${num(r.barrel, 1)}%` : '—'}</td>
                <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', color: r.ev != null && r.ev >= 92 ? 'var(--strong)' : '#fff' }}>{r.ev != null ? `${num(r.ev, 1)}` : '—'}</td>
                <td style={{ padding: '7px 8px', textAlign: 'center', fontFamily: 'var(--mono)', color: r.hh != null && r.hh >= 40 ? 'var(--strong)' : r.hh != null ? '#fff' : 'var(--text-faint)' }}>{r.hh != null ? `${num(r.hh, 0)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Percentile section
// ---------------------------------------------------------------------------

const PCTILE_ROWS = [
  { k: 'hrRate',   label: 'HR/AB',      v: b => b.season?.ab >= 30 ? pct(b.season.hr / b.season.ab, 1) : null },
  { k: 'iso',      label: 'ISO',        v: b => rate(b.season?.iso ?? (b.season?.slg != null && b.season?.avg != null ? b.season.slg - b.season.avg : null)) },
  { k: 'xiso',     label: 'xISO',       v: b => rate(b.xStats?.xISO) },
  { k: 'barrel',   label: 'Barrel%',    v: b => (b.barrelPctBBE ?? b.barrelPct) != null ? `${num(b.barrelPctBBE ?? b.barrelPct, 1)}%` : null },
  { k: 'ev',       label: 'Exit velo',  v: b => b.exitVelo != null ? `${num(b.exitVelo, 1)} mph` : null },
  { k: 'hardHit',  label: 'Hard-hit%',  v: b => b.hardHitPct != null ? `${num(b.hardHitPct, 0)}%` : null },
]
const pctileColor = p => `hsl(${220 - 180 * (p / 100)} 75% 50%)`

function PercentileSection({ b }) {
  const rows = PCTILE_ROWS.map(r => {
    const mlbP = b.pctileMLB?.[r.k], slateP = b.pctile?.[r.k]
    const mlb = Number.isFinite(mlbP)
    return { ...r, p: mlb ? mlbP : slateP, slateP, basis: mlb ? 'MLB' : 'slate', val: r.v(b) }
  }).filter(r => r.p != null)
  if (!rows.length) return null
  return (
    <Section title="Percentile Rankings" icon="BarChart3">
      <div style={{ fontSize: '11px', color: 'var(--text-faint)', marginBottom: '14px' }}>Statcast power quality ranked vs <b>all MLB</b> (Savant); rate stats vs today's slate.</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {rows.map(r => (
          <div key={r.k} title={`${r.label}: ${r.p}th pct (${r.basis === 'MLB' ? 'vs all MLB' : "vs slate"})`} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px' }}>
            <span style={{ width: '68px', color: 'var(--text-dim)', fontWeight: '700', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{r.label}</span>
            <span style={{ flex: 1, height: '8px', background: 'var(--card-2)', borderRadius: '99px', position: 'relative', overflow: 'hidden' }}>
              <span style={{ width: `${r.p}%`, background: pctileColor(r.p), height: '100%', display: 'block', borderRadius: '99px' }} />
            </span>
            <span style={{ width: '52px', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1.15, fontFamily: 'var(--mono)' }}>
              <span><b style={{ fontWeight: '800', color: pctileColor(r.p) }}>{r.p}</b><span style={{ fontSize: '8px', color: 'var(--text-faint)', fontWeight: '700', marginLeft: '3px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{r.basis}</span></span>
              {r.basis === 'MLB' && Number.isFinite(r.slateP) && <span style={{ fontSize: '9px', color: 'var(--text-faint)' }}>{r.slateP} slate</span>}
            </span>
            <span style={{ width: '58px', textAlign: 'right', fontWeight: '700', color: '#fff', fontFamily: 'var(--mono)' }}>{r.val ?? '—'}</span>
          </div>
        ))}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Trends tab
// ---------------------------------------------------------------------------

function TodaysOutlook({ b }) {
  const level = useEliLevel()
  const items = reasonsForLevel(b, level)
  if (!items.length) return null
  const positives = items.filter(r => r.tone === 'good').length
  const negatives = items.filter(r => r.tone === 'bad').length
  const g = b.grade?.label || 'SKIP'
  const verdictColor = g === 'PRIME' ? 'var(--prime)' : g === 'STRONG' ? 'var(--strong)' : g === 'LEAN' ? '#8b8bff' : 'var(--bad)'
  const verdictLabel = g === 'PRIME' ? 'Prime Play' : g === 'STRONG' ? 'Strong' : g === 'LEAN' ? 'Lean' : 'Skip'
  return (
    <Section title="Today's Outlook" icon="Sparkles">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: verdictColor, display: 'inline-block', boxShadow: `0 0 8px ${verdictColor}` }} />
          <span style={{ fontSize: '18px', fontWeight: '800', color: verdictColor }}>{verdictLabel}</span>
        </div>
        <div style={{ fontSize: '12px' }}>
          <span style={{ color: 'var(--strong)', fontWeight: '600' }}>{positives} positive</span>
          {negatives > 0 && <> · <span style={{ color: 'var(--bad)', fontWeight: '600' }}>{negatives} negative</span></>}
        </div>
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '7px' }}>
        {items.map((r, i) => (
          <li key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '8px', background: r.tone === 'good' ? 'rgba(105,185,158,0.05)' : r.tone === 'bad' ? 'rgba(239,68,68,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${r.tone === 'good' ? 'rgba(105,185,158,0.15)' : r.tone === 'bad' ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.04)'}` }}>
            <Icon name={r.tone === 'good' ? 'CheckCircle2' : r.tone === 'bad' ? 'AlertTriangle' : 'Minus'} size={14} style={{ color: r.tone === 'good' ? 'var(--strong)' : r.tone === 'bad' ? 'var(--prime)' : 'var(--text-faint)', marginTop: '1px', flexShrink: 0 }} />
            <span style={{ fontSize: '12px', color: r.tone === 'good' ? 'var(--text)' : 'var(--text-dim)', lineHeight: '1.45' }}>{r.text}</span>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function DueIndicatorSection({ b }) {
  const { checks, n } = hrSetup(b)
  const total = checks.length
  if (!total) return null
  const heat = b.heatIndex != null ? b.heatIndex : heatBreakdown(b).total
  const dueLabel = n >= 5 ? 'Hot' : n >= 3 ? 'Warm' : 'Cool'
  const dueColor = n >= 5 ? 'var(--strong)' : n >= 3 ? 'var(--prime)' : 'var(--text-faint)'
  return (
    <Section title="HR Due Indicator" icon="Target">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '14px', paddingBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <span style={{ fontSize: '26px', fontWeight: '800', fontFamily: 'var(--mono)', color: dueColor, lineHeight: 1 }}>{n}</span>
        <span style={{ fontSize: '13px', color: 'var(--text-faint)' }}>/ {total}</span>
        <span style={{ fontSize: '12px', fontWeight: '700', color: dueColor, background: n >= 5 ? 'rgba(105,185,158,0.08)' : n >= 3 ? 'rgba(214,181,111,0.08)' : 'rgba(255,255,255,0.04)', padding: '2px 10px', borderRadius: '6px', marginLeft: '6px' }}>{dueLabel}</span>
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--text-faint)' }}>heat {heat}/100</span>
      </div>
      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {checks.map(c => (
          <li key={c.label} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px 12px', borderRadius: '8px', background: c.pass ? 'rgba(105,185,158,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${c.pass ? 'rgba(105,185,158,0.12)' : 'rgba(255,255,255,0.04)'}` }}>
            <Icon name={c.pass ? 'Check' : 'X'} size={13} style={{ color: c.pass ? 'var(--strong)' : 'var(--text-faint)', marginTop: '1px', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '12px', fontWeight: c.pass ? '600' : '400', color: c.pass ? '#fff' : 'var(--text-faint)' }}>{c.label}</div>
              <div style={{ fontSize: '10px', color: 'var(--text-faint)', marginTop: '2px' }}>{c.detail}</div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Park & weather (Overview)
// ---------------------------------------------------------------------------

function WindDial({ deg, speed }) {
  const rot = (deg ?? 0) + 180
  return (
    <div title={`Wind from ${compass(deg) || '—'} (${deg ?? '—'}°)`} style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '50%', padding: '4px', width: '64px', height: '64px', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
      <svg viewBox="0 0 64 64" width="56" height="56">
        <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1.5" />
        <text x="32" y="11" fill="var(--text-faint)" fontSize="8" fontWeight="800" textAnchor="middle">N</text>
        {deg != null && <g transform={`rotate(${rot} 32 32)`}><path d="M32 14 L37 32 L32 28 L27 32 Z" fill="var(--accent)" style={{ filter: 'drop-shadow(0 0 4px var(--accent))' }} /></g>}
        <text x="32" y="34" fill="#fff" fontSize="12" fontWeight="800" textAnchor="middle" dominantBaseline="central">{speed != null ? Math.round(speed) : '—'}</text>
        <text x="32" y="46" fill="var(--text-faint)" fontSize="6" fontWeight="700" textAnchor="middle">mph</text>
      </svg>
    </div>
  )
}

function Wx({ icon, k, v, sub }) {
  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '8px 10px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.04)' }}>
      <Icon name={icon} size={14} style={{ color: 'var(--accent)' }} />
      <div>
        <div style={{ fontSize: '9px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k}</div>
        <div style={{ fontSize: '12px', fontWeight: '700', color: '#fff', fontFamily: 'var(--mono)' }}>{v}{sub ? <span style={{ fontSize: '10px', color: 'var(--text-dim)' }}> · {sub}</span> : null}</div>
      </div>
    </div>
  )
}

function EnvSection({ b }) {
  const w = b.weather
  const hasFactors = [b.gameParkHRFactor, b.parkWeatherHandFactor].some(v => v != null)
  if (!w && !hasFactors) return null
  const sky = skyLabel(w)
  const wind = interpretWind(w, b.game?.homeTeam?.abbr, { roofClosed: w?.roofClosed })
  return (
    <Section title="Park & weather" icon="Wind" id="sec-env">
      {wind && (
        <div style={{ color: wind.tint, display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: '700', background: hexA(wind.tint, 0.08), padding: '8px 12px', borderRadius: '8px', border: `1px solid ${hexA(wind.tint, 0.25)}`, marginBottom: '12px' }}>
          <Icon name="Wind" size={13} /><b>{wind.verdict}</b><span>{wind.caption}</span>
        </div>
      )}
      {w && (
        <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '12px' }}>
          <WindDial deg={w.windDirDeg} speed={w.windSpeedMph} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', flex: 1 }}>
            <Wx icon="Thermometer" k="Temp" v={w.tempF != null ? `${Math.round(w.tempF)}°F` : '—'} />
            <Wx icon="Wind" k="Wind" v={w.windSpeedMph != null ? `${Math.round(w.windSpeedMph)} ${compass(w.windDirDeg) || ''}` : '—'} sub={Number.isFinite(w.windGustMph) && w.windGustMph <= 90 && w.windGustMph >= (w.windSpeedMph || 0) ? `G${Math.round(w.windGustMph)}` : null} />
            <Wx icon="Droplet" k="Humidity" v={w.humidity != null ? `${w.humidity}%` : '—'} />
            <Wx icon="Cloud" k="Precip" v={w.precipProbPct != null ? `${w.precipProbPct}%` : '—'} />
          </div>
        </div>
      )}
      {sky && <div style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-dim)', background: 'rgba(255,255,255,0.02)', padding: '6px 10px', borderRadius: '6px', marginBottom: '12px' }}><Icon name={w?.roofClosed ? 'House' : 'Cloud'} size={12} style={{ color: 'var(--accent)' }} /> <span>{sky}{w?.source ? ` (${w.source.toUpperCase()})` : ''}</span></div>}
      {hasFactors && (
        <div className="stat-grid" style={{ marginTop: w ? 12 : 0 }}>
          <Cell k="Park HR factor" v={b.gameParkHRFactor != null ? `${num(b.gameParkHRFactor, 3)}×` : '—'} title="Park-only HR multiplier (1.00 = average)" />
          <Cell k="Air factor" v={b.parkWeatherHandFactor != null ? `${num(b.parkWeatherHandFactor, 3)}×` : '—'} title="Combined conditions factor" />
          {b.parkWeatherHandFactor != null && <Cell k="Air vs neutral" v={signedPct(b.parkWeatherHandFactor - 1, 1)} title="Condition change vs standard" />}
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Odds section
// ---------------------------------------------------------------------------

function OddsSection({ b }) {
  const o = b.odds
  if (!o?.books?.length) return null
  return (
    <Section title="Market odds" icon="Percent">
      <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', overflow: 'hidden', marginBottom: '8px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 30px', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', fontSize: '10px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
          {['Book','Price','Implied','Edge',''].map((h, i) => <span key={i}>{h}</span>)}
        </div>
        {o.books.slice().sort((a, b2) => (b2.edge ?? -9) - (a.edge ?? -9)).map(row => (
          <div key={row.book} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr 30px', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '12px', alignItems: 'center' }}>
            <span style={{ color: '#fff', fontWeight: '600' }}>{bookLabel(row.book)}</span>
            <span style={{ fontFamily: 'var(--mono)' }}>{american(row.american ?? decimalToAmerican(row.decimal))}</span>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{pct(row.implied, 1)}</span>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: '700', color: row.edge >= 0 ? 'var(--strong)' : 'var(--bad)' }}>{signedPct(row.edge, 1)}</span>
            <span style={{ display: 'grid', placeItems: 'center' }}>{row.link ? <a href={row.link} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}><Icon name="ExternalLink" size={12} /></a> : null}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-faint)' }}>Model {pct(b.hrProbability, 2)} vs market avg {pct(o.marketImplied, 2)} · positive edge = value play</div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// LiveSection / TechReasons
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ExplainPick — one-tap plain-English "why this pick", narrated by Claude Haiku
// from the model's already-computed reason lines. Lazy (fires only on tap),
// cached per player/day, and read-only: it explains the score, never changes
// it. Silently absent when the worker URL isn't configured or there are no
// reason lines to narrate.
// ---------------------------------------------------------------------------

function ExplainPick({ b }) {
  const { status, text, run, available } = useExplain(b)
  if (!available) return null

  return (
    <Section title="Explain this pick" icon="Sparkles">
      {status === 'done' && (
        <p style={{ fontSize: '13px', lineHeight: '1.5', color: 'var(--text)', margin: 0 }}>{text}</p>
      )}
      {status !== 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '8px' }}>
          <button
            onClick={run}
            disabled={status === 'loading'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '7px',
              background: 'rgba(151,149,203,0.08)', border: '1px solid rgba(151,149,203,0.25)',
              color: 'var(--accent)', padding: '8px 14px', borderRadius: '9px',
              fontSize: '13px', fontWeight: '700', cursor: status === 'loading' ? 'default' : 'pointer',
              opacity: status === 'loading' ? 0.7 : 1,
            }}
          >
            <Icon name={status === 'loading' ? 'Loader' : 'Sparkles'} size={14}
              style={status === 'loading' ? { animation: 'spin 1s linear infinite' } : undefined} />
            {status === 'loading' ? 'Thinking…' : 'Explain this pick'}
          </button>
          {status === 'error' && (
            <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
              Couldn't reach the explainer — tap to retry.
            </span>
          )}
          {status === 'idle' && (
            <span style={{ fontSize: '11px', color: 'var(--text-faint)' }}>
              Plain-English summary of why the model rates {b.name.split(' ').slice(-1)[0]} this way.
            </span>
          )}
        </div>
      )}
    </Section>
  )
}

function TechReasons({ b }) {
  const [open, setOpen] = useState(false)
  if (!b.reasons?.length) return null
  return (
    <section style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '12px', padding: '12px 16px', marginBottom: '16px' }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><Icon name="ListFilter" size={14} style={{ color: 'var(--accent)' }} /> Model details</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} />
      </button>
      {open && (
        <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '12px' }}>
          {b.reasons.map((r, i) => (
            <li key={i} style={{ display: 'flex', gap: '6px', fontSize: '11px', color: 'var(--text-dim)', lineHeight: '1.4' }}>
              <Icon name="ChevronRight" size={10} style={{ color: 'var(--accent)', marginTop: '2px', flexShrink: 0 }} />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Split chips (used inside HrFormSection)
// ---------------------------------------------------------------------------

function SplitRow({ label, left, right }) {
  const lv = left.iso, rv = right.iso
  const betterLeft = (lv ?? -1) >= (rv ?? -1)
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '12px' }}>
      <span style={{ flex: 1, color: 'var(--text-faint)', fontSize: '11px' }}>{label}</span>
      <span style={{ width: '90px', textAlign: 'right', color: betterLeft && lv != null ? 'var(--strong)' : 'var(--text-dim)', fontWeight: betterLeft && lv != null ? '700' : '400', display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
        {left.name}{left.tonight && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent)' }} />}
        <b style={{ fontFamily: 'var(--mono)', marginLeft: '4px' }}>{lv != null ? rate(lv) : '—'}</b>
      </span>
      <span style={{ width: '90px', textAlign: 'right', color: !betterLeft && rv != null ? 'var(--strong)' : 'var(--text-dim)', fontWeight: !betterLeft && rv != null ? '700' : '400', display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: '4px' }}>
        {right.name}{right.tonight && <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: 'var(--accent)' }} />}
        <b style={{ fontFamily: 'var(--mono)', marginLeft: '4px' }}>{rv != null ? rate(rv) : '—'}</b>
      </span>
    </div>
  )
}

function SplitChips({ b }) {
  const ha = b.homeAwaySplits, dn = b.dayNightSplits
  if (!ha && !dn) return null
  return (
    <div style={{ borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '10px', marginTop: '10px' }}>
      {ha && (ha.homeISO != null || ha.awayISO != null) && <SplitRow label="ISO · home / away" left={{ name: 'Home', iso: ha.homeISO, tonight: b.isHome === true }} right={{ name: 'Away', iso: ha.awayISO, tonight: b.isHome === false }} />}
      {dn && (dn.dayISO != null || dn.nightISO != null) && <SplitRow label="ISO · day / night" left={{ name: 'Day', iso: dn.dayISO }} right={{ name: 'Night', iso: dn.nightISO }} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Utility components
// ---------------------------------------------------------------------------

function Section({ title, icon, children, id, className = '' }) {
  return (
    <section id={id} className={`drawer-section-card${className ? ` ${className}` : ''}`} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '12px', padding: '16px', marginBottom: '16px' }}>
      <h3 style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '8px' }}>
        <Icon name={icon} size={14} style={{ color: 'var(--accent)' }} /> {title}
      </h3>
      {children}
    </section>
  )
}

function Cell({ k, v, unit, tone, title }) {
  return (
    <div className="cell" title={title} style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '8px', padding: '8px 12px', textAlign: 'center' }}>
      <div style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '2px' }}>{k}</div>
      <div style={{ fontSize: '14px', fontWeight: '700', fontFamily: 'var(--mono)', color: tone ? toneColor(tone) : '#fff' }}>
        {v}{unit ? <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: '400' }}> {unit}</span> : null}
      </div>
    </div>
  )
}

function Mini({ k, v }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: 'var(--text-dim)' }}>
      {k && <span style={{ color: 'var(--text-faint)' }}>{k}:</span>}
      <span style={{ fontWeight: '700', fontFamily: 'var(--mono)' }}>{v}</span>
    </span>
  )
}
