// Loads the brain's scored slate (dist/daily.json) and shapes it for the board.

import { heatIndex } from './scout.js'

// Relative to the app's base URL so it works at any deploy path (root host or
// a GitHub Pages project subpath) as well as the dev server. Guarded so the
// module also imports cleanly under Node (tests), where import.meta.env is unset.
const BASE_URL = import.meta.env?.BASE_URL ?? '/'
const DATA_URL = `${BASE_URL}data/daily.json`

// Normalize a player name for fuzzy matching across sources (MLB API vs books).
// Strips accents, punctuation, generational suffixes; lowercases.
export function normName(name) {
  if (!name) return ''
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildOddsIndex(oddsForGame) {
  // gamePk → { normName → { books: {book: {american, decimal, link}}, name } }
  const idx = new Map()
  if (!oddsForGame || !oddsForGame.books) return idx
  for (const [book, players] of Object.entries(oddsForGame.books)) {
    for (const [playerName, price] of Object.entries(players)) {
      const key = normName(playerName)
      if (!idx.has(key)) idx.set(key, { name: playerName, books: {} })
      idx.get(key).books[book] = price
    }
  }
  return idx
}

function attachOdds(batter, oddsIndex) {
  const entry = oddsIndex.get(normName(batter.name))
  if (!entry) return null
  const p = batter.hrProbability
  const books = []
  let best = null
  for (const [book, price] of Object.entries(entry.books)) {
    const decimal = price.decimal
    if (!decimal || decimal <= 1) continue
    const implied = 1 / decimal
    const edge = p != null ? p * decimal - 1 : null // EV per $1 staked
    const row = { book, american: price.american, decimal, implied, edge, link: price.link }
    books.push(row)
    if (!best || decimal > best.decimal) best = row // best payout
  }
  if (!books.length) return null
  const marketImplied = books.reduce((s, b) => s + b.implied, 0) / books.length
  return { books, best, marketImplied }
}

export async function loadSlate() {
  const res = await fetch(DATA_URL, { cache: 'no-store' })
  if (!res.ok) {
    throw new Error(
      `Couldn't load ${DATA_URL} (HTTP ${res.status}). Run \`npm run slate\` in the brain to generate dist/daily.json.`,
    )
  }
  const d = await res.json()

  const gamesByPk = new Map()
  for (const g of d.games || []) gamesByPk.set(g.gamePk, g)

  const oddsIndexByPk = new Map()
  for (const [pk, og] of Object.entries(d.odds || {})) {
    oddsIndexByPk.set(Number(pk), buildOddsIndex(og))
  }

  // The brain emits each batter under two keys (a bare playerId and a
  // composite `playerId-gamePk`), so Object.values has every row twice.
  // Dedupe on a stable composite id (also correct for doubleheaders).
  const dedup = new Map()
  for (const b of Object.values(d.scoredBatters || {})) {
    const id = `${b.playerId}-${b.gamePk}`
    if (!dedup.has(id)) dedup.set(id, b)
  }

  const h2hMap = d.h2h || {}

  const batters = [...dedup.values()].map((b) => {
    const id = `${b.playerId}-${b.gamePk}`
    const game = gamesByPk.get(b.gamePk) || null
    const oddsIndex = oddsIndexByPk.get(b.gamePk)
    const odds = oddsIndex ? attachOdds(b, oddsIndex) : null
    const opp = game ? (b.isHome ? game.awayTeam : game.homeTeam) : null
    const pitcherId = b.pitcher?.id
    return {
      ...b,
      id,
      game,
      opponent: opp,
      odds,
      // convenience: model edge vs best market price
      edge: odds?.best?.edge ?? null,
      weather: d.weatherByGame?.[b.gamePk] || null,
      h2h: pitcherId ? h2hMap[`${b.playerId}-${pitcherId}`] || null : null,
      heatIndex: heatIndex(b),
      // Boolean signal: batter mashes the pitcher's most-used pitch (slate's
      // primaryPitchEdge.passes). Surfaced as the "Pitch Edge" badge/filter.
      pitchEdge: b.primaryPitchEdge?.passes === true,
      // Boolean signal: tonight's park × weather × handedness env boosts HR.
      // parkWeatherHandFactor is a multiplier (1.0 = neutral); flag a ≥5% boost.
      wxEdge: (b.parkWeatherHandFactor ?? 1) >= 1.05,
      // Boolean signal: elite barrel rate (top ~10% of MLB, ≥13% of batted
      // balls). Matches the backend's barrelKing definition (backtest/reconcile).
      barrelKing: (b.barrelPctBBE ?? b.barrelPct ?? 0) >= 13,
      // Pitch-type matchup data for the Zone page: the batter's own arsenal
      // (SLG/RV/Whiff per pitch) and the opposing starter's mix (usage% + shape).
      arsenal: d.batterArsenal?.[b.playerId] || null,
      pitchMix: pitcherId ? d.pitcherPitchMix?.[pitcherId] || null : null,
    }
  })

  const meta = {
    version: d.version,
    date: d.date,
    generatedAt: d.generatedAt,
    finishedAt: d.finishedAt,
    stats: d.stats || {},
    modelMetrics: d.modelMetrics || null,
    ensembleMeta: d.ensembleMeta || null,
    scoreToProb: d.scoreToProb || null,
    oddsBooks: collectBooks(d.odds),
  }

  return { batters, games: d.games || [], meta, raw: d }
}

function collectBooks(odds) {
  const set = new Set()
  for (const og of Object.values(odds || {})) {
    for (const b of Object.keys(og.books || {})) set.add(b)
  }
  return [...set]
}

export const BOOK_LABELS = {
  fanduel: 'FanDuel',
  draftkings: 'DraftKings',
  betmgm: 'BetMGM',
  caesars: 'Caesars',
}

export function bookLabel(b) {
  return BOOK_LABELS[b] || b
}
