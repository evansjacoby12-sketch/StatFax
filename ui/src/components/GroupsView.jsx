import { useMemo, useState, useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import Select from './Select.jsx'
import { pct, num, rate, american, signedPct } from '../lib/format.js'
import { buildGroups, legsByStrategy, mergeGroups, lastFirst, isoOf, blastOf, blastMixOf, blastVsHandOf, legFlags, legIsBad, risingForm } from '../lib/groups.js'
import { comboStatus, legStatus, VERDICT_META } from '../lib/live.js'
import { americanToRawImplied, bestSingleBook } from '../lib/odds.js'
import { bookLabel } from '../lib/data.js'
import * as store from '../lib/storage.js'
import { toast } from './Toast.jsx'

const GROUP_GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }
const LOCK_STRAT_LABEL = { precision: 'Precision', matchup: 'Soft Matchup', mix: 'Best Mix', park: 'Park & Air', edge: 'Edge Stack' }

// The server-frozen bettable board, shown only AFTER the slate has started
// (final: true). Pregame it's redundant — the morning score lock already keeps
// the live combos below stable — but once games go live the builder hides
// started games, so this is the record of what the full board actually was.
function LockedBoard({ locked, batters, onSelect }) {
  const [open, setOpen] = useState(false)
  if (!locked?.final || !locked?.combos?.length) return null
  const byId = new Map()
  for (const b of batters || []) if (!byId.has(b.playerId)) byId.set(b.playerId, b)
  const at = new Date(locked.at)
  const time = Number.isFinite(at.getTime()) ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''
  return (
    <div className="locked-board final">
      <button className="locked-board-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="Lock" size={13} />
        <b>Locked board</b>
        <span className="locked-board-sub">
          {`frozen ${time} — the board as it stood at first pitch (${locked.combos.length} combos)`}
        </span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} className="locked-board-chev" />
      </button>
      {open && (
        <div className="locked-board-list">
          {locked.combos.map((c, i) => (
            <div className="locked-combo" key={`${c.strategy}-${c.size}-${i}`}>
              <span className="locked-strat">{LOCK_STRAT_LABEL[c.strategy] || c.strategy}</span>
              <span className="locked-size mono">{c.size}-leg</span>
              <span className="locked-legs">
                {c.legs.map((id) => {
                  const b = byId.get(id)
                  return b ? (
                    <button key={id} className="locked-leg" onClick={() => onSelect?.(b)} title={`${b.name} — open card`}>
                      {lastFirst(b.name)}
                    </button>
                  ) : (
                    <span key={id} className="locked-leg dim">#{id}</span>
                  )
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
const SIZE_TABS = [
  { k: 2, label: '2-leg' },
  { k: 3, label: '3-leg' },
  // Audited 2026-07-05: 4-legs went 1-for-110 with the SAME leg quality as
  // 2-legs (which cashed 12%) — the math, not the picks, kills them. Kept as
  // an explicitly-labeled lottery, not a core bet.
  { k: 4, label: '4-leg · lottery', lottery: true },
]
// How many combos to SHOW per size, strongest first.
const DISPLAY_CAP = { 2: 3, 3: 2, 4: 1 }

// Per-leg weakness checks (legFlags / legIsBad) are shared with the SGP tab —
// see ui/lib/groups.js.
// Score each leg + find the single weakest (lowest HR prob). Card tone: green
// when every leg is clean, red when a leg is really bad (the weakest one gets
// flagged), yellow for minor flags in between.
function assessCombo(g) {
  const legs = g.legs.map((b) => { const flags = legFlags(b); return { flags, bad: legIsBad(b, flags) } })
  const anyBad = legs.some((l) => l.bad)
  const anyFlag = legs.some((l) => l.flags.length)
  let weakestIdx = 0, minP = Infinity
  g.legs.forEach((b, i) => {
    const p = Number.isFinite(b.hrProbability) ? b.hrProbability : 1
    if (p < minP) { minP = p; weakestIdx = i }
  })
  return { legs, weakestIdx, tone: anyBad ? 'risk' : anyFlag ? 'caution' : 'tail' }
}

const STRAT_LABEL = { precision: 'Precision', mix: 'Best Mix', edge: 'Edge Stack', matchup: 'Soft Matchup', park: 'Park & Air', top: 'Top Picks', stack: 'Signal Stack', hot: 'Hot Hand', power: 'Power Bats' }

// Rolling combo scorecard — the real "have our combos hit?" record, graded
// server-side off frozen pregame combos vs actual HRs (server/parlay-combos.mjs).
function ScoreCard({ sc }) {
  if (!sc || !sc.days || !sc.overall?.combos) return null
  const sizes = Object.entries(sc.bySize || {})
    .filter(([k]) => Number(k) <= 4)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
  const strats = Object.entries(sc.byStrategy || {})
    .filter(([, v]) => v.combos > 0)
    .sort((a, b) => (b[1].hitRate ?? 0) - (a[1].hitRate ?? 0) || (b[1].legHitRate ?? 0) - (a[1].legHitRate ?? 0))
  const ov = sc.overall
  const ba = sc.bestAvailable
  // Estimated P&L at your stake: price each HR-prop leg at ≈+250 (decimal 3.5) —
  // a fair midpoint for these PRIME bats — and assume you bet every canonical
  // combo. Rough "are these +EV at my price" gauge; not exact (no odds feed).
  const PER_LEG_DEC = 3.5
  let stakeUnits = 0, returnUnits = 0
  for (const [k, v] of sizes) {
    stakeUnits += v.combos || 0
    returnUnits += (v.allHit || 0) * Math.pow(PER_LEG_DEC, Number(k))
  }
  const roi = stakeUnits ? (returnUnits - stakeUnits) / stakeUnits : 0
  const netAt = (stake) => Math.round((returnUnits - stakeUnits) * stake)
  return (
    <details className="combo-sc">
      <summary className="combo-sc-sum">
        <Icon name="Activity" size={13} />
        <span className="combo-sc-head">
          Combo scorecard · <b className="mono">{pct(ov.hitRate, 0)}</b> cashed
        </span>
        <span className="combo-sc-sub dim">
          {ov.allHit}/{ov.combos} combos · {sc.days}d
        </span>
        <Icon name="ChevronDown" size={14} className="combo-sc-chev" />
      </summary>
      <div className="combo-sc-body">
        <div className="combo-sc-cap dim">
          Canonical pregame combos (one per strategy &amp; size), graded against actual home runs.
        </div>
        {ba?.latest && (
          <div className="combo-sc-ba" title="The best perfect parlay that was sittable from the PRIME/STRONG pool — one bat per game that homered, capped at the max combo size. Gauges grading quality apart from which combos the strategies built.">
            <Icon name="Sparkles" size={12} />
            <span className="combo-sc-ba-txt">
              {ba.latest.n >= 2 ? (
                <>
                  Best {ba.latest.n}-leg available {ba.latest.date.slice(5)}: <b className="mono">{ba.latest.n}/{ba.latest.n}</b>
                  {ba.latest.legs?.length > 0 && (
                    <span className="dim"> · {ba.latest.legs.map((l) => lastFirst(l.name).split(',')[0]).join(' + ')}</span>
                  )}
                  {ba.latest.games > ba.latest.n && <span className="dim"> (+{ba.latest.games - ba.latest.n} more games)</span>}
                </>
              ) : (
                <span>Best available {ba.latest.date.slice(5)}: <span className="dim">no 2+ combo was sittable</span></span>
              )}
            </span>
            <span className="combo-sc-ba-days dim">won {ba.daysAvailable}/{ba.days}d</span>
          </div>
        )}
        <div className="combo-sc-rows">
          {sizes.map(([k, v]) => (
            <div className="combo-sc-row" key={k}>
              <span className="combo-sc-k">{k}-leg</span>
              <span className="combo-sc-bar">
                <span className="combo-sc-fill" style={{ width: `${Math.round((v.hitRate ?? 0) * 100)}%` }} />
              </span>
              <span className="combo-sc-v mono">{pct(v.hitRate, 0)}</span>
              <span className="combo-sc-n dim">{v.allHit}/{v.combos}</span>
            </div>
          ))}
        </div>
        {strats.length > 0 && (
          <>
            <div className="combo-sc-sec dim">By strategy</div>
            <div className="combo-sc-rows">
              {strats.map(([k, v]) => (
                <div className="combo-sc-row strat" key={k}>
                  <span className="combo-sc-k" title={`per-leg hit ${pct(v.legHitRate, 0)}`}>{STRAT_LABEL[k] || k}</span>
                  <span className="combo-sc-bar">
                    <span className="combo-sc-fill" style={{ width: `${Math.round((v.hitRate ?? 0) * 100)}%` }} />
                  </span>
                  <span className="combo-sc-v mono">{pct(v.hitRate, 0)}</span>
                  <span className="combo-sc-n dim">{v.allHit}/{v.combos}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {stakeUnits > 0 && (
          <div className="combo-sc-pnl">
            <div className="combo-sc-pnl-l">
              <span className="combo-sc-pnl-cap dim">Est. P&amp;L · every combo · ≈+250/leg</span>
              <span className={`combo-sc-roi ${roi >= 0 ? 'pos' : 'neg'}`}>{roi >= 0 ? '+' : ''}{(roi * 100).toFixed(0)}% ROI</span>
            </div>
            <div className="combo-sc-pnl-r dim">
              $5/combo → <b className={netAt(5) >= 0 ? 'pos' : 'neg'}>{netAt(5) >= 0 ? '+' : '−'}${Math.abs(netAt(5))}</b>
              {' · '}$10 → <b className={netAt(10) >= 0 ? 'pos' : 'neg'}>{netAt(10) >= 0 ? '+' : '−'}${Math.abs(netAt(10))}</b>
            </div>
          </div>
        )}
        <div className="combo-sc-best dim">Per-leg hit rate {pct(ov.legHitRate, 0)} · combos cash when every leg homers.</div>
      </div>
    </details>
  )
}

// Lineup-confirmation summary for the pool: distinct still-playable games and
// how many have their lineup posted. Drives the "as of" stamp.
function confirmSummary(batters) {
  const games = new Map() // gamePk -> confirmed?
  for (const b of batters || []) {
    if (b.gamePk == null || b.game?.isFinal || b.game?.isLive) continue
    const prev = games.get(b.gamePk) || false
    games.set(b.gamePk, prev || b.lineupConfirmed === true)
  }
  const total = games.size
  const confirmed = [...games.values()].filter(Boolean).length
  return { total, confirmed, allIn: total > 0 && confirmed === total }
}
const fmtTime = (iso) => {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET'
  } catch {
    return null
  }
}

// Cluster the slate's games into start WINDOWS — games within ~2.5h of the
// window's first pitch, so the latest leg's lineup posts before the earliest
// locks (a same-window combo confirms + locks together, no staggered-start
// trap). Span-based, matching the server grader (buildWindowBoards). Schedule-
// agnostic: splits day/night, getaway-day, and early/late-cluster slates.
const WINDOW_SPAN_MS = 2.5 * 3600e3
function computeWindows(gameList) {
  const sorted = (gameList || []).filter((g) => g.time).slice().sort((a, b) => a.time.localeCompare(b.time))
  const out = []
  for (const g of sorted) {
    const t = new Date(g.time).getTime()
    const last = out[out.length - 1]
    if (last && t - last.minT <= WINDOW_SPAN_MS) { // span from the window's START, not gap
      last.pks.add(g.gamePk); last.maxT = Math.max(last.maxT, t)
    } else {
      out.push({ pks: new Set([g.gamePk]), minT: t, maxT: t })
    }
  }
  const short = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })
  return out.map((w) => ({
    pks: w.pks,
    minT: w.minT,
    label: w.minT === w.maxT ? `${short(w.minT)}` : `${short(w.minT)}–${short(w.maxT).replace(/ /g, '')}`,
  }))
}

// Cross-Game HR Groups — auto-built multi-leg parlays, one best bat per game.
// Spread picker — from a size's combos, greedily choose a set that shares the
// FEWEST bats, so you get independent shots instead of the same anchors N times.
// Start with the strongest, then keep adding the combo that brings the most new
// bats (ties → higher all-hit). Caps the over-concentration the board produces.
function spreadPick(groups, n = 4) {
  const pool = [...groups].sort((a, b) => (b.allHit ?? 0) - (a.allHit ?? 0))
  const picked = []
  const used = new Set()
  while (picked.length < n && picked.length < pool.length) {
    let best = null, bestScore = -Infinity
    for (const g of pool) {
      if (picked.includes(g)) continue
      const ids = g.legs.map((b) => b.id)
      const overlap = ids.filter((id) => used.has(id)).length
      const fresh = ids.length - overlap
      const score = fresh * 100 - overlap * 60 + (g.allHit ?? 0) * 10
      if (score > bestScore) { bestScore = score; best = g }
    }
    if (!best) break
    picked.push(best)
    for (const b of best.legs) used.add(b.id)
  }
  return picked
}

export default function GroupsView({ batters, onSelect, selectedId, scorecard, generatedAt, windowMode = false, comboConf = 'off', favorConsistency = false, lockedBoard = null, slipSet = null, onToggleSlip = null, comboLock = false }) {
  const [size, setSize] = useState(2)
  const [games, setGames] = useState(() => new Set()) // empty = all games
  // Hide started defaults ON: HR props can't be bet pregame once the game is
  // live, so combos built on started games are usually unplaceable.
  const [hideStarted, setHideStarted] = useState(true)
  const [confirmedOnly, setConfirmedOnly] = useState(false)
  const [spread, setSpread] = useState(false) // de-correlated subset (min bat overlap)
  const [valueSort, setValueSort] = useState(false) // sort by EV when books are posted
  const [showAll, setShowAll] = useState(false)
  // windowMode (start-window grouping) is an app-level setting — see Settings.

  // Distinct, still-playable games in the pool — for the game selector.
  const gameList = useMemo(() => {
    const m = new Map()
    for (const b of batters || []) {
      if (b.gamePk == null || m.has(b.gamePk) || b.game?.isFinal) continue
      if (hideStarted && b.game?.isLive) continue
      const a = b.game?.awayTeam?.abbr
      const h = b.game?.homeTeam?.abbr
      m.set(b.gamePk, { gamePk: b.gamePk, label: a && h ? `${a}@${h}` : b.team || `#${b.gamePk}`, time: b.game?.gameDate || '' })
    }
    return [...m.values()].sort((x, y) => x.time.localeCompare(y.time) || x.label.localeCompare(y.label))
  }, [batters, hideStarted])

  const windows = useMemo(() => computeWindows(gameList), [gameList])
  // Multi-select: every window whose games are all currently picked. Drives the
  // window dropdown so you can combine two or more start windows into one pool.
  const selectedWindowIdxs = new Set(
    games.size ? windows.map((_, i) => i).filter((i) => [...windows[i].pks].every((pk) => games.has(pk))).map(String) : [],
  )
  const onWindows = (set) => {
    if (!set.size) { setGames(new Set()); return } // empty = all windows
    const next = new Set()
    for (const s of set) for (const pk of windows[Number(s)].pks) next.add(pk)
    setGames(next)
  }
  // With Windows on, land on the earliest window that can actually FORM a combo
  // (≥2 games) rather than the flickery all-games view. A lone early game (e.g. a
  // getaway day game) is its own 1-game window — landing there showed an empty
  // board even though the evening windows were full. One-time so it never fights
  // a tap; falls back to all-games if no window has 2+ games.
  const autoWindowed = useRef(false)
  useEffect(() => {
    if (windowMode && !autoWindowed.current && windows.length > 1 && games.size === 0) {
      const w = windows.find((win) => win.pks.size >= 2)
      if (w) setGames(new Set(w.pks)) // else keep all-games so combos still build
      autoWindowed.current = true
    }
  }, [windowMode, windows, games])

  // Restrict the combo pool: selected games (none = all), pregame-only and
  // confirmed-lineup-only when those chips are on.
  const pool = useMemo(
    () =>
      (batters || []).filter(
        (b) =>
          (!games.size || games.has(b.gamePk)) &&
          (!hideStarted || !b.game?.isLive) &&
          (!confirmedOnly || b.lineupConfirmed === true),
      ),
    [batters, games, hideStarted, confirmedOnly],
  )
  const conf = useMemo(() => confirmSummary(batters), [batters])
  const asOf = fmtTime(generatedAt)

  // Anti-flicker incumbency: remember the prior build's legs per strategy and
  // feed them back so a leg only changes when a challenger is clearly better
  // (see buildGroups' stickMargin). Keyed by slate day so it resets each morning;
  // stored as plain arrays (Sets don't serialize). Read from a ref so it doesn't
  // retrigger the build — we use last build's legs, then persist this build's.
  // Key incumbency by the ET slate day (not UTC) so night games crossing
  // midnight UTC don't roll the key mid-slate and reset the anti-flicker state.
  const slateDay = (generatedAt ? new Date(generatedAt) : new Date()).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const incKey = `combo-incumbents-${slateDay}`
  // Incumbency is ALSO scoped to the pool selection (windows + filter chips).
  // Sticky legs exist to steady rebuilds of the SAME pool across data
  // refreshes; carrying them across filter changes made the board
  // order-dependent — reaching the same window selection via different click
  // orders inherited different incumbents and showed different combos.
  const poolSig = `${[...games].sort((a, b) => a - b).join(',')}|${hideStarted ? 1 : 0}|${confirmedOnly ? 1 : 0}`
  const parseInc = (raw) => {
    const out = {}
    for (const [sig, m] of Object.entries(raw || {})) {
      if (!m || typeof m !== 'object' || Array.isArray(m)) continue // skip pre-scoping format
      out[sig] = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, new Set(Array.isArray(v) ? v : [])]))
    }
    return out
  }
  const incRef = useRef(null)
  if (incRef.current == null) incRef.current = parseInc(store.load(incKey, null))
  useEffect(() => {
    incRef.current = parseInc(store.load(incKey, null))
  }, [incKey])

  const bySize = useMemo(
    () => buildGroups(pool, { favorConsistency, incumbents: incRef.current[poolSig] || null, scorecard, applyComboLock: comboLock }),
    [pool, favorConsistency, scorecard, poolSig, comboLock],
  )

  // Persist this build's legs as next build's incumbents (for this pool only).
  useEffect(() => {
    incRef.current[poolSig] = legsByStrategy(bySize)
    store.save(
      incKey,
      Object.fromEntries(
        Object.entries(incRef.current).map(([sig, m]) => [sig, Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]))]),
      ),
    )
  }, [bySize, incKey, poolSig])
  const available = SIZE_TABS.filter((t) => bySize[t.k]?.length)
  const activeSize = bySize[size]?.length ? size : available[0]?.k
  const groups = activeSize ? bySize[activeSize] : []
  // Exposure across ALL sizes — the board recombines the same studs, so "tail
  // everything" is really betting 2-3 bats many times. Flag the over-represented.
  const exposure = useMemo(() => {
    const all = [2, 3, 4].flatMap((k) => bySize[k] || [])
    const count = new Map()
    for (const g of all) for (const b of g.legs) count.set(b.name, (count.get(b.name) || 0) + 1)
    const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2)
    return { total: all.length, top }
  }, [bySize])
  const overConc = exposure.top[0] && exposure.top[0][1] >= Math.max(4, Math.ceil(exposure.total * 0.35))
  // Whether any shown combo is fully priced — only then is a Value/EV sort useful.
  const anyPriced = groups.some((g) => g.ev != null)
  // EV-desc: priced combos first (best EV on top); unpriced fall back to all-hit.
  const byValue = (a, b) => {
    if (a.ev != null && b.ev != null) return b.ev - a.ev
    if (a.ev != null) return -1
    if (b.ev != null) return 1
    return (b.allHit ?? 0) - (a.allHit ?? 0)
  }
  const byProb = (a, b) => (b.allHit ?? 0) - (a.allHit ?? 0)
  // Spread mode: show a de-correlated subset instead of the full (overlapping) list.
  const shownGroups = spread
    ? spreadPick(groups, 4)
    : [...groups]
        .sort(valueSort && anyPriced ? byValue : byProb)
        .slice(0, showAll ? Infinity : (DISPLAY_CAP[activeSize] ?? Infinity))

  const toggleGame = (pk) =>
    setGames((prev) => {
      const next = new Set(prev)
      next.has(pk) ? next.delete(pk) : next.add(pk)
      return next
    })

  // Fused stacks: when two GREEN (no-warning) 2-leg combos on the board share
  // exactly one bat, offer their union as a 3-leg — "both 2-mans are green, so
  // here's the 3-man". Clean merges only (distinct games), best two by all-hit.
  const stacks = (() => {
    if (activeSize !== 2 || shownGroups.length < 2) return []
    const clean = shownGroups.filter((g) => assessCombo(g).tone === 'tail')
    const out = []
    const seen = new Set()
    for (let i = 0; i < clean.length; i++) {
      for (let j = i + 1; j < clean.length; j++) {
        const m = mergeGroups(clean[i], clean[j])
        if (!m) continue
        const sig = m.legs.map((x) => x.id).sort().join('|')
        if (seen.has(sig)) continue
        seen.add(sig)
        out.push(m)
      }
    }
    return out.sort((x, y) => (y.allHit ?? 0) - (x.allHit ?? 0)).slice(0, 2)
  })()

  // Shared domain for the per-card all-hit rails: every card's bar is scaled
  // against the same max, so the drop-off from card 1 to card 3 reads at a
  // glance (a per-card scale would make every bar look full).
  const allCards = [...shownGroups, ...stacks]
  const railMax = 1.2 * Math.max(0.01, ...allCards.map((g) => Math.max(g.allHit ?? 0, americanToRawImplied(g.american) ?? 0)))
  // How many SHOWN combos each bat appears in — ≥2 means tailing several
  // tickets is really re-betting that bat. Drives the ×N chip + hover linking.
  const legCount = new Map()
  for (const g of allCards) for (const b of g.legs) if (b.playerId != null) legCount.set(b.playerId, (legCount.get(b.playerId) || 0) + 1)
  const [hoverPid, setHoverPid] = useState(null)

  return (
    <>
      <ScoreCard sc={scorecard} />
      <LockedBoard locked={lockedBoard} batters={batters} onSelect={onSelect} />
      <div className={`grp-mode ${windowMode ? 'window' : 'full'}`}>
        <Icon name={windowMode ? 'Lock' : 'Layers'} size={12} />
        {windowMode ? (
          <span><b>Same-window combos</b> — every leg starts together, so each combo locks as one bettable ticket.</span>
        ) : (
          <span><b>Full board (benchmark)</b> — best bat per game across all games. Measures the model; legs may span start windows you can’t parlay as one ticket (those show <b>CROSS-WINDOW</b>, not LOCKED).</span>
        )}
      </div>
      {overConc && !spread && (
        <div className="grp-overlap">
          <Icon name="TriangleAlert" size={13} />
          <span className="grp-overlap-txt">
            <b>Heavy overlap</b> — {exposure.top.map(([n, c]) => `${n.split(' ').slice(-1)[0]} in ${c}`).join(', ')} of {exposure.total} combos. Tailing all isn’t diversifying — it’s betting those bats over and over.
          </span>
          <button className="grp-spread-btn" onClick={() => setSpread(true)}>Spread →</button>
        </div>
      )}
      {windowMode && windows.length > 1 ? (
        <div className="grp-games" role="group" aria-label="Filter by start window">
          <Select
            multi
            icon="Clock"
            ariaLabel="Filter by start window"
            title="Pick one or more start windows — same-window legs lock together"
            value={selectedWindowIdxs}
            onChange={onWindows}
            options={[{ value: '', label: 'All windows' }, ...windows.map((w, i) => ({ value: i, label: `${w.label} · ${w.pks.size}g` }))]}
          />
        </div>
      ) : (
        gameList.length > 1 && (
          <div className="grp-games" role="group" aria-label="Filter by game">
            <Select
              multi
              icon="List"
              ariaLabel="Filter by game"
              value={new Set([...games].map(String))}
              onChange={(set) => setGames(new Set([...set].map(Number)))}
              options={[{ value: '', label: 'All games' }, ...gameList.map((g) => ({ value: g.gamePk, label: g.label }))]}
            />
          </div>
        )
      )}
      <div className="grp-controls" role="group" aria-label="Group size">
        {available.map((t) => (
          <button
            key={t.k}
            className={`badge-toggle ${activeSize === t.k ? 'on' : ''}`}
            onClick={() => { setSize(t.k); setShowAll(false) }}
            title={t.lottery ? '4-leg all-hits went 1-for-110 all-time despite the same leg quality as 2-legs — the multiplication, not the picks, kills them. Small stakes only.' : undefined}
          >
            {t.lottery && <Icon name="Sparkles" size={11} style={{ marginRight: '3px', color: 'var(--prime)' }} />}
            {t.label}
          </button>
        ))}
        <span className="grp-ctrl-sep" aria-hidden="true" />
        <button
          className={`badge-toggle ${hideStarted ? 'on' : ''}`}
          onClick={() => setHideStarted((v) => !v)}
          aria-pressed={hideStarted}
          title="Only build combos from games that haven't started"
        >
          <Icon name="Clock" size={12} /> Hide started
        </button>
        <button
          className={`badge-toggle ${confirmedOnly ? 'on' : ''}`}
          onClick={() => setConfirmedOnly((v) => !v)}
          aria-pressed={confirmedOnly}
          title="Only batters in a confirmed lineup"
        >
          <Icon name="UserCheck" size={12} /> Confirmed only
        </button>
        <button
          className={`badge-toggle ${spread ? 'on' : ''}`}
          onClick={() => setSpread((v) => !v)}
          aria-pressed={spread}
          title="Show a de-correlated set — combos that share the fewest bats, so they're independent shots, not the same anchors repeated"
        >
          <Icon name="Layers" size={12} /> Spread
        </button>
        {anyPriced && (
          <button
            className={`badge-toggle ${valueSort ? 'on' : ''}`}
            onClick={() => setValueSort((v) => !v)}
            aria-pressed={valueSort}
            title="Sort by betting EV — model all-hit % against the posted parlay price (de-juiced). Needs books posted."
          >
            <Icon name="Percent" size={12} /> Value
          </button>
        )}
      </div>
      {available.length ? (
        <div className="grp-list">
          {spread ? (
            <div className="grp-trim dim">
              <b>Spread set</b> — {shownGroups.length} {activeSize}-leg combos chosen to share the fewest bats, so they're independent shots. Tap Spread off to see the full list.
            </div>
          ) : showAll && groups.length > (DISPLAY_CAP[activeSize] ?? Infinity) ? (
            <div className="grp-trim dim">
              Showing all {groups.length} {activeSize}-leg combos ·{' '}
              <button className="grp-trim-link" onClick={() => setShowAll(false)}>show fewer</button>
            </div>
          ) : groups.length > shownGroups.length && (
            <div className="grp-trim dim">
              Showing the top {shownGroups.length} {activeSize}-leg combos · {groups.length - shownGroups.length} weaker hidden ·{' '}
              <button className="grp-trim-link" onClick={() => setShowAll(true)}>show all</button>
            </div>
          )}
          {shownGroups.map((g, i) => (
            <GroupCard key={g.id} g={g} idx={i} onSelect={onSelect} selectedId={selectedId} comboConf={comboConf} slipSet={slipSet} onToggleSlip={onToggleSlip} railMax={railMax} legCount={legCount} hoverPid={hoverPid} onHoverPid={setHoverPid} />
          ))}
          {stacks.length > 0 && (
            <>
              <div className="grp-stack-divider dim">
                <Icon name="GitMerge" size={12} /> Two green 2-legs share a bat — the fused 3-man
              </div>
              {stacks.map((g, i) => (
                <GroupCard key={g.id} g={g} idx={shownGroups.length + i} onSelect={onSelect} selectedId={selectedId} comboConf={comboConf} slipSet={slipSet} onToggleSlip={onToggleSlip} railMax={railMax} legCount={legCount} hoverPid={hoverPid} onHoverPid={setHoverPid} />
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="empty-note">
          {games.size || confirmedOnly || hideStarted
            ? 'Not enough eligible batters with these filters — widen the games or turn a filter off.'
            : 'Not enough games to build cross-game groups.'}
        </div>
      )}
    </>
  )
}

function GroupCard({ g, idx = 0, onSelect, selectedId, comboConf = 'off', slipSet = null, onToggleSlip = null, railMax = null, legCount = null, hoverPid = null, onHoverPid = null }) {
  const allInSlip = !!slipSet && g.legs.length > 0 && g.legs.every((b) => slipSet.has(b.id))
  // Best one-ticket price: the headline `pays` multiplies each leg's best price
  // across different books; this is the best single book that prices every leg.
  const oneBook = bestSingleBook(g.legs)
  const implied = americanToRawImplied(g.american)
  const gc = GROUP_GRADE_COLOR[g.grade] || '#6b7787'
  const { legs: legInfo, weakestIdx, tone } = assessCombo(g)
  // Start-time spread: a parlay locks at the EARLIEST leg's first pitch, but a
  // much-later leg's lineup won't be posted by then — so you're forced to bet it
  // blind. Warn when legs are >2.5h apart (mixing an early + late game).
  const times = g.legs.map((b) => (b.game?.gameDate ? new Date(b.game.gameDate).getTime() : null)).filter(Boolean)
  const spreadHrs = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 3600e3 : 0
  const spreadWarn = spreadHrs > 2.5
  const earliestTime = times.length ? fmtTime(new Date(Math.min(...times)).toISOString()) : null
  const latestTime = times.length ? fmtTime(new Date(Math.max(...times)).toISOString()) : null
  const staggered = times.length >= 2 && Math.max(...times) > Math.min(...times)
  // Live tracking — once legs' games start, light the card up with a verdict.
  const live = comboStatus(g.legs)
  const lv = VERDICT_META[live.code]
  const title =
    tone === 'risk'
      ? `🔴 Weak leg — ${g.legs
          .map((b, i) => (legInfo[i].bad ? `${lastFirst(b.name).split(',')[0]}: ${legInfo[i].flags.join(', ') || 'long-shot HR%'}` : null))
          .filter(Boolean)
          .join(' · ')}`
      : tone === 'caution'
        ? `⚠️ Caution — ${g.legs
            .map((b, i) => (legInfo[i].flags.length ? `${lastFirst(b.name).split(',')[0]}: ${legInfo[i].flags.join(', ')}` : null))
            .filter(Boolean)
            .join(' · ')}`
        : '✅ Tail — every leg is clean'
  const cashed = live.started && g.legs.length > 0 && live.hits >= g.legs.length
  const oneAway = live.started && live.code === 'live' && live.n >= 2 && live.hits === live.n - 1
  const allConfirmed = g.legs.length > 0 && g.legs.every((b) => b.lineupConfirmed === true)
  return (
    <section
      className={`grp-card tone-${tone}${cashed ? ' cashed' : ''}${oneAway ? ' one-away' : ''}`}
      data-strat={g.strategy}
      style={{ '--gc': gc, '--i': Math.min(idx, 8) }}
      title={cashed ? '💰 CASHED — every leg homered' : oneAway ? '🔥 ONE AWAY — one more HR cashes this ticket' : title}
    >
      {live.started && (
        <div className="grp-progress" title={`${live.hits} of ${live.n} legs homered`}>
          <div className="grp-progress-fill" style={{ '--p': live.n ? live.hits / live.n : 0, background: cashed ? 'var(--strong)' : oneAway ? 'var(--prime)' : lv.color }} />
        </div>
      )}
      <header className="grp-head">
        <span className="grp-legbadge">{g.size}-LEG</span>
        <span className="grp-strategy">
          <Icon name={g.icon} size={13} /> {g.label}
        </span>
        {live.started ? (
          <span className="grp-live-tag" title={`Live: ${live.hits}/${live.n} legs homered`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', color: lv.color, background: `color-mix(in srgb, ${lv.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${lv.color} 35%, transparent)`, borderRadius: '5px', padding: '1px 6px' }}>
            <Icon name={lv.icon} size={10} className={live.code === 'live' ? 'spin-pulse' : ''} /> {lv.label} {live.hits}/{live.n}
          </span>
        ) : spreadWarn ? (
          <span className="grp-split-tag" title="Benchmark combo — its legs start in different windows (>2.5h apart), so it can't be locked as one clean ticket. Shown to measure the model, not to bet as a single parlay.">
            <Icon name="Layers" size={10} /> CROSS-WINDOW
          </span>
        ) : allConfirmed ? (
          <span className="grp-locked-tag" title="Every leg's lineup is confirmed — this is the final combo. Frozen at the morning lock and graded for the record.">
            <Icon name="Lock" size={10} /> LOCKED
          </span>
        ) : (
          <span className="grp-projected-tag" title={`Projected — ${g.legs.filter((b) => b.lineupConfirmed !== true).length} of ${g.legs.length} legs aren't in a confirmed lineup yet. The combo is frozen at the morning lock and won't drift, but a leg could still be scratched or moved down the order before first pitch.`}>
            <Icon name="Clock" size={10} /> PROJECTED
          </span>
        )}
        {comboConf === 'percent' && (
          <span className="grp-conf pct" title="Chance every leg homers (all-hit probability)">{pct(g.allHit, g.allHit < 0.01 ? 2 : 1)}</span>
        )}
        <span className={`grp-grade grade-glow-${g.grade}`} style={{ color: gc, borderColor: gc }}>{g.grade}</span>
        <button
          className="grp-copy"
          title="Copy this combo as text"
          onClick={(e) => {
            e.stopPropagation()
            const legsTxt = g.legs.map((b) => `${lastFirst(b.name).split(',')[0]}${b.odds?.best?.american ? ` ${american(b.odds.best.american)}` : ''}`).join(' + ')
            const line = `${g.size}-leg ${g.label}: ${legsTxt} — all-hit ${pct(g.allHit, g.allHit < 0.01 ? 2 : 1)}${oneBook ? ` · ${bookLabel(oneBook.book)} one-ticket ${american(oneBook.american)}` : g.american ? ` · pays ${american(g.american)}` : ''} (StatFax)`
            navigator.clipboard?.writeText(line).then(() => toast.success('Combo copied')).catch(() => toast.warn('Copy failed'))
          }}
        >
          <Icon name="Copy" size={12} />
        </button>
        {onToggleSlip && (
          <button
            className={`grp-tail${allInSlip ? ' on' : ''}`}
            title={allInSlip ? 'Every leg is already in your parlay slip' : 'Tail — drop every leg into your parlay slip'}
            onClick={(e) => {
              e.stopPropagation()
              const missing = g.legs.filter((b) => !slipSet?.has(b.id))
              if (!missing.length) {
                toast.info('Already in your slip')
                return
              }
              missing.forEach((b) => onToggleSlip(b))
              toast.success(`${missing.length} leg${missing.length > 1 ? 's' : ''} → parlay slip`)
            }}
          >
            <Icon name={allInSlip ? 'Check' : 'Plus'} size={12} /> Tail
          </button>
        )}
      </header>
      <div className="grp-sub dim">
        — {g.desc} · 1 per game · all-hit {pct(g.allHit, g.allHit < 0.01 ? 2 : 1)}
        {g.american && (
          <>
            {' · pays '}
            <b className="grp-pays" title="Best price per leg across ALL books multiplied — no single book pays this on one ticket">{american(g.american)}</b>
          </>
        )}
        {oneBook && (
          <span
            className="grp-onebook"
            title={`Best single book that prices every leg — an actually placeable ticket.\n${oneBook.perBook.slice(0, 3).map((x) => `${bookLabel(x.book)}: ${american(x.american)}`).join(' · ')}`}
          >
            {' · '}{bookLabel(oneBook.book)} <b className="mono">{american(oneBook.american)}</b> one ticket
          </span>
        )}
        {g.ev != null && (
          <span className={`grp-edge ${g.ev >= 0 ? 'pos' : 'neg'}`} title="Betting EV per $1 staked — model all-hit % × the posted parlay payout − 1">
            {' · '}{signedPct(g.ev, 0)} EV
          </span>
        )}
        {g.deJuicedEdge != null && (
          <span className={`grp-edge ${g.deJuicedEdge >= 0 ? 'pos' : 'neg'}`} title="Model all-hit % vs the de-vigged 'fair' market line — the book's hold removed">
            {' · '}{signedPct(g.deJuicedEdge, 1)} vs fair
          </span>
        )}
      </div>
      {railMax != null && Number.isFinite(g.allHit) && (
        <div className="grp-hitrail" title={implied != null ? `Model: hits ~1 in ${Math.max(1, Math.round(1 / g.allHit))} · priced like 1 in ${Math.max(1, Math.round(1 / implied))} — fill past the tick = the model likes it more than the price` : `Model: hits ~1 in ${Math.max(1, Math.round(1 / g.allHit))} — no full price posted`}>
        <div className="grp-hitrail-bar">
          <div className="grp-hitrail-fill" style={{ width: `${Math.min(100, (g.allHit / railMax) * 100)}%` }} />
          {implied != null && <span className="grp-hitrail-tick" style={{ left: `${Math.min(100, (implied / railMax) * 100)}%` }} />}
        </div>
        <span className="grp-hitrail-cap mono">
          ~1 in {Math.max(1, Math.round(1 / g.allHit))}
          {implied != null && (
            <span className={g.allHit >= implied ? 'pos' : 'neg'}> · priced 1 in {Math.max(1, Math.round(1 / implied))}</span>
          )}
        </span>
        </div>
      )}
      <ul className="grp-legs">
        {g.legs.map((b, i) => (
          <GroupLeg
            key={b.id}
            b={b}
            idx={i + 1}
            onSelect={onSelect}
            selected={selectedId === b.id}
            bad={legInfo[i].bad}
            weakest={i === weakestIdx && legInfo[i].bad}
            reasons={legInfo[i].flags}
            unconfirmed={b.lineupConfirmed !== true}
            dupCount={legCount?.get(b.playerId) || 0}
            sameBat={hoverPid != null && b.playerId === hoverPid}
            onHoverPid={onHoverPid}
          />
        ))}
      </ul>
      {staggered && (
        <footer className="grp-foot dim">
          <span className="grp-foot-lock" title="Each leg locks at its own game's first pitch. Until then an unconfirmed later leg can still change.">
            <Icon name="Lock" size={9} /> legs lock {earliestTime} → {latestTime}
          </span>
        </footer>
      )}
    </section>
  )
}

function GroupLeg({ b, idx, onSelect, selected, bad, weakest, reasons, unconfirmed, dupCount = 0, sameBat = false, onHoverPid = null }) {
  const hm = b.hotnessMultiplier
  const hotTone = hm > 1.02 ? 'good' : hm < 0.98 ? 'bad' : ''
  const hotLabel = hm > 1.02 ? 'HOT' : hm < 0.98 ? 'COLD' : 'NEU'
  const cond = b.parkWeatherHandFactor
  const condUp = cond >= 1.03
  const condDown = cond <= 0.97
  const era = b.pitcher?.season?.era
  const barrel = b.barrelPctBBE ?? b.barrelPct
  const iso = isoOf(b)
  const rising = risingForm(b)
  // Live leg status — glow on a HR (live OR already-final game, via homeredThisGame).
  const st = legStatus(b)
  const hrToday = st.code === 'hit'
  // Per-leg lock: a leg is locked once ITS game starts (first pitch) — on a full
  // board the legs are in different games, so they lock at different times.
  const lockIso = b.game?.gameDate
  const lockTime = lockIso ? fmtTime(lockIso) : null
  const legLocked = !!(b.game?.isFinal || b.game?.isLive)
  return (
    <li
      className={`grp-leg ${selected ? 'selected' : ''} ${bad ? 'weak-leg' : ''}${sameBat ? ' same-bat' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(b)}
      onMouseEnter={onHoverPid ? () => onHoverPid(b.playerId) : undefined}
      onMouseLeave={onHoverPid ? () => onHoverPid(null) : undefined}
      onFocus={onHoverPid ? () => onHoverPid(b.playerId) : undefined}
      onBlur={onHoverPid ? () => onHoverPid(null) : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(b)
        }
      }}
    >
      <span className="grp-ord mono">{idx}</span>
      <div className="grp-leg-body">
        <div className="grp-leg-l1">
          <span className={`grp-leg-name ${hrToday ? 'hr-glow' : ''}`}>{lastFirst(b.name)}</span>
          <span className="grp-team">{b.team}</span>
          {dupCount >= 2 && (
            <span className="grp-chip dup" title={`In ${dupCount} of the shown combos — tailing several tickets is re-betting this bat, not diversifying. Hover to light him up across cards.`}>
              ×{dupCount}
            </span>
          )}
          {hrToday ? (
            <span className="grp-chip" style={{ color: 'var(--strong)', background: 'color-mix(in srgb, var(--strong) 12%, transparent)', borderColor: 'color-mix(in srgb, var(--strong) 35%, transparent)' }} title="Homered today">
              <Icon name="Check" size={10} /> HR
            </span>
          ) : st.code === 'live' ? (
            <span className="grp-chip" style={{ color: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' }} title="Game in progress">
              <Icon name="Activity" size={10} /> {st.label}
            </span>
          ) : st.code === 'dead' ? (
            <span className="grp-chip" style={{ color: 'var(--text-faint)' }} title="Game final — no HR">no HR</span>
          ) : null}
          {unconfirmed && (
            <span className="grp-chip unconf" title="Lineup not posted yet — this bat isn't confirmed in the order. Combo can still change before first pitch.">
              <Icon name="Clock" size={10} /> NO LINEUP
            </span>
          )}
          {bad && (
            <span className="grp-chip weak" title={`Weak leg — ${reasons?.length ? reasons.join(' · ') : 'long-shot HR%'} — most likely to sink this parlay`}>
              <Icon name="TriangleAlert" size={10} /> {weakest ? 'WEAKEST' : 'WEAK'}
            </span>
          )}
          {b.hot && <Icon name="Flame" size={12} className="grp-fire" />}
          {rising && (
            <span
              className="grp-chip rising"
              title={`Rising — L14 barrel ${rising.recent.toFixed(0)}% vs ${rising.season.toFixed(0)}% season (+${rising.delta.toFixed(0)} pts). Heating up right now.`}
            >
              <Icon name="TrendingUp" size={10} /> RISING
            </span>
          )}
          {b.blast && (
            <span
              className="grp-chip blast"
              title={[
                `Blasting ${num(blastOf(b), 0)}% lately — fast, squared-up contact (bat tracking)`,
                blastVsHandOf(b) != null ? `vs ${b.batTracking?.vsHand}HP ${num(blastVsHandOf(b), 0)}%` : null,
                blastMixOf(b) != null ? `vs his mix ${num(blastMixOf(b), 0)}%` : null,
              ].filter(Boolean).join(' · ')}
            >
              <Icon name="Zap" size={10} /> BLAST
            </span>
          )}
          {(condUp || condDown) && <span className={`grp-chip ${condUp ? 'good' : 'bad'}`}>COND{condUp ? '↑' : '↓'}</span>}
          {b.primaryPitchEdge?.passes && (
            <span className="grp-chip pitch" title={`Mashes the ${b.primaryPitchEdge.pitchName || 'top'} pitch`}>
              <Icon name="Crosshair" size={10} />
            </span>
          )}
        </div>
        <div className="grp-leg-l2 dim">
          vs {b.pitcher?.name || 'TBD'}
          {era != null && (
            <>
              {' · '}
              <b className="grp-era">ERA {num(era, 2)}</b>
            </>
          )}
          {barrel != null && (
            <>
              {' · '}
              <Icon name="Crosshair" size={10} /> {num(barrel, 0)}% barrel
            </>
          )}
          {iso != null && <> · ISO {rate(iso)}</>}
          {lockTime && (
            <span
              className={`grp-leg-lock ${legLocked ? 'locked' : unconfirmed ? 'pending' : ''}`}
              title={
                legLocked
                  ? 'Game underway — this leg is locked'
                  : unconfirmed
                    ? `Lineup not posted — this leg can still change until first pitch (${lockTime})`
                    : `This leg locks at its first pitch (${lockTime})`
              }
            >
              {' · '}
              <Icon name="Lock" size={9} /> {legLocked ? 'locked' : `locks ${lockTime}`}
            </span>
          )}
        </div>
      </div>
      <div className="grp-leg-right">
        {hotTone && <span className={`grp-mult ${hotTone}`}>{hotLabel} {num(hm, 2)}×</span>}
        <span className="grp-prob mono">{pct(b.hrProbability, 2)}</span>
        <GradeChip grade={b.grade} size="sm" score={b.score} />
      </div>
    </li>
  )
}
