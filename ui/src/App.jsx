import { useEffect, useMemo, useState, useCallback, useRef, useLayoutEffect } from 'react'
import { loadSlate, forceSlateRefresh, normName } from './lib/data.js'
import { GRADE_ORDER, BADGES } from './lib/badges.js'
import { HOT_HEAT, DESC_BY_DEFAULT, DEFAULT_FILTERS, SORTS } from './lib/constants.js'
import { risingForm, precisionSignal, sleeperSignal } from './lib/groups.js'
import * as store from './lib/storage.js'
import { buzz } from './lib/haptics.js'
import { LiveModeContext } from './lib/liveMode.js'
import { EliLevelContext, nextEliLevel } from './lib/eliLevel.js'
import Header from './components/Header.jsx'
import Filters from './components/Filters.jsx'
import BatterTable from './components/BatterTable.jsx'
import GamesView from './components/GamesView.jsx'
import PitchersView, { PitcherCard } from './components/PitchersView.jsx'
import { groupPitchers } from './lib/pitchers.js'
import WeatherView from './components/WeatherView.jsx'
import GroupsView from './components/GroupsView.jsx'
import SameGameView from './components/SameGameView.jsx'
import CheatSheet from './components/CheatSheet.jsx'
import BacktestView from './components/BacktestView.jsx'
import ResultsView from './components/ResultsView.jsx'
import PlayerDrawer from './components/PlayerDrawer.jsx'
import ZoneView from './components/ZoneView.jsx'
import ParlaySlip from './components/ParlaySlip.jsx'
import ParlayBuilder from './components/ParlayBuilder.jsx'
import Legend from './components/Legend.jsx'
import Guide from './components/Guide.jsx'
import HowToPick from './components/HowToPick.jsx'
import Settings from './components/Settings.jsx'
import DayRating from './components/DayRating.jsx'
import Skeleton from './components/Skeleton.jsx'
import BackToTop from './components/BackToTop.jsx'
import PullToRefresh from './components/PullToRefresh.jsx'
import PickOfDay from './components/PickOfDay.jsx'
import UpdateBanner from './components/UpdateBanner.jsx'
import ListBuilderView from './components/ListBuilderView.jsx'
import ToastStack, { toast } from './components/Toast.jsx'
import InstallPrompt from './components/InstallPrompt.jsx'
import Confetti from './components/Confetti.jsx'
import Icon from './components/Icon.jsx'
import './app.css'

const AUTO_REFRESH_MS    = 60_000
const LIVE_REFRESH_MS    = 30_000  // faster cadence while a game is actually live
const SLATE_REFRESH_MS   = 3 * 60_000 // always-on background poll — pipeline runs every 10 min

