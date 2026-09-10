import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'
import WorkspaceShell from './WorkspaceShell.jsx'
import { NFL_PROP_MARKET_LIST, eligiblePropMarkets } from '../../../src/sports/nfl/logic/propEligibility.js'
import { scoreNFLProp } from '../../../src/sports/nfl/logic/ScoringEngine.js'
import { americanOdds } from '../lib/nflCombos.js'

const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`
const price = (value) => value == null ? 'No price' : value > 0 ? `+${value}` : String(value)
const GRADE_COLORS = { PRIME: 'var(--prime)', STRONG: 'var(--strong)', LEAN: 'var(--lean)', SKIP: 'var(--skip)' }
const PAGES = [
  { id: 'touchdowns', label: 'Touchdowns', icon: 'Target', markets: ['anytime_td', 'first_td', 'two_plus_td'] },
  { id: 'receiving', label: 'Receiving', icon: 'Radio', markets: ['receptions', 'receiving_yards'] },
  { id: 'rushing', label: 'Rushing', icon: 'Zap', markets: ['rushing_yards', 'rushing_receiving_yards'] },
  { id: 'passing', label: 'Passing', icon: 'BarChart3', markets: ['passing_yards', 'passing_rushing_yards'] },
]

function cheatPrice(model, marketId) {
  if (!model) return '—'
  if (marketId.includes('td')) {
    if (model.odds != null) return price(model.odds)
    if (model.probability != null && model.probability > 0) {
      const fair = americanOdds(1 / model.probability)
      return fair ? `Fair ${price(fair)}` : 'No price'
    }
    return 'No price'
  }
  const lineStr = model.line != null ? `O ${model.line}` : null
  const oddsStr = model.odds != null ? `(${price(model.odds)})` : null
  if (lineStr && oddsStr) return `${lineStr} ${oddsStr}`
  if (lineStr) return lineStr
  if (oddsStr) return oddsStr
  if (model.probability != null && model.probability > 0) {
    const fair = americanOdds(1 / model.probability)
    return fair ? `Fair ${price(fair)}` : 'No price'
  }
  return 'No price'
}

function MarketBoard({ snapshot, marketId }) {
  const market = NFL_PROP_MARKET_LIST.find((item) => item.id === marketId)
  const rows = useMemo(() => (snapshot?.players || [])
    .filter((player) => !player.live?.isFinal)
    .filter((player) => eligiblePropMarkets(player).some((item) => item.id === marketId))
    .map((player) => ({ player, model: scoreNFLProp(player, marketId) }))
    .filter(({ model }) => Number.isFinite(model.probability))
    .sort((a, b) => b.model.probability - a.model.probability || String(a.player.id).localeCompare(String(b.player.id)))
    .slice(0, 10), [marketId, snapshot])
  if (!rows.length) return null
  return <section className="splits-card nfl-cheat-card">
    <h4 className="splits-h"><Icon name={marketId.includes('td') ? 'Target' : marketId.includes('rece') ? 'Radio' : marketId.includes('rush') ? 'Zap' : 'BarChart3'} size={14} />{market?.label}<span className="splits-sub dim">model probability</span></h4>
    <ol className="splits-list">{rows.map(({ player, model }, index) => <li className="splits-row static nfl-cheat-row" key={`${player.id}:${marketId}`}><span className="splits-rank mono">{index + 1}</span><span className="splits-name">{player.name}<small>{player.position} · {player.team} vs {player.opponent}</small></span><span className="nfl-cheat-grade" style={{ color: GRADE_COLORS[model.grade] }}>{model.grade}</span><span className="nfl-cheat-price mono">{cheatPrice(model, marketId)}</span><span className="splits-val mono">{pct(model.probability)}</span></li>)}</ol>
  </section>
}

export default function NFLCheatSheet({ snapshot, onClose }) {
  const [page, setPage] = useState('touchdowns')
  const active = PAGES.find((item) => item.id === page) || PAGES[0]
  return <WorkspaceShell icon="LayoutGrid" eyebrow="NFL discovery workspace" title="NFL Cheat Sheet" description="Market-by-market football leaders ranked from the current NFL model slate." tabs={[]} onClose={onClose} status={`${snapshot?.players?.length || 0} slate players`}>
    <div className="workspace-brief compact"><span><b>Read the exact market</b> Probability, eligibility, line, price, and grade are market-specific. Missing prices remain explicit.</span></div>
    <CommandTabs className="cheat-tabs" label="NFL cheat sheet pages" value={page} onChange={setPage} tabs={PAGES} />
    <div className="splits-grid">{active.markets.map((marketId) => <MarketBoard key={marketId} snapshot={snapshot} marketId={marketId} />)}</div>
  </WorkspaceShell>
}
