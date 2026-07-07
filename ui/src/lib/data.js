// Loads the brain's scored slate (dist/daily.json) and shapes it for the board.

import { heatIndex, pitchMixScore } from './scout.js'

// Relative to the app's base URL so it works at any deploy path (root host or
// a GitHub Pages project subpath) as well as the dev server. Guarded so the
// module also imports cleanly under Node (tests), where import.meta.env is unset.
const BASE_URL = import.meta.env?.BASE_URL ?? '/'
const DATA_URL = `${BASE_URL}data/daily.json`
const STATUS_URL = `${BASE_URL}api/status`
const REFRESH_URL = `${BASE_URL}api/refresh`

// Returns true if the local server is running (has /api/status).
async function hasLocalServer() {
  try {
    const r = await fetch(STATUS_URL, { cache: 'no-store' })
    return r.ok
  } catch {
    return false
  }
}

// Triggers a server-side slate regeneration (POST /api/refresh) and waits for
// it to finish, then returns so the caller can re-loadSlate() with fresh data.
// Falls back silently if not running against the local server (e.g. GitHub Pages).
export async function forceSlateRefresh(onStatus) {
  const live = await hasLocalServer()
  if (!live) return // GitHub Pages / static host — nothing to trigger

  await fetch(REFRESH_URL, { method: 'POST', cache: 'no-store' }).catch(() => {})

  // Poll /api/status until refreshing goes false.
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    try {
      const r = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: 'no-store' })
      const s = await r.json()
      onStatus?.(s)
      if (!s.refreshing) return
    } catch {
      // keep polling
    }
  }
}

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

// Does the opposing starter allow a big HR platoon split on THIS batter's side?
// Mirrors RudeBets' "vs LHB/RHB" tag: ≥30% higher HR/9 to the batter's side
// than the other, with a real per-side sample (~12 IP ≈ 50 PA) and a floor on
// the absolute rate so a 0.2→0.3 jump doesn't flag. Switch hitters bat opposite
// the pitcher's hand.
function hasHrPlatoonEdge(b) {
  const sp = b.pitcher?.splits
  if (!sp) return false
  const phand = b.pitcher?.hand
  const effSide = b.batSide === 'S' ? (phand === 'L' ? 'R' : 'L') : b.batSide
  const onSide = effSide === 'L' ? sp.vl : sp.vr
  const offSide = effSide === 'L' ? sp.vr : sp.vl
  if (!onSide || !offSide) return false
  if ((onSide.ip ?? 0) < 12 || (offSide.ip ?? 0) < 12) return false
  const on = onSide.hrPer9
  const off = offSide.hrPer9
  if (!Number.isFinite(on) || on < 1.2) return false // floor: must be genuinely HR-prone
  const ratioFlag = off > 0 ? on >= 1.3 * off : true // off-side allows ~none → clear split
  return ratioFlag
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
  // Cache-buster: GitHub Pages' CDN (Fastly) can keep serving a stale daily.json
  // for many minutes even though each deploy republishes it — and `cache:no-store`
  // only governs the browser cache, not the CDN edge. A unique query string per
  // request is a URL the edge hasn't cached, forcing a fresh pull every poll.
  const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store' })
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
      // Opposing team's bullpen HR/9 — the pen this batter attacks once the
      // starter exits. Drives the Cheat Sheet "Bullpen Targets" board.
      opposingBullpenHR9: d.bullpenHR9?.[opp?.id] ?? null,
      // Boolean signal: batter mashes the pitcher's most-used pitch (slate's
      // primaryPitchEdge.passes). Surfaced as the "Pitch Edge" badge/filter.
      pitchEdge: b.primaryPitchEdge?.passes === true,
      // Boolean signal: tonight's park × weather × handedness env boosts HR.
      // parkWeatherHandFactor is a multiplier (1.0 = neutral); flag a ≥5% boost.
      wxEdge: (b.parkWeatherHandFactor ?? 1) >= 1.05,
      // Boolean signal: elite barrel rate (top ~10% of MLB, ≥13% of batted
      // balls). Matches the backend's barrelKing definition (backtest/reconcile).
      barrelKing: (b.barrelPctBBE ?? b.barrelPct ?? 0) >= 13,
      // Boolean signal: elite BLAST rate (Statcast bat tracking) — fast,
      // squared-up contact. Recent ~2wk blasts-per-squared-up-contact preferred
      // (real swing sample), season fallback; flags the top blasters (≥25%, ≈
      // top ~8% of the slate). Mirrors groups.js / parlay-combos.mjs.
      blast: (() => {
        const t = b.batTracking
        if (!t) return false
        const r = Number.isFinite(t.recentBlastPerContact) && (t.recentSwings ?? 0) >= 25
          ? t.recentBlastPerContact
          : Number.isFinite(t.blastPerContact) ? t.blastPerContact : null
        return Number.isFinite(r) && r >= 25
      })(),
      // Boolean signal: facing a fly-ball-prone starter (GO/AO well below the
      // ~1.15 league norm) — more balls in the air, an HR-friendly matchup.
      // (RudeBets' "vs FB Pitcher".) Needs a real IP sample to be trustworthy.
      flyBallMatchup: (b.pitcher?.season?.ip ?? 0) >= 30 && (b.pitcher?.season?.goAo ?? 99) <= 0.92,
      // Boolean signal: the opposing starter gives up notably more HR to this
      // batter's side than the other (RudeBets' "vs LHB/RHB"). Computed below.
      hrPlatoonEdge: hasHrPlatoonEdge(b),
      // Boolean signal: 2+ matched zones (batter hot cell overlaps pitcher's
      // above-average frequency cell). Mirrors the ZONE_MASTER badge threshold.
      zoneEdge: (b.zoneMatchup?.matchedZones?.length ?? 0) >= 2,
      // Boolean signal: favorable pitch-type matchup — batter's weighted SLG
      // advantage across the pitcher's arsenal scores 7+/10 (5 = neutral).
      pitchMixEdge: (pitchMixScore(b) ?? 0) >= 7,
      // Pitch-type matchup data for the Zone page: the batter's own arsenal
      // (SLG/RV/Whiff per pitch) and the opposing starter's mix (usage% + shape).
      arsenal: d.batterArsenal?.[b.playerId] || null,
      pitchMix: pitcherId ? d.pitcherPitchMix?.[pitcherId] || null : null,
    }
  })

  attachSlatePercentiles(batters)

  const meta = {
    version: d.version,
    date: d.date,
    generatedAt: d.generatedAt,
    finishedAt: d.finishedAt,
    stats: d.stats || {},
    modelMetrics: d.modelMetrics || null,
    comboScorecard: d.comboScorecard || null,
    sgpScorecard: d.sgpScorecard || null,
    dayRating: d.dayRating || null,
    morningLockAt: d.morningLockAt || null,
    ensembleMeta: d.ensembleMeta || null,
    scoreToProb: d.scoreToProb || null,
    oddsBooks: collectBooks(d.odds),
  }

  return { batters, games: d.games || [], meta, raw: d }
}

