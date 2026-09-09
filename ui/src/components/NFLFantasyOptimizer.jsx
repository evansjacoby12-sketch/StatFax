import { useState, useMemo, useEffect } from 'react'
import Icon from './Icon.jsx'
import {
  FANTASY_SCORING_PRESETS,
  DEFAULT_ROSTER_SLOTS,
  calculateFantasyPoints,
  calculatePlayerDistribution,
  enrichPlayerFantasyProfile,
  optimizeFantasyLineup,
  simulateH2HMatchup,
  compareStartSit,
  scoreWaiverTarget,
  parseRosterText,
  generateSlateSpecialUnits,
  calculateLiveMatchupStats,
  evaluateFantasyTrade,
  generateMatchupShareText,
} from '../../../src/sports/nfl/logic/fantasyEngine.js'

const readStorage = (key, fallback) => {
  if (typeof window === 'undefined') return fallback
  try {
    const val = JSON.parse(window.localStorage.getItem(key))
    return val ?? fallback
  } catch {
    return fallback
  }
}

const writeStorage = (key, value) => {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {}
  }
}

const DEFAULT_LEAGUES = [
  { id: 'league-1', name: 'Main League (PPR)', format: 'ppr', myTeamName: 'My Squad', oppTeamName: 'Rival Franchise' },
]

const FANTASY_TABS = [
  { id: 'h2h', label: 'H2H Simulator', icon: 'Swords', desc: 'Monte Carlo matchup win probability & slot battles' },
  { id: 'lineup', label: 'Lineup Optimizer', icon: 'Trophy', desc: 'Auto-optimize starters & roster management' },
  { id: 'trade', label: 'Trade Lab', icon: 'ArrowLeftRight', desc: 'Evaluate trade proposals & weekly point delta' },
  { id: 'start-sit', label: 'Start / Sit Lab', icon: 'Scale', desc: 'Side-by-side 1v1 player decision engine' },
  { id: 'waivers', label: 'Waiver Radar', icon: 'Radar', desc: 'Breakout sleepers & role inheritance targets' },
]

