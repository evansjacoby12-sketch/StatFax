import { useState } from 'react'
import Icon from './Icon.jsx'
import WorkspaceShell from './WorkspaceShell.jsx'

const TABS = [
  { id: 'playbook', label: 'Playbook', icon: 'Target' },
  { id: 'guide', label: 'Guide', icon: 'BookOpen' },
  { id: 'glossary', label: 'Glossary', icon: 'Search' },
]

const PLAYBOOK = [
  ['LayoutGrid', '1 · Choose the market first', ['A player can be a strong Anytime TD play and still be a poor receiving-yards play. Start with the exact market, then evaluate its role and line.', 'Use only eligible markets shown in player research. Missing price or line data stays unknown; it is never treated as value.']],
  ['UserCheck', '2 · Confirm role and availability', ['Prefer active players with a stable depth-chart role, strong snap expectation, and no meaningful restriction.', 'Role inheritance can create value when an inactive teammate leaves carries, routes, targets, or goal-line work behind.']],
  ['Target', '3 · Match opportunity to the prop', ['Touchdowns: prioritize red-zone touches, end-zone targets, goal-line packages, and team scoring opportunity.', 'Receiving: prioritize routes, target share, targets per route, and matchup allowance. Rushing: prioritize carries, carry share, goal-line work, and game script. Passing: prioritize dropbacks, attempts, protection, and pace.']],
  ['Shield', '4 · Check the matchup', ['Defense-vs-position ranks and allowed production describe the opposing unit, not a guarantee for one player.', 'Use matchup as support for a strong role. A soft defense cannot rescue a player who may not be on the field.']],
  ['Wind', '5 · Price weather and uncertainty', ['Wind and precipitation matter most for passing and receiving markets. Dome and neutral conditions should remain neutral.', 'Questionable availability, stale feeds, missing odds, and uncertain workload must lower confidence even when the projection looks attractive.']],
  ['GitBranch', '6 · Build parlays last', ['Every leg must hit, so all-hit probability falls quickly as legs are added.', 'Same-game combinations use the independent product until settled evidence supports a real correlation adjustment. More legs increase payout—not reliability.']],
]

const GUIDE_SECTIONS = [
  ['Zap', 'Signals', 'Ranked QB, RB, WR, and TE props with market-specific probability, line or odds, model edge, role, matchup, weather, and live state.'],
  ['Beaker', 'TD Bet Lab', 'Build Scorer Core, Goal-Line Hammer, End-Zone Alpha, First Strike, and Double Tap touchdown parlays.'],
  ['Gauge', 'Performance', 'NFL feed health, season tracking, probability calibration, projection error, and market-level results.'],
  ['SlidersHorizontal', 'Signal filters', 'Combine Role Up, Goal-Line, Red Zone, Route Share, Target Share, Snap Share, streak, matchup, split, weather, and lineup filters.'],
  ['BookOpen', 'Player research', 'Open a player for Overview, Role, Matchup, and Game Log evidence without losing the selected market.'],
]

const SIGNALS = [
  ['Role Up', 'The player is inheriting meaningful work or projecting above his recent role.'],
  ['Goal-Line', 'The player owns touches or a package near the opponent goal line.'],
  ['Red Zone', 'Recent red-zone targets or touches support scoring opportunity.'],
  ['Route Share', 'The player participates in a strong share of team pass routes.'],
  ['Target Share', 'The player earns a meaningful share of team pass attempts.'],
  ['Snap Share', 'Projected or observed playing time supports the workload.'],
  ['Matchup Edge', 'The opposing defense has allowed above-average production to the position.'],
  ['Weather Edge', 'Conditions provide a small, market-specific benefit.'],
  ['Snap Limit', 'The player has a workload restriction or meaningful role uncertainty.'],
]

const TERMS = [
  ['Model probability', 'The NFL engine’s estimated chance that the selected prop hits.'],
  ['Model edge', 'Model probability minus the fair implied probability from the available market price.'],
  ['Anytime TD', 'Chance the player scores at least one touchdown.'],
  ['First TD', 'Chance the player scores the game’s first touchdown; a higher-variance market.'],
  ['2+ TD', 'Chance the player scores at least twice, modeled separately from Anytime TD.'],
  ['All-hit', 'Chance every parlay leg hits. StatFax multiplies the individual leg probabilities.'],
  ['Target share', 'Share of team pass attempts directed to the player.'],
  ['Route participation', 'Share of team dropbacks on which the player runs a route.'],
  ['Carry share', 'Share of team rushing attempts assigned to the player.'],
  ['Red-zone opportunity', 'A target or rushing attempt close to the opponent end zone.'],
  ['Defense vs position', 'Opponent production allowed to the selected player position.'],
  ['Live blend', 'Observed production and remaining-game expectation combined during a live game.'],
]

