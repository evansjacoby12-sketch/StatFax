// Shared AI explanation plumbing. Player explanations use a structured
// Case-vs-Caution contract; combo explanations retain the legacy paragraph
// contract. In both paths the AI only narrates already-computed engine facts.

import { useEffect, useState } from 'react'

export const WORKER_URL = import.meta.env?.VITE_WORKER_URL || ''
export const PLAYER_EXPLAIN_VERSION = 2

const mem = new Map()
const today = () => { try { return new Date().toISOString().slice(0, 10) } catch { return 'x' } }
const keyFor = (id, version = 1) => version === PLAYER_EXPLAIN_VERSION
  ? `sf_explain_v2_${id}_${today()}`
  : `sf_explain_${id}_${today()}`

function compact(value, max = 220) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max).trim()
}

function cleanBottomLine(value) {
  const text = compact(value, 180).replace(/[*_`#<>]/g, '')
  if (
    !text
    || /\d|%|\b(?:lock|guarantee(?:d)?|best bet|wager|odds?|value|due|overdue|owed|safe|high[- ]floor)\b/i.test(text)
  ) return ''
  return text
}

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

const TECHNICAL_CAUTION = /\b(?:limits?|suppresses?|tough|cold|below average|not elite|weak|poor|risk|unconfirmed|scratch|slump)\b/i

// Build stable, engine-owned signal candidates. The AI receives these IDs and
// text, then may select IDs only; it never returns replacement evidence.
export function buildPlayerExplainSignals(batter) {
  const seen = new Set()
  const signals = []
  const add = (id, tone, text, icon = null) => {
    const clean = compact(text, 220)
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) return
    seen.add(key)
    signals.push({ id, tone, text: clean, icon: compact(icon, 30) || null })
  }

  ;(Array.isArray(batter?.eli5Reasons) ? batter.eli5Reasons : [])
    .slice(0, 14)
    .forEach((reason, index) => {
      const tone = reason?.tone === 'good' ? 'case' : 'caution'
      add(`signal:${index}`, tone, reason?.text, reason?.icon)
    })

  // Older cached slates may not have enough ELI5 rows. Add clearly positive
  // technical engine reasons without guessing the tone of negative language.
  if (signals.filter((signal) => signal.tone === 'case').length < 2) {
    ;(Array.isArray(batter?.reasons) ? batter.reasons : [])
      .slice(0, 14)
      .forEach((reason, index) => {
        if (!TECHNICAL_CAUTION.test(String(reason || ''))) add(`reason:${index}`, 'case', reason, 'activity')
      })
  }

  const probability = Number.isFinite(batter?.hrProbability)
    ? `${(batter.hrProbability * 100).toFixed(1)}%`
    : 'The model probability'
  add(
    'variance',
    'caution',
    `${probability} is an estimated home-run chance, not a predicted outcome.`,
    'shield',
  )
  const variance = signals.find((signal) => signal.id === 'variance')
  const bounded = signals.filter((signal) => signal.id !== 'variance').slice(0, 17)
  return variance ? [...bounded, variance] : bounded
}

export function playerExplainPayload(batter) {
  return {
    kind: 'player',
    version: PLAYER_EXPLAIN_VERSION,
    name: compact(batter?.name, 60),
    grade: compact(batter?.grade?.label || batter?.grade, 12).toUpperCase(),
    hrProb: Number.isFinite(batter?.hrProbability) ? batter.hrProbability : null,
    pitcher: compact(batter?.pitcher?.name, 60) || null,
    park: compact(batter?.game?.venueName, 80) || null,
    signals: buildPlayerExplainSignals(batter).map(({ id, tone, text }) => ({ id, tone, text })),
  }
}

export function normalizePlayerExplain(batter, raw) {
  if (raw?.text && Number(raw?.version || 1) < PLAYER_EXPLAIN_VERSION) {
    return { version: 1, text: compact(raw.text, 500) }
  }
  if (Number(raw?.version) !== PLAYER_EXPLAIN_VERSION) return null

  const signals = buildPlayerExplainSignals(batter)
  const caseCandidates = signals.filter((signal) => signal.tone === 'case')
  const cautionCandidates = signals.filter((signal) => signal.tone === 'caution')
  const caseById = new Map(caseCandidates.map((signal) => [signal.id, signal]))
  const cautionById = new Map(cautionCandidates.map((signal) => [signal.id, signal]))
  const selectedCase = []
  const used = new Set()

  for (const id of Array.isArray(raw.caseIds) ? raw.caseIds : []) {
    const signal = caseById.get(id)
    if (!signal || used.has(id)) continue
    used.add(id)
    selectedCase.push(signal)
  }
  for (const signal of caseCandidates) {
    if (selectedCase.length >= Math.min(2, caseCandidates.length)) break
    if (used.has(signal.id)) continue
    used.add(signal.id)
    selectedCase.push(signal)
  }

  const cautionSignal = cautionById.get(raw.cautionId) || cautionCandidates[0] || null
  if (!selectedCase.length || !cautionSignal) return null

  return {
    version: PLAYER_EXPLAIN_VERSION,
    bottomLine: cleanBottomLine(raw.bottomLine)
      || 'The engine sees a favorable combination, but the home-run outcome remains high variance.',
    caseSignals: selectedCase,
    cautionSignal,
  }
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
  const ids = (group?.legs || []).map((b) => b.playerId).filter((x) => x != null).slice().sort((a, b) => a - b).join('-')
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
