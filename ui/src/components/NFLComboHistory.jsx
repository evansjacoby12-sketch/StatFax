import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import Select from './Select.jsx'
import SportMultiFilterBar from './SportMultiFilterBar.jsx'
import { buildNFLComboBoard, NFL_COMBO_STRATEGIES, americanOdds } from '../lib/nflCombos.js'
import { NFL_TEAM_COLORS } from './NFLBoard.jsx'

const pct = (value, digits = 1) => value == null ? '—' : `${(value * 100).toFixed(digits)}%`
const odds = (value) => value == null ? '—' : value > 0 ? `+${value}` : String(value)

/**
 * Normalize week strings into uniform labels (e.g. 3 -> "Week 3", "Week 3" -> "Week 3")
 */
function normalizeWeek(val) {
  if (val == null) return 'Current Slate'
  const str = String(val).trim()
  if (/^week\s*\d+$/i.test(str)) {
    const num = str.replace(/\D+/g, '')
    return `Week ${num}`
  }
  if (/^\d+$/.test(str)) {
    return `Week ${str}`
  }
  return str
}

/**
 * Strictly grade an individual leg against live data or frozen outcomes.
 */
function gradeLeg(leg, player) {
  if (!player) {
    const rawStatus = leg.status || 'pending'
    return {
      ...leg,
      status: rawStatus,
      outcome: leg.outcome ?? (rawStatus === 'won' ? 1 : rawStatus === 'lost' ? 0 : null),
    }
  }

  const live = player.live || {}
  const touchdowns = Number(live.stats?.totalTds || 0)
  const isFinal = Boolean(live.isFinal)
  const isLive = Boolean(live.isLive)

  if (leg.marketId === 'anytime_td') {
    if (touchdowns >= 1) return { ...leg, status: 'won', outcome: 1, touchdowns, firstTd: Boolean(live.isFirstTdScorer) }
    if (isFinal) return { ...leg, status: 'lost', outcome: 0, touchdowns, firstTd: Boolean(live.isFirstTdScorer) }
    return { ...leg, status: isLive ? 'live' : 'pending', touchdowns }
  }

  if (leg.marketId === 'two_plus_td') {
    if (touchdowns >= 2) return { ...leg, status: 'won', outcome: 1, touchdowns, firstTd: Boolean(live.isFirstTdScorer) }
    if (isFinal) return { ...leg, status: 'lost', outcome: 0, touchdowns, firstTd: Boolean(live.isFirstTdScorer) }
    return { ...leg, status: isLive ? 'live' : 'pending', touchdowns }
  }

  if (leg.marketId === 'first_td') {
    if (live.isFirstTdScorer) return { ...leg, status: 'won', outcome: 1, touchdowns, firstTd: true }
    if (isFinal && live.firstTdKnown) return { ...leg, status: 'lost', outcome: 0, touchdowns, firstTd: false }
    if (isFinal && !live.firstTdKnown) return { ...leg, status: 'void', outcome: null, touchdowns, firstTd: null }
    return { ...leg, status: isLive ? 'live' : 'pending', touchdowns }
  }

  return { ...leg, status: leg.status || 'pending' }
}

/**
 * Strictly grade a multi-leg combination.
 * A parlay is WON IF AND ONLY IF EVERY SINGLE LEG is won (or void/push).
 * If EVEN ONE LEG is lost, the entire parlay is LOST.
 */
function gradeCombo(combo, playerMap) {
  const legs = (combo.legs || []).map((leg) => {
    const player = playerMap.get(`${leg.gameId}:${leg.playerId}`) ||
      playerMap.get(leg.playerId) ||
      playerMap.get(String(leg.playerId).replace(/^espn-/, '')) ||
      playerMap.get(`espn-${leg.playerId}`)
    return gradeLeg(leg, player)
  })

  const wonCount = legs.filter((l) => l.status === 'won').length
  const lostCount = legs.filter((l) => l.status === 'lost').length
  const liveCount = legs.filter((l) => l.status === 'live').length
  const totalLegs = legs.length

  // Strict outcome determination
  const isLost = lostCount > 0
  const isWon = !isLost && totalLegs > 0 && legs.every((l) => l.status === 'won' || l.status === 'void' || l.status === 'push') && wonCount > 0
  const isVoid = !isLost && !isWon && totalLegs > 0 && legs.every((l) => l.status === 'void' || l.status === 'push')
  const isLive = !isLost && !isWon && !isVoid && (liveCount > 0 || wonCount > 0)

  const status = isLost ? 'lost' : isWon ? 'won' : isVoid ? 'void' : isLive ? 'live' : 'pending'
  const outcome = status === 'won' ? 1 : status === 'lost' ? 0 : null

  return {
    ...combo,
    legs,
    status,
    outcome,
    wonLegsCount: wonCount,
    lostLegsCount: lostCount,
    totalLegs,
    brier: outcome == null || !Number.isFinite(Number(combo.probability)) ? null : (Number(combo.probability) - outcome) ** 2,
  }
}

