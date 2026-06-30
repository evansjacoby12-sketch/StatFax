import { useMemo, useState, useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import Select from './Select.jsx'
import { pct, num, rate, american, signedPct } from '../lib/format.js'
import { buildGroups, legsByStrategy, lastFirst, isoOf, blastOf, blastMixOf, blastVsHandOf, legFlags, legIsBad, risingForm } from '../lib/groups.js'
import { comboStatus, legStatus, VERDICT_META } from '../lib/live.js'
import * as store from '../lib/storage.js'

const GROUP_GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }
const SIZE_TABS = [2, 3, 4].map((k) => ({ k, label: `${k}-leg` }))
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
        {Number.isFinite(ov.predHitRate) && (() => {
          const d = ov.hitRate - ov.predHitRate
          const tone = d >= 0.02 ? 'pos' : d <= -0.02 ? 'neg' : ''
          const label = d >= 0.02 ? 'beating the model' : d <= -0.02 ? 'under the model' : 'on the model'
          return (
            <div className="combo-sc-calib">
              <Icon name="Target" size={12} />
              <span>Actual <b className="mono">{pct(ov.hitRate, 0)}</b> vs predicted <b className="mono">{pct(ov.predHitRate, 0)}</b></span>
              <span className={`combo-sc-calib-tag ${tone}`}>{label}</span>
            </div>
          )
        })()}
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
                {Number.isFinite(v.predHitRate) && (
                  <span className="combo-sc-pred-tick" style={{ left: `${Math.min(100, Math.round(v.predHitRate * 100))}%` }} title={`predicted ${pct(v.predHitRate, 0)}`} />
                )}
              </span>
              <span className="combo-sc-v mono">{pct(v.hitRate, 0)}</span>
              <span className="combo-sc-n dim">{v.allHit}/{v.combos}{Number.isFinite(v.predHitRate) ? ` · exp ${pct(v.predHitRate, 0)}` : ''}</span>
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
                    {Number.isFinite(v.predHitRate) && (
                      <span className="combo-sc-pred-tick" style={{ left: `${Math.min(100, Math.round(v.predHitRate * 100))}%` }} title={`predicted ${pct(v.predHitRate, 0)}`} />
                    )}
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
// how many have their lineup posted. Early in the day (no lineups) the board is
// PROVISIONAL — its bats shift as lineups/probables confirm, so combos locked
// then often aren't the ones that grade. This drives the "as of" stamp + guard.
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
// Combo confidence — Stars (quality: clean tail of strong legs → 5★, dinged by
// caution/weak flags and weaker legs) and % (the real all-hit chance, g.allHit).
function comboStars(g, tone) {
  const probs = g.legs.map((b) => b.hrProbability).filter(Number.isFinite)
  const avg = probs.length ? probs.reduce((s, p) => s + p, 0) / probs.length : 0
  const normP = Math.min(1, Math.max(0, (avg - 0.15) / (0.27 - 0.15)))
  const penalty = tone === 'risk' ? 0.45 : tone === 'caution' ? 0.2 : 0
  const conf = Math.min(1, Math.max(0, normP - penalty))
  return Math.max(1, Math.round(1 + conf * 4))
}

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

