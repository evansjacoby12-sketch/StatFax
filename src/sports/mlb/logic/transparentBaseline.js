// Transparent, outcome-blind starter baselines. These intentionally stay
// simpler than K Brain and the batter HR model so they can act as a stable
// benchmark: if the advanced layers do not beat these formulas, they have not
// earned their complexity.

export const TRANSPARENT_BASELINE_VERSION = 1
export const BASELINE_LEAGUE_K_RATE = 0.222
export const BASELINE_LEAGUE_ISO = 0.165

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
}

function average(values, fallback = null) {
  const usable = values.filter(finite).map(Number)
  return {
    value: usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : fallback,
    sample: usable.length,
    coverage: values.length ? usable.length / values.length : 0,
  }
}

function pitcherRatePer9(season, rateField, countField) {
  if (finite(season?.[rateField]) && Number(season[rateField]) >= 0) return Number(season[rateField])
  const innings = Number(season?.ip)
  const count = Number(season?.[countField])
  return innings > 0 && Number.isFinite(count) && count >= 0 ? (count * 9) / innings : null
}

function batterKRate(target) {
  const season = target?.season || {}
  const pa = Number(season.ab || 0) + Number(season.bb || 0)
  const strikeouts = Number(season.k)
  return pa > 0 && Number.isFinite(strikeouts) ? Math.max(0, Math.min(0.60, strikeouts / pa)) : null
}

function batterIso(target) {
  const season = target?.season || {}
  if (finite(season.iso)) return Math.max(0, Number(season.iso))
  if (finite(season.slg) && finite(season.avg)) return Math.max(0, Number(season.slg) - Number(season.avg))
  return null
}

function targetParkFactor(target, pitcher) {
  if (finite(target?.gameParkHRFactor) && Number(target.gameParkHRFactor) > 0) return Number(target.gameParkHRFactor)
  if (finite(pitcher?.gameParkHRFactor) && Number(pitcher.gameParkHRFactor) > 0) return Number(pitcher.gameParkHRFactor)
  return null
}

function targetWeatherFactor(target, pitcher) {
  const combined = Number(target?.parkWeatherHandFactor)
  const park = targetParkFactor(target, pitcher)
  if (!Number.isFinite(combined) || combined <= 0 || !Number.isFinite(park) || park <= 0) return null
  return Math.max(0.80, Math.min(1.20, combined / park))
}

export function projectStarterKBaseline({
  kPer9,
  expectedIP,
  lineupKRate,
  leagueKRate = BASELINE_LEAGUE_K_RATE,
} = {}) {
  if (![kPer9, expectedIP, lineupKRate, leagueKRate].every(finite)) return null
  if (Number(kPer9) < 0 || Number(expectedIP) <= 0 || Number(lineupKRate) < 0 || Number(leagueKRate) <= 0) return null
  return (Number(kPer9) * Number(expectedIP) / 9) * (Number(lineupKRate) / Number(leagueKRate))
}

export function projectStarterHRBaseline({
  hrPer9,
  expectedIP,
  lineupIso,
  leagueIso = BASELINE_LEAGUE_ISO,
  parkFactor = 1,
  weatherFactor = 1,
} = {}) {
  if (![hrPer9, expectedIP, lineupIso, leagueIso, parkFactor, weatherFactor].every(finite)) return null
  if (Number(hrPer9) < 0 || Number(expectedIP) <= 0 || Number(lineupIso) < 0 || Number(leagueIso) <= 0 || Number(parkFactor) <= 0 || Number(weatherFactor) <= 0) return null
  return (Number(hrPer9) * Number(expectedIP) / 9)
    * (Number(lineupIso) / Number(leagueIso))
    * Number(parkFactor)
    * Number(weatherFactor)
}

export function buildTransparentStarterBaseline(pitcher, targets, { expectedIP } = {}) {
  const lineup = (targets || []).filter(Boolean)
  const kProfile = average(lineup.map(batterKRate), BASELINE_LEAGUE_K_RATE)
  const isoProfile = average(lineup.map(batterIso), BASELINE_LEAGUE_ISO)
  const parkProfile = average(lineup.map((target) => targetParkFactor(target, pitcher)), 1)
  const weatherProfile = average(lineup.map((target) => targetWeatherFactor(target, pitcher)), 1)
  const kPer9 = pitcherRatePer9(pitcher?.season, 'kPer9', 'k')
  const hrPer9 = pitcherRatePer9(pitcher?.season, 'hrPer9', 'hr')

  return {
    version: TRANSPARENT_BASELINE_VERSION,
    expectedIP: finite(expectedIP) ? Number(expectedIP) : null,
    k: {
      projection: projectStarterKBaseline({
        kPer9,
        expectedIP,
        lineupKRate: kProfile.value,
      }),
      pitcherKPer9: kPer9,
      lineupKRate: kProfile.value,
      leagueKRate: BASELINE_LEAGUE_K_RATE,
      lineupSample: kProfile.sample,
      lineupCoverage: kProfile.coverage,
      formula: '(K/9 x IP/9) x (lineup K% / 22.2%)',
    },
    hr: {
      projection: projectStarterHRBaseline({
        hrPer9,
        expectedIP,
        lineupIso: isoProfile.value,
        parkFactor: parkProfile.value,
        weatherFactor: weatherProfile.value,
      }),
      pitcherHRPer9: hrPer9,
      lineupIso: isoProfile.value,
      leagueIso: BASELINE_LEAGUE_ISO,
      parkFactor: parkProfile.value,
      weatherFactor: weatherProfile.value,
      lineupSample: isoProfile.sample,
      lineupCoverage: isoProfile.coverage,
      parkCoverage: parkProfile.coverage,
      weatherCoverage: weatherProfile.coverage,
      formula: '(HR/9 x IP/9) x (lineup ISO / .165) x park x weather',
    },
  }
}
