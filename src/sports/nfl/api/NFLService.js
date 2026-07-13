import NFL_DEMO_SNAPSHOT from '../data/demoSlate.js'

const DEFAULT_URLS = ['/data/nfl/daily.json', './data/nfl/daily.json', '/nfl/daily.json', '/dist/nfl/daily.json']

export function validateNFLSnapshot(snapshot) {
  if (!snapshot || snapshot.sport !== 'nfl' || !Array.isArray(snapshot.players)) throw new Error('Invalid NFL snapshot')
  return snapshot
}

export async function loadNFLSnapshot({ urls = DEFAULT_URLS, fetchImpl = globalThis.fetch, demoFallback = true } = {}) {
  if (typeof fetchImpl === 'function') {
    for (const url of urls) {
      try {
        const response = await fetchImpl(url, { cache: 'no-store' })
        if (!response.ok) continue
        return validateNFLSnapshot(await response.json())
      } catch {}
    }
  }
  if (demoFallback) return NFL_DEMO_SNAPSHOT
  throw new Error('NFL snapshot unavailable')
}

export function mergeNFLLiveUpdate(snapshot, update) {
  if (!update?.players) return snapshot
  const byId = new Map(update.players.map((player) => [player.id, player]))
  return {
    ...snapshot,
    generatedAt: update.generatedAt || snapshot.generatedAt,
    players: snapshot.players.map((player) => {
      const next = byId.get(player.id)
      return next ? { ...player, ...next, live: { ...player.live, ...next.live, stats: { ...player.live?.stats, ...next.live?.stats } } } : player
    }),
  }
}
