import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct, num, rate, american, signedPct } from '../lib/format.js'
import { buildGroups, lastFirst, isoOf } from '../lib/groups.js'
import { useLiveMode } from '../lib/liveMode.js'

const GROUP_GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }
const SIZE_TABS = [2, 3, 4].map((k) => ({ k, label: `${k}-leg` }))

const STRAT_LABEL = { top: 'Top Picks', mix: 'Best Mix', stack: 'Signal Stack', hot: 'Hot Hand', power: 'Power Bats', matchup: 'Soft Matchup', park: 'Park & Air' }

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
        <div className="combo-sc-best dim">Per-leg hit rate {pct(ov.legHitRate, 0)} · combos cash when every leg homers.</div>
      </div>
    </details>
  )
}

// Cross-Game HR Groups — auto-built multi-leg parlays, one best bat per game.
export default function GroupsView({ batters, onSelect, selectedId, scorecard }) {
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
  const bySize = useMemo(() => buildGroups(pool), [pool])
  const available = SIZE_TABS.filter((t) => bySize[t.k]?.length)
  const activeSize = bySize[size]?.length ? size : available[0]?.k
  const groups = activeSize ? bySize[activeSize] : []

  const toggleGame = (pk) =>
    setGames((prev) => {
      const next = new Set(prev)
      next.has(pk) ? next.delete(pk) : next.add(pk)
      return next
    })

  return (
    <>
      <ScoreCard sc={scorecard} />
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
          {groups.map((g) => (
            <GroupCard key={g.id} g={g} onSelect={onSelect} selectedId={selectedId} />
          ))}
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
  return (
    <section className="grp-card" style={{ '--gc': gc }}>
      <header className="grp-head">
        <span className="grp-legbadge">{g.size}-LEG</span>
        <span className="grp-strategy">
          <Icon name={g.icon} size={13} /> {g.label}
        </span>
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
      <ul className="grp-legs">
        {g.legs.map((b, i) => (
          <GroupLeg key={b.id} b={b} idx={i + 1} onSelect={onSelect} selected={selectedId === b.id} />
        ))}
      </ul>
      <footer className="grp-foot dim">
        {g.size}-leg {g.label} · {names}
      </footer>
    </section>
  )
}

function GroupLeg({ b, idx, onSelect, selected }) {
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
      className={`grp-leg ${selected ? 'selected' : ''}`}
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
          {b.hot && <Icon name="Flame" size={12} className="grp-fire" />}
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
          {iso != null && <> · ISO {rate(iso)}</>}
        </div>
      </div>
      <div className="grp-leg-right">
        {hotTone && <span className={`grp-mult ${hotTone}`}>{hotLabel} {num(hm, 2)}×</span>}
        <span className="grp-prob mono">{pct(b.hrProbability, 1)}</span>
        <GradeChip grade={b.grade} size="sm" score={b.score} />
      </div>
    </li>
  )
}
