// OddsPapi (https://oddspapi.io) → MLB home-run prop odds for the slate.
//
// Reads the key from process.env.ODDS_API_KEY (set as a GitHub Actions secret;
// never commit it). Returns:
//   { status, odds, books, debug }
// where `odds` is keyed by MLB gamePk in the exact shape the UI's data.js
// expects:
//   odds[gamePk] = { books: { <book>: { "First Last": { american, decimal, link } } } }
//
// Everything is best-effort + null-safe: any failure degrades to an empty odds
// map with a status string, so the slate (and the board) keep working
// model-first. `debug` carries first-run diagnostics (discovered ids + small
// raw samples) so the response shapes can be verified from the deployed slate.

const BASE = 'https://api.oddspapi.io/v4'
const BOOKS = ['fanduel', 'draftkings']

async function get(path, params, key) {
  const u = new URL(BASE + path)
  u.search = new URLSearchParams({ ...params, apiKey: key }).toString()
  const r = await fetch(u, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`)
  return r.json()
}

// Many list endpoints may wrap the array under a key — normalize to an array.
const asArray = (x) => (Array.isArray(x) ? x : x?.data || x?.results || x?.items || x?.fixtures || x?.markets || x?.sports || [])

const decToAmerican = (d) => (!d || d <= 1 ? null : d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)))

const normTeam = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
// "Cunningham, Cade" → "Cade Cunningham"; leaves "First Last" untouched.
const flipName = (n) => {
  const s = String(n || '').trim()
  if (s.includes(',')) {
    const [last, first] = s.split(',')
    return `${(first || '').trim()} ${(last || '').trim()}`.trim()
  }
  return s
}

// Best-effort extraction of [home, away] team names from an OddsPapi fixture.
function fixtureTeams(f) {
  const pick = (...vals) => vals.find((v) => typeof v === 'string' && v.trim())
  let home = pick(f.homeTeam?.name, f.home?.name, f.homeName, typeof f.home === 'string' ? f.home : null, f.participants?.[0]?.name, f.competitors?.[0]?.name)
  let away = pick(f.awayTeam?.name, f.away?.name, f.awayName, typeof f.away === 'string' ? f.away : null, f.participants?.[1]?.name, f.competitors?.[1]?.name)
  if ((!home || !away) && typeof f.name === 'string') {
    const m = f.name.split(/\s+(?:vs\.?|@|-)\s+/i)
    if (m.length === 2) {
      home = home || m[1] // "Away vs Home" or "Home vs Away" — order unknown, match is order-insensitive anyway
      away = away || m[0]
    }
  }
  return [home, away]
}

export async function fetchHrOdds(games = [], dateStr) {
  const key = process.env.ODDS_API_KEY
  const debug = { provider: 'oddspapi' }
  if (!key) return { status: 'no_key', odds: {}, books: [], debug }

  try {
    // 1) Baseball/MLB sportId
    const sports = asArray(await get('/sports', {}, key))
    const baseball = sports.find((s) => /base\s?ball|mlb/i.test(s.name || s.title || ''))
    const sportId = baseball?.id ?? baseball?.sportId ?? baseball?.key
    debug.sportId = sportId
    debug.sampleSport = sports[0]

    // 2) Home-run market id
    let markets = asArray(await get('/markets', sportId ? { sportId } : {}, key).catch(() => []))
    if (!markets.length) markets = asArray(await get('/markets', {}, key).catch(() => []))
    const hrMarket = markets.find((m) => /home\s?run/i.test(m.name || m.title || ''))
    const hrId = hrMarket?.id ?? hrMarket?.marketId ?? hrMarket?.key
    debug.hrMarketId = hrId
    debug.hrMarketName = hrMarket?.name || hrMarket?.title
    debug.sampleMarket = markets[0]

    // 3) Today's MLB fixtures
    const fixtures = asArray(await get('/fixtures', { sportId, from: dateStr, to: dateStr }, key))
    debug.fixtureCount = fixtures.length
    debug.sampleFixture = fixtures[0]

    // Order-insensitive team-pair → gamePk lookup (full name + nickname).
    const byPair = new Map()
    const nickname = (full) => normTeam(String(full).split(/\s+/).pop())
    for (const g of games) {
      const h = g.homeTeam?.name, a = g.awayTeam?.name
      if (!h || !a) continue
      byPair.set([normTeam(h), normTeam(a)].sort().join('|'), g.gamePk)
      byPair.set([nickname(h), nickname(a)].sort().join('|'), g.gamePk)
    }

    const odds = {}
    let matched = 0, priced = 0
    for (const f of fixtures) {
      if (f.hasOdds === false) continue
      const [home, away] = fixtureTeams(f)
      if (!home || !away) continue
      const gamePk =
        byPair.get([normTeam(home), normTeam(away)].sort().join('|')) ??
        byPair.get([nickname(home), nickname(away)].sort().join('|'))
      if (gamePk == null) continue
      const fid = f.id ?? f.fixtureId
      let payload
      try {
        payload = await get('/odds', { fixtureId: fid, bookmakers: BOOKS.join(','), oddsFormat: 'decimal' }, key)
      } catch (e) {
        debug.oddsError = String(e)
        continue
      }
      if (!debug.sampleOdds) debug.sampleOdds = JSON.parse(JSON.stringify(payload)) // captured once for shape verification
      const bmo = payload?.bookmakerOdds || payload?.data?.bookmakerOdds
      if (!bmo) continue
      matched++

      const booksOut = {}
      for (const [book, bdata] of Object.entries(bmo)) {
        const market = bdata?.markets?.[hrId]
        if (!market) continue
        const players = {}
        for (const outcome of Object.values(market.outcomes || {})) {
          const oname = String(outcome.name || outcome.outcomeName || outcome.label || '').toLowerCase()
          if (/\b(no|under)\b/.test(oname)) continue // want "to hit a HR" / Over 0.5 / Yes
          for (const p of Object.values(outcome.players || {})) {
            if (p.active === false) continue
            const decimal = Number(p.price)
            if (!Number.isFinite(decimal) || decimal <= 1) continue
            players[flipName(p.playerName)] = { american: decToAmerican(decimal), decimal, link: p.link || null }
            priced++
          }
        }
        if (Object.keys(players).length) booksOut[book] = players
      }
      if (Object.keys(booksOut).length) odds[gamePk] = { books: booksOut }
    }

    debug.matchedFixtures = matched
    debug.pricedPlayers = priced
    const status = priced > 0 ? 'ok' : sportId && hrId ? 'no_props' : 'discovery_failed'
    return { status, odds, books: BOOKS, debug }
  } catch (e) {
    debug.error = String(e)
    return { status: 'error', odds: {}, books: [], debug }
  }
}
