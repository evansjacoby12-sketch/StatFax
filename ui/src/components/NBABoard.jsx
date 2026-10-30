import { useState, useMemo } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'
import { SPORT_UI } from '../lib/sportUi.js'
import NBA_DEMO_SNAPSHOT from '../../../src/sports/nba/data/demoSlate.js'
import {
  probToAmericanOdds,
  SETTLEMENT_RULES,
  scoreGameFirstBasket,
} from '../../../src/sports/nba/logic/firstBasketEngine.js'
import { getJumpBallMatchup } from '../../../src/sports/nba/data/jumpBalls.js'
import { getStartersForTeam, TEAM_ABBR_ALIASES } from '../../../src/sports/nba/data/teamRosters.js'
import {
  generateTwoLegBoard,
  buildTwoLegCombo,
  NBA_COMBO_STRATEGIES,
} from '../../../src/sports/nba/logic/firstBasketCombos.js'
import './NBABoard.css'

export const NBA_TEAM_COLORS = {
  ATL: '#E03A3E', BOS: '#007A33', BKN: '#000000', CHA: '#1D1160', CHI: '#CE1141',
  CLE: '#860038', DAL: '#00538C', DEN: '#0E2240', DET: '#1D428A', GSW: '#1D428A',
  HOU: '#CE1141', IND: '#002D62', LAC: '#C8102E', LAL: '#552583', MEM: '#5D76A9',
  MIA: '#98002E', MIL: '#00471B', MIN: '#0C2340', NOP: '#0C2340', NYK: '#006BB6',
  OKC: '#007AC1', ORL: '#0077C0', PHI: '#006BB6', PHX: '#1D1160', POR: '#E03A3E',
  SAC: '#5A2D81', SAS: '#C4CED4', TOR: '#CE1141', UTA: '#002B5C', WAS: '#002B5C',
}

