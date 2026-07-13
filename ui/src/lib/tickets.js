// My Tickets — a local ledger of combos the user actually bet ("tracked").
//
// The combo board tracks the MODEL's evolving picks; this tracks YOUR ticket.
// When you Track a combo, its exact legs are snapshotted at that instant and
// pinned — so board re-ranks, the morning lock, and lineup shuffles can never
// lose it. Each ticket then grades live (in-progress) and settles (final)
// against the actual HRs, independent of whether it's still a model pick.
//
// Stored in localStorage (per device). A window event keeps every mounted
// hook instance — the Track buttons on cards and the My Tickets panel — in sync.

import { useState, useEffect, useCallback } from 'react'

const KEY = 'sf_tickets'
const EVT = 'sf_tickets_change'
const MAX = 100 // hard cap so the ledger can't grow unbounded

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY))
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX))) } catch { /* quota/private mode */ }
  try { window.dispatchEvent(new Event(EVT)) } catch { /* SSR */ }
}

export function trackTicket(ticket) {
  const list = read()
  if (!ticket?.id || list.some((item) => item.id === ticket.id)) return false
  list.unshift(ticket)
  write(list)
  return true
}

// Stable id from the leg set + slate date, so the same pair on the same day is
// one ticket (idempotent Track), but the same pair on another day is distinct.
export function ticketId(legs, date) {
  const ids = (legs || []).map((l) => l.playerId).filter((x) => x != null).slice().sort((a, b) => a - b).join('-')
  return `${date || '?'}:${ids}`
}

// Build a ticket record from a display combo group (or a manual leg list).
export function makeTicket({ legs, date, strategy = 'custom', label = 'Custom', size = null, allHit = null, american = null, wager = null, book = null }) {
  const slim = (legs || []).map((b) => ({
    playerId: b.playerId,
    name: b.name,
    team: b.team,
    opponent: b.opponent?.abbr || b.opponent || null,
    gamePk: b.gamePk,
    grade: b.grade?.label || b.grade || null,
    score: Number.isFinite(b.score) ? b.score : null,
    modelProb: Number.isFinite(b.hrProbability) ? b.hrProbability : null,
    lineupConfirmed: b.lineupConfirmed === true,
  }))
  return {
    id: ticketId(slim, date),
    tailedAt: Date.now(),
    date,
    strategy,
    label,
    size: size ?? slim.length,
    allHitPct: Number.isFinite(allHit) ? allHit : null,
    american: Number.isFinite(american) ? american : null,
    wager: Number.isFinite(wager) && wager > 0 ? wager : null,
    book: book || null,
    legs: slim,
    settled: null, // { cashed: bool, at: ts } once every leg's game is final
  }
}

// Shared hook. Returns the ledger plus toggle/remove/settle/isTracked.
export function useTickets() {
  const [tickets, setTickets] = useState(read)
  useEffect(() => {
    const sync = () => setTickets(read())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync) // cross-tab
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const toggle = useCallback((ticket) => {
    const list = read()
    const i = list.findIndex((t) => t.id === ticket.id)
    if (i >= 0) {
      list.splice(i, 1)
      write(list)
    } else {
      trackTicket(ticket)
    }
    return i < 0 // true when newly added
  }, [])

  const remove = useCallback((id) => { write(read().filter((t) => t.id !== id)) }, [])

  const update = useCallback((id, patch) => {
    const list = read()
    const ticket = list.find((item) => item.id === id)
    if (!ticket || ticket.settled) return false
    Object.assign(ticket, patch, { updatedAt: Date.now() })
    write(list)
    return true
  }, [])

  // Freeze the final outcome onto a ticket once its games are all done, so the
  // result survives after the slate rolls to the next day (when the live batters
  // no longer carry these legs).
  const settle = useCallback((id, cashed) => {
    const list = read()
    const t = list.find((x) => x.id === id)
    if (t && !t.settled) { t.settled = { cashed, at: Date.now() }; write(list) }
  }, [])

  const isTracked = useCallback((id) => tickets.some((t) => t.id === id), [tickets])

  return { tickets, toggle, remove, update, settle, isTracked }
}