function NFLPlaybook() {
  return <div className="learn-embedded" role="tabpanel">
    <div className="model-head"><h2><Icon name="Target" size={18} /> NFL Playbook</h2><div className="model-sub dim">A market-first process for evaluating football props and combinations.</div></div>
    {PLAYBOOK.map(([icon, title, points]) => <section className="htp-step" key={title}><h3 className="section-title"><Icon name={icon} size={14} />{title}</h3><ul className="htp-list">{points.map((point) => <li key={point}>{point}</li>)}</ul></section>)}
    <section className="htp-step"><h3 className="section-title"><Icon name="Check" size={14} />60-second checklist</h3><ul className="htp-check">{['Eligible for this exact market', 'Active role with no unresolved restriction', 'Opportunity matches the prop type', 'Matchup supports—not replaces—the role', 'Line and price are present when evaluating edge', 'Parlay probability is understood before adding legs'].map((item) => <li key={item}><Icon name="Check" size={13} />{item}</li>)}</ul></section>
  </div>
}

function NFLGuide() {
  return <div className="learn-embedded" role="tabpanel">
    <div className="model-head"><h2><Icon name="BookOpen" size={18} /> NFL Guide</h2><div className="model-sub dim">How the football workspace is organized and what each surface is for.</div></div>
    <div className="guide-callout"><span className="guide-callout-h"><Icon name="TriangleAlert" size={14} />Read availability before projection</span><span className="dim">NFL workloads change quickly. Depth, injury, restriction, lineup, and live-snap context should be checked before treating a model probability as actionable.</span></div>
    <h3 className="section-title"><Icon name="LayoutGrid" size={14} />The workspaces</h3><div className="guide-list">{GUIDE_SECTIONS.map(([icon, name, desc]) => <div className="guide-row" key={name}><span className="guide-ico"><Icon name={icon} size={15} /></span><span className="guide-txt"><b>{name}</b><span className="dim">{desc}</span></span></div>)}</div>
    <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="Gauge" size={14} />Reading a prop</h3><p className="guide-p dim">Lead with the selected market, model probability, line or odds, edge, availability, and role. Then use matchup, recent production, weather, and live pace as supporting evidence. A missing price is shown as missing—not as a positive edge.</p>
    <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="GitBranch" size={14} />Reading TD Bet Lab</h3><p className="guide-p dim">Scorer Core ranks Anytime TD anchors. Goal-Line Hammer and End-Zone Alpha require observed usage or a confirmed role. First Strike uses one First TD scorer per game. Double Tap uses only 2+ TD legs and carries extreme variance. The engine caps player, team, and game exposure; archives opening and closing boards; and applies stack-level joint calibration when at least 100 historical builds are available.</p>
  </div>
}

function NFLGlossary() {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const visibleSignals = needle ? SIGNALS.filter(([term, description]) => `${term} ${description}`.toLowerCase().includes(needle)) : SIGNALS
  const visibleTerms = needle ? TERMS.filter(([term, description]) => `${term} ${description}`.toLowerCase().includes(needle)) : TERMS
  return <div className="learn-embedded" role="tabpanel">
    <label className="learn-search"><Icon name="Search" size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search NFL markets, signals, or stats…" aria-label="Search NFL glossary" /></label>
    <h3 className="section-title"><Icon name="SlidersHorizontal" size={14} />Signals</h3><dl className="legend-terms">{visibleSignals.map(([term, description]) => <div className="legend-term" key={term}><dt>{term}</dt><dd className="dim">{description}</dd></div>)}</dl>
    <h3 className="section-title" style={{ marginTop: 18 }}><Icon name="Gauge" size={14} />Markets and stats</h3><dl className="legend-terms">{visibleTerms.map(([term, description]) => <div className="legend-term" key={term}><dt>{term}</dt><dd className="dim">{description}</dd></div>)}</dl>
    {needle && !visibleSignals.length && !visibleTerms.length && <div className="learn-search-empty">No NFL glossary entries match “{query}”.</div>}
  </div>
}

export default function NFLLearnCenter({ initialTab = 'playbook', onClose }) {
  const [tab, setTab] = useState(initialTab)
  return <WorkspaceShell icon="GraduationCap" eyebrow="NFL reference workspace" title="NFL Learn Center" description="A football-specific playbook, product guide, and plain-language definition library." tabs={TABS} activeTab={tab} onTabChange={setTab} onClose={onClose} size="reading" status={null}>
    {tab === 'playbook' && <NFLPlaybook />}
    {tab === 'guide' && <NFLGuide />}
    {tab === 'glossary' && <NFLGlossary />}
  </WorkspaceShell>
}
