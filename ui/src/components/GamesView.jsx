import { useState, useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import GameFilterBar from './GameFilterBar.jsx'
import CallKey from './CallKey.jsx'
import { GradeChip, BadgeRow, ProbBar, ProbRing } from './atoms.jsx'
import { teamColor, teamLogo, hexToRgba, readableOn, playerHeadshot } from '../lib/teams.js'
import { american, pct, num, gameTime, signedPct } from '../lib/format.js'
import { gradeColor, eli5IconName, toneColor } from '../lib/badges.js'
import { HOT_HEAT } from '../lib/constants.js'
import { compass } from '../lib/weather.js'
import { interpretWind } from '../lib/wind.js'
import { useLiveMode } from '../lib/liveMode.js'
import { filterAndSortGames } from '../lib/gameFilters.js'
import {
  gameMarketMovementCaution,
  gameMarketPortfolioSelection,
  gameMarketValidation,
} from '../lib/gameMarketView.js'
import { hexA } from './atoms.jsx'

const lastName = (n) => { const p = (n || '').trim().split(/\s+/).filter(Boolean); const l = p[p.length - 1] || ''; return /^(jr|sr|ii|iii|iv|v)\.?$/i.test(l) && p.length >= 2 ? p[p.length - 2] : l }

function computeGameOfDay(batters) {
  const byGame = new Map()
  for (const b of batters || []) {
    if (b.game?.isFinal || !Number.isFinite(b.expectedHRs)) continue
    let g = byGame.get(b.gamePk)
    if (!g) {
      g = { gamePk: b.gamePk, game: b.game, bats: [], xhr: 0, primeStrong: 0 }
      byGame.set(b.gamePk, g)
    }
    g.bats.push(b)
    g.xhr += b.expectedHRs
    const lbl = b.grade?.label
    if (lbl === 'PRIME' || lbl === 'STRONG') g.primeStrong++
  }
  const list = [...byGame.values()].filter((g) => g.bats.length >= 4 && g.primeStrong >= 1)
  if (!list.length) return null
  list.sort((a, b) => b.xhr - a.xhr)
  const g = list[0]
  if (!g) return null
  g.awayPitcher = g.bats.find((b) => b.isHome)?.pitcher || null
  g.homePitcher = g.bats.find((b) => !b.isHome)?.pitcher || null
  g.park = g.bats[0]?.gameParkHRFactor ?? null
  g.weather = g.bats[0]?.weather || g.game?.weather || null
  g.threats = g.bats
    .filter((b) => (b.grade?.label || 'SKIP') !== 'SKIP')
    .sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0))
    .slice(0, 4)
  return g
}

function gameOpportunity(game, groups) {
  const bats = [...(groups?.away || []), ...(groups?.home || [])]
  const targets = bats
    .filter((b) => (b.grade?.label || 'SKIP') !== 'SKIP')
    .sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0) || (b.score ?? 0) - (a.score ?? 0))
  const sample = bats[0]
  const expectedHRs = bats.reduce((sum, b) => sum + (Number.isFinite(b.expectedHRs) ? b.expectedHRs : 0), 0)
  const envScore = Number.isFinite(sample?.envScore) ? Math.round(sample.envScore) : null
  const park = Number.isFinite(sample?.gameParkHRFactor) ? sample.gameParkHRFactor : null
  const hr9s = [
    game?.awayPitcher?.season?.hrPer9,
    game?.homePitcher?.season?.hrPer9,
    ...bats.map((b) => b.pitcher?.season?.hrPer9),
  ].filter(Number.isFinite)
  const maxHr9 = hr9s.length ? Math.max(...hr9s) : null
  const vulnerability = maxHr9 == null ? 'Unknown' : maxHr9 >= 1.3 ? 'High' : maxHr9 >= 1 ? 'Average' : 'Low'
  const envLabel = envScore == null ? 'Unknown' : envScore >= 70 ? 'Strong' : envScore <= 45 ? 'Suppressed' : 'Neutral'
  return { targets, sample, expectedHRs, envScore, park, maxHr9, vulnerability, envLabel }
}

function GodPitcher({ p, onOpenPitcher, gamePk }) {
  if (!p?.name) return null
  const hr9 = p.season?.hrPer9
  const tone = hr9 >= 1.3 ? 'pos' : hr9 <= 0.9 ? 'neg' : ''
  return (
    <button className="god-pitcher" onClick={() => onOpenPitcher?.(p.id, gamePk)} title={`${p.name} — open pitcher card`} style={{
      color: 'var(--accent)',
      fontWeight: '600',
      borderBottom: '1px dashed rgba(151, 149, 203, 0.4)',
      display: 'inline-block'
    }}>
      {lastName(p.name)} {hr9 != null && <b className={tone} style={{ marginLeft: '4px' }}>{num(hr9, 2)}</b>}
    </button>
  )
}

