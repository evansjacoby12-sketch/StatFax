import { useEffect, useMemo, useState } from 'react'
import { nbaTeamLogoCandidates, nbaTeamLogoLabel } from '../lib/nbaTeamLogo.js'

export default function NBATeamLogo({ team, src = null, className = '', style }) {
  const candidates = useMemo(() => nbaTeamLogoCandidates(team, src), [team, src])
  const label = nbaTeamLogoLabel(team)
  const [sourceIndex, setSourceIndex] = useState(0)

  useEffect(() => setSourceIndex(0), [candidates])

  if (sourceIndex >= candidates.length) {
    return (
      <span
        className={`nba-team-logo-fallback ${className}`.trim()}
        style={style}
        role="img"
        aria-label={`${label} logo unavailable`}
        title={label}
      >
        {label}
      </span>
    )
  }

  return (
    <img
      src={candidates[sourceIndex]}
      alt={`${label} logo`}
      className={className}
      style={style}
      loading="lazy"
      decoding="async"
      onError={() => setSourceIndex(index => index + 1)}
    />
  )
}
