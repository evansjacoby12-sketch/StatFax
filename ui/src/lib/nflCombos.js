import { NFL_PROP_MARKET_LIST, eligiblePropMarkets } from '../../../src/sports/nfl/logic/propEligibility.js'
import { scoreNFLProp } from '../../../src/sports/nfl/logic/ScoringEngine.js'
import { isNFLTDMarket, nflLegKey } from './nflTickets.js'

export const NFL_COMBO_STRATEGIES = Object.freeze([
  { id: 'scorer-core', label: 'Scorer Core', cardLabel: 'Core', icon: 'Shield', risk: 'Standard risk', riskTone: 'good', scopes: ['all', 'same-game'], description: 'Highest-confidence Anytime TD anchors.', meaning: 'Anytime TD only · probability, model strength and stable scoring role.' },
  { id: 'goal-line-hammer', label: 'Goal-Line Hammer', cardLabel: 'Goal-Line', icon: 'Bomb', risk: 'Elevated risk', riskTone: 'caution', scopes: ['all', 'same-game'], description: 'Rushing scorers with real work near the goal line.', meaning: 'QB/RB only · goal-line touches, inside-five share or designed red-zone work required.' },
  { id: 'end-zone-alpha', label: 'End-Zone Alpha', cardLabel: 'End-Zone', icon: 'Crosshair', risk: 'Elevated risk', riskTone: 'caution', scopes: ['all', 'same-game'], description: 'Primary receiving threats where touchdowns are caught.', meaning: 'WR/TE only · end-zone targets or meaningful red-zone target volume required.' },
  { id: 'first-strike', label: 'First Strike', cardLabel: 'First Strike', icon: 'Trophy', risk: 'High variance', riskTone: 'avoid', scopes: ['all'], description: 'A cross-game portfolio of First TD scorers.', meaning: 'First TD only · every leg must come from a different game.' },
  { id: 'double-tap', label: 'Double Tap', cardLabel: 'Double Tap', icon: 'Flame', risk: 'Extreme variance', riskTone: 'avoid', scopes: ['all', 'same-game'], description: 'Multi-score ceiling plays.', meaning: '2+ TD only · longshot outcomes with the highest stack variance.' },
])

const GRADE_RANK = { SKIP: 0, LEAN: 1, STRONG: 2, PRIME: 3 }
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0))

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

function goalLineScore(candidate) {
  const role = candidate.scoringRole
  return clamp01(
    Math.min(1, role.goalLineTouchesL3 / 3) * .34
    + clamp01(role.goalLineOpportunityShare / .3) * .26
    + clamp01(role.insideFiveShare / .55) * .2
    + clamp01(role.designedTouchShare / .3) * .2,
  )
}

function endZoneScore(candidate) {
  const role = candidate.scoringRole
  return clamp01(
    Math.min(1, role.endZoneTargetsL3 / 3) * .38
    + Math.min(1, role.redZoneTargetsL3 / 5) * .24
    + clamp01(role.endZoneTargetShare / .3) * .2
    + clamp01(role.endZoneRouteShare / .55) * .18,
  )
}

function eligibleForStack(candidate, strategy) {
  if (strategy === 'scorer-core') return candidate.marketId === 'anytime_td'
  if (strategy === 'goal-line-hammer') return ['anytime_td', 'two_plus_td'].includes(candidate.marketId)
    && ['QB', 'RB'].includes(candidate.position)
    && (candidate.scoringRole.goalLineTouchesL3 >= 1 || candidate.scoringRole.goalLineOpportunityShare >= .12 || candidate.scoringRole.designedTouchShare >= .12)
  if (strategy === 'end-zone-alpha') return ['anytime_td', 'first_td'].includes(candidate.marketId)
    && ['WR', 'TE'].includes(candidate.position)
    && (candidate.scoringRole.endZoneTargetsL3 >= 1 || candidate.scoringRole.redZoneTargetsL3 >= 2 || candidate.scoringRole.endZoneTargetShare >= .1)
  if (strategy === 'first-strike') return candidate.marketId === 'first_td'
  if (strategy === 'double-tap') return candidate.marketId === 'two_plus_td'
  return false
}

function candidateScore(candidate, strategy) {
  const probability = candidate.model.probability || 0
  const edge = candidate.model.edge == null ? 0 : candidate.model.edge
  const model = (candidate.model.score || 0) / 100
  if (strategy === 'goal-line-hammer') return probability * .36 + model * .25 + goalLineScore(candidate) * .32 + Math.max(0, edge) * .7
  if (strategy === 'end-zone-alpha') return probability * .36 + model * .25 + endZoneScore(candidate) * .32 + Math.max(0, edge) * .7
  if (strategy === 'first-strike') return probability * .56 + model * .3 + Math.max(0, edge) * 1.1
  if (strategy === 'double-tap') return probability * .5 + model * .35 + Math.max(0, edge) * .9
  return probability * .62 + model * .3 + Math.max(0, edge) * .8
}

