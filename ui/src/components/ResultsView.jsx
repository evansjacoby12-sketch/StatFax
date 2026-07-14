import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'
import { pct, num, signedPct } from '../lib/format.js'
import { GRADE_ORDER, gradeColor } from '../lib/badges.js'
import { GradeChip } from './atoms.jsx'
import { playerHeadshot } from '../lib/teams.js'
import { hexA } from './atoms.jsx'
import CombosView from './CombosView.jsx'
import MyTickets from './MyTickets.jsx'
import { useTickets } from '../lib/tickets.js'
import { gradeTicket, summarizeTickets } from '../lib/ticketMath.js'
import { loadBacktestLog } from '../lib/backtestLog.js'

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

const RESULTS_TABS = [
  { id: 'overview', label: 'Overview', icon: 'LayoutGrid' },
  { id: 'tickets', label: 'My Tickets', icon: 'Bookmark' },
  { id: 'model', label: 'Model', icon: 'Activity' },
]

// Results hub: the model track record and the parlay-combo record share one tab
// now (combos was folded back in here), switched by a sub-toggle.
export default function ResultsView({ meta, batters, onSelect, favorConsistency = false, initialTab = 'model' }) {
  const normalizedInitial = initialTab === 'combos' ? 'tickets' : initialTab === 'model' ? 'model' : 'overview'
  const [tab, setTab] = useState(normalizedInitial)
  useEffect(() => setTab(initialTab === 'combos' ? 'tickets' : initialTab === 'model' ? 'model' : 'overview'), [initialTab])
  return (
    <div className="results-wrap">
      <div className="mobile-page-kicker results-mobile-kicker">
        <span><Icon name="BarChart3" size={14} /> Accountability</span>
        <small className="mono">Outcomes + process</small>
      </div>
      <CommandTabs
        className="results-subnav accountability-subnav"
        label="Results workspace"
        value={tab}
        onChange={setTab}
        tabs={RESULTS_TABS}
        ariaPressed
      />
      {tab === 'overview' && <AccountabilityOverview meta={meta} batters={batters} onSelect={onSelect} onOpenTickets={() => setTab('tickets')} />}
      {tab === 'tickets' && <CombosView batters={batters} onSelect={onSelect} favorConsistency={favorConsistency} initialSection="tickets" />}
      {tab === 'model' && <ModelResults meta={meta} />}
    </div>
  )
}

