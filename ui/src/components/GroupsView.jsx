import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct, num, rate, american, signedPct } from '../lib/format.js'
import { buildGroups, lastFirst, isoOf } from '../lib/groups.js'
import { useLiveMode } from '../lib/liveMode.js'

const GROUP_GRADE_COLOR = { S: '#f5a623', A: '#32d74b', B: '#3b82f6', C: '#9aa6b6', D: '#6b7787' }
const SIZE_TABS = [
  { k: 2, label: '2-leg' },
  { k: 3, label: '3-leg' },
  { k: 4, label: '4-leg' },
]

// Cross-Game HR Groups — auto-built multi-leg parlays, one best bat per game.
export default function GroupsView({ batters, onSelect, selectedId }) {
  const [size, setSize] = useState(2)
  const [games, setGames] = useState(() => new Set()) // empty = all games

  // Distinct, still-playable games in the pool — for the game selector.
  const gameList = useMemo(() => {
    const m = new Map()
    for (const b of batters || []) {
      if (b.gamePk == null || m.has(b.gamePk) || b.game?.isFinal) continue
      const a = b.game?.awayTeam?.abbr
      const h = b.game?.homeTeam?.abbr
      m.set(b.gamePk, { gamePk: b.gamePk, label: a && h ? `${a}@${h}` : b.team || `#${b.gamePk}`, time: b.game?.gameDate || '' })
    }
    return [...m.values()].sort((x, y) => x.time.localeCompare(y.time) || x.label.localeCompare(y.label))
  }, [batters])

  // Restrict the combo pool to the selected games (none selected = all games).
  const pool = useMemo(
    () => (games.size ? (batters || []).filter((b) => games.has(b.gamePk)) : batters),
    [batters, games],
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
      </div>
      {available.length ? (
        <div className="grp-list">
          {groups.map((g) => (
            <GroupCard key={g.id} g={g} onSelect={onSelect} selectedId={selectedId} />
          ))}
        </div>
      ) : (
        <div className="empty-note">
          {games.size ? 'Pick at least 2 games to build a combo.' : 'Not enough games to build cross-game groups.'}
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