function GameOfDay({ god, onSelect, onOpenPitcher }) {
  if (!god) return null
  const g = god.game
  const away = g?.awayTeam?.abbr || '—'
  const home = g?.homeTeam?.abbr || '—'
  const wind = interpretWind(god.weather, g?.homeTeam?.abbr, { roofClosed: god.weather?.roofClosed })
  return (
    <section className="god-card" style={{
      background: 'linear-gradient(135deg, rgba(151, 149, 203, 0.12) 0%, rgba(8,12,28,0.85) 100%)',
      border: '1px solid rgba(151, 149, 203, 0.25)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.5), 0 0 16px var(--accent-glow)',
      borderRadius: '16px',
      padding: '20px',
      marginBottom: '24px',
      position: 'relative'
    }}>
      <div className="god-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span className="god-kicker" style={{
          fontSize: '12px',
          fontWeight: '800',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--accent)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <Icon name="Flame" size={14} style={{ filter: 'drop-shadow(0 0 4px var(--accent))' }} /> Game of the Day
        </span>
        <span className="god-xhr mono" style={{ fontSize: '13px', fontWeight: '700', color: '#fff' }}>
          {num(god.xhr, 1)} <em style={{ fontStyle: 'normal', color: 'var(--text-faint)' }}>exp HR</em>
        </span>
      </div>
      <div className="god-matchup" style={{ fontSize: '18px', fontWeight: '800', color: '#fff', marginBottom: '12px' }}>
        {away} @ {home}
        <span style={{ fontSize: '13px', color: 'var(--text-dim)', fontWeight: '400', marginLeft: '8px' }}>
          {g?.venueName ? ` · ${g.venueName}` : ''}
          {g?.gameDate ? ` · ${gameTime(g.gameDate)}` : ''}
        </span>
      </div>
      <div className="god-factors" style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '14px', fontSize: '13px' }}>
        <span className="god-fac" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="Shield" size={12} style={{ color: 'var(--text-faint)' }} /> vs <GodPitcher p={god.awayPitcher} onOpenPitcher={onOpenPitcher} gamePk={god.gamePk} />
          <span className="god-amp">·</span>
          <GodPitcher p={god.homePitcher} onOpenPitcher={onOpenPitcher} gamePk={god.gamePk} /> HR/9
        </span>
        {wind && wind.verdict !== 'CROSS' && (
          <span className={`god-fac ${wind.verdict === 'OUT' ? 'good' : 'bad'}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="Wind" size={12} /> {wind.caption}
          </span>
        )}
        {god.park != null && Math.abs(god.park - 1) >= 0.02 && (
          <span className={`god-fac ${god.park >= 1.05 ? 'good' : god.park <= 0.95 ? 'bad' : ''}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Icon name="Gauge" size={12} /> {signedPct(god.park - 1, 0)} park
          </span>
        )}
        <span className="god-fac" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Icon name="Award" size={12} style={{ color: 'var(--text-faint)' }} /> {god.primeStrong} PRIME/STRONG
        </span>
      </div>
      <div className="god-threats" style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '14px' }}>
        <span className="god-threats-k dim" style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Top threats:</span>
        {god.threats.map((b) => (
          <button 
            key={b.id} 
            className="god-threat" 
            onClick={() => onSelect(b)} 
            style={{ 
              '--row-accent': gradeColor(b.grade?.label),
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(255,255,255,0.03)',
              border: `1px solid ${hexA(gradeColor(b.grade?.label), 0.25)}`,
              borderRadius: '6px',
              padding: '3px 8px',
              fontSize: '12px',
              color: '#fff',
              fontWeight: '600'
            }}
          >
            {lastName(b.name)} <span className="mono" style={{ color: gradeColor(b.grade?.label) }}>{pct(b.hrProbability, 1)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}

function MarketDecisionCard({
  gamePk,
  market,
  decision,
  policy,
  projection,
  marketEvaluation,
  portfolio,
}) {
  const tier = decision?.tier || 'unavailable'
  const validation = gameMarketValidation(policy?.[market] || null, marketEvaluation, market)
  const selection = gameMarketPortfolioSelection(portfolio, gamePk, market)
  const caution = gameMarketMovementCaution(projection, market, decision)
  const modelProbability = market === 'moneyline'
    ? decision?.modelProbability
    : decision?.conditionalModelProbability
  const headline = market === 'moneyline'
    ? decision?.selectedTeam?.abbr && Number.isFinite(decision?.american)
      ? `${decision.selectedTeam.abbr} ${american(Math.round(decision.american))}`
      : 'No complete price'
    : decision?.selectedSide && Number.isFinite(decision?.line) && Number.isFinite(decision?.american)
      ? `${decision.selectedSide.toUpperCase()} ${num(decision.line, 1)} ${american(Math.round(decision.american))}`
      : 'No complete total'
  const forecastDiffers = market === 'moneyline'
    && decision?.selectedSide
    && decision?.forecastSide
    && decision.selectedSide !== decision.forecastSide
  const validationIcon = validation.status === 'eligible'
    ? 'CircleCheck'
    : validation.status === 'hold'
      ? 'TriangleAlert'
      : 'Hourglass'
  const driftWarning = validation.drift === 'drift'
    ? 'Performance drift'
    : validation.drift === 'watch'
      ? 'Drift watch'
      : null
  const blowUpRisk = market === 'total' && decision?.selectedSide === 'under'
    ? decision?.blowUpRisk
    : null

  return (
    <article className={`game-decision-card ${tier}`} aria-label={`${market} decision: ${tier}`}>
      <div className="game-decision-head">
        <span className={`game-decision-tier ${tier}`}>{tier.toUpperCase()}</span>
        <strong>{headline}</strong>
        <span className={`game-decision-validation ${validation.status}`}>
          <Icon name={validationIcon} size={11} />
          {validation.label}
        </span>
      </div>
      <div className="game-decision-stats">
        {Number.isFinite(modelProbability) && <span>
          <small>Model chance</small>
          <b className="mono">{pct(modelProbability, 1)}</b>
        </span>}
        {Number.isFinite(decision?.modelEdge) && <span>
          <small>Edge</small>
          <b className="mono">{signedPct(decision?.modelEdge, 1)}</b>
        </span>}
        {Number.isFinite(decision?.expectedRoi) && <span>
          <small>Est. ROI</small>
          <b className="mono">{signedPct(decision?.expectedRoi, 1)}</b>
        </span>}
      </div>
      <div className="game-decision-context">
        {market === 'moneyline' ? (
          <>
            <span className={forecastDiffers ? 'decision-difference' : ''}>
              Forecast favorite: <b>{decision?.forecastTeam?.abbr || '—'} {pct(decision?.forecastProbability, 1)}</b>
            </span>
            <span>vs {pct(decision?.marketFairProbability, 1)} fair market</span>
          </>
        ) : (
          <>
            <span><b>{num(decision?.projectedTotal, 1)}</b> projected vs {num(decision?.line, 1)}</span>
            <span>{num(decision?.runSeparation, 1)} run separation</span>
          </>
        )}
      </div>
      <div className="game-decision-proof">
        <span>
          3-season validation · {validation.historicalGames} games
        </span>
        <span>
          Forward monitor: {validation.decisions} settled calls
        </span>
        {selection && (
          <span className="game-decision-curated">
            <Icon name="Star" size={10} />
            Curated slate
          </span>
        )}
      </div>
      {blowUpRisk && (
        <div
          className={`game-decision-blowup ${blowUpRisk.level}`}
          title={`Chance this game finishes at least ${blowUpRisk.marginRuns} runs above the posted total. This is a volatility warning, not a second projection.`}
        >
          <Icon name={blowUpRisk.level === 'high' ? 'TriangleAlert' : 'Flame'} size={11} />
          <span>Blow-Up Risk</span>
          <b>{blowUpRisk.level.toUpperCase()}</b>
          <em className="mono">{pct(blowUpRisk.probability, 1)} chance of {blowUpRisk.thresholdRuns}+ runs</em>
          {blowUpRisk.capApplied && <small>PLAY capped to LEAN</small>}
        </div>
      )}
      {(caution || driftWarning) && (
        <div className="game-decision-caution">
          <Icon name="TriangleAlert" size={11} />
          {[caution, driftWarning].filter(Boolean).join(' · ')}
        </div>
      )}
      <p className="game-decision-reason">{decision?.reason || 'No complete market decision is available.'}</p>
    </article>
  )
}

function GameForecastStrip({
  game,
  projection,
  evaluation,
  marketEvaluation,
  portfolio,
}) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  if (!projection) return null

  const awayAbbr = projection.awayTeam?.abbr || game?.awayTeam?.abbr || 'Away'
  const homeAbbr = projection.homeTeam?.abbr || game?.homeTeam?.abbr || 'Home'
  const awayWin = projection.awayWinProbability
  const homeWin = projection.homeWinProbability
  const moneyline = projection.marketComparison?.moneyline
  const moneylineDecision = projection.marketDecision?.moneyline
  const totalDecision = projection.marketDecision?.total
  const sideEdge = moneylineDecision?.modelEdge
  const valueAbbr = moneylineDecision?.selectedTeam?.abbr
  const totalDelta = totalDecision?.projectionDelta
  const sample = evaluation?.sample?.games || 0
  const actionableCalls = marketEvaluation?.sample?.actionable
  const historicalGames = projection?.marketDecision?.policy?.moneyline?.historicalSample?.games
  const frozen = projection.freezeState === 'final-pregame'
  const awayPrice = Number.isFinite(moneyline?.awayAmerican)
    ? american(Math.round(moneyline.awayAmerican))
    : pct(moneyline?.awayMarketProbability, 1)
  const homePrice = Number.isFinite(moneyline?.homeAmerican)
    ? american(Math.round(moneyline.homeAmerican))
    : pct(moneyline?.homeMarketProbability, 1)
  const marketBlend = projection.marketBlend
  const sideBlend = marketBlend?.side
  const totalBlend = marketBlend?.total
  const appliedBlendParts = [
    sideBlend?.applied ? `side ${pct(sideBlend.weight, 0)}` : null,
    totalBlend?.applied ? `total ${pct(totalBlend.weight, 0)}` : null,
  ].filter(Boolean)
  const independentPricing = projection.pricingContract?.marketInputsAffectProjection === false
  const blendHeadline = independentPricing
    ? 'Comparison only · 0% influence'
    : marketBlend?.applied
      ? `Applied · ${appliedBlendParts.join(' · ')}`
      : marketBlend?.policyStatus === 'inactive'
        ? 'Inactive · no proven edge'
        : 'Collecting · no influence'
  const blendReason = independentPricing
    ? 'Sportsbook prices grade value only; they do not change projected runs or fair probabilities.'
    : marketBlend?.applied
      ? 'Only evidence-cleared market components influence this forecast.'
      : [sideBlend?.reason, totalBlend?.reason].filter(Boolean).join(' ')

  return (
    <section
      className={`game-forecast${detailsOpen ? ' details-open' : ''}`}
      aria-label={`${awayAbbr} at ${homeAbbr} model forecast`}
      style={{
        '--forecast-away': teamColor(game?.awayTeam?.id),
        '--forecast-home': teamColor(game?.homeTeam?.id),
        '--forecast-away-share': `${Math.max(0, Math.min(100, (awayWin || 0) * 100))}%`,
      }}
    >
      <div className="game-forecast-head">
        <span className="game-forecast-title">
          <Icon name="ChartNoAxesCombined" size={12} /> Model forecast v{projection.modelVersion || 1}
        </span>
        <span className="game-forecast-sample">
          {Number.isFinite(historicalGames)
            ? `${historicalGames} historical games · ${actionableCalls || 0} live calls`
            : `${sample} settled forecasts`}
        </span>
        <span className="game-forecast-state">{frozen ? 'Frozen pregame' : 'Pregame'} · advisory</span>
      </div>
      <div className="game-decision-grid" aria-label="Game market decision grades">
        <MarketDecisionCard
          gamePk={projection.gamePk ?? game?.gamePk}
          market="moneyline"
          decision={moneylineDecision}
          policy={projection.marketDecision?.policy}
          projection={projection}
          marketEvaluation={marketEvaluation}
          portfolio={portfolio}
        />
        <MarketDecisionCard
          gamePk={projection.gamePk ?? game?.gamePk}
          market="total"
          decision={totalDecision}
          policy={projection.marketDecision?.policy}
          projection={projection}
          marketEvaluation={marketEvaluation}
          portfolio={portfolio}
        />
      </div>
      <div className="game-forecast-core">
        <div className="game-forecast-projection away">
          <small>{awayAbbr} projected runs</small>
          <strong className="mono">{num(projection.awayExpectedRuns, 1)}</strong>
        </div>
        <div className="game-forecast-projection home">
          <small>{homeAbbr} projected runs</small>
          <strong className="mono">{num(projection.homeExpectedRuns, 1)}</strong>
        </div>
        <div className="game-forecast-projection total">
          <small>Projected total</small>
          <strong className="mono">{num(projection.projectedTotal, 1)}</strong>
        </div>
        <div className="game-forecast-win">
          <span><b>{awayAbbr}</b><strong className="mono">{pct(awayWin, 1)}</strong></span>
          <span><b>{homeAbbr}</b><strong className="mono">{pct(homeWin, 1)}</strong></span>
          <i aria-hidden="true"><b /></i>
        </div>
        <div className="game-forecast-quality">
          <small>{projection.confidence?.status || 'limited'} confidence</small>
          <strong className="mono">{pct(projection.confidence?.coverage, 0)} coverage</strong>
        </div>
      </div>
      <button
        type="button"
        className="game-forecast-toggle"
        onClick={() => setDetailsOpen((open) => !open)}
        aria-expanded={detailsOpen}
      >
        <Icon name="Scale" size={14} />
        Market & validation
        <Icon name={detailsOpen ? 'ChevronUp' : 'ChevronDown'} size={15} />
      </button>
      <div className="game-forecast-details">
        <div>
          <small>Market moneyline</small>
          <strong className="mono">
            {moneyline ? `${awayAbbr} ${awayPrice} · ${homeAbbr} ${homePrice}` : 'Unavailable'}
          </strong>
          {moneyline && <em>{pct(moneyline.awayMarketProbability, 1)} / {pct(moneyline.homeMarketProbability, 1)} fair</em>}
        </div>
        <div>
          <small>Selected value vs market</small>
          <strong className={`mono ${Number.isFinite(sideEdge) && sideEdge >= 0 ? 'good' : ''}`}>
            {Number.isFinite(sideEdge) ? `${signedPct(sideEdge, 1)} ${valueAbbr || 'side'}` : 'No side comparison'}
          </strong>
          <em>
            {Number.isFinite(totalDelta)
              ? `${totalDecision?.selectedSide?.toUpperCase() || 'Total'} ${num(totalDecision?.line, 1)} · ${num(totalDecision?.runSeparation, 1)} run separation`
              : 'No total comparison'}
          </em>
        </div>
        <div>
          <small>Market input</small>
          <strong className={`mono ${marketBlend?.applied ? 'good' : ''}`}>
            {marketBlend ? blendHeadline : 'Unavailable'}
          </strong>
          <em title={blendReason || undefined}>
            {marketBlend
              ? blendReason
              : 'This forecast predates the evidence-gated blend contract.'}
          </em>
        </div>
        <div>
          <small>Forward validation</small>
          <strong className="mono">
            {sample
              ? `${pct(evaluation?.winner?.accuracy, 1)} winners · ${num(evaluation?.total?.mae, 2)} total MAE`
              : 'Awaiting settled games'}
          </strong>
          <em>{sample ? `Brier ${num(evaluation?.winner?.brier, 4)}` : 'Starts after frozen forecasts settle'}</em>
        </div>
      </div>
    </section>
  )
}

export default function GamesView({
  games,
  batters,
  gameProjections = {},
  gameProjectionEvaluation = null,
  gameMarketEvaluation = null,
  gameMarketPortfolio = null,
  onSelect,
  selectedId,
  watchlist,
  slip,
  onToggleWatch,
  onToggleSlip,
  onOpenPitcher,
}) {
  const byGame = new Map()
  for (const b of batters) {
    if (!byGame.has(b.gamePk)) byGame.set(b.gamePk, { away: [], home: [] })
    byGame.get(b.gamePk)[b.isHome ? 'home' : 'away'].push(b)
  }

  const eligibleGames = games
    .filter((g) => {
      const grp = byGame.get(g.gamePk)
      return grp && grp.away.length + grp.home.length > 0
    })

  const god = computeGameOfDay(batters)
  const [gameQuery, setGameQuery] = useState('')
  const [gameState, setGameState] = useState('all')
  const [gameTimeWindow, setGameTimeWindow] = useState('all')
  const [gameSortDirection, setGameSortDirection] = useState('asc')
  const ordered = filterAndSortGames(eligibleGames, {
    query: gameQuery,
    state: gameState,
    timeWindow: gameTimeWindow,
    sortDirection: gameSortDirection,
  })
  const visibleGod = god && ordered.some((game) => game.gamePk === god.gamePk) ? god : null
  const [expandedGamePk, setExpandedGamePk] = useState(null)
  const orderedGameKey = ordered.map((game) => game.gamePk).join('|')
  const filtersActive = Boolean(
    gameQuery.trim()
    || gameState !== 'all'
    || gameTimeWindow !== 'all'
    || gameSortDirection !== 'asc',
  )

  useEffect(() => {
    if (
      expandedGamePk != null
      && !orderedGameKey.split('|').includes(String(expandedGamePk))
    ) {
      setExpandedGamePk(null)
    }
  }, [expandedGamePk, orderedGameKey])

  if (!eligibleGames.length) {
    return (
      <div className="empty" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '64px', color: 'var(--text-faint)', gap: '12px' }}>
        <Icon name="Search" size={32} />
        <p>No batters match these filters.</p>
      </div>
    )
  }

  const ctx = { onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip, onOpenPitcher }
  const clearGameFilters = () => {
    setGameQuery('')
    setGameState('all')
    setGameTimeWindow('all')
    setGameSortDirection('asc')
  }

  return (
    <>
      <GameFilterBar
        query={gameQuery}
        onQueryChange={setGameQuery}
        state={gameState}
        onStateChange={setGameState}
        timeWindow={gameTimeWindow}
        onTimeWindowChange={setGameTimeWindow}
        sortDirection={gameSortDirection}
        onSortDirectionChange={setGameSortDirection}
        shownCount={ordered.length}
        totalCount={eligibleGames.length}
        filtersActive={filtersActive}
        onClear={clearGameFilters}
      />
      <CallKey className="games-call-key" />
      {ordered.length ? (
        <section className="games-accordion" aria-label="Game matchups">
          <div className="games-accordion-head">
            <span>Matchups</span>
            <span>{ordered.length} games · Select a game for full analysis</span>
          </div>
          <div className="games-accordion-list">
            {ordered.map((g, i) => (
              <GameAccordionItem
                key={g.gamePk}
                game={g}
                groups={byGame.get(g.gamePk)}
                projection={gameProjections?.[g.gamePk]}
                evaluation={gameProjectionEvaluation}
                marketEvaluation={gameMarketEvaluation}
                portfolio={gameMarketPortfolio}
                featured={g.gamePk === visibleGod?.gamePk}
                open={String(g.gamePk) === String(expandedGamePk)}
                onToggle={() => setExpandedGamePk((current) => (
                  String(current) === String(g.gamePk) ? null : g.gamePk
                ))}
                idx={i}
                {...ctx}
              />
            ))}
          </div>
        </section>
      ) : (
        <div className="games-filter-empty">
          <Icon name="Search" size={28} />
          <strong>No games match these filters</strong>
          <span>Try another team, game state, or start-time window.</span>
          <button type="button" onClick={clearGameFilters}>Clear game filters</button>
        </div>
      )}
    </>
  )
}

