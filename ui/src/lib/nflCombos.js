import { NFL_PROP_MARKET_LIST, eligiblePropMarkets } from '../../../src/sports/nfl/logic/propEligibility.js'
import { scoreNFLProp } from '../../../src/sports/nfl/logic/ScoringEngine.js'
import { nflLegKey } from './nflTickets.js'

export const NFL_COMBO_STRATEGIES = Object.freeze([
  { id: 'balanced', label: 'Balanced', icon: 'Layers', description: 'Blends confidence, price and market variety.' },
  { id: 'safe', label: 'High confidence', icon: 'Shield', description: 'Prioritizes the strongest model probabilities.' },
  { id: 'value', label: 'Best value', icon: 'CircleDollarSign', description: 'Prioritizes positive model edge at available prices.' },
  { id: 'touchdown', label: 'TD stack', icon: 'Flame', description: 'Builds scorer-only combinations.' },
  { id: 'volume', label: 'Volume', icon: 'Activity', description: 'Builds yardage and reception combinations.' },
])

const TD_MARKETS = new Set(['anytime_td', 'first_td', 'two_plus_td'])
const GRADE_RANK = { SKIP: 0, LEAN: 1, STRONG: 2, PRIME: 3 }

const gameKey = (player) => player.gameId || [player.team, player.opponent].filter(Boolean).sort().join('-')
const decimalOdds = (american) => !Number.isFinite(Number(american)) || Number(american) === 0
  ? null
  : Number(american) > 0 ? 1 + Number(american) / 100 : 1 + 100 / Math.abs(Number(american))

function americanOdds(decimal) {
  if (!Number.isFinite(decimal) || decimal <= 1) return null
  return Math.round(decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1))
}

function combinationRows(rows, size) {
  const out = []
  const visit = (start, picked) => {
    if (picked.length === size) { out.push(picked.slice()); return }
    for (let index = start; index <= rows.length - (size - picked.length); index += 1) {
      picked.push(rows[index]); visit(index + 1, picked); picked.pop()
    }
  }
  visit(0, [])
  return out
}

function candidateScore(candidate, strategy) {
  const probability = candidate.model.probability || 0
  const edge = candidate.model.edge == null ? 0 : candidate.model.edge
  const model = (candidate.model.score || 0) / 100
  if (strategy === 'safe') return probability * .72 + model * .28
  if (strategy === 'value') return edge * 1.8 + model * .34 + probability * .22
  if (strategy === 'touchdown') return probability * .52 + model * .32 + Math.max(0, edge) * .9
  if (strategy === 'volume') return probability * .58 + model * .34 + Math.max(0, edge) * .7
  return probability * .42 + model * .38 + Math.max(0, edge) * .9
}

function rationaleFor(legs, strategy, scope) {
  const signalCount = legs.reduce((sum, leg) => sum + Math.min(2, leg.model.signals?.length || 0), 0)
  const positiveEdges = legs.filter((leg) => Number(leg.model.edge) > 0).length
  const games = new Set(legs.map((leg) => leg.gameKey)).size
  if (strategy === 'safe') return `Top-confidence legs with ${signalCount} active model signals.`
  if (strategy === 'value') return `${positiveEdges}/${legs.length} legs show positive edge at the listed price.`
  if (strategy === 'touchdown') return 'Scorer stack built from role, red-zone and matchup evidence.'
  if (strategy === 'volume') return 'Volume stack built from projected workload and defensive matchup.'
  return scope === 'same-game'
    ? `One-game build with ${signalCount} active role and matchup signals.`
    : `Balanced across ${games} game${games === 1 ? '' : 's'} with confidence and price in the mix.`
}

export function buildNFLCombos(snapshot, { legs = 2, strategy = 'balanced', scope = 'all', minGrade = 'LEAN' } = {}) {
  const candidates = (snapshot?.players || []).flatMap((player) => eligiblePropMarkets(player).map((market) => {
    const model = scoreNFLProp(player, market.id)
    return {
      key: nflLegKey(player.id, market.id), playerId: player.id, name: player.name, position: player.position,
      team: player.team, opponent: player.opponent, gameKey: gameKey(player), kickoff: player.kickoff,
      marketId: market.id, marketLabel: market.shortLabel, marketKind: market.kind, line: model.line,
      odds: model.odds, probability: model.probability, grade: model.grade, model,
    }
  }))
    .filter((candidate) => GRADE_RANK[candidate.grade] >= GRADE_RANK[minGrade])
    .filter((candidate) => strategy !== 'touchdown' || TD_MARKETS.has(candidate.marketId))
    .filter((candidate) => strategy !== 'volume' || !TD_MARKETS.has(candidate.marketId))
    .sort((a, b) => candidateScore(b, strategy) - candidateScore(a, strategy))
    .slice(0, scope === 'same-game' ? 32 : 18)

  const combos = combinationRows(candidates, Math.max(2, Math.min(4, Number(legs) || 2)))
    .filter((combo) => new Set(combo.map((leg) => leg.playerId)).size === combo.length)
    .filter((combo) => scope !== 'same-game' || new Set(combo.map((leg) => leg.gameKey)).size === 1)
    .map((combo) => {
      const probability = combo.reduce((product, leg) => product * leg.probability, 1)
      const prices = combo.map((leg) => decimalOdds(leg.odds))
      const decimal = prices.every(Number.isFinite) ? prices.reduce((product, price) => product * price, 1) : null
      const avgScore = combo.reduce((sum, leg) => sum + leg.model.score, 0) / combo.length
      const avgEdge = combo.reduce((sum, leg) => sum + (leg.model.edge || 0), 0) / combo.length
      const variety = new Set(combo.map((leg) => leg.marketKind)).size / combo.length
      const rank = combo.reduce((sum, leg) => sum + candidateScore(leg, strategy), 0) / combo.length
        + Math.max(0, avgEdge) * .45 + variety * (strategy === 'balanced' ? .06 : .015)
      // Grade the construction quality from its legs. The all-hit probability
      // naturally falls as legs are added and should not downgrade a sound
      // three- or four-leg build merely because multiplication is doing its job.
      const score = Math.max(0, Math.min(100, Math.round(avgScore)))
      const grade = score >= 70 ? 'PRIME' : score >= 58 ? 'STRONG' : score >= 46 ? 'LEAN' : 'SKIP'
      return {
        id: combo.map((leg) => leg.key).sort().join('|'), legs: combo, probability, decimalOdds: decimal,
        americanOdds: americanOdds(decimal), avgEdge, score, grade, rank,
        rationale: rationaleFor(combo, strategy, scope), strategy, scope,
      }
    })
    .sort((a, b) => b.rank - a.rank || b.probability - a.probability)

  const seen = new Set()
  return combos.filter((combo) => {
    const signature = combo.legs.map((leg) => leg.key).sort().join('|')
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  }).slice(0, 12)
}

export function nflComboMarketLabel(marketId) {
  return NFL_PROP_MARKET_LIST.find((market) => market.id === marketId)?.shortLabel || marketId
}
