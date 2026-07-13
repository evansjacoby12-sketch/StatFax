# Shared layouts

## $path

``jsx
import { useEffect, useMemo, useState, useCallback, useRef, useLayoutEffect } from 'react'
import { loadSlate, loadBrief, forceSlateRefresh, normName } from './lib/data.js'
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
import SlateBrief from './components/SlateBrief.jsx'
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

// Cloudflare Worker base — its /trigger endpoint fires a repository_dispatch
// that rebuilds the slate on GitHub Actions (the press-and-hold "build" action).
const WORKER_URL = import.meta.env?.VITE_WORKER_URL || ''

const AUTO_REFRESH_MS    = 60_000
const LIVE_REFRESH_MS    = 30_000  // faster cadence while a game is actually live
const SLATE_REFRESH_MS   = 3 * 60_000 // always-on background poll — pipeline runs every 10 min

// Reopening the app after this long away resets the view + board filters to a
// fresh Board (see staleReturn). A heartbeat keeps `lastSeenAt` current while the
// app is open, so it only trips after a real absence, not idle time on-screen.
const STALE_RESET_MS = 30 * 60 * 1000 // 30 min

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
  // Stale-return reset: if the app was last open > STALE_RESET_MS ago (closed /
  // backgrounded, not just idle), open fresh on the Board with default filters
  // instead of restoring wherever you left off on yesterday's slate.
  const staleReturn = (() => {
    const last = store.load('lastSeenAt', 0)
    return last > 0 && Date.now() - last > STALE_RESET_MS
  })()

  const [state, setState] = useState({ status: 'loading', data: null, error: null })
  const [brief, setBrief] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [slateBuilding, setSlateBuilding] = useState(false)
  const [filters, setFilters] = useState(() => (staleReturn ? DEFAULT_FILTERS : initialFilters()))
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
  // Favor-consistency lean removed from the UI — kept as a constant so the combo
  // builders' `favorConsistency` prop stays wired (always off) without churn.
  const favorConsistency = false
  // Morning combo lock: apply the server's comboFreeze bundle so the parlay board's
  // leg selection is pinned at the morning lock. Toggle (default OFF for now while
  // testing) — off = the board re-ranks live from current heat/park/edge signals.
  const [comboLock, setComboLock] = useState(() => store.load('comboLock', false))
  const [splitProjected, setSplitProjected] = useState(() => store.load('splitProjected', false))
  const [watchlist, setWatchlist] = useState(() => new Set(store.load('watchlist', [])))
  const [slipIds, setSlipIds] = useState(() => store.load('slip', []))
  const [autoRefresh, setAutoRefresh] = useState(() => store.load('autoRefresh', false))
  const [view, setView] = useState(() => (staleReturn ? 'board' : (viewFromHash() || store.load('view', 'board'))))
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
  useEffect(() => store.save('comboLock', comboLock), [comboLock])
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
      // Fire-and-forget: the brief is advisory and must never block or fail the
      // board load. Refreshes alongside each slate load (a few times a day).
      loadBrief().then(setBrief).catch(() => {})
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

  // Press-and-hold (10s) on the refresh button → kick off a full slate REBUILD
  // on GitHub Actions via the Worker's /trigger endpoint. This is the heavy
  // action (fetches fresh MLB + Savant data and re-scores everything, ~2-3 min),
  // deliberately gated behind a long hold so a normal tap stays a cheap reload.
  // On a local dev host (no Worker URL) it falls back to the local-server rebuild.
  const buildSlate = useCallback(async () => {
    if (!WORKER_URL) { await forceRefresh(); return }
    try {
      const res = await fetch(`${WORKER_URL}/trigger`, { cache: 'no-store' })
      if (res.ok) {
        toast.success('Rebuild kicked off — fresh slate in ~2–3 min')
      } else {
        toast.error(`Rebuild failed to start (${res.status})`)
      }
    } catch {
      // A plain GET still reaches the Worker and dispatches even if the browser
      // can't read the response (e.g. an older Worker without CORS), so treat an
      // unreadable response as "requested" rather than a hard failure.
      toast.success('Rebuild requested — fresh slate in ~2–3 min')
    }
  }, [forceRefresh])

  useEffect(() => {
    load()
  }, [load])

  // Track when the app was last actively open, and reset a stale return. A
  // heartbeat marks `lastSeenAt` every minute while visible; on hide we stamp it;
  // on becoming visible again after > STALE_RESET_MS we snap back to a fresh
  // Board (default filters, close overlays) and reload the slate — so you don't
  // resume hours later still parked on a filtered view of yesterday's board.
  useEffect(() => {
    const mark = () => { if (document.visibilityState === 'visible') store.save('lastSeenAt', Date.now()) }
    mark()
    const beat = setInterval(mark, 60_000)
    const onVis = () => {
      if (document.visibilityState === 'hidden') { store.save('lastSeenAt', Date.now()); return }
      const last = store.load('lastSeenAt', 0)
      if (last > 0 && Date.now() - last > STALE_RESET_MS) {
        setView('board')
        setFilters(DEFAULT_FILTERS)
        setSelectedId(null)
        setShowGroups(false)
        setShowSGP(false)
        load()
      }
      store.save('lastSeenAt', Date.now())
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(beat); document.removeEventListener('visibilitychange', onVis) }
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
          onHoldBuild={buildSlate}
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
            <SlateBrief brief={brief} />
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
                comboLock={comboLock}
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
                sgpScorecard={data.meta?.sgpScorecard}
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
          splitProjected={splitProjected}
          onToggleSplit={() => setSplitProjected((v) => !v)}
          comboLock={comboLock}
          onToggleComboLock={() => setComboLock((v) => !v)}
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

``n## $path

``jsx
import { useState, useRef, useEffect } from 'react'
import Icon from './Icon.jsx'
import { timeAgo, pct } from '../lib/format.js'
import { GRADE_ORDER, gradeColor } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

// "First pitch in 38m" — live countdown to the next scheduled game. Hidden
// once something is live (the board carries the LIVE story from there) or
// when the whole slate is done. Ticks every 30s.
function FirstPitchCountdown({ games = [] }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])
  if (games.some((g) => g.isLive)) return null
  const next = games
    .filter((g) => !g.isFinal && !g.isLive && Number.isFinite(Date.parse(g.gameDate)))
    .map((g) => Date.parse(g.gameDate))
    .filter((t) => t > now)
    .sort((a, b) => a - b)[0]
  if (!next) return null
  const mins = Math.max(1, Math.round((next - now) / 60_000))
  const label = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`
  return (
    <>
      <span className="dot-sep">·</span>
      <span className="first-pitch" title="Time until the next scheduled first pitch">
        <Icon name="Clock" size={11} style={{ color: 'var(--accent)' }} /> first pitch {label}
      </span>
    </>
  )
}

// Help dropdown anchored to the header info button
function HelpMenu({ onOpenWeather, onOpenBuilder, onOpenGroups, onOpenSGP, onOpenSplits, onOpenBacktest, onOpenListBuilder, onOpenGuide, onOpenHowTo, onOpenLegend, onOpenSettings }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  
  useEffect(() => {
    if (!open) return
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Grouped so the menu reads as: betting tools → finding plays → learning →
  // app settings, instead of one flat 9-item wall.
  const sections = [
    {
      title: 'Parlays',
      items: [
        { label: 'Weather', desc: 'Park factors, wind & game-time conditions', icon: 'Wind', fn: onOpenWeather },
        { label: 'Parlay Combos', desc: 'Auto-built chalk, value, lottery combos', icon: 'Layers', fn: onOpenGroups },
        { label: 'Parlay Builder', desc: 'Build your own slip — live odds, EV & correlation', icon: 'Sparkles', fn: onOpenBuilder },
        { label: 'Same-Game Parlays', desc: 'Best correlated 2–4 leg SGPs', icon: 'Zap', fn: onOpenSGP },
      ],
    },
    {
      title: 'Find plays',
      items: [
        { label: 'Cheat Sheet', desc: 'HR plays, barrels, weak arms & parks', icon: 'LayoutGrid', fn: onOpenSplits },
        { label: 'List Builder', desc: 'Filter batters by your own Statcast criteria', icon: 'Filter', fn: onOpenListBuilder },
        { label: 'Signal Backtest', desc: 'Hit rates by grade and signals', icon: 'Activity', fn: onOpenBacktest },
      ],
    },
    {
      title: 'Learn',
      items: [
        { label: 'How to Pick', desc: 'HR-selection playbook strategies', icon: 'Target', fn: onOpenHowTo },
        { label: 'Guide', desc: 'Learn how the board is structured', icon: 'Info', fn: onOpenGuide },
        { label: 'Legend', desc: 'Definitions of grades, signals & stats', icon: 'Trophy', fn: onOpenLegend },
      ],
    },
    {
      title: 'App',
      items: [
        { label: 'Settings', desc: 'Live updates, refresh rate, combo window', icon: 'SlidersHorizontal', fn: onOpenSettings },
      ],
    },
  ]

  return (
    <div className="help-menu" ref={ref} style={{ position: 'relative' }}>
      <button
        className={`icon-btn ${open ? 'on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Help & Tools Menu"
        aria-label="Help"
        style={{
          background: open ? 'var(--hover)' : 'var(--card)',
          borderColor: open ? 'var(--accent)' : 'var(--border)'
        }}
      >
        <Icon name="ChevronDown" size={16} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && (
        <div className="view-menu-pop" role="menu">
          {sections.map((sec, si) => (
            <div key={sec.title} role="group" aria-label={sec.title}>
              <div
                className="vm-section"
                style={{
                  fontSize: '9px',
                  fontWeight: '700',
                  textTransform: 'uppercase',
                  letterSpacing: '0.07em',
                  color: 'var(--text-faint)',
                  padding: si === 0 ? '6px 12px 4px' : '10px 12px 4px',
                  marginTop: si > 0 ? '2px' : '0',
                  borderTop: si > 0 ? '1px solid var(--border-soft)' : 'none',
                }}
              >
                {sec.title}
              </div>
              {sec.items.map((it) => (
                <button
                  key={it.label}
                  role="menuitem"
                  className="vm-item"
                  onClick={() => {
                    it.fn()
                    setOpen(false)
                  }}
                >
                  <div className="vm-icon-box">
                    <Icon name={it.icon} size={15} />
                  </div>
                  <span className="vm-txt">
                    <b>{it.label}</b>
                    <span className="dim">{it.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Header({
  meta,
  counts,
  onRefresh,
  onHoldBuild,
  onOpenModel,
  onOpenLegend,
  autoRefresh,
  onToggleAuto,
  liveScores = true,
  onToggleLive,
  eliLevel = 'eli5',
  onCycleEli,
  refreshing,
  slateBuilding = false,
  gradeCounts = {},
  total = 0,
  games = [],
  onOpenGuide,
  onOpenHowTo,
  onOpenWeather,
  onOpenBuilder,
  onOpenGroups,
  onOpenSGP,
  onOpenSplits,
  onOpenBacktest,
  onOpenListBuilder,
  onOpenSettings,
}) {
  const m = meta.modelMetrics
  const brierEdge = m ? (m.baselineBrier - m.brier) / m.baselineBrier : null
  const genMs = meta.generatedAt ? Date.parse(meta.generatedAt) : NaN
  const slateStale = Number.isFinite(genMs) && Date.now() - genMs > 14 * 60_000

  // Press-and-hold the refresh button for HOLD_MS → trigger a full slate
  // rebuild (onHoldBuild). A short tap still fires onRefresh (the cheap reload).
  // `holding` drives a progress fill that charges over the hold; when it
  // completes we mark suppressClick so the release's synthetic click doesn't
  // ALSO fire a reload. Keyboard activation (Enter/Space → click) keeps the tap.
  const HOLD_MS = 10_000
  const [holding, setHolding] = useState(false)
  const holdTimer = useRef(null)
  const suppressClick = useRef(false)
  const canBuild = !!onHoldBuild && !slateBuilding

  const clearHold = () => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
    setHolding(false)
  }
  const startHold = (e) => {
    // Primary button / touch / pen only; ignore right-click etc.
    if (e.button != null && e.button !== 0) return
    if (!canBuild || refreshing) return
    suppressClick.current = false
    setHolding(true)
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null
      suppressClick.current = true   // swallow the release-click that follows
      setHolding(false)
      onHoldBuild?.()
    }, HOLD_MS)
  }
  const handleRefreshClick = () => {
    if (suppressClick.current) { suppressClick.current = false; return }
    onRefresh?.()
  }
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current) }, [])

  return (
    <header className="header">
      <div className="header-left">
        <div className="brand">
          <span className="brand-mark" style={{
            background: 'linear-gradient(135deg, var(--accent) 0%, #0052d4 100%)',
            boxShadow: '0 0 16px rgba(0, 216, 246, 0.4)',
            borderRadius: '10px',
            width: '34px',
            height: '34px',
            display: 'grid',
            placeItems: 'center',
            color: '#fff'
          }}>
            <Icon name="Trophy" size={16} />
          </span>
          <div className="brand-txt">
            <span className="brand-name">
              Stat<span style={{ color: 'var(--accent)', textShadow: '0 0 8px var(--accent-glow)' }}>Fax</span>
            </span>
            <span className="brand-sub">Model Board</span>
          </div>
        </div>
        <div className="slate-block">
          <div className="slate-meta">
            <span className="slate-date">{meta.date}</span>
            <span className="dot-sep">·</span>
            <span>{counts.games} games</span>
            <span className="dot-sep slate-batters">·</span>
            <span className="slate-batters">
              <b className="mono" style={{ color: 'var(--accent)' }}>{counts.shown}</b> / {counts.total} batters
            </span>
            <FirstPitchCountdown games={games} />
            {meta.morningLockAt && (
              <>
                <span className="dot-sep">·</span>
                <span className="first-pitch" title={`Scores locked for the day at ${new Date(meta.morningLockAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — only lineups, scratches, odds and live state update from here. A changed starting pitcher re-scores that game.`}>
                  <Icon name="Lock" size={10} style={{ color: 'var(--prime)' }} /> locked {new Date(meta.morningLockAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                </span>
              </>
            )}
          </div>
          {total > 0 && (
            <div className="grade-bar" title="Grade distribution" style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden', marginTop: '6px' }}>
              {GRADE_ORDER.map((g) => {
                const n = gradeCounts[g] || 0
                if (!n) return null
                return (
                  <span
                    key={g}
                    className="grade-bar-seg"
                    style={{ flexGrow: n, background: gradeColor(g), height: '100%', display: 'inline-block' }}
                    title={`${g}: ${n}`}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="header-right">
        <button className="metric-pill" onClick={onOpenModel} title="Model accuracy & calibration tracker">
          <Icon name="Gauge" size={14} style={{ color: 'var(--accent)' }} />
          <span className="metric-pill-stack">
            <span className="metric-pill-k">Brier</span>
            <span className="metric-pill-v mono" style={{ color: 'var(--accent)' }}>{m ? m.brier.toFixed(4) : '—'}</span>
          </span>
          {brierEdge != null && (
            <span className={`metric-delta ${brierEdge >= 0 ? 'up' : 'down'} mono`}>
              {brierEdge >= 0 ? '▲' : '▼'} {pct(Math.abs(brierEdge), 0)}
            </span>
          )}
        </button>

        <div
          className={`gen-meta ${slateStale ? 'stale' : ''}`}
          title={
            slateStale
              ? `Slate generated ${meta.generatedAt} — scores/innings are from then, not live-now.`
              : `Generated ${meta.generatedAt}`
          }
        >
          <Icon name={slateStale ? 'TriangleAlert' : 'Clock'} size={13} style={{ color: slateStale ? 'var(--warn)' : 'var(--text-faint)' }} />
          <span style={{ color: slateStale ? 'var(--warn)' : 'var(--text-dim)' }}>{timeAgo(meta.generatedAt)}</span>
        </div>

        <button
          className={`toggle-btn live-btn ${liveScores ? 'on' : ''}`}
          onClick={onToggleLive}
          title={
            liveScores
              ? 'Live scores & innings auto-updating — tap to view pregame only'
              : 'Pregame only — tap to enable live updates'
          }
          aria-pressed={liveScores}
          aria-label={liveScores ? 'Live scores on' : 'Pregame look'}
          style={{
            background: liveScores ? 'rgba(16, 185, 129, 0.1)' : 'var(--card)',
            borderColor: liveScores ? 'var(--strong)' : 'var(--border)',
            color: liveScores ? 'var(--strong)' : 'var(--text-dim)'
          }}
        >
          <Icon name={liveScores ? 'Activity' : 'Clock'} size={14} className={liveScores ? 'spin-pulse' : ''} />
        </button>

        <button
          className="toggle-btn eli-btn"
          onClick={onCycleEli}
          title={
            eliLevel === 'eli5'
              ? 'Explanations: Plain English (ELI5). Tap for stats depth (ELI15).'
              : 'Explanations: Stats depth (ELI15). Tap for plain English (ELI5).'
          }
          aria-label={`Explanation depth: ${eliLevel}`}
        >
          <Icon name={eliLevel === 'eli5' ? 'Sparkles' : 'BarChart3'} size={14} style={{ color: 'var(--accent)' }} />
        </button>

        <HelpMenu onOpenWeather={onOpenWeather} onOpenBuilder={onOpenBuilder} onOpenGroups={onOpenGroups} onOpenSGP={onOpenSGP} onOpenSplits={onOpenSplits} onOpenBacktest={onOpenBacktest} onOpenListBuilder={onOpenListBuilder} onOpenGuide={onOpenGuide} onOpenHowTo={onOpenHowTo} onOpenLegend={onOpenLegend} onOpenSettings={onOpenSettings} />

        <button
          className={`icon-btn ${refreshing ? 'refreshing' : ''} ${holding ? 'holding' : ''}`}
          onClick={handleRefreshClick}
          onPointerDown={startHold}
          onPointerUp={clearHold}
          onPointerLeave={clearHold}
          onPointerCancel={clearHold}
          onContextMenu={(e) => { if (holding) e.preventDefault() }}
          title={slateBuilding ? 'Building fresh slate from MLB APIs…' : canBuild ? 'Tap to reload · hold 10s to rebuild the slate' : 'Reload slate'}
          aria-label={slateBuilding ? 'Building slate' : 'Reload slate — hold to rebuild'}
          style={{
            position: 'relative',
            overflow: 'hidden',
            touchAction: 'none'   // let the hold gesture own the press (no scroll steal)
          }}
        >
          {/* Hold-progress fill — charges bottom-up over HOLD_MS while pressed,
              snaps back on release. Behind the icon, pointer-transparent. */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              height: holding ? '100%' : '0%',
              background: 'var(--accent)', opacity: 0.28, pointerEvents: 'none',
              transition: holding ? `height ${HOLD_MS}ms linear` : 'height 180ms ease',
            }}
          />
          <Icon name={slateBuilding ? 'Loader' : 'RefreshCw'} size={14} className={refreshing ? 'animate-spin' : ''} style={{ position: 'relative' }} />
        </button>
      </div>
    </header>
  )
}

``n## $path

``jsx
import { useState, useRef, useLayoutEffect } from 'react'
import Icon from './Icon.jsx'
import Select from './Select.jsx'
import { GRADE_ORDER, gradeColor, BADGES } from '../lib/badges.js'
import { SORTS } from '../lib/constants.js'
import { useLiveMode } from '../lib/liveMode.js'
import { hexA } from './atoms.jsx'

const VIEW_TABS = [
  { id: 'board', label: 'Board', icon: 'List', desc: 'Ranked board' },
  { id: 'games', label: 'Games', icon: 'LayoutGrid', desc: 'Game-by-game' },
  { id: 'pitchers', label: 'Pitchers', icon: 'Crosshair', desc: 'Pitcher vulnerability' },
  { id: 'weather', label: 'Weather', icon: 'Wind', desc: 'Weather report' },
  { id: 'results', label: 'Results', icon: 'Activity', desc: 'Model track record + combos' },
]

// Segmented view switcher with a sliding glow indicator. The indicator is one
// absolutely-positioned pill measured off the active button, so it glides
// between tabs instead of the active style teleporting.
function ViewToggle({ view, onView }) {
  const activeId = view === 'combos' ? 'results' : view
  const wrapRef = useRef(null)
  const indRef = useRef(null)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const ind = indRef.current
    if (!wrap || !ind) return
    const place = () => {
      const btn = wrap.querySelector(`[data-view="${activeId}"]`)
      if (!btn) { ind.style.opacity = '0'; return }
      ind.style.opacity = '1'
      ind.style.transform = `translateX(${btn.offsetLeft}px)`
      ind.style.width = `${btn.offsetWidth}px`
    }
    place()
    const ro = new ResizeObserver(place) // reflows (font load, phone rotate) re-seat it
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [activeId])

  return (
    <div className="view-toggle" role="group" aria-label="View" ref={wrapRef}>
      <span className="view-ind" ref={indRef} aria-hidden="true" />
      {VIEW_TABS.map((tab, i) => (
        <button
          key={tab.id}
          data-view={tab.id}
          className={`view-btn ${activeId === tab.id ? 'on' : ''}`}
          onClick={() => onView(tab.id)}
          title={`${tab.desc} — press ${i + 1}`}
        >
          <Icon name={tab.icon} size={14} />
          {tab.label}
        </button>
      ))}
    </div>
  )
}

export default function Filters({ value, onChange, gradeCounts, games, badgeCounts, watchCount, view, onView }) {
  const v = value
  const liveMode = useLiveMode()
  const [open, setOpen] = useState(false)
  const showFilters = view === 'board' || view === 'games'
  
  const toggleGrade = (g) => {
    const next = new Set(v.grades)
    if (next.has(g)) next.delete(g)
    else next.add(g)
    onChange({ grades: next })
  }
  
  const toggleBadge = (key) => {
    const next = new Set(v.badges)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange({ badges: next })
  }

  const activeMore =
    v.gamePks.size + (v.confirmedOnly ? 1 : 0) + (v.watchedOnly ? 1 : 0) + (v.hotOnly ? 1 : 0) + (v.precisionOnly ? 1 : 0) + (v.sleepersOnly ? 1 : 0) + v.badges.size
  const badgeDefs = BADGES.filter((b) => v.badges.has(b.key))

  return (
    <div className="filters">
      <div className="filters-row">
        <ViewToggle view={view} onView={onView} />

        {showFilters ? (
          <>
            <label className="search" style={{ border: v.q ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
              <Icon name="Search" size={14} style={{ color: v.q ? 'var(--accent)' : 'var(--text-faint)' }} />
              <input
                type="text"
                placeholder="Search batter, team, pitcher..."
                value={v.q}
                onChange={(e) => onChange({ q: e.target.value })}
                aria-label="Search"
              />
              {v.q && (
                <button className="search-clear" onClick={() => onChange({ q: '' })} aria-label="Clear search">
                  <Icon name="X" size={12} />
                </button>
              )}
            </label>

            <div className="grade-pills" role="group" aria-label="Filter by grade">
              {GRADE_ORDER.map((g) => {
                const on = v.grades.has(g)
                const c = gradeColor(g)
                return (
                  <button
                    key={g}
                    className={`grade-pill ${on ? 'on' : ''}`}
                    onClick={() => toggleGrade(g)}
                    style={{
                      color: on ? c : 'var(--text-faint)',
                      borderColor: on ? hexA(c, 0.45) : 'var(--border)',
                      background: on ? `linear-gradient(135deg, ${hexA(c, 0.12)} 0%, ${hexA(c, 0.04)} 100%)` : 'var(--card)',
                      boxShadow: on ? `0 0 10px ${hexA(c, 0.1)}` : 'none'
                    }}
                    title={`${g} — ${gradeCounts[g] || 0} batters`}
                  >
                    <span className="grade-pill-dot" style={{ background: c, boxShadow: on ? `0 0 8px ${c}` : 'none' }} />
                    {g}
                    <span className="grade-pill-n mono">{gradeCounts[g] || 0}</span>
                  </button>
                )
              })}
            </div>

            <div className="filters-spacer" />

            <Select
              icon="ArrowUpDown"
              title="Sort"
              ariaLabel="Sort by"
              value={v.sort}
              onChange={(val) => onChange({ sort: val })}
              options={SORTS.map((s) => ({ value: s.key, label: s.label }))}
            />

            <button
              className={`toggle-btn more-btn chevron-btn ${open ? 'open' : ''} ${activeMore ? 'on' : ''}`}
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-label={`Filters${activeMore ? ` (${activeMore} active)` : ''}`}
              title="More filters"
              style={{
                borderColor: open ? 'var(--accent)' : activeMore ? 'var(--accent)' : 'var(--border)',
                background: open ? 'var(--hover)' : activeMore ? 'rgba(0, 216, 246, 0.08)' : 'var(--card)',
                color: open || activeMore ? '#fff' : 'var(--text-dim)'
              }}
            >
              <Icon name="ChevronDown" size={18} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
              {activeMore > 0 && <span className="more-count mono" style={{ background: 'var(--accent)' }}>{activeMore}</span>}
            </button>
          </>
        ) : null}
      </div>

      {showFilters && !open && activeMore > 0 && (
        <div className="active-chips" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
          {[...v.gamePks].map((pk) => (
            <FilterChip
              key={pk}
              label={gameLabel(games, pk)}
              onClear={() => {
                const next = new Set(v.gamePks)
                next.delete(pk)
                onChange({ gamePks: next })
              }}
            />
          ))}
          {v.confirmedOnly && <FilterChip label="Confirmed" onClear={() => onChange({ confirmedOnly: false })} />}
          {v.watchedOnly && <FilterChip label="Watchlist" onClear={() => onChange({ watchedOnly: false })} />}
          {v.hotOnly && <FilterChip label="Heating up" icon="Flame" onClear={() => onChange({ hotOnly: false })} />}
          {v.precisionOnly && <FilterChip label="Precision" icon="Sparkles" onClear={() => onChange({ precisionOnly: false })} />}
          {v.sleepersOnly && <FilterChip label="Sleepers" icon="Moon" onClear={() => onChange({ sleepersOnly: false })} />}
          {badgeDefs.map((bd) => (
            <FilterChip
              key={bd.key}
              label={bd.label}
              icon={bd.lucide}
              onClear={() => {
                const next = new Set(v.badges)
                next.delete(bd.key)
                onChange({ badges: next })
              }}
            />
          ))}
        </div>
      )}

      {showFilters && open && (
        <div className="filters-panel" style={{
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '12px',
          padding: '16px',
          marginTop: '12px'
        }}>
          <div className="filters-row fp-controls">
            <Select
              multi
              icon="MapPin"
              title="Filter by game"
              ariaLabel="Filter by game"
              value={v.gamePks}
              onChange={(val) => onChange({ gamePks: val })}
              options={[
                { value: '', label: 'All games' },
                ...games.map((g) => ({
                  value: g.gamePk,
                  label: `${g.awayTeam.abbr} @ ${g.homeTeam.abbr}${liveMode && g.isLive ? ' · LIVE' : ''}`,
                })),
              ]}
            />

            <button
              className={`toggle-btn ${v.confirmedOnly ? 'on' : ''}`}
              onClick={() => onChange({ confirmedOnly: !v.confirmedOnly })}
              title="Only batters in confirmed lineups"
              style={v.confirmedOnly ? {
                background: 'rgba(16, 185, 129, 0.1)',
                borderColor: 'var(--strong)',
                color: 'var(--strong)'
              } : {}}
            >
              <Icon name={v.confirmedOnly ? 'Check' : 'ListFilter'} size={14} />
              Confirmed
            </button>

            <button
              className={`toggle-btn star-toggle ${v.watchedOnly ? 'on' : ''}`}
              onClick={() => onChange({ watchedOnly: !v.watchedOnly })}
              title="Only batters on your watchlist"
              style={v.watchedOnly ? {
                background: 'rgba(245, 166, 35, 0.1)',
                borderColor: 'var(--prime)',
                color: 'var(--prime)'
              } : {}}
            >
              <Icon name="Star" size={14} />
              Watchlist
              {watchCount > 0 && <span className="badge-toggle-n mono" style={{ background: 'var(--prime)', color: '#000' }}>{watchCount}</span>}
            </button>

            <button
              className={`toggle-btn hot-toggle ${v.hotOnly ? 'on' : ''}`}
              onClick={() => onChange({ hotOnly: !v.hotOnly })}
              title="Only bats with Heat index >= 58"
              style={v.hotOnly ? {
                background: 'rgba(249, 115, 22, 0.1)',
                borderColor: 'var(--b-hot)',
                color: 'var(--b-hot)'
              } : {}}
            >
              <Icon name="Flame" size={14} />
              Heating up
            </button>

            <button
              className={`toggle-btn ${v.precisionOnly ? 'on' : ''}`}
              onClick={() => onChange({ precisionOnly: !v.precisionOnly })}
              title="Only batters meeting all precision gates (pitch mix ≥7, heat ≥48, HR due 5/6+, 8+ positive trends, ≤3 negatives)"
              style={v.precisionOnly ? {
                background: 'rgba(0, 216, 246, 0.1)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)'
              } : {}}
            >
              <Icon name="Sparkles" size={14} />
              Precision
            </button>

            <button
              className={`toggle-btn ${v.sleepersOnly ? 'on' : ''}`}
              onClick={() => onChange({ sleepersOnly: !v.sleepersOnly })}
              title="Under-the-radar value: STRONG/LEAN bats with PRIME-adjacent form (heat ≥48, setup 3/6+, hot or rising) — hit 21% over the validation window"
              style={v.sleepersOnly ? {
                background: 'rgba(139, 92, 246, 0.12)',
                borderColor: '#8b5cf6',
                color: '#a78bfa'
              } : {}}
            >
              <Icon name="Moon" size={14} />
              Sleepers
            </button>
          </div>

          <div className="filters-row badges-row" style={{ marginTop: '14px', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '14px' }}>
            <span className="badges-row-label">
              <Icon name="SlidersHorizontal" size={12} style={{ color: 'var(--accent)' }} /> Signals
            </span>
            <button 
              className={`badge-toggle ${!v.badges.size ? 'on' : ''}`} 
              onClick={() => onChange({ badges: new Set() })}
              style={{
                borderColor: !v.badges.size ? 'var(--accent)' : 'var(--border-soft)',
                background: !v.badges.size ? 'var(--hover)' : 'transparent',
                color: !v.badges.size ? '#fff' : 'var(--text-faint)'
              }}
            >
              Any
            </button>
            {BADGES.map((b) => {
              const has = v.badges.has(b.key)
              return (
                <button
                  key={b.key}
                  className={`badge-toggle ${has ? 'on' : ''}`}
                  onClick={() => toggleBadge(b.key)}
                  style={{
                    color: has ? b.color : 'var(--text-faint)',
                    borderColor: has ? hexA(b.color, 0.4) : 'var(--border-soft)',
                    background: has ? hexA(b.color, 0.08) : 'transparent'
                  }}
                  title={b.desc}
                >
                  <Icon name={b.lucide} size={12} />
                  {b.label}
                  <span className="badge-toggle-n mono" style={{ opacity: has ? 1 : 0.6 }}>{badgeCounts[b.key] || 0}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function FilterChip({ label, icon, onClear }) {
  return (
    <button 
      className="active-chip" 
      onClick={onClear} 
      title="Remove filter"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        background: 'rgba(0, 216, 246, 0.1)',
        border: '1px solid rgba(0, 216, 246, 0.25)',
        borderRadius: '8px',
        padding: '4px 10px',
        fontSize: '12px',
        color: '#e2e8f0',
        cursor: 'pointer'
      }}
    >
      {icon && <Icon name={icon} size={11} style={{ color: 'var(--accent)' }} />}
      <span>{label}</span>
      <Icon name="X" size={11} style={{ opacity: 0.6 }} />
    </button>
  )
}

function gameLabel(games, pk) {
  const g = games.find((x) => String(x.gamePk) === String(pk))
  return g ? `${g.awayTeam.abbr} @ ${g.homeTeam.abbr}` : 'Game'
}

``n