function AccordionDecision({ market, decision }) {
  const tier = decision?.tier || 'unavailable'
  const headline = market === 'moneyline'
    ? decision?.selectedTeam?.abbr && Number.isFinite(decision?.american)
      ? `${decision.selectedTeam.abbr} ${american(Math.round(decision.american))}`
      : 'Side pending'
    : decision?.selectedSide && Number.isFinite(decision?.line)
      ? `${decision.selectedSide.toUpperCase()} ${num(decision.line, 1)}`
      : 'Total pending'

  return (
    <span className={`games-accordion-decision ${tier}`}>
      <small>{tier === 'unavailable' ? 'PENDING' : tier.toUpperCase()}</small>
      <b className="mono">{headline}</b>
    </span>
  )
}

function GameAccordionItem({
  game: g,
  groups,
  projection,
  evaluation,
  marketEvaluation,
  portfolio,
  featured,
  open,
  onToggle,
  idx,
  ...ctx
}) {
  const info = gameOpportunity(g, groups)
  const status = g.isFinal
    ? 'Final'
    : g.isLive
      ? `${(g.inningHalf || '').slice(0, 3)} ${g.currentInning || ''}`.trim()
      : gameTime(g.gameDate) || 'TBD'
  const moneylineDecision = projection?.marketDecision?.moneyline
  const totalDecision = projection?.marketDecision?.total
  const panelId = `game-accordion-panel-${g.gamePk}`
  const toggleId = `game-accordion-toggle-${g.gamePk}`
  const awayLogo = teamLogo(g.awayTeam?.id)
  const homeLogo = teamLogo(g.homeTeam?.id)
  const [showFullLineup, setShowFullLineup] = useState(false)

  useEffect(() => {
    if (!open) setShowFullLineup(false)
  }, [open])

  return (
    <article
      className={`games-accordion-item${open ? ' open' : ''}${g.isLive ? ' live' : ''}`}
      style={{ '--i': Math.min(idx, 12) }}
    >
      <button
        id={toggleId}
        type="button"
        className="games-accordion-toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
      >
        <span className="games-accordion-primary">
          <span className="games-accordion-matchup">
            {awayLogo && <img src={awayLogo} alt="" loading="lazy" />}
            <strong>{g.awayTeam?.abbr || '—'}</strong>
            <small>@</small>
            {homeLogo && <img src={homeLogo} alt="" loading="lazy" />}
            <strong>{g.homeTeam?.abbr || '—'}</strong>
          </span>
          <span className={`games-accordion-status${g.isLive ? ' live' : ''}`}>{status}</span>
          {featured && <span className="games-accordion-featured"><Icon name="Flame" size={11} /> Top game</span>}
        </span>
        <span className="games-accordion-pitchers">
          <small>Probable pitchers</small>
          <b>{lastName(g.awayPitcher?.name) || 'TBD'} vs {lastName(g.homePitcher?.name) || 'TBD'}</b>
        </span>
        <span className="games-accordion-opportunity">
          <span className={`games-accordion-env ${info.envLabel.toLowerCase()}`}>
            <Icon name="Gauge" size={12} />
            {info.envLabel}
          </span>
          <span className="games-accordion-xhr">
            <b className="mono">{num(info.expectedHRs, 1)}</b>
            <small>EXP HR</small>
          </span>
        </span>
        <span className="games-accordion-decisions">
          <AccordionDecision market="moneyline" decision={moneylineDecision} />
          <AccordionDecision market="total" decision={totalDecision} />
        </span>
        <span className="games-accordion-chevron" aria-hidden="true">
          <small>{open ? 'Collapse' : 'Open game'}</small>
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={18} />
        </span>
      </button>
      {open && (
        <div
          id={panelId}
          className="games-accordion-panel"
          role="region"
          aria-labelledby={toggleId}
        >
          <LineupScopeToggle
            showFullLineup={showFullLineup}
            onToggle={() => setShowFullLineup((current) => !current)}
          />
          <div className="games-accordion-desktop-detail">
            <MatchupWorkspace
              game={g}
              groups={groups}
              projection={projection}
              evaluation={evaluation}
              marketEvaluation={marketEvaluation}
              portfolio={portfolio}
              showFullLineup={showFullLineup}
              featured={featured}
              {...ctx}
            />
          </div>
          <div className="games-accordion-mobile-detail">
            <MobileDetailCard
              game={g}
              groups={groups}
              projection={projection}
              evaluation={evaluation}
              marketEvaluation={marketEvaluation}
              portfolio={portfolio}
              idx={idx}
              showFullLineup={showFullLineup}
              {...ctx}
            />
          </div>
        </div>
      )}
    </article>
  )
}