export default function NFLFantasyOptimizer({ snapshot }) {
  const [activeTab, setActiveTab] = useState('h2h')
  
  // Multi-League Profiles
  const [leagues, setLeagues] = useState(() => readStorage('statfax:nfl:fantasy:leagues', DEFAULT_LEAGUES))
  const [activeLeagueId, setActiveLeagueId] = useState(() => readStorage('statfax:nfl:fantasy:active_league', 'league-1'))

  const currentLeague = useMemo(() => {
    return leagues.find((l) => l.id === activeLeagueId) || leagues[0] || DEFAULT_LEAGUES[0]
  }, [leagues, activeLeagueId])

  const [format, setFormat] = useState(() => currentLeague.format || 'ppr')
  const [optimizeMode, setOptimizeMode] = useState('median') // 'median' | 'floor' | 'ceiling'

  // Custom Team Names for Active League
  const [myTeamName, setMyTeamName] = useState(() => currentLeague.myTeamName || 'My Squad')
  const [oppTeamName, setOppTeamName] = useState(() => currentLeague.oppTeamName || 'Rival Franchise')

  // Persisted Rosters per League
  const [myRosterIds, setMyRosterIds] = useState(() => readStorage(`statfax:nfl:fantasy:my_roster_${activeLeagueId}`, []))
  const [oppRosterIds, setOppRosterIds] = useState(() => readStorage(`statfax:nfl:fantasy:opp_roster_${activeLeagueId}`, []))

  // In-line Roster Management in H2H View
  const [showRosterManager, setShowRosterManager] = useState(true)
  const [mySearchQuery, setMySearchQuery] = useState('')
  const [myPosFilter, setMyPosFilter] = useState('ALL')
  const [oppSearchQuery, setOppSearchQuery] = useState('')
  const [oppPosFilter, setOppPosFilter] = useState('ALL')

  // Slot Picker Modal State
  const [slotPickerState, setSlotPickerState] = useState(null)
  const [pickerSearch, setPickerSearch] = useState('')
  const [pickerPosFilter, setPickerPosFilter] = useState('ALL')

  // Roster Import Modal State
  const [importTarget, setImportTarget] = useState(null)
  const [importRawText, setImportRawText] = useState('')

  // Trade Lab State
  const [tradeGiveIds, setTradeGiveIds] = useState([])
  const [tradeReceiveIds, setTradeReceiveIds] = useState([])
  const [tradeSearchGive, setTradeSearchGive] = useState('')
  const [tradePosGive, setTradePosGive] = useState('ALL')
  const [tradeSourceGive, setTradeSourceGive] = useState('roster') // 'roster' | 'all'
  const [tradeSearchRec, setTradeSearchRec] = useState('')
  const [tradePosRec, setTradePosRec] = useState('ALL')
  const [tradeSourceRec, setTradeSourceRec] = useState('all') // 'opp' | 'all'

  // Start / Sit state
  const [startSitPlayerA, setStartSitPlayerA] = useState(null)
  const [startSitPlayerB, setStartSitPlayerB] = useState(null)
  const [startSitSearchA, setStartSitSearchA] = useState('')
  const [startSitPosA, setStartSitPosA] = useState('ALL')
  const [startSitSourceA, setStartSitSourceA] = useState('roster') // 'roster' | 'all'
  const [startSitSearchB, setStartSitSearchB] = useState('')
  const [startSitPosB, setStartSitPosB] = useState('ALL')
  const [startSitSourceB, setStartSitSourceB] = useState('roster') // 'roster' | 'all'

  // Waiver Wire Filter State
  const [waiverSearchQuery, setWaiverSearchQuery] = useState('')
  const [waiverPosFilter, setWaiverPosFilter] = useState('ALL')
  const [waiverRatingFilter, setWaiverRatingFilter] = useState('ALL')

  // Toast message state (e.g. "Matchup copied to clipboard!")
  const [toastMessage, setToastMessage] = useState(null)

  const showToast = (msg) => {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3200)
  }

  const allPlayers = useMemo(() => {
    const raw = snapshot?.players || []
    const specialUnits = generateSlateSpecialUnits(raw)
    return [...raw, ...specialUnits]
  }, [snapshot])

  // Sync state when league changes
  useEffect(() => {
    const l = leagues.find((item) => item.id === activeLeagueId) || leagues[0]
    if (l) {
      setFormat(l.format || 'ppr')
      setMyTeamName(l.myTeamName || 'My Squad')
      setOppTeamName(l.oppTeamName || 'Rival Franchise')
      setMyRosterIds(readStorage(`statfax:nfl:fantasy:my_roster_${l.id}`, []))
      setOppRosterIds(readStorage(`statfax:nfl:fantasy:opp_roster_${l.id}`, []))
    }
    writeStorage('statfax:nfl:fantasy:active_league', activeLeagueId)
  }, [activeLeagueId])

  // Save changes to localStorage
  useEffect(() => {
    writeStorage('statfax:nfl:fantasy:leagues', leagues)
  }, [leagues])

  useEffect(() => {
    writeStorage(`statfax:nfl:fantasy:my_roster_${activeLeagueId}`, myRosterIds)
  }, [myRosterIds, activeLeagueId])

  useEffect(() => {
    writeStorage(`statfax:nfl:fantasy:opp_roster_${activeLeagueId}`, oppRosterIds)
  }, [oppRosterIds, activeLeagueId])

  // Update active league meta in `leagues` list
  const updateActiveLeagueMeta = (updates) => {
    setLeagues((curr) =>
      curr.map((l) => (l.id === activeLeagueId ? { ...l, ...updates } : l))
    )
  }

  const handleFormatChange = (newFmt) => {
    setFormat(newFmt)
    updateActiveLeagueMeta({ format: newFmt })
  }

  const handleMyTeamNameChange = (newName) => {
    setMyTeamName(newName)
    updateActiveLeagueMeta({ myTeamName: newName })
  }

  const handleOppTeamNameChange = (newName) => {
    setOppTeamName(newName)
    updateActiveLeagueMeta({ oppTeamName: newName })
  }

  const handleCreateNewLeague = () => {
    const newId = `league-${Date.now()}`
    const newName = `League ${leagues.length + 1} (Half-PPR)`
    const newLeague = {
      id: newId,
      name: newName,
      format: 'half_ppr',
      myTeamName: 'My Squad',
      oppTeamName: 'Opponent',
    }
    setLeagues((prev) => [...prev, newLeague])
    setActiveLeagueId(newId)
    showToast(`Created ${newName}`)
  }

  // Quick preset: Load realistic Demo Matchup with full 9-starter standard rosters
  const loadDemoMatchup = () => {
    const demoTeamA = ['Josh Allen', 'Derrick Henry', 'Javonte Williams', 'Davante Adams', 'Chris Olave', 'Sam LaPorta', 'Cam Skattebo', 'Baltimore Ravens D/ST', 'Justin Tucker']
    const demoTeamB = ['Jalen Hurts', 'Omarion Hampton', 'Saquon Barkley', 'Tyreek Hill', 'Alec Pierce', 'Dallas Goedert', 'Jahmyr Gibbs', 'Detroit Lions D/ST', 'Jake Bates']

    const resolveIds = (names) => names.map((name) => allPlayers.find((p) => p.name.toLowerCase().includes(name.toLowerCase()))?.id).filter(Boolean)

    const idsA = resolveIds(demoTeamA)
    const idsB = resolveIds(demoTeamB)

    setMyRosterIds(idsA.length ? idsA : allPlayers.slice(0, 9).map((p) => p.id))
    setOppRosterIds(idsB.length ? idsB : allPlayers.slice(9, 18).map((p) => p.id))
    showToast('Loaded demo starting lineups!')
  }

  // Auto-load demo on first visit if completely empty
  useEffect(() => {
    if (!myRosterIds.length && !oppRosterIds.length && allPlayers.length > 0) {
      loadDemoMatchup()
    }
  }, [allPlayers])

  const myRoster = useMemo(() => {
    const set = new Set(myRosterIds)
    return allPlayers.filter((p) => set.has(p.id))
  }, [allPlayers, myRosterIds])

  const oppRoster = useMemo(() => {
    const set = new Set(oppRosterIds)
    return allPlayers.filter((p) => set.has(p.id))
  }, [allPlayers, oppRosterIds])

  // Optimized Lineup for My Team
  const myOptimized = useMemo(() => {
    return optimizeFantasyLineup(myRoster, DEFAULT_ROSTER_SLOTS, format, optimizeMode)
  }, [myRoster, format, optimizeMode])

  // Optimized Lineup for Opponent Team
  const oppOptimized = useMemo(() => {
    return optimizeFantasyLineup(oppRoster, DEFAULT_ROSTER_SLOTS, format, 'median')
  }, [oppRoster, format])

  // Monte Carlo H2H Matchup Simulation
  const h2hSim = useMemo(() => {
    const teamAStarters = myOptimized.lineup.map((slot) => slot.player).filter(Boolean)
    const teamBStarters = oppOptimized.lineup.map((slot) => slot.player).filter(Boolean)
    return simulateH2HMatchup(teamAStarters, teamBStarters, format, 3000)
  }, [myOptimized, oppOptimized, format])

  // Live Game-Day Stats & PMR
  const liveStats = useMemo(() => {
    const teamAStarters = myOptimized.lineup.map((slot) => slot.player).filter(Boolean)
    const teamBStarters = oppOptimized.lineup.map((slot) => slot.player).filter(Boolean)
    return calculateLiveMatchupStats(teamAStarters, teamBStarters, format)
  }, [myOptimized, oppOptimized, format])

  // Trade Lab Evaluation
  const tradeGivePlayers = useMemo(() => {
    const set = new Set(tradeGiveIds)
    return allPlayers.filter((p) => set.has(p.id))
  }, [allPlayers, tradeGiveIds])

  const tradeReceivePlayers = useMemo(() => {
    const set = new Set(tradeReceiveIds)
    return allPlayers.filter((p) => set.has(p.id))
  }, [allPlayers, tradeReceiveIds])

  const tradeEvaluation = useMemo(() => {
    return evaluateFantasyTrade(tradeGivePlayers, tradeReceivePlayers, myRoster, DEFAULT_ROSTER_SLOTS, format)
  }, [tradeGivePlayers, tradeReceivePlayers, myRoster, format])

  // Start / Sit 1v1 Evaluation
  const startSitComp = useMemo(() => {
    if (!startSitPlayerA || !startSitPlayerB) return null
    return compareStartSit(startSitPlayerA, startSitPlayerB, format)
  }, [startSitPlayerA, startSitPlayerB, format])

  // Default start/sit selections if unselected
  useEffect(() => {
    if (myRoster.length >= 2) {
      if (!startSitPlayerA) setStartSitPlayerA(myRoster[0])
      if (!startSitPlayerB) setStartSitPlayerB(myRoster[1])
    }
  }, [myRoster])

  // Waiver Wire Candidates
  const waiverCandidates = useMemo(() => {
    const mySet = new Set(myRosterIds)
    const oppSet = new Set(oppRosterIds)
    const unowned = allPlayers.filter((p) => !mySet.has(p.id) && !oppSet.has(p.id))
    return unowned.map((p) => scoreWaiverTarget(p, format)).sort((a, b) => b.waiverScore - a.waiverScore)
  }, [allPlayers, myRosterIds, oppRosterIds, format])

  // Filtered Waiver Candidates with live search & multi-tier filters
  const filteredWaiverCandidates = useMemo(() => {
    const q = waiverSearchQuery.trim().toLowerCase()
    return waiverCandidates
      .filter((p) => waiverPosFilter === 'ALL' || p.position === waiverPosFilter)
      .filter((p) => waiverRatingFilter === 'ALL' || p.breakoutRating === waiverRatingFilter)
      .filter((p) => {
        if (!q) return true
        const haystack = `${p.name} ${p.team} ${p.position} ${p.opponent} ${(p.fantasy.signals || []).map((s) => s.text).join(' ')}`.toLowerCase()
        return haystack.includes(q)
      })
  }, [waiverCandidates, waiverPosFilter, waiverRatingFilter, waiverSearchQuery])

  // Search pool for My Team inline search
  const mySearchPool = useMemo(() => {
    const q = mySearchQuery.trim().toLowerCase()
    return allPlayers
      .filter((p) => myPosFilter === 'ALL' || p.position === myPosFilter)
      .filter((p) => !q || `${p.name} ${p.team} ${p.position}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [allPlayers, mySearchQuery, myPosFilter])

  // Search pool for Opp Team inline search
  const oppSearchPool = useMemo(() => {
    const q = oppSearchQuery.trim().toLowerCase()
    return allPlayers
      .filter((p) => oppPosFilter === 'ALL' || p.position === oppPosFilter)
      .filter((p) => !q || `${p.name} ${p.team} ${p.position}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [allPlayers, oppSearchQuery, oppPosFilter])

  // Filtered pool for Giving in Trade Lab
  const tradeGivePool = useMemo(() => {
    const base = tradeSourceGive === 'roster' && myRoster.length > 0 ? myRoster : allPlayers
    const q = tradeSearchGive.trim().toLowerCase()
    return base
      .filter((p) => !tradeGiveIds.includes(p.id))
      .filter((p) => tradePosGive === 'ALL' || p.position === tradePosGive)
      .filter((p) => !q || `${p.name} ${p.team} ${p.position}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [tradeSourceGive, myRoster, allPlayers, tradeGiveIds, tradePosGive, tradeSearchGive])

  // Filtered pool for Receiving in Trade Lab
  const tradeRecPool = useMemo(() => {
    const base = tradeSourceRec === 'opp' && oppRoster.length > 0 ? oppRoster : allPlayers
    const q = tradeSearchRec.trim().toLowerCase()
    return base
      .filter((p) => !tradeReceiveIds.includes(p.id))
      .filter((p) => tradePosRec === 'ALL' || p.position === tradePosRec)
      .filter((p) => !q || `${p.name} ${p.team} ${p.position}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [tradeSourceRec, oppRoster, allPlayers, tradeReceiveIds, tradePosRec, tradeSearchRec])

  // Search pool for Start / Sit Player A
  const startSitPoolA = useMemo(() => {
    const base = startSitSourceA === 'roster' && myRoster.length > 0 ? myRoster : allPlayers
    const q = startSitSearchA.trim().toLowerCase()
    return base
      .filter((p) => startSitPosA === 'ALL' || p.position === startSitPosA)
      .filter((p) => !q || `${p.name} ${p.team} ${p.position}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [startSitSourceA, myRoster, allPlayers, startSitPosA, startSitSearchA])

  // Search pool for Start / Sit Player B
  const startSitPoolB = useMemo(() => {
    const base = startSitSourceB === 'roster' && myRoster.length > 0 ? myRoster : allPlayers
    const q = startSitSearchB.trim().toLowerCase()
    return base
      .filter((p) => startSitPosB === 'ALL' || p.position === startSitPosB)
      .filter((p) => !q || `${p.name} ${p.team} ${p.position}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [startSitSourceB, myRoster, allPlayers, startSitPosB, startSitSearchB])

  // Filtered pool for Slot Picker Popover
  const slotPickerPool = useMemo(() => {
    if (!slotPickerState) return []
    const { slotKey } = slotPickerState
    const q = pickerSearch.trim().toLowerCase()

    return allPlayers
      .filter((p) => {
        if (slotKey === 'FLEX') {
          if (pickerPosFilter !== 'ALL') return p.position === pickerPosFilter
          return ['RB', 'WR', 'TE'].includes(p.position)
        }
        if (slotKey === 'DST' || slotKey === 'D/ST' || slotKey === 'DEF') return ['DST', 'D/ST', 'DEF'].includes(p.position)
        return p.position === slotKey
      })
      .filter((p) => !q || `${p.name} ${p.team} ${p.position}`.toLowerCase().includes(q))
      .map((p) => enrichPlayerFantasyProfile(p, format))
      .sort((a, b) => b.fantasy.points - a.fantasy.points)
      .slice(0, 30)
  }, [slotPickerState, allPlayers, pickerSearch, pickerPosFilter, format])

  // Parse result for Import Modal
  const parsedImport = useMemo(() => {
    if (!importRawText.trim()) return null
    return parseRosterText(importRawText, allPlayers)
  }, [importRawText, allPlayers])

  const toggleMyRosterPlayer = (playerId) => {
    setMyRosterIds((current) => {
      const next = new Set(current)
      next.has(playerId) ? next.delete(playerId) : next.add(playerId)
      return [...next]
    })
  }

  const toggleOppRosterPlayer = (playerId) => {
    setOppRosterIds((current) => {
      const next = new Set(current)
      next.has(playerId) ? next.delete(playerId) : next.add(playerId)
      return [...next]
    })
  }

  const handleApplyImport = () => {
    if (!parsedImport || !parsedImport.matchedIds.length) return
    if (importTarget === 'my') {
      setMyRosterIds(parsedImport.matchedIds)
      showToast(`Imported ${parsedImport.count} players to ${myTeamName}`)
    } else if (importTarget === 'opp') {
      setOppRosterIds(parsedImport.matchedIds)
      showToast(`Imported ${parsedImport.count} players to ${oppTeamName}`)
    }
    setImportTarget(null)
    setImportRawText('')
  }

  const handleSelectSlotPlayer = (player) => {
    if (!slotPickerState) return
    const { team, currentId } = slotPickerState
    if (team === 'my') {
      setMyRosterIds((curr) => {
        const next = new Set(curr)
        if (currentId) next.delete(currentId)
        next.add(player.id)
        return [...next]
      })
    } else {
      setOppRosterIds((curr) => {
        const next = new Set(curr)
        if (currentId) next.delete(currentId)
        next.add(player.id)
        return [...next]
      })
    }
    setSlotPickerState(null)
    setPickerSearch('')
  }

  const handleCopyMatchupCard = () => {
    const text = generateMatchupShareText(h2hSim, myTeamName, oppTeamName, format)
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text)
      showToast('Matchup card copied to clipboard!')
    }
  }

  return (
    <div className="fantasy-optimizer-workspace">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fantasy-toast-pill">
          <Icon name="CheckCircle2" size={14} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Top Header with Multi-League Profile Switcher & Global Controls */}
      <header className="fantasy-topbar">
        <div className="fantasy-title-block">
          <div className="fantasy-eyebrow"><Icon name="Trophy" size={13} /> StatFax Fantasy Suite</div>
          <h2>Fantasy League Optimizer & Matchup Lab</h2>
          <p>Multi-league roster manager, live PMR tracker, trade evaluator, and format-aware decision models.</p>
        </div>

        <div className="fantasy-controls">
          {/* League Profile Selector */}
          <div className="fantasy-preset-group">
            <span className="fantasy-control-label">Active League</span>
            <div className="league-switcher-wrap">
              <select
                className="league-select-dropdown"
                value={activeLeagueId}
                onChange={(e) => {
                  if (e.target.value === '__new__') {
                    handleCreateNewLeague()
                  } else {
                    setActiveLeagueId(e.target.value)
                  }
                }}
              >
                {leagues.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
                <option value="__new__">+ Create New League…</option>
              </select>
            </div>
          </div>

          <div className="fantasy-preset-group">
            <span className="fantasy-control-label">Scoring Format</span>
            <div className="fantasy-format-tabs">
              {Object.values(FANTASY_SCORING_PRESETS).map((p) => (
                <button
                  key={p.id}
                  className={`fantasy-format-btn ${format === p.id ? 'active' : ''}`}
                  onClick={() => handleFormatChange(p.id)}
                >
                  {p.shortLabel}
                </button>
              ))}
            </div>
          </div>

          <div className="fantasy-actions-group">
            <button className="fantasy-action-btn" onClick={loadDemoMatchup} title="Load realistic sample matchup">
              <Icon name="Sparkles" size={13} /> Demo Matchup
            </button>
            <button className="fantasy-action-btn text-muted" onClick={() => { setMyRosterIds([]); setOppRosterIds([]) }}>
              <Icon name="Trash2" size={13} /> Reset All
            </button>
          </div>
        </div>
      </header>

      {/* Navigation Sub-Tabs */}
      <nav className="fantasy-nav-tabs" role="tablist">
        {FANTASY_TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`fantasy-nav-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <Icon name={tab.icon} size={15} />
            <span className="tab-text">
              <strong>{tab.label}</strong>
              <small>{tab.desc}</small>
            </span>
          </button>
        ))}
      </nav>

      {/* Main Tab Views */}
      <div className="fantasy-content-body">
        {/* =========================================================================
            TAB 1: H2H MATCHUP SIMULATOR & ROSTER BUILDER
            ========================================================================= */}
        {activeTab === 'h2h' && (
          <div className="fantasy-h2h-view">
            {/* Live Game-Day / PMR Status Banner (if active games exist) */}
            {liveStats.isGameDayActive && (
              <div className="live-gameday-banner">
                <div className="live-status-badge">
                  <span className="live-pulse-dot" />
                  <strong>LIVE GAME-DAY TRACKER</strong>
                </div>
                <div className="live-score-split">
                  <div className="team-live-block">
                    <span className="lbl">{myTeamName}:</span>
                    <b className="live-num mono">{liveStats.liveScoreA} pts scored</b>
                    <small className="mono">({liveStats.pmrA} PMR left · Proj: {liveStats.projFinalA})</small>
                  </div>
                  <div className="vs-sep mono">VS</div>
                  <div className="team-live-block">
                    <span className="lbl">{oppTeamName}:</span>
                    <b className="live-num mono">{liveStats.liveScoreB} pts scored</b>
                    <small className="mono">({liveStats.pmrB} PMR left · Proj: {liveStats.projFinalB})</small>
                  </div>
                </div>
              </div>
            )}

            {/* Win Probability & Projection Hero Card */}
            <section className="h2h-hero-card">
              <div className="h2h-header-row">
                <div className="h2h-team-col my-team">
                  <div className="team-header-edit">
                    <input
                      type="text"
                      className="team-name-input"
                      value={myTeamName}
                      onChange={(e) => handleMyTeamNameChange(e.target.value)}
                      placeholder="My Team Name"
                    />
                    <span className="team-tag">YOU</span>
                  </div>
                  <div className="team-score-hero">
                    <span className="score-val mono">{h2hSim.meanScoreA}</span>
                    <small>Projected pts</small>
                  </div>
                  <div className="score-range mono">Range: {h2hSim.floorA} – {h2hSim.ceilingA}</div>
                </div>

                <div className="h2h-meter-col">
                  <div className="win-prob-headline">
                    <span className="prob-label">WIN PROBABILITY (10,000 SIMS)</span>
                    <span className={`prob-value mono ${h2hSim.winProbA >= 50 ? 'tone-good' : 'tone-bad'}`}>
                      {h2hSim.winProbA}%
                    </span>
                  </div>
                  <div className="h2h-prob-bar-track">
                    <div
                      className="h2h-prob-bar-fill"
                      style={{ width: `${h2hSim.winProbA}%` }}
                    />
                  </div>
                  <div className="h2h-prob-subtext">
                    <span>{h2hSim.winProbA}% {myTeamName}</span>
                    <span>{h2hSim.winProbB}% {oppTeamName}</span>
                  </div>
                </div>

                <div className="h2h-team-col opp-team">
                  <div className="team-header-edit text-right">
                    <span className="team-tag opp-tag">RIVAL</span>
                    <input
                      type="text"
                      className="team-name-input text-right"
                      value={oppTeamName}
                      onChange={(e) => handleOppTeamNameChange(e.target.value)}
                      placeholder="Opponent Name"
                    />
                  </div>
                  <div className="team-score-hero">
                    <span className="score-val mono">{h2hSim.meanScoreB}</span>
                    <small>Projected pts</small>
                  </div>
                  <div className="score-range mono">Range: {h2hSim.floorB} – {h2hSim.ceilingB}</div>
                </div>
              </div>

              {/* Strategy Coach Alert & Share Button */}
              <div className="h2h-strategy-row">
                <div className={`h2h-strategy-box tone-${h2hSim.strategyTone}`}>
                  <Icon name={h2hSim.strategyTone === 'good' ? 'ShieldCheck' : h2hSim.strategyTone === 'warn' ? 'Flame' : 'Target'} size={18} />
                  <div className="strategy-text">
                    <strong>Matchup Strategy Coach</strong>
                    <p>{h2hSim.strategyAdvice}</p>
                  </div>
                </div>
                <button className="share-matchup-btn" onClick={handleCopyMatchupCard} title="Copy matchup summary for Discord/Slack">
                  <Icon name="Share2" size={13} /> Copy Card
                </button>
              </div>
            </section>

            {/* Interactive Team Lineup Selector & Builder */}
            <section className="h2h-lineup-builder-section">
              <div className="section-head-with-actions">
                <div>
                  <h3><Icon name="Users" size={17} /> Roster Lineup Manager</h3>
                  <small>Select starters slot-by-slot or import full 9-man lineups from ESPN / Yahoo / Sleeper</small>
                </div>
                <div className="section-actions">
                  <button
                    className="toggle-expand-btn"
                    onClick={() => setShowRosterManager((prev) => !prev)}
                  >
                    <Icon name={showRosterManager ? 'ChevronUp' : 'ChevronDown'} size={14} />
                    {showRosterManager ? 'Collapse Rosters' : 'Expand Rosters'}
                  </button>
                </div>
              </div>

              {showRosterManager && (
                <div className="h2h-rosters-grid">
                  {/* Column 1: My Team Roster */}
                  <div className="h2h-team-roster-card my-roster">
                    <div className="roster-card-header">
                      <div className="team-badge-group">
                        <span className="team-dot blue-dot" />
                        <strong>{myTeamName} (My Lineup)</strong>
                      </div>
                      <div className="roster-card-tools">
                        <button
                          className="import-tool-btn"
                          onClick={() => { setImportTarget('my'); setImportRawText('') }}
                          title="Paste ESPN or Yahoo lineup"
                        >
                          <Icon name="ClipboardPaste" size={13} /> Import ESPN
                        </button>
                        <button
                          className="clear-tool-btn"
                          onClick={() => setMyRosterIds([])}
                          title="Clear My Lineup"
                        >
                          <Icon name="Trash2" size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="roster-slots-stack">
                      {myOptimized.lineup.map((s, idx) => {
                        const weather = s.player?.weather
                        const isHighWind = weather && weather.roof === 'outdoor' && weather.windMph >= 15
                        const isRain = weather && weather.roof === 'outdoor' && weather.precipProbability >= 40

                        return (
                          <div key={idx} className="h2h-slot-row">
                            <span className={`slot-pill ${s.slot.toLowerCase()}`}>{s.slotLabel}</span>
                            {s.player ? (
                              <div className="slot-player-pill">
                                <div className="p-text">
                                  <div className="p-name-row">
                                    <strong className="p-name">{s.player.name}</strong>
                                    {isHighWind && <span className="hazard-pill wind" title={`${weather.windMph} mph wind`}>💨 {weather.windMph}m</span>}
                                    {isRain && <span className="hazard-pill rain" title={`${weather.precipProbability}% rain`}>🌧️ Rain</span>}
                                  </div>
                                  <span className="p-sub">{s.player.team} vs {s.player.opponent} · {s.player.position}</span>
                                </div>
                                <span className="p-fpts mono">{s.player.fantasy.points} pts</span>
                                <div className="slot-btn-group">
                                  <button
                                    className="slot-swap-btn"
                                    onClick={() => setSlotPickerState({ team: 'my', slotKey: s.slot, currentId: s.player.id })}
                                    title="Swap Player"
                                  >
                                    <Icon name="RefreshCw" size={11} />
                                  </button>
                                  <button
                                    className="slot-del-btn"
                                    onClick={() => toggleMyRosterPlayer(s.player.id)}
                                    title="Remove"
                                  >
                                    <Icon name="X" size={12} />
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                className="slot-empty-pill"
                                onClick={() => setSlotPickerState({ team: 'my', slotKey: s.slot, currentId: null })}
                              >
                                <Icon name="Plus" size={12} /> Select {s.slotLabel}…
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* Quick Add Search for My Team */}
                    <div className="roster-quick-search">
                      <div className="quick-search-input-wrap">
                        <Icon name="Search" size={13} />
                        <input
                          type="text"
                          placeholder="Quick add player to My Team…"
                          value={mySearchQuery}
                          onChange={(e) => setMySearchQuery(e.target.value)}
                        />
                        <select value={myPosFilter} onChange={(e) => setMyPosFilter(e.target.value)}>
                          <option value="ALL">All Pos</option>
                          <option value="QB">QB</option>
                          <option value="RB">RB</option>
                          <option value="WR">WR</option>
                          <option value="TE">TE</option>
                          <option value="DST">D/ST</option>
                          <option value="K">K</option>
                        </select>
                      </div>

                      {mySearchQuery.trim() && (
                        <div className="quick-search-dropdown">
                          {mySearchPool.map((p) => {
                            const isAdded = myRosterIds.includes(p.id)
                            const pts = calculateFantasyPoints(p, format)
                            return (
                              <div key={p.id} className="quick-search-row">
                                <div className="qs-info">
                                  <strong>{p.name}</strong>
                                  <small>{p.position} · {p.team} vs {p.opponent}</small>
                                </div>
                                <span className="qs-pts mono">{pts} pts</span>
                                <button
                                  className={`qs-add-btn ${isAdded ? 'added' : ''}`}
                                  onClick={() => toggleMyRosterPlayer(p.id)}
                                >
                                  {isAdded ? 'Added ✓' : '+ Add'}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Column 2: Opponent Team Roster */}
                  <div className="h2h-team-roster-card opp-roster">
                    <div className="roster-card-header">
                      <div className="team-badge-group">
                        <span className="team-dot crimson-dot" />
                        <strong>{oppTeamName} (Opponent)</strong>
                      </div>
                      <div className="roster-card-tools">
                        <button
                          className="import-tool-btn"
                          onClick={() => { setImportTarget('opp'); setImportRawText('') }}
                          title="Paste Opponent lineup"
                        >
                          <Icon name="ClipboardPaste" size={13} /> Import Opponent
                        </button>
                        <button
                          className="clear-tool-btn"
                          onClick={() => setOppRosterIds([])}
                          title="Clear Opponent Lineup"
                        >
                          <Icon name="Trash2" size={12} />
                        </button>
                      </div>
                    </div>

                    <div className="roster-slots-stack">
                      {oppOptimized.lineup.map((s, idx) => (
                        <div key={idx} className="h2h-slot-row">
                          <span className={`slot-pill ${s.slot.toLowerCase()}`}>{s.slotLabel}</span>
                          {s.player ? (
                            <div className="slot-player-pill">
                              <div className="p-text">
                                <strong className="p-name">{s.player.name}</strong>
                                <span className="p-sub">{s.player.team} vs {s.player.opponent} · {s.player.position}</span>
                              </div>
                              <span className="p-fpts mono">{s.player.fantasy.points} pts</span>
                              <div className="slot-btn-group">
                                <button
                                  className="slot-swap-btn"
                                  onClick={() => setSlotPickerState({ team: 'opp', slotKey: s.slot, currentId: s.player.id })}
                                  title="Swap Player"
                                >
                                  <Icon name="RefreshCw" size={11} />
                                </button>
                                <button
                                  className="slot-del-btn"
                                  onClick={() => toggleOppRosterPlayer(s.player.id)}
                                  title="Remove"
                                >
                                  <Icon name="X" size={12} />
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              className="slot-empty-pill"
                              onClick={() => setSlotPickerState({ team: 'opp', slotKey: s.slot, currentId: null })}
                            >
                              <Icon name="Plus" size={12} /> Select {s.slotLabel}…
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Quick Add Search for Opponent */}
                    <div className="roster-quick-search">
                      <div className="quick-search-input-wrap">
                        <Icon name="Search" size={13} />
                        <input
                          type="text"
                          placeholder="Quick add player to Opponent…"
                          value={oppSearchQuery}
                          onChange={(e) => setOppSearchQuery(e.target.value)}
                        />
                        <select value={oppPosFilter} onChange={(e) => setOppPosFilter(e.target.value)}>
                          <option value="ALL">All Pos</option>
                          <option value="QB">QB</option>
                          <option value="RB">RB</option>
                          <option value="WR">WR</option>
                          <option value="TE">TE</option>
                          <option value="DST">D/ST</option>
                          <option value="K">K</option>
                        </select>
                      </div>

                      {oppSearchQuery.trim() && (
                        <div className="quick-search-dropdown">
                          {oppSearchPool.map((p) => {
                            const isAdded = oppRosterIds.includes(p.id)
                            const pts = calculateFantasyPoints(p, format)
                            return (
                              <div key={p.id} className="quick-search-row">
                                <div className="qs-info">
                                  <strong>{p.name}</strong>
                                  <small>{p.position} · {p.team} vs {p.opponent}</small>
                                </div>
                                <span className="qs-pts mono">{pts} pts</span>
                                <button
                                  className={`qs-add-btn opp-add ${isAdded ? 'added' : ''}`}
                                  onClick={() => toggleOppRosterPlayer(p.id)}
                                >
                                  {isAdded ? 'Added ✓' : '+ Add'}
                                </button>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {/* Positional Slot-by-Slot Comparison (Tale of the Tape) */}
            <section className="h2h-battles-section">
              <div className="section-head">
                <h3><Icon name="Swords" size={16} /> Slot-by-Slot "Tale of the Tape"</h3>
                <small>Positional point differentials based on current active lineups</small>
              </div>

              <div className="h2h-battle-table">
                <div className="battle-table-header">
                  <span>{myTeamName} Starter</span>
                  <span>Slot</span>
                  <span>{oppTeamName} Starter</span>
                  <span>Matchup Edge</span>
                </div>

                {h2hSim.slotBattles.map((b, idx) => {
                  const pA = b.playerA
                  const pB = b.playerB
                  return (
                    <div key={idx} className={`battle-row ${b.advantage}`}>
                      <div className="player-cell my-player">
                        {pA ? (
                          <>
                            <span className="p-pos mono">{pA.position}</span>
                            <div className="p-info">
                              <strong>{pA.name}</strong>
                              <small>{pA.team} vs {pA.opponent}</small>
                            </div>
                            <b className="p-pts mono">{pA.fantasy.points}</b>
                            <button
                              className="table-swap-btn"
                              onClick={() => setSlotPickerState({ team: 'my', slotKey: pA.position, currentId: pA.id })}
                              title="Swap player"
                            >
                              <Icon name="RefreshCw" size={11} />
                            </button>
                          </>
                        ) : (
                          <button
                            className="empty-slot-btn"
                            onClick={() => setSlotPickerState({ team: 'my', slotKey: b.slotKey || 'FLEX', currentId: null })}
                          >
                            + Empty Slot
                          </button>
                        )}
                      </div>

                      <div className="slot-badge mono">
                        {pA?.position || pB?.position || 'FLEX'}
                      </div>

                      <div className="player-cell opp-player">
                        {pB ? (
                          <>
                            <button
                              className="table-swap-btn"
                              onClick={() => setSlotPickerState({ team: 'opp', slotKey: pB.position, currentId: pB.id })}
                              title="Swap player"
                            >
                              <Icon name="RefreshCw" size={11} />
                            </button>
                            <b className="p-pts mono">{pB.fantasy.points}</b>
                            <div className="p-info text-right">
                              <strong>{pB.name}</strong>
                              <small>{pB.team} vs {pB.opponent}</small>
                            </div>
                            <span className="p-pos mono">{pB.position}</span>
                          </>
                        ) : (
                          <button
                            className="empty-slot-btn"
                            onClick={() => setSlotPickerState({ team: 'opp', slotKey: b.slotKey || 'FLEX', currentId: null })}
                          >
                            + Empty Slot
                          </button>
                        )}
                      </div>

                      <div className={`edge-badge mono ${b.advantage === 'teamA' ? 'edge-plus' : b.advantage === 'teamB' ? 'edge-minus' : 'edge-even'}`}>
                        {b.diff > 0 ? `+${b.diff}` : b.diff === 0 ? 'EVEN' : `${b.diff}`}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Conflict & Correlation Radar */}
            {h2hSim.correlations.length > 0 && (
              <section className="h2h-correlations-section">
                <div className="section-head">
                  <h3><Icon name="Shuffle" size={16} /> In-Game Conflict & Synergy Radar</h3>
                </div>
                <div className="correlation-grid">
                  {h2hSim.correlations.map((c, i) => (
                    <div key={i} className={`correlation-card is-${c.type}`}>
                      <Icon name={c.type === 'hedge' ? 'GitMerge' : 'Flame'} size={16} />
                      <div>
                        <strong>{c.title}</strong>
                        <p>{c.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 2: LINEUP OPTIMIZER & BENCH MANAGEMENT
            ========================================================================= */}
        {activeTab === 'lineup' && (
          <div className="fantasy-lineup-view">
            <div className="lineup-toolbar">
              <div className="optimizer-modes">
                <span className="mode-label">Optimize Goal:</span>
                <button className={`mode-btn ${optimizeMode === 'median' ? 'active' : ''}`} onClick={() => setOptimizeMode('median')}>
                  <Icon name="Target" size={13} /> Max Points
                </button>
                <button className={`mode-btn ${optimizeMode === 'floor' ? 'active' : ''}`} onClick={() => setOptimizeMode('floor')}>
                  <Icon name="Shield" size={13} /> Max Floor (Protect Lead)
                </button>
                <button className={`mode-btn ${optimizeMode === 'ceiling' ? 'active' : ''}`} onClick={() => setOptimizeMode('ceiling')}>
                  <Icon name="Flame" size={13} /> Max Ceiling (Upset Mode)
                </button>
              </div>

              <div className="roster-stats mono">
                <span>Total: <b>{myOptimized.totalPoints} pts</b></span>
                <span>Floor: <b>{myOptimized.totalFloor}</b></span>
                <span>Ceiling: <b>{myOptimized.totalCeiling}</b></span>
              </div>
            </div>

            <div className="lineup-grid-layout">
              {/* Left Column: Starters */}
              <div className="lineup-column starters-col">
                <div className="col-header">
                  <h4><Icon name="Star" size={14} /> Optimal Starting Lineup</h4>
                  <small>{myOptimized.lineup.filter((s) => s.player).length} active starters</small>
                </div>

                <div className="slots-list">
                  {myOptimized.lineup.map((s, idx) => (
                    <div key={idx} className="lineup-slot-card">
                      <span className="slot-tag mono">{s.slotLabel}</span>
                      {s.player ? (
                        <div className="slot-player-body">
                          <div className="p-main">
                            <strong>{s.player.name}</strong>
                            <span className="p-meta">{s.player.team} · {s.player.position} vs {s.player.opponent}</span>
                          </div>
                          <div className="p-metrics">
                            <div className="metric-box">
                              <small>PROJ</small>
                              <b className="mono">{s.player.fantasy.points}</b>
                            </div>
                            <div className="metric-box floor-box">
                              <small>FLOOR</small>
                              <b className="mono">{s.player.fantasy.floor}</b>
                            </div>
                            <div className="metric-box ceil-box">
                              <small>CEIL</small>
                              <b className="mono">{s.player.fantasy.ceiling}</b>
                            </div>
                          </div>
                          <button className="remove-btn" onClick={() => toggleMyRosterPlayer(s.player.id)} title="Remove from roster">
                            <Icon name="X" size={13} />
                          </button>
                        </div>
                      ) : (
                        <div className="slot-empty-body">
                          <span className="empty-text">No eligible {s.slotLabel} on roster</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Bench & Player Add Drawer */}
              <div className="lineup-column bench-col">
                <div className="col-header">
                  <h4><Icon name="Users" size={14} /> Bench ({myOptimized.bench.length})</h4>
                </div>

                <div className="bench-list">
                  {myOptimized.bench.map((p) => (
                    <div key={p.id} className="bench-player-row">
                      <span className="p-pos mono">{p.position}</span>
                      <div className="p-info">
                        <strong>{p.name}</strong>
                        <small>{p.team} vs {p.opponent}</small>
                      </div>
                      <div className="bench-pts mono">{p.fantasy.points} pts</div>
                      <button className="remove-btn" onClick={() => toggleMyRosterPlayer(p.id)} title="Remove from roster">
                        <Icon name="X" size={12} />
                      </button>
                    </div>
                  ))}
                  {!myOptimized.bench.length && (
                    <div className="empty-bench-msg">No players on bench. Add below or import your full league roster!</div>
                  )}
                </div>

                {/* Add Player Search Panel */}
                <div className="add-player-panel">
                  <div className="add-panel-head">
                    <h5>Add Players to Roster</h5>
                    <button className="import-inline-link" onClick={() => { setImportTarget('my'); setImportRawText('') }}>
                      <Icon name="ClipboardPaste" size={12} /> Paste ESPN Lineup
                    </button>
                  </div>
                  <div className="search-bar-inline">
                    <Icon name="Search" size={14} />
                    <input
                      type="text"
                      placeholder="Search player or team…"
                      value={mySearchQuery}
                      onChange={(e) => setMySearchQuery(e.target.value)}
                    />
                    <select value={myPosFilter} onChange={(e) => setMyPosFilter(e.target.value)}>
                      <option value="ALL">All Pos</option>
                      <option value="QB">QB</option>
                      <option value="RB">RB</option>
                      <option value="WR">WR</option>
                      <option value="TE">TE</option>
                      <option value="DST">D/ST</option>
                      <option value="K">K</option>
                    </select>
                  </div>

                  <div className="search-results-list">
                    {mySearchPool.map((p) => {
                      const onMyRoster = myRosterIds.includes(p.id)
                      const onOppRoster = oppRosterIds.includes(p.id)
                      const pts = calculateFantasyPoints(p, format)
                      return (
                        <div key={p.id} className="search-player-item">
                          <div className="p-details">
                            <strong>{p.name}</strong>
                            <small>{p.position} · {p.team} vs {p.opponent}</small>
                          </div>
                          <span className="search-pts mono">{pts} pts</span>
                          <div className="add-actions">
                            <button
                              className={`add-btn my-btn ${onMyRoster ? 'active' : ''}`}
                              onClick={() => toggleMyRosterPlayer(p.id)}
                            >
                              {onMyRoster ? 'My Team ✓' : '+ My Team'}
                            </button>
                            <button
                              className={`add-btn opp-btn ${onOppRoster ? 'active' : ''}`}
                              onClick={() => toggleOppRosterPlayer(p.id)}
                            >
                              {onOppRoster ? 'Opp ✓' : '+ Opp'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 3: TRADE EVALUATOR & FAIR VALUE LAB
            ========================================================================= */}
        {activeTab === 'trade' && (
          <div className="fantasy-trade-view">
            <div className="section-head">
              <h3><Icon name="ArrowLeftRight" size={16} /> Fantasy Trade Analyzer & Value Lab</h3>
              <small>Simulates starting lineup point differentials, floor/ceiling swings, and roster balance</small>
            </div>

            {/* Trade Analysis Verdict Card */}
            <div className="trade-verdict-hero">
              <div className={`verdict-grade-box tone-${tradeEvaluation.tone}`}>
                <span className="grade-badge mono">{tradeEvaluation.grade}</span>
                <div className="verdict-text-block">
                  <h4>{tradeEvaluation.verdict}</h4>
                  <p>{tradeEvaluation.summary}</p>
                </div>
              </div>

              <div className="trade-metrics-stats">
                <div className="trade-stat-item">
                  <small>WEEKLY STARTER DELTA</small>
                  <b className={`mono ${tradeEvaluation.pointDelta >= 0 ? 'tone-good' : 'tone-bad'}`}>
                    {tradeEvaluation.pointDelta >= 0 ? `+${tradeEvaluation.pointDelta}` : tradeEvaluation.pointDelta} pts
                  </b>
                </div>
                <div className="trade-stat-item">
                  <small>FLOOR IMPACT</small>
                  <b className={`mono ${tradeEvaluation.floorDelta >= 0 ? 'tone-good' : 'tone-bad'}`}>
                    {tradeEvaluation.floorDelta >= 0 ? `+${tradeEvaluation.floorDelta}` : tradeEvaluation.floorDelta}
                  </b>
                </div>
                <div className="trade-stat-item">
                  <small>CEILING IMPACT</small>
                  <b className={`mono ${tradeEvaluation.ceilingDelta >= 0 ? 'tone-good' : 'tone-bad'}`}>
                    {tradeEvaluation.ceilingDelta >= 0 ? `+${tradeEvaluation.ceilingDelta}` : tradeEvaluation.ceilingDelta}
                  </b>
                </div>
              </div>
            </div>

            {/* Trade Selector Columns */}
            <div className="trade-columns-grid">
              {/* Column 1: Players You Give */}
              <div className="trade-side-card giving-card">
                <div className="card-head">
                  <div className="badge-title">
                    <span className="trade-dot red-dot" />
                    <strong>Players You Give ({tradeGivePlayers.length})</strong>
                  </div>
                  <span className="side-total-pts mono">-{tradeEvaluation.givingPoints} pts</span>
                </div>

                <div className="trade-players-list">
                  {tradeGivePlayers.map((p) => (
                    <div key={p.id} className="trade-player-row">
                      <span className="p-pos mono">{p.position}</span>
                      <div className="p-info">
                        <strong>{p.name}</strong>
                        <small>{p.team} vs {p.opponent}</small>
                      </div>
                      <span className="p-pts mono">{calculateFantasyPoints(p, format)} pts</span>
                      <button
                        type="button"
                        className="trade-remove-btn"
                        onClick={() => setTradeGiveIds((curr) => curr.filter((id) => id !== p.id))}
                        title="Remove from trade"
                      >
                        <Icon name="X" size={12} />
                      </button>
                    </div>
                  ))}
                  {!tradeGivePlayers.length && (
                    <div className="empty-trade-box">Select players from your roster or pool below to trade away.</div>
                  )}
                </div>

                {/* Quick Add Giving Player with Search & Position Filters */}
                <div className="trade-player-search-panel">
                  <div className="panel-controls-top">
                    <div className="source-toggle mini">
                      <button
                        type="button"
                        className={`source-btn ${tradeSourceGive === 'roster' ? 'active' : ''}`}
                        onClick={() => setTradeSourceGive('roster')}
                      >
                        My Roster ({myRoster.length})
                      </button>
                      <button
                        type="button"
                        className={`source-btn ${tradeSourceGive === 'all' ? 'active' : ''}`}
                        onClick={() => setTradeSourceGive('all')}
                      >
                        All Slate
                      </button>
                    </div>
                    <select
                      className="pos-filter-mini"
                      value={tradePosGive}
                      onChange={(e) => setTradePosGive(e.target.value)}
                    >
                      <option value="ALL">All Pos</option>
                      <option value="QB">QB</option>
                      <option value="RB">RB</option>
                      <option value="WR">WR</option>
                      <option value="TE">TE</option>
                      <option value="DST">D/ST</option>
                      <option value="K">K</option>
                    </select>
                  </div>

                  <div className="search-bar-inline">
                    <Icon name="Search" size={13} />
                    <input
                      type="text"
                      placeholder="Search player to trade away…"
                      value={tradeSearchGive}
                      onChange={(e) => setTradeSearchGive(e.target.value)}
                    />
                    {tradeSearchGive && (
                      <button type="button" className="clear-search-btn" onClick={() => setTradeSearchGive('')}>
                        <Icon name="X" size={11} />
                      </button>
                    )}
                  </div>

                  <div className="trade-candidates-dropdown">
                    {tradeGivePool.map((p) => {
                      const pts = calculateFantasyPoints(p, format)
                      return (
                        <div key={p.id} className="trade-candidate-row">
                          <span className="cand-pos mono">{p.position}</span>
                          <div className="cand-info">
                            <strong>{p.name}</strong>
                            <small>{p.team} vs {p.opponent}</small>
                          </div>
                          <span className="cand-pts mono">{pts} pts</span>
                          <button
                            type="button"
                            className="trade-add-btn give-btn"
                            onClick={() => {
                              setTradeGiveIds((prev) => [...prev, p.id])
                              setTradeSearchGive('')
                            }}
                          >
                            + Give
                          </button>
                        </div>
                      )
                    })}
                    {!tradeGivePool.length && (
                      <div className="empty-pool-msg">No eligible players found. Try searching or change filters.</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Column 2: Players You Receive */}
              <div className="trade-side-card receiving-card">
                <div className="card-head">
                  <div className="badge-title">
                    <span className="trade-dot green-dot" />
                    <strong>Players You Receive ({tradeReceivePlayers.length})</strong>
                  </div>
                  <span className="side-total-pts mono">+{tradeEvaluation.receivingPoints} pts</span>
                </div>

                <div className="trade-players-list">
                  {tradeReceivePlayers.map((p) => (
                    <div key={p.id} className="trade-player-row">
                      <span className="p-pos mono">{p.position}</span>
                      <div className="p-info">
                        <strong>{p.name}</strong>
                        <small>{p.team} vs {p.opponent}</small>
                      </div>
                      <span className="p-pts mono">{calculateFantasyPoints(p, format)} pts</span>
                      <button
                        type="button"
                        className="trade-remove-btn"
                        onClick={() => setTradeReceiveIds((curr) => curr.filter((id) => id !== p.id))}
                        title="Remove from trade"
                      >
                        <Icon name="X" size={12} />
                      </button>
                    </div>
                  ))}
                  {!tradeReceivePlayers.length && (
                    <div className="empty-trade-box">Select incoming target players from slate/opponent below.</div>
                  )}
                </div>

                {/* Quick Add Receiving Player with Search & Position Filters */}
                <div className="trade-player-search-panel">
                  <div className="panel-controls-top">
                    <div className="source-toggle mini">
                      <button
                        type="button"
                        className={`source-btn ${tradeSourceRec === 'opp' ? 'active' : ''}`}
                        onClick={() => setTradeSourceRec('opp')}
                      >
                        Opponent ({oppRoster.length})
                      </button>
                      <button
                        type="button"
                        className={`source-btn ${tradeSourceRec === 'all' ? 'active' : ''}`}
                        onClick={() => setTradeSourceRec('all')}
                      >
                        All Slate
                      </button>
                    </div>
                    <select
                      className="pos-filter-mini"
                      value={tradePosRec}
                      onChange={(e) => setTradePosRec(e.target.value)}
                    >
                      <option value="ALL">All Pos</option>
                      <option value="QB">QB</option>
                      <option value="RB">RB</option>
                      <option value="WR">WR</option>
                      <option value="TE">TE</option>
                      <option value="DST">D/ST</option>
                      <option value="K">K</option>
                    </select>
                  </div>

                  <div className="search-bar-inline">
                    <Icon name="Search" size={13} />
                    <input
                      type="text"
                      placeholder="Search player to RECEIVE…"
                      value={tradeSearchRec}
                      onChange={(e) => setTradeSearchRec(e.target.value)}
                    />
                    {tradeSearchRec && (
                      <button type="button" className="clear-search-btn" onClick={() => setTradeSearchRec('')}>
                        <Icon name="X" size={11} />
                      </button>
                    )}
                  </div>

                  <div className="trade-candidates-dropdown">
                    {tradeRecPool.map((p) => {
                      const pts = calculateFantasyPoints(p, format)
                      return (
                        <div key={p.id} className="trade-candidate-row">
                          <span className="cand-pos mono">{p.position}</span>
                          <div className="cand-info">
                            <strong>{p.name}</strong>
                            <small>{p.team} vs {p.opponent}</small>
                          </div>
                          <span className="cand-pts mono">{pts} pts</span>
                          <button
                            type="button"
                            className="trade-add-btn receive-btn"
                            onClick={() => {
                              setTradeReceiveIds((prev) => [...prev, p.id])
                              setTradeSearchRec('')
                            }}
                          >
                            + Receive
                          </button>
                        </div>
                      )
                    })}
                    {!tradeRecPool.length && (
                      <div className="empty-pool-msg">No eligible players found. Try searching or change filters.</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 4: START / SIT LAB
            ========================================================================= */}
        {activeTab === 'start-sit' && (
          <div className="fantasy-start-sit-view">
            <div className="section-head">
              <h3><Icon name="Scale" size={16} /> Start / Sit Matchup Decision Engine</h3>
              <small>Side-by-side volume, projection range, boom probability, and defensive allowance comparison</small>
            </div>

            {/* Interactive Searchable Player Selector Cards */}
            <div className="start-sit-picker-wrapper">
              {/* Player A Search & Selector Card */}
              <div className="start-sit-picker-card">
                <div className="picker-card-top">
                  <div className="picker-label-group">
                    <span className="player-tag-pill tag-a">PLAYER A</span>
                    <div className="source-toggle mini">
                      <button
                        type="button"
                        className={`source-btn ${startSitSourceA === 'roster' ? 'active' : ''}`}
                        onClick={() => setStartSitSourceA('roster')}
                      >
                        My Roster ({myRoster.length})
                      </button>
                      <button
                        type="button"
                        className={`source-btn ${startSitSourceA === 'all' ? 'active' : ''}`}
                        onClick={() => setStartSitSourceA('all')}
                      >
                        All Slate
                      </button>
                    </div>
                  </div>
                  <select
                    className="pos-filter-mini"
                    value={startSitPosA}
                    onChange={(e) => setStartSitPosA(e.target.value)}
                  >
                    <option value="ALL">All Pos</option>
                    <option value="QB">QB</option>
                    <option value="RB">RB</option>
                    <option value="WR">WR</option>
                    <option value="TE">TE</option>
                    <option value="DST">D/ST</option>
                    <option value="K">K</option>
                  </select>
                </div>

                <div className="search-bar-inline">
                  <Icon name="Search" size={13} />
                  <input
                    type="text"
                    placeholder="Search Player A (name, team)…"
                    value={startSitSearchA}
                    onChange={(e) => setStartSitSearchA(e.target.value)}
                  />
                  {startSitSearchA && (
                    <button type="button" className="clear-search-btn" onClick={() => setStartSitSearchA('')}>
                      <Icon name="X" size={11} />
                    </button>
                  )}
                </div>

                {/* Selected Player Preview Banner */}
                {startSitPlayerA && (
                  <div className="active-player-banner banner-a">
                    <span className="active-pos-pill mono">{startSitPlayerA.position}</span>
                    <div className="active-player-info">
                      <strong>{startSitPlayerA.name}</strong>
                      <small>{startSitPlayerA.team} vs {startSitPlayerA.opponent}</small>
                    </div>
                    <span className="active-player-pts mono">{calculateFantasyPoints(startSitPlayerA, format)} pts</span>
                  </div>
                )}

                {/* Search Results Dropdown / Picker List */}
                <div className="search-candidates-list">
                  {startSitPoolA.map((p) => {
                    const isSelected = startSitPlayerA?.id === p.id
                    const pts = calculateFantasyPoints(p, format)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`candidate-row-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setStartSitPlayerA(p)
                          setStartSitSearchA('')
                        }}
                      >
                        <span className="cand-pos mono">{p.position}</span>
                        <div className="cand-info">
                          <strong>{p.name}</strong>
                          <small>{p.team} vs {p.opponent}</small>
                        </div>
                        <span className="cand-pts mono">{pts} pts</span>
                        <span className="cand-select-tag">{isSelected ? 'Active ✓' : 'Select'}</span>
                      </button>
                    )
                  })}
                  {!startSitPoolA.length && (
                    <div className="empty-pool-msg">No matching players found. Try "All Slate" or clear search.</div>
                  )}
                </div>
              </div>

              {/* Center Swap Action */}
              <div className="start-sit-swap-center">
                <button
                  type="button"
                  className="swap-sides-btn"
                  title="Swap Player A and Player B"
                  onClick={() => {
                    const tmp = startSitPlayerA
                    setStartSitPlayerA(startSitPlayerB)
                    setStartSitPlayerB(tmp)
                  }}
                >
                  <Icon name="ArrowLeftRight" size={16} />
                  <span>SWAP</span>
                </button>
              </div>

              {/* Player B Search & Selector Card */}
              <div className="start-sit-picker-card">
                <div className="picker-card-top">
                  <div className="picker-label-group">
                    <span className="player-tag-pill tag-b">PLAYER B</span>
                    <div className="source-toggle mini">
                      <button
                        type="button"
                        className={`source-btn ${startSitSourceB === 'roster' ? 'active' : ''}`}
                        onClick={() => setStartSitSourceB('roster')}
                      >
                        My Roster ({myRoster.length})
                      </button>
                      <button
                        type="button"
                        className={`source-btn ${startSitSourceB === 'all' ? 'active' : ''}`}
                        onClick={() => setStartSitSourceB('all')}
                      >
                        All Slate
                      </button>
                    </div>
                  </div>
                  <select
                    className="pos-filter-mini"
                    value={startSitPosB}
                    onChange={(e) => setStartSitPosB(e.target.value)}
                  >
                    <option value="ALL">All Pos</option>
                    <option value="QB">QB</option>
                    <option value="RB">RB</option>
                    <option value="WR">WR</option>
                    <option value="TE">TE</option>
                    <option value="DST">D/ST</option>
                    <option value="K">K</option>
                  </select>
                </div>

                <div className="search-bar-inline">
                  <Icon name="Search" size={13} />
                  <input
                    type="text"
                    placeholder="Search Player B (name, team)…"
                    value={startSitSearchB}
                    onChange={(e) => setStartSitSearchB(e.target.value)}
                  />
                  {startSitSearchB && (
                    <button type="button" className="clear-search-btn" onClick={() => setStartSitSearchB('')}>
                      <Icon name="X" size={11} />
                    </button>
                  )}
                </div>

                {/* Selected Player Preview Banner */}
                {startSitPlayerB && (
                  <div className="active-player-banner banner-b">
                    <span className="active-pos-pill mono">{startSitPlayerB.position}</span>
                    <div className="active-player-info">
                      <strong>{startSitPlayerB.name}</strong>
                      <small>{startSitPlayerB.team} vs {startSitPlayerB.opponent}</small>
                    </div>
                    <span className="active-player-pts mono">{calculateFantasyPoints(startSitPlayerB, format)} pts</span>
                  </div>
                )}

                {/* Search Results Dropdown / Picker List */}
                <div className="search-candidates-list">
                  {startSitPoolB.map((p) => {
                    const isSelected = startSitPlayerB?.id === p.id
                    const pts = calculateFantasyPoints(p, format)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`candidate-row-btn ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setStartSitPlayerB(p)
                          setStartSitSearchB('')
                        }}
                      >
                        <span className="cand-pos mono">{p.position}</span>
                        <div className="cand-info">
                          <strong>{p.name}</strong>
                          <small>{p.team} vs {p.opponent}</small>
                        </div>
                        <span className="cand-pts mono">{pts} pts</span>
                        <span className="cand-select-tag">{isSelected ? 'Active ✓' : 'Select'}</span>
                      </button>
                    )
                  })}
                  {!startSitPoolB.length && (
                    <div className="empty-pool-msg">No matching players found. Try "All Slate" or clear search.</div>
                  )}
                </div>
              </div>
            </div>

            {startSitComp && (
              <div className="start-sit-result-card">
                <div className="recommendation-banner">
                  <Icon name="CheckCircle2" size={20} />
                  <div>
                    <h4>{startSitComp.summary}</h4>
                    <small>Based on {FANTASY_SCORING_PRESETS[format]?.label} volume projections and defensive allowance</small>
                  </div>
                </div>

                <div className="comparison-cards-grid">
                  {/* Player A Card */}
                  <div className={`comp-player-card ${startSitComp.recommended?.id === startSitComp.playerA.id ? 'is-recommended' : ''}`}>
                    <div className="card-head">
                      {startSitComp.recommended?.id === startSitComp.playerA.id && <span className="start-badge">START</span>}
                      <h3>{startSitComp.playerA.name}</h3>
                      <p>{startSitComp.playerA.position} · {startSitComp.playerA.team} vs {startSitComp.playerA.opponent}</p>
                    </div>

                    <div className="comp-score-hero">
                      <b className="mono">{startSitComp.playerA.fantasy.points}</b>
                      <small>Projected points</small>
                    </div>

                    <div className="comp-stat-grid">
                      <div className="stat-row"><span>Floor (10th %)</span><b className="mono">{startSitComp.playerA.fantasy.floor}</b></div>
                      <div className="stat-row"><span>Ceiling (90th %)</span><b className="mono">{startSitComp.playerA.fantasy.ceiling}</b></div>
                      <div className="stat-row"><span>Touchdown Chance</span><b className="mono">{(startSitComp.playerA.fantasy.stats.anytimeProb * 100).toFixed(1)}%</b></div>
                      <div className="stat-row"><span>Boom Probability</span><b className="mono">{(startSitComp.playerA.fantasy.boomProb * 100).toFixed(0)}%</b></div>
                    </div>
                  </div>

                  {/* Player B Card */}
                  <div className={`comp-player-card ${startSitComp.recommended?.id === startSitComp.playerB.id ? 'is-recommended' : ''}`}>
                    <div className="card-head">
                      {startSitComp.recommended?.id === startSitComp.playerB.id && <span className="start-badge">START</span>}
                      <h3>{startSitComp.playerB.name}</h3>
                      <p>{startSitComp.playerB.position} · {startSitComp.playerB.team} vs {startSitComp.playerB.opponent}</p>
                    </div>

                    <div className="comp-score-hero">
                      <b className="mono">{startSitComp.playerB.fantasy.points}</b>
                      <small>Projected points</small>
                    </div>

                    <div className="comp-stat-grid">
                      <div className="stat-row"><span>Floor (10th %)</span><b className="mono">{startSitComp.playerB.fantasy.floor}</b></div>
                      <div className="stat-row"><span>Ceiling (90th %)</span><b className="mono">{startSitComp.playerB.fantasy.ceiling}</b></div>
                      <div className="stat-row"><span>Touchdown Chance</span><b className="mono">{(startSitComp.playerB.fantasy.stats.anytimeProb * 100).toFixed(1)}%</b></div>
                      <div className="stat-row"><span>Boom Probability</span><b className="mono">{(startSitComp.playerB.fantasy.boomProb * 100).toFixed(0)}%</b></div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 5: WAIVER RADAR
            ========================================================================= */}
        {activeTab === 'waivers' && (
          <div className="fantasy-waivers-view">
            <div className="section-head">
              <div>
                <h3><Icon name="Radar" size={16} /> Waiver Wire & Free Agent Breakout Radar</h3>
                <small>Unowned players ranked by red-zone opportunity spikes and role-expansion signals</small>
              </div>
              <div className="waiver-count-pill mono">
                {filteredWaiverCandidates.length} Targets Found
              </div>
            </div>

            {/* Waiver Search & Multi-Filter Toolbar */}
            <div className="waiver-toolbar-card">
              <div className="waiver-search-input-wrap">
                <Icon name="Search" size={14} />
                <input
                  type="text"
                  placeholder="Search waiver targets by player name, team, opponent, or signals…"
                  value={waiverSearchQuery}
                  onChange={(e) => setWaiverSearchQuery(e.target.value)}
                />
                {waiverSearchQuery && (
                  <button type="button" className="clear-search-btn" onClick={() => setWaiverSearchQuery('')}>
                    <Icon name="X" size={12} />
                  </button>
                )}
              </div>

              <div className="waiver-filters-row">
                <div className="filter-chips-group">
                  <span className="filter-label">Pos:</span>
                  {['ALL', 'QB', 'RB', 'WR', 'TE', 'DST', 'K'].map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      className={`filter-chip ${waiverPosFilter === pos ? 'active' : ''}`}
                      onClick={() => setWaiverPosFilter(pos)}
                    >
                      {pos}
                    </button>
                  ))}
                </div>

                <div className="filter-chips-group">
                  <span className="filter-label">Priority:</span>
                  {[
                    { id: 'ALL', label: 'All Tiers' },
                    { id: 'HIGH_PRIORITY', label: 'High Priority' },
                    { id: 'TARGET', label: 'Target' },
                    { id: 'STASH', label: 'Stash' },
                  ].map((tier) => (
                    <button
                      key={tier.id}
                      type="button"
                      className={`filter-chip tier-chip ${waiverRatingFilter === tier.id ? 'active' : ''}`}
                      onClick={() => setWaiverRatingFilter(tier.id)}
                    >
                      {tier.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Waiver Cards Grid */}
            <div className="waiver-cards-grid">
              {filteredWaiverCandidates.map((p) => {
                const signals = p.fantasy.signals || []
                return (
                  <div key={p.id} className={`waiver-card is-${p.breakoutRating.toLowerCase()}`}>
                    <div className="waiver-card-header">
                      <div>
                        <strong>{p.name}</strong>
                        <span className="p-meta">{p.position} · {p.team} vs {p.opponent}</span>
                      </div>
                      <span className={`breakout-badge ${p.breakoutRating.toLowerCase()}`}>
                        {p.breakoutRating.replace('_', ' ')}
                      </span>
                    </div>

                    <div className="waiver-pts-row">
                      <div className="pts-block">
                        <small>PROJ</small>
                        <b className="mono">{p.fantasy.points} pts</b>
                      </div>
                      <div className="pts-block">
                        <small>CEILING</small>
                        <b className="mono">{p.fantasy.ceiling} pts</b>
                      </div>
                      <div className="pts-block">
                        <small>TD CHANCE</small>
                        <b className="mono">{(p.fantasy.stats.anytimeProb * 100).toFixed(0)}%</b>
                      </div>
                    </div>

                    <div className="waiver-signals-list">
                      {signals.slice(0, 2).map((s) => (
                        <span key={s.key} className={`sig-pill tone-${s.tone}`}>
                          {s.text}
                        </span>
                      ))}
                      {!signals.length && <span className="sig-pill neutral">Steady depth volume</span>}
                    </div>

                    <button
                      type="button"
                      className={`claim-btn ${myRosterIds.includes(p.id) ? 'active' : ''}`}
                      onClick={() => toggleMyRosterPlayer(p.id)}
                    >
                      <Icon name="Plus" size={13} /> Add to My Roster
                    </button>
                  </div>
                )
              })}
            </div>

            {!filteredWaiverCandidates.length && (
              <div className="empty-waiver-state">
                <Icon name="Search" size={24} />
                <h4>No waiver targets match your search</h4>
                <p>Try clearing your search query or changing position/tier filters.</p>
                <button
                  type="button"
                  className="reset-filters-btn"
                  onClick={() => {
                    setWaiverSearchQuery('')
                    setWaiverPosFilter('ALL')
                    setWaiverRatingFilter('ALL')
                  }}
                >
                  Reset All Filters
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* =========================================================================
          MODAL 1: IMPORT ESPN / YAHOO / SLEEPER ROSTER
          ========================================================================= */}
      {importTarget && (
        <div className="fantasy-modal-backdrop" onClick={() => setImportTarget(null)}>
          <div className="fantasy-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <Icon name="ClipboardPaste" size={18} />
                <h3>Import {importTarget === 'my' ? myTeamName : oppTeamName} Roster</h3>
              </div>
              <button className="modal-close-btn" onClick={() => setImportTarget(null)}>
                <Icon name="X" size={16} />
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-instructions">
                Copy your lineup from <strong>ESPN Fantasy</strong>, <strong>Yahoo</strong>, or <strong>Sleeper</strong> and paste it below. We'll automatically identify each player on this week's NFL slate.
              </p>

              <div className="sample-paste-chips">
                <span className="sample-label">Try sample:</span>
                <button
                  type="button"
                  className="sample-btn"
                  onClick={() => setImportRawText(`QB Josh Allen BUF\nRB Derrick Henry BAL\nRB Javonte Williams DEN\nWR Davante Adams NYJ\nWR Chris Olave NO\nTE Sam LaPorta DET\nFLEX Cam Skattebo AZ\nDST Baltimore Ravens D/ST\nK Justin Tucker`)}
                >
                  ESPN 9-Man Sample
                </button>
                <button
                  type="button"
                  className="sample-btn"
                  onClick={() => setImportRawText(`Jalen Hurts\nSaquon Barkley\nTyreek Hill\nDallas Goedert\nJahmyr Gibbs\nDetroit Lions D/ST`)}
                >
                  Name List Sample
                </button>
              </div>

              <textarea
                className="import-textarea"
                rows={7}
                placeholder="Paste roster text here (e.g. 'QB Josh Allen', 'RB Derrick Henry', etc.)…"
                value={importRawText}
                onChange={(e) => setImportRawText(e.target.value)}
                autoFocus
              />

              {parsedImport && (
                <div className="import-analysis-box">
                  <div className="analysis-summary">
                    <span className="matched-count">
                      <Icon name="CheckCircle2" size={14} /> {parsedImport.count} Players Matched
                    </span>
                    {parsedImport.unmatched.length > 0 && (
                      <span className="unmatched-count">
                        {parsedImport.unmatched.length} unmatched (byes / unlisted)
                      </span>
                    )}
                  </div>

                  <div className="matched-tags-list">
                    {parsedImport.matchedPlayers.map((p) => (
                      <span key={p.id} className="matched-player-tag">
                        {p.name} ({p.position} · {p.team})
                      </span>
                    ))}
                  </div>

                  {parsedImport.unmatched.length > 0 && (
                    <div className="unmatched-warning">
                      <small>Could not match: {parsedImport.unmatched.slice(0, 4).join(', ')}</small>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setImportTarget(null)}>
                Cancel
              </button>
              <button
                className="btn-apply"
                disabled={!parsedImport || parsedImport.count === 0}
                onClick={handleApplyImport}
              >
                Apply Lineup ({parsedImport?.count || 0} Players)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 2: SLOT-BY-SLOT PLAYER PICKER / SWAP
          ========================================================================= */}
      {slotPickerState && (
        <div className="fantasy-modal-backdrop" onClick={() => setSlotPickerState(null)}>
          <div className="fantasy-modal-card picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <Icon name="UserCheck" size={18} />
                <h3>Select {slotPickerState.slotKey} for {slotPickerState.team === 'my' ? myTeamName : oppTeamName}</h3>
              </div>
              <button className="modal-close-btn" onClick={() => setSlotPickerState(null)}>
                <Icon name="X" size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div className="picker-search-bar">
                <Icon name="Search" size={14} />
                <input
                  type="text"
                  placeholder={`Search ${slotPickerState.slotKey} players (name, team)…`}
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  autoFocus
                />
                {pickerSearch && (
                  <button type="button" className="clear-search-btn" onClick={() => setPickerSearch('')}>
                    <Icon name="X" size={12} />
                  </button>
                )}
              </div>

              {/* Flex Sub-Position Filter Chips */}
              {slotPickerState.slotKey === 'FLEX' && (
                <div className="picker-flex-chips">
                  {['ALL', 'RB', 'WR', 'TE'].map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      className={`flex-pos-chip ${pickerPosFilter === pos ? 'active' : ''}`}
                      onClick={() => setPickerPosFilter(pos)}
                    >
                      {pos === 'ALL' ? 'All Flex' : pos}
                    </button>
                  ))}
                </div>
              )}

              <div className="picker-candidates-list">
                {slotPickerPool.map((p) => {
                  const isCurrent = slotPickerState.currentId === p.id
                  return (
                    <div
                      key={p.id}
                      className={`picker-candidate-row ${isCurrent ? 'is-selected' : ''}`}
                      onClick={() => handleSelectSlotPlayer(p)}
                    >
                      <span className="p-pos mono">{p.position}</span>
                      <div className="p-main-info">
                        <strong>{p.name}</strong>
                        <small>{p.team} vs {p.opponent} · Team Total {p.teamTotal || '24.0'}</small>
                      </div>
                      <div className="p-proj-nums">
                        <span className="proj-pts mono">{p.fantasy.points} pts</span>
                        <small className="proj-rng mono">{p.fantasy.floor} - {p.fantasy.ceiling}</small>
                      </div>
                      <button type="button" className="select-candidate-btn">
                        {isCurrent ? 'Active ✓' : 'Select'}
                      </button>
                    </div>
                  )
                })}
                {!slotPickerPool.length && (
                  <div className="empty-search-msg">No eligible {slotPickerState.slotKey} found matching criteria.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
