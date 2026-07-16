import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import { GradeChip } from './atoms.jsx'
import { activeBadges, gradeColor } from '../lib/badges.js'
import { american, num, pct } from '../lib/format.js'
import { isBenched } from '../lib/combo-engine.js'
import { playerHeadshot } from '../lib/teams.js'
import { pitcherVulnerability } from '../lib/vulnerability.js'
import { combinedEdge5 } from '../lib/zoneEdge.js'
import { lineupActionability } from '../lib/actionability.js'

const ELIGIBLE_GRADES = new Set(['PRIME', 'STRONG', 'LEAN'])
const GRADE_CASE = { PRIME: 100, STRONG: 78, LEAN: 58 }

const clamp = (value, low = 0, high = 100) => Math.max(low, Math.min(high, value))

function impliedProbability(odds) {
  if (!Number.isFinite(odds) || odds === 0) return null
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100)
}

function addEvidence(list, key, label, icon, detail, points) {
  if (!list.some((item) => item.key === key)) list.push({ key, label, icon, detail, points })
}

function buildCase(batter) {
  const grade = batter.grade?.label || batter.grade || 'SKIP'
  const probability = Number(batter.hrProbability)
  const zone = combinedEdge5(batter)
  const vulnerability = pitcherVulnerability(batter.pitcher)
  const barrel = Number.isFinite(batter.barrelPctBBE) ? batter.barrelPctBBE : batter.barrelPct
  const air = Number.isFinite(batter.parkWeatherHandFactor) ? batter.parkWeatherHandFactor : 1
  const price = Number(batter.odds?.best?.american)
  const implied = impliedProbability(price)
  const marketEdge = implied == null ? null : probability - implied
  const positiveReasons = (batter.eli5Reasons || []).filter((reason) => reason?.tone === 'good').length
  const negativeReasons = (batter.eli5Reasons || []).filter((reason) => reason?.tone === 'bad').length
  const signalKeys = new Set(activeBadges(batter).map((badge) => badge.key))

  const probScore = clamp(((probability - 0.07) / 0.18) * 100)
  const model = clamp(0.52 * (batter.score ?? 50) + 0.48 * probScore)
  const gradeScore = GRADE_CASE[grade] ?? 0
  const matchupCount = [
    batter.primaryPitchEdge?.passes,
    batter.pitchMixEdge || signalKeys.has('pitchMixEdge'),
    batter.hrPlatoonEdge || signalKeys.has('hrPlatoonEdge'),
    batter.flyBallMatchup || signalKeys.has('flyBallMatchup'),
  ].filter(Boolean).length
  const matchup = clamp(34 + matchupCount * 13 + (Number.isFinite(zone) ? (zone - 2.5) * 12 : 0))
  const pitcher = vulnerability?.score ?? 50
  const barrelScore = Number.isFinite(barrel) ? clamp(((barrel - 5) / 13) * 100) : 45
  const liveForm = clamp(
    50 + ((batter.hotnessMultiplier ?? 1) - 1) * 500 + (batter.hot ? 12 : 0) + (batter.rising ? 10 : 0) + (batter.blast ? 10 : 0),
  )
  const power = clamp(0.42 * barrelScore + 0.28 * (batter.ceilScore ?? batter.score ?? 50) + 0.30 * (batter.formScore ?? liveForm))
  const evidenceBalance = clamp(50 + positiveReasons * 7 - negativeReasons * 8)
  const environment = clamp(50 + (air - 1) * 260)
  const market = marketEdge == null ? 50 : clamp(50 + marketEdge * 350)

  const penalties = []
  if (batter.cold || (batter.hotnessMultiplier ?? 1) < 0.97) penalties.push({ key: 'cold', label: 'Cold form', icon: 'Snowflake', detail: 'Recent contact is below the batter’s normal power baseline.', points: 6 })
  if (air < 0.97) penalties.push({ key: 'air', label: 'Weather drag', icon: 'CloudSun', detail: 'Park and air conditions suppress expected carry.', points: 4 })
  if (pitcher < 38) penalties.push({ key: 'pitcher', label: 'Tough pitcher', icon: 'Radar', detail: 'The opposing starter grades as difficult to attack.', points: 5 })
  if (marketEdge != null && marketEdge < -0.02) penalties.push({ key: 'price', label: 'Price tax', icon: 'DollarSign', detail: 'The posted price implies a higher hit rate than the model.', points: 4 })
  if (negativeReasons >= 4) penalties.push({ key: 'conflict', label: 'Signal conflict', icon: 'TriangleAlert', detail: 'Several negative matchup reasons oppose the positive case.', points: 3 })

  const rawScore =
    gradeScore * 0.08 +
    model * 0.14 +
    matchup * 0.22 +
    pitcher * 0.15 +
    power * 0.16 +
    evidenceBalance * 0.11 +
    environment * 0.06 +
    market * 0.08
  const penaltyTotal = penalties.reduce((sum, penalty) => sum + penalty.points, 0)
  const caseScore = Math.round(clamp(rawScore - penaltyTotal))

  const evidence = []
  if (Number.isFinite(zone) && zone >= 3.1) addEvidence(evidence, 'zone', 'Zone match', 'Grid3x3', `${num(zone, 1)}/5 zone-location or arsenal edge.`, Math.round(zone * 4))
  if (batter.primaryPitchEdge?.passes) addEvidence(evidence, 'pitch', 'Pitch edge', 'Crosshair', `Strong result against ${batter.primaryPitchEdge.pitchName || 'the primary pitch'} (${pct(batter.primaryPitchEdge.pitcherFreq, 0)} usage).`, 17)
  if (batter.pitchMixEdge || signalKeys.has('pitchMixEdge') || (batter.pmScore ?? 0) >= 7) addEvidence(evidence, 'mix', 'Pitch mix', 'BarChart2', 'The batter’s damage profile fits the starter’s full arsenal.', 16)
  if ((vulnerability?.score ?? 0) >= 58) addEvidence(evidence, 'vulnerability', 'Pitcher outlook', 'Shield', `${vulnerability.score}/100 pitcher vulnerability favors contact damage.`, Math.round((vulnerability.score - 35) / 2))
  if (Number.isFinite(barrel) && barrel >= 10) addEvidence(evidence, 'barrel', 'Barrel form', 'Target', `${num(barrel, 1)}% barrel rate supports the power ceiling.`, Math.round(barrel))
  if (batter.hot || batter.rising || batter.blast || signalKeys.has('hot') || signalKeys.has('rising') || signalKeys.has('blast')) addEvidence(evidence, 'form', 'Live power', 'Flame', 'Recent contact quality is running above the season baseline.', 15)
  if (batter.hrPlatoonEdge || signalKeys.has('hrPlatoonEdge')) addEvidence(evidence, 'platoon', 'Platoon edge', 'Split', 'The pitcher’s HR split favors this batter’s effective side.', 14)
  if (air >= 1.03) addEvidence(evidence, 'air', 'Air boost', 'Wind', `${num((air - 1) * 100, 0)}% park/weather/hand lift.`, Math.round((air - 1) * 100))
  if (marketEdge != null && marketEdge >= 0.01) addEvidence(evidence, 'value', 'Price value', 'DollarSign', `${pct(marketEdge, 1)} model edge versus the posted implied rate.`, Math.round(marketEdge * 100))
  if (positiveReasons >= 4) addEvidence(evidence, 'outlook', 'Reason stack', 'Layers', `${positiveReasons} positive model reasons agree on the play.`, positiveReasons)

  evidence.sort((a, b) => b.points - a.points || a.label.localeCompare(b.label))
  const topEvidence = evidence.slice(0, 3)
  const leading = topEvidence.slice(0, 2).map((item) => item.label.toLowerCase())
  const outlook = leading.length
    ? `${grade} case led by ${leading.join(' and ')}${penalties[0] ? `; ${penalties[0].label.toLowerCase()} caps the ceiling` : ' with no major conflict'}.`
    : `${grade} model case without enough supporting matchup evidence to upgrade the outlook.`

  return {
    batter,
    grade,
    probability,
    price: Number.isFinite(price) ? price : null,
    implied,
    marketEdge,
    zone,
    vulnerability,
    barrel,
    air,
    positiveReasons,
    negativeReasons,
    actionability: lineupActionability(batter),
    caseScore,
    evidence,
    topEvidence,
    penalties,
    outlook,
    factors: [
      { label: 'Grade', value: gradeScore, weight: 8 },
      { label: 'Model', value: model, weight: 14 },
      { label: 'Matchup', value: matchup, weight: 22 },
      { label: 'Pitcher', value: pitcher, weight: 15 },
      { label: 'Power/Form', value: power, weight: 16 },
      { label: 'Reasons', value: evidenceBalance, weight: 11 },
      { label: 'Environment', value: environment, weight: 6 },
      { label: 'Price', value: market, weight: 8 },
    ],
  }
}