function rationaleFor(legs, strategy, scope) {
  const signalCount = legs.reduce((sum, leg) => sum + Math.min(2, leg.model.signals?.length || 0), 0)
  const games = new Set(legs.map((leg) => leg.gameKey)).size
  const averageProbability = legs.reduce((sum, leg) => sum + leg.probability, 0) / legs.length
  if (strategy === 'goal-line-hammer') {
    const touches = legs.reduce((sum, leg) => sum + leg.scoringRole.goalLineTouchesL3, 0)
    return `${touches} combined goal-line touches over the last three games, supported by inside-five or designed rushing work.`
  }
  if (strategy === 'end-zone-alpha') {
    const endZone = legs.reduce((sum, leg) => sum + leg.scoringRole.endZoneTargetsL3, 0)
    const redZone = legs.reduce((sum, leg) => sum + leg.scoringRole.redZoneTargetsL3, 0)
    return `${endZone} end-zone targets and ${redZone} red-zone targets over the last three games across this stack.`
  }
  if (strategy === 'first-strike') return `One First TD scorer from each of ${games} separate games.`
  if (strategy === 'double-tap') return `Every leg requires two touchdowns; average modeled leg probability is ${(averageProbability * 100).toFixed(1)}%.`
  return scope === 'same-game' ? `One-game Anytime TD core averaging ${(averageProbability * 100).toFixed(1)}% per leg with ${signalCount} supporting signals.` : `Anytime TD anchors across ${games} games averaging ${(averageProbability * 100).toFixed(1)}% per leg.`
}

export function buildNFLCombos(snapshot, { legs = 2, strategy = 'scorer-core', scope = 'all', minGrade = 'LEAN' } = {}) {
  const candidates = (snapshot?.players || []).flatMap((player) => eligiblePropMarkets(player).map((market) => {
    const model = scoreNFLProp(player, market.id)
    return {
      key: nflLegKey(player.id, market.id), playerId: player.id, name: player.name, position: player.position,
      team: player.team, opponent: player.opponent, gameKey: gameKey(player), kickoff: player.kickoff,
      marketId: market.id, marketLabel: market.shortLabel, marketKind: market.kind, line: model.line,
      odds: model.odds, probability: model.probability, grade: model.grade, model,
      scoringRole: {
        goalLineTouchesL3: Number(player.usage?.goalLineTouchesL3 || 0),
        goalLineOpportunityShare: Number(player.usage?.goalLineOpportunityShare || player.usage?.goalToGoOpportunityShare || 0),
        insideFiveShare: Number(player.lineup?.redZone?.insideFiveShare || 0),
        designedTouchShare: Number(player.lineup?.redZone?.designedTouchShare || 0),
        endZoneTargetsL3: Number(player.usage?.endZoneTargetsL3 || 0),
        redZoneTargetsL3: Number(player.usage?.redZoneTargetsL3 || 0),
        endZoneTargetShare: Number(player.usage?.endZoneTargetShare || 0),
        endZoneRouteShare: Number(player.lineup?.redZone?.endZoneRouteShare || 0),
      },
    }
  }))
    .filter((candidate) => isNFLTDMarket(candidate.marketId))
    .filter((candidate) => eligibleForStack(candidate, strategy))
    .filter((candidate) => GRADE_RANK[candidate.grade] >= GRADE_RANK[minGrade])
    .sort((a, b) => candidateScore(b, strategy) - candidateScore(a, strategy))
    .slice(0, scope === 'same-game' ? 32 : 18)

  const combos = combinationRows(candidates, Math.max(2, Math.min(4, Number(legs) || 2)))
    .filter((combo) => new Set(combo.map((leg) => leg.playerId)).size === combo.length)
    .filter((combo) => {
      const firstTDGames = combo.filter((leg) => leg.marketId === 'first_td').map((leg) => leg.gameKey)
      return new Set(firstTDGames).size === firstTDGames.length
    })
    .filter((combo) => scope === 'same-game'
      ? new Set(combo.map((leg) => leg.gameKey)).size === 1
      : new Set(combo.map((leg) => leg.gameKey)).size === combo.length)
    .map((combo) => {
      const probability = combo.reduce((product, leg) => product * leg.probability, 1)
      const prices = combo.map((leg) => decimalOdds(leg.odds))
      const decimal = prices.every(Number.isFinite) ? prices.reduce((product, price) => product * price, 1) : null
      const avgScore = combo.reduce((sum, leg) => sum + leg.model.score, 0) / combo.length
      const avgEdge = combo.reduce((sum, leg) => sum + (leg.model.edge || 0), 0) / combo.length
      const rank = combo.reduce((sum, leg) => sum + candidateScore(leg, strategy), 0) / combo.length
        + Math.max(0, avgEdge) * .45
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