export default function GroupsView({ batters, onSelect, selectedId, scorecard, generatedAt, windowMode = false, comboConf = 'off', favorConsistency = false }) {
  const [size, setSize] = useState(2)
  const [games, setGames] = useState(() => new Set()) // empty = all games
  // Hide started defaults ON: HR props can't be bet pregame once the game is
  // live, so combos built on started games are usually unplaceable.
  const [hideStarted, setHideStarted] = useState(true)
  const [confirmedOnly, setConfirmedOnly] = useState(false)
  const [spread, setSpread] = useState(false) // de-correlated subset (min bat overlap)
  const [valueSort, setValueSort] = useState(false) // sort by EV when books are posted
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
  // With Windows on, land on the EARLY window by default (once) rather than the
  // flickery all-games view — the all-slate board churns as unconfirmed late
  // games wobble, the window board is stable. One-time so it never fights a tap.
  const autoWindowed = useRef(false)
  useEffect(() => {
    if (windowMode && !autoWindowed.current && windows.length > 1 && games.size === 0) {
      setGames(new Set(windows[0].pks))
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
  const incRef = useRef(null)
  if (incRef.current == null) {
    const raw = store.load(incKey, null) || {}
    incRef.current = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, new Set(v)]))
  }
  useEffect(() => {
    const raw = store.load(incKey, null) || {}
    incRef.current = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, new Set(v)]))
  }, [incKey])

  const bySize = useMemo(
    () => buildGroups(pool, { favorConsistency, incumbents: incRef.current, scorecard }),
    [pool, favorConsistency, scorecard],
  )

  // Persist this build's legs as next build's incumbents.
  useEffect(() => {
    const legs = legsByStrategy(bySize)
    incRef.current = legs
    store.save(incKey, Object.fromEntries(Object.entries(legs).map(([k, v]) => [k, [...v]])))
  }, [bySize, incKey])
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
        .slice(0, DISPLAY_CAP[activeSize] ?? Infinity)

  const toggleGame = (pk) =>
    setGames((prev) => {
      const next = new Set(prev)
      next.has(pk) ? next.delete(pk) : next.add(pk)
      return next
    })

  return (
    <>
      <ScoreCard sc={scorecard} />
      {conf.total > 0 && (
        <div className={`grp-stamp ${conf.allIn ? 'ready' : 'provisional'}`}>
          <Icon name={conf.allIn ? 'UserCheck' : 'Clock'} size={13} />
          <span className="grp-stamp-txt">
            {conf.allIn ? (
              <><b>Lineups in</b> ({conf.confirmed}/{conf.total} games) — combos are bettable</>
            ) : (
              <><b>Provisional board</b> — {conf.confirmed}/{conf.total} lineups confirmed. Bats shift as lineups post; wait before betting.</>
            )}
          </span>
          {asOf && <span className="grp-stamp-time dim">as of {asOf}</span>}
        </div>
      )}
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
          <button key={t.k} className={`badge-toggle ${activeSize === t.k ? 'on' : ''}`} onClick={() => setSize(t.k)}>
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
          {shownGroups.map((g) => (
            <GroupCard key={g.id} g={g} onSelect={onSelect} selectedId={selectedId} comboConf={comboConf} />
          ))}
          {spread ? (
            <div className="grp-trim dim">
              <b>Spread set</b> — {shownGroups.length} {activeSize}-leg combos chosen to share the fewest bats, so they're independent shots. Tap Spread off to see the full list.
            </div>
          ) : groups.length > shownGroups.length && (
            <div className="grp-trim dim">
              Showing the top {shownGroups.length} {activeSize}-leg combos · {groups.length - shownGroups.length} weaker hidden ({activeSize}-leg is a longshot tier)
            </div>
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

function GroupCard({ g, onSelect, selectedId, comboConf = 'off' }) {
  const gc = GROUP_GRADE_COLOR[g.grade] || '#6b7787'
  const { legs: legInfo, weakestIdx, tone } = assessCombo(g)
  // Provisional = a leg's lineup isn't posted yet, so this combo can still
  // reshuffle before first pitch — not safe to bet (the 6 AM-board trap).
  const unconfirmed = g.legs.filter((b) => b.lineupConfirmed !== true)
  const provisional = unconfirmed.length > 0
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
  return (
    <section
      className={`grp-card tone-${tone} ${provisional ? 'provisional' : ''}`}
      style={{ '--gc': gc }}
      title={provisional ? `⏳ Provisional — lineup not posted for ${unconfirmed.map((b) => lastFirst(b.name).split(',')[0]).join(', ')}. Can still reshuffle before first pitch.` : title}
    >
      <header className="grp-head">
        <span className="grp-legbadge">{g.size}-LEG</span>
        <span className="grp-strategy">
          <Icon name={g.icon} size={13} /> {g.label}
        </span>
        {live.started ? (
          <span className="grp-live-tag" title={`Live: ${live.hits}/${live.n} legs homered`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '10px', fontWeight: '800', color: lv.color, background: `color-mix(in srgb, ${lv.color} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${lv.color} 35%, transparent)`, borderRadius: '5px', padding: '1px 6px' }}>
            <Icon name={lv.icon} size={10} className={live.code === 'live' ? 'spin-pulse' : ''} /> {lv.label} {live.hits}/{live.n}
          </span>
        ) : provisional ? (
          <span className="grp-prov-tag"><Icon name="Clock" size={10} /> PROVISIONAL</span>
        ) : spreadWarn ? (
          <span className="grp-split-tag" title="Benchmark combo — its legs start in different windows (>2.5h apart), so it can't be locked as one clean ticket. Shown to measure the model, not to bet as a single parlay.">
            <Icon name="Layers" size={10} /> CROSS-WINDOW
          </span>
        ) : (
          <span className="grp-locked-tag" title="All lineups confirmed and every leg starts together — this combo locks in as one bettable ticket, and it's the version graded for the record.">
            <Icon name="Lock" size={10} /> LOCKED
          </span>
        )}
        {comboConf === 'stars' && (() => { const s = comboStars(g, tone); return (
          <span className="grp-conf" title={`Confidence ${s}/5 — combo quality (leg strength minus caution/weak flags)`}>
            {'★'.repeat(s)}<span className="grp-conf-off">{'★'.repeat(5 - s)}</span>
          </span>
        ) })()}
        {comboConf === 'percent' && (
          <span className="grp-conf pct" title="Chance every leg homers (all-hit probability)">{pct(g.allHit, g.allHit < 0.01 ? 2 : 1)}</span>
        )}
        <span className="grp-grade" style={{ color: gc, borderColor: gc }}>{g.grade}</span>
      </header>
      <div className="grp-sub dim">
        — {g.desc} · 1 per game · all-hit {pct(g.allHit, g.allHit < 0.01 ? 2 : 1)}
        {g.american && (
          <>
            {' · pays '}
            <b className="grp-pays">{american(g.american)}</b>
          </>
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
      {spreadWarn && !provisional && (
        <div className="grp-spread-warn" title="A parlay locks at the earliest leg's first pitch. The later game's lineup won't be posted by then, so you'd bet that leg before its lineup is confirmed.">
          <Icon name="Clock" size={11} /> Legs {spreadHrs.toFixed(1)}h apart — ticket locks at {earliestTime}, but the late leg's lineup won't be set yet
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

function GroupLeg({ b, idx, onSelect, selected, bad, weakest, reasons, unconfirmed }) {
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
      className={`grp-leg ${selected ? 'selected' : ''} ${bad ? 'weak-leg' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect(b)}
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
