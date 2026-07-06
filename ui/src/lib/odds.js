// Betting odds + expected-value math. Harvested from the (now-deleted)
// src/logic/parlayPairings.js — the de-juiced implied prob + EV machinery was
// the most careful odds code in the repo and was sitting in dead code. Pure
// helpers, client-only (the graded combo scorecard is intentionally odds-free,
// so the server never imports this).

import { decimalToAmerican } from './format.js'

/** American odds → decimal payout multiplier (e.g. +450 → 5.50, -120 → 1.833). */
export function americanToDecimal(american) {
  const n = Number(american)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? n / 100 + 1 : 100 / Math.abs(n) + 1
}

/** American odds → raw implied probability (still includes the book's vig). */
export function americanToRawImplied(american) {
  const n = Number(american)
  if (!Number.isFinite(n) || n === 0) return null
  return n > 0 ? 100 / (n + 100) : Math.abs(n) / (Math.abs(n) + 100)
}

// Typical hold (vig) on an MLB HR prop, used to de-juice when only the "Yes"
// side is posted (our odds feed doesn't carry the "No" price). Two-sided
// de-juicing is exact; the flat-hold fallback is a documented approximation.
const HR_PROP_HOLD = 0.08

/**
 * De-juiced ("fair") implied probability for a binary HR prop. With both sides,
 * normalize: p_fair = p_yes / (p_yes + p_no). With only the Yes side, divide out
 * a flat hold. Returns null when the Yes price is missing.
 */
export function dejuicedImpliedProb(yesAmerican, noAmerican = null) {
  const py = americanToRawImplied(yesAmerican)
  if (py == null) return null
  const pn = americanToRawImplied(noAmerican)
  if (pn != null && pn > 0) return py / (py + pn)
  return py / (1 + HR_PROP_HOLD)
}

/**
 * Per-leg "value" edge: how much the model's HR prob exceeds the de-juiced
 * market estimate (modelProb − fairImplied). Positive = the model sees value the
 * market doesn't. Distinct from betting EV (which folds in the payout) — this is
 * the probability disagreement vs a fair line. null when unpriced.
 */
export function dejuicedEdge(modelProb, yesAmerican, noAmerican = null) {
  const fair = dejuicedImpliedProb(yesAmerican, noAmerican)
  if (fair == null || !Number.isFinite(modelProb)) return null
  return modelProb - fair
}

/**
 * Best SINGLE-BOOK parlay price. comboMarket's `american` multiplies each leg's
 * best price across DIFFERENT books — a number no sportsbook pays on one
 * ticket. This intersects the books that price EVERY leg and returns the best
 * one-ticket price: { book, decimal, american, perBook } (perBook sorted
 * best-first), or null when no single book covers the whole combo. `legs` are
 * batter rows carrying odds.books = [{ book, american, decimal, ... }].
 */
export function bestSingleBook(legs) {
  const lists = (legs || []).map((b) => (b.odds?.books || []).filter((x) => Number.isFinite(x.decimal) && x.decimal > 1))
  if (!lists.length || lists.some((l) => !l.length)) return null
  let common = null
  for (const l of lists) {
    const keys = new Set(l.map((x) => x.book))
    common = common ? new Set([...common].filter((k) => keys.has(k))) : keys
  }
  if (!common?.size) return null
  const perBook = [...common]
    .map((book) => {
      const decimal = lists.reduce((p, l) => p * l.find((x) => x.book === book).decimal, 1)
      return { book, decimal, american: decimalToAmerican(decimal) }
    })
    .sort((a, b) => b.decimal - a.decimal)
  return { ...perBook[0], perBook }
}

/**
 * Combine a parlay's legs into market figures. `legs` is an array of plain
 * descriptors { american, decimal?, modelProb } so this stays pure + testable.
 *
 * Returns:
 *   allPriced       every leg has a usable book price
 *   decimal         combined parlay decimal (product), null unless allPriced
 *   american        that decimal as American odds
 *   ev              betting EV per $1 = modelAllHit × decimal − 1 (the value to
 *                   sort on); null unless allPriced and the model prob is known
 *   deJuicedImplied combined fair (de-vigged) all-hit implied prob
 *   deJuicedEdge    modelAllHit − deJuicedImplied (probability edge vs fair)
 */
export function comboMarket(legs) {
  let decimal = 1
  let priced = 0
  let dj = 1
  let djOk = true
  let model = 1
  let modelOk = true
  for (const l of legs) {
    const d = Number.isFinite(l.decimal) ? l.decimal : americanToDecimal(l.american)
    if (d && d > 1) {
      decimal *= d
      priced++
    }
    const p = dejuicedImpliedProb(l.american, l.noAmerican ?? null)
    if (p != null) dj *= p
    else djOk = false
    if (Number.isFinite(l.modelProb)) model *= l.modelProb
    else modelOk = false
  }
  const allPriced = legs.length > 0 && priced === legs.length
  const modelAllHit = modelOk ? model : null
  const ev = allPriced && modelAllHit != null ? modelAllHit * decimal - 1 : null
  const deJuicedImplied = allPriced && djOk ? dj : null
  const deJuicedEdge = deJuicedImplied != null && modelAllHit != null ? modelAllHit - deJuicedImplied : null
  return {
    allPriced,
    decimal: allPriced ? decimal : null,
    american: allPriced ? decimalToAmerican(decimal) : null,
    ev,
    deJuicedImplied,
    deJuicedEdge,
  }
}