function AccountabilityOverview({ meta, batters, onSelect, onOpenTickets }) {
  const { tickets } = useTickets()
  const graded = useMemo(() => tickets.map((ticket) => gradeTicket(ticket, batters)), [tickets, batters])
  const summary = useMemo(() => summarizeTickets(graded), [graded])
  const [log, setLog] = useState(null)

  useEffect(() => {
    let alive = true
    loadBacktestLog()
      .then((data) => { if (alive) setLog(data) })
      .catch(() => { if (alive) setLog(null) })
    return () => { alive = false }
  }, [])

  const rows = useMemo(() => Object.entries(log?.records || {}).flatMap(([date, records]) => (records || [])
    .filter((record) => typeof record.homered === 'boolean')
    .map((record) => ({ ...record, date }))), [log])
  const baseRate = rows.length ? rows.filter((row) => row.homered).length / rows.length : null
  const gradeReview = GRADE_ORDER.map((grade) => {
    const segment = rows.filter((row) => (row.grade || 'SKIP') === grade)
    return { grade, n: segment.length, rate: segment.length ? segment.filter((row) => row.homered).length / segment.length : null }
  })
  const qualifiedGrades = gradeReview.filter((item) => item.n >= 20 && item.rate != null)
  const strongestGrade = qualifiedGrades.slice().sort((a, b) => b.rate - a.rate)[0] || null
  const weakestGrade = qualifiedGrades.slice().sort((a, b) => a.rate - b.rate)[0] || null
  const projectedLegs = tickets.flatMap((ticket) => ticket.legs || []).filter((leg) => leg.lineupConfirmed === false).length
  const modelMetrics = meta?.modelMetrics
  const brierLift = modelMetrics && modelMetrics.baselineBrier > 0
    ? (modelMetrics.baselineBrier - modelMetrics.brier) / modelMetrics.baselineBrier
    : null

  let verdict = 'Track tickets to connect StatFax recommendations to your actual betting results.'
  let verdictTone = 'neutral'
  if (summary.pricedSettled > 0) {
    verdictTone = summary.net >= 0 ? 'positive' : 'warning'
    verdict = `${summary.pricedSettled} fully priced ${summary.pricedSettled === 1 ? 'ticket' : 'tickets'} produced ${summary.net >= 0 ? '+' : ''}${summary.net.toFixed(2)} units. ${summary.pricedSettled < 20 ? 'The sample is still too small for a strategy conclusion.' : 'Keep judging the process alongside the result.'}`
  } else if (summary.settled > 0) {
    verdict = `${summary.settled} ticket ${summary.settled === 1 ? 'outcome is' : 'outcomes are'} settled. Add wager and posted odds to unlock honest profit and ROI.`
  } else if (tickets.length > 0) {
    verdict = `${tickets.length} ${tickets.length === 1 ? 'ticket is' : 'tickets are'} tracked with ${summary.open} still open. Exposure is visible now; profit and ROI remain locked until settlement.`
  }

  const nextAction = !tickets.length
    ? 'Track the next parlay you actually place.'
    : summary.settled > summary.pricedSettled
      ? 'Add stake and posted odds to open tickets before first pitch.'
      : projectedLegs > 0
        ? `Review ${projectedLegs} projected-lineup ${projectedLegs === 1 ? 'leg' : 'legs'} before lock.`
        : 'Keep stake sizing consistent while the sample grows.'

  return (
    <div className="accountability-overview">
      <section className={`accountability-verdict ${verdictTone}`}>
        <span><Icon name="Info" size={14} /> Evidence-based verdict</span>
        <p>{verdict}</p>
      </section>

      <div className="accountability-kpis">
        <Kpi label="Settled record" value={summary.settled ? `${summary.wins}-${summary.settled - summary.wins}` : '—'} sub={summary.settled ? `${pct(summary.wins / summary.settled, 1)} cash rate · n=${summary.settled}` : 'No settled tickets'} />
        <Kpi label="Net units / ROI" value={summary.pricedSettled ? `${summary.net >= 0 ? '+' : ''}${summary.net.toFixed(2)}u` : '—'} sub={summary.roi != null ? `${signedPct(summary.roi, 1)} ROI · n=${summary.pricedSettled}` : 'Needs wager + odds'} accent={summary.pricedSettled ? summary.net >= 0 ? 'var(--strong)' : 'var(--bad)' : null} />
        <Kpi label="Open exposure" value={summary.knownExposure > 0 ? `${summary.knownExposure.toFixed(2)}u` : summary.open ? 'Unknown' : '0u'} sub={`${summary.live} live · ${summary.open} open`} accent={summary.open ? 'var(--accent)' : null} />
        <Kpi label="Model health" value={modelMetrics?.brier != null ? modelMetrics.brier.toFixed(4) : 'Building'} sub={brierLift != null ? `${signedPct(brierLift, 0)} vs baseline Brier` : `${rows.length} reconciled picks`} accent="var(--prime)" />
      </div>

      <div className="accountability-grid">
        <section className="accountability-brief results-card">
          <h3><Icon name="BookOpen" size={14} /> Review brief</h3>
          <div className="review-brief-item positive"><span>Strongest repeatable signal</span><p>{strongestGrade ? `${strongestGrade.grade} picks have hit at ${pct(strongestGrade.rate, 1)} across ${strongestGrade.n} reconciled picks.` : 'More reconciled outcomes are needed before naming a repeatable strength.'}</p></div>
          <div className="review-brief-item warning"><span>Biggest avoidable risk</span><p>{projectedLegs ? `${projectedLegs} tracked ${projectedLegs === 1 ? 'leg was' : 'legs were'} saved before lineup confirmation.` : weakestGrade && baseRate != null ? `${weakestGrade.grade} is the lowest observed tier at ${pct(weakestGrade.rate, 1)}; use the grade as a filter, not a guarantee.` : 'No lineup-readiness risk is visible in the current ticket ledger.'}</p></div>
          <div className="review-brief-item neutral"><span>Sample-size warning</span><p>{summary.pricedSettled < 20 ? `Only ${summary.pricedSettled} settled ${summary.pricedSettled === 1 ? 'ticket has' : 'tickets have'} complete economics. ROI is descriptive, not yet reliable.` : `ROI currently covers ${summary.pricedSettled} fully priced tickets and excludes incomplete records.`}</p></div>
          <div className="review-next-action"><Icon name="ArrowRight" size={14} /><span><small>Next action</small><b>{nextAction}</b></span></div>
        </section>

        <section className="accountability-ledger results-card">
          <div className="accountability-section-head"><h3><Icon name="Bookmark" size={14} /> Recent tickets</h3><button type="button" onClick={onOpenTickets}>View ledger <Icon name="ChevronRight" size={13} /></button></div>
          <MyTickets batters={batters} onSelect={onSelect} compact limit={3} />
        </section>
      </div>
    </div>
  )
}

