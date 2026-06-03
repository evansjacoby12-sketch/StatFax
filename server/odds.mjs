// OddsPapi (https://oddspapi.io) → MLB home-run prop odds for the slate.
//
// Reads the key from process.env.ODDS_API_KEY (GitHub Actions secret; never
// commit it). Returns { status, odds, books, debug } where `odds` is keyed by
// MLB gamePk in the shape the UI's data.js expects:
//   odds[gamePk] = { books: { <book>: { "First Last": { american, decimal, link } } } }
//
// All best-effort + null-safe: any failure → empty odds + a status string, so
// the board keeps working model-first. `debug` carries first-run diagnostics
// (discovered ids + small raw samples) so shapes can be verified from the slate.
//
// OddsPapi shapes (confirmed from live responses):
//   /sports   → [{ sportId, slug, sportName }]
//   /markets  → [{ marketId, marketName, playerProp, sportId, outcomes:[{outcomeId,outcomeName}] }]
//   /fixtures → [{ fixtureId, participant1Name, participant2Name, sportId, hasOdds, ... }]
//   /odds     → { bookmakerOdds: { <book>: { markets: { <marketId>: { outcomes: { <id>:
//                 { players: { <pid>: { playerName, price, active } } } } } } } } }

const BASE = 'https://api.oddspapi.io/v4'
const BOOKS = ['fanduel', 'draftkings']

async function get(path, params, key) {
  const u = new URL(BASE + path)
  u.search = new URLSearchParams({ ...params, apiKey: key }).toString()
  const r = await fetch(u, { headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`)
  return r.json()
}

const asArray = (x) =>
  Array.isArray(x) ? x : x?.data || x?.results || x?.items || x?.fixtures || x?.markets || x?.sports || []

const decToAmerican = (d) => (!d || d <= 1 ? null : d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)))

const normTeam = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '')
const nickname = (full) => normTeam(String(full || '').split(/\s+/).pop())
// "Cunningham, Cade" → "Cade Cunningham"; leaves "First Last" untouched.
const flipName = (n) => {
  const s = String(n || '').trim()
  if (s.includes(',')) {
    const [last, first] = s.split(',')
    return `${(first || '').trim()} ${(last || '').trim()}`.trim()
  }
  return s
}

export async function fetchHrOdds(games = [], dateStr) {
  const key = process.env.ODDS_API_KEY
  const debug = { provider: 'oddspapi' }
  if (!key) return { status: 'no_key', odds: {}, books: [], debug }

  try {
    // 1) Baseball sportId
    const sports = asArray(await get('/sports', {}, key))
    debug.sportCount = sports.length
    const baseball = sports.find((s) => /base\s?ball/i.test(s.sportName || s.slug || s.name || ''))
    const sportId = baseball?.sportId ?? baseball?.id
    debug.sportId = sportId
    if (!sportId) debug.sportsList = sports.map((s) => `${s.sportId}:${s.slug || s.sportName}`).slice(0, 80)

    // 2) Home-run player-prop market id
    let markets = asArray(await get('/markets', sportId ? { sportId } : {}, key).catch(() => []))
    debug.marketCount = markets.length
    const hrCands = markets.filter((m) => /home\s?run/i.test(m.marketName || m.name || ''))
    debug.hrCandidates = hrCands.map((m) => `${m.marketId}:${m.marketName}${m.playerProp ? ' (prop)' : ''}`)
    const hrMarket =
      hrCands.find((m) => m.playerProp && /hit a home run|to record/i.test(m.marketName || '')) ||
      hrCands.find((m) => m.playerProp) ||
      hrCands[0]
    const hrId = hrMarket?.marketId ?? hrMarket?.id
    debug.hrMarketId = hrId
    debug.hrMarketName = hrMarket?.marketName

    // 3) MLB tournament (the sport has many leagues — narrow to MLB)
    const tournaments = asArray(await get('/tournaments', sportId ? { sportId } : {}, key).catch(() => []))
    debug.tournamentCount = tournaments.length
    const mlb = tournaments.find((t) => /\bmlb\b|major league baseball/i.test(t.tournamentName || t.name || t.slug || ''))
    const mlbId = mlb?.tournamentId ?? mlb?.id
    debug.mlbTournamentId = mlbId
    debug.mlbTournamentName = mlb?.tournamentName || mlb?.name
    if (!mlbId) debug.tournamentsList = tournaments.map((t) => `${t.tournamentId ?? t.id}:${t.tournamentName || t.slug}`).slice(0, 40)

    // 4) Today's fixtures — prefer the MLB tournament, fall back to sport-wide.
    const tomorrow = new Date(new Date(dateStr + 'T12:00:00Z').getTime() + 864e5).toISOString().slice(0, 10)
    let fixtures = asArray(
      await get('/fixtures', { ...(mlbId ? { tournamentId: mlbId } : { sportId }), from: dateStr, to: tomorrow }, key),
    )
    if (!fixtures.length && mlbId) fixtures = asArray(await get('/fixtures', { sportId, from: dateStr, to: tomorrow }, key).catch(() => []))
    debug.fixtureCount = fixtures.length
    debug.sampleFixtureRaw = fixtures[0]
    debug.fixtureTeamsSample = fixtures.slice(0, 12).map((f) => `${f.participant1Name} vs ${f.participant2Name} [${f.startTime || ''}]`)

    // Order-insensitive team-pair → gamePk (full name + nickname).
    const byPair = new Map()
    for (const g of games) {
      const h = g.homeTeam?.name, a = g.awayTeam?.name
      if (!h || !a) continue
      byPair.set([normTeam(h), normTeam(a)].sort().join('|'), g.gamePk)
      byPair.set([nickname(h), nickname(a)].sort().join('|'), g.gamePk)
    }

    const teamsOf = (f) => [
      f.participant1Name || f.homeTeam?.name || f.home?.name || f.home,
      f.participant2Name || f.awayTeam?.name || f.away?.name || f.away,
    ]

    const odds = {}
    let matched = 0, priced = 0
    for (const f of fixtures) {
      if (f.hasOdds === false) continue
      const [t1, t2] = teamsOf(f)
      if (!t1 || !t2) continue
      const gamePk =
        byPair.get([normTeam(t1), normTeam(t2)].sort().join('|')) ??
        byPair.get([nickname(t1), nickname(t2)].sort().join('|'))
      if (gamePk == null) continue
      matched++
      if (!debug.sampleFixture) debug.sampleFixture = f

      const fid = f.fixtureId ?? f.id
      let payload
      try {
        payload = await get('/odds', { fixtureId: fid, bookmakers: BOOKS.join(','), oddsFormat: 'decimal' }, key)
      } catch (e) {
        debug.oddsError = String(e)
        continue
      }
      if (!debug.sampleOdds) debug.sampleOdds = payload // captured once for shape verification
      const bmo = payload?.bookmakerOdds || payload?.data?.bookmakerOdds
      if (!bmo || hrId == null) continue

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
    const status = priced > 0 ? 'ok' : sportId && hrId != null ? (matched ? 'no_props' : 'no_match') : 'discovery_failed'
    return { status, odds, books: BOOKS, debug }
  } catch (e) {
    debug.error = String(e)
    return { status: 'error', odds: {}, books: [], debug }
  }
}
