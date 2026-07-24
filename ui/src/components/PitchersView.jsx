import { useMemo, useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { loadBacktestLog } from '../lib/backtestLog.js'
import CommandTabs from './CommandTabs.jsx'
import { GradeChip, ScoreRing, Stat } from './atoms.jsx'
import {
  groupPitchers,
  pitchUsage,
  effSide,
  K_MODEL_VERSION,
  kOverProb,
  projectedK,
  summarizeKProjectionResults,
} from '../lib/pitchers.js'
import { pct, num, rate, gameTime } from '../lib/format.js'
import { evaluateKMarket } from '../lib/kMarket.js'
import { teamColor, teamLogo, playerHeadshot, hexToRgba } from '../lib/teams.js'
import { useLiveMode } from '../lib/liveMode.js'
import { gradeColor } from '../lib/badges.js'
import { hexA } from './atoms.jsx'

const PSORT = [
  { k: 'vuln', label: 'Most hittable' },
  { k: 'time', label: 'Game time' },
]

export default function PitchersView({ batters, kDistByPitcher = {}, liveKsByPitcher = {}, onSelect, selectedId, watchlist, slip, focusKey, onFocusDone }) {
  const [sort, setSort] = useState('vuln')
  const [view, setView] = useState('preview')
  const [kOpen, setKOpen] = useState(false)
  const grouped = useMemo(() => groupPitchers(batters, kDistByPitcher), [batters, kDistByPitcher])
  
  const pitchers = useMemo(() => {
    if (sort !== 'time') return grouped
    return [...grouped].sort(
      (a, b) =>
        (a.game?.gameDate || '').localeCompare(b.game?.gameDate || '') ||
        (b.vuln?.score ?? 0) - (a.vuln?.score ?? 0),
    )
  }, [grouped, sort])

  useEffect(() => {
    if (!focusKey) return
    const el = document.getElementById(`pcard-${focusKey}`)
    if (el) {
      const t = setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' })
        el.classList.add('flash')
        setTimeout(() => el.classList.remove('flash'), 1600)
      }, 60)
      onFocusDone?.()
      return () => clearTimeout(t)
    }
    onFocusDone?.()
  }, [focusKey, pitchers, onFocusDone])

  if (!pitchers.length) {
    return <div className="empty-note" style={{ padding: '64px', textAlign: 'center', color: 'var(--text-faint)' }}>No pitchers match the current filters.</div>
  }
  return (
    <>
      <div className="mobile-page-kicker pitchers-mobile-kicker">
        <span><Icon name="CircleDot" size={14} /> Pitcher board</span>
        <small className="mono">{pitchers.length} starters</small>
      </div>
      <div className="pitchers-controls">
        <span className="pitchers-controls-k dim">View Mode</span>
        <CommandTabs
          className="pitcher-mode-tabs"
          label="Pitcher view"
          value={view}
          onChange={setView}
          ariaPressed
          tabs={[
            { id: 'preview', label: 'Vulnerability', icon: 'Swords' },
            { id: 'detail', label: <><span className="pitcher-detail-label">Detail Cards</span><span className="pitcher-cards-label">Cards</span></>, icon: 'Rows3' },
            { id: 'kbrain', label: 'K Brain', icon: 'Radar', iconSize: 11 },
          ]}
        />
        
        {view === 'detail' && (
          <div className="pitcher-sort-row">
            <span className="pitchers-controls-k dim" style={{ marginLeft: 12, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sort:</span>
            {PSORT.map((t) => (
              <button 
                key={t.k} 
                className={`badge-toggle ${sort === t.k ? 'on' : ''}`} 
                onClick={() => setSort(t.k)}
                style={{
                  borderColor: sort === t.k ? 'var(--accent)' : 'var(--border-soft)',
                  background: sort === t.k ? 'var(--hover)' : 'transparent',
                  color: sort === t.k ? '#fff' : 'var(--text-faint)'
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <KParlaySection pitchers={grouped} open={kOpen} onToggle={() => setKOpen((v) => !v)} />

      {view === 'kbrain' ? (
        <KBrainView pitchers={grouped} liveKsByPitcher={liveKsByPitcher} />
      ) : view === 'preview' ? (
        <PitcherPreview pitchers={grouped} onSelect={onSelect} />
      ) : (
        <div className="pitchers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(420px, 100%), 1fr))', gap: '20px' }}>
          {pitchers.map((e) => (
            <PitcherCard
              key={e.key}
              entry={e}
              onSelect={onSelect}
              selectedId={selectedId}
              watchlist={watchlist}
              slip={slip}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ─── K Brain view ────────────────────────────────────────────────────────────
const TREND_ICON = { up: 'TrendingUp', down: 'TrendingDown', flat: 'Minus' }
const TREND_LABEL = { up: 'Trending up', down: 'Trending down', flat: 'Stable trend' }
const TREND_COLOR = { up: 'var(--strong)', down: 'var(--bad)', flat: 'var(--text-faint)' }
const CONF_COLOR = { high: 'var(--strong)', med: 'var(--accent)', low: 'var(--text-faint)' }

function KBrainView({ pitchers, liveKsByPitcher = {} }) {
  const [markets, setMarkets] = useState({})
  const [marketOpen, setMarketOpen] = useState({})
  const [search, setSearch] = useState('')
  const [minK, setMinK] = useState(0)
  const [confFilter, setConfFilter] = useState('all')
  const [sortBy, setSortBy] = useState('k')
  const [h2hOpen, setH2hOpen] = useState({})
  const [detailsOpen, setDetailsOpen] = useState({})
  const [showAllArms, setShowAllArms] = useState(false)
  const [kLog, setKLog] = useState(null)

  useEffect(() => {
    loadBacktestLog().then(setKLog).catch(() => {})
  }, [])

  const arms = useMemo(() => {
    let pool = pitchers.filter((e) => e.estK && Number.isFinite(e.estK.lambda))
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      pool = pool.filter((e) =>
        e.pitcher.name?.toLowerCase().includes(q) ||
        (e.targets[0]?.team || '').toLowerCase().includes(q)
      )
    }
    if (minK > 0) pool = pool.filter((e) => e.estK.k >= minK)
    if (confFilter !== 'all') pool = pool.filter((e) => e.estK.conf === confFilter)
    return [...pool].sort(sortBy === 'time'
      ? (a, b) => (a.game?.gameDate || '').localeCompare(b.game?.gameDate || '') || b.estK.lambda - a.estK.lambda
      : (a, b) => b.estK.lambda - a.estK.lambda
    )
  }, [pitchers, search, minK, confFilter, sortBy])

  const filterBtnStyle = (active) => ({
    padding: '3px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
    border: `1px solid ${active ? 'var(--accent)' : 'rgba(255,255,255,0.1)'}`,
    background: active ? 'rgba(99,102,241,0.18)' : 'rgba(255,255,255,0.04)',
    color: active ? '#fff' : 'var(--text-faint)', fontWeight: active ? '700' : '400',
  })

  const setMarketField = (key, field, value) => {
    setMarkets((current) => ({
      ...current,
      [key]: {
        line: '',
        overOdds: '',
        underOdds: '',
        side: 'over',
        ...current[key],
        [field]: value,
      },
    }))
  }

  if (!pitchers.filter(e => e.estK).length) {
    return <div className="empty-note" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-faint)' }}>No K estimates available — missing recent start data.</div>
  }

  return (
    <div className="kbrain-view" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Filter bar */}
      <div className="kbrain-filters" style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', background: 'rgba(16,24,48,0.4)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px' }}>
        {/* Search */}
        <input
          className="kbrain-search"
          type="text"
          aria-label="Search pitcher or team"
          placeholder="Search pitcher or team…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '5px 10px', color: '#fff', fontSize: '12px', boxSizing: 'border-box' }}
        />
        {/* Filter chips row */}
        <div className="kbrain-filter-row" style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '2px' }}>Min projected K</span>
          {[0, 4.5, 5.5, 6.5, 7.5].map((v) => (
            <button key={v} style={filterBtnStyle(minK === v)} onClick={() => setMinK(v)}>
              {v === 0 ? 'All' : `${v}+`}
            </button>
          ))}
          <span style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 2px 0 8px' }}>Conf</span>
          {['all', 'high', 'med'].map((v) => (
            <button key={v} style={filterBtnStyle(confFilter === v)} onClick={() => setConfFilter(v)}>
              {v === 'all' ? 'All' : v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
          <span style={{ fontSize: '10px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 2px 0 8px' }}>Sort</span>
          <button style={filterBtnStyle(sortBy === 'k')} onClick={() => setSortBy('k')}>Projected K</button>
          <button style={filterBtnStyle(sortBy === 'time')} onClick={() => setSortBy('time')}>Game Time</button>
        </div>
        {/* Result count */}
        <div className="kbrain-result-count" style={{ fontSize: '10px', color: 'var(--text-faint)' }}>
          {arms.length} pitcher{arms.length !== 1 ? 's' : ''} · projected strikeouts · enter the book line to see over probability
        </div>
      </div>

      {arms.length === 0 && (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '13px' }}>
          No pitchers match those filters.
        </div>
      )}

      <div className={`kbrain-list ${showAllArms ? 'show-all' : ''}`}>
      {arms.map((e) => {
        const ek = e.estK
        const oppTeam = e.targets[0]?.team || '?'
        const market = {
          line: '',
          overOdds: '',
          underOdds: '',
          side: 'over',
          ...markets[e.key],
        }
        const myLine = market.line
        const myLineNum = myLine !== undefined && myLine !== '' ? parseFloat(myLine) : null
        const myProb = myLineNum != null && Number.isFinite(myLineNum) && myLineNum >= 0 && myLineNum <= 15
          ? kOverProb(ek.lambda, myLineNum)
          : null
        const underProb = myLineNum != null && Number.isFinite(myLineNum) && myLineNum >= 0 && myLineNum <= 15
          ? 1 - kOverProb(ek.lambda, Math.ceil(myLineNum) - 1)
          : null
        const decision = evaluateKMarket({
          overProbability: myProb,
          underProbability: underProb,
          overOdds: market.overOdds,
          underOdds: market.underOdds,
          side: market.side,
        })
        const marketMetric = (value, digits = 1, signed = false) => {
          if (!Number.isFinite(value)) return '—'
          const amount = value * 100
          return `${signed && amount > 0 ? '+' : ''}${amount.toFixed(digits)}%`
        }
        const liveK = liveKsByPitcher[e.key]
        const projection = projectedK(ek)

        return (
          <article key={e.key} className={`kbrain-card ${detailsOpen[e.key] ? 'is-expanded' : ''}`}>
            <header className="kbrain-card-head">
              <div className="kbrain-identity">
                <img className="kbrain-headshot" src={playerHeadshot(e.pitcher.id, 96)} alt="" loading="lazy" />
                <div className="kbrain-identity-copy">
                  <div className="kbrain-pitcher-name">{e.pitcher.name}</div>
                  <div className="kbrain-matchup">
                    {e.pitcher.hand}HP · vs {oppTeam}
                    {e.game?.gameDate && <span> · {gameTime(e.game.gameDate)}</span>}
                  </div>
                  <div className="kbrain-projection-meta">
                    <span style={{ color: CONF_COLOR[ek.conf] }}>{ek.conf} confidence</span>
                    <span>{Number.isFinite(ek.expIP) ? `${ek.expIP.toFixed(1)} expected IP` : 'Workload unavailable'}</span>
                  </div>
                </div>
                {liveK && (
                  <div className="kbrain-live">
                    <strong>{liveK.ks} K</strong>
                    <span>live{liveK.ip != null ? ` · ${liveK.ip} IP` : ''}</span>
                  </div>
                )}
              </div>
              <div className="kbrain-projection" title={`80% uncertainty interval: ${ek.lo}–${ek.hi} K`}>
                <strong>{Number.isFinite(projection) ? projection.toFixed(1) : '—'}</strong>
                <span>Projected K</span>
                <small>{Number.isFinite(ek.lo) && Number.isFinite(ek.hi) ? `80% range ${ek.lo}–${ek.hi}` : 'Point estimate'}</small>
              </div>
            </header>

            <section className={`kbrain-market ${marketOpen[e.key] ? 'is-open' : ''}`} aria-label="Sportsbook strikeout market evaluator">
              <div className="kbrain-market-summary" aria-live="polite">
                <div className="kbrain-market-summary-action">
                  <span className={`kbrain-market-verdict tone-${decision.status}`}>{decision.label}</span>
                  <small>
                    {myProb != null
                      ? `${marketMetric(myProb, 0)} model chance to go over ${myLineNum}`
                      : 'Add the sportsbook line to evaluate this market'}
                  </small>
                </div>
                <div className="kbrain-market-summary-metrics">
                  <span><small>Fair {decision.side === 'over' ? 'O' : 'U'}</small><b className="mono">{marketMetric(decision.fairProbability)}</b></span>
                  <span><small>Edge</small><b className={`mono ${decision.edge >= 0.03 ? 'pos' : ''}`}>{marketMetric(decision.edge, 1, true)}</b></span>
                  <span><small>EV</small><b className={`mono ${decision.expectedRoi >= 0.05 ? 'pos' : ''}`}>{marketMetric(decision.expectedRoi, 1, true)}</b></span>
                </div>
                <button
                  type="button"
                  className="kbrain-market-disclosure"
                  onClick={() => setMarketOpen((current) => ({ ...current, [e.key]: !current[e.key] }))}
                  aria-expanded={!!marketOpen[e.key]}
                >
                  {marketOpen[e.key] ? 'Hide market' : 'Market details'}
                  <Icon name={marketOpen[e.key] ? 'ChevronUp' : 'ChevronDown'} size={14} />
                </button>
              </div>

              <div className="kbrain-market-body">
                <div className="kbrain-market-inputs">
                  <label htmlFor={`k-line-${e.key}`}>
                    <span>K line</span>
                    <input
                      id={`k-line-${e.key}`}
                      type="number"
                      step="0.5"
                      min="0"
                      max="15"
                      inputMode="decimal"
                      placeholder="6.5"
                      value={market.line}
                      onChange={(event) => setMarketField(e.key, 'line', event.target.value)}
                    />
                  </label>
                  <label htmlFor={`k-over-${e.key}`}>
                    <span>Over</span>
                    <input
                      id={`k-over-${e.key}`}
                      type="text"
                      inputMode="numeric"
                      placeholder="-110"
                      value={market.overOdds}
                      onChange={(event) => setMarketField(e.key, 'overOdds', event.target.value)}
                    />
                  </label>
                  <label htmlFor={`k-under-${e.key}`}>
                    <span>Under</span>
                    <input
                      id={`k-under-${e.key}`}
                      type="text"
                      inputMode="numeric"
                      placeholder="-110"
                      value={market.underOdds}
                      onChange={(event) => setMarketField(e.key, 'underOdds', event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="kbrain-market-side"
                    onClick={() => setMarketField(e.key, 'side', market.side === 'over' ? 'under' : 'over')}
                    aria-label={`Selected side: ${market.side}. Switch to ${market.side === 'over' ? 'under' : 'over'}.`}
                  >
                    Side: {market.side === 'over' ? 'O' : 'U'}
                  </button>
                </div>

                <div className="kbrain-market-comparison" aria-live="polite">
                  <span><b className="mono">{marketMetric(decision.fairProbability)}</b><small>Fair model</small></span>
                  <span><b className="mono">{marketMetric(decision.impliedProbability)}</b><small>Implied</small></span>
                  <span title={decision.noVigProbability == null ? 'Enter both Over and Under prices to remove the vig.' : 'Both sides normalized to remove sportsbook hold.'}>
                    <b className="mono">{marketMetric(decision.noVigProbability)}</b><small>No-vig</small>
                  </span>
                  <span><b className={`mono ${decision.edge >= 0.03 ? 'pos' : decision.edge < 0 ? 'neg' : ''}`}>{marketMetric(decision.edge, 1, true)}</b><small>Edge</small></span>
                  <span><b className={`mono ${decision.expectedRoi >= 0.05 ? 'pos' : decision.expectedRoi < 0 ? 'neg' : ''}`}>{marketMetric(decision.expectedRoi, 1, true)}</b><small>EV / ROI</small></span>
                </div>

                <div className="kbrain-market-action">
                  <span className={`kbrain-market-verdict tone-${decision.status}`}>{decision.label}</span>
                  <p>{decision.detail}</p>
                  <button
                    type="button"
                    className="kbrain-market-info"
                    aria-label="Explain market metrics"
                    title="Fair: model win chance. Implied: probability in the selected price. No-vig: both prices normalized to remove hold. Edge: model minus market probability. EV: expected return per dollar."
                  >
                    <Icon name="Info" size={14} />
                  </button>
                </div>
              </div>
            </section>

            <section className="kbrain-drivers" aria-label="Primary projection drivers">
              <div className="kbrain-section-label">Why this projection</div>
              <div className="kbrain-driver-list">
                <div className="kbrain-driver">
                  <Icon name="Gauge" size={15} />
                  <span>
                    <strong>{Number.isFinite(ek.expIP) ? `${ek.expIP.toFixed(1)} IP` : '—'}</strong>
                    <small>{Number.isFinite(ek.expBF) ? `${Math.round(ek.expBF)} expected batters` : 'Expected workload'}</small>
                  </span>
                </div>
                <div className="kbrain-driver">
                  <Icon name="Users" size={15} />
                  <span>
                    <strong>{pct(ek.oppK, 1)}</strong>
                    <small>Opponent K rate</small>
                  </span>
                </div>
                <div className="kbrain-driver" style={{ '--driver-color': TREND_COLOR[ek.trend] }}>
                  <Icon name={TREND_ICON[ek.trend]} size={15} />
                  <span>
                    <strong>{pct(ek.adjustedKRate, 1)}</strong>
                    <small>Adjusted K rate · {TREND_LABEL[ek.trend]}</small>
                  </span>
                </div>
              </div>
            </section>

            <div className="kbrain-context">
              <div className="kbrain-section-label">Model &amp; matchup context</div>
              <div className="kbrain-adjustments">
                {ek.tempF != null && (
                  <span style={{ color: ek.tempAdj < 0.97 ? 'var(--bad)' : ek.tempAdj > 1.02 ? 'var(--strong)' : 'var(--text-faint)' }}>
                    {Math.round(ek.tempF)}°F{ek.tempAdj < 0.97 ? ' · cold' : ek.tempAdj > 1.02 ? ' · warm' : ''}
                  </span>
                )}
                {ek.umpireAdj != null && ek.umpireAdj !== 1 && (
                  <span style={{ color: ek.umpireAdj > 1.01 ? 'var(--strong)' : 'var(--bad)' }}>
                    Umpire {ek.umpireAdj > 1.01 ? '+ K zone' : '− K zone'}
                  </span>
                )}
                {ek.parkKAdj != null && ek.parkKAdj !== 1 && (
                  <span style={{ color: ek.parkKAdj < 0.97 ? 'var(--bad)' : ek.parkKAdj > 1.02 ? 'var(--strong)' : 'var(--text-faint)' }}>
                    Park {ek.parkKAdj > 1 ? `+${((ek.parkKAdj - 1) * 100).toFixed(0)}%` : `${((ek.parkKAdj - 1) * 100).toFixed(0)}%`} K
                  </span>
                )}
                {ek.tttoPenalty != null && ek.tttoPenalty < 0.97 && (
                  <span style={{ color: 'var(--bad)' }} title="Third-time-through-order K decay">
                    TTTO −{((1 - ek.tttoPenalty) * 100).toFixed(0)}%
                  </span>
                )}
                {ek.vegasTrim != null && ek.vegasTrim < 1 && (
                  <span style={{ color: 'var(--bad)' }} title="Elite-contact lineup creates earlier hook risk">
                    Lineup pressure −{((1 - ek.vegasTrim) * 100).toFixed(0)}%
                  </span>
                )}
              </div>
              <KBrainH2H
                targets={e.targets}
                open={!!h2hOpen[e.key]}
                onToggle={() => setH2hOpen((prev) => ({ ...prev, [e.key]: !prev[e.key] }))}
              />
            </div>
            <button
              className="kbrain-card-toggle"
              onClick={() => setDetailsOpen((prev) => ({ ...prev, [e.key]: !prev[e.key] }))}
              aria-expanded={!!detailsOpen[e.key]}
            >
              {detailsOpen[e.key] ? 'Show less' : 'More context'}
              <Icon name={detailsOpen[e.key] ? 'ChevronUp' : 'ChevronDown'} size={14} />
            </button>
          </article>
        )
      })}
      </div>
      {arms.length > 8 && (
        <button className="kbrain-list-toggle" onClick={() => setShowAllArms((open) => !open)} aria-expanded={showAllArms}>
          {showAllArms ? 'Show top 8 pitchers' : `Show all ${arms.length} pitchers`}
          <Icon name={showAllArms ? 'ChevronUp' : 'ChevronDown'} size={14} />
        </button>
      )}

      {/* K-prop results scorecard */}
      {(() => {
        const resultsByDate = kLog?.kProps?.resultsByDate
        if (!resultsByDate) return null
        const dates = Object.keys(resultsByDate).sort().slice(-7).reverse()
        if (!dates.length) return null
        const recentResults = dates.flatMap((d) => resultsByDate[d] || [])
        const currentResults = recentResults.filter((row) => row.modelVersion === K_MODEL_VERSION)
        const showingCurrentModel = currentResults.length > 0
        const scoredResults = showingCurrentModel ? currentResults : recentResults
        const projectionSummary = summarizeKProjectionResults(scoredResults)
        const displayDates = dates.filter((d) => (resultsByDate[d] || []).some((row) => (
          showingCurrentModel ? row.modelVersion === K_MODEL_VERSION : true
        )))
        return (
          <details className="kbrain-record" style={{ marginTop: '20px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '16px' }}>
            <summary className="kbrain-record-summary" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={{ fontSize: '12px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)' }}>K projection accuracy</span>
              {projectionSummary.n > 0 && (
                <span style={{ fontSize: '11px', color: projectionSummary.mae <= 1 ? 'var(--strong)' : projectionSummary.mae <= 1.75 ? '#c69a57' : 'var(--bad)' }}>
                  {showingCurrentModel ? `v${K_MODEL_VERSION}` : 'legacy'} · MAE {projectionSummary.mae.toFixed(1)} K · exact {projectionSummary.exactCount}/{projectionSummary.n} · ±1 K {projectionSummary.withinCount}/{projectionSummary.n}
                </span>
              )}
              <Icon className="kbrain-record-chevron" name="ChevronDown" size={14} />
            </summary>
            {!showingCurrentModel && projectionSummary.n > 0 && (
              <div style={{ fontSize: '10px', color: 'var(--text-faint)', margin: '-4px 0 10px' }}>
                Legacy baseline only. v{K_MODEL_VERSION} tracking begins with its first graded slate. Exact and ±1 use the rounded projected total; MAE uses the decimal projection.
              </div>
            )}
            <div className="kbrain-record-body">
              {displayDates.map((d) => {
                const rows = (resultsByDate[d] || []).filter((e) => (
                  e.actualK != null && (showingCurrentModel ? e.modelVersion === K_MODEL_VERSION : true)
                ))
              if (!rows.length) return null
              return (
                <div key={d} style={{ marginBottom: '12px' }}>
                  <div style={{ fontSize: '10px', fontWeight: '700', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '5px' }}>{d}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                    {rows.map((e, i) => {
                      const projection = projectedK(e)
                      const pointProjection = Number.isFinite(projection) ? Math.round(projection) : null
                      const pointError = Number.isFinite(pointProjection) ? e.actualK - pointProjection : null
                      const hit = Number.isFinite(pointError) && Math.abs(pointError) <= 1
                      return (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px', padding: '4px 8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                          <span style={{ flex: 1, fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.name}</span>
                          <span className="mono" style={{ color: 'var(--text-faint)', flexShrink: 0 }}>proj {Number.isFinite(projection) ? `${projection.toFixed(1)} → ${pointProjection}` : '—'} K</span>
                          <span className="mono" style={{ color: '#fff', fontWeight: '700', flexShrink: 0 }}>actual {e.actualK}</span>
                          {Number.isFinite(pointError) && <span className="mono" style={{ color: hit ? 'var(--strong)' : 'var(--bad)', flexShrink: 0 }}>{pointError >= 0 ? '+' : ''}{pointError}</span>}
                          <Icon name={hit ? 'Check' : 'X'} size={13} style={{ flexShrink: 0, color: hit ? 'var(--strong)' : 'var(--bad)' }} aria-label={hit ? 'within one strikeout' : 'more than one strikeout off'} />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            </div>
          </details>
        )
      })()}
    </div>
  )
}

// ─── H2H K matchup table for K Brain ─────────────────────────────────────────
// Shows each opposing batter's career K rate vs this specific pitcher,
// relative to their season average. Requires h2h.ab >= 5 for a meaningful
// sample. Sorted by H2H K% so the most K-prone matchups surface first.
function KBrainH2H({ targets, open, onToggle }) {
  const rows = useMemo(() => {
    const seen = new Set()
    return (targets || [])
      .filter((b) => {
        if (!b.playerId || seen.has(b.playerId)) return false
        seen.add(b.playerId)
        return b.h2h && b.h2h.ab >= 5 && Number.isFinite(b.h2h.k)
      })
      .map((b) => {
        const h2hKPct  = b.h2h.k / b.h2h.ab
        const ss       = b.season
        const pa       = (ss?.ab || 0) + (ss?.bb || 0)
        const seasonKPct = pa > 0 ? (ss?.k || 0) / pa : null
        const delta    = seasonKPct != null ? h2hKPct - seasonKPct : null
        return { b, h2hKPct, seasonKPct, delta }
      })
      .sort((a, b) => b.h2hKPct - a.h2hKPct)
  }, [targets])

  if (!rows.length) return null

  const highK  = rows.filter((r) => r.h2hKPct >= 0.30).length
  const lowK   = rows.filter((r) => r.h2hKPct <= 0.12).length

  return (
    <div className="kbrain-h2h" style={{ marginTop: '10px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '10px' }}>
      <button
        className="kbrain-h2h-trigger"
        onClick={onToggle}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', padding: '0', cursor: 'pointer', width: '100%', textAlign: 'left' }}
      >
        <Icon name="BookOpen" size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: '11px', fontWeight: '700', color: open ? '#fff' : 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          H2H K rates
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-faint)', fontWeight: '400' }}>
          · {rows.length} batters
          {highK > 0 && <span style={{ color: 'var(--bad)', marginLeft: '4px' }}>{highK} K-prone</span>}
          {lowK  > 0 && <span style={{ color: 'var(--strong)', marginLeft: '4px' }}>{lowK} K-resistant</span>}
        </span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={11} style={{ marginLeft: 'auto', color: 'var(--text-faint)' }} />
      </button>

      {open && (
        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 40px 40px 44px 52px', gap: '4px', fontSize: '9px', color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '0 4px', marginBottom: '2px' }}>
            <span>Batter</span>
            <span style={{ textAlign: 'right' }}>AB</span>
            <span style={{ textAlign: 'right' }}>K</span>
            <span style={{ textAlign: 'right' }}>H2H K%</span>
            <span style={{ textAlign: 'right' }}>vs szn</span>
          </div>
          {rows.map(({ b, h2hKPct, delta }) => {
            const kColor = h2hKPct >= 0.30 ? 'var(--bad)'
                         : h2hKPct <= 0.12 ? 'var(--strong)'
                         : '#fff'
            const deltaStr = delta != null
              ? (delta > 0 ? `+${(delta * 100).toFixed(0)}%` : `${(delta * 100).toFixed(0)}%`)
              : '—'
            const deltaColor = delta == null ? 'var(--text-faint)'
                             : delta > 0.05 ? 'var(--bad)'
                             : delta < -0.05 ? 'var(--strong)'
                             : 'var(--text-faint)'
            return (
              <div
                key={b.playerId}
                style={{ display: 'grid', gridTemplateColumns: '1fr 40px 40px 44px 52px', gap: '4px', fontSize: '11px', padding: '4px', borderRadius: '6px', background: 'rgba(255,255,255,0.03)', alignItems: 'center' }}
              >
                <span style={{ fontWeight: '600', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                  {b.battingOrder ? <span style={{ fontSize: '9px', color: 'var(--text-faint)', marginLeft: '4px' }}>#{b.battingOrder}</span> : null}
                </span>
                <span className="mono" style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{b.h2h.ab}</span>
                <span className="mono" style={{ textAlign: 'right', color: 'var(--text-faint)' }}>{b.h2h.k}</span>
                <span className="mono" style={{ textAlign: 'right', fontWeight: '700', color: kColor }}>{(h2hKPct * 100).toFixed(0)}%</span>
                <span className="mono" style={{ textAlign: 'right', fontSize: '10px', color: deltaColor }}>{deltaStr}</span>
              </div>
            )
          })}
          <div style={{ fontSize: '9px', color: 'var(--text-faint)', marginTop: '4px', paddingLeft: '4px' }}>
            H2H K% vs season PA K rate · min 5 AB · sorted high→low
          </div>
        </div>
      )}
    </div>
  )
}

// Build K-prop parlay combos across pitchers. Ranks pitchers by estimated K
// count, then builds 2-leg and 3-leg combos with a suggested line below the
// single-number K projection so the target is realistic.
function buildKParlays(pitchers) {
  const pool = pitchers
    .filter((e) => e.estK && Number.isFinite(e.estK.k) && e.estK.k >= 4)
    .sort((a, b) => (b.estK.k - a.estK.k) || (b.vuln?.score ?? 0) - (a.vuln?.score ?? 0))
  if (pool.length < 2) return []
  const combos = []
  for (const size of [2, 3]) {
    if (pool.length < size) continue
    const legs = pool.slice(0, size)
    combos.push({ size, legs })
  }
  return combos
}

// Suggest a K line: floor to nearest 0.5 below the projected total so the line
// is hittable (e.g. est 7.2 → offer 6.5+, not 7.5+).
function kLine(estK) {
  return Math.floor(estK.k * 2) / 2  // floor to nearest 0.5
}

function KParlaySection({ pitchers, open, onToggle }) {
  const combos = useMemo(() => buildKParlays(pitchers), [pitchers])
  if (!combos.length) return null
  return (
    <div className="k-parlay-section" style={{ marginBottom: '16px', background: 'rgba(16,24,48,0.35)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '12px', overflow: 'hidden' }}>
      <button
        className="k-parlay-trigger"
        onClick={onToggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer', color: open ? '#fff' : 'var(--text-dim)', textAlign: 'left' }}
      >
        <Icon name="Zap" size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontWeight: '800', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>K-Prop Parlays</span>
        <span style={{ fontSize: '11px', color: 'var(--text-faint)', fontWeight: '400' }}>· {combos.length} combo{combos.length !== 1 ? 's' : ''} · top strikeout arms</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={13} style={{ marginLeft: 'auto', color: 'var(--text-faint)' }} />
      </button>
      {open && (
        <div style={{ padding: '0 16px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {combos.map((c) => (
            <div key={c.size} style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '10px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-faint)' }}>{c.size}-leg parlay</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                {c.legs.map((e, i) => {
                  const line = kLine(e.estK)
                  const oppTeam = e.targets[0]?.team || '?'
                  return (
                    <span key={e.key} style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', padding: '5px 10px', fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '1px', lineHeight: 1.3 }}>
                        <span style={{ fontWeight: '700', color: '#fff' }}>{e.pitcher.name}</span>
                        <span style={{ fontSize: '10px', color: 'var(--accent)' }}>
                          <b>{line}+ K</b>
                          <span style={{ color: 'var(--text-faint)', marginLeft: '4px' }}>proj {projectedK(e.estK)?.toFixed(1)} K vs {oppTeam}</span>
                        </span>
                      </span>
                      {i < c.legs.length - 1 && <span style={{ color: 'var(--text-faint)', fontSize: '11px', fontWeight: '700' }}>+</span>}
                    </span>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const PVP_TIERS = [
  { key: 'vuln', label: 'High Exposure', sub: 'extreme HR risk', verdict: 'Attack', color: '#c96f7e', test: (s) => s >= 80 },
  { key: 'shaky', label: 'Shaky Rotation', sub: 'selective exposure', verdict: 'Watch', color: '#ffb02e', test: (s) => s >= 60 && s < 80 },
  { key: 'mild', label: 'Situational', sub: 'target with support', verdict: 'Lean', color: '#d6b56f', test: (s) => s >= 40 && s < 60 },
  { key: 'tough', label: 'Protected', sub: 'avoid forcing action', verdict: 'Pass', color: '#69b99e', test: (s) => s < 40 },
]

function lastName(name) {
  const p = (name || '').trim().split(/\s+/)
  return p.length > 1 ? p.slice(1).join(' ') : name || ''
}

function PitcherPreview({ pitchers, onSelect }) {
  const [openTiers, setOpenTiers] = useState(() => Object.fromEntries(PVP_TIERS.map((tier) => [tier.key, true])))
  const tbd = pitchers.filter((e) => !Number.isFinite(e.pitcher?.season?.hrPer9))
  const scored = pitchers
    .filter((e) => Number.isFinite(e.pitcher?.season?.hrPer9))
    .sort((a, b) => (b.vuln?.score ?? 0) - (a.vuln?.score ?? 0))
  const attackable = scored.filter((e) => (e.vuln?.score ?? 0) >= 60)
  const topEntry = scored[0]
  const topTarget = topEntry?.targets?.find((b) => b.playerId != null)
  return (
    <div className="pvp pvp-attack-board">
      <div className="pvp-command-strip">
        <div className="pvp-command-title">
          <span className="pvp-command-icon"><Icon name="Crosshair" size={15} /></span>
          <span><b>Vulnerability Attack Board</b><small>Pitcher risk → supporting evidence → target bats</small></span>
        </div>
        <div className="pvp-command-facts">
          <span><small>Slate posture</small><b className={attackable.length ? 'is-live' : ''}>{attackable.length ? 'Attack spots live' : 'Selective'}</b></span>
          <span><small>Attackable</small><b className="mono">{attackable.length}</b></span>
          <span><small>Top target</small><b>{topTarget ? lastName(topTarget.name) : 'No target'}</b></span>
        </div>
      </div>
      {PVP_TIERS.map((t) => {
        const rows = scored.filter((e) => t.test(e.vuln?.score ?? 50))
        if (!rows.length) return null
        const expanded = openTiers[t.key]
        return (
          <section className={`pvp-tier ${expanded ? 'is-open' : ''}`} key={t.key} style={{ '--tier-color': t.color }}>
            <button
              type="button"
              className="pvp-tier-head"
              onClick={() => setOpenTiers((current) => ({ ...current, [t.key]: !current[t.key] }))}
              aria-expanded={expanded}
            >
              <span className="pvp-dot" />
              <span className="pvp-tier-copy"><b>{t.label}</b><small>{t.sub}</small></span>
              <span className="pvp-tier-verdict">{t.verdict}</span>
              <span className="pvp-tier-n mono">{rows.length}</span>
              <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={15} />
            </button>
            <div className="pvp-tier-rows" hidden={!expanded}>
              {rows.map((e) => <PvpRow key={e.key} e={e} tier={t} onSelect={onSelect} />)}
            </div>
          </section>
        )
      })}
      {tbd.length > 0 && (
        <section className="pvp-tier pvp-tier-tbd" style={{ '--tier-color': '#676673' }}>
          <div className="pvp-tier-head pvp-tier-head-static">
            <span className="pvp-dot" />
            <span className="pvp-tier-copy"><b>TBD / low sample</b><small>treat league average</small></span>
            <span className="pvp-tier-n mono">{tbd.length}</span>
          </div>
          <div className="pvp-tbd">{tbd.map((e) => `${e.pitcher.name} (${e.targets[0]?.team || '?'})`).join(' · ')}</div>
        </section>
      )}
    </div>
  )
}

// Build 2-leg and 3-leg SGP suggestions from the top targets for a pitcher.
// Joint probability is a naive product (no within-game correlation adjustment)
// but gives a useful fair-value floor for the SGP price.
function sgpLegs(targets, n) {
  const seen = new Set()
  const pool = targets.filter((b) => b.playerId != null && Number.isFinite(b.hrProbability) && !seen.has(b.playerId) && seen.add(b.playerId))
  if (pool.length < n) return null
  const legs = pool.slice(0, n)
  const prob = legs.reduce((acc, b) => acc * b.hrProbability, 1)
  return { legs, prob }
}

function SgpCombo({ legs, prob, onSelect }) {
  return (
    <div className="pvp-combo">
      {legs.map((b, i) => (
        <span className="pvp-combo-leg" key={b.playerId}>
          <button
            className={`pvp-bat ${(b.grade?.label || b.grade) === 'PRIME' ? 'prime' : ''}`}
            onClick={() => onSelect?.(b)}
            title={`${b.name} · ${pct(b.hrProbability, 1)} HR`}
          >
            {lastName(b.name)}
          </button>
          {i < legs.length - 1 && <span className="pvp-combo-plus">+</span>}
        </span>
      ))}
      <span className="pvp-combo-fair mono">~{pct(prob, 1)} fair</span>
    </div>
  )
}

function pvpReasons(e) {
  const s = e.pitcher?.season || {}
  const sav = e.pitcher?.savant || {}
  const reasons = []
  if (s.hrPer9 >= 1.5) reasons.push('Elevated home-run rate')
  else if (s.hrPer9 >= 1.1) reasons.push('Playable HR profile')
  if (sav.exitVeloAgainst >= 90) reasons.push('Hard contact running hot')
  else if (sav.exitVeloAgainst >= 88) reasons.push('Firm contact allowed')
  if (e.estK?.k <= 5) reasons.push('Low strikeout resistance')
  if ((e.targets || []).some((b) => (b.grade?.label || b.grade) === 'PRIME')) reasons.push('Prime bat in matchup')
  return reasons.slice(0, 2).length ? reasons.slice(0, 2) : ['No single attack flag', 'Require batter-side support']
}

function PvpRow({ e, tier, onSelect }) {
  const [open, setOpen] = useState(false)
  const p = e.pitcher
  const s = p.season || {}
  const sav = p.savant || {}
  const seen = new Set()
  const tg = e.targets.filter((b) => b.playerId != null && !seen.has(b.playerId) && seen.add(b.playerId)).slice(0, 4)
  const oppTeam = tg[0]?.team || '?'
  const sgp2 = sgpLegs(e.targets, 2)
  const sgp3 = sgpLegs(e.targets, 3)
  const reasons = pvpReasons(e)
  const kProjection = projectedK(e.estK)
  return (
    <article className={`pvp-row ${open ? 'is-open' : ''}`}>
      <div className="pvp-identity">
        <span className="pvp-pitcher-silo"><img src={playerHeadshot(p.id, 96)} alt={p.name} loading="lazy" /></span>
        <div className="pvp-p">
          <span className="pvp-name">{p.name}</span>
          <span className="pvp-matchup"><b>{p.hand}HP</b><span>vs {oppTeam}</span></span>
        </div>
      </div>

      <div className="pvp-decision">
        <span className="pvp-vuln-score">
          <b className="mono">{Math.round(e.vuln?.score ?? 0)}</b>
          <small>score</small>
        </span>
        <span className="pvp-verdict-copy">
          <b className={`pvp-verdict pvp-verdict-${tier?.verdict?.toLowerCase()}`}>{tier?.verdict}</b>
          <span className="pvp-reasons">{reasons.map((reason) => <small key={reason}><Icon name="Check" size={10} />{reason}</small>)}</span>
        </span>
      </div>

      <div className="pvp-stats mono">
        <span><b>{num(s.hrPer9, 2)}</b><small>HR/9</small></span>
        <span title={Number.isFinite(kProjection) ? `Projected strikeouts: ${kProjection.toFixed(1)} K (80% interval ${e.estK.lo}–${e.estK.hi}; ≈${e.estK.expIP.toFixed(1)} IP vs a ${pct(e.estK.oppK, 0)}-K lineup)` : undefined}><b className="is-accent">{Number.isFinite(kProjection) ? kProjection.toFixed(1) : '—'}</b><small>Proj K</small></span>
        <span><b>{sav.exitVeloAgainst != null ? num(sav.exitVeloAgainst, 0) : '—'}</b><small>EV</small></span>
      </div>

      <div className="pvp-target-rail">
        <span className="pvp-target-label">Target bats</span>
        <div className="pvp-bats">
        {tg.map((b) => (
          <button
            key={b.playerId}
            className={`pvp-target ${(b.grade?.label || b.grade) === 'PRIME' ? 'prime' : ''}`}
            onClick={() => onSelect?.(b)}
            title={`${b.name} · ${pct(b.hrProbability, 1)} HR`}
          >
            <span className="pvp-target-photo"><img src={playerHeadshot(b.playerId, 72)} alt="" loading="lazy" /></span>
            <span className="pvp-target-copy"><b>{lastName(b.name)}</b><small className="mono">{pct(b.hrProbability, 1)}</small></span>
            {(b.grade?.label || b.grade) === 'PRIME' && <em>Prime</em>}
          </button>
        ))}
        </div>
        {(sgp2 || sgp3) && (
          <button
            className="pvp-sgp-toggle"
            onClick={(ev) => { ev.stopPropagation(); setOpen((v) => !v) }}
            aria-expanded={open}
            title={open ? 'Hide SGP combos' : 'Show SGP combos'}
          >
            <Icon name={open ? 'ChevronUp' : 'Plus'} size={14} />
            <span>{open ? 'Hide combos' : 'Build SGP'}</span>
            {sgp2 && <small className="mono">~{pct(sgp2.prob, 1)}</small>}
          </button>
        )}
      </div>

      {open && (sgp2 || sgp3) && (
        <div className="pvp-sgp">
          <span className="pvp-sgp-title"><Icon name="GitMerge" size={12} />Same-game combinations <small>Fair probability floor; correlation not applied</small></span>
          {sgp2 && (
            <div className="pvp-sgp-row">
              <span>2-leg</span>
              <SgpCombo legs={sgp2.legs} prob={sgp2.prob} onSelect={onSelect} />
            </div>
          )}
          {sgp3 && (
            <div className="pvp-sgp-row">
              <span>3-leg</span>
              <SgpCombo legs={sgp3.legs} prob={sgp3.prob} onSelect={onSelect} />
            </div>
          )}
        </div>
      )}
    </article>
  )
}

// Match Savant's long pitch_name ("4-Seam Fastball") to our short usage label
// ("4-Seam") — prefix match either way on the first 5 letters, punctuation-blind.
function pitchNameMatches(savantName, label) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
  const a = norm(savantName)
  const b = norm(label)
  if (!a || !b) return false
  return a.startsWith(b) || b.startsWith(a) || a.slice(0, 5) === b.slice(0, 5)
}

const HITTABLE = 'bad'
const TOUGH = 'good'
function tone(value, { hi, lo, invert = false }) {
  if (value == null || Number.isNaN(value)) return undefined
  const hot = value >= hi
  const cold = value <= lo
  if (!hot && !cold) return undefined
  return (invert ? cold : hot) ? HITTABLE : TOUGH
}

export function PitcherCard({ entry, onSelect, selectedId, watchlist, slip }) {
  const [sgpOpen, setSgpOpen] = useState(false)
  const [scoutingOpen, setScoutingOpen] = useState(false)
  const { pitcher, vuln, targets, team, game, attackSide } = entry
  const color = teamColor(team?.id)
  const logo = teamLogo(team?.id)
  const season = pitcher.season || {}
  const sav = pitcher.savant || {}
  const x = pitcher.xStats || {}
  const usage = pitchUsage(pitcher.pitchMix)
  const worst = pitcher.pitchMix?.worstPitch
  const vl = pitcher.splits?.vl
  const vr = pitcher.splits?.vr
  const lH = vl?.hrPer9
  const rH = vr?.hrPer9
  const pl3d = pitcher.recentForm?.pitchesL3D
  const hand = pitcher.hand ? `${pitcher.hand}HP` : null

  const matchup = game ? `${game.awayTeam?.abbr} @ ${game.homeTeam?.abbr}` : null
  const liveMode = useLiveMode()
  const live = liveMode && game?.isLive
  const isFinal = game?.isFinal
  const vulnScore = Math.round(vuln?.score ?? 0)
  const attackRate = attackSide === 'L' ? lH : attackSide === 'R' ? rH : null
  const verdictTitle = vulnScore >= 70 ? 'Attackable power matchup' : vulnScore >= 50 ? 'Selective power matchup' : 'Tough power matchup'
  const verdictDetail = attackSide
    ? `${attackSide === 'L' ? 'Left-handed' : 'Right-handed'} bats own the cleaner path${Number.isFinite(attackRate) ? ` at ${num(attackRate, 2)} HR/9` : ''}.`
    : 'No meaningful platoon advantage is available in the current sample.'
  const kProjection = projectedK(entry.estK)

  return (
    <section id={`pcard-${entry.key}`} className={`pcard ${isFinal ? 'final' : ''} ${scoutingOpen ? 'scouting-open' : ''}`} style={{
      '--tc': color,
      background: 'rgba(17, 18, 20, 0.45)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'var(--glass-shadow)',
      borderRadius: '16px',
      padding: '20px',
      position: 'relative',
      overflow: 'hidden'
    }}>
      <div className="pcard-accent" style={{ background: hexToRgba(color, 0.08), position: 'absolute', inset: 0, zIndex: 0 }} />

      {/* Decision hero */}
      <header className="pcard-head" style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '16px', position: 'relative', zIndex: 1 }}>
        <span className="pcard-photo-silo">
          <img className="pcard-photo" src={playerHeadshot(pitcher.id, 120)} alt={pitcher.name} loading="lazy" />
          {logo && <img className="pcard-team-mark" src={logo} alt="" loading="lazy" />}
        </span>
        <div className="pcard-id" style={{ flex: '1', minWidth: '0' }}>
          <div className="pcard-kicker">Pitcher blueprint {matchup && <><i /> <span>{matchup}</span></>}</div>
          <div className="pcard-name" style={{ fontSize: '15px', fontWeight: '800', color: '#fff' }}>{pitcher.name}</div>
          <div className="pcard-sub" style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-dim)', flexWrap: 'wrap', marginTop: '2px' }}>
            {logo && <img className="pcard-logo" src={logo} alt="" loading="lazy" style={{ width: '14px', height: '14px' }} />}
            <span>{team?.abbr}</span>
            {hand && <span className="pcard-hand">({hand})</span>}
            {matchup && <span>· {matchup}</span>}
            {live ? <span className="pcard-live" style={{ color: 'var(--bad)', fontWeight: '700' }}>LIVE</span> : isFinal ? <span className="final-tag">FINAL</span> : game?.gameDate && <span>· {gameTime(game.gameDate)}</span>}
          </div>
        </div>
        <div className="pcard-vuln" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span className="pcard-vgrade" style={{ color: vuln?.grade?.color, fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {vuln?.grade?.label}
          </span>
          <ScoreRing score={vuln?.score ?? 0} color={vuln?.grade?.color} size={48} />
        </div>
      </header>

      <div className={`pcard-verdict ${vulnScore >= 70 ? 'is-attackable' : vulnScore < 50 ? 'is-tough' : ''}`}>
        <Icon name={vulnScore >= 70 ? 'TriangleAlert' : vulnScore < 50 ? 'Shield' : 'Crosshair'} size={16} />
        <span><b>{verdictTitle}</b><small>{verdictDetail}</small></span>
      </div>

      {/* Driver stats */}
      <div className="pcard-stats" style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(3, 1fr)', 
        gap: '6px', 
        marginBottom: '14px', 
        position: 'relative', 
        zIndex: 1 
      }}>
        <Stat label="HR/9" value={num(season.hrPer9, 2)} tone={tone(season.hrPer9, { hi: 1.4, lo: 0.9 })} />
        <Stat label="Gopher pitch" value={worst?.rv > 0.5 ? worst.name : 'No flag'} sub={worst?.rv > 0.5 ? `+${worst.rv.toFixed(1)} RV/100` : 'Below warning line'} tone={worst?.rv > 0.5 ? 'bad' : undefined} />
        <Stat label="Projected K" value={Number.isFinite(kProjection) ? kProjection.toFixed(1) : '—'} sub={entry.estK ? `${entry.estK.conf || 'low'} confidence` : null} />
        <Stat label="ERA" value={num(season.era, 2)} tone={tone(season.era, { hi: 4.6, lo: 3.0 })} />
        <Stat label="Barrel%" value={sav.barrelPctAllowed != null ? num(sav.barrelPctAllowed, 1) : '—'} tone={tone(sav.barrelPctAllowed, { hi: 9, lo: 6 })} />
        <Stat label="EV against" value={sav.exitVeloAgainst != null ? `${num(sav.exitVeloAgainst, 1)}` : '—'} tone={tone(sav.exitVeloAgainst, { hi: 90, lo: 87 })} />
        <Stat
          label={Number.isFinite(x.xEra) ? 'xERA' : 'xwOBA'}
          value={Number.isFinite(x.xEra) ? num(x.xEra, 2) : Number.isFinite(x.xwOba) ? rate(x.xwOba) : '—'}
        />
      </div>

      {attackSide && (
        <div className="pcard-attack-blueprint">
          <span className={attackSide === 'L' ? 'on' : ''}>
            <small>{attackSide === 'L' ? 'Primary attack side' : 'Opposite side'}</small>
            <b>{attackSide === 'L' ? 'Left-handed bats' : 'Lefties'} <em className="mono">{lH != null ? num(lH, 2) : '—'} HR/9</em></b>
          </span>
          <span className={attackSide === 'R' ? 'on' : ''}>
            <small>{attackSide === 'R' ? 'Primary attack side' : 'Opposite side'}</small>
            <b>{attackSide === 'R' ? 'Right-handed bats' : 'Righties'} <em className="mono">{rH != null ? num(rH, 2) : '—'} HR/9</em></b>
          </span>
        </div>
      )}

      {attackSide && (
        <div className="pcard-attack" style={{ 
          background: 'rgba(0,0,0,0.15)', 
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: '8px', 
          padding: '8px 12px', 
          display: 'flex', 
          gap: '12px', 
          fontSize: '12px', 
          marginBottom: '14px', 
          position: 'relative', 
          zIndex: 1 
        }}>
          <span className="pa-cap" style={{ fontWeight: '700', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            <Icon name="Crosshair" size={12} style={{ color: 'var(--accent)' }} /> Platoon Target
          </span>
          <span className="pa-mobile-copy">
            <small>Best attack side</small>
            <b>Target {attackSide === 'L' ? 'lefties' : 'righties'}</b>
          </span>
          <span className={`pa-hand ${attackSide === 'L' ? 'on' : ''}`} style={{ color: attackSide === 'L' ? 'var(--strong)' : 'var(--text-faint)', fontWeight: attackSide === 'L' ? '700' : '400' }}>
            LHB <b className="mono">{lH != null ? num(lH, 2) : '—'}</b>
          </span>
          <span className={`pa-hand ${attackSide === 'R' ? 'on' : ''}`} style={{ color: attackSide === 'R' ? 'var(--strong)' : 'var(--text-faint)', fontWeight: attackSide === 'R' ? '700' : '400' }}>
            RHB <b className="mono">{rH != null ? num(rH, 2) : '—'}</b>
          </span>
          <span className="pa-unit dim" style={{ marginLeft: 'auto', fontSize: '10px' }}>HR/9</span>
        </div>
      )}

      <div className="pcard-cols" style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '14px', position: 'relative', zIndex: 1 }}>
        {/* Top HR targets */}
        <div className="pcard-targets">
          <h4 className="pcard-h4" style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
            <Icon name="Crosshair" size={12} style={{ color: 'var(--accent)' }} /> Top HR targets
          </h4>
          <ul className="ptarget-list" style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {targets.slice(0, 5).map((b) => (
              <li
                key={b.id}
                className={`ptarget ${selectedId === b.id ? 'selected' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => onSelect(b)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(b)
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 6px',
                  borderRadius: '6px',
                  background: selectedId === b.id ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.01)',
                  border: `1px solid ${selectedId === b.id ? 'var(--accent)' : 'transparent'}`,
                  cursor: 'pointer',
                  fontSize: '11px'
                }}
              >
                <span className="ptarget-ord mono" style={{ color: 'var(--text-faint)' }}>{b.battingOrder || '–'}</span>
                <img className="ptarget-photo" src={playerHeadshot(b.playerId, 96)} alt="" loading="lazy" />
                <span className={`ptarget-name ${liveMode && b.liveContext?.isHRThisGame ? 'hr-glow' : ''}`} style={{ flex: '1', display: 'flex', alignItems: 'center', gap: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <span style={{ fontWeight: '600', color: '#fff', textOverflow: 'ellipsis', overflow: 'hidden' }}>{b.name}</span>
                  <span className={`bathand ${attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'pa-match' : ''}`} style={{
                    fontSize: '8px',
                    borderColor: attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'var(--strong)' : 'rgba(255,255,255,0.1)',
                    background: attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'rgba(105,185,158,0.1)' : 'transparent',
                    color: attackSide && effSide(b.batSide, pitcher.hand) === attackSide ? 'var(--strong)' : 'inherit',
                    padding: '0 3px',
                    borderRadius: '3px',
                    borderStyle: 'solid',
                    borderWidth: '1px'
                  }}>
                    {b.batSide}
                  </span>
                </span>
                <span className="ptarget-probability mono">{pct(b.hrProbability, 1)}<small>HR</small></span>
                <GradeChip grade={b.grade} size="sm" score={b.score} />
              </li>
            ))}
          </ul>

          {/* SGP combos — collapsible */}
          {(() => {
            const sgp2 = sgpLegs(targets, 2)
            const sgp3 = sgpLegs(targets, 3)
            if (!sgp2 && !sgp3) return null
            return (
              <div style={{ marginTop: '10px' }}>
                <button
                  className="pcard-sgp-toggle"
                  onClick={() => setSgpOpen((v) => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', color: sgpOpen ? 'var(--accent)' : 'var(--text-faint)', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}
                >
                  <Icon name="Zap" size={11} />
                  SGP combos
                  <Icon name={sgpOpen ? 'ChevronUp' : 'ChevronDown'} size={11} style={{ marginLeft: '2px' }} />
                </button>
                {sgpOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '6px', padding: '10px 12px', background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px' }}>
                    {sgp2 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-faint)', minWidth: '30px' }}>2-leg</span>
                        <SgpCombo legs={sgp2.legs} prob={sgp2.prob} onSelect={onSelect} />
                      </div>
                    )}
                    {sgp3 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '10px', color: 'var(--text-faint)', minWidth: '30px' }}>3-leg</span>
                        <SgpCombo legs={sgp3.legs} prob={sgp3.prob} onSelect={onSelect} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
        </div>

        {/* Pitch mix + splits/fatigue */}
        <div className="pcard-side" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="pcard-secondary-metrics">
            <span><small>K/9</small><b className="mono">{num(season.kPer9, 1)}</b></span>
            <span><small>ERA</small><b className="mono">{num(season.era, 2)}</b></span>
            <span><small>Barrel%</small><b className="mono">{sav.barrelPctAllowed != null ? num(sav.barrelPctAllowed, 1) : '—'}</b></span>
            <span><small>EV against</small><b className="mono">{sav.exitVeloAgainst != null ? num(sav.exitVeloAgainst, 1) : '—'}</b></span>
            <span><small>{Number.isFinite(x.xEra) ? 'xERA' : 'xwOBA'}</small><b className="mono">{Number.isFinite(x.xEra) ? num(x.xEra, 2) : Number.isFinite(x.xwOba) ? rate(x.xwOba) : '—'}</b></span>
          </div>
          {usage.length > 0 && (
            <div className="pcard-mix">
              <h4 className="pcard-h4" style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                <Icon name="Layers" size={12} style={{ color: 'var(--accent)' }} /> Pitch mix
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {usage.slice(0, 4).map((p) => {
                  const isWorst = worst?.rv > 0.5 && pitchNameMatches(worst.name, p.label)
                  return (
                    <div className="mix-row" key={p.code} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
                      <span className="mix-label" style={{ width: '45px', color: isWorst ? 'var(--b-hot)' : 'var(--text-dim)' }}>{p.label}</span>
                      <span className="mix-track" style={{ flex: '1', height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '99px', overflow: 'hidden' }}>
                        <span className="mix-fill" style={{ display: 'block', height: '100%', width: `${Math.min(100, p.pct)}%`, background: isWorst ? 'var(--b-hot)' : 'var(--accent)', boxShadow: isWorst ? '0 0 6px var(--b-hot)' : 'none' }} />
                      </span>
                      <span className="mix-pct mono" style={{ width: '22px', textAlign: 'right' }}>{num(p.pct, 0)}%</span>
                    </div>
                  )
                })}
              </div>
              {worst && worst.rv > 0.5 && (
                <div className="mix-worst" title={`Run value allowed per 100 pitches — batters are producing +${worst.rv.toFixed(1)} runs per 100 ${worst.name}s. The pitch to sit on.`}>
                  <Icon name="Flame" size={11} /> Gopher pitch: <b>{worst.name}</b> +{worst.rv.toFixed(1)} RV/100
                </div>
              )}
            </div>
          )}

          {(vl || vr || Number.isFinite(pl3d)) && (
            <div className="pcard-splits">
              <h4 className="pcard-h4" style={{ fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-faint)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
                <Icon name="BarChart3" size={12} style={{ color: 'var(--accent)' }} /> splits & workload
              </h4>
              <div className="split-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
                <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '6px', padding: '4px', textAlign: 'center' }}>
                  <div style={{ fontSize: '7px', color: 'var(--text-faint)', textTransform: 'uppercase' }}>vs LHB</div>
                  <span className="mono" style={{ fontSize: '11px', fontWeight: '700', color: vl?.hrPer9 >= 1.3 ? 'var(--b-hot)' : '#fff' }}>{num(vl?.hrPer9, 2)}</span>
                </div>
                <div style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.03)', borderRadius: '6px', padding: '4px', textAlign: 'center' }}>
                  <div style={{ fontSize: '7px', color: 'var(--text-faint)', textTransform: 'uppercase' }}>vs RHB</div>
                  <span className="mono" style={{ fontSize: '11px', fontWeight: '700', color: vr?.hrPer9 >= 1.3 ? 'var(--b-hot)' : '#fff' }}>{num(vr?.hrPer9, 2)}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      <button
        className="pcard-scout-toggle"
        onClick={() => setScoutingOpen((open) => !open)}
        aria-expanded={scoutingOpen}
      >
        {scoutingOpen ? 'Hide scouting' : 'Pitch mix & scouting'}
        <Icon name={scoutingOpen ? 'ChevronUp' : 'ChevronDown'} size={14} />
      </button>
    </section>
  )
}