export default function NFLComboHistory({ snapshot, onSelectPlayer }) {
  // Filter states
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all') // 'all', 'won', 'lost', 'live', 'pending'
  const [weekFilters, setWeekFilters] = useState(() => {
    const w = normalizeWeek(snapshot?.meta?.week)
    return w && w !== 'Current Slate' ? new Set([w]) : new Set()
  })
  const [strategyFilters, setStrategyFilters] = useState(() => new Set())
  const [legFilters, setLegFilters] = useState(() => new Set())
  const [teamFilters, setTeamFilters] = useState(() => new Set())
  const [positionFilters, setPositionFilters] = useState(() => new Set())
  const [scopeFilters, setScopeFilters] = useState(() => new Set())
  const [topPicksOnly, setTopPicksOnly] = useState(true) // Defaults to Top Pick (Rank 1) per board
  const [highProbOnly, setHighProbOnly] = useState(false)
  const [sortBy, setSortBy] = useState('recent')
  const [copiedId, setCopiedId] = useState(null)

  // Map of current snapshot players for dynamic real-time grading
  const playerMap = useMemo(() => {
    const map = new Map()
    for (const p of snapshot?.players || []) {
      if (p.gameId && p.id) {
        map.set(`${p.gameId}:${p.id}`, p)
        map.set(`${p.gameId}:${String(p.id).replace(/^espn-/, '')}`, p)
      }
      if (p.id) {
        map.set(p.id, p)
        map.set(String(p.id).replace(/^espn-/, ''), p)
        map.set(`espn-${p.id}`, p)
      }
    }
    return map
  }, [snapshot])

  // Flatten and strictly grade all combos with board and week metadata
  const allCombos = useMemo(() => {
    const stackBoards = snapshot?.modelTracking?.stackBoards || snapshot?.comboHistory || []
    const list = []

    if (stackBoards.length > 0) {
      for (const board of stackBoards) {
        const rawCombos = board.closing?.combos || board.opened?.combos || []
        for (let idx = 0; idx < rawCombos.length; idx++) {
          const rawCombo = rawCombos[idx]
          const graded = gradeCombo(rawCombo, playerMap)
          list.push({
            ...graded,
            rank: rawCombo.rank ?? (idx + 1),
            boardId: board.id,
            week: normalizeWeek(board.week || snapshot?.meta?.week),
            season: board.season || snapshot?.meta?.season || 2026,
            strategy: graded.strategy || board.strategy,
            scope: graded.scope || board.scope,
            boardStrategy: board.strategy,
            boardScope: board.scope,
            boardLegs: board.legs,
            settledAt: graded.settledAt || board.settledAt,
          })
        }
      }
    } else if (snapshot?.players?.length) {
      // If tracking boards not yet populated, generate boards from current snapshot
      for (const strat of NFL_COMBO_STRATEGIES) {
        for (const scope of strat.scopes) {
          for (const legs of [2, 3, 4]) {
            const board = buildNFLComboBoard(snapshot, { strategy: strat.id, scope, legs, minGrade: 'LEAN', allowFinal: true })
            const rawCombos = board.combos || []
            for (let idx = 0; idx < rawCombos.length; idx++) {
              const rawCombo = rawCombos[idx]
              const graded = gradeCombo(rawCombo, playerMap)
              list.push({
                ...graded,
                rank: rawCombo.rank ?? (idx + 1),
                boardId: `${strat.id}:${scope}:${legs}`,
                week: normalizeWeek(snapshot?.meta?.week),
                season: snapshot?.meta?.season || 2026,
                strategy: strat.id,
                scope,
                boardStrategy: strat.id,
                boardScope: scope,
                boardLegs: legs,
              })
            }
          }
        }
      }
    }

    return list
  }, [snapshot, playerMap])

  // Extract unique option pools from all combos
  const weeks = useMemo(() => [...new Set(allCombos.map((c) => c.week))].filter(Boolean).sort().reverse(), [allCombos])
  const teams = useMemo(() => {
    const set = new Set()
    for (const c of allCombos) {
      for (const l of c.legs || []) if (l.team) set.add(l.team)
    }
    return [...set].sort()
  }, [allCombos])
  const positions = useMemo(() => {
    const set = new Set()
    for (const c of allCombos) {
      for (const l of c.legs || []) if (l.position) set.add(l.position)
    }
    return ['QB', 'RB', 'WR', 'TE'].filter((p) => set.has(p))
  }, [allCombos])

  // Global counts for status rail
  const statusCounts = useMemo(() => {
    const counts = { all: allCombos.length, won: 0, lost: 0, live: 0, pending: 0 }
    for (const c of allCombos) {
      if (c.status === 'won') counts.won++
      else if (c.status === 'lost') counts.lost++
      else if (c.status === 'live') counts.live++
      else counts.pending++
    }
    return counts
  }, [allCombos])

  const weekCounts = useMemo(() => {
    const counts = {}
    for (const c of allCombos) {
      if (c.week) counts[c.week] = (counts[c.week] || 0) + 1
    }
    return counts
  }, [allCombos])

  const stratCounts = useMemo(() => {
    const counts = {}
    for (const c of allCombos) {
      if (c.strategy) counts[c.strategy] = (counts[c.strategy] || 0) + 1
    }
    return counts
  }, [allCombos])

  const teamCounts = useMemo(() => {
    const counts = {}
    for (const c of allCombos) {
      for (const l of c.legs || []) {
        if (l.team) counts[l.team] = (counts[l.team] || 0) + 1
      }
    }
    return counts
  }, [allCombos])

  // Filtered combos with STRICT parlay win verification
  const filteredCombos = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    const result = allCombos.filter((combo) => {
      // STRICT OUTCOME RULE:
      // When 'won' is requested, the combo status MUST be 'won' (all legs hit).
      // If a combo has ANY lost leg (e.g. 1/2 hit, 2/4 hit), it is lost and must be excluded!
      if (statusFilter === 'won') {
        if (combo.status !== 'won' || combo.wonLegsCount !== combo.totalLegs || combo.lostLegsCount > 0) {
          return false
        }
      } else if (statusFilter === 'lost') {
        if (combo.status !== 'lost') return false
      } else if (statusFilter === 'live') {
        if (combo.status !== 'live') return false
      } else if (statusFilter === 'pending') {
        if (combo.status !== 'pending' && combo.status !== 'open') return false
      }

      // Top picks only toggle (Rank 1 showcase combos)
      if (topPicksOnly && (combo.rank || 1) > 1) return false

      // High prob toggle
      if (highProbOnly && Number(combo.probability || 0) < 0.25) return false

      // Week filters
      if (weekFilters.size > 0 && !weekFilters.has(combo.week)) return false

      // Strategy filters
      if (strategyFilters.size > 0 && !strategyFilters.has(combo.strategy)) return false

      // Leg count filters
      if (legFilters.size > 0 && !legFilters.has(String(combo.legs?.length))) return false

      // Scope filters
      if (scopeFilters.size > 0 && !scopeFilters.has(combo.scope)) return false

      // Team filters
      if (teamFilters.size > 0) {
        const hasTeam = combo.legs?.some((l) => teamFilters.has(l.team))
        if (!hasTeam) return false
      }

      // Position filters
      if (positionFilters.size > 0) {
        const hasPos = combo.legs?.some((l) => positionFilters.has(l.position))
        if (!hasPos) return false
      }

      // Search query
      if (query) {
        const matchPlayer = combo.legs?.some((l) =>
          l.name?.toLowerCase().includes(query) ||
          l.team?.toLowerCase().includes(query) ||
          l.opponent?.toLowerCase().includes(query) ||
          l.position?.toLowerCase().includes(query) ||
          l.marketLabel?.toLowerCase().includes(query)
        )
        const matchStrategy = combo.strategy?.toLowerCase().includes(query)
        const matchRationale = combo.rationale?.toLowerCase().includes(query)
        if (!matchPlayer && !matchStrategy && !matchRationale) return false
      }

      return true
    })

    // Sorting
    return result.sort((a, b) => {
      if (sortBy === 'prob-desc') return (b.probability || 0) - (a.probability || 0)
      if (sortBy === 'prob-asc') return (a.probability || 0) - (b.probability || 0)
      if (sortBy === 'legs-desc') return (b.legs?.length || 0) - (a.legs?.length || 0)
      if (sortBy === 'legs-asc') return (a.legs?.length || 0) - (b.legs?.length || 0)
      return (b.settledAt || '').localeCompare(a.settledAt || '') || (b.boardId || '').localeCompare(a.boardId || '')
    })
  }, [allCombos, searchQuery, statusFilter, topPicksOnly, highProbOnly, weekFilters, strategyFilters, legFilters, scopeFilters, teamFilters, positionFilters, sortBy])

  // Summary metrics for current filtered subset
  const stats = useMemo(() => {
    const settled = filteredCombos.filter((c) => c.status === 'won' || c.status === 'lost')
    const won = settled.filter((c) => c.status === 'won' && c.wonLegsCount === c.totalLegs).length
    const hitRate = settled.length ? won / settled.length : null
    const brierSum = settled.reduce((sum, c) => sum + (c.brier || 0), 0)
    const brier = settled.length ? brierSum / settled.length : null
    const live = filteredCombos.filter((c) => c.status === 'live').length
    const pending = filteredCombos.filter((c) => c.status === 'pending' || c.status === 'open').length

    // Breakdown by strategy (using overall dataset for stable hit rate baseline)
    const byStrat = {}
    for (const s of NFL_COMBO_STRATEGIES) {
      const stratCombos = allCombos.filter((c) => (c.strategy === s.id || c.boardStrategy === s.id) && (c.status === 'won' || c.status === 'lost'))
      const stratWon = stratCombos.filter((c) => c.status === 'won' && c.wonLegsCount === c.totalLegs).length
      byStrat[s.id] = {
        label: s.label,
        icon: s.icon,
        settled: stratCombos.length,
        won: stratWon,
        hitRate: stratCombos.length ? stratWon / stratCombos.length : null,
      }
    }

    return { total: filteredCombos.length, settled: settled.length, won, hitRate, brier, live, pending, byStrat }
  }, [filteredCombos, allCombos])

  // Helper toggle functions
  const toggleSet = (setter, val) => {
    setter((current) => {
      const next = new Set(current)
      next.has(val) ? next.delete(val) : next.add(val)
      return next
    })
  }

  const isWinnersOnly = statusFilter === 'won'

  const hasActiveFilters = weekFilters.size > 0 ||
    strategyFilters.size > 0 ||
    legFilters.size > 0 ||
    teamFilters.size > 0 ||
    positionFilters.size > 0 ||
    scopeFilters.size > 0 ||
    statusFilter !== 'all' ||
    topPicksOnly ||
    highProbOnly ||
    searchQuery.trim().length > 0

  const clearAllFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setWeekFilters(new Set())
    setStrategyFilters(new Set())
    setLegFilters(new Set())
    setTeamFilters(new Set())
    setPositionFilters(new Set())
    setScopeFilters(new Set())
    setTopPicksOnly(false)
    setHighProbOnly(false)
    setSortBy('recent')
  }

  // Filter definitions for SportMultiFilterBar
  const multiBarFilters = [
    {
      id: 'weeks',
      label: 'Weeks',
      value: weekFilters,
      onChange: setWeekFilters,
      options: [
        { value: '', label: 'All Weeks' },
        ...weeks.map((w) => ({ value: w, label: `${w} (${weekCounts[w] || 0})` })),
      ],
    },
    {
      id: 'strategies',
      label: 'Strategies',
      value: strategyFilters,
      onChange: setStrategyFilters,
      options: [
        { value: '', label: 'All Strategies' },
        ...NFL_COMBO_STRATEGIES.map((s) => ({ value: s.id, label: `${s.label} (${stratCounts[s.id] || 0})` })),
      ],
    },
    {
      id: 'legs',
      label: 'Leg Count',
      value: legFilters,
      onChange: setLegFilters,
      options: [
        { value: '', label: 'All Leg Counts' },
        { value: '2', label: '2-Leg Parlay' },
        { value: '3', label: '3-Leg Parlay' },
        { value: '4', label: '4-Leg Parlay' },
      ],
    },
    {
      id: 'teams',
      label: 'Teams',
      value: teamFilters,
      onChange: setTeamFilters,
      options: [
        { value: '', label: 'All Teams' },
        ...teams.map((t) => ({ value: t, label: `${t} (${teamCounts[t] || 0})` })),
      ],
    },
    {
      id: 'positions',
      label: 'Positions',
      value: positionFilters,
      onChange: setPositionFilters,
      options: [
        { value: '', label: 'All Positions' },
        ...positions.map((p) => ({ value: p, label: p })),
      ],
    },
    {
      id: 'scopes',
      label: 'Scope',
      value: scopeFilters,
      onChange: setScopeFilters,
      options: [
        { value: '', label: 'All Scopes' },
        { value: 'slate-wide', label: 'Cross-Game' },
        { value: 'same-game', label: 'Same-Game (SGP)' },
      ],
    },
  ]

  const handleShareCombo = async (combo) => {
    const lines = [
      `🏈 NFL Parlay · ${combo.week || 'Week'} · ${combo.strategy} (${combo.legs.length} legs)`,
      `Model Prob: ${pct(combo.probability)} · Outcome: ${combo.status === 'won' ? 'CASHED ✅' : combo.status === 'lost' ? 'MISSED ❌' : 'LIVE ⚡'}`,
      ...combo.legs.map((l, i) => `${i + 1}. ${l.name} (${l.team}) - ${l.marketLabel || l.marketId}: ${l.status === 'won' ? '✅ HIT' : l.status === 'lost' ? '❌ MISS' : '⏳ PENDING'}`),
      'statfax.online/nfl',
    ]
    const text = lines.join('\n')
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text)
        setCopiedId(combo.id)
        setTimeout(() => setCopiedId(null), 2000)
      }
    } catch {}
  }

  const handleExportCSV = () => {
    const headers = ['week', 'strategy', 'scope', 'legs_count', 'model_probability', 'status', 'outcome', 'brier', 'settled_at', 'legs_summary']
    const rows = filteredCombos.map((c) => {
      const legsSummary = c.legs.map((l) => `${l.name} (${l.team} ${l.marketId}: ${l.status})`).join('; ')
      return [
        c.week,
        c.strategy,
        c.scope,
        c.legs.length,
        c.probability != null ? c.probability.toFixed(4) : '',
        c.status,
        c.outcome != null ? c.outcome : '',
        c.brier != null ? c.brier.toFixed(4) : '',
        c.settledAt || '',
        `"${legsSummary.replace(/"/g, '""')}"`,
      ].join(',')
    })
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `statfax-nfl-combo-history-${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className="nfl-combo-history-hub">
      {/* Top Accountability Stats Strip */}
      <div className="nfl-combo-history-stats">
        <div className="nfl-stat-box">
          <small>Settled Combos</small>
          <strong className="mono">{stats.won} / {stats.settled}</strong>
          <span>{stats.hitRate != null ? `${pct(stats.hitRate)} hit rate` : 'Awaiting settlement'}</span>
        </div>
        <div className="nfl-stat-box">
          <small>Live / Pending</small>
          <strong className="mono">{stats.live} live · {stats.pending} pre</strong>
          <span>Active slate progress</span>
        </div>
        <div className="nfl-stat-box">
          <small>Brier Calibration</small>
          <strong className="mono">{stats.brier != null ? stats.brier.toFixed(3) : '—'}</strong>
          <span>{stats.brier != null && stats.brier <= 0.15 ? 'Sharp calibration' : 'Walk-forward tracking'}</span>
        </div>
        <div className="nfl-stat-box">
          <small>Strategies Active</small>
          <strong className="mono">{NFL_COMBO_STRATEGIES.length} models</strong>
          <span>Diversified parlay recipes</span>
        </div>
      </div>

      {/* Outcome / Status Segmented Rail */}
      <div className="nfl-combo-status-rail" role="group" aria-label="Filter by outcome status">
        <button
          type="button"
          className={`nfl-status-pill-btn ${statusFilter === 'all' ? 'is-active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          <Icon name="Layers" size={12} />
          <span>All Combos</span>
          <b className="mono">{statusCounts.all}</b>
        </button>
        <button
          type="button"
          className={`nfl-status-pill-btn is-won ${statusFilter === 'won' ? 'is-active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'won' ? 'all' : 'won')}
        >
          <Icon name="Trophy" size={12} />
          <span>Cashed / Won</span>
          <b className="mono">{statusCounts.won}</b>
        </button>
        <button
          type="button"
          className={`nfl-status-pill-btn is-live ${statusFilter === 'live' ? 'is-active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'live' ? 'all' : 'live')}
        >
          <Icon name="Activity" size={12} />
          <span>Still Alive</span>
          <b className="mono">{statusCounts.live}</b>
        </button>
        <button
          type="button"
          className={`nfl-status-pill-btn is-lost ${statusFilter === 'lost' ? 'is-active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'lost' ? 'all' : 'lost')}
        >
          <Icon name="XCircle" size={12} />
          <span>Lost / Missed</span>
          <b className="mono">{statusCounts.lost}</b>
        </button>
        <button
          type="button"
          className={`nfl-status-pill-btn is-pending ${statusFilter === 'pending' ? 'is-active' : ''}`}
          onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
        >
          <Icon name="Clock" size={12} />
          <span>Pending</span>
          <b className="mono">{statusCounts.pending}</b>
        </button>
      </div>

      {/* Strategy Performance Badges / Quick-Filter Pills */}
      <div className="nfl-combo-strategy-pills">
        {NFL_COMBO_STRATEGIES.map((strat) => {
          const s = stats.byStrat?.[strat.id]
          const isSelected = strategyFilters.has(strat.id)
          return (
            <button
              key={strat.id}
              type="button"
              className={`nfl-strat-chip is-${strat.riskTone || 'accent'} ${isSelected ? 'is-active' : ''}`}
              onClick={() => toggleSet(setStrategyFilters, strat.id)}
              aria-pressed={isSelected}
              title={`Filter by ${strat.label}`}
            >
              <Icon name={strat.icon} size={12} />
              <span>{strat.label}</span>
              {s?.settled > 0 ? (
                <b className="mono">{s.won}/{s.settled} ({pct(s.hitRate, 0)})</b>
              ) : (
                <small className="mono">Tracking</small>
              )}
            </button>
          )
        })}
      </div>

      {/* Multi-Filter Bar with Search, Dropdowns, Toggles and Export */}
      <div className="nfl-filter-controls-wrap">
        <SportMultiFilterBar
          sport="nfl"
          className="nfl-combo-filters"
          searchValue={searchQuery}
          onSearch={setSearchQuery}
          searchPlaceholder="Search player, team, matchup, or strategy…"
          filters={multiBarFilters}
        >
          {/* Sort Dropdown */}
          <div className="nfl-sort-select-wrap">
            <Select
              value={sortBy}
              onChange={setSortBy}
              ariaLabel="Sort combo history"
              title="Sort combinations"
              options={[
                { value: 'recent', label: 'Sort: Most Recent' },
                { value: 'prob-desc', label: 'Sort: Highest Prob' },
                { value: 'prob-asc', label: 'Sort: Lowest Prob' },
                { value: 'legs-desc', label: 'Sort: Legs (High to Low)' },
                { value: 'legs-asc', label: 'Sort: Legs (Low to High)' },
              ]}
            />
          </div>

          {/* Top Picks Only Quick Toggle Button */}
          <button
            type="button"
            className={`nfl-two-filter ${topPicksOnly ? 'active' : ''}`}
            aria-pressed={topPicksOnly}
            onClick={() => setTopPicksOnly((curr) => !curr)}
            title="Filter Top #1 showcase combo per board configuration"
          >
            <Icon name="Crown" size={13} />
            Top picks only
          </button>

          {/* Winners Only Quick Toggle Button */}
          <button
            type="button"
            className={`nfl-two-filter ${isWinnersOnly ? 'active' : ''}`}
            aria-pressed={isWinnersOnly}
            onClick={() => setStatusFilter(isWinnersOnly ? 'all' : 'won')}
            title="Filter only cashed winning parlays"
          >
            <Icon name="Trophy" size={13} />
            Winners only
          </button>

          {/* High Prob Toggle */}
          <button
            type="button"
            className={`nfl-two-filter ${highProbOnly ? 'active' : ''}`}
            aria-pressed={highProbOnly}
            onClick={() => setHighProbOnly((curr) => !curr)}
            title="Filter combos with 25%+ model probability"
          >
            <Icon name="Flame" size={13} />
            25%+ prob
          </button>

          {/* CSV Export Button */}
          <button
            type="button"
            className="nfl-combo-export-btn"
            onClick={handleExportCSV}
            disabled={!filteredCombos.length}
            title="Export filtered combination history to CSV"
          >
            <Icon name="Download" size={13} /> Export CSV
          </button>
        </SportMultiFilterBar>
      </div>

      {/* Active Filter Chips & Counter Strip */}
      {hasActiveFilters && (
        <div className="nfl-active-filters-strip">
          <div className="nfl-active-chips-list">
            <span className="nfl-active-label">Active filters:</span>
            {topPicksOnly && (
              <span className="nfl-active-chip is-gold">
                Top Picks (Rank 1)
                <button type="button" onClick={() => setTopPicksOnly(false)} aria-label="Show all diversified variations">
                  <Icon name="X" size={11} />
                </button>
              </span>
            )}
            {searchQuery.trim() && (
              <span className="nfl-active-chip">
                Search: "{searchQuery.trim()}"
                <button type="button" onClick={() => setSearchQuery('')} aria-label="Clear search query">
                  <Icon name="X" size={11} />
                </button>
              </span>
            )}
            {statusFilter !== 'all' && (
              <span className={`nfl-active-chip ${statusFilter === 'won' ? 'is-gold' : ''}`}>
                {statusFilter === 'won' ? 'Winners Only' : `Status: ${statusFilter.toUpperCase()}`}
                <button type="button" onClick={() => setStatusFilter('all')} aria-label="Clear status filter">
                  <Icon name="X" size={11} />
                </button>
              </span>
            )}
            {highProbOnly && (
              <span className="nfl-active-chip is-flame">
                25%+ Probability
                <button type="button" onClick={() => setHighProbOnly(false)} aria-label="Clear high prob filter">
                  <Icon name="X" size={11} />
                </button>
              </span>
            )}
            {[...weekFilters].map((w) => (
              <span key={w} className="nfl-active-chip">
                {w}
                <button type="button" onClick={() => toggleSet(setWeekFilters, w)} aria-label={`Remove ${w} filter`}>
                  <Icon name="X" size={11} />
                </button>
              </span>
            ))}
            {[...strategyFilters].map((sId) => {
              const s = NFL_COMBO_STRATEGIES.find((item) => item.id === sId)
              return (
                <span key={sId} className="nfl-active-chip">
                  {s?.label || sId}
                  <button type="button" onClick={() => toggleSet(setStrategyFilters, sId)} aria-label={`Remove ${s?.label || sId} filter`}>
                    <Icon name="X" size={11} />
                  </button>
                </span>
              )
            })}
            {[...legFilters].map((l) => (
              <span key={l} className="nfl-active-chip">
                {l}-Leg
                <button type="button" onClick={() => toggleSet(setLegFilters, l)} aria-label={`Remove ${l}-leg filter`}>
                  <Icon name="X" size={11} />
                </button>
              </span>
            ))}
            {[...teamFilters].map((t) => (
              <span key={t} className="nfl-active-chip">
                Team: {t}
                <button type="button" onClick={() => toggleSet(setTeamFilters, t)} aria-label={`Remove ${t} filter`}>
                  <Icon name="X" size={11} />
                </button>
              </span>
            ))}
            {[...positionFilters].map((p) => (
              <span key={p} className="nfl-active-chip">
                Pos: {p}
                <button type="button" onClick={() => toggleSet(setPositionFilters, p)} aria-label={`Remove ${p} filter`}>
                  <Icon name="X" size={11} />
                </button>
              </span>
            ))}
            {[...scopeFilters].map((sc) => (
              <span key={sc} className="nfl-active-chip">
                Scope: {sc === 'same-game' ? 'SGP' : 'Cross-Game'}
                <button type="button" onClick={() => toggleSet(setScopeFilters, sc)} aria-label={`Remove ${sc} filter`}>
                  <Icon name="X" size={11} />
                </button>
              </span>
            ))}
            <button type="button" className="nfl-clear-filters-btn" onClick={clearAllFilters}>
              Clear all filters
            </button>
          </div>
          <span className="nfl-results-counter mono">
            Showing <b>{filteredCombos.length}</b> of <b>{allCombos.length}</b> combinations
          </span>
        </div>
      )}

      {/* Combos History List / Grid */}
      {filteredCombos.length > 0 ? (
        <div className="nfl-combo-history-grid">
          {filteredCombos.map((combo, comboIdx) => {
            const isWon = combo.status === 'won'
            const isLost = combo.status === 'lost'
            const isLive = combo.status === 'live'
            const isPending = combo.status === 'pending' || combo.status === 'open'
            const strat = NFL_COMBO_STRATEGIES.find((s) => s.id === combo.strategy)
            const fairOdds = combo.probability > 0 ? americanOdds(1 / combo.probability) : null
            const wonLegsCount = combo.wonLegsCount ?? (combo.legs || []).filter((l) => l.status === 'won').length
            const totalLegs = combo.totalLegs ?? combo.legs?.length ?? 0

            return (
              <article
                key={`${combo.boardId || 'board'}-${combo.id || combo.strategy}-${comboIdx}`}
                className={`nfl-combo-history-card ${isWon ? 'is-won' : isLost ? 'is-lost' : isLive ? 'is-live' : 'is-pending'}`}
              >
                {/* Card Header */}
                <header className="nfl-combo-card-head">
                  <div className="nfl-combo-card-badges">
                    <span className={`nfl-combo-strategy-tag is-${strat?.riskTone || 'accent'}`}>
                      <Icon name={strat?.icon || 'Layers'} size={11} />
                      {strat?.label || combo.strategy}
                    </span>
                    <span className="nfl-combo-pill">{totalLegs}-Leg</span>
                    <span className="nfl-combo-pill">{combo.scope === 'same-game' ? 'Same-Game' : 'Cross-Game'}</span>
                    <span className="nfl-combo-pill">{combo.week}</span>
                  </div>
                  <div className="nfl-combo-status-badge">
                    {isWon && <span className="status-pill won"><Icon name="Trophy" size={11} /> CASHED ({wonLegsCount}/{totalLegs})</span>}
                    {isLost && <span className="status-pill lost"><Icon name="X" size={11} /> MISSED ({wonLegsCount}/{totalLegs})</span>}
                    {isLive && <span className="status-pill live"><Icon name="Activity" size={11} /> ALIVE ({wonLegsCount}/{totalLegs})</span>}
                    {isPending && <span className="status-pill pending"><Icon name="Clock" size={11} /> PREGAME</span>}
                  </div>
                </header>

                {/* Hit Progress Bar */}
                <div className="nfl-combo-progress-bar" title={`${wonLegsCount} of ${totalLegs} legs hit`}>
                  <div
                    className={`nfl-combo-progress-fill ${isWon ? 'is-won' : isLost ? 'is-lost' : isLive ? 'is-live' : 'is-pending'}`}
                    style={{ width: `${totalLegs > 0 ? (wonLegsCount / totalLegs) * 100 : 0}%` }}
                  />
                </div>

                {/* Metrics Strip */}
                <div className="nfl-combo-metrics-strip">
                  <div>
                    <small>Model Prob</small>
                    <strong className="mono">{pct(combo.probability)}</strong>
                  </div>
                  {fairOdds != null && (
                    <div>
                      <small>Fair Odds</small>
                      <strong className="mono">{odds(fairOdds)}</strong>
                    </div>
                  )}
                  {combo.score != null && (
                    <div>
                      <small>Score</small>
                      <strong className="mono">{combo.score}</strong>
                    </div>
                  )}
                  {combo.brier != null && (
                    <div>
                      <small>Brier</small>
                      <strong className="mono">{combo.brier.toFixed(3)}</strong>
                    </div>
                  )}
                </div>

                {/* Legs List */}
                <ul className="nfl-combo-legs-list">
                  {(combo.legs || []).map((leg, legIdx) => {
                    const legWon = leg.status === 'won'
                    const legLost = leg.status === 'lost'
                    const legLive = leg.status === 'live'
                    const teamColor = NFL_TEAM_COLORS?.[leg.team] || 'var(--accent)'

                    return (
                      <li
                        key={`${combo.id}-${leg.key || legIdx}`}
                        className={`nfl-combo-leg-item ${legWon ? 'is-won' : legLost ? 'is-lost' : legLive ? 'is-live' : 'is-pending'}`}
                        onClick={() => {
                          const playerObj = snapshot?.players?.find((p) => p.id === leg.playerId || p.id === `espn-${leg.playerId}` || String(p.id).replace(/^espn-/, '') === String(leg.playerId))
                          if (playerObj && onSelectPlayer) onSelectPlayer(playerObj)
                        }}
                        role="button"
                        tabIndex={0}
                        title={`Open ${leg.name} research drawer`}
                      >
                        <div className="leg-identity">
                          <span className="leg-num mono">{legIdx + 1}.</span>
                          <span className="leg-team-dot" style={{ background: teamColor }} />
                          <div>
                            <strong>{leg.name}</strong>
                            <small>{leg.position} · {leg.team}{leg.opponent ? ` vs ${leg.opponent}` : ''}</small>
                          </div>
                        </div>

                        <div className="leg-meta">
                          <span className="leg-market">{leg.marketLabel || leg.marketId?.replace('_', ' ')}</span>
                          {leg.touchdowns != null && <span className="leg-score mono" title="Observed Touchdowns">{leg.touchdowns} TD</span>}
                          {leg.probability != null && <span className="leg-prob mono">{pct(leg.probability)}</span>}
                          <span className={`leg-outcome-chip ${legWon ? 'won' : legLost ? 'lost' : legLive ? 'live' : 'pending'}`}>
                            {legWon ? '✅ Won' : legLost ? '❌ Miss' : legLive ? '⚡ Live' : '⏳ Pre'}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>

                {/* Card Footer */}
                <footer className="nfl-combo-card-footer">
                  {combo.rationale && <p className="nfl-combo-rationale"><Icon name="Sparkles" size={11} /> {combo.rationale}</p>}
                  <div className="nfl-combo-actions">
                    <button type="button" onClick={(e) => { e.stopPropagation(); handleShareCombo(combo) }} title="Copy combo text">
                      <Icon name={copiedId === combo.id ? 'Check' : 'Share2'} size={12} /> {copiedId === combo.id ? 'Copied' : 'Share'}
                    </button>
                  </div>
                </footer>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="nfl-combo-history-empty">
          <Icon name="Layers" size={26} />
          <b>No combo history matching current filters</b>
          <span>Adjust the week, strategy, team, or status filters above to view historical parlay records.</span>
          {hasActiveFilters && (
            <button type="button" className="nfl-clear-filters-btn-empty" onClick={clearAllFilters}>
              Reset all filters
            </button>
          )}
        </div>
      )}
    </div>
  )
}