function ModelResults({ meta }) {
  const [log, setLog] = useState(null)
  const [err, setErr] = useState(null)
  const [hrDay, setHrDay] = useState(null)
  const [chartTab, setChartTab] = useState('grades')
  const [showAllHRs, setShowAllHRs] = useState(false)

  useEffect(() => {
    let alive = true
    loadBacktestLog()
      .then((d) => alive && setLog(d))
      .catch((e) => alive && setErr(String(e)))
    return () => {
      alive = false
    }
  }, [])

  if (err) {
    return (
      <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px', color: 'var(--text-faint)', gap: '12px' }}>
        <Icon name="TriangleAlert" size={32} />
        <p>No backtest log yet — run a few days of `npm run slate` + reconcile to build a track record.</p>
      </div>
    )
  }
  if (!log) return <div className="results-loading" style={{ display: 'flex', justifyContent: 'center', padding: '64px', color: 'var(--text-dim)', fontWeight: '600' }}>Loading track record…</div>

  const rows = []
  for (const d of Object.keys(log.records || {})) {
    for (const r of log.records[d]) {
      if (Number.isFinite(r.score) && typeof r.homered === 'boolean') rows.push({ ...r, date: d })
    }
  }
  if (!rows.length) return <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px', color: 'var(--text-faint)' }}><Icon name="Search" size={32} /><p>No reconciled records yet.</p></div>

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
  // Both the daily table and the combo scoreboard are scoped to a rolling week.
  const RECENT_DAYS = 7
  const daily = dates.slice(0, RECENT_DAYS).map((d) => {
    const rs = (log.records[d] || []).filter((r) => typeof r.homered === 'boolean')
    const prime = rs.filter((r) => (r.grade || '') === 'PRIME' || (r.grade || '') === 'STRONG')
    return {
      date: d,
      n: rs.length,
      hits: rs.filter((r) => r.homered).length,
      topN: prime.length,
      topHits: prime.filter((r) => r.homered).length,
      // Per-pick hit/miss for the tier picks — hits first (best score first
      // within each group), so the strip reads as a solid green block + dim
      // tail: a discrete ratio bar, not scattered noise.
      dots: prime
        .slice()
        .sort((a, b) => (b.homered - a.homered) || (b.score ?? 0) - (a.score ?? 0))
        .map((r) => ({ hit: r.homered, name: r.name })),
    }
  })

  // Model cash streak: consecutive days (newest first, all history) where at
  // least one PRIME/STRONG pick homered. Purely client-side over the same log.
  let cashStreak = 0
  for (const d of dates) {
    const rs = (log.records[d] || []).filter((r) => typeof r.homered === 'boolean')
    const tier = rs.filter((r) => r.grade === 'PRIME' || r.grade === 'STRONG')
    if (!tier.length) break
    if (tier.some((r) => r.homered)) cashStreak++
    else break
  }

  const m = meta.modelMetrics
  const reliability = m?.reliability || []

  // Scope the top-tier HR feed to the same rolling week as the tables above.
  const recentSet = new Set(dates.slice(0, RECENT_DAYS))
  const topHRs = rows
    .filter((r) => (r.grade === 'PRIME' || r.grade === 'STRONG') && r.homered && recentSet.has(r.date))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.score ?? 0) - (a.score ?? 0)))
  const hrDates = [...new Set(topHRs.map((r) => r.date))]
  const activeDay = hrDay && hrDates.includes(hrDay) ? hrDay : null
  const shownHRs = activeDay ? topHRs.filter((r) => r.date === activeDay) : topHRs

  return (
    <div className="results">
      <div className="results-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '24px' }}>
        <Kpi label="Discrimination (AUC)" value={Number.isFinite(auc) ? auc.toFixed(3) : '—'} sub="ranking quality · 0.5 = random" accent="var(--prime)" />
        <Kpi label="Top-decile hit rate" value={pct(topRate, 0)} sub={`${(topRate / base).toFixed(1)}x vs base ${pct(base, 0)}`} accent="var(--strong)" />
        <Kpi label="Graded picks" value={num(N)} sub={`${hits} HR · ${dates.length} days`} />
        {m && <Kpi label="Brier vs baseline" value={m.brier.toFixed(4)} sub={`${pct((m.baselineBrier - m.brier) / m.baselineBrier, 0)} better`} accent="var(--accent)" />}
      </div>

      <CommandTabs
        className="results-chart-tabs"
        label="Results analysis"
        value={chartTab}
        onChange={setChartTab}
        tabs={[
          { id: 'grades', label: 'Grades', icon: 'Trophy' },
          { id: 'calibration', label: 'Calibration', icon: 'Gauge' },
        ]}
      />

      <div className="results-cols" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px', flexWrap: 'wrap' }}>
        <section className={`results-card results-grade-card ${chartTab === 'grades' ? 'is-mobile-active' : ''}`} style={{
          background: 'rgba(17, 18, 20, 0.45)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '12px',
          padding: '20px'
        }}>
          <h3 className="section-title" style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '8px' }}>
            <Icon name="Trophy" size={14} style={{ color: 'var(--accent)' }} /> Hit rate by grade
          </h3>
          <div className="grade-hits" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {byGrade.map((x) => (
              <div className="grade-hit" key={x.g}>
                <div className="grade-hit-head" style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}>
                  <span style={{ color: gradeColor(x.g), fontWeight: '700' }}>{x.g}</span>
                  <span className="mono" style={{ color: '#fff' }}>{pct(x.rate, 1)} <span style={{ color: 'var(--text-faint)', fontSize: '11px', fontWeight: '400' }}>· n={x.n}</span></span>
                </div>
                <div className="grade-hit-track" style={{ height: '6px', background: 'rgba(255,255,255,0.03)', borderRadius: '99px', overflow: 'hidden' }}>
                  <div className="grade-hit-fill" style={{ 
                    width: `${Math.min(100, (x.rate / maxGradeRate) * 100)}%`, 
                    background: gradeColor(x.g),
                    height: '100%',
                    borderRadius: '99px',
                    boxShadow: `0 0 8px ${hexA(gradeColor(x.g), 0.4)}`
                  }} />
                </div>
              </div>
            ))}
          </div>
          <p className="chart-cap dim" style={{ fontSize: '11px', marginTop: '16px' }}>Share of each grade that homered. A well-calibrated model shows a staircase slope.</p>
        </section>

        <section className={`results-card results-reliability-card ${chartTab === 'calibration' ? 'is-mobile-active' : ''}`} style={{
          background: 'rgba(17, 18, 20, 0.45)',
          border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: '12px',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <h3 className="section-title" style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '8px' }}>
            <Icon name="Activity" size={14} style={{ color: 'var(--accent)' }} /> Reliability Diagram
          </h3>
          <div style={{ flex: '1', display: 'grid', placeItems: 'center' }}>
            <Reliability bins={reliability} />
          </div>
          <p className="chart-cap dim" style={{ fontSize: '11px', marginTop: '16px' }}>Predicted vs observed HR rates. Dashed diagonal = ideal calibration.</p>
        </section>
      </div>

      <section className="results-card" style={{
        background: 'rgba(17, 18, 20, 0.45)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '24px'
      }}>
        <h3 className="section-title" style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '8px' }}>
          <Icon name="Flame" size={14} style={{ color: 'var(--accent)' }} /> Top-tier home runs
          <span style={{ fontWeight: '400', textTransform: 'none', marginLeft: '6px', fontSize: '12px', color: 'var(--text-faint)' }}>
            · {shownHRs.length} PRIME/STRONG {activeDay ? `on ${activeDay.slice(5)}` : 'cashed'}
          </span>
        </h3>
        {hrDates.length > 1 && (
          <div className="hr-days" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
            <button className={`hr-day ${!activeDay ? 'on' : ''}`} onClick={() => setHrDay(null)} style={{
              background: !activeDay ? 'var(--hover)' : 'rgba(255,255,255,0.03)',
              border: !activeDay ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
              color: !activeDay ? '#fff' : 'var(--text-dim)',
              fontSize: '11px',
              padding: '3px 8px',
              borderRadius: '4px'
            }}>
              All
            </button>
            {hrDates.slice(0, 15).map((d) => (
              <button key={d} className={`hr-day ${activeDay === d ? 'on' : ''}`} onClick={() => setHrDay(d)} style={{
                background: activeDay === d ? 'var(--hover)' : 'rgba(255,255,255,0.03)',
                border: activeDay === d ? '1px solid var(--accent)' : '1px solid rgba(255,255,255,0.08)',
                color: activeDay === d ? '#fff' : 'var(--text-dim)',
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '4px'
              }}>
                {d.slice(5)}
              </button>
            ))}
          </div>
        )}
        {shownHRs.length ? (
          <ul className={`hr-feed ${showAllHRs ? 'show-all' : ''}`} style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '10px' }}>
            {shownHRs.map((r, i) => (
              <li className="hr-feed-row" key={`${r.playerId}-${r.date}-${i}`} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.04)',
                borderRadius: '8px',
                padding: '8px 12px'
              }}>
                <img className="hr-feed-photo" src={playerHeadshot(r.playerId, 64)} alt="" loading="lazy" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
                {/* Name owns the flexible width (two-line block with the date
                    beneath) so it can't be crushed by the fixed-size grade chip. */}
                <span style={{ flex: '1', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <span className="hr-feed-name" style={{ fontSize: '12px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name || `#${r.playerId}`}</span>
                  <span className="hr-feed-date mono dim" style={{ fontSize: '9.5px', color: 'var(--text-faint)' }}>{r.date.slice(5)}</span>
                </span>
                <GradeChip grade={{ label: r.grade, color: gradeColor(r.grade) }} size="sm" score={r.score} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="chart-cap dim">No PRIME/STRONG picks homered yet.</p>
        )}
        {shownHRs.length > 8 && (
          <button className="results-feed-toggle" onClick={() => setShowAllHRs((open) => !open)} aria-expanded={showAllHRs}>
            {showAllHRs ? 'Show fewer home runs' : `Show all ${shownHRs.length} home runs`}
            <Icon name={showAllHRs ? 'ChevronUp' : 'ChevronDown'} size={14} />
          </button>
        )}
      </section>

      <section className="results-card" style={{
        background: 'rgba(17, 18, 20, 0.45)',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '12px',
        padding: '20px'
      }}>
        <h3 className="section-title" style={{ fontSize: '13px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '8px' }}>
          <Icon name="Clock" size={14} style={{ color: 'var(--accent)' }} /> Daily track record
          <span style={{ fontWeight: '400', textTransform: 'none', marginLeft: '6px', fontSize: '12px', color: 'var(--text-faint)' }}>
            · last 7 days
          </span>
          {cashStreak >= 2 && (
            <span className={`cash-streak${cashStreak >= 3 ? ' hot' : ''}`} title={`A PRIME/STRONG pick has homered ${cashStreak} days in a row`}>
              <Icon name="Flame" size={11} /> {cashStreak}-day cash streak
            </span>
          )}
        </h3>
        <div className="daily-table" style={{ display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.04)', borderRadius: '8px', overflow: 'hidden' }}>
          {/* No inline grid here — the header must share .daily-row's CSS grid
              (64px + 5 columns) or its columns drift off the data rows'. */}
          <div className="daily-row daily-th" style={{ padding: '6px 10px', background: 'rgba(255,255,255,0.03)', fontSize: '10px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase' }}>
            <span>Date</span><span>Picks</span><span>HR</span><span>Hit%</span><span>Tier</span><span>T-hit%</span>
          </div>
          {daily.map((d) => (
            <div className="daily-row" key={d.date} style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.02)', fontSize: '12px' }}>
              {/* Six values stay DIRECT children — .daily-row's own CSS grid
                  (64px + 5 columns) aligns them under the header row. */}
              <span className="mono daily-date" style={{ color: '#fff' }}>{d.date.slice(5)}</span>
              <span className="mono daily-stat" data-label="Picks">{d.n}</span>
              <span className="mono daily-stat" data-label="HR">{d.hits}</span>
              <span className="mono daily-stat" data-label="Hit rate">{d.n ? pct(d.hits / d.n, 0) : '—'}</span>
              <span className="mono dim daily-stat" data-label="Tier picks">{d.topN}</span>
              <span className={`mono daily-stat ${d.topN && d.topHits / d.topN > base ? 'pos' : ''}`} data-label="Tier hit" style={d.topN && d.topHits / d.topN > base ? { color: 'var(--strong)', fontWeight: '700' } : {}}>{d.topN ? pct(d.topHits / d.topN, 0) : '—'}</span>
              {d.dots.length > 0 && (
                // Every tier pick gets a dot (no cap) — smaller and tighter so
                // a 140-pick day still reads as one or two clean lines.
                <div className="daily-dots" style={{ gridColumn: '1 / -1', display: 'flex', flexWrap: 'wrap', gap: '2px', marginTop: '4px', alignItems: 'center' }}>
                  {d.dots.map((p, i) => (
                    <span
                      key={i}
                      title={`${p.name} — ${p.hit ? 'HR ✓' : 'no HR'}`}
                      style={{
                        width: '5px',
                        height: '5px',
                        borderRadius: '50%',
                        background: p.hit ? 'var(--strong)' : 'rgba(255,255,255,0.09)',
                        boxShadow: p.hit ? '0 0 4px rgba(105,185,158,0.55)' : 'none',
                        flexShrink: 0,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, accent }) {
  return (
    <div className="results-kpi" style={{
      background: 'rgba(17, 18, 20, 0.45)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      boxShadow: accent ? `0 0 16px ${hexA(accent, 0.05)}` : 'none',
      borderRadius: '12px',
      padding: '16px',
      textAlign: 'center'
    }}>
      <div className="results-kpi-label" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: '4px' }}>{label}</div>
      <div className="results-kpi-value mono" style={{ fontSize: '26px', fontWeight: '800', color: accent || '#fff' }}>{value}</div>
      {sub && <div className="results-kpi-sub dim" style={{ fontSize: '11px', marginTop: '2px', color: 'var(--text-faint)' }}>{sub}</div>}
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
    <svg viewBox={`0 0 ${W} ${H}`} className="reliability" role="img" aria-label="Reliability diagram" style={{ overflow: 'visible', maxWidth: '400px', width: '100%' }}>
      <defs>
        <radialGradient id="dotGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.4" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {[0, 0.1, 0.2, 0.3].filter((t) => t <= max).map((t) => (
        <g key={t}>
          <line x1={x(t)} y1={pad.t} x2={x(t)} y2={pad.t + ih} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
          <line x1={pad.l} y1={y(t)} x2={pad.l + iw} y2={y(t)} stroke="rgba(255,255,255,0.03)" strokeWidth="1" />
          <text x={x(t)} y={H - 10} fill="var(--text-faint)" fontSize="8" fontFamily="var(--mono)" textAnchor="middle">{Math.round(t * 100)}%</text>
          <text x={pad.l - 5} y={y(t) + 3} fill="var(--text-faint)" fontSize="8" fontFamily="var(--mono)" textAnchor="end">{Math.round(t * 100)}%</text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(max)} y2={y(max)} stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="3 3" />
      <polyline 
        fill="none" 
        stroke="var(--accent)" 
        strokeWidth="2.5" 
        strokeLinecap="round"
        strokeLinejoin="round"
        points={bins.map((b) => `${x(b.avgPredicted)},${y(b.observedRate)}`).join(' ')} 
        style={{ filter: 'drop-shadow(0 0 3px var(--accent-glow))' }}
      />
      {bins.map((b, i) => {
        const radius = 3 + 6 * Math.sqrt((b.n || 0) / maxN)
        return (
          <g key={i}>
            <circle cx={x(b.avgPredicted)} cy={y(b.observedRate)} r={radius * 2} fill="url(#dotGlow)" />
            <circle cx={x(b.avgPredicted)} cy={y(b.observedRate)} r={radius} fill="var(--accent)" stroke="#010102" strokeWidth="1.5">
              <title>predicted {pct(b.avgPredicted, 1)} → observed {pct(b.observedRate, 1)} (n={b.n})</title>
            </circle>
          </g>
        )
      })}
    </svg>
  )
}
