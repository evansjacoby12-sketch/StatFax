import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { hrSetup } from '../lib/scout.js'
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
    .sort((a, b) => get(b) - get(a) || String(a.id).localeCompare(String(b.id)))
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
  const [tab, setTab] = useState('batters')
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
        pmap.set(key, { id: p.id, gamePk: x.gamePk, name: p.name, hr9: p.season?.hrPer9, k9: p.season?.kPer9, era: p.season?.era, matchup: a && h ? `${a}@${h}` : x.opponent?.abbr || '' })
      }
    }
    // Unique opposing bullpens (one per team being faced) for Bullpen Targets.
    const bpmap = new Map()
    for (const x of b) {
      const opp = x.opponent
      if (!live(x) || opp?.id == null || bpmap.has(opp.id) || !Number.isFinite(x.opposingBullpenHR9)) continue
      bpmap.set(opp.id, { id: opp.id, abbr: opp.abbr, hr9: x.opposingBullpenHR9 })
    }
    // Unique games for park environment.
    const gmap = new Map()
    for (const x of b) {
      if (!live(x) || x.gamePk == null || gmap.has(x.gamePk)) continue
      const a = x.game?.awayTeam?.abbr
      const h = x.game?.homeTeam?.abbr
      gmap.set(x.gamePk, { gamePk: x.gamePk, label: a && h ? `${a} @ ${h}` : '', park: x.gameParkHRFactor, venue: x.game?.venueName })
    }
    return { pitchers: [...pmap.values()], games: [...gmap.values()], bullpens: [...bpmap.values()] }
  }, [batters])

  const B = (cfg) => batterBoard(batters, { ...cfg, onSelect })
  const lb = (b) => (b || []).filter(live)
  const gradeBadge = (b) => <GradeChip grade={b.grade} size="sm" />

  // ── Batters ──
  // HR Matchups — bat × opposing-pitcher HR/9 cross-check, sorted by model HR%.
  const hrMatchups = lb(batters)
    .filter((b) => Number.isFinite(b.hrProbability))
    .sort((a, b) => b.hrProbability - a.hrProbability || String(a.id).localeCompare(String(b.id)))
    .slice(0, 12)
    .map((b) => ({
      key: b.id,
      name: b.name,
      meta: b.pitcher?.name ? `vs ${lastName(b.pitcher.name)} ${Number.isFinite(b.pitcher.season?.hrPer9) ? num(b.pitcher.season.hrPer9, 2) : '–'}` : b.team,
      badge: gradeBadge(b),
      val: pct(b.hrProbability, 2),
      onClick: () => onSelect(b),
    }))
  const barrels = B({ get: (b) => b.barrelPctBBE ?? b.barrelPct, fmt: (v) => `${num(v, 1)}%` })
  const exitVelo = B({ get: (b) => b.exitVelo, fmt: (v) => `${num(v, 1)}` })
  const hot = B({ get: (b) => b.recent7?.iso, fmt: (v) => rate(v), filter: (b) => (b.recent7?.ab ?? 0) >= 8 })
  const penMash = B({
    get: (b) => b.bullpenSplits?.rpHrRate,
    fmt: (v) => pct(v, 1),
    filter: (b) => (b.bullpenSplits?.rpAb ?? 0) >= 20,
  })

  // ── Alerts ──
  // Blast Alert — most HR signals stacked (the 6-box setup), the "about to go off" list.
  const blast = lb(batters)
    .map((b) => ({ b, n: hrSetup(b).n }))
    .filter((x) => x.n >= 4)
    .sort((a, b) => b.n - a.n || (b.b.hrProbability ?? 0) - (a.b.hrProbability ?? 0) || String(a.b.id).localeCompare(String(b.b.id)))
    .slice(0, 12)
    .map(({ b, n }) => ({ key: b.id, name: b.name, meta: b.team, badge: gradeBadge(b), val: `${n}/6`, onClick: () => onSelect(b) }))
  // Exit-Velo Surge — recent (14d) EV jump over season (bat-speed proxy; we don't get bat speed).
  const evSurge = lb(batters)
    .filter((b) => Number.isFinite(b.recentBarrel?.recentEV) && Number.isFinite(b.exitVelo) && (b.recentBarrel?.recentBBE ?? 0) >= 10)
    .map((b) => ({ b, delta: b.recentBarrel.recentEV - b.exitVelo }))
    .filter((x) => x.delta > 0)
    .sort((a, b) => b.delta - a.delta || String(a.b.id).localeCompare(String(b.b.id)))
    .slice(0, 12)
    .map(({ b, delta }) => ({ key: b.id, name: b.name, meta: `${num(b.recentBarrel.recentEV, 1)} mph`, badge: gradeBadge(b), val: `+${num(delta, 1)}`, onClick: () => onSelect(b) }))
  // 1st-Inning HR Leaders — top-of-order bats (they hit the starter in the 1st).
  const firstInning = lb(batters)
    .filter((b) => b.battingOrder >= 1 && b.battingOrder <= 3 && Number.isFinite(b.hrProbability))
    .sort((a, b) => b.hrProbability - a.hrProbability || String(a.id).localeCompare(String(b.id)))
    .slice(0, 12)
    .map((b) => ({ key: b.id, name: b.name, meta: `#${b.battingOrder} vs ${lastName(b.pitcher?.name)}`, badge: gradeBadge(b), val: pct(b.hrProbability, 2), onClick: () => onSelect(b) }))

  // ── Splits ──
  const night = B({ get: (b) => b.dayNightSplits?.nightHRRate, ab: (b) => b.dayNightSplits?.nightAB, minAb: 25, fmt: (v) => pct(v, 1), filter: (b) => isDayGame(b) === false })
  const day = B({ get: (b) => b.dayNightSplits?.dayHRRate, ab: (b) => b.dayNightSplits?.dayAB, minAb: 25, fmt: (v) => pct(v, 1), filter: (b) => isDayGame(b) === true })
  const home = B({ get: (b) => b.homeAwaySplits?.homeISO, ab: (b) => b.homeAwaySplits?.homeAB, minAb: 30, fmt: (v) => rate(v), filter: (b) => b.isHome === true })
  const away = B({ get: (b) => b.homeAwaySplits?.awayISO, ab: (b) => b.homeAwaySplits?.awayAB, minAb: 30, fmt: (v) => rate(v), filter: (b) => b.isHome === false })

  // ── Matchups ── batters ranked by their SLG on the pitcher's most-used pitch
  const pitchEdgeRows = (batters || [])
    .filter((b) => live(b) && Number.isFinite(b.primaryPitchEdge?.batterSlg) && (b.primaryPitchEdge?.pitcherFreq ?? 0) >= 0.18)
    .sort((a, b) => b.primaryPitchEdge.batterSlg - a.primaryPitchEdge.batterSlg || String(a.id).localeCompare(String(b.id)))
    .slice(0, 10)
    .map((b) => ({
      key: b.id,
      name: b.name,
      meta: b.primaryPitchEdge.pitchName,
      badge: <GradeChip grade={b.grade} size="sm" />,
      val: rate(b.primaryPitchEdge.batterSlg),
      onClick: () => onSelect(b),
    }))

  // ── Pitchers & parks ──
  const weakArms = data.pitchers
    .filter((p) => Number.isFinite(p.hr9))
    .sort((a, b) => b.hr9 - a.hr9 || String(a.id).localeCompare(String(b.id)))
    .slice(0, 10)
    .map((p) => ({ key: `${p.id}-${p.gamePk}`, name: lastName(p.name), meta: p.matchup, val: `${num(p.hr9, 2)}`, onClick: () => onOpenPitcher?.(p.id, p.gamePk) }))
  const highK = data.pitchers
    .filter((p) => Number.isFinite(p.k9))
    .sort((a, b) => b.k9 - a.k9 || String(a.id).localeCompare(String(b.id)))
    .slice(0, 10)
    .map((p) => ({ key: `${p.id}-${p.gamePk}`, name: lastName(p.name), meta: p.matchup, val: `${num(p.k9, 1)}`, onClick: () => onOpenPitcher?.(p.id, p.gamePk) }))
  const bullpenTargets = data.bullpens
    .filter((t) => Number.isFinite(t.hr9))
    .sort((a, b) => b.hr9 - a.hr9 || String(a.id).localeCompare(String(b.id)))
    .slice(0, 10)
    .map((t) => ({ key: t.id, name: `${t.abbr} bullpen`, meta: '', val: `${num(t.hr9, 2)}` }))
  const bestParks = data.games
    .filter((g) => Number.isFinite(g.park))
    .sort((a, b) => b.park - a.park || (a.gamePk ?? 0) - (b.gamePk ?? 0))
    .slice(0, 8)
    .map((g) => ({ key: g.gamePk, name: g.label, meta: g.venue, val: signedPct(g.park - 1, 0) }))

  const anything = [hrMatchups, barrels, exitVelo, hot, penMash, pitchEdgeRows, blast, evSurge, firstInning, night, day, home, away, weakArms, highK, bullpenTargets, bestParks].some((x) => x.length)
  if (!anything) return <div className="empty-note">No cheat-sheet data for today's slate yet.</div>

  const TABS = [
    { k: 'batters', label: 'Batters', icon: 'Crosshair' },
    { k: 'alerts', label: 'Alerts', icon: 'Flame' },
    { k: 'splits', label: 'Splits', icon: 'LayoutGrid' },
    { k: 'arms', label: 'Pitchers', icon: 'Target' },
  ]

  return (
    <div className="cheat">
      <div className="cheat-tabs" role="tablist" aria-label="Cheat sheet pages">
        {TABS.map((t) => (
          <button
            key={t.k}
            role="tab"
            aria-selected={tab === t.k}
            className={`badge-toggle ${tab === t.k ? 'on' : ''}`}
            onClick={() => setTab(t.k)}
          >
            <Icon name={t.icon} size={13} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'batters' && (
        <div className="splits-grid">
          <LbCard title="HR Matchups" sub="HR% · vs pitcher HR/9" icon="Flame" items={hrMatchups} />
          <LbCard title="Barrel Kings" sub="barrel%" icon="Crosshair" items={barrels} />
          <LbCard title="Exit Velo" sub="avg EV (mph)" icon="Zap" items={exitVelo} />
          <LbCard title="Hot Streaks" sub="last-7 ISO" icon="TrendingUp" items={hot} />
          <LbCard title="Bullpen Mashers" sub="HR% vs RP" icon="Shield" items={penMash} />
          <LbCard title="Pitch Matchup Edge" sub="SLG vs top pitch" icon="Crosshair" items={pitchEdgeRows} />
        </div>
      )}

      {tab === 'alerts' && (
        <div className="splits-grid">
          <LbCard title="Blast Alert" sub="HR signals stacked (/6)" icon="Flame" items={blast} />
          <LbCard title="Exit-Velo Surge" sub="last-14d EV vs season" icon="TrendingUp" items={evSurge} />
          <LbCard title="1st-Inning HR Leaders" sub="top-of-order vs starter" icon="Clock" items={firstInning} />
        </div>
      )}

      {tab === 'splits' && (
        <div className="splits-grid">
          <LbCard title="Night HR Leaders" sub="night games" icon="Clock" items={night} />
          <LbCard title="Day HR Leaders" sub="day games" icon="Sun" items={day} />
          <LbCard title="Home Power (ISO)" sub="home today" icon="House" items={home} />
          <LbCard title="Road Power (ISO)" sub="road today" icon="Plane" items={away} />
        </div>
      )}

      {tab === 'arms' && (
        <div className="splits-grid">
          <LbCard title="Pitcher Weak Spots" sub="HR/9 allowed" icon="Shield" items={weakArms} />
          <LbCard title="Strikeout Arms" sub="K/9 — tough to homer off" icon="Zap" items={highK} />
          <LbCard title="Bullpen Targets" sub="opp pen HR/9" icon="Shield" items={bullpenTargets} />
          <LbCard title="Best HR Parks" sub="park factor" icon="Gauge" items={bestParks} />
        </div>
      )}
    </div>
  )
}
