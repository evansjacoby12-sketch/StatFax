import { normalizePlayerName } from './providers/odds.mjs'

const HARD_OUT = /\b(out|inactive|injured reserve|\bir\b|pup|suspend|non-football injury|nfi)\b/i
const DOUBTFUL = /doubtful/i
const QUESTIONABLE = /questionable|game.?time decision/i
const DNP = /did not practice|\bdnp\b/i
const LIMITED = /limited/i

export function indexAvailability(payload) {
  const byId = new Map()
  const byName = new Map()
  for (const player of payload?.players || []) {
    if (player.espnId != null) byId.set(String(player.espnId), player)
    if (player.name) byName.set(normalizePlayerName(player.name), player)
  }
  return { byId, byName, generatedAt: payload?.generatedAt || null }
}

export function externalAvailabilityFor(player, index) {
  return index?.byId?.get(String(player.espnId)) || index?.byName?.get(normalizePlayerName(player.name)) || null
}

export function assessPlayerAvailability(player, external = null) {
  const status = external?.status || player?.injury?.status || player?.rosterStatus || 'Active'
  const practice = external?.practiceParticipation || player?.injury?.practiceParticipation || null
  const detail = external?.detail || player?.injury?.detail || null
  const combined = [status, practice, detail].filter(Boolean).join(' · ')
  const explicitlyInactive = external?.active === false || external?.inactive === true
  if (explicitlyInactive || HARD_OUT.test(combined)) {
    return { eligible: false, multiplier: 0, status, practice, detail, label: combined || 'Inactive', tone: 'out', reason: 'inactive-or-out' }
  }
  let multiplier = 1
  let reason = 'active'
  let tone = 'good'
  if (DOUBTFUL.test(combined)) { multiplier = .25; reason = 'doubtful'; tone = 'warn' }
  else if (DNP.test(combined) && !/rest/i.test(combined)) { multiplier = .65; reason = 'did-not-practice'; tone = 'warn' }
  else if (QUESTIONABLE.test(combined)) { multiplier = .82; reason = 'questionable'; tone = 'warn' }
  else if (LIMITED.test(combined)) { multiplier = .92; reason = 'limited'; tone = 'warn' }
  return { eligible: true, multiplier, status, practice, detail, label: combined || 'Active', tone, reason }
}
