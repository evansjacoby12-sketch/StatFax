import { parkRunFactorForVenue } from '../data/parkRunFactors.js'

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value))
const round = (value, digits = 4) => {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function relativeWindDirection(windDirDeg, parkBearing) {
  const windToDeg = (windDirDeg + 180) % 360
  return ((windToDeg - parkBearing) % 360 + 360) % 360
}

/**
 * Build a run-scoring environment rather than reusing an HR-only park signal.
 * Statcast's park value is damped because lineup and team scoring inputs still
 * contain some home-park history. Weather adjustments are deliberately small:
 * temperature and the outfield-axis wind component can each move runs by at
 * most four percent.
 */
export function buildGameRunEnvironment({ weather = null, stadium = null } = {}) {
  const park = parkRunFactorForVenue(stadium?.name)
  const rawParkFactor = Number.isFinite(park?.factor) ? park.factor : 1
  const appliedParkFactor = clamp(1 + 0.65 * (rawParkFactor - 1), 0.88, 1.18)
  const fixedDome = stadium?.type === 'Fixed Dome'
  const roofClosed = fixedDome || weather?.roofClosed === true
  const roofPending = stadium?.type === 'Retractable' && weather?.roofClosed == null

  let tempFactor = 1
  let windFactor = 1
  let windComponent = null
  let temperatureCovered = false
  let windCovered = false
  let weatherStatus = 'missing'

  if (roofClosed) {
    temperatureCovered = true
    windCovered = true
    weatherStatus = 'indoor'
  } else if (roofPending) {
    weatherStatus = 'roof-pending'
  } else if (weather) {
    if (Number.isFinite(weather.tempF)) {
      tempFactor = clamp(1 + (weather.tempF - 72) * 0.0015, 0.96, 1.04)
      temperatureCovered = true
    }
    if (
      Number.isFinite(weather.windSpeedMph)
      && Number.isFinite(weather.windDirDeg)
      && Number.isFinite(stadium?.bearing)
    ) {
      const relative = relativeWindDirection(weather.windDirDeg, stadium.bearing)
      windComponent = Math.cos(relative * Math.PI / 180)
      windFactor = clamp(
        1 + windComponent * Math.min(weather.windSpeedMph, 20) * 0.002,
        0.96,
        1.04,
      )
      windCovered = true
    }
    weatherStatus = temperatureCovered || windCovered ? 'outdoor' : 'missing'
  }

  const weatherFactor = tempFactor * windFactor
  const factor = clamp(appliedParkFactor * weatherFactor, 0.86, 1.17)
  const coverage = (
    (park ? 0.6 : 0)
    + (temperatureCovered ? 0.2 : 0)
    + (windCovered ? 0.2 : 0)
  )

  return {
    factor: round(factor),
    rawParkFactor: round(rawParkFactor),
    appliedParkFactor: round(appliedParkFactor),
    weatherFactor: round(weatherFactor),
    tempFactor: round(tempFactor),
    windFactor: round(windFactor),
    windComponent: Number.isFinite(windComponent) ? round(windComponent) : null,
    tempF: Number.isFinite(weather?.tempF) ? weather.tempF : null,
    windSpeedMph: Number.isFinite(weather?.windSpeedMph) ? weather.windSpeedMph : null,
    parkPeriod: park?.period || null,
    parkSource: park?.source || null,
    weatherStatus,
    roofClosed,
    roofPending,
    coverage: round(clamp(coverage, 0, 1)),
  }
}
