// Wind → HR verdict. A faithful, trimmed port of the engine's
// src/logic/windInterpreter.js so the board reads OUT/IN the same way the
// model's ball-carry physics does. `bearing` is the home-plate→CF compass
// heading (deg). Conventions: weather.windDirDeg is "wind FROM" (meteorological);
// windOutMph = -mph·cos(angleFromCF) → positive = blowing OUT (helps HR).

const D2R = Math.PI / 180

// Compact stadium table keyed by home-team abbr (bearing + roof type).
export const STADIUMS = {
  ARI: { bearing: 0, type: 'Retractable' },
  ATL: { bearing: 152, type: 'Open' },
  BAL: { bearing: 32, type: 'Open' },
  BOS: { bearing: 46, type: 'Open' },
  CHC: { bearing: 36, type: 'Open' },
  CWS: { bearing: 105, type: 'Open' },
  CIN: { bearing: 115, type: 'Open' },
  CLE: { bearing: 6, type: 'Open' },
  COL: { bearing: 6, type: 'Open' },
  DET: { bearing: 150, type: 'Open' },
  HOU: { bearing: 68, type: 'Retractable' },
  KC: { bearing: 45, type: 'Open' },
  LAA: { bearing: 42, type: 'Open' },
  LAD: { bearing: 24, type: 'Open' },
  MIA: { bearing: 108, type: 'Retractable' },
  MIL: { bearing: 128, type: 'Retractable' },
  MIN: { bearing: 90, type: 'Open' },
  NYM: { bearing: 24, type: 'Open' },
  NYY: { bearing: 75, type: 'Open' },
  OAK: { bearing: 50, type: 'Open' },
  PHI: { bearing: 14, type: 'Open' },
  PIT: { bearing: 118, type: 'Open' },
  SD: { bearing: 358, type: 'Open' },
  SF: { bearing: 93, type: 'Open' },
  SEA: { bearing: 52, type: 'Retractable' },
  STL: { bearing: 62, type: 'Open' },
  TB: { bearing: 45, type: 'Fixed Dome' },
  TEX: { bearing: 60, type: 'Retractable' },
  TOR: { bearing: 341, type: 'Retractable' },
  WSH: { bearing: 30, type: 'Open' },
}

// StatsAPI abbreviations that differ from the table keys.
const ALIASES = { AZ: 'ARI', CHW: 'CWS', ATH: 'OAK', WAS: 'WSH', SDP: 'SD', SFG: 'SF', TBR: 'TB', KCR: 'KC' }

export function stadiumFor(abbr) {
  if (!abbr) return null
  const key = STADIUMS[abbr] ? abbr : ALIASES[abbr]
  return key ? STADIUMS[key] : null
}

function sideLabelFor(angle) {
  const a = ((angle % 360) + 360) % 360
  if (a >= 337.5 || a < 22.5) return 'CF'
  if (a < 67.5) return 'RCF'
  if (a < 112.5) return 'RF'
  if (a < 157.5) return 'RF line'
  if (a < 202.5) return 'home'
  if (a < 247.5) return 'LF line'
  if (a < 292.5) return 'LF'
  return 'LCF'
}

function tintFor(verdict, magnitude) {
  if (verdict === 'OUT') return magnitude === 'strong' ? '#32D74B' : '#64D2FF'
  if (verdict === 'IN') return magnitude === 'strong' ? '#FF453A' : '#FF9F0A'
  return '#8E8E93' // CROSS
}

// Returns the wind verdict for a game, or null when there's nothing useful to
// show (no/closed roof, sub-1mph wind, missing data, or unknown park).
export function interpretWind(weather, homeAbbr, { roofClosed = false } = {}) {
  if (!weather || roofClosed) return null
  const stadium = stadiumFor(homeAbbr)
  if (stadium?.type === 'Fixed Dome') return null // never any wind effect
  const mph = Number(weather.windSpeedMph)
  const fromDeg = Number(weather.windDirDeg)
  const bearing = Number(stadium?.bearing)
  if (!Number.isFinite(mph) || mph < 1) return null
  if (!Number.isFinite(fromDeg) || !Number.isFinite(bearing)) return null

  const fromCompass = ((fromDeg % 360) + 360) % 360
  const relativeFromCf = (((fromCompass - bearing) % 360) + 360) % 360
  const relativeToCf = (relativeFromCf + 180) % 360
  const windOutMph = -mph * Math.cos(relativeFromCf * D2R)

  let verdict, magnitude
  if (windOutMph >= 6) [verdict, magnitude] = ['OUT', 'strong']
  else if (windOutMph >= 2) [verdict, magnitude] = ['OUT', 'mild']
  else if (windOutMph <= -6) [verdict, magnitude] = ['IN', 'strong']
  else if (windOutMph <= -2) [verdict, magnitude] = ['IN', 'mild']
  else [verdict, magnitude] = ['CROSS', 'mild']

  const side = sideLabelFor(relativeToCf)
  const fromSide = sideLabelFor((relativeToCf + 180) % 360)
  const mphStr = `${Math.round(mph)} mph`
  const caption =
    verdict === 'OUT'
      ? `${mphStr} out to ${side}`
      : verdict === 'IN'
        ? `${mphStr} in from ${fromSide}`
        : `${mphStr} cross to ${side}`

  return {
    mph,
    windOutMph,
    verdict,
    magnitude,
    side,
    fromSide,
    caption,
    tint: tintFor(verdict, magnitude),
    arrowRotation: relativeToCf, // 0 = up toward CF (OUT), 180 = down (IN)
  }
}
