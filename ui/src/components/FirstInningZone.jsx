import { useMemo, useState } from 'react'
import Icon from './Icon.jsx'
import CommandTabs from './CommandTabs.jsx'
import CallKey from './CallKey.jsx'
import { pct } from '../lib/format.js'

const SIDE_TABS = [
  { id: 'all', label: 'All games', icon: 'ListFilter' },
  { id: 'nrfi', label: 'NRFI leans', icon: 'Shield' },
  { id: 'yrfi', label: 'YRFI leans', icon: 'Flame' },
]

const TIME_OPTIONS = [
  { id: 'all', label: 'All start times' },
  { id: 'next3', label: 'Next 3 hours' },
  { id: 'early', label: 'Early games' },
  { id: 'late', label: 'Late games' },
]

function gameTime(value) {
  if (!value || Number.isNaN(Date.parse(value))) return 'TBD'
  return new Date(value).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function timeMatches(gameDate, filter) {
  if (filter === 'all') return true
  const start = Date.parse(gameDate)
  if (Number.isNaN(start)) return false
  if (filter === 'next3') {
    const now = Date.now()
    return start >= now && start <= now + (3 * 60 * 60 * 1000)
  }
  const hour = new Date(start).getHours()
  return filter === 'early' ? hour < 19 : hour >= 19
}

function lineupLabel(first) {
  const sources = [first?.halves?.away?.lineupSource, first?.halves?.home?.lineupSource]
  if (sources.every((source) => source === 'confirmed')) return 'Confirmed'
  if (sources.some((source) => source === 'roster-fallback')) return 'Limited'
  return 'Projected'
}

function tierLabel(first) {
  if (first?.tier === 'strong') return `Strong ${first.lean.toUpperCase()}`
  if (first?.tier === 'lean') return `Lean ${first.lean.toUpperCase()}`
  if (first?.tier === 'limited') return `Limited ${first.lean.toUpperCase()}`
  return `Watch ${first?.lean?.toUpperCase() || ''}`.trim()
}

function rankedRows(games, projections) {
  return (games || [])
    .filter((game) => game?.isLive !== true && game?.isFinal !== true)
    .map((game) => ({
      game,
      projection: projections?.[game.gamePk] || null,
      first: projections?.[game.gamePk]?.firstInning || null,
    }))
    .filter((row) => row.first)
    .sort((left, right) => (
      (right.first.selectedProbability ?? 0) - (left.first.selectedProbability ?? 0)
      || Date.parse(left.game.gameDate) - Date.parse(right.game.gameDate)
      || Number(left.game.gamePk) - Number(right.game.gamePk)
    ))
}

function Highlight({ label, row }) {
  if (!row) {
    return (
      <span className="fi-highlight is-empty">
        <small>{label}</small>
        <b>No qualified lean</b>
      </span>
    )
  }
  return (
    <span className={`fi-highlight is-${row.first.lean}`}>
      <small>{label}</small>
      <b>{row.game.awayTeam?.abbr} @ {row.game.homeTeam?.abbr}</b>
      <strong className="mono">{pct(row.first.selectedProbability, 1)}</strong>
    </span>
  )
}

function HalfPanel({ label, half }) {
  const hitterNames = (half?.topOrder || []).map((hitter) => hitter.name).join(' · ')
  const pitcherMicro = half?.pitcherFirstInning
  const pitcherSample = pitcherMicro?.sampleMode === 'blended-previous-season'
    ? `${pitcherMicro.currentWindowStarts} current + ${pitcherMicro.previousSeasonStartsUsed} prior starts`
    : pitcherMicro?.currentWindowStarts
      ? `${pitcherMicro.currentWindowStarts} current starts`
      : 'Micro split unavailable'
  return (
    <section className="fi-half">
      <header>
        <span>
          <small>{label}</small>
          <b>{half?.team?.abbr || '—'} pressure</b>
        </span>
        <strong className="mono">{pct(half?.scoringProbability, 1)}</strong>
      </header>
      <div className="fi-half-matchup">
        <span>
          <small>Top three</small>
          <b>{hitterNames || 'Projected order unavailable'}</b>
        </span>
        <Icon name="ArrowRight" size={13} />
        <span>
          <small>Opposing starter</small>
          <b>{half?.opposingStarter?.name || 'Starter TBD'}</b>
          <small>{pitcherSample}</small>
        </span>
      </div>
      <dl>
        <div><dt>Half runs</dt><dd className="mono">{half?.expectedRuns?.toFixed?.(2) ?? '—'}</dd></div>
        <div><dt>Top-3 split OBP</dt><dd className="mono">{half?.topOrderObp?.toFixed?.(3) ?? '—'}</dd></div>
        <div><dt>Offense score · L30</dt><dd className="mono">{pct(half?.historical?.offenseRecent30ScoreRate, 1)}</dd></div>
        <div><dt>Team YRFI · L30</dt><dd className="mono">{pct(half?.historical?.teamRecent30YrfiRate, 1)}</dd></div>
        <div><dt>First-inning FIP</dt><dd className="mono">{pitcherMicro?.firstInningFip?.toFixed?.(2) ?? '—'}</dd></div>
        <div><dt>1st-through K/9</dt><dd className="mono">{pitcherMicro?.ttoK9?.toFixed?.(1) ?? '—'}</dd></div>
        <div><dt>1st-through BB/9</dt><dd className="mono">{pitcherMicro?.ttoBb9?.toFixed?.(1) ?? '—'}</dd></div>
        <div>
          <dt>Collision edge</dt>
          <dd className="mono">
            {Number.isFinite(half?.collision?.edge)
              ? `${half.collision.edge >= 0 ? '+' : ''}${half.collision.edge.toFixed(2)}`
              : '—'}
          </dd>
        </div>
        <div><dt>History coverage</dt><dd className="mono">{pct(half?.historical?.coverage, 0)}</dd></div>
      </dl>
    </section>
  )
}

function MatchupRow({ row, rank, expanded, onToggle, evaluation }) {
  const { game, projection, first } = row
  const lineups = lineupLabel(first)
  const isReady = lineups === 'Confirmed'
  const leanProbability = first.lean === 'nrfi'
    ? first.nrfiProbability
    : first.yrfiProbability
  return (
    <article className={`fi-game is-${first.lean} tier-${first.tier} ${expanded ? 'is-open' : ''}`}>
      <button
        type="button"
        className="fi-game-main"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={`first-inning-${game.gamePk}`}
      >
        <span className="fi-rank mono">#{rank}</span>
        <span className="fi-matchup">
          <span>
            <b>{game.awayTeam?.abbr} @ {game.homeTeam?.abbr}</b>
            <small>{gameTime(game.gameDate)} · {game.venueName || 'Venue TBD'}</small>
          </span>
          <span className="fi-starters">
            {projection?.probablePitchers?.away?.name || 'Away SP TBD'} vs {projection?.probablePitchers?.home?.name || 'Home SP TBD'}
          </span>
          <em className={isReady ? 'is-ready' : lineups === 'Limited' ? 'is-limited' : ''}>
            <Icon name={isReady ? 'CircleCheck' : 'Clock3'} size={10} /> {lineups}
          </em>
        </span>
        <span className="fi-prob-pair">
          <span><small>NRFI</small><b className="mono">{pct(first.nrfiProbability, 1)}</b></span>
          <span><small>YRFI</small><b className="mono">{pct(first.yrfiProbability, 1)}</b></span>
          <span><small>Proj. 1R</small><b className="mono">{first.projectedRuns?.toFixed?.(2) ?? '—'}</b></span>
        </span>
        <span className={`fi-decision is-${first.lean}`}>
          <small>Model lean</small>
          <b>{tierLabel(first)}</b>
          <span className="mono">{pct(leanProbability, 1)}</span>
        </span>
        <span className="fi-coverage">
          <small>Coverage</small>
          <b className="mono">{pct(first.coverage, 0)}</b>
        </span>
        <Icon className="fi-chevron" name="ChevronDown" size={15} />
      </button>

      {expanded && (
        <div className="fi-game-detail" id={`first-inning-${game.gamePk}`}>
          <div className="fi-halves">
            <HalfPanel label="Top 1st" half={first.halves?.away} />
            <HalfPanel label="Bottom 1st" half={first.halves?.home} />
          </div>
          <div className="fi-case-caution">
            <span className="fi-case">
              <Icon name="CircleCheck" size={13} />
              <span><small>Case</small><b>{first.evidence?.case}</b></span>
            </span>
            <span className="fi-caution">
              <Icon name="TriangleAlert" size={13} />
              <span><small>Caution</small><b>{first.evidence?.caution}</b></span>
            </span>
          </div>
          <footer>
            <span>
              <Icon name="Database" size={12} />
              {first.validation?.historicalSeasons || 0}-season backbone · {first.validation?.historicalGames || 0} walk-forward games
            </span>
            <span>
              <Icon name="Activity" size={12} />
              Forward monitor: {evaluation?.firstInning?.sample || 0} settled calls
            </span>
            <span><Icon name="Info" size={12} /> Model lean only · NRFI/YRFI prices unavailable</span>
          </footer>
        </div>
      )}
    </article>
  )
}

export default function FirstInningZone({
  games = [],
  gameProjections = {},
  gameProjectionEvaluation = null,
  historicalValidation = null,
}) {
  const [side, setSide] = useState('all')
  const [qualifiedOnly, setQualifiedOnly] = useState(false)
  const [lineupReadyOnly, setLineupReadyOnly] = useState(false)
  const [timeFilter, setTimeFilter] = useState('all')
  const [expandedGame, setExpandedGame] = useState(null)

  const allRows = useMemo(
    () => rankedRows(games, gameProjections),
    [games, gameProjections],
  )
  const rows = useMemo(() => allRows.filter((row) => (
    (side === 'all' || row.first.lean === side)
    && (!qualifiedOnly || row.first.qualified === true)
    && (!lineupReadyOnly || lineupLabel(row.first) === 'Confirmed')
    && timeMatches(row.game.gameDate, timeFilter)
  )), [allRows, side, qualifiedOnly, lineupReadyOnly, timeFilter])
  const strongestNrfi = allRows.find((row) => row.first.lean === 'nrfi' && row.first.qualified)
    || allRows.find((row) => row.first.lean === 'nrfi')
  const strongestYrfi = allRows.find((row) => row.first.lean === 'yrfi' && row.first.qualified)
    || allRows.find((row) => row.first.lean === 'yrfi')
  const historicalStatus = historicalValidation?.status || 'collecting'
  const watchNrfiPromotion = gameProjectionEvaluation?.firstInning?.watchNrfiPromotion || null
  const promotionMinimum = watchNrfiPromotion?.policy?.minimumSettled || 20
  const promotionTarget = watchNrfiPromotion?.policy?.targetSettled || 30

  return (
    <div className="fi-zone">
      <section className="fi-method">
        <div className="fi-method-highlights">
          <Highlight label="Strongest NRFI lean" row={strongestNrfi} />
          <Highlight label="Strongest YRFI lean" row={strongestYrfi} />
        </div>
        <div className="fi-method-model">
          <small>Model engine</small>
          <b>Forecast V9 + 1st Inning Layer</b>
          {watchNrfiPromotion && (
            <span
              className={`fi-promotion ${watchNrfiPromotion.status}`}
              title={`WATCH NRFI needs ${promotionMinimum} settled calls to be considered and ${promotionTarget} for a mature sample.`}
            >
              <Icon name={watchNrfiPromotion.status === 'eligible' ? 'CircleCheck' : 'Lock'} size={11} />
              WATCH NRFI gate · {watchNrfiPromotion.wins}-{watchNrfiPromotion.losses}
              {' '}· {watchNrfiPromotion.sample}/{promotionMinimum} settled
              {' '}· {watchNrfiPromotion.status.toUpperCase()}
            </span>
          )}
          <span><Icon name="Shield" size={11} /> Advisory only · {historicalStatus} history gate</span>
          <span><Icon name="Activity" size={11} /> Pitcher micro active · team L30 shadow-tested</span>
        </div>
      </section>

      <CallKey className="fi-call-key" />

      <section className="fi-controls" aria-label="First inning filters">
        <CommandTabs
          className="fi-side-tabs"
          label="First inning decision side"
          value={side}
          onChange={setSide}
          tabs={SIDE_TABS}
        />
        <div className="fi-filter-actions">
          <button
            type="button"
            className={qualifiedOnly ? 'on' : ''}
            onClick={() => setQualifiedOnly((value) => !value)}
            aria-pressed={qualifiedOnly}
          >
            <Icon name="CheckCircle2" size={13} /> Qualified only
          </button>
          <button
            type="button"
            className={lineupReadyOnly ? 'on' : ''}
            onClick={() => setLineupReadyOnly((value) => !value)}
            aria-pressed={lineupReadyOnly}
          >
            <Icon name="UserRoundCheck" size={13} /> Lineup ready
          </button>
          <label>
            <Icon name="Clock3" size={13} />
            <select value={timeFilter} onChange={(event) => setTimeFilter(event.target.value)}>
              {TIME_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <div className="fi-list-head">
        <span>{rows.length} of {allRows.length} matchups</span>
        <span>Ranked by model separation · prices excluded</span>
      </div>

      {rows.length ? (
        <section className="fi-game-list" aria-label="Ranked first inning matchups">
          {rows.map((row, index) => (
            <MatchupRow
              key={row.game.gamePk}
              row={row}
              rank={allRows.indexOf(row) + 1}
              expanded={expandedGame === row.game.gamePk}
              onToggle={() => setExpandedGame((current) => (
                current === row.game.gamePk ? null : row.game.gamePk
              ))}
              evaluation={gameProjectionEvaluation}
            />
          ))}
        </section>
      ) : (
        <section className="fi-empty">
          <Icon name="TimerReset" size={24} />
          <b>{allRows.length ? 'No matchups clear these filters.' : 'First-inning projections are not in this slate yet.'}</b>
          <span>{allRows.length ? 'Relax one filter to restore games.' : 'Build a fresh slate to generate Forecast V9 first-inning probabilities.'}</span>
        </section>
      )}

      <footer className="fi-zone-footer">
        <span><Icon name="Shield" size={12} /> NRFI and YRFI are complementary model probabilities.</span>
        <span><Icon name="GitBranch" size={12} /> Top and bottom halves are combined independently until joint calibration is proven.</span>
        <span><Icon name="CircleDollarSign" size={12} /> No value or EV claim is made without a sportsbook price.</span>
      </footer>
    </div>
  )
}
