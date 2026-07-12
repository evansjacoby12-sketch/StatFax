import Icon from './Icon.jsx'

// Day Rating — a 1-5★ "should I bet HR props today?" gauge. Server-computed from
// homer-prone pitching (the big lever), park/weather, and elite-bat supply.
// Expand for the factor breakdown. Color tracks the verdict: green-ish = lean in.
const TONE = { 5: 'great', 4: 'good', 3: 'ok', 2: 'soft', 1: 'skip' }

function Stars({ n }) {
  return (
    <span className="dr-stars" aria-label={`${n} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`dr-star ${i <= n ? 'on' : ''}`} style={{ '--i': i }}>★</span>
      ))}
    </span>
  )
}

export default function DayRating({ rating, estHRs }) {
  if (!rating || !rating.stars) return null
  const { stars, score, verdict, factors = {}, primePerGame, softArmPct, favGames, games } = rating
  const pct = (x) => `${Math.round((x ?? 0) * 100)}%`
  const hasEst = Number.isFinite(estHRs) && estHRs > 0
  const estStr = hasEst ? `~${estHRs.toFixed(1)}` : null
  return (
    <details className={`day-rating tone-${TONE[stars] || 'ok'}`}>
      <summary className="dr-sum">
        <Icon name="Gauge" size={14} />
        <span className="dr-head">Day Rating</span>
        <Stars n={stars} />
        <span className="dr-verdict">{verdict}</span>
        {estStr && (
          <span className="dr-est-hrs" title="Projected home runs across today's starting lineups — Σ of each starter's calibrated HR probability (~9 batters per team)">
            {estStr} HRs
          </span>
        )}
        <Icon name="ChevronDown" size={14} className="dr-chev" />
      </summary>
      <div className="dr-body">
        <div className="dr-cap dim">
          How good a home-run slate this is — score {score}/100. Higher = more homer-prone arms, better parks/weather, and more elite bats.
          {estStr && <> Model projects <b>{estStr} HRs</b> across today's starting lineups (Σ each starter's HR%).</>}
        </div>
        <div className="dr-bars">
          <Bar label="Soft pitching" v={factors.pitching} sub={`${softArmPct}% of starters HR-prone`} />
          <Bar label="Park & weather" v={factors.environment} sub={`${favGames}/${games} games favorable`} />
          <Bar label="Bat supply" v={factors.supply} sub={`${primePerGame} PRIME bats/game`} />
        </div>
      </div>
    </details>
  )

  function Bar({ label, v, sub }) {
    return (
      <div className="dr-row">
        <span className="dr-k">{label}</span>
        <span className="dr-bar"><span className="dr-fill" style={{ width: pct(v) }} /></span>
        <span className="dr-sub dim">{sub}</span>
      </div>
    )
  }
}
