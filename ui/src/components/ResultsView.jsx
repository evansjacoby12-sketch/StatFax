import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { pct, num } from '../lib/format.js'
import { GRADE_ORDER, gradeColor } from '../lib/badges.js'
import { GradeChip } from './atoms.jsx'
import { playerHeadshot } from '../lib/teams.js'

// Mann–Whitney AUC (ranking quality), tie-aware.
function computeAuc(rows) {
  const y = rows.map((r) => (r.homered ? 1 : 0))
  const nPos = y.reduce((s, v) => s + v, 0)
  const nNeg = y.length - nPos
  if (!nPos || !nNeg) return NaN
  const ord = rows.map((r, i) => ({ s: r.score, y: y[i] })).sort((a, b) => a.s - b.s)
  let i = 0
  let rankSum = 0
  while (i < ord.length) {
    let j = i
    while (j < ord.length && ord[j].s === ord[i].s) j++
    const avg = (i + 1 + j) / 2
    for (let k = i; k < j; k++) if (ord[k].y === 1) rankSum += avg
    i = j
  }
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg)
}

export default function ResultsView({ meta }) {
  const [log, setLog] = useState(null)
  const [err, setErr] = useState(null)
  const [hrDay, setHrDay] = useState(null) // null = all days
  const [comboDay, setComboDay] = useState(null) // null = latest
  const [comboBoard, setComboBoard] = useState('final') // 'final' = all-slate · 'late' = evening bettable
  useEffect(() => {
    let alive = true
    fetch(`${import.meta.env.BASE_URL}data/backtest-log.json`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`)))
      .then((d) => alive && setLog(d))
      .catch((e) => alive && setErr(String(e)))
    return () => {
      alive = false
    }
  }, [])

  if (err)
    return (
      <div className="empty">
        <Icon name="TriangleAlert" size={26} />
        <p>No backtest log yet — run a few days of `npm run slate` + reconcile to build a track record.</p>
      </div>
    )
  if (!log) return <div className="results-loading">Loading track record…</div>

  const rows = []
  for (const d of Object.keys(log.records || {})) {
    for (const r of log.records[d]) {
      if (Number.isFinite(r.score) && typeof r.homered === 'boolean') rows.push({ ...r, date: d })
    }
  }
  if (!rows.length) return <div className="empty"><Icon name="Search" size={26} /><p>No reconciled records yet.</p></div>

  const N = rows.length
  const hits = rows.filter((r) => r.homered).length
  const base = hits / N
  const auc = computeAuc(rows)
  const sorted = rows.slice().sort((a, b) => b.score - a.score)
  const topN = Math.max(1, Math.round(N * 0.1))
  const topRate = sorted.slice(0, topN).filter((r) => r.homered).length / topN

  const byGrade = GRADE_ORDER.map((g) => {
    const seg = rows.filter((r) => (r.grade || 'SKIP') === g)
    return { g, n: seg.length, rate: seg.length ? seg.filter((r) => r.homered).length / seg.length : 0 }
  })
  const maxGradeRate = Math.max(0.3, ...byGrade.map((x) => x.rate))

  const dates = Object.keys(log.records || {}).sort().reverse()
  const daily = dates.map((d) => {
    const rs = (log.records[d] || []).filter((r) => typeof r.homered === 'boolean')
    const prime = rs.filter((r) => (r.grade || '') === 'PRIME' || (r.grade || '') === 'STRONG')
    return {
      date: d,
      n: rs.length,
      hits: rs.filter((r) => r.homered).length,
      topN: prime.length,
      topHits: prime.filter((r) => r.homered).length,
    }
  })

  // Exact graded combos per day — the canonical pregame parlays + which legs
  // homered. log.combos.byDate stores { strategy, size, legs:[playerId], allHit };
  // resolve each leg's name + HR from that day's records.
  const STRAT_LABEL = { top: 'Top Picks', mix: 'Best Mix', stack: 'Signal Stack', hot: 'Hot Hand', power: 'Power Bats', matchup: 'Soft Matchup', park: 'Park & Air' }
  const comboByDate = log.combos?.byDate || {}
  const comboLateByDate = log.combos?.lateByDate || {}
  // Day selection is driven by the settled (graded) FINAL board.
  const comboDates = Object.keys(comboByDate).filter((d) => (comboByDate[d] || []).length).sort().reverse()
  const activeComboDay = comboDay && comboDates.includes(comboDay) ? comboDay : comboDates[0] || null
  // "Evening board" = the latest bettable board (still-pregame games only) — what
  // you could actually bet late. Only offer the toggle when we have it for the day.
  const hasLate = activeComboDay && (comboLateByDate[activeComboDay] || []).length > 0
  const board = comboBoard === 'late' && hasLate ? 'late' : 'final'
  const recByDay = (d) => {
    const map = new Map()
    for (const r of log.records?.[d] || []) map.set(Number(r.playerId), r)
    return map
  }
  const dayCombos = (() => {
    if (!activeComboDay) return []
    const recs = recByDay(activeComboDay)
    const src = board === 'late' ? comboLateByDate[activeComboDay] : comboByDate[activeComboDay]
    return (src || [])
      .map((c) => {
        const legs = (c.legs || []).map((pid) => {
          const r = recs.get(Number(pid))
          return { name: (r?.name || `#${pid}`).split(' ').slice(-1)[0], homered: r?.homered === true }
        })
        const nHit = legs.filter((l) => l.homered).length
        return { strategy: c.strategy, size: c.size, nHit, allHit: legs.length > 0 && nHit === legs.length, legs }
      })
      .sort((a, b) => Number(b.allHit) - Number(a.allHit) || a.size - b.size)
  })()
  const comboCashed = dayCombos.filter((c) => c.allHit).length

  const m = meta.modelMetrics
  const reliability = m?.reliability || []

  // Every PRIME/STRONG graded pick that actually homered, newest first.
  const topHRs = rows
    .filter((r) => (r.grade === 'PRIME' || r.grade === 'STRONG') && r.homered)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.score ?? 0) - (a.score ?? 0)))
  const hrDates = [...new Set(topHRs.map((r) => r.date))] // already newest-first
  const activeDay = hrDay && hrDates.includes(hrDay) ? hrDay : null
  const shownHRs = activeDay ? topHRs.filter((r) => r.date === activeDay) : topHRs

  return (
    <div className="results">
      <div className="results-kpis">
        <Kpi label="Discrimination (AUC)" value={Number.isFinite(auc) ? auc.toFixed(3) : '—'} sub="ranking quality · 0.5 = coin flip" accent="var(--prime)" />
        <Kpi label="Top-decile hit rate" value={pct(topRate, 0)} sub={`${(topRate / base).toFixed(1)}× vs base ${pct(base, 0)}`} accent="var(--strong)" />
        <Kpi label="Graded picks" value={num(N)} sub={`${hits} HR · ${dates.length} days`} />
        {m && <Kpi label="Brier vs baseline" value={m.brier.toFixed(4)} sub={`${pct((m.baselineBrier - m.brier) / m.baselineBrier, 0)} better`} accent="var(--accent)" />}
      </div>

      <div className="results-cols">
        <section className="results-card">
          <h3 className="section-title"><Icon name="Trophy" size={14} /> Hit rate by grade</h3>
          <div className="grade-hits">
            {byGrade.map((x) => (
              <div className="grade-hit" key={x.g}>
                <div className="grade-hit-head">
                  <span style={{ color: gradeColor(x.g), fontWeight: 700 }}>{x.g}</span>
                  <span className="mono">{pct(x.rate, 1)} <span className="dim">· n={x.n}</span></span>
                </div>
                <div className="grade-hit-track">
                  <div className="grade-hit-fill" style={{ width: `${Math.min(100, (x.rate / maxGradeRate) * 100)}%`, background: gradeColor(x.g) }} />
                </div>
              </div>
            ))}
          </div>
          <p className="chart-cap dim">Share of each grade that actually homered, over the reconciled window. A working model shows a clean PRIME &gt; STRONG &gt; LEAN &gt; SKIP staircase.</p>
        </section>

        <section className="results-card">
          <h3 className="section-title"><Icon name="Activity" size={14} /> Reliability</h3>
          <Reliability bins={reliability} />
          <p className="chart-cap dim">Predicted vs actual HR rate. On the dashed line = perfectly calibrated.</p>
        </section>
      </div>

      <section className="results-card">
        <h3 className="section-title">
          <Icon name="Flame" size={14} /> Top-tier home runs
          <span className="dim" style={{ fontWeight: 400, marginLeft: 6 }}>
            · {shownHRs.length} PRIME/STRONG {activeDay ? `on ${activeDay.slice(5)}` : 'cashed'}
          </span>
        </h3>
        {hrDates.length > 1 && (
          <div className="hr-days">
            <button className={`hr-day ${!activeDay ? 'on' : ''}`} onClick={() => setHrDay(null)}>
              All
            </button>
            {hrDates.map((d) => (
              <button key={d} className={`hr-day ${activeDay === d ? 'on' : ''}`} onClick={() => setHrDay(d)}>
                {d.slice(5)}
              </button>
            ))}
          </div>
        )}
        {shownHRs.length ? (
          <ul className="hr-feed">
            {shownHRs.map((r, i) => (
              <li className="hr-feed-row" key={`${r.playerId}-${r.date}-${i}`}>
                <span className="hr-feed-date mono dim">{r.date.slice(5)}</span>
                <img className="hr-feed-photo" src={playerHeadshot(r.playerId, 64)} alt="" loading="lazy" />
                <span className="hr-feed-name">{r.name || `#${r.playerId}`}</span>
                <GradeChip grade={{ label: r.grade, color: gradeColor(r.grade) }} size="sm" score={r.score} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="chart-cap dim">No PRIME or STRONG picks have homered in the reconciled window yet.</p>
        )}
        <p className="chart-cap dim">Every PRIME &amp; STRONG graded pick that homered, newest first. LEAN and SKIP are hidden.</p>
      </section>

      {comboDates.length > 0 && (
        <section className="results-card">
          <h3 className="section-title">
            <Icon name="Layers" size={14} /> Combo results
            <span className="dim" style={{ fontWeight: 400, marginLeft: 6 }}>
              · {comboCashed}/{dayCombos.length} cashed{activeComboDay ? ` on ${activeComboDay.slice(5)}` : ''}
            </span>
          </h3>
          {hasLate && (
            <div className="hr-days" role="group" aria-label="Board view">
              <button className={`hr-day ${board === 'final' ? 'on' : ''}`} onClick={() => setComboBoard('final')} title="The full-slate confirmed board (all games, frozen pregame)">
                Full board
              </button>
              <button className={`hr-day ${board === 'late' ? 'on' : ''}`} onClick={() => setComboBoard('late')} title="The latest bettable board — built only from games that hadn't started yet (what you could realistically bet late)">
                Evening board
              </button>
            </div>
          )}
          {comboDates.length > 1 && (
            <div className="hr-days">
              {comboDates.map((d) => (
                <button key={d} className={`hr-day ${activeComboDay === d ? 'on' : ''}`} onClick={() => setComboDay(d)}>
                  {d.slice(5)}
                </button>
              ))}
            </div>
          )}
          <p className="chart-cap dim" style={{ marginTop: 2 }}>
            {board === 'late'
              ? 'Evening board — the latest combos built only from games that hadn’t started, i.e. what you could realistically still bet late.'
              : 'Full board — all games, each bat frozen at its first pitch.'}
          </p>
          <ul className="combo-res">
            {dayCombos.map((c, i) => (
              <li className={`combo-res-row ${c.allHit ? 'hit' : 'miss'}`} key={`${c.strategy}-${c.size}-${i}`}>
                <span className="combo-res-badge">{c.allHit ? '🎯' : `${c.nHit}/${c.size}`}</span>
                <span className="combo-res-strat">{STRAT_LABEL[c.strategy] || c.strategy}</span>
                <span className="combo-res-size dim">{c.size}-leg</span>
                <span className="combo-res-legs">
                  {c.legs.map((l, j) => (
                    <span key={j} className={`combo-res-leg ${l.homered ? 'hr' : 'no'}`}>
                      {l.name}{l.homered ? ' ✅' : ' ❌'}{j < c.legs.length - 1 ? ' · ' : ''}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="chart-cap dim">The canonical pregame combos (one per strategy &amp; size) graded against actual HRs. 🎯 = every leg homered.</p>
        </section>
      )}

      <section className="results-card">
        <h3 className="section-title"><Icon name="Clock" size={14} /> Daily track record</h3>
        <div className="daily-table">
          <div className="daily-row daily-th">
            <span>Date</span><span>Picks</span><span>HR</span><span>Hit%</span><span>Top tier</span><span>Top hit%</span>
          </div>
          {daily.map((d) => (
            <div className="daily-row" key={d.date}>
              <span className="mono">{d.date.slice(5)}</span>
              <span className="mono">{d.n}</span>
              <span className="mono">{d.hits}</span>
              <span className="mono">{d.n ? pct(d.hits / d.n, 0) : '—'}</span>
              <span className="mono dim">{d.topN}</span>
              <span className={`mono ${d.topN && d.topHits / d.topN > base ? 'pos' : ''}`}>{d.topN ? pct(d.topHits / d.topN, 0) : '—'}</span>
            </div>
          ))}
        </div>
        <p className="chart-cap dim">"Top tier" = PRIME + STRONG picks. Green = beat the base rate that day.</p>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="results-kpi">
      <div className="results-kpi-label">{label}</div>
      <div className="results-kpi-value mono" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="results-kpi-sub dim">{sub}</div>}
    </div>
  )
}

function Reliability({ bins }) {
  if (!bins?.length) return <div className="dim" style={{ fontSize: 12 }}>Not enough data yet.</div>
  const W = 300, H = 200, pad = { l: 34, r: 10, t: 10, b: 28 }
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const max = Math.max(0.3, ...bins.map((b) => b.avgPredicted), ...bins.map((b) => b.observedRate)) * 1.05
  const x = (v) => pad.l + (v / max) * iw
  const y = (v) => pad.t + ih - (v / max) * ih
  const maxN = Math.max(1, ...bins.map((b) => b.n || 0))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="reliability" role="img" aria-label="Reliability diagram">
      {[0, 0.1, 0.2, 0.3].filter((t) => t <= max).map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={pad.t} x2={x(t)} y2={pad.t + ih} className="grid" />
          <line x1={pad.l} y1={y(t)} x2={pad.l + iw} y2={y(t)} className="grid" />
          <text x={x(t)} y={H - 10} className="axis-lbl" textAnchor="middle">{Math.round(t * 100)}%</text>
          <text x={pad.l - 5} y={y(t) + 3} className="axis-lbl" textAnchor="end">{Math.round(t * 100)}%</text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(max)} y2={y(max)} className="diag" />
      <polyline className="rel-line" points={bins.map((b) => `${x(b.avgPredicted)},${y(b.observedRate)}`).join(' ')} />
      {bins.map((b, i) => (
        <circle key={i} cx={x(b.avgPredicted)} cy={y(b.observedRate)} r={3 + 6 * Math.sqrt((b.n || 0) / maxN)} className="rel-pt">
          <title>predicted {pct(b.avgPredicted, 1)} → observed {pct(b.observedRate, 1)} (n={b.n})</title>
        </circle>
      ))}
    </svg>
  )
}
