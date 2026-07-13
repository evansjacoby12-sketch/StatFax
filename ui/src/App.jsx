import { useEffect, useMemo, useState, useCallback, useRef, useLayoutEffect } from 'react'
import { loadSlate, loadBrief, forceSlateRefresh, normName, projectedSlateHRs } from './lib/data.js'
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
import BacktestView from './components/BacktestView.jsx'
import ResultsView from './components/ResultsView.jsx'
import PlayerDrawer from './components/PlayerDrawer.jsx'
import ZoneView from './components/ZoneView.jsx'
import ParlaySlip from './components/ParlaySlip.jsx'
import Settings from './components/Settings.jsx'
import DayRating from './components/DayRating.jsx'
import Skeleton from './components/Skeleton.jsx'
import BackToTop from './components/BackToTop.jsx'
import PullToRefresh from './components/PullToRefresh.jsx'
import PickOfDay from './components/PickOfDay.jsx'
import ReadyRadar from './components/ReadyRadar.jsx'
import BoardWorkspaceSummary from './components/BoardWorkspaceSummary.jsx'
import UpdateBanner from './components/UpdateBanner.jsx'
import BetLab from './components/BetLab.jsx'
import FindPlays from './components/FindPlays.jsx'
import LearnCenter from './components/LearnCenter.jsx'
import WorkspaceShell from './components/WorkspaceShell.jsx'
import NFLBoard from './components/NFLBoard.jsx'
import { loadNFLSnapshot } from '../../src/sports/nfl/api/NFLService.js'
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
const BOTTOM_TABS = [
  { id: 'board', label: 'Board', icon: 'List' },
  { id: 'games', label: 'Games', icon: 'LayoutGrid' },
  { id: 'pitchers', label: 'Pitchers', icon: 'Crosshair' },
  { id: 'results', label: 'Results', icon: 'Activity' },
]
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
  const [learnTab, setLearnTab] = useState(null)
  const [betLabTab, setBetLabTab] = useState(null)
  const [findPlaysTab, setFindPlaysTab] = useState(null)
  const [showBacktest, setShowBacktest] = useState(false)
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
  const [betaCeil, setBetaCeil] = useState(() => store.load('betaCeil', false)) // private beta: advisory Ceiling/Form in the player drawer
  const [splitProjected, setSplitProjected] = useState(() => store.load('splitProjected', false))
  const [watchlist, setWatchlist] = useState(() => new Set(store.load('watchlist', [])))
  const [slipIds, setSlipIds] = useState(() => store.load('slip', []))
  const [autoRefresh, setAutoRefresh] = useState(() => store.load('autoRefresh', false))
  const [sport, setSport] = useState(() => (store.load('sport', 'mlb') === 'nfl' ? 'nfl' : 'mlb'))
  const [nflSnapshot, setNflSnapshot] = useState(null)
  const [nflRefreshing, setNflRefreshing] = useState(false)
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
  useEffect(() => store.save('sport', sport), [sport])
  useEffect(() => store.save('windowMode', windowMode), [windowMode])
  useEffect(() => store.save('showDayRating', showDayRating), [showDayRating])
  useEffect(() => store.save('comboConf', comboConf), [comboConf])
  useEffect(() => store.save('comboLock', comboLock), [comboLock])
  useEffect(() => store.save('betaCeil', betaCeil), [betaCeil])
  useEffect(() => {
    if (betaCeil) return
    setFilters((current) => {
      if (!current.badges.has('powerReady') && !current.badges.has('barrelReady')) return current
      return {
        ...current,
        badges: new Set([...current.badges].filter((key) => key !== 'powerReady' && key !== 'barrelReady')),
      }
    })
  }, [betaCeil])
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

  const refreshNFL = useCallback(async () => {
    setNflRefreshing(true)
    try { setNflSnapshot(await loadNFLSnapshot({ demoFallback: true })) }
    finally { setNflRefreshing(false) }
  }, [])
  useEffect(() => {
    if (sport !== 'nfl') return undefined
    refreshNFL()
    const timer = setInterval(refreshNFL, 30_000)
    return () => clearInterval(timer)
  }, [refreshNFL, sport])

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
        setBetLabTab(null)
        setFindPlaysTab(null)
        setLearnTab(null)
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
        else if (findPlaysTab) setFindPlaysTab(null)
        else if (betLabTab) setBetLabTab(null)
        else if (learnTab) setLearnTab(null)
        else if (showSettings) setShowSettings(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, zoneId, findPlaysTab, betLabTab, learnTab, showBacktest, showSettings, pitcherKey])

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

  if (sport === 'nfl') {
    const nflData = nflSnapshot
    const nflPlayers = nflData?.players || []
    const nflLive = nflPlayers.some((player) => player.live?.isLive)
    return (
      <LiveModeContext.Provider value={false}>
      <EliLevelContext.Provider value={eliLevel}>
        <div className="app nfl-app">
          <div className="topbar" ref={topbarRef}>
            <Header
              sport="nfl"
              onSportChange={(next) => setSport(next)}
              meta={{ week: nflData?.meta?.week || 'NFL', modelMetrics: null, generatedAt: nflData?.generatedAt || null, sourceMode: nflData?.source?.mode || 'demo', oddsStatus: nflData?.source?.providers?.odds || null }}
              counts={{ games: nflData?.meta?.games || 0, total: nflPlayers.length, shown: nflPlayers.length }}
              onRefresh={refreshNFL}
              onToggleLive={() => toast.info(nflLive ? 'Live NFL updates refresh every 30 seconds' : 'No NFL game is live right now')}
              onCycleEli={() => setEliLevel((value) => nextEliLevel(value))}
              liveScores={nflLive}
              eliLevel={eliLevel}
              refreshing={nflRefreshing}
              gradeCounts={{}}
              total={nflPlayers.length}
              games={nflData?.games || []}
            />
          </div>
          <main className="main nfl-main"><NFLBoard snapshot={nflData} /></main>
          <footer className="foot"><span className="dim">StatFax NFL · TD, yardage and reception props</span></footer>
          <ToastStack />
        </div>
      </EliLevelContext.Provider>
      </LiveModeContext.Provider>
    )
  }

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
  const bottomNavView = view === 'combos' ? 'results' : view
  const bottomNavIndex = BOTTOM_TABS.findIndex((tab) => tab.id === bottomNavView)

  return (
    <LiveModeContext.Provider value={liveScores}>
    <EliLevelContext.Provider value={eliLevel}>
    <>
    <div className="app">
      <div className="topbar" ref={topbarRef}>
        <Header
          sport="mlb"
          onSportChange={(next) => setSport(next)}
          meta={data.meta}
          counts={{
            games: data.games.length,
            total: all.length,
            shown: filtered.length,
          }}
          onRefresh={forceRefresh}
          onHoldBuild={buildSlate}
          onOpenModel={() => setView('results')}
          onOpenLegend={() => setLearnTab('glossary')}
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
          onOpenGuide={() => setLearnTab('guide')}
          onOpenHowTo={() => setLearnTab('playbook')}
          onOpenBuilder={() => setBetLabTab('builder')}
          onOpenWeather={() => setFindPlaysTab('weather')}
          onOpenListBuilder={() => setFindPlaysTab('list-builder')}
          onOpenGroups={() => setBetLabTab('explore')}
          onOpenSGP={() => setBetLabTab('same-game')}
          onOpenSplits={() => setFindPlaysTab('cheat-sheet')}
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
          betaEnabled={betaCeil}
        />
      </div>

      <main className="main">
        {view === 'results' || view === 'combos' ? (
          <ResultsView
            meta={data.meta}
            batters={all}
            onSelect={(b) => setSelectedId(b.id)}
            favorConsistency={favorConsistency}
            initialTab={view === 'combos' ? 'combos' : 'overview'}
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
          <div className="board-workspace">
            <section className="board-workspace-main" aria-label="Ranked batter board">
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
                betaEnabled={betaCeil}
                signalLimit={2}
                total={all.length}
                onClearFilters={clearFilters}
              />
            </section>
            <aside className="board-decision-rail" aria-label="Slate decisions">
              <div className="board-slate-pulse">
                {showDayRating && <DayRating
                  rating={data.meta?.dayRating}
                  estHRs={projectedSlateHRs(data.batters)}
                />}
                {betaCeil && (
                  <ReadyRadar
                    batters={all}
                    badges={filters.badges}
                    onChangeBadges={(badges) => patch({ badges })}
                    onSelect={(b) => setSelectedId(b.id)}
                  />
                )}
              </div>
              <div className="board-decision-pick">
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
              </div>
              <div className="board-decision-brief"><SlateBrief brief={brief} /></div>
              <BoardWorkspaceSummary
                watchCount={watchlist.size}
                slipCount={slipIds.length}
                onWatchlist={() => patch({ watchedOnly: true })}
                onBuilder={() => setBetLabTab('builder')}
              />
            </aside>
          </div>
        )}
      </main>

      <footer className="foot">
        <span className="dim">StatFax</span>
      </footer>

      <ParlaySlip
        legs={slipLegs}
        batters={all}
        onRemove={removeSlip}
        onClear={clearSlip}
        onReplace={replaceSlip}
        onSelect={(b) => setSelectedId(b.id)}
        onOpenBuilder={() => setBetLabTab('builder')}
      />

      {betLabTab && (
        <BetLab
          key={betLabTab}
          initialTab={betLabTab}
          onClose={() => setBetLabTab(null)}
          batters={all}
          selectedId={selectedId}
          onSelect={(b) => setSelectedId(b.id)}
          scorecard={data.meta?.comboScorecard}
          generatedAt={data.meta?.generatedAt}
          windowMode={windowMode}
          comboConf={comboConf}
          favorConsistency={favorConsistency}
          lockedBoard={data.raw?.lockedBoard}
          slipSet={slipSet}
          onToggleSlip={toggleSlip}
          comboLock={comboLock}
          legs={slipLegs}
          onRemove={removeSlip}
          onClear={clearSlip}
          onReplace={replaceSlip}
          sgpScorecard={data.meta?.sgpScorecard}
        />
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
      {findPlaysTab && (
        <FindPlays
          key={findPlaysTab}
          initialTab={findPlaysTab}
          onClose={() => setFindPlaysTab(null)}
          batters={all}
          selectedId={selectedId}
          onSelect={(b) => setSelectedId(b.id)}
          onOpenPitcher={openPitcher}
        />
      )}
      {showBacktest && (
        <WorkspaceShell icon="Activity" eyebrow="Evidence workspace" title="Signal Backtest" description="Test a grade-and-signal hypothesis against reconciled historical outcomes before applying it to tonight's board." onClose={() => setShowBacktest(false)} status="Descriptive evidence">
          <div className="workspace-truth"><Icon name="Info" size={14} /><span><b>Truth disclosure</b> Historical hit-rate lift describes the recorded sample. It does not guarantee the next slate.</span></div>
            <BacktestView
              batters={all}
              onApply={(g, s) => {
                patch({ grades: new Set(g.length ? g : GRADE_ORDER), badges: new Set(s) })
                setShowBacktest(false)
                setView('board')
              }}
            />
        </WorkspaceShell>
      )}
      {learnTab && <LearnCenter key={learnTab} initialTab={learnTab} onClose={() => setLearnTab(null)} />}
      {showSettings && (
        <WorkspaceShell icon="SlidersHorizontal" eyebrow="Control center" title="Settings" description="Optional behavior and display preferences. Every change is saved locally on this device." onClose={() => setShowSettings(false)} size="settings" status="Saved automatically">
          <Settings
            embedded
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
            betaCeil={betaCeil}
            onToggleBetaCeil={() => setBetaCeil((v) => !v)}
            onClose={() => setShowSettings(false)}
          />
        </WorkspaceShell>
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
    <nav
      className="bottom-nav"
      aria-label="Primary navigation"
      data-has-active={bottomNavIndex >= 0}
      style={{ '--bottom-nav-index': Math.max(0, bottomNavIndex) }}
    >
      <span className="bottom-nav-indicator" aria-hidden="true" />
      {BOTTOM_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`bottom-nav-btn ${bottomNavView === tab.id ? 'active' : ''}`}
          onClick={() => setView(tab.id)}
          aria-current={bottomNavView === tab.id ? 'page' : undefined}
          aria-label={tab.label}
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
