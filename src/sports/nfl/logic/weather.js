const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

export function nflWeatherImpact(weather = {}, marketId = 'anytime_td') {
  const roof = String(weather.roof || '').toLowerCase()
  const dome = roof.includes('dome') || roof.includes('closed') || roof.includes('indoor')
  if (dome) return { factor: 1, label: 'Dome · neutral', tone: 'neutral', reasons: ['Indoor conditions'] }

  const wind = Number(weather.windMph ?? weather.wind ?? 0)
  const temp = Number(weather.tempF ?? weather.temp ?? 70)
  const precip = Number(weather.precipProbability ?? weather.precipPct ?? 0)
  const passMarket = ['passing_yards', 'receiving_yards', 'receptions', 'passing_rushing_yards'].includes(marketId)
  const rushMarket = ['rushing_yards', 'rushing_receiving_yards'].includes(marketId)
  let delta = 0
  const reasons = []

  if (wind >= 20) { delta += passMarket ? -0.09 : rushMarket ? 0.025 : -0.025; reasons.push(`${wind} mph wind`) }
  else if (wind >= 14) { delta += passMarket ? -0.045 : rushMarket ? 0.012 : -0.01; reasons.push(`${wind} mph breeze`) }
  if (precip >= 60) { delta += passMarket ? -0.035 : rushMarket ? 0.015 : -0.01; reasons.push(`${precip}% precipitation`) }
  if (temp <= 25) { delta -= passMarket ? 0.025 : 0.01; reasons.push(`${temp}° cold`) }
  if (temp >= 88) { delta -= 0.008; reasons.push(`${temp}° heat`) }

  const factor = clamp(1 + delta, 0.86, 1.06)
  return {
    factor,
    label: reasons.length ? `${delta >= 0 ? '+' : ''}${Math.round(delta * 100)}% · ${reasons[0]}` : 'Neutral conditions',
    tone: delta > 0.008 ? 'good' : delta < -0.008 ? 'warn' : 'neutral',
    reasons,
  }
}