export default function NBABoard({
  snapshot: suppliedSnapshot = null,
  view: controlledView = null,
  onViewChange = null,
}) {
  const snapshot = suppliedSnapshot || NBA_DEMO_SNAPSHOT
  const [internalView, setInternalView] = useState('signals')
  const view = controlledView || internalView
  const setView = onViewChange || setInternalView

  // Settlement rules: FIRST_FIELD_GOAL (DraftKings/FanDuel standard) vs FIRST_POINT_SCORED (FTs count)
  const [settlementRule, setSettlementRule] = useState(SETTLEMENT_RULES.FIRST_FIELD_GOAL)

  // Filters
  const [search, setSearch] = useState('')
  const [marketMode, setMarketMode] = useState('game') // 'game' | 'team'
  const [selectedPos, setSelectedPos] = useState('all') // 'all' | 'PG' | 'SG' | 'SF' | 'PF' | 'C'
  const [valueFilter, setValueFilter] = useState('all') // 'all' | 'ev' | 'prime' | 'longshot'
  const [selectedGameId, setSelectedGameId] = useState('all')
  const [top3Only, setTop3Only] = useState(true) // Default to Top 3 picks per game (clean, less clutter)
  const [groupByGame, setGroupByGame] = useState(true) // Group and sort chronologically by game and time

  // Bet Lab 2-Leg Parlay State
  const [betLabSubView, setBetLabSubView] = useState('recipes') // 'recipes' | 'builder'
  const [comboStrategyFilter, setComboStrategyFilter] = useState('all') // 'all' | strategy id
  const [customLegA, setCustomLegA] = useState(null)
  const [customLegB, setCustomLegB] = useState(null)
  const [copiedSlip, setCopiedSlip] = useState(false)

  // Parlay slip state
  const [slipLegs, setSlipLegs] = useState([])
  const [stake, setStake] = useState(20)

  // Drawer modal
  const [inspectedPlayer, setInspectedPlayer] = useState(null)

  // NOP starting center scenario switch (Missi day-to-day vs Jordan if out)
  const [centerScenarioNOP, setCenterScenarioNOP] = useState('missi')

  // Dynamically recompute games if alternate settlement rule or starting center is selected
  const games = useMemo(() => {
    if (!snapshot?.games) return []
    const rawList = snapshot.games.map((g) => {
      const rawHome = (g.homeTeam?.abbr || '').toUpperCase()
      const rawAway = (g.awayTeam?.abbr || '').toUpperCase()
      const homeAbbr = TEAM_ABBR_ALIASES[rawHome] || rawHome
      const awayAbbr = TEAM_ABBR_ALIASES[rawAway] || rawAway
      const isNOP = homeAbbr === 'NOP' || awayAbbr === 'NOP'

      const needsRescore = settlementRule !== SETTLEMENT_RULES.FIRST_FIELD_GOAL || (isNOP && centerScenarioNOP !== 'missi')
      if (!needsRescore) return g

      const homeStarters = (isNOP && homeAbbr === 'NOP')
        ? getStartersForTeam('NOP', { centerChoice: centerScenarioNOP })
        : (g.homePlayers || g.players?.filter((p) => p.isHome) || [])
      const awayStarters = (isNOP && awayAbbr === 'NOP')
        ? getStartersForTeam('NOP', { centerChoice: centerScenarioNOP })
        : (g.awayPlayers || g.players?.filter((p) => !p.isHome) || [])

      const homeCenter = homeStarters.find((p) => p.position === 'C') || homeStarters[0]
      const awayCenter = awayStarters.find((p) => p.position === 'C') || awayStarters[0]
      const jumpMatch = getJumpBallMatchup(homeAbbr, awayAbbr, homeCenter?.name, awayCenter?.name)

      return scoreGameFirstBasket({
        gameId: g.gameId,
        gameTime: g.gameTime,
        homeTeam: g.homeTeam,
        awayTeam: g.awayTeam,
        homePlayers: homeStarters,
        awayPlayers: awayStarters,
        homeJumper: jumpMatch.jumperA,
        awayJumper: jumpMatch.jumperB,
        marketOdds: g.marketOdds || (g.players || []).reduce((acc, p) => {
          if (p.books) acc[p.name?.toLowerCase()] = p.books
          else if (p.bookOdds) acc[p.name?.toLowerCase()] = p.bookOdds
          return acc
        }, {}),
        closingLines: g.closingLines || {},
        homeOppDefense: g.homeOppDefense || {},
        awayOppDefense: g.awayOppDefense || {},
        settlementRule,
        lineupStatus: g.lineupStatus,
        pace: g.pace,
      })
    })

    // Sort games chronologically by scheduled tip-off time
    return [...rawList].sort((a, b) => {
      const tA = Date.parse(a.date || a.gameTime || 0) || 0
      const tB = Date.parse(b.date || b.gameTime || 0) || 0
      return tA - tB
    })
  }, [snapshot, settlementRule, centerScenarioNOP])

  const players = useMemo(() => {
    const list = games.flatMap((g) => {
      // Sort starters within each game by first basket probability
      const gameStarters = [...g.players].sort((a, b) => (b.gameProb || 0) - (a.gameProb || 0))
      return gameStarters.map((p, rankInGame) => ({
        ...p,
        gameId: g.gameId,
        gameTime: g.gameTime,
        date: g.date,
        tipMatchup: g.tipMatchup,
        lineupStatus: g.lineupStatus,
        pace: g.pace,
        gamePickRank: rankInGame + 1,
        isTop3InGame: rankInGame < 3,
      }))
    })
    list.sort((a, b) => b.gameProb - a.gameProb)
    return list.map((p, idx) => ({ ...p, slateRank: idx + 1 }))
  }, [games])


  // Top Model Pick: player with highest combined score and positive EV edge
  const topPick = useMemo(() => {
    if (!players.length) return null
    return [...players].sort((a, b) => {
      const aVal = (a.gameProb || 0) * (1 + (a.edgePct > 0 ? a.edgePct / 100 : 0))
      const bVal = (b.gameProb || 0) * (1 + (b.edgePct > 0 ? b.edgePct / 100 : 0))
      return bVal - aVal
    })[0]
  }, [players])

  // Filtered Players
  const filteredPlayers = useMemo(() => {
    return players.filter((p) => {
      if (top3Only && !p.isTop3InGame) return false
      if (search) {
        const q = search.toLowerCase().trim()
        const matchName = p.name?.toLowerCase().includes(q)
        const matchTeam = p.team?.toLowerCase().includes(q)
        if (!matchName && !matchTeam) return false
      }
      if (selectedPos !== 'all' && p.position !== selectedPos) return false
      if (selectedGameId !== 'all' && p.gameId !== selectedGameId) return false
      if (valueFilter === 'ev' && (!p.edgePct || p.edgePct <= 0)) return false
      if (valueFilter === 'prime' && p.grade !== 'PRIME') return false
      if (valueFilter === 'longshot') {
        const oddsNum = parseInt(p.bookOdds?.replace('+', '') || p.fairGameOdds?.replace('+', ''), 10)
        if (oddsNum < 650) return false
      }
      return true
    })
  }, [players, top3Only, search, selectedPos, selectedGameId, valueFilter])

  // Toggle parlay slip leg
  const toggleSlipLeg = (player, e) => {
    e?.stopPropagation()
    setSlipLegs((prev) => {
      const exists = prev.some((l) => l.id === player.id)
      if (exists) return prev.filter((l) => l.id !== player.id)
      return [...prev, player]
    })
  }

  // Joint parlay math
  const parlayMath = useMemo(() => {
    if (slipLegs.length === 0) return { prob: 0, fairOdds: '+0', payout: 0, mult: 1 }

    // Multi-game joint probability (assumes independent games)
    const jointProb = slipLegs.reduce((acc, l) => acc * (l.gameProb || 0.1), 1)

    // Sportsbook multiplier from book odds
    const mult = slipLegs.reduce((acc, l) => {
      const num = parseInt(l.bookOdds?.replace('+', '') || l.fairGameOdds?.replace('+', ''), 10)
      const decimal = num > 0 ? (num / 100) + 1 : (100 / Math.abs(num)) + 1
      return acc * decimal
    }, 1)

    const fairAmerican = probToAmericanOdds(jointProb)
    const payout = Math.round(stake * mult * 100) / 100

    return {
      jointProb: Math.round(jointProb * 10000) / 100,
      fairAmerican,
      mult: Math.round(mult * 10) / 10,
      payout,
    }
  }, [slipLegs, stake])

  // Generated 2-Leg Parlay Combo Board
  const comboBoard = useMemo(() => {
    return generateTwoLegBoard(games)
  }, [games])

  // Filtered Combos for Bet Lab
  const displayedCombos = useMemo(() => {
    if (!comboBoard?.combos) return []
    if (comboStrategyFilter === 'all') return comboBoard.combos.slice(0, 12)
    return comboBoard.combos.filter((c) => c.tags.includes(comboStrategyFilter)).slice(0, 12)
  }, [comboBoard, comboStrategyFilter])

  // Live custom 2-leg parlay combo
  const liveCustomCombo = useMemo(() => {
    if (!customLegA || !customLegB || customLegA.gameId === customLegB.gameId) return null
    try {
      return buildTwoLegCombo(customLegA, customLegB)
    } catch {
      return null
    }
  }, [customLegA, customLegB])

  const loadComboIntoSlip = (combo) => {
    if (!combo?.legs) return
    setSlipLegs([...combo.legs])
  }

  const copySlipToClipboard = () => {
    if (slipLegs.length === 0) return
    const legTexts = slipLegs.map((l, i) => `${i + 1}. ${l.name} (${l.team}) - First Basket (${l.bookOdds || l.fairGameOdds})`).join('\n')
    const text = `🏀 StatFax NBA First Basket ${slipLegs.length}-Leg Parlay\n${legTexts}\n\n📊 Compounded Multiplier: ${parlayMath.mult}x | Joint Fair Prob: ${parlayMath.jointProb}% (${parlayMath.fairAmerican})\n💰 Wager: $${stake} -> Est. Payout: $${parlayMath.payout}`
    navigator.clipboard?.writeText(text)
    setCopiedSlip(true)
    setTimeout(() => setCopiedSlip(false), 2500)
  }

  return (
    <div className="nba-workspace">
      {/* Workspace Head */}
      <div className="nba-workspace-head">
        <div className="nba-title-group">
          <span className="nba-eyebrow">
            <Icon name="Activity" size={13} /> NBA First Basket Intelligence
          </span>
          <h1>First Basket Scorer</h1>
          <p>
            Opening tip-off jump ball models, scripted 1st-possession frequencies,
            shot proximity conversion, and de-vigged fair market value.
          </p>
        </div>

        <CommandTabs
          tabs={SPORT_UI.nba.primaryViews}
          value={view}
          onChange={setView}
          label="NBA View"
          variant="workspace"
        />
      </div>

      {/* Settlement Rules & Institutional Settlement Bar */}
      <div className="nba-settlement-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
          <div className="nba-settlement-toggle-group">
            <button
              type="button"
              className={`nba-settlement-btn ${settlementRule === SETTLEMENT_RULES.FIRST_FIELD_GOAL ? 'active' : ''}`}
              onClick={() => setSettlementRule(SETTLEMENT_RULES.FIRST_FIELD_GOAL)}
            >
              <Icon name="Target" size={13} /> DraftKings / FanDuel (1st FG Only)
            </button>
            <button
              type="button"
              className={`nba-settlement-btn ${settlementRule === SETTLEMENT_RULES.FIRST_POINT_SCORED ? 'active' : ''}`}
              onClick={() => setSettlementRule(SETTLEMENT_RULES.FIRST_POINT_SCORED)}
            >
              <Icon name="Zap" size={13} /> 1st Point Scored (FTs Count)
            </button>
          </div>

          <div className="nba-settlement-explainer">
            <Icon name="Info" size={14} style={{ color: '#38bdf8', flexShrink: 0 }} />
            {settlementRule === SETTLEMENT_RULES.FIRST_FIELD_GOAL ? (
              <span>
                <strong>DraftKings & FanDuel Standard:</strong> Made free throws do NOT cash the ticket. Bet remains live until the first made field goal (tip-ins/putbacks count).
              </span>
            ) : (
              <span>
                <strong>First Point Market:</strong> Made free throws count immediately. Foul magnets (Embiid, SGA, Giannis) receive an EV boost on drawn shooting fouls.
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span className="nba-chip-pill" style={{ background: 'rgba(52, 211, 153, 0.15)', borderColor: 'rgba(52, 211, 153, 0.3)', color: '#34d399' }}>
            <Icon name="CheckCircle" size={12} /> Starters Confirmed (~30m Pre-Tip)
          </span>
          <span className="nba-chip-pill" style={{ color: '#94a3b8' }}>
            Late Run Active
          </span>
        </div>
      </div>

      {/* Summary KPI Bar */}
      <div className="nba-summary-bar">
        <span className="nba-summary-item">
          <Icon name="Calendar" size={13} />
          <span>Games: <strong>{games.length}</strong></span>
        </span>
        <span className="nba-summary-divider" />
        <span className="nba-summary-item">
          <Icon name="Users" size={13} />
          <span>Starters Tracked: <strong>{players.filter((p) => p.isStarter).length}</strong></span>
        </span>
        <span className="nba-summary-divider" />
        <span className="nba-summary-item">
          <Icon name="Zap" size={13} />
          <span>Tip Conversion Advantage: <strong>64%</strong></span>
        </span>
        <span className="nba-summary-divider" />
        <span className="nba-summary-item">
          <Icon name="TrendingUp" size={13} />
          <span>+EV Edges Found: <strong>{players.filter((p) => p.edgePct > 0).length}</strong></span>
        </span>
      </div>

      {/* VIEW 1: SIGNALS BOARD */}
      {view === 'signals' && (
        <>
          {/* Top Hero Pick Callout */}
          {topPick && (
            <div className="nba-hero-pick" onClick={() => setInspectedPlayer(topPick)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div className="nba-hero-badge">
                  <Icon name="Crown" size={14} /> Top Model First Basket Call
                </div>
                {topPick.lineMovement && (
                  <span className={`nba-chip-pill ${topPick.lineMovement.movement?.includes('Steam') ? 'nba-steam-chip' : 'nba-drift-chip'}`}>
                    <Icon name="TrendingUp" size={12} /> Line: {topPick.lineMovement.opening} → {topPick.lineMovement.closing} ({topPick.lineMovement.movement})
                  </span>
                )}
              </div>

              <div className="nba-hero-content">
                <div className="nba-hero-left">
                  <div
                    className="nba-team-badge-circle"
                    style={{
                      width: 58,
                      height: 58,
                      borderColor: NBA_TEAM_COLORS[topPick.team] || 'rgba(255,255,255,0.2)',
                    }}
                  >
                    <img
                      src={`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${topPick.team.toLowerCase()}.png`}
                      alt={topPick.team}
                    />
                  </div>
                  <div>
                    <h2 className="nba-hero-player-name">{topPick.name}</h2>
                    <div className="nba-hero-player-meta">
                      <span>{topPick.team} · #{topPick.jersey || '—'} · {topPick.position}</span>
                      {topPick.opponent && <span>vs {topPick.opponent}</span>}
                      {topPick.method?.primary && (
                        <>
                          <span>·</span>
                          <span className="nba-method-tag">
                            <Icon name="Target" size={12} /> {topPick.method.primary}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="nba-hero-right">
                  <div className="nba-hero-stat-block">
                    <div className="nba-hero-stat-label">Model Prob</div>
                    <div className="nba-hero-stat-val" style={{ color: 'var(--prime, #00ffcc)' }}>
                      {(topPick.gameProb * 100).toFixed(1)}%
                    </div>
                  </div>

                  <div className="nba-hero-stat-block">
                    <div className="nba-hero-stat-label">Fair Odds</div>
                    <div className="nba-hero-stat-val">{topPick.fairGameOdds}</div>
                  </div>

                  {topPick.bookOdds && (
                    <div className="nba-hero-stat-block">
                      <div className="nba-hero-stat-label">Best Book</div>
                      <div className="nba-hero-stat-val" style={{ color: '#38bdf8' }}>
                        {topPick.bestBook ? `${topPick.bestBook.toUpperCase()} ` : ''}{topPick.bookOdds}
                      </div>
                    </div>
                  )}

                  {topPick.edgePct > 0 && (
                    <span className="nba-edge-badge" style={{ fontSize: '0.9rem', padding: '0.4rem 0.75rem' }}>
                      <Icon name="TrendingUp" size={14} /> +{topPick.edgePct}% Edge
                    </span>
                  )}

                  <button
                    type="button"
                    className={`nba-slip-add-btn ${slipLegs.some((l) => l.id === topPick.id) ? 'in-slip' : ''}`}
                    onClick={(e) => toggleSlipLeg(topPick, e)}
                    style={{ padding: '0.6rem 1.1rem', fontSize: '0.85rem' }}
                  >
                    <Icon name={slipLegs.some((l) => l.id === topPick.id) ? 'Check' : 'Plus'} size={14} />
                    {slipLegs.some((l) => l.id === topPick.id) ? 'In Parlay Slip' : 'Add to Parlay'}
                  </button>
                </div>
              </div>

              {/* Shot mix bar on hero */}
              {topPick.shotMix && (
                <div className="nba-shotmix-wrap" style={{ maxWidth: 420 }}>
                  <div className="nba-shotmix-bar">
                    <div className="nba-shotmix-seg-rim" style={{ width: `${topPick.shotMix.rim * 100}%` }} />
                    <div className="nba-shotmix-seg-mid" style={{ width: `${topPick.shotMix.mid * 100}%` }} />
                    <div className="nba-shotmix-seg-three" style={{ width: `${topPick.shotMix.three * 100}%` }} />
                  </div>
                  <div className="nba-shotmix-legend">
                    <span>Rim {(topPick.shotMix.rim * 100).toFixed(0)}% ({topPick.zoneFG?.rim || 70}% FG)</span>
                    <span>Mid {(topPick.shotMix.mid * 100).toFixed(0)}%</span>
                    <span>3PT {(topPick.shotMix.three * 100).toFixed(0)}% ({topPick.zoneFG?.three || 36}% FG)</span>
                  </div>
                </div>
              )}

              <div className="nba-hero-narrative">
                <strong>Opening Play Tendency:</strong> {topPick.scriptedSetPlay} (Early Shot Share: {(topPick.earlyShotShare * 100).toFixed(0)}% vs {(topPick.seasonUsage || 22)}% full game USG).
                <div style={{ marginTop: '0.35rem', color: '#94a3b8' }}>{topPick.eli5}</div>
              </div>
            </div>
          )}

          {/* Filter Bar */}
          <div className="nba-filter-bar">
            <div className="nba-filter-row-top">
              <div className="nba-search-wrap">
                <Icon name="Search" size={15} />
                <input
                  type="text"
                  placeholder="Search player or team..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="nba-search-input"
                />
              </div>

              <div className="nba-mode-toggle" role="group" aria-label="Market mode">
                <button
                  type="button"
                  className={`nba-mode-btn ${marketMode === 'game' ? 'active' : ''}`}
                  onClick={() => setMarketMode('game')}
                >
                  Game First Basket
                </button>
                <button
                  type="button"
                  className={`nba-mode-btn ${marketMode === 'team' ? 'active' : ''}`}
                  onClick={() => setMarketMode('team')}
                >
                  Team First Basket
                </button>
              </div>
            </div>

            <div className="nba-filter-row-bottom">
              <div className="nba-pills-group">
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>PICKS:</span>
                <button
                  type="button"
                  className={`nba-filter-pill ${top3Only ? 'active nba-top3-active-chip' : ''}`}
                  onClick={() => setTop3Only((v) => !v)}
                  title="Filter to Top 3 First Basket picks per game for less clutter"
                >
                  <Icon name="Zap" size={12} /> {top3Only ? '⚡ Top 3 Per Game (Clean)' : 'All Starters (10)'}
                </button>
                <button
                  type="button"
                  className={`nba-filter-pill ${groupByGame ? 'active' : ''}`}
                  onClick={() => setGroupByGame((v) => !v)}
                  title="Sort and group games chronologically by tip-off time"
                >
                  <Icon name="Clock" size={12} /> {groupByGame ? 'Sorted by Game & Time' : 'Flat Board'}
                </button>
              </div>

              <div className="nba-pills-group">
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>POSITION:</span>
                {['all', 'C', 'PF', 'SF', 'SG', 'PG'].map((pos) => (
                  <button
                    key={pos}
                    type="button"
                    className={`nba-filter-pill ${selectedPos === pos ? 'active' : ''}`}
                    onClick={() => setSelectedPos(pos)}
                  >
                    {pos.toUpperCase()}
                  </button>
                ))}
              </div>

              <div className="nba-pills-group">
                <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>FILTER:</span>
                <button
                  type="button"
                  className={`nba-filter-pill ${valueFilter === 'all' ? 'active' : ''}`}
                  onClick={() => setValueFilter('all')}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`nba-filter-pill ${valueFilter === 'ev' ? 'active' : ''}`}
                  onClick={() => setValueFilter('ev')}
                >
                  +EV Edges
                </button>
                <button
                  type="button"
                  className={`nba-filter-pill ${valueFilter === 'prime' ? 'active' : ''}`}
                  onClick={() => setValueFilter('prime')}
                >
                  💎 Prime
                </button>
                <button
                  type="button"
                  className={`nba-filter-pill ${valueFilter === 'longshot' ? 'active' : ''}`}
                  onClick={() => setValueFilter('longshot')}
                >
                  🎲 Longshots
                </button>
              </div>
            </div>
          </div>

          {/* Cards Display: Grouped & Sorted by Game & Time or Flat Slate */}
          {groupByGame ? (
            <div className="nba-game-sections">
              {games.map((g) => {
                const gamePlayers = filteredPlayers.filter((p) => p.gameId === g.gameId)
                if (gamePlayers.length === 0) return null

                return (
                  <section key={g.gameId} className="nba-game-section">
                    <div className="nba-game-section-header">
                      <div className="nba-game-matchup-title">
                        <div className="nba-game-team-logos">
                          {g.awayTeam?.logo && (
                            <img src={g.awayTeam.logo} alt={g.awayTeam.abbr} className="nba-game-team-logo" />
                          )}
                          {g.homeTeam?.logo && (
                            <img src={g.homeTeam.logo} alt={g.homeTeam.abbr} className="nba-game-team-logo" />
                          )}
                        </div>
                        <div className="nba-game-names-wrap">
                          <h2 className="nba-game-matchup-heading">
                            {g.awayTeam?.abbr} @ {g.homeTeam?.abbr}
                          </h2>
                          <span className="nba-game-time-badge">
                            <Icon name="Clock" size={12} /> {g.gameTime || '8:00 PM ET'}
                          </span>
                        </div>
                      </div>

                      <div className="nba-game-meta-group">
                        {(g.homeTeam?.abbr === 'NOP' || g.homeTeam?.abbr === 'NO' || g.awayTeam?.abbr === 'NOP' || g.awayTeam?.abbr === 'NO') && (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              background: 'rgba(255, 255, 255, 0.05)',
                              padding: '0.2rem 0.5rem',
                              borderRadius: '6px',
                              border: '1px solid rgba(255, 255, 255, 0.1)',
                            }}
                          >
                            <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>NOP Center:</span>
                            <button
                              type="button"
                              onClick={() => setCenterScenarioNOP('queen')}
                              style={{
                                background: centerScenarioNOP === 'queen' ? 'rgba(0, 255, 204, 0.2)' : 'transparent',
                                color: centerScenarioNOP === 'queen' ? 'var(--prime)' : '#94a3b8',
                                border: centerScenarioNOP === 'queen' ? '1px solid var(--prime)' : '1px solid transparent',
                                borderRadius: '4px',
                                padding: '0.1rem 0.4rem',
                                fontSize: '0.68rem',
                                cursor: 'pointer',
                                fontWeight: centerScenarioNOP === 'queen' ? 700 : 500,
                              }}
                              title="Derik Queen starts at center for New Orleans"
                            >
                              Queen (Starter)
                            </button>
                            <button
                              type="button"
                              onClick={() => setCenterScenarioNOP('missi')}
                              style={{
                                background: centerScenarioNOP === 'missi' ? 'rgba(0, 255, 204, 0.2)' : 'transparent',
                                color: centerScenarioNOP === 'missi' ? 'var(--prime)' : '#94a3b8',
                                border: centerScenarioNOP === 'missi' ? '1px solid var(--prime)' : '1px solid transparent',
                                borderRadius: '4px',
                                padding: '0.1rem 0.4rem',
                                fontSize: '0.68rem',
                                cursor: 'pointer',
                                fontWeight: centerScenarioNOP === 'missi' ? 700 : 500,
                              }}
                              title="Yves Missi active (Day-to-Day knee bruise)"
                            >
                              Missi (Day-to-Day)
                            </button>
                            <button
                              type="button"
                              onClick={() => setCenterScenarioNOP('jordan')}
                              style={{
                                background: centerScenarioNOP === 'jordan' ? 'rgba(0, 255, 204, 0.2)' : 'transparent',
                                color: centerScenarioNOP === 'jordan' ? 'var(--prime)' : '#94a3b8',
                                border: centerScenarioNOP === 'jordan' ? '1px solid var(--prime)' : '1px solid transparent',
                                borderRadius: '4px',
                                padding: '0.1rem 0.4rem',
                                fontSize: '0.68rem',
                                cursor: 'pointer',
                                fontWeight: centerScenarioNOP === 'jordan' ? 700 : 500,
                              }}
                              title="DeAndre Jordan veteran reserve option"
                            >
                              Jordan (Reserve)
                            </button>
                          </div>
                        )}

                        {g.tipMatchup && (
                          <div className="nba-jump-pill" title="Jump ball edge & standing reach differential">
                            <Icon name="Activity" size={13} style={{ color: 'var(--prime)' }} />
                            <span>
                              Tip: <strong>{g.tipMatchup.jumperA?.jumper || g.homeTeam?.abbr}</strong> ({(g.tipMatchup.tipProbA * 100).toFixed(0)}%) vs <strong>{g.tipMatchup.jumperB?.jumper || g.awayTeam?.abbr}</strong> ({(g.tipMatchup.tipProbB * 100).toFixed(0)}%)
                              {g.tipMatchup.reachDiffInches !== 0 ? (
                                <span style={{ color: '#38bdf8', marginLeft: '0.35rem', fontWeight: 600 }}>
                                  {g.tipMatchup.reachDiffInches > 0
                                    ? `+${g.tipMatchup.reachDiffInches}" Reach (${g.tipMatchup.jumperA?.jumper?.split(' ')[1] || 'Home'})`
                                    : `+${Math.abs(g.tipMatchup.reachDiffInches)}" Reach (${g.tipMatchup.jumperB?.jumper?.split(' ')[1] || 'Away'})`}
                                </span>
                              ) : (
                                <span style={{ color: '#94a3b8', marginLeft: '0.35rem' }}>Even reach</span>
                              )}
                            </span>
                          </div>
                        )}
                        <span className="nba-chip-pill" style={{ color: '#94a3b8' }}>
                          Pace {g.pace || 100}
                        </span>
                        <span className="nba-chip-pill" style={{ background: 'rgba(0, 255, 204, 0.1)', color: 'var(--prime)', borderColor: 'rgba(0, 255, 204, 0.25)' }}>
                          {top3Only ? 'Top 3 Picks' : `${gamePlayers.length} Starters`}
                        </span>
                      </div>
                    </div>

                    <div className="nba-cards-grid">
                      {gamePlayers.map((player) => {
                        const displayProb = marketMode === 'game' ? player.gameProb : player.teamProb
                        const displayOdds = marketMode === 'game' ? player.fairGameOdds : player.fairTeamOdds
                        const inSlip = slipLegs.some((l) => l.id === player.id)
                        const teamColor = NBA_TEAM_COLORS[player.team] || '#9795cb'

                        return (
                          <div
                            key={player.id}
                            className="nba-card"
                            onClick={() => setInspectedPlayer(player)}
                            style={{ borderTop: `3px solid ${teamColor}`, position: 'relative' }}
                          >
                            <div>
                              <div className="nba-card-top">
                                <div className="nba-card-player-info">
                                  <div className="nba-team-badge-circle">
                                    <img
                                      src={`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${player.team.toLowerCase()}.png`}
                                      alt={player.team}
                                    />
                                  </div>
                                  <div>
                                    <h3 className="nba-card-player-name">{player.name}</h3>
                                    <div className="nba-card-player-sub">
                                      <span>{player.team} · #{player.jersey || '—'} · {player.position}</span>
                                      {player.opponent && <span>vs {player.opponent}</span>}
                                    </div>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                                  <span className={`nba-game-rank-badge nba-rank-${player.gamePickRank <= 3 ? player.gamePickRank : 'other'}`}>
                                    {player.gamePickRank === 1 ? '🏆 #1 Game Pick' : player.gamePickRank === 2 ? '⚡ #2 Game Pick' : player.gamePickRank === 3 ? '👀 #3 Game Pick' : `#${player.gamePickRank}`}
                                  </span>
                                  <span
                                    style={{
                                      fontSize: '0.68rem',
                                      fontWeight: 800,
                                      padding: '0.15rem 0.45rem',
                                      borderRadius: '5px',
                                      background:
                                        player.grade === 'PRIME'
                                          ? 'rgba(0, 255, 204, 0.15)'
                                          : player.grade === 'STRONG'
                                          ? 'rgba(234, 179, 8, 0.15)'
                                          : 'rgba(255, 255, 255, 0.08)',
                                      color:
                                        player.grade === 'PRIME'
                                          ? 'var(--prime, #00ffcc)'
                                          : player.grade === 'STRONG'
                                          ? '#fde047'
                                          : '#cbd5e1',
                                    }}
                                  >
                                    {player.grade === 'PRIME' ? '💎 PRIME' : player.grade === 'STRONG' ? '⚡ STRONG' : '👀 VALUE'}
                                  </span>
                                </div>
                              </div>

                              <div className="nba-card-metrics">
                                <div>
                                  <div className="nba-card-metric-label">
                                    {marketMode === 'game' ? 'Game Prob' : 'Team Prob'}
                                  </div>
                                  <div
                                    className="nba-card-metric-val"
                                    style={{ color: player.grade === 'PRIME' ? 'var(--prime)' : '#f8fafc' }}
                                  >
                                    {(displayProb * 100).toFixed(1)}%
                                  </div>
                                  {player.ci90 && (
                                    <div style={{ fontSize: '0.66rem', color: '#94a3b8', marginTop: '0.15rem', whiteSpace: 'nowrap' }}>
                                      90% CI: {player.ci90.lower}%–{player.ci90.upper}%
                                    </div>
                                  )}
                                </div>

                                <div>
                                  <div className="nba-card-metric-label">Fair Odds</div>
                                  <div className="nba-card-metric-val">{displayOdds}</div>
                                </div>

                                <div>
                                  <div className="nba-card-metric-label">Sportsbook</div>
                                  <div className="nba-card-metric-val" style={{ color: '#38bdf8' }}>
                                    {player.bookOdds || '—'}
                                  </div>
                                </div>
                              </div>

                              {/* Scripted set & Early shot share chip */}
                              <div style={{ margin: '0.4rem 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                                <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Script: </span>
                                <span>{player.scriptedSetPlay}</span>
                                <span style={{ margin: '0 0.35rem', color: '#64748b' }}>·</span>
                                <span style={{ color: '#38bdf8' }}>{(player.earlyShotShare * 100).toFixed(0)}% early look</span>
                              </div>

                              {/* Shot Mix Mini Bar */}
                              {player.shotMix && (
                                <div className="nba-shotmix-wrap">
                                  <div className="nba-shotmix-bar">
                                    <div className="nba-shotmix-seg-rim" style={{ width: `${player.shotMix.rim * 100}%` }} />
                                    <div className="nba-shotmix-seg-mid" style={{ width: `${player.shotMix.mid * 100}%` }} />
                                    <div className="nba-shotmix-seg-three" style={{ width: `${player.shotMix.three * 100}%` }} />
                                  </div>
                                  <div className="nba-shotmix-legend">
                                    <span>Rim {(player.shotMix.rim * 100).toFixed(0)}%</span>
                                    <span>Mid {(player.shotMix.mid * 100).toFixed(0)}%</span>
                                    <span>3PT {(player.shotMix.three * 100).toFixed(0)}%</span>
                                  </div>
                                </div>
                              )}

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem', marginTop: '0.4rem' }}>
                                {player.edgePct > 0 && (
                                  <span className="nba-edge-badge">
                                    <Icon name="TrendingUp" size={12} /> +{player.edgePct}% Edge
                                  </span>
                                )}
                                {player.kellyUnits > 0 && (
                                  <span className="nba-kelly-badge">
                                    <Icon name="Shield" size={12} /> {player.kellyUnits}u Kelly
                                  </span>
                                )}
                                <span className="nba-method-tag">
                                  <Icon name="Target" size={12} /> {player.method?.primary}
                                </span>
                                {player.lineMovement?.movement && player.lineMovement.movement !== 'Flat' && player.lineMovement.movement !== '0' && (
                                  <span className={`nba-chip-pill ${player.lineMovement.movement.includes('Steam') ? 'nba-steam-chip' : 'nba-drift-chip'}`}>
                                    {player.lineMovement.movement}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="nba-card-footer">
                              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                {player.jumper?.tipProb != null
                                  ? `${(player.jumper.tipProb * 100).toFixed(0)}% Tip Win`
                                  : (player.teamScoresFirstProb > 0.505
                                      ? `${(player.teamScoresFirstProb * 100).toFixed(0)}% 1st Poss`
                                      : player.teamScoresFirstProb < 0.495
                                        ? `${(player.teamScoresFirstProb * 100).toFixed(0)}% 1st Poss`
                                        : '50/50 Poss')}
                              </span>

                              <button
                                type="button"
                                className={`nba-slip-add-btn ${inSlip ? 'in-slip' : ''}`}
                                onClick={(e) => toggleSlipLeg(player, e)}
                              >
                                <Icon name={inSlip ? 'Check' : 'Plus'} size={13} />
                                {inSlip ? 'Added' : 'Parlay'}
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )
              })}
            </div>
          ) : (
            <div className="nba-cards-grid">
              {filteredPlayers.map((player) => {
                const displayProb = marketMode === 'game' ? player.gameProb : player.teamProb
                const displayOdds = marketMode === 'game' ? player.fairGameOdds : player.fairTeamOdds
                const inSlip = slipLegs.some((l) => l.id === player.id)
                const teamColor = NBA_TEAM_COLORS[player.team] || '#9795cb'

                return (
                  <div
                    key={player.id}
                    className="nba-card"
                    onClick={() => setInspectedPlayer(player)}
                    style={{ borderTop: `3px solid ${teamColor}`, position: 'relative' }}
                  >
                    <div>
                      <div className="nba-card-top">
                        <div className="nba-card-player-info">
                          <div className="nba-team-badge-circle">
                            <img
                              src={`https://a.espncdn.com/i/teamlogos/nba/500/scoreboard/${player.team.toLowerCase()}.png`}
                              alt={player.team}
                            />
                          </div>
                          <div>
                            <h3 className="nba-card-player-name">{player.name}</h3>
                            <div className="nba-card-player-sub">
                              <span>{player.team} · #{player.jersey || '—'} · {player.position}</span>
                              <span>vs {player.opponent}</span>
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
                          <span className={`nba-game-rank-badge nba-rank-${player.gamePickRank <= 3 ? player.gamePickRank : 'other'}`}>
                            {player.gamePickRank === 1 ? '🏆 #1 Game Pick' : player.gamePickRank === 2 ? '⚡ #2 Game Pick' : player.gamePickRank === 3 ? '👀 #3 Game Pick' : `#${player.gamePickRank}`}
                          </span>
                          <span
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              padding: '0.15rem 0.45rem',
                              borderRadius: '5px',
                              background:
                                player.grade === 'PRIME'
                                  ? 'rgba(0, 255, 204, 0.15)'
                                  : player.grade === 'STRONG'
                                  ? 'rgba(234, 179, 8, 0.15)'
                                  : 'rgba(255, 255, 255, 0.08)',
                              color:
                                player.grade === 'PRIME'
                                  ? 'var(--prime, #00ffcc)'
                                  : player.grade === 'STRONG'
                                  ? '#fde047'
                                  : '#cbd5e1',
                            }}
                          >
                            {player.grade === 'PRIME' ? '💎 PRIME' : player.grade === 'STRONG' ? '⚡ STRONG' : '👀 VALUE'}
                          </span>
                        </div>
                      </div>

                      <div className="nba-card-metrics">
                        <div>
                          <div className="nba-card-metric-label">
                            {marketMode === 'game' ? 'Game Prob' : 'Team Prob'}
                          </div>
                          <div
                            className="nba-card-metric-val"
                            style={{ color: player.grade === 'PRIME' ? 'var(--prime)' : '#f8fafc' }}
                          >
                            {(displayProb * 100).toFixed(1)}%
                          </div>
                        </div>

                        <div>
                          <div className="nba-card-metric-label">Fair Odds</div>
                          <div className="nba-card-metric-val">{displayOdds}</div>
                        </div>

                        <div>
                          <div className="nba-card-metric-label">Sportsbook</div>
                          <div className="nba-card-metric-val" style={{ color: '#38bdf8' }}>
                            {player.bookOdds || '—'}
                          </div>
                        </div>
                      </div>

                      {/* Scripted set & Early shot share chip */}
                      <div style={{ margin: '0.4rem 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Script: </span>
                        <span>{player.scriptedSetPlay}</span>
                        <span style={{ margin: '0 0.35rem', color: '#64748b' }}>·</span>
                        <span style={{ color: '#38bdf8' }}>{(player.earlyShotShare * 100).toFixed(0)}% early look</span>
                      </div>

                      {/* Shot Mix Mini Bar */}
                      {player.shotMix && (
                        <div className="nba-shotmix-wrap">
                          <div className="nba-shotmix-bar">
                            <div className="nba-shotmix-seg-rim" style={{ width: `${player.shotMix.rim * 100}%` }} />
                            <div className="nba-shotmix-seg-mid" style={{ width: `${player.shotMix.mid * 100}%` }} />
                            <div className="nba-shotmix-seg-three" style={{ width: `${player.shotMix.three * 100}%` }} />
                          </div>
                          <div className="nba-shotmix-legend">
                            <span>Rim {(player.shotMix.rim * 100).toFixed(0)}%</span>
                            <span>Mid {(player.shotMix.mid * 100).toFixed(0)}%</span>
                            <span>3PT {(player.shotMix.three * 100).toFixed(0)}%</span>
                          </div>
                        </div>
                      )}

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.6rem', marginTop: '0.4rem' }}>
                        {player.edgePct > 0 && (
                          <span className="nba-edge-badge">
                            <Icon name="TrendingUp" size={12} /> +{player.edgePct}% Edge
                          </span>
                        )}
                        {player.kellyUnits > 0 && (
                          <span className="nba-kelly-badge">
                            <Icon name="Shield" size={12} /> {player.kellyUnits}u Kelly
                          </span>
                        )}
                        <span className="nba-method-tag">
                          <Icon name="Target" size={12} /> {player.method?.primary}
                        </span>
                        {player.lineMovement?.movement && player.lineMovement.movement !== 'Flat' && player.lineMovement.movement !== '0' && (
                          <span className={`nba-chip-pill ${player.lineMovement.movement.includes('Steam') ? 'nba-steam-chip' : 'nba-drift-chip'}`}>
                            {player.lineMovement.movement}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="nba-card-footer">
                      <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                        {player.jumper?.tipProb != null
                          ? `${(player.jumper.tipProb * 100).toFixed(0)}% Tip Win`
                          : (player.teamScoresFirstProb > 0.505
                              ? `${(player.teamScoresFirstProb * 100).toFixed(0)}% 1st Poss`
                              : player.teamScoresFirstProb < 0.495
                                ? `${(player.teamScoresFirstProb * 100).toFixed(0)}% 1st Poss`
                                : '50/50 Poss')}
                      </span>

                      <button
                        type="button"
                        className={`nba-slip-add-btn ${inSlip ? 'in-slip' : ''}`}
                        onClick={(e) => toggleSlipLeg(player, e)}
                      >
                        <Icon name={inSlip ? 'Check' : 'Plus'} size={13} />
                        {inSlip ? 'Added' : 'Parlay'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* VIEW 2: JUMP BALL MATCHUPS */}
      {view === 'matchups' && (
        <div className="nba-matchups-list">
          {games.map((g) => {
            const tip = g.tipMatchup
            const homeAdvantage = tip?.homeScoresFirstProb >= 0.55
            const awayAdvantage = tip?.awayScoresFirstProb >= 0.55

            return (
              <div key={g.gameId} className="nba-matchup-card">
                <div className="nba-matchup-header">
                  <div className="nba-matchup-teams-title">
                    <span>{g.awayTeam.abbr}</span>
                    <span style={{ color: '#64748b', fontSize: '0.9rem' }}>@</span>
                    <span>{g.homeTeam.abbr}</span>
                    <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>
                      · {g.gameTime}
                    </span>
                  </div>

                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      color: homeAdvantage || awayAdvantage ? '#34d399' : '#94a3b8',
                      background: 'rgba(255,255,255,0.05)',
                      padding: '0.3rem 0.65rem',
                      borderRadius: '8px',
                    }}
                  >
                    <Icon name="Zap" size={13} /> {tip.favorite} First Possession Edge ({tip.edgePct}%)
                  </span>
                </div>

                {/* Jump Ball Radar Arena */}
                <div className="nba-tip-battle-arena">
                  {/* Away Jumper */}
                  <div className="nba-tip-jumper-side is-away">
                    <div
                      className="nba-team-badge-circle"
                      style={{ borderColor: NBA_TEAM_COLORS[g.awayTeam.abbr] }}
                    >
                      <img src={g.awayTeam.logo} alt={g.awayTeam.abbr} />
                    </div>
                    <div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffffff' }}>
                        {tip.awayJumper}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        {g.awayTeam.abbr} · Tips: {tip.jumperB?.tipWins || 0}/{tip.jumperB?.tipAttempts || 0} ({(tip.jumperB?.winPct * 100).toFixed(0)}%)
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                        Reach: {tip.jumperB?.standingReachInches || 110}" · Elo: {tip.jumperB?.rating || 1500} · {tip.jumperB?.sampleTier || 'High Sample'}
                      </div>
                    </div>
                  </div>

                  {/* Center Circle Gauge */}
                  <div className="nba-tip-circle-gauge">
                    <Icon name="Activity" size={20} style={{ color: 'var(--accent, #9795cb)' }} />
                    <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#94a3b8', marginTop: 2 }}>
                      OPENING TIP
                    </span>
                    <span style={{ fontSize: '1rem', fontWeight: 800, fontFamily: 'monospace', color: '#ffffff' }}>
                      {(tip.awayTipProb * 100).toFixed(0)}% / {(tip.homeTipProb * 100).toFixed(0)}%
                    </span>
                    <span style={{ fontSize: '0.7rem', color: '#38bdf8', fontWeight: 700, marginTop: 2 }}>
                      {tip.reachDiffInches !== 0
                        ? `${tip.reachDiffInches > 0 ? `+${tip.reachDiffInches}"` : `${tip.reachDiffInches}"`} Reach Diff`
                        : 'Equal Reach'}
                    </span>
                  </div>

                  {/* Home Jumper */}
                  <div className="nba-tip-jumper-side">
                    <div
                      className="nba-team-badge-circle"
                      style={{ borderColor: NBA_TEAM_COLORS[g.homeTeam.abbr] }}
                    >
                      <img src={g.homeTeam.logo} alt={g.homeTeam.abbr} />
                    </div>
                    <div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#ffffff' }}>
                        {tip.homeJumper}
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        {g.homeTeam.abbr} · Tips: {tip.jumperA?.tipWins || 0}/{tip.jumperA?.tipAttempts || 0} ({(tip.jumperA?.winPct * 100).toFixed(0)}%)
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>
                        Reach: {tip.jumperA?.standingReachInches || 110}" · Elo: {tip.jumperA?.rating || 1500} · {tip.jumperA?.sampleTier || 'High Sample'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Split Bar */}
                <div>
                  <div className="nba-tip-split-bar">
                    <div
                      style={{
                        width: `${tip.awayTipProb * 100}%`,
                        background: NBA_TEAM_COLORS[g.awayTeam.abbr] || '#64748b',
                      }}
                    />
                    <div
                      style={{
                        width: `${tip.homeTipProb * 100}%`,
                        background: NBA_TEAM_COLORS[g.homeTeam.abbr] || '#007ac1',
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                    <span>{g.awayTeam.abbr} scores first: <strong>{(tip.awayScoresFirstProb * 100).toFixed(1)}%</strong></span>
                    <span>{g.homeTeam.abbr} scores first: <strong>{(tip.homeScoresFirstProb * 100).toFixed(1)}%</strong></span>
                  </div>
                </div>

                {/* Starters Side-by-Side */}
                <div className="nba-matchup-starters-grid">
                  <div className="nba-starters-column">
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.2rem' }}>
                      {g.awayTeam.name} Starting 5
                    </div>
                    {g.players
                      .filter((p) => !p.isHome && p.isStarter)
                      .slice(0, 5)
                      .map((p) => (
                        <div
                          key={p.id}
                          className="nba-starter-row"
                          onClick={() => setInspectedPlayer(p)}
                          style={{ cursor: 'pointer' }}
                        >
                          <span>
                            <strong>{p.name}</strong> ({p.position})
                          </span>
                          <span className="mono" style={{ color: 'var(--prime, #00ffcc)', fontWeight: 700 }}>
                            {(p.gameProb * 100).toFixed(1)}% ({p.fairGameOdds})
                          </span>
                        </div>
                      ))}
                  </div>

                  <div className="nba-starters-column">
                    <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '0.2rem' }}>
                      {g.homeTeam.name} Starting 5
                    </div>
                    {g.players
                      .filter((p) => p.isHome && p.isStarter)
                      .slice(0, 5)
                      .map((p) => (
                        <div
                          key={p.id}
                          className="nba-starter-row"
                          onClick={() => setInspectedPlayer(p)}
                          style={{ cursor: 'pointer' }}
                        >
                          <span>
                            <strong>{p.name}</strong> ({p.position})
                          </span>
                          <span className="mono" style={{ color: 'var(--prime, #00ffcc)', fontWeight: 700 }}>
                            {(p.gameProb * 100).toFixed(1)}% ({p.fairGameOdds})
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* VIEW 3: BET LAB (2-LEG PARLAY BUILDER & INSTITUTIONAL COMBOS) */}
      {view === 'bet-lab' && (
        <div className="nba-betlab-wrap">
          {/* Main selection area */}
          <div>
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <span className="nba-eyebrow">
                  <Icon name="Beaker" size={13} /> Institutional Doubles & Cross-Game Combos
                </span>
                <span className="nba-chip-pill" style={{ color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)' }}>
                  {comboBoard.gamePairsCount} Cross-Game Pairs Available
                </span>
              </div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ffffff', margin: '0 0 0.4rem' }}>
                First Basket Bet Lab · 2-Leg Parlays
              </h2>
              <p style={{ fontSize: '0.88rem', color: '#94a3b8', margin: 0 }}>
                Cross-game First Basket doubles modeled with independent joint probability ($P_1 \times P_2$),
                compounded sportsbook payouts (+3000 to +6000), EV edge, and Quarter-Kelly bankroll allocation.
              </p>
            </div>

            {/* Sub-view navigation: Curated Recipes vs Custom Builder */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.85rem' }}>
              <button
                type="button"
                className={`nba-settlement-btn ${betLabSubView === 'recipes' ? 'active' : ''}`}
                onClick={() => setBetLabSubView('recipes')}
              >
                <Icon name="Layers" size={14} /> Curated 2-Leg Recipes ({comboBoard.totalAvailable})
              </button>
              <button
                type="button"
                className={`nba-settlement-btn ${betLabSubView === 'builder' ? 'active' : ''}`}
                onClick={() => setBetLabSubView('builder')}
              >
                <Icon name="Sparkles" size={14} /> Custom 2-Leg Builder
              </button>
            </div>

            {/* SUB-VIEW 1: CURATED RECIPES */}
            {betLabSubView === 'recipes' && (
              <div>
                {/* Strategy Filters */}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                  <button
                    type="button"
                    className={`nba-filter-pill ${comboStrategyFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setComboStrategyFilter('all')}
                  >
                    All Recipes ({comboBoard.totalAvailable})
                  </button>
                  {NBA_COMBO_STRATEGIES.map((strat) => {
                    const count = comboBoard.combos.filter((c) => c.tags.includes(strat.id)).length
                    return (
                      <button
                        key={strat.id}
                        type="button"
                        className={`nba-filter-pill ${comboStrategyFilter === strat.id ? 'active' : ''}`}
                        onClick={() => setComboStrategyFilter(strat.id)}
                      >
                        <Icon name={strat.icon} size={13} /> {strat.label} ({count})
                      </button>
                    )
                  })}
                </div>

                {/* Combos Grid */}
                <div className="nba-combo-recipes-grid">
                  {displayedCombos.map((combo, idx) => {
                    const isAdded = combo.legs.every((l) => slipLegs.some((sl) => sl.id === l.id))
                    const stratMeta = NBA_COMBO_STRATEGIES.find((s) => combo.tags.includes(s.id)) || NBA_COMBO_STRATEGIES[0]
                    const accentColor = combo.grade === 'PRIME' ? 'var(--prime)' : combo.grade === 'STRONG' ? '#38bdf8' : '#34d399'

                    return (
                      <article
                        key={combo.id}
                        className="nba-combo-card"
                        style={{ '--nba-combo-accent': accentColor }}
                      >
                        <header className="nba-combo-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className="nba-combo-rank-badge">#{idx + 1}</span>
                            <span className={`nba-combo-strat-badge is-${stratMeta.riskTone}`}>
                              <Icon name={stratMeta.icon} size={12} /> {stratMeta.label}
                            </span>
                          </div>
                          <span className="nba-combo-grade-tag" style={{ color: accentColor }}>
                            BUILD {combo.grade} · {combo.score}
                          </span>
                        </header>

                        {/* Legs breakdown */}
                        <div className="nba-combo-legs-wrap">
                          {combo.legs.map((leg, legIdx) => (
                            <div key={leg.id} className="nba-combo-leg-row">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                <span className="nba-combo-leg-num">LEG {legIdx + 1}</span>
                                <div>
                                  <div style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.92rem' }}>
                                    {leg.name}
                                  </div>
                                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                                    {leg.team} vs {leg.opponent} · {leg.position} · {leg.scriptedSetPlay || 'Opening Set'}
                                  </div>
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div className="mono" style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.92rem' }}>
                                  {(leg.gameProb * 100).toFixed(1)}%
                                </div>
                                <div className="mono" style={{ fontSize: '0.78rem', color: '#38bdf8', fontWeight: 700 }}>
                                  {leg.bookOdds || leg.fairGameOdds}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Metrics 4-Box */}
                        <div className="nba-combo-metrics-grid">
                          <div>
                            <small>Joint Prob</small>
                            <strong style={{ color: accentColor }}>{combo.jointProbPct}%</strong>
                          </div>
                          <div>
                            <small>Parlay Price</small>
                            <strong style={{ color: '#38bdf8' }}>{combo.compoundedAmerican}</strong>
                          </div>
                          <div>
                            <small>Model Fair</small>
                            <strong style={{ color: '#94a3b8' }}>{combo.fairAmerican}</strong>
                          </div>
                          <div>
                            <small>Kelly Size</small>
                            <strong style={{ color: '#34d399' }}>{combo.kellyUnits}u</strong>
                          </div>
                        </div>

                        <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0, lineHeight: 1.4, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Icon name="Sparkles" size={13} style={{ color: accentColor, flexShrink: 0 }} />
                          {combo.rationale}
                        </p>

                        <footer style={{ marginTop: 'auto', paddingTop: '0.5rem' }}>
                          <button
                            type="button"
                            className={`nba-parlay-add-btn ${isAdded ? 'active' : ''}`}
                            onClick={() => loadComboIntoSlip(combo)}
                            style={{
                              width: '100%',
                              padding: '0.65rem 1rem',
                              borderRadius: '8px',
                              border: isAdded ? '1px solid #34d399' : '1px solid rgba(255, 255, 255, 0.1)',
                              background: isAdded ? 'rgba(52, 211, 153, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                              color: isAdded ? '#34d399' : '#ffffff',
                              fontWeight: 700,
                              fontSize: '0.82rem',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.5rem',
                              transition: 'all 0.15s ease',
                            }}
                          >
                            <Icon name={isAdded ? 'Check' : 'Plus'} size={14} />
                            {isAdded ? '2-Leg Parlay in Slip' : `Load ${combo.compoundedAmerican} 2-Leg Parlay`}
                          </button>
                        </footer>
                      </article>
                    )
                  })}
                </div>
              </div>
            )}

            {/* SUB-VIEW 2: CUSTOM 2-LEG BUILDER */}
            {betLabSubView === 'builder' && (
              <div>
                <div style={{ padding: '0.85rem 1.15rem', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '12px', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                  <Icon name="Info" size={16} style={{ color: '#38bdf8', flexShrink: 0 }} />
                  <span style={{ fontSize: '0.84rem', color: '#e2e8f0' }}>
                    <strong>Cross-Game Exclusivity:</strong> Select one starter from Game 1 and one starter from Game 2. Same-game First Baskets are mutually exclusive because only one player can score the opening basket in a single game.
                  </span>
                </div>

                {/* 2-Column Game Picker */}
                <div className="nba-custom-builder-arena">
                  {/* Leg 1 Column */}
                  <div className="nba-builder-column">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.65rem' }}>
                      <span style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.95rem' }}>
                        1. Select Leg 1 (Game A)
                      </span>
                      {customLegA && (
                        <span className="nba-chip-pill" style={{ color: '#34d399', borderColor: '#34d399' }}>
                          {customLegA.name} ({customLegA.team})
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '420px', overflowY: 'auto' }}>
                      {players.filter((p) => p.isStarter).map((p) => {
                        const isSelected = customLegA?.id === p.id
                        const isSameGameAsB = customLegB && customLegB.gameId === p.gameId
                        return (
                          <div
                            key={`legA_${p.id}`}
                            className={`nba-starter-row ${isSelected ? 'active' : ''}`}
                            onClick={() => !isSameGameAsB && setCustomLegA(p)}
                            style={{
                              cursor: isSameGameAsB ? 'not-allowed' : 'pointer',
                              opacity: isSameGameAsB ? 0.35 : 1,
                              border: isSelected ? '1px solid var(--prime)' : '1px solid rgba(255,255,255,0.06)',
                              background: isSelected ? 'rgba(151, 149, 203, 0.2)' : 'rgba(30, 41, 59, 0.35)',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 700, color: '#ffffff' }}>{p.name}</div>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                {p.team} vs {p.opponent} · {p.position}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div className="mono" style={{ fontWeight: 700, color: '#ffffff' }}>
                                {(p.gameProb * 100).toFixed(1)}%
                              </div>
                              <div className="mono" style={{ fontSize: '0.75rem', color: '#38bdf8' }}>
                                {p.bookOdds || p.fairGameOdds}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Leg 2 Column */}
                  <div className="nba-builder-column">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', paddingBottom: '0.65rem' }}>
                      <span style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.95rem' }}>
                        2. Select Leg 2 (Game B)
                      </span>
                      {customLegB && (
                        <span className="nba-chip-pill" style={{ color: '#34d399', borderColor: '#34d399' }}>
                          {customLegB.name} ({customLegB.team})
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '420px', overflowY: 'auto' }}>
                      {players.filter((p) => p.isStarter).map((p) => {
                        const isSelected = customLegB?.id === p.id
                        const isSameGameAsA = customLegA && customLegA.gameId === p.gameId
                        return (
                          <div
                            key={`legB_${p.id}`}
                            className={`nba-starter-row ${isSelected ? 'active' : ''}`}
                            onClick={() => !isSameGameAsA && setCustomLegB(p)}
                            style={{
                              cursor: isSameGameAsA ? 'not-allowed' : 'pointer',
                              opacity: isSameGameAsA ? 0.35 : 1,
                              border: isSelected ? '1px solid var(--prime)' : '1px solid rgba(255,255,255,0.06)',
                              background: isSelected ? 'rgba(151, 149, 203, 0.2)' : 'rgba(30, 41, 59, 0.35)',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 700, color: '#ffffff' }}>{p.name}</div>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                {p.team} vs {p.opponent} · {p.position}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div className="mono" style={{ fontWeight: 700, color: '#ffffff' }}>
                                {(p.gameProb * 100).toFixed(1)}%
                              </div>
                              <div className="mono" style={{ fontSize: '0.75rem', color: '#38bdf8' }}>
                                {p.bookOdds || p.fairGameOdds}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {/* Live Custom Parlay Analysis Banner */}
                {liveCustomCombo && (
                  <div className="nba-builder-live-summary">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="nba-combo-strat-badge is-prime">
                          <Icon name="Sparkles" size={13} /> Custom 2-Leg Double
                        </span>
                        <span style={{ fontWeight: 800, color: '#ffffff', fontSize: '1.1rem' }}>
                          {liveCustomCombo.legs[0].name} ({liveCustomCombo.legs[0].team}) + {liveCustomCombo.legs[1].name} ({liveCustomCombo.legs[1].team})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => loadComboIntoSlip(liveCustomCombo)}
                        style={{
                          padding: '0.55rem 1.25rem',
                          borderRadius: '8px',
                          background: 'var(--prime)',
                          border: 'none',
                          color: '#ffffff',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Load Custom Parlay to Slip
                      </button>
                    </div>

                    <div className="nba-combo-metrics-grid">
                      <div>
                        <small>Joint Probability</small>
                        <strong style={{ color: 'var(--prime)' }}>{liveCustomCombo.jointProbPct}%</strong>
                      </div>
                      <div>
                        <small>Compounded Payout</small>
                        <strong style={{ color: '#38bdf8' }}>{liveCustomCombo.compoundedAmerican}</strong>
                      </div>
                      <div>
                        <small>Fair Model Odds</small>
                        <strong style={{ color: '#94a3b8' }}>{liveCustomCombo.fairAmerican}</strong>
                      </div>
                      <div>
                        <small>Recommended Stake</small>
                        <strong style={{ color: '#34d399' }}>{liveCustomCombo.kellyUnits}u (Kelly)</strong>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sticky Parlay Slip */}
          <div className="nba-parlay-slip">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 800, color: '#ffffff' }}>
                <Icon name="Ticket" size={16} /> 2-Leg Parlay Slip ({slipLegs.length} legs)
              </div>
              {slipLegs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSlipLegs([])}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  Clear All
                </button>
              )}
            </div>

            {slipLegs.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem 1rem', color: '#64748b', fontSize: '0.85rem' }}>
                Load a curated 2-leg recipe or pick 2 players across different games in the Custom Builder.
              </div>
            ) : (
              <div className="nba-slip-legs-list">
                {slipLegs.map((leg, legIdx) => (
                  <div key={leg.id} className="nba-slip-leg-item">
                    <div>
                      <div style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 800 }}>LEG {legIdx + 1}</div>
                      <div style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.9rem' }}>
                        {leg.name}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                        {leg.team} vs {leg.opponent} · First Basket
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                      <span className="mono" style={{ fontWeight: 700, color: '#38bdf8', fontSize: '0.9rem' }}>
                        {leg.bookOdds || leg.fairGameOdds}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => toggleSlipLeg(leg, e)}
                        style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                      >
                        <Icon name="X" size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {slipLegs.length > 0 && (
              <div className="nba-slip-totals">
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#94a3b8' }}>
                  <span>Joint Fair Prob:</span>
                  <span className="mono" style={{ color: '#ffffff', fontWeight: 700 }}>
                    {parlayMath.jointProb}% ({parlayMath.fairAmerican})
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', color: '#94a3b8' }}>
                  <span>Compounded Odds Multiplier:</span>
                  <span className="mono" style={{ color: '#38bdf8', fontWeight: 700 }}>
                    {parlayMath.mult}x
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                  <label htmlFor="nba-stake-input" style={{ fontSize: '0.82rem', color: '#94a3b8' }}>Wager ($):</label>
                  <input
                    id="nba-stake-input"
                    type="number"
                    min="1"
                    max="1000"
                    value={stake}
                    onChange={(e) => setStake(Math.max(1, Number(e.target.value) || 1))}
                    style={{
                      width: '80px',
                      padding: '0.3rem 0.5rem',
                      background: 'rgba(2, 6, 23, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: '6px',
                      color: '#ffffff',
                      textAlign: 'right',
                      fontFamily: 'monospace',
                    }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '1.1rem', fontWeight: 800, color: '#34d399', marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
                  <span>Est. Payout:</span>
                  <span className="mono">${parlayMath.payout}</span>
                </div>

                <button
                  type="button"
                  onClick={copySlipToClipboard}
                  style={{
                    marginTop: '0.5rem',
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(151, 149, 203, 0.3)',
                    background: copiedSlip ? 'rgba(52, 211, 153, 0.2)' : 'rgba(151, 149, 203, 0.15)',
                    color: copiedSlip ? '#34d399' : '#c4b5fd',
                    fontWeight: 800,
                    fontSize: '0.82rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Icon name={copiedSlip ? 'Check' : 'Copy'} size={14} />
                  {copiedSlip ? 'Copied Parlay Slip!' : 'Copy Parlay Ticket'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* INSPECTION DRAWER MODAL */}
      {inspectedPlayer && (
        <div className="nba-drawer-backdrop" onClick={() => setInspectedPlayer(null)}>
          <div className="nba-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <div>
                <span className="nba-eyebrow">
                  <Icon name="Activity" size={13} /> Mathematical Telemetry
                </span>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#ffffff', margin: '0.2rem 0' }}>
                  {inspectedPlayer.name}
                </h2>
                <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  {inspectedPlayer.team} · #{inspectedPlayer.jersey || '—'} · {inspectedPlayer.position}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInspectedPlayer(null)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.4rem' }}
              >
                <Icon name="X" size={18} />
              </button>
            </div>

            {/* Odds & Probs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.85rem', padding: '1rem', background: 'rgba(2, 6, 23, 0.6)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
              <div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase' }}>Game First Basket</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--prime)', fontFamily: 'monospace' }}>
                  {(inspectedPlayer.gameProb * 100).toFixed(1)}%
                </div>
                {inspectedPlayer.ci90 && (
                  <div style={{ fontSize: '0.72rem', color: '#38bdf8', marginTop: 2 }}>
                    90% CI: {inspectedPlayer.ci90.lower}%–{inspectedPlayer.ci90.upper}%
                  </div>
                )}
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>Fair: {inspectedPlayer.fairGameOdds}</div>
              </div>
              <div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', textTransform: 'uppercase' }}>Team First Basket</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f8fafc', fontFamily: 'monospace' }}>
                  {(inspectedPlayer.teamProb * 100).toFixed(1)}%
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 2 }}>Fair: {inspectedPlayer.fairTeamOdds}</div>
              </div>
            </div>

            {/* Method & Shot Mix Breakdown */}
            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.65rem' }}>
                Shot Method & Zone Conversion
              </h4>
              <div style={{ display: 'flex', gap: '0.85rem' }}>
                <div style={{ flex: 1, padding: '0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>2PT / Paint / Dunk</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff', fontFamily: 'monospace' }}>
                    {(inspectedPlayer.method?.prob2PT * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                    Rim FG: {inspectedPlayer.zoneFG?.rim || 70}% · Mid: {inspectedPlayer.zoneFG?.mid || 44}%
                  </div>
                </div>
                <div style={{ flex: 1, padding: '0.75rem', background: 'rgba(255,255,255,0.04)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>3PT Perimeter</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#a855f7', fontFamily: 'monospace' }}>
                    {(inspectedPlayer.method?.prob3PT * 100).toFixed(0)}%
                  </div>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>
                    3PT FG: {inspectedPlayer.zoneFG?.three || 36}%
                  </div>
                </div>
              </div>
            </div>

            {/* Markov Possession Chain Sequence */}
            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.65rem' }}>
                Markov First-Possession Sequence
              </h4>
              <div className="nba-sequence-chain">
                <div className="nba-sequence-step">
                  <span className="nba-step-num">1</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.84rem' }}>
                      Opening Tip Win Probability: {(inspectedPlayer.teamScoresFirstProb * 100).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {inspectedPlayer.tipMatchup?.jumperA?.jumper || inspectedPlayer.tipMatchup?.homeJumper} vs {inspectedPlayer.tipMatchup?.jumperB?.jumper || inspectedPlayer.tipMatchup?.awayJumper} · {inspectedPlayer.tipMatchup?.reachDiffInches > 0 ? `+${inspectedPlayer.tipMatchup.reachDiffInches}" Reach Advantage` : inspectedPlayer.tipMatchup?.reachDiffInches < 0 ? `+${Math.abs(inspectedPlayer.tipMatchup.reachDiffInches)}" Reach Advantage` : 'Even Reach'} ({inspectedPlayer.tipMatchup?.sampleConfidence || 'High Sample'})
                    </div>
                  </div>
                </div>

                <div className="nba-sequence-step">
                  <span className="nba-step-num">2</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.84rem' }}>
                      Ball Security Check (1 - Turnover Rate): {(100 - (inspectedPlayer.turnoverRate || 12.5)).toFixed(1)}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      {inspectedPlayer.turnoverRate || 12.5}% early turnover risk flips possession to opponent without a field goal attempt.
                    </div>
                  </div>
                </div>

                <div className="nba-sequence-step">
                  <span className="nba-step-num">3</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.84rem' }}>
                      Scripted Play Action: {inspectedPlayer.scriptedSetPlay}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      Target takes {(inspectedPlayer.earlyShotShare * 100).toFixed(0)}% of team's shots in min 0-3 (vs {inspectedPlayer.seasonUsage || 22}% season usage).
                    </div>
                  </div>
                </div>

                <div className="nba-sequence-step">
                  <span className="nba-step-num">4</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.84rem' }}>
                      Expected Make Rate: {inspectedPlayer.expectedMakeRate}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      Weighted blend across player's shot mix adjusted for opponent rim protection and perimeter contest.
                    </div>
                  </div>
                </div>

                <div className="nba-sequence-step">
                  <span className="nba-step-num">5</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.84rem' }}>
                      Offensive Rebound Putback Extension: +{inspectedPlayer.orebExtensionPct || 26}%
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                      Missed first shot sequence continues with offensive glass crash before defensive stop.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Multi-Book Comparison Matrix */}
            {inspectedPlayer.multiBookComparison && Object.keys(inspectedPlayer.multiBookComparison).length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.45rem' }}>
                  Multi-Book Odds Matrix & Closing Benchmark
                </h4>
                <div style={{ overflowX: 'auto', background: 'rgba(2, 6, 23, 0.5)', borderRadius: '8px', padding: '0.4rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <table className="nba-multibook-table">
                    <thead>
                      <tr>
                        <th>Sportsbook</th>
                        <th>Odds</th>
                        <th>Implied</th>
                        <th>EV Edge</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(inspectedPlayer.multiBookComparison).map(([bName, bData]) => {
                        const isBest = inspectedPlayer.bestBook === bName;
                        return (
                          <tr key={bName}>
                            <td style={{ fontWeight: 600, color: '#f8fafc', textTransform: 'capitalize' }}>
                              {bName}
                              {isBest && <span className="nba-best-book-badge">BEST</span>}
                            </td>
                            <td className="mono" style={{ color: isBest ? '#34d399' : '#38bdf8', fontWeight: 700 }}>
                              {bData.odds}
                            </td>
                            <td className="mono" style={{ color: '#94a3b8' }}>
                              {bData.implied ? `${bData.implied}%` : '—'}
                            </td>
                            <td>
                              {bData.edge != null ? (
                                <span style={{ color: bData.edge > 0 ? '#34d399' : '#ef4444', fontWeight: 700, fontFamily: 'monospace' }}>
                                  {bData.edge > 0 ? `+${bData.edge}%` : `${bData.edge}%`}
                                </span>
                              ) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {inspectedPlayer.lineMovement && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', fontSize: '0.78rem', color: '#94a3b8' }}>
                    <span>Opening Line: <strong>{inspectedPlayer.lineMovement.opening}</strong></span>
                    <span>Closing Benchmark: <strong>{inspectedPlayer.lineMovement.closing}</strong></span>
                    <span className={`nba-chip-pill ${inspectedPlayer.lineMovement.movement?.includes('Steam') ? 'nba-steam-chip' : 'nba-drift-chip'}`}>
                      {inspectedPlayer.lineMovement.movement}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Contributing Factor breakdown */}
            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.65rem' }}>
                Contributing Model Weights & Settlement Context
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', fontSize: '0.82rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0.65rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>Active Settlement Rule:</span>
                  <span className="mono" style={{ color: '#38bdf8', fontWeight: 700 }}>{settlementRule}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0.65rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>Positional Script Weight:</span>
                  <span className="mono" style={{ color: '#ffffff' }}>×{inspectedPlayer.breakdown?.posWeight?.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0.65rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>Shot Proximity Conversion:</span>
                  <span className="mono" style={{ color: '#ffffff' }}>×{inspectedPlayer.breakdown?.proximityWeight?.toFixed(2)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.45rem 0.65rem', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                  <span style={{ color: '#94a3b8' }}>Quarter-Kelly Bankroll Allocation:</span>
                  <span className="mono" style={{ color: inspectedPlayer.kellyUnits > 0 ? '#34d399' : '#64748b' }}>
                    {inspectedPlayer.kellyUnits > 0 ? `${inspectedPlayer.kellyUnits} units` : '0 units (No EV)'}
                  </span>
                </div>
              </div>
            </div>

            {/* Explanations */}
            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.5rem' }}>
                ELI5 Summary
              </h4>
              <p style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.5, margin: 0, padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                {inspectedPlayer.eli5}
              </p>
            </div>

            <div>
              <h4 style={{ fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.5rem' }}>
                ELI15 Advanced Telemetry
              </h4>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5, margin: 0, padding: '0.75rem', background: 'rgba(2, 6, 23, 0.5)', borderRadius: '8px', fontFamily: 'monospace' }}>
                {inspectedPlayer.eli15}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

