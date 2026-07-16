// Pure Case-vs-Caution contract helpers. Kept separate from the React hook so
// the root Node test suite can validate the browser boundary without loading
// UI dependencies before the UI install step runs in CI.

export const PLAYER_EXPLAIN_VERSION = 3

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

  // Prefer a concrete counter-case over a generic probability disclaimer.
  // These are all engine-owned facts already present on the player-game row.
  if (Number.isFinite(batter?.battingOrder) && batter.battingOrder >= 7) {
    add('context:order', 'caution', 'The lower lineup spot can reduce the number of plate appearances available to do damage.', 'clock')
  }
  if (Number.isFinite(batter?.pitcher?.season?.kPer9) && batter.pitcher.season.kPer9 >= 9) {
    add('context:pitcher-k', 'caution', `${compact(batter.pitcher?.name, 60) || 'The opposing pitcher'} still has strong strikeout ability, which can erase a plate appearance before a hittable mistake arrives.`, 'activity')
  }
  if (Number.isFinite(batter?.pitcher?.savant?.barrelPctAllowed) && batter.pitcher.savant.barrelPctAllowed <= 7) {
    add('context:pitcher-contact', 'caution', `${compact(batter.pitcher?.name, 60) || 'The opposing pitcher'} has limited barrels overall, so the hitter may not get the ideal contact the matchup case needs.`, 'shield')
  }
  if (Number.isFinite(batter?.envScore) && batter.envScore < 55) {
    add('context:environment', 'caution', 'Park and weather are the weakest part of the case and do not add much margin for a home run.', 'cloud')
  }
  if (Number.isFinite(batter?.matchupScore) && batter.matchupScore < 55) {
    add('context:matchup', 'caution', 'The pitcher matchup is the weakest model pillar, so the hitter may have to create the damage without much matchup help.', 'shield')
  }
  if (Number.isFinite(batter?.batterScore) && batter.batterScore < 55) {
    add('context:contact', 'caution', 'The underlying batter-quality pillar is the weakest part of the case, leaving less room if the matchup does not carry it.', 'activity')
  }

  ;(Array.isArray(batter?.reasons) ? batter.reasons : [])
    .slice(0, 14)
    .forEach((reason, index) => {
      if (TECHNICAL_CAUTION.test(String(reason || ''))) add(`reason:${index}`, 'caution', reason, 'shield')
    })

  add(
    'variance',
    'caution',
    'No single matchup warning stands out; the case still depends on getting a hittable pitch to drive.',
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
  const allCautions = signals.filter((signal) => signal.tone === 'caution')
  const specificCautions = allCautions.filter((signal) => signal.id !== 'variance')
  const cautionCandidates = specificCautions.length ? specificCautions : allCautions
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
