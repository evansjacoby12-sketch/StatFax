const SGO_BASE = 'https://api.sportsgameodds.com/v2'
const BOOKS = new Set(['draftkings', 'fanduel', 'betmgm', 'caesars', 'betrivers'])

export const normalizePlayerName = (raw) => String(raw || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.'’-]/g, '').replace(/\s+(jr|sr|ii|iii|iv|v)$/i, '').replace(/\s+/g, ' ').trim()

const STAT_MARKETS = new Map([
  ['touchdowns', 'anytime_td'], ['anytimetouchdown', 'anytime_td'], ['firsttouchdown', 'first_td'],
  ['passingyards', 'passing_yards'], ['receptions', 'receptions'], ['receivingyards', 'receiving_yards'],
  ['rushingyards', 'rushing_yards'], ['rushingreceivingyards', 'rushing_receiving_yards'], ['passingrushingyards', 'passing_rushing_yards'],
])

const american = (raw) => {
  const value = Number.parseInt(String(raw ?? '').replace(/[^\d+-]/g, ''), 10)
  return Number.isFinite(value) ? value : null
}

function representativeMarket(market, opposite) {
  const books = {}
  const prices = []
  const lines = []
  for (const [book, info] of Object.entries(market?.byBookmaker || {})) {
    if (!BOOKS.has(book) || info.available === false) continue
    const odds = american(info.odds)
    if (odds == null) continue
    const line = info.spread != null && info.spread !== '' && Number.isFinite(Number(info.spread)) ? Number(info.spread) : null
    books[book] = { odds, line, deeplink: info.deeplink || null }
    prices.push(odds)
    if (line != null) lines.push(line)
  }
  const oppositePrices = Object.entries(opposite?.byBookmaker || {}).filter(([book, info]) => BOOKS.has(book) && info.available !== false).map(([, info]) => american(info.odds)).filter((value) => value != null)
  const fallbackLine = market?.spread != null && Number.isFinite(Number(market.spread)) ? Number(market.spread) : market?.bookOdds?.[0]?.spread != null && Number.isFinite(Number(market.bookOdds[0].spread)) ? Number(market.bookOdds[0].spread) : null
  return {
    line: lines.length ? lines.sort((a, b) => a - b)[Math.floor(lines.length / 2)] : fallbackLine,
    odds: prices.length ? Math.round(prices.reduce((sum, value) => sum + value, 0) / prices.length) : null,
    underOdds: oppositePrices.length ? Math.round(oppositePrices.reduce((sum, value) => sum + value, 0) / oppositePrices.length) : null,
    books,
    source: 'sportsgameodds',
  }
}

export function parseSportsGameOdds(payload) {
  const players = new Map()
  for (const event of payload?.data || []) {
    for (const [oddId, market] of Object.entries(event.odds || {})) {
      if (!oddId.endsWith('-game-ou-over')) continue
      const playerId = market.playerID || market.statEntityID
      const player = event.players?.[playerId]
      if (!player?.name || !playerId) continue
      const marker = `-${playerId}-game-ou-over`
      if (!oddId.endsWith(marker)) continue
      const stat = oddId.slice(0, -marker.length).replace(/[^a-z0-9]/gi, '').toLowerCase()
      const marketId = STAT_MARKETS.get(stat)
      if (!marketId) continue
      const key = normalizePlayerName(player.name)
      const underId = oddId.slice(0, -4) + 'under'
      if (!players.has(key)) players.set(key, { name: player.name, markets: {} })
      players.get(key).markets[marketId] = representativeMarket(market, event.odds?.[underId])
    }
  }
  return players
}

export async function fetchNFLOdds(apiKey, fetchImpl = fetch) {
  if (!apiKey) return { status: 'no_key', players: new Map() }
  try {
    const response = await fetchImpl(`${SGO_BASE}/events?leagueID=NFL&oddsAvailable=true&includeOpposingOdds=true&limit=100`, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' } })
    if (!response.ok) return { status: `http_${response.status}`, players: new Map() }
    const players = parseSportsGameOdds(await response.json())
    return { status: players.size ? 'ok' : 'empty', players }
  } catch (error) {
    return { status: `error:${error.message}`, players: new Map() }
  }
}
