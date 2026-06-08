import { useMemo } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { pct, rate } from '../lib/format.js'

// Rough day/night classifier from the game's UTC start hour. Day games start
// ~16-21 UTC (≈ noon-5pm ET); everything else (incl. late west-coast games that
// wrap past midnight UTC) is night.
const isDayGame = (b) => {
  const gd = b.game?.gameDate
  if (!gd) return null
  const h = new Date(gd).getUTCHours()
  return h >= 14 && h < 22
}

// Each board: who's in that split TODAY, ranked by the relevant career split.
const BOARDS = [
  {
    k: 'night',
    title: 'Night HR Leaders',
    sub: 'in night games today',
    icon: 'Clock',
    filter: (b) => isDayGame(b) === false,
    get: (b) => b.dayNightSplits?.nightHRRate,
    ab: (b) => b.dayNightSplits?.nightAB,
    fmt: (v) => pct(v, 1),
    minAb: 25,
  },
  {
    k: 'day',
    title: 'Day HR Leaders',
    sub: 'in day games today',
    icon: 'Sun',
    filter: (b) => isDayGame(b) === true,
    get: (b) => b.dayNightSplits?.dayHRRate,
    ab: (b) => b.dayNightSplits?.dayAB,
    fmt: (v) => pct(v, 1),
    minAb: 25,
  },
  {
    k: 'home',
    title: 'Home Power (ISO)',
    sub: 'playing at home today',
    icon: 'House',
    filter: (b) => b.isHome === true,
    get: (b) => b.homeAwaySplits?.homeISO,
    ab: (b) => b.homeAwaySplits?.homeAB,
    fmt: (v) => rate(v),
    minAb: 30,
  },
  {
    k: 'away',
    title: 'Road Power (ISO)',
    sub: 'on the road today',
    icon: 'Plane',
    filter: (b) => b.isHome === false,
    get: (b) => b.homeAwaySplits?.awayISO,
    ab: (b) => b.homeAwaySplits?.awayAB,
    fmt: (v) => rate(v),
    minAb: 30,
  },
]

// Batter Splits cheatsheet — day/night & home/road HR/power leaders, scoped to
// who's actually in that split on today's slate.
export default function SplitsView({ batters, onSelect }) {
  const boards = useMemo(
    () =>
      BOARDS.map((bd) => {
        const rows = (batters || [])
          .filter((b) => !b.game?.isFinal && bd.filter(b) && Number.isFinite(bd.get(b)) && (bd.ab(b) ?? 0) >= bd.minAb)
          .sort((a, b) => bd.get(b) - bd.get(a))
          .slice(0, 10)
        return { ...bd, rows }
      }),
    [batters],
  )

  if (!boards.some((b) => b.rows.length)) {
    return <div className="empty-note">No split data for today's slate yet.</div>
  }

  return (
    <div className="splits-grid">
      {boards.map(
        (bd) =>
          bd.rows.length > 0 && (
            <section className="splits-card" key={bd.k}>
              <h4 className="splits-h">
                <Icon name={bd.icon} size={14} /> {bd.title}
                <span className="splits-sub dim">{bd.sub}</span>
              </h4>
              <ol className="splits-list">
                {bd.rows.map((b, i) => (
                  <li
                    key={b.id}
                    className="splits-row"
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
                    <span className="splits-rank mono">{i + 1}</span>
                    <span className="splits-name">{b.name}</span>
                    <span className="splits-team">{b.team}</span>
                    <GradeChip grade={b.grade} size="sm" />
                    <span className="splits-val mono">{bd.fmt(bd.get(b))}</span>
                  </li>
                ))}
              </ol>
            </section>
          ),
      )}
    </div>
  )
}