function LineupScopeToggle({ showFullLineup, onToggle }) {
  return (
    <div className="game-lineup-scope">
      <span>
        <Icon name={showFullLineup ? 'Users' : 'ListFilter'} size={15} />
        <span>
          <strong>{showFullLineup ? 'Full lineup' : 'Qualified targets'}</strong>
          <small>{showFullLineup ? 'Every listed hitter, including SKIP' : 'PRIME, STRONG, and LEAN only'}</small>
        </span>
      </span>
      <button type="button" onClick={onToggle} aria-pressed={showFullLineup}>
        {showFullLineup ? 'Qualified only' : 'Show full lineup'}
        <Icon name={showFullLineup ? 'ListFilter' : 'Users'} size={15} />
      </button>
    </div>
  )
}

function MatchupWorkspace({ game: g, groups, projection, evaluation, marketEvaluation, portfolio, showFullLineup, featured, onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip, onOpenPitcher }) {
  const info = gameOpportunity(g, groups)
  const live = g.isLive || g.isFinal
  const status = g.isFinal ? 'Final' : g.isLive ? `${(g.inningHalf || '').slice(0, 3)} ${g.currentInning || ''}`.trim() : gameTime(g.gameDate) || 'TBD'
  const wind = info.sample?.weather && !info.sample.weather.roofClosed
    ? interpretWind(info.sample.weather, g.homeTeam?.abbr, { roofClosed: false })
    : null
  const teamCtx = { onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip }
  return (
    <section className={`matchup-workspace-card${g.isLive ? ' live' : ''}`}>
      <header className="matchup-workspace-head">
        <div className="matchup-workspace-kicker">
          <span>{featured ? <><Icon name="Flame" size={12} /> Game of the Day</> : 'Matchup workspace'}</span>
          <span className="mono">{num(info.expectedHRs, 1)} expected HR</span>
        </div>
        <div className="matchup-workspace-scoreboard">
          <WorkspaceTeam team={g.awayTeam} pitcher={g.awayPitcher} score={g.awayScore} showScore={live} gamePk={g.gamePk} onOpenPitcher={onOpenPitcher} />
          <div className="matchup-workspace-status"><b className={g.isLive ? 'live' : ''}>{status}</b><span>{g.venueName || ''}</span></div>
          <WorkspaceTeam team={g.homeTeam} pitcher={g.homePitcher} score={g.homeScore} showScore={live} gamePk={g.gamePk} onOpenPitcher={onOpenPitcher} align="right" />
        </div>
        <GameForecastStrip game={g} projection={projection} evaluation={evaluation} marketEvaluation={marketEvaluation} portfolio={portfolio} />
        <div className="matchup-workspace-metrics">
          <WorkspaceMetric icon="Gauge" label="Environment" value={info.envLabel} tone={info.envScore >= 70 ? 'good' : info.envScore <= 45 ? 'bad' : ''} sub={info.envScore == null ? 'No score' : `${info.envScore}/100`} />
          <WorkspaceMetric icon="Shield" label="Pitcher vulnerability" value={info.vulnerability} tone={info.vulnerability === 'High' ? 'good' : info.vulnerability === 'Low' ? 'bad' : ''} sub={info.maxHr9 == null ? 'HR/9 unavailable' : `${num(info.maxHr9, 2)} max HR/9`} />
          <WorkspaceMetric icon="Wind" label="Game conditions" value={wind?.verdict === 'OUT' ? 'Carry boost' : wind?.verdict === 'IN' ? 'Holding in' : info.sample?.weather?.roofClosed ? 'Roof closed' : 'Neutral'} tone={wind?.verdict === 'OUT' ? 'good' : wind?.verdict === 'IN' ? 'bad' : ''} sub={wind?.caption || (info.park == null ? 'No park factor' : `${num(info.park, 2)}× park`)} />
        </div>
      </header>
      <div className="matchup-workspace-body">
        <WorkspaceTargets team={g.awayTeam} bats={groups.away} showFullLineup={showFullLineup} {...teamCtx} />
        <WorkspaceTargets team={g.homeTeam} bats={groups.home} showFullLineup={showFullLineup} {...teamCtx} />
      </div>
    </section>
  )
}

