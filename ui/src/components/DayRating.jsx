import Icon from './Icon.jsx'

// Day Rating — a slate-level "should I play HR props today?" signal. The
// server score stays authoritative; this component makes its decision and
// three inputs scannable without asking users to interpret a star scale.
const TONE = { 5: 'great', 4: 'good', 3: 'ok', 2: 'soft', 1: 'skip' }

function signalFor(stars) {
  if (stars >= 4) return 'PLAY'
  if (stars === 3) return 'LEAN'
  return 'PASS'
}

export default function DayRating({ rating, estHRs }) {
  if (!rating || !rating.stars) return null
  const { stars, score, verdict, factors = {}, primePerGame, softArmPct, favGames, games } = rating
  const signal = signalFor(stars)
  const pct = (x) => `${Math.round(Math.max(0, Math.min(1, x ?? 0)) * 100)}%`
  const scoreValue = Math.round(Math.max(0, Math.min(100, score ?? 0)))
  const hasEst = Number.isFinite(estHRs) && estHRs > 0
  const estStr = hasEst ? `~${estHRs.toFixed(1)}` : null

  return (
    <details className={`day-rating tone-${TONE[stars] || 'ok'}`}>
      <summary className="dr-sum">
        <span className="dr-score" title={`Slate score ${scoreValue} out of 100`}>
          <strong>{scoreValue}</strong>
          <small>/100</small>
        </span>
        <span className="dr-signal-copy">
          <span className="dr-head">Day Rating</span>
          <span className="dr-signal-line">
            <b className="dr-signal">{signal}</b>
            <span className="dr-verdict">{verdict}</span>
          </span>
        </span>
        {estStr && (
          <span className="dr-est-hrs" title="Projected home runs across today's starting lineups — sum of each starter's calibrated HR probability">
            <small>PROJECTED</small>
            <b>{estStr} HR</b>
          </span>
        )}
        <Icon name="ChevronDown" size={15} className="dr-chev" />
      </summary>

      <div className="dr-body">
        <p className="dr-cap">
          The slate scores <b>{scoreValue}/100</b> from pitching, run environment, and qualified power bats.
        </p>
        <div className="dr-bars">
          <Factor icon="Crosshair" label="Soft pitching" value={factors.pitching} sub={`${softArmPct ?? 0}% of starters HR-prone`} />
          <Factor icon="Wind" label="Park & weather" value={factors.environment} sub={`${favGames ?? 0}/${games ?? 0} games favorable`} />
          <Factor icon="Flame" label="Bat supply" value={factors.supply} sub={`${primePerGame ?? 0} PRIME bats/game`} />
        </div>
        {estStr && <p className="dr-projection">Model projects <b>{estStr} home runs</b> across today’s starting lineups.</p>}
      </div>
    </details>
  )

  function Factor({ icon, label, value, sub }) {
    const valuePct = pct(value)
    return (
      <div className="dr-row">
        <span className="dr-factor-head">
          <Icon name={icon} size={13} />
          <span className="dr-k">{label}</span>
          <b className="dr-factor-value mono">{valuePct}</b>
        </span>
        <span className="dr-bar" aria-label={`${label} ${valuePct}`}>
          <span className="dr-fill" style={{ width: valuePct }} />
        </span>
        <span className="dr-sub">{sub}</span>
      </div>
    )
  }
}
