// Pure Case-vs-Caution contract helpers. Kept separate from the React hook so
// the root Node test suite can validate the browser boundary without loading
// UI dependencies before the UI install step runs in CI.

export const PLAYER_EXPLAIN_VERSION = 2

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