function WorkspaceTeam({ team, pitcher, score, showScore, gamePk, onOpenPitcher, align = 'left' }) {
  const logo = teamLogo(team?.id)
  return (
    <div className={`matchup-workspace-team ${align}`}>
      {logo && <img src={logo} alt="" loading="lazy" />}
      <span><strong>{team?.abbr || '—'}</strong>{pitcher?.id && onOpenPitcher ? <button onClick={() => onOpenPitcher(pitcher.id, gamePk)}>{pitcher.name}</button> : <small>{pitcher?.name || 'TBD'}</small>}</span>
      {showScore && <b className="mono">{score ?? 0}</b>}
    </div>
  )
}

function WorkspaceMetric({ icon, label, value, tone = '', sub }) {
  return (
    <div className={`matchup-workspace-metric ${tone}`}>
      <Icon name={icon} size={16} />
      <span><small>{label}</small><strong>{value}</strong></span>
      <em>{sub}</em>
    </div>
  )
}

function WorkspaceTargets({ team, bats, showFullLineup, onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip }) {
  const sorted = [...(bats || [])].sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0) || (b.score ?? 0) - (a.score ?? 0))
  const visible = showFullLineup
    ? sorted
    : sorted.filter((b) => (b.grade?.label || 'SKIP') !== 'SKIP').slice(0, 5)
  return (
    <div className="matchup-target-column">
      <div className="matchup-target-head"><span>{team?.name || team?.abbr} targets</span><b>{visible.length}</b></div>
      <div className="matchup-target-list">
        {visible.map((b) => (
          <WorkspaceTargetRow key={b.id} b={b} selected={selectedId === b.id} watched={watchlist.has(b.id)} inSlip={slip.has(b.id)} onSelect={onSelect} onToggleWatch={onToggleWatch} onToggleSlip={onToggleSlip} />
        ))}
        {!visible.length && <div className="matchup-target-empty">No qualified targets</div>}
      </div>
    </div>
  )
}

function WorkspaceTargetRow({ b, selected, watched, inSlip, onSelect, onToggleWatch, onToggleSlip }) {
  const color = gradeColor(b.grade?.label)
  const stop = (fn) => (e) => { e.stopPropagation(); fn?.(b) }
  return (
    <div className={`matchup-target-row${selected ? ' selected' : ''}`} role="button" tabIndex={0} onClick={() => onSelect?.(b)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(b) } }} style={{ '--target-color': color }}>
      <span className="matchup-target-avatar"><img src={playerHeadshot(b.playerId, 96)} alt="" loading="lazy" />{b.battingOrder && <small className="mono">#{b.battingOrder}</small>}</span>
      <span className="matchup-target-player"><strong>{b.name}</strong><span><GradeChip grade={b.grade} size="sm" score={b.score} /><small>{b.batSide} · {b.team}</small></span></span>
      <span className="matchup-target-prob"><b className="mono">{pct(b.hrProbability, 1)}</b><small>HR PROB</small></span>
      <span className="matchup-target-actions">
        <button className={watched ? 'on watch' : ''} onClick={stop(onToggleWatch)} aria-label={watched ? `Remove ${b.name} from watchlist` : `Watch ${b.name}`}><Icon name="Star" size={16} style={{ fill: watched ? 'currentColor' : 'none' }} /></button>
        <button className={inSlip ? 'on slip' : ''} onClick={stop(onToggleSlip)} aria-label={inSlip ? `Remove ${b.name} from parlay` : `Add ${b.name} to parlay`}><Icon name={inSlip ? 'Check' : 'Plus'} size={17} /></button>
      </span>
    </div>
  )
}

function MobileTopTargets({ targets, onSelect }) {
  if (!targets.length) return null
  return (
    <section className="mobile-targets" aria-labelledby="mobile-targets-title">
      <div className="mobile-targets-head">
        <span id="mobile-targets-title"><Icon name="TrendingUp" size={14} /> Top Targets Today</span>
        <span>Model HR%</span>
      </div>
      {targets.map((b, i) => {
        const color = gradeColor(b.grade?.label)
        const away = b.game?.awayTeam?.abbr
        const home = b.game?.homeTeam?.abbr
        return (
          <button key={b.id} className="mobile-target-row" onClick={() => onSelect?.(b)} style={{ '--target-color': color }}>
            <span className="mobile-target-rank mono">{i + 1}</span>
            <span className="mobile-target-main">
              <strong>{b.name}</strong>
              <small>{away && home ? `${away} @ ${home}` : b.team}{b.battingOrder ? ` · #${b.battingOrder}` : ''}</small>
            </span>
            <GradeChip grade={b.grade} size="sm" score={b.score} />
            <span className="mobile-target-prob mono">{pct(b.hrProbability, 1)}</span>
            <Icon name="ChevronRight" size={15} className="mobile-target-chev" />
          </button>
        )
      })}
    </section>
  )
}

function MobileMatchupCard({ game: g, groups, projection, evaluation, marketEvaluation, portfolio, idx = 0, expanded = false, onSelect, onOpenPitcher, watchlist, slip, onToggleWatch, onToggleSlip }) {
  const [reasonsOpen, setReasonsOpen] = useState(false)
  const open = expanded || reasonsOpen
  const away = [...(groups.away || [])].filter((b) => (b.grade?.label || 'SKIP') !== 'SKIP').sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0))[0]
  const home = [...(groups.home || [])].filter((b) => (b.grade?.label || 'SKIP') !== 'SKIP').sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0))[0]
  const sample = groups.away?.[0] || groups.home?.[0]
  const opportunity = gameOpportunity(g, groups)
  const env = opportunity.envScore
  const envTone = env == null ? '' : env >= 70 ? 'good' : env <= 45 ? 'bad' : ''
  const status = g.isFinal ? 'Final' : g.isLive ? `${(g.inningHalf || '').slice(0, 3)} ${g.currentInning || ''}`.trim() : gameTime(g.gameDate) || 'TBD'
  return (
    <section className={`mobile-matchup${open ? ' open' : ''}${g.isLive ? ' live' : ''}`} style={{ '--i': Math.min(idx, 12) }}>
      <div className="mobile-matchup-scoreboard">
        <MobileTeam team={g.awayTeam} pitcher={g.awayPitcher} score={g.awayScore} live={g.isLive || g.isFinal} onOpenPitcher={onOpenPitcher} gamePk={g.gamePk} />
        <div className="mobile-matchup-center">
          <span className={`mobile-game-status${g.isLive ? ' live' : ''}`}>{status}</span>
          <span className={`mobile-env-score ${envTone}`}><Icon name="Gauge" size={12} />{env ?? '—'}</span>
        </div>
        <MobileTeam team={g.homeTeam} pitcher={g.homePitcher} score={g.homeScore} live={g.isLive || g.isFinal} onOpenPitcher={onOpenPitcher} gamePk={g.gamePk} />
      </div>
      <GameForecastStrip game={g} projection={projection} evaluation={evaluation} marketEvaluation={marketEvaluation} portfolio={portfolio} />
      <div className="mobile-matchup-verdicts">
        <span className={envTone}><small>Environment</small><b>{opportunity.envLabel}</b></span>
        <span className={opportunity.vulnerability === 'High' ? 'good' : opportunity.vulnerability === 'Low' ? 'bad' : ''}><small>Vulnerability</small><b>{opportunity.vulnerability}</b></span>
      </div>
      <GameChips sample={sample} game={g} />
      <div className="mobile-matchup-leaders">
        <MobileLeader b={away} icon="Award" onSelect={onSelect} watched={away ? watchlist.has(away.id) : false} inSlip={away ? slip.has(away.id) : false} onToggleWatch={onToggleWatch} onToggleSlip={onToggleSlip} />
        <MobileLeader b={home} icon="Target" onSelect={onSelect} watched={home ? watchlist.has(home.id) : false} inSlip={home ? slip.has(home.id) : false} onToggleWatch={onToggleWatch} onToggleSlip={onToggleSlip} />
      </div>
      {open && (
        <div className="mobile-matchup-detail">
          {[away, home].filter(Boolean).map((b) => (
            <div key={b.id} className="mobile-reasons">
              <strong>{lastName(b.name)} signals</strong>
              {(b.eli5Reasons || []).slice(0, 2).map((r, i) => (
                <span key={i}><Icon name={eli5IconName(r.icon)} size={12} style={{ color: toneColor(r.tone) }} />{r.text}</span>
              ))}
            </div>
          ))}
        </div>
      )}
      {!expanded && (
        <button className="mobile-matchup-toggle" onClick={() => setReasonsOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Hide matchup details' : 'View reasons & data'}
          <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={16} />
        </button>
      )}
    </section>
  )
}

