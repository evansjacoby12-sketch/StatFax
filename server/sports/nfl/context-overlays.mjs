import { promises as fs } from 'node:fs'

const normalize = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

export async function readOptionalJSON(file) {
  if (!file) return null
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return null }
}

function indexPlayers(payload) {
  const byId = new Map()
  const byName = new Map()
  for (const player of payload?.players || []) {
    if (player.espnId) byId.set(String(player.espnId), player)
    if (player.name) byName.set(normalize(player.name), player)
  }
  return { byId, byName, generatedAt: payload?.generatedAt || null }
}

export function indexDepthChart(payload) {
  return indexPlayers(payload)
}

export function depthFor(player, index) {
  return index?.byId?.get(String(player?.espnId || '')) || index?.byName?.get(normalize(player?.name)) || null
}

export function indexWeather(payload) {
  return {
    byGame: new Map((payload?.games || []).filter((game) => game.gameId).map((game) => [String(game.gameId), game])),
    generatedAt: payload?.generatedAt || null,
  }
}

export function weatherFor(game, index) {
  return index?.byGame?.get(String(game?.id || '')) || null
}

export function overlayFreshness(generatedAt, now = new Date(), maxAgeHours = 48) {
  const timestamp = Date.parse(generatedAt)
  if (!Number.isFinite(timestamp)) return { available: false, fresh: false, ageHours: null }
  const ageHours = Math.max(0, (+new Date(now) - timestamp) / 3_600_000)
  return { available: true, fresh: ageHours <= maxAgeHours, ageHours }
}

