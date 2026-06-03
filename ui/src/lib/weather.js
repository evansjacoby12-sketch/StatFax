// Weather display helpers. windDirDeg follows the meteorological convention:
// the direction the wind blows FROM. An arrow showing where it blows TO points
// at deg + 180.

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

export function compass(deg) {
  if (deg == null || Number.isNaN(deg)) return null
  return DIRS[Math.round(deg / 22.5) % 16]
}

// Rough sky label from cloud cover + precip probability.
export function skyLabel(w) {
  if (!w) return null
  if (w.roofClosed) return 'Roof closed'
  if (w.precipProbPct >= 50) return 'Likely rain'
  const c = w.cloudCoverPct
  if (c == null) return null
  if (c < 20) return 'Clear'
  if (c < 55) return 'Partly cloudy'
  if (c < 85) return 'Mostly cloudy'
  return 'Overcast'
}