function MobileTeam({ team, pitcher, score, live, onOpenPitcher, gamePk }) {
  return (
    <div className="mobile-score-team">
      <strong>{team?.abbr || '—'}</strong>
      {live && <b className="mono">{score ?? 0}</b>}
      {pitcher?.id && onOpenPitcher ? (
        <button onClick={() => onOpenPitcher(pitcher.id, gamePk)}>{lastName(pitcher.name)}</button>
      ) : <span>{lastName(pitcher?.name) || 'TBD'}</span>}
    </div>
  )
}

function MobileLeader({ b, icon, onSelect, watched, inSlip, onToggleWatch, onToggleSlip }) {
  if (!b) return <div className="mobile-leader empty">No qualified target</div>
  const color = gradeColor(b.grade?.label)
  const stop = (fn) => (e) => { e.stopPropagation(); fn?.(b) }
  return (
    <div className="mobile-leader" role="button" tabIndex={0} onClick={() => onSelect?.(b)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(b) } }} style={{ '--leader-color': color }}>
      <Icon name={icon} size={16} />
      <span><strong>{b.name}</strong><small>{b.team}{b.battingOrder ? ` · #${b.battingOrder}` : ''}</small></span>
      <b className="mono">{pct(b.hrProbability, 1)}</b>
      <span className="mobile-leader-actions">
        <button className={watched ? 'on watch' : ''} onClick={stop(onToggleWatch)} aria-label={watched ? `Remove ${b.name} from watchlist` : `Watch ${b.name}`}><Icon name="Star" size={16} style={{ fill: watched ? 'currentColor' : 'none' }} /></button>
        <button className={inSlip ? 'on slip' : ''} onClick={stop(onToggleSlip)} aria-label={inSlip ? `Remove ${b.name} from parlay` : `Add ${b.name} to parlay`}><Icon name={inSlip ? 'Check' : 'Plus'} size={17} /></button>
      </span>
    </div>
  )
}

function MobileDetailCard({ game: g, groups, projection, evaluation, marketEvaluation, portfolio, idx = 0, showFullLineup = false, onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip, onOpenPitcher }) {
  const [side, setSide] = useState('away')
  const sample = groups.away?.[0] || groups.home?.[0]
  const env = Number.isFinite(sample?.envScore) ? Math.round(sample.envScore) : null
  const envTone = env == null ? '' : env >= 70 ? 'good' : env <= 45 ? 'bad' : ''
  const status = g.isFinal ? 'Final' : g.isLive ? `${(g.inningHalf || '').slice(0, 3)} ${g.currentInning || ''}`.trim() : gameTime(g.gameDate) || 'TBD'
  const sortBats = (list) => [...(list || [])].sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0) || (b.score ?? 0) - (a.score ?? 0))
  const selectBats = (list) => {
    const sorted = sortBats(list)
    return showFullLineup
      ? sorted
      : sorted.filter((b) => (b.grade?.label || 'SKIP') !== 'SKIP').slice(0, 5)
  }
  const awayBats = selectBats(groups.away)
  const homeBats = selectBats(groups.home)
  const activeBats = side === 'away' ? awayBats : homeBats
  return (
    <section className={`mobile-detail-card${g.isLive ? ' live' : ''}`} style={{ '--i': Math.min(idx, 12) }}>
      <div className="mobile-matchup-scoreboard">
        <MobileTeam team={g.awayTeam} pitcher={g.awayPitcher} score={g.awayScore} live={g.isLive || g.isFinal} onOpenPitcher={onOpenPitcher} gamePk={g.gamePk} />
        <div className="mobile-matchup-center">
          <span className={`mobile-game-status${g.isLive ? ' live' : ''}`}>{status}</span>
          <span className={`mobile-env-score ${envTone}`}><Icon name="Gauge" size={12} />{env ?? '—'}</span>
        </div>
        <MobileTeam team={g.homeTeam} pitcher={g.homePitcher} score={g.homeScore} live={g.isLive || g.isFinal} onOpenPitcher={onOpenPitcher} gamePk={g.gamePk} />
      </div>
      <GameForecastStrip game={g} projection={projection} evaluation={evaluation} marketEvaluation={marketEvaluation} portfolio={portfolio} />
      <GameChips sample={sample} game={g} />
      <div className="mobile-team-switcher" role="tablist" aria-label={`${g.awayTeam?.abbr} and ${g.homeTeam?.abbr} hitters`}>
        <MobileTeamTab side="away" active={side === 'away'} team={g.awayTeam} batters={awayBats} onClick={() => setSide('away')} />
        <MobileTeamTab side="home" active={side === 'home'} team={g.homeTeam} batters={homeBats} onClick={() => setSide('home')} />
      </div>
      <div className="mobile-roster" role="tabpanel" aria-label={`${side === 'away' ? g.awayTeam?.abbr : g.homeTeam?.abbr} hitters`}>
        {activeBats.map((b) => (
          <MobileDetailRow
            key={b.id}
            b={b}
            selected={selectedId === b.id}
            watched={watchlist.has(b.id)}
            inSlip={slip.has(b.id)}
            onSelect={onSelect}
            onToggleWatch={onToggleWatch}
            onToggleSlip={onToggleSlip}
          />
        ))}
        {!activeBats.length && <div className="mobile-roster-empty">No qualified targets</div>}
      </div>
    </section>
  )
}

function MobileTeamTab({ side, active, team, batters, onClick }) {
  const max = batters[0]?.hrProbability
  return (
    <button
      className={`mobile-team-tab${active ? ' active' : ''}`}
      role="tab"
      aria-selected={active}
      data-side={side}
      onClick={onClick}
    >
      <span><strong>{team?.abbr || '—'}</strong><small>{batters.length}</small></span>
      <b className="mono">{max != null ? `${pct(max, 1)} max` : 'No targets'}</b>
    </button>
  )
}