// Each view is its own page via a URL hash (#board, #pitchers, …) — bookmarkable
// and back/forward navigable. Hash routing works as-is on static hosting.
const VIEWS = new Set(['board', 'games', 'pitchers', 'weather', 'combos', 'results'])
const viewFromHash = () => {
  const h = (typeof location !== 'undefined' ? location.hash : '').replace(/^#\/?/, '')
  return VIEWS.has(h) ? h : null
}

// Restore the durable slice of the filter state (not search / game / badge).
function initialFilters() {
  const saved = store.load('filters', null)
  if (!saved) return DEFAULT_FILTERS
  return {
    ...DEFAULT_FILTERS,
    grades: new Set(Array.isArray(saved.grades) ? saved.grades : GRADE_ORDER),
    // Validate against current sort options (a persisted, since-removed key like
    // 'edge' would leave the dropdown blank and silently break sorting).
    sort: SORTS.some((s) => s.key === saved.sort) ? saved.sort : DEFAULT_FILTERS.sort,
    dir: saved.dir || DEFAULT_FILTERS.dir,
    confirmedOnly: !!saved.confirmedOnly,
    watchedOnly: !!saved.watchedOnly,
    hotOnly: !!saved.hotOnly,
    precisionOnly: !!saved.precisionOnly,
    sleepersOnly: !!saved.sleepersOnly,
  }
}

export default function App() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [refreshing, setRefreshing] = useState(false)
  const [slateBuilding, setSlateBuilding] = useState(false)
  const [filters, setFilters] = useState(initialFilters)
  const [selectedId, setSelectedId] = useState(null)
  const [zoneId, setZoneId] = useState(null)
  // Opposing-pitcher card shown as a popup overlay (entry key: `${pitcherId}-${gamePk}`).
  const [pitcherKey, setPitcherKey] = useState(null)
  const [showLegend, setShowLegend] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [showHowTo, setShowHowTo] = useState(false)
  const [showGroups, setShowGroups] = useState(false)
  const [showSGP, setShowSGP] = useState(false)
  const [showBuilder, setShowBuilder] = useState(false)
  const [showSplits, setShowSplits] = useState(false)
  const [showBacktest, setShowBacktest] = useState(false)
  const [showListBuilder, setShowListBuilder] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  // Default ON: same-window grouping is the default combos view — those are the
  // combos you can actually bet as one ticket (every leg's lineup confirms before
  // the earliest locks). The full board is an idealized benchmark (it grades each
  // leg at its own confirmed pregame state, a ticket that never existed at one
  // bettable moment), so it's opt-in. Toggle in Settings.
  const [windowMode, setWindowMode] = useState(() => store.load('windowMode', true))
  const [showDayRating, setShowDayRating] = useState(() => store.load('showDayRating', true))
  const [comboConf, setComboConf] = useState(() => store.load('comboConf', 'off')) // 'off' | 'stars' | 'percent'
  const [favorConsistency, setFavorConsistency] = useState(() => store.load('favorConsistency', false))
  const [splitProjected, setSplitProjected] = useState(() => store.load('splitProjected', false))
  const [watchlist, setWatchlist] = useState(() => new Set(store.load('watchlist', [])))
  const [slipIds, setSlipIds] = useState(() => store.load('slip', []))
  const [autoRefresh, setAutoRefresh] = useState(() => store.load('autoRefresh', false))
  const [view, setView] = useState(() => viewFromHash() || store.load('view', 'board'))
  const [liveScores, setLiveScores] = useState(() => store.load('liveScores', true))
  const [eliLevel, setEliLevel] = useState(() => store.load('eliLevel', 'eli5')) // 'eli5' | 'eli15'
  // Dismissed Pick of the Day, keyed by batter id (which embeds the gamePk, so
  // it's inherently scoped to that day). Persisted, so a dismiss survives reloads
  // — but a new day's (or changed) pick has a new id and shows again.
  const [podDismissedId, setPodDismissedId] = useState(() => store.load('podDismissed', null))
  const topbarRef = useRef(null)

  // Persist the durable bits.
  useEffect(() => {
    store.save('filters', {
      grades: [...filters.grades],
      sort: filters.sort,
      dir: filters.dir,
      confirmedOnly: filters.confirmedOnly,
      watchedOnly: filters.watchedOnly,
      hotOnly: filters.hotOnly,
      precisionOnly: filters.precisionOnly,
      sleepersOnly: filters.sleepersOnly,
    })
  }, [filters])
  useEffect(() => store.save('watchlist', [...watchlist]), [watchlist])
  useEffect(() => store.save('slip', slipIds), [slipIds])
  useEffect(() => store.save('autoRefresh', autoRefresh), [autoRefresh])
  useEffect(() => store.save('windowMode', windowMode), [windowMode])
  useEffect(() => store.save('showDayRating', showDayRating), [showDayRating])
  useEffect(() => store.save('comboConf', comboConf), [comboConf])
  useEffect(() => store.save('favorConsistency', favorConsistency), [favorConsistency])
  useEffect(() => store.save('splitProjected', splitProjected), [splitProjected])
  useEffect(() => store.save('eliLevel', eliLevel), [eliLevel])
  useEffect(() => store.save('podDismissed', podDismissedId), [podDismissedId])
  useEffect(() => {
    store.save('view', view)
    if (viewFromHash() !== view) location.hash = view // reflect the view in the URL
  }, [view])
  // Back/forward or a pasted #view URL drives the view.
  useEffect(() => {
    const onHash = () => {
      const v = viewFromHash()
      if (v) setView(v)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => store.save('liveScores', liveScores), [liveScores])

  // Publish the sticky chrome height so the board column-header can stick right
  // below it — robust to the filter bar wrapping at any width.
  useLayoutEffect(() => {
    const el = topbarRef.current
    if (!el) return
    const apply = () => document.documentElement.style.setProperty('--chrome-h', `${el.offsetHeight}px`)
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [state.status])

  const load = useCallback(async () => {
    setRefreshing(true)
    setState((s) => ({ ...s, status: s.data ? 'ready' : 'loading' }))
    try {
      const data = await loadSlate()
      setState({ status: 'ready', data, error: null })
    } catch (e) {
      setState((s) => (s.data ? s : { status: 'error', data: null, error: e.message }))
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Force-refresh: ask the local server to re-run fetch-slate.mjs, wait for it,
  // then reload the new JSON. On static hosts (GitHub Pages) falls back to load().
  const forceRefresh = useCallback(async () => {
    if (refreshing || slateBuilding) return
    setSlateBuilding(true)
    try {
      await forceSlateRefresh()
    } finally {
      setSlateBuilding(false)
    }
    await load()
    toast.success('Slate refreshed')
  }, [refreshing, slateBuilding, load])

  useEffect(() => {
    load()
  }, [load])

  // Live game state (scores, innings, "homered" tags) lives in daily.json, so it
  // only changes when we re-fetch. Detect what's in progress to drive polling.
  const livePhase = useMemo(() => {
    const games = state.data?.games || []
    return {
      anyLive: games.some((g) => g.isLive),
      anyPending: games.some((g) => !g.isFinal), // scheduled or live
    }
  }, [state.data])

  // Auto-refresh — soft reload on an interval (no loader flicker; filters,
  // selection, watchlist and slip all survive because they live in state by id).
  // Two triggers: the explicit auto-refresh toggle, OR Live mode while games are
  // still going — otherwise "Live on" would freeze on the last load, which is
  // exactly what users hit. Poll faster once a game is actually live.
  useEffect(() => {
    const livePolling = liveScores && livePhase.anyPending
    if (!autoRefresh && !livePolling) return
    const ms = livePhase.anyLive ? LIVE_REFRESH_MS : AUTO_REFRESH_MS
    const t = setInterval(load, ms)
    return () => clearInterval(t)
  }, [autoRefresh, liveScores, livePhase.anyLive, livePhase.anyPending, load])

  // Silent background poll — always fires every 3 min regardless of toggles.
  // Only swaps in fresh data when generatedAt actually changed, so there's no
  // flicker or loading spinner for a 19-minute session with a stale slate.
  useEffect(() => {
    const poll = async () => {
      try {
        const fresh = await loadSlate()
        setState((s) => {
          if (!s.data || fresh.meta?.generatedAt !== s.data.meta?.generatedAt) {
            const n = fresh.batters?.length
            toast.success(`Slate updated${n ? ` · ${n} players` : ''}`)
            return { status: 'ready', data: fresh, error: null }
          }
          return s
        })
      } catch { /* fail soft — active session keeps current data */ }
    }
    const t = setInterval(poll, SLATE_REFRESH_MS)
    return () => clearInterval(t)
  }, [])

  // Connectivity toasts — the SW keeps serving the last cached slate offline,
  // so tell the user what they're looking at.
  useEffect(() => {
    const onOffline = () => toast.warn('Offline — showing last saved slate', 4000)
    const onOnline = () => { toast.success('Back online'); load() }
    window.addEventListener('offline', onOffline)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('offline', onOffline)
      window.removeEventListener('online', onOnline)
    }
  }, [load])

  // Esc closes the topmost overlay; '/' focuses search; 1-4 switch views.
  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA'].includes(e.target.tagName)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        const input = document.querySelector('.search input')
        if (input) { input.focus(); input.select() }
        return
      }
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && ['1', '2', '3', '4', '5'].includes(e.key)) {
        setView(['board', 'games', 'pitchers', 'weather', 'results'][+e.key - 1]) // matches the view-toggle tab order
        return
      }
      if (e.key === 'Escape') {
        if (pitcherKey) setPitcherKey(null)
        else if (zoneId) setZoneId(null)
        else if (selectedId) setSelectedId(null) // drawer stacks above the modals — close it first
        else if (showBacktest) setShowBacktest(false)
        else if (showListBuilder) setShowListBuilder(false)
        else if (showSplits) setShowSplits(false)
        else if (showBuilder) setShowBuilder(false)
        else if (showGroups) setShowGroups(false)
        else if (showSGP) setShowSGP(false)
        else if (showHowTo) setShowHowTo(false)
        else if (showGuide) setShowGuide(false)
        else if (showLegend) setShowLegend(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, showLegend, showGuide, showHowTo, zoneId, showGroups, showSGP, showBuilder, showSplits, showBacktest, showListBuilder, pitcherKey])

  const patch = useCallback((p) => setFilters((f) => ({ ...f, ...p })), [])

  // Empty-state escape hatch: back to defaults but keep the user's sort.
  const clearFilters = useCallback(() => {
    setFilters((f) => ({ ...DEFAULT_FILTERS, grades: new Set(GRADE_ORDER), gamePks: new Set(), sort: f.sort, dir: f.dir }))
  }, [])

  // Pop up the opposing pitcher's card as an overlay (entry key matches
  // groupPitchers: `${pitcherId}-${gamePk}`). Stays in place — no view change.
  const openPitcher = useCallback((pitcherId, gamePk) => {
    if (pitcherId == null) return
    setPitcherKey(`${pitcherId}-${gamePk}`)
  }, [])

  // Resolve the popup's pitcher entry from the full slate (grouped the same way
  // the Pitchers page does, so the key lines up).
  const pitcherEntry = useMemo(() => {
    if (!pitcherKey) return null
    return groupPitchers(state.data?.batters || []).find((e) => e.key === pitcherKey) || null
  }, [pitcherKey, state.data])

  const onSort = useCallback((key) => {
    setFilters((f) => {
      if (f.sort === key) return { ...f, dir: f.dir === 'asc' ? 'desc' : 'asc' }
      return { ...f, sort: key, dir: DESC_BY_DEFAULT.has(key) ? 'desc' : 'asc' }
    })
  }, [])

  const toggleWatch = useCallback((b) => {
    buzz()
    setWatchlist((prev) => {
      const next = new Set(prev)
      const adding = !next.has(b.id)
      adding ? next.add(b.id) : next.delete(b.id)
      toast.info(adding ? `⭐ Watching ${b.name}` : `Removed ${b.name} from watchlist`)
      return next
    })
  }, [])

  const toggleSlip = useCallback((b) => {
    buzz()
    setSlipIds((prev) => {
      const adding = !prev.includes(b.id)
      toast.success(adding ? `➕ ${b.name} added to parlay` : `Removed ${b.name} from parlay`)
      return adding ? [...prev, b.id] : prev.filter((x) => x !== b.id)
    })
  }, [])

  const removeSlip = useCallback((id) => setSlipIds((prev) => prev.filter((x) => x !== id)), [])
  const clearSlip = useCallback(() => setSlipIds([]), [])
  // Replace the whole slip (auto-build / load a saved slip) — dedupes + ignores blanks.
  const replaceSlip = useCallback((ids) => setSlipIds([...new Set((ids || []).filter((x) => x != null))]), [])

  // Attach the RISING signal (recent L14 barrel surging above season) as a real
  // boolean flag so every consumer — board badges, filters, counts, backtest —
  // reads it the same way as the engine's server-side flags.
  const all = useMemo(
    () => (state.data?.batters || []).map((b) => {
      let b2 = risingForm(b) ? { ...b, rising: true } : b
      if (precisionSignal(b2)) b2 = { ...b2, precision: true }
      if (sleeperSignal(b2)) b2 = { ...b2, sleeper: true }
      return b2
    }),
    [state.data],
  )
  const slipSet = useMemo(() => new Set(slipIds), [slipIds])

  // Live HR alerts — when a refresh brings a new "homered this game" flag,
  // announce it. Slip legs celebrate loudest, then watchlist, then everyone.
  // First load seeds silently so we never announce HRs that already happened.
  const prevHRs = useRef(null)
  useEffect(() => {
    if (!all.length) return
    const current = new Set(all.filter((b) => b.liveContext?.isHRThisGame).map((b) => b.id))
    const prev = prevHRs.current
    prevHRs.current = current
    if (!prev) return
    const fresh = all.filter((b) => current.has(b.id) && !prev.has(b.id))
    for (const b of fresh.slice(0, 4)) {
      if (slipSet.has(b.id)) { toast.success(`💰 PARLAY LEG HIT — ${b.name} HOMERED!`, 7000); buzz(60) }
      else if (watchlist.has(b.id)) { toast.success(`⭐💥 ${b.name} just homered!`, 6000); buzz(30) }
      else toast.info(`💥 ${b.name} homered`, 4000)
    }
  }, [all, slipSet, watchlist])

  // Resolve slip ids → batter objects in slip order; drop any not in this slate.
  const slipLegs = useMemo(() => {
    const byId = new Map(all.map((b) => [b.id, b]))
    return slipIds.map((id) => byId.get(id)).filter(Boolean)
  }, [all, slipIds])

  // The big one: every slip leg has homered → confetti. Fires once per unique
  // slip (keyed by leg ids), so editing the slip re-arms it but a re-render
  // or poll can't replay the same celebration. NOTE: must stay BELOW the
  // slipLegs declaration — referencing the const earlier is a TDZ crash.
  const [celebrate, setCelebrate] = useState(false)
  const cashedKeyRef = useRef(null)
  useEffect(() => {
    if (slipLegs.length < 2) return
    if (!slipLegs.every((b) => b.liveContext?.isHRThisGame)) return
    const key = slipLegs.map((b) => b.id).sort().join(',')
    if (cashedKeyRef.current === key) return
    cashedKeyRef.current = key
    setCelebrate(true)
    toast.success(`🎉 PARLAY CASHED — all ${slipLegs.length} legs homered!`, 9000)
    buzz(120)
  }, [slipLegs])

  const gradeCounts = useMemo(() => {
    const c = {}
    for (const b of all) {
      const g = b.grade?.label || 'SKIP'
      c[g] = (c[g] || 0) + 1
    }
    return c
  }, [all])

  const badgeCounts = useMemo(() => {
    const c = {}
    for (const b of all) for (const def of BADGES) if (b[def.key]) c[def.key] = (c[def.key] || 0) + 1
    return c
  }, [all])

  const filtered = useMemo(() => {
    const q = normName(filters.q)
    let rows = all.filter((b) => {
      if (!filters.grades.has(b.grade?.label || 'SKIP')) return false
      if (filters.gamePks.size && !filters.gamePks.has(String(b.gamePk))) return false
      if (filters.confirmedOnly && !b.lineupConfirmed) return false
      if (filters.watchedOnly && !watchlist.has(b.id)) return false
      if (filters.hotOnly && (b.heatIndex ?? 0) < HOT_HEAT) return false
      if (filters.precisionOnly && !b.precision) return false
      if (filters.sleepersOnly && !b.sleeper) return false
      // Signals are multi-select (AND): a batter must carry EVERY chosen signal.
      if (filters.badges.size && ![...filters.badges].every((k) => b[k])) return false
      if (q) {
        const hay = normName(`${b.name} ${b.team} ${b.opponent?.abbr || ''} ${b.pitcher?.name || ''}`)
        if (!hay.includes(q)) return false
      }
      return true
    })

    const { sort, dir } = filters
    const mul = dir === 'asc' ? 1 : -1
    const get = (b) => {
      if (sort === 'zone') return b.zoneMatchup?.zoneRating ?? null
      if (sort === 'edge') return b.edge
      if (sort === 'heat') return b.heatIndex
      if (sort === 'air') return b.parkWeatherHandFactor ?? null
      return b[sort]
    }
    // Deterministic, meaningful tie-break: many picks share a probability at the
    // flat ends of the calibration curve, so fall back to score → xHR → name.
    const tiebreak = (a, b) =>
      (b.score ?? 0) - (a.score ?? 0) ||
      (b.expectedHRs ?? 0) - (a.expectedHRs ?? 0) ||
      (a.name || '').localeCompare(b.name || '')
    rows = rows.slice().sort((a, b) => {
      // When the lineup split is on, confirmed lineups always rank above
      // projected (roster-fallback) bats, independent of the chosen sort — a
      // late lineup post can't let a projected bat leapfrog a confirmed play,
      // so the pre-lineup churn stays in the projected group below the divider.
      // Toggleable in Settings; off = one flat board ranked purely by the sort.
      if (splitProjected) {
        const ca = a.lineupConfirmed ? 0 : 1
        const cb = b.lineupConfirmed ? 0 : 1
        if (ca !== cb) return ca - cb
      }
      const va = get(a)
      const vb = get(b)
      // nulls always last
      const na = va == null || Number.isNaN(va)
      const nb = vb == null || Number.isNaN(vb)
      if (na && nb) return tiebreak(a, b)
      if (na) return 1
      if (nb) return -1
      const cmp = typeof va === 'string' ? va.localeCompare(vb) * mul : (va - vb) * mul
      return cmp !== 0 ? cmp : tiebreak(a, b)
    })
    return rows
  }, [all, filters, watchlist, splitProjected])

  const selected = useMemo(
    () => (selectedId != null ? all.find((b) => b.id === selectedId) || null : null),
    [all, selectedId],
  )
  const zoneBatter = useMemo(
    () => (zoneId != null ? all.find((b) => b.id === zoneId) || null : null),
    [all, zoneId],
  )

  // Pick of the Day: the model's single best HR play with the lineup set.
  // Lead with MODEL SCORE, not HR probability — probability saturates at a
  // ceiling (~26.5%), so the top tier ties on it and the pick flickers on every
  // 10-min rebuild. Score has real resolution. Prefer confirmed-lineup bats, and
  // finish with a deterministic tie-break (xHR → stable id) so the pick only
  // changes when the numbers actually move, never on iteration-order noise.
  const pick = useMemo(() => {
    const pool = all.filter((b) => (b.grade?.label || 'SKIP') !== 'SKIP')
    if (!pool.length) return null
    const confirmed = pool.filter((b) => b.lineupConfirmed)
    const base = confirmed.length ? confirmed : pool
    return base.slice().sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        (b.hrProbability ?? 0) - (a.hrProbability ?? 0) ||
        (b.expectedHRs ?? 0) - (a.expectedHRs ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    )[0]
  }, [all])

  if (state.status === 'loading') {
    return <Skeleton />
  }

  if (state.status === 'error') {
    return (
      <div className="screen-center">
        <div className="error-box">
          <Icon name="TriangleAlert" size={28} />
          <h2>Couldn't load the slate</h2>
          <p className="dim">{state.error}</p>
          <button className="toggle-btn on" onClick={load}>
            <Icon name="RefreshCw" size={14} /> Retry
          </button>
        </div>
      </div>
    )
  }

  const { data } = state

  return (
    <LiveModeContext.Provider value={liveScores}>
    <EliLevelContext.Provider value={eliLevel}>
    <>
    <div className="app">
      <div className="topbar" ref={topbarRef}>
        <Header
          meta={data.meta}
          counts={{
            games: data.games.length,
            total: all.length,
            shown: filtered.length,
          }}
          onRefresh={forceRefresh}
          onOpenModel={() => setView('results')}
          onOpenLegend={() => setShowLegend(true)}
          autoRefresh={autoRefresh}
          onToggleAuto={() => setAutoRefresh((v) => !v)}
          liveScores={liveScores}
          onToggleLive={() => setLiveScores((v) => !v)}
          eliLevel={eliLevel}
          onCycleEli={() => setEliLevel((v) => nextEliLevel(v))}
          refreshing={refreshing || slateBuilding}
          slateBuilding={slateBuilding}
          gradeCounts={gradeCounts}
          total={all.length}
          games={data.games}
          onOpenGuide={() => setShowGuide(true)}
          onOpenHowTo={() => setShowHowTo(true)}
          onOpenBuilder={() => setShowBuilder(true)}
          onOpenWeather={() => setView('weather')}
          onOpenListBuilder={() => setShowListBuilder(true)}
          onOpenGroups={() => setShowGroups(true)}
          onOpenSGP={() => setShowSGP(true)}
          onOpenSplits={() => setShowSplits(true)}
          onOpenBacktest={() => setShowBacktest(true)}
          onOpenSettings={() => setShowSettings(true)}
        />

        <Filters
          value={filters}
          onChange={patch}
          gradeCounts={gradeCounts}
          badgeCounts={badgeCounts}
          games={data.games}
          watchCount={watchlist.size}
          view={view}
          onView={setView}
        />
      </div>

      <main className="main">
        {view === 'results' || view === 'combos' ? (
          <ResultsView
            meta={data.meta}
            batters={all}
            onSelect={(b) => setSelectedId(b.id)}
            favorConsistency={favorConsistency}
            initialTab={view === 'combos' ? 'combos' : 'model'}
          />
        ) : view === 'pitchers' ? (
          <PitchersView
            batters={all}
            kDistByPitcher={data?.kDistByPitcher || {}}
            liveKsByPitcher={data?.liveKsByPitcher || {}}
            onSelect={(b) => setSelectedId(b.id)}
            selectedId={selectedId}
            watchlist={watchlist}
            slip={slipSet}
          />
        ) : view === 'weather' ? (
          <WeatherView
            batters={all}
            onSelect={(b) => setSelectedId(b.id)}
            selectedId={selectedId}
          />
        ) : view === 'games' ? (
          <GamesView
            games={data.games}
            batters={filtered}
            onSelect={(b) => setSelectedId(b.id)}
            selectedId={selectedId}
            watchlist={watchlist}
            slip={slipSet}
            onToggleWatch={toggleWatch}
            onToggleSlip={toggleSlip}
            onOpenPitcher={openPitcher}
          />
        ) : (
          <>
            {showDayRating && <DayRating
              rating={data.meta?.dayRating}
              estHRs={data.batters?.reduce((s, b) => s + (Number.isFinite(b.hrProbability) ? b.hrProbability : 0), 0) ?? null}
            />}
            {pick && pick.id !== podDismissedId && (
              <PickOfDay
                batter={pick}
                onSelect={(b) => setSelectedId(b.id)}
                watched={watchlist.has(pick.id)}
                inSlip={slipSet.has(pick.id)}
                onToggleWatch={toggleWatch}
                onToggleSlip={toggleSlip}
                onOpenPitcher={openPitcher}
                onDismiss={(b) => setPodDismissedId(b.id)}
              />
            )}
            <BatterTable
              batters={filtered}
              onSelect={(b) => setSelectedId(b.id)}
              selectedId={selectedId}
              sort={filters.sort}
              dir={filters.dir}
              onSort={onSort}
              watchlist={watchlist}
              slip={slipSet}
              onToggleWatch={toggleWatch}
              onToggleSlip={toggleSlip}
              onOpenPitcher={openPitcher}
              splitProjected={splitProjected}
              total={all.length}
              onClearFilters={clearFilters}
            />
          </>
        )}
      </main>

      <footer className="foot">
        <span className="dim">StatFax</span>
      </footer>

      <ParlaySlip
        legs={slipLegs}
        onRemove={removeSlip}
        onClear={clearSlip}
        onSelect={(b) => setSelectedId(b.id)}
        onOpenBuilder={() => setShowBuilder(true)}
      />

      {showBuilder && (
        <>
          <div className="drawer-scrim" onClick={() => setShowBuilder(false)} />
          <div className="modal groups-modal builder-modal" role="dialog" aria-modal="true" aria-label="Parlay Builder">
            <button className="drawer-close icon-btn" onClick={() => setShowBuilder(false)} aria-label="Close">
              <Icon name="X" size={18} />
            </button>
            <div className="groups-modal-head">
              <Icon name="Layers" size={18} />
              <h2>Parlay Builder</h2>
            </div>
            <div className="groups-modal-body">
              <ParlayBuilder
                batters={all}
                legs={slipLegs}
                slipSet={slipSet}
                onToggle={toggleSlip}
                onRemove={removeSlip}
                onClear={clearSlip}
                onReplace={replaceSlip}
                onSelect={(b) => setSelectedId(b.id)}
                onClose={() => setShowBuilder(false)}
                favorConsistency={favorConsistency}
                scorecard={data.meta?.comboScorecard}
              />
            </div>
          </div>
        </>
      )}

      {selected && (
        <PlayerDrawer
          batter={selected}
          batters={all}
          onClose={() => setSelectedId(null)}
          watched={watchlist.has(selected.id)}
          inSlip={slipSet.has(selected.id)}
          onToggleWatch={toggleWatch}
          onToggleSlip={toggleSlip}
          onOpenZone={(bb) => setZoneId(bb.id)}
          onOpenPitcher={openPitcher}
        />
      )}
      {zoneBatter && <ZoneView batter={zoneBatter} onClose={() => setZoneId(null)} />}
      {pitcherEntry && (
        <>
          <div className="drawer-scrim pitcher-scrim" onClick={() => setPitcherKey(null)} />
          <div className="drawer pitcher-drawer" role="dialog" aria-modal="true" aria-label="Pitcher card">
            <button className="drawer-close icon-btn" onClick={() => setPitcherKey(null)} aria-label="Close">
              <Icon name="X" size={18} />
            </button>
            <div className="pitcher-drawer-body">
              <PitcherCard
                entry={pitcherEntry}
                onSelect={(b) => {
                  setPitcherKey(null)
                  setSelectedId(b.id)
                }}
                selectedId={selectedId}
                watchlist={watchlist}
                slip={slipSet}
              />
            </div>
          </div>
        </>
      )}
      {showGroups && (
        <>
          <div className="drawer-scrim" onClick={() => setShowGroups(false)} />
          <div className="modal groups-modal" role="dialog" aria-modal="true" aria-label="Parlay Combos">
            <button className="drawer-close icon-btn" onClick={() => setShowGroups(false)} aria-label="Close">
              <Icon name="X" size={18} />
            </button>
            <div className="groups-modal-head">
              <Icon name="Layers" size={18} />
              <h2>Parlay Combos</h2>
            </div>
            <div className="groups-modal-body">
              <GroupsView
                batters={all}
                onSelect={(b) => setSelectedId(b.id)}
                selectedId={selectedId}
                scorecard={data.meta?.comboScorecard}
                generatedAt={data.meta?.generatedAt}
                windowMode={windowMode}
                comboConf={comboConf}
                favorConsistency={favorConsistency}
                lockedBoard={data.raw?.lockedBoard}
                slipSet={slipSet}
                onToggleSlip={toggleSlip}
              />
            </div>
          </div>
        </>
      )}
      {showSGP && (
        <>
          <div className="drawer-scrim" onClick={() => setShowSGP(false)} />
          <div className="modal groups-modal" role="dialog" aria-modal="true" aria-label="Same-Game Parlays">
            <button className="drawer-close icon-btn" onClick={() => setShowSGP(false)} aria-label="Close">
              <Icon name="X" size={18} />
            </button>
            <div className="groups-modal-head">
              <Icon name="Zap" size={18} />
              <h2>Same-Game Parlays</h2>
            </div>
            <div className="groups-modal-body">
              <SameGameView
                batters={all}
                onSelect={(b) => setSelectedId(b.id)}
                favorConsistency={favorConsistency}
                comboConf={comboConf}
              />
            </div>
          </div>
        </>
      )}
      {showSplits && (
        <>
          <div className="drawer-scrim" onClick={() => setShowSplits(false)} />
          <div className="modal groups-modal cheat-modal" role="dialog" aria-modal="true" aria-label="Cheat Sheet">
            <button className="drawer-close icon-btn" onClick={() => setShowSplits(false)} aria-label="Close">
              <Icon name="X" size={18} />
            </button>
            <div className="groups-modal-head">
              <Icon name="LayoutGrid" size={18} />
              <h2>Cheat Sheet</h2>
            </div>
            <div className="groups-modal-body">
              <CheatSheet batters={all} onSelect={(b) => setSelectedId(b.id)} onOpenPitcher={openPitcher} />
            </div>
          </div>
        </>
      )}
      {showListBuilder && (
        <>
          <div className="drawer-scrim" onClick={() => setShowListBuilder(false)} />
          <div className="modal groups-modal cheat-modal" role="dialog" aria-modal="true" aria-label="List Builder">
            <button className="drawer-close icon-btn" onClick={() => setShowListBuilder(false)} aria-label="Close">
              <Icon name="X" size={18} />
            </button>
            <div className="groups-modal-head">
              <Icon name="Filter" size={18} />
              <h2>List Builder</h2>
            </div>
            <div className="groups-modal-body">
              <ListBuilderView batters={all} onSelect={(b) => { setSelectedId(b.id); setShowListBuilder(false) }} />
            </div>
          </div>
        </>
      )}
      {showBacktest && (
        <>
          <div className="drawer-scrim" onClick={() => setShowBacktest(false)} />
          <div className="modal backtest-modal" role="dialog" aria-modal="true" aria-label="Signal Backtest">
            <button className="drawer-close icon-btn" onClick={() => setShowBacktest(false)} aria-label="Close">
              <Icon name="X" size={18} />
            </button>
            <div className="groups-modal-head">
              <Icon name="Activity" size={18} />
              <h2>Signal Backtest</h2>
            </div>
            <BacktestView
              batters={all}
              onApply={(g, s) => {
                patch({ grades: new Set(g.length ? g : GRADE_ORDER), badges: new Set(s) })
                setShowBacktest(false)
                setView('board')
              }}
            />
          </div>
        </>
      )}
      {showLegend && <Legend onClose={() => setShowLegend(false)} />}
      {showGuide && <Guide onClose={() => setShowGuide(false)} />}
      {showHowTo && <HowToPick onClose={() => setShowHowTo(false)} />}
      {showSettings && (
        <Settings
          liveScores={liveScores}
          onToggleLive={() => setLiveScores((v) => !v)}
          autoRefresh={autoRefresh}
          onToggleAuto={() => setAutoRefresh((v) => !v)}
          windowMode={windowMode}
          onToggleWindows={() => setWindowMode((v) => !v)}
          showDayRating={showDayRating}
          onToggleDayRating={() => setShowDayRating((v) => !v)}
          comboConf={comboConf}
          onSetComboConf={setComboConf}
          eliLevel={eliLevel}
          onSetEli={setEliLevel}
          favorConsistency={favorConsistency}
          onToggleConsistency={() => setFavorConsistency((v) => !v)}
          splitProjected={splitProjected}
          onToggleSplit={() => setSplitProjected((v) => !v)}
          onClose={() => setShowSettings(false)}
        />
      )}
      <BackToTop />
      <PullToRefresh onRefresh={load} />
      <UpdateBanner />
      <ToastStack />
      <InstallPrompt />
      {celebrate && <Confetti onDone={() => setCelebrate(false)} />}
    </div>
    {/* Bottom nav is a sibling of .app (not a child) so iOS doesn't route its
        touch events through the overflow-y:auto scroll container, which can
        swallow taps on position:fixed descendants in standalone PWA mode. */}
    <nav className="bottom-nav">
      {[
        { id: 'board', label: 'Board', icon: 'List' },
        { id: 'games', label: 'Games', icon: 'LayoutGrid' },
        { id: 'pitchers', label: 'Pitchers', icon: 'Crosshair' },
        { id: 'results', label: 'Results', icon: 'Activity' }
      ].map((tab) => (
        <button
          key={tab.id}
          className={`bottom-nav-btn ${view === tab.id || (tab.id === 'results' && view === 'combos') ? 'active' : ''}`}
          onClick={() => setView(tab.id)}
        >
          <Icon name={tab.icon} size={20} />
          <span className="bottom-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
    </>
    </EliLevelContext.Provider>
    </LiveModeContext.Provider>
  )
}
