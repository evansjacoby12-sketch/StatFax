const PARK_BOOST = 1.03
const PARK_DRAG = 0.97
const INTERACTION_BOOST = 1.03
const INTERACTION_DRAG = 0.97

const finite = Number.isFinite
const parkText = (parkHR) => finite(parkHR) ? `${parkHR.toFixed(2)}× park` : 'park factor unavailable'

function bias(value, boostAt, dragAt) {
  if (!finite(value)) return 'unknown'
  if (value >= boostAt) return 'boost'
  if (value <= dragAt) return 'drag'
  return 'neutral'
}

function directionalWindBias(wind) {
  if (!wind || !finite(wind.windOutMph)) return 'unknown'
  if (wind.windOutMph >= 2) return 'boost'
  if (wind.windOutMph <= -2) return 'drag'
  return 'neutral'
}

function windNote(g, direction) {
  const mph = finite(g.weather?.windSpeedMph) ? `${Math.round(g.weather.windSpeedMph)} mph` : 'Wind'
  const coverage = finite(g.envFactor) ? 'mapped' : 'directional estimate'
  return `${mph} ${direction} · ${coverage}`
}

export function roofStatusForGame(g = {}) {
  if (g.roofStatus === 'closed' || g.roofStatus === 'open' || g.roofStatus === 'pending') return g.roofStatus

  const type = g.stadium?.type
  if (type === 'Fixed Dome') return 'closed'
  if (type === 'Retractable') {
    if (g.weather?.roofClosed === true) return 'closed'
    if (g.weather?.roofClosed === false) return 'open'
    return 'pending'
  }
  if (g.closed === true) return 'closed'
  return null
}

/**
 * Classify a game's overall HR environment without turning missing interaction
 * coverage into a false "Neutral". gameParkHRFactor supplies the park baseline;
 * parkWeatherHandFactor refines it where the hand-specific lookup exists; the
 * stadium-relative wind verdict remains a qualitative fallback everywhere else.
 */
export function classifyWeatherGame(g = {}) {
  const precip = g.weather?.precipProbPct ?? 0
  const roofStatus = roofStatusForGame(g)
  if (roofStatus === 'closed') return { key: 'dome', label: 'Dome game · Closed', icon: 'House', note: 'Indoor · no wind effect', favorable: false, roofStatus }
  if (roofStatus === 'pending') return { key: 'roof-pending', label: 'Dome game · Pending', icon: 'CircleHelp', note: 'Open/closed not confirmed', favorable: false, roofStatus }

  const present = (state) => roofStatus === 'open'
    ? { ...state, label: 'Dome game · Open', note: `${state.label} · ${state.note}`, roofStatus }
    : state

  if (precip >= 50) return present({ key: 'rain', label: 'Rain watch', icon: 'CloudRain', note: `${Math.round(precip)}% precipitation`, favorable: false })

  const parkBias = bias(g.parkHR, PARK_BOOST, PARK_DRAG)
  const mappedBias = bias(g.envFactor, INTERACTION_BOOST, INTERACTION_DRAG)
  const windBias = directionalWindBias(g.wind)
  // A mapped non-neutral interaction is the stronger signal. When the mapped
  // value is near neutral, retain the honest directional read (e.g. a mild
  // tailwind offsetting a strongly suppressive park).
  const airBias = mappedBias === 'boost' || mappedBias === 'drag' ? mappedBias : windBias

  if ((parkBias === 'boost' && airBias === 'drag') || (parkBias === 'drag' && airBias === 'boost')) {
    const air = airBias === 'boost' ? 'out wind' : 'in wind'
    return present({ key: 'offset', label: 'Mixed signals', icon: 'ArrowLeftRight', note: `${air} vs ${parkText(g.parkHR)}`, favorable: false })
  }

  if (parkBias === 'boost' && airBias === 'boost') {
    return present({ key: 'favorable', label: 'Favorable', icon: 'TrendingUp', note: 'Park + air aligned', favorable: true })
  }
  if (parkBias === 'drag' && airBias === 'drag') {
    return present({ key: 'suppressed', label: 'Suppressed', icon: 'TrendingDown', note: `${parkText(g.parkHR)} + wind in`, favorable: false })
  }
  if (parkBias === 'boost' && (airBias === 'neutral' || airBias === 'unknown')) {
    return present({ key: 'park-boost', label: 'Park boost', icon: 'Gauge', note: parkText(g.parkHR), favorable: true })
  }
  if (parkBias === 'drag' && (airBias === 'neutral' || airBias === 'unknown')) {
    return present({ key: 'suppressed', label: 'Suppressed', icon: 'TrendingDown', note: parkText(g.parkHR), favorable: false })
  }
  if (airBias === 'boost') {
    return present({ key: 'wind-boost', label: 'Wind boost', icon: 'Wind', note: windNote(g, 'out'), favorable: true })
  }
  if (airBias === 'drag') {
    return present({ key: 'wind-drag', label: 'Wind drag', icon: 'Wind', note: windNote(g, 'in'), favorable: false })
  }

  const windKnown = finite(g.weather?.windSpeedMph) && finite(g.weather?.windDirDeg)
  const interactionKnown = finite(g.envFactor)
  const calm = windKnown && g.weather.windSpeedMph < 1
  if (interactionKnown || calm) {
    return present({ key: 'neutral', label: 'Neutral', icon: 'Minus', note: interactionKnown ? 'Mapped interaction near neutral' : 'Calm air · park near neutral', favorable: false })
  }
  return present({
    key: 'unrated',
    label: 'Unrated',
    icon: 'CircleHelp',
    note: windKnown ? 'Wind interaction unavailable' : 'Weather input unavailable',
    favorable: false,
  })
}

export function isFavorableWeatherGame(g) {
  return classifyWeatherGame(g).favorable
}

// Sorting-only signal. Mapped interaction deltas win; otherwise use the
// stadium-relative wind component so uncovered parks are not forced to last.
export function airSortValue(g = {}) {
  const roofStatus = roofStatusForGame(g)
  if (roofStatus === 'closed' || roofStatus === 'pending') return -1
  if (finite(g.envFactor)) return g.envFactor - 1
  const windOutMph = finite(g.windOutMph) ? g.windOutMph : g.wind?.windOutMph
  if (finite(windOutMph)) return windOutMph / 100
  return 0
}
