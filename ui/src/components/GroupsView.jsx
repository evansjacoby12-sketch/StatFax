import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct, num, rate, american, signedPct } from '../lib/format.js'
import { buildGroups, lastFirst, isoOf, blastOf, blastMixOf, blastVsHandOf } from '../lib/groups.js'
import { useLiveMode } from '../lib/liveMode.js'

const GROUP_GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }
// 4-leg is treated as a lottery and hidden from the bettable board (the server
// still grades it for the record). 2-leg is the cashable tier, 3-leg the stretch.
const SIZE_TABS = [2, 3].map((k) => ({ k, label: `${k}-leg` }))
// How many combos to SHOW per size, strongest first. 2-leg shows all; 3-leg trims.
const DISPLAY_CAP = { 2: Infinity, 3: 5 }

// Per-leg weakness — the same checks as the manual combo audits, but scored on
// ONE leg so the card can point at *which* leg is the risk, not just glow.
const STINGY_HR9 = 0.85
const LOW_BARREL = 13
const PITCHER_PARK = 0.92
const LONGSHOT_PROB = 0.18
function legFlags(b) {
  const f = []
  const grade = b.grade?.label || b.grade
  const sb = Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct
  const hr9 = b.pitcher?.season?.hrPer9
  const park = b.gameParkHRFactor
  if (grade !== 'PRIME') f.push(`${grade || 'SKIP'} (not PRIME)`)
  if (Number.isFinite(sb) && sb < LOW_BARREL) f.push(`low barrel ${sb.toFixed(0)}%`)
  if (Number.isFinite(hr9) && hr9 < STINGY_HR9) f.push(`HR-stingy arm ${hr9.toFixed(2)}`)
  if (Number.isFinite(park) && park <= PITCHER_PARK) f.push(`pitcher's park ${park.toFixed(2)}`)
  return f
}
// "Really bad" = a leg likely to sink the whole parlay: a long-shot HR prob, a
// tiny barrel under a sub-PRIME grade, or 2+ flags stacking. These turn the card
// red and earn the leg a WEAK badge.
function legIsBad(b, flags = legFlags(b)) {
  const grade = b.grade?.label || b.grade
  const sb = Number.isFinite(b.barrelPctBBE) ? b.barrelPctBBE : b.barrelPct
  if (Number.isFinite(b.hrProbability) && b.hrProbability < LONGSHOT_PROB) return true
  if (grade !== 'PRIME' && Number.isFinite(sb) && sb < 8) return true
  return flags.length >= 2
}
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

const STRAT_LABEL = { top: 'Top Picks', mix: 'Best Mix', stack: 'Signal Stack', hot: 'Hot Hand', power: 'Power Bats', matchup: 'Soft Matchup', park: 'Park & Air' }

// Rolling combo scorecard — the real "have our combos hit?" record, graded
// server-side off frozen pregame combos vs actual HRs (server/parlay-combos.mjs).
function ScoreCard({ sc }) {
  if (!sc || !sc.days || !sc.overall?.combos) return null
  const sizes = Object.entries(sc.bySize || {})
    .filter(([k]) => Number(k) <= 3) // 4-leg is a lotto — excluded from the board + P&L
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

// Cross-Game HR Groups — auto-built multi-leg parlays, one best bat per game.
export default function GroupsView({ batters, onSelect, selectedId, scorecard, generatedAt }) {
  const [size, setSize] = useState(2)
  const [games, setGames] = useState(() => new Set()) // empty = all games
  // Hide started defaults ON: HR props can't be bet pregame once the game is
  // live, so combos built on started games are usually unplaceable.
  const [hideStarted, setHideStarted] = useState(true)
  const [confirmedOnly, setConfirmedOnly] = useState(false)

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
  const bySize = useMemo(() => buildGroups(pool), [pool])
  const available = SIZE_TABS.filter((t) => bySize[t.k]?.length)
  const activeSize = bySize[size]?.length ? size : available[0]?.k
  const groups = activeSize ? bySize[activeSize] : []
  // Display cap: strongest-first, trimmed per size (4-leg lottery → top 3).
  const shownGroups = [...groups]
    .sort((a, b) => (b.allHit ?? 0) - (a.allHit ?? 0))
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
      {gameList.length > 1 && (
        <div className="grp-games" role="group" aria-label="Filter by game">
          <button className={`badge-toggle ${games.size === 0 ? 'on' : ''}`} onClick={() => setGames(new Set())}>
            All games
          </button>
          {gameList.map((g) => (
            <button
              key={g.gamePk}
              className={`badge-toggle ${games.has(g.gamePk) ? 'on' : ''}`}
              onClick={() => toggleGame(g.gamePk)}
            >
              {g.label}
            </button>
          ))}
        </div>
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
      </div>
      {available.length ? (
        <div className="grp-list">
          {shownGroups.map((g) => (
            <GroupCard key={g.id} g={g} onSelect={onSelect} selectedId={selectedId} />
          ))}
          {groups.length > shownGroups.length && (
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

function GroupCard({ g, onSelect, selectedId }) {
  const gc = GROUP_GRADE_COLOR[g.grade] || '#6b7787'
  const names = g.legs.map((b) => lastFirst(b.name).split(',')[0]).join(' + ')
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
        {provisional && <span className="grp-prov-tag"><Icon name="Clock" size={10} /> PROVISIONAL</span>}
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
        {g.edge != null && (
          <span className={`grp-edge ${g.edge >= 0 ? 'pos' : 'neg'}`}> · {signedPct(g.edge, 0)} edge</span>
        )}
      </div>
      {spreadWarn && (
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
      <footer className="grp-foot dim">
        {g.size}-leg {g.label} · {names}
      </footer>
    </section>
  )
}

function GroupLeg({ b, idx, onSelect, selected, bad, weakest, reasons, unconfirmed }) {
  const liveMode = useLiveMode()
  const hm = b.hotnessMultiplier
  const hotTone = hm > 1.02 ? 'good' : hm < 0.98 ? 'bad' : ''
  const hotLabel = hm > 1.02 ? 'HOT' : hm < 0.98 ? 'COLD' : 'NEU'
  const cond = b.parkWeatherHandFactor
  const condUp = cond >= 1.03
  const condDown = cond <= 0.97
  const era = b.pitcher?.season?.era
  const barrel = b.barrelPctBBE ?? b.barrelPct
  const iso = isoOf(b)
  const hrToday = liveMode && b.liveContext?.isHRThisGame
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
              <Icon name="Crosshair" size={10} /> {num(barrel, 0)}%
            </>
          )}
          {blastOf(b) != null && (
            <>
              {' · '}
              <span className={b.blast ? 'grp-blast-hot' : ''}><Icon name="Zap" size={10} /> {num(blastOf(b), 0)}%</span>
            </>
          )}
          {blastMixOf(b) != null && (
            <span className="grp-blast-mix" title="Blast rate vs the exact pitch mix today's starter throws (usage-weighted)">
              {' · '}vs mix {num(blastMixOf(b), 0)}%
            </span>
          )}
          {iso != null && <> · ISO {rate(iso)}</>}
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