function CaseScore({ score, color }) {
  return (
    <span className="straight-case-score" style={{ '--case-score': score, '--case-color': color }}>
      <b className="mono">{score}</b><small>case</small>
    </span>
  )
}

function EvidenceChip({ item, caution = false }) {
  return <span className={`straight-evidence ${caution ? 'caution' : ''}`} title={item.detail}><Icon name={item.icon} size={10} />{item.label}</span>
}

function StraightRow({ item, rank, onSelect, slipSet, onToggleSlip }) {
  const [open, setOpen] = useState(false)
  const b = item.batter
  const color = gradeColor(item.grade)
  const inSlip = !!slipSet?.has(b.id)
  const rankMove = item.boardRank - rank
  return (
    <article className={`straight-row ${open ? 'is-open' : ''}`} style={{ '--straight-color': color }}>
      <div className="straight-rank"><small>Rank</small><b className="mono">{String(rank).padStart(2, '0')}</b><em className={rankMove > 0 ? 'up' : rankMove < 0 ? 'down' : ''}>{rankMove === 0 ? 'same' : `${rankMove > 0 ? '↑' : '↓'}${Math.abs(rankMove)}`}</em></div>
      <div className="straight-identity">
        <span className="straight-photo"><img src={playerHeadshot(b.playerId, 96)} alt={b.name} loading="lazy" /></span>
        <span className="straight-player-copy">
          <span><b>{b.name}</b><GradeChip grade={b.grade} size="sm" /><span className={`lineup-state ${item.actionability.key}`} title={item.actionability.label}><Icon name={item.actionability.icon} size={8} />{item.actionability.shortLabel}</span></span>
          <small>{b.team} · vs {b.pitcher?.name || 'TBD'} ({b.pitcher?.hand || '?'}HP)</small>
          <em>Probability order #{item.boardRank}</em>
        </span>
      </div>
      <div className="straight-thesis">
        <div className="straight-evidence-row">
          {item.topEvidence.map((reason) => <EvidenceChip item={reason} key={reason.key} />)}
          {item.penalties[0] && <EvidenceChip item={item.penalties[0]} caution />}
        </div>
        <p>{item.outlook}</p>
      </div>
      <div className="straight-market">
        <span><small>Model HR</small><b className="mono">{pct(item.probability, 1)}</b></span>
        <span><small>Best price</small><b className={`mono ${item.marketEdge != null && item.marketEdge >= 0 ? 'pos' : ''}`}>{item.price != null ? american(item.price) : '—'}</b></span>
      </div>
      <CaseScore score={item.caseScore} color={color} />
      <div className="straight-actions">
        <button type="button" className="straight-research" onClick={() => onSelect?.(b)}><Icon name="ScanSearch" size={14} /><span>Research</span></button>
        <button type="button" className={`straight-add ${inSlip ? 'on' : ''}`} onClick={() => onToggleSlip?.(b)} disabled={!onToggleSlip}><Icon name={inSlip ? 'Check' : 'Plus'} size={14} /><span>{inSlip ? 'In slip' : 'Add to slip'}</span></button>
        <button type="button" className="straight-disclosure" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={open ? `Hide ${b.name} evidence` : `Show ${b.name} evidence`}><Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={14} /></button>
      </div>
      {open && (
        <div className="straight-breakdown">
          <div className="straight-factor-grid">
            {item.factors.map((factor) => <span key={factor.label}><small>{factor.label} · {factor.weight}%</small><b className="mono">{Math.round(factor.value)}</b><i><em style={{ width: `${factor.value}%` }} /></i></span>)}
          </div>
          <div className="straight-full-case">
            <span><b>Supporting evidence</b>{item.evidence.map((reason) => <small key={reason.key}><Icon name={reason.icon} size={10} />{reason.detail}</small>)}</span>
            <span><b>Conflicts & penalties</b>{item.penalties.length ? item.penalties.map((penalty) => <small className="bad" key={penalty.key}><Icon name={penalty.icon} size={10} />−{penalty.points}: {penalty.detail}</small>) : <small><Icon name="Check" size={10} />No material penalty applied.</small>}</span>
            <p><b>Why this is not board order:</b> probability rank #{item.boardRank}; reasons-based Case rank #{rank}. The Case Score rewards agreement and subtracts conflicts instead of sorting only by model HR probability.</p>
          </div>
        </div>
      )}
    </article>
  )
}

