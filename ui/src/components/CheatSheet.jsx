import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct, num, rate, signedPct } from '../lib/format.js'

const isDayGame = (b) => {
  const gd = b.game?.gameDate
  if (!gd) return null
  const h = new Date(gd).getUTCHours()
  return h >= 14 && h < 22
}
const live = (b) => !b.game?.isFinal
const lastName = (n) => (n || '').trim().split(/\s+/).slice(-1)[0]

// One leaderboard card. `items` = [{ key, name, meta, badge?, val, onClick? }].
function LbCard({ title, sub, icon, items }) {
  if (!items?.length) return null
  return (
    <section className="splits-card">
      <h4 className="splits-h">
        <Icon name={icon} size={14} /> {title}
        {sub && <span className="splits-sub dim">{sub}</span>}
      </h4>
      <ol className="splits-list">
        {items.map((it, i) => (
          <li
            key={it.key}
            className={`splits-row ${it.onClick ? '' : 'static'}`}
            role={it.onClick ? 'button' : undefined}
            tabIndex={it.onClick ? 0 : undefined}
            onClick={it.onClick}
            onKeyDown={(e) => {
              if (it.onClick && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                it.onClick()
              }
            }}
          >
            <span className="splits-rank mono">{i + 1}</span>
            <span className="splits-name">{it.name}</span>
            <span className="splits-team">{it.meta}</span>
            {it.badge || <span />}
            <span className="splits-val mono">{it.val}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

// A batter leaderboard → LbCard items (top 10 by `get`, optional filter/minAb).
function batterBoard(batters, { get, fmt, filter, ab, minAb = 0, onSelect }) {
  return (batters || [])
    .filter((b) => live(b) && Number.isFinite(get(b)) && (!filter || filter(b)) && (!minAb || (ab?.(b) ?? 0) >= minAb))
    .sort((a, b) => get(b) - get(a))
    .slice(0, 10)
    .map((b) => ({
      key: b.id,
      name: b.name,
      meta: b.team,
      badge: <GradeChip grade={b.grade} size="sm" />,
      val: fmt(get(b)),
      onClick: () => onSelect(b),
    }))
}

export default function CheatSheet({ batters, onSelect, onOpenPitcher }) {
  const data = useMemo(() => {
    const b = batters || []
    // Unique starters this slate (a batter faces the opposing starter).
    const pmap = new Map()
    for (const x of b) {
      const p = x.pitcher
      if (!p?.id || !live(x)) continue
      const key = `${p.id}-${x.gamePk}`
      if (!pmap.has(key)) {
        const a = x.game?.awayTeam?.abbr
        const h = x.game?.homeTeam?.abbr
        pmap.set(key, { id: p.id, gamePk: x.gamePk, name: p.name, hr9: p.season?.hrPer9, era: p.season?.era, matchup: a && h ? `${a}@${h}` : x.opponent?.abbr || '' })
      }
    }
    // Unique games for park environment.
    const gmap = new Map()
    for (const x of b) {
      if (!live(x) || x.gamePk == null || gmap.has(x.gamePk)) continue
      const a = x.game?.awayTeam?.abbr
      const h = x.game?.homeTeam?.abbr
      gmap.set(x.gamePk, { gamePk: x.gamePk, label: a && h ? `${a} @ ${h}` : '', park: x.gameParkHRFactor, venue: x.game?.venueName })
    }
    return { pitchers: [...pmap.values()], games: [...gmap.values()] }
  }, [batters])

  const B = (cfg) => batterBoard(batters, { ...cfg, onSelect })

  // ── Batters ──
  const topHR = B({ get: (b) => b.hrProbability, fmt: (v) => pct(v, 1) })
  const barrels = B({ get: (b) => b.barrelPctBBE ?? b.barrelPct, fmt: (v) => `${num(v, 1)}%` })
  const exitVelo = B({ get: (b) => b.exitVelo, fmt: (v) => `${num(v, 1)}` })
  const hot = B({ get: (b) => b.recent7?.iso, fmt: (v) => rate(v), filter: (b) => (b.recent7?.ab ?? 0) >= 8 })
  const penMash = B({
    get: (b) => b.bullpenSplits?.rpHrRate,
    fmt: (v) => pct(v, 1),
    filter: (b) => (b.bullpenSplits?.rpAb ?? 0) >= 20,
  })

  // ── Splits ──
  const night = B({ get: (b) => b.dayNightSplits?.nightHRRate, ab: (b) => b.dayNightSplits?.nightAB, minAb: 25, fmt: (v) => pct(v, 1), filter: (b) => isDayGame(b) === false })
  const day = B({ get: (b) => b.dayNightSplits?.dayHRRate, ab: (b) => b.dayNightSplits?.dayAB, minAb: 25, fmt: (v) => pct(v, 1), filter: (b) => isDayGame(b) === true })
  const home = B({ get: (b) => b.homeAwaySplits?.homeISO, ab: (b) => b.homeAwaySplits?.homeAB, minAb: 30, fmt: (v) => rate(v), filter: (b) => b.isHome === true })
  const away = B({ get: (b) => b.homeAwaySplits?.awayISO, ab: (b) => b.homeAwaySplits?.awayAB, minAb: 30, fmt: (v) => rate(v), filter: (b) => b.isHome === false })

  // ── Pitchers & parks ──
  const weakArms = data.pitchers
    .filter((p) => Number.isFinite(p.hr9))
    .sort((a, b) => b.hr9 - a.hr9)
    .slice(0, 10)
    .map((p) => ({ key: `${p.id}-${p.gamePk}`, name: lastName(p.name), meta: p.matchup, val: `${num(p.hr9, 2)}`, onClick: () => onOpenPitcher?.(p.id, p.gamePk) }))
  const bestParks = data.games
    .filter((g) => Number.isFinite(g.park))
    .sort((a, b) => b.park - a.park)
    .slice(0, 8)
    .map((g) => ({ key: g.gamePk, name: g.label, meta: g.venue, val: signedPct(g.park - 1, 0) }))

  const anything = [topHR, barrels, exitVelo, hot, penMash, night, day, home, away, weakArms, bestParks].some((x) => x.length)
  if (!anything) return <div className="empty-note">No cheat-sheet data for today's slate yet.</div>

  return (
    <div className="cheat">
      <h3 className="cheat-cat">
        <Icon name="Crosshair" size={14} /> Batters
      </h3>
      <div className="splits-grid">
        <LbCard title="Top HR Plays" sub="model %" icon="Flame" items={topHR} />
        <LbCard title="Barrel Kings" sub="barrel%" icon="Crosshair" items={barrels} />
        <LbCard title="Exit Velo" sub="avg EV (mph)" icon="Zap" items={exitVelo} />
        <LbCard title="Hot Streaks" sub="last-7 ISO" icon="TrendingUp" items={hot} />
        <LbCard title="Bullpen Mashers" sub="HR% vs RP" icon="Shield" items={penMash} />
      </div>

      <h3 className="cheat-cat">
        <Icon name="LayoutGrid" size={14} /> Splits — today's slate
      </h3>
      <div className="splits-grid">
        <LbCard title="Night HR Leaders" sub="night games" icon="Clock" items={night} />
        <LbCard title="Day HR Leaders" sub="day games" icon="Sun" items={day} />
        <LbCard title="Home Power (ISO)" sub="home today" icon="House" items={home} />
        <LbCard title="Road Power (ISO)" sub="road today" icon="Plane" items={away} />
      </div>

      <h3 className="cheat-cat">
        <Icon name="Target" size={14} /> Pitchers & parks
      </h3>
      <div className="splits-grid">
        <LbCard title="Pitcher Weak Spots" sub="HR/9 allowed" icon="Shield" items={weakArms} />
        <LbCard title="Best HR Parks" sub="park factor" icon="Gauge" items={bestParks} />
      </div>
    </div>
  )
}
