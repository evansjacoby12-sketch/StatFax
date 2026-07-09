// Shared "Explain this pick" plumbing — one lazy Haiku narration per player,
// reused by the player drawer AND the board row so a tap in either place
// populates both. The worker's /explain endpoint turns the model's already-
// computed reason lines into plain English; it never sees raw data, does math,
// or changes a score. See server/cloudflare/src/worker.js → handleExplain.

import { useEffect, useState } from 'react'

export const WORKER_URL = import.meta.env?.VITE_WORKER_URL || ''

// ── Cache — keyed per player per day ────────────────────────────────────────
// The slate rebuilds daily, so a date-stamped key auto-expires stale prose
// without ever serving one day's explanation for another day's board. A
// module-level Map keeps it instant within a session; sessionStorage lets it
// survive drawer close / row collapse. Both are best-effort — a miss re-fetches.

const mem = new Map()
const today = () => { try { return new Date().toISOString().slice(0, 10) } catch { return 'x' } }
const keyFor = (playerId) => `sf_explain_${playerId}_${today()}`

export function readExplainCache(playerId) {
  if (!playerId) return null
  const k = keyFor(playerId)
  if (mem.has(k)) return mem.get(k)
  try {
    const v = sessionStorage.getItem(k)
    if (v) { mem.set(k, v); return v }
  } catch { /* storage unavailable — fall through to miss */ }
  return null
}

export function writeExplainCache(playerId, text) {
  if (!playerId || !text) return
  const k = keyFor(playerId)
  mem.set(k, text)
  try { sessionStorage.setItem(k, text) } catch { /* quota / private mode — memory cache still holds */ }
}

// Facts sent to the narrator — all pre-computed by the engine. The worker
// clamps/sanitizes these again server-side; sending only what it uses keeps
// the payload tiny.
function explainPayload(b) {
  return {
    name: b.name,
    grade: b.grade?.label,
    hrProb: b.hrProbability,
    batterScore: b.batterScore,
    matchupScore: b.matchupScore,
    envScore: b.envScore,
    pitcher: b.pitcher?.name,
    park: b.game?.venueName,
    reasons: b.reasons,
  }
}

// Shared hook: returns { status, text, run, available }.
//   status: 'idle' | 'loading' | 'done' | 'error'
//   available: false when the worker URL is unset or there's nothing to narrate
// Hydrates from cache (or resets) whenever the player changes; run() fires the
// fetch on demand and writes the result back to the shared cache.
export function useExplain(b) {
  const [status, setStatus] = useState('idle')
  const [text, setText] = useState('')

  useEffect(() => {
    const cached = readExplainCache(b?.playerId)
    if (cached) { setText(cached); setStatus('done') }
    else { setText(''); setStatus('idle') }
  }, [b?.playerId])

  const available = !!WORKER_URL && !!b?.reasons?.length

  const run = async () => {
    if (!available) return
    setStatus('loading')
    try {
      const resp = await fetch(`${WORKER_URL}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(explainPayload(b)),
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok && data.text) {
        setText(data.text)
        setStatus('done')
        writeExplainCache(b.playerId, data.text)
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return { status, text, run, available }
}