export default function TopStraightsView({ batters, onSelect, slipSet, onToggleSlip }) {
  const ranking = useMemo(() => {
    const eligible = (batters || []).filter((batter) => {
      const grade = batter.grade?.label || batter.grade || 'SKIP'
      return ELIGIBLE_GRADES.has(grade) && Number.isFinite(batter.hrProbability) && !batter.game?.isFinal && !batter.game?.isLive && !isBenched(batter)
    })
    const boardOrder = [...eligible].sort((a, b) => (b.hrProbability ?? 0) - (a.hrProbability ?? 0) || (b.score ?? 0) - (a.score ?? 0) || String(a.id ?? `${a.playerId}-${a.gamePk}`).localeCompare(String(b.id ?? `${b.playerId}-${b.gamePk}`)))
    const boardRanks = new Map(boardOrder.map((batter, index) => [batter.id ?? `${batter.playerId}-${batter.gamePk}`, index + 1]))
    return eligible
      .map(buildCase)
      .map((item) => ({ ...item, boardRank: boardRanks.get(item.batter.id ?? `${item.batter.playerId}-${item.batter.gamePk}`) }))
      .sort((a, b) => b.caseScore - a.caseScore || b.topEvidence.length - a.topEvidence.length || b.probability - a.probability || String(a.batter.id ?? `${a.batter.playerId}-${a.batter.gamePk}`).localeCompare(String(b.batter.id ?? `${b.batter.playerId}-${b.batter.gamePk}`)))
      .slice(0, 10)
  }, [batters])

  const eligibleCounts = ranking.reduce((counts, item) => ({ ...counts, [item.grade]: (counts[item.grade] || 0) + 1 }), {})
  return (
    <div className="top-straights">
      <div className="straight-method">
        <span className="straight-method-mark"><Icon name="ListOrdered" size={16} /></span>
        <span><b>Reasons-based ranking</b><small>Independent of the main board’s probability order</small></span>
        <div className="straight-grade-scope"><span style={{ '--scope-color': 'var(--prime)' }}>PRIME {eligibleCounts.PRIME || 0}</span><span style={{ '--scope-color': 'var(--strong)' }}>STRONG {eligibleCounts.STRONG || 0}</span><span style={{ '--scope-color': 'var(--lean)' }}>LEAN {eligibleCounts.LEAN || 0}</span></div>
        <em><Icon name="Info" size={11} />Not a guarantee</em>
      </div>
      <div className="straight-list-head"><span>Case rank</span><span>Player & matchup</span><span>Best reasons & outlook</span><span>Probability / price</span><span>Score</span><span>Actions</span></div>
      <div className="straight-list">
        {ranking.map((item, index) => <StraightRow key={item.batter.id ?? item.batter.playerId} item={item} rank={index + 1} onSelect={onSelect} slipSet={slipSet} onToggleSlip={onToggleSlip} />)}
      </div>
      {!ranking.length && <div className="empty-note">No PRIME, STRONG, or LEAN pregame plays are eligible right now.</div>}
      <p className="straight-disclaimer">Case Score ranks current evidence quality and disagreement; it does not predict certainty or guarantee an outcome.</p>
    </div>
  )
}