// Savant-style percentile ranks, computed against TODAY'S SLATE (every scored
// batter on the board) rather than all of MLB — the honest comparison set we
// actually have client-side, and arguably the more useful one for picking.
// Attaches `b.pctile = { iso: 0-100, ... }` (null where the stat is missing).
const PCTILE_METRICS = {
  iso: (b) => {
    const s = b.season
    if (Number.isFinite(s?.iso)) return s.iso
    return Number.isFinite(s?.slg) && Number.isFinite(s?.avg) ? s.slg - s.avg : null
  },
  xiso: (b) => (Number.isFinite(b.xStats?.xISO) ? b.xStats.xISO : null),
  barrel: (b) => {
    const v = b.barrelPctBBE ?? b.barrelPct
    return Number.isFinite(v) ? v : null
  },
  ev: (b) => (Number.isFinite(b.exitVelo) ? b.exitVelo : null),
  hardHit: (b) => (Number.isFinite(b.hardHitPct) ? b.hardHitPct : null),
  // HR per AB needs a real sample before a rate means anything.
  hrRate: (b) => {
    const s = b.season
    return Number.isFinite(s?.hr) && Number.isFinite(s?.ab) && s.ab >= 30 ? s.hr / s.ab : null
  },
}

function attachSlatePercentiles(batters) {
  // De-dupe doubleheader rows so a batter playing twice doesn't count double
  // in the distribution.
  const byPlayer = new Map()
  for (const b of batters) if (!byPlayer.has(b.playerId)) byPlayer.set(b.playerId, b)
  const pool = [...byPlayer.values()]
  const sorted = {}
  for (const [k, get] of Object.entries(PCTILE_METRICS)) {
    sorted[k] = pool.map(get).filter((v) => v != null).sort((a, b) => a - b)
  }
  // Mid-rank percentile: ties share rank so identical values get the same number.
  const pctOf = (arr, v) => {
    if (v == null || arr.length < 20) return null
    let lo = 0
    while (lo < arr.length && arr[lo] < v) lo++
    let hi = lo
    while (hi < arr.length && arr[hi] === v) hi++
    return Math.round(((lo + (hi - lo) / 2) / arr.length) * 100)
  }
  for (const b of batters) {
    b.pctile = {}
    for (const [k, get] of Object.entries(PCTILE_METRICS)) {
      b.pctile[k] = pctOf(sorted[k], get(b))
    }
  }
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
  betrivers: 'BetRivers',
  espnbet: 'ESPN Bet',
  fanatics: 'Fanatics',
  hardrockbet: 'Hard Rock',
  bovada: 'Bovada',
  betonlineag: 'BetOnline',
  mybookieag: 'MyBookie',
  lowvig: 'LowVig',
  ballybet: 'Bally Bet',
  fliff: 'Fliff',
}

export function bookLabel(b) {
  return BOOK_LABELS[b] || b
}
