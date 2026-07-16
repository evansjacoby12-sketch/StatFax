// Shared AI explanation hooks. Player explanations use a structured
// Case-vs-Caution contract; combo explanations retain the legacy paragraph
// contract. In both paths AI only narrates already-computed engine facts.

import { useEffect, useState } from 'react'
import {
  PLAYER_EXPLAIN_VERSION,
  buildPlayerExplainSignals,
  normalizePlayerExplain,
  playerExplainPayload,
} from './playerExplain.js'

export {
  PLAYER_EXPLAIN_VERSION,
  buildPlayerExplainSignals,
  normalizePlayerExplain,
  playerExplainPayload,
} from './playerExplain.js'

export const WORKER_URL = import.meta.env?.VITE_WORKER_URL || ''

const mem = new Map()
const today = () => { try { return new Date().toISOString().slice(0, 10) } catch { return 'x' } }
const keyFor = (id, version = 1) => version === PLAYER_EXPLAIN_VERSION
  ? `sf_explain_v${version}_${id}_${today()}`
  : `sf_explain_${id}_${today()}`

export function readExplainCache(id, version = 1) {
  if (!id) return null
  const key = keyFor(id, version)
  if (mem.has(key)) return mem.get(key)
  try {
    const stored = sessionStorage.getItem(key)
    if (!stored) return null
    const value = version === PLAYER_EXPLAIN_VERSION ? JSON.parse(stored) : stored
    mem.set(key, value)
    return value
  } catch {
    return null
  }
}

export function writeExplainCache(id, value, version = 1) {
  if (!id || !value) return
  const key = keyFor(id, version)
  mem.set(key, value)
  try {
    sessionStorage.setItem(key, version === PLAYER_EXPLAIN_VERSION ? JSON.stringify(value) : value)
  } catch { /* quota / private mode — memory cache still works */ }
}

function playerCacheId(batter) {
  if (!batter?.playerId) return null
  return batter.gamePk != null ? `${batter.playerId}-${batter.gamePk}` : String(batter.playerId)
}

export function useExplain(batter) {
  const [status, setStatus] = useState('idle')
  const [explanation, setExplanation] = useState(null)
  const cacheId = playerCacheId(batter)

  useEffect(() => {
    const cached = readExplainCache(cacheId, PLAYER_EXPLAIN_VERSION)
    if (cached) { setExplanation(cached); setStatus('done') }
    else { setExplanation(null); setStatus('idle') }
  }, [cacheId])

  const available = !!WORKER_URL && buildPlayerExplainSignals(batter).some((signal) => signal.tone === 'case')

  const run = async () => {
    if (!available) return
    setStatus('loading')
    try {
      const resp = await fetch(`${WORKER_URL}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(playerExplainPayload(batter)),
      })
      const data = await resp.json().catch(() => ({}))
      const normalized = resp.ok ? normalizePlayerExplain(batter, data) : null
      if (normalized) {
        setExplanation(normalized)
        setStatus('done')
        writeExplainCache(cacheId, normalized, PLAYER_EXPLAIN_VERSION)
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return {
    status,
    explanation,
    text: explanation?.text || explanation?.bottomLine || '',
    run,
    available,
  }
}

// Combo “Why?” keeps the existing paragraph response and cache contract.
function comboKey(group, date) {
  const ids = (group?.legs || [])
    .filter((b) => b?.playerId != null)
    .map((b) => b.gamePk != null ? `${b.playerId}@${b.gamePk}` : String(b.playerId))
    .sort()
    .join('-')
  return `combo_${date || '?'}_${ids}`
}

function comboPayload(group) {
  const legLine = (b) => {
    const grade = b.grade?.label || b.grade || '?'
    const probability = Number.isFinite(b.hrProbability) ? ` ${(b.hrProbability * 100).toFixed(0)}% HR` : ''
    const reason = b.reasons?.[0] ? ` — ${String(b.reasons[0]).slice(0, 90)}` : ''
    return `${b.name} (${grade}${probability}, vs ${b.pitcher?.name || '?'})${reason}`
  }
  return {
    kind: 'combo',
    name: `${group.size}-leg ${group.label} parlay`,
    grade: group.grade,
    reasons: [
      `Strategy: ${group.label}${group.desc ? ` — ${group.desc}` : ''}`,
      `Every leg must homer to cash; model all-hit ${((group.allHit ?? 0) * 100).toFixed(1)}%`,
      ...(group.legs || []).map(legLine),
    ],
  }
}

export function useComboExplain(group, slateDate) {
  const key = comboKey(group, slateDate)
  const [status, setStatus] = useState('idle')
  const [text, setText] = useState('')

  useEffect(() => {
    const cached = readExplainCache(key)
    if (cached) { setText(cached); setStatus('done') }
    else { setText(''); setStatus('idle') }
  }, [key])

  const available = !!WORKER_URL && (group?.legs?.length ?? 0) >= 2

  const run = async () => {
    if (!available) return
    setStatus('loading')
    try {
      const resp = await fetch(`${WORKER_URL}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(comboPayload(group)),
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok && data.text) {
        setText(data.text)
        setStatus('done')
        writeExplainCache(key, data.text)
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return { status, text, run, available }
}
