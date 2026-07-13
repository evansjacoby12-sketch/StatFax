const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'

async function getJSON(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'StatFax-NFL/1.0' } })
  if (!response.ok) throw new Error(`weather HTTP ${response.status}: ${url}`)
  return response.json()
}

export function nearestHourlyForecast(payload, kickoffAt) {
  const times = payload?.hourly?.time || []
  if (!times.length) return null
  const kickoff = +new Date(kickoffAt)
  let best = -1
  let distance = Infinity
  times.forEach((time, index) => {
    const delta = Math.abs(+new Date(`${time}Z`) - kickoff)
    if (delta < distance) { best = index; distance = delta }
  })
  if (best < 0 || distance > 4 * 3_600_000) return null
  return {
    tempF: payload.hourly.temperature_2m?.[best] ?? null,
    windMph: payload.hourly.wind_speed_10m?.[best] ?? null,
    windGustMph: payload.hourly.wind_gusts_10m?.[best] ?? null,
    precipProbability: payload.hourly.precipitation_probability?.[best] ?? null,
    weatherCode: payload.hourly.weather_code?.[best] ?? null,
    forecastAt: `${times[best]}Z`, source: 'open-meteo',
  }
}

export async function fetchGameWeather(game, fetchImpl = fetch) {
  if (game?.venue?.indoor) return { roof: 'dome', source: 'venue', forecastAt: game.date }
  const city = game?.venue?.city
  if (!city) return null
  const search = new URL(GEOCODING)
  search.searchParams.set('name', `${city}, ${game.venue.state || ''}`.trim())
  search.searchParams.set('count', '5')
  search.searchParams.set('language', 'en')
  search.searchParams.set('countryCode', 'US')
  const locations = (await getJSON(search, fetchImpl))?.results || []
  const state = String(game.venue.state || '').toLowerCase()
  const location = locations.find((item) => !state || String(item.admin1 || '').toLowerCase().includes(state)) || locations[0]
  if (!location) return null
  const forecast = new URL(FORECAST)
  forecast.searchParams.set('latitude', location.latitude)
  forecast.searchParams.set('longitude', location.longitude)
  forecast.searchParams.set('hourly', 'temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m,weather_code')
  forecast.searchParams.set('temperature_unit', 'fahrenheit')
  forecast.searchParams.set('wind_speed_unit', 'mph')
  forecast.searchParams.set('timezone', 'UTC')
  forecast.searchParams.set('forecast_days', '16')
  const weather = nearestHourlyForecast(await getJSON(forecast, fetchImpl), game.date)
  return weather ? { roof: 'outdoor', ...weather, latitude: location.latitude, longitude: location.longitude } : null
}

export async function fetchNFLWeather(games, fetchImpl = fetch) {
  const results = await Promise.all((games || []).map(async (game) => {
    try { return { gameId: game.id, ...(await fetchGameWeather(game, fetchImpl)) } }
    catch (error) { return { gameId: game.id, error: error.message } }
  }))
  return { generatedAt: new Date().toISOString(), games: results.filter((item) => item.roof || item.tempF != null), errors: results.filter((item) => item.error) }
}