function MobileDetailRow({ b, selected, watched, inSlip, onSelect, onToggleWatch, onToggleSlip }) {
  const color = gradeColor(b.grade?.label)
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn(b)
  }
  return (
    <div
      className={`mobile-detail-row${selected ? ' selected' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelect?.(b)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect?.(b)
        }
      }}
      style={{ '--detail-color': color }}
    >
      <span className="mobile-detail-avatar-wrap">
        <img src={playerHeadshot(b.playerId, 96)} alt="" loading="lazy" className="mobile-detail-avatar" />
        {b.battingOrder && <small className="mono">#{b.battingOrder}</small>}
      </span>
      <span className="mobile-detail-player">
        <span><strong>{b.name}</strong><small>{b.batSide}</small></span>
        <span><GradeChip grade={b.grade} size="sm" score={b.score} /></span>
      </span>
      <span className="mobile-detail-prob"><b className="mono">{pct(b.hrProbability, 1)}</b><small>HR PROB</small></span>
      <button className={`mobile-detail-action${watched ? ' on watch' : ''}`} onClick={stop(onToggleWatch)} aria-label={watched ? `Remove ${b.name} from watchlist` : `Watch ${b.name}`}>
        <Icon name="Star" size={17} style={{ fill: watched ? 'currentColor' : 'none' }} />
      </button>
      <button className={`mobile-detail-action${inSlip ? ' on slip' : ''}`} onClick={stop(onToggleSlip)} aria-label={inSlip ? `Remove ${b.name} from parlay` : `Add ${b.name} to parlay`}>
        <Icon name={inSlip ? 'Check' : 'Plus'} size={18} />
      </button>
    </div>
  )
}

function envAlert(bat, game) {
  if (!bat) return null
  const w = bat.weather
  const park = bat.gameParkHRFactor
  const env = bat.envScore
  const wind = w ? interpretWind(w, game?.homeTeam?.abbr, { roofClosed: w?.roofClosed }) : null
  const parts = []
  if (Number.isFinite(w?.tempF) && w.tempF >= 80) parts.push('warm air adds carry')
  if (wind?.verdict === 'OUT') parts.push(`wind out (${wind.caption})`)
  else if (wind?.verdict === 'IN') parts.push('wind holding it in')
  if (Number.isFinite(park) && park >= 1.08) parts.push("hitter's park")
  else if (Number.isFinite(park) && park <= 0.92) parts.push("pitcher's park")
  const tone = Number.isFinite(env) ? (env >= 78 ? 'good' : env <= 45 ? 'bad' : '') : ''
  const lead = !Number.isFinite(env) ? 'Environment' : env >= 78 ? 'Strong HR environment' : env >= 62 ? 'Above-average HR environment' : env <= 45 ? 'Suppressed HR environment' : 'Neutral environment'
  return { tone, text: parts.length ? `${parts.join(', ')}` : `${lead}.`, env }
}

function ExtractorCard({ game: g, groups, idx = 0, ...ctx }) {
  const liveMode = useLiveMode()
  const awayC = teamColor(g.awayTeam?.id)
  const homeC = teamColor(g.homeTeam?.id)
  const all = [...(groups.away || []), ...(groups.home || [])]
    .filter((b) => (b.grade?.label || b.grade) !== 'SKIP')
    .sort(
      (a, b) =>
        (b.score ?? 0) - (a.score ?? 0) ||
        (b.hrProbability ?? 0) - (a.hrProbability ?? 0) ||
        String(a.id).localeCompare(String(b.id)),
    )
  const king = all[0]
  const target = all[1]
  const alert = envAlert(groups.away?.[0] || groups.home?.[0], g)
  if (!king) return null
  return (
    <section className={`xcard${liveMode && g.isLive ? ' live' : ''}`} style={{
      '--i': Math.min(idx, 12),
      background: 'rgba(17, 18, 20, 0.45)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'var(--glass-shadow)',
      borderRadius: '16px',
      overflow: 'hidden'
    }}>
      <header
        className="xc-head"
        style={{ 
          background: `linear-gradient(100deg, ${hexToRgba(awayC, 0.15)}, transparent 45%, transparent 55%, ${hexToRgba(homeC, 0.15)})`,
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        <div className="xc-matchup">
          <span className="xc-teams" style={{ fontWeight: '800' }}>{g.awayTeam?.abbr} @ {g.homeTeam?.abbr}</span>
          <span className="xc-arms dim" style={{ fontSize: '11px', display: 'block', marginTop: '2px' }}>{g.awayPitcher?.name || 'TBD'} vs {g.homePitcher?.name || 'TBD'}</span>
        </div>
        <GameStatus g={g} />
      </header>
      <GameChips sample={groups.away?.[0] || groups.home?.[0]} game={g} />
      {alert && (
        <div className={`xc-alert ${alert.tone}`} style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '8px 12px',
          margin: '0 12px 12px',
          borderRadius: '8px',
          fontSize: '11px',
          fontWeight: '500',
          background: alert.tone === 'good' ? 'rgba(105, 185, 158, 0.08)' : alert.tone === 'bad' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.03)',
          color: alert.tone === 'good' ? 'var(--strong)' : alert.tone === 'bad' ? 'var(--bad)' : 'var(--text-dim)',
          border: alert.tone === 'good' ? '1px solid rgba(105, 185, 158, 0.15)' : alert.tone === 'bad' ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid rgba(255,255,255,0.05)'
        }}>
          <Icon name="TriangleAlert" size={11} />
          <span>{alert.text}</span>
        </div>
      )}
      <ExtractorBat b={king} rank="king" onSelect={ctx.onSelect} />
      {target && <ExtractorBat b={target} rank="target" onSelect={ctx.onSelect} />}
    </section>
  )
}

function ExtractorBat({ b, rank, onSelect }) {
  const reasons = (b.eli5Reasons || []).slice(0, 5)
  const isKing = rank === 'king'
  const color = gradeColor(b.grade?.label)
  return (
    <div className={`xc-bat ${rank}`} role="button" tabIndex={0} onClick={() => onSelect?.(b)} style={{
      borderLeft: `3px solid ${color}`,
      background: 'rgba(255,255,255,0.01)',
      borderBottom: !isKing ? 'none' : '1px solid rgba(255,255,255,0.03)'
    }}>
      <div className="xc-bat-head">
        <span className="xc-crown">{isKing ? '👑' : '🎯'}</span>
        <span className="xc-label" style={{ color: color, fontWeight: '700' }}>{isKing ? 'HR King' : 'Elite Target'}</span>
        <span className="xc-bat-name" style={{ fontWeight: '600', color: '#fff' }}>{b.name}</span>
        <span className="xc-bat-team dim">{b.team}{b.battingOrder ? ` · #${b.battingOrder}` : ''}</span>
        <span className="xc-bat-right">
          <span className="xc-bat-prob mono" style={{ color: color, fontWeight: '800' }}>{pct(b.hrProbability, 1)}</span>
          <GradeChip grade={b.grade} size="sm" score={b.score} />
        </span>
      </div>
      {reasons.length > 0 && (
        <ul className="xc-reasons">
          {reasons.map((r, i) => (
            <li key={i} className={`xc-reason tone-${r.tone}`}>
              <span className="xc-reason-ico" style={{ color: toneColor(r.tone) }}>
                <Icon name={eli5IconName(r.icon)} size={11} />
              </span>
              {r.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function GameStatus({ g }) {
  const liveMode = useLiveMode()
  if (liveMode && g.isLive) {
    return (
      <div className="gc-status live" style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--bad)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
        <span className="live-dot" />
        {(g.inningHalf || '').slice(0, 3)} {g.currentInning}
      </div>
    )
  }
  if (g.isFinal) return <div className="gc-status final" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-faint)' }}>Final</div>
  return <div className="gc-status" style={{ background: 'rgba(151, 149, 203, 0.08)', color: 'var(--accent)' }}>{gameTime(g.gameDate) || 'TBD'}</div>
}

function TeamHead({ team, pitcher, score, showScore, align, gamePk, onOpenPitcher }) {
  const color = teamColor(team?.id)
  const logo = teamLogo(team?.id)
  const canOpen = !!onOpenPitcher && pitcher?.id != null
  // Flash the score pill when a poll brings a higher score. Works because
  // GameCard is keyed by stable gamePk, so this instance survives refreshes.
  const prevScore = useRef(score)
  const [popped, setPopped] = useState(false)
  useEffect(() => {
    const scored = showScore && Number.isFinite(score) && Number.isFinite(prevScore.current) && score > prevScore.current
    prevScore.current = score
    if (scored) {
      setPopped(true)
      const t = setTimeout(() => setPopped(false), 1400)
      return () => clearTimeout(t)
    }
  }, [score, showScore])
  return (
    <div className={`gc-team ${align}`} style={{ '--tc': color }}>
      {logo && <img className="gc-logo" src={logo} alt={team?.name || ''} loading="lazy" style={{ width: '28px', height: '28px' }} />}
      <div className="gc-team-txt">
        <span className="gc-abbr" style={{ fontSize: '15px', fontWeight: '800' }}>{team?.abbr}</span>
        {canOpen ? (
          <button
            className="gc-pitcher pitch-link"
            onClick={() => onOpenPitcher(pitcher.id, gamePk)}
            title={`Open ${pitcher.name}'s pitcher card`}
            style={{
              color: 'var(--accent)',
              fontSize: '11px',
              borderBottom: '1px dashed rgba(151, 149, 203, 0.3)'
            }}
          >
            {pitcher.name}
          </button>
        ) : (
          <span className="gc-pitcher" style={{ fontSize: '11px' }}>{pitcher?.name || 'TBD'}</span>
        )}
      </div>
      {showScore && <span className={`gc-score mono${popped ? ' scored' : ''}`} style={{ fontSize: '18px', fontWeight: '800', background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '6px' }}>{score ?? 0}</span>}
    </div>
  )
}

function GameCard({ game: g, groups, idx = 0, ...ctx }) {
  const liveMode = useLiveMode()
  const awayC = teamColor(g.awayTeam?.id)
  const homeC = teamColor(g.homeTeam?.id)
  const showScore = liveMode && (g.isLive || g.isFinal)
  return (
    <section className={`game-card ${g.isFinal ? 'final' : ''}${liveMode && g.isLive ? ' live' : ''}`} style={{
      '--i': Math.min(idx, 12),
      background: 'rgba(17, 18, 20, 0.45)',
      border: '1px solid rgba(255,255,255,0.06)',
      boxShadow: 'var(--glass-shadow)',
      borderRadius: '16px',
      overflow: 'hidden'
    }}>
      <header
        className="gc-head"
        style={{
          background: `linear-gradient(100deg, ${hexToRgba(awayC, 0.15)}, transparent 45%, transparent 55%, ${hexToRgba(homeC, 0.15)})`,
          borderBottom: '1px solid rgba(255,255,255,0.06)'
        }}
      >
        <TeamHead team={g.awayTeam} pitcher={g.awayPitcher} score={g.awayScore} showScore={showScore} align="left" gamePk={g.gamePk} onOpenPitcher={ctx.onOpenPitcher} />
        <div className="gc-center">
          <GameStatus g={g} />
          <span className="gc-venue" style={{ fontSize: '10px' }}>{g.venueName || ''}</span>
        </div>
        <TeamHead team={g.homeTeam} pitcher={g.homePitcher} score={g.homeScore} showScore={showScore} align="right" gamePk={g.gamePk} onOpenPitcher={ctx.onOpenPitcher} />
      </header>

      <GameChips sample={groups.away[0] || groups.home[0]} game={g} />

      <div className="gc-silos" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
        <Silo team={g.awayTeam} batters={groups.away} {...ctx} />
        <Silo team={g.homeTeam} batters={groups.home} {...ctx} />
      </div>
    </section>
  )
}

function GameChips({ sample, game }) {
  const w = sample?.weather
  const park = sample?.gameParkHRFactor
  if (!w && park == null) return null
  const chips = []
  if (w?.tempF != null) chips.push({ icon: 'Thermometer', text: `${Math.round(w.tempF)}°F` })
  // Wind: park-relative verdict (out = HR-friendly green, in = red) with an
  // arrow rotated to the actual blow direction (0deg = out to CF). Falls back
  // to the raw compass chip when we can't resolve the park orientation.
  const wind = w && !w.roofClosed ? interpretWind(w, game?.homeTeam?.abbr, { roofClosed: w.roofClosed }) : null
  if (wind) {
    chips.push({
      icon: 'ArrowUp',
      rot: wind.arrowRotation,
      text: `${Math.round(wind.mph)} ${wind.verdict === 'OUT' ? `out ${wind.side}` : wind.verdict === 'IN' ? 'in' : 'cross'}`,
      tone: wind.verdict === 'OUT' ? 'good' : wind.verdict === 'IN' ? 'bad' : '',
      title: wind.caption,
    })
  } else if (w?.windSpeedMph != null) {
    chips.push({ icon: 'Wind', text: `${Math.round(w.windSpeedMph)} ${compass(w.windDirDeg) || ''}`.trim() })
  }
  if (park != null)
    chips.push({ icon: 'Gauge', text: `${num(park, 2)}× park`, tone: park >= 1.05 ? 'good' : park <= 0.95 ? 'bad' : '' })
  if (w?.roofClosed) chips.push({ icon: 'House', text: 'Roof closed' })
  else if (w?.precipProbPct >= 40) chips.push({ icon: 'Droplet', text: `${w.precipProbPct}% rain` })
  if (!chips.length) return null
  return (
    <div className="gc-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '12px', background: 'rgba(0,0,0,0.1)' }}>
      {chips.map((c, i) => (
        <span className={`gc-chip ${c.tone || ''}`} key={i} title={c.title} style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          fontSize: '11px',
          background: c.tone === 'good' ? 'rgba(105, 185, 158, 0.08)' : c.tone === 'bad' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.03)',
          color: c.tone === 'good' ? 'var(--strong)' : c.tone === 'bad' ? 'var(--bad)' : 'var(--text-dim)',
          border: c.tone === 'good' ? '1px solid rgba(105, 185, 158, 0.15)' : c.tone === 'bad' ? '1px solid rgba(239, 68, 68, 0.15)' : '1px solid rgba(255,255,255,0.05)',
          padding: '2px 8px',
          borderRadius: '6px'
        }}>
          <Icon name={c.icon} size={11} style={c.rot != null ? { transform: `rotate(${c.rot}deg)` } : undefined} />
          {c.text}
        </span>
      ))}
    </div>
  )
}

function Silo({ team, batters, ...ctx }) {
  const color = teamColor(team?.id)
  const logo = teamLogo(team?.id)
  return (
    <div className="silo" style={{ '--tc': color, borderRight: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="silo-head" style={{ 
        background: hexToRgba(color, 0.12),
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.04)'
      }}>
        {logo && <img className="silo-logo" src={logo} alt={team?.abbr} loading="lazy" style={{ width: '18px', height: '18px' }} />}
        <span className="silo-team" style={{ color: '#fff', fontSize: '13px', fontWeight: '800' }}>
          {team?.abbr}
        </span>
        <span className="silo-count mono" style={{ fontSize: '11px', background: 'rgba(255,255,255,0.08)', padding: '1px 5px', borderRadius: '4px', marginLeft: 'auto' }}>{batters.length}</span>
      </div>
      <div className="silo-body" style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {batters.length === 0 ? (
          <div className="silo-empty" style={{ padding: '24px 12px', textAlign: 'center', color: 'var(--text-faint)', fontSize: '12px' }}>No matching batters</div>
        ) : (
          batters.map((b) => <SiloBatter key={b.id} b={b} {...ctx} />)
        )}
      </div>
    </div>
  )
}

function SiloBatter({ b, onSelect, selectedId, watchlist, slip, onToggleWatch, onToggleSlip }) {
  const color = gradeColor(b.grade?.label)
  const watched = watchlist.has(b.id)
  const inSlip = slip.has(b.id)
  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn(b)
  }
  const hrToday = useLiveMode() && b.liveContext?.isHRThisGame
  return (
    <div
      className={`silo-row ${selectedId === b.id ? 'selected' : ''}`}
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
        '--row-accent': color,
        borderLeft: `2px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.02)',
        cursor: 'pointer',
        transition: 'background 0.15s'
      }}
    >
      <img className="sb-avatar" src={playerHeadshot(b.playerId, 96)} alt={b.name} loading="lazy" style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover', background: 'rgba(255,255,255,0.03)', marginRight: '10px' }} />
      <div className="sb-content" style={{ flex: '1', minWidth: '0' }}>
        <div className="sb-line1" style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          {b.battingOrder ? <span className="sb-order mono" style={{ fontSize: '10px', background: 'rgba(255,255,255,0.05)', padding: '1px 4px', borderRadius: '3px' }}>{b.battingOrder}</span> : null}
          <span className={`sb-name ${hrToday ? 'hr-glow' : ''}`} style={{ fontSize: '12px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</span>
          <span className="bathand" style={{ fontSize: '9px', opacity: 0.6 }}>{b.batSide}</span>
          {hrToday && (
            <span className="hr-tag sm" title="Already homered" style={{ background: 'var(--b-hot)', color: '#000', borderRadius: '3px', padding: '1px 3px' }}>
              <Icon name="Flame" size={8} />
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
            <ProbRing value={b.hrProbability} color={color} size={36} />
          </div>
        </div>
        <div className="sb-line2" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
          <GradeChip grade={b.grade} size="sm" score={b.score} />
          {b.heatIndex >= HOT_HEAT && (
            <span className="sb-heat" title={`Heat index ${b.heatIndex}/100`} style={{ color: 'var(--b-hot)', display: 'inline-flex', alignItems: 'center', gap: '2px', fontWeight: '600' }}>
              <Icon name="Flame" size={10} />
              {b.heatIndex}
            </span>
          )}
          <span className="sb-acts" style={{ marginLeft: 'auto', display: 'flex', gap: '4px' }}>
            <button 
              className={`act-btn star ${watched ? 'on' : ''}`} 
              onClick={stop(onToggleWatch)} 
              aria-label="Watch" 
              title={watched ? 'Unwatch' : 'Watch'}
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '4px',
                border: '1px solid var(--border-soft)',
                background: watched ? 'rgba(214,181,111,0.1)' : 'transparent',
                color: watched ? 'var(--prime)' : 'var(--text-faint)',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Icon name="Star" size={11} style={{ fill: watched ? 'currentColor' : 'none' }} />
            </button>
            <button 
              className={`act-btn add ${inSlip ? 'on' : ''}`} 
              onClick={stop(onToggleSlip)} 
              aria-label="Parlay" 
              title={inSlip ? 'In parlay' : 'Add to parlay'}
              style={{
                width: '22px',
                height: '22px',
                borderRadius: '4px',
                border: '1px solid var(--border-soft)',
                background: inSlip ? 'rgba(105,185,158,0.1)' : 'transparent',
                color: inSlip ? 'var(--strong)' : 'var(--text-faint)',
                display: 'grid',
                placeItems: 'center'
              }}
            >
              <Icon name={inSlip ? 'Check' : 'Plus'} size={11} />
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}